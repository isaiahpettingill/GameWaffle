mod lan;
mod mapping;
mod media;
#[cfg(feature = "libretro")]
mod retro;
mod sound;

use gamewaffle_runtime::{Input, Runtime, viewport};
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
        rect(right + size, y + size * 2.),
        rect(right, y + size),
        rect(right + size, y),
        rect(w / 2. - size / 2., h - size - 4.),
        rect(w - size - 4., 4.),
        rect(4., 4.),
        rect(6. + size, 4.),
        rect(w - size * 2. - 6., 4.),
    ]
}

fn touch_button(canvas: &Canvas<Window>, view: [u32; 4], x: f32, y: f32) -> Option<usize> {
    let (w, h) = canvas.output_size().ok()?;
    let (width, height) = (view[2] as f32, view[3] as f32);
    let scale = (w as f32 / width).min(h as f32 / height);
    let lx = (x * w as f32 - (w as f32 - width * scale) / 2.) / scale;
    let ly = (y * h as f32 - (h as f32 - height * scale) / 2.) / scale;
    overlay(view[2], view[3])
        .iter()
        .position(|r| lx >= r.x && lx < r.x + r.w && ly >= r.y && ly < r.y + r.h)
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

fn draw<T: sdl3::render::RenderTarget>(
    canvas: &mut Canvas<T>,
    game: &Game,
    snapshot: &gamewaffle_runtime::Snapshot<'_>,
    atlas: &Texture<'_>,
    view: [u32; 4],
    rectangles: &mut Vec<FRect>,
) -> Result<(), Error> {
    let room = &game.media.rooms[snapshot.room];
    let source = &game.media.atlases[snapshot.room];
    let [vx, vy, w, h] = view;
    let axis = |base: u32, size: u32, extent: u32, focus: Option<f32>, lo: &str, hi: &str| {
        let center = focus.map_or(base as i32, |f| f.round() as i32 - size as i32 / 2);
        center.clamp(
            if room.seams.contains_key(lo) {
                -(size as i32 / 2)
            } else {
                0
            },
            (extent as i32
                - if room.seams.contains_key(hi) {
                    size.div_ceil(2)
                } else {
                    size
                } as i32)
                .max(0),
        )
    };
    let x = axis(
        vx,
        w,
        room.width,
        snapshot.focus.map(|p| p[0]),
        "left",
        "right",
    );
    let y = axis(
        vy,
        h,
        room.height,
        snapshot.focus.map(|p| p[1]),
        "up",
        "down",
    );
    let color = room
        .background
        .strip_prefix('#')
        .and_then(|s| u32::from_str_radix(s, 16).ok())
        .unwrap_or(0x171829);
    canvas.set_draw_color(Color::RGB(
        (color >> 16) as u8,
        (color >> 8) as u8,
        color as u8,
    ));
    canvas.clear();
    let mut entries: Vec<_> = room
        .baked
        .iter()
        .map(|layer| (layer.layer, false, 0., Some(layer), None))
        .chain(snapshot.actors.iter().map(|actor| {
            (
                actor.layer,
                true,
                if room.y_sort && actor.image.starts_with("sprite/") {
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
    for (_, _, _, layer, actor) in entries {
        if let Some(layer) = layer {
            if let Some(r) = source.rect(&layer.image) {
                let dest = FRect::new(
                    (layer.x - x as i32) as f32,
                    (layer.y - y as i32) as f32,
                    r.width() as f32,
                    r.height() as f32,
                );
                if visible(dest) {
                    canvas.copy(atlas, r, dest)?;
                }
            }
        } else if let Some(actor) = actor {
            let dest = FRect::new(
                actor.x.round() - x as f32 - actor.width / 2.,
                actor.y.round() - y as f32 - actor.height / 2.,
                actor.width,
                actor.height,
            );
            if !visible(dest) {
                continue;
            }
            if let Some(r) = source.rect(actor.image) {
                canvas.copy_ex(
                    atlas,
                    r,
                    dest,
                    f64::from(actor.angle.to_degrees()),
                    None,
                    actor.facing < 0.,
                    false,
                )?;
            } else {
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
    if let Some(font) = source.rect("ui/font") {
        let text = |canvas: &mut Canvas<T>, line: &str, mut x: f32, y: f32| -> Result<(), Error> {
            for ch in line.chars() {
                let i = if (' '..='~').contains(&ch) {
                    ch as i32
                } else {
                    63
                } - 32;
                let glyph =
                    sdl3::rect::Rect::new(font.x() + i % 16 * 6, font.y() + i / 16 * 8, 6, 8);
                canvas.copy(atlas, glyph, FRect::new(x, y, 6., 8.))?;
                x += 6.;
            }
            Ok(())
        };
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
            canvas.fill_rect(FRect::new(2., y, line.chars().count() as f32 * 6. + 4., 9.))?;
            text(canvas, &line, 4., y)?;
            y += 10.;
        }
        for (label, [value, max]) in snapshot.bars {
            text(canvas, label, 4., y)?;
            y += 8.;
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
        if let Some(dialog) = snapshot.dialog {
            let wrapped = gamewaffle_runtime::dialogue_lines(dialog, (w as usize - 8) / 6);
            y = h as f32 - (wrapped.lines().count() + 1) as f32 * 8. - 4.;
            canvas.fill_rect(FRect::new(1., y, w as f32 - 2., h as f32 - y - 1.))?;
            for line in wrapped.lines().chain(std::iter::once("[A]")) {
                text(canvas, line, 4., y + 1.)?;
                y += 8.;
            }
        }
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
    let window = window.resizable().position_centered().build()?;
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
    let mut frame_dimensions = [0, 0];
    let mut atlas_id = String::new();
    let mut touch = cfg!(target_os = "android");
    let mut fingers = BTreeMap::new();
    let mut taps = [false; 8];
    let mut view = [0, 0, 320, 224];
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
                    Event::FingerDown { x, y, .. } => match touch_button(&canvas, view, x, y) {
                        Some(10) => Some(true),
                        Some(11) => Some(false),
                        _ => None,
                    },
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
            ) || matches!(event,Event::FingerDown {x,y,..} if touch_button(&canvas,view,x,y)==Some(9));
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
                } => {
                    touch = !touch;
                    fingers.clear();
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
                } => {
                    touch = true;
                    if let Some(index) = touch_button(&canvas, view, x, y) {
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
                } => {
                    if let Some(index) = touch_button(&canvas, view, x, y).filter(|n| *n < 8) {
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
                let pairs = [
                    [Key::Up, Key::W],
                    [Key::Down, Key::S],
                    [Key::Left, Key::A],
                    [Key::Right, Key::D],
                    [Key::Z, Key::Semicolon],
                    [Key::X, Key::Apostrophe],
                    [Key::C, Key::Space],
                    [Key::Return, Key::Return],
                ];
                let mut states = [[false; 8]; 4];
                for (index, pair) in pairs.iter().enumerate() {
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
                if mixer.room(room.music.as_deref(), room.ambience.as_deref()) {
                    for (id, gain) in [
                        (room.music.as_deref(), 0.55),
                        (room.ambience.as_deref(), 0.4),
                    ] {
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
            view = viewport(
                game.media.camera,
                [output.0, output.1],
                [room.width, room.height],
                snapshot.focus.unwrap_or(focus),
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
        let dimensions = [view[2], view[3]];
        if frame_dimensions != dimensions {
            let mut target =
                creator.create_texture_target(PixelFormat::RGBA32, view[2], view[3])?;
            target.set_scale_mode(sdl3::render::ScaleMode::Nearest);
            frame_texture = Some(target);
            frame_dimensions = dimensions;
        }
        let snapshot = game.as_ref().map(|game| game.runtime.view());
        let frame = frame_texture.as_mut().unwrap();
        let mut rendered = Ok(());
        canvas.with_texture_canvas(frame, |canvas| {
            rendered = (|| -> Result<(), Error> {
                if let (Some(game), Some(snapshot)) = (&game, &snapshot) {
                    draw(
                        canvas,
                        game,
                        snapshot,
                        texture.as_ref().unwrap(),
                        view,
                        &mut particle_rects,
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
        canvas.set_logical_size(
            view[2],
            view[3],
            sdl3::sys::render::SDL_LOGICAL_PRESENTATION_LETTERBOX,
        )?;
        canvas.set_draw_color(Color::RGB(14, 14, 22));
        canvas.clear();
        canvas.copy(
            frame,
            None,
            FRect::new(0., 0., view[2] as f32, view[3] as f32),
        )?;
        if touch {
            canvas.set_blend_mode(BlendMode::Blend);
            for (index, rect) in overlay(view[2], view[3]).into_iter().enumerate() {
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
pub extern "C" fn SDL_main(_: i32, _: *mut *mut std::ffi::c_char) -> i32 {
    match run(Some("demo.waffle".into()), false) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("{error}");
            1
        }
    }
}
