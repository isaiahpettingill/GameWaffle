import {Worker} from 'node:worker_threads';
import {compileShader} from './shader-assets.mjs';
import {shaderSource} from './shader-graph.mjs';
import {byteCache} from './compile-cache.mjs';

let compiler, next=0;
const programs=byteCache(8*1024*1024);
const jobs=new Map(), pending=new Map();

function getCompiler(){
  if(compiler)return compiler;
  // Compile off the Studio server's event loop so live preview does not delay saves.
  const worker=new Worker(new URL('./shader-compiler-worker.mjs',import.meta.url),{execArgv:[]});
  compiler=worker;
  worker.on('message',({id,bytes,error})=>{
    const job=jobs.get(id);
    if(!job)return;
    jobs.delete(id);
    if(error)job.reject(Error(error));else job.resolve(bytes);
    if(!jobs.size)worker.unref();
  });
  const close=error=>{
    if(compiler!==worker)return;
    compiler=undefined;
    for(const job of jobs.values())job.reject(error);
    jobs.clear();
  };
  worker.on('error',close);
  worker.on('exit',code=>close(Error('The shader compiler stopped ('+code+')')));
  return worker;
}

function compileSource(source){
  const cached=programs.get(source);
  if(cached)return Promise.resolve(cached);
  if(pending.has(source))return pending.get(source);
  const fresh=new Promise((resolve,reject)=>{
    const worker=getCompiler(),id=++next;
    jobs.set(id,{resolve,reject});
    worker.ref();
    worker.postMessage({id,source});
  }).then(bytes=>programs.put(source,bytes,source.length*2+bytes.length))
    .finally(()=>pending.delete(source));
  pending.set(source,fresh);
  return fresh;
}

export async function compileShaderGraph(graph,{preview=false}={}) {
  const {source,previewSource,defaults}=shaderSource(graph);
  const result=await compileShader(await compileSource(source));
  const parameters=result.parameters.map(parameter=>Object.hasOwn(defaults,parameter.name)
    ? {...parameter,defaults:defaults[parameter.name]}:parameter);
  return {...result,parameters,...(preview?{previewSource}:{})};
}
