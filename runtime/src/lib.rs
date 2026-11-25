mod camera;
pub mod cartridge;
mod collections;
mod frame;
mod jit;
pub mod drawing;
pub mod gradient;
pub mod hd;
mod model;
#[cfg(target_arch = "wasm32")]
mod midi;
mod particles;
mod path;
mod physics;
mod progress;
mod shader;
mod sensing;
#[cfg(target_arch = "wasm32")]
mod shader_import;
mod vm;

pub use camera::{Camera, viewport, viewport_zoom};
pub use model::{ActorView, GameSettings, HudAnchor, HudText, Input, RuntimeEvent, ShadowPlacement, Snapshot, SoundCommand};
pub use shader::{RoomShader, ShaderKind, ShaderPass};

use model::*;
use physics::{Body, Contacts, PPM, Vec2, World};
use std::{
    collections::{BTreeMap, HashSet},
    rc::Rc,
};
use wasm_bindgen::prelude::*;

const STEP: f32 = 1.0 / 60.0;
const MAX_ACTORS: usize = 4096;
const GAME_SCRIPT: &str = "@game";
const MAX_ACTIONS: usize = MAX_ACTORS * 8;
const MAX_BROADCASTS: usize = 128;
const MAX_EVENT_DELIVERIES: usize = MAX_ACTORS * 2;
const RESUME_FUEL: usize = 64 * vm::SLICE;
const EVENT_FUEL: usize = 32 * vm::SLICE;
const TICK_FUEL: usize = 96 * vm::SLICE;
const LATE_FUEL: usize = 32 * vm::SLICE;
const CONTROL_RESUME_FUEL: usize = 8 * vm::SLICE;
const CONTROL_FUEL: usize = 24 * vm::SLICE;
const SCRIPT_FUEL: usize = RESUME_FUEL + EVENT_FUEL + TICK_FUEL + LATE_FUEL + CONTROL_RESUME_FUEL + CONTROL_FUEL;

#[derive(Clone, serde::Deserialize, serde::Serialize)]
struct Broadcast {
    name: String,
    sender: u32,
    #[serde(default)]
    entity: u32,
}

#[derive(Default)]
struct GameProperties {
    globals: vm::Variables,
    flags: vm::Variables,
    collections: collections::Collections,
    player_items: [BTreeMap<String, u32>; 4],
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
struct EventDelivery {
    receiver: u32,
    signal: Broadcast,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Bullet {
    aim: String,
    speed: f32,
    damage: f32,
    owner: u32,
    remaining: u32,
}

struct Actor {
    tile_mark: Option<model::TileMark>,
    hidden: bool,
    created_at: u64,
    origin: Option<Spawn>,
    standard_movement: bool,
    tick_gravity: Option<f32>,
    persistence: Option<String>,
    last_spawn: u32,
    last_clone: u32,
    clone_source: Option<u32>,
    clone_pending: bool,
    clone_deleting: bool,
    answer: i64,
    item_count: u32,
    menu_choice: usize,
    menu_item: String,
    menu_id: String,
    dormant: bool,
    always_active: Option<bool>,
    emitter: Option<particles::Emitter>,
    id: u32,
    name: Option<String>,
    sprite: Option<String>,
    tile: Option<Clip>,
    physics: Physics,
    body: Option<Body>,
    collider_frame: Option<String>,
    collider_bounds: [f32; 4],
    spawn: Vec2,
    p: Vec2,
    v: Vec2,
    width: f32,
    height: f32,
    facing: f32,
    visual_flip_x: bool,
    visual_flip_y: bool,
    visual_rotation: f32,
    shadow: Option<SpriteShadow>,
    health_bar: Option<HealthBarStyle>,
    aim: Vec2,
    player: Option<usize>,
    team: i32,
    layer: i32,
    health: f32,
    animation: String,
    animation_start: u64,
    animation_once: bool,
    animation_finished: bool,
    components: Vec<String>,
    bullet: Option<Bullet>,
    variables: vm::Variables,
    scripts: BTreeMap<String, vm::Machine>,
    tick_script: Option<vm::Machine>,
}

impl Actor {
    fn active(&self) -> bool {
        !self.dormant && !self.clone_pending
    }

    fn face(&mut self, v: Vec2, top_down: bool) {
        if v.x.abs() > 0.05 {
            self.facing = v.x.signum();
        }
        if top_down && v.length_squared() > 0.0025 {
            self.aim = unit(v);
        } else if !top_down {
            self.aim = Vec2::new(self.facing, 0.0);
        }
    }

    fn velocity(&mut self, world: &mut World, velocity: Vec2) {
        self.v = velocity;
        if let Some(body) = self.body {
            world.body_mut(body).set_linvel(velocity, true);
        }
    }
    fn teleport(&mut self, world: &mut World, p: Vec2) {
        self.p = p;
        self.velocity(world, Vec2::ZERO);
        if let Some(body) = self.body {
            world.transform(body, p, 0.0);
        }
    }
    fn active_solid(&self) -> bool {
        matches!(
            self.physics.mode,
            Mode::Static | Mode::Dynamic | Mode::Kinematic | Mode::OneWay | Mode::Breakable
        )
    }
}

enum ScriptPayload {
    Numbers([i64; 2]),
    UsedItem(String),
}

enum Action {
    Damage {
        source: u32,
        target: u32,
        amount: Option<f32>,
    },
    Heal(u32, f32),
    Remove(u32),
    Used(u32, String),
    Fire(u32, Option<String>, String, f32, f32),
    Instance(u32, Spawn),
    Broadcast(Broadcast),
}

#[wasm_bindgen]
pub struct Runtime {
    particles: particles::Particles,
    game: Game,
    room: String,
    respawns: BTreeMap<String, Vec<PendingRespawn>>,
    visited: std::collections::BTreeSet<String>,
    world: World,
    contacts: Contacts,
    actors: BTreeMap<u32, Actor>,
    entity_ids: std::collections::BTreeSet<u32>,
    animated_colliders: std::collections::BTreeSet<u32>,
    named_entities: BTreeMap<String, u32>,
    entry_removed: HashSet<String>,
    static_ids: HashSet<u32>,
    border_walls: Vec<(physics::Body, u8, bool)>,
    tick: u64,
    next: u32,
    inputs: [Input; 4],
    prior_buttons: [u8; 4],
    blocked: HashSet<usize>,
    gates: Vec<(Spawn, Option<u32>)>,
    gates_dirty: bool,
    sounds: Vec<SoundCommand>,
    events: Vec<RuntimeEvent>,
    transition: Option<String>,
    pending_start: Vec<u32>,
    broadcasts: std::collections::VecDeque<Broadcast>,
    event_deliveries: std::collections::VecDeque<EventDelivery>,
    restored: bool,
    pending_instances: Vec<(u32, Spawn)>,
    programs: BTreeMap<String, vm::Programs>,
    timer_schedules: BTreeMap<String, Vec<(Rc<str>, u64, bool)>>,
    game_properties: GameProperties,
    seed: u32,
    rng: u32,
    camera_actor: Option<u32>,
    group_camera: bool,
    camera_slot: usize,
    control_events: Vec<(u8, Rc<str>, Rc<str>)>,
    memory: progress::WorldMemory,
    removed: BTreeMap<String, std::collections::BTreeSet<String>>,
    camera_point: Option<[f32; 2]>,
    room_settings: RoomSettings,
    game_settings: GameSettings,
    connected_players: u8,
    reported_players: u8,
    startup_gamepads: Option<u8>,
    shapes: Vec<drawing::Shape>,
    room_script_id: Option<u32>,
    view_size: [u32; 2],
    camera_window: [u32; 2],
    camera_seams: bool,
    tile_entities: std::collections::BTreeSet<u32>,
    checkpoint: Option<Vec<u8>>,
    checkpoint_requested: bool,
    retry: bool,
    inventory: BTreeMap<String, u32>,
    dialog: std::collections::VecDeque<(String, Option<u32>)>,
    menu: Option<model::Menu>,
    hud_font: String,
    hud_text: BTreeMap<String, HudText>,
    hud_sprites: BTreeMap<String, LayerSprite>,
    background_sprites: BTreeMap<String, LayerSprite>,
    icons: BTreeMap<String, [i32; 2]>,
    bars: BTreeMap<String, [i32; 2]>,
    counters: BTreeMap<String, i32>,
    script_fuel: usize,
    control_fuel: usize,
    resume_cursor: Option<(u32, String)>,
    tick_cursor: Option<u32>,
    jit_enabled: bool,
    jit_cache: jit::Cache,
    jit_runs: u32,
    debug: bool,
}

#[wasm_bindgen]
impl Runtime {
    #[wasm_bindgen(constructor)]
    pub fn new(json: &str) -> Result<Runtime, String> {
        let game: Game = serde_json::from_str(json).map_err(|error| error.to_string())?;
        Self::from_game(game, None)
    }

    /// Load a GameWaffle cartridge, optionally starting at a different room.
    pub fn from_cartridge(bytes: &[u8], room: Option<String>) -> Result<Runtime, String> {
        Self::from_cartridge_with_controllers(bytes, room, 1, None)
    }

    /// Start with the host's current controller state. Local hosts supply a
    /// gamepad count. Hosts with fixed ports supply an already assigned mask.
    pub fn from_cartridge_with_controllers(
        bytes: &[u8], room: Option<String>, connected: u8, gamepads: Option<u8>,
    ) -> Result<Runtime, String> {
        Self::from_cartridge_with_view(bytes, room, connected, gamepads, 640, 480, false)
    }

    /// Set the initial view before Game startup handlers run. A zero-sized
    /// window uses the native console size of 320 by 240 logical pixels.
    pub fn from_cartridge_with_view(
        bytes: &[u8], room: Option<String>, connected: u8, gamepads: Option<u8>,
        width: u32, height: u32, seams: bool,
    ) -> Result<Runtime, String> {
        if bytes.len() < 111 || bytes.len() > cartridge::MAX_CARTRIDGE {
            return Err("Invalid cartridge size".into());
        }
        let (bytes, signature) = bytes.split_at(bytes.len() - cartridge::SIGNATURE_SIZE);
        let key = ed25519_dalek::VerifyingKey::from_bytes(signature[..32].try_into().unwrap())
            .map_err(|_| "Invalid cartridge signing key")?;
        key.verify_strict(
            bytes,
            &ed25519_dalek::Signature::from_bytes(signature[32..].try_into().unwrap()),
        )
        .map_err(|_| "Invalid cartridge signature")?;
        let data = cartridge::Sections::read(bytes)?.simulation()?;
        let game: Game = ciborium::from_reader(data.as_slice()).map_err(|error| error.to_string())?;
        Self::from_game_with_controllers(game, room, connected, gamepads, [width, height], seams)
    }

    pub fn enable_debug(&mut self) {
        self.debug = true;
    }
    pub fn inspect_actor(&self, id: u32) -> Result<Vec<u8>, String> {
        frame::inspect(self, id)
    }
    pub fn save_id(&self) -> String {
        self.game.id.clone()
    }
    pub fn set_view_size(&mut self, w: u32, h: u32) {
        self.view_size = [w.clamp(64, 512), h.clamp(64, 512)];
    }
    pub fn set_camera_window(&mut self, width: u32, height: u32, seams: bool) {
        self.camera_window = [width.max(1), height.max(1)];
        self.camera_seams = seams;
    }
    pub fn advance_buttons(&mut self, buttons: u32, ticks: u8) -> Result<(), String> {
        let inputs = std::array::from_fn(|index| {
            Input::from_bits((buttons >> (index * 8)) as u8)
        });
        for _ in 0..ticks {
            self.step_inputs(inputs)?;
        }
        Ok(())
    }

    pub fn step_buttons(&mut self, buttons: u32) -> Result<Vec<u8>, String> {
        self.advance_buttons(buttons, 1)?;
        self.snapshot()
    }

    pub fn step(&mut self, input_json: &str) -> Result<Vec<u8>, String> {
        let inputs: [Input; 4] = serde_json::from_str(input_json).map_err(|err| err.to_string())?;
        self.step_inputs(inputs)?;
        self.snapshot()
    }

    pub fn snapshot(&self) -> Result<Vec<u8>, String> {
        let view = self.view();
        let mut bytes = Vec::with_capacity(256 + 64 * view.actors.len());
        ciborium::into_writer(&view, &mut bytes).map_err(|error| error.to_string())?;
        Ok(bytes)
    }

