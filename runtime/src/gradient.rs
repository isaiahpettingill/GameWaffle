use serde::{Deserialize, Serialize};

pub const POINTS: usize = 8;
pub const PALETTE: usize = 16;
type Rgb = [u8; 3];

#[derive(Clone, Copy, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GradientKind {
    #[default]
    Linear,
    Radial,
}

#[derive(Clone, Copy, PartialEq, Deserialize, Serialize)]
pub struct Stop {
    pub offset: f32,
    pub color: Rgb,
}

#[derive(Clone, Copy, PartialEq, Deserialize, Serialize)]
pub struct Focus {
    pub center: [f32; 2],
    pub radius: f32,
    pub color: Rgb,
}

#[derive(Clone, PartialEq, Deserialize, Serialize)]
pub struct Gradient {
    pub kind: GradientKind,
    pub dithered: bool,
    pub axis: [f32; 4],
    pub stops: [Option<Stop>; POINTS],
    pub foci: [Option<Focus>; POINTS],
    pub palette: [Option<Rgb>; PALETTE],
}

impl Default for Gradient {
    fn default() -> Self {
        Self {
            kind: GradientKind::Linear,
            dithered: false,
            axis: [0., 0., 0., 1.],
            stops: [None; POINTS],
            foci: [None; POINTS],
            palette: [None; PALETTE],
        }
    }
}

impl Gradient {
    pub(crate) fn valid(&self) -> bool {
        let coord = |v: f32| (-4.0..=4.0).contains(&v);
        self.axis.iter().copied().all(coord)
            && self
                .stops
                .iter()
                .flatten()
                .all(|stop| (0.0..=1.0).contains(&stop.offset))
            && self.foci.iter().flatten().all(|focus| {
                focus.center.into_iter().all(coord) && (0.001..=8.).contains(&focus.radius)
            })
    }
}

pub fn rgb(text: &str) -> Option<Rgb> {
    let digits = text.strip_prefix('#')?;
    if digits.len() != 6 || !digits.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let packed = u32::from_str_radix(digits, 16).ok()?;
    Some([(packed >> 16) as u8, (packed >> 8) as u8, packed as u8])
}

const BAYER: [[f32; 4]; 4] = [
    [0., 8., 2., 10.],
    [12., 4., 14., 6.],
    [3., 11., 1., 9.],
    [15., 7., 13., 5.],
];

fn lerp(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    std::array::from_fn(|i| a[i] + (b[i] - a[i]) * t)
}

fn distance(a: [f32; 3], b: [f32; 3]) -> f32 {
    (a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)
}

#[derive(Clone, Copy)]
struct Dither {
    a: u8,
    b: u8,
    ratio: f32,
}

fn palette_pair(colors: &[[f32; 3]], target: [f32; 3]) -> Dither {
    let (a, mut error) = colors
        .iter()
        .enumerate()
        .map(|(i, &color)| (i, distance(color, target)))
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .unwrap();
    let mut result = Dither {
        a: a as u8,
        b: a as u8,
        ratio: 0.,
    };
    for (b, &color) in colors.iter().enumerate() {
        let length = distance(colors[a], color);
        if length == 0. {
            continue;
        }
        let origin = colors[a];
        let ratio = ((target[0] - origin[0]) * (color[0] - origin[0])
            + (target[1] - origin[1]) * (color[1] - origin[1])
            + (target[2] - origin[2]) * (color[2] - origin[2]))
            / length;
        let ratio = ratio.clamp(0., 1.);
        let next = distance(lerp(origin, color, ratio), target);
        if next < error {
            error = next;
            result = Dither {
                a: a as u8,
                b: b as u8,
                ratio,
            };
        }
    }
    result
}

