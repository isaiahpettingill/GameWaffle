import { pack } from '../src/cartridge.mjs';
import init, { Runtime } from '../web-built/runtime/runtime.js';
import url from '../web-built/runtime/runtime_bg.wasm?url';
let ready;
export async function createRuntime(cart, room = cart.start, bytes = pack(cart)) {
  ready ??= fetch(url).then(response => {
    if (!response.ok) throw Error('Cannot load the Rust runtime');
    return response.arrayBuffer();
  }).then(module_or_path => init({ module_or_path }));
  await ready;
  return Runtime.from_cartridge(bytes, room);
}
