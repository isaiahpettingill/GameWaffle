use super::{Context, Instruction, Machine, Program, Value};
use crate::gradient::{Focus, GradientKind, PALETTE, POINTS, Stop, rgb};

pub(super) fn command(
    op: u8,
    instruction: &Instruction,
    program: &Program,
    machine: &Machine,
    context: &mut Context<'_>,
) -> Result<(), &'static str> {
    let runtime = &mut context.runtime;
    if runtime.room_script_id != Some(context.id) {
        return Err("Use background gradients in a Room script");
    }
    let args = instruction.args;
    let name = |index: usize| program.names[args[index] as usize].as_ref();
    let value = |index: usize| &machine.registers[args[index] as usize];
    let number = |index: usize| value(index).float() as f32;
    let coord = |index: usize| number(index).clamp(-4.0, 4.0);
    let color = |index: usize| match value(index) {
        Value::Text(text) => rgb(text).ok_or("Use a gradient color such as #101a23"),
        _ => Err("Use a gradient color such as #101a23"),
    };
    let slot = |index: usize, limit: usize| match value(index) {
        Value::Small(n) if (1..=limit as i64).contains(n) => Ok(*n as usize - 1),
        _ => Err("Gradient slot is outside its range"),
    };
    let settings = &mut runtime.room_settings.background_gradient;
    if op == 144 {
        let kind = match name(0) {
            "none" => {
                *settings = None;
                return Ok(());
            }
            "linear" => GradientKind::Linear,
            "radial" => GradientKind::Radial,
            _ => return Err("Choose a linear or radial gradient"),
        };
        let dithered = match name(1) {
            "smooth" => false,
            "dithered" => true,
            _ => return Err("Choose smooth or dithered colors"),
        };
        let gradient = settings.get_or_insert_with(Default::default);
        gradient.kind = kind;
        gradient.dithered = dithered;
        return Ok(());
    }
    let gradient = settings
        .as_mut()
        .ok_or("Set a room background gradient first")?;
    match op {
        145 => gradient.axis = [coord(0), coord(1), coord(2), coord(3)],
        146 => {
            gradient.stops[slot(0, POINTS)?] = Some(Stop {
                offset: number(1).clamp(0., 1.),
                color: color(2)?,
            })
        }
        147 => {
            gradient.foci[slot(0, POINTS)?] = Some(Focus {
                center: [coord(1), coord(2)],
                radius: number(3).clamp(0.001, 8.),
                color: color(4)?,
            })
        }
        148 => gradient.palette[slot(0, PALETTE)?] = Some(color(1)?),
        149 => match name(0) {
            "stop" => gradient.stops[slot(1, POINTS)?] = None,
            "focus" => gradient.foci[slot(1, POINTS)?] = None,
            "palette" => gradient.palette[slot(1, PALETTE)?] = None,
            _ => return Err("Choose a gradient stop, focus, or palette color"),
        },
        _ => unreachable!(),
    }
    Ok(())
}
