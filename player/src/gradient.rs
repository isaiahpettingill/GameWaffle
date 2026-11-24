use crate::Error;
use gamewaffle_runtime::gradient::{Gradient, rasterize, rgb};
use sdl3::{
    pixels::PixelFormat,
    render::{ScaleMode, Texture, TextureCreator},
};

#[derive(Default)]
pub(crate) struct Layer<'a> {
    texture: Option<Texture<'a>>,
    current: Option<(Gradient, [u32; 2], [u8; 3])>,
    pixels: Vec<u8>,
}

impl<'a> Layer<'a> {
    pub(crate) fn get<T>(
        &mut self,
        creator: &'a TextureCreator<T>,
        gradient: Option<&Gradient>,
        size: [u32; 2],
        background: &str,
    ) -> Result<Option<&Texture<'a>>, Error> {
        let Some(gradient) = gradient else {
            return Ok(None);
        };
        let color = rgb(background).unwrap_or([23, 24, 41]);
        if self.current.as_ref().is_some_and(|(prior, extent, base)| {
            prior == gradient && *extent == size && *base == color
        }) {
            return Ok(self.texture.as_ref());
        }
        let [w, h] = size;
        if self
            .current
            .as_ref()
            .is_none_or(|(_, prior, _)| *prior != size)
        {
            let mut texture = creator.create_texture_streaming(PixelFormat::RGBA32, w, h)?;
            texture.set_scale_mode(ScaleMode::Nearest);
            self.texture = Some(texture);
        }
        rasterize(&mut self.pixels, size, gradient, color);
        self.texture
            .as_mut()
            .unwrap()
            .update(None, &self.pixels, w as usize * 4)?;
        self.current = Some((gradient.clone(), size, color));
        Ok(self.texture.as_ref())
    }
}
