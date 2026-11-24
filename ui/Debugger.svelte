<script>
  import {onMount} from 'svelte';
  import SearchSelect from './SearchSelect.svelte';
  import {unpack} from '../src/cartridge.mjs';
  import {loadAtlas,drawRoom} from './render.js';
  let {room,onClose}=$props();
  let symbols=$state.raw({});
  let current=$derived(symbols[state?.sprite]?.[stop?.event]?.[stop?.pc]);
  let canvas,worker,control,cart,images={},frame;
  let stop=$state(null),state=$state(null),error=$state(''),running=$state(false);
  let event=$state(''),pc=$state(0),actor=$state(0);
  const keys=['KeyW','KeyS','KeyA','KeyD','Semicolon','Quote','Space','Enter'];
  function key(e,down){
    const index=keys.indexOf(e.code);if(index<0||!control)return;
    e.preventDefault();
    if(down)Atomics.or(control,1,1<<index);else Atomics.and(control,1,~(1<<index));
  }
  function resume(step){
    stop=null;running=true;Atomics.store(control,0,step?1:2);Atomics.notify(control,0);
  }
  function breakpoint(){
    Atomics.store(control,3,pc||0);Atomics.store(control,4,actor||0);
    for(let i=0;i<64;i++)Atomics.store(control,5+i,event.charCodeAt(i)||0);
  }
  onMount(()=>{
    let closed=false;
    (async()=>{
      if(typeof SharedArrayBuffer==='undefined')throw Error('Open the debugger in Studio on localhost.');
      const bytes=new Uint8Array(await (await fetch('./game.waffle')).arrayBuffer());
      if(closed)return;
      cart=unpack(bytes);
      control=new Int32Array(new SharedArrayBuffer(69*4));control[0]=1;
      worker=new Worker(new URL('./debug-worker.js',import.meta.url),{type:'module'});
      worker.onerror=e=>error=e.message;
      worker.onmessage=async({data})=>{
        if(data.error)error=data.error;
        if(data.state)state=data.state;
        if(data.stop){
          stop=data.stop;running=false;
          const sprite=data.state?.sprite;
          if(sprite&&!symbols[sprite]){
            const roomScript=sprite.startsWith('@room/');
            const path=roomScript?'room-script/'+encodeURIComponent(sprite.slice(6)):'script/'+encodeURIComponent(sprite);
            const r=await fetch('./api/'+path+'?debug');
            if(r.ok)symbols={...symbols,[sprite]:await r.json()};
          }
        }
        if(data.frame){
          frame=data.frame;const id=frame.room;
          images[id]??=await loadAtlas(cart.atlases[id]);
          if(!closed&&frame.room===id)drawRoom(canvas,cart,frame,images);
        }
      };
      worker.postMessage({bytes,room,buffer:control.buffer});
    })().catch(e=>error=String(e.message??e));
    return ()=>{closed=true;worker?.terminate();};
  });
</script>
<section class="card debugger" aria-label="Script debugger">
  <div class="row"><h2>Script debugger</h2><button onclick={onClose}>Close</button></div>
  <div tabindex="0" role="application" aria-label="Debug game input" onkeydown={e=>key(e,true)} onkeyup={e=>key(e,false)} onblur={()=>control&&Atomics.store(control,1,0)}><canvas bind:this={canvas}></canvas></div>
  <div class="row"><button disabled={!stop} onclick={()=>resume(false)}>Continue</button><button disabled={!stop} onclick={()=>resume(true)}>Step instruction</button><button disabled={!running} onclick={()=>Atomics.store(control,0,1)}>Pause</button></div>
  <p role="status">{stop ? `Paused at ${stop.event} · instruction ${stop.pc} · entity ${stop.actor}` : 'Running'}</p>
  {#if stop&&current}<p><code>{current.file}:{current.line} {current.text}</code> · {current.op}</p>{/if}
  <form class="row" onsubmit={e=>{e.preventDefault();breakpoint();}}>
    <label>Event<input placeholder="tick" maxlength="64" bind:value={event}></label>
    <label>Instruction<input type="number" min="0" bind:value={pc}></label>
    <SearchSelect label="Debug entity" value={actor}
      options={[{value:0,label:'Any entity'},...(state?.entities??[]).map(entry=>({value:entry.id,label:entry.name??'Entity'}))]}
      onChange={value=>actor=value}/>
    <button disabled={!state}>Set breakpoint</button><button type="button" disabled={!state} onclick={()=>{event='';breakpoint();}}>Clear</button>
  </form>
  {#if state}<p>{state.room} · Tick {state.tick} · {state.sprite?.startsWith('@room/')?'Room script':(state.sprite??'Entity')+' '+state.actor}</p>
    {#each ['globals','flags','locals'] as scope}<h3>{scope}</h3><dl>{#each Object.entries(state[scope]??{}) as [name,value]}<dt>{name}</dt><dd>{value}</dd>{:else}<dd>None</dd>{/each}</dl>{/each}
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
</section>
<style>
.debugger{padding:.8rem;overflow-y:auto;overflow-x:hidden;max-height:85dvh}.debugger canvas{width:min(100%,32rem);height:12rem;object-fit:contain;background:#16191b}.debugger label{max-width:10rem}dl{display:grid;grid-template-columns:minmax(0,auto) minmax(0,1fr);margin:.3rem 0}dd{overflow-wrap:anywhere}
</style>
