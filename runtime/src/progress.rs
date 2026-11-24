use super::*;
use serde::{Deserialize, Serialize};

const MAX_SAVE_BYTES: usize = 4 * 1024 * 1024;

pub(super) type WorldMemory = BTreeMap<String, BTreeMap<String, Record>>;
#[derive(Clone, Deserialize, Serialize)]
pub(super) struct Record {
    pub xy: [f32; 2],
    pub motion: [f32; 2],
    pub health: f32,
    pub locals: BTreeMap<String, String>,
    pub animation: String,
    pub facing: f32,
}
pub(super) fn variables(source: &BTreeMap<String, String>) -> Result<vm::Variables, String> {
    let mut globals = vm::Variables::new();
    for (name, value) in source {
        let value = if name.starts_with("text.") {
            if value.len() > 4096 {
                return Err("Saved string exceeds 4096 bytes".into());
            }
            vm::Value::Text(Rc::from(value.as_str()))
        } else if name.starts_with("bool.") {
            match value.as_str() {
                "0" => vm::Value::Small(0),
                "1" => vm::Value::Small(1),
                _ => return Err("Invalid saved boolean".into()),
            }
        } else if name.starts_with("real.") {
            let real = value
                .parse::<f64>()
                .ok()
                .filter(|value| value.is_finite())
                .ok_or("Invalid saved real")?;
            vm::Value::Real(real)
        } else if let Ok(v) = value.parse::<i64>() {
            vm::Value::Small(v)
        } else {
            if value.len() > 2468 {
                return Err("Invalid saved integer".into());
            }
            let big = value
                .parse::<num_bigint::BigInt>()
                .map_err(|_| "Invalid saved integer")?;
            if big.bits() > 8192 {
                return Err("Invalid saved integer".into());
            }
            vm::Value::Large(Rc::new(big))
        };
        globals.insert(name.as_str().into(), value);
    }
    Ok(globals)
}
impl Runtime {
    pub(super) fn room_memory(&self) -> BTreeMap<String, Record> {
        let mut records = self.memory.get(&self.room).cloned().unwrap_or_default();
        for a in self.actors.values() {
            if let Some(key) = &a.persistence {
                records.insert(
                    key.clone(),
                    Record {
                        xy: [a.p.x, a.p.y],
                        motion: [a.v.x, a.v.y],
                        health: a.health,
                        locals: a
                            .variables
                            .iter()
                            .map(|(k, v)| (k.to_string(), v.to_string()))
                            .collect(),
                        animation: a.animation.clone(),
                        facing: a.facing,
                    },
                );
            }
        }
        records
    }
}
#[derive(Deserialize, Serialize)]
struct Scene {
    room: String,
    tick: u64,
    next: u32,
    inputs: [u8; 4],
    actors: Vec<SavedActor>,
    gates: Vec<Option<u32>>,
    starts: Vec<u32>,
    #[serde(default, skip_serializing_if = "std::collections::VecDeque::is_empty")]
    broadcasts: std::collections::VecDeque<Broadcast>,
    #[serde(default, skip_serializing_if = "std::collections::VecDeque::is_empty")]
    event_deliveries: std::collections::VecDeque<EventDelivery>,
    #[serde(default)]
    entry_removed: std::collections::BTreeSet<String>,
    pending: Vec<(u32, Spawn)>,
    #[serde(default)]
    particles: particles::Particles,
    menu: Option<Menu>,
    dialog: std::collections::VecDeque<(String, Option<u32>)>,
    camera_actor: Option<u32>,
    group_camera: bool,
    camera_slot: usize,
    camera_point: Option<[f32; 2]>,
    #[serde(default, skip_serializing_if = "RoomSettings::is_default")]
    room_settings: RoomSettings,
    #[serde(default, skip_serializing_if = "GameSettings::is_default")]
    game_settings: GameSettings,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    shapes: Vec<drawing::Shape>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    hud_font: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    hud_text: BTreeMap<String, HudText>,
    icons: BTreeMap<String, [i32; 2]>,
    bars: BTreeMap<String, [i32; 2]>,
    solids: usize,
    layout: String,
}

