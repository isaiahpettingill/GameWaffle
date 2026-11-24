use std::{cell::{Cell, OnceCell}, collections::HashMap, rc::Rc};

pub const SUPPORTED: bool = cfg!(any(
    target_arch = "wasm32",
    all(any(target_arch = "x86_64", target_arch = "aarch64"),
        any(target_os = "linux", target_os = "macos", target_os = "windows")),
));

#[derive(Clone, Copy)]
pub enum Op {
    Add,
    Subtract,
    Multiply,
    Divide,
}

impl Op {
    pub fn from_bytecode(op: u16) -> Option<Self> {
        match op {
            0 => Some(Self::Add),
            1 => Some(Self::Subtract),
            2 => Some(Self::Multiply),
            3 => Some(Self::Divide),
            _ => None,
        }
    }
}

#[derive(Clone, Copy)]
pub enum Step {
    Real {
        dst: u16,
        value: f64,
    },
    Math {
        dst: u16,
        lhs: u16,
        rhs: u16,
        op: Op,
    },
}

pub struct Region {
    pub steps: Box<[Step]>,
    pub inputs: Box<[u16]>,
    pub outputs: Box<[u16]>,
    hits: Cell<u8>,
    signature: Vec<[u64; 2]>,
    compiled: OnceCell<Option<Rc<backend::Code>>>,
}

#[derive(Default)]
pub struct Cache {
    kernels: HashMap<Vec<[u64; 2]>, Rc<backend::Code>>,
    compile_available: bool,
}

impl Cache {
    pub fn begin_tick(&mut self) {
        self.compile_available = true;
    }
}

impl Region {
    pub fn new(steps: Vec<Step>, inputs: Vec<u16>, outputs: Vec<u16>) -> Self {
        let signature = steps.iter().map(|step| match *step {
            Step::Real { dst, value } => [u64::from(dst), value.to_bits()],
            Step::Math { dst, lhs, rhs, op } => [u64::from(dst) | 1 << 16,
                u64::from(lhs) | u64::from(rhs) << 16 | (op as u64) << 32],
        }).collect();
        Self {
            steps: steps.into_boxed_slice(),
            inputs: inputs.into_boxed_slice(),
            outputs: outputs.into_boxed_slice(),
            hits: Cell::new(0),
            signature,
            compiled: OnceCell::new(),
        }
    }

    pub fn run(&self, registers: &mut [f64; 64], cache: &mut Cache) -> bool {
        const HOT: u8 = 24;
        let hits = self.hits.get();
        if hits < HOT {
            self.hits.set(hits + 1);
            return false;
        }
        if self.compiled.get().is_none() {
            if let Some(code) = cache.kernels.get(&self.signature) {
                let _ = self.compiled.set(Some(Rc::clone(code)));
            } else if std::mem::take(&mut cache.compile_available) {
                let compiled = backend::Code::compile(&self.steps).map(Rc::new);
                if let Some(code) = &compiled && cache.kernels.len() < 256 {
                    cache.kernels.insert(self.signature.clone(), Rc::clone(code));
                }
                let _ = self.compiled.set(compiled);
            }
        }
        self.compiled.get().and_then(Option::as_ref)
            .is_some_and(|code| code.run(registers))
    }
}

#[cfg(all(
    any(target_arch = "x86_64", target_arch = "aarch64"),
    any(target_os = "linux", target_os = "macos", target_os = "windows")
))]
mod backend {
    use super::{Op, Step};
    use cranelift_codegen::ir::{
        AbiParam, Function, InstBuilder, MemFlagsData, UserFuncName, condcodes::FloatCC, types,
    };
    use cranelift_frontend::{FunctionBuilder, FunctionBuilderContext};
    use cranelift_jit::{JITBuilder, JITModule};
    use cranelift_module::{Linkage, Module, default_libcall_names};

    type Run = unsafe extern "C" fn(*mut f64) -> i32;

    pub struct Code {
        run: Run,
        module: Option<JITModule>,
    }

