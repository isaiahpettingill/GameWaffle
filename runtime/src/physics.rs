use crate::model::{Collider, Mode, Physics};
pub use rapier2d::math::Vector as Vec2;
use rapier2d::parry::bounding_volume::{Aabb, BoundingVolume};
use rapier2d::parry::query::Ray;
use rapier2d::prelude::{
    ActiveHooks, CoefficientCombineRule, ColliderBuilder, Group, InteractionGroups,
    PairFilterContext, PhysicsHooks, PhysicsWorld, Pose, QueryFilter, RigidBody, RigidBodyBuilder,
    RigidBodyHandle, Rotation, SharedShape, SolverFlags,
};
use std::collections::HashMap;

pub const PPM: f32 = 24.0;
pub type Body = RigidBodyHandle;
#[derive(Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "rollback", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "rollback", serde(transparent))]
pub(crate) struct ContactPairs(Vec<(u32, u32)>);

impl ContactPairs {
    pub(crate) fn contains(&self, pair: &(u32, u32)) -> bool {
        self.0.binary_search(pair).is_ok()
    }

    fn difference(&self, other: &Self) -> impl Iterator<Item = (u32, u32)> {
        let mut remaining = other.0.as_slice();
        self.0.iter().copied().filter(move |pair| {
            while remaining.first().is_some_and(|candidate| candidate < pair) {
                remaining = &remaining[1..];
            }
            remaining.first() != Some(pair)
        })
    }

    pub(crate) fn sort_and_deduplicate(&mut self) {
        self.0.sort_unstable();
        self.0.dedup();
    }
}

#[derive(Clone, Copy)]
struct CollisionFilter {
    category: u16,
    mask: u16,
    group: i16,
}

impl From<&Physics> for CollisionFilter {
    fn from(physics: &Physics) -> Self {
        Self {
            category: physics.category,
            mask: physics.mask,
            group: physics.group,
        }
    }
}

impl CollisionFilter {
    fn allows(self, other: Self) -> bool {
        if self.group != 0 && self.group == other.group {
            return self.group > 0;
        }
        self.mask & other.category != 0 && other.mask & self.category != 0
    }
}

#[derive(Clone, Copy)]
struct ColliderInfo {
    id: u32,
    top: f32,
    one_way: bool,
    filter: CollisionFilter,
}

impl ColliderInfo {
    fn pack(self) -> u128 {
        u128::from(self.id)
            | (u128::from(self.top.to_bits()) << 32)
            | (u128::from(self.one_way) << 64)
            | (u128::from(self.filter.group as u16) << 65)
            | (u128::from(self.filter.category) << 81)
            | (u128::from(self.filter.mask) << 97)
    }

    fn unpack(data: u128) -> Self {
        Self {
            id: data as u32,
            top: f32::from_bits((data >> 32) as u32),
            one_way: (data >> 64) & 1 != 0,
            filter: CollisionFilter {
                group: (data >> 65) as i16,
                category: (data >> 81) as u16,
                mask: (data >> 97) as u16,
            },
        }
    }
}

#[derive(Default)]
pub struct Contacts {
    pub events: Vec<(bool, u32, u32)>,
    pub previous: HashMap<u32, (f32, bool)>,
    pub(crate) pairs: ContactPairs,
    next: ContactPairs,
}

struct ContactRules<'a>(&'a HashMap<u32, (f32, bool)>);

