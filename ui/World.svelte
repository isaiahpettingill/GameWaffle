<script>
  import Modal from './Modal.svelte';
  import {mapPositionLimit,roomMapPositions,seamlessNeighbor,sharedRoomEdge} from '../src/room-geometry.mjs';
  let {rooms,authoring,start,roomId,tileArt,authoredVariants,previewImage,flags,onSelect,onScript,onMove,onExit}=$props();
  const edges={left:'Left',right:'Right',up:'Top',down:'Bottom'};
  const ids=$derived(Object.keys(rooms));
  const routes=$derived(Object.fromEntries(ids.map(id=>[id,{exits:authoring[id]?.exits??rooms[id].exits??{}}])));
  const savedPositions=$derived(roomMapPositions(rooms,routes,start));
  const label=id=>rooms[id]?.title??id;
  let viewport=$state(),canvas=$state(),width=$state(0),height=$state(0),fitted=$state(false);
  let scale=$state(8),x=$state(20),y=$state(20),drag=$state.raw(null),pan=$state.raw(null);
  const positions=$derived(drag?.position?{...savedPositions,[drag.id]:drag.position}:savedPositions);

  function fit(){
    if(!width||!height||!ids.length)return;
    const left=Math.min(...ids.map(id=>savedPositions[id][0])), top=Math.min(...ids.map(id=>savedPositions[id][1]));
    const right=Math.max(...ids.map(id=>savedPositions[id][0]+rooms[id].cols));
    const bottom=Math.max(...ids.map(id=>savedPositions[id][1]+rooms[id].rows));
    scale=Math.max(.02,Math.min(24,(width-32)/(right-left),(height-32)/(bottom-top)));
    x=(width-(left+right)*scale)/2;
    y=(height-(top+bottom)*scale)/2;
    fitted=true;
  }
  $effect(()=>{if(!fitted&&width&&height)fit();});
  $effect(()=>{
    const element=viewport;
    if(!element)return;
    element.addEventListener('wheel',wheel,{passive:false});
    return ()=>element.removeEventListener('wheel',wheel);
  });

  const links=$derived(ids.flatMap(id=>Object.entries(routes[id].exits).flatMap(([edge,exit])=>exit.targets
    .filter(target=>Object.hasOwn(rooms,target)).map(target=>({id,target,edge,span:seamlessNeighbor(routes,id,edge)===target
      ?sharedRoomEdge(rooms,positions,id,edge,target):undefined})))));
  $effect(()=>{
    if(!canvas||!width||!height)return;
    const dpr=window.devicePixelRatio||1;
    const pixelWidth=Math.round(width*dpr),pixelHeight=Math.round(height*dpr);
    if(canvas.width!==pixelWidth)canvas.width=pixelWidth;
    if(canvas.height!==pixelHeight)canvas.height=pixelHeight;
    const ctx=canvas.getContext('2d');
    ctx.resetTransform();ctx.clearRect(0,0,pixelWidth,pixelHeight);
    ctx.setTransform(scale*dpr,0,0,scale*dpr,x*dpr,y*dpr);
    ctx.imageSmoothingEnabled=false;
    for(const id of ids){
      const [left,top]=positions[id],room=rooms[id];
      if(left*scale+x>width||top*scale+y>height||(left+room.cols)*scale+x<0||(top+room.rows)*scale+y<0)continue;
      ctx.fillStyle=room.background??'#22243a';ctx.fillRect(left,top,room.cols,room.rows);
      for(const layer of [...(room.layers??[])].sort((a,b)=>(a.order??0)-(b.order??0)))for(const [col,row,tile,variant] of layer.cells){
        const frames=tileArt[tile]??[];
        const frame=frames[variant??((col*37+row*17)%(authoredVariants[tile]??frames.length))];
        const image=frame&&previewImage(frame);
        if(image?.naturalWidth)ctx.drawImage(image,left+col,top+row,1,1);
        else{ctx.fillStyle='#626583';ctx.fillRect(left+col,top+row,1,1);}
      }
    }
    for(const {id,target,edge,span} of links){
      if(id===target)continue;
      const [a,b]=positions[id], [c,d]=positions[target], room=rooms[id], other=rooms[target];
      const side=edge==='left'||edge==='right';
      ctx.lineWidth=(span?3:1.5)/scale;
      ctx.strokeStyle=span?'#8be4ad':'#c6a5f5';
      ctx.setLineDash(span?[]:[4/scale,4/scale]);
      ctx.beginPath();
      let tipX,tipY,angle;
      if(span){
        const bound=side?a+(edge==='right'?room.cols:0):b+(edge==='down'?room.rows:0);
        const middle=(span.start+span.end)/2;
        tipX=side?bound:(a+middle);
        tipY=side?(b+middle):bound;
        angle=edge==='left'?Math.PI:edge==='up'?-Math.PI/2:edge==='down'?Math.PI/2:0;
        ctx.moveTo(side?bound:a+span.start,side?b+span.start:bound);
        ctx.lineTo(side?bound:a+span.end,side?b+span.end:bound);
      }else{
        const sx=a+room.cols/2,sy=b+room.rows/2,tx=c+other.cols/2,ty=d+other.rows/2;
        tipX=sx+(tx-sx)*.65;tipY=sy+(ty-sy)*.65;
        angle=Math.atan2(ty-sy,tx-sx);
        ctx.moveTo(sx,sy);ctx.lineTo(tx,ty);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(tipX+Math.cos(angle)*5/scale,tipY+Math.sin(angle)*5/scale);
      for(const turn of [-2.4,2.4])ctx.lineTo(tipX+Math.cos(angle+turn)*6/scale,tipY+Math.sin(angle+turn)*6/scale);
      ctx.closePath();ctx.fillStyle=ctx.strokeStyle;ctx.fill();
    }
  });

  const bounded=point=>point.map(axis=>Math.max(-mapPositionLimit,Math.min(mapPositionLimit,Math.round(axis))));
  function snapped(id,[left,top]){
    const room=rooms[id], point=bounded([left,top]);
    const nearest=[Math.min(1.15,12/scale),Math.min(1.15,12/scale)];
    for(const otherId of ids){
      if(otherId===id)continue;
      const [x,y]=savedPositions[otherId], other=rooms[otherId];
      const match=(axis,value,distance)=>{
        if(Math.abs(distance)<nearest[axis]){nearest[axis]=Math.abs(distance);point[axis]=value;}
      };
      if(top<y+other.rows&&top+room.rows>y){
        match(0,x+other.cols,x+other.cols-left);
        match(0,x-room.cols,x-room.cols-left);
      }
      if(left<x+other.cols&&left+room.cols>x){
        match(1,y+other.rows,y+other.rows-top);
        match(1,y-room.rows,y-room.rows-top);
      }
    }
    return bounded(point);
  }
  function startRoom(event,id){
    if(event.button!==0)return;
    drag={id,pointer:event.pointerId,start:[event.clientX,event.clientY]};
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event){
    if(pan?.pointer===event.pointerId){x=pan.x+event.clientX-pan.left;y=pan.y+event.clientY-pan.top;return;}
    if(drag?.pointer!==event.pointerId)return;
    const dx=event.clientX-drag.start[0],dy=event.clientY-drag.start[1];
    if(!drag.position&&Math.hypot(dx,dy)<4)return;
    const [left,top]=savedPositions[drag.id], point=[left+dx/scale,top+dy/scale];
    drag={...drag,position:event.altKey?bounded(point):snapped(drag.id,point)};
  }
  function finish(event){
    if(pan?.pointer===event.pointerId)pan=null;
    if(drag?.pointer!==event.pointerId)return;
    const {id,position}=drag;
    drag=null;
    if(position&&position.some((axis,index)=>axis!==savedPositions[id][index]))onMove(id,position,savedPositions);
  }
  function startPan(event){
    if(event.button!==1&&!(event.button===0&&event.target===canvas))return;
    pan={pointer:event.pointerId,x,y,left:event.clientX,top:event.clientY};
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function wheel(event){
    event.preventDefault();
    const box=viewport.getBoundingClientRect(), px=event.clientX-box.left,py=event.clientY-box.top;
    const next=Math.max(.02,Math.min(64,scale*(event.deltaY<0?1.16:1/1.16)));
    x=px-(px-x)*next/scale;y=py-(py-y)*next/scale;scale=next;
  }
  function nudge(event,id){
    const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    if(!delta)return;
    event.preventDefault();
    onMove(id,bounded(savedPositions[id].map((value,index)=>value+delta[index])),savedPositions);
  }

  let exitEdit=$state(null),saving=$state(false),error=$state('');
  function editExit(edge){
    const exit=routes[roomId]?.exits[edge];
    exitEdit={id:roomId,edge,target:exit?.targets[0]??'',alternates:exit?.targets.slice(1)??[],
      mode:exit?.mode??'fixed',flag:exit?.flag??'',when:exit?.when??true,adjacent:exit?.adjacent??false};
    error='';
  }
  async function saveExit(event){
    event.preventDefault();
    if(saving)return;
    const {id,edge,target,mode,flag,when,adjacent,alternates}=exitEdit;
    const targets=target?[target,...(mode==='fixed'?[]:alternates.filter(value=>value!==target))]:[];
    saving=true;error='';
    try{
      await onExit(id,edge,{targets,mode,flag:target?flag:'',when,adjacent:Boolean(target)&&id!==target&&mode==='fixed'&&adjacent});
      exitEdit=null;
    }catch(err){error=err.message;}
    finally{saving=false;}
  }
</script>

<section class="card">
  <div class="row heading"><h2>World map</h2><button type="button" onclick={fit}>Fit</button></div>
  <div class="world" role="region" aria-label="World layout" bind:this={viewport} bind:clientWidth={width} bind:clientHeight={height}
    onpointerdown={startPan} onpointermove={move} onpointerup={finish} onpointercancel={()=>{drag=null;pan=null;}}>
    <canvas bind:this={canvas} aria-hidden="true"></canvas>
    {#each ids as id (id)}
      {@const [left,top]=positions[id]}
      <button type="button" class="room" class:selected={id===roomId} aria-pressed={id===roomId} title={label(id)}
        style:left={x+left*scale+'px'} style:top={y+top*scale+'px'} style:width={rooms[id].cols*scale+'px'} style:height={rooms[id].rows*scale+'px'}
        onclick={()=>onSelect(id)} onpointerdown={event=>startRoom(event,id)} onkeydown={event=>nudge(event,id)}><span>{label(id)}</span></button>
    {/each}
  </div>
  <div class="row room-heading"><h3>{label(roomId)}</h3><button type="button" onclick={onScript}>Open room script</button></div>
  <dl class="connections">
    {#each Object.entries(edges) as [edge,name]}
      {@const exit=routes[roomId]?.exits[edge]}
      {@const target=exit?.targets[0]}
      {@const span=target&&exit.adjacent?sharedRoomEdge(rooms,positions,roomId,edge,target):null}
      <div><dt><button type="button" aria-label={'Edit '+name.toLowerCase()+' exit'} onclick={()=>editExit(edge)}>{name}</button></dt>
        <dd>{target?exit.targets.map(label).join(', '):'No exit'}</dd>
        {#if target&&exit.adjacent}<small>{span?'Seamless':'Align edges for seamless scrolling'}</small>{/if}
        {#if target&&exit.flag}<small class="condition">{exit.flag} {exit.when?'on':'off'}</small>{/if}
      </div>
    {/each}
  </dl>
</section>

{#if exitEdit}
  <Modal title={'Edit '+edges[exitEdit.edge].toLowerCase()+' exit'} busy={saving} onClose={()=>exitEdit=null}>
    <form onsubmit={saveExit}>
      <label>Destination<select aria-label="Destination" bind:value={exitEdit.target} disabled={saving}><option value="">No exit</option>
        {#each ids as id}<option value={id}>{label(id)}</option>{/each}
      </select></label>
      {#if exitEdit.target}
        <label>Routing<select aria-label="Routing" bind:value={exitEdit.mode} disabled={saving}>
          <option value="fixed">Fixed</option><option value="save">Random per save</option><option value="crossing">Random each crossing</option>
        </select></label>
        {#if exitEdit.mode==='fixed'&&exitEdit.id!==exitEdit.target}<label class="toggle"><input type="checkbox" bind:checked={exitEdit.adjacent} disabled={saving}>Seamless scrolling</label>
        {:else}<label>Alternate destinations<select aria-label="Alternate destinations" multiple bind:value={exitEdit.alternates} disabled={saving}>
          {#each ids.filter(id=>id!==exitEdit.id&&id!==exitEdit.target) as id}<option value={id}>{label(id)}</option>{/each}
        </select></label>{/if}
        {#if flags.length||exitEdit.flag}
          <label>Required flag<select aria-label="Required flag" bind:value={exitEdit.flag} disabled={saving}><option value="">None</option>
            {#each [...new Set([...flags,...(exitEdit.flag?[exitEdit.flag]:[])])] as flag}<option value={flag}>{flag}</option>{/each}
          </select></label>
          {#if exitEdit.flag}<label class="toggle"><input type="checkbox" bind:checked={exitEdit.when} disabled={saving}>Flag must be on</label>{/if}
        {/if}
      {/if}
      {#if error}<p role="alert">{error}</p>{/if}
      <div class="dialog-actions"><button type="button" disabled={saving} onclick={()=>exitEdit=null}>Cancel</button>
        <button class="primary" disabled={saving}>{saving?'Saving…':'Save exit'}</button></div>
    </form>
  </Modal>
{/if}

<style>
  section{padding:.8rem}h2,h3{font-size:1rem;margin:0}.heading,.room-heading{justify-content:space-between}
  .world{position:relative;overflow:hidden;height:clamp(16rem,52dvh,48rem);background:var(--well);margin:.55rem 0 .7rem;touch-action:none}
  canvas{position:absolute;width:100%;height:100%;display:block;cursor:grab}
  .world .room{position:absolute;min-height:0;min-width:0;display:block;padding:0;background:transparent;border:1px solid #aaaac488;overflow:hidden;text-align:left;cursor:grab;touch-action:none}
  .world .room.selected{border:2px solid var(--accent)}
  .world .room:active{cursor:grabbing}
  .room span{position:absolute;top:0;left:0;padding:.17rem .35rem;max-width:100%;background:#171829e8;color:#f1e7ff;font-size:.73rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .connections{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,10rem),1fr));gap:.45rem;margin:.5rem 0 0}
  .connections div{padding:.4rem .55rem;border:1px solid var(--line);overflow-wrap:anywhere}
  .connections button{margin-bottom:.25rem}
  dd{margin:0;color:var(--muted)}small{color:var(--muted)}
  small.condition{display:block}
  form .toggle{display:flex;align-items:center;gap:.35rem}
</style>