    pub fn reset(&mut self) -> Result<(), String> {
        self.inputs = [Input::default(); 4];
        self.tick = 0;
        self.sounds.clear();
        self.hud_sprites.clear();
        self.transition = None;
        self.game_properties.player_items = Default::default();
        self.checkpoint = None;
        self.checkpoint_requested = false;
        self.retry = false;
        self.inventory.clear();
        self.removed.clear();
        self.memory.clear();
        self.respawns.clear();
        self.visited.clear();
        self.actors.clear();
        self.entity_ids.clear();
        self.animated_colliders.clear();
        self.named_entities.clear();
        self.entry_removed.clear();
        self.set_seed(self.seed.wrapping_mul(1664525).wrapping_add(1013904223));
        self.game_settings = GameSettings::default();
        self.reported_players = 1;
        self.reset_variables()?;
        self.load(&self.game.start.clone())?;
        self.game_startup()
    }

    pub fn set_jit_enabled(&mut self, enabled: bool) {
        self.jit_enabled = enabled && jit::SUPPORTED;
    }

    pub fn jit_executions(&self) -> u32 {
        self.jit_runs
    }

    pub fn set_connected_players(&mut self, mask: u8) {
        self.connected_players = mask & 15;
    }

    pub fn first_controller_slot(&self) -> usize {
        self.game_settings.first_controller_slot.unwrap_or(0)
    }
}

impl Runtime {
    pub fn game_settings(&self) -> &GameSettings { &self.game_settings }

    pub fn connected_player_mask(&self) -> u8 {
        self.connected_players
    }

    fn next_random_u32(rng: &mut u32) -> u32 {
        *rng ^= *rng << 13;
        *rng ^= *rng >> 17;
        *rng ^= *rng << 5;
        *rng
    }

    fn camera_viewport(&self) -> [i32; 4] {
        let room = &self.game.rooms[&self.room];
        let full = [(room.cols as f32 * room.size) as u32, room.height as u32];
        let height = self.room_settings.camera_height.or(room.camera_height).unwrap_or(full[1]);
        let limits = [full[0].max(1), height.clamp(1, full[1].max(1))];
        let camera = self.game_settings.display.unwrap_or(self.game.camera);
        let window = if self.camera_window == [0, 0] {
            [320 * camera.zoom.max(1), 240 * camera.zoom.max(1)]
        } else {
            self.camera_window
        };
        let size = camera.view_size(window, self.room_settings.zoom);
        let [w,h] = [size[0].min(limits[0]), size[1].min(limits[1])];
        let focus = self.focus().or_else(|| self.actors.values().find(|actor| !actor.hidden && actor.player == Some(0)).map(|actor| [actor.p.x, actor.p.y]))
            .unwrap_or([full[0] as f32 / 2., full[1] as f32 / 2.]);
        let margins = if self.camera_seams { room.seam_margins } else { [0; 4] };
        let axis = |center: f32, size: u32, limit: u32, before: u32, after: u32| {
            let half = size / 2;
            ((f64::from(center) + 0.5).floor() as i32).saturating_sub(half as i32)
                .clamp(-(half.min(before) as i32), (limit - size + (size - half).min(after)) as i32)
        };
        [axis(focus[0], w, limits[0], margins[0], margins[1]),
         axis(focus[1], h, limits[1], margins[2], if limits[1] == full[1] { margins[3] } else { 0 }), w as i32, h as i32]
    }

    fn focus(&self) -> Option<[f32; 2]> {
        if self.group_camera {
            let mut players = self.actors.values().filter(|actor| {
                !actor.hidden && actor.player.is_some_and(|slot| self.connected_players & (1 << slot) != 0)
            });
            if let Some(first) = players.next() {
                let (mut left, mut right, mut top, mut bottom) =
                    (first.p.x, first.p.x, first.p.y, first.p.y);
                for a in players {
                    left = left.min(a.p.x);
                    right = right.max(a.p.x);
                    top = top.min(a.p.y);
                    bottom = bottom.max(a.p.y);
                }
                return Some([(left + right) * 0.5, (top + bottom) * 0.5]);
            }
        }
        self.camera_point.or_else(|| {
            self.camera_actor
                .and_then(|id| self.actors.get(&id))
                .or_else(|| {
                    self.actors
                        .values()
                        .find(|a| !a.hidden && a.player == Some(self.camera_slot)
                            && (self.camera_slot != 0 || self.connected_players & 1 != 0))
                        .or_else(|| self.actors.values().find(|a| !a.hidden
                            && a.player.is_some_and(|slot| self.connected_players & (1 << slot) != 0)))
                        .or_else(|| self.actors.values().find(|a| !a.hidden && a.player == Some(self.camera_slot)))
                })
                .map(|a| [a.p.x, a.p.y])
        })
    }
    pub fn view(&self) -> Snapshot<'_> {
        let top_down = self.game.rooms[&self.room].is_top_down();
        let actors = self
            .actors
            .values()
            .filter(|actor| {
                !actor.hidden && !self.static_ids.contains(&actor.id) && Some(actor.id) != self.room_script_id && actor.id != 0
            })
            .map(|actor| {
                let elapsed = (self.tick - actor.animation_start) * 1000 / 60;
                let image = actor
                    .tile
                    .as_ref()
                    .or_else(|| {
                        let sprite = self.game.sprites.get(actor.sprite.as_ref()?)?;
                        sprite
                            .clips
                            .get(&actor.animation)
                            .or_else(|| sprite.clips.get("default"))
                    })
                    .map_or("", |clip| {
                        clip.image_with_repeat(
                            elapsed,
                            if actor.animation_once { 1 } else { clip.repeat },
                        )
                    });
                ActorView {
                    id: actor.id,
                    clone_source: actor.clone_source,
                    name: actor.name.as_deref(),
                    x: actor.p.x,
                    y: actor.p.y,
                    width: actor.width,
                    height: actor.height,
                    angle: actor.visual_rotation
                        + actor
                            .body
                            .map_or(0.0, |body| self.world.body(body).rotation().angle()),
                    layer: actor.layer,
                    facing: if actor.visual_flip_x {
                        -actor.facing
                    } else {
                        actor.facing
                    },
                    flip_y: actor.visual_flip_y,
                    shadow: actor.shadow.and_then(|style| {
                        let x = actor.p.x.round();
                        let y = actor.p.y.round();
                        let half_width = actor.width / 2.0;
                        let half_height = actor.height / 2.0;
                        let rect = match style.placement {
                            ShadowPlacement::Behind => [
                                x - half_width + 2.0,
                                y - half_height + 3.0,
                                actor.width,
                                actor.height,
                            ],
                            ShadowPlacement::Ground => {
                                let ground = if top_down {
                                    y + half_height
                                } else {
                                    self.world.ground_below(actor.p / PPM, 8.0, actor.id)? * PPM
                                };
                                let width = (actor.width * 0.7).clamp(4.0, 128.0);
                                let height = (width * 0.28).clamp(2.0, 18.0);
                                [
                                    x - width / 2.0,
                                    ground.round() - height / 2.0,
                                    width,
                                    height,
                                ]
                            }
                        };
                        Some(ShadowView { style, rect })
                    }),
                    health_bar: actor.health_bar.map(|style| {
                        let width = actor.width.round().clamp(12.0, 64.0);
                        HealthBarView {
                            style,
                            rect: [
                                (actor.p.x - width / 2.0).round(),
                                (actor.p.y - actor.height / 2.0).floor() - 6.0,
                                width,
                                3.0,
                            ],
                            fraction: (actor.health / actor.physics.health).clamp(0.0, 1.0),
                        }
                    }),
                    image,
                    player: actor.player,
                    health: actor.health,
                }
            })
            .collect();
        Snapshot {
            room_settings: &self.room_settings,
            game_settings: &self.game_settings,
            shapes: &self.shapes,
            particles: self.particles.visible_batches(),
            room: &self.room,
            explored: (self.game_settings.minimap.as_deref().unwrap_or(&self.game.minimap) == "explored").then_some(&self.visited),
            tick: self.tick,
            actors,
            focus: self.focus(),
            viewport: self.camera_viewport(),
            dialog: self.dialog.front().map(|d| d.0.as_str()),
            menu: self.menu.as_ref(),
            hud_font: &self.hud_font,
            hud_text: &self.hud_text,
            hud_sprites: self.layer_sprites(&self.hud_sprites),
            background_sprites: self.layer_sprites(&self.background_sprites),
            icons: &self.icons,
            bars: &self.bars,
            counters: &self.counters,
            sounds: &self.sounds,
            events: &self.events,
        }
    }

    fn layer_sprites<'a>(&'a self, entries: &'a BTreeMap<String, LayerSprite>) -> BTreeMap<&'a str, LayerSpriteView<'a>> {
        entries.iter().filter_map(|(label, entry)| {
            let sprite = self.game.sprites.get(&entry.sprite)?;
            let clip = sprite.clips.get(&sprite.animation).or_else(|| sprite.clips.get("default"))?;
            let elapsed = self.tick.saturating_sub(entry.started).saturating_mul(1000) / 60;
            Some((label.as_str(), LayerSpriteView {
                image: clip.image_with_repeat(elapsed, clip.repeat),
                anchor: entry.anchor,
                offset: entry.offset,
                scale: entry.scale,
                parallax: entry.parallax,
            }))
        }).collect()
    }

    pub fn room_settings(&self) -> &RoomSettings {
        &self.room_settings
    }

    fn apply_room_border(&mut self) {
        for &(body, edge, initial) in &self.border_walls {
            let enabled = self.room_settings.border.map_or(initial, |mask| mask & edge != 0);
            self.world.set_body_enabled(body, enabled);
        }
    }

    fn room_gravity(&self) -> f32 {
        self.room_settings
            .gravity
            .unwrap_or(self.game.rooms[&self.room].gravity)
    }

    fn script_mass(&self, actor: &Actor) -> f64 {
        actor.body.filter(|_| actor.physics.mode == Mode::Dynamic).map_or(0.0, |body| {
            f64::from(self.world.body(body).mass()) * self.game.mass_scale()
        })
    }

    fn apply_room_gravity(&mut self) {
        self.world.set_gravity(self.room_gravity());
    }

    pub fn room(&self) -> &str {
        &self.room
    }

    pub fn sounds(&self) -> &[SoundCommand] {
        &self.sounds
    }

    fn stop_sound(&mut self, entity: u32) {
        if entity != 0 && self.sounds.len() < 128 {
            self.sounds.push(SoundCommand::Stop { entity });
        }
    }

    pub fn events(&self) -> &[RuntimeEvent] {
        &self.events
    }

    pub fn scripted_global(&self, name: &str) -> String {
        self.game_properties.globals
            .get(name)
            .map_or_else(|| "0".into(), ToString::to_string)
    }

    pub fn flag(&self, name: &str) -> bool {
        self.game_properties.flags.contains_key(name)
    }

    pub fn local(&self, actor: u32, name: &str) -> Option<String> {
        Some(
            self.actors
                .get(&actor)?
                .variables
                .get(name)
                .map_or_else(|| "0".into(), ToString::to_string),
        )
    }

    fn reset_variables(&mut self) -> Result<(), String> {
        self.game_properties.collections = collections::Collections::new(&self.game.collections)?;
        self.game_properties.globals = self
            .game
            .globals
            .iter()
            .filter(|(_, value)| **value != 0)
            .map(|(key, value)| (Rc::from(key.as_str()), (*value).into()))
            .collect();
        self.game_properties.flags = self
            .game
            .flags
            .iter()
            .filter(|(_, value)| **value)
            .map(|(key, _)| (Rc::from(key.as_str()), 1.into()))
            .collect();
        self.game_properties.globals.extend(progress::variables(&self.game.initial_globals)?);
        Ok(())
    }

    fn from_game(game: Game, room: Option<String>) -> Result<Self, String> {
        Self::from_game_with_controllers(game, room, 1, None, [640, 480], false)
    }

