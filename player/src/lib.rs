mod lan;
mod mapping;
mod media;
#[cfg(feature = "libretro")]
mod retro;
mod sound;

use gamewaffle_runtime::{Input, RoomShader, Runtime, ShaderKind, viewport, viewport_zoom};
use media::Media;
use sdl3::{
    dialog::{DialogFileFilter, show_open_file_dialog},
    event::{Event, WindowEvent},
    gamepad::{Axis, Button, Gamepad},
    keyboard::Scancode as Key,
    pixels::{Color, PixelFormat},
    render::{BlendMode, Canvas, FRect, Texture},
    video::Window,
};
use std::{
    collections::BTreeMap,
    io::Read,
    path::{Path, PathBuf},
    sync::mpsc,
    time::{Duration, Instant},
};
type Error = Box<dyn std::error::Error>;
const TICK: Duration = Duration::from_nanos(16_666_667);

fn active_track<'a>(setting: &'a Option<String>, default: &'a Option<String>) -> Option<&'a str> {
    setting
        .as_deref()
        .or(default.as_deref())
        .filter(|track| !track.is_empty())
}

struct Game {
    runtime: Runtime,
    media: Media,
}
impl Game {
    fn open(path: &Path) -> Result<Self, Error> {
        let mut bytes = Vec::new();
        sdl3::iostream::IOStream::from_file(path, "rb")?
            .take(256 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)?;
        Self::from_cartridge(&bytes)
    }
    fn from_cartridge(bytes: &[u8]) -> Result<Self, Error> {
        std::hint::black_box(
            b"GAMEWAFFLE_RUNTIME_ABI_3\0GAMEWAFFLE_RUNTIME_ABI_4\0GAMEWAFFLE_RUNTIME_ABI_5\0GAMEWAFFLE_RUNTIME_ABI_6\0GAMEWAFFLE_RUNTIME_ABI_7\0GAMEWAFFLE_RUNTIME_ABI_8\0GAMEWAFFLE_RUNTIME_ABI_9\0GAMEWAFFLE_RUNTIME_ABI_10\0GAMEWAFFLE_RUNTIME_ABI_11\0",
        );
        let mut runtime = Runtime::from_cartridge(bytes, None)?;
        runtime.set_seed(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .subsec_nanos(),
        );
        let media = Media::read(&bytes[..bytes.len() - 96])?;
        for name in media.rooms.keys() {
            if !media.atlases.contains_key(name) {
                return Err(format!("Missing atlas for {name}").into());
            }
        }
        Ok(Self { runtime, media })
    }
}

const BUTTONS: [Button; 8] = [
    Button::DPadUp,
    Button::DPadDown,
    Button::DPadLeft,
    Button::DPadRight,
    Button::South,
    Button::East,
    Button::West,
    Button::Start,
];
const KEYS: [[Key; 2]; 8] = [
    [Key::Up, Key::W],
    [Key::Down, Key::S],
    [Key::Left, Key::A],
    [Key::Right, Key::D],
    [Key::Z, Key::Semicolon],
    [Key::X, Key::Apostrophe],
    [Key::C, Key::Space],
    [Key::Return, Key::Return],
];

fn buttons(keys: [bool; 8]) -> Input {
    let [up, down, left, right, a, b, x, menu] = keys;
    Input {
        up,
        down,
        left,
        right,
        a,
        b,
        x,
        menu,
    }
}

fn overlay(width: u32, height: u32) -> [FRect; 12] {
    let (w, h) = (width as f32, height as f32);
    let size = (h * 0.145).clamp(18., 48.);
    let y = h - size * 3. - 4.;
    let right = w - size * 2. - 5.;
    let rect = |x, y| FRect::new(x, y, size - 1., size - 1.);
    [
        rect(5. + size, y),
        rect(5. + size, y + size * 2.),
        rect(5., y + size),
        rect(5. + size * 2., y + size),
        rect(right + size, y + size),
        rect(right, y + size * 2.),
        rect(right, y),
        rect(w / 2. - size / 2., h - size - 4.),
        rect(w - size - 4., 4.),
        rect(4., 4.),
        rect(6. + size, 4.),
        rect(w - size * 2. - 6., 4.),
    ]
}

fn touch_button(
    canvas: &Canvas<Window>,
    [width, height]: [u32; 2],
    x: f32,
    y: f32,
) -> Option<usize> {
    let (w, h) = canvas.output_size().ok()?;
    let scale = (w as f32 / width as f32).min(h as f32 / height as f32);
    let lx = (x * w as f32 - (w as f32 - width as f32 * scale) / 2.) / scale;
    let ly = (y * h as f32 - (h as f32 - height as f32 * scale) / 2.) / scale;
    overlay(width, height)
        .iter()
        .position(|r| lx >= r.x && lx < r.x + r.w && ly >= r.y && ly < r.y + r.h)
}

fn fit_frame([width, height]: [u32; 2], [display_w, display_h]: [u32; 2]) -> [u32; 4] {
    let w = display_w.min(display_h * width / height).max(1);
    let h = display_h.min(display_w * height / width).max(1);
    [(display_w - w) / 2, (display_h - h) / 2, w, h]
}

