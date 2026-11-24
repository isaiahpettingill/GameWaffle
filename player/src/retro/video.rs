use crate::{Error, Game, draw, fit_frame};
use sdl3::{
    pixels::{Color, PixelFormat},
    rect::Rect,
    render::{Canvas, FRect, Texture, TextureCreator},
    surface::{Surface, SurfaceContext},
    sys::surface::SDL_SCALEMODE_NEAREST,
};
use self_cell::self_cell;

// The Android core renders into memory owned by SDL surfaces. RetroArch owns
// the activity, so the private SDL copy cannot wait for SDLActivity callbacks.
#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
extern "C" fn __wrap_Android_WaitActiveAndLockActivity() -> bool {
    true
}

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
extern "C" fn __wrap_Android_UnlockActivityMutex() {}

struct RoomTextures<'a> {
    atlas: Texture<'a>,
    ripple: Option<Texture<'a>>,
    hd: Option<Texture<'a>>,
    gradient: crate::gradient::Layer<'a>,
}
self_cell!(
    struct CachedAtlas {
        owner: TextureCreator<SurfaceContext<'static>>,
        #[covariant]
        dependent: RoomTextures,
    }
);

pub(super) struct Video {
    canvas: Canvas<Surface<'static>>,
    presentation: Option<Surface<'static>>,
    atlas: Option<(String, bool, bool, CachedAtlas)>,
    pub dimensions: [u32; 2],
    rectangles: Vec<FRect>,
}

impl Video {
    pub fn new(game: &Game) -> Result<Self, Error> {
        let cam = game.runtime.view().game_settings.display.unwrap_or(game.media.camera);
        let zoom = cam.zoom.clamp(1, 16);
        let [w, h] = cam.view_size([320 * zoom, 240 * zoom], None);
        let canvas = Surface::new(w, h, PixelFormat::XRGB8888)?.into_canvas()?;
        Ok(Self {
            canvas,
            presentation: None,
            atlas: None,
            dimensions: [w, h],
            rectangles: Vec::new(),
        })
    }
    pub fn frame(&mut self, game: &Game, output: super::VideoFn, environment: Option<super::EnvFn>) -> Result<(), Error> {
        let snapshot = game.runtime.view();
        let id = snapshot.room;
        let room = &game.media.rooms[id];
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
        let cam = snapshot.game_settings.display.unwrap_or(game.media.camera);
        let [w, h] = cam.view_size([320 * cam.zoom.max(1), 240 * cam.zoom.max(1)], None);
        if self.dimensions != [w, h] {
            self.dimensions = [w, h];
            if let Some(environment) = environment {
                const SET_GEOMETRY: u32 = 37;
                let mut geometry = super::Geometry { w, h, max_w: 1024, max_h: 1024, aspect: w as f32 / h as f32 };
                environment(SET_GEOMETRY, std::ptr::from_mut(&mut geometry).cast());
            }
        }
        let view = if game.media.runtime_abi >= 15 {
            snapshot.viewport.map(|pixel| pixel as u32)
        } else { gamewaffle_runtime::viewport_zoom(
            cam,
            [
                w.saturating_mul(cam.zoom.max(1)),
                h.saturating_mul(cam.zoom.max(1)),
            ],
            [room.width, snapshot.room_settings.camera_height.unwrap_or_else(|| room.camera_height())],
            focus,
            snapshot.room_settings.zoom,
        ) };
        let [_, _, w, h] = view;
        let hd = snapshot.room_settings.shader_pipeline.is_none() && room.hd_strength(snapshot.room_settings.shader) > 0;
        let ripple_active = snapshot.room_settings.shader_pipeline.is_none() && room
            .ripple_settings(snapshot.room_settings.shader)
            .is_some();
        let scale = if hd { 2 } else { 1 };
        if self.canvas.surface().width() != w * scale || self.canvas.surface().height() != h * scale
        {
            self.atlas = None;
            self.canvas =
                Surface::new(w * scale, h * scale, PixelFormat::XRGB8888)?.into_canvas()?;
        }
        if self
            .atlas
            .as_ref()
            .is_none_or(|a| a.0 != id || a.1 != hd || a.2 != ripple_active)
        {
            let atlas = CachedAtlas::try_new(self.canvas.texture_creator(), |creator| {
                let ripple = if ripple_active {
                    Some(creator.create_texture_target(PixelFormat::RGBA32, w, h)?)
                } else {
                    None
                };
                Ok::<_, Error>(RoomTextures {
                    atlas: game.media.atlases[id].texture(creator)?,
                    ripple,
                    gradient: Default::default(),
                    hd: if hd {
                        Some(creator.create_texture_streaming(PixelFormat::RGBA32, w * 2, h * 2)?)
                    } else {
                        None
                    },
                })
            })?;
            self.atlas = Some((id.to_owned(), hd, ripple_active, atlas));
        }
        self.atlas
            .as_mut()
            .unwrap()
            .3
            .with_dependent_mut(|creator, textures| {
                let settings = snapshot.room_settings;
                let gradient = textures.gradient.get(
                    creator,
                    settings.background_gradient.as_ref(),
                    [w, h],
                    settings.background.as_deref().unwrap_or(&room.background),
                )?;
                draw(
                    &mut self.canvas,
                    game,
                    &snapshot,
                    &mut textures.atlas,
                    view,
                    &mut self.rectangles,
                    textures.ripple.as_mut(),
                    textures.hd.as_mut(),
                    gradient,
                    None,
                )
            })?;
        self.canvas.present();
        let mut surface = self.canvas.surface();
        if let Some([width, height]) = cam
            .fixed_resolution()
            .filter(|&size| size != [w * scale, h * scale])
        {
            if self.presentation.is_none() {
                self.presentation = Some(Surface::new(width, height, PixelFormat::XRGB8888)?);
            }
            let output = self.presentation.as_mut().unwrap();
            output.fill_rect(None, Color::RGB(14, 14, 22))?;
            let [x, y, fit_w, fit_h] = fit_frame([w, h], [width, height]);
            surface.blit_scaled(
                None,
                output,
                Rect::new(x as i32, y as i32, fit_w, fit_h),
                SDL_SCALEMODE_NEAREST,
            )?;
            surface = output;
        }
        surface.with_lock(|pixels| {
            output(
                pixels.as_ptr().cast(),
                surface.width(),
                surface.height(),
                surface.pitch() as usize,
            )
        });
        Ok(())
    }
}
