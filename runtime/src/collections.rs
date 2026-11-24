use crate::vm::Value;
use num_bigint::BigInt;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    rc::Rc,
};

const MAX_ENTRIES: usize = 4096;
const MAX_COLLECTION_BYTES: usize = 2 * 1024 * 1024;

#[derive(Default, Deserialize)]
#[serde(default)]
pub struct Schema {
    types: BTreeMap<String, BTreeMap<String, Property>>,
    inventories: BTreeMap<String, Vec<String>>,
    arrays: BTreeMap<String, String>,
    game: Option<String>,
    players: Option<String>,
}

#[derive(Deserialize)]
struct Property {
    #[serde(rename = "type")]
    kind: String,
    default: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
enum Member {
    Integer(i64),
    Large(#[serde(with = "decimal_integer")] Rc<BigInt>),
    Real(f64),
    Boolean(bool),
    Text(Rc<str>),
    Object(Option<Rc<Object>>),
}

mod decimal_integer {
    use super::*;

    pub fn serialize<S: serde::Serializer>(value: &Rc<BigInt>, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(value)
    }

    pub fn deserialize<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Rc<BigInt>, D::Error> {
        let text=String::deserialize(deserializer)?;
        let value=(text.len()<=2468).then(|| text.parse::<BigInt>().ok()).flatten()
            .filter(|value| value.bits() <= 8192).ok_or_else(|| serde::de::Error::custom("Invalid collection integer"))?;
        Ok(Rc::new(value))
    }
}

#[derive(Clone, Deserialize, Serialize)]
struct Object {
    kind: String,
    properties: BTreeMap<String, Member>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct Collections {
    inventories: BTreeMap<String, Vec<Rc<Object>>>,
    arrays: BTreeMap<String, Vec<Member>>,
    #[serde(skip)]
    bytes: usize,
}

fn scalar(kind: &str) -> bool {
    matches!(kind, "integer" | "real" | "boolean" | "string")
}

impl Schema {
    pub fn validate(&self) -> Result<(), String> {
        fn visit<'a>(
            schema: &'a Schema,
            kind: &'a str,
            active: &mut BTreeSet<&'a str>,
            heights: &mut BTreeMap<&'a str, usize>,
        ) -> Result<usize, String> {
            if let Some(&height) = heights.get(kind) {
                return Ok(height);
            }
            if !active.insert(kind) {
                return Err("Circular or excessively nested object types".into());
            }
            let properties = schema.types.get(kind).ok_or("Unknown object type")?;
            if properties.len() > 32 {
                return Err("Too many properties on an object".into());
            }
            let mut height = 1;
            for (name, field) in properties {
                if name.is_empty() || name.len() > 64 || name.contains('.') {
                    return Err("Invalid property name".into());
                }
                if scalar(&field.kind) {
                    field.initial().map_err(str::to_owned)?;
                } else {
                    height = height.max(1 + visit(schema, &field.kind, active, heights)?);
                }
            }
            if height > 16 {
                return Err("Object types can be nested up to 16 levels".into());
            }
            active.remove(kind);
            heights.insert(kind, height);
            Ok(height)
        }
        if self.types.len() > 64 || self.inventories.len() > 64 || self.arrays.len() > 64 {
            return Err("Too many collection definitions".into());
        }
        let mut heights = BTreeMap::new();
        for kind in self.types.keys() {
            visit(self, kind, &mut BTreeSet::new(), &mut heights)?;
        }
        if self.inventories.iter().any(|(id, types)| {
            matches!(id.as_str(), "game" | "players")
                || types.is_empty()
                || types.iter().any(|kind| !self.types.contains_key(kind))
        }) || self
            .game
            .iter()
            .chain(&self.players)
            .any(|kind| !self.types.contains_key(kind))
            || self
                .arrays
                .values()
                .any(|kind| !matches!(kind.as_str(), "integer" | "real"))
        {
            return Err("Invalid collection type".into());
        }
        Ok(())
    }

