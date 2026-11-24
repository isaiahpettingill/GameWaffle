<script>
  import {untrack} from 'svelte';
  import Modal from './Modal.svelte';
  import Sections from './Sections.svelte';
  let {entity,art,onApply,onClose}=$props();
  const tools={Rectangle:'rectangle',Circle:'circle',Pill:'pill'};
  let frame=$state(0),tool=$state('Rectangle'),shapes=$state(untrack(()=>({...entity.frameColliders})));
  let surface=$state(), drag=$state.raw(null),pending=$state.raw(null);
  const {width,height,frames=1}=untrack(()=>art);
  const placed=$derived(shapes[frame]??[]);
  const url=$derived('./api/room-art?path='+encodeURIComponent(entity.source)+'&frame='+frame);

  function point(event){
    const box=surface.getBoundingClientRect();
    return {
      x:Math.round(Math.max(0,Math.min(width,(event.clientX-box.left)*width/box.width))),
      y:Math.round(Math.max(0,Math.min(height,(event.clientY-box.top)*height/box.height))),
    };
  }
  function start(event){
    if(event.button!==0||placed.length>=8)return;
    drag={...point(event),id:event.pointerId};
    surface.setPointerCapture(event.pointerId);
  }
  function move(event){
    if(drag?.id!==event.pointerId)return;
    const to=point(event);
    const w=Math.abs(to.x-drag.x),h=Math.abs(to.y-drag.y),side=Math.min(w,h);
    const horizontal=tool==='Circle'?side:w,vertical=tool==='Circle'?side:h;
    pending={kind:tools[tool],x:to.x<drag.x?drag.x-horizontal:drag.x,y:to.y<drag.y?drag.y-vertical:drag.y,w:horizontal,h:vertical};
  }
  function finish(event,apply){
    if(drag?.id!==event.pointerId)return;
    if(apply)move(event);
    if(apply&&pending?.w>=1&&pending.h>=1)shapes[frame]=[...placed,pending];
    drag=null;pending=null;
  }
  function apply(){
    const authored=Object.fromEntries(Object.entries($state.snapshot(shapes)).filter(([,shapes])=>shapes.length));
    onApply(Object.keys(authored).length?authored:undefined);
  }
</script>

<Modal title="Frame Colliders" {onClose}>
  <div class="row toolbar">
    {#if frames>1}<label>Frame<select bind:value={frame}>{#each Array(frames) as _,index}
      <option value={index}>Frame {index+1}{shapes[index]?.length?' · custom':''}</option>
    {/each}</select></label>{/if}
    <Sections labels={Object.keys(tools)} bind:value={tool}/>
  </div>
  <svg class="drawing" role="application" aria-label="Collider drawing canvas" viewBox={`0 0 ${width} ${height}`}
    style:aspect-ratio={width+'/'+height} style:--frame-width={(44*width/height)+'dvh'} bind:this={surface}
    onpointerdown={start} onpointermove={move} onpointerup={event=>finish(event,true)} onpointercancel={event=>finish(event,false)}
    onlostpointercapture={event=>finish(event,false)}>
    <image href={url} x="0" y="0" {width} {height}/>
    {#each [...placed,...(pending?[pending]:[])] as shape}
      {#if shape.kind==='circle'}
        <circle cx={shape.x+shape.w/2} cy={shape.y+shape.h/2} r={shape.w/2}/>
      {:else}
        <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.kind==='pill'?Math.min(shape.w,shape.h)/2:0}/>
      {/if}
    {/each}
  </svg>
  <div class="row shape-tools">
    <small>{placed.length?placed.length+' of 8 shapes':'Using the default collider'}</small>
    <button disabled={!placed.length} onclick={()=>shapes[frame]=placed.slice(0,-1)}>Undo shape</button>
    <button disabled={!placed.length} onclick={()=>shapes[frame]=[]}>Clear frame</button>
  </div>
  <div class="dialog-actions"><button onclick={onClose}>Cancel</button><button class="primary" onclick={apply}>Apply colliders</button></div>
</Modal>
<style>
  .toolbar{align-items:end;margin-bottom:.45rem}
  .toolbar :global(.sections){margin:0}
  label{display:grid;gap:.24rem;color:var(--muted)}
  .drawing{display:block;width:min(100%,22rem,var(--frame-width));max-height:44dvh;margin:auto;touch-action:none;cursor:crosshair;
    background:repeating-conic-gradient(#313244 0% 25%,#242434 0% 50%) 0 / 1.3rem 1.3rem}
  image{image-rendering:pixelated;pointer-events:none}
  :is(rect,circle){fill:#89dceb32;stroke:#89dceb;vector-effect:non-scaling-stroke;stroke-width:1.5px;pointer-events:none}
  .shape-tools{margin-top:.45rem}
  .shape-tools small{margin-right:auto}
</style>
