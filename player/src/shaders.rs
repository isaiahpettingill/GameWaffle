use crate::Error;
use gamewaffle_runtime::ShaderPass;
use sdl3::{
    pixels::PixelFormat,
    render::{BlendMode, Canvas, FRect, RenderTarget, ScaleMode, Texture, TextureCreator},
    sys::{gpu::*, properties::*, render::*},
    video::Window,
};
use serde::Deserialize;
use std::{collections::BTreeMap, ffi::CString, ptr};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Shader {
    pub title: String,
    pub fingerprint: String,
    pub entry: String,
    pub msl: String,
    pub msl_entry: String,
    #[serde(with = "serde_bytes")]
    pub spirv: Vec<u8>,
    pub uniform_size: usize,
    pub parameters: Vec<Parameter>,
}

#[derive(Deserialize)]
pub(crate) struct Parameter {
    offset: usize,
    automatic: Option<String>,
}

pub(crate) fn canvas(window: Window) -> Canvas<Window> {
    if std::env::var_os("SDL_RENDER_DRIVER").is_some() {
        return window.into_canvas();
    }
    // The renderer owns its GPU device. Keep SDL's fallback for software/dummy drivers.
    let renderer = unsafe {
        let properties = SDL_CreateProperties();
        if properties == 0 {
            return window.into_canvas();
        }
        SDL_SetPointerProperty(
            properties,
            SDL_PROP_RENDERER_CREATE_WINDOW_POINTER,
            window.raw().cast(),
        );
        SDL_SetStringProperty(
            properties,
            SDL_PROP_RENDERER_CREATE_NAME_STRING,
            c"gpu".as_ptr(),
        );
        let driver = if cfg!(target_os = "macos") {
            c"metal"
        } else {
            c"vulkan"
        };
        SDL_SetStringProperty(
            properties,
            SDL_PROP_GPU_DEVICE_CREATE_NAME_STRING,
            driver.as_ptr(),
        );
        let renderer = SDL_CreateRendererWithProperties(properties);
        SDL_DestroyProperties(properties);
        renderer
    };
    if renderer.is_null() {
        window.into_canvas()
    } else {
        // SDL created renderer from this same window and Canvas takes ownership.
        unsafe { Canvas::from_window_and_renderer(window, renderer) }
    }
}

struct Program {
    device: *mut SDL_GPUDevice,
    shader: *mut SDL_GPUShader,
    state: *mut SDL_GPURenderState,
}

impl Drop for Program {
    fn drop(&mut self) {
        unsafe {
            SDL_DestroyGPURenderState(self.state);
            SDL_ReleaseGPUShader(self.device, self.shader);
        }
    }
}

pub(crate) struct Pipeline {
    device: *mut SDL_GPUDevice,
    programs: BTreeMap<String, Result<Program, String>>,
    pub(crate) error: Option<String>,
}

impl Pipeline {
    pub(crate) fn new<T: RenderTarget>(canvas: &Canvas<T>) -> Self {
        Self {
            device: unsafe { SDL_GetGPURendererDevice(canvas.raw()) },
            programs: BTreeMap::new(),
            error: None,
        }
    }

    pub(crate) fn reset<T: RenderTarget>(&mut self, canvas: &Canvas<T>) {
        if !self.programs.is_empty() {
            unsafe { SDL_FlushRenderer(canvas.raw()) };
            self.programs.clear();
        }
        self.error = None;
    }