    fn from_game_with_controllers(
        mut game: Game, room: Option<String>, connected: u8, gamepads: Option<u8>,
        camera_window: [u32; 2], camera_seams: bool,
    ) -> Result<Self, String> {
        game.collections.validate()?;
        if !game.rooms.contains_key(&game.start) {
            return Err("Unknown starting room".into());
        }
        for room in game.rooms.values() {
            if room.cols == 0
                || room.rows == 0
                || room.cols > 1024
                || room.rows > 1024
                || room.size <= 0.0
                || room.entities.len() > MAX_ACTORS
                || room.solids.len() > 32768
            {
                return Err("Invalid room dimensions or actor count".into());
            }
        }
        if game.controls.len() > 72 {
            return Err("Too many input actions".into());
        }
        let control_events = game
            .controls
            .iter()
            .map(|(name, &mask)| {
                (
                    mask,
                    Rc::from(format!("pressed.{name}")),
                    Rc::from(format!("released.{name}")),
                )
            })
            .collect();
        let mut programs: BTreeMap<String, vm::Programs> = BTreeMap::new();
        for (id, sprite) in &mut game.sprites {
            if !physics::valid_colliders(&sprite.collider)
                || sprite
                    .frame_colliders
                    .values()
                    .any(|shapes| !physics::valid_colliders(shapes))
            {
                return Err(format!("Invalid sprite collider: {id}"));
            }
            let events = std::mem::take(&mut sprite.program)
                .into_iter()
                .map(|(event, encoded)| {
                    let program = vm::Program::decode(encoded, &game.controls)
                        .map_err(|error| format!("{id}/{event}: {error}"))?;
                    Ok::<_, String>((event, Rc::new(program)))
                })
                .collect::<Result<_, _>>()?;
            programs.insert(id.clone(), events);
        }
        let timer_schedules = programs.iter().filter_map(|(name, events)| {
            let timers: Vec<_> = events.keys().filter_map(|event| {
                let (kind, interval) = event.split_once('.')?;
                let interval: u64 = interval.parse().ok()?;
                (matches!(kind, "after" | "every") && (1..=1296000).contains(&interval))
                    .then(|| (Rc::from(event.as_str()), interval, kind == "every"))
            }).collect();
            (!timers.is_empty()).then(|| (name.clone(),timers))
        }).collect();
        let start = room.unwrap_or_else(|| game.start.clone());
        let world = World::new(0.0, game.pixel_units);
        let mut rt = Runtime {
            particles: Default::default(),
            game,
            room: String::new(),
            respawns: Default::default(),
            visited: Default::default(),
            world,
            contacts: Contacts::default(),
            actors: BTreeMap::new(),
            entity_ids: Default::default(),
            animated_colliders: Default::default(),
            named_entities: Default::default(),
            entry_removed: Default::default(),
            static_ids: HashSet::new(),
            border_walls: Vec::with_capacity(4),
            tick: 0,
            next: 1,
            inputs: [Input::default(); 4],
            prior_buttons: [0; 4],
            blocked: HashSet::new(),
            gates: Vec::new(),
            gates_dirty: false,
            sounds: Vec::new(),
            events: Vec::new(),
            transition: None,
            pending_start: Vec::new(),
            broadcasts: Default::default(),
            event_deliveries: Default::default(),
            restored: false,
            pending_instances: Vec::new(),
            programs,
            timer_schedules,
            game_properties: GameProperties::default(),
            seed: 1,
            rng: 1,
            camera_actor: None,
            group_camera: false,
            camera_slot: 0,
            control_events,
            memory: Default::default(),
            removed: Default::default(),
            camera_point: None,
            room_settings: RoomSettings::default(),
            room_script_id: None,
            game_settings: GameSettings::default(),
            connected_players: connected & 15,
            reported_players: 0,
            startup_gamepads: gamepads.map(|count| count.min(4)),
            shapes: Vec::new(),
            view_size: [512, 512],
            camera_window,
            camera_seams,
            tile_entities: Default::default(),
            checkpoint: None,
            checkpoint_requested: false,
            retry: false,
            inventory: Default::default(),
            dialog: Default::default(),
            menu: None,
            hud_font: String::new(),
            hud_text: Default::default(),
            hud_sprites: Default::default(),
            background_sprites: Default::default(),
            icons: Default::default(),
            bars: Default::default(),
            counters: Default::default(),
            script_fuel: 0,
            control_fuel: 0,
            resume_cursor: None,
            tick_cursor: None,
            jit_enabled: jit::SUPPORTED,
            jit_cache: jit::Cache::default(),
            jit_runs: 0,
            debug: false,
        };
        rt.reset_variables()?;
        rt.load(&start)?;
        rt.update_startup_controllers();
        rt.game_startup()?;
        rt.startup_gamepads = None;
        Ok(rt)
    }

    fn update_startup_controllers(&mut self) {
        if let Some(count) = self.startup_gamepads {
            let pressed = ((1u8 << count) - 1) << self.first_controller_slot();
            self.set_connected_players(pressed | 1);
        }
    }

    fn game_startup(&mut self) -> Result<(), String> {
        self.jit_cache.begin_tick();
        self.script_fuel = SCRIPT_FUEL;
        self.control_fuel = 0;
        let mut actions = Vec::new();
        let inputs = self.inputs;
        self.events.clear();
        self.run(0, "init", &inputs, &mut actions);
        self.run(0, "game_startup", &inputs, &mut actions);
        for failure in &self.events {
            if let RuntimeEvent::ScriptError {event, message, ..} = failure {
                return Err(format!("Game script {event}: {message}"));
            }
        }
        self.apply(&mut actions, &inputs);
        if let Some(room) = self.transition.take() {
            self.load(&room)?;
        }
        Ok(())
    }

    fn load(&mut self, id: &str) -> Result<(), String> {
        let room = self.game.rooms.get(id).ok_or("Unknown room")?.clone();
        self.sounds.retain(|command| !matches!(command, SoundCommand::Play { .. }));
        if !self.room.is_empty() {
            self.sounds.push(SoundCommand::RoomChanged);
        }
        let game_actor = self.actors.remove(&0);
        if !self.actors.is_empty() {
            let state = self.room_memory();
            self.memory.insert(self.room.clone(), state);
        }
        self.actors.clear();
        self.resume_cursor = None;
        self.tick_cursor = None;
        self.tile_entities.clear();
        self.entity_ids.clear();
        self.animated_colliders.clear();
        self.named_entities.clear();
        self.entry_removed.clear();
        self.particles.clear();
        self.shapes.clear();
        self.world = World::new(room.gravity, self.game.pixel_units);
        self.contacts = Contacts::default();
        self.room = id.into();
        self.visited.insert(self.room.clone());
        self.camera_actor = None;
        self.group_camera = room.group_camera_override.or(self.game_settings.group_camera).unwrap_or(room.group_camera);
        self.camera_slot = 0;
        self.camera_point = None;
        self.room_settings = RoomSettings {
            zoom: room.camera_zoom,
            ..RoomSettings::default()
        };
        self.room_script_id = None;
        self.blocked = room.blockers.iter().copied().collect();
        self.static_ids.clear();
        self.border_walls.clear();
        self.dialog.clear();
        self.menu = None;
        self.counters.clear();
        self.hud_font.clear();
        self.hud_text.clear();
        self.background_sprites.clear();
        self.icons.clear();
        self.bars.clear();
        self.restored = false;
        self.pending_start.clear();
        self.broadcasts.clear();
        self.event_deliveries.clear();
        self.pending_instances.clear();
        self.events.clear();
        self.next = 1;
        if let Some(mut actor) = game_actor {
            actor.last_spawn = 0;
            actor.last_clone = 0;
            self.actors.insert(0, actor);
        } else if self.game.sprites.contains_key(GAME_SCRIPT) {
            self.next = 0;
            self.add(Some(GAME_SCRIPT.into()), None, Physics::default(), Vec2::ZERO, (1., 1.), (0, None));
        }
        for solid in room.solids {
            let id = self.add(
                None,
                None,
                solid.physics,
                Vec2::new(solid.x, solid.y),
                (solid.width, solid.height),
                (0, None),
            );
            self.static_ids.insert(id);
            if solid.border != 0 {
                if let Some(body) = self.actors[&id].body {
                    self.border_walls.push((body, solid.border, !solid.disabled));
                    if solid.disabled {
                        self.world.set_body_enabled(body, false);
                    }
                }
            }
        }
        self.gates.clear();
        for spawn in room.entities {
            if !spawn.conditions.is_empty() {
                self.gates.push((spawn, None));
            } else if !self.was_removed(&spawn) && !self.waiting_respawn(&spawn) {
                self.add_scene_actor(spawn, room.size)?;
            }
        }
        self.gates_dirty = true;
        self.sync_gates()?;
        if let Some(host) = room.script_host {
            if !self.game.sprites.contains_key(&host) {
                return Err("Room script is missing".into());
            }
            self.add(
                Some(host),
                None,
                Physics::default(),
                Vec2::ZERO,
                (1., 1.),
                (0, None),
            );
        }
        Ok(())
    }

    fn was_removed(&self, spawn: &Spawn) -> bool {
        let Some(set) = self.removed.get(&self.room) else {
            return false;
        };
        spawn
            .persistence
            .as_ref()
            .is_some_and(|key| set.contains(key))
            || spawn
                .name
                .as_ref()
                .is_some_and(|name| set.contains(&format!("entity/{name}")))
    }

    fn waiting_respawn(&self, spawn: &Spawn) -> bool {
        spawn.name.as_ref().is_some_and(|name| {
            self.respawns.get(&self.room).is_some_and(|queue| {
                queue
                    .iter()
                    .any(|entry| entry.spawn.name.as_ref() == Some(name))
            })
        })
    }

    fn process_respawns(&mut self) -> Result<(), String> {
        let Some(queue) = self.respawns.remove(&self.room) else {
            return Ok(());
        };
        let size = self.game.rooms[&self.room].size;
        let mut waiting = Vec::new();
        for entry in queue {
            let allowed = entry.spawn.respawn.as_ref().is_some_and(|rule| {
                rule.flag
                    .as_ref()
                    .is_none_or(|flag| self.flag(flag) == rule.when)
            }) && entry
                .spawn
                .conditions
                .iter()
                .all(|(flag, when)| self.flag(flag) == *when);
            if self.tick < entry.due
                || !allowed
                || self.actors.len() >= MAX_ACTORS + self.static_ids.len()
            {
                waiting.push(entry);
                continue;
            }
            let id = self.next;
            let name = entry.spawn.name.clone();
            self.add_scene_actor(entry.spawn, size)?;
            if let Some(name) = name {
                for (spawn, current) in &mut self.gates {
                    if spawn.name.as_ref() == Some(&name) {
                        *current = Some(id);
                    }
                }
            }
        }
        if !waiting.is_empty() {
            self.respawns.insert(self.room.clone(), waiting);
        }
        Ok(())
    }

    fn sync_gates(&mut self) -> Result<(), String> {
        if !std::mem::take(&mut self.gates_dirty) || self.gates.is_empty() {
            return Ok(());
        }
        let mut gates = std::mem::take(&mut self.gates);
        let room = &self.game.rooms[&self.room];
        let size = room.size;
        self.blocked = room.blockers.iter().copied().collect();
        for (spawn, id) in &mut gates {
            if !self.was_removed(spawn)
                && !spawn
                    .name
                    .as_ref()
                    .is_some_and(|name| self.entry_removed.contains(name))
                && !self.waiting_respawn(spawn)
                && spawn
                    .conditions
                    .iter()
                    .all(|(flag, on)| self.flag(flag) == *on)
            {
                if let Some(cell) = spawn.blocker {
                    self.blocked.insert(cell);
                }
                if id.is_none() {
                    *id = Some(self.next);
                    self.add_scene_actor(spawn.clone(), size)?;
                }
            } else if let Some(actor) = id.take().and_then(|id| self.remove_entity_record(id)) {
                if let Some(body) = actor.body {
                    self.world.remove(body);
                }
            }
        }
        self.gates = gates;
        Ok(())
    }