impl PhysicsHooks for ContactRules<'_> {
    fn filter_contact_pair(&self, cx: &PairFilterContext<'_>) -> Option<SolverFlags> {
        if ![cx.rigid_body1, cx.rigid_body2]
            .into_iter()
            .flatten()
            .any(|body| cx.bodies[body].is_dynamic())
        {
            return None;
        }
        let a = ColliderInfo::unpack(cx.colliders[cx.collider1].user_data);
        let b = ColliderInfo::unpack(cx.colliders[cx.collider2].user_data);
        if !a.filter.allows(b.filter) {
            return None;
        }
        let (platform, platform_body, other, other_body) = if a.one_way {
            (a, cx.rigid_body1, b, cx.rigid_body2)
        } else if b.one_way {
            (b, cx.rigid_body2, a, cx.rigid_body1)
        } else {
            return Some(SolverFlags::COMPUTE_RIGID_IMPULSES);
        };
        let top = cx.bodies[platform_body?].translation().y + platform.top;
        let (bottom, drop) = self.0.get(&other.id).copied()?;
        (!drop && cx.bodies[other_body?].linvel().y >= -0.05 && bottom <= top + 0.07)
            .then_some(SolverFlags::COMPUTE_RIGID_IMPULSES)
    }

    fn filter_intersection_pair(&self, cx: &PairFilterContext<'_>) -> bool {
        let a = ColliderInfo::unpack(cx.colliders[cx.collider1].user_data);
        let b = ColliderInfo::unpack(cx.colliders[cx.collider2].user_data);
        a.filter.allows(b.filter)
    }
}

#[cfg_attr(feature = "rollback", derive(serde::Serialize, serde::Deserialize))]
pub struct World {
    physics: PhysicsWorld,
    pending: Vec<Body>,
    forced: Vec<Body>,
    #[cfg_attr(feature = "rollback", serde(default))]
    pixel_masses: bool,
}

impl World {
    pub fn new(gravity: f32, pixel_masses: bool) -> Self {
        let mut physics = PhysicsWorld {
            gravity: Vec2::new(0., gravity),
            ..Default::default()
        };
        physics.integration_parameters.dt = crate::STEP;
        physics.integration_parameters.num_solver_iterations = 6;
        Self {
            physics,
            pending: Vec::new(),
            forced: Vec::new(),
            pixel_masses,
        }
    }

    pub fn set_gravity(&mut self, gravity: f32) {
        self.physics.gravity.y = gravity;
        for (_, body) in self.physics.bodies.iter_mut() {
            if body.is_dynamic() && body.is_enabled() {
                body.wake_up(true);
            }
        }
    }

    pub fn body(&self, handle: Body) -> &RigidBody {
        &self.physics.bodies[handle]
    }

    pub fn body_mut(&mut self, handle: Body) -> &mut RigidBody {
        &mut self.physics.bodies[handle]
    }

    pub fn set_body_enabled(&mut self, handle: Body, enabled: bool) {
        self.body_mut(handle).set_enabled(enabled);
        self.pending.push(handle);
    }

    pub fn set_friction(&mut self, handle: Body, friction: f32) {
        for collider in self.physics.bodies[handle].colliders() {
            let collider = &mut self.physics.colliders[*collider];
            collider.set_friction(friction);
            collider.set_friction_combine_rule(CoefficientCombineRule::Min);
        }
    }

    #[cfg(feature = "rollback")]
    pub(crate) fn contains(&self, handle: Body, id: u32) -> bool {
        self.physics
            .bodies
            .get(handle)
            .is_some_and(|body| body.user_data == u128::from(id))
    }

