import {createRuntime} from './runtime.js';
let control, runtime, lastActor=0, location, frames=0;
let breakEvent='', breakPc=0, breakActor=0;
globalThis.waffleBreak=(actor,event,pc)=>{
  lastActor=actor;
  if(Atomics.load(control,0)!==1 && !(event===breakEvent && pc===breakPc && (!breakActor||actor===breakActor)))return false;
  location={actor,event,pc};
  return true;
};
globalThis.waffleInspect=state=>{
  Atomics.store(control,0,0);
  postMessage({stop:location,state:JSON.parse(state)});
  // Wait here to retain the VM registers, physics tick, and event call stack.
  while(Atomics.load(control,0)===0)Atomics.wait(control,0,0);
  // A breakpoint can change while the worker is stopped.
  readBreakpoint();
};
function readBreakpoint(){
  breakPc=Atomics.load(control,3);breakActor=Atomics.load(control,4);
  breakEvent=Array.from(control.subarray(5,69),v=>v?String.fromCharCode(v):'').join('');
}
onmessage=async({data})=>{
  try{
    control=new Int32Array(data.buffer);
    runtime=await createRuntime(data.bytes,data.room);
    runtime.enable_debug();
    postMessage({frame:JSON.parse(runtime.snapshot())});
    function frame(){
      try{
        readBreakpoint();
        const state=JSON.parse(runtime.step_buttons(Atomics.load(control,1)));
        postMessage({frame:state,...(++frames%15===0?{state:JSON.parse(runtime.inspect_actor(Atomics.load(control,4)||lastActor))}:{})});
        setTimeout(frame,1000/60);
      }catch(e){postMessage({error:String(e)});}
    }
    frame();
  }catch(e){postMessage({error:String(e)});}
};