fn request_file(window: &Window, sender: &mpsc::Sender<PathBuf>) -> Result<(), Error> {
    let tx = sender.clone();
    show_open_file_dialog(
        &[DialogFileFilter {
            name: "GameWaffle cartridge",
            pattern: "waffle",
        }],
        None::<&Path>,
        false,
        window,
        Box::new(move |paths, _| {
            if let Ok(paths) = paths
                && let Some(path) = paths.into_iter().next()
            {
                let _ = tx.send(path);
            }
        }),
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn draw_world<T: sdl3::render::RenderTarget>(
    canvas: &mut Canvas<T>,
    game: &Game,
    snapshot: &gamewaffle_runtime::Snapshot<'_>,
    atlas: &mut Texture<'_>,
    view: [u32; 4],
    rectangles: &mut Vec<FRect>,
) -> Result<(), Error> {
    let room = &game.media.rooms[snapshot.room];
    let source = &game.media.atlases[snapshot.room];
    let [vx, vy, w, h] = view;
    let seam = |edge: &str, name: &str, horizontal: bool| {
        if room.seams.get(edge) != Some(&true) {
            return 0;
        }
        source.rect(name).map_or(0, |rect| {
            if horizontal {
                rect.width()
            } else {
                rect.height()
            }
        })
    };
    let axis = |base: u32, size: u32, extent: u32, focus: Option<f32>, before: u32, after: u32| {
        let half = size / 2;
        let origin = focus.map_or(i64::from(base), |f| {
            ((f + 0.5).floor() as i64).saturating_sub(i64::from(half))
        });
        origin.clamp(
            -i64::from(half.min(before)),
            i64::from(extent.saturating_sub(size) + (size - half).min(after)),
        ) as i32
    };
    let x = axis(
        vx,
        w,
        room.width,
        snapshot.focus.map(|p| p[0]),
        seam("left", "seam/left", true),
        seam("right", "seam/right", true),
    );
    let y = axis(
        vy,
        h,
        room.camera_height(),
        snapshot.focus.map(|p| p[1]),
        seam("up", "seam/up", false),
        if room.camera_height.is_none() {
            seam("down", "seam/down", false)
        } else {
            0
        },
    );
    let color = snapshot
        .room_settings
        .background
        .as_deref()
        .unwrap_or(&room.background)
        .strip_prefix('#')
        .and_then(|s| u32::from_str_radix(s, 16).ok())
        .unwrap_or(0x171829);
    canvas.set_draw_color(Color::RGB(
        (color >> 16) as u8,
        (color >> 8) as u8,
        color as u8,
    ));
    canvas.clear();
    use gamewaffle_runtime::ShadowPlacement;
    let mut entries: Vec<_> = room
        .baked
        .iter()
        .map(|layer| (layer.layer, 0, 0., Some(layer), None))
        .chain(snapshot.actors.iter().filter_map(|actor| {
            actor
                .shadow
                .as_ref()
                .filter(|shadow| shadow.style.placement == ShadowPlacement::Ground)
                .map(|_| (actor.layer, 1, 0., None, Some(actor)))
        }))
        .chain(snapshot.actors.iter().map(|actor| {
            (
                actor.layer,
                2,
                if snapshot.room_settings.y_sort.unwrap_or(room.y_sort)
                    && actor.image.starts_with("sprite/")
                {
                    actor.y + actor.height / 2.
                } else {
                    0.
                },
                None,
                Some(actor),
            )
        }))
        .collect();
    entries.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.total_cmp(&b.2)));
    let visible = |r: FRect| r.x < w as f32 && r.y < h as f32 && r.x + r.w > 0. && r.y + r.h > 0.;
    for (_, order, _, layer, actor) in entries {
        if let Some(layer) = layer {
            if let Some(r) = source.rect(&layer.image) {
                let scroll = layer.parallax.unwrap_or(1.0);
                let dest = FRect::new(
                    layer.x as f32 - x as f32 * scroll,
                    layer.y as f32 - y as f32 * scroll,
                    layer.width.unwrap_or(r.width()) as f32 * scroll + w as f32 * (1.0 - scroll),
                    layer.height.unwrap_or(r.height()) as f32 * scroll + h as f32 * (1.0 - scroll),
                );
                if visible(dest) {
                    canvas.copy(atlas, r, dest)?;
                }
            }
        } else if let Some(actor) = actor {
            let shadow = actor.shadow.as_ref().map(|shadow| {
                let [left, top, width, height] = shadow.rect;
                let dest = FRect::new(left - x as f32, top - y as f32, width, height);
                let alpha = (u16::from(shadow.style.opacity) * 255 / 100) as u8;
                (shadow.style.placement, dest, alpha)
            });
            if order == 1 {
                if let Some((_, dest, alpha)) = shadow.filter(|(_, dest, _)| visible(*dest)) {
                    rectangles.clear();
                    let ry = dest.h / 2.;
                    let cy = dest.y + ry;
                    let cx = dest.x + dest.w / 2.;
                    for y in dest.y.floor() as i32..(dest.y + dest.h).ceil() as i32 {
                        let ratio = (y as f32 + 0.5 - cy) / ry;
                        let half_width = dest.w / 2. * (1. - ratio * ratio).max(0.).sqrt();
                        if half_width > 0. {
                            rectangles.push(FRect::new(
                                cx - half_width,
                                y as f32,
                                2. * half_width,
                                1.,
                            ));
                        }
                    }
                    let blend = canvas.blend_mode();
                    canvas.set_blend_mode(BlendMode::Blend);
                    canvas.set_draw_color(Color::RGBA(0, 0, 0, alpha));
                    let result = canvas.fill_rects(rectangles);
                    canvas.set_blend_mode(blend);
                    result?;
                }
                continue;
            }
            let dest = FRect::new(
                actor.x.round() - x as f32 - actor.width / 2.,
                actor.y.round() - y as f32 - actor.height / 2.,
                actor.width,
                actor.height,
            );
            if let Some(r) = source.rect(actor.image) {
                let copy_sprite = |canvas: &mut Canvas<T>, atlas: &Texture<'_>, dest| {
                    canvas.copy_ex(
                        atlas,
                        r,
                        dest,
                        f64::from(actor.angle.to_degrees()),
                        None,
                        actor.facing < 0.,
                        actor.flip_y,
                    )
                };
                if let Some((ShadowPlacement::Behind, shadow, alpha)) =
                    shadow.filter(|(_, shadow, _)| visible(*shadow))
                {
                    let previous_alpha = atlas.alpha_mod();
                    let (red, green, blue) = atlas.color_mod();
                    atlas.set_alpha_mod(alpha);
                    atlas.set_color_mod(0, 0, 0);
                    let result = copy_sprite(canvas, atlas, shadow);
                    atlas.set_color_mod(red, green, blue);
                    atlas.set_alpha_mod(previous_alpha);
                    result?;
                }
                if visible(dest) {
                    copy_sprite(canvas, atlas, dest)?;
                }
            } else if visible(dest) {
                canvas.set_draw_color(Color::RGB(255, 200, 117));
                canvas.fill_rect(FRect::new(
                    actor.x - x as f32 - 2.,
                    actor.y - y as f32 - 2.,
                    4.,
                    4.,
                ))?;
            }
        }
    }
    for batch in snapshot.particles {
        if batch.points.is_empty() {
            continue;
        }
        let rgb = batch.color;
        canvas.set_draw_color(Color::RGB((rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8));
        rectangles.clear();
        rectangles.extend(batch.points.iter().map(|p| {
            FRect::new(
                (i32::from(p[0]) - x) as f32,
                (i32::from(p[1]) - y) as f32,
                batch.size as f32,
                batch.size as f32,
            )
        }));
        canvas.fill_rects(rectangles)?;
    }
    let color = |rgb: u32| Color::RGB((rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8);
    for bar in snapshot
        .actors
        .iter()
        .filter_map(|actor| actor.health_bar.as_ref())
    {
        let [left, top, width, height] = bar.rect;
        let track = FRect::new(left - x as f32, top - y as f32, width, height);
        if !visible(track) {
            continue;
        }
        canvas.set_draw_color(color(bar.style.track));
        canvas.fill_rect(track)?;
        let filled = ((width - 2.) * bar.fraction).round();
        if filled > 0. {
            canvas.set_draw_color(color(bar.style.fill));
            canvas.fill_rect(FRect::new(track.x + 1., track.y + 1., filled, height - 2.))?;
        }
    }
    Ok(())
}

fn draw_minimap<T: sdl3::render::RenderTarget>(
    canvas: &mut Canvas<T>,
    map: &media::Minimap,
    snapshot: &gamewaffle_runtime::Snapshot<'_>,
    width: u32,
    height: u32,
) -> Result<(), Error> {
    let visible = |name: &str| {
        map.mode == "world" || snapshot.explored.is_some_and(|rooms| rooms.contains(name))
    };
    let bounds = map.rooms.iter().filter(|(name, _)| visible(name)).fold(
        None::<[i32; 4]>,
        |bounds, (_, room)| {
            let [x, y, w, h] = *room;
            Some(match bounds {
                Some([l, t, r, b]) => [
                    i32::min(l, x),
                    i32::min(t, y),
                    i32::max(r, x + w),
                    i32::max(b, y + h),
                ],
                None => [x, y, x + w, y + h],
            })
        },
    );
    let Some([left, top, right, bottom]) = bounds else {
        return Ok(());
    };
    let scale = 3.0_f32
        .min(64.0 / (right - left).max(1) as f32)
        .min(42.0 / (bottom - top).max(1) as f32);
    let w = ((right - left) as f32 * scale).ceil();
    let h = ((bottom - top) as f32 * scale).ceil();
    let ox = width as f32 - w - 7.0;
    let oy = height as f32 - h - 7.0;
    let point = |x: f32, y: f32| {
        (
            (ox + (x - left as f32) * scale).round(),
            (oy + (y - top as f32) * scale).round(),
        )
    };
    canvas.set_draw_color(Color::RGB(26, 26, 40));
    canvas.fill_rect(FRect::new(ox - 3.0, oy - 3.0, w + 6.0, h + 6.0))?;
    canvas.set_draw_color(Color::RGB(136, 138, 167));
    for [a, b] in &map.edges {
        if !visible(a) || !visible(b) {
            continue;
        }
        let (Some(p), Some(q)) = (map.rooms.get(a), map.rooms.get(b)) else {
            continue;
        };
        let center = |r: &[i32; 4]| {
            point(
                r[0] as f32 + r[2] as f32 / 2.0,
                r[1] as f32 + r[3] as f32 / 2.0,
            )
        };
        canvas.draw_line(center(p), center(q))?;
    }
    for (id, [x, y, w, h]) in &map.rooms {
        if !visible(id) {
            continue;
        }
        let (x, y) = point(*x as f32, *y as f32);
        let rect = FRect::new(
            x,
            y,
            (*w as f32 * scale).round().max(1.0),
            (*h as f32 * scale).round().max(1.0),
        );
        canvas.set_draw_color(if id == snapshot.room {
            Color::RGB(249, 226, 175)
        } else {
            Color::RGB(41, 44, 64)
        });
        canvas.fill_rect(rect)?;
        canvas.set_draw_color(if id == snapshot.room {
            Color::RGB(255, 241, 188)
        } else {
            Color::RGB(166, 173, 200)
        });
        canvas.draw_rect(rect)?;
    }
    Ok(())
}

struct FontPainter<'a> {
    layout: Option<&'a media::FontLayout>,
    rect: sdl3::rect::Rect,
    fallback: Option<sdl3::rect::Rect>,
    glyphs: &'a std::collections::BTreeMap<char, i32>,
    fallback_glyphs: &'a std::collections::BTreeMap<char, i32>,
}

