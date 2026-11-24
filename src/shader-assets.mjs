import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {byteCache} from './compile-cache.mjs';

const cache=byteCache(16*1024*1024);
let inspector;

async function loadInspector(){
  const runtime=await import('../web-built/runtime/runtime.js');
  runtime.initSync({module:await readFile(new URL('../web-built/runtime/runtime_bg.wasm',import.meta.url))});
  if(!runtime.inspect_spirv)throw Error('Build GameWaffle Studio to import shaders');
  return runtime.inspect_spirv;
}

export async function compileShader(bytes){
  if(bytes.length>512*1024)throw Error('A SPIR-V shader can be up to 512 KiB');
  const key=createHash('sha256').update(bytes).digest('hex');
  if(cache.get(key))return cache.get(key);
  inspector??=loadInspector().catch(error=>{inspector=undefined;throw error;});
  const inspect=await inspector;
  try{
    const definition={...JSON.parse(inspect(bytes)),fingerprint:key,spirv:Uint8Array.from(bytes)};
    return cache.put(key,definition,bytes.length+definition.wgsl.length+definition.msl.length);
  }catch(error){throw Error(typeof error==='string'?error:error.message);}
}
