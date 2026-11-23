use serde::{Deserialize, Serialize};

const LIMIT: usize = 2048;
const BIRTH_LIMIT: usize = 256;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Effect {
    Sparks,
    Dust,
    Smoke,
    Flame,
    Bubbles,
    Rain,
    Snow,
}

#[derive(Clone, Copy, Deserialize)]
pub struct Emitter {
    pub effect: Effect,
    pub rate: u16,
    #[serde(skip)]
    pub phase: u16,
}

impl Effect {
    pub fn named(s: &str) -> Option<Self> {
        Some(match s {
            "sparks" => Self::Sparks,
            "dust" => Self::Dust,
            "smoke" => Self::Smoke,
            "flame" => Self::Flame,
            "bubbles" => Self::Bubbles,
            "rain" => Self::Rain,
            "snow" => Self::Snow,
            _ => return None,
        })
    }
    // Horizontal spread, upward speed, downward acceleration, lifetime, first palette entry.
    fn properties(self) -> (f32, f32, f32, u8, usize) {
        match self {
            Self::Sparks => (120., 105., 250., 32, 0),
            Self::Dust => (36., 22., 32., 25, 2),
            Self::Smoke => (15., 24., -6., 80, 4),
            Self::Flame => (18., 38., -24., 30, 6),
            Self::Bubbles => (12., 20., -15., 70, 8),
            Self::Rain => (6., -155., 70., 45, 10),
            Self::Snow => (14., -18., 5., 100, 12),
        }
    }
}
struct Particle {
    x: f32,
    y: f32,
    dx: f32,
    dy: f32,
    gravity: f32,
    life: u8,
    age: u8,
    style: usize,
}
#[derive(Serialize)]
pub struct Batch {
    pub color: u32,
    pub size: u8,
    pub points: Vec<[i16; 2]>,
}
pub struct Particles {
    live: Vec<Particle>,
    pub batches: Vec<Batch>,
    rng: u32,
    births: usize,
}

impl Default for Particles {
    fn default() -> Self {
        let styles = [
            (0xffe4a1, 2),
            (0xe38b59, 1),
            (0xd0af8f, 2),
            (0x94796b, 1),
            (0x787683, 3),
            (0x585967, 4),
            (0xffda76, 3),
            (0xef7548, 2),
            (0x86c9d5, 2),
            (0xc8edf0, 1),
            (0x85aac9, 2),
            (0x678aab, 1),
            (0xf1f2f5, 2),
            (0xc7d5e0, 1),
        ];
        Self {
            live: Vec::with_capacity(LIMIT),
            batches: styles
                .into_iter()
                .map(|(color, size)| Batch {
                    color,
                    size,
                    points: Vec::new(),
                })
                .collect(),
            rng: 0x9e3779b9,
            births: 0,
        }
    }
}
impl Particles {
    pub fn visible_batches(&self) -> &[Batch] {
        if self.live.is_empty() {
            &[]
        } else {
            &self.batches
        }
    }
    pub fn clear(&mut self) {
        self.live.clear();
        for batch in &mut self.batches {
            batch.points.clear();
        }
        self.births = 0;
    }
    fn random(&mut self) -> f32 {
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 17;
        self.rng ^= self.rng << 5;
        (self.rng >> 8) as f32 / 16777216.
    }
    pub fn emit(&mut self, effect: Effect, pos: [f32; 2], count: usize) {
        let count = count
            .min(BIRTH_LIMIT - self.births)
            .min(LIMIT - self.live.len());
        self.births += count;
        let (spread, speed, gravity, ticks, style) = effect.properties();
        for _ in 0..count {
            let dx = (self.random() * 2. - 1.) * spread;
            let dy = -(0.45 + self.random() * 0.55) * speed;
            let life = (ticks as f32 * (0.65 + self.random() * 0.35)) as u8;
            self.live.push(Particle {
                x: pos[0],
                y: pos[1],
                dx,
                dy,
                gravity,
                life,
                age: 0,
                style,
            });
        }
    }
    pub fn update(&mut self, focus: Option<[f32; 2]>, size: [u32; 2]) {
        for batch in &mut self.batches {
            batch.points.clear();
        }
        self.births = 0;
        self.live.retain_mut(|p| {
            p.age += 1;
            if p.age >= p.life {
                return false;
            }
            p.dy += p.gravity * super::STEP;
            p.x += p.dx * super::STEP;
            p.y += p.dy * super::STEP;
            // Keep one full viewport around the focus for cameras clamped at a room edge.
            if focus.is_none_or(|f| {
                (p.x - f[0]).abs() < size[0] as f32 + 8. && (p.y - f[1]).abs() < size[1] as f32 + 8.
            }) {
                self.batches[p.style + usize::from(p.age > p.life / 2)]
                    .points
                    .push([p.x.round() as i16, p.y.round() as i16]);
            }
            true
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bursts_share_room_budget_and_expire() {
        let mut particles = Particles::default();
        for _ in 0..16 {
            particles.emit(Effect::Snow, [64., 64.], 4096);
            particles.emit(Effect::Snow, [64., 64.], 4096);
            assert!(particles.births <= BIRTH_LIMIT && particles.live.len() <= LIMIT);
            particles.update(None, [128, 128]);
        }
        assert_eq!(particles.live.len(), LIMIT);
        for _ in 0..100 {
            particles.update(None, [128, 128]);
        }
        assert!(particles.visible_batches().is_empty());
    }
}