impl<'a> FontPainter<'a> {
    fn select(media: &'a Media, source: &media::Atlas, name: &str) -> Option<Self> {
        let named = media.fonts.get(name).and_then(|font| {
            source
                .rect(&format!("ui/font/{name}"))
                .map(|rect| (font, rect))
        });
        let (rect, layout, glyphs) = if let Some((font, rect)) = named {
            (rect, font.layout.as_ref(), &font.glyphs)
        } else {
            (
                source.rect("ui/font")?,
                media.font_layout.as_ref(),
                &media.font_glyphs,
            )
        };
        let layout = layout.filter(|layout| {
            (1..=64).contains(&layout.width)
                && (1..=64).contains(&layout.height)
                && (1..=4096).contains(&layout.columns)
        });
        let (fallback, fallback_glyphs) = if layout.is_some() {
            (source.rect("ui/font-fallback"), &media.font_fallback_glyphs)
        } else {
            (Some(rect), glyphs)
        };
        Some(Self {
            layout,
            rect,
            fallback,
            glyphs,
            fallback_glyphs,
        })
    }

    fn dimensions(&self) -> [u32; 2] {
        self.layout
            .map_or([6, 8], |layout| [layout.width, layout.height])
    }
}

fn paint_text<T: sdl3::render::RenderTarget>(
    canvas: &mut Canvas<T>,
    atlas: &Texture<'_>,
    font: &FontPainter<'_>,
    line: &str,
    mut x: f32,
    y: f32,
) -> Result<(), Error> {
    let [glyph_w, glyph_h] = font.dimensions();
    let layout = font.layout;
    for ch in line.chars() {
        let custom = layout.and_then(|layout| {
            let glyphs = font.glyphs;
            glyphs
                .get(&ch)
                .or_else(|| {
                    let mut upper = ch.to_uppercase();
                    let character = upper.next()?;
                    upper
                        .next()
                        .is_none()
                        .then(|| glyphs.get(&character))
                        .flatten()
                })
                .or_else(|| {
                    let mut lower = ch.to_lowercase();
                    let character = lower.next()?;
                    lower
                        .next()
                        .is_none()
                        .then(|| glyphs.get(&character))
                        .flatten()
                })
                .map(|&i| (i, glyph_w, glyph_h, layout.columns, font.rect))
        });
        let cell = custom.or_else(|| {
            font.fallback.map(|sheet| {
                let i = if (' '..='~').contains(&ch) {
                    ch as i32 - 32
                } else {
                    font.fallback_glyphs.get(&ch).copied().unwrap_or(31)
                };
                (i, 6, 8, 16, sheet)
            })
        });
        if let Some((i, width, height, columns, sheet)) = cell
            && (0..4096).contains(&i)
        {
            let left = i as u32 % columns as u32 * width;
            let top = i as u32 / columns as u32 * height;
            if left + width <= sheet.width() && top + height <= sheet.height() {
                let glyph = sdl3::rect::Rect::new(
                    sheet.x() + left as i32,
                    sheet.y() + top as i32,
                    width,
                    height,
                );
                canvas.copy(
                    atlas,
                    glyph,
                    FRect::new(x, y, glyph_w as f32, glyph_h as f32),
                )?;
            }
        }
        x += glyph_w as f32;
    }
    Ok(())
}