#[derive(Deserialize, Serialize)]
struct SavedActor {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    hidden: bool,
    #[serde(default)]
    created_at: u64,
    #[serde(default)]
    origin: Option<Spawn>,
    id: u32,
    name: Option<String>,
    sprite: Option<String>,
    tile: Option<Clip>,
    physics: Physics,
    spawn: [f32; 2],
    xy: [f32; 2],
    velocity: [f32; 2],
    angles: [f32; 2],
    dimensions: [f32; 2],
    facing: f32,
    #[serde(default)]
    visual_flip_x: bool,
    #[serde(default)]
    visual_flip_y: bool,
    #[serde(default)]
    visual_rotation: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    shadow: Option<SpriteShadow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    health_bar: Option<HealthBarStyle>,
    aim: [f32; 2],
    player: Option<usize>,
    team: i32,
    layer: i32,
    health: f32,
    animation: String,
    animation_start: u64,
    animation_once: bool,
    animation_finished: bool,
    components: Vec<String>,
    standard_movement: bool,
    tick_gravity: Option<f32>,
    persistence: Option<String>,
    last_spawn: u32,
    answer: i64,
    item_count: u32,
    menu_choice: usize,
    menu_item: String,
    menu_id: String,
    dormant: bool,
    emitter: Option<particles::Emitter>,
    bullet: Option<Bullet>,
    locals: BTreeMap<String, String>,
    scripts: BTreeMap<String, vm::SavedMachine>,
    tick_script: Option<vm::SavedMachine>,
}

impl SavedActor {
    fn capture(actor: &Actor, world: &World) -> Self {
        Self {
            id: actor.id,
            hidden: actor.hidden,
            created_at: actor.created_at,
            origin: actor.origin.clone(),
            name: actor.name.clone(),
            sprite: actor.sprite.clone(),
            tile: actor.tile.clone(),
            physics: actor.physics.clone(),
            spawn: [actor.spawn.x, actor.spawn.y],
            xy: [actor.p.x, actor.p.y],
            velocity: [actor.v.x, actor.v.y],
            dimensions: [actor.width, actor.height],
            angles: actor.body.map_or([0.0; 2], |body| {
                let body = world.body(body);
                [body.rotation().angle(), body.angvel()]
            }),
            facing: actor.facing,
            visual_flip_x: actor.visual_flip_x,
            visual_flip_y: actor.visual_flip_y,
            visual_rotation: actor.visual_rotation,
            shadow: actor.shadow,
            health_bar: actor.health_bar,
            aim: [actor.aim.x, actor.aim.y],
            player: actor.player,
            team: actor.team,
            layer: actor.layer,
            health: actor.health,
            animation: actor.animation.clone(),
            animation_start: actor.animation_start,
            animation_once: actor.animation_once,
            animation_finished: actor.animation_finished,
            components: actor.components.clone(),
            standard_movement: actor.standard_movement,
            tick_gravity: actor.tick_gravity,
            persistence: actor.persistence.clone(),
            last_spawn: actor.last_spawn,
            answer: actor.answer,
            item_count: actor.item_count,
            menu_choice: actor.menu_choice,
            menu_item: actor.menu_item.clone(),
            menu_id: actor.menu_id.clone(),
            dormant: actor.dormant,
            emitter: actor.emitter,
            bullet: actor.bullet.clone(),
            locals: actor
                .variables
                .iter()
                .map(|(key, value)| (key.to_string(), value.to_string()))
                .collect(),
            scripts: actor
                .scripts
                .iter()
                .map(|(event, machine)| (event.clone(), machine.save()))
                .collect(),
            tick_script: actor.tick_script.as_ref().map(vm::Machine::save),
        }
    }