    fn add_scene_actor(&mut self, mut spawn: Spawn, size: f32) -> Result<(), String> {
        let definition = match spawn.sprite.as_ref() {
            Some(key) => Some(self.game.sprites.get(key).ok_or("Unknown sprite in room")?),
            None => None,
        };
        if spawn.respawn.is_none() && !spawn.standard_respawn {
            spawn.respawn = definition.and_then(|sprite| sprite.respawn.clone());
        }
        let origin = spawn.sprite.is_some().then(|| spawn.clone());
        let config = spawn.physics.unwrap_or_else(|| {
            definition.map_or_else(Physics::default, |sprite| sprite.physics.clone())
        });
        let size = definition.map_or((size, size), |sprite| (sprite.width, sprite.height));
        let layer = spawn
            .layer
            .unwrap_or_else(|| definition.map_or(0, |sprite| sprite.layer));
        let clip = spawn.clip.map(|frames| Clip {
            duration_ms: frames.iter().map(|frame| u64::from(frame.ms.max(1))).sum(),
            frames,
            repeat: 0,
        });
        let id = self.add(
            spawn.sprite,
            clip,
            config,
            Vec2::new(spawn.x, spawn.y),
            size,
            (layer, spawn.player.filter(|slot| *slot < 4)),
        );
        let actor = self.actors.get_mut(&id).unwrap();
        actor.origin = origin;
        actor.tile_mark = spawn.tile_mark;
        if actor.tile_mark.is_some() {
            self.tile_entities.insert(id);
        }
        actor.standard_movement = spawn.standard_movement;
        if let Some(name) = &spawn.name {
            self.named_entities.insert(name.clone(), id);
        }
        actor.name = spawn.name;
        actor.components.extend(spawn.components);
        actor.persistence = spawn.persistence;
        if let Some(animation) = spawn.animation {
            actor.animation = animation;
        }
        if let Some(state) = actor
            .persistence
            .as_ref()
            .and_then(|key| self.memory.get(&self.room)?.get(key))
        {
            actor.teleport(&mut self.world, Vec2::new(state.xy[0], state.xy[1]));
            actor.velocity(&mut self.world, Vec2::new(state.motion[0], state.motion[1]));
            actor.health = state.health;
            actor.variables = progress::variables(&state.locals)?;
            actor.animation = state.animation.clone();
            actor.facing = state.facing;
        } else if spawn.flip_x == Some(true) {
            actor.face(Vec2::new(-1.0, 0.0), false);
        }
        Ok(())
    }

    fn add(
        &mut self,
        sprite: Option<String>,
        tile: Option<Clip>,
        physics: Physics,
        p: Vec2,
        (width, height): (f32, f32),
        (layer, player): (i32, Option<usize>),
    ) -> u32 {
        let id = self.next;
        self.next += 1;
        let definition = sprite.as_ref().and_then(|key| self.game.sprites.get(key));
        let team = definition.map_or(0, |s| s.team);
        let animation = definition.map_or_else(|| "default".into(), |s| s.animation.clone());
        let colliders = definition.map_or(&[][..], |sprite| sprite.collider.as_slice());
        let collider_bounds = physics::bounds(colliders, width, height);
        let body = self.world.create(id, p, width, height, &physics, colliders);
        if body.is_some() && definition.is_some_and(|sprite| !sprite.frame_colliders.is_empty()) {
            self.animated_colliders.insert(id);
        }
        let health = physics.health;
        if let Some(sprite) = sprite.as_ref().filter(|_| id != 0) {
            if self.game.rooms[&self.room].script_host.as_ref() == Some(sprite) {
                self.room_script_id = Some(id);
            } else {
                self.entity_ids.insert(id);
            }
            self.pending_start.push(id);
        }
        self.actors.insert(
            id,
            Actor {
                tile_mark: None,
                hidden: false,
                created_at: self.tick,
                origin: None,
                standard_movement: false,
                tick_gravity: definition.filter(|s| s.script_gravity).map(|_| 0.0),
                dormant: false,
                always_active: None,
                persistence: None,
                last_spawn: 0,
                last_clone: 0,
                clone_source: None,
                clone_pending: false,
                clone_deleting: false,
                answer: 0,
                item_count: 0,
                menu_choice: 0,
                menu_item: String::new(),
                menu_id: String::new(),
                emitter: definition
                    .and_then(|s| s.emitter)
                    .map(|emitter| particles::Emitter {
                        phase: 0,
                        ..emitter
                    }),
                id,
                name: None,
                sprite,
                tile,
                physics,
                body,
                collider_frame: None,
                collider_bounds,
                spawn: p,
                p,
                width,
                height,
                v: Vec2::ZERO,
                facing: 1.0,
                visual_flip_x: false,
                visual_flip_y: false,
                visual_rotation: 0.0,
                shadow: None,
                health_bar: None,
                aim: Vec2::new(1.0, 0.0),
                player,
                team,
                layer,
                health,
                animation,
                animation_start: self.tick,
                animation_once: false,
                animation_finished: false,
                components: definition.map_or_else(Vec::new, |sprite| sprite.components.clone()),
                bullet: None,
                variables: Default::default(),
                scripts: Default::default(),
                tick_script: None,
            },
        );
        id
    }

    fn clone_entity(&mut self, source: u32) -> u32 {
        if self.actors.len() >= MAX_ACTORS + self.static_ids.len() {
            return 0;
        }
        let Some(actor) = self.entity(source).filter(|actor| actor.health > 0.0) else {
            return 0;
        };
        let Some(sprite) = actor.sprite.as_deref().filter(|sprite| !sprite.starts_with('@')) else {
            return 0;
        };
        let id = self.add(
            Some(sprite.to_owned()), None, actor.physics.clone(), actor.p,
            (actor.width, actor.height), (actor.layer, None),
        );
        let mut clone = self.actors.remove(&id).unwrap();
        let actor = &self.actors[&source];
        clone.clone_source = Some(source);
        clone.clone_pending = true;
        clone.hidden = actor.hidden;
        clone.always_active = actor.always_active;
        clone.standard_movement = actor.standard_movement;
        clone.tick_gravity = actor.tick_gravity;
        clone.facing = actor.facing;
        clone.aim = actor.aim;
        clone.visual_flip_x = actor.visual_flip_x;
        clone.visual_flip_y = actor.visual_flip_y;
        clone.visual_rotation = actor.visual_rotation;
        clone.shadow = actor.shadow;
        clone.health_bar = actor.health_bar;
        clone.team = actor.team;
        clone.health = actor.health;
        clone.animation.clone_from(&actor.animation);
        clone.animation_start = actor.animation_start;
        clone.animation_once = actor.animation_once;
        clone.animation_finished = actor.animation_finished;
        clone.components.clone_from(&actor.components);
        clone.variables.clone_from(&actor.variables);
        clone.emitter = actor.emitter;
        clone.velocity(&mut self.world, actor.v);
        if let Some(body) = clone.body {
            if let Some(source_body) = actor.body {
                let source_body = self.world.body(source_body);
                let (angle, speed) = (source_body.rotation().angle(), source_body.angvel());
                self.world.transform(body, clone.p, angle);
                self.world.body_mut(body).set_angvel(speed, true);
            }
            self.world.set_body_enabled(body, false);
        }
        self.actors.insert(id, clone);
        id
    }

    fn update_activity(&mut self) {
        let room = &self.game.rooms[&self.room];
        let [w, h] = self.view_size.map(|v| v as f32);
        let center = |v: f32, size: f32, extent: f32| {
            (v - size / 2.).clamp(0., (extent - size).max(0.)) + size / 2.
        };
        let views: Vec<_> = self
            .actors
            .values()
            .filter(|a| a.player.is_some())
            .map(|a| [a.p.x, a.p.y])
            .chain(self.focus())
            .map(|[x, y]| {
                [
                    center(x, w, room.cols as f32 * room.size),
                    center(y, h, room.height),
                ]
            })
            .collect();
        for id in &self.entity_ids {
            let actor = self.actors.get_mut(id).unwrap();
            if actor.clone_pending {
                continue;
            }
            let Some(sprite) = actor
                .sprite
                .as_ref()
                .filter(|_| actor.player.is_none() && actor.bullet.is_none())
            else {
                continue;
            };
            let dormant = !actor.always_active.unwrap_or(self.game.sprites[sprite].always_active)
                && !views.is_empty()
                && views.iter().all(|p| {
                    (actor.p.x - p[0]).abs() > w / 2. + 64. + actor.width / 2.
                        || (actor.p.y - p[1]).abs() > h / 2. + 64. + actor.height / 2.
                });
            if actor.dormant != dormant {
                actor.dormant = dormant;
                if let Some(body) = actor.body {
                    self.world.body_mut(body).set_enabled(!dormant);
                }
            }
        }
    }

    pub fn step_inputs(&mut self, inputs: [Input; 4]) -> Result<(), String> {
        self.step_scene(inputs)?;
        if std::mem::take(&mut self.checkpoint_requested)
            && let Ok(save) = self.save_game()
        {
            self.checkpoint = Some(save);
        }
        Ok(())
    }

