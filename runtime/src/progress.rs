use super::*;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
struct Save {
    version: u8,
    game: String,
    room: String,
    seed: u32,
    rng: u32,
    players: BTreeMap<usize, [f32; 2]>,
    globals: BTreeMap<String, String>,
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
        let state = Save {
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
                .globals
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            flags: self.flags.keys().map(ToString::to_string).collect(),
            personal: self.personal.clone(),
            inventory: self.inventory.clone(),
            removed: self.removed.clone(),
            counters: self.counters.clone(),
        };
        serde_json::to_string(&state).map_err(|e| e.to_string())
    }
    pub fn load_game(&mut self, data: &str) -> Result<(), String> {
        if data.len() > 4 * 1024 * 1024 {
            return Err("Save is too large".into());
        }
        let state: Save = serde_json::from_str(data).map_err(|e| e.to_string())?;
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
        let mut globals = vm::Variables::new();
        for (name, value) in state.globals {
            let integer = if let Ok(v) = value.parse::<i64>() {
                vm::Integer::Small(v)
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
                vm::Integer::Large(big)
            };
            globals.insert(name.into(), integer);
        }
        self.globals = globals;
        self.flags = state
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
        for actor in self.actors.values_mut() {
            if let Some(pos) = actor.player.and_then(|p| state.players.get(&p)) {
                actor.teleport(Vec2::new(pos[0], pos[1]));
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
                                a.teleport(Vec2::new(
                                    pos.x.clamp(0., dest.size * dest.cols as f32 - 0.01),
                                    pos.y.clamp(0., dest.height - 0.01),
                                ));
                                a.velocity(*v);
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
                            a.teleport(Vec2::new(
                                x.max(a.width / 2.)
                                    .min(dest.cols as f32 * dest.size - a.width / 2.),
                                y.max(a.height / 2.).min(dest.height - a.height / 2.),
                            ));
                            a.velocity(*v);
                        }
                    }
                }
                return Ok(());
            }
        }
        Ok(())
    }
}
