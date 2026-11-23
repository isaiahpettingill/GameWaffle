use crate::{Error, Game, draw};
use sdl3::{
    pixels::PixelFormat,
    render::{Canvas, FRect, Texture, TextureCreator},
    surface::{Surface, SurfaceContext},
};
use self_cell::self_cell;
type AtlasTexture<'a> = Texture<'a>;
self_cell!(
    struct CachedAtlas {
        owner: TextureCreator<SurfaceContext<'static>>,
        #[covariant]
        dependent: AtlasTexture,
    }
);

pub(super) struct Video {
    canvas: Canvas<Surface<'static>>,
    atlas: Option<(String, CachedAtlas)>,
    pub dimensions: [u32; 2],
    rectangles: Vec<FRect>,
}

impl Video {
    pub fn new(game: &Game) -> Result<Self, Error> {
        let cam = game.media.camera;
        let [_, _, w, h] = gamewaffle_runtime::viewport(
            cam,
            [320 * cam.zoom.max(1).min(16), 240 * cam.zoom.max(1).min(16)],
            [320, 240],
            [160., 120.],
        );
        let canvas = Surface::new(w, h, PixelFormat::XRGB8888)?.into_canvas()?;
        Ok(Self {
            canvas,
            atlas: None,
            dimensions: [w, h],
            rectangles: Vec::new(),
        })
    }
    pub fn frame(&mut self, game: &Game, output: super::VideoFn) -> Result<(), Error> {
        let snapshot = game.runtime.view();
        let id = snapshot.room;
        let room = &game.media.rooms[id];
        if self.atlas.as_ref().is_none_or(|a| a.0 != id) {
            let atlas = CachedAtlas::try_new(self.canvas.texture_creator(), |creator| {
                game.media.atlases[id].texture(creator)
            })?;
            self.atlas = Some((id.to_owned(), atlas));
        }
        let focus = snapshot
            .focus
            .or_else(|| {
                snapshot
                    .actors
                    .iter()
                    .find(|a| a.player == Some(0))
                    .map(|a| [a.x, a.y])
            })
            .unwrap_or([room.width as f32 / 2., room.height as f32 / 2.]);
        let [w, h] = self.dimensions;
        let cam = game.media.camera;
        let view = gamewaffle_runtime::viewport(
            cam,
            [
                w.saturating_mul(cam.zoom.max(1)),
                h.saturating_mul(cam.zoom.max(1)),
            ],
            [room.width, room.height],
            focus,
        );
        draw(
            &mut self.canvas,
            game,
            &snapshot,
            self.atlas.as_ref().unwrap().1.borrow_dependent(),
            view,
            &mut self.rectangles,
        )?;
        self.canvas.present();
        let surface = self.canvas.surface();
        surface.with_lock(|pixels| output(pixels.as_ptr().cast(), w, h, surface.pitch() as usize));
        Ok(())
    }
}
