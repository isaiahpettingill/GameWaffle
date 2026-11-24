"""Exercise the libretro ABI with the compiled Basalt Works cartridge."""
import ctypes as c
import hashlib
import json
import subprocess
from pathlib import Path
import sys

core = c.CDLL(str(Path(sys.argv[1]).resolve()))
cart = c.create_string_buffer(Path(sys.argv[2]).read_bytes())
u, ptr, size = c.c_uint, c.c_void_p, c.c_size_t


class Game(c.Structure):
    _fields_ = [('path', c.c_char_p), ('data', ptr), ('size', size), ('meta', c.c_char_p)]


class Geometry(c.Structure):
    _fields_ = [('width', u), ('height', u), ('max_width', u), ('max_height', u), ('aspect', c.c_float)]


class AvInfo(c.Structure):
    _fields_ = [('geometry', Geometry), ('fps', c.c_double), ('sample_rate', c.c_double)]


def function(name, result, *args):
    fn = getattr(core, 'retro_' + name)
    fn.restype, fn.argtypes = result, args
    return fn


callbacks = []
def register(name, result, args, action):
    fn = c.CFUNCTYPE(result, *args)(action)
    callbacks.append(fn)
    function('set_' + name, None, type(fn))(fn)


frames, audio, ports = [], [], set()
video_hashes, audio_hashes = [], []
geometry_updates = []
held = {(0, 7)}
frame_data = None


def environment(command, data):
    if command == 37:  # RETRO_ENVIRONMENT_SET_GEOMETRY
        geometry = c.cast(data, c.POINTER(Geometry)).contents
        geometry_updates.append((geometry.width, geometry.height, geometry.aspect))
        return True
    return command in (10, 11, 44)


def video(data, w, h, pitch):
    global frame_data
    samples = c.string_at(data, h * pitch)
    frame_data = (samples, pitch)
    frames.append((w, h, len(set(samples))))
    video_hashes.append(hashlib.sha256(samples).digest())


def sound(data, count):
    samples = (c.c_int16 * (count * 2)).from_address(data)
    audio.append((count, max(samples)))
    audio_hashes.append(hashlib.sha256(bytes(samples)).digest())
    return count


def input_state(port, device, index, button):
    ports.add(port)
    return int((port, button) in held)


register('environment', c.c_bool, [u, ptr], environment)
register('video_refresh', None, [ptr, u, u, size], video)
register('audio_sample_batch', size, [ptr, size], sound)
register('input_poll', None, [], lambda: None)
register('input_state', c.c_int16, [u, u, u, u], input_state)
load = function('load_game', c.c_bool, c.POINTER(Game))
state_size = function('serialize_size', size)
save = function('serialize', c.c_bool, ptr, size)
restore = function('unserialize', c.c_bool, ptr, size)
run = function('run', None)
ram = function('get_memory_data', ptr, u)
init = function('init', None)
unload = function('unload_game', None)
reset = function('reset', None)
set_device = function('set_controller_port_device', None, u, u)
av_info = function('get_system_av_info', None, c.POINTER(AvInfo))
init()
info = Game(None, c.cast(cart, ptr), len(cart) - 1, None)
assert not load(None)
assert load(c.byref(info))


def capture():
    buf = c.create_string_buffer(state_size())
    assert save(buf, len(buf))
    length = int.from_bytes(buf.raw[:4], 'little')
    portable = buf.raw[4:4 + length]
    assert portable.startswith(b'GWSV\0\1')
    result = subprocess.check_output(
        ['node', '--input-type=module', '-e', '''
            import {readFileSync} from 'node:fs';
            import {decodeSave} from './src/save.mjs';
            console.log(JSON.stringify(decodeSave(readFileSync(0)).players));
        '''],
        input=portable,
        cwd=Path(__file__).resolve().parents[1],
    )
    return buf, {'players': json.loads(result)}


for _ in range(5):
    run()
initial, before = capture()
for _ in range(30):
    run()
_, after = capture()
assert before['players']['0'] != after['players']['0']
assert ports == {0, 1, 2, 3}
assert len(frames) == 35 and all(128 <= w <= 512 and 128 <= h <= 512 and colors > 8 for w, h, colors in frames)
assert len(audio) == 35 and all(n == 800 for n, _ in audio) and any(level > 0 for _, level in audio)
assert not restore(c.create_string_buffer(b'bad'), 3)
assert restore(initial, len(initial))
assert capture()[1]['players'] == before['players']
original_video, original_audio = video_hashes[-30:], audio_hashes[-30:]
for _ in range(30):
    run()