    fn compile<T: RenderTarget>(
        device: *mut SDL_GPUDevice,
        canvas: &Canvas<T>,
        asset: &Shader,
    ) -> Result<Program, String> {
        if device.is_null() {
            return Err("Custom shaders need a Vulkan or Metal renderer.".into());
        }
        if asset.uniform_size > 256 || asset.uniform_size % 16 != 0 {
            return Err("Invalid shader uniform block size".into());
        }
        let formats = unsafe { SDL_GetGPUShaderFormats(device) };
        let (format, source, entry) = if formats.0 & SDL_GPU_SHADERFORMAT_SPIRV.0 != 0 {
            (
                SDL_GPU_SHADERFORMAT_SPIRV,
                asset.spirv.as_slice(),
                asset.entry.as_str(),
            )
        } else if formats.0 & SDL_GPU_SHADERFORMAT_MSL.0 != 0 {
            (
                SDL_GPU_SHADERFORMAT_MSL,
                asset.msl.as_bytes(),
                asset.msl_entry.as_str(),
            )
        } else {
            return Err("The selected graphics backend cannot run this shader.".into());
        };
        let entry = CString::new(entry).map_err(|_| "Invalid shader entry point")?;
        let info = SDL_GPUShaderCreateInfo {
            code_size: source.len(),
            code: source.as_ptr(),
            entrypoint: entry.as_ptr(),
            format,
            stage: SDL_GPU_SHADERSTAGE_FRAGMENT,
            num_samplers: 1,
            num_uniform_buffers: u32::from(asset.uniform_size != 0),
            ..Default::default()
        };
        let shader = unsafe { SDL_CreateGPUShader(device, &info) };
        if shader.is_null() {
            return Err(format!("{} — {}", asset.title, sdl3::get_error()));
        }
        let state = unsafe {
            SDL_CreateGPURenderState(
                canvas.raw(),
                &SDL_GPURenderStateCreateInfo {
                    fragment_shader: shader,
                    ..Default::default()
                },
            )
        };
        if state.is_null() {
            unsafe { SDL_ReleaseGPUShader(device, shader) };
            return Err(format!("{} — {}", asset.title, sdl3::get_error()));
        }
        Ok(Program {
            device,
            shader,
            state,
        })
    }

    pub(crate) fn prepare<T: RenderTarget>(
        &mut self,
        canvas: &Canvas<T>,
        shaders: &BTreeMap<String, Shader>,
        passes: &[ShaderPass],
    ) -> bool {
        for pass in passes {
            let Some(asset) = shaders.get(&pass.shader) else {
                self.error = Some(format!("Missing shader {}", pass.shader));
                return false;
            };
            if let Err(error) = self
                .programs
                .entry(asset.fingerprint.clone())
                .or_insert_with(|| Self::compile(self.device, canvas, asset))
            {
                self.error = Some(error.clone());
                return false;
            }
        }
        true
    }

    pub(crate) fn draw<T: RenderTarget>(
        &self,
        canvas: &mut Canvas<T>,
        targets: &mut Targets<'_>,
        shaders: &BTreeMap<String, Shader>,
        passes: &[ShaderPass],
        tick: u64,
        destination: FRect,
        paint: impl FnOnce(&mut Canvas<T>) -> Result<(), Error>,
    ) -> Result<(), Error> {
        let [width, height] = targets.dimensions;
        let [first, second] = &mut targets.textures;
        let mut result = Ok(());
        let mut paint = Some(paint);
        canvas.with_texture_canvas(first, |target| {
            result = paint.take().unwrap()(target);
        })?;
        result?;
        for (index, pass) in passes.iter().enumerate() {
            let (from, to) = if index % 2 == 0 {
                (&*first, &mut *second)
            } else {
                (&*second, &mut *first)
            };
            let asset = &shaders[&pass.shader];
            let Some(Ok(program)) = self.programs.get(&asset.fingerprint) else {
                return Err("Shader was not prepared".into());
            };
            if index + 1 == passes.len() {
                draw_pass(
                    canvas,
                    from,
                    destination,
                    program,
                    asset,
                    pass,
                    [width, height],
                    tick,
                )?;
            } else {
                let mut result = Ok(());
                canvas.with_texture_canvas(to, |target| {
                    target.set_draw_color(sdl3::pixels::Color::BLACK);
                    target.clear();
                    result = draw_pass(
                        target,
                        from,
                        FRect::new(0., 0., width as f32, height as f32),
                        program,
                        asset,
                        pass,
                        [width, height],
                        tick,
                    );
                })?;
                result?;
            }
        }
        Ok(())
    }
}