    fn object(&self, kind: &str) -> Result<Rc<Object>, &'static str> {
        let layout = self.types.get(kind).ok_or("Unknown object type")?;
        Ok(Rc::new(Object {
            kind: kind.to_owned(),
            properties: layout
                .iter()
                .map(|(name, field)| Ok((name.clone(), field.initial()?)))
                .collect::<Result<_, &'static str>>()?,
        }))
    }

    fn property<'a>(&'a self, kind: &'a str, path: &str) -> Option<&'a Property> {
        let mut fields = self.types.get(kind)?;
        let mut parts = path.split('.').peekable();
        while let Some(name) = parts.next() {
            let field = fields.get(name)?;
            if parts.peek().is_none() {
                return Some(field);
            }
            fields = self.types.get(&field.kind)?;
        }
        None
    }
}

impl Property {
    fn initial(&self) -> Result<Member, &'static str> {
        let text = self.default.as_deref();
        Ok(match self.kind.as_str() {
            "integer" => Member::Integer(
                text.unwrap_or("0")
                    .parse()
                    .map_err(|_| "Invalid integer default")?,
            ),
            "real" => Member::Real(
                text.unwrap_or("0")
                    .parse::<f64>()
                    .ok()
                    .filter(|value| value.is_finite())
                    .ok_or("Invalid real default")?,
            ),
            "boolean" => Member::Boolean(
                text.unwrap_or("false")
                    .parse()
                    .map_err(|_| "Invalid boolean default")?,
            ),
            "string" if text.is_none_or(|value| value.len() <= 4096) => {
                Member::Text(Rc::from(text.unwrap_or("")))
            }
            "string" => return Err("Collection string exceeds 4096 bytes"),
            _ => Member::Object(None),
        })
    }
}

impl Member {
    // Upper bound for this member's compact JSON representation, including its tag.
    fn saved_bytes(&self) -> usize {
        20 + match self {
            Self::Integer(_) | Self::Real(_) => 32,
            Self::Boolean(_) | Self::Object(None) => 5,
            Self::Large(value) => (value.bits() as usize * 30_103) / 100_000 + 3,
            Self::Text(value) => string_bytes(value),
            Self::Object(Some(value)) => value.saved_bytes(),
        }
    }
    fn from_value(kind: &str, value: &Value) -> Result<Self, &'static str> {
        match (kind, value) {
            ("integer", Value::Small(n)) => Ok(Self::Integer(*n)),
            ("integer", Value::Large(n)) if n.bits() <= 8192 => Ok(Self::Large(n.clone())),
            ("real", Value::Real(n)) => Ok(Self::Real(*n)),
            ("boolean", Value::Small(0 | 1)) => Ok(Self::Boolean(matches!(value, Value::Small(1)))),
            ("string", Value::Text(text)) => Ok(Self::Text(text.clone())),
            _ => Err("Collection property type does not match"),
        }
    }
    fn value(&self) -> Result<Value, &'static str> {
        match self {
            Self::Integer(n) => Ok(Value::Small(*n)),
            Self::Large(value) => Ok(Value::Large(value.clone())),
            Self::Real(n) if n.is_finite() => Ok(Value::Real(*n)),
            Self::Boolean(b) => Ok(Value::Small(i64::from(*b))),
            Self::Text(text) if text.len() <= 4096 => Ok(Value::Text(text.clone())),
            _ => Err("Read a valid scalar property through its object path"),
        }
    }
    fn present(&self) -> bool {
        !matches!(self, Self::Object(None))
    }
}

fn string_bytes(value: &str) -> usize {
    value.len() + value.bytes().map(|byte| match byte {
        b'"' | b'\\' | b'\n' | b'\r' | b'\t' | 8 | 12 => 1,
        0..=31 => 5,
        _ => 0,
    }).sum::<usize>()
}

fn update_bytes(total: &mut usize, before: usize, after: usize) -> Result<(), &'static str> {
    let next = *total - before + after;
    if next > MAX_COLLECTION_BYTES && next > *total {
        return Err("Saved collections are full. Remove objects or shorten their text.");
    }
    *total = next;
    Ok(())
}

