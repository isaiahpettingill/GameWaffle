use crate::{Error, Game, gradient, shaders};
use gamewaffle_runtime::Snapshot;
use sdl3::{
    pixels::{Color, PixelFormat},
    render::{Canvas, FRect, RenderTarget, ScaleMode, Texture, TextureCreator},
};

#[derive(Clone, Copy)]
struct Pane {
    bounds: [u32; 4],
    focus: [f32; 2],
}

#[derive(Default)]
pub(crate) struct Layout {
    pub(crate) focus: Option<[f32; 2]>,
    display: Option<[u32; 2]>,
    panes: [Option<Pane>; 4],
}

impl Layout {
    pub(crate) fn for_frame(
        snapshot: &Snapshot<'_>,
        connected: u8,
        display: [u32; 2],
        view: [u32; 2],
    ) -> Self {
        let Some(merge_distance) = snapshot.game_settings.split_screen else {
            return Self::default();
        };
        let mut positions = [None; 4];
        for actor in &snapshot.actors {
            if let Some(slot) = actor.player.filter(|&slot| connected & (1 << slot) != 0) {
                positions[slot] = Some([actor.x, actor.y]);
            }
        }
        Self::new(positions, merge_distance, display, view)
    }

    fn new(
        positions: [Option<[f32; 2]>; 4],
        merge_distance: u16,
        [width, height]: [u32; 2],
        [view_width, view_height]: [u32; 2],
    ) -> Self {
        let mut layout = Self::default();
        let mut players = positions.into_iter().flatten();
        let Some(first) = players.next() else {
            return layout;
        };
        let count = 1 + players.clone().count();
        let gap = f32::from(merge_distance);
        let close = gap > 0.
            && positions.iter().enumerate().all(|(i, a)| {
                a.is_none_or(|[x, y]| {
                    positions[..i].iter().flatten().all(|[bx, by]| {
                        let dx = (x - bx).abs();
                        let dy = (y - by).abs();
                        dx < view_width as f32
                            && dy < view_height as f32
                            && dx * dx + dy * dy <= gap * gap
                    })
                })
            });
        if count == 1 || close {
            let [min_x, min_y, max_x, max_y] = players.fold(
                [first[0], first[1], first[0], first[1]],
                |[min_x, min_y, max_x, max_y], [x, y]| {
                    [min_x.min(x), min_y.min(y), max_x.max(x), max_y.max(y)]
                },
            );
            layout.focus = Some([(min_x + max_x) * 0.5, (min_y + max_y) * 0.5]);
            return layout;
        }
        let (left, top) = (width / 2, height / 2);
        let (right, bottom) = (width - left, height - top);
        let bounds = match (count, width >= height) {
            (2, true) => [
                [0, 0, left, height],
                [left, 0, right, height],
                [0; 4],
                [0; 4],
            ],
            (2, false) => [[0, 0, width, top], [0, top, width, bottom], [0; 4], [0; 4]],
            (3, true) => [
                [0, 0, width, top],
                [0, top, left, bottom],
                [left, top, right, bottom],
                [0; 4],
            ],
            (3, false) => [
                [0, 0, left, height],
                [left, 0, right, top],
                [left, top, right, bottom],
                [0; 4],
            ],
            _ => [
                [0, 0, left, top],
                [left, 0, right, top],
                [0, top, left, bottom],
                [left, top, right, bottom],
            ],
        };
        for ((entry, focus), bounds) in layout
            .panes
            .iter_mut()
            .zip(positions.into_iter().flatten())
            .zip(bounds)
        {
            *entry = Some(Pane { bounds, focus });
        }
        layout.display = Some([width, height]);
        layout
    }

    pub(crate) fn is_split(&self) -> bool {
        self.display.is_some()
    }

    pub(crate) fn display(&self) -> Option<[u32; 2]> {
        self.display
    }
}

#[derive(Default)]
pub(crate) struct Targets<'a> {
    frame: Option<(u32, u32, Texture<'a>)>,
    ripple: Option<Texture<'a>>,
    hd: Option<Texture<'a>>,
    gradient: gradient::Layer<'a>,
    shaders: Option<shaders::Targets<'a>>,
}

