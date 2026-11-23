use sdl3::{GamepadSubsystem, event::Event, joystick::JoystickId};
use std::{fs, path::PathBuf};

const FIELDS: [&str; 8] = [
    "dpup", "dpdown", "dpleft", "dpright", "a", "b", "x", "start",
];
const LABELS: [&str; 8] = ["Up", "Down", "Left", "Right", "A", "B", "X", "Start"];

fn directory() -> Result<PathBuf, super::Error> {
    let path = sdl3::filesystem::get_pref_path("GameWaffle", "Player")?.join("controllers");
    fs::create_dir_all(&path)?;
    Ok(path)
}

pub fn load(pads: &GamepadSubsystem) -> Result<(), super::Error> {
    for entry in fs::read_dir(directory()?)? {
        let path = entry?.path();
        if path.extension().is_some_and(|ext| ext == "map") {
            pads.load_mappings(path)?;
        }
    }
    Ok(())
}

#[derive(Default)]
pub struct Setup {
    device: Option<JoystickId>,
    bindings: Vec<String>,
}

impl Setup {
    pub fn prompt(&self) -> String {
        format!("Press {}", LABELS[self.bindings.len()])
    }
    pub fn capture(
        &mut self,
        event: &Event,
        pads: &GamepadSubsystem,
    ) -> Result<bool, super::Error> {
        let (id, binding) = match *event {
            Event::JoyButtonDown {
                which, button_idx, ..
            } => (which, format!("b{button_idx}")),
            Event::JoyHatMotion {
                which,
                hat_idx,
                state,
                ..
            } if matches!(state as u8, 1 | 2 | 4 | 8) => {
                (which, format!("h{hat_idx}.{}", state as u8))
            }
            Event::JoyAxisMotion {
                which,
                axis_idx,
                value,
                ..
            } if value.unsigned_abs() > 24576 => (
                which,
                format!("{}a{axis_idx}", if value < 0 { "-" } else { "+" }),
            ),
            Event::JoyDeviceRemoved { which, .. } if Some(which) == self.device => {
                *self = Self::default();
                return Ok(false);
            }
            _ => return Ok(false),
        };
        if self.device.is_some_and(|device| device != id) || self.bindings.contains(&binding) {
            return Ok(false);
        }
        self.device = Some(id);
        self.bindings.push(binding);
        if self.bindings.len() < FIELDS.len() {
            return Ok(false);
        }
        let guid = pads.guid_for_id(id).string();
        let existing = pads.mapping_for_id(id).unwrap_or_default();
        let mut mapping = format!("{guid},GameWaffle controller,");
        for field in existing.split(',').skip(2) {
            if let Some((key, _)) = field.split_once(':')
                && !FIELDS.contains(&key)
            {
                mapping.push_str(field);
                mapping.push(',');
            }
        }
        for (key, input) in FIELDS.iter().zip(&self.bindings) {
            mapping.push_str(&format!("{key}:{input},"));
        }
        let dir = directory()?;
        let file = dir.join(format!("{guid}.map"));
        let temp = file.with_extension("tmp");
        fs::write(&temp, format!("{mapping}\n"))?;
        pads.add_mapping(&mapping)?;
        fs::rename(temp, file)?;
        Ok(true)
    }
}