    pub fn create(
        &mut self,
        id: u32,
        p: Vec2,
        w: f32,
        h: f32,
        config: &Physics,
        colliders: &[Collider],
    ) -> Option<Body> {
        let mut body = match config.mode {
            Mode::None => return None,
            Mode::Dynamic => RigidBodyBuilder::dynamic().ccd_enabled(true),
            Mode::Kinematic => RigidBodyBuilder::kinematic_velocity_based(),
            _ => RigidBodyBuilder::fixed(),
        }
        .translation(p / PPM)
        .gravity_scale(config.gravity)
        .user_data(u128::from(id));
        if config.fixed {
            body = body.lock_rotations();
        }
        let mut hooks = ActiveHooks::empty();
        let groups = if config.group == 0 {
            InteractionGroups::new(
                Group::from_bits_retain(u32::from(config.category)),
                Group::from_bits_retain(u32::from(config.mask)),
                Default::default(),
            )
        } else {
            hooks |= ActiveHooks::FILTER_CONTACT_PAIRS | ActiveHooks::FILTER_INTERSECTION_PAIR;
            InteractionGroups::all()
        };
        let one_way = config.mode == Mode::OneWay;
        if one_way {
            hooks |= ActiveHooks::FILTER_CONTACT_PAIRS;
        }
        let mut collider = ColliderBuilder::new(shape(colliders, w, h))
            .user_data(
                ColliderInfo {
                    id,
                    top: bounds(colliders, w, h)[1] / PPM,
                    one_way,
                    filter: config.into(),
                }
                .pack(),
            )
            .active_hooks(hooks)
            .collision_groups(groups)
            .sensor(matches!(
                config.mode,
                Mode::Sensor | Mode::Fluid | Mode::Ladder
            ))
            .density(config.density)
            .friction(config.friction)
            .friction_combine_rule(CoefficientCombineRule::Min)
            .restitution(config.elasticity)
            .restitution_combine_rule(CoefficientCombineRule::Max);
        if let Some(mass) = config.mass.filter(|_| config.mode == Mode::Dynamic) {
            collider = collider.mass(if self.pixel_masses { mass / (PPM * PPM) } else { mass });
        }
        let (handle, _) = self.physics.insert(body, collider);
        self.pending.push(handle);
        Some(handle)
    }

    pub fn transform(&mut self, body: Body, p: Vec2, angle: f32) {
        let rigid = self.body_mut(body);
        rigid.set_translation(p / PPM, true);
        rigid.set_rotation(Rotation::new(angle), true);
        self.pending.push(body);
    }

    pub fn set_shape(&mut self, body: Body, w: f32, h: f32, shapes: &[Collider]) {
        let handle = self.body(body).colliders()[0];
        let collider = &mut self.physics.colliders[handle];
        let mut info = ColliderInfo::unpack(collider.user_data);
        info.top = bounds(shapes, w, h)[1] / PPM;
        collider.user_data = info.pack();
        collider.set_shape(shape(shapes, w, h));
        self.body_mut(body).wake_up(true);
        self.pending.push(body);
    }

    pub fn remove(&mut self, body: Body) {
        self.physics.remove_body(body);
    }

    pub fn force(&mut self, body: Body, force: Vec2) {
        if force != Vec2::ZERO {
            self.body_mut(body).add_force(force, true);
            self.forced.push(body);
        }
    }

    pub fn track_contact(
        &mut self,
        body: Body,
        id: u32,
        bottom: f32,
        drop: bool,
        contacts: &mut Contacts,
    ) {
        contacts.previous.insert(id, (bottom, drop));
        if drop && self.body(body).is_sleeping() {
            self.body_mut(body).wake_up(true);
        }
    }

    pub fn step(&mut self, contacts: &mut Contacts) {
        self.physics
            .step_with_events(&ContactRules(&contacts.previous), &());
        self.pending.clear();
        for body in self.forced.drain(..) {
            if let Some(body) = self.physics.bodies.get_mut(body) {
                body.reset_forces(false);
            }
        }
        contacts.next.0.clear();
        let pair = |a: u128, b: u128| {
            let (a, b) = (a as u32, b as u32);
            (a.min(b), a.max(b))
        };
        for contact in self
            .physics
            .contact_pairs()
            .filter(|pair| pair.has_any_active_contact())
        {
            if let (Some(a), Some(b)) = (
                self.physics.colliders.get(contact.collider1),
                self.physics.colliders.get(contact.collider2),
            ) {
                contacts.next.0.push(pair(a.user_data, b.user_data));
            }
        }
        for (_, a, _, b, touching) in self.physics.intersection_pairs() {
            if touching {
                contacts.next.0.push(pair(a.user_data, b.user_data));
            }
        }
        contacts.next.sort_and_deduplicate();
        if contacts.pairs != contacts.next {
            contacts.events.extend(contacts.pairs.difference(&contacts.next).map(|(a, b)| (false, a, b)));
            contacts.events.extend(contacts.next.difference(&contacts.pairs).map(|(a, b)| (true, a, b)));
        }
        std::mem::swap(&mut contacts.pairs, &mut contacts.next);
    }