pub(crate) fn draw<'a, T: RenderTarget>(
    canvas: &mut Canvas<T>,
    creator: &'a TextureCreator<T::Context>,
    game: &Game,
    snapshot: &Snapshot<'_>,
    atlas: &mut Texture<'_>,
    layout: &Layout,
    targets: &mut [Targets<'a>; 4],
    rectangles: &mut Vec<FRect>,
    pipeline: Option<&shaders::Pipeline>,
    output_scale: u32,
) -> Result<(), Error> {
    let room = &game.media.rooms[snapshot.room];
    let settings = snapshot.room_settings;
    let preset = settings.shader_pipeline.is_none();
    let hd = preset && room.hd_strength(settings.shader) > 0;
    let ripple = preset && room.ripple_settings(settings.shader).is_some();
    let zoom = settings.zoom.unwrap_or(1.);
    let camera_height = settings
        .camera_height
        .unwrap_or_else(|| room.camera_height());
    let scale = if hd { 2 } else { 1 };

    let pixels = |axis: u32| (axis * output_scale) as f32;
    canvas.set_draw_color(Color::RGB(14, 14, 22));
    canvas.clear();
    for (pane, targets) in layout.panes.iter().flatten().zip(targets) {
        let [x, y, pane_w, pane_h] = pane.bounds;
        let extent =
            |extent: u32, room: u32| ((extent as f32 / zoom) as u32).clamp(1, room.clamp(1, 512));
        let (w, h) = (extent(pane_w, room.width), extent(pane_h, camera_height));
        if targets
            .frame
            .as_ref()
            .is_none_or(|&(fw, fh, _)| (fw, fh) != (w * scale, h * scale))
            || targets.hd.is_some() != hd
            || targets.ripple.is_some() != ripple
        {
            let mut frame =
                creator.create_texture_target(PixelFormat::RGBA32, w * scale, h * scale)?;
            frame.set_scale_mode(ScaleMode::Nearest);
            targets.frame = Some((w * scale, h * scale, frame));
            targets.ripple = ripple
                .then(|| creator.create_texture_target(PixelFormat::RGBA32, w, h))
                .transpose()?;
            targets.hd = hd
                .then(|| {
                    creator.create_texture_streaming(PixelFormat::RGBA32, w * scale, h * scale)
                })
                .transpose()?;
        }
        if pipeline.is_some()
            && targets
                .shaders
                .as_ref()
                .is_none_or(|shader| shader.dimensions != [w, h])
        {
            targets.shaders = Some(shaders::Targets::new(creator, [w, h])?);
        }
        let gradient = targets.gradient.get(
            creator,
            settings.background_gradient.as_ref(),
            [w, h],
            settings.background.as_deref().unwrap_or(&room.background),
        )?;
        let frame = &mut targets.frame.as_mut().unwrap().2;
        let mut result = Ok(());
        canvas.with_texture_canvas(frame, |canvas| {
            result = crate::draw(
                canvas,
                game,
                snapshot,
                atlas,
                [0, 0, w, h],
                Some(pane.focus),
                rectangles,
                targets.ripple.as_mut(),
                targets.hd.as_mut(),
                gradient,
                pipeline.zip(targets.shaders.as_mut()),
            );
        })?;
        result?;
        let [dx, dy, dw, dh] = crate::fit_frame([w, h], [pane_w, pane_h]);
        canvas.copy(
            frame,
            None,
            FRect::new(pixels(x + dx), pixels(y + dy), pixels(dw), pixels(dh)),
        )?;
    }
    canvas.set_draw_color(Color::RGB(14, 14, 22));
    for pane in layout.panes.iter().flatten() {
        let [x, y, w, h] = pane.bounds.map(pixels);
        if x > 0. {
            canvas.fill_rect(FRect::new(x, y, pixels(1), h))?;
        }
        if y > 0. {
            canvas.fill_rect(FRect::new(x, y, w, pixels(1)))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panels_follow_slot_order_and_give_player_one_the_large_pane() {
        let players = [
            Some([10., 20.]),
            Some([40., 30.]),
            Some([80., 50.]),
            Some([120., 60.]),
        ];
        let layout = Layout::new(players, 0, [321, 225], [321, 225]);
        let panes = layout.panes.map(|pane| pane.unwrap().bounds);
        assert_eq!(
            panes,
            [
                [0, 0, 160, 112],
                [160, 0, 161, 112],
                [0, 112, 160, 113],
                [160, 112, 161, 113]
            ]
        );
        let mut three = players;
        three[1] = None;
        let layout = Layout::new(three, 0, [320, 224], [320, 224]);
        assert_eq!(layout.panes[0].unwrap().bounds, [0, 0, 320, 112]);
        assert_eq!(layout.panes[1].unwrap().focus, [80., 50.]);
        let portrait = Layout::new(three, 0, [224, 320], [224, 320]);
        assert_eq!(portrait.panes[0].unwrap().bounds, [0, 0, 112, 320]);
    }

    #[test]
    fn merge_requires_every_player_pair_to_fit() {
        let players = [Some([10., 20.]), Some([40., 40.]), Some([70., 20.]), None];
        assert!(Layout::new(players, 59, [320, 224], [320, 224]).is_split());
        assert!(Layout::new(players, 60, [320, 224], [60, 224]).is_split());
        let layout = Layout::new(players, 60, [320, 224], [320, 224]);
        assert!(!layout.is_split());
        assert_eq!(layout.focus, Some([40., 30.]));
        assert!(Layout::new(players, 0, [320, 224], [320, 224]).is_split());
    }
}