    fn restore(self, runtime: &mut Runtime) -> Result<(), String> {
        runtime.next = self.id;
        let p = Vec2::new(self.xy[0], self.xy[1]);
        let id = runtime.add(
            self.sprite,
            self.tile,
            self.physics,
            p,
            (self.dimensions[0], self.dimensions[1]),
            (self.layer, self.player),
        );
        let actor = runtime.actors.get_mut(&id).unwrap();
        actor.hidden = self.hidden;
        actor.created_at = self.created_at;
        if let Some(name) = &self.name {
            runtime.named_entities.insert(name.clone(), id);
        }
        if self.bullet.is_some() {
            runtime.entity_ids.remove(&id);
        }
        actor.name = self.name;
        actor.origin = self.origin;
        actor.spawn = Vec2::new(self.spawn[0], self.spawn[1]);
        actor.velocity(
            &mut runtime.world,
            Vec2::new(self.velocity[0], self.velocity[1]),
        );
        if let Some(body) = actor.body {
            runtime.world.transform(body, p, self.angles[0]);
            let body = runtime.world.body_mut(body);
            body.set_angvel(self.angles[1], true);
            body.set_enabled(!self.dormant);
        }
        actor.facing = self.facing;
        actor.visual_flip_x = self.visual_flip_x;
        actor.visual_flip_y = self.visual_flip_y;
        actor.visual_rotation = self.visual_rotation;
        actor.shadow = self.shadow;
        actor.health_bar = self.health_bar;
        actor.aim = Vec2::new(self.aim[0], self.aim[1]);
        actor.team = self.team;
        actor.health = self.health;
        actor.animation = self.animation;
        actor.animation_start = self.animation_start;
        actor.animation_once = self.animation_once;
        actor.animation_finished = self.animation_finished;
        actor.components = self.components;
        actor.standard_movement = self.standard_movement;
        actor.tick_gravity = self.tick_gravity;
        actor.persistence = self.persistence;
        actor.last_spawn = self.last_spawn;
        actor.answer = self.answer;
        actor.item_count = self.item_count;
        actor.menu_choice = self.menu_choice;
        actor.menu_item = self.menu_item;
        actor.menu_id = self.menu_id;
        actor.dormant = self.dormant;
        actor.emitter = self.emitter;
        actor.bullet = self.bullet;
        actor.variables = variables(&self.locals)?;
        if let Some(programs) = actor
            .sprite
            .as_ref()
            .and_then(|name| runtime.programs.get(name))
        {
            actor.scripts = self
                .scripts
                .into_iter()
                .filter_map(|(event, saved)| {
                    vm::Machine::restore(programs.get(&event)?.clone(), saved)
                        .map(|machine| (event, machine))
                })
                .collect();
            actor.tick_script = self
                .tick_script
                .and_then(|saved| vm::Machine::restore(programs.get("tick")?.clone(), saved));
        }
        Ok(())
    }
}

impl Scene {
    fn capture(runtime: &Runtime) -> Self {
        Self {
            room: runtime.room.clone(),
            tick: runtime.tick,
            next: runtime.next,
            inputs: runtime.inputs.map(Input::bits),
            actors: runtime
                .actors
                .values()
                .filter(|actor| !runtime.static_ids.contains(&actor.id))
                .map(|actor| SavedActor::capture(actor, &runtime.world))
                .collect(),
            gates: runtime.gates.iter().map(|(_, id)| *id).collect(),
            starts: runtime.pending_start.clone(),
            broadcasts: runtime.broadcasts.clone(),
            event_deliveries: runtime.event_deliveries.clone(),
            entry_removed: runtime.entry_removed.iter().cloned().collect(),
            pending: runtime.pending_instances.clone(),
            particles: runtime.particles.clone(),
            menu: runtime.menu.clone(),
            dialog: runtime.dialog.clone(),
            camera_actor: runtime.camera_actor,
            group_camera: runtime.group_camera,
            camera_slot: runtime.camera_slot,
            camera_point: runtime.camera_point,
            room_settings: runtime.room_settings.clone(),
            game_settings: runtime.game_settings.clone(),
            shapes: runtime.shapes.clone(),
            hud_font: runtime.hud_font.clone(),
            hud_text: runtime.hud_text.clone(),
            icons: runtime.icons.clone(),
            bars: runtime.bars.clone(),
            solids: runtime.static_ids.len(),
            layout: runtime.game.rooms[&runtime.room].layout_key.clone(),
        }
    }

