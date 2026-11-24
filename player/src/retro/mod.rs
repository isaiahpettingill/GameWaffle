//! Libretro API version 1. The frontend owns the callbacks and their buffers.
mod audio;
mod video;
use crate::{Error, Game, buttons};
use audio::Audio;
use std::{
    cell::RefCell,
    ffi::{c_char, c_void},
    ptr, slice,
};
use video::Video;

type EnvFn = extern "C" fn(u32, *mut c_void) -> bool;
type VideoFn = extern "C" fn(*const c_void, u32, u32, usize);
type BatchFn = extern "C" fn(*const i16, usize) -> usize;
type SampleFn = extern "C" fn(i16, i16);
type PollFn = extern "C" fn();
type InputFn = extern "C" fn(u32, u32, u32, u32) -> i16;
#[derive(Clone, Copy, Default)]
struct Host {
    env: Option<EnvFn>,
    video: Option<VideoFn>,
    batch: Option<BatchFn>,
    sample: Option<SampleFn>,
    poll: Option<PollFn>,
    input: Option<InputFn>,
}

#[repr(C)]
struct SystemInfo {
    name: *const c_char,
    version: *const c_char,
    extensions: *const c_char,
    full_path: bool,
    block_extract: bool,
}
#[repr(C)]
struct GameInfo {
    path: *const c_char,
    data: *const c_void,
    size: usize,
    meta: *const c_char,
}
#[repr(C)]
struct Geometry {
    w: u32,
    h: u32,
    max_w: u32,
    max_h: u32,
    aspect: f32,
}
#[repr(C)]
struct Timing {
    fps: f64,
    rate: f64,
}
#[repr(C)]
struct AvInfo {
    geometry: Geometry,
    timing: Timing,
}
#[repr(C)]
struct Descriptor {
    port: u32,
    device: u32,
    index: u32,
    id: u32,
    description: *const c_char,
}
const PAD: u32 = 1;
const IDS: [u32; 8] = [4, 5, 6, 7, 0, 8, 1, 3];
const SAVE_SIZE: usize = 4 * 1024 * 1024 + 4;
const ROLLBACK_TAG: &[u8; 4] = b"GWRS";

#[derive(serde::Deserialize, serde::Serialize)]
struct RollbackState {
    signature: [u8; 32],
    physics: serde_bytes::ByteBuf,
    audio: audio::SavedAudio,
    ticks: u64,
}
struct Core {
    game: Game,
    video: Video,
    audio: Audio,
    ram: Vec<u8>,
    first: bool,
    ticks: u64,
    signature: [u8; 32],
}
impl Core {
    fn load(bytes: &[u8], ports: [bool; 4]) -> Result<Self, Error> {
        let connected = ports.iter().enumerate().fold(1, |mask, (slot, enabled)| mask | (u8::from(*enabled) << slot));
        let mut game = Game::from_cartridge(bytes, connected, None, [0, 0])?;
        // The same cartridge starts from the same seed on every peer.
        let signature: [u8; 32] = bytes[bytes.len() - 32..].try_into().unwrap();
        game.runtime
            .set_seed(u32::from_le_bytes(signature[..4].try_into().unwrap()));
        let video = Video::new(&game)?;
        game.runtime
            .set_view_size(video.dimensions[0], video.dimensions[1]);
        Ok(Self {
            game,
            video,
            audio: Audio::default(),
            ram: vec![0; SAVE_SIZE],
            first: true,
            ticks: 0,
            signature,
        })
    }
    fn restore(&mut self, data: &[u8]) -> bool {
        let Some(save) = checkpoint(data) else {
            return false;
        };
        let tail = &data[save.len() + 4..];
        if let Some(payload) = tail.strip_prefix(ROLLBACK_TAG) {
            let Ok(state) = ciborium::from_reader::<RollbackState, _>(payload) else {
                return false;
            };
            if self.signature != state.signature
                || self
                    .game
                    .runtime
                    .load_rollback(save, &state.physics)
                    .is_err()
            {
                return false;
            }
            self.audio.restore(&self.game, state.audio);
            self.ticks = state.ticks;
        } else {
            if self.game.runtime.load_game(save).is_err() {
                return false;
            }
            self.audio = Audio::default();
        }
        self.first = false;
        self.refresh_ram();
        true
    }
    fn serialize(&self, out: &mut [u8]) -> bool {
        let (Ok(save), Ok(physics)) = (
            self.game.runtime.save_game(),
            self.game.runtime.save_rollback(),
        ) else {
            return false;
        };
        if !write_checkpoint(out, &save) {
            return false;
        }
        let Some(tail) = out.get_mut(save.len() + 4..) else {
            return false;
        };
        let Some((tag, payload)) = tail.split_at_mut_checked(ROLLBACK_TAG.len()) else {
            return false;
        };
        tag.copy_from_slice(ROLLBACK_TAG);
        ciborium::into_writer(
            &RollbackState {
                signature: self.signature,
                physics: physics.into(),
                audio: self.audio.save(),
                ticks: self.ticks,
            },
            payload,
        )
        .is_ok()
    }