    impl Code {
        pub fn compile(steps: &[Step]) -> Option<Self> {
            let jit =
                JITBuilder::with_flags(&[("opt_level", "speed")], default_libcall_names()).ok()?;
            let mut module = JITModule::new(jit);
            let mut signature = module.make_signature();
            signature
                .params
                .push(AbiParam::new(module.target_config().pointer_type()));
            signature.returns.push(AbiParam::new(types::I32));
            let id = module
                .declare_function("waffle_numeric", Linkage::Local, &signature)
                .ok()?;
            let mut context = module.make_context();
            context.func =
                Function::with_name_signature(UserFuncName::user(0, id.as_u32()), signature);
            let mut builder_context = FunctionBuilderContext::new();
            let mut builder = FunctionBuilder::new(&mut context.func, &mut builder_context);
            let entry = builder.create_block();
            builder.append_block_params_for_function_params(entry);
            builder.switch_to_block(entry);
            builder.seal_block(entry);
            let memory = builder.block_params(entry)[0];
            let mut values = [None; 64];
            let mut valid = builder.ins().iconst(types::I8, 1);
            let limit = builder.ins().f64const(f64::MAX);
            for &step in steps {
                let (dst, result) = match step {
                    Step::Real { dst, value } => (dst, builder.ins().f64const(value)),
                    Step::Math { dst, lhs, rhs, op } => {
                        let mut read = |reg: u16| {
                            *values[reg as usize].get_or_insert_with(|| {
                                builder.ins().load(
                                    types::F64,
                                    MemFlagsData::trusted(),
                                    memory,
                                    i32::from(reg) * 8,
                                )
                            })
                        };
                        let lhs = read(lhs);
                        let rhs = read(rhs);
                        let result = match op {
                            Op::Add => builder.ins().fadd(lhs, rhs),
                            Op::Subtract => builder.ins().fsub(lhs, rhs),
                            Op::Multiply => builder.ins().fmul(lhs, rhs),
                            Op::Divide => builder.ins().fdiv(lhs, rhs),
                        };
                        let magnitude = builder.ins().fabs(result);
                        let finite = builder
                            .ins()
                            .fcmp(FloatCC::LessThanOrEqual, magnitude, limit);
                        valid = builder.ins().band(valid, finite);
                        (dst, result)
                    }
                };
                values[dst as usize] = Some(result);
            }
            let mut written = [false; 64];
            for &step in steps.iter().rev() {
                let (Step::Real { dst, .. } | Step::Math { dst, .. }) = step;
                if !std::mem::replace(&mut written[dst as usize], true) {
                    builder.ins().store(
                        MemFlagsData::trusted(),
                        values[dst as usize]?,
                        memory,
                        i32::from(dst) * 8,
                    );
                }
            }
            let valid = builder.ins().uextend(types::I32, valid);
            builder.ins().return_(&[valid]);
            builder.finalize(module.target_config());
            module.define_function(id, &mut context).ok()?;
            module.finalize_definitions().ok()?;
            // The generated function has Run's ABI and lives as long as the module.
            let run =
                unsafe { std::mem::transmute::<*const u8, Run>(module.get_finalized_function(id)) };
            Some(Self {
                module: Some(module),
                run,
            })
        }

        pub fn run(&self, registers: &mut [f64; 64]) -> bool {
            // The kernel accesses only the 64 validated f64 register slots.
            unsafe { (self.run)(registers.as_mut_ptr()) != 0 }
        }
    }

    impl Drop for Code {
        fn drop(&mut self) {
            if let Some(module) = self.module.take() {
                // No generated code escapes Code or remains active during its destruction.
                unsafe { module.free_memory() };
            }
        }
    }
}