    fn compatible(&self, runtime: &Runtime, room: &Room) -> bool {
        self.solids == room.solids.len()
            && self.layout == room.layout_key
            && self.gates.len()
                == room
                    .entities
                    .iter()
                    .filter(|spawn| !spawn.conditions.is_empty())
                    .count()
            && self.actors.iter().all(|actor| {
                actor
                    .sprite
                    .as_ref()
                    .is_none_or(|id| runtime.game.sprites.contains_key(id))
            })
    }

    fn validate(&self) -> Result<(), String> {
        let ids: HashSet<_> = self.actors.iter().map(|actor| actor.id).collect();
        if self.actors.len() > MAX_ACTORS
            || ids.len() != self.actors.len()
            || self.next == u32::MAX
            || self.tick > u64::MAX / 2000
            || self.solid_id_in_scene()
            || !self.particles.valid_save()
            || self.camera_slot > 3
            || !self.room_settings.valid()
            || !self.game_settings.valid()
            || self.shapes.len() > drawing::LIMIT || self.shapes.iter().any(|shape| !shape.valid())
            || self.pending.len() > MAX_ACTORS
            || self.broadcasts.len() > MAX_BROADCASTS
            || self.event_deliveries.len() > MAX_EVENT_DELIVERIES
            || self
                .broadcasts
                .iter()
                .chain(
                    self.event_deliveries
                        .iter()
                        .map(|delivery| &delivery.signal),
                )
                .any(|signal| signal.name.len() > 64)
            || self.dialog.len() > 32
            || self.hud_font.len() > 64
            || self.hud_text.len() > 64
            || self.hud_text.iter().any(|(label, text)| {
                label.len() > 96
                    || text.value.len() > 4096
                    || text.font.len() > 64
                    || text.offset.iter().any(|n| !(-4096..=4096).contains(n))
            })
            || self
                .camera_point
                .is_some_and(|xy| xy.iter().any(|n| !n.is_finite() || n.abs() > 100_000.))
            || self.menu.as_ref().is_some_and(|menu| {
                !ids.contains(&menu.owner)
                    || menu.options.is_empty()
                    || menu.options.len() > 256
                    || menu.selected >= menu.options.len()
            })
        {
            return Err("Invalid saved room state".into());
        }
        for actor in &self.actors {
            if actor.animation_start > self.tick || actor.created_at > self.tick
                || actor.player.is_some_and(|p| p > 3)
                || actor
                    .xy
                    .iter()
                    .chain(&actor.spawn)
                    .chain(&actor.velocity)
                    .chain(&actor.angles)
                    .chain(&actor.aim)
                    .any(|n| !n.is_finite() || n.abs() > 100_000.)
                || actor.dimensions.iter().any(|n| !(1.0..=8192.0).contains(n))
                || !actor.health.is_finite()
                || !actor.facing.is_finite()
                || !actor.visual_rotation.is_finite()
                || actor
                    .shadow
                    .is_some_and(|shadow| !(1..=100).contains(&shadow.opacity))
                || actor
                    .health_bar
                    .is_some_and(|bar| bar.fill > 0xffffff || bar.track > 0xffffff)
                || actor
                    .emitter
                    .is_some_and(|emitter| emitter.phase >= 60 || emitter.rate > 240)
                || actor.physics.mass.is_some_and(|mass| mass <= 0.0)
                || actor.physics.density <= 0.0
                || actor.physics.density > 100_000.0
            {
                return Err("Invalid saved actor state".into());
            }
            variables(&actor.locals)?;
        }
        Ok(())
    }

