use super::{Context, Instruction, Machine, Value, entity_id, real_result};
use num_traits::{ToPrimitive, Zero};
use std::rc::Rc;

const TEXT_LIMIT: usize = 4096;

fn text(value: &Value) -> Result<&str, &'static str> {
    match value {
        Value::Text(value) => Ok(value),
        _ => Err("Expected text"),
    }
}

fn checked_text(value: String) -> Result<Value, &'static str> {
    if value.len() > TEXT_LIMIT {
        return Err("Text value exceeds 4096 bytes");
    }
    Ok(Value::Text(Rc::from(value)))
}

fn index(value: &Value) -> Result<usize, &'static str> {
    match value {
        Value::Small(value) => Ok(usize::try_from((*value).max(0)).unwrap_or(usize::MAX)),
        Value::Large(value) if value.sign() == num_bigint::Sign::Minus => Ok(0),
        Value::Large(_) => Ok(usize::MAX),
        _ => Err("Expected an integer index"),
    }
}

fn replace(value: &str, old: &str, new: &str) -> Result<Value, &'static str> {
    if old.is_empty() {
        return checked_text(value.to_owned());
    }
    let count = value.matches(old).count();
    if value.len() - count * old.len() + count * new.len() > TEXT_LIMIT {
        return Err("Text value exceeds 4096 bytes");
    }
    checked_text(value.replace(old, new))
}

fn modulo(a: &Value, b: &Value) -> Result<Value, &'static str> {
    match (a, b) {
        (Value::Real(a), Value::Real(b)) if *b != 0. => {
            let r = a % b;
            real_result(if r != 0. && r.is_sign_negative() != b.is_sign_negative() {
                r + b
            } else {
                r
            })
        }
        (Value::Real(_), Value::Real(_)) | (_, Value::Small(0)) => Err("Modulo by zero"),
        (Value::Small(a), Value::Small(b)) => {
            let r = a.checked_rem(*b).unwrap_or(0);
            Ok(Value::Small(if r != 0 && (r < 0) != (*b < 0) {
                r + b
            } else {
                r
            }))
        }
        _ => {
            let [a, b] = [a.integer()?, b.integer()?];
            if b.is_zero() {
                return Err("Modulo by zero");
            }
            let r = a % &b;
            Ok(Value::from_integer(
                if !r.is_zero() && r.sign() != b.sign() {
                    r + b
                } else {
                    r
                },
            ))
        }
    }
}

fn clamp(value: &Value, lo: &Value, hi: &Value) -> Result<Value, &'static str> {
    if let (Value::Real(value), Value::Real(lo), Value::Real(hi)) = (value, lo, hi) {
        return if lo <= hi {
            real_result(value.clamp(*lo, *hi))
        } else {
            Err("Invalid clamp range")
        };
    }
    if let (Value::Small(value), Value::Small(lo), Value::Small(hi)) = (value, lo, hi) {
        return if lo <= hi {
            Ok(Value::Small((*value).clamp(*lo, *hi)))
        } else {
            Err("Invalid clamp range")
        };
    }
    let [value, lo, hi] = [value.integer()?, lo.integer()?, hi.integer()?];
    if lo > hi {
        return Err("Invalid clamp range");
    }
    Ok(Value::from_integer(value.clamp(lo, hi)))
}

fn random_integer(
    runtime: &mut crate::Runtime,
    a: &Value,
    b: &Value,
) -> Result<Value, &'static str> {
    let i64_value = |value: &Value| match value {
        Value::Small(value) => Ok(*value),
        Value::Large(value) => value
            .to_i64()
            .ok_or("Random integer bounds must fit in 64 bits"),
        _ => Err("Random integer bounds must be integers"),
    };
    let [a, b] = [i64_value(a)?, i64_value(b)?];
    if a > b {
        return Err("Invalid random range");
    }
    if a == b {
        return Ok(Value::Small(a));
    }
    let span = (i128::from(b) - i128::from(a) + 1) as u128;
    let limit = (1u128 << 64) / span * span;
    loop {
        let high = u128::from(crate::Runtime::next_random_u32(&mut runtime.rng));
        let low = u128::from(crate::Runtime::next_random_u32(&mut runtime.rng));
        let bits = (high << 32) | low;
        if bits < limit {
            return Ok(Value::Small((i128::from(a) + (bits % span) as i128) as i64));
        }
    }
}

pub(super) fn evaluate(
    i: &Instruction,
    m: &mut Machine,
    cx: &mut Context<'_>,
) -> Result<(), &'static str> {
    let [dest, op, a, b, c, _] = i.args;
    let [a, b, c] = [a, b, c].map(|index| &m.registers[usize::from(index)]);
    let boolean = |value: bool| Value::Small(i64::from(value));
    let value = match op {
        0..=2 => boolean(cx.runtime.camera_sensing(
            entity_id(a),
            op,
            if op == 1 { "any" } else { text(b)? },
        )),
        3..=8 => {
            let [x, y, w, h] = cx.runtime.camera_viewport().map(i64::from);
            Value::Small([x, y, x + w, y + h, w, h][usize::from(op - 3)])
        }
        9..=10 => boolean(
            cx.runtime
                .touching_tiles(entity_id(a), text(b)?, text(c)?, op == 10),
        ),
        11 => checked_text([text(a)?, text(b)?].concat())?,
        12 => Value::Small(text(a)?.chars().count() as i64),
        13 => {
            let text = text(a)?;
            let index = index(b)?;
            let letter = index
                .checked_sub(1)
                .and_then(|index| text.chars().nth(index));
            checked_text(letter.map_or_else(String::new, |letter| letter.to_string()))?
        }
        14 => {
            let start = index(b)?.max(1) - 1;
            let count = index(c)?.saturating_sub(start);
            checked_text(text(a)?.chars().skip(start).take(count).collect())?
        }
        15 => boolean(text(a)?.contains(text(b)?)),
        16 => {
            let haystack = text(a)?;
            Value::Small(
                haystack
                    .find(text(b)?)
                    .map_or(0, |byte| haystack[..byte].chars().count() as i64 + 1),
            )
        }
        17 => checked_text(text(a)?.to_uppercase())?,
        18 => checked_text(text(a)?.to_lowercase())?,
        19 => checked_text(text(a)?.trim().to_owned())?,
        20 => replace(text(a)?, text(b)?, text(c)?)?,
        21..=22 => checked_text(a.to_string())?,
        23 => modulo(a, b)?,
        24 => clamp(a, b, c)?,
        25 => real_result(a.float() * (1. - c.float()) + b.float() * c.float())?,
        26 => real_result(a.float().hypot(b.float()))?,
        27 => random_integer(cx.runtime, a, b)?,
        28 => {
            let [lo, hi] = [a.float(), b.float()];
            if lo > hi {
                return Err("Invalid random range");
            }
            if lo == hi {
                Value::Real(lo)
            } else {
                let t =
                    f64::from(crate::Runtime::next_random_u32(&mut cx.runtime.rng)) / 4294967296.0;
                real_result(lo * (1. - t) + hi * t)?
            }
        }
        29 => Value::Text(Rc::from(cx.runtime.localized_text(text(a)?))),
        30 => Value::Real(f64::from(cx.runtime.room_gravity()) * cx.runtime.game.distance_scale()),
        _ => unreachable!(),
    };
    m.registers[usize::from(dest)] = value;
    Ok(())
}
