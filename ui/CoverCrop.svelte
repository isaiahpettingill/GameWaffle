<script>
  import {
    COVER_SIZE, DEFAULT_COVER_CROP, MAX_COVER_ZOOM, clamp, coverCropRect, coverFitZoom,
  } from '../src/cover.mjs';

  let {file=null, path='', crop=$bindable(), upload=$bindable(null), ready=$bindable(false), disabled=false}=$props();
  let image=$state.raw(null), canvas=$state(), error=$state(''), drag=$state.raw(null);
  const frame=$derived(image ? coverCropRect(image.width,image.height,crop) : null);
  const minZoom=$derived(image ? coverFitZoom(image.width,image.height) : 1);

  async function load(source, existing, signal){
    if(source && !/\.(ase|aseprite)$/i.test(source.name)){
      const bitmap=await createImageBitmap(source);
      if(!/\.(jpe?g|webp)$/i.test(source.name))return {bitmap,source};
      try{
        const scale=Math.min(1,4096/Math.max(bitmap.width,bitmap.height),Math.sqrt(7*1024*1024/(bitmap.width*bitmap.height)));
        const pixels=document.createElement('canvas');
        pixels.width=Math.max(1,Math.round(bitmap.width*scale));
        pixels.height=Math.max(1,Math.round(bitmap.height*scale));
        pixels.getContext('2d').drawImage(bitmap,0,0,pixels.width,pixels.height);
        const png=await new Promise((resolve,reject)=>pixels.toBlob(blob=>
          blob ? resolve(blob) : reject(Error('Could not convert the cover image')), 'image/png'));
        const converted=new File([png],source.name.replace(/\.[^.]+$/,'.png'),{type:'image/png'});
        return {bitmap:await createImageBitmap(converted),source:converted};
      }finally{bitmap.close();}
    }
    const response=source
      ? await fetch('./api/import?kind=cover&preview=1&name='+encodeURIComponent(source.name),{method:'POST',body:source,signal})
      : await fetch('./api/room-art?path='+encodeURIComponent(existing),{cache:'no-store',signal});
    if(!response.ok)throw Error((await response.json()).error ?? 'Could not open the cover image');
    return {bitmap:await createImageBitmap(await response.blob()),source};
  }

  $effect(()=>{
    const source=file, existing=path;
    const controller=new AbortController();
    let opened;
    image=null;upload=null;ready=false;error='';drag=null;
    load(source,existing,controller.signal).then(result=>{
      if(controller.signal.aborted){result.bitmap.close();return;}
      opened=result.bitmap;
      image=opened;upload=result.source;ready=true;
    }).catch(err=>{
      if(!controller.signal.aborted)error=err.message;
    });
    return ()=>{controller.abort();opened?.close();};
  });

  $effect(()=>{
    if(!canvas||!image||!frame)return;
    const ctx=canvas.getContext('2d');
    const scale=COVER_SIZE/frame.side;
    ctx.clearRect(0,0,COVER_SIZE,COVER_SIZE);
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(image,-frame.left*scale,-frame.top*scale,image.width*scale,image.height*scale);
  });

  function startDrag(event){
    if(!frame||disabled||event.button!==0||drag)return;
    const {width}=event.currentTarget.getBoundingClientRect();
    drag={id:event.pointerId, x:event.clientX, y:event.clientY, crop, scale:frame.side/width};
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event){
    if(!image||!frame||disabled||drag?.id!==event.pointerId)return;
    const pan=(value, distance, span)=>span ? clamp(value-distance*drag.scale/span,0,1) : value;
    crop={...drag.crop,
      x:pan(drag.crop.x,event.clientX-drag.x,image.width-frame.side),
      y:pan(drag.crop.y,event.clientY-drag.y,image.height-frame.side),
    };
  }
  function endDrag(event){
    if(drag?.id===event.pointerId)drag=null;
  }
  function center(zoom){
    crop={...DEFAULT_COVER_CROP,zoom};
  }
</script>

<div class="cover-crop">
  <canvas bind:this={canvas} width={COVER_SIZE} height={COVER_SIZE}
    aria-label="Cover crop preview" class:dragging={drag}
    onpointerdown={startDrag} onpointermove={moveDrag} onpointerup={endDrag}
    onpointercancel={endDrag} onlostpointercapture={endDrag}></canvas>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {:else if !image}
    <p role="status">Opening image…</p>
  {:else}
    <div class="row framing">
      <small>{COVER_SIZE} × {COVER_SIZE} px</small>
      <div class="row">
        <button type="button" onclick={()=>center(minZoom)} {disabled}>Fit</button>
        <button type="button" onclick={()=>center(1)} {disabled}>Fill</button>
      </div>
    </div>
    <label>Zoom
      <input type="range" min={minZoom} max={MAX_COVER_ZOOM} step="any" value={Math.max(minZoom,crop.zoom)}
        oninput={event=>crop={...crop,zoom:event.currentTarget.valueAsNumber}} {disabled}>
    </label>
    <label>Horizontal position
      <input type="range" min="0" max="1" step=".001" value={crop.x}
        oninput={event=>crop={...crop,x:event.currentTarget.valueAsNumber}} disabled={disabled||image.width===frame.side}>
    </label>
    <label>Vertical position
      <input type="range" min="0" max="1" step=".001" value={crop.y}
        oninput={event=>crop={...crop,y:event.currentTarget.valueAsNumber}} disabled={disabled||image.height===frame.side}>
    </label>
  {/if}
</div>

<style>
  .cover-crop{display:grid;gap:.5rem;justify-self:center;width:min(100%,19rem)}
  canvas{box-sizing:border-box;display:block;width:100%;height:auto;aspect-ratio:1;border:1px solid var(--line);
    background:repeating-conic-gradient(var(--well) 0% 25%,var(--panel) 0% 50%) 0 0/16px 16px;
    image-rendering:pixelated;touch-action:none;cursor:grab}
  canvas.dragging{cursor:grabbing}
  .framing{justify-content:space-between}
  label{display:grid;grid-template-columns:8.3rem minmax(0,1fr);align-items:center;gap:.45rem}
  input{min-width:0;width:100%}
  @media(max-width:600px){.cover-crop{width:min(100%,19rem,max(9rem,30dvh))}}
</style>
