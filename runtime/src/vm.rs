use crate::{Action, Input, Runtime, jit};
use num_bigint::BigInt;
use num_traits::{FromPrimitive, ToPrimitive, Zero};
use serde::{Deserialize, Serialize};
use std::hash::{DefaultHasher, Hasher};
use std::{collections::BTreeMap, rc::Rc};
mod reporters;
mod gradient;

pub type Variables = BTreeMap<Rc<str>, Value>;
#[derive(Clone)]
pub enum Value {
    Small(i64),
    Large(Rc<BigInt>),
    Real(f64),
    Text(Rc<str>),
}

impl Default for Value {
    fn default() -> Self {
        Self::Small(0)
    }
}
impl From<i64> for Value {
    fn from(value: i64) -> Self {
        Self::Small(value)
    }
}
impl std::fmt::Display for Value {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Small(value) => value.fmt(f),
            Self::Large(value) => value.fmt(f),
            Self::Real(value) => value.fmt(f),
            Self::Text(value) => value.fmt(f),
        }
    }
}
impl Value {
    fn zero(&self) -> bool {
        match self {
            Self::Small(value) => *value == 0,
            Self::Large(value) => value.is_zero(),
            Self::Real(value) => *value == 0.0,
            Self::Text(value) => value.is_empty(),
        }
    }
    fn integer(&self) -> Result<BigInt, &'static str> {
        match self {
            Self::Small(value) => Ok((*value).into()),
            Self::Large(value) => Ok((**value).clone()),
            Self::Real(_) | Self::Text(_) => Err("Expected integer operands"),
        }
    }
    fn from_integer(value: BigInt) -> Self {
        value
            .to_i64()
            .map_or_else(|| Self::Large(Rc::new(value)), Self::Small)
    }
    fn float(&self) -> f64 {
        match self {
            Self::Small(value) => *value as f64,
            Self::Large(value) => value.to_f64().unwrap_or_default(),
            Self::Real(value) => *value,
            Self::Text(_) => 0.0,
        }
    }
    fn bounded_tick_count(&self) -> Result<u64, &'static str> {
        match self {
            Self::Small(value) => Ok((*value).clamp(1, i64::from(u32::MAX)) as u64),
            Self::Large(value) if value.sign() == num_bigint::Sign::Minus => Ok(1),
            Self::Large(_) => Ok(u64::from(u32::MAX)),
            Self::Real(_) | Self::Text(_) => Err("Wait requires integer ticks"),
        }
    }
}
pub type Programs = BTreeMap<String, Rc<Program>>;

const REGISTERS: usize = 64;
pub(crate) const SLICE: usize = 1024;
// Bound the host stack on targets that do not eliminate indirect tail calls.
const DISPATCH_BATCH: usize = 16;
const INTEGER_BITS: u64 = 8192;
const VARIABLE_LIMIT: usize = 4096;

