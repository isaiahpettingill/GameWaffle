use crate::model::{Mode, Physics};
use box2d_rs::{
    b2_body::{B2body, B2bodyDef, B2bodyType, BodyPtr},
    b2_collision::B2manifold,
    b2_contact::B2contactDynTrait,
    b2_fixture::{B2filter, B2fixtureDef},
    b2_math::B2vec2,
    b2_shape::B2massData,
    b2_world::{B2world, B2worldPtr},
    b2_world_callbacks::B2contactListener,
    b2rs_common::UserDataType,
    shapes::b2_polygon_shape::B2polygonShape,
};
use std::{cell::RefCell, collections::HashMap, rc::Rc};

pub const PPM: f32 = 24.0;

#[derive(Clone, Copy, Debug, Default)]
pub struct Info {
    pub id: u32,
    pub half_height: f32,
    pub one_way: bool,
}

#[derive(Clone, Default)]
pub struct Data;
impl UserDataType for Data {
    type Fixture = Info;
    type Body = ();
    type Joint = ();
}

pub type World = B2worldPtr<Data>;
pub type Body = BodyPtr<Data>;

#[derive(Default)]
pub struct Contacts {
    pub events: Vec<(bool, u32, u32)>,
    pub previous: HashMap<u32, (f32, bool)>,
}

impl B2contactListener<Data> for Contacts {
    fn begin_contact(&mut self, contact: &mut dyn B2contactDynTrait<Data>) {
        let c = contact.get_base();
        if let (Some(a), Some(b)) = (
            c.get_fixture_a().borrow().get_user_data(),
            c.get_fixture_b().borrow().get_user_data(),
        ) {
            self.events.push((true, a.id, b.id));
        }
    }
    fn end_contact(&mut self, contact: &mut dyn B2contactDynTrait<Data>) {
        let c = contact.get_base();
        if let (Some(a), Some(b)) = (
            c.get_fixture_a().borrow().get_user_data(),
            c.get_fixture_b().borrow().get_user_data(),
        ) {
            self.events.push((false, a.id, b.id));
        }
    }
    fn pre_solve(&mut self, contact: &mut dyn B2contactDynTrait<Data>, _: &B2manifold) {
        let a = contact.get_base().get_fixture_a();
        let b = contact.get_base().get_fixture_b();
        let ai = a.borrow().get_user_data().unwrap_or_default();
        let bi = b.borrow().get_user_data().unwrap_or_default();
        let (platform, platform_info, other, info) = if ai.one_way {
            (a, ai, b, bi)
        } else if bi.one_way {
            (b, bi, a, ai)
        } else {
            return;
        };
        let top =
            platform.borrow().get_body().borrow().get_position().y - platform_info.half_height;
        let body = other.borrow().get_body();
        let body = body.borrow();
        let (bottom, drop) = self
            .previous
            .get(&info.id)
            .copied()
            .unwrap_or((body.get_position().y + info.half_height, false));
        if drop || body.get_linear_velocity().y < -0.05 || bottom > top + 0.07 {
            contact.get_base_mut().set_enabled(false);
        }
    }
}

pub fn world(gravity: f32) -> (World, Rc<RefCell<Contacts>>) {
    let world = B2world::new(B2vec2::new(0.0, gravity));
    let contacts = Rc::new(RefCell::new(Contacts::default()));
    world.borrow_mut().set_contact_listener(contacts.clone());
    (world, contacts)
}

pub fn allows(a: &Physics, b: &Physics) -> bool {
    if a.group != 0 && a.group == b.group {
        return a.group > 0;
    }
    a.mask & b.category != 0 && b.mask & a.category != 0
}

pub fn body(world: &World, id: u32, p: B2vec2, w: f32, h: f32, config: &Physics) -> Option<Body> {
    let kind = match config.mode {
        Mode::None => return None,
        Mode::Kinematic => B2bodyType::B2KinematicBody,
        Mode::Dynamic => B2bodyType::B2DynamicBody,
        _ => B2bodyType::B2StaticBody,
    };
    let def = B2bodyDef {
        body_type: kind,
        position: (1.0 / PPM) * p,
        fixed_rotation: config.fixed,
        gravity_scale: config.gravity,
        ..Default::default()
    };
    let body = B2world::create_body(world.clone(), &def);
    let mut shape = B2polygonShape::default();
    shape.set_as_box(w / (2.0 * PPM), h / (2.0 * PPM));
    let fixture = B2fixtureDef {
        shape: Some(Rc::new(RefCell::new(shape))),
        user_data: Some(Info {
            id,
            half_height: h / (2.0 * PPM),
            one_way: config.mode == Mode::OneWay,
        }),
        density: config.density,
        restitution: config.elasticity,
        friction: config.friction,
        is_sensor: matches!(config.mode, Mode::Sensor | Mode::Fluid | Mode::Ladder),
        filter: B2filter {
            category_bits: config.category,
            mask_bits: config.mask,
            group_index: config.group,
        },
        ..Default::default()
    };
    B2body::create_fixture(body.clone(), &fixture);
    if let Some(mass) = config.mass.filter(|_| kind == B2bodyType::B2DynamicBody) {
        let mut data = B2massData::default();
        body.borrow().get_mass_data(&mut data);
        data.i *= mass / data.mass;
        data.mass = mass;
        body.borrow_mut().set_mass_data(&data);
    }
    Some(body)
}
