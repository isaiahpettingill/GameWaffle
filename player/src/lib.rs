mod media;
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
        let media = Media::read(&bytes)?;
        let runtime = Runtime::from_cartridge(&bytes, None)?;
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

fn overlay(width: u32, height: u32) -> [FRect; 9] {
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

fn draw(
    canvas: &mut Canvas<Window>,
    game: &Game,
    snapshot: &gamewaffle_runtime::Snapshot<'_>,
    atlas: &Texture<'_>,
    view: [u32; 4],
) -> Result<(), Error> {
    let room = &game.media.rooms[snapshot.room];
    let source = &game.media.atlases[snapshot.room];
    let [x, y, w, h] = view;
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
    Ok(())
}

pub fn run(path: Option<PathBuf>, verify: bool) -> Result<(), Error> {
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
    let mut controllers: Vec<Gamepad> = pads
        .gamepads()?
        .into_iter()
        .filter_map(|id| pads.open(id).ok())
        .collect();
    let mut pump = sdl.event_pump()?;
    let (sender, files) = mpsc::channel();
    let mut mixer = sound::Mixer::new(sdl.audio().ok());
    let mut game = path.as_deref().map(Game::open).transpose()?;
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
    let mut status = String::new();
    let mut frames = 0;
    'running: loop {
        for event in pump.poll_iter() {
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
                        game.runtime.reset()?;
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
            while lag >= TICK {
                lag -= TICK;
                let keys = pump.keyboard_state();
                let pairs = [
                    [Key::Up, Key::W],
                    [Key::Down, Key::S],
                    [Key::Left, Key::A],
                    [Key::Right, Key::D],
                    [Key::Z, Key::Space],
                    [Key::X, Key::X],
                    [Key::C, Key::C],
                    [Key::Return, Key::Return],
                ];
                let mut states = [[false; 8]; 4];
                for (index, pair) in pairs.iter().enumerate() {
                    states[0][index] = pair.iter().any(|key| keys.is_scancode_pressed(*key))
                        || taps[index]
                        || fingers.values().any(|value| *value == index);
                }
                taps = [false; 8];
                let start = usize::from(controllers.len() < 4);
                for (slot, pad) in states.iter_mut().skip(start).zip(&controllers) {
                    for (index, button) in BUTTONS.iter().enumerate() {
                        slot[index] = pad.button(*button);
                    }
                    let x = pad.axis(Axis::LeftX);
                    let y = pad.axis(Axis::LeftY);
                    slot[0] |= y < -16000;
                    slot[1] |= y > 16000;
                    slot[2] |= x < -16000;
                    slot[3] |= x > 16000;
                }
                game.runtime.step_inputs(states.map(buttons))?;
                let room_id = game.runtime.room();
                let room = game
                    .media
                    .rooms
                    .get(room_id)
                    .ok_or("Room graphics are missing")?;
                if mixer.room(room_id) {
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
                focus,
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
                    draw(canvas, game, snapshot, texture.as_ref().unwrap(), view)?;
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
                let name = ["^", "v", "<", ">", "A", "B", "X", "Start", "Open"][index];
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