    fn step_scene(&mut self, inputs: [Input; 4]) -> Result<(), String> {
        self.prior_buttons = self.inputs.map(Input::bits);
        self.sounds.clear();
        self.events.clear();
        if let Some(menu) = self.menu.as_mut() {
            let mut choice = None;
            let owner_slot = self.actors.get(&menu.owner).and_then(|actor| actor.player);
            for (slot, (now, before)) in inputs.iter().zip(self.inputs).enumerate() {
                if owner_slot.is_some_and(|owner| owner != slot) {
                    continue;
                }
                let count = menu.options.len();
                if now.up && !before.up {
                    menu.selected = (menu.selected + count - 1) % count;
                }
                if now.down && !before.down {
                    menu.selected = (menu.selected + 1) % count;
                }
                if now.a && !before.a {
                    choice = Some(menu.selected + 1);
                    break;
                }
                if now.b && !before.b {
                    choice = Some(0);
                    break;
                }
            }
            self.inputs = inputs;
            if let Some(choice) = choice {
                let menu = self.menu.take().unwrap();
                if let Some(actor) = self.actors.get_mut(&menu.owner) {
                    actor.menu_choice = choice;
                    actor.menu_id = menu.id;
                    actor.menu_item = choice
                        .checked_sub(1)
                        .and_then(|index| menu.items.get(index))
                        .cloned()
                        .unwrap_or_default();
                    let mut actions = Vec::new();
                    self.script_fuel = SCRIPT_FUEL;
                    self.control_fuel = 0;
                    self.run(menu.owner, "menu_selected", &inputs, &mut actions);
                    self.apply(&mut actions, &inputs);
                    if let Some(room) = self.transition.take() {
                        self.load(&room)?;
                    }
                }
            }
            return Ok(());
        }
        if !self.dialog.is_empty() {
            let target = self.dialog.front().and_then(|d| d.1);
            let answer = inputs.iter().zip(self.inputs).find_map(|(n, o)| {
                if n.a && !o.a {
                    Some(1)
                } else if target.is_some() && n.b && !o.b {
                    Some(0)
                } else {
                    None
                }
            });
            if let Some(answer) = answer {
                if let Some(actor) = target.and_then(|id| self.actors.get_mut(&id)) {
                    actor.answer = answer;
                }
                self.dialog.pop_front();
            }
            self.inputs = inputs;
            return Ok(());
        }
        self.tick += 1;
        self.jit_cache.begin_tick();
        self.shapes.clear();
        self.script_fuel = RESUME_FUEL;
        self.control_fuel = CONTROL_RESUME_FUEL;
        self.update_activity();
        let mut actions = Vec::new();
        let suspended: Vec<_> = self
            .actors
            .values()
            .flat_map(|actor| {
                actor
                    .scripts
                    .iter()
                    .filter(|(event, machine)| {
                        *event != "tick" && machine.ready(self.tick)
                            && (!actor.dormant || event.starts_with("received."))
                    })
                    .map(move |(event, _)| (actor.id, event.clone()))
            })
            .collect();
        let resume_start = self
            .resume_cursor
            .take()
            .map_or(0, |cursor| suspended.partition_point(|job| job < &cursor));
        for (id, event) in suspended[resume_start..].iter().chain(&suspended[..resume_start]) {
            if self.script_budget(*id, event) == 0 {
                if self.resume_cursor.is_none() {
                    self.resume_cursor = Some((*id, event.clone()));
                }
                if self.control_fuel == 0 {
                    break;
                }
                continue;
            }
            self.run_script(
                *id,
                event,
                &inputs,
                &mut actions,
                false,
                ScriptPayload::Numbers([0; 2]),
            );
        }
        // Let later phases spend unused fuel from earlier ones.
        self.script_fuel += EVENT_FUEL;
        if std::mem::take(&mut self.restored) {
            let actors: Vec<_> = self
                .actors
                .values()
                .filter(|actor| actor.sprite.is_some() && actor.bullet.is_none())
                .map(|actor| actor.id)
                .collect();
            for id in actors {
                self.run(id, "restored", &inputs, &mut actions);
            }
        }
        for id in std::mem::take(&mut self.pending_start) {
            let Some(actor) = self.actors.get_mut(&id) else { continue };
            if actor.clone_pending {
                actor.clone_pending = false;
                if let Some(body) = actor.body {
                    self.world.set_body_enabled(body, true);
                }
                self.run(id, "clone_start", &inputs, &mut actions);
            } else if actor.clone_source.is_none() {
                self.run(id, "init", &inputs, &mut actions);
                self.run(id, "start", &inputs, &mut actions);
            }
        }
        self.control_fuel += CONTROL_FUEL;
        let changed = self.reported_players ^ self.connected_players;
        self.reported_players = self.connected_players;
        if changed != 0 {
            for slot in 0..4 {
                if changed & (1 << slot) == 0 { continue; }
                let event = if self.connected_players & (1 << slot) == 0 {"disconnected"} else {"connected"};
                self.run(0, &format!("controller_{event}.{}", slot + 1), &inputs, &mut actions);
            }
        }
        self.deliver_broadcasts(&inputs, &mut actions);
        self.run_timers(&inputs, &mut actions);
        self.script_fuel += TICK_FUEL;
        let mut emitter_ids = Vec::new();
        let scripted: Vec<_> = self
            .entity_ids
            .iter()
            .filter_map(|id| self.actors.get(id))
            .filter(|actor| actor.sprite.is_some() && actor.bullet.is_none() && actor.active())
            .map(|actor| (actor, actor.player))
            .chain(self.room_script_id.map(|id| (&self.actors[&id], Some(0))))
            .chain(self.actors.get(&0).map(|actor| (actor, Some(0))))
            .map(|(actor, player)| {
                if actor.emitter.is_some() {
                    emitter_ids.push(actor.id);
                }
                (actor.id, player)
            })
            .collect();
        let edges: [Vec<Rc<str>>; 4] = std::array::from_fn(|slot| {
            let now = inputs[slot].bits();
            let before = self.inputs[slot].bits();
            if now == before {
                return Vec::new();
            }
            self.control_events
                .iter()
                .filter_map(|(mask, pressed, released)| {
                    match (before & mask != 0, now & mask != 0) {
                        (false, true) => Some(pressed.clone()),
                        (true, false) => Some(released.clone()),
                        _ => None,
                    }
                })
                .collect()
        });
        if !emitter_ids.is_empty() {
            let start = (self.tick % emitter_ids.len() as u64) as usize;
            for id in emitter_ids[start..].iter().chain(&emitter_ids[..start]) {
                let actor = self.actors.get_mut(id).unwrap();
                let emitter = actor.emitter.as_mut().unwrap();
                if let Some(count) = emitter.advance(self.tick) {
                    if count == 0 {
                        continue;
                    }
                    self.particles.emit(
                        emitter.effect,
                        [actor.p.x + emitter.offset[0], actor.p.y + emitter.offset[1]],
                        count,
                    );
                } else {
                    actor.emitter = None;
                }
            }
        }
        let tick_start = self.tick_cursor.take().and_then(|cursor| {
            scripted.iter().position(|(id, _)| *id == cursor)
                .or_else(|| scripted.iter().position(|(id, _)| *id > cursor))
        }).unwrap_or(0);
        for &(id, player) in scripted[tick_start..].iter().chain(&scripted[..tick_start]) {
            let actor = &mut self.actors.get_mut(&id).unwrap();
            let finished = !actor.animation_finished
                && actor
                    .sprite
                    .as_ref()
                    .and_then(|sprite| self.game.sprites[sprite].clips.get(&actor.animation))
                    .is_some_and(|clip| {
                        let repeat = if actor.animation_once { 1 } else { clip.repeat };
                        repeat > 0
                            && (self.tick - actor.animation_start) * 1000 / 60
                                >= clip.duration() * u64::from(repeat)
                    });
            if finished {
                actor.animation_finished = true;
                self.run(id, "animation_finished", &inputs, &mut actions);
            }
            let Some(actor) = self.actors.get(&id) else { continue };
            if let Some(slot) = player.filter(|_| actor.standard_movement) {
                let jump = inputs[slot].x
                    && !self.inputs[slot].x
                    && actor.sprite.as_ref().is_none_or(|sprite| !self.game.sprites[sprite].script_jump);
                self.engine(id, inputs[slot], 0, [4., 0., 0.], "", &mut actions);
                if jump {
                    self.engine(id, inputs[slot], 1, [8., 0., 0.], "", &mut actions);
                }
            }
            if self.script_fuel < vm::SLICE
                && self.tick_cursor.is_none()
                && self.script_budget(id, "tick") < vm::SLICE
            {
                self.tick_cursor = Some(id);
            }
            self.run(id, "tick", &inputs, &mut actions);
            if let Some(slot) = player {
                for event in &edges[slot] {
                    self.run(id, event, &inputs, &mut actions);
                }
                let now = inputs[slot];
                let before = self.inputs[slot];
                for (name, pressed) in [
                    ("a", now.a && !before.a),
                    ("b", now.b && !before.b),
                    ("x", now.x && !before.x),
                    ("menu", now.menu && !before.menu),
                ] {
                    if pressed {
                        self.run(id, name, &inputs, &mut actions);
                    }
                }
            }
        }
        self.inputs = inputs;
        self.script_fuel += LATE_FUEL + std::mem::take(&mut self.control_fuel);
        self.apply(&mut actions, &inputs);
        if let Some(room) = self.transition.take() {
            return self.load(&room);
        }

        self.sync_gates()?;
        self.sync_colliders();
        self.zones(&inputs, &mut actions);
        self.move_bullets(&mut actions);
        self.contacts.previous.clear();
        let top_down = self.game.rooms[&self.room].is_top_down();
        for actor in self.actors.values() {
            if actor.active()
                && matches!(actor.physics.mode, Mode::Dynamic | Mode::Kinematic)
                && let Some(body) = actor.body
            {
                let drop = !top_down && actor.player.is_some_and(|slot| self.inputs[slot].down);
                self.world.track_contact(
                    body,
                    actor.id,
                    (actor.p.y + actor.collider_bounds[3]) / PPM,
                    drop,
                    &mut self.contacts,
                );
            }
        }
        self.world.step(&mut self.contacts);
        let height = self.game.rooms[&self.room].height;
        for actor in self.actors.values_mut().filter(|a| a.active()) {
            if let Some(body) = actor.body {
                let body = self.world.body(body);
                actor.p = PPM * body.translation();
                actor.v = body.linvel();
            } else if actor.bullet.is_none() {
                actor.p += (PPM * STEP) * actor.v;
            }
            if actor.p.y > height + PPM * 4.0 {
                if actor.clone_source.is_none() && actor.player.is_some()
                    && actor
                        .origin
                        .as_ref()
                        .is_none_or(|spawn| spawn.respawn.is_none())
                {
                    actor.teleport(&mut self.world, actor.spawn);
                } else {
                    actions.push(Action::Remove(actor.id));
                }
            }
        }
        let events = std::mem::take(&mut self.contacts.events);
        for (began, a, b) in events {
            self.events.push(RuntimeEvent::Contact { began, a, b });
            let event = if began {
                "begin_contact"
            } else {
                "end_contact"
            };
            self.run_script(
                a,
                event,
                &inputs,
                &mut actions,
                true,
                ScriptPayload::Numbers([i64::from(b), 0]),
            );
            self.run_script(
                b,
                event,
                &inputs,
                &mut actions,
                true,
                ScriptPayload::Numbers([i64::from(a), 0]),
            );
        }
        self.apply(&mut actions, &inputs);
        let size = self.game.rooms[&self.room].size;
        for (owner, spawn) in std::mem::take(&mut self.pending_instances) {
            if self.actors.len() >= MAX_ACTORS + self.static_ids.len() {
                break;
            }
            let spawned = self.next;
            self.add_scene_actor(spawn, size)?;
            if let Some(a) = self.actors.get_mut(&owner) {
                a.last_spawn = spawned;
            }
        }
        self.sync_gates()?;
        self.process_respawns()?;
        let particle_focus = self.game_settings.split_screen.is_none().then(|| self.focus()).flatten();
        self.particles.update(particle_focus, self.view_size);
        if std::mem::take(&mut self.retry) {
            if let Some(saved) = self.checkpoint.clone() {
                return self.load_game(&saved);
            }
        }
        self.cross_exit(&inputs)
    }

    fn assign_player(&mut self, entity: u32, player: Option<usize>) {
        if !self.entity_ids.contains(&entity) || self.actors[&entity].player == player {
            return;
        }
        if let Some(player) = player {
            for actor in self.actors.values_mut().filter(|actor| actor.player == Some(player)) {
                actor.player = None;
            }
        }
        self.actors.get_mut(&entity).unwrap().player = player;
    }

    fn run_timers(&mut self, inputs: &[Input; 4], actions: &mut Vec<Action>) {
        if self.timer_schedules.is_empty() { return; }
        let mut due = Vec::new();
        for actor in self.actors.values().filter(|actor| actor.active() && actor.bullet.is_none()) {
            let elapsed = self.tick.saturating_sub(actor.created_at);
            if elapsed == 0 { continue; }
            if let Some(timers) = actor.sprite.as_ref().and_then(|name| self.timer_schedules.get(name)) {
                for (event, interval, repeat) in timers {
                    if elapsed == *interval || (*repeat && elapsed.is_multiple_of(*interval)) {
                        due.push((actor.id,event.clone()));
                    }
                }
            }
        }
        for (id,event) in due { self.run(id,&event,inputs,actions); }
    }

    fn touches_tile_top(&self, tile: u32, entity: u32) -> bool {
        let pair = (tile.min(entity),tile.max(entity));
        if !self.contacts.pairs.contains(&pair) { return false; }
        let (Some(tile), Some(entity)) = (self.entity(tile),self.entity(entity)) else { return false; };
        let [l, top, r, _] = tile.collider_bounds;
        let [el, _, er, foot] = entity.collider_bounds;
        entity.p.y < tile.p.y && (entity.p.y + foot - tile.p.y - top).abs() < 3.0
            && entity.p.x + er > tile.p.x + l && entity.p.x + el < tile.p.x + r
    }

    fn touching_entity(&self, source: u32, target: u32) -> bool {
        source != target
            && self.contacts.pairs.contains(&(source.min(target), source.max(target)))
            && self.entity(target).is_some_and(Actor::active)
    }

    fn deliver_broadcasts(&mut self, inputs: &[Input; 4], actions: &mut Vec<Action>) {
        while let Some(signal) = self.broadcasts.front() {
            let event = format!("received.{}", signal.name);
            let listeners = self
                .entity_ids
                .iter()
                .copied()
                .chain(self.room_script_id)
                .chain(self.actors.contains_key(&0).then_some(0))
                .filter(|id| {
                    self.actors[id]
                        .sprite
                        .as_ref()
                        .and_then(|sprite| self.programs.get(sprite))
                        .is_some_and(|events| events.contains_key(&event))
                });
            let room = MAX_EVENT_DELIVERIES.saturating_sub(self.event_deliveries.len());
            let listeners: Vec<_> = listeners.take(room + 1).collect();
            if listeners.len() > room {
                break;
            }
            let signal = self.broadcasts.pop_front().unwrap();
            self.event_deliveries
                .extend(listeners.into_iter().map(|id| EventDelivery {
                    receiver: id,
                    signal: signal.clone(),
                }));
        }
        for _ in 0..self.event_deliveries.len() {
            let delivery = self.event_deliveries.pop_front().unwrap();
            let Some(actor) = self.actors.get(&delivery.receiver) else {
                continue;
            };
            let event = format!("received.{}", delivery.signal.name);
            if actor.scripts.contains_key(&event) {
                self.event_deliveries.push_back(delivery);
            } else {
                self.run_script(
                    delivery.receiver,
                    &event,
                    inputs,
                    actions,
                    true,
                    ScriptPayload::Numbers([i64::from(delivery.signal.sender), i64::from(delivery.signal.entity)]),
                );
            }
        }
    }

    fn run(&mut self, id: u32, event: &str, inputs: &[Input; 4], actions: &mut Vec<Action>) {
        self.run_script(
            id,
            event,
            inputs,
            actions,
            true,
            ScriptPayload::Numbers([0; 2]),
        );
    }