#[derive(Deserialize)]
pub struct Encoded {
    #[serde(with = "serde_bytes")]
    b: Vec<u8>,
    n: Vec<String>,
    k: Vec<i64>,
    #[serde(default)]
    f: Vec<String>,
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
extern "C" {
    #[wasm_bindgen::prelude::wasm_bindgen(js_namespace=globalThis, js_name=waffleBreak)]
    fn debug_break(id: u32, event: &str, pc: usize) -> bool;
    #[wasm_bindgen::prelude::wasm_bindgen(js_namespace=globalThis, js_name=waffleInspect)]
    fn debug_inspect(state: &[u8]);
}

type Handler =
    fn(&Instruction, &Program, &mut Machine, &mut Context<'_>, usize) -> Result<(), &'static str>;

struct Instruction {
    handler: Handler,
    args: [u16; 6],
}

pub struct Program {
    code: Vec<Instruction>,
    fingerprint: u64,
    names: Vec<Rc<str>>,
    constants: Vec<i64>,
    registers: usize,
    reals: Vec<f64>,
    regions: Vec<jit::Region>,
}

pub struct Machine {
    payload: [i64; 2],
    used_item: Option<Rc<str>>,
    program: Rc<Program>,
    registers: Vec<Value>,
    pc: usize,
    wake: u64,
    draw_style: crate::drawing::Style,
    shader_builder: Option<Vec<crate::ShaderPass>>,
}

#[derive(Deserialize, Serialize)]
pub struct SavedMachine {
    fingerprint: u64,
    payload: [i64; 2],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    used_item: Option<String>,
    registers: Vec<SavedRegister>,
    pc: usize,
    wake: u64,
    #[serde(default, skip_serializing_if = "crate::drawing::Style::is_default")]
    draw_style: crate::drawing::Style,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    shader_builder: Option<Vec<crate::ShaderPass>>,
}

#[derive(Deserialize, Serialize)]
enum SavedRegister {
    Integer(String),
    Real(f64),
    Text(String),
}

struct Context<'a> {
    runtime: &'a mut Runtime,
    id: u32,
    received: bool,
    input: Input,
    buttons: u8,
    previous_buttons: u8,
    fuel: usize,
    actions: &'a mut Vec<Action>,
}

impl Program {
    pub fn decode(raw: Encoded, controls: &BTreeMap<String, u8>) -> Result<Self, String> {
        if raw.b.len() > 65535 || raw.n.len() > 4096 || raw.k.len() > 4096 || raw.f.len() > 4096 {
            return Err("Script bytecode exceeds its limits".into());
        }
        let mut hasher = DefaultHasher::new();
        hasher.write(&raw.b);
        for name in raw.n.iter().chain(&raw.f) {
            hasher.write(&(name.len() as u64).to_le_bytes());
            hasher.write(name.as_bytes());
        }
        for value in &raw.k {
            hasher.write(&value.to_le_bytes());
        }
        let mut code = Vec::new();
        let mut opcodes = Vec::new();
        let mut positions = BTreeMap::new();
        let mut jumps = Vec::new();
        let mut registers = 0;
        let mut pc = 0;
        while pc < raw.b.len() {
            positions.insert(pc, code.len());
            let opcode = raw.b[pc];
            pc += 1;
            let layout = match opcode {
                0 | 1 | 4 | 40 | 42 | 43 | 69..=72 => "W",
                73 => "NNWW",
                74..=78 => "W",
                79 | 80 => "N",
                81 | 83 => "",
                82 | 87 => "NW",
                84 | 86 => "N",
                85 => "NWNNWW",
                88 | 90 => "WWW",
                89 => "WW",
                91 => "W",
                92 | 97 | 98 => "WW",
                93 => "WWWWW",
                94 | 95 => "N",
                96 => "W",
                99 => "NW",
                100 | 104 => "N",
                101..=103 => "W",
                105 => "WWW",
                106 => "N",
                107 | 109 | 111 => "W",
                108 | 110 => "",
                112 | 113 | 115 => "WWWW",
                114 => "WWW",
                116 => "WWWWWW",
                117 => "WW",
                118 => "NN",
                119 | 123 | 125 => "NW",
                120 => "NWNW",
                121 | 122 => "NWN",
                124 => "NWW",
                126 => "roNWN",
                127 => "NW",
                128 => "W",
                129 => "N",
                130..=133 | 139 | 140 => "WW",
                134 => "NWWW",
                135 => "",
                136 => "Nu",
                137 => "Wuo",
                138 => "o",
                141 => "W",
                142 => "",
                143 => "roWWW",
                144 => "NN",
                145 => "WWWW",
                146 => "WWW",
                147 => "WWWWW",
                148 => "WW",
                149 => "NW",
                150 => "WW",
                2 => "WWW",
                3 | 9 => "NWW",
                5 | 7 | 8 => "N",
                6 | 41 | 44 | 45 | 46 => "WW",
                10 => "rk",
                11 => "rsn",
                12 => "snr",
                13 => "rorr",
                14 => "rj",
                15 => "j",
                16 => "r",
                17 => "rf",
                47 | 48 => "rN",
                49 => "orWW",
                50 => "rorr",
                51 | 52 => "WWW",
                53 => "WW",
                54 => "W",
                55 | 56 => "N",
                66 => "WNW",
                67 | 68 => "NWW",
                57 | 64 => "",
                58 | 59 => "WN",
                60..=63 | 65 => "WNW",
                18 | 19 | 21 | 27 | 28 => "NW",
                20 | 22 => "N",
                33 => "N",
                34 | 35 | 37 | 39 => "NWW",
                36 | 38 => "NW",
                23 | 25 | 26 | 29 | 30 | 31 | 32 => "",
                24 => "WW",
                _ => return Err(format!("Invalid opcode {opcode}")),
            };
            let mut args = [0; 6];
            let read = |pc: &mut usize| {
                let value = raw.b.get(*pc).copied().ok_or("Incomplete instruction");
                *pc += 1;
                value
            };
            for (slot, kind) in layout.bytes().enumerate() {
                let mut value = u16::from(read(&mut pc)?);
                if !b"rsou".contains(&kind) {
                    value |= u16::from(read(&mut pc)?) << 8;
                }
                let index = usize::from(value);
                let valid = match kind {
                    b'r' | b'W' => {
                        registers = registers.max(index + 1);
                        index < REGISTERS
                    }
                    b'k' => index < raw.k.len(),
                    b'f' => index < raw.f.len(),
                    b'N' => index < raw.n.len(),
                    b'n' if opcode == 11 && args[1] == 5 => index < 31,
                    b'n' if opcode == 11 && args[1] == 3 => index < 8,
                    b'n' => index < raw.n.len(),
                    b's' => {
                        if opcode == 11 {
                            index < 15
                        } else {
                            matches!(index, 0..=2 | 9..=14)
                        }
                    }
                    b'u' => index <= crate::shader::MAX_SHADER_WORDS,
                    b'o' if opcode == 137 => index < 3,
                    b'o' if opcode == 138 => index < 2,
                    b'o' if opcode == 143 => index < 30,
                    b'o' if opcode == 50 => index < 20,
                    b'o' if opcode == 126 => index < 6,
                    b'o' if opcode == 49 => matches!(index, 20 | 21 | 22 | 33 | 37),
                    b'o' => index < 34,
                    _ => true,
                };
                if !valid {
                    return Err(format!("Invalid operand for opcode {opcode}"));
                }
                args[slot] = value;
            }
            if opcode == 11 && (6..=8).contains(&args[1]) {
                args[3] = controls.get(&raw.n[args[2] as usize]).copied().unwrap_or_default().into();
            }
            let handler = HANDLERS[usize::from(opcode)];
            code.push(Instruction { handler, args });
            opcodes.push(opcode);
            match opcode {
                14 => jumps.push((code.len() - 1, 1)),
                15 => jumps.push((code.len() - 1, 0)),
                _ => {}
            }
        }
        positions.insert(pc, code.len());
        for (index, operand) in jumps {
            let target = &mut code[index].args[operand];
            *target = *positions
                .get(&usize::from(*target))
                .ok_or("Jump target is outside an instruction boundary")?
                as u16;
        }
        for pc in 0..code.len().saturating_sub(3) {
            if opcodes[pc..pc+4]!=[11,10,13,12] {continue;}
            let [dest,scope,name,..]=code[pc].args;
            let [rhs,..]=code[pc+1].args;
            let [calc_dest,op,left,right,..]=code[pc+2].args;
            let [store_scope,store_name,source,..]=code[pc+3].args;
            if scope<=1 && rhs!=dest && matches!(op,0..=2) && calc_dest==dest && left==dest && right==rhs
                && store_scope==scope && store_name==name && source==dest {
                code[pc].handler=fused_integer_update;
            }
        }
        for (pc, ops) in opcodes.windows(3).enumerate() {
            let [temp, constant, ..] = code[pc].args;
            let [dst, op, left, right, ..] = code[pc + 1].args;
            match ops {
                [10, 13, 14] if raw.k[constant as usize] == 0
                    && op == 6 && temp == dst && temp == left && temp != right
                    && code[pc + 2].args[0] == temp =>
                {
                    code[pc].handler = fused_repeat_test;
                }
                [10, 13, 15] if raw.k[constant as usize] == 1
                    && op == 1 && temp == right && left == dst && temp != left =>
                {
                    code[pc].handler = fused_repeat_next;
                }
                _ => {}
            }
        }
        let reals: Vec<f64> = raw.f.iter().map(|value| {
            value.parse::<f64>().ok().filter(|value| value.is_finite()).ok_or("Invalid real constant")
        }).collect::<Result<_, _>>()?;
        let regions = find_numeric_regions(&mut code, &opcodes, &reals);
        Ok(Self {
            code,
            fingerprint: hasher.finish(),
            names: raw.n.into_iter().map(Rc::from).collect(),
            constants: raw.k,
            registers,
            reals,
            regions,
        })
    }
}

fn find_numeric_regions(code: &mut [Instruction], opcodes: &[u8], reals: &[f64]) -> Vec<jit::Region> {
    let mut regions = Vec::new();
    let mut start = 0;
    while start < code.len() && regions.len() < 8 {
        let mut steps = Vec::new();
        let mut inputs = Vec::new();
        let mut outputs = Vec::new();
        let mut written = [false; REGISTERS];
        let mut read = [false; REGISTERS];
        let mut math = 0;
        let mut has_real = false;
        for (instruction, opcode) in code.iter().zip(opcodes).skip(start).take(128) {
            let [dst, arg, lhs, rhs, ..] = instruction.args;
            let step = match *opcode {
                17 => {
                    has_real = true;
                    jit::Step::Real { dst, value: reals[arg as usize] }
                }
                13 => {
                    let Some(op) = jit::Op::from_bytecode(arg) else { break };
                    for reg in [lhs, rhs] {
                        if !written[reg as usize] && !std::mem::replace(&mut read[reg as usize], true) {
                            inputs.push(reg);
                        }
                    }
                    math += 1;
                    jit::Step::Math { dst, lhs, rhs, op }
                }
                _ => break,
            };
            if !std::mem::replace(&mut written[dst as usize], true) {
                outputs.push(dst);
            }
            steps.push(step);
        }
        let length = steps.len();
        if math >= 6 && has_real {
            code[start].handler = if opcodes[start] == 17 { run_numeric_region::<17> } else { run_numeric_region::<13> };
            code[start].args[5] = regions.len() as u16;
            regions.push(jit::Region::new(steps, inputs, outputs));
        }
        start += length.max(1);
    }
    regions
}

fn run_numeric_region<const FIRST: u8>(
    instruction: &Instruction, program: &Program, machine: &mut Machine, context: &mut Context<'_>, count: usize,
) -> Result<(), &'static str> {
    let region = &program.regions[instruction.args[5] as usize];
    let interpret = |machine: &mut Machine, context: &mut Context<'_>| {
        execute::<FIRST>(instruction, program, machine, context, count)
    };
    if count == 1 || !context.runtime.jit_enabled || context.fuel < region.steps.len() {
        return interpret(machine, context);
    }
    let mut scratch = [0.0; REGISTERS];
    for &reg in &region.inputs {
        let Value::Real(value) = machine.registers[reg as usize] else { return interpret(machine, context) };
        scratch[reg as usize] = value;
    }
    if !region.run(&mut scratch, &mut context.runtime.jit_cache) {
        return interpret(machine, context);
    }
    for &reg in &region.outputs {
        machine.registers[reg as usize] = Value::Real(scratch[reg as usize]);
    }
    context.runtime.jit_runs = context.runtime.jit_runs.wrapping_add(1);
    context.fuel -= region.steps.len();
    machine.pc += region.steps.len();
    Ok(())
}

impl Machine {
    pub(crate) fn ready(&self, tick: u64) -> bool {
        self.wake <= tick
    }

    pub fn new(program: Rc<Program>, payload: [i64; 2]) -> Self {
        Self {
            payload,
            used_item: None,
            registers: vec![Value::default(); program.registers],
            program,
            pc: 0,
            wake: 0,
            draw_style: Default::default(),
            shader_builder: None,
        }
    }

    pub fn with_used_item(mut self, item: String) -> Self {
        self.used_item = Some(item.into());
        self
    }

    pub fn save(&self) -> SavedMachine {
        SavedMachine {
            fingerprint: self.program.fingerprint,
            payload: self.payload,
            used_item: self.used_item.as_deref().map(str::to_owned),
            registers: self
                .registers
                .iter()
                .map(|value| match value {
                    Value::Real(real) => SavedRegister::Real(*real),
                    Value::Text(text) => SavedRegister::Text(text.to_string()),
                    _ => SavedRegister::Integer(value.to_string()),
                })
                .collect(),
            pc: self.pc,
            wake: self.wake,
            draw_style: self.draw_style,
            shader_builder: self.shader_builder.clone(),
        }
    }

    pub fn restore(program: Rc<Program>, saved: SavedMachine) -> Option<Self> {
        if saved.fingerprint != program.fingerprint
            || saved.pc > program.code.len()
            || saved.registers.len() != program.registers
            || !saved.draw_style.valid()
            || saved.shader_builder.as_deref().is_some_and(|passes| !crate::shader::valid_pipeline(passes))
        {
            return None;
        }
        let registers = saved
            .registers
            .into_iter()
            .map(|register| match register {
                SavedRegister::Real(real) if real.is_finite() => Some(Value::Real(real)),
                SavedRegister::Text(text) if text.len() <= 4096 => Some(Value::Text(text.into())),
                SavedRegister::Integer(value) if value.len() <= 2468 => value
                    .parse::<BigInt>()
                    .ok()
                    .filter(|number| number.bits() <= INTEGER_BITS)
                    .map(Value::from_integer),
                _ => None,
            })
            .collect::<Option<_>>()?;
        Some(Self {
            program,
            registers,
            payload: saved.payload,
            used_item: saved
                .used_item
                .filter(|item| item.len() <= 4096)
                .map(Rc::from),
            pc: saved.pc,
            wake: saved.wake,
            draw_style: saved.draw_style,
            shader_builder: saved.shader_builder,
        })
    }

    pub fn restart(&mut self) {
        self.pc = 0;
        self.wake = 0;
        self.draw_style = Default::default();
    }