    pub fn any_in_aabb(&self, min: Vec2, max: Vec2, mut matches: impl FnMut(u32) -> bool) -> bool {
        let aabb = Aabb::new(min, max);
        self.physics
            .intersect_aabb_conservative(aabb, QueryFilter::default())
            .any(|(_, collider)| collider.is_enabled() && matches(collider.user_data as u32))
            || self.pending.iter().any(|&body| {
                let Some(body) = self
                    .physics
                    .bodies
                    .get(body)
                    .filter(|body| body.is_enabled())
                else {
                    return false;
                };
                body.colliders().iter().any(|&handle| {
                    let collider = &self.physics.colliders[handle];
                    collider
                        .shape()
                        .compute_aabb(body.position())
                        .intersects(&aabb)
                        && matches(collider.user_data as u32)
                })
            })
    }

    pub fn ground_below(&self, origin: Vec2, distance: f32, actor: u32) -> Option<f32> {
        let ray = Ray::new(origin, Vec2::Y);
        let filter = QueryFilter::default().exclude_sensors();
        let ground = |_: _, collider: &rapier2d::prelude::Collider| {
            collider.is_enabled() && collider.user_data as u32 != actor
        };
        let hit = self
            .physics
            .cast_ray(&ray, distance, true, filter.predicate(&ground));
        let mut closest = hit.map_or(distance, |(_, distance)| distance);
        let mut found = hit.is_some();
        for &handle in &self.pending {
            let Some(body) = self
                .physics
                .bodies
                .get(handle)
                .filter(|body| body.is_enabled())
            else {
                continue;
            };
            for &handle in body.colliders() {
                let collider = &self.physics.colliders[handle];
                if !collider.is_sensor()
                    && ground(handle, collider)
                    && let Some(distance) =
                        collider
                            .shape()
                            .cast_ray(body.position(), &ray, closest, true)
                {
                    closest = distance;
                    found = true;
                }
            }
        }
        found.then_some(origin.y + closest)
    }
}

pub fn allows(a: &Physics, b: &Physics) -> bool {
    CollisionFilter::from(a).allows(b.into())
}

fn shape(colliders: &[Collider], width: f32, height: f32) -> SharedShape {
    let fallback = || SharedShape::cuboid(width / (2. * PPM), height / (2. * PPM));
    if colliders.is_empty() {
        return fallback();
    }
    let parts = colliders
        .iter()
        .filter_map(|shape| match shape {
            Collider::Polygon { points } => {
                let vertices = points
                    .iter()
                    .map(|&[x, y]| Vec2::new(x, y) / PPM)
                    .collect::<Vec<_>>();
                SharedShape::convex_hull(&vertices).map(|shape| (Pose::IDENTITY, shape))
            }
            Collider::Circle { center, radius } => Some((
                Pose::from_translation(Vec2::from_array(*center) / PPM),
                SharedShape::ball(radius / PPM),
            )),
        })
        .collect::<Vec<_>>();
    match parts.as_slice() {
        [] => fallback(),
        [(pose, shape)] if *pose == Pose::IDENTITY => shape.clone(),
        _ => SharedShape::compound(parts),
    }
}