/// Draw an opaque gradient in logical screen pixels. Ramp positions use normalized
/// screen coordinates and radial distances use the shorter screen dimension.
pub fn rasterize(output: &mut Vec<u8>, [width, height]: [u32; 2], gradient: &Gradient, base: Rgb) {
    output.clear();
    output.reserve(width as usize * height as usize * 4);
    let mut stops: Vec<_> = gradient
        .stops
        .iter()
        .flatten()
        .map(|stop| (stop.offset, stop.color.map(f32::from)))
        .collect();
    stops.sort_by(|a, b| a.0.total_cmp(&b.0));
    let palette: Vec<_> = gradient.palette.iter().flatten().copied().collect();
    let colors: Vec<_> = palette.iter().map(|color| color.map(f32::from)).collect();
    let mut table = if gradient.dithered && !palette.is_empty() {
        vec![None; 32768]
    } else {
        Vec::new()
    };
    let base = base.map(f32::from);
    let [x0, y0, x1, y1] = gradient.axis;
    let [dx, dy] = [x1 - x0, y1 - y0];
    let dot_inverse = (dx * dx + dy * dy).max(0.000001).recip();
    let sx = (width as f32).recip();
    let sy = (height as f32).recip();
    let short_side = width.min(height).max(1) as f32;
    let radial: Vec<_> = gradient
        .foci
        .iter()
        .flatten()
        .map(|focus| {
            let [x, y] = focus.center;
            (
                x * width as f32,
                y * height as f32,
                (focus.radius * short_side).recip(),
                focus.color.map(f32::from),
            )
        })
        .collect();
    for y in 0..height {
        let row = y as f32 + 0.5;
        for x in 0..width {
            let col = x as f32 + 0.5;
            let color = match gradient.kind {
                GradientKind::Linear if !stops.is_empty() => {
                    let t = ((col * sx - x0) * dx + (row * sy - y0) * dy) * dot_inverse;
                    let upper = stops.partition_point(|&(offset, _)| offset <= t);
                    match (upper.checked_sub(1), stops.get(upper)) {
                        (None, Some(&(_, color))) => color,
                        (Some(lower), None) => stops[lower].1,
                        (Some(lower), Some(&(end, next))) => {
                            let (start, previous) = stops[lower];
                            lerp(previous, next, (t - start) / (end - start))
                        }
                        _ => base,
                    }
                }
                GradientKind::Linear => base,
                GradientKind::Radial => {
                    let mut sum = [0.; 3];
                    let mut total = 0.;
                    let mut uncovered = 1.;
                    for &(fx, fy, scale, color) in &radial {
                        let squared = ((col - fx).powi(2) + (row - fy).powi(2)) * scale * scale;
                        if squared >= 1. {
                            continue;
                        }
                        let t = squared.sqrt();
                        let weight = 1. - t * t * (3. - 2. * t);
                        for i in 0..3 {
                            sum[i] += color[i] * weight;
                        }
                        total += weight;
                        uncovered *= 1. - weight;
                    }
                    if total > 0. {
                        lerp(base, sum.map(|v| v / total), 1. - uncovered)
                    } else {
                        base
                    }
                }
            };
            let pixel = if table.is_empty() {
                color.map(|v| v.round() as u8)
            } else {
                let [r, g, b] = color.map(|v| (v.round() as u8 >> 3) as usize);
                let pair = table[r << 10 | g << 5 | b].get_or_insert_with(|| {
                    palette_pair(
                        &colors,
                        [r, g, b].map(|v| (((v << 3) | (v >> 2)) as u8).into()),
                    )
                });
                let threshold = (BAYER[y as usize & 3][x as usize & 3] + 0.5) / 16.;
                palette[usize::from(if pair.ratio > threshold {
                    pair.b
                } else {
                    pair.a
                })]
            };
            output.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
        }
    }
}

#[wasm_bindgen::prelude::wasm_bindgen]
pub fn room_gradient_pixels(
    width: u32,
    height: u32,
    settings: &str,
    base: &str,
) -> Result<Vec<u8>, String> {
    if !(1..=512).contains(&width) || !(1..=512).contains(&height) {
        return Err("Gradient output exceeds the viewport limits".into());
    }
    let gradient: Gradient = serde_json::from_str(settings).map_err(|error| error.to_string())?;
    if !gradient.valid() {
        return Err("Invalid background gradient".into());
    }
    let mut pixels = Vec::new();
    rasterize(
        &mut pixels,
        [width, height],
        &gradient,
        rgb(base).unwrap_or([23, 24, 41]),
    );
    Ok(pixels)
}
