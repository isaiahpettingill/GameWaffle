// Convert the single combined SDL sampler into WebGPU's separate texture and sampler.
use naga::{AddressSpace, Binding, ImageClass, ImageDimension, ScalarKind, ShaderStage, TypeInner};
use serde::Serialize;
use wasm_bindgen::prelude::*;

const MAX_MODULE: usize = 512 * 1024;
const MAX_UNIFORMS: u32 = 256;

fn instruction(words: &mut Vec<u32>, opcode: u16, operands: &[u32]) {
    words.push(((operands.len() as u32 + 1) << 16) | u32::from(opcode));
    words.extend_from_slice(operands);
}

fn split_sampler(bytes: &[u8]) -> Result<Vec<u8>, String> {
    const ENTRY: u16 = 15;
    const TYPE_SAMPLER: u16 = 26;
    const TYPE_SAMPLED_IMAGE: u16 = 27;
    const TYPE_POINTER: u16 = 32;
    const VARIABLE: u16 = 59;
    const LOAD: u16 = 61;
    const DECORATE: u16 = 71;
    const SAMPLED_IMAGE: u16 = 86;
    const BINDING: u32 = 33;
    const SET: u32 = 34;

    if bytes.len() < 20 || bytes.len() > MAX_MODULE || bytes.len() % 4 != 0 {
        return Err("Choose a SPIR-V binary of up to 512 KiB".into());
    }
    let words: Vec<u32> = bytes
        .chunks_exact(4)
        .map(|word| u32::from_le_bytes(word.try_into().unwrap()))
        .collect();
    if words[0] != 0x0723_0203 || !(1..=65536).contains(&words[3]) {
        return Err("Invalid little-endian SPIR-V header".into());
    }
    let mut instructions = Vec::new();
    let mut rest = &words[5..];
    while let Some(&head) = rest.first() {
        let length = (head >> 16) as usize;
        if length == 0 || length > rest.len() {
            return Err("Invalid SPIR-V instruction length".into());
        }
        instructions.push((head as u16, &rest[1..length]));
        rest = &rest[length..];
    }
    let decorations = |reason, value| {
        instructions.iter().filter_map(move |&(op, args)| {
            if op == DECORATE && args.len() == 3 && args[1] == reason && args[2] == value {
                Some(args[0])
            } else {
                None
            }
        })
    };
    let group: Vec<_> = decorations(SET, 2).collect();
    let screen = decorations(BINDING, 0).find(|id| group.contains(id));
    let Some(screen) = screen else {
        return Ok(bytes.to_vec());
    };
    let pointer = instructions
        .iter()
        .find_map(|&(op, args)| {
            (op == VARIABLE && args.len() == 3 && args[1] == screen && args[2] == 0)
                .then(|| args[0])
        })
        .ok_or("Use a combined sampler2D at set 2 binding 0")?;
    let sampled = instructions
        .iter()
        .find_map(|&(op, args)| {
            (op == TYPE_POINTER && args.len() == 3 && args[0] == pointer && args[1] == 0)
                .then(|| args[2])
        })
        .ok_or("Invalid screen sampler pointer")?;
    let image = instructions
        .iter()
        .find_map(|&(op, args)| {
            (op == TYPE_SAMPLED_IMAGE && args.len() == 2 && args[0] == sampled).then(|| args[1])
        })
        .ok_or("Use a combined sampler2D at set 2 binding 0")?;
    let mut result = words[..5].to_vec();
    let mut next = words[3];
    let mut id = || {
        let current = next;
        next += 1;
        current
    };
    let image_pointer = id();
    let sampler_type = id();
    let sampler_pointer = id();
    let sampler = id();
    for (op, args) in instructions {
        if op == VARIABLE && args.get(1) == Some(&screen) {
            instruction(&mut result, TYPE_POINTER, &[image_pointer, 0, image]);
            instruction(&mut result, TYPE_SAMPLER, &[sampler_type]);
            instruction(
                &mut result,
                TYPE_POINTER,
                &[sampler_pointer, 0, sampler_type],
            );
            instruction(&mut result, VARIABLE, &[sampler_pointer, sampler, 0]);
            instruction(&mut result, VARIABLE, &[image_pointer, screen, 0]);
        } else if op == LOAD && args.get(2) == Some(&screen) {
            if args.len() != 3 || args[0] != sampled {
                return Err("Unsupported load of the screen sampler".into());
            }
            let loaded_image = id();
            let loaded_sampler = id();
            instruction(&mut result, LOAD, &[image, loaded_image, screen]);
            instruction(&mut result, LOAD, &[sampler_type, loaded_sampler, sampler]);
            instruction(
                &mut result,
                SAMPLED_IMAGE,
                &[sampled, args[1], loaded_image, loaded_sampler],
            );
        } else if op == ENTRY {
            let mut interface = args.to_vec();
            if let Some(end) = args
                .get(2..)
                .and_then(|name| name.iter().position(|word| word.to_le_bytes().contains(&0)))
            {
                if args[3 + end..].contains(&screen) {
                    interface.push(sampler);
                }
            }
            instruction(&mut result, op, &interface);
        } else {
            instruction(&mut result, op, args);
            if op == DECORATE && args == [screen, SET, 2] {
                instruction(&mut result, DECORATE, &[sampler, SET, 2]);
                instruction(&mut result, DECORATE, &[sampler, BINDING, 1]);
            }
        }
    }
    result[3] = next;
    Ok(result.into_iter().flat_map(u32::to_le_bytes).collect())
}