    pub fn run(
        &mut self,
        runtime: &mut Runtime,
        id: u32,
        event: &str,
        input: Input,
        previous_buttons: u8,
        actions: &mut Vec<Action>,
    ) -> Result<bool, &'static str> {
        if self.wake > runtime.tick {
            return Ok(false);
        }
        let program = self.program.clone();
        let budget = runtime.script_fuel.min(SLICE);
        let mut cx = Context {
            received: event.starts_with("received."),
            runtime,
            id,
            input,
            buttons: input.bits(),
            previous_buttons,
            fuel: budget,
            actions,
        };
        let result = loop {
            if cx.fuel == 0 || self.wake > cx.runtime.tick { break Ok(()); }
            let Some(first) = program.code.get(self.pc) else {
                break Ok(());
            };
            #[cfg(target_arch = "wasm32")]
            if cx.runtime.debug {
                if debug_break(id, event, self.pc)
                    && let Ok(state) = cx.runtime.inspect_actor(id)
                {
                    debug_inspect(&state);
                }
                if let Err(error) = (first.handler)(first, &program, self, &mut cx, 1) { break Err(error); }
                continue;
            }
            let count = cx.fuel.min(DISPATCH_BATCH);
            if let Err(error) = (first.handler)(first, &program, self, &mut cx, count) { break Err(error); }
        };
        cx.runtime.script_fuel -= budget - cx.fuel;
        result?;
        if self.wake > cx.runtime.tick {
            return Ok(false);
        }
        Ok(self.pc == program.code.len())
    }
}

// The loader resolves each opcode once. Each handler reads the next handler
// address directly from the decoded instruction stream.
const HANDLERS: [Handler; 151] = [
    execute::<0>,
    execute::<1>,
    execute::<2>,
    execute::<3>,
    execute::<4>,
    execute::<5>,
    execute::<6>,
    execute::<7>,
    execute::<8>,
    execute::<9>,
    execute::<10>,
    execute::<11>,
    execute::<12>,
    execute::<13>,
    execute::<14>,
    execute::<15>,
    execute::<16>,
    execute::<17>,
    execute::<18>,
    execute::<19>,
    execute::<20>,
    execute::<21>,
    execute::<22>,
    execute::<23>,
    execute::<24>,
    execute::<25>,
    execute::<26>,
    execute::<27>,
    execute::<28>,
    execute::<29>,
    execute::<30>,
    execute::<31>,
    execute::<32>,
    execute::<33>,
    execute::<34>,
    execute::<35>,
    execute::<36>,
    execute::<37>,
    execute::<38>,
    execute::<39>,
    execute::<40>,
    execute::<41>,
    execute::<42>,
    execute::<43>,
    execute::<44>,
    execute::<45>,
    execute::<46>,
    execute::<47>,
    execute::<48>,
    execute::<49>,
    execute::<50>,
    execute::<51>,
    execute::<52>,
    execute::<53>,
    execute::<54>,
    execute::<55>,
    execute::<56>,
    execute::<57>,
    execute::<58>,
    execute::<59>,
    execute::<60>,
    execute::<61>,
    execute::<62>,
    execute::<63>,
    execute::<64>,
    execute::<65>,
    execute::<66>,
    execute::<67>,
    execute::<68>,
    execute::<69>,
    execute::<70>,
    execute::<71>,
    execute::<72>,
    execute::<73>,
    execute::<74>,
    execute::<75>,
    execute::<76>,
    execute::<77>,
    execute::<78>,
    execute::<79>,
    execute::<80>,
    execute::<81>,
    execute::<82>,
    execute::<83>,
    execute::<84>,
    execute::<85>,
    execute::<86>,
    execute::<87>,
    execute::<88>,
    execute::<89>,
    execute::<90>,
    execute::<91>,
    execute::<92>,
    execute::<93>,
    execute::<94>,
    execute::<95>,
    execute::<96>,
    execute::<97>,
    execute::<98>,
    execute::<99>,
    execute::<100>,
    execute::<101>,
    execute::<102>,
    execute::<103>,
    execute::<104>,
    execute::<105>,
    execute::<106>,
    execute::<107>,
    execute::<108>,
    execute::<109>,
    execute::<110>,
    execute::<111>,
    execute::<112>,
    execute::<113>,
    execute::<114>,
    execute::<115>,
    execute::<116>,
    execute::<117>,
    execute::<118>,
    execute::<119>,
    execute::<120>,
    execute::<121>,
    execute::<122>,
    execute::<123>,
    execute::<124>,
    execute::<125>,
    execute::<126>,
    execute::<127>,
    execute::<128>,
    execute::<129>,
    execute::<130>,
    execute::<131>,
    execute::<132>,
    execute::<133>,
    execute::<134>,
    execute::<135>,
    execute::<136>,
    execute::<137>,
    execute::<138>,
    execute::<139>,
    execute::<140>,
    execute::<141>,
    execute::<142>,
    execute::<143>,
    execute::<144>,
    execute::<145>,
    execute::<146>,
    execute::<147>,
    execute::<148>,
    execute::<149>,
    execute::<150>,
];
fn execute<const OP: u8>(
    i: &Instruction,
    program: &Program,
    m: &mut Machine,
    cx: &mut Context<'_>,
    count: usize,
) -> Result<(), &'static str> {
    m.pc += 1;
    cx.fuel -= 1;
    match OP {
        144..=149 => gradient::command(OP, i, program, m, cx),
        143 => reporters::evaluate(i, m, cx),
        141 => {
            let source = entity_id(&m.registers[i.args[0] as usize]);
            let id = cx.runtime.clone_entity(source);
            cx.runtime.actors.get_mut(&cx.id).unwrap().last_clone = id;
            Ok(())
        }
        142 => {
            let actor = cx.runtime.actors.get_mut(&cx.id).unwrap();
            if actor.clone_source.is_some() {
                actor.clone_deleting = true;
                m.pc = program.code.len();
            }
            Ok(())
        }
        135..=138 => shader_command(OP, i, m, cx),
        118..=126 => collection_command(OP,i,m,cx),
        106..=117 => draw_command(OP, i, m, cx),
        92..=98 | 150 => system_command(OP, i, m, cx),
        100..=104 => tile_command(OP, i, m, cx),
        105 => {
            let [target,x,y,..]=i.args;
            if let Some(body)=cx.runtime.entity(entity_id(&m.registers[target as usize])).and_then(|actor|actor.body) {
                let f=|reg:u16|m.registers[reg as usize].float().clamp(-20000.0,20000.0) as f32;
                cx.runtime.world.force(body, crate::Vec2::new(f(x),f(y)));
            }
            Ok(())
        }
        134 => {
            let [preset, rate, x, y, ..] = i.args;
            let effect = crate::particles::Effect::named(&m.program.names[preset as usize])
                .ok_or("Choose a particle effect")?;
            let offset = [x, y].map(|reg| m.registers[reg as usize].float().clamp(-4096.0, 4096.0) as f32);
            let rate = m.registers[rate as usize].float().clamp(1.0, 240.0) as u16;
            if let Some(actor) = cx.runtime.actors.get_mut(&cx.id) {
                let phase = actor.emitter.filter(|old| old.effect == effect).map_or(0, |old| old.phase);
                actor.emitter = Some(crate::particles::Emitter { effect, rate, offset, phase, until: None });
            }
            Ok(())
        }
        10 => constant(i, m, cx),
        11 => load(i, m, cx),
        12 => store(i, m, cx),
        13 => calculate(i, m, cx),
        14 => branch(i, m, cx),
        15 => jump(i, m, cx),
        16 => wait(i, m, cx),
        17 => real(i, m, cx),
        47 => {
            m.registers[i.args[0] as usize] =
                Value::Text(program.names[i.args[1] as usize].clone());
            Ok(())
        }
        48 => {
            m.registers[i.args[0] as usize] = Value::Text(Rc::from(
                cx.runtime
                    .localized_text(&program.names[i.args[1] as usize]),
            ));
            Ok(())
        }
        49 => text_command(i, m, cx),
        50 => entity_query(i, m, cx),
        73 => {
            let [projectile, aim, speed, damage, ..] = i.args;
            cx.runtime.fire_projectile(
                cx.id,
                &program.names[projectile as usize],
                &program.names[aim as usize],
                m.registers[speed as usize].float() as f32,
                m.registers[damage as usize].float() as f32,
                cx.actions,
            );
            Ok(())
        }
        74..=83 | 127..=129 => room_command::<OP>(i, m, cx),
        84 | 99 => {
            let name = &program.names[i.args[0] as usize];
            if cx.runtime.game.events.contains(name.as_ref())
                && cx.actions.len() < crate::MAX_ACTIONS
            {
                let sender = if Some(cx.id) == cx.runtime.room_script_id {
                    0
                } else {
                    cx.id
                };
                cx.actions.push(Action::Broadcast(crate::Broadcast {
                    name: name.to_string(),
                    sender,
                    entity: if OP==99 { entity_id(&m.registers[i.args[1] as usize]) } else { 0 },
                }));
            }
            Ok(())
        }
        85 => draw_hud_text(i, m, cx),
        86 => {
            let font = &program.names[i.args[0] as usize];
            if (font.is_empty() || cx.runtime.game.fonts.contains(font.as_ref()))
                && cx.runtime.hud_font != font.as_ref()
            {
                cx.runtime.hud_font = font.to_string();
            }
            Ok(())
        }
        88 => {
            let [enabled, fill, track, ..] = i.args;
            let color = |index: u16| {
                let Value::Text(text) = &m.registers[index as usize] else {
                    return Err("Health bar color requires text");
                };
                if !crate::RoomSettings::valid_color(text) {
                    return Err("Use a health bar color such as #a6e3a1");
                }
                u32::from_str_radix(&text[1..], 16).map_err(|_| "Invalid health bar color")
            };
            let style = if m.registers[enabled as usize].zero() {
                None
            } else {
                Some(crate::HealthBarStyle {
                    fill: color(fill)?,
                    track: color(track)?,
                })
            };
            let actor = cx.runtime.actors.get_mut(&cx.id).unwrap();
            if actor.sprite.is_some() {
                actor.health_bar = style;
            }
            Ok(())
        }
        51..=54 | 58..=63 | 65 | 66 | 89..=91 | 130..=133 | 139 | 140 => entity_command::<OP>(i, m, cx),
        _ => engine::<OP>(i, m, cx),
    }?;
    if count > 1 && m.wake <= cx.runtime.tick {
        if let Some(next) = program.code.get(m.pc) {
            return (next.handler)(next, program, m, cx, count - 1);
        }
    }
    Ok(())
}

