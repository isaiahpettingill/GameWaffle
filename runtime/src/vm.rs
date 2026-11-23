use crate::{Action, Input, Runtime};
use num_bigint::BigInt;
use num_traits::{ToPrimitive, Zero};
use serde::Deserialize;
use std::{collections::BTreeMap, rc::Rc};

pub type Variables = BTreeMap<Rc<str>, Integer>;
#[derive(Clone)]
pub enum Integer {
    Small(i64),
    Large(BigInt),
}

impl Default for Integer {
    fn default() -> Self {
        Self::Small(0)
    }
}
impl From<i64> for Integer {
    fn from(value: i64) -> Self {
        Self::Small(value)
    }
}
impl std::fmt::Display for Integer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Small(value) => value.fmt(f),
            Self::Large(value) => value.fmt(f),
        }
    }
}
impl Integer {
    fn zero(&self) -> bool {
        matches!(self, Self::Small(0))
    }
    fn big(&self) -> BigInt {
        match self {
            Self::Small(value) => (*value).into(),
            Self::Large(value) => value.clone(),
        }
    }
    fn float(&self) -> f32 {
        match self {
            Self::Small(value) => *value as f32,
            Self::Large(value) => value.to_f32().unwrap_or_default(),
        }
    }
    fn bounded_tick_count(&self) -> u64 {
        match self {
            Self::Small(value) => (*value).clamp(1, i64::from(u32::MAX)) as u64,
            Self::Large(value) if value.sign() == num_bigint::Sign::Minus => 1,
            _ => u64::from(u32::MAX),
        }
    }
}
pub type Programs = BTreeMap<String, Rc<Program>>;

const REGISTERS: usize = 64;
const SLICE: usize = 1024;
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

type Handler = fn(&Instruction, &mut Machine, &mut Context<'_>) -> Result<(), &'static str>;

struct Instruction {
    handler: Handler,
    args: [u16; 4],
}

pub struct Program {
    code: Vec<Instruction>,
    names: Vec<Rc<str>>,
    constants: Vec<Integer>,
    registers: usize,
    reals: Vec<f32>,
}

pub struct Machine {
    program: Rc<Program>,
    registers: Vec<Integer>,
    real_registers: [Option<f32>; REGISTERS],
    pc: usize,
    wake: u64,
}

struct Context<'a> {
    runtime: &'a mut Runtime,
    id: u32,
    input: Input,
    actions: &'a mut Vec<Action>,
}

impl Program {
    pub fn decode(raw: Encoded) -> Result<Self, String> {
        if raw.b.len() > 65535 || raw.n.len() > 4096 || raw.k.len() > 4096 || raw.f.len() > 4096 {
            return Err("Script bytecode exceeds its limits".into());
        }
        let mut code = Vec::new();
        let mut positions = BTreeMap::new();
        let mut registers = 0;
        let mut pc = 0;
        while pc < raw.b.len() {
            positions.insert(pc, code.len());
            let opcode = raw.b[pc];
            pc += 1;
            let layout = match opcode {
                0 | 1 | 4 => "W",
                2 => "WWW",
                3 | 9 => "NWW",
                5 | 7 | 8 => "N",
                6 => "WW",
                10 => "rk",
                11 => "rsn",
                12 => "snr",
                13 => "rorr",
                14 => "rj",
                15 => "j",
                16 => "r",
                17 => "rf",
                18 | 19 | 21 | 27 | 28 => "NW",
                20 | 22 => "N",
                23 | 25 | 26 | 29 => "",
                24 => "WW",
                _ => return Err(format!("Invalid opcode {opcode}")),
            };
            let mut args = [0; 4];
            let read = |pc: &mut usize| {
                let value = raw.b.get(*pc).copied().ok_or("Incomplete instruction");
                *pc += 1;
                value
            };
            for (slot, kind) in layout.bytes().enumerate() {
                let mut value = u16::from(read(&mut pc)?);
                if !b"rso".contains(&kind) {
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
                    b'n' if opcode == 11 && args[1] == 3 => index < 8,
                    b'n' => index < raw.n.len(),
                    b's' => index < if opcode == 11 { 5 } else { 3 },
                    b'o' => index < 11,
                    _ => true,
                };
                if !valid {
                    return Err(format!("Invalid operand for opcode {opcode}"));
                }
                args[slot] = value;
            }
            let handler = match opcode {
                0 => engine::<0>,
                1 => engine::<1>,
                2 => engine::<2>,
                3 => engine::<3>,
                4 => engine::<4>,
                5 => engine::<5>,
                6 => engine::<6>,
                7 => engine::<7>,
                8 => engine::<8>,
                9 => engine::<9>,
                10 => constant,
                11 => load,
                12 => store,
                13 => calculate,
                14 => branch,
                15 => jump,
                16 => wait,
                17 => real,
                18 => engine::<18>,
                19 => engine::<19>,
                20 => engine::<20>,
                21 => engine::<21>,
                22 => engine::<22>,
                23 => engine::<23>,
                24 => engine::<24>,
                25 => engine::<25>,
                26 => engine::<26>,
                27 => engine::<27>,
                28 => engine::<28>,
                29 => engine::<29>,

                _ => unreachable!(),
            };
            code.push(Instruction { handler, args });
        }
        positions.insert(pc, code.len());
        for instruction in &mut code {
            let index = if std::ptr::fn_addr_eq(instruction.handler, branch as Handler) {
                1
            } else if std::ptr::fn_addr_eq(instruction.handler, jump as Handler) {
                0
            } else {
                continue;
            };
            instruction.args[index] = *positions
                .get(&usize::from(instruction.args[index]))
                .ok_or("Jump target is outside an instruction boundary")?
                as u16;
        }
        Ok(Self {
            code,
            names: raw.n.into_iter().map(Rc::from).collect(),
            constants: raw.k.into_iter().map(Integer::from).collect(),
            registers,
            reals: raw
                .f
                .into_iter()
                .map(|value| {
                    value
                        .parse::<f32>()
                        .ok()
                        .filter(|value| value.is_finite() && value.abs() <= 10000.0)
                        .ok_or("Invalid real constant")
                })
                .collect::<Result<_, _>>()?,
        })
    }
}

