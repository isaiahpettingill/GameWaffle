import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {runCodec} from './asset-codec.mjs';
import {byteCache} from './compile-cache.mjs';

const audioCache=byteCache(48*1024*1024);
const sampleRate=32000;
let renderer;

async function loadRenderer(){
  const module=await import('../web-built/runtime/runtime.js');
  module.initSync({module:await readFile(new URL('../web-built/runtime/runtime_bg.wasm',import.meta.url))});
  if(!module.render_midi)throw Error('Build GameWaffle Studio before importing MIDI music');
  return module.render_midi;
}

export async function compileMidi(midi,font){
  const key=createHash('sha256').update(String(midi.length)).update(':').update(midi).update(font).digest('hex');
  const cached=audioCache.get(key);
  if(cached)return cached;
  renderer??=loadRenderer().catch(error=>{renderer=undefined;throw error;});
  const render=await renderer;
  const samples=render(midi,font,sampleRate);
  const count=samples.length/2;
  const data=runCodec('encode_stereo_qoa',sampleRate,samples.subarray(0,count),samples.subarray(count));
  return audioCache.put(key,data,data.byteLength);
}