    fn is_control_event(event: &str) -> bool {
        matches!(event, "tick" | "a" | "b" | "x" | "menu")
            || event.starts_with("pressed.")
            || event.starts_with("released.")
            || event.starts_with("controller_")
    }

    fn script_budget(&self, id: u32, event: &str) -> usize {
        if self.control_fuel != 0 && Self::is_control_event(event)
            && (id == 0 || self.room_script_id == Some(id)
                || self.actors.get(&id).is_some_and(|actor| actor.player.is_some()))
        {
            self.control_fuel
        } else {
            self.script_fuel
        }
    }

    fn run_script(
        &mut self,
        id: u32,
        event: &str,
        inputs: &[Input; 4],
        actions: &mut Vec<Action>,
        start: bool,
        payload: ScriptPayload,
    ) -> bool {
        let Some(actor) = self.actors.get_mut(&id) else {
            return false;
        };
        if actor.clone_pending {
            return false;
        }
        let tick = event == "tick";
        let previous = if tick {
            actor.tick_script.take()
        } else {
            actor.scripts.remove(event)
        };
        let mut machine = match previous {
            Some(machine) if !tick && start => {
                actor.scripts.insert(event.into(), machine);
                return true;
            }
            Some(machine) => machine,
            None => {
                let Some(program) = actor
                    .sprite
                    .as_ref()
                    .and_then(|sprite| self.programs.get(sprite))
                    .and_then(|events| events.get(event))
                else {
                    return false;
                };
                if !start {
                    return true;
                }
                match payload {
                    ScriptPayload::Numbers(values) => vm::Machine::new(program.clone(), values),
                    ScriptPayload::UsedItem(item) => {
                        vm::Machine::new(program.clone(), [0; 2]).with_used_item(item)
                    }
                }
            }
        };
        let slot = actor
            .player
            .or((id == 0 || self.room_script_id == Some(id)).then_some(0));
        let (input, previous) = slot.map_or((Input::default(), 0), |slot| (inputs[slot], self.prior_buttons[slot]));
        let control = self.control_fuel != 0 && slot.is_some() && Self::is_control_event(event);
        if control {
            std::mem::swap(&mut self.script_fuel, &mut self.control_fuel);
        }
        let result = machine.run(self, id, event, input, previous, actions);
        if control {
            std::mem::swap(&mut self.script_fuel, &mut self.control_fuel);
        }
        if self.actors.get(&id).is_some_and(|actor| actor.clone_deleting) {
            if let Some(body) = self.remove_entity_record(id).and_then(|actor| actor.body) {
                self.world.remove(body);
            }
            return true;
        }
        match result {
            Ok(finished) if tick => {
                if finished {
                    machine.restart();
                }
                self.actors.get_mut(&id).unwrap().tick_script = Some(machine);
            }
            Ok(false) => {
                self.actors
                    .get_mut(&id)
                    .unwrap()
                    .scripts
                    .insert(event.into(), machine);
            }
            Ok(true) => {}
            Err(message) if self.events.len() < 256 => {
                self.events.push(RuntimeEvent::ScriptError {
                    actor: id,
                    event: event.into(),
                    message: message.into(),
                })
            }
            Err(_) => {}
        }
        true
    }

    fn remove_entity_record(&mut self, id: u32) -> Option<Actor> {
        let actor = self.actors.remove(&id)?;
        if self.menu.as_ref().is_some_and(|menu| menu.owner == id) {
            self.menu = None;
        }
        self.dialog.retain(|(_, owner)| *owner != Some(id));
        self.entity_ids.remove(&id);
        self.tile_entities.remove(&id);
        if Some(id) == self.room_script_id {
            self.room_script_id = None;
        }
        self.animated_colliders.remove(&id);
        if let Some(name) = &actor.name
            && self.named_entities.get(name) == Some(&id)
        {
            self.named_entities.remove(name);
        }
        Some(actor)
    }

    fn entity(&self, id: u32) -> Option<&Actor> {
        self.entity_ids
            .contains(&id)
            .then(|| self.actors.get(&id))
            .flatten()
    }

    fn has_component(&self, actor: &Actor, component: &str) -> bool {
        match component {
            "transform" | "sprite" | "health" => true,
            "body" => actor.body.is_some(),
            "player" => actor.player.is_some(),
            "script" => actor
                .sprite
                .as_ref()
                .is_some_and(|sprite| !self.programs[sprite].is_empty()),
            _ => actor.components.iter().any(|name| name == component),
        }
    }

    fn localized_text(&self, key: &str) -> &str {
        self.game.text.get(key).map_or("", String::as_str)
    }

    fn fire_projectile(
        &self,
        id: u32,
        projectile: &str,
        aim: &str,
        speed: f32,
        damage: f32,
        actions: &mut Vec<Action>,
    ) {
        if actions.len() < MAX_ACTIONS
            && speed > 0.0
            && damage > 0.0
            && self.game.sprites.contains_key(projectile)
        {
            actions.push(Action::Fire(
                id,
                Some(projectile.into()),
                aim.into(),
                speed.min(100.0),
                damage,
            ));
        }
    }