impl Machine {
    pub fn new(program: Rc<Program>) -> Self {
        Self {
            registers: vec![Integer::default(); program.registers],
            real_registers: [None; REGISTERS],
            program,
            pc: 0,
            wake: 0,
        }
    }

    pub fn restart(&mut self) {
        self.pc = 0;
        self.wake = 0;
    }

    pub fn run(
        &mut self,
        runtime: &mut Runtime,
        id: u32,
        input: Input,
        actions: &mut Vec<Action>,
    ) -> Result<bool, &'static str> {
        if self.wake > runtime.tick {
            return Ok(false);
        }
        let program = self.program.clone();
        let mut cx = Context {
            runtime,
            id,
            input,
            actions,
        };
        let budget = cx.runtime.script_fuel.min(SLICE);
        for _ in 0..budget {
            let Some(instruction) = program.code.get(self.pc) else {
                return Ok(true);
            };
            self.pc += 1;
            cx.runtime.script_fuel -= 1;
            (instruction.handler)(instruction, self, &mut cx)?;
            if self.wake > cx.runtime.tick {
                return Ok(false);
            }
        }
        Ok(self.pc == program.code.len())
    }
}

fn constant(i: &Instruction, m: &mut Machine, _: &mut Context<'_>) -> Result<(), &'static str> {
    m.real_registers[i.args[0] as usize] = None;
    m.registers[i.args[0] as usize] = m.program.constants[i.args[1] as usize].clone();
    Ok(())
}

fn real(i: &Instruction, m: &mut Machine, _: &mut Context<'_>) -> Result<(), &'static str> {
    m.registers[i.args[0] as usize] = Integer::default();
    m.real_registers[i.args[0] as usize] = Some(m.program.reals[i.args[1] as usize]);
    Ok(())
}

fn load(i: &Instruction, m: &mut Machine, cx: &mut Context<'_>) -> Result<(), &'static str> {
    let [dest, scope, key, _] = i.args;
    let value = if scope == 3 {
        let input = cx.input;
        Integer::from(i64::from(
            [
                input.up,
                input.down,
                input.left,
                input.right,
                input.a,
                input.b,
                input.x,
                input.menu,
            ][key as usize],
        ))
    } else if scope == 4 {
        Integer::from(i64::from(
            *cx.runtime
                .inventory
                .get(m.program.names[key as usize].as_ref())
                .unwrap_or(&0),
        ))
    } else {
        let name = &m.program.names[key as usize];
        match scope {
            0 => cx.runtime.actors[&cx.id].variables.get(name),
            1 => cx.runtime.globals.get(name),
            _ => cx.runtime.flags.get(name),
        }
        .cloned()
        .unwrap_or_default()
    };
    m.real_registers[dest as usize] = None;
    m.registers[dest as usize] = value;
    Ok(())
}

fn store(i: &Instruction, m: &mut Machine, cx: &mut Context<'_>) -> Result<(), &'static str> {
    let [scope, key, source, _] = i.args;
    let table = match scope {
        0 => &mut cx.runtime.actors.get_mut(&cx.id).unwrap().variables,
        1 => &mut cx.runtime.globals,
        _ => &mut cx.runtime.flags,
    };
    let name = &m.program.names[key as usize];
    let value = &m.registers[source as usize];
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
                Integer::from(1)
            } else {
                value.clone()
            },
        );
    }
    Ok(())
}

fn calculate(i: &Instruction, m: &mut Machine, _: &mut Context<'_>) -> Result<(), &'static str> {
    let [dest, op, a, b] = i.args;
    let a = &m.registers[a as usize];
    let b = &m.registers[b as usize];
    if matches!(op, 3 | 4) && b.zero() {
        return Err("Division by zero");
    }
    let small = if let (Integer::Small(a), Integer::Small(b)) = (a, b) {
        match op {
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
            _ => Some(i64::from(*a == 0)),
        }
    } else {
        None
    };
    let value = if let Some(value) = small {
        Integer::Small(value)
    } else {
        let (a, b) = (a.big(), b.big());
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
            _ => boolean(a.is_zero()),
        };
        if value.bits() > INTEGER_BITS {
            return Err("Script integer limit reached");
        }
        value.to_i64().map_or(Integer::Large(value), Integer::Small)
    };
    m.real_registers[dest as usize] = None;
    m.registers[dest as usize] = value;
    Ok(())
}

fn branch(i: &Instruction, m: &mut Machine, _: &mut Context<'_>) -> Result<(), &'static str> {
    if m.registers[i.args[0] as usize].zero() {
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
    let count = ticks.bounded_tick_count();
    m.wake = cx.runtime.tick.saturating_add(count);
    Ok(())
}

fn engine<const OP: u8>(
    i: &Instruction,
    m: &mut Machine,
    cx: &mut Context<'_>,
) -> Result<(), &'static str> {
    let named = matches!(OP, 3 | 5 | 7 | 8 | 9 | 18..=22 | 27 | 28);
    let arg = |index: usize| {
        if index == 0 && named {
            return 0.0;
        }
        if let Some(value) = m
            .real_registers
            .get(i.args[index] as usize)
            .copied()
            .flatten()
        {
            return value;
        }
        m.registers
            .get(i.args[index] as usize)
            .map(Integer::float)
            .unwrap_or_default()
            .clamp(-10000.0, 10000.0)
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
