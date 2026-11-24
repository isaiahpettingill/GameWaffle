use flate2::bufread::ZlibDecoder;
use std::{borrow::Cow, collections::BTreeMap, io::Read, rc::Rc};
use wasm_bindgen::prelude::*;

type Palette = [[u8; 4]; 256];
type Result<T> = std::result::Result<T, &'static str>;

fn word(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

fn dword(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}

fn content(bytes: &[u8], offset: usize, length: usize) -> Result<&[u8]> {
    bytes
        .get(offset..)
        .and_then(|tail| tail.get(..length))
        .ok_or("Truncated Aseprite file")
}

fn name(bytes: &[u8], offset: usize) -> Result<(&[u8], usize)> {
    let length = usize::from(word(content(bytes, offset, 2)?, 0));
    Ok((content(bytes, offset + 2, length)?, offset + length + 2))
}

struct Layer<'a> {
    flags: u16,
    level: u16,
    blend: u16,
    opacity: f64,
    visible: bool,
    name: &'a [u8],
}

#[derive(Clone)]
struct Cel<'a> {
    x: i32,
    y: i32,
    z: i32,
    alpha: f64,
    width: usize,
    height: usize,
    pixels: Rc<Cow<'a, [u8]>>,
}

struct Frame<'a> {
    duration: u16,
    cels: BTreeMap<usize, Cel<'a>>,
    palette: Option<Box<Palette>>,
}