assert video_hashes[-30:] == original_video, 'Video diverged after restoring the rollback state'
assert audio_hashes[-30:] == original_audio, 'Audio diverged after restoring the rollback state'
assert capture()[1]['players'] == after['players']
reset()
assert restore(initial, len(initial))
sram = c.string_at(ram(0), state_size())
unload()
assert load(c.byref(info))
c.memmove(ram(0), sram, len(sram))
run()
assert abs(capture()[1]['players']['0'][0] - before['players']['0'][0]) < 5
unload()
assert not ram(0)

# Exercise native composition with a cropped camera, changing controller counts,
# HD output, and an odd author-defined display resolution.
scaling_cart = subprocess.check_output(
    ['node', '--input-type=module', '-e', '''
        import {readFileSync} from 'node:fs';
        import {compileProject} from './src/compiler.mjs';
        import {pack} from './src/pack.mjs';
        import {parseScript} from './src/wafflescript.mjs';
        const project=JSON.parse(readFileSync('demo/project.json','utf8'));
        const scripts=new Map(Object.keys(project.sprites).map(id=>[id,{events:{}}]));
        project.rooms.yard.entities=[['maker',65,80],['runner',410,105]].map(([sprite,x,near],player)=>{
          project.sprites[sprite].physics={mode:'none'};
          scripts.set(sprite,parseScript(`on pressed.a
            set_position(${near}, 54)
          end`));
          return {sprite,player,x,y:54};
        });
        scripts.set('game',parseScript(`on game startup
          set_adaptive_display(128, 128, 512, 512, 2)
          set_split_screen(true, 96)
        end
        on pressed.menu
          set_display_resolution(301, 207)
        end`));
        scripts.set('room:yard',parseScript(`on start
          camera_zoom(2.0)
          set_camera_bottom_inset(12)
        end
        on pressed.b
          set_room_shader("hd", 100)
        end
        on pressed.x
          reset_room_shader()
        end`));
        process.stdout.write(pack(await compileProject('demo',{project,scripts})));
    '''],
    cwd=Path(__file__).resolve().parents[1],
)
scaling_buffer = c.create_string_buffer(scaling_cart)
assert load(c.byref(Game(None, c.cast(scaling_buffer, ptr), len(scaling_cart), None)))
geometry_updates.clear()


def dimensions(w, h, scale=1):
    assert frames[-1][:2] == (w * scale, h * scale), (frames[-1][:2], (w * scale, h * scale))
    info = AvInfo()
    av_info(c.byref(info))
    geometry = info.geometry
    assert (geometry.width, geometry.height) == (w, h)
    assert abs(geometry.aspect - w / h) < 1e-6
    assert geometry.max_width >= w * scale and geometry.max_height >= h * scale


def pixel(x, y):
    data, pitch = frame_data
    offset = y * pitch + x * 4
    return int.from_bytes(data[offset:offset + 4], sys.byteorder) & 0xffffff


def step(*buttons):
    held.clear()
    held.update(buttons)
    run()


matte = 0x0e0e16
step()
dimensions(320, 240)
assert pixel(0, 0) == matte and pixel(160, 120) != matte
set_device(1, 1)
step()
dimensions(320, 240)
assert pixel(160, 120) == matte and pixel(158, 120) != matte
step((0, 8))
dimensions(320, 240, 2)
assert all(pixel(x, 240) == matte for x in (320, 321))
assert all(pixel(x, 240) != matte for x in (319, 322))
step((0, 0), (1, 0))
dimensions(320, 240, 2)
assert pixel(320, 240) != matte
assert not geometry_updates
step((0, 3))
dimensions(301, 207, 2)
assert len(geometry_updates) == 1 and geometry_updates[0][:2] == (301, 207)
assert abs(geometry_updates[0][2] - 301 / 207) < 1e-6
step((0, 1))
dimensions(301, 207)
assert len(geometry_updates) == 1
unload()
function('deinit', None)()
print('Passed libretro input, video, audio, frame-exact rollback, checkpoint, reset, and save RAM checks')
print('Passed libretro aspect ratio, stable split-screen geometry, native HD output, and scripted resolution changes')
