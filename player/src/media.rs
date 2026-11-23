use gamewaffle_runtime::Camera;
use sdl3::{
    pixels::PixelFormat,
    rect::Rect,
    render::{BlendMode, ScaleMode, Texture, TextureCreator},
};
use serde::Deserialize;
use std::{collections::BTreeMap, io::Cursor};

type Error = Box<dyn std::error::Error>;

#[derive(Deserialize)]
pub struct Media {
    pub name: String,
    pub rooms: BTreeMap<String, Room>,
    pub atlases: BTreeMap<String, Atlas>,
    #[serde(default)]
    pub camera: Camera,
    #[serde(default)]
    pub audio: BTreeMap<String, Sound>,
}

#[derive(Deserialize)]
pub struct Room {
    #[serde(default)]
    pub seams: BTreeMap<String, bool>,
    pub width: u32,
    pub height: u32,
    pub background: String,
    pub baked: Vec<Layer>,
    #[serde(rename = "ySort", default)]
    pub y_sort: bool,
    pub music: Option<String>,
    pub ambience: Option<String>,
}

#[derive(Deserialize)]
pub struct Layer {
    pub image: String,
    pub layer: i32,
    #[serde(default)]
    pub x: i32,
    #[serde(default)]
    pub y: i32,
}

#[derive(Deserialize)]
pub struct Atlas {
    pub entries: BTreeMap<String, [i32; 4]>,
    #[serde(with = "serde_bytes")]
    png: Vec<u8>,
}

#[derive(Deserialize)]
pub struct Sound {
    pub format: String,
    #[serde(with = "serde_bytes")]
    pub data: Vec<u8>,
}

impl Media {
    pub fn read(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.len() > 256 * 1024 * 1024 {
            return Err("Cartridge exceeds 256 MiB".into());
        }
        let offset = match bytes.get(..6) {
            Some(b"GWAF\x00\x02") if bytes.len() >= 14 => {
                14usize.saturating_add(u32::from_le_bytes(bytes[6..10].try_into()?) as usize)
            }
            _ => return Err("Unsupported cartridge".into()),
        };
        Ok(ciborium::from_reader(
            bytes
                .get(offset..)
                .ok_or("Invalid cartridge section lengths")?,
        )?)
    }
}

impl Atlas {
    pub fn rect(&self, id: &str) -> Option<Rect> {
        let [x, y, w, h] = *self.entries.get(id)?;
        Some(Rect::new(x, y, w as u32, h as u32))
    }

    pub fn texture<'a, T>(&self, creator: &'a TextureCreator<T>) -> Result<Texture<'a>, Error> {
        let mut decoder = png::Decoder::new(Cursor::new(&self.png));
        decoder.set_transformations(png::Transformations::normalize_to_color8());
        let mut reader = decoder.read_info()?;
        let (width, height) = (reader.info().width, reader.info().height);
        if width > 4096 || height > 4096 || width == 0 || height == 0 {
            return Err("Invalid atlas dimensions".into());
        }
        let mut bytes = vec![0; reader.output_buffer_size().ok_or("Invalid atlas pixels")?];
        let frame = reader.next_frame(&mut bytes)?;
        let rgba = match frame.color_type {
            png::ColorType::Rgba => bytes,
            png::ColorType::Rgb => bytes
                .chunks_exact(3)
                .flat_map(|p| [p[0], p[1], p[2], 255])
                .collect(),
            png::ColorType::Grayscale => bytes.iter().flat_map(|&p| [p, p, p, 255]).collect(),
            png::ColorType::GrayscaleAlpha => bytes
                .chunks_exact(2)
                .flat_map(|p| [p[0], p[0], p[0], p[1]])
                .collect(),
            _ => return Err("Unsupported atlas pixels".into()),
        };
        let mut texture = creator.create_texture_static(PixelFormat::RGBA32, width, height)?;
        texture.update(None, &rgba, width as usize * 4)?;
        texture.set_scale_mode(ScaleMode::Nearest);
        texture.set_blend_mode(BlendMode::Blend);
        Ok(texture)
    }
}
