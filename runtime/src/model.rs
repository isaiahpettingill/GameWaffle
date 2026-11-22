use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub type Code = BTreeMap<String, Vec<Vec<Value>>>;

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
    pub mass: Option<f32>,
    pub density: f32,
    pub friction: f32,
    pub elasticity: f32,
    pub category: u16,
    pub mask: u16,
    pub group: i16,
    pub gravity: f32,
    pub fixed: bool,
    pub health: f32,
    pub buoyancy: f32,
    pub drag: f32,
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

#[derive(Clone, Deserialize)]
pub struct Sprite {
    pub clips: BTreeMap<String, Clip>,
    pub code: Code,
    pub physics: Physics,
    pub width: f32,
    pub height: f32,
    pub layer: i32,
    pub animation: String,
    pub team: i32,
    pub projectile: Option<String>,
}

#[derive(Clone, Deserialize)]
pub struct Spawn {
    pub x: f32,
    pub y: f32,
    pub layer: Option<i32>,
    pub player: Option<usize>,
    pub sprite: Option<String>,
    pub clip: Option<Vec<Frame>>,
    pub physics: Option<Physics>,
}

#[derive(Clone, Deserialize)]
pub struct Solid {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub physics: Physics,
}

#[derive(Clone, Deserialize)]
pub struct Room {
    pub cols: usize,
    pub rows: usize,
    pub size: f32,
    pub height: f32,
    pub gravity: f32,
    pub entities: Vec<Spawn>,
    pub solids: Vec<Solid>,
    pub blockers: Vec<usize>,
}

#[derive(Deserialize)]
pub struct Game {
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
    pub player: Option<usize>,
    pub health: f32,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RuntimeEvent {
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
    pub sounds: &'a [String],
    pub events: &'a [RuntimeEvent],
}