    fn solid_id_in_scene(&self) -> bool {
        self.actors
            .iter()
            .any(|actor| {
                if actor.id == 0 { return actor.sprite.as_deref() != Some(GAME_SCRIPT) || actor.player.is_some(); }
                actor.id <= self.solids as u32 || actor.id >= self.next || actor.sprite.as_deref() == Some(GAME_SCRIPT)
            })
    }

    fn restore(self, runtime: &mut Runtime) -> Result<(), String> {
        let discard: Vec<_> = runtime
            .actors
            .keys()
            .filter(|id| !runtime.static_ids.contains(id) && (**id != 0 || self.actors.iter().any(|actor| actor.id == 0)))
            .copied()
            .collect();
        for id in discard {
            if let Some(body) = runtime
                .remove_entity_record(id)
                .and_then(|actor| actor.body)
            {
                runtime.world.remove(body);
            }
        }
        runtime.tick = self.tick;
        for actor in self.actors {
            actor.restore(runtime)?;
        }
        runtime.next = self.next;
        runtime.inputs = self.inputs.map(Input::from_bits);
        runtime.pending_start = self.starts;
        runtime.broadcasts = self.broadcasts;
        runtime.event_deliveries = self.event_deliveries;
        runtime.entry_removed = self.entry_removed.into_iter().collect();
        runtime.pending_instances = self.pending;
        for ((_, current), saved) in runtime.gates.iter_mut().zip(self.gates) {
            *current = saved;
        }
        runtime.camera_actor = self.camera_actor;
        runtime.group_camera = self.group_camera;
        runtime.camera_slot = self.camera_slot;
        runtime.camera_point = self.camera_point;
        runtime.room_settings = self.room_settings;
        runtime.apply_room_border();
        runtime.shapes = self.shapes;
        if !self.game_settings.is_default() {
            runtime.game_settings = self.game_settings;
        }
        if runtime.room_settings.gravity.is_some() {
            runtime.apply_room_gravity();
        }
        runtime.particles = self.particles;
        runtime.menu = self.menu;
        runtime.dialog = self.dialog;
        runtime.hud_font = self.hud_font;
        runtime.hud_text = self.hud_text;
        runtime.icons = self.icons;
        runtime.bars = self.bars;
        runtime.contacts.events.clear();
        Ok(())
    }
}

#[derive(Deserialize, Serialize)]
struct Save {
    #[serde(default)]
    respawns: BTreeMap<String, Vec<PendingRespawn>>,
    #[serde(default)]
    visited: std::collections::BTreeSet<String>,
    #[serde(default)]
    scene: Option<Scene>,
    #[serde(default)]
    memory: WorldMemory,
    version: u8,
    game: String,
    room: String,
    seed: u32,
    rng: u32,
    players: BTreeMap<usize, [f32; 2]>,
    globals: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "collections::Collections::is_empty")]
    collections: collections::Collections,
    flags: Vec<String>,
    #[serde(default)]
    personal: [BTreeMap<String, u32>; 4],
    inventory: BTreeMap<String, u32>,
    #[serde(default)]
    removed: BTreeMap<String, std::collections::BTreeSet<String>>,
    #[serde(default)]
    counters: BTreeMap<String, i32>,
}

