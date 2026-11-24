use crate::{ActorView, Runtime, vm};
use serde::{Serialize, Serializer};
use std::collections::BTreeMap;

const ACTOR_STRIDE: usize = 44;

pub(crate) fn inspect(runtime: &Runtime, id: u32) -> Result<Vec<u8>, String> {
    #[derive(Serialize)]
    struct Entity<'a> {
        id: u32,
        name: Option<&'a str>,
    }

    #[derive(Serialize)]
    struct Inspection<'a> {
        room: &'a str,
        tick: u64,
        actor: u32,
        sprite: Option<&'a str>,
        entities: Vec<Entity<'a>>,
        globals: BTreeMap<&'a str, String>,
        locals: BTreeMap<&'a str, String>,
        flags: BTreeMap<&'a str, String>,
    }

    fn values(table: &vm::Variables) -> BTreeMap<&str, String> {
        table
            .iter()
            .map(|(key, value)| (key.as_ref(), value.to_string()))
            .collect()
    }

    let actor = runtime.actors.get(&id);
    let state = Inspection {
        room: &runtime.room,
        tick: runtime.tick,
        actor: id,
        sprite: actor.and_then(|actor| actor.sprite.as_deref()),
        entities: runtime
            .entity_ids
            .iter()
            .filter_map(|id| runtime.actors.get(id))
            .map(|actor| Entity {
                id: actor.id,
                name: actor.name.as_deref().or(actor.sprite.as_deref()),
            })
            .collect(),
        globals: values(&runtime.game_properties.globals),
        locals: actor.map_or_else(BTreeMap::new, |actor| values(&actor.variables)),
        flags: values(&runtime.game_properties.flags),
    };
    let mut bytes = Vec::new();
    ciborium::into_writer(&state, &mut bytes).map_err(|error| error.to_string())?;
    Ok(bytes)
}

pub(crate) fn actors<S: Serializer>(
    actors: &[ActorView<'_>],
    serializer: S,
) -> Result<S::Ok, S::Error> {
    #[derive(Serialize)]
    struct Packed<'a, 'view> {
        #[serde(with = "serde_bytes")]
        data: Vec<u8>,
        details: Details<'a, 'view>,
    }

    let mut data = Vec::with_capacity(actors.len() * ACTOR_STRIDE);
    for actor in actors {
        data.extend(actor.id.to_le_bytes());
        data.extend(actor.clone_source.unwrap_or(0).to_le_bytes());
        for value in [
            actor.x,
            actor.y,
            actor.width,
            actor.height,
            actor.angle,
            actor.facing,
            actor.health,
        ] {
            data.extend(value.to_le_bytes());
        }
        data.extend(actor.layer.to_le_bytes());
        let player = actor.player.map_or(0, |slot| slot as u32 + 1);
        data.extend((player << 1 | u32::from(actor.flip_y)).to_le_bytes());
    }
    Packed {
        data,
        details: Details(actors),
    }
    .serialize(serializer)
}

struct Details<'a, 'view>(&'a [ActorView<'view>]);

impl Serialize for Details<'_, '_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_seq(self.0.iter().map(|actor| {
            (
                actor.image,
                actor.name,
                actor.shadow.as_ref(),
                actor.health_bar.as_ref(),
            )
        }))
    }
}