#[cfg(target_arch = "wasm32")]
mod backend {
    use super::{Op, Step};
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen(inline_js = r#"
const availableSlots = new WeakMap();
export function waffleInstallKernel(code, memory, table) {
    try {
        const kernel = new WebAssembly.Instance(new WebAssembly.Module(code), {env: {memory}});
        const available = availableSlots.get(table);
        const index = available?.length ? available.pop() : table.grow(1);
        table.set(index, kernel.exports.run);
        return index;
    } catch {
        return -1;
    }
}
export function waffleRemoveKernel(index, table) {
    table.set(index, null);
    if (!availableSlots.has(table)) availableSlots.set(table, []);
    availableSlots.get(table).push(index);
}
"#)]
    extern "C" {
        fn waffleInstallKernel(code: &[u8], memory: JsValue, table: JsValue) -> i32;
        fn waffleRemoveKernel(index: u32, table: JsValue);
    }

    pub struct Code(u32);
    type Run = unsafe extern "C" fn(*mut f64) -> i32;

    fn unsigned(mut value: usize, out: &mut Vec<u8>) {
        while value >= 128 {
            out.push((value as u8 & 0x7f) | 0x80);
            value >>= 7;
        }
        out.push(value as u8);
    }

    fn section(module: &mut Vec<u8>, id: u8, payload: &[u8]) {
        module.push(id);
        unsigned(payload.len(), module);
        module.extend(payload);
    }

    fn load(body: &mut Vec<u8>, register: u16) {
        body.extend([0x20, 0, 0x2b, 3]); // local.get ptr; f64.load align=8
        unsigned(usize::from(register) * 8, body);
    }

    impl Code {
        pub fn compile(steps: &[Step]) -> Option<Self> {
            let mut module = b"\0asm\x01\0\0\0".to_vec();
            section(&mut module, 1, &[1, 0x60, 1, 0x7f, 1, 0x7f]); // (i32) -> i32
            section(&mut module, 2, b"\x01\x03env\x06memory\x02\0\0");
            section(&mut module, 3, &[1, 0]);
            section(&mut module, 7, b"\x01\x03run\0\0");

            // One f64 temporary for checking each result before continuing.
            let mut body = vec![1, 1, 0x7c];
            for &step in steps {
                let dst = match step {
                    Step::Real { dst, value } => {
                        body.extend([0x20, 0, 0x44]); // local.get ptr; f64.const
                        body.extend(value.to_le_bytes());
                        dst
                    }
                    Step::Math { dst, lhs, rhs, op } => {
                        load(&mut body, lhs);
                        load(&mut body, rhs);
                        body.push(match op {
                            Op::Add => 0xa0,
                            Op::Subtract => 0xa1,
                            Op::Multiply => 0xa2,
                            Op::Divide => 0xa3,
                        });
                        // If abs(result) <= MAX is false, return zero and replay in the VM.
                        body.extend([0x22, 1, 0x99, 0x44]);
                        body.extend(f64::MAX.to_le_bytes());
                        body.extend([0x65, 0x45, 0x04, 0x40, 0x41, 0, 0x0f, 0x0b]);
                        body.extend([0x20, 0, 0x20, 1]);
                        dst
                    }
                };
                body.extend([0x39, 3]); // f64.store align=8
                unsigned(usize::from(dst) * 8, &mut body);
            }
            body.extend([0x41, 1, 0x0b]);
            let mut code = vec![1];
            unsigned(body.len(), &mut code);
            code.extend(body);
            section(&mut module, 10, &code);
            let index = waffleInstallKernel(
                &module,
                wasm_bindgen::memory(),
                wasm_bindgen::function_table(),
            );
            u32::try_from(index)
                .ok()
                .filter(|index| *index != 0)
                .map(Self)
        }

        pub fn run(&self, registers: &mut [f64; 64]) -> bool {
            // The Wasm function pointer is the checked table index installed by compile.
            // Rust emits call_indirect for this call, with no JavaScript on dispatch.
            let run = unsafe { std::mem::transmute::<usize, Run>(self.0 as usize) };
            unsafe { run(registers.as_mut_ptr()) != 0 }
        }
    }

    impl Drop for Code {
        fn drop(&mut self) {
            waffleRemoveKernel(self.0, wasm_bindgen::function_table());
        }
    }
}

#[cfg(not(any(
    target_arch = "wasm32",
    all(
        any(target_arch = "x86_64", target_arch = "aarch64"),
        any(target_os = "linux", target_os = "macos", target_os = "windows")
    )
)))]
mod backend {
    use super::Step;

    pub struct Code;

    impl Code {
        pub fn compile(_: &[Step]) -> Option<Self> {
            None
        }
        pub fn run(&self, _: &mut [f64; 64]) -> bool {
            false
        }
    }
}

#[cfg(all(
    test,
    any(target_arch = "x86_64", target_arch = "aarch64"),
    any(target_os = "linux", target_os = "macos", target_os = "windows")
))]
mod tests {
    use super::*;

    #[test]
    fn generated_native_code_calculates_reals_and_detects_nonfinite_intermediates() {
        let code = backend::Code::compile(&[
            Step::Real { dst: 1, value: 2.0 },
            Step::Math {
                dst: 2,
                lhs: 0,
                rhs: 1,
                op: Op::Multiply,
            },
            Step::Math {
                dst: 3,
                lhs: 1,
                rhs: 2,
                op: Op::Divide,
            },
        ])
        .expect("Cranelift kernel");
        let mut registers = [0.0; 64];
        registers[0] = 4.0;
        assert!(code.run(&mut registers));
        assert_eq!(registers[2], 8.0);
        assert_eq!(registers[3], 0.25);
        registers[0] = f64::MAX;
        assert!(!code.run(&mut registers));
    }
}
