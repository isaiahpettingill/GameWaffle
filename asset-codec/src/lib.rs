use png::{BitDepth, ColorType, DeflateCompression, Encoder, Filter};
use std::collections::{HashMap, hash_map::Entry};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let bytes = width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(4));
    if width == 0 || height == 0 || bytes.map(|bytes| bytes as usize) != Some(rgba.len()) {
        return Err("Invalid RGBA image dimensions or length".into());
    }

    let mut output = Vec::new();
    let mut encoder = Encoder::new(&mut output, width, height);
    encoder.set_deflate_compression(DeflateCompression::Level(4));
    let indexed = index_pixels(rgba, width as usize);
    let pixels = if let Some(image) = indexed.as_ref() {
        encoder.set_color(ColorType::Indexed);
        encoder.set_depth(image.depth);
        encoder.set_palette(image.colors.as_slice());
        if !image.alpha.is_empty() {
            encoder.set_trns(image.alpha.as_slice());
        }
        encoder.set_filter(Filter::NoFilter);
        image.indices.as_slice()
    } else {
        encoder.set_color(ColorType::Rgba);
        encoder.set_depth(BitDepth::Eight);
        encoder.set_filter(Filter::Adaptive);
        rgba
    };
    let mut writer = encoder.write_header().map_err(|error| error.to_string())?;
    writer
        .write_image_data(pixels)
        .map_err(|error| error.to_string())?;
    writer.finish().map_err(|error| error.to_string())?;
    Ok(output)
}

struct IndexedImage {
    depth: BitDepth,
    colors: Vec<u8>,
    alpha: Vec<u8>,
    indices: Vec<u8>,
}

fn index_pixels(rgba: &[u8], width: usize) -> Option<IndexedImage> {
    let mut palette = HashMap::new();
    let mut colors = Vec::new();
    let mut alpha = Vec::new();
    let mut indices = Vec::with_capacity(rgba.len() / 4);
    // Sprite and tile artwork commonly contain long runs of the same color.
    let mut previous = None;
    for pixel in rgba.chunks_exact(4) {
        let index = match previous {
            Some((color, index)) if color == pixel => index,
            _ => {
                let next = palette.len();
                let index = match palette.entry(pixel) {
                    Entry::Occupied(entry) => *entry.get(),
                    Entry::Vacant(entry) => {
                        let index = u8::try_from(next).ok()?;
                        colors.extend_from_slice(&pixel[..3]);
                        alpha.push(pixel[3]);
                        *entry.insert(index)
                    }
                };
                previous = Some((pixel, index));
                index
            }
        };
        indices.push(index);
    }

    // Bytes after the last non-opaque entry are optional in the transparency chunk.
    alpha.truncate(
        alpha
            .iter()
            .rposition(|&value| value != 255)
            .map_or(0, |last| last + 1),
    );
    let (depth, bits) = match palette.len() {
        0..=2 => (BitDepth::One, 1),
        3..=4 => (BitDepth::Two, 2),
        5..=16 => (BitDepth::Four, 4),
        _ => (BitDepth::Eight, 8),
    };
    if bits < 8 {
        let per_byte = 8 / bits;
        let stride = width.div_ceil(per_byte);
        let mut packed = Vec::with_capacity(indices.len() / width * stride);
        for row in indices.chunks_exact(width) {
            for group in row.chunks(per_byte) {
                let byte = group.iter().enumerate().fold(0, |byte, (index, value)| {
                    byte | (value << (8 - bits * (index + 1)))
                });
                packed.push(byte);
            }
        }
        indices = packed;
    }
    Some(IndexedImage {
        depth,
        colors,
        alpha,
        indices,
    })
}
