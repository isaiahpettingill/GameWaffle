import init, { Runtime } from '../web-built/runtime/runtime.js';

let ready;
export async function createRuntime(bytes, room, gamepads, view, aot) {
  ready ??= init();
  await ready;
  if(aot?.length){
    const [width,height]=view??[640,480];
    return Runtime.from_cartridge_with_aot(bytes,aot,room,gamepads,width,height);
  }
  return view
    ? Runtime.from_cartridge_with_view(bytes,room,1,gamepads,view[0],view[1],true)
    : Runtime.from_cartridge_with_controllers(bytes,room,1,gamepads);
}