fn draw_pass<T: RenderTarget>(
    canvas: &mut Canvas<T>,
    source: &Texture<'_>,
    destination: FRect,
    program: &Program,
    shader: &Shader,
    pass: &ShaderPass,
    size: [u32; 2],
    tick: u64,
) -> Result<(), Error> {
    let mut words = [0u32; 64];
    for (word, value) in words.iter_mut().zip(&pass.uniforms) {
        *word = *value;
    }
    for param in &shader.parameters {
        let offset = param.offset / 4;
        match param.automatic.as_deref() {
            Some("resolution") if offset + 1 < words.len() => {
                words[offset] = (size[0] as f32).to_bits();
                words[offset + 1] = (size[1] as f32).to_bits();
            }
            Some("time") if offset < words.len() => words[offset] = (tick as f32 / 60.).to_bits(),
            Some("delta_time") if offset < words.len() => words[offset] = (1f32 / 60.).to_bits(),
            _ => {}
        }
    }
    let renderer = canvas.raw();
    unsafe {
        if shader.uniform_size != 0
            && !SDL_SetGPURenderStateFragmentUniforms(
                program.state,
                0,
                words.as_ptr().cast(),
                shader.uniform_size as u32,
            )
        {
            return Err(sdl3::get_error().into());
        }
        if !SDL_SetGPURenderState(renderer, program.state) {
            return Err(sdl3::get_error().into());
        }
    }
    let copied = canvas.copy(source, None, destination);
    // SDL flushes queued draws before changing uniforms on a state in use.
    unsafe { SDL_SetGPURenderState(renderer, ptr::null_mut()) };
    copied?;
    Ok(())
}

pub(crate) struct Targets<'a> {
    textures: [Texture<'a>; 2],
    pub(crate) dimensions: [u32; 2],
}

impl<'a> Targets<'a> {
    pub(crate) fn new<C>(
        creator: &'a TextureCreator<C>,
        dimensions: [u32; 2],
    ) -> Result<Self, Error> {
        let target = || -> Result<Texture<'a>, Error> {
            let mut texture =
                creator.create_texture_target(PixelFormat::RGBA32, dimensions[0], dimensions[1])?;
            texture.set_scale_mode(ScaleMode::Nearest);
            texture.set_blend_mode(BlendMode::None);
            Ok(texture)
        };
        Ok(Self {
            textures: [target()?, target()?],
            dimensions,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires a Vulkan display or offscreen driver"]
    fn runs_ordered_gpu_passes() -> Result<(), Error> {
        let sdl = sdl3::init()?;
        let video = sdl.video()?;
        let window = video
            .window("GameWaffle GPU check", 64, 64)
            .hidden()
            .build()?;
        let mut canvas = super::canvas(window);
        assert!(!unsafe { SDL_GetGPURendererDevice(canvas.raw()) }.is_null());
        let creator = canvas.texture_creator();
        let mut pipeline = Pipeline::new(&canvas);
        let shaders = BTreeMap::from([(
            "tint".into(),
            Shader {
                title: "Tint".into(),
                fingerprint: "tint".into(),
                entry: "main".into(),
                msl: String::new(),
                msl_entry: String::new(),
                spirv: include_bytes!("../../src/shaders/presets.spv").to_vec(),
                uniform_size: 48,
                parameters: vec![Parameter {
                    offset: 0,
                    automatic: Some("resolution".into()),
                }],
            },
        )]);
        let pass = |strength: f32, color: [f32; 3]| {
            let mut uniforms = vec![0; 12];
            uniforms[5] = strength.to_bits();
            for (index, component) in color.into_iter().enumerate() {
                uniforms[8 + index] = component.to_bits();
            }
            ShaderPass {
                shader: "tint".into(),
                uniforms,
            }
        };
        let passes = [pass(100., [1., 0., 0.]), pass(50., [0., 0., 1.])];
        assert!(
            pipeline.prepare(&canvas, &shaders, &passes),
            "{:?}",
            pipeline.error
        );
        let mut targets = Targets::new(&creator, [64, 64])?;
        pipeline.draw(
            &mut canvas,
            &mut targets,
            &shaders,
            &passes,
            0,
            FRect::new(0., 0., 64., 64.),
            |target| {
                target.set_draw_color(sdl3::pixels::Color::RGB(0, 255, 0));
                target.clear();
                Ok(())
            },
        )?;
        let surface = canvas
            .read_pixels(None)?
            .convert_format(PixelFormat::RGBA32)?;
        surface.with_lock(|rgba| {
            assert!((126..=129).contains(&rgba[0]));
            assert_eq!(rgba[1], 0);
            assert!((126..=129).contains(&rgba[2]));
        });
        Ok(())
    }
}
