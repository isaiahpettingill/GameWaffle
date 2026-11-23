mod camera;
mod model;
mod path;
mod physics;
mod vm;

pub use camera::{Camera, viewport};
pub use model::{ActorView, Input, RuntimeEvent, Snapshot};

use box2d_rs::b2_math::B2vec2 as Vec2;
use model::*;
use physics::{Body, Contacts, PPM, World};
use serde_json::Value;
use std::{
    cell::RefCell,
    collections::{BTreeMap, HashSet},
    rc::Rc,
};
use wasm_bindgen::prelude::*;

const STEP: f32 = 1.0 / 60.0;
const MAX_ACTORS: usize = 4096;
const MAX_ACTIONS: usize = MAX_ACTORS * 8;

struct Bullet {
    aim: String,
    speed: f32,
    damage: f32,
    owner: u32,
    remaining: u32,
}

struct Actor {
    id: u32,
    name: Option<String>,
    sprite: Option<String>,
    tile: Option<Clip>,
    physics: Physics,
    body: Option<Body>,
    spawn: Vec2,
    p: Vec2,
    v: Vec2,
    width: f32,
    height: f32,
    facing: f32,
    aim: Vec2,
    player: Option<usize>,
    team: i32,
    layer: i32,
    health: f32,
    animation: String,
    animation_start: u64,
    bullet: Option<Bullet>,
    variables: vm::Variables,
    scripts: BTreeMap<String, vm::Machine>,
    tick_script: Option<vm::Machine>,
}

impl Actor {
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

    fn velocity(&mut self, velocity: Vec2) {
        self.v = velocity;
        if let Some(body) = &self.body {
            body.borrow_mut().set_linear_velocity(velocity);
        }
    }
    fn teleport(&mut self, p: Vec2) {
        self.p = p;
        self.velocity(Vec2::zero());
        if let Some(body) = &self.body {
            body.borrow_mut().set_transform((1.0 / PPM) * p, 0.0);
        }
    }
    fn active_solid(&self) -> bool {
        matches!(
            self.physics.mode,
            Mode::Static | Mode::Dynamic | Mode::Kinematic | Mode::OneWay | Mode::Breakable
        )
    }
}

enum Action {
    Damage {
        source: u32,
        target: u32,
        amount: f32,
    },
    Remove(u32),
    Fire(u32, String, f32, f32),
    Instance(Spawn),
}

#[wasm_bindgen]
pub struct Runtime {
    game: Game,
    room: String,
    world: World,
    contacts: Rc<RefCell<Contacts>>,
    actors: BTreeMap<u32, Actor>,
    static_ids: HashSet<u32>,
    tick: u64,
    next: u32,
    inputs: [Input; 4],
    blocked: HashSet<usize>,
    sounds: Vec<String>,
    events: Vec<RuntimeEvent>,
    transition: Option<String>,
    pending_start: Vec<u32>,
    pending_instances: Vec<Spawn>,
    programs: BTreeMap<String, vm::Programs>,
    legacy_programs: BTreeMap<String, BTreeMap<String, Rc<Vec<Vec<Value>>>>>,
    globals: vm::Variables,
    flags: vm::Variables,
    script_fuel: usize,
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
        let game = if let Some(payload) = bytes.strip_prefix(b"GWAF\x00\x01") {
            #[derive(serde::Deserialize)]
            struct Legacy {
                start: String,
                rooms: Value,
                sprites: Value,
            }
            let metadata: Legacy = ciborium::from_reader(payload).map_err(|e| e.to_string())?;
            Game {
                globals: Default::default(),
                flags: Default::default(),
                start: metadata.start,
                rooms: serde_json::from_value(metadata.rooms).map_err(|e| e.to_string())?,
                sprites: serde_json::from_value(metadata.sprites).map_err(|e| e.to_string())?,
            }
        } else if bytes.starts_with(b"GWAF\x00\x02") && bytes.len() >= 14 {
            let packed = u32::from_le_bytes(bytes[6..10].try_into().unwrap()) as usize;
            let size = u32::from_le_bytes(bytes[10..14].try_into().unwrap()) as usize;
            let end = 14usize
                .checked_add(packed)
                .ok_or("Invalid cartridge size")?;
            if packed == 0 || size == 0 || size > 32 * 1024 * 1024 || end >= bytes.len() {
                return Err("Invalid cartridge section lengths".into());
            }
            let data = miniz_oxide::inflate::decompress_to_vec_with_limit(&bytes[14..end], size)
                .map_err(|_| "Cannot decompress simulation data")?;
            if data.len() != size {
                return Err("Invalid simulation data length".into());
            }
            // Legacy authoring numbers can be CBOR integers or floats, both accepted by the JSON model.
            let game: Game = ciborium::from_reader(&data[..]).map_err(|error| error.to_string())?;
            game
        } else {
            return Err("Unsupported cartridge format".into());
        };
        Self::from_game(game, room)
    }

    pub fn step_buttons(&mut self, buttons: u32) -> Result<String, String> {
        self.step_inputs(std::array::from_fn(|index| {
            Input::from_bits((buttons >> (index * 8)) as u8)
        }))?;
        self.snapshot()
    }

    pub fn step(&mut self, input_json: &str) -> Result<String, String> {
        let inputs: [Input; 4] = serde_json::from_str(input_json).map_err(|err| err.to_string())?;
        self.step_inputs(inputs)?;
        self.snapshot()
    }

    pub fn snapshot(&self) -> Result<String, String> {
        serde_json::to_string(&self.view()).map_err(|error| error.to_string())
    }

    pub fn reset(&mut self) -> Result<(), String> {
        self.inputs = [Input::default(); 4];
        self.tick = 0;
        self.transition = None;
        self.reset_variables();
        self.load(&self.game.start.clone())
    }
}

