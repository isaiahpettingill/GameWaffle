import { decode as decodeQoa } from 'qoa-format';

export function createAudio() {
  let context, master;
  let muted = true, cart, roomId;
  const sources = [], decoded = new Map();
  function stopRoom() {
    for (const source of sources.splice(0)) { try { source.stop(); } catch { /* Already stopped. */ } }
  }
  function setCart(value) {
    stopRoom();
    decoded.clear();
    cart = value;
    roomId = undefined;
  }
  function decode(id) {
    if (decoded.has(id)) return decoded.get(id);
    const track = cart?.audio[id];
    if (!track || !context) return null;
    const result = (async () => {
      if (track.format !== 'qoa') {
        return context.decodeAudioData(Uint8Array.from(track.data).buffer);
      }
      const sound = decodeQoa(Uint8Array.from(track.data));
      const buffer = context.createBuffer(sound.channelData.length,sound.samples,sound.sampleRate);
      sound.channelData.forEach((channel,index)=>buffer.copyToChannel(channel,index));
      return buffer;
    })();
    decoded.set(id,result);
    return result;
  }
  async function play(id, volume, loop = false) {
    if (muted || !id) return false;
    const room = roomId, expected = cart;
    try {
      const buffer = await decode(id);
      if (!buffer || muted || cart !== expected || (loop && room !== roomId)) return false;
      const player = context.createBufferSource(), gain = context.createGain();
      player.buffer = buffer;
      player.loop = loop;
      gain.gain.value = volume;
      player.connect(gain);
      gain.connect(master);
      player.start();
      if (loop) sources.push(player);
      return true;
    } catch { return false; }
  }
  function setRoom(id) {
    if (roomId === id) return;
    stopRoom();
    roomId = id;
    const room = cart?.rooms[id];
    play(room?.music,.7,true);
    play(room?.ambience,.45,true);
  }
  async function toggle() {
    muted = !muted;
    if (muted) stopRoom();
    else {
      context ??= new AudioContext();
      if (!master) { master = context.createGain(); master.connect(context.destination); }
      await context.resume();
      const room = roomId;
      roomId = undefined;
      setRoom(room);
    }
    if (master) master.gain.value = muted ? 0 : 1;
    return muted;
  }
  function dispose() { stopRoom(); context?.close().catch(()=>{}); }
  return { setCart, setRoom, play, toggle, dispose };
}