#[derive(Serialize)]
struct Parameter {
    name: String,
    offset: u32,
    lanes: u8,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    automatic: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Shader {
    entry: String,
    wgsl: String,
    msl: String,
    msl_entry: String,
    uniform_size: u32,
    samples_screen: bool,
    parameters: Vec<Parameter>,
}

fn reflection(data: &[u8]) -> Result<Shader, String> {
    let split = split_sampler(data)?;
    let options = naga::front::spv::Options {
        adjust_coordinate_space: false,
        ..Default::default()
    };
    let mut module =
        naga::front::spv::parse_u8_slice(&split, &options).map_err(|error| error.to_string())?;
    if module.entry_points.len() != 1 || module.entry_points[0].stage != ShaderStage::Fragment {
        return Err("A shader asset needs one fragment entry point".into());
    }
    let fragment = &mut module.entry_points[0];
    let entry = std::mem::replace(&mut fragment.name, "waffle_fragment".into());
    let ty_is = |ty, vector| {
        matches!(module.types[ty].inner,
        TypeInner::Vector { size, scalar } if size as u8 == vector && scalar.kind == ScalarKind::Float && scalar.width == 4)
    };
    let output = fragment
        .function
        .result
        .as_ref()
        .ok_or("Return a vec4 color at location 0")?;
    if !matches!(output.binding, Some(Binding::Location { location: 0, .. }))
        || !ty_is(output.ty, 4)
    {
        return Err("Return a vec4 color at location 0".into());
    }
    let check_input = |binding: &Option<Binding>, ty| match binding {
        Some(Binding::Location { location: 1, .. }) => ty_is(ty, 2),
        Some(Binding::Location { location: 0, .. }) => ty_is(ty, 4),
        Some(Binding::BuiltIn(naga::BuiltIn::Position { .. } | naga::BuiltIn::FrontFacing)) => true,
        _ => false,
    };
    for argument in &fragment.function.arguments {
        let valid = match &module.types[argument.ty].inner {
            TypeInner::Struct { members, .. } => members
                .iter()
                .all(|member| check_input(&member.binding, member.ty)),
            _ => check_input(&argument.binding, argument.ty),
        };
        if !valid {
            return Err("Use vec2 UV at location 1 and optional vec4 color at location 0".into());
        }
    }
    let mut shader = Shader {
        entry,
        wgsl: String::new(),
        msl: String::new(),
        msl_entry: String::new(),
        uniform_size: 0,
        samples_screen: false,
        parameters: Vec::new(),
    };
    use naga::back::msl::{BindSamplerTarget, BindTarget, EntryPointResources};
    let mut metal = EntryPointResources::default();
    let mut sampler_present = false;
    for (_, global) in module.global_variables.iter_mut() {
        let Some(ref mut binding) = global.binding else {
            if matches!(global.space, AddressSpace::Private) {
                continue;
            }
            return Err("Only the screen sampler and parameter buffer can be bound".into());
        };
        let (slot, target) = match (binding.group, binding.binding, global.space, &module.types[global.ty].inner) {
            (2, 0, AddressSpace::Handle, TypeInner::Image { dim: ImageDimension::D2, arrayed: false, class: ImageClass::Sampled { kind: ScalarKind::Float, multi: false } }) => {
                shader.samples_screen = true;
                (0, BindTarget { texture: Some(0), ..Default::default() })
            }
            (2, 1, AddressSpace::Handle, TypeInner::Sampler { comparison: false }) => {
                sampler_present = true;
                (1, BindTarget { sampler: Some(BindSamplerTarget::Resource(0)), ..Default::default() })
            }
            (3, 0, AddressSpace::Uniform, TypeInner::Struct { members, span }) if *span > 0 && *span <= MAX_UNIFORMS => {
                if shader.uniform_size != 0 { return Err("Use one uniform block".into()); }
                shader.uniform_size = span.next_multiple_of(16);
                for (index, member) in members.iter().enumerate() {
                    let (scalar, lanes) = match module.types[member.ty].inner {
                        TypeInner::Scalar(scalar) => (scalar, 1),
                        TypeInner::Vector { size, scalar } => (scalar, size as u8),
                        _ => return Err("Use float, int, uint, or 2–4 component vectors for uniforms".into()),
                    };
                    let kind = match (scalar.kind, scalar.width) {
                        (ScalarKind::Float, 4) => "float",
                        (ScalarKind::Sint, 4) => "int",
                        (ScalarKind::Uint, 4) => "uint",
                        _ => return Err("Use 32-bit uniform components".into()),
                    };
                    let name = member.name.clone().unwrap_or_else(|| format!("parameter_{}", index + 1));
                    let automatic = match (name.as_str(), kind, lanes) {
                        ("resolution", "float", 2) => Some("resolution"),
                        ("time", "float", 1) => Some("time"),
                        ("delta_time", "float", 1) => Some("delta_time"),
                        ("resolution" | "time" | "delta_time", _, _) => return Err(format!("Wrong type for automatic uniform {name}")),
                        _ => None,
                    };
                    shader.parameters.push(Parameter { name, offset: member.offset, kind, lanes, automatic });
                }
                (2, BindTarget { buffer: Some(0), ..Default::default() })
            }
            _ => return Err("Bind sampler2D at set 2 binding 0 and an optional parameter block at set 3 binding 0".into()),
        };
        binding.group = 0;
        binding.binding = slot;
        if metal.resources.insert(binding.clone(), target).is_some() {
            return Err("Duplicate shader resource binding".into());
        }
    }
    if shader.samples_screen != sampler_present {
        return Err("Use one combined sampler2D for the screen".into());
    }
    let info = naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::empty(),
    )
    .validate(&module)
    .map_err(|error| format!("Shader validation failed: {error:#}"))?;
    shader.wgsl =
        naga::back::wgsl::write_string(&module, &info, naga::back::wgsl::WriterFlags::empty())
            .map_err(|error| error.to_string())?;
    let options = naga::back::msl::Options {
        lang_version: (2, 0),
        spirv_cross_compatibility: true,
        per_entry_point_map: [(String::from("waffle_fragment"), metal)].into(),
        fake_missing_bindings: false,
        ..Default::default()
    };
    let (source, metadata) =
        naga::back::msl::write_string(&module, &info, &options, &Default::default())
            .map_err(|error| error.to_string())?;
    shader.msl = source;
    shader.msl_entry = metadata
        .entry_point_names
        .into_iter()
        .next()
        .ok_or("Missing Metal shader entry point")?
        .map_err(|error| error.to_string())?;
    Ok(shader)
}

#[wasm_bindgen]
pub fn inspect_spirv(data: &[u8]) -> Result<String, String> {
    let shader = reflection(data)?;
    serde_json::to_string(&shader).map_err(|error| error.to_string())
}