impl Object {
    fn saved_bytes(&self) -> usize {
        32 + string_bytes(&self.kind) + self.properties.iter()
            .map(|(name, value)| 5 + string_bytes(name) + value.saved_bytes()).sum::<usize>()
    }
    fn member(&self, path: &str) -> Option<&Member> {
        let (name, rest) = path.split_once('.').unwrap_or((path, ""));
        let field = self.properties.get(name)?;
        if rest.is_empty() {
            Some(field)
        } else if let Member::Object(Some(child)) = field {
            child.member(rest)
        } else {
            None
        }
    }
    fn member_mut(&mut self, path: &str) -> Option<&mut Member> {
        let (name, rest) = path.split_once('.').unwrap_or((path, ""));
        let field = self.properties.get_mut(name)?;
        if rest.is_empty() {
            Some(field)
        } else if let Member::Object(Some(child)) = field {
            Rc::make_mut(child).member_mut(rest)
        } else {
            None
        }
    }
}

impl Collections {
    pub fn new(schema: &Schema) -> Result<Self, String> {
        let mut inventories: BTreeMap<_, _> = schema
            .inventories
            .keys()
            .map(|name| (name.clone(), Vec::new()))
            .collect();
        for (name, kind, count) in [("game", &schema.game, 1), ("players", &schema.players, 4)] {
            if let Some(kind) = kind {
                inventories.insert(
                    name.into(),
                    (0..count)
                        .map(|_| schema.object(kind))
                        .collect::<Result<_, _>>()?,
                );
            }
        }
        let mut collections = Self {
            inventories,
            arrays: schema
                .arrays
                .keys()
                .map(|name| (name.clone(), Vec::new()))
                .collect(),
            bytes: 0,
        };
        collections.measure();
        if collections.bytes > MAX_COLLECTION_BYTES {
            return Err("Default collection objects exceed the save budget".into());
        }
        Ok(collections)
    }

