import { pack } from '../src/cartridge.mjs';
import init, { Runtime } from '../web-built/runtime/runtime.js';

let ready;
export async function createRuntime(cart, room = cart.start, bytes = pack(cart)) {
  ready ??= init();
  await ready;
  return Runtime.from_cartridge(bytes, room);
}
