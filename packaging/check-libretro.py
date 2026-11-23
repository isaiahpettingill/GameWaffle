"""Exercise the libretro ABI with the compiled Basalt Works cartridge."""
import ctypes as c
import json
from pathlib import Path
import sys

core = c.CDLL(str(Path(sys.argv[1]).resolve()))
cart = c.create_string_buffer(Path(sys.argv[2]).read_bytes())
u, ptr, size = c.c_uint, c.c_void_p, c.c_size_t


class Game(c.Structure):
    _fields_ = [('path', c.c_char_p), ('data', ptr), ('size', size), ('meta', c.c_char_p)]


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
def video(data, w, h, pitch):
    samples = c.string_at(data, h * pitch)
    frames.append((w, h, len(set(samples))))


def sound(data, count):
    samples = (c.c_int16 * (count * 2)).from_address(data)
    audio.append((count, max(samples)))
    return count


def input_state(port, device, index, button):
    ports.add(port)
    return int(port == 0 and button == 7)


register('environment', c.c_bool, [u, ptr], lambda cmd, data: cmd in (10, 11, 44))
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
init()
info = Game(None, c.cast(cart, ptr), len(cart) - 1, None)
assert not load(None)
assert load(c.byref(info))


def capture():
    buf = c.create_string_buffer(state_size())
    assert save(buf, len(buf))
    length = int.from_bytes(buf.raw[:4], 'little')
    return buf, json.loads(buf.raw[4:4 + length])


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
function('deinit', None)()
print('Passed libretro input, video, audio, checkpoint, reset, and save RAM checks')
