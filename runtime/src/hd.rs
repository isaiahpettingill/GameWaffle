// Fixed 2x reconstruction for retro art. Use local contrast to keep hard
// boundaries sharp and connect agreeing neighbors across a diagonal corner.
use wasm_bindgen::prelude::*;

pub fn scale(
    src: &[u8],
    w: usize,
    h: usize,
    pitch: usize,
    strength: u8,
    dst: &mut [u8],
    stride: usize,
) {
    let distance = |a: &[u8], b: &[u8]| -> u32 {
        (0..3)
            .zip([2, 4, 1])
            .map(|(i, k)| u32::from(a[i].abs_diff(b[i])) * k)
            .sum::<u32>()
            / 7
    };
    for y in 0..h {
        for x in 0..w {
            let pixel = |x: usize, y: usize| &src[y * pitch + 4 * x..][..4];
            let center = pixel(x, y);
            let horizontal = [pixel(x.saturating_sub(1), y), pixel((x + 1).min(w - 1), y)];
            let vertical = [pixel(x, y.saturating_sub(1)), pixel(x, (y + 1).min(h - 1))];
            for (j, v) in vertical.iter().enumerate() {
                for (i, u) in horizontal.iter().enumerate() {
                    let offset = (2 * y + j) * stride + (2 * x + i) * 4;
                    let contrast = distance(center, u).min(distance(center, v));
                    let corner = distance(u, v) < contrast / 2
                        && distance(u, horizontal[1 - i]) > contrast / 2
                        && distance(v, vertical[1 - j]) > contrast / 2;
                    let blend = if corner {
                        80
                    } else {
                        28u32.saturating_sub(distance(center, u).max(distance(center, v)) / 3)
                    };
                    let blend = blend * u32::from(strength.min(100)) / 100;
                    for c in 0..3 {
                        dst[offset + c] = ((u32::from(center[c]) * (256 - 2 * blend)
                            + (u32::from(u[c]) + u32::from(v[c])) * blend
                            + 128)
                            >> 8) as u8;
                    }
                    dst[offset + 3] = 255;
                }
            }
        }
    }
}

#[wasm_bindgen]
pub fn hd_frame(src: &[u8], w: usize, h: usize, strength: u8) -> Result<Vec<u8>, String> {
    if !(1..=512).contains(&w) || !(1..=512).contains(&h) || src.len() != w * h * 4 {
        return Err("Invalid HD frame size".into());
    }
    let mut dst = vec![0; w * h * 16];
    scale(src, w, h, w * 4, strength, &mut dst, w * 8);
    Ok(dst)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_straight_edges_and_cuts_corners() {
        let source = [255, 255, 0, 255, 0, 0, 0, 0, 0]
            .into_iter()
            .flat_map(|v| [v, v, v, 255])
            .collect::<Vec<_>>();
        let out = hd_frame(&source, 3, 3, 100).unwrap();
        assert!(out[(2 * 6 + 2) * 4] > 100);
        assert_eq!(out[(3 * 6 + 3) * 4], 0);
        assert_eq!(out[0], 255);
    }
}
