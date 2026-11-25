import { decode as decodeQoa } from 'qoa-format';

export function createAudio() {
  let context, master;
  let muted = true, cart, music, ambience, roomGeneration=0;
  const sources = [], decoded = new Map();
  const effects = new Set();
  function stopRoom() {
    roomGeneration++;
    for (const source of sources.splice(0)) { try { source.stop(); } catch { /* Already stopped. */ } }
  }
  function setCart(value) {
    stopRoom();
    stopEffects();
    decoded.clear();
    cart = value;
    music = ambience = undefined;
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
  async function play(id, volume, loop = false, entity) {
    if (muted || !id) return false;
    const generation = roomGeneration, expected = cart;
    const effect = loop ? null : {entity, source:null};
    if (effect) effects.add(effect);
    try {
      const buffer = await decode(id);
      if (!buffer || muted || cart !== expected || (loop ? generation !== roomGeneration : !effects.has(effect))) return false;
      const player = context.createBufferSource(), gain = context.createGain();
      player.buffer = buffer;
      player.loop = loop;
      gain.gain.value = volume;
      player.connect(gain);
      gain.connect(master);
      player.start();
      if (loop) sources.push(player);
      else {
        effect.source = player;
        player.onended = () => effects.delete(effect);
      }
      return true;
    } catch { return false; }
    finally { if (effect && !effect.source) effects.delete(effect); }
  }
  function stopEffects(entity) {
    for (const effect of effects) {
      if (entity !== undefined && effect.entity !== entity) continue;
      effects.delete(effect);
      try { effect.source?.stop(); } catch { /* Already stopped. */ }
    }
  }
  function apply(commands) {
    for (const command of commands) {
      if (typeof command === 'string') play(command,.65);
      else if (command.kind === 'play') play(command.sound,.65,false,command.entity);
      else if (command.kind === 'stop') stopEffects(command.entity);
      else if (command.kind === 'room_changed') {
        for (const effect of effects) effect.entity=undefined;
      }
    }
  }
  function setRoom(id,settings) {
    const room=cart?.rooms[id];
    const nextMusic=settings?.music??room?.music, nextAmbience=settings?.ambience??room?.ambience;
    if(music===nextMusic && ambience===nextAmbience)return;
    music=nextMusic;ambience=nextAmbience;
    stopRoom();
    play(music,.7,true);
    play(ambience,.45,true);
  }
  async function toggle() {
    muted = !muted;
    if (muted) stopRoom();
    else {
      context ??= new AudioContext();
      if (!master) { master = context.createGain(); master.connect(context.destination); }
      await context.resume();
      play(music,.7,true);
      play(ambience,.45,true);
    }
    if (master) master.gain.value = muted ? 0 : 1;
    return muted;
  }
  function dispose() { stopRoom(); stopEffects(); context?.close().catch(()=>{}); }
  return { setCart, setRoom, apply, toggle, dispose };
}