fn constant(i: &Instruction, m: &mut Machine, _: &mut Context<'_>) -> Result<(), &'static str> {
    m.registers[i.args[0] as usize] = Value::Small(m.program.constants[i.args[1] as usize]);
    Ok(())
}

// Run the three original loop instructions together when the counter fits in
// a register. Step counts, registers, and jump targets stay identical.
fn fused_repeat_test(i: &Instruction, program: &Program, m: &mut Machine, cx: &mut Context<'_>, count: usize) -> Result<(), &'static str> {
    if count < 3 {
        return execute::<10>(i, program, m, cx, count);
    }
    let counter = program.code[m.pc + 1].args[3] as usize;
    let Value::Small(value) = m.registers[counter] else {
        return execute::<10>(i, program, m, cx, count);
    };
    m.registers[i.args[0] as usize] = Value::Small(i64::from(value > 0));
    let next = if value > 0 { m.pc + 3 } else { program.code[m.pc + 2].args[1] as usize };
    finish_fused_repeat(program, m, cx, count, next)
}

fn fused_repeat_next(i: &Instruction, program: &Program, m: &mut Machine, cx: &mut Context<'_>, count: usize) -> Result<(), &'static str> {
    if count < 3 {
        return execute::<10>(i, program, m, cx, count);
    }
    let counter = program.code[m.pc + 1].args[0] as usize;
    let Value::Small(value) = m.registers[counter] else {
        return execute::<10>(i, program, m, cx, count);
    };
    let Some(decremented) = value.checked_sub(1) else {
        return execute::<10>(i, program, m, cx, count);
    };
    m.registers[i.args[0] as usize] = Value::Small(1);
    m.registers[counter] = Value::Small(decremented);
    let next = program.code[m.pc + 2].args[0] as usize;
    finish_fused_repeat(program, m, cx, count, next)
}

fn finish_fused_repeat(program: &Program, m: &mut Machine, cx: &mut Context<'_>, count: usize, next: usize) -> Result<(), &'static str> {
    cx.fuel -= 3;
    m.pc = next;
    if count > 3 && let Some(instruction) = program.code.get(next) {
        return (instruction.handler)(instruction, program, m, cx, count - 3);
    }
    Ok(())
}

// Keep the original instructions and their program counters for single-step
// debugging, instruction budgets, jumps into the sequence, and large integers.
fn fused_integer_update(i:&Instruction,program:&Program,m:&mut Machine,cx:&mut Context<'_>,count:usize)->Result<(),&'static str>{
    use std::collections::btree_map::Entry;
    if count<4 {return execute::<11>(i,program,m,cx,count);}
    let [dest,scope,name,..]=i.args;
    let [rhs,constant,..]=program.code[m.pc+1].args;
    let op=program.code[m.pc+2].args[1];
    let number=program.constants[constant as usize];
    let updated={
        let table=if scope==0 {&mut cx.runtime.actors.get_mut(&cx.id).unwrap().variables}else{&mut cx.runtime.game_properties.globals};
        let at_limit=table.len()>=VARIABLE_LIMIT;
        let output=|left:i64| match op {0=>left.checked_add(number),1=>left.checked_sub(number),_=>left.checked_mul(number)};
        match table.entry(program.names[name as usize].clone()) {
            Entry::Occupied(mut entry)=>{
                if let Value::Small(left)=entry.get(){
                    let result=output(*left);
                    if let Some(value)=result{
                        if value==0 {entry.remove();}else{*entry.get_mut()=Value::Small(value);}
                    }
                    result
                }else{None}
            }
            Entry::Vacant(entry)=>{
                let result=output(0);
                if let Some(value)=result.filter(|value|*value!=0 && !at_limit){entry.insert(Value::Small(value));}
                result.filter(|value|*value==0 || !at_limit)
            }
        }
    };
    let Some(updated)=updated else{return execute::<11>(i,program,m,cx,count);};
    m.registers[dest as usize]=Value::Small(updated);
    m.registers[rhs as usize]=Value::Small(number);
    cx.fuel-=4;
    m.pc+=4;
    if count>4 {
        if let Some(next)=program.code.get(m.pc){return (next.handler)(next,program,m,cx,count-4);}
    }
    Ok(())
}

fn real(i: &Instruction, m: &mut Machine, _: &mut Context<'_>) -> Result<(), &'static str> {
    m.registers[i.args[0] as usize] = Value::Real(m.program.reals[i.args[1] as usize]);
    Ok(())
}

fn load(i: &Instruction, m: &mut Machine, cx: &mut Context<'_>) -> Result<(), &'static str> {
    let [dest, scope, key, mask, ..] = i.args;
    let value = if scope == 3 {
        Value::from(i64::from(cx.buttons & (1 << key) != 0))
    } else if scope == 5 {
        let a = &cx.runtime.actors[&cx.id];
        match key {
            17 => Value::Real(f64::from(a.p.x)),
            18 => Value::Real(f64::from(a.p.y)),
            19 => Value::Real(f64::from(a.v.x)),
            20 => Value::Real(f64::from(a.v.y)),
            21 => Value::Real(f64::from(a.health)),
            22 => Value::from(a.menu_choice as i64),
            23 => Value::Text(Rc::from(a.menu_item.as_str())),
            24 => Value::Text(Rc::from(a.menu_id.as_str())),
            25 => Value::Text(m.used_item.clone().unwrap_or_default()),
            26 => Value::from(if cx.received { m.payload[0] } else { 0 }),
            27 => Value::from(if cx.received { m.payload[1] } else { 0 }),
            28 => Value::from(i64::from(a.last_clone)),
            29 => Value::from(i64::from(a.clone_source.unwrap_or(0))),
            30 => Value::from(i64::from(a.clone_source.is_some())),
            _ => Value::from(match key {
                0 => i64::from(cx.id),
                1 => a.p.x.round() as i64,
                2 => a.p.y.round() as i64,
                3 => a.v.x.round() as i64,
                4 => a.v.y.round() as i64,
                5 => a.health.round() as i64,
                6 => i64::from(cx.runtime.grounded(cx.id)),
                7 => a.player.map_or(0, |p| p as i64 + 1),
                8 => m.payload[0],
                9 => m.payload[1],
                11 => i64::from(a.last_spawn),
                12 => a.answer,
                13 => i64::from(a.item_count),
                14 => i64::from(a.v.length_squared() > 0.0025),
                15 => i64::from(a.player.is_some()),
                16 => a.facing as i64,
                _ => cx
                    .runtime
                    .actors
                    .get(&(m.payload[0] as u32))
                    .and_then(|a| a.player)
                    .map_or(0, |p| p as i64 + 1),
            }),
        }
    } else if (6..=8).contains(&scope) {
        let mask = mask as u8;
        let now = cx.buttons & mask != 0;
        let before = cx.previous_buttons & mask != 0;
        Value::from(i64::from(match scope {
            7 => now && !before,
            8 => before && !now,
            _ => now,
        }))
    } else if scope == 4 {
        Value::from(i64::from(
            *cx.runtime
                .inventory
                .get(m.program.names[key as usize].as_ref())
                .unwrap_or(&0),
        ))
    } else {
        let name = &m.program.names[key as usize];
        let table = match scope {
            0 | 9 | 11 | 13 => &cx.runtime.actors[&cx.id].variables,
            1 | 10 | 12 | 14 => &cx.runtime.game_properties.globals,
            _ => &cx.runtime.game_properties.flags,
        };
        let fallback = || match scope {
            9 | 10 => Value::Real(0.0),
            13 | 14 => Value::Text(Rc::from("")),
            _ => Value::default(),
        };
        table.get(name).cloned().unwrap_or_else(fallback)
    };
    m.registers[dest as usize] = value;
    Ok(())
}

fn store(i: &Instruction, m: &mut Machine, cx: &mut Context<'_>) -> Result<(), &'static str> {
    let [scope, key, source, _, ..] = i.args;
    let table = match scope {
        0 | 9 | 11 | 13 => &mut cx.runtime.actors.get_mut(&cx.id).unwrap().variables,
        1 | 10 | 12 | 14 => &mut cx.runtime.game_properties.globals,
        _ => &mut cx.runtime.game_properties.flags,
    };
    let name = &m.program.names[key as usize];
    let value = &m.registers[source as usize];
    let valid = match scope {
        9 | 10 => matches!(value, Value::Real(_)),
        11 | 12 => matches!(value, Value::Small(0 | 1)),
        13 | 14 => matches!(value, Value::Text(_)),
        _ => matches!(value, Value::Small(_) | Value::Large(_)),
    };
    if !valid {
        return Err("Wrong type for this variable");
    }
    if scope == 2 && table.contains_key(name) == value.zero() {
        cx.runtime.gates_dirty = true;
    }
    if value.zero() {
        table.remove(name);
    } else {
        if table.len() >= VARIABLE_LIMIT && !table.contains_key(name) {
            return Err("Variable limit reached");
        }
        table.insert(
            name.clone(),
            if scope == 2 {
                Value::from(1)
            } else {
                value.clone()
            },
        );
    }
    Ok(())
}

fn calculate(i: &Instruction, m: &mut Machine, _: &mut Context<'_>) -> Result<(), &'static str> {
    let [dest, op, a, b, ..] = i.args;
    let a = &m.registers[a as usize];
    let b = &m.registers[b as usize];
    if matches!(op, 3 | 4) && b.zero() {
        return Err("Division by zero");
    }
    let value = match (op, a, b) {
        (_, Value::Text(a), Value::Text(b)) => match op {
            0 if a.len() + b.len() <= 4096 => Value::Text(Rc::from(format!("{a}{b}"))),
            0 => return Err("String exceeds 4096 bytes"),
            5 => Value::from(i64::from(a == b)),
            11 => Value::from(i64::from(a != b)),
            _ => return Err("Operation does not accept strings"),
        },
        (_, Value::Text(_), _) | (_, _, Value::Text(_)) => return Err("Operand types must match"),
        (33, Value::Small(0 | 1), _) => a.clone(),
        (17, Value::Small(_) | Value::Large(_), _) => real_result(a.float())?,
        (_, Value::Real(a), Value::Real(b)) => calculate_real(op, *a, *b)?,
        (_, Value::Real(_), _) | (_, _, Value::Real(_)) => {
            return Err("Numeric types must match");
        }
        _ => calculate_integer(op, a, b)?,
    };
    m.registers[dest as usize] = value;
    Ok(())
}

fn collection_command(op:u8,i:&Instruction,m:&mut Machine,cx:&mut Context<'_>)->Result<(),&'static str>{
    let get=|n:usize|&m.registers[i.args[n] as usize];
    let name=|n:usize|m.program.names[i.args[n] as usize].as_ref();
    let index=|n:usize|match get(n){
        Value::Small(value) if *value>0=>usize::try_from(*value-1).unwrap_or(usize::MAX),
        _=>usize::MAX,
    };
    if op==126{
        let id=name(2);
        let path=name(4);
        if matches!(i.args[1], 2 | 3) && id == "players"
            && let Some(item)=path.strip_prefix("items.").filter(|item|cx.runtime.game.items.contains_key(*item)) {
            let bag=cx.runtime.game_properties.player_items.get(index(3));
            let value = if i.args[1] == 2 { i64::from(bag.is_some()) }
                else { i64::from(bag.ok_or("Choose a player from 1 to 4")?.get(item).copied().unwrap_or(0)) };
            m.registers[i.args[0] as usize]=Value::Small(value);
            return Ok(());
        }
        let collections=&cx.runtime.game_properties.collections;
        let result=collections.query(i.args[1],name(2),index(3),name(4))?;
        m.registers[i.args[0] as usize]=result;
        return Ok(());
    }
    let zero=Value::Small(0);
    let (index,path,value)=match op {
        118=>(0,name(1),&zero),119|125=>(index(1),"",&zero),120=>(index(1),name(2),get(3)),
        121|122=>(index(1),name(2),&zero),123=>(0,"",get(1)),124=>(index(1),"",get(2)),
        _=>unreachable!(),
    };
    if op == 120 && name(0) == "players"
        && let Some(item)=path.strip_prefix("items.").filter(|item|cx.runtime.game.items.contains_key(*item)) {
        let bag=cx.runtime.game_properties.player_items.get_mut(index).ok_or("Choose a player from 1 to 4")?;
        let Value::Small(count)=value else { return Err("Use a nonnegative item count"); };
        let count=u32::try_from(*count).map_err(|_| "Use a nonnegative item count")?;
        if count==0 { bag.remove(item); }
        else {
            if bag.len()>=1024 && !bag.contains_key(item) { return Err("Player item properties are full"); }
            bag.insert(item.into(),count);
        }
        return Ok(());
    }
    let collections=&mut cx.runtime.game_properties.collections;
    collections.command(&cx.runtime.game.collections,op,name(0),index,path,value)
}

fn draw_command(op: u8, i: &Instruction, m: &mut Machine, cx: &mut Context<'_>) -> Result<(), &'static str> {
    use crate::drawing::{Kind, Shape};
    let get=|index:usize| &m.registers[i.args[index] as usize];
    match op {
        106 => m.draw_style.hud=m.program.names[i.args[0] as usize].as_ref()=="hud",
        107 | 109 => {
            let Value::Text(text)=get(0) else {return Err("A drawing color must be a string");};
            let color=text.strip_prefix('#').filter(|hex|matches!(hex.len(),6|8))
                .and_then(|hex|u32::from_str_radix(hex,16).ok().map(|color|if hex.len()==6{(color<<8)|255}else{color}))
                .ok_or("Use a color such as #80c0ff or #80c0ff80")?;
            if op==107 {m.draw_style.fill=color;} else {m.draw_style.stroke=color;}
        }
        108 => m.draw_style.fill=0,
        110 => m.draw_style.stroke=0,
        111 => m.draw_style.width=get(0).float().clamp(0.0,64.0) as f32,
        _ => {
            if cx.runtime.shapes.len()>=crate::drawing::LIMIT {return Ok(());}
            let (kind,count)=match op {
                112=>(Kind::Rect,4), 113=>(Kind::Ellipse,4), 114=>(Kind::Ellipse,3),
                115=>(Kind::Line,4), 116=>(Kind::Triangle,6), 117=>(Kind::Point,2), _=>unreachable!(),
            };
            let mut coords=[0.0;6];
            for (index,coord) in coords[..count].iter_mut().enumerate(){
                *coord=get(index).float().clamp(-65536.0,65536.0) as f32;
            }
            if op==114 {coords[3]=coords[2];}
            cx.runtime.shapes.push(Shape {kind,coords,style:m.draw_style});
        }
    }
    Ok(())
}

fn system_command(op: u8, i: &Instruction, m: &Machine, cx: &mut Context<'_>) -> Result<(), &'static str> {
    let integer = |n: usize| match &m.registers[i.args[n] as usize] {
        Value::Small(value) => u32::try_from(*value).map_err(|_| "Integer outside supported range"),
        _ => Err("Expected a non-negative integer"),
    };
    let name = || m.program.names[i.args[0] as usize].as_ref();
    let runtime = &mut cx.runtime;
    if (op <= 96 || op == 150) && cx.id != 0 {
        return Err("Use this command in the Game script");
    }
    match op {
        92 | 93 => {
            let settings = if op == 92 {
                crate::Camera { resolution: Some([integer(0)?, integer(1)?]), ..Default::default() }
            } else {
                crate::Camera { min_width: integer(0)?, min_height: integer(1)?, max_width: integer(2)?,
                    max_height: integer(3)?, zoom: integer(4)?, resolution: None }
            };
            if !settings.valid() { return Err("Display dimensions or pixel zoom are outside the supported range"); }
            runtime.game_settings.display = Some(settings);
        }
        94 => {
            let group = match name() { "player" => false, "group" => true, _ => return Err("Unknown camera target") };
            runtime.game_settings.group_camera = Some(group);
            runtime.group_camera = runtime.game.rooms[&runtime.room].group_camera_override.unwrap_or(group);
        }
        95 => {
            let mode = name();
            if !matches!(mode, "off" | "world" | "explored") { return Err("Unknown minimap mode"); }
            if runtime.game_settings.minimap.as_deref() != Some(mode) {
                runtime.game_settings.minimap = Some(mode.to_owned());
            }
        }
        96 => {
            let player = integer(0)?;
            if !(1..=2).contains(&player) { return Err("Choose player 1 or 2 for the first gamepad"); }
            runtime.game_settings.first_controller_slot = Some(player as usize - 1);
            runtime.update_startup_controllers();
        }
        97 => {
            let entity = integer(0)?;
            if runtime.entity_ids.contains(&entity) {
                runtime.actors.get_mut(&entity).unwrap().hidden = m.registers[i.args[1] as usize].zero();
            }
        }
        98 => {
            let entity = integer(0)?;
            let player = integer(1)?;
            if player > 4 { return Err("Choose player 1 to 4, or 0 for no player"); }
            runtime.assign_player(entity, player.checked_sub(1).map(|player| player as usize));
        }
        150 => {
            let distance = u16::try_from(integer(1)?).map_err(|_| "Split-screen merge distance must be between 0 and 65535 pixels")?;
            runtime.game_settings.split_screen = (!m.registers[i.args[0] as usize].zero()).then_some(distance);
        }
        _ => unreachable!(),
    }
    Ok(())
}

fn tile_command(op: u8, i: &Instruction, m: &Machine, cx: &mut Context<'_>) -> Result<(), &'static str> {
    let runtime = &mut cx.runtime;
    let actor = runtime.actors.get_mut(&cx.id).ok_or("Tile is no longer active")?;
    let name = actor.sprite.as_deref().filter(|name| name.starts_with("@tile/"))
        .ok_or("Use this command in a tile script")?;
    let value = || &m.registers[i.args[0] as usize];
    let text = || m.program.names[i.args[0] as usize].as_ref();
    match op {
        100 => {
            let (clip,once) = match text() {
                "still" => ("default",false), "loop" => ("sequence",false), "once" => ("sequence",true),
                _ => return Err("Unknown tile playback mode"),
            };
            if actor.animation!=clip || actor.animation_once!=once || once {
                actor.animation=clip.into(); actor.animation_start=runtime.tick;
                actor.animation_once=once; actor.animation_finished=false;
            }
        }
        101 | 102 => {
            let Value::Small(amount) = value() else { return Err("Use an integer tile frame"); };
            let sprite=&runtime.game.sprites[name];
            let frames=&sprite.clips["sequence"].frames;
            if frames.is_empty() { return Ok(()); }
            let count=frames.len() as i64;
            let current=actor.animation.strip_prefix("frame_").and_then(|text|text.parse::<i64>().ok()).unwrap_or_else(|| {
                let image = sprite.clips.get(&actor.animation).map(|clip|clip.image_with_repeat(
                    (runtime.tick - actor.animation_start) * 1000 / 60, u32::from(actor.animation_once)));
                frames.iter().position(|frame|Some(frame.image.as_str())==image).unwrap_or(0) as i64
            });
            let frame=if op==101 { amount.saturating_sub(1).clamp(0,count-1) } else { (current+amount.rem_euclid(count)).rem_euclid(count) };
            actor.animation=format!("frame_{frame}");
            actor.animation_start=runtime.tick;actor.animation_once=false;
        }
        103 => {
            let friction = value().float().clamp(0.0,1.0) as f32;
            actor.physics.friction=friction;
            if let Some(body)=actor.body {runtime.world.set_friction(body,friction);}
        }
        104 => {
            use crate::Mode::*;
            let mode = match text() {
                "none"=>None,"static"=>Static,"dynamic"=>Dynamic,"kinematic"=>Kinematic,
                "sensor"=>Sensor,"one_way"=>OneWay,"breakable"=>Breakable,"fluid"=>Fluid,"ladder"=>Ladder,
                _=>return Err("Unknown tile body type"),
            };
            if let Some(mark) = &mut actor.tile_mark {
                mark.mode = mode;
            }
            if actor.physics.mode!=mode {
                actor.physics.mode=mode;
                if let Some(body)=actor.body.take() {runtime.world.remove(body);}
                actor.body=runtime.world.create(actor.id,actor.p,actor.width,actor.height,&actor.physics,&[]);
                if let Some(body)=actor.body { runtime.world.set_friction(body,actor.physics.friction); }
                actor.velocity(&mut runtime.world,actor.v);
            }
        }
        _=>unreachable!(),
    }
    Ok(())
}

fn real_result(value: f64) -> Result<Value, &'static str> {
    if value.is_finite() {
        Ok(Value::Real(value))
    } else {
        Err("Math result is not finite")
    }
}

fn calculate_real(op: u16, a: f64, b: f64) -> Result<Value, &'static str> {
    let boolean = |test| Ok(Value::from(i64::from(test)));
    let value = match op {
        0 => a + b,
        1 => a - b,
        2 => a * b,
        3 => a / b,
        4 => a % b,
        5 => return boolean(a == b),
        6 => return boolean(a < b),
        7 => return boolean(a <= b),
        11 => return boolean(a != b),
        12 => return boolean(a > b),
        13 => return boolean(a >= b),
        14 => a.min(b),
        15 => a.max(b),
        16 => a.abs(),
        18..=21 => {
            let integer = match op {
                18 => a.floor(),
                19 => a.ceil(),
                20 => a.round(),
                _ => a.trunc(),
            };
            return BigInt::from_f64(integer)
                .map(Value::from_integer)
                .ok_or("Invalid real value");
        }
        22 => a.sqrt(),
        23 => a.to_radians().sin(),
        24 => a.to_radians().cos(),
        25 => a.to_radians().tan(),
        26 => a.asin().to_degrees(),
        27 => a.acos().to_degrees(),
        28 => a.atan().to_degrees(),
        29 => a.atan2(b).to_degrees(),
        30 => a.powf(b),
        31 => a.ln(),
        32 => a.exp(),
        _ => return Err("Operation requires integer operands"),
    };
    real_result(value)
}

fn calculate_integer(op: u16, a: &Value, b: &Value) -> Result<Value, &'static str> {
    if let (Value::Small(a), Value::Small(b)) = (a, b) {
        let small = match op {
            0 => a.checked_add(*b),
            1 => a.checked_sub(*b),
            2 => a.checked_mul(*b),
            3 => a.checked_div(*b),
            4 => a.checked_rem(*b),
            5 => Some(i64::from(a == b)),
            6 => Some(i64::from(a < b)),
            7 => Some(i64::from(a <= b)),
            8 => Some(i64::from(*a != 0 && *b != 0)),
            9 => Some(i64::from(*a != 0 || *b != 0)),
            10 => Some(i64::from(*a == 0)),
            11 => Some(i64::from(a != b)),
            12 => Some(i64::from(a > b)),
            13 => Some(i64::from(a >= b)),
            14 => Some(*a.min(b)),
            15 => Some(*a.max(b)),
            16 => a.checked_abs(),
            _ => return Err("Operation requires real operands"),
        };
        if let Some(value) = small {
            return Ok(Value::Small(value));
        }
    }
    let (a, b) = (a.integer()?, b.integer()?);
    let boolean = |test| BigInt::from(i64::from(test));
    let value = match op {
        0 => a + b,
        1 => a - b,
        2 => a * b,
        3 => a / b,
        4 => a % b,
        5 => boolean(a == b),
        6 => boolean(a < b),
        7 => boolean(a <= b),
        8 => boolean(!a.is_zero() && !b.is_zero()),
        9 => boolean(!a.is_zero() || !b.is_zero()),
        10 => boolean(a.is_zero()),
        11 => boolean(a != b),
        12 => boolean(a > b),
        13 => boolean(a >= b),
        14 => a.min(b),
        15 => a.max(b),
        16 => num_traits::Signed::abs(&a),
        _ => return Err("Operation requires real operands"),
    };
    if value.bits() > INTEGER_BITS {
        return Err("Script integer limit reached");
    }
    Ok(Value::from_integer(value))
}

fn branch(i: &Instruction, m: &mut Machine, _: &mut Context<'_>) -> Result<(), &'static str> {
    let condition = &m.registers[i.args[0] as usize];
    if matches!(condition, Value::Real(_) | Value::Text(_)) {
        return Err("Condition requires a boolean");
    }
    if condition.zero() {
        m.pc = i.args[1] as usize;
    }
    Ok(())
}
fn jump(i: &Instruction, m: &mut Machine, _: &mut Context<'_>) -> Result<(), &'static str> {
    m.pc = i.args[0] as usize;
    Ok(())
}
fn wait(i: &Instruction, m: &mut Machine, cx: &mut Context<'_>) -> Result<(), &'static str> {
    let ticks = &m.registers[i.args[0] as usize];
    let count = ticks.bounded_tick_count()?;
    m.wake = cx.runtime.tick.saturating_add(count);
    Ok(())
}

fn engine<const OP: u8>(
    i: &Instruction,
    m: &mut Machine,
    cx: &mut Context<'_>,
) -> Result<(), &'static str> {
    let named =
        matches!(OP, 3 | 5 | 7 | 8 | 9 | 18..=22 | 27 | 28 | 33..=39 | 55 | 56 | 67 | 68 | 87);
    let arg = |index: usize| {
        if index == 0 && named {
            return 0.0;
        }
        m.registers
            .get(i.args[index] as usize)
            .map(Value::float)
            .unwrap_or_default()
            .clamp(-10000.0, 10000.0) as f32
    };
    let name = if named {
        &*m.program.names[i.args[0] as usize]
    } else {
        ""
    };
    cx.runtime.engine(
        cx.id,
        cx.input,
        OP.into(),
        [arg(0), arg(1), arg(2)],
        name,
        cx.actions,
    );
    Ok(())
}

fn draw_hud_text(i: &Instruction, m: &Machine, cx: &mut Context<'_>) -> Result<(), &'static str> {
    let [label, text, font, anchor, x, y] = i.args;
    let label = &m.program.names[label as usize];
    let font = &m.program.names[font as usize];
    let anchor = crate::HudAnchor::from_name(&m.program.names[anchor as usize])
        .ok_or("Choose a HUD anchor")?;
    let Value::Text(text) = &m.registers[text as usize] else {
        return Err("HUD text requires a string");
    };
    if !font.is_empty() && !cx.runtime.game.fonts.contains(font.as_ref()) {
        return Err("Choose a registered bitfont");
    }
    if !cx.runtime.hud_text.contains_key(label.as_ref()) && cx.runtime.hud_text.len() >= 64 {
        return Ok(());
    }
    let offset = [x, y].map(|register| {
        m.registers[register as usize]
            .float()
            .clamp(-4096., 4096.)
            .round() as i32
    });
    if !cx.runtime.hud_text.get(label.as_ref()).is_some_and(|old| {
        old.value == text.as_ref()
            && old.font == font.as_ref()
            && old.anchor == anchor
            && old.offset == offset
    }) {
        cx.runtime.hud_text.insert(
            label.to_string(),
            crate::HudText {
                value: text.to_string(),
                font: font.to_string(),
                anchor,
                offset,
            },
        );
    }
    Ok(())
}

fn shader_command(op: u8, i: &Instruction, m: &mut Machine, cx: &mut Context<'_>) -> Result<(), &'static str> {
    match op {
        135 => m.shader_builder = Some(Vec::new()),
        136 => {
            let builder = m.shader_builder.as_mut().ok_or("Missing shader pipeline")?;
            let id = &m.program.names[i.args[0] as usize];
            if builder.len() >= crate::shader::MAX_SHADER_PASSES || id.is_empty() || id.len() > 96 {
                return Err("Invalid shader pass");
            }
            builder.push(crate::ShaderPass { shader: id.to_string(), uniforms: vec![0; i.args[1] as usize] });
        }
        137 => {
            let word = m.shader_builder.as_mut().and_then(|passes| passes.last_mut())
                .and_then(|pass| pass.uniforms.get_mut(i.args[1] as usize)).ok_or("Invalid shader parameter slot")?;
            let value = &m.registers[i.args[0] as usize];
            *word = match i.args[2] {
                0 => {
                    let real = value.float() as f32;
                    if !real.is_finite() { return Err("Shader parameter is outside the float range"); }
                    real.to_bits()
                }
                1 => match value {
                    Value::Small(value) => i32::try_from(*value).map_err(|_| "Shader parameter is outside the int range")? as u32,
                    _ => return Err("Shader parameter needs a 32-bit integer"),
                },
                2 => match value {
                    Value::Small(value) => u32::try_from(*value).map_err(|_| "Shader parameter is outside the uint range")?,
                    _ => return Err("Shader parameter needs an unsigned 32-bit integer"),
                },
                _ => unreachable!(),
            };
        }
        138 => {
            let passes = m.shader_builder.take().ok_or("Missing shader pipeline")?;
            let runtime = &mut cx.runtime;
            match i.args[0] {
                0 if runtime.room_script_id == Some(cx.id) => runtime.room_settings.shader_pipeline = Some(passes),
                1 if cx.id == 0 => runtime.game_settings.postprocessing = passes,
                _ => return Err("Use shader pipelines in the matching Room or Game script"),
            }
        }
        _ => unreachable!(),
    }
    Ok(())
}

fn room_command<const OP: u8>(
    i: &Instruction,
    m: &Machine,
    cx: &mut Context<'_>,
) -> Result<(), &'static str> {
    let runtime = &mut cx.runtime;
    if runtime.room_script_id != Some(cx.id) && cx.id != 0 {
        return Err("Room controls require a room script");
    }
    if matches!(OP, 82 | 83) && runtime.room_script_id != Some(cx.id) {
        return Err("Room shaders require a room script");
    }
    if matches!(OP, 82 | 83) {
        runtime.room_settings.shader_pipeline = None;
    }
    let operand = i.args[0] as usize;
    match OP {
        74 => {
            let target = entity_id(&m.registers[operand]);
            if runtime.entity(target).is_some() {
                runtime.camera_actor = Some(target);
                runtime.camera_point = None;
                runtime.group_camera = false;
            }
        }
        75 => {
            let zoom = m.registers[operand].float().clamp(0.25, 4.0) as f32;
            runtime.room_settings.zoom = (zoom != 1.0).then_some(zoom);
        }
        76 => {
            let gravity = m.registers[operand].float().clamp(-100.0, 100.0) as f32;
            if gravity != runtime.room_gravity() {
                runtime.room_settings.gravity = Some(gravity);
                runtime.apply_room_gravity();
            }
        }
        77 => {
            let Value::Text(color) = &m.registers[operand] else {
                return Err("Background color requires text");
            };
            if !crate::RoomSettings::valid_color(color) {
                return Err("Use a background color such as #101a23");
            }
            if runtime.room_settings.background.as_deref() != Some(color) {
                runtime.room_settings.background = Some(color.to_string());
            }
        }
        78 => runtime.room_settings.y_sort = Some(!m.registers[operand].zero()),
        79 | 80 => {
            let track = &m.program.names[operand];
            let current = if OP == 79 {
                &mut runtime.room_settings.music
            } else {
                &mut runtime.room_settings.ambience
            };
            if current.as_deref() != Some(track) {
                *current = Some(track.to_string());
            }
        }
        81 => {
            runtime.camera_actor = None;
            runtime.camera_point = None;
            runtime.camera_slot = 0;
            let room = &runtime.game.rooms[&runtime.room];
            runtime.group_camera = room.group_camera_override.or(runtime.game_settings.group_camera).unwrap_or(room.group_camera);
            runtime.room_settings.zoom = room.camera_zoom;
        }
        82 => {
            let kind = crate::ShaderKind::from_name(&m.program.names[operand])
                .ok_or("Choose a room shader preset")?;
            let strength = m.registers[i.args[1] as usize]
                .float()
                .clamp(0.0, 100.0)
                .round() as u8;
            runtime.room_settings.shader = Some(crate::RoomShader { kind, strength });
        }
        83 => runtime.room_settings.shader = None,
        127 => {
            let image = &m.program.names[operand];
            if runtime.room_settings.background_image.as_deref() != Some(image.as_ref()) {
                runtime.room_settings.background_image = Some(image.to_string());
            }
            runtime.room_settings.background_scroll = Some(m.registers[i.args[1] as usize].float().clamp(0.0, 1.0) as f32);
        }
        128 => {
            let room = &runtime.game.rooms[&runtime.room];
            let rows = m.registers[operand].float().clamp(0.0, room.rows.saturating_sub(1) as f64);
            runtime.room_settings.camera_height = Some((room.height - rows as f32 * room.size) as u32);
        }
        129 => {
            let border = match m.program.names[operand].as_ref() {
                "open" => 0,
                "sides" => 1,
                "closed" => 3,
                _ => return Err("Unknown room border"),
            };
            if runtime.room_settings.border != Some(border) {
                runtime.room_settings.border = Some(border);
                runtime.apply_room_border();
            }
        }
        _ => unreachable!(),
    }
    Ok(())
}

fn text_command(i: &Instruction, m: &Machine, cx: &mut Context<'_>) -> Result<(), &'static str> {
    let [opcode, text, a, b, ..] = i.args;
    let Value::Text(message) = &m.registers[text as usize] else {
        return Err("Command requires a string");
    };
    let number = |index: u16| m.registers[index as usize].float().clamp(-10000.0, 10000.0) as f32;
    cx.runtime.engine(
        cx.id,
        cx.input,
        opcode.into(),
        [0.0, number(a), number(b)],
        message,
        cx.actions,
    );
    Ok(())
}

fn entity_id(value: &Value) -> u32 {
    match value {
        Value::Small(id) => u32::try_from(*id).unwrap_or_default(),
        _ => 0,
    }
}

fn entity_query(
    i: &Instruction,
    m: &mut Machine,
    cx: &mut Context<'_>,
) -> Result<(), &'static str> {
    let [dest, op, a, b, ..] = i.args;
    let a = &m.registers[a as usize];
    let b = &m.registers[b as usize];
    let runtime = &cx.runtime;
    let value = match op {
        0 | 1 => {
            let Value::Text(name) = a else {
                return Err("Expected an entity or component name");
            };
            let found = if op == 0 {
                runtime
                    .named_entities
                    .get(name.as_ref())
                    .and_then(|id| runtime.entity(*id))
            } else {
                let origin = runtime.actors[&cx.id].p;
                let radius = b.float().clamp(0.0, 100000.0) as f32;
                runtime
                    .entity_ids
                    .iter()
                    .filter(|id| **id != cx.id)
                    .map(|id| &runtime.actors[id])
                    .filter(|actor| runtime.has_component(actor, name))
                    .map(|actor| (actor, (actor.p - origin).length_squared()))
                    .filter(|(_, distance)| *distance <= radius * radius)
                    .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.id.cmp(&b.0.id)))
                    .map(|(actor, _)| actor)
            };
            Value::from(found.map_or(0, |actor| i64::from(actor.id)))
        }
        2 => Value::from(i64::from(runtime.entity(entity_id(a)).is_some())),
        3 => {
            let Value::Text(name) = b else {
                return Err("Expected a component name");
            };
            Value::from(i64::from(
                runtime
                    .entity(entity_id(a))
                    .is_some_and(|actor| runtime.has_component(actor, name)),
            ))
        }
        9..=12 => {
            let Value::Text(key) = b else {
                return Err("Expected an entity field name");
            };
            let (prefix, fallback) = match op {
                10 => ("real.", Value::Real(0.0)),
                11 => ("bool.", Value::from(0)),
                12 => ("text.", Value::Text("".into())),
                _ => ("", Value::from(0)),
            };
            runtime
                .entity(entity_id(a))
                .and_then(|actor| actor.variables.get(format!("{prefix}{key}").as_str()))
                .cloned()
                .unwrap_or(fallback)
        }
        13 => Value::from(i64::from(matches!(a, Value::Small(1..=4)) &&
            runtime.connected_players & (1 << (entity_id(a) - 1)) != 0)),
        14 => Value::from(i64::from(runtime.entity(entity_id(a)).is_some_and(|actor| actor.player.is_some()))),
        15 => Value::from(runtime.entity(entity_id(a)).and_then(|actor| actor.player).map_or(0, |slot| slot as i64 + 1)),
        16 => {
            let Value::Text(key) = b else { return Err("Expected an entity property name"); };
            Value::from(i64::from(runtime.entity(entity_id(a)).is_some_and(|actor| {
                actor.variables.keys().any(|name| {
                    let name = name.as_ref();
                    name == key.as_ref() || name.split_once('.').is_some_and(|(_, suffix)| suffix == key.as_ref())
                })
            })))
        }
        17 => Value::from(i64::from(runtime.touches_tile_top(cx.id,entity_id(a)))),
        18 => Value::from(i64::from(runtime.entity(entity_id(a)).is_some_and(|actor| actor.clone_source.is_some()))),
        19 => Value::from(runtime.entity(entity_id(a)).and_then(|actor| actor.clone_source).map_or(0, i64::from)),
        _ => Value::Real(runtime.entity(entity_id(a)).map_or(0.0, |actor| {
            f64::from(match op {
                4 => actor.p.x,
                5 => actor.p.y,
                6 => actor.v.x,
                7 => actor.v.y,
                _ => actor.health,
            })
        })),
    };
    m.registers[dest as usize] = value;
    Ok(())
}

fn entity_command<const OP: u8>(
    i: &Instruction,
    m: &Machine,
    cx: &mut Context<'_>,
) -> Result<(), &'static str> {
    let id = entity_id(&m.registers[i.args[0] as usize]);
    if cx.runtime.entity(id).is_none() || cx.actions.len() >= crate::MAX_ACTIONS {
        return Ok(());
    }
    let number = |index: usize| {
        m.registers[i.args[index] as usize]
            .float()
            .clamp(-10000.0, 10000.0) as f32
    };
    match OP {
        51 => cx.runtime.engine(
            id,
            cx.input,
            46,
            [number(1), number(2), 0.0],
            "",
            cx.actions,
        ),
        52 => cx
            .runtime
            .engine(id, cx.input, 6, [number(1), number(2), 0.0], "", cx.actions),
        53 if number(1) > 0.0 => cx.actions.push(Action::Damage {
            source: cx.id,
            target: id,
            amount: Some(number(1)),
        }),
        89 if number(1) > 0.0 => cx.actions.push(Action::Heal(id, number(1))),
        90 => cx.runtime.engine(
            id,
            cx.input,
            45,
            [number(1), number(2), 0.0],
            "",
            cx.actions,
        ),
        91 => cx.actions.push(Action::Damage {
            source: cx.id,
            target: id,
            amount: None,
        }),
        58 | 59 => {
            let name = &m.program.names[i.args[1] as usize];
            let actor = cx.runtime.actors.get_mut(&id).unwrap();
            if OP == 59 {
                actor.components.retain(|entry| entry != name.as_ref());
            } else if actor.components.len() < 64
                && !actor.components.iter().any(|entry| entry == name.as_ref())
            {
                actor.components.push(name.to_string());
            }
        }
        130..=133 => {
            let value = m.registers[i.args[1] as usize].float();
            let actor = cx.runtime.actors.get_mut(&id).unwrap();
            match OP {
                130 => actor.layer = value.clamp(-10000.0, 10000.0) as i32,
                131 => actor.team = value.clamp(i32::MIN as f64, i32::MAX as f64) as i32,
                132 => {
                    actor.physics.health = value.clamp(0.001, 1000000.0) as f32;
                    actor.health = actor.health.min(actor.physics.health);
                }
                133 => {
                    actor.physics.friction = value.clamp(0.0, 1.0) as f32;
                    if let Some(body) = actor.body {
                        cx.runtime.world.set_friction(body, actor.physics.friction);
                    }
                }
                _ => unreachable!(),
            }
        }
        139 => {
            let enabled = !m.registers[i.args[1] as usize].zero();
            let runtime = &mut cx.runtime;
            let actor = runtime.actors.get_mut(&id).unwrap();
            if enabled && actor.persistence.is_none() {
                let name = actor.origin.as_ref().and_then(|spawn| spawn.name.as_ref())
                    .ok_or("Name the placed entity to remember its state")?;
                let key = format!("sprite/{name}");
                if let Some(record) = runtime.memory.get(&runtime.room).and_then(|room| room.get(&key)) {
                    actor.teleport(&mut runtime.world, crate::Vec2::from_array(record.xy));
                    actor.velocity(&mut runtime.world, crate::Vec2::from_array(record.motion));
                    actor.health = record.health;
                    actor.variables = crate::progress::variables(&record.locals).map_err(|_| "Invalid saved entity state")?;
                    actor.animation.clone_from(&record.animation);
                    actor.facing = record.facing;
                }
                actor.persistence = Some(key);
                if let Some(origin) = &mut actor.origin { origin.remember_removal = Some(false); }
            } else if !enabled && let Some(key) = actor.persistence.take() {
                if let Some(room) = runtime.memory.get_mut(&runtime.room) { room.remove(&key); }
            }
        }
        140 => {
            let enabled = !m.registers[i.args[1] as usize].zero();
            cx.runtime.actors.get_mut(&id).unwrap().always_active = Some(enabled);
        }
        60..=63 => {
            let name = &m.program.names[i.args[1] as usize];
            let value = &m.registers[i.args[2] as usize];
            let prefix = match (OP, value) {
                (60, Value::Small(_) | Value::Large(_)) => "",
                (61, Value::Real(_)) => "real.",
                (62, Value::Small(0 | 1)) => "bool.",
                (63, Value::Text(_)) => "text.",
                _ => return Err("Wrong entity field type"),
            };
            let fields = &mut cx.runtime.actors.get_mut(&id).unwrap().variables;
            let key = format!("{prefix}{name}");
            if fields.len() < VARIABLE_LIMIT || fields.contains_key(key.as_str()) {
                fields.insert(key.into(), value.clone());
            } else {
                return Err("Entity field limit reached");
            }
        }
        65 => {
            let mode = &m.program.names[i.args[1] as usize];
            let ticks = entity_id(&m.registers[i.args[2] as usize]).clamp(1, 216000);
            if let Some(spawn) = cx
                .runtime
                .actors
                .get_mut(&id)
                .and_then(|actor| actor.origin.as_mut())
            {
                spawn.respawn = match mode.as_ref() {
                    "never" => Some(crate::Respawn {
                        mode: crate::RespawnMode::Never,
                        ticks: 0,
                        flag: None,
                        when: true,
                    }),
                    "on_entry" => Some(crate::Respawn {
                        mode: crate::RespawnMode::OnEntry,
                        ticks: 0,
                        flag: None,
                        when: true,
                    }),
                    "delay" => Some(crate::Respawn {
                        mode: crate::RespawnMode::Delay,
                        ticks,
                        flag: None,
                        when: true,
                    }),
                    _ => None,
                };
            }
        }
        66 => {
            let flag = &m.program.names[i.args[1] as usize];
            let when = !m.registers[i.args[2] as usize].zero();
            if let Some(rule) = cx
                .runtime
                .actors
                .get_mut(&id)
                .and_then(|actor| actor.origin.as_mut())
                .and_then(|spawn| spawn.respawn.as_mut())
            {
                rule.flag = (!flag.is_empty()).then(|| flag.to_string());
                rule.when = when;
            }
        }
        54 => cx.actions.push(Action::Remove(id)),
        _ => {}
    }
    Ok(())
}