fn draw_weather<T: sdl3::render::RenderTarget>(
    canvas: &mut Canvas<T>,
    shader: RoomShader,
    [w, h]: [u32; 2],
    tick: u64,
    rectangles: &mut Vec<FRect>,
) -> Result<(), Error> {
    let (limit, dx, dy, rgb) = match shader.kind {
        ShaderKind::Snow => (80, 1, 1, [240, 246, 255]),
        ShaderKind::Rain => (120, 1, 5, [177, 213, 245]),
        ShaderKind::Wind => (50, 5, 1, [220, 232, 244]),
        _ => return Ok(()),
    };
    let count = (limit * u32::from(shader.strength)).div_ceil(100);
    if count == 0 {
        return Ok(());
    }
    rectangles.clear();
    let t = (tick % 36_000) as u32;
    for i in 0..count {
        let (length, height) = match shader.kind {
            ShaderKind::Snow => (1 + i % 2, 1 + i % 2),
            ShaderKind::Rain => (1, 5 + i % 4),
            _ => (7 + i % 10, 1),
        };
        let x = ((i * 67 + i * i * 17 + t * dx / 2) % (w + length)) as f32 - length as f32;
        let y = ((i * 53 + i * i * 23 + t * dy) % (h + height)) as f32 - height as f32;
        rectangles.push(FRect::new(x, y, length as f32, height as f32));
    }
    let blend = canvas.blend_mode();
    canvas.set_blend_mode(BlendMode::Blend);
    let alpha = (65 + u16::from(shader.strength) * 110 / 100) as u8;
    canvas.set_draw_color(Color::RGBA(rgb[0], rgb[1], rgb[2], alpha));
    let rendered = canvas.fill_rects(rectangles);
    canvas.set_blend_mode(blend);
    rendered?;
    Ok(())
}