#[wasm_bindgen]
impl Runtime {
    pub fn set_seed(&mut self, seed: u32) {
        self.seed = seed.max(1);
        self.rng = self.seed;
    }
    pub fn save_game(&self) -> Result<String, String> {
        let mut memory = self.memory.clone();
        memory.insert(self.room.clone(), self.room_memory());
        let state = Save {
            respawns: self.respawns.clone(),
            visited: self.visited.clone(),
            scene: Some(Scene::capture(self)),
            memory,
            version: 1,
            game: self.game.id.clone(),
            room: self.room.clone(),
            seed: self.seed,
            rng: self.rng,
            players: self
                .actors
                .values()
                .filter_map(|a| Some((a.player?, [a.p.x, a.p.y])))
                .collect(),
            globals: self
                .game_properties.globals
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            collections: self.game_properties.collections.clone(),
            flags: self.game_properties.flags.keys().map(ToString::to_string).collect(),
            personal: self.personal.clone(),
            inventory: self.inventory.clone(),
            removed: self.removed.clone(),
            counters: self.counters.clone(),
        };
        let save = serde_json::to_string(&state).map_err(|error| error.to_string())?;
        if save.len() > MAX_SAVE_BYTES {
            return Err("Save is too large".into());
        }
        Ok(save)
    }
    pub fn load_game(&mut self, data: &str) -> Result<(), String> {
        if data.len() > MAX_SAVE_BYTES {
            return Err("Save is too large".into());
        }
        let mut state: Save = serde_json::from_str(data).map_err(|e| e.to_string())?;
        if state.version != 1
            || state.game != self.game.id
            || !self.game.rooms.contains_key(&state.room)
            || state.globals.len() > 4096
            || state.flags.len() > 4096
            || state.inventory.len() > 1024
            || state
                .players
                .iter()
                .any(|(p, xy)| *p > 3 || xy.iter().any(|x| !x.is_finite() || x.abs() > 65536.))
        {
            return Err("Invalid save for this game".into());
        }
        let globals = variables(&state.globals)?;
        if !state.collections.valid(&self.game.collections) {return Err("Invalid saved collections".into());}
        let collections=if state.collections.is_empty(){collections::Collections::new(&self.game.collections)?}else{state.collections};
        for room in state.memory.values() {
            for record in room.values() {
                if record
                    .xy
                    .iter()
                    .chain(record.motion.iter())
                    .any(|n| !n.is_finite() || n.abs() > 100000.)
                    || !record.health.is_finite()
                {
                    return Err("Invalid saved actor".into());
                }
                variables(&record.locals)?;
            }
        }
        let scene = state.scene.take().filter(|scene| {
            scene.room == state.room
                && scene.compatible(self, &self.game.rooms[&state.room])
                && state.players.iter().all(|(slot, xy)| {
                    scene
                        .actors
                        .iter()
                        .any(|actor| actor.player == Some(*slot) && actor.xy == *xy)
                })
        });
        if let Some(scene) = &scene {
            scene.validate()?;
        }
        if state.respawns.values().any(|queue| {
            queue.len() > MAX_ACTORS
                || queue.iter().any(|entry| {
                    entry
                        .spawn
                        .sprite
                        .as_ref()
                        .is_none_or(|sprite| !self.game.sprites.contains_key(sprite))
                })
        }) {
            return Err("Invalid saved respawn queue".into());
        }
        self.respawns = state.respawns;
        self.actors.clear();
        self.visited = state
            .visited
            .into_iter()
            .filter(|room| self.game.rooms.contains_key(room))
            .collect();
        self.memory = state.memory;
        self.game_properties.collections = collections;
        self.game_properties.globals = globals;
        self.game_properties.flags = state
            .flags
            .into_iter()
            .map(|n| (n.into(), 1.into()))
            .collect();
        self.personal = state.personal;
        self.inventory = state.inventory;
        self.removed = state.removed;
        self.seed = state.seed.max(1);
        self.rng = state.rng.max(1);
        self.inputs = Default::default();
        self.transition = None;
        self.tick = 0;
        self.load(&state.room)?;
        self.counters = state.counters;
        self.restored = true;
        if let Some(scene) = scene {
            scene.restore(self)?;
        } else {
            self.pending_start.clear();
            for actor in self.actors.values_mut() {
                if let Some(pos) = actor.player.and_then(|p| state.players.get(&p)) {
                    actor.teleport(&mut self.world, Vec2::new(pos[0], pos[1]));
                }
            }
        }
        Ok(())
    }
}

