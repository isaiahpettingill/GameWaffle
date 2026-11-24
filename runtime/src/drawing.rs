use serde::{Deserialize, Serialize};

pub const LIMIT: usize = 4096;

#[derive(Clone, Copy, Deserialize, PartialEq, Serialize)]
pub struct Style {
    pub fill: u32,
    pub stroke: u32,
    pub width: f32,
    pub hud: bool,
}

impl Default for Style {
    fn default() -> Self {
        Self {
            fill: 0xffffffff,
            stroke: 0x12121bff,
            width: 1.0,
            hud: false,
        }
    }
}

impl Style {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }
    pub(crate) fn valid(self) -> bool {
        (0.0..=64.0).contains(&self.width)
    }
}

#[derive(Clone, Copy, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Rect,
    Ellipse,
    Line,
    Triangle,
    Point,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
pub struct Shape {
    pub kind: Kind,
    pub coords: [f32; 6],
    #[serde(flatten)]
    pub style: Style,
}

impl Shape {
    pub(crate) fn valid(self) -> bool {
        self.style.valid() && self.coords.iter().all(|coord| coord.abs() <= 65536.0)
    }

    /// Produce untextured triangles for a caller's reusable graphics batch.
    pub fn triangles(self, offset: [f32; 2], mut emit: impl FnMut([[f32; 2]; 3], u32)) {
        fn fan(points: &[[f32; 2]], color: u32, emit: &mut impl FnMut([[f32; 2]; 3], u32)) {
            if color & 255 == 0 {
                return;
            }
            for pair in points[1..].windows(2) {
                emit([points[0], pair[0], pair[1]], color);
            }
        }
        fn segment(
            a: [f32; 2],
            b: [f32; 2],
            width: f32,
            color: u32,
            emit: &mut impl FnMut([[f32; 2]; 3], u32),
        ) {
            if width <= 0.0 || color & 255 == 0 {
                return;
            }
            let [dx, dy] = [b[0] - a[0], b[1] - a[1]];
            let length = (dx * dx + dy * dy).sqrt();
            if length <= 0.0 {
                return;
            }
            let half = width * 0.5 / length;
            let [x, y] = [-dy * half, dx * half];
            let [p, q, r, s] = [
                [a[0] + x, a[1] + y],
                [b[0] + x, b[1] + y],
                [b[0] - x, b[1] - y],
                [a[0] - x, a[1] - y],
            ];
            emit([p, q, r], color);
            emit([p, r, s], color);
        }
        let [x, y, a, b, c, d] = self.coords;
        let point = |x: f32, y: f32| [x - offset[0], y - offset[1]];
        let center = point(x, y);
        let mut ellipse = [[0.0; 2]; 32];
        let rect = [
            center,
            point(x + a, y),
            point(x + a, y + b),
            point(x, y + b),
        ];
        let tri = [center, point(a, b), point(c, d)];
        let points: &[[f32; 2]] = match self.kind {
            Kind::Line => {
                segment(
                    center,
                    point(a, b),
                    self.style.width,
                    self.style.stroke,
                    &mut emit,
                );
                return;
            }
            Kind::Point => {
                let half = self.style.width * 0.5;
                fan(
                    &[
                        point(x - half, y - half),
                        point(x + half, y - half),
                        point(x + half, y + half),
                        point(x - half, y + half),
                    ],
                    self.style.stroke,
                    &mut emit,
                );
                return;
            }
            Kind::Rect => &rect,
            Kind::Triangle => &tri,
            Kind::Ellipse => {
                let count = ((a.abs().max(b.abs()) * 0.20).ceil() as usize).clamp(12, 32);
                for (index, p) in ellipse[..count].iter_mut().enumerate() {
                    let (sin, cos) =
                        (std::f32::consts::TAU * index as f32 / count as f32).sin_cos();
                    *p = point(x + cos * a * 0.5, y + sin * b * 0.5);
                }
                &ellipse[..count]
            }
        };
        fan(points, self.style.fill, &mut emit);
        if self.style.stroke & 255 != 0 {
            for (a, b) in points
                .iter()
                .zip(points.iter().cycle().skip(1))
                .take(points.len())
            {
                segment(*a, *b, self.style.width, self.style.stroke, &mut emit);
            }
        }
    }
}
