import init, { Runtime } from '../web-built/runtime/runtime.js';

let ready;
export async function createRuntime(bytes, room) {
  ready ??= init();
  await ready;
  return Runtime.from_cartridge(bytes, room);
}