impl Runtime {
    pub(super) fn cross_exit(&mut self, inputs: &[Input; 4]) -> Result<(), String> {
        let room = &self.game.rooms[&self.room];
        if room.exits.is_empty() {
            return Ok(());
        }
        for actor in self.actors.values().filter(|a| a.player.is_some()) {
            let input = inputs[actor.player.unwrap()];
            let edges = [
                ("left", input.left && actor.p.x - actor.width / 2. <= 1.),
                (
                    "right",
                    input.right
                        && actor.p.x + actor.width / 2. >= room.size * room.cols as f32 - 1.,
                ),
                ("up", input.up && actor.p.y - actor.height / 2. <= 1.),
                (
                    "down",
                    input.down && actor.p.y + actor.height / 2. >= room.height - 1.,
                ),
            ];
            for (edge, hit) in edges {
                let seam = room.seams.contains_key(edge);
                let old_width = room.size * room.cols as f32;
                let old_height = room.height;
                let crossed = match edge {
                    "left" => actor.p.x < 0.,
                    "right" => actor.p.x >= old_width,
                    "up" => actor.p.y < 0.,
                    _ => actor.p.y >= old_height,
                };
                let Some(exit) = room
                    .exits
                    .get(edge)
                    .filter(|_| if seam { crossed } else { hit })
                else {
                    continue;
                };
                if exit.targets.is_empty()
                    || exit
                        .flag
                        .as_ref()
                        .is_some_and(|flag| self.flag(flag) != exit.when)
                {
                    continue;
                }
                let key = match exit.mode.as_str() {
                    "save" => self
                        .room
                        .bytes()
                        .chain(edge.bytes())
                        .fold(self.seed, |h, b| (h ^ b as u32).wrapping_mul(16777619)),
                    "crossing" => {
                        self.rng ^= self.rng << 13;
                        self.rng ^= self.rng >> 17;
                        self.rng ^= self.rng << 5;
                        self.rng
                    }
                    _ => 0,
                };
                let target = exit.targets[key as usize % exit.targets.len()].clone();
                let adjacent = exit.adjacent;
                let positions: Vec<_> = self
                    .actors
                    .values()
                    .filter_map(|a| Some((a.player?, a.p, a.v)))
                    .collect();
                self.load(&target)?;
                if adjacent {
                    let dest = &self.game.rooms[&target];
                    for a in self.actors.values_mut() {
                        if let Some((_, p, v)) = positions
                            .iter()
                            .find(|(slot, _, _)| Some(*slot) == a.player)
                        {
                            if seam {
                                let pos = Vec2::new(
                                    p.x + match edge {
                                        "left" => dest.size * dest.cols as f32,
                                        "right" => -old_width,
                                        _ => 0.,
                                    },
                                    p.y + match edge {
                                        "up" => dest.height,
                                        "down" => -old_height,
                                        _ => 0.,
                                    },
                                );
                                a.teleport(
                                    &mut self.world,
                                    Vec2::new(
                                        pos.x.clamp(0., dest.size * dest.cols as f32 - 0.01),
                                        pos.y.clamp(0., dest.height - 0.01),
                                    ),
                                );
                                a.velocity(&mut self.world, *v);
                                continue;
                            }
                            let x = match edge {
                                "right" => a.width / 2. + 2.,
                                "left" => dest.cols as f32 * dest.size - a.width / 2. - 2.,
                                _ => p.x,
                            };
                            let y = match edge {
                                "down" => a.height / 2. + 2.,
                                "up" => dest.height - a.height / 2. - 2.,
                                _ => p.y,
                            };
                            a.teleport(
                                &mut self.world,
                                Vec2::new(
                                    x.max(a.width / 2.)
                                        .min(dest.cols as f32 * dest.size - a.width / 2.),
                                    y.max(a.height / 2.).min(dest.height - a.height / 2.),
                                ),
                            );
                            a.velocity(&mut self.world, *v);
                        }
                    }
                }
                return Ok(());
            }
        }
        Ok(())
    }
}

#[cfg(feature = "rollback")]
#[derive(Deserialize, Serialize)]
struct RollbackActor {
    id: u32,
    body: Option<Body>,
    collider_frame: Option<String>,
    bounds: [f32; 4],
}

