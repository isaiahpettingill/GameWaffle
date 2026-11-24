use gamewaffle_runtime::{Camera, cartridge::Sections};
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
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "runtimeAbi")]
    pub runtime_abi: u32,
    #[serde(default)]
    pub shaders: BTreeMap<String, crate::shaders::Shader>,
    pub minimap: Option<Minimap>,
    pub rooms: BTreeMap<String, Room>,
    pub atlases: BTreeMap<String, Atlas>,
    #[serde(default)]
    pub camera: Camera,
    #[serde(default)]
    pub audio: BTreeMap<String, Sound>,
    #[serde(rename = "fontGlyphs", default)]
    pub font_glyphs: BTreeMap<char, i32>,
    #[serde(rename = "fontLayout")]
    pub font_layout: Option<FontLayout>,
    #[serde(default)]
    pub fonts: BTreeMap<String, NamedFont>,
    #[serde(rename = "fontFallbackGlyphs", default)]
    pub font_fallback_glyphs: BTreeMap<char, i32>,
}

#[derive(Deserialize)]
pub struct NamedFont {
    pub layout: Option<FontLayout>,
    pub glyphs: BTreeMap<char, i32>,
}

#[derive(Deserialize)]
pub struct FontLayout {
    pub width: u32,
    pub height: u32,
    pub columns: i32,
}

#[derive(Deserialize)]
pub struct Minimap {
    pub mode: String,
    pub rooms: BTreeMap<String, [i32; 4]>,
    pub edges: Vec<[String; 2]>,
}

#[derive(Deserialize)]
pub struct Room {
    pub shader: Option<gamewaffle_runtime::RoomShader>,
    pub hd: Option<u8>,
    pub ripple: Option<[u8; 3]>,
    #[serde(default)]
    pub seams: BTreeMap<String, bool>,
    pub width: u32,
    pub height: u32,
    #[serde(rename = "cameraHeight")]
    pub camera_height: Option<u32>,
    pub background: String,
    pub baked: Vec<Layer>,
    #[serde(rename = "ySort", default)]
    pub y_sort: bool,
    pub music: Option<String>,
    pub ambience: Option<String>,
}

impl Room {
    pub fn camera_height(&self) -> u32 {
        self.camera_height
            .unwrap_or(self.height)
            .clamp(1, self.height.max(1))
    }

    pub fn hd_strength(&self, shader: Option<gamewaffle_runtime::RoomShader>) -> u8 {
        shader
            .or(self.shader)
            .map_or(self.hd.unwrap_or(0), |shader| shader.hd())
    }

    pub fn ripple_settings(
        &self,
        shader: Option<gamewaffle_runtime::RoomShader>,
    ) -> Option<[u8; 3]> {
        match shader.or(self.shader) {
            Some(shader) => shader.ripple(),
            None => self.ripple,
        }
    }
}

#[derive(Deserialize)]
pub struct Layer {
    pub image: String,
    pub layer: i32,
    #[serde(default)]
    pub x: i32,
    #[serde(default)]
    pub y: i32,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub parallax: Option<f32>,
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
        #[derive(Deserialize)]
        struct Card {
            name: String,
            #[serde(rename = "runtimeAbi")]
            runtime_abi: u32,
        }

        let sections = Sections::read(bytes)?;
        let mut media: Self = ciborium::from_reader(sections.media()?.as_ref())?;
        if let Some(card) = sections.card {
            let card: Card = ciborium::from_reader(card)?;
            media.name = card.name;
            media.runtime_abi = card.runtime_abi;
        }
        Ok(media)
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