    pub fn measure(&mut self) {
        self.bytes = self.inventories.values().flatten().map(|object| object.saved_bytes() + 1).sum::<usize>()
            + self.arrays.values().flatten().map(|value| value.saved_bytes() + 1).sum::<usize>();
    }
    pub fn command(
        &mut self,
        schema: &Schema,
        op: u8,
        id: &str,
        index: usize,
        path: &str,
        value: &Value,
    ) -> Result<(), &'static str> {
        if op >= 123 {
            let numbers = self.arrays.get_mut(id).ok_or("Unknown number array")?;
            if op == 123 {
                if numbers.len() >= MAX_ENTRIES {
                    return Err("Number array is full");
                }
                let value = Member::from_value(&schema.arrays[id], value)?;
                update_bytes(&mut self.bytes, 0, value.saved_bytes() + 1)?;
                numbers.push(value);
            } else if index >= numbers.len() {
                return Err("Number array index outside the array");
            } else if op == 124 {
                let value = Member::from_value(&schema.arrays[id], value)?;
                update_bytes(&mut self.bytes, numbers[index].saved_bytes(), value.saved_bytes())?;
                numbers[index] = value;
            } else {
                self.bytes -= numbers.remove(index).saved_bytes() + 1;
            }
            return Ok(());
        }
        let objects = self.inventories.get_mut(id).ok_or("Unknown inventory")?;
        match op {
            118 if schema
                .inventories
                .get(id)
                .is_some_and(|kinds| kinds.iter().any(|kind| kind == path)) =>
            {
                if objects.len() >= MAX_ENTRIES {
                    return Err("Inventory is full");
                }
                let object = schema.object(path)?;
                update_bytes(&mut self.bytes, 0, object.saved_bytes() + 1)?;
                objects.push(object);
            }
            118 => return Err("Object type is not allowed in this inventory"),
            119 if matches!(id, "game" | "players") => {
                return Err("Game and player properties have fixed ownership");
            }
            119 => {
                if index >= objects.len() {
                    return Err("Inventory index outside the array");
                }
                self.bytes -= objects.remove(index).saved_bytes() + 1;
            }
            120..=122 => {
                let object = objects
                    .get_mut(index)
                    .ok_or("Inventory index outside the array")?;
                let property = schema
                    .property(&object.kind, path)
                    .ok_or("Unknown object property")?;
                let next = match op {
                    120 => Member::from_value(&property.kind, value)?,
                    121 if !scalar(&property.kind) => {
                        Member::Object(Some(schema.object(&property.kind)?))
                    }
                    122 if !scalar(&property.kind) => Member::Object(None),
                    _ => return Err("Expected an object property"),
                };
                let member = Rc::make_mut(object).member_mut(path).ok_or("Create the parent object first")?;
                update_bytes(&mut self.bytes, member.saved_bytes(), next.saved_bytes())?;
                *member = next;
            }
            _ => return Err("Unknown collection command"),
        }
        Ok(())
    }

    pub fn query(
        &self,
        op: u16,
        id: &str,
        index: usize,
        path: &str,
    ) -> Result<Value, &'static str> {
        if op >= 4 {
            let numbers = self.arrays.get(id).ok_or("Unknown number array")?;
            return if op == 4 {
                Ok(Value::Small(numbers.len() as i64))
            } else {
                numbers
                    .get(index)
                    .ok_or("Number array index outside the array")?
                    .value()
            };
        }
        let Some(objects) = self.inventories.get(id) else {
            let (count, kind) = match id {
                "game" => (1, "game"),
                "players" => (4, "player"),
                _ => return Err("Unknown inventory"),
            };
            return match op {
                0 => Ok(Value::Small(count as i64)),
                1 => Ok(Value::Text(Rc::from(if index < count { kind } else { "" }))),
                _ => Err("Unknown property"),
            };
        };
        let object = objects.get(index);
        match op {
            0 => Ok(Value::Small(objects.len() as i64)),
            1 => Ok(Value::Text(
                object.map_or("", |record| record.kind.as_str()).into(),
            )),
            2 => Ok(Value::Small(i64::from(
                object
                    .and_then(|record| record.member(path))
                    .is_some_and(Member::present),
            ))),
            3 => object
                .and_then(|record| record.member(path))
                .ok_or("Missing object property")?
                .value(),
            _ => Err("Unknown collection query"),
        }
    }

    pub fn valid(&self, schema: &Schema) -> bool {
        fn object(record: &Object, schema: &Schema, depth: usize) -> bool {
            let Some(layout) = schema.types.get(&record.kind) else {
                return false;
            };
            depth <= 16
                && layout.len() == record.properties.len()
                && layout.iter().all(|(name, property)| {
                    let Some(field) = record.properties.get(name) else {
                        return false;
                    };
                    match field {
                        Member::Object(child) => {
                            !scalar(&property.kind)
                                && child.as_ref().is_none_or(|child| {
                                    child.kind == property.kind && object(child, schema, depth + 1)
                                })
                        }
                        _ => field
                            .value()
                            .is_ok_and(|value| Member::from_value(&property.kind, &value).is_ok()),
                    }
                })
        }
        self.inventories.len()
            == schema.inventories.len()
                + usize::from(schema.game.is_some())
                + usize::from(schema.players.is_some())
            && self.arrays.len() == schema.arrays.len()
            && self.inventories.iter().all(|(name, records)| {
                let allowed = match name.as_str() {
                    "game" if records.len() == 1 => schema.game.as_ref().map(std::slice::from_ref),
                    "players" if records.len() == 4 => {
                        schema.players.as_ref().map(std::slice::from_ref)
                    }
                    id => schema.inventories.get(id).map(Vec::as_slice),
                };
                records.len() <= MAX_ENTRIES
                    && allowed.is_some_and(|allowed| {
                        records.iter().all(|record| {
                            allowed.contains(&record.kind) && object(record, schema, 1)
                        })
                    })
            })
            && self.arrays.iter().all(|(name, values)| {
                values.len() <= MAX_ENTRIES
                    && schema.arrays.get(name).is_some_and(|kind| {
                        values.iter().all(|value| {
                            value
                                .value()
                                .is_ok_and(|value| Member::from_value(kind, &value).is_ok())
                        })
                    })
            })
    }
    pub fn is_empty(&self) -> bool {
        self.inventories.is_empty() && self.arrays.is_empty()
    }
}