    fn refresh_ram(&mut self) {
        if let Ok(save) = self.game.runtime.save_game() {
            write_checkpoint(&mut self.ram, &save);
        }
    }
    fn frame(&mut self, host: Host, ports: [bool; 4]) -> Result<(), Error> {
        if self.first {
            self.first = false;
            if let Some(save) = checkpoint(&self.ram) {
                let _ = self.game.runtime.load_game(save);
            }
        }
        if let Some(poll) = host.poll {
            poll();
        }
        let states = std::array::from_fn(|port| {
            buttons(IDS.map(|id| {
                ports[port] && host.input.is_some_and(|f| f(port as u32, PAD, 0, id) != 0)
            }))
        });
        self.game.runtime.set_connected_players(ports.iter().enumerate().fold(1, |mask, (slot, enabled)| mask | (u8::from(*enabled) << slot)));
        self.game.runtime.step_inputs(states)?;
        if let Some(video) = host.video {
            self.video.frame(&self.game, video, host.env)?;
        }
        let mut pcm = [0; 1600];
        self.audio.frame(&self.game, &mut pcm);
        if let Some(batch) = host.batch {
            batch(pcm.as_ptr(), 800);
        } else if let Some(sample) = host.sample {
            for frame in pcm.chunks_exact(2) {
                sample(frame[0], frame[1]);
            }
        }
        self.ticks = self.ticks.wrapping_add(1);
        if self.ticks % 60 == 1 {
            self.refresh_ram();
        }
        Ok(())
    }
}
fn checkpoint(bytes: &[u8]) -> Option<&[u8]> {
    let len = u32::from_le_bytes(bytes.get(..4)?.try_into().ok()?) as usize;
    if len == 0 || len > SAVE_SIZE - 4 {
        return None;
    }
    bytes.get(4..4 + len)
}
fn write_checkpoint(bytes: &mut [u8], save: &[u8]) -> bool {
    if bytes.len() < save.len() + 4 {
        return false;
    }
    bytes[..4].copy_from_slice(&(save.len() as u32).to_le_bytes());
    bytes[4..4 + save.len()].copy_from_slice(save);
    true
}
thread_local! {
    static HOST:RefCell<Host>=RefCell::default();
    static CORE:RefCell<Option<Core>>=const{RefCell::new(None)};
    static PORTS:RefCell<[bool;4]>=const{RefCell::new([true;4])};
}

macro_rules! setter {
    ($name:ident,$field:ident,$ty:ty) => {
        #[unsafe(no_mangle)]
        extern "C" fn $name(callback: Option<$ty>) {
            HOST.with_borrow_mut(|host| host.$field = callback);
        }
    };
}
setter!(retro_set_environment, env, EnvFn);
setter!(retro_set_video_refresh, video, VideoFn);
setter!(retro_set_audio_sample, sample, SampleFn);
setter!(retro_set_audio_sample_batch, batch, BatchFn);
setter!(retro_set_input_poll, poll, PollFn);
setter!(retro_set_input_state, input, InputFn);

