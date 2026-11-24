use crate::{Error, Game, draw, fit_frame, split};
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
    split: [split::Targets<'a>; 4],
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
    pub(super) fn display_size(game: &Game) -> [u32; 2] {
        let camera = game
            .runtime
            .game_settings()
            .display
            .unwrap_or(game.media.camera);
        let zoom = camera.zoom.clamp(1, 16);
        camera.view_size([320 * zoom, 240 * zoom], None)
    }

    pub fn new(game: &Game) -> Result<Self, Error> {
        let [w, h] = Self::display_size(game);
        let canvas = Surface::new(w, h, PixelFormat::XRGB8888)?.into_canvas()?;
        Ok(Self {
            canvas,
            presentation: None,
            atlas: None,
            dimensions: [w, h],
            rectangles: Vec::new(),
        })
    }
    pub fn frame(
        &mut self,
        game: &Game,
        output: super::VideoFn,
        environment: Option<super::EnvFn>,
    ) -> Result<(), Error> {
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
        let display = Self::display_size(game);
        if self.dimensions != display {
            self.dimensions = display;
            if let Some(environment) = environment {
                const SET_GEOMETRY: u32 = 37;
                let mut geometry = super::Geometry::new(display);
                environment(SET_GEOMETRY, std::ptr::from_mut(&mut geometry).cast());
            }
        }
        let view = if game.media.runtime_abi >= 15 {
            snapshot.viewport.map(|pixel| pixel as u32)
        } else {
            gamewaffle_runtime::viewport_zoom(
                cam,
                [
                    display[0].saturating_mul(cam.zoom.max(1)),
                    display[1].saturating_mul(cam.zoom.max(1)),
                ],
                [
                    room.width,
                    snapshot
                        .room_settings
                        .camera_height
                        .unwrap_or_else(|| room.camera_height()),
                ],
                focus,
                snapshot.room_settings.zoom,
            )
        };
        let layout = split::Layout::for_frame(
            &snapshot,
            game.runtime.connected_player_mask(),
            display,
            [view[2], view[3]],
        );
        let split = layout.is_split();
        let [w, h] = if split { display } else { [view[2], view[3]] };
        let scale = if snapshot.room_settings.shader_pipeline.is_none()
            && room.hd_strength(snapshot.room_settings.shader) > 0
        {
            2
        } else {
            1
        };
        let hd = !split && scale == 2;
        let ripple_active = !split
            && snapshot.room_settings.shader_pipeline.is_none()
            && room
                .ripple_settings(snapshot.room_settings.shader)
                .is_some();
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
                    split: Default::default(),
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
                if split {
                    return split::draw(
                        &mut self.canvas,
                        creator,
                        game,
                        &snapshot,
                        &mut textures.atlas,
                        &layout,
                        &mut textures.split,
                        &mut self.rectangles,
                        None,
                        scale,
                    );
                }
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
                    layout.focus,
                    &mut self.rectangles,
                    textures.ripple.as_mut(),
                    textures.hd.as_mut(),
                    gradient,
                    None,
                )
            })?;
        self.canvas.present();
        let mut surface = self.canvas.surface();
        let [width, height] = display.map(|pixels| pixels * scale);
        if display != [w, h] {
            if self
                .presentation
                .as_ref()
                .is_none_or(|surface| surface.width() != width || surface.height() != height)
            {
                self.presentation = Some(Surface::new(width, height, PixelFormat::XRGB8888)?);
            }
            let output = self.presentation.as_mut().unwrap();
            output.fill_rect(None, Color::RGB(14, 14, 22))?;
            let [x, y, fit_w, fit_h] = fit_frame([w, h], display).map(|pixels| pixels * scale);
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