#[wasm_bindgen]
pub fn decode_aseprite(bytes: &[u8]) -> std::result::Result<Vec<u8>, String> {
    let header = bytes.get(..128).ok_or("Invalid Aseprite header")?;
    if word(header, 4) != 0xa5e0 {
        return Err("Invalid Aseprite header".into());
    }
    let count = usize::from(word(header, 6));
    let width = usize::from(word(header, 8));
    let height = usize::from(word(header, 10));
    let depth = usize::from(word(header, 12)) / 8;
    if !matches!(word(header, 12), 8 | 16 | 32)
        || count == 0
        || width == 0
        || height == 0
        || width as u64 * height as u64 * count as u64 > 120_000_000
    {
        return Err("Unsupported Aseprite dimensions or color depth".into());
    }
    let use_opacity = dword(header, 14) & 1 != 0;
    let transparent = header[28];
    let mut frames: Vec<Frame<'_>> = Vec::with_capacity(count);
    let mut layers: Vec<Layer<'_>> = Vec::new();
    let mut tag_count = 0u32;
    let mut tag_bytes = Vec::new();
    let mut palette = std::array::from_fn(|index| [index as u8; 4]);
    for color in &mut palette {
        color[3] = 255;
    }
    let mut modern_palette = false;
    let mut remaining = &bytes[128..];
    for index in 0..count {
        let head = content(remaining, 0, 16)?;
        let length = dword(head, 0) as usize;
        if length < 16 || word(head, 4) != 0xf1fa {
            return Err("Invalid Aseprite frame".into());
        }
        let frame = content(remaining, 0, length)?;
        let chunks = if word(head, 6) == 0xffff {
            dword(head, 12)
        } else {
            u32::from(word(head, 6))
        };
        let mut chunks_data = &frame[16..];
        remaining = &remaining[length..];
        let mut cels = BTreeMap::new();
        for _ in 0..chunks {
            let chunk = content(chunks_data, 0, 6)?;
            let size = dword(chunk, 0) as usize;
            if size < 6 {
                return Err("Invalid Aseprite chunk".into());
            }
            let body = &content(chunks_data, 0, size)?[6..];
            chunks_data = &chunks_data[size..];
            match word(chunk, 4) {
                0x2004 => {
                    let fields = content(body, 0, 16)?;
                    let level = word(fields, 4);
                    let flags = word(fields, 0);
                    let mut visible = flags & 1 != 0;
                    let mut opacity = if use_opacity {
                        f64::from(fields[12]) / 255.
                    } else {
                        1.
                    };
                    if level != 0
                        && let Some(parent) = layers.iter().rev().find(|layer| layer.level < level)
                    {
                        visible &= parent.visible;
                        opacity *= parent.opacity;
                    }
                    layers.push(Layer {
                        flags,
                        level,
                        opacity,
                        visible,
                        blend: word(fields, 10),
                        name: name(body, 16)?.0,
                    });
                }
                0x2005 => {
                    let fields = content(body, 0, 16)?;
                    let layer = usize::from(word(fields, 0));
                    let (w, h, pixels) = match word(fields, 7) {
                        0 | 2 => {
                            content(body, 16, 4)?;
                            let w = usize::from(word(body, 16));
                            let h = usize::from(word(body, 18));
                            let length = (w as u64 * h as u64 * depth as u64)
                                .try_into().ok().filter(|length: &usize| *length <= 64_000_000)
                                .ok_or("Aseprite cel exceeds size limit")?;
                            let packed = &body[20..];
                            let pixels = if word(fields, 7) == 0 {
                                if packed.len() != length {
                                    return Err("Invalid Aseprite cel pixels".into());
                                }
                                Rc::new(Cow::Borrowed(packed))
                            } else {
                                let mut output = Vec::with_capacity(length);
                                ZlibDecoder::new(packed).take(length as u64 + 1).read_to_end(&mut output)
                                    .map_err(|_| "Invalid Aseprite cel pixels")?;
                                if output.len() != length {
                                    return Err("Invalid Aseprite cel pixels".into());
                                }
                                Rc::new(Cow::Owned(output))
                            };
                            (w, h, pixels)
                        }
                        1 => {
                            let number = usize::from(word(content(body, 16, 2)?, 0));
                            let cel = frames.get(number).and_then(|frame| frame.cels.get(&layer))
                                .ok_or("Invalid linked Aseprite cel")?;
                            (cel.width, cel.height, Rc::clone(&cel.pixels))
                        }
                        3 => return Err("Flatten native Aseprite tilemap layers to image layers before importing".into()),
                        _ => continue,
                    };
                    cels.insert(
                        layer,
                        Cel {
                            x: i32::from(word(fields, 2) as i16),
                            y: i32::from(word(fields, 4) as i16),
                            z: i32::from(word(fields, 9) as i16),
                            alpha: f64::from(fields[6]) / 255.,
                            width: w,
                            height: h,
                            pixels,
                        },
                    );
                }
                0x2018 => {
                    let field = content(body, 0, 10)?;
                    let mut offset = 10;
                    for _ in 0..word(field, 0) {
                        let tag = content(body, offset, 17)?;
                        let (from, to, direction, repeat) =
                            (word(tag, 0), word(tag, 2), tag[4], word(tag, 5));
                        if from > to || usize::from(to) >= count || direction > 3 {
                            return Err("Invalid Aseprite tag range or direction".into());
                        }
                        let (label, next) = name(body, offset + 17)?;
                        tag_bytes.extend_from_slice(&from.to_le_bytes());
                        tag_bytes.extend_from_slice(&to.to_le_bytes());
                        tag_bytes.push(direction);
                        tag_bytes.extend_from_slice(&repeat.to_le_bytes());
                        tag_bytes.extend_from_slice(&(label.len() as u16).to_le_bytes());
                        tag_bytes.extend_from_slice(label);
                        tag_count += 1;
                        offset = next;
                    }
                }
                0x2019 if depth == 1 => {
                    let fields = content(body, 0, 20)?;
                    let first = dword(fields, 4) as usize;
                    let last = dword(fields, 8) as usize;
                    let colors = palette
                        .get_mut(first..=last)
                        .ok_or("Indexed palette exceeds 256 colors")?;
                    modern_palette = true;
                    let mut offset = 20;
                    for color in colors {
                        let entry = content(body, offset, 6)?;
                        color.copy_from_slice(&entry[2..]);
                        offset += 6;
                        if word(entry, 0) & 1 != 0 {
                            offset = name(body, offset)?.1;
                        }
                    }
                }
                id @ (4 | 0x11) if depth == 1 && !modern_palette => {
                    if index == 0 && word(header, 32) > 256 {
                        continue;
                    }
                    let packets = word(content(body, 0, 2)?, 0);
                    let mut offset = 2;
                    let mut start = 0;
                    for _ in 0..packets {
                        let fields = content(body, offset, 2)?;
                        offset += 2;
                        start += usize::from(fields[0]);
                        let length = if fields[1] == 0 {
                            256
                        } else {
                            usize::from(fields[1])
                        };
                        let channels = content(body, offset, length * 3)?;
                        let target = palette
                            .get_mut(start..start + length)
                            .ok_or("Indexed palette exceeds 256 colors")?;
                        for (color, rgb) in target.iter_mut().zip(channels.chunks_exact(3)) {
                            let scale = |value| {
                                if id == 0x11 {
                                    ((u16::from(value) * 255 + 31) / 63) as u8
                                } else {
                                    value
                                }
                            };
                            *color = [scale(rgb[0]), scale(rgb[1]), scale(rgb[2]), 255];
                        }
                        start += length;
                        offset += length * 3;
                    }
                }
                _ => {}
            }
        }
        let duration = match word(head, 8) {
            0 => 100,
            value => value,
        };
        frames.push(Frame {
            duration,
            cels,
            palette: (depth == 1).then(|| Box::new(palette)),
        });
    }

    let frame_bytes = width * height * 4;
    let mut output = Vec::with_capacity(16 + tag_bytes.len() + count * (frame_bytes + 2));
    for value in [width as u32, height as u32, count as u32, tag_count] {
        output.extend_from_slice(&value.to_le_bytes());
    }
    output.extend_from_slice(&tag_bytes);
    for frame in frames {
        output.extend_from_slice(&frame.duration.to_le_bytes());
        let offset = output.len();
        output.resize(offset + frame_bytes, 0);
        let mut cels: Vec<_> = frame.cels.into_iter().collect();
        cels.sort_by_key(|(layer, cel)| (*layer as i32 + cel.z, *layer));
        for (index, cel) in cels {
            let Some(layer) = layers.get(index).filter(|layer| layer.visible) else {
                continue;
            };
            if layer.blend != 0 {
                return Err(format!(
                    "Layer \"{}\" uses an unsupported blend mode. Flatten it before importing.",
                    String::from_utf8_lossy(layer.name)
                ));
            }
            let image = &mut output[offset..];
            let opacity = cel.alpha * layer.opacity;
            let x = cel.x;
            let y = cel.y;
            for row in 0.max(-y)..(cel.height as i32).min(height as i32 - y) {
                for col in 0.max(-x)..(cel.width as i32).min(width as i32 - x) {
                    let source = (row as usize * cel.width + col as usize) * depth;
                    let first = cel.pixels[source];
                    let [r, g, b, a] = match depth {
                        4 => cel.pixels[source..source + 4].try_into().unwrap(),
                        2 => [first, first, first, cel.pixels[source + 1]],
                        _ if first == transparent && layer.flags & 8 == 0 => continue,
                        _ => frame.palette.as_ref().unwrap()[usize::from(first)],
                    };
                    let dest = ((row + y) as usize * width + (col + x) as usize) * 4;
                    let dest = &mut image[dest..dest + 4];
                    if a == 255 && opacity == 1. {
                        dest.copy_from_slice(&[r, g, b, a]);
                        continue;
                    }
                    let alpha = f64::from(a) * opacity;
                    let behind = f64::from(dest[3]) * (1. - alpha / 255.);
                    let total = alpha + behind;
                    if total != 0. {
                        for (value, old) in [r, g, b].into_iter().zip(&mut dest[..3]) {
                            *old = ((f64::from(value) * alpha + f64::from(*old) * behind) / total)
                                as u8;
                        }
                        dest[3] = total as u8;
                    }
                }
            }
        }
    }
    Ok(output)
}