    fn engine(
        &mut self,
        id: u32,
        input: Input,
        opcode: u64,
        args: [f32; 3],
        name: &str,
        actions: &mut Vec<Action>,
    ) {
        if actions.len() >= MAX_ACTIONS && matches!(opcode, 2 | 3 | 9 | 26 | 38 | 64) {
            return;
        }
        let arg = |index: usize| args[index - 1];
        let top_down = self.game.rooms[&self.room].is_top_down();
        let menu_controls = || {
            self.game
                .text
                .get("menu_controls")
                .cloned()
                .unwrap_or_else(|| "[A] Select  [B] Back".into())
        };
        match opcode {
            56 if self.menu.is_none() => {
                if let Some(menu) = self
                    .game
                    .menus
                    .get(name)
                    .filter(|menu| !menu.options.is_empty())
                {
                    self.menu = Some(model::Menu {
                        id: name.into(),
                        controls: menu_controls(),
                        owner: id,
                        title: menu.title.clone(),
                        options: menu.options.clone(),
                        selected: 0,
                        items: Vec::new(),
                    });
                }
            }
            57 if self.menu.is_none() => {
                let player = self.actors[&id].player;
                let mut inventory = self.inventory.clone();
                if let Some(slot) = player {
                    for (item, count) in &self.game_properties.player_items[slot] {
                        let total = inventory.entry(item.clone()).or_default();
                        *total = total.saturating_add(*count);
                    }
                }
                let entries: Vec<_> = inventory
                    .iter()
                    .filter(|(_, count)| **count > 0)
                    .take(256)
                    .collect();
                let title = self
                    .game
                    .text
                    .get("inventory_title")
                    .cloned()
                    .unwrap_or_else(|| "Inventory".into());
                if entries.is_empty() {
                    let text = self
                        .game
                        .text
                        .get("inventory_empty")
                        .cloned()
                        .unwrap_or_else(|| "Inventory is empty".into());
                    self.dialog.push_back((text, None));
                } else {
                    self.menu = Some(model::Menu {
                        id: "inventory".into(),
                        controls: menu_controls(),
                        owner: id,
                        title,
                        options: entries
                            .iter()
                            .map(|(item, count)| {
                                format!(
                                    "{} x {count}",
                                    self.game
                                        .items
                                        .get(*item)
                                        .and_then(|item| item.label.as_deref())
                                        .unwrap_or(item)
                                )
                            })
                            .collect(),
                        selected: 0,
                        items: entries.iter().map(|(item, _)| (*item).clone()).collect(),
                    });
                }
            }
            64 => {
                let actor = &self.actors[&id];
                let name = &actor.menu_item;
                let Some(item) = self.game.items.get(name) else {
                    return;
                };
                let bag = actor
                    .player
                    .filter(|slot| self.game_properties.player_items[*slot].contains_key(name))
                    .map_or(&mut self.inventory, |slot| &mut self.game_properties.player_items[slot]);
                let Some(count) = bag.get_mut(name).filter(|count| **count > 0) else {
                    return;
                };
                if item.consumable {
                    *count -= 1;
                    if *count == 0 {
                        bag.remove(name);
                    }
                }
                if let Some(flag) = &item.flag {
                    self.game_properties.flags.insert(flag.as_str().into(), 1.into());
                    self.gates_dirty = true;
                }
                actions.push(Action::Used(id, name.into()));
            }
            27 | 28 | 67 | 68 => {
                if let Some(effect) = particles::Effect::named(name) {
                    let actor = self.actors.get_mut(&id).unwrap();
                    let rate = args[1].clamp(0.0, 240.0) as u16;
                    match opcode {
                        27 => self.particles.emit(
                            effect,
                            [actor.p.x, actor.p.y],
                            args[1].max(0.0) as usize,
                        ),
                        68 => self.particles.emit(
                            effect,
                            [actor.p.x + args[1], actor.p.y + args[2]],
                            12,
                        ),
                        _ => {
                            let previous = actor.emitter.filter(|emitter| emitter.effect == effect);
                            let phase = previous.map_or(0, |emitter| emitter.phase);
                            let offset = previous.map_or([0.0; 2], |emitter| emitter.offset);
                            let until = (opcode == 67).then(|| {
                                self.tick
                                    .saturating_add(args[2].clamp(1.0, 10000.0) as u64 + 1)
                            });
                            actor.emitter = Some(particles::Emitter {
                                effect,
                                rate,
                                phase,
                                offset,
                                until,
                            });
                        }
                    }
                }
            }
            29 => self.actors.get_mut(&id).unwrap().emitter = None,

            26 => actions.push(Action::Remove(id)),
            31 => {
                self.checkpoint_requested = true;
            }
            32 => self.retry = true,
            33 if self.dialog.len() < 32 => self
                .dialog
                .push_back((format!("{name}  A: Yes  B: No"), Some(id))),
            34..=36 => {
                let slot = args[1] as i32;
                if !(1..=4).contains(&slot) {
                    self.actors.get_mut(&id).unwrap().item_count = 0;
                    return;
                }
                let bag = &mut self.game_properties.player_items[(slot - 1) as usize];
                let old = bag.get(name).copied().unwrap_or(0);
                let n = args[2].max(0.) as u32;
                let count = match opcode {
                    34 if old > 0 || bag.len() < 1024 => old.saturating_add(n),
                    35 => old.saturating_sub(n),
                    _ => old,
                };
                if opcode != 36 {
                    if count == 0 {
                        bag.remove(name);
                    } else {
                        bag.insert(name.into(), count);
                    }
                }
                self.actors.get_mut(&id).unwrap().item_count = count;
            }
            30 => {
                self.group_camera = true;
                self.camera_actor = None;
                self.camera_point = None;
            }
            23 => {
                self.group_camera = false;
                self.camera_actor = Some(id);
                self.camera_point = None;
            }
            24 => {
                self.group_camera = false;
                self.camera_actor = None;
                self.camera_point = Some([args[0], args[1]]);
            }
            41 => self
                .actors
                .get_mut(&id)
                .unwrap()
                .teleport(&mut self.world, Vec2::new(args[0], args[1])),
            46 => {
                let actor = self.actors.get_mut(&id).unwrap();
                let velocity = actor.v;
                actor.teleport(&mut self.world, actor.p + Vec2::new(args[0], args[1]));
                actor.velocity(&mut self.world, velocity);
            }
            25 | 40 => {
                if opcode == 40 && !(1..=4).contains(&(args[0] as i32)) {
                    return;
                }
                self.camera_slot = if opcode == 40 {
                    args[0] as usize - 1
                } else {
                    0
                };
                self.group_camera = false;
                self.camera_actor = None;
                self.camera_point = None;
            }

            18 | 19 => {
                let current = self.inventory.get(name).copied().unwrap_or(0);
                let change = args[1].max(0.) as u32;
                let count = if opcode == 18 {
                    current.saturating_add(change)
                } else {
                    current.saturating_sub(change)
                };
                if count == 0 {
                    self.inventory.remove(name);
                } else if current > 0 || self.inventory.len() < 1024 {
                    self.inventory.insert(name.into(), count);
                }
            }
            20 if self.dialog.len() < 32 && !name.is_empty() => {
                self.dialog.push_back((name.into(), None))
            }
            21 if self.counters.contains_key(name) || self.counters.len() < 4 => {
                self.counters.insert(name.into(), args[1] as i32);
            }
            38 => {
                let slot = args[1] as usize;
                if let Some(item) = self.game.items.get(name)
                    && (1..=4).contains(&slot)
                    && let Some(count) = self.game_properties.player_items[slot - 1].get_mut(name)
                    && *count > 0
                {
                    if item.consumable {
                        *count -= 1;
                    }
                    if let Some(flag) = &item.flag {
                        self.game_properties.flags.insert(flag.as_str().into(), 1.into());
                        self.gates_dirty = true;
                    }
                    if let Some(target) = self.actors.values().find(|a| a.player == Some(slot - 1))
                    {
                        actions.push(Action::Used(target.id, name.into()));
                    }
                }
            }
            39 if self.game.items.contains_key(name)
                && (self.icons.contains_key(name) || self.icons.len() < 32) =>
            {
                self.icons
                    .insert(name.into(), [args[1] as i32, args[2] as i32]);
            }
            37 if self.bars.contains_key(name) || self.bars.len() < 4 => {
                let max = (args[2] as i32).max(1);
                self.bars
                    .insert(name.into(), [(args[1] as i32).clamp(0, max), max]);
            }
            22 => {
                self.hud_text.remove(name);
                self.hud_sprites.remove(name);
                self.background_sprites.remove(name);
                self.icons.remove(name);
                self.bars.remove(name);
                self.counters.remove(name);
            }

            0 => {
                let actor = self.actors.get_mut(&id).unwrap();
                let dx = f32::from(input.right) - f32::from(input.left);
                let dy = f32::from(input.down) - f32::from(input.up);
                let direction = Vec2::new(dx, if top_down { dy } else { 0.0 });
                actor.face(direction, top_down);
                let velocity = if top_down {
                    arg(1) * unit(direction)
                } else {
                    Vec2::new(dx * arg(1), actor.v.y)
                };
                actor.velocity(&mut self.world, velocity);
            }
            43 => {
                if let Some(scale) = self.actors.get_mut(&id).unwrap().tick_gravity.as_mut() {
                    *scale = arg(1);
                }
            }
            44 | 45 => {
                if let Some(body) = self.actors[&id].body {
                    let vector = Vec2::new(arg(1), arg(2));
                    if opcode == 44 {
                        self.world.force(body, vector);
                    } else {
                        self.world.body_mut(body).apply_impulse(vector, true);
                    }
                }
            }
            69 => self.actors.get_mut(&id).unwrap().visual_flip_x = arg(1) != 0.0,
            70 => self.actors.get_mut(&id).unwrap().visual_flip_y = arg(1) != 0.0,
            71 | 72 => {
                let actor = self.actors.get_mut(&id).unwrap();
                let angle = if opcode == 72 {
                    actor.visual_rotation
                } else {
                    0.0
                };
                actor.visual_rotation =
                    (angle + arg(1).to_radians()).rem_euclid(std::f32::consts::TAU);
            }
            87 => {
                let opacity = arg(2).clamp(0.0, 100.0).round() as u8;
                let placement = match name {
                    "behind" => Some(ShadowPlacement::Behind),
                    "ground" => Some(ShadowPlacement::Ground),
                    _ => None,
                };
                let actor = self.actors.get_mut(&id).unwrap();
                if actor.sprite.is_some() {
                    actor.shadow = placement
                        .filter(|_| opacity > 0)
                        .map(|placement| SpriteShadow { placement, opacity });
                }
            }
            42 if !top_down && self.grounded(id) => {
                if let Some(body) = self.actors[&id].body {
                    self.world.force(body, Vec2::new(0.0, -arg(1).max(0.0)));
                }
            }
            1 if !top_down && !input.down && self.grounded(id) => {
                let actor = self.actors.get_mut(&id).unwrap();
                actor.velocity(&mut self.world, Vec2::new(actor.v.x, -arg(1)));
            }
            2 if arg(1) > 0.0 && arg(2) > 0.0 => {
                let owner = &self.actors[&id];
                let range = arg(2);
                let width = if arg(3) > 0.0 { arg(3) } else { owner.height };
                for target in self
                    .actors
                    .values()
                    .filter(|target| self.hittable(owner, target))
                {
                    if actions.len() >= MAX_ACTIONS {
                        break;
                    }
                    if attack_intersects(owner, target, range, width) {
                        actions.push(Action::Damage {
                            source: id,
                            target: target.id,
                            amount: Some(arg(1)),
                        });
                    }
                }
            }
            3 if arg(2) > 0.0 && arg(3) > 0.0 => actions.push(Action::Fire(
                id,
                None,
                name.into(),
                arg(2).min(100.0),
                arg(3),
            )),
            4 => {
                // Stagger search across actors and keep their last velocity between searches.
                if self.tick % 6 != u64::from(id % 6) {
                    return;
                }
                let p = self.actors[&id].p;
                let destination = self
                    .actors
                    .values()
                    .filter(|a| a.player.is_some())
                    .min_by(|a, b| {
                        (a.p - p)
                            .length_squared()
                            .total_cmp(&(b.p - p).length_squared())
                    })
                    .map(|a| a.p);
                if !top_down
                    && self.actors[&id].physics.gravity > 0.
                    && self.actors[&id].physics.mode == Mode::Dynamic
                {
                    let Some(to) = destination else { return };
                    let a = &self.actors[&id];
                    let ladder = self.actors.values().any(|r| {
                        r.physics.mode == Mode::Ladder
                            && overlap(a.p, a.width, a.height, r.p, r.width, r.height)
                    });
                    let velocity = if ladder && (to.y - p.y).abs() > 4. {
                        Vec2::new(0., (to.y - p.y).signum() * arg(1))
                    } else if self.grounded(id) {
                        path::platform_move(
                            &self.game.rooms[&self.room],
                            Vec2::new(p.x, p.y + a.height / 2. - 1.),
                            to,
                            &self.blocked,
                            arg(1),
                            self.room_gravity() * a.physics.gravity,
                        )
                    } else {
                        return;
                    };
                    let a = self.actors.get_mut(&id).unwrap();
                    a.face(velocity, false);
                    a.velocity(&mut self.world, velocity);
                    return;
                }
                let v = destination
                    .and_then(|to| {
                        path::waypoint(&self.game.rooms[&self.room], p, to, &self.blocked)
                    })
                    .map_or(Vec2::ZERO, |to| arg(1) * unit(to - p));
                let actor = self.actors.get_mut(&id).unwrap();
                actor.face(v, top_down);
                actor.velocity(&mut self.world, v);
            }
            5 if self.sounds.len() < 64 => self.sounds.push(SoundCommand::Play {
                entity: id,
                sound: name.into(),
            }),
            6 => self
                .actors
                .get_mut(&id)
                .unwrap()
                .velocity(&mut self.world, Vec2::new(arg(1), arg(2))),
            7 | 55 => {
                let actor = self.actors.get_mut(&id).unwrap();
                if actor.animation != name
                    || actor.animation_once != (opcode == 55)
                    || (opcode == 55 && actor.animation_finished)
                {
                    actor.animation = name.into();
                    actor.animation_start = self.tick;
                    actor.animation_once = opcode == 55;
                    actor.animation_finished = false;
                }
            }
            8 if self.game.rooms.contains_key(name) && name != self.room => {
                self.transition = Some(name.into())
            }
            9 if self.game.sprites.contains_key(name) => {
                let p = self.actors[&id].p;
                actions.push(Action::Instance(
                    id,
                    Spawn {
                        sprite: Some(name.into()),
                        x: p.x + arg(2),
                        y: p.y + arg(3),
                        ..Spawn::default()
                    },
                ));
            }
            _ => {}
        }
    }

    fn sync_colliders(&mut self) {
        for id in &self.animated_colliders {
            let Some(actor) = self.actors.get_mut(id) else {
                continue;
            };
            let Some(sprite) = actor
                .sprite
                .as_ref()
                .and_then(|name| self.game.sprites.get(name))
            else {
                continue;
            };
            let Some(body) = actor.body else {
                continue;
            };
            let frame = sprite
                .clips
                .get(&actor.animation)
                .or_else(|| sprite.clips.get("default"))
                .map(|clip| {
                    let elapsed = self.tick.saturating_sub(actor.animation_start) * 1000 / 60;
                    clip.image_with_repeat(
                        elapsed,
                        if actor.animation_once { 1 } else { clip.repeat },
                    )
                });
            let override_shape =
                frame.and_then(|image| sprite.frame_colliders.get_key_value(image));
            let frame_id = override_shape.map(|(image, _)| image.as_str());
            if frame_id == actor.collider_frame.as_deref() {
                continue;
            }
            let shapes =
                override_shape.map_or(sprite.collider.as_slice(), |(_, shapes)| shapes.as_slice());
            self.world
                .set_shape(body, actor.width, actor.height, shapes);
            actor.collider_bounds = physics::bounds(shapes, actor.width, actor.height);
            actor.collider_frame = frame_id.map(str::to_owned);
        }
    }

    fn grounded(&self, id: u32) -> bool {
        let actor = &self.actors[&id];
        if actor.v.y < -0.1 {
            return false;
        }
        let [left, _, right, foot] = actor.collider_bounds;
        let bottom = actor.p.y + foot;
        self.world.any_in_aabb(
            Vec2::new((actor.p.x + left) / PPM, (bottom - 3.0) / PPM),
            Vec2::new((actor.p.x + right) / PPM, (bottom + 3.0) / PPM),
            |other_id| {
                self.actors.get(&other_id).is_some_and(|other| {
                    other.id != id
                        && other.active_solid()
                        && physics::allows(&actor.physics, &other.physics)
                        && (other.p.y + other.collider_bounds[1] - bottom).abs() < 3.0
                        && actor.p.x + right > other.p.x + other.collider_bounds[0] + 0.5
                        && actor.p.x + left < other.p.x + other.collider_bounds[2] - 0.5
                })
            },
        )
    }

    fn hittable(&self, owner: &Actor, target: &Actor) -> bool {
        target.active()
            && self.room_script_id != Some(target.id)
            && owner.id != target.id
            && !self.static_ids.contains(&target.id)
            && target.bullet.is_none()
            && (target.sprite.is_some() || target.physics.mode == Mode::Breakable)
            && (owner.team == 0 || target.team == 0 || owner.team != target.team)
    }