fn draw<T: sdl3::render::RenderTarget>(
    canvas: &mut Canvas<T>,
    game: &Game,
    snapshot: &gamewaffle_runtime::Snapshot<'_>,
    atlas: &mut Texture<'_>,
    view: [u32; 4],
    rectangles: &mut Vec<FRect>,
    ripple_target: Option<&mut Texture<'_>>,
    hd_target: Option<&mut Texture<'_>>,
) -> Result<(), Error> {
    let [_, _, w, h] = view;
    let room = &game.media.rooms[snapshot.room];
    let source = &game.media.atlases[snapshot.room];
    let override_shader = snapshot.room_settings.shader;
    let shader = override_shader.or(room.shader);
    let hd = room.hd_strength(override_shader);
    if let (Some([amplitude, wavelength, speed]), Some(scene)) =
        (room.ripple_settings(override_shader), ripple_target)
    {
        let mut result = Ok(());
        canvas.with_texture_canvas(scene, |target| {
            result = draw_world(target, game, snapshot, atlas, view, rectangles);
        })?;
        result?;
        for row in (0..h).step_by(2) {
            let phase = row as f64 / wavelength.max(1) as f64
                + (snapshot.tick % 60) as f64 * speed as f64 / 60.;
            let shift = (amplitude as f64 * (phase * std::f64::consts::TAU).sin()).round() as i32;
            let band = 2.min(h - row);
            let copy = |canvas: &mut Canvas<T>, sx, sw, dx, dw| {
                canvas.copy(
                    scene,
                    sdl3::rect::Rect::new(sx, row as i32, sw, band),
                    FRect::new(dx as f32, row as f32, dw as f32, band as f32),
                )
            };
            copy(canvas, 0, w, shift, w)?;
            if shift > 0 {
                copy(canvas, 0, 1, 0, shift as u32)?;
            }
            if shift < 0 {
                copy(
                    canvas,
                    w as i32 - 1,
                    1,
                    w as i32 + shift,
                    shift.unsigned_abs(),
                )?;
            }
        }
    } else {
        draw_world(canvas, game, snapshot, atlas, view, rectangles)?;
    }
    let layers = shader.map_or(
        &[
            ("post/screen", "screen"),
            ("post/rows", "rows"),
            ("post/columns", "columns"),
        ][..],
        |shader| shader.kind.masks(),
    );
    if !layers.is_empty() && shader.is_none_or(|shader| shader.strength > 0) {
        if let Some(shader) = shader {
            atlas.set_alpha_mod((u16::from(shader.strength) * 255 / 100) as u8);
        }
        let overlays = (|| -> Result<(), Error> {
            for (key, layer) in layers {
                if let Some(mut rect) = source.rect(key) {
                    if *layer == "rows" {
                        rect.set_height(h);
                    }
                    if *layer == "columns" {
                        rect.set_width(w);
                    }
                    canvas.copy(atlas, rect, FRect::new(0., 0., w as f32, h as f32))?;
                }
            }
            Ok(())
        })();
        if shader.is_some() {
            atlas.set_alpha_mod(255);
        }
        overlays?;
    }
    if let Some(shader) = shader {
        draw_weather(canvas, shader, [w, h], snapshot.tick, rectangles)?;
    }
    if let Some(texture) = hd_target {
        let raw = canvas.read_pixels(sdl3::rect::Rect::new(0, 0, w, h))?;
        let surface = if raw.pixel_format() == PixelFormat::RGBA32 {
            raw
        } else {
            raw.convert_format(PixelFormat::RGBA32)?
        };
        surface.with_lock(|pixels| {
            texture.with_lock(None, |out, stride| {
                gamewaffle_runtime::hd::scale(
                    pixels,
                    w as usize,
                    h as usize,
                    surface.pitch() as usize,
                    hd,
                    out,
                    stride,
                )
            })
        })?;
        canvas.copy(
            texture,
            None,
            FRect::new(0., 0., (w * 2) as f32, (h * 2) as f32),
        )?;
        canvas.set_scale(2., 2.)?;
    }
    if snapshot.menu.is_none()
        && snapshot.dialog.is_none()
        && let Some(map) = &game.media.minimap
    {
        draw_minimap(canvas, map, snapshot, w, h)?;
    }
    if let Some(font) = FontPainter::select(&game.media, source, snapshot.hud_font) {
        let [glyph_w, glyph_h] = font.dimensions();
        let text = |canvas: &mut Canvas<T>, line: &str, x: f32, y: f32| {
            paint_text(canvas, atlas, &font, line, x, y)
        };
        for entry in snapshot.hud_text.values() {
            let chosen = if entry.font.is_empty() {
                None
            } else {
                FontPainter::select(&game.media, source, &entry.font)
            };
            let painter = chosen.as_ref().unwrap_or(&font);
            let [gw, gh] = painter.dimensions();
            let lines = entry.value.split('\n');
            let height = gh * lines.clone().count() as u32;
            for (row, line) in lines.enumerate() {
                let [x, y] = entry.anchor.position(
                    [w, h],
                    [line.chars().count() as u32 * gw, height],
                    entry.offset,
                );
                let y = y + row as f32 * gh as f32;
                if y > -(gh as f32) && y < h as f32 {
                    paint_text(canvas, atlas, painter, line, x, y)?;
                }
            }
        }

        canvas.set_draw_color(Color::RGB(38, 35, 52));
        for (id, [x, y]) in snapshot.icons {
            if let Some(r) = source.rect(&format!("ui/item/{id}")) {
                canvas.copy(
                    atlas,
                    r,
                    FRect::new(*x as f32, *y as f32, r.width() as f32, r.height() as f32),
                )?;
            }
        }
        let mut y = 2.;
        for (label, value) in snapshot.counters {
            let line = format!("{label} {value}");
            canvas.fill_rect(FRect::new(
                2.,
                y,
                line.chars().count() as f32 * glyph_w as f32 + 4.,
                glyph_h as f32 + 1.,
            ))?;
            text(canvas, &line, 4., y)?;
            y += glyph_h as f32 + 2.;
        }
        for (label, [value, max]) in snapshot.bars {
            text(canvas, label, 4., y)?;
            y += glyph_h as f32;
            canvas.set_draw_color(Color::RGB(38, 35, 52));
            canvas.fill_rect(FRect::new(2., y, 64., 5.))?;
            canvas.set_draw_color(Color::RGB(146, 218, 196));
            canvas.fill_rect(FRect::new(
                3.,
                y + 1.,
                62. * (*value as f32) / (*max as f32),
                3.,
            ))?;
            y += 7.;
        }
        canvas.set_draw_color(Color::RGB(38, 35, 52));
        if snapshot.dialog.is_some() || snapshot.menu.is_some() {
            let columns = ((w as usize).saturating_sub(8) / glyph_w as usize).max(1);
            let visible_rows = ((h as usize).saturating_sub(10) / glyph_h as usize).max(1);
            let lines: Vec<String> = if let Some(menu) = snapshot.menu {
                let clip = |value: &str| value.chars().take(columns).collect::<String>();
                let rows = visible_rows.saturating_sub(2).clamp(1, 8);
                let start = menu.selected.saturating_sub(rows - 1);
                std::iter::once(clip(&menu.title))
                    .chain(menu.options.iter().enumerate().skip(start).take(rows).map(
                        |(i, label)| {
                            clip(&format!(
                                "{}{label}",
                                if i == menu.selected { "> " } else { "  " }
                            ))
                        },
                    ))
                    .chain(std::iter::once(clip(&menu.controls)))
                    .collect()
            } else {
                gamewaffle_runtime::dialogue_lines(snapshot.dialog.unwrap(), columns)
                    .lines()
                    .take(visible_rows.saturating_sub(1).max(1))
                    .map(String::from)
                    .chain(std::iter::once("[A]".into()))
                    .collect()
            };
            y = (h as f32 - lines.len() as f32 * glyph_h as f32 - 10.).max(0.);
            canvas.fill_rect(FRect::new(1., y, w as f32 - 2., h as f32 - y - 1.))?;
            for line in lines {
                text(canvas, &line, 4., y + 1.)?;
                y += glyph_h as f32;
            }
        }
    }
    if hd > 0 {
        canvas.set_scale(1., 1.)?;
    }
    Ok(())
}

fn save_slot(runtime: &mut Runtime, slot: u8, write: bool) -> Result<(), Error> {
    let id = runtime
        .save_id()
        .bytes()
        .fold(14695981039346656037u64, |h, b| {
            (h ^ u64::from(b)).wrapping_mul(1099511628211)
        });
    let path = sdl3::filesystem::get_pref_path("GameWaffle", "Player")?
        .join(format!("{id:016x}-{slot}.sav"));
    if write {
        let temp = path.with_extension(format!("{}.tmp", std::process::id()));
        std::fs::write(&temp, runtime.save_game()?)?;
        std::fs::rename(temp, path)?;
    } else {
        runtime.load_game(&std::fs::read_to_string(path)?)?;
    }
    Ok(())
}

