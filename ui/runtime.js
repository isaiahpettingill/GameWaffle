import init, { Runtime } from '../web-built/runtime/runtime.js';

let ready;
export async function createRuntime(bytes, room, gamepads, view) {
  ready ??= init();
  await ready;
  return view
    ? Runtime.from_cartridge_with_view(bytes,room,1,gamepads,view[0],view[1],true)
    : Runtime.from_cartridge_with_controllers(bytes,room,1,gamepads);
}