#[unsafe(no_mangle)]
extern "C" fn retro_api_version() -> u32 {
    1
}
#[unsafe(no_mangle)]
extern "C" fn retro_get_region() -> u32 {
    0
}
#[unsafe(no_mangle)]
unsafe extern "C" fn retro_get_system_info(out: *mut SystemInfo) {
    if !out.is_null() {
        unsafe {
            out.write(SystemInfo {
                name: c"GameWaffle".as_ptr(),
                version: c"2".as_ptr(),
                extensions: c"waffle".as_ptr(),
                full_path: false,
                block_extract: false,
            })
        };
    }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn retro_get_system_av_info(out: *mut AvInfo) {
    if out.is_null() {
        return;
    }
    let [w, h] = CORE.with(|slot| {
        slot.try_borrow()
            .ok()
            .and_then(|c| c.as_ref().map(|c| c.video.dimensions))
            .unwrap_or([320, 240])
    });
    unsafe {
        out.write(AvInfo {
            geometry: Geometry {
                w,
                h,
                max_w: 1024,
                max_h: 1024,
                aspect: w as f32 / h as f32,
            },
            timing: Timing {
                fps: 60.,
                rate: 48000.,
            },
        })
    };
}
#[unsafe(no_mangle)]
extern "C" fn retro_init() {
    PORTS.with_borrow_mut(|p| *p = [true; 4]);
}
#[unsafe(no_mangle)]
extern "C" fn retro_deinit() {
    retro_unload_game();
}
#[unsafe(no_mangle)]
extern "C" fn retro_unload_game() {
    CORE.with_borrow_mut(|c| *c = None);
}
fn setup_frontend(env: EnvFn) -> bool {
    let mut format = 1i32; // RETRO_PIXEL_FORMAT_XRGB8888
    if !env(10, (&mut format as *mut i32).cast()) {
        return false;
    }
    let mut incomplete = 1u64; // Game checkpoints omit transient physics and script state.
    env(44, (&mut incomplete as *mut u64).cast());
    let names = [
        c"Up", c"Down", c"Left", c"Right", c"A", c"B", c"X", c"Start",
    ];
    let mut descriptors = Vec::with_capacity(33);
    for port in 0..4 {
        for (id, name) in IDS.into_iter().zip(names) {
            descriptors.push(Descriptor {
                port,
                device: PAD,
                index: 0,
                id,
                description: name.as_ptr(),
            });
        }
    }
    descriptors.push(Descriptor {
        port: 0,
        device: 0,
        index: 0,
        id: 0,
        description: ptr::null(),
    });
    env(11, descriptors.as_mut_ptr().cast());
    true
}
#[unsafe(no_mangle)]
unsafe extern "C" fn retro_load_game(info: *const GameInfo) -> bool {
    let Some(info) = (unsafe { info.as_ref() }) else {
        return false;
    };
    if info.data.is_null() || info.size < 110 || info.size > 256 * 1024 * 1024 {
        return false;
    }
    let Some(env) = HOST.with_borrow(|h| h.env) else {
        return false;
    };
    if !setup_frontend(env) {
        return false;
    }
    let bytes = unsafe { slice::from_raw_parts(info.data.cast(), info.size) };
    match Core::load(bytes, PORTS.with_borrow(|ports| *ports)) {
        Ok(core) => {
            CORE.with_borrow_mut(|c| *c = Some(core));
            true
        }
        Err(err) => {
            eprintln!("GameWaffle: {err}");
            false
        }
    }
}
#[unsafe(no_mangle)]
extern "C" fn retro_run() {
    let host = HOST.with_borrow(|h| *h);
    let ports = PORTS.with_borrow(|p| *p);
    let failed = CORE.with_borrow_mut(|c| c.as_mut().and_then(|c| c.frame(host, ports).err()));
    if let Some(err) = failed {
        eprintln!("GameWaffle: {err}");
        if let Some(env) = host.env {
            env(7, ptr::null_mut());
        }
    }
}
#[unsafe(no_mangle)]
extern "C" fn retro_reset() {
    CORE.with_borrow_mut(|c| {
        if let Some(c) = c {
            if c.game.runtime.reset().is_ok() {
                c.first = false;
                c.audio = Audio::default();
                c.refresh_ram();
            }
        }
    });
}
#[unsafe(no_mangle)]
extern "C" fn retro_set_controller_port_device(port: u32, device: u32) {
    PORTS.with_borrow_mut(|p| {
        if let Some(slot) = p.get_mut(port as usize) {
            *slot = device & 255 == PAD;
        }
    });
}
#[unsafe(no_mangle)]
extern "C" fn retro_serialize_size() -> usize {
    SAVE_SIZE
}
#[unsafe(no_mangle)]
unsafe extern "C" fn retro_serialize(out: *mut c_void, size: usize) -> bool {
    if out.is_null() || size < SAVE_SIZE {
        return false;
    }
    CORE.with_borrow(|c| {
        c.as_ref().is_some_and(|c| {
            let bytes = unsafe { slice::from_raw_parts_mut(out.cast(), SAVE_SIZE) };
            bytes.fill(0);
            c.serialize(bytes)
        })
    })
}
#[unsafe(no_mangle)]
unsafe extern "C" fn retro_unserialize(data: *const c_void, size: usize) -> bool {
    if data.is_null() || size < 4 || size > SAVE_SIZE {
        return false;
    }
    CORE.with_borrow_mut(|c| {
        c.as_mut()
            .is_some_and(|c| c.restore(unsafe { slice::from_raw_parts(data.cast(), size) }))
    })
}
#[unsafe(no_mangle)]
extern "C" fn retro_get_memory_size(id: u32) -> usize {
    if id == 0 && CORE.with(|s| s.try_borrow().is_ok_and(|c| c.is_some())) {
        SAVE_SIZE
    } else {
        0
    }
}
#[unsafe(no_mangle)]
extern "C" fn retro_get_memory_data(id: u32) -> *mut c_void {
    if id != 0 {
        return ptr::null_mut();
    }
    CORE.with(|s| {
        s.try_borrow_mut()
            .ok()
            .and_then(|mut c| {
                c.as_mut().map(|c| {
                    if !c.first {
                        c.refresh_ram();
                    }
                    c.ram.as_mut_ptr().cast()
                })
            })
            .unwrap_or(ptr::null_mut())
    })
}
#[unsafe(no_mangle)]
extern "C" fn retro_load_game_special(_: u32, _: *const GameInfo, _: usize) -> bool {
    false
}
#[unsafe(no_mangle)]
extern "C" fn retro_cheat_reset() {}
#[unsafe(no_mangle)]
extern "C" fn retro_cheat_set(_: u32, _: bool, _: *const c_char) {}