#[cfg(feature = "rollback")]
#[derive(Deserialize, Serialize)]
struct Rollback<W> {
    version: u8,
    room: String,
    layout: String,
    tick: u64,
    world: W,
    actors: Vec<RollbackActor>,
    touching: physics::ContactPairs,
    prior_buttons: [u8; 4],
    view_size: [u32; 2],
    restored: bool,
    gates_dirty: bool,
    checkpoint: Option<String>,
    checkpoint_requested: bool,
    transition: Option<String>,
    retry: bool,
}

#[cfg(feature = "rollback")]
impl Runtime {
    /// Write the Rapier state used by rollback alongside the portable game save.
    pub fn save_rollback(&self) -> Result<Vec<u8>, String> {
        let state = Rollback {
            version: 1,
            room: self.room.clone(),
            layout: self.game.rooms[&self.room].layout_key.clone(),
            tick: self.tick,
            world: &self.world,
            actors: self
                .actors
                .values()
                .map(|actor| RollbackActor {
                    id: actor.id,
                    body: actor.body,
                    collider_frame: actor.collider_frame.clone(),
                    bounds: actor.collider_bounds,
                })
                .collect(),
            touching: self.contacts.pairs.clone(),
            prior_buttons: self.prior_buttons,
            view_size: self.view_size,
            restored: self.restored,
            gates_dirty: self.gates_dirty,
            checkpoint: self.checkpoint.clone(),
            checkpoint_requested: self.checkpoint_requested,
            transition: self.transition.clone(),
            retry: self.retry,
        };
        let mut bytes = Vec::new();
        ciborium::into_writer(&state, &mut bytes).map_err(|error| error.to_string())?;
        Ok(miniz_oxide::deflate::compress_to_vec_zlib(&bytes, 1))
    }

    /// Restore solver contacts, rigid bodies and script scheduler state for an exact replay.
    pub fn load_rollback(&mut self, save: &str, physics: &[u8]) -> Result<(), String> {
        let bytes =
            miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(physics, 64 * 1024 * 1024)
                .map_err(|_| "Invalid rollback data")?;
        let state: Rollback<World> =
            ciborium::from_reader(bytes.as_slice()).map_err(|error| error.to_string())?;
        let portable: Save = serde_json::from_str(save).map_err(|error| error.to_string())?;
        let valid = state.version == 1
            && portable.room == state.room
            && self
                .game
                .rooms
                .get(&state.room)
                .is_some_and(|room| room.layout_key == state.layout)
            && portable
                .scene
                .as_ref()
                .is_some_and(|scene| scene.tick == state.tick)
            && state.view_size.iter().all(|n| (64..=512).contains(n))
            && state.actors.iter().all(|actor| {
                actor
                    .body
                    .is_none_or(|body| state.world.contains(body, actor.id))
                    && actor
                        .bounds
                        .iter()
                        .all(|n| n.is_finite() && n.abs() <= 16_384.)
            });
        if !valid {
            return Err("Rollback state does not match this cartridge".into());
        }
        self.load_game(save)?;
        if self.actors.len() != state.actors.len()
            || self
                .actors
                .keys()
                .copied()
                .ne(state.actors.iter().map(|actor| actor.id))
        {
            return Err("Rollback entity list does not match the saved scene".into());
        }
        for record in state.actors {
            let actor = self.actors.get_mut(&record.id).unwrap();
            actor.body = record.body;
            actor.collider_bounds = record.bounds;
            actor.collider_frame = record.collider_frame;
        }
        self.world = state.world;
        self.contacts.pairs = state.touching;
        self.prior_buttons = state.prior_buttons;
        self.view_size = state.view_size;
        self.restored = state.restored;
        self.gates_dirty = state.gates_dirty;
        self.checkpoint = state.checkpoint;
        self.checkpoint_requested = state.checkpoint_requested;
        self.transition = state.transition;
        self.retry = state.retry;
        Ok(())
    }
}
