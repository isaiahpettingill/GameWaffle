<script>
  import {decodeFrame} from '../src/frame.mjs';
  import {onMount} from 'svelte';
  import {Pause,Play} from '@lucide/svelte';
  import {unpack} from '../src/cartridge.mjs';
  import {createRuntime} from './runtime.js';
  import {MAX_CATCH_UP,TICK_MS} from './frame-clock.js';
  import {drawRoom,loadAtlas} from './render.js';
  import {previewShaderStatus,runShaderPipeline} from './shader-pipeline.js';
  import {createShaderPreviewGL} from './shader-preview-gl.js';

  let {room,definition}=$props();
  let canvas,presentation,stage;
  let scope=$state('room'),playing=$state(true),effect=$state(true),status=$state('Loading room…'),loadError=$state('');
  let runtime,cart,lastGood,uniforms=[],candidate,snapshot,raf,last=0,elapsed=0,needsPaint=true;
  let previewGL, rejected, useGL=false;
  const atlases={};
  const previewKey=':studio_preview';

  function prepareGL(shader){
    if(previewGL===undefined)previewGL=createShaderPreviewGL();
    return previewGL?.prepare(shader);
  }

  function prepare(shader){
    if(!shader||shader===candidate||shader===rejected)return;
    if(shader.fingerprint!==lastGood?.fingerprint){
      const building=previewShaderStatus(shader);
      if(building){
        status=building;
        if(building==='Compiling shaders…')return;
        try{
          if(!prepareGL(shader)){rejected=shader;return;}
        }catch(error){rejected=shader;status='Shader preview — '+error.message;return;}
      }
      useGL=Boolean(building);
      lastGood=shader;
    }
    candidate=shader;
    const words=new Uint32Array(shader.uniformSize/4);
    const floats=new Float32Array(words.buffer);
    for(const {defaults,offset} of shader.parameters)
      if(defaults)floats.set(defaults,offset/4);
    uniforms=words;
    needsPaint=true;
    status='';
  }

  function runPasses(owner,kind,source,shaders,passes,tick,size,room){
    const studioPass=passes?.[0]?.shader===previewKey;
    if(studioPass&&useGL)return previewGL.run(source,uniforms,tick,size,room);
    const result=runShaderPipeline(owner,kind,source,shaders,passes,tick,size,room);
    if(studioPass&&result.status==='The WebGPU device was lost.'&&lastGood!==rejected){
      try{useGL=Boolean(prepareGL(lastGood));}catch{useGL=false;}
      if(useGL)return previewGL.run(source,uniforms,tick,size,room);
      rejected=lastGood;
    }
    return result;
  }

  function tick(now){
    if(!runtime)return;
    try{
      prepare(definition);
      elapsed=Math.min(elapsed+(last?now-last:0),TICK_MS*MAX_CATCH_UP);
      last=now;
      if(playing&&elapsed>=2*TICK_MS){
        const frames=Math.floor((elapsed+1e-6)/TICK_MS);
        elapsed=Math.max(0,elapsed-frames*TICK_MS);
        runtime.advance_buttons(0,frames);
        snapshot=decodeFrame(runtime.snapshot());
        needsPaint=true;
      }else if(!playing)elapsed=0;
      if(needsPaint&&atlases[snapshot.room]?.image){
        const pass=effect&&lastGood?[{shader:previewKey,uniforms}]:[];
        const frame=scope==='display'
          ? {...snapshot,gameSettings:{...snapshot.gameSettings,postprocessing:pass}}
          : {...snapshot,roomSettings:{...snapshot.roomSettings,shaderPipeline:pass},
            gameSettings:{...snapshot.gameSettings,postprocessing:[]}};
        const assets=Object.fromEntries(Object.entries(atlases).map(([id,entry])=>[id,entry.image]));
        const error=drawRoom(canvas,{...cart,shaders:{...cart.shaders,[previewKey]:lastGood}},frame,assets,false,presentation,runPasses);
        if(error)status=error;
        needsPaint=false;
      }else if(!atlases[snapshot.room])prefetch(snapshot.room);
    }catch(error){loadError=String(error.message??error);return;}
    raf=requestAnimationFrame(tick);
  }

  function prefetch(id){
    if(atlases[id])return;
    const entry=atlases[id]={};
    loadAtlas(cart.atlases[id]).then(image=>{entry.image=image;needsPaint=true;})
      .catch(error=>loadError=String(error.message??error));
  }

  $effect(()=>{scope;effect;needsPaint=true;});
  onMount(()=>{
    const abort=new AbortController();
    const resize=new ResizeObserver(()=>{
      const bounds=stage.getBoundingClientRect();
      runtime?.set_camera_window(Math.floor(bounds.width),Math.floor(bounds.height),true);
      if(runtime&&!playing)snapshot=decodeFrame(runtime.snapshot());
      needsPaint=true;
    });
    resize.observe(stage);
    (async()=>{
      const response=await fetch('./game.waffle',{signal:abort.signal});
      if(!response.ok)throw Error('Cannot load the room preview');
      const bytes=new Uint8Array(await response.arrayBuffer());
      const current=unpack(bytes),start=Object.hasOwn(current.rooms,room)?room:current.start;
      const bounds=stage.getBoundingClientRect();
      const engine=await createRuntime(bytes,start,0,[Math.floor(bounds.width),Math.floor(bounds.height)]);
      if(abort.signal.aborted){engine.free();return;}
      runtime=engine;cart=current;snapshot=decodeFrame(engine.snapshot());
      prefetch(snapshot.room);status='';
      raf=requestAnimationFrame(tick);
    })().catch(error=>{if(!abort.signal.aborted)loadError=String(error.message??error);});
    return ()=>{abort.abort();resize.disconnect();cancelAnimationFrame(raf);runtime?.free();previewGL?.dispose();runtime=null;};
  });
</script>

<div class="preview">
  <div bind:this={stage} class="screen" aria-label="Live room preview" role="img">
    <canvas bind:this={canvas}></canvas>
    <canvas bind:this={presentation} hidden></canvas>
  </div>
  <div class="controls">
    <label>Preview <select aria-label="Preview shader scope" bind:value={scope}><option value="room">Room</option><option value="display">Display</option></select></label>
    <button type="button" class="icon-button" aria-label={playing?'Pause preview':'Resume preview'} onclick={()=>playing=!playing}>
      {#if playing}<Pause size={15}/>{:else}<Play size={15}/>{/if}
    </button>
    <label><input type="checkbox" bind:checked={effect}>Show effect</label>
  </div>
  {#if loadError||status}<small role="status">{loadError||status}</small>{/if}
</div>

<style>
  .preview{min-width:0;display:grid;gap:.5rem;align-content:start}
  .screen{position:relative;aspect-ratio:4/3;min-width:0;background:var(--well);overflow:hidden;outline:1px solid var(--line)}
  canvas{position:absolute;width:100%;height:100%;object-fit:contain;image-rendering:pixelated}
  canvas[hidden]{display:none}
  .controls,.controls label{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap}
  .controls{justify-content:space-between}
  .controls label,small{color:var(--muted)}
</style>