pub fn run(path: Option<PathBuf>, verify: bool) -> Result<(), Error> {
    run_network(path, verify, None)
}
pub fn run_network(
    path: Option<PathBuf>,
    verify: bool,
    connection: Option<(String, Option<usize>)>,
) -> Result<(), Error> {
    let mut network = connection
        .map(|(address, n)| {
            lan::Network::connect(
                path.as_deref().ok_or("Select a cartridge for LAN play")?,
                &address,
                n,
            )
        })
        .transpose()?;
    let sdl = sdl3::init()?;
    let video = sdl.video()?;
    let mut window = video.window("GameWaffle Player", 800, 560);
    if verify {
        window.hidden();
    }
    let mut window = window.resizable().position_centered().build()?;
    let mut icon = png::Decoder::new(std::io::Cursor::new(include_bytes!(
        "../../studio/icons/icon.png"
    )))
    .read_info()?;
    let mut pixels = vec![0; icon.output_buffer_size().ok_or("Invalid window icon")?];
    let image = icon.next_frame(&mut pixels)?;
    let surface = sdl3::surface::Surface::from_data(
        &mut pixels,
        image.width,
        image.height,
        image.width * 4,
        PixelFormat::RGBA32,
    )?;
    window.set_icon(surface);
    let mut canvas = window.into_canvas();
    let creator = canvas.texture_creator();
    let pads = sdl.gamepad()?;
    let mut status = mapping::load(&pads)
        .err()
        .map(|e| e.to_string())
        .unwrap_or_default();
    let sticks = sdl.joystick()?;
    let mut raw = Vec::new();
    let mut setup: Option<mapping::Setup> = None;
    let mut slot = 1;
    let mut mouse = [false; 2];
    let mut controllers: Vec<Gamepad> = pads
        .gamepads()?
        .into_iter()
        .filter_map(|id| pads.open(id).ok())
        .collect();
    let mut pump = sdl.event_pump()?;
    let (sender, files) = mpsc::channel();
    let mut mixer = sound::Mixer::new(sdl.audio().ok());
    let mut game = path.as_deref().map(Game::open).transpose()?;
    if let (Some((_, seed)), Some(game)) = (&network, &mut game) {
        game.runtime.set_seed(*seed);
    }
    let mut texture = None;
    let mut frame_texture = None;
    let mut ripple_texture = None;
    let mut hd_texture = None;
    let mut frame_dimensions = [0, 0];
    let mut atlas_id = String::new();
    let mut touch = false;
    let mut fingers = BTreeMap::new();
    let mut taps = [false; 8];
    let mut view = [0, 0, 320, 224];
    let mut display = [320, 224];
    let mut previous = Instant::now();
    let mut lag = Duration::ZERO;

    let mut frames = 0;
    let mut particle_rects = Vec::new();
    'running: loop {
        for event in pump.poll_iter() {
            if setup.is_none() && network.is_none() {
                let command = match event {
                    Event::KeyDown {
                        scancode: Some(Key::F5),
                        repeat: false,
                        ..
                    } => Some(true),
                    Event::KeyDown {
                        scancode: Some(Key::F9),
                        repeat: false,
                        ..
                    } => Some(false),
                    Event::KeyDown {
                        scancode: Some(Key::F6),
                        repeat: false,
                        ..
                    } => {
                        slot = slot % 3 + 1;
                        status = format!("Save slot {slot}");
                        continue;
                    }
                    Event::FingerDown { x, y, .. } if !cfg!(target_os = "android") => {
                        match touch_button(&canvas, display, x, y) {
                            Some(10) => Some(true),
                            Some(11) => Some(false),
                            _ => None,
                        }
                    }
                    _ => None,
                };
                if let Some(write) = command {
                    if let Some(game) = &mut game {
                        status = match save_slot(&mut game.runtime, slot, write) {
                            Ok(()) => {
                                if !write {
                                    mixer.reset();
                                }
                                format!("{} slot {slot}", if write { "Saved" } else { "Loaded" })
                            }
                            Err(e) => e.to_string(),
                        };
                    }
                    continue;
                }
            }
            let toggle_setup = matches!(
                event,
                Event::KeyDown {
                    scancode: Some(Key::F4),
                    repeat: false,
                    ..
                }
            ) || (!cfg!(target_os = "android")
                && matches!(event,Event::FingerDown {x,y,..} if touch_button(&canvas,display,x,y)==Some(9)));
            if toggle_setup {
                if setup.take().is_none() {
                    setup = Some(mapping::Setup::default());
                    raw = sticks
                        .joysticks()?
                        .into_iter()
                        .filter_map(|id| sticks.open(id).ok())
                        .collect();
                } else {
                    raw.clear();
                }
                taps.fill(false);
                fingers.clear();
                mouse.fill(false);
                continue;
            }
            if let Some(screen) = &mut setup {
                match screen.capture(&event, &pads) {
                    Ok(false) => {}
                    result => {
                        status = result
                            .err()
                            .map_or_else(|| "Controller saved".into(), |e| e.to_string());
                        setup = None;
                        raw.clear();
                        continue;
                    }
                }
                match event {
                    Event::KeyDown {
                        scancode: Some(Key::Escape),
                        ..
                    } => {
                        setup = None;
                        raw.clear();
                        continue;
                    }
                    Event::JoyDeviceAdded { which, .. } => {
                        if let Ok(stick) = sticks.open(which) {
                            raw.push(stick);
                        }
                    }
                    Event::Quit { .. }
                    | Event::GamepadAdded { .. }
                    | Event::GamepadRemoved { .. } => {}
                    _ => continue,
                }
            }
            match event {
                Event::Quit { .. }
                | Event::KeyDown {
                    scancode: Some(Key::Escape),
                    ..
                } => break 'running,
                Event::KeyDown {
                    scancode: Some(Key::F1),
                    repeat: false,
                    ..
                } => {
                    if let Err(error) = request_file(canvas.window(), &sender) {
                        status = error.to_string();
                    }
                }
                Event::KeyDown {
                    scancode: Some(Key::F2),
                    repeat: false,
                    ..
                } => {
                    if let Some(game) = &mut game {
                        if network.is_none() {
                            game.runtime.reset()?;
                        }
                        mixer.reset();
                    }
                }
                Event::KeyDown {
                    scancode: Some(Key::F3),
                    repeat: false,
                    ..
                } if !cfg!(target_os = "android") => {
                    touch = !touch;
                    fingers.clear();
                }
                Event::KeyDown {
                    scancode: Some(key),
                    repeat: false,
                    ..
                } => {
                    if let Some(index) = KEYS.iter().position(|pair| pair.contains(&key)) {
                        taps[index] = true;
                    }
                }
                Event::MouseButtonDown {
                    which, mouse_btn, ..
                }
                | Event::MouseButtonUp {
                    which, mouse_btn, ..
                } if which != u32::MAX => {
                    let index = match mouse_btn {
                        sdl3::mouse::MouseButton::Left => 0,
                        sdl3::mouse::MouseButton::Right => 1,
                        _ => continue,
                    };
                    mouse[index] = matches!(event, Event::MouseButtonDown { .. });
                    taps[4 + index] |= mouse[index];
                }
                Event::DropFile { filename, .. } => {
                    let _ = sender.send(filename.into());
                }
                Event::GamepadAdded { which, .. } => {
                    if !controllers.iter().any(|pad| pad.id().ok() == Some(which))
                        && let Ok(pad) = pads.open(which)
                    {
                        controllers.push(pad);
                    }
                }
                Event::GamepadRemoved { .. } => controllers.retain(Gamepad::connected),
                Event::Window {
                    win_event: WindowEvent::FocusLost,
                    ..
                } => {
                    fingers.clear();
                    mouse.fill(false);
                    taps = [false; 8];
                }
                Event::FingerDown {
                    finger_id, x, y, ..
                } if !cfg!(target_os = "android") => {
                    touch = true;
                    if let Some(index) = touch_button(&canvas, display, x, y) {
                        if index < 8 {
                            fingers.insert(finger_id, index);
                            taps[index] = true;
                        } else if let Err(error) = request_file(canvas.window(), &sender) {
                            status = error.to_string();
                        }
                    }
                }
                Event::FingerMotion {
                    finger_id, x, y, ..
                } if !cfg!(target_os = "android") => {
                    if let Some(index) = touch_button(&canvas, display, x, y).filter(|n| *n < 8) {
                        fingers.insert(finger_id, index);
                    } else {
                        fingers.remove(&finger_id);
                    }
                }
                Event::FingerUp { finger_id, .. } => {
                    fingers.remove(&finger_id);
                }
                _ => {}
            }
        }
        for path in files.try_iter() {
            if network.is_some() {
                continue;
            }
            match Game::open(&path) {
                Ok(new) => {
                    let title = format!("GameWaffle — {}", new.media.name.replace('\0', ""));
                    canvas.window_mut().set_title(&title)?;
                    game = Some(new);
                    texture = None;
                    atlas_id.clear();
                    status.clear();
                    mixer.reset();
                }
                Err(error) => {
                    status = error.to_string();
                    eprintln!("{status}");
                }
            }
        }
        let output = canvas.output_size()?;
        let now = Instant::now();
        lag = (lag + now.duration_since(previous)).min(TICK * 5);
        previous = now;
        if let Some(game) = &mut game {
            if setup.is_some() {
                lag = Duration::ZERO;
            }
            while lag >= TICK {
                lag -= TICK;
                let keys = pump.keyboard_state();
                let mut states = [[false; 8]; 4];
                for (index, pair) in KEYS.iter().enumerate() {
                    states[0][index] = pair.iter().any(|key| keys.is_scancode_pressed(*key))
                        || taps[index]
                        || fingers.values().any(|value| *value == index);
                }
                taps = [false; 8];
                states[0][4] |= mouse[0];
                states[0][5] |= mouse[1];
                for (slot, pad) in states.iter_mut().zip(&controllers) {
                    for (index, button) in BUTTONS.iter().enumerate() {
                        slot[index] |= pad.button(*button);
                    }
                    let x = pad.axis(Axis::LeftX);
                    let y = pad.axis(Axis::LeftY);
                    slot[0] |= y < -16000;
                    slot[1] |= y > 16000;
                    slot[2] |= x < -16000;
                    slot[3] |= x > 16000;
                }
                if let Some((net, _)) = &mut network {
                    states = net.step(states[0])?;
                    game.runtime.set_view_size(320, 240);
                } else {
                    game.runtime.set_view_size(view[2], view[3]);
                }
                game.runtime.step_inputs(states.map(buttons))?;
                let room_id = game.runtime.room();
                let room = game
                    .media
                    .rooms
                    .get(room_id)
                    .ok_or("Room graphics are missing")?;
                let settings = game.runtime.room_settings();
                let music = active_track(&settings.music, &room.music);
                let ambience = active_track(&settings.ambience, &room.ambience);
                if mixer.room(music, ambience) {
                    for (id, gain) in [(music, 0.55), (ambience, 0.4)] {
                        if let Some(id) = id
                            && let Err(error) = mixer.play(id, &game.media.audio, true, gain)
                        {
                            eprintln!("{error}");
                        }
                    }
                }
                for sound in game.runtime.sounds() {
                    if let Err(error) = mixer.play(sound, &game.media.audio, false, 0.65) {
                        eprintln!("{error}");
                    }
                }
                for event in game.runtime.events() {
                    if let gamewaffle_runtime::RuntimeEvent::ScriptError {
                        actor,
                        event,
                        message,
                    } = event
                    {
                        status = format!("Script {actor}/{event}: {message}");
                    }
                }
            }
            let snapshot = game.runtime.view();
            let room = game
                .media
                .rooms
                .get(snapshot.room)
                .ok_or("Room graphics are missing")?;
            if atlas_id != snapshot.room {
                texture = Some(
                    game.media
                        .atlases
                        .get(snapshot.room)
                        .ok_or("Room atlas is missing")?
                        .texture(&creator)?,
                );
                atlas_id = snapshot.room.to_owned();
            }
            let focus = snapshot
                .actors
                .iter()
                .find(|a| a.player == Some(0))
                .map_or([room.width as f32 / 2., room.height as f32 / 2.], |a| {
                    [a.x, a.y]
                });
            view = viewport_zoom(
                game.media.camera,
                [output.0, output.1],
                [room.width, room.camera_height()],
                snapshot.focus.unwrap_or(focus),
                snapshot.room_settings.zoom,
            );
        } else {
            lag = Duration::ZERO;
            view = viewport(
                Default::default(),
                [output.0, output.1],
                [320, 224],
                [160., 112.],
            );
        }
        let hd = game.as_ref().is_some_and(|g| {
            g.media.rooms[g.runtime.room()].hd_strength(g.runtime.room_settings().shader) > 0
        });
        let scale = if hd { 2 } else { 1 };
        let dimensions = [view[2] * scale, view[3] * scale];
        if frame_dimensions != dimensions || hd_texture.is_some() != hd {
            let mut target =
                creator.create_texture_target(PixelFormat::RGBA32, dimensions[0], dimensions[1])?;
            target.set_scale_mode(sdl3::render::ScaleMode::Nearest);
            frame_texture = Some(target);
            frame_dimensions = dimensions;
            hd_texture = if hd {
                Some(creator.create_texture_streaming(
                    PixelFormat::RGBA32,
                    dimensions[0],
                    dimensions[1],
                )?)
            } else {
                None
            };
            ripple_texture = None;
        }
        let snapshot = game.as_ref().map(|game| game.runtime.view());
        let ripple = game.as_ref().zip(snapshot.as_ref()).is_some_and(|(g, s)| {
            g.media.rooms[s.room]
                .ripple_settings(s.room_settings.shader)
                .is_some()
        });
        if ripple && ripple_texture.is_none() {
            ripple_texture =
                Some(creator.create_texture_target(PixelFormat::RGBA32, view[2], view[3])?);
        } else if !ripple {
            ripple_texture = None;
        }
        let frame = frame_texture.as_mut().unwrap();
        let mut rendered = Ok(());
        canvas.with_texture_canvas(frame, |canvas| {
            rendered = (|| -> Result<(), Error> {
                if let (Some(game), Some(snapshot)) = (&game, &snapshot) {
                    draw(
                        canvas,
                        game,
                        snapshot,
                        texture.as_mut().unwrap(),
                        view,
                        &mut particle_rects,
                        ripple_texture.as_mut(),
                        hd_texture.as_mut(),
                    )?;
                } else {
                    canvas.set_draw_color(Color::RGB(24, 24, 34));
                    canvas.clear();
                    canvas.set_draw_color(Color::RGB(244, 199, 126));
                    canvas.draw_debug_text("GameWaffle Player", (12., 13.))?;
                    let help = if touch {
                        "Tap Open to select a cartridge."
                    } else {
                        "F1 Open or drop a .waffle file"
                    };
                    canvas.draw_debug_text(help, (12., 34.))?;
                    canvas.draw_debug_text("F4 Map controller", (12., 52.))?;
                }
                Ok(())
            })();
        })?;
        rendered?;
        display = game
            .as_ref()
            .and_then(|g| g.media.camera.fixed_resolution())
            .unwrap_or([view[2], view[3]]);
        canvas.set_logical_size(
            display[0],
            display[1],
            sdl3::sys::render::SDL_LOGICAL_PRESENTATION_LETTERBOX,
        )?;
        canvas.set_draw_color(Color::RGB(14, 14, 22));
        canvas.clear();
        let [x, y, w, h] = fit_frame([view[2], view[3]], display).map(|axis| axis as f32);
        canvas.copy(frame, None, FRect::new(x, y, w, h))?;
        if touch {
            canvas.set_blend_mode(BlendMode::Blend);
            for (index, rect) in overlay(display[0], display[1]).into_iter().enumerate() {
                canvas.set_draw_color(Color::RGBA(61, 51, 79, 215));
                canvas.fill_rect(rect)?;
                canvas.set_draw_color(Color::RGB(255, 226, 177));
                let name = [
                    "^", "v", "<", ">", "A", "B", "X", "Start", "Open", "Pad", "Save", "Load",
                ][index];
                canvas.draw_debug_text(
                    name,
                    (
                        rect.x + (rect.w - name.len() as f32 * 8.) / 2.,
                        rect.y + rect.h / 2. - 4.,
                    ),
                )?;
            }
            canvas.set_blend_mode(BlendMode::None);
        }
        if !status.is_empty() {
            canvas.set_draw_color(Color::RGB(255, 163, 153));
            let text: String = status
                .chars()
                .take(view[2].saturating_sub(16) as usize / 8)
                .collect();
            canvas.draw_debug_text(&text.replace('\0', ""), (8., 8.))?;
        }
        if let Some(screen) = &setup {
            canvas.set_draw_color(Color::RGB(34, 31, 45));
            canvas.fill_rect(FRect::new(0., 32., view[2] as f32, 76.))?;
            canvas.set_draw_color(Color::RGB(255, 226, 177));
            canvas.draw_debug_text("Map controller", (8., 42.))?;
            canvas.draw_debug_text(&screen.prompt(), (8., 64.))?;
            canvas.draw_debug_text(
                if touch {
                    "Tap Pad to cancel"
                } else {
                    "Esc to cancel"
                },
                (8., 86.),
            )?;
        }
        canvas.present();
        mixer.update();
        frames += 1;
        if verify && frames >= 5 {
            break;
        }
        std::thread::sleep(Duration::from_millis(13));
    }
    Ok(())
}

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn SDL_main(argc: i32, argv: *mut *mut std::ffi::c_char) -> i32 {
    if argc != 2 || argv.is_null() {
        return 1;
    }
    let path = unsafe { *argv.add(1) };
    if path.is_null() {
        return 1;
    }
    let path = unsafe { std::ffi::CStr::from_ptr(path) }.to_string_lossy();
    match run(Some(PathBuf::from(path.as_ref())), false) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("{error}");
            1
        }
    }
}