    fn apply(&mut self, actions: &mut Vec<Action>, inputs: &[Input; 4]) {
        let mut queue = std::collections::VecDeque::from(std::mem::take(actions));
        let mut budget = MAX_ACTIONS;
        while let Some(action) = queue.pop_front() {
            if budget == 0 {
                break;
            }
            budget -= 1;
            match action {
                Action::Heal(id, amount) => {
                    if let Some(actor) = self.actors.get_mut(&id).filter(|actor| actor.health > 0.0)
                    {
                        actor.health = (actor.health + amount).min(actor.physics.health);
                    }
                }
                Action::Used(id, item) => {
                    self.run_script(
                        id,
                        "use_item",
                        inputs,
                        actions,
                        true,
                        ScriptPayload::UsedItem(item),
                    );
                }
                Action::Fire(id, projectile, aim, speed, damage) => {
                    self.fire(id, projectile, aim, speed, damage)
                }
                Action::Broadcast(signal) if self.broadcasts.len() < MAX_BROADCASTS => {
                    self.broadcasts.push_back(signal)
                }
                Action::Broadcast(_) => {}
                Action::Instance(owner, spawn) => {
                    if self.pending_instances.len() < MAX_ACTORS {
                        self.pending_instances.push((owner, spawn));
                    }
                }
                Action::Damage {
                    source,
                    target: id,
                    amount,
                } => {
                    let Some(actor) = self.actors.get_mut(&id) else {
                        continue;
                    };
                    if actor.health <= 0.0 {
                        continue;
                    }
                    let amount = amount.unwrap_or(actor.health);
                    actor.health -= amount;
                    self.events.push(RuntimeEvent::Damage {
                        source,
                        target: id,
                        amount,
                    });
                    let dead = actor.health <= 0.0;
                    self.run_script(
                        id,
                        "damage",
                        inputs,
                        actions,
                        true,
                        ScriptPayload::Numbers([i64::from(source), amount.round() as i64]),
                    );
                    if dead {
                        actions.push(Action::Remove(id));
                    }
                }
                Action::Remove(id) => {
                    if self.menu.as_ref().is_some_and(|menu| menu.owner == id) {
                        self.menu = None;
                    }
                    self.run(id, "destroy", inputs, actions);
                    if self.actors.get(&id).is_some_and(|actor| {
                        actor.clone_source.is_none() && actor.player.is_some()
                            && actor
                                .origin
                                .as_ref()
                                .is_none_or(|spawn| spawn.respawn.is_none())
                    }) {
                        let actor = self.actors.get_mut(&id).unwrap();
                        actor.health = actor.physics.health;
                        actor.teleport(&mut self.world, actor.spawn);
                    } else if let Some(mut actor) = self.remove_entity_record(id) {
                        let rule = actor
                            .origin
                            .as_ref()
                            .and_then(|spawn| spawn.respawn.clone());
                        if let Some(rule) = rule {
                            match rule.mode {
                                RespawnMode::Never => {
                                    if let Some(name) = &actor.name {
                                        self.removed
                                            .entry(self.room.clone())
                                            .or_default()
                                            .insert(format!("entity/{name}"));
                                    }
                                }
                                RespawnMode::OnEntry | RespawnMode::Delay => {
                                    if rule.mode == RespawnMode::OnEntry
                                        && let Some(name) = &actor.name
                                    {
                                        self.entry_removed.insert(name.clone());
                                    }
                                    if let Some(key) = &actor.persistence {
                                        if let Some(records) = self.memory.get_mut(&self.room) {
                                            records.remove(key);
                                        }
                                    }
                                    if rule.mode == RespawnMode::Delay
                                        && let Some(spawn) = actor.origin.take()
                                    {
                                        let queue =
                                            self.respawns.entry(self.room.clone()).or_default();
                                        if queue.len() < MAX_ACTORS {
                                            queue.push(PendingRespawn {
                                                spawn,
                                                due: self
                                                    .tick
                                                    .saturating_add(u64::from(rule.ticks.max(1))),
                                            });
                                        }
                                    }
                                }
                            }
                        } else if let Some(key) = actor.persistence.take() {
                            let remember_removal = actor
                                .origin
                                .as_ref()
                                .and_then(|spawn| spawn.remember_removal)
                                .unwrap_or(true);
                            if let Some(records) = self.memory.get_mut(&self.room) {
                                records.remove(&key);
                            }
                            if remember_removal {
                                self.removed
                                    .entry(self.room.clone())
                                    .or_default()
                                    .insert(key);
                            }
                        }
                        if let Some(body) = actor.body {
                            self.world.remove(body);
                        }
                    }
                }
            }
            queue.extend(actions.drain(..));
        }
    }

    fn zones(&mut self, inputs: &[Input; 4], actions: &mut Vec<Action>) {
        let density_scale = if self.game.pixel_units { 1.0 } else { PPM * PPM };
        let zones: Vec<_> = self
            .actors
            .values()
            .filter(|a| a.active() && matches!(a.physics.mode, Mode::Fluid | Mode::Ladder))
            .map(|a| (a.id, a.p, a.width, a.height, a.physics.clone()))
            .collect();
        for actor in self
            .actors
            .values_mut()
            .filter(|a| a.active() && a.physics.mode == Mode::Dynamic)
        {
            let base_gravity = actor.physics.gravity * actor.tick_gravity.unwrap_or(1.0);
            if let Some(scale) = actor.tick_gravity.as_mut() {
                *scale = 0.0;
            }
            let mut gravity = base_gravity;
            let mut fluid_drag = 0.0_f32;
            let mut submerged = 0.0;
            let body_density = actor.physics.mass.map_or(actor.physics.density, |mass| {
                mass * density_scale / (actor.width * actor.height)
            });
            let mut ladder = false;
            for (id, p, w, h, zone) in &zones {
                if !physics::allows(&actor.physics, zone)
                    || !overlap(actor.p, actor.width, actor.height, *p, *w, *h)
                {
                    continue;
                }
                if zone.mode == Mode::Ladder {
                    ladder = true;
                } else {
                    let submerged_axis = |center: f32, extent: f32, water: f32, span: f32| {
                        ((center + extent / 2.).min(water + span / 2.)
                            - (center - extent / 2.).max(water - span / 2.))
                            / extent
                    };
                    let fraction = submerged_axis(actor.p.x, actor.width, p.x, *w)
                        * submerged_axis(actor.p.y, actor.height, p.y, *h);
                    let portion = fraction.min(1.0 - submerged);
                    submerged += portion;
                    gravity -= base_gravity * portion * zone.buoyancy * zone.density / body_density;
                    fluid_drag += portion * zone.drag;
                    if portion > 0.0 && zone.damage > 0.0 && actor.sprite.is_some() {
                        actions.push(Action::Damage {
                            source: *id,
                            target: actor.id,
                            amount: Some(portion * zone.damage * STEP),
                        });
                    }
                }
            }
            if ladder
                && !self.game.rooms[&self.room].is_top_down()
                && actor.player.is_some_and(|p| inputs[p].up || inputs[p].down)
            {
                let input = inputs[actor.player.unwrap()];
                gravity = 0.0;
                let dy = (f32::from(input.down) - f32::from(input.up)) * 3.5;
                actor.velocity(&mut self.world, Vec2::new(actor.v.x, dy));
            }
            if let Some(body) = actor.body {
                let body = self.world.body_mut(body);
                let gravity = gravity.clamp(-8.0, 8.0);
                if body.gravity_scale() != gravity {
                    body.set_gravity_scale(gravity, true);
                }
                if body.linear_damping() != fluid_drag {
                    body.set_linear_damping(fluid_drag);
                }
            }
        }
    }

    fn target(&self, actor: &Actor, p: Vec2) -> Option<&Actor> {
        self.actors
            .values()
            .filter(|target| target.sprite.is_some() && self.hittable(actor, target))
            .min_by(|a, b| {
                (a.p - p)
                    .length_squared()
                    .total_cmp(&(b.p - p).length_squared())
            })
    }

    fn fire(&mut self, id: u32, projectile: Option<String>, aim: String, speed: f32, damage: f32) {
        let Some(owner) = self.actors.get(&id) else {
            return;
        };
        if self.actors.len() >= MAX_ACTORS + self.static_ids.len() {
            return;
        }
        let projectile = projectile.or_else(|| {
            owner
                .sprite
                .as_ref()
                .and_then(|s| self.game.sprites.get(s))
                .and_then(|s| s.projectile.clone())
        });
        let mut dir = owner.aim;
        if aim != "facing"
            && let Some(target) = self.target(owner, owner.p)
        {
            let delta = target.p - owner.p;
            let lead = if aim == "trajectory" {
                let v = PPM * target.v;
                let s = speed * PPM;
                let a = v.length_squared() - s * s;
                let b = 2.0 * (delta.x * v.x + delta.y * v.y);
                let c = delta.length_squared();
                let disc = b * b - 4.0 * a * c;
                if a.abs() < 0.001 {
                    if b < -0.001 { -c / b } else { 0.0 }
                } else if disc >= 0.0 {
                    [
                        (-b - disc.sqrt()) / (2.0 * a),
                        (-b + disc.sqrt()) / (2.0 * a),
                    ]
                    .into_iter()
                    .filter(|t| *t > 0.0)
                    .min_by(f32::total_cmp)
                    .unwrap_or(0.0)
                } else {
                    0.0
                }
            } else {
                0.0
            };
            let aimed = unit(delta + (PPM * lead) * target.v);
            if aimed.length_squared() > 0.0 {
                dir = aimed;
            }
        }
        let size = projectile
            .as_ref()
            .and_then(|s| self.game.sprites.get(s))
            .map_or((7.0, 7.0), |s| (s.width, s.height));
        let start = owner.p;
        let (layer, team) = (owner.layer + 1, owner.team);
        let physics = Physics::default();
        let bullet = self.add(projectile, None, physics, start, size, (layer, None));
        let actor = self.actors.get_mut(&bullet).unwrap();
        actor.v = speed * dir;
        actor.facing = if dir.x < 0.0 { -1.0 } else { 1.0 };
        actor.team = team;
        self.entity_ids.remove(&bullet);
        actor.bullet = Some(Bullet {
            aim,
            speed,
            damage,
            owner: id,
            remaining: 180,
        });
        self.pending_start.retain(|id| *id != bullet);
    }

    fn move_bullets(&mut self, actions: &mut Vec<Action>) {
        let updates: Vec<_> = self
            .actors
            .values()
            .filter_map(|actor| {
                let bullet = actor.bullet.as_ref()?;
                let mut v = actor.v;
                if bullet.aim == "heat_seek"
                    && let Some(target) =
                        self.target(actor, actor.p).filter(|a| a.id != bullet.owner)
                {
                    let direction = unit(target.p - actor.p);
                    v = bullet.speed * unit(0.92 * unit(v) + 0.08 * direction);
                }
                let delta = (STEP * PPM) * v;
                let hit = self
                    .actors
                    .values()
                    .filter(|other| other.id != bullet.owner && other.bullet.is_none())
                    .filter(|other| {
                        (other.active_solid()
                            && (other.team == 0 || actor.team == 0 || other.team != actor.team))
                            || self.hittable(actor, other)
                    })
                    .filter_map(|other| {
                        segment(
                            actor.p,
                            delta,
                            other.p,
                            actor.width + other.width,
                            actor.height + other.height,
                        )
                        .map(|time| (time, other.id, self.hittable(actor, other)))
                    })
                    .min_by(|a, b| a.0.total_cmp(&b.0));
                Some((actor.id, v, delta, hit))
            })
            .collect();
        for (id, v, delta, hit) in updates {
            let actor = self.actors.get_mut(&id).unwrap();
            let bullet = actor.bullet.as_mut().unwrap();
            bullet.remaining -= 1;
            actor.v = v;
            actor.p += delta;
            if let Some((_, target, true)) = hit {
                actions.push(Action::Damage {
                    source: bullet.owner,
                    target,
                    amount: Some(bullet.damage),
                });
            }
            if hit.is_some() || bullet.remaining == 0 {
                actions.push(Action::Remove(id));
            }
        }
    }
}

fn unit(v: Vec2) -> Vec2 {
    v.normalize_or_zero()
}

fn attack_intersects(owner: &Actor, target: &Actor, range: f32, width: f32) -> bool {
    let forward = owner.aim;
    let side = Vec2::new(-forward.y, forward.x);
    let reach = (owner.width * forward.x.abs() + owner.height * forward.y.abs() + range) / 2.0;
    let delta = target.p - (owner.p + reach * forward);
    let dot = |a: Vec2, b: Vec2| a.x * b.x + a.y * b.y;
    [forward, side, Vec2::new(1.0, 0.0), Vec2::new(0.0, 1.0)]
        .into_iter()
        .all(|axis| {
            let attack_radius =
                (range * dot(forward, axis).abs() + width * dot(side, axis).abs()) / 2.0;
            let target_radius = (target.width * axis.x.abs() + target.height * axis.y.abs()) / 2.0;
            dot(delta, axis).abs() < attack_radius + target_radius
        })
}

fn overlap(p: Vec2, w: f32, h: f32, q: Vec2, tw: f32, th: f32) -> bool {
    (p.x - q.x).abs() * 2.0 < w + tw && (p.y - q.y).abs() * 2.0 < h + th
}

fn segment(p: Vec2, delta: Vec2, q: Vec2, w: f32, h: f32) -> Option<f32> {
    let mut near = 0.0_f32;
    let mut far = 1.0_f32;
    for (start, dir, center, half) in [(p.x, delta.x, q.x, w / 2.0), (p.y, delta.y, q.y, h / 2.0)] {
        if dir.abs() < 0.00001 {
            if (start - center).abs() > half {
                return None;
            }
        } else {
            let a = (center - half - start) / dir;
            let b = (center + half - start) / dir;
            near = near.max(a.min(b));
            far = far.min(a.max(b));
            if near > far {
                return None;
            }
        }
    }
    Some(near)
}

/// Split dialogue at word boundaries for the active pixel viewport.
#[wasm_bindgen]
pub fn dialogue_lines(text: &str, columns: usize) -> String {
    let columns = columns.max(1);
    let mut lines = String::new();
    let mut col = 0;
    for word in text.split_whitespace() {
        if col > 0 {
            if col + 1 + word.chars().count() > columns {
                lines.push('\n');
                col = 0;
            } else {
                lines.push(' ');
                col += 1;
            }
        }
        for ch in word.chars() {
            if col == columns {
                lines.push('\n');
                col = 0;
            }
            lines.push(ch);
            col += 1;
        }
    }
    lines
}
