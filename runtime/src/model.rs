use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

fn read_float<'de, D: serde::Deserializer<'de>>(decoder: D) -> Result<f32, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Number {
        Integer(i64),
        Float(f64),
    }
    let number = match Number::deserialize(decoder)? {
        Number::Integer(value) => value as f64,
        Number::Float(value) => value,
    };
    let result = number as f32;
    if !result.is_finite() {
        return Err(serde::de::Error::custom("Expected a finite number"));
    }
    Ok(result)
}

fn read_optional_float<'de, D: serde::Deserializer<'de>>(
    decoder: D,
) -> Result<Option<f32>, D::Error> {
    #[derive(Deserialize)]
    struct Number(#[serde(deserialize_with = "read_float")] f32);
    Ok(Option::<Number>::deserialize(decoder)?.map(|number| number.0))
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    #[default]
    None,
    Static,
    Dynamic,
    Kinematic,
    Sensor,
    Ladder,
    OneWay,
    Breakable,
    Fluid,
}

#[derive(Clone, Deserialize)]
#[serde(default)]
pub struct Physics {
    pub mode: Mode,
    #[serde(deserialize_with = "read_optional_float")]
    pub mass: Option<f32>,
    #[serde(deserialize_with = "read_float")]
    pub density: f32,
    #[serde(deserialize_with = "read_float")]
    pub friction: f32,
    #[serde(deserialize_with = "read_float")]
    pub elasticity: f32,
    pub category: u16,
    pub mask: u16,
    pub group: i16,
    #[serde(deserialize_with = "read_float")]
    pub gravity: f32,
    pub fixed: bool,
    #[serde(deserialize_with = "read_float")]
    pub health: f32,
    #[serde(deserialize_with = "read_float")]
    pub buoyancy: f32,
    #[serde(deserialize_with = "read_float")]
    pub drag: f32,
    #[serde(deserialize_with = "read_float")]
    pub damage: f32,
}

impl Default for Physics {
    fn default() -> Self {
        Self {
            mode: Mode::None,
            mass: None,
            density: 1.0,
            friction: 0.35,
            elasticity: 0.0,
            category: 1,
            mask: u16::MAX,
            group: 0,
            gravity: 1.0,
            fixed: true,
            health: 1.0,
            buoyancy: 0.75,
            drag: 2.0,
            damage: 0.0,
        }
    }
}

#[derive(Clone, Deserialize)]
pub struct Frame {
    pub image: String,
    pub ms: u32,
}

#[derive(Clone, Default, Deserialize)]
pub struct Clip {
    pub frames: Vec<Frame>,
    pub repeat: u32,
}

impl Clip {
    pub fn image(&self, elapsed: u64) -> &str {
        let duration = self
            .frames
            .iter()
            .map(|frame| u64::from(frame.ms.max(1)))
            .sum::<u64>();
        if duration == 0 {
            return "";
        }
        if self.repeat > 0 && elapsed / duration >= u64::from(self.repeat) {
            return self.frames.last().map_or("", |frame| &frame.image);
        }
        let mut cursor = elapsed % duration;
        for frame in &self.frames {
            if cursor < u64::from(frame.ms.max(1)) {
                return &frame.image;
            }
            cursor -= u64::from(frame.ms.max(1));
        }
        ""
    }
}

#[derive(Deserialize)]
pub struct Sprite {
    pub emitter: Option<crate::particles::Emitter>,
    #[serde(default, rename = "alwaysActive")]
    pub always_active: bool,
    pub clips: BTreeMap<String, Clip>,
    #[serde(default)]
    pub program: BTreeMap<String, crate::vm::Encoded>,
    pub physics: Physics,
    #[serde(deserialize_with = "read_float")]
    pub width: f32,
    #[serde(deserialize_with = "read_float")]
    pub height: f32,
    pub layer: i32,
    pub animation: String,
    pub team: i32,
    pub projectile: Option<String>,
}

#[derive(Clone, Default, Deserialize)]
pub struct Spawn {
    #[serde(default)]
    pub conditions: Vec<(String, bool)>,
    pub blocker: Option<usize>,
    #[serde(deserialize_with = "read_float")]
    pub x: f32,
    #[serde(deserialize_with = "read_float")]
    pub y: f32,
    pub layer: Option<i32>,
    pub player: Option<usize>,
    pub sprite: Option<String>,
    pub name: Option<String>,
    pub animation: Option<String>,
    #[serde(rename = "flipX")]
    pub flip_x: Option<bool>,
    pub clip: Option<Vec<Frame>>,
    pub physics: Option<Physics>,
}

#[derive(Clone, Deserialize)]
pub struct Solid {
    #[serde(deserialize_with = "read_float")]
    pub x: f32,
    #[serde(deserialize_with = "read_float")]
    pub y: f32,
    #[serde(deserialize_with = "read_float")]
    pub width: f32,
    #[serde(deserialize_with = "read_float")]
    pub height: f32,
    pub physics: Physics,
}

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum View {
    Platformer,
    TopDown,
}

#[derive(Clone, Deserialize)]
pub struct Exit {
    pub targets: Vec<String>,
    pub mode: String,
    pub flag: Option<String>,
    pub when: bool,
    pub adjacent: bool,
}
#[derive(Clone, Deserialize)]
pub struct Room {
    #[serde(default)]
    pub seams: BTreeMap<String, bool>,
    #[serde(default)]
    pub exits: BTreeMap<String, Exit>,
    pub cols: usize,
    pub rows: usize,
    #[serde(deserialize_with = "read_float")]
    pub size: f32,
    #[serde(deserialize_with = "read_float")]
    pub height: f32,
    #[serde(deserialize_with = "read_float")]
    pub gravity: f32,
    pub view: Option<View>,
    pub entities: Vec<Spawn>,
    pub solids: Vec<Solid>,
    pub blockers: Vec<usize>,
}

impl Room {
    pub fn is_top_down(&self) -> bool {
        self.view
            .map_or(self.gravity.abs() < 0.01, |view| view == View::TopDown)
    }
}

#[derive(Deserialize)]
pub struct Game {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub globals: BTreeMap<String, i64>,
    #[serde(default)]
    pub flags: BTreeMap<String, bool>,
    pub start: String,
    pub rooms: BTreeMap<String, Room>,
    pub sprites: BTreeMap<String, Sprite>,
}

#[derive(Default, Clone, Copy, Deserialize)]
#[serde(default)]
pub struct Input {
    pub up: bool,
    pub down: bool,
    pub left: bool,
    pub right: bool,
    pub a: bool,
    pub b: bool,
    pub x: bool,
    pub menu: bool,
}

impl Input {
    pub fn from_bits(bits: u8) -> Self {
        let on = |index: u32| bits & (1u8 << index) != 0;
        Self {
            up: on(0),
            down: on(1),
            left: on(2),
            right: on(3),
            a: on(4),
            b: on(5),
            x: on(6),
            menu: on(7),
        }
    }
}

#[derive(Serialize)]
pub struct ActorView<'a> {
    pub id: u32,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub angle: f32,
    pub layer: i32,
    pub facing: f32,
    pub image: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<&'a str>,
    pub player: Option<usize>,
    pub health: f32,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RuntimeEvent {
    ScriptError {
        actor: u32,
        event: String,
        message: String,
    },
    Contact {
        began: bool,
        a: u32,
        b: u32,
    },
    Damage {
        source: u32,
        target: u32,
        amount: f32,
    },
}

#[derive(Serialize)]
pub struct Snapshot<'a> {
    pub room: &'a str,
    pub tick: u64,
    pub actors: Vec<ActorView<'a>>,
    pub particles: &'a [crate::particles::Batch],
    pub focus: Option<[f32; 2]>,
    pub dialog: Option<&'a str>,
    pub counters: &'a BTreeMap<String, i32>,
    pub sounds: &'a [String],
    pub events: &'a [RuntimeEvent],
}