pub fn bounds(colliders: &[Collider], w: f32, h: f32) -> [f32; 4] {
    if colliders.is_empty() {
        return [-w / 2.0, -h / 2.0, w / 2.0, h / 2.0];
    }
    let mut result = [
        f32::INFINITY,
        f32::INFINITY,
        f32::NEG_INFINITY,
        f32::NEG_INFINITY,
    ];
    let mut include = |left: f32, top: f32, right: f32, bottom: f32| {
        result[0] = result[0].min(left);
        result[1] = result[1].min(top);
        result[2] = result[2].max(right);
        result[3] = result[3].max(bottom);
    };
    for shape in colliders {
        match shape {
            Collider::Polygon { points } => {
                for &[x, y] in points {
                    include(x, y, x, y);
                }
            }
            Collider::Circle {
                center: [x, y],
                radius,
            } => include(x - radius, y - radius, x + radius, y + radius),
        }
    }
    result
}

pub fn valid_colliders(colliders: &[Collider]) -> bool {
    colliders.len() <= 8
        && colliders.iter().all(|shape| match shape {
            Collider::Polygon { points } => {
                (3..=8).contains(&points.len())
                    && points
                        .iter()
                        .flatten()
                        .all(|&n| n.is_finite() && n.abs() <= 8192.0)
                    && points.iter().enumerate().all(|(i, a)| {
                        points.iter().skip(i + 1).all(|b| {
                            let dx = a[0] - b[0];
                            let dy = a[1] - b[1];
                            dx * dx + dy * dy > 0.004
                        })
                    })
                    && points
                        .iter()
                        .zip(points.iter().cycle().skip(1))
                        .map(|(a, b)| a[0] * b[1] - a[1] * b[0])
                        .sum::<f32>()
                        .abs()
                        > 0.06
            }
            Collider::Circle { center, radius } => {
                center.iter().all(|&n| n.is_finite() && n.abs() <= 8192.0)
                    && (0.06..=8192.0).contains(radius)
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(feature = "rollback")]
    #[test]
    fn rollback_contacts_keep_the_sorted_set_encoding() {
        let legacy = std::collections::BTreeSet::from([(1_u32, 8_u32), (2, 4), (5, 9)]);
        let mut bytes = Vec::new();
        ciborium::into_writer(&legacy, &mut bytes).unwrap();
        let previous: ContactPairs = ciborium::from_reader(bytes.as_slice()).unwrap();

        let mut next = ContactPairs(vec![(5, 9), (2, 3), (2, 3), (1, 6)]);
        next.sort_and_deduplicate();
        assert!(next.contains(&(2, 3)));
        assert_eq!(previous.difference(&next).collect::<Vec<_>>(), [(1, 8), (2, 4)]);
        assert_eq!(next.difference(&previous).collect::<Vec<_>>(), [(1, 6), (2, 3)]);

        let mut encoded = Vec::new();
        ciborium::into_writer(&previous, &mut encoded).unwrap();
        assert_eq!(encoded, bytes);
    }

    #[test]
    fn one_way_platform_lands_and_drops() {
        let mut world = World::new(16., false);
        let mut contacts = Contacts::default();
        let config = |mode| Physics {
            mode,
            ..Physics::default()
        };
        world.create(1, Vec2::new(0., 48.), 120., 12., &config(Mode::OneWay), &[]);
        let player = world
            .create(2, Vec2::new(0., 65.), 12., 12., &config(Mode::Dynamic), &[])
            .unwrap();
        world.body_mut(player).set_linvel(Vec2::new(0., -8.), true);
        let advance = |world: &mut World, contacts: &mut Contacts, drop| {
            let bottom = world.body(player).translation().y + 6. / PPM;
            world.track_contact(player, 2, bottom, drop, contacts);
            world.step(contacts);
            world.body(player).translation().y * PPM
        };
        for _ in 0..25 {
            advance(&mut world, &mut contacts, false);
        }
        assert!(world.body(player).translation().y * PPM < 36.);
        for _ in 0..60 {
            advance(&mut world, &mut contacts, false);
        }
        assert!((world.body(player).translation().y * PPM - 36.).abs() < 1.);
        for _ in 0..35 {
            advance(&mut world, &mut contacts, true);
        }
        assert!(world.body(player).translation().y * PPM > 55.);
    }
}
