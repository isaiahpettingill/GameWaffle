use png::{BitDepth, ColorType, Decoder, Transformations};
use std::io::Cursor;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn decode_png(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(Transformations::EXPAND);
    decoder.set_ignore_text_chunk(true);
    decoder.set_ignore_iccp_chunk(true);
    let header = decoder
        .read_header_info()
        .map_err(|error| error.to_string())?;
    if header.width > 4096 || header.height > 4096 {
        return Err("PNG exceeds 4096 pixels per side".into());
    }
    let (width, height) = (header.width, header.height);
    let mut reader = decoder.read_info().map_err(|error| error.to_string())?;
    let info = reader.info();
    let clear_transparent =
        info.trns.is_some() && matches!(info.color_type, ColorType::Rgb | ColorType::Grayscale);
    let length = reader
        .output_buffer_size()
        .ok_or("Invalid PNG frame size")?;
    let mut decoded = vec![0; 8 + length];
    let frame = reader
        .next_frame(&mut decoded[8..])
        .map_err(|error| error.to_string())?;
    reader.finish().map_err(|error| error.to_string())?;
    if (frame.width, frame.height) != (width, height) {
        return Err("PNG first frame does not fill the image".into());
    }
    decoded[..4].copy_from_slice(&width.to_le_bytes());
    decoded[4..8].copy_from_slice(&height.to_le_bytes());

    if frame.color_type == ColorType::Rgba && frame.bit_depth == BitDepth::Eight {
        if clear_transparent {
            for pixel in decoded[8..].chunks_exact_mut(4) {
                if pixel[3] == 0 {
                    pixel.fill(0);
                }
            }
        }
        return Ok(decoded);
    }

    let mut rgba = Vec::with_capacity(8 + width as usize * height as usize * 4);
    rgba.extend_from_slice(&decoded[..8]);
    // Preserve the previous importer's rounded conversion from 16-bit samples.
    let sample_bytes = if frame.bit_depth == BitDepth::Sixteen {
        2
    } else {
        1
    };
    let sample = |pixel: &[u8], channel: usize| -> u8 {
        let index = channel * sample_bytes;
        if sample_bytes == 1 {
            pixel[index]
        } else {
            let value = u16::from_be_bytes([pixel[index], pixel[index + 1]]);
            ((u32::from(value) * 255 + 32767) / 65535) as u8
        }
    };
    for pixel in decoded[8..].chunks_exact(frame.color_type.samples() * sample_bytes) {
        let first = sample(pixel, 0);
        let mut color = match frame.color_type {
            ColorType::Grayscale => [first, first, first, 255],
            ColorType::GrayscaleAlpha => [first, first, first, sample(pixel, 1)],
            ColorType::Rgb => [first, sample(pixel, 1), sample(pixel, 2), 255],
            ColorType::Rgba => [first, sample(pixel, 1), sample(pixel, 2), sample(pixel, 3)],
            ColorType::Indexed => return Err("PNG palette could not be expanded".into()),
        };
        if clear_transparent && color[3] == 0 {
            color.fill(0);
        }
        rgba.extend_from_slice(&color);
    }
    Ok(rgba)
}
