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

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
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

#[derive(Clone, Deserialize, Serialize)]
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

#[derive(Clone, Deserialize, Serialize)]
pub struct Frame {
    pub image: String,
    pub ms: u32,
}

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct Clip {
    #[serde(default, rename = "durationMs")]
    pub duration_ms: u64,
    pub frames: Vec<Frame>,
    pub repeat: u32,
}

impl Clip {
    pub fn duration(&self) -> u64 {
        if self.duration_ms > 0 {
            return self.duration_ms;
        }
        self.frames
            .iter()
            .map(|frame| u64::from(frame.ms.max(1)))
            .sum()
    }

    pub fn image_with_repeat(&self, elapsed: u64, repeat: u32) -> &str {
        let duration = self.duration();
        if duration == 0 {
            return "";
        }
        if repeat > 0 && elapsed / duration >= u64::from(repeat) {
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
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Collider {
    Polygon { points: Vec<[f32; 2]> },
    Circle { center: [f32; 2], radius: f32 },
}

#[derive(Deserialize)]
pub struct Sprite {
    #[serde(default)]
    pub collider: Vec<Collider>,
    #[serde(default, rename = "frameColliders")]
    pub frame_colliders: BTreeMap<String, Vec<Collider>>,
    pub respawn: Option<Respawn>,
    #[serde(default)]
    pub components: Vec<String>,
    #[serde(default, rename = "scriptJump")]
    pub script_jump: bool,
    #[serde(default, rename = "scriptGravity")]
    pub script_gravity: bool,
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

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RespawnMode {
    Never,
    OnEntry,
    Delay,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Respawn {
    pub mode: RespawnMode,
    #[serde(default)]
    pub ticks: u32,
    pub flag: Option<String>,
    #[serde(default = "enabled")]
    pub when: bool,
}

fn enabled() -> bool {
    true
}

#[derive(Clone, Deserialize, Serialize)]
pub struct PendingRespawn {
    pub spawn: Spawn,
    pub due: u64,
}

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct Spawn {
    #[serde(default, rename = "tileMark", skip_serializing_if = "Option::is_none")]
    pub tile_mark: Option<TileMark>,
    #[serde(default, rename = "standardRespawn")]
    pub standard_respawn: bool,
    pub respawn: Option<Respawn>,
    #[serde(default)]
    pub components: Vec<String>,
    #[serde(default, rename = "standardMovement")]
    pub standard_movement: bool,
    #[serde(default)]
    pub persistence: Option<String>,
    #[serde(
        default,
        rename = "rememberRemoval",
        skip_serializing_if = "Option::is_none"
    )]
    pub remember_removal: Option<bool>,
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

#[derive(Clone, Deserialize, Serialize)]
pub struct TileMark {
    pub tile: String,
    pub mode: Mode,
}

#[derive(Clone, Deserialize)]
pub struct Solid {
    #[serde(default)]
    pub border: u8,
    #[serde(default)]
    pub disabled: bool,
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
    #[serde(default, rename = "scriptHost")]
    pub script_host: Option<String>,
    #[serde(default, rename = "layoutKey")]
    pub layout_key: String,
    #[serde(default)]
    pub group_camera: bool,
    #[serde(default, rename = "groupCameraOverride")]
    pub group_camera_override: Option<bool>,
    #[serde(default, rename = "cameraZoom")]
    pub camera_zoom: Option<f32>,
    #[serde(default, rename = "cameraHeight")]
    pub camera_height: Option<u32>,
    #[serde(default, rename = "seamMargins")]
    pub seam_margins: [u32; 4],
    #[serde(default, rename = "tileCells")]
    pub tile_cells: BTreeMap<usize, Vec<TileMark>>,
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
pub struct Item {
    pub label: Option<String>,
    pub consumable: bool,
    pub flag: Option<String>,
}
#[derive(Clone, Deserialize)]
pub struct MenuDefinition {
    pub title: String,
    pub options: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Menu {
    pub id: String,
    pub controls: String,
    pub owner: u32,
    pub title: String,
    pub options: Vec<String>,
    pub selected: usize,
    pub items: Vec<String>,
}
#[derive(Deserialize)]
pub struct Game {
    #[serde(default)]
    pub camera: crate::Camera,
    #[serde(default)]
    pub collections: crate::collections::Schema,
    #[serde(default)]
    pub fonts: std::collections::BTreeSet<String>,
    #[serde(default)]
    pub events: std::collections::BTreeSet<String>,
    #[serde(default)]
    pub minimap: String,
    #[serde(default)]
    pub text: BTreeMap<String, String>,
    #[serde(default)]
    pub menus: BTreeMap<String, MenuDefinition>,
    #[serde(default)]
    pub controls: BTreeMap<String, u8>,
    #[serde(default)]
    pub items: BTreeMap<String, Item>,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub globals: BTreeMap<String, i64>,
    #[serde(default, rename = "initialGlobals")]
    pub initial_globals: BTreeMap<String, String>,
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
    pub fn bits(self) -> u8 {
        (self.up as u8)
            | ((self.down as u8) << 1)
            | ((self.left as u8) << 2)
            | ((self.right as u8) << 3)
            | ((self.a as u8) << 4)
            | ((self.b as u8) << 5)
            | ((self.x as u8) << 6)
            | ((self.menu as u8) << 7)
    }
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
    #[serde(skip_serializing_if = "Option::is_none", rename = "cloneOf")]
    pub clone_source: Option<u32>,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub angle: f32,
    pub flip_y: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shadow: Option<ShadowView>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "healthBar")]
    pub health_bar: Option<HealthBarView>,
    pub layer: i32,
    pub facing: f32,
    pub image: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<&'a str>,
    pub player: Option<usize>,
    pub health: f32,
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ShadowPlacement {
    Behind,
    Ground,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
pub struct SpriteShadow {
    pub placement: ShadowPlacement,
    pub opacity: u8,
}

#[derive(Serialize)]
pub struct ShadowView {
    #[serde(flatten)]
    pub style: SpriteShadow,
    pub rect: [f32; 4],
}

#[derive(Clone, Copy, Deserialize, Serialize)]
pub struct HealthBarStyle {
    pub fill: u32,
    pub track: u32,
}

#[derive(Serialize)]
pub struct HealthBarView {
    #[serde(flatten)]
    pub style: HealthBarStyle,
    pub rect: [f32; 4],
    pub fraction: f32,
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

#[derive(Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct RoomSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shader: Option<crate::RoomShader>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shader_pipeline: Option<Vec<crate::ShaderPass>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoom: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gravity: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_gradient: Option<crate::gradient::Gradient>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_scroll: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub camera_height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y_sort: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub music: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ambience: Option<String>,
}

#[derive(Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct GameSettings {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub postprocessing: Vec<crate::ShaderPass>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display: Option<crate::Camera>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimap: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_camera: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_controller_slot: Option<usize>,
}

impl GameSettings {
    pub(crate) fn is_default(&self) -> bool {
        *self == Self::default()
    }

    pub(crate) fn valid(&self) -> bool {
        crate::shader::valid_pipeline(&self.postprocessing)
            && self.display.is_none_or(crate::Camera::valid)
            && self.minimap.as_deref().is_none_or(|mode| matches!(mode, "off" | "world" | "explored"))
            && self.first_controller_slot.is_none_or(|slot| slot < 2)
    }
}

impl RoomSettings {
    pub(crate) fn valid_color(value: &str) -> bool {
        value.len() == 7
            && value.starts_with('#')
            && value[1..].bytes().all(|c| c.is_ascii_hexdigit())
    }

    pub(crate) fn valid(&self) -> bool {
        self.shader_pipeline.as_deref().is_none_or(crate::shader::valid_pipeline)
            && self.shader.is_none_or(|shader| shader.strength <= 100)
            && self.zoom.is_none_or(|zoom| (0.25..=4.0).contains(&zoom))
            && self
                .gravity
                .is_none_or(|gravity| (-100.0..=100.0).contains(&gravity))
            && self.background.as_deref().is_none_or(Self::valid_color)
            && self.background_gradient.as_ref().is_none_or(crate::gradient::Gradient::valid)
            && self.background_image.as_ref().is_none_or(|path| path.len() <= 256)
            && self.background_scroll.is_none_or(|scroll| (0.0..=1.0).contains(&scroll))
            && self.camera_height.is_none_or(|height| (1..=4096).contains(&height))
            && self.border.is_none_or(|border| matches!(border, 0 | 1 | 3))
            && self
                .music
                .iter()
                .chain(&self.ambience)
                .all(|sound| sound.len() <= 96)
    }

    pub(crate) fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HudAnchor {
    TopLeft,
    TopCenter,
    TopRight,
    CenterLeft,
    Center,
    CenterRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
}

impl HudAnchor {
    pub(crate) fn from_name(value: &str) -> Option<Self> {
        Some(match value {
            "top_left" => Self::TopLeft,
            "top_center" => Self::TopCenter,
            "top_right" => Self::TopRight,
            "center_left" => Self::CenterLeft,
            "center" => Self::Center,
            "center_right" => Self::CenterRight,
            "bottom_left" => Self::BottomLeft,
            "bottom_center" => Self::BottomCenter,
            "bottom_right" => Self::BottomRight,
            _ => return None,
        })
    }

    pub fn position(
        self,
        [width, height]: [u32; 2],
        [text_width, text_height]: [u32; 2],
        [x, y]: [i32; 2],
    ) -> [f32; 2] {
        let ww = width as f32 - text_width as f32;
        let hh = height as f32 - text_height as f32;
        let px = match self {
            Self::TopRight | Self::CenterRight | Self::BottomRight => ww - x as f32,
            Self::TopCenter | Self::Center | Self::BottomCenter => (ww / 2.).floor() + x as f32,
            _ => x as f32,
        };
        let py = match self {
            Self::BottomLeft | Self::BottomCenter | Self::BottomRight => hh - y as f32,
            Self::CenterLeft | Self::Center | Self::CenterRight => (hh / 2.).floor() + y as f32,
            _ => y as f32,
        };
        [px, py]
    }
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct HudText {
    pub value: String,
    pub font: String,
    pub anchor: HudAnchor,
    pub offset: [i32; 2],
}

#[derive(Serialize)]
pub struct Snapshot<'a> {
    #[serde(skip_serializing_if = "<[crate::drawing::Shape]>::is_empty")]
    pub shapes: &'a [crate::drawing::Shape],
    #[serde(rename = "gameSettings", skip_serializing_if = "GameSettings::is_default")]
    pub game_settings: &'a GameSettings,
    #[serde(
        rename = "roomSettings",
        skip_serializing_if = "RoomSettings::is_default"
    )]
    pub room_settings: &'a RoomSettings,
    pub room: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explored: Option<&'a std::collections::BTreeSet<String>>,
    pub tick: u64,
    pub actors: Vec<ActorView<'a>>,
    pub particles: &'a [crate::particles::Batch],
    pub focus: Option<[f32; 2]>,
    pub viewport: [i32; 4],
    pub dialog: Option<&'a str>,
    pub menu: Option<&'a Menu>,
    #[serde(rename = "hudFont", skip_serializing_if = "str::is_empty")]
    pub hud_font: &'a str,
    #[serde(rename = "hudText", skip_serializing_if = "BTreeMap::is_empty")]
    pub hud_text: &'a BTreeMap<String, HudText>,
    pub icons: &'a BTreeMap<String, [i32; 2]>,
    pub bars: &'a BTreeMap<String, [i32; 2]>,
    pub counters: &'a BTreeMap<String, i32>,
    pub sounds: &'a [String],
    pub events: &'a [RuntimeEvent],
}
