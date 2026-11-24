<script>
  import {onMount} from 'svelte';
  import {Pause,Play} from '@lucide/svelte';
  import {unpack} from '../src/cartridge.mjs';
  import {createRuntime} from './runtime.js';
  import {drawRoom,loadAtlas} from './render.js';
  import {previewShaderStatus} from './shader-pipeline.js';

  let {room,definition}=$props();
  let canvas,presentation,stage;
  let scope=$state('room'),playing=$state(true),effect=$state(true),status=$state('Loading room…'),loadError=$state('');
  let runtime,cart,lastGood,uniforms=[],candidate,snapshot,raf,last=0,elapsed=0,needsPaint=true;
  const atlases={};

  function prepare(shader){
    if(!shader||shader===candidate)return;
    if(shader.fingerprint!==lastGood?.fingerprint){
      const building=previewShaderStatus(shader);
      if(building){status=building;return;}
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

  function tick(now){
    if(!runtime)return;
    try{
      prepare(definition);
      elapsed=Math.min(elapsed+(last?now-last:0),100);
      last=now;
      if(playing&&elapsed>=1000/30){
        const frames=Math.floor(elapsed/(1000/60));
        elapsed-=frames*(1000/60);
        for(let i=0;i<frames;i++)snapshot=JSON.parse(runtime.step_buttons(0));
        needsPaint=true;
      }else if(!playing)elapsed=0;
      if(needsPaint&&atlases[snapshot.room]?.image){
        const pass=effect&&lastGood?[{shader:':studio_preview',uniforms}]:[];
        const frame=scope==='display'
          ? {...snapshot,gameSettings:{...snapshot.gameSettings,postprocessing:pass}}
          : {...snapshot,roomSettings:{...snapshot.roomSettings,shaderPipeline:pass},
            gameSettings:{...snapshot.gameSettings,postprocessing:[]}};
        const assets=Object.fromEntries(Object.entries(atlases).map(([id,entry])=>[id,entry.image]));
        const error=drawRoom(canvas,{...cart,shaders:{...cart.shaders,':studio_preview':lastGood}},frame,assets,false,presentation);
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
      if(runtime&&!playing)snapshot=JSON.parse(runtime.snapshot());
      needsPaint=true;
    });
    resize.observe(stage);
    (async()=>{
      const response=await fetch('./api/preview',{signal:abort.signal});
      if(!response.ok)throw Error('Cannot load the room preview');
      const bytes=new Uint8Array(await response.arrayBuffer());
      const current=unpack(bytes),start=Object.hasOwn(current.rooms,room)?room:current.start;
      const bounds=stage.getBoundingClientRect();
      const engine=await createRuntime(bytes,start,0,[Math.floor(bounds.width),Math.floor(bounds.height)]);
      if(abort.signal.aborted){engine.free();return;}
      runtime=engine;cart=current;snapshot=JSON.parse(engine.snapshot());
      prefetch(snapshot.room);status='';
      raf=requestAnimationFrame(tick);
    })().catch(error=>{if(!abort.signal.aborted)loadError=String(error.message??error);});
    return ()=>{abort.abort();resize.disconnect();cancelAnimationFrame(raf);runtime?.free();runtime=null;};
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
  .screen{display:grid;aspect-ratio:4/3;align-items:center;min-width:0;background:var(--well);overflow:hidden;border:1px solid var(--line)}
  canvas{grid-area:1/1;width:100%;height:100%;object-fit:contain;image-rendering:pixelated;min-width:0;min-height:0}
  canvas[hidden]{display:none}
  .controls,.controls label{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap}
  .controls{justify-content:space-between}
  .controls label,small{color:var(--muted)}
</style>
