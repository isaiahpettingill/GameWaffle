import {parentPort} from 'node:worker_threads';
import glslang from '@webgpu/glslang';

const compiler=glslang();
parentPort.on('message',({id,source})=>{
  try{
    const words=compiler.compileGLSL(source,'fragment',true);
    const bytes=new Uint8Array(words.byteLength);
    const view=new DataView(bytes.buffer);
    words.forEach((word,index)=>view.setUint32(index*4,word,true));
    parentPort.postMessage({id,bytes},[bytes.buffer]);
  }catch{
    parentPort.postMessage({id,error:'The shader could not be compiled. Check parameter names and node inputs.'});
  }
});