impl Runtime {
    pub fn view(&self) -> Snapshot<'_> {
        let actors = self
            .actors
            .values()
            .filter(|actor| !self.static_ids.contains(&actor.id))
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
                    .map_or("", |clip| clip.image(elapsed));
                ActorView {
                    id: actor.id,
                    name: actor.name.as_deref(),
                    x: actor.p.x,
                    y: actor.p.y,
                    width: actor.width,
                    height: actor.height,
                    angle: actor
                        .body
                        .as_ref()
                        .map_or(0.0, |body| body.borrow().get_angle()),
                    layer: actor.layer,
                    facing: actor.facing,
                    image,
                    player: actor.player,
                    health: actor.health,
                }
            })
            .collect();
        Snapshot {
            room: &self.room,
            tick: self.tick,
            actors,
            sounds: &self.sounds,
            events: &self.events,
        }
    }

    pub fn room(&self) -> &str {
        &self.room
    }

    pub fn sounds(&self) -> &[String] {
        &self.sounds
    }

    pub fn events(&self) -> &[RuntimeEvent] {
        &self.events
    }

    pub fn scripted_global(&self, name: &str) -> String {
        self.globals
            .get(name)
            .map_or_else(|| "0".into(), ToString::to_string)
    }

    pub fn flag(&self, name: &str) -> bool {
        self.flags.contains_key(name)
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

    fn reset_variables(&mut self) {
        self.globals = self
            .game
            .globals
            .iter()
            .filter(|(_, value)| **value != 0)
            .map(|(key, value)| (Rc::from(key.as_str()), (*value).into()))
            .collect();
        self.flags = self
            .game
            .flags
            .iter()
            .filter(|(_, value)| **value)
            .map(|(key, _)| (Rc::from(key.as_str()), 1.into()))
            .collect();
    }

    fn from_game(mut game: Game, room: Option<String>) -> Result<Self, String> {
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
        let mut programs = BTreeMap::new();
        let mut legacy_programs = BTreeMap::new();
        for (id, sprite) in &mut game.sprites {
            let events = std::mem::take(&mut sprite.program)
                .into_iter()
                .map(|(event, encoded)| {
                    let program = vm::Program::decode(encoded)
                        .map_err(|error| format!("{id}/{event}: {error}"))?;
                    Ok::<_, String>((event, Rc::new(program)))
                })
                .collect::<Result<_, _>>()?;
            programs.insert(id.clone(), events);
            if !sprite.code.is_empty() {
                legacy_programs.insert(
                    id.clone(),
                    std::mem::take(&mut sprite.code)
                        .into_iter()
                        .map(|(event, body)| (event, Rc::new(body)))
                        .collect(),
                );
            }
        }
        let (world, contacts) = physics::world(0.0);
        let start = room.unwrap_or_else(|| game.start.clone());
        let mut rt = Runtime {
            game,
            room: String::new(),
            world,
            contacts,
            actors: BTreeMap::new(),
            static_ids: HashSet::new(),
            tick: 0,
            next: 1,
            inputs: [Input::default(); 4],
            blocked: HashSet::new(),
            sounds: Vec::new(),
            events: Vec::new(),
            transition: None,
            pending_start: Vec::new(),
            pending_instances: Vec::new(),
            programs,
            legacy_programs,
            globals: Default::default(),
            flags: Default::default(),
            script_fuel: 0,
        };
        rt.reset_variables();
        rt.load(&start)?;
        Ok(rt)
    }

    fn load(&mut self, id: &str) -> Result<(), String> {
        let room = self.game.rooms.get(id).ok_or("Unknown room")?.clone();
        self.actors.clear();
        (self.world, self.contacts) = physics::world(room.gravity);
        self.room = id.into();
        self.blocked = room.blockers.iter().copied().collect();
        self.static_ids.clear();
        self.pending_start.clear();
        self.pending_instances.clear();
        self.sounds.clear();
        self.events.clear();
        self.next = 1;
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
        }
        for spawn in room.entities {
            self.add_scene_actor(spawn, room.size)?;
        }
        Ok(())
    }

    fn add_scene_actor(&mut self, spawn: Spawn, size: f32) -> Result<(), String> {
        let definition = match spawn.sprite.as_ref() {
            Some(key) => Some(self.game.sprites.get(key).ok_or("Unknown sprite in room")?),
            None => None,
        };
        let config = spawn.physics.unwrap_or_else(|| {
            definition.map_or_else(Physics::default, |sprite| sprite.physics.clone())
        });
        let size = definition.map_or((size, size), |sprite| (sprite.width, sprite.height));
        let layer = spawn
            .layer
            .unwrap_or_else(|| definition.map_or(0, |sprite| sprite.layer));
        let clip = spawn.clip.map(|frames| Clip { frames, repeat: 0 });
        let id = self.add(
            spawn.sprite,
            clip,
            config,
            Vec2::new(spawn.x, spawn.y),
            size,
            (layer, spawn.player.filter(|slot| *slot < 4)),
        );
        let actor = self.actors.get_mut(&id).unwrap();
        actor.name = spawn.name;
        if let Some(animation) = spawn.animation {
            actor.animation = animation;
        }
        if spawn.flip_x == Some(true) {
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
        let body = physics::body(&self.world, id, p, width, height, &physics);
        let health = physics.health;
        if sprite.is_some() {
            self.pending_start.push(id);
        }
        self.actors.insert(
            id,
            Actor {
                id,
                name: None,
                sprite,
                tile,
                physics,
                body,
                spawn: p,
                p,
                width,
                height,
                v: Vec2::zero(),
                facing: 1.0,
                aim: Vec2::new(1.0, 0.0),
                player,
                team,
                layer,
                health,
                animation,
                animation_start: self.tick,
                bullet: None,
                variables: Default::default(),
                scripts: Default::default(),
                tick_script: None,
            },
        );
        id
    }

    pub fn step_inputs(&mut self, inputs: [Input; 4]) -> Result<(), String> {
        self.sounds.clear();
        self.events.clear();
        self.tick += 1;
        self.script_fuel = 262144;
        let mut actions = Vec::new();
        let suspended: Vec<_> = self
            .actors
            .values()
            .flat_map(|actor| {
                actor
                    .scripts
                    .keys()
                    .map(move |event| (actor.id, event.clone()))
            })
            .collect();
        for (id, event) in suspended {
            if event != "tick" {
                self.run_script(id, &event, &inputs, &mut actions, false);
            }
        }
        for id in std::mem::take(&mut self.pending_start) {
            self.run(id, "start", &inputs, &mut actions);
        }
        let scripted: Vec<_> = self
            .actors
            .values()
            .filter(|actor| actor.sprite.is_some() && actor.bullet.is_none())
            .map(|actor| (actor.id, actor.player))
            .collect();
        for (id, player) in scripted {
            self.run(id, "tick", &inputs, &mut actions);
            if let Some(slot) = player {
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
        self.apply(&mut actions, &inputs);
        if let Some(room) = self.transition.take() {
            return self.load(&room);
        }

        self.zones(&inputs, &mut actions);
        self.move_bullets(&mut actions);
        {
            let mut contacts = self.contacts.borrow_mut();
            contacts.previous.clear();
            let top_down = self.game.rooms[&self.room].is_top_down();
            for actor in self.actors.values() {
                let drop = !top_down && actor.player.is_some_and(|slot| self.inputs[slot].down);
                contacts
                    .previous
                    .insert(actor.id, ((actor.p.y + actor.height / 2.0) / PPM, drop));
            }
        }
        self.world.borrow_mut().step(STEP, 8, 3);
        let height = self.game.rooms[&self.room].height;
        for actor in self.actors.values_mut() {
            if let Some(body) = &actor.body {
                let body = body.borrow();
                actor.p = PPM * body.get_position();
                actor.v = body.get_linear_velocity();
            } else if actor.bullet.is_none() {
                actor.p += (PPM * STEP) * actor.v;
            }
            if actor.p.y > height + PPM * 4.0 {
                if actor.player.is_some() {
                    actor.teleport(actor.spawn);
                } else {
                    actions.push(Action::Remove(actor.id));
                }
            }
        }
        let events = std::mem::take(&mut self.contacts.borrow_mut().events);
        for (began, a, b) in events {
            self.events.push(RuntimeEvent::Contact { began, a, b });
            let event = if began {
                "begin_contact"
            } else {
                "end_contact"
            };
            self.run(a, event, &inputs, &mut actions);
            self.run(b, event, &inputs, &mut actions);
        }
        self.apply(&mut actions, &inputs);
        let size = self.game.rooms[&self.room].size;
        for spawn in std::mem::take(&mut self.pending_instances) {
            if self.actors.len() >= MAX_ACTORS + self.static_ids.len() {
                break;
            }
            self.add_scene_actor(spawn, size)?;
        }
        Ok(())
    }

    fn run(&mut self, id: u32, event: &str, inputs: &[Input; 4], actions: &mut Vec<Action>) {
        if self.run_script(id, event, inputs, actions, true) {
            return;
        }
        let Some(actor) = self.actors.get(&id) else {
            return;
        };
        let Some(code) = actor
            .sprite
            .as_ref()
            .and_then(|s| self.legacy_programs.get(s))
            .and_then(|events| events.get(event))
            .cloned()
        else {
            return;
        };
        let input = actor.player.map_or(Input::default(), |slot| inputs[slot]);
        for op in code.iter() {
            let Some(opcode) = op.first().and_then(Value::as_u64) else {
                continue;
            };
            let arg = |index: usize| op.get(index).and_then(Value::as_f64).unwrap_or(0.0) as f32;
            let name = op.get(1).and_then(Value::as_str).unwrap_or("");
            self.engine(id, input, opcode, [arg(1), arg(2), arg(3)], name, actions);
        }
    }

    fn run_script(
        &mut self,
        id: u32,
        event: &str,
        inputs: &[Input; 4],
        actions: &mut Vec<Action>,
        start: bool,
    ) -> bool {
        let Some(actor) = self.actors.get_mut(&id) else {
            return false;
        };
        let Some(program) = actor
            .sprite
            .as_ref()
            .and_then(|sprite| self.programs.get(sprite))
            .and_then(|events| events.get(event))
        else {
            return false;
        };
        let previous = if event == "tick" {
            actor.tick_script.take()
        } else {
            actor.scripts.remove(event)
        };
        let mut machine = match previous {
            Some(machine) if event != "tick" && start => {
                actor.scripts.insert(event.into(), machine);
                return true;
            }
            Some(machine) => machine,
            None if start => vm::Machine::new(program.clone()),
            None => return true,
        };
        let input = actor.player.map_or(Input::default(), |slot| inputs[slot]);
        match machine.run(self, id, input, actions) {
            Ok(finished) if event == "tick" => {
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

    fn engine(
        &mut self,
        id: u32,
        input: Input,
        opcode: u64,
        args: [f32; 3],
        name: &str,
        actions: &mut Vec<Action>,
    ) {
        if actions.len() >= MAX_ACTIONS {
            return;
        }
        let arg = |index: usize| args[index - 1];
        let top_down = self.game.rooms[&self.room].is_top_down();
        match opcode {
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
                actor.velocity(velocity);
            }
            1 if !top_down && !input.down && self.grounded(id) => {
                let actor = self.actors.get_mut(&id).unwrap();
                actor.velocity(Vec2::new(actor.v.x, -arg(1)));
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
                            amount: arg(1),
                        });
                    }
                }
            }
            3 if arg(2) > 0.0 && arg(3) > 0.0 => {
                actions.push(Action::Fire(id, name.into(), arg(2).min(100.0), arg(3)))
            }
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
                let v = destination
                    .and_then(|to| {
                        path::waypoint(&self.game.rooms[&self.room], p, to, &self.blocked)
                    })
                    .map_or(Vec2::zero(), |to| arg(1) * unit(to - p));
                let actor = self.actors.get_mut(&id).unwrap();
                actor.face(v, top_down);
                actor.velocity(v);
            }
            5 if self.sounds.len() < 64 => self.sounds.push(name.into()),
            6 => self
                .actors
                .get_mut(&id)
                .unwrap()
                .velocity(Vec2::new(arg(1), arg(2))),
            7 => {
                let actor = self.actors.get_mut(&id).unwrap();
                if actor.animation != name {
                    actor.animation = name.into();
                    actor.animation_start = self.tick;
                }
            }
            8 if self.game.rooms.contains_key(name) && name != self.room => {
                self.transition = Some(name.into())
            }
            9 if self.game.sprites.contains_key(name) => {
                let p = self.actors[&id].p;
                actions.push(Action::Instance(Spawn {
                    sprite: Some(name.into()),
                    x: p.x + arg(2),
                    y: p.y + arg(3),
                    ..Spawn::default()
                }));
            }
            _ => {}
        }
    }

    fn grounded(&self, id: u32) -> bool {
        let actor = &self.actors[&id];
        let bottom = actor.p.y + actor.height / 2.0;
        actor.v.y >= -0.1
            && self.actors.values().any(|other| {
                let top = other.p.y - other.height / 2.0;
                other.id != id
                    && other.active_solid()
                    && physics::allows(&actor.physics, &other.physics)
                    && (top - bottom).abs() < 3.0
                    && (actor.p.x - other.p.x).abs() < (actor.width + other.width) / 2.0 - 0.5
            })
    }

    fn hittable(&self, owner: &Actor, target: &Actor) -> bool {
        owner.id != target.id
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
                Action::Fire(id, aim, speed, damage) => self.fire(id, aim, speed, damage),
                Action::Instance(spawn) => {
                    if self.pending_instances.len() < MAX_ACTORS {
                        self.pending_instances.push(spawn);
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
                    actor.health -= amount;
                    self.events.push(RuntimeEvent::Damage {
                        source,
                        target: id,
                        amount,
                    });
                    let dead = actor.health <= 0.0;
                    self.run(id, "damage", inputs, actions);
                    if dead {
                        actions.push(Action::Remove(id));
                    }
                }
                Action::Remove(id) => {
                    self.run(id, "destroy", inputs, actions);
                    if let Some(mut actor) = self.actors.remove(&id) {
                        if actor.player.is_some() {
                            actor.health = actor.physics.health;
                            actor.teleport(actor.spawn);
                            self.actors.insert(id, actor);
                        } else if let Some(body) = actor.body {
                            self.world.borrow_mut().destroy_body(body);
                        }
                    }
                }
            }
            queue.extend(actions.drain(..));
        }
    }

    fn zones(&mut self, inputs: &[Input; 4], actions: &mut Vec<Action>) {
        let zones: Vec<_> = self
            .actors
            .values()
            .filter(|a| matches!(a.physics.mode, Mode::Fluid | Mode::Ladder))
            .map(|a| (a.id, a.p, a.width, a.height, a.physics.clone()))
            .collect();
        for actor in self
            .actors
            .values_mut()
            .filter(|a| a.physics.mode == Mode::Dynamic)
        {
            let mut gravity = actor.physics.gravity;
            let mut fluid_drag = 0.0_f32;
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
                    gravity = gravity.min(
                        actor.physics.gravity
                            * (1.0 - zone.buoyancy * zone.density / actor.physics.density),
                    );
                    fluid_drag = fluid_drag.max(zone.drag);
                    if zone.damage > 0.0 && actor.sprite.is_some() {
                        actions.push(Action::Damage {
                            source: *id,
                            target: actor.id,
                            amount: zone.damage * STEP,
                        });
                    }
                }
            }
            if ladder && !self.game.rooms[&self.room].is_top_down() && actor.player.is_some() {
                let input = inputs[actor.player.unwrap()];
                gravity = 0.0;
                let dy = (f32::from(input.down) - f32::from(input.up)) * 3.5;
                actor.velocity(Vec2::new(actor.v.x, dy));
            }
            if let Some(body) = &actor.body {
                let mut body = body.borrow_mut();
                body.set_gravity_scale(gravity.clamp(-8.0, 8.0));
                body.set_linear_damping(fluid_drag);
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

    fn fire(&mut self, id: u32, aim: String, speed: f32, damage: f32) {
        let Some(owner) = self.actors.get(&id) else {
            return;
        };
        if self.actors.len() >= MAX_ACTORS + self.static_ids.len() {
            return;
        }
        let projectile = owner
            .sprite
            .as_ref()
            .and_then(|s| self.game.sprites.get(s))
            .and_then(|s| s.projectile.clone());
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
                    amount: bullet.damage,
                });
            }
            if hit.is_some() || bullet.remaining == 0 {
                actions.push(Action::Remove(id));
            }
        }
    }
}

fn unit(mut v: Vec2) -> Vec2 {
    v.normalize();
    v
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
