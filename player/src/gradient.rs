use crate::Error;
use gamewaffle_runtime::gradient::{Gradient, rasterize, rgb};
use sdl3::{
    pixels::PixelFormat,
    rect::Rect,
    render::{ScaleMode, Texture, TextureCreator},
};

pub(crate) type View<'texture, 'creator> = (&'texture Texture<'creator>, Rect);

#[derive(PartialEq)]
struct Region {
    origin: [i32; 2],
    size: [u32; 2],
    room: [u32; 2],
}

#[derive(Default)]
pub(crate) struct Layer<'a> {
    texture: Option<Texture<'a>>,
    current: Option<(Gradient, Region, [u8; 3])>,
    pixels: Vec<u8>,
}

impl<'a> Layer<'a> {
    pub(crate) fn get<T>(
        &mut self,
        creator: &'a TextureCreator<T>,
        gradient: Option<&Gradient>,
        size: [u32; 2],
        origin: [i32; 2],
        room: [u32; 2],
        background: &str,
    ) -> Result<Option<View<'_, 'a>>, Error> {
        let Some(gradient) = gradient else {
            return Ok(None);
        };
        const MARGIN: i32 = 64;
        let region = Region {
            origin: origin.map(|axis| axis.div_euclid(MARGIN) * MARGIN),
            size: size.map(|axis| axis + MARGIN as u32),
            room,
        };
        let crop = Rect::new(
            origin[0] - region.origin[0],
            origin[1] - region.origin[1],
            size[0],
            size[1],
        );
        let color = rgb(background).unwrap_or([23, 24, 41]);
        if self.current.as_ref().is_some_and(|(prior, extent, base)| {
            prior == gradient && *extent == region && *base == color
        }) {
            return Ok(self.texture.as_ref().map(|texture| (texture, crop)));
        }
        let [w, h] = region.size;
        if self
            .current
            .as_ref()
            .is_none_or(|(_, prior, _)| prior.size != region.size)
        {
            let mut texture = creator.create_texture_streaming(PixelFormat::RGBA32, w, h)?;
            texture.set_scale_mode(ScaleMode::Nearest);
            self.texture = Some(texture);
        }
        rasterize(
            &mut self.pixels,
            region.size,
            region.origin,
            room,
            gradient,
            color,
        );
        self.texture
            .as_mut()
            .unwrap()
            .update(None, &self.pixels, w as usize * 4)?;
        self.current = Some((gradient.clone(), region, color));
        Ok(self.texture.as_ref().map(|texture| (texture, crop)))
    }
}
