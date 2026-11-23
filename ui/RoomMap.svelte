<script>
  import PagedList from './PagedList.svelte';
  let spriteFilter=$state('');
  import {Layers3,SquareUserRound,Brush,Eraser,Square,Pipette,CopyPlus,MousePointer2,Hand,Undo2,Redo2,Play,ZoomIn,ZoomOut} from '@lucide/svelte';
  const icons={paint:Brush,erase:Eraser,rect:Square,pick:Pipette,spawn:CopyPlus,select:MousePointer2,hand:Hand};
  import { platformGravity, roomBorder } from '../src/schema.mjs';
import { tick } from 'svelte';
  import { newInstanceName, spriteDragType } from '../src/instances.mjs';

  let {
    room, roomId, size, tiles, sprites, tileArt, spriteArt, previewModes, layerIndex,
    selectedEntity = $bindable(-1), tileId = $bindable(''), spriteId = $bindable(''), tool = $bindable('paint'),
    canUndo, canRedo, onUndo, onRedo, onEdit, onLayer, onSprites, onAssets, onPlay, busy,
  } = $props();

  const tools = [
    ['paint', 'B', 'Brush'], ['erase', 'E', 'Eraser'], ['rect', 'R', 'Rectangle'],
    ['pick', 'I', 'Pick tile'], ['spawn', 'P', 'Add instance'], ['select', 'V', 'Select instance'],
    ['hand', 'H', 'Pan'],
  ];
  const playerColors = ['#ffc875','#92dac4','#bda6ed','#ee9e9f'];
  const collision = {
    static: '#ffc875', one_way: '#97d2f0', ladder: '#a8d4aa', fluid: '#78d3cc',
    dynamic: '#f7a270', kinematic: '#f7a270', breakable: '#f3a197', sensor: '#c8a6f0',
  };
  let variant = $state('auto'), query = $state('');
  let grid = $state(true), collisionView = $state(false), snap = $state(true);
  let zoom = $state(null), viewportWidth = $state(1), viewportHeight = $state(1);
  let viewport, canvas = $state(), draft = $state.raw(null), hover = $state.raw(null), gesture;
  let space = $state(false), hidden = $state({});
  const loadedImages = new Map();

  const view = $derived(draft ?? room);
  const width = $derived(view.cols * size);
  const height = $derived(view.rows * size);
  const fit = $derived(Math.min(2, Math.max(.02, Math.min(
    (viewportWidth - 32) / width, (viewportHeight - 32) / height,
  ))));
  const scale = $derived(zoom ?? fit);
  const spriteTool = $derived(tool === 'spawn' || tool === 'select');
  const tileChoices = $derived(Object.keys(tiles).filter(id=>id.toLowerCase().includes(query.trim().toLowerCase())));
  const help = $derived({
    paint: 'Drag to paint tiles.', erase: 'Drag to erase tiles on the active layer.',
    rect: 'Drag from one corner to the other to fill a rectangle.',
    pick: 'Select a tile on a visible layer to use it as the brush.',
    spawn: 'Select a sprite definition. Click the map to add an instance.',
    select: 'Select or drag an instance. Press Delete to remove it.',
    hand: 'Drag to move the view.',
  }[tool]);

  function image(url) {
    if (!url) return null;
    if (!loadedImages.has(url)) {
      const img = new Image();
      img.src = url;
      loadedImages.set(url, img);
    }
    return loadedImages.get(url);
  }

  function tileVariant(id, x, y, selected) {
    const count = tileArt[id]?.length || 1;
    return selected ?? ((x * 37 + y * 17) % count);
  }

  function spriteSize(actor) {
    const definition = sprites[actor.sprite];
    const img = image(spriteArt[actor.sprite]);
    return [definition?.width ?? (img?.naturalWidth || size), definition?.height ?? (img?.naturalHeight || size)];
  }

  function orderedLayers(map) {
    return map.layers.map((item,index)=>({ item, index, order:item.order ?? index }))
      .sort((a,b)=>a.order-b.order || a.index-b.index);
  }

  function draw() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = view.background ?? '#171829';
    ctx.fillRect(0,0,width,height);
    const topDown = (view.view ?? (Math.abs(view.gravity ?? platformGravity) < .01 ? 'top_down' : 'platformer')) === 'top_down';
    const entries = [
      ...orderedLayers(view).filter(({index})=>!hidden[index]).map(entry=>({...entry, sprite:false})),
      ...view.entities.map((actor,index)=>({actor,index,sprite:true,order:actor.layer ?? sprites[actor.sprite]?.layer ?? 0})),
    ].sort((a,b)=>a.order-b.order || Number(a.sprite)-Number(b.sprite)
      || ((view.ySort ?? topDown) && a.sprite && b.sprite
        ? (a.actor.y+spriteSize(a.actor)[1]/2)-(b.actor.y+spriteSize(b.actor)[1]/2) : a.index-b.index));
    for (const entry of entries) {
      if (entry.sprite) {
        const actor = entry.actor;
        const [w,h] = spriteSize(actor);
        const img = image(spriteArt[actor.sprite]);
        if (img?.complete && img.naturalWidth) {
          ctx.save();
          ctx.translate(actor.x,actor.y);
          if (actor.flipX) ctx.scale(-1,1);
          ctx.drawImage(img,-w/2,-h/2,w,h);
          ctx.restore();
        }
        else { ctx.fillStyle = '#a16b8c'; ctx.fillRect(actor.x-w/2,actor.y-h/2,w,h); }
        continue;
      }
      for (const [x,y,id,variantIndex] of entry.item.cells) {
        const art = tileArt[id];
        const img = image(art?.[tileVariant(id,x,y,variantIndex)] ?? art?.[0]);
        if (img?.complete && img.naturalWidth) ctx.drawImage(img,x*size,y*size,size,size);
        else { ctx.fillStyle = '#736485'; ctx.fillRect(x*size,y*size,size,size); }
      }
    }

    if (grid && scale * size >= 5) {
      ctx.strokeStyle = '#ece6fa35';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x=0; x<width; x+=size) { ctx.moveTo(x+.5,0); ctx.lineTo(x+.5,height); }
      for (let y=0; y<height; y+=size) { ctx.moveTo(0,y+.5); ctx.lineTo(width,y+.5); }
      ctx.stroke();
    }
    if (collisionView) {
      const border = roomBorder(view,topDown);
      if (border !== 'open') {
        const inset = Math.max(1, 1.5 / scale);
        ctx.strokeStyle = collision.static;
        ctx.lineWidth = inset;
        if (border === 'closed') ctx.strokeRect(inset/2,inset/2,width-inset,height-inset);
        else { ctx.beginPath(); ctx.moveTo(inset/2,0); ctx.lineTo(inset/2,height); ctx.moveTo(width-inset/2,0); ctx.lineTo(width-inset/2,height); ctx.stroke(); }
        ctx.lineWidth = 1;
      }
      for (const {item,index} of orderedLayers(view)) {
        if (!item.collidable || hidden[index]) continue;
        for (const [x,y,id] of item.cells) {
          const type = tiles[id]?.physics?.mode ?? previewModes[id] ?? 'static';
          const color = collision[type];
          if (!color) continue;
          ctx.fillStyle = color + '65';
          ctx.fillRect(x*size,y*size,size,size);
          ctx.strokeStyle = color;
          if (type === 'one_way') {
            ctx.beginPath();
            ctx.moveTo(x*size,y*size+1);
            ctx.lineTo((x+1)*size,y*size+1);
            ctx.stroke();
          } else ctx.strokeRect(x*size+.5,y*size+.5,size-1,size-1);
        }
      }
    }
    for (const [index,actor] of view.entities.entries()) {
      const [w,h] = spriteSize(actor);
      if (actor.player != null) {
        ctx.fillStyle = playerColors[actor.player];
        ctx.font = 'bold 10px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('P'+(actor.player+1),actor.x,actor.y-h/2-3);
      }
      if (index === selectedEntity) {
        ctx.strokeStyle = '#f4c77e';
        ctx.lineWidth = Math.max(1,1.5 / scale);
        ctx.strokeRect(actor.x-w/2-1,actor.y-h/2-1,w+2,h+2);
      }
    }

    if (!hover || (spriteTool && tool !== 'spawn') || tool === 'hand' || space) return;
    ctx.strokeStyle = '#f4c77e';
    ctx.lineWidth = Math.max(1,1 / scale);
    if (tool === 'spawn') {
      const p = placement(hover);
      const img = image(spriteArt[spriteId]);
      if (img?.complete && img.naturalWidth) {
        const [w,h] = spriteSize({sprite:spriteId});
        ctx.globalAlpha = .55;
        ctx.drawImage(img,p.px-w/2,p.py-h/2,w,h);
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.moveTo(p.px-5,p.py); ctx.lineTo(p.px+5,p.py);
      ctx.moveTo(p.px,p.py-5); ctx.lineTo(p.px,p.py+5);
      ctx.stroke();
      return;
    }
    const area = tool === 'rect' && gesture?.kind === 'rect'
      ? rectangle(gesture.start,hover) : rectangle(hover,hover);
    ctx.strokeRect(area.x*size+.5,area.y*size+.5,area.cols*size-1,area.rows*size-1);
    if (tool === 'paint' && tileId && !gesture) {
      const img = image(tileArt[tileId]?.[tileVariant(tileId,hover.x,hover.y,brushVariant())]);
      if (img?.complete && img.naturalWidth) {
        ctx.globalAlpha = .55;
        ctx.drawImage(img,hover.x*size,hover.y*size,size,size);
        ctx.globalAlpha = 1;
      }
    }
  }

  $effect(()=>{
    const urls = new Set([...Object.values(tileArt).flat(),...Object.values(spriteArt)]);
    for (const key of loadedImages.keys()) if (!urls.has(key)) loadedImages.delete(key);
    const images = [...urls].map(image);
    let cancelled = false;
    Promise.allSettled(images.map(img=>img.decode())).then(()=>{ if (!cancelled) draw(); });
    return ()=>{ cancelled = true; };
  });
  $effect(()=>{ draw(); });

  function chooseTool(next) {
    tool = next;
  }

  function chooseTile(id, selected = 'auto') {
    tileId = id;
    variant = selected;
    if (spriteTool || tool === 'erase' || tool === 'pick' || tool === 'hand') chooseTool('paint');
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    const px = Math.max(0,Math.min(width-.001,(event.clientX-rect.left)/rect.width*width));
    const py = Math.max(0,Math.min(height-.001,(event.clientY-rect.top)/rect.height*height));
    return {px,py,x:Math.floor(px/size),y:Math.floor(py/size)};
  }

  function placement(p) {
    if (!snap) return {px:Math.round(p.px),py:Math.round(p.py)};
    return {px:Math.round((p.x+.5)*size),py:Math.round((p.y+.5)*size)};
  }

  function rectangle(a,b) {
    return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),cols:Math.abs(a.x-b.x)+1,rows:Math.abs(a.y-b.y)+1};
  }

  function brushVariant() {
    return variant !== 'auto' && Number(variant) < (tileArt[tileId]?.length ?? 0) ? Number(variant) : undefined;
  }

  function stamp(x,y) {
    const key = y * room.cols + x;
    const old = gesture.cells.get(key);
    if (gesture.kind === 'erase') {
      if (gesture.cells.delete(key)) gesture.changed = true;
      return;
    }
    const after = [x,y,gesture.tile,...(gesture.variant == null ? [] : [gesture.variant])];
    if (old?.[2] === after[2] && old?.[3] === after[3]) return;
    gesture.cells.set(key,after);
    gesture.changed = true;
  }

  function stroke(from,to) {
    let {x,y} = from;
    const dx = Math.abs(to.x-x), dy = -Math.abs(to.y-y);
    const sx = x<to.x ? 1 : -1, sy = y<to.y ? 1 : -1;
    let error = dx+dy;
    while (true) {
      stamp(x,y);
      if (x===to.x && y===to.y) break;
      const double = 2*error;
      if (double >= dy) { error += dy; x += sx; }
      if (double <= dx) { error += dx; y += sy; }
    }
  }

  function publishCells() {
    const layers = [...room.layers];
    layers[gesture.layer] = {...layers[gesture.layer],cells:[...gesture.cells.values()]};
    draft = {...room,layers};
  }

  function spriteAt(p) {
    const hit = (actor) => {
      const [w,h] = spriteSize(actor);
      return Math.abs(actor.x-p.px) <= w/2+2 && Math.abs(actor.y-p.py) <= h/2+2;
    };
    const hits = room.entities.map((actor,index)=>({actor,index})).filter(entry=>hit(entry.actor));
    const topDown = (room.view ?? (Math.abs(room.gravity ?? platformGravity) < .01 ? 'top_down' : 'platformer')) === 'top_down';
    hits.sort((a,b)=>(a.actor.layer ?? sprites[a.actor.sprite]?.layer ?? 0)-(b.actor.layer ?? sprites[b.actor.sprite]?.layer ?? 0)
      || ((room.ySort ?? topDown)
        ? a.actor.y+spriteSize(a.actor)[1]/2-b.actor.y-spriteSize(b.actor)[1]/2 : a.index-b.index));
    return hits.at(-1)?.index ?? -1;
  }

  function down(event) {
    if (busy || gesture || (event.button !== 0 && event.button !== 1)) return;
    const p = point(event);
    hover = p;
    if (tool === 'hand' || space || event.button === 1) {
      gesture = {kind:'hand',id:event.pointerId,x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};
    } else if (tool === 'pick') {
      const layers = orderedLayers(room).reverse();
      const match = layers.filter(({index})=>!hidden[index]).map(entry=>({
        ...entry, cell:entry.item.cells.find(([x,y])=>x===p.x && y===p.y),
      })).find(entry=>entry.cell);
      if (match) {
        chooseTile(match.cell[2],match.cell[3] == null ? 'auto' : String(match.cell[3]));
        onLayer(match.index);
      }
      return;
    } else if (tool === 'spawn') {
      placeInstance(spriteId,p);
      return;
    } else if (tool === 'select') {
      selectedEntity = spriteAt(p);
      if (selectedEntity < 0) return;
      const actor = room.entities[selectedEntity];
      gesture = {kind:'select',id:event.pointerId,index:selectedEntity,actor,start:p,changed:false};
      onSprites();
    } else {
      const layer = room.layers[layerIndex];
      if (!layer || hidden[layerIndex] || (tool !== 'erase' && !tileId)) return;
      gesture = {kind:tool,id:event.pointerId,start:p,previous:p,layer:layerIndex,tile:tileId,variant:brushVariant(),
        cells:new Map(layer.cells.map(cell=>[cell[1]*room.cols+cell[0],cell])),changed:false};
      if (tool !== 'rect') { stamp(p.x,p.y); publishCells(); }
    }
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function placeInstance(id,p) {
    if (!Object.hasOwn(sprites,id)) return;
    const {px,py} = placement(p);
    const name = newInstanceName(id,room.entities);
    const entities = [...room.entities,{sprite:id,name,x:px,y:py}];
    onEdit({...room,entities});
    selectedEntity = entities.length-1;
    onSprites();
  }

  function dragOver(event) {
    if (busy || !event.dataTransfer.types.includes(spriteDragType)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    hover = point(event);
  }

  function drop(event) {
    if (busy || !event.dataTransfer.types.includes(spriteDragType)) return;
    event.preventDefault();
    const id = event.dataTransfer.getData(spriteDragType);
    if (!Object.hasOwn(sprites,id)) return;
    spriteId = id;
    chooseTool('select');
    placeInstance(id,point(event));
    hover = null;
  }

  function move(event) {
    if (!canvas) return;
    const p = point(event);
    hover = p;
    if (!gesture || gesture.id !== event.pointerId) return;
    if (gesture.kind === 'hand') {
      viewport.scrollLeft = gesture.left + gesture.x - event.clientX;
      viewport.scrollTop = gesture.top + gesture.y - event.clientY;
    } else if (gesture.kind === 'select') {
      if (!gesture.dragged && Math.hypot(p.px-gesture.start.px,p.py-gesture.start.py)*scale<3) return;
      gesture.dragged = true;
      const x = Math.max(0,Math.min(width-.001,gesture.actor.x+p.px-gesture.start.px));
      const y = Math.max(0,Math.min(height-.001,gesture.actor.y+p.py-gesture.start.py));
      const next = placement({px:x,py:y,x:Math.floor(x/size),y:Math.floor(y/size)});
      gesture.changed = next.px !== gesture.actor.x || next.py !== gesture.actor.y;
      const entities = [...room.entities];
      entities[gesture.index] = {...gesture.actor,x:next.px,y:next.py};
      draft = {...room,entities};
    } else if (gesture.kind !== 'rect') {
      stroke(gesture.previous,p);
      gesture.previous = p;
      publishCells();
    }
  }

  function finish(event, commit) {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (commit && gesture.kind === 'rect') {
      const area = rectangle(gesture.start,point(event));
      for (let y=area.y;y<area.y+area.rows;y++) {
        for (let x=area.x;x<area.x+area.cols;x++) stamp(x,y);
      }
      publishCells();
    }
    if (commit && gesture.changed && draft) onEdit(draft);
    gesture = undefined;
    draft = null;
    draw();
  }

  async function changeZoom(next) {
    const centerX = (viewport.scrollLeft + viewport.clientWidth/2) / viewport.scrollWidth;
    const centerY = (viewport.scrollTop + viewport.clientHeight/2) / viewport.scrollHeight;
    zoom = next == null ? null : Math.min(6,Math.max(scale < .2 ? fit : .2,next));
    await tick();
    viewport.scrollLeft = centerX * viewport.scrollWidth - viewport.clientWidth/2;
    viewport.scrollTop = centerY * viewport.scrollHeight - viewport.clientHeight/2;
  }

  function keydown(event) {
    if (event.target.matches?.('input,select,textarea') || event.target.isContentEditable || busy || gesture) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Space' && !event.target.closest?.('button,a')) {
      space = true;
      event.preventDefault();
    }
    const match = tools.find(([,shortcut])=>shortcut.toLowerCase()===event.key.toLowerCase());
    if (match) chooseTool(match[0]);
    if (event.key === 'Escape' && tool === 'spawn') chooseTool('select');
    if (event.key === 'Delete' && room.entities[selectedEntity]) {
      onEdit({...room,entities:room.entities.filter((_,index)=>index!==selectedEntity)});
      selectedEntity = -1;
    }
  }

  function toggleLayer() {
    hidden = {...hidden,[layerIndex]:!hidden[layerIndex]};
  }
</script>

<svelte:window onkeydown={keydown} onkeyup={event=>{if (event.code==='Space') space=false;}} onblur={()=>space=false} />
<section class="card map">
  <header class="maphead">
    <div>
      <h2>{room.title ?? roomId}</h2>
      <small>{room.cols} × {room.rows} tiles</small>
    </div>
    <div class="row">
      <button class="icon-button" aria-label="Undo room edit" title="Undo (Ctrl+Z)" disabled={!canUndo || busy} onclick={onUndo}><Undo2 size={15}/></button>
      <button class="icon-button" aria-label="Redo room edit" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo || busy} onclick={onRedo}><Redo2 size={15}/></button>
      <a class="button" title="Play the saved room" aria-disabled={busy} href={busy ? undefined : `./player.html?room=${encodeURIComponent(roomId)}`} target="_blank" rel="noopener" onclick={onPlay}><Play size={14}/>Play room</a>
    </div>
  </header>
  <div class="tools row" aria-label="Map tools">
    {#each tools as [id,shortcut,label]}
      {@const Icon=icons[id]}
      <button class:selected={tool===id} aria-pressed={tool===id} title={`${label} (${shortcut})`} onclick={()=>chooseTool(id)}><Icon size={15}/>{label}</button>
    {/each}
  </div>
  <div class="view-tools row">
    <div class="row">
      <button aria-pressed={grid} onclick={()=>grid=!grid}>Grid</button>
      <button aria-pressed={collisionView} onclick={()=>collisionView=!collisionView}>Collision</button>
      {#if spriteTool}<button aria-pressed={snap} onclick={()=>snap=!snap}>Snap</button>{/if}
    </div>
    <div class="row">
      <button class="icon-button" aria-label="Zoom out" onclick={()=>changeZoom(scale/1.25)}><ZoomOut size={15}/></button>
      <button title="Fit room to view" onclick={()=>changeZoom(null)}>{zoom == null ? 'Fit' : `${Math.round(scale*100)}%`}</button>
      <button class="icon-button" aria-label="Zoom in" onclick={()=>changeZoom(scale*1.25)}><ZoomIn size={15}/></button>
    </div>
  </div>
  <div class="viewport" bind:this={viewport} bind:clientWidth={viewportWidth} bind:clientHeight={viewportHeight}>
    <div class="canvas-space">
      <canvas aria-label="Room map" class:hand={tool==='hand' || space} class:select={tool==='pick' || tool==='select'}
        bind:this={canvas} {width} {height} style:width={`${width*scale}px`} style:height={`${height*scale}px`}
        ondragover={dragOver} ondrop={drop}
        onpointerdown={down} onpointermove={move} onpointerup={event=>finish(event,true)}
        onpointercancel={event=>finish(event,false)} onlostpointercapture={event=>finish(event,false)}
        onpointerleave={()=>{if(!gesture)hover=null;}}></canvas>
    </div>
  </div>
  <div class="map-status">
    <span>{help}</span>
    {#if hover}<span>Col {hover.x+1}, row {hover.y+1}</span>{/if}
  </div>
  {#if collisionView}<div class="legend"><span class="solid">Solid</span><span class="one-way">One-way</span><span class="fluid">Fluid</span><span class="ladder">Ladder</span><span class="dynamic">Moving</span><span class="breakable">Breakable</span><span class="sensor">Sensor</span></div>{/if}
  {#if spriteTool}
    <div class="palette">
      {#if tool==='spawn'}
        <div class="palette-head row"><strong>Sprites</strong><input type="search" aria-label="Find a sprite" placeholder="Find a sprite" bind:value={spriteFilter}></div>
        <div class="tile-list">
          <PagedList items={Object.keys(sprites)} query={spriteFilter} label="sprite choices" size={12}>{#snippet children(id)}
            <button class="swatch" class:selected={spriteId===id} aria-pressed={spriteId===id}
              aria-label={`Use ${id} for placement`} onclick={()=>spriteId=id}>
              {#if spriteArt[id]}<img src={spriteArt[id]} alt="">{:else}<SquareUserRound size={22}/>{/if}
              <span>{id}</span>
            </button>
          {/snippet}</PagedList>
        </div>
      {:else if room.entities[selectedEntity]}
        <span>{room.entities[selectedEntity].name ?? room.entities[selectedEntity].sprite} selected</span>
      {:else}<span>Select an instance on the map.</span>{/if}
    </div>
  {:else}
    <div class="palette">
      <div class="palette-head row">
        <strong>Tiles</strong>
        <input type="search" aria-label="Find a tile" placeholder="Find a tile" bind:value={query}>
        <button onclick={onAssets}>Manage tiles</button>
      </div>
      {#if tileChoices.length}
        <div class="tile-list">
          <PagedList items={tileChoices} query={query} label="tile choices" size={12}>{#snippet children(id)}
            <button class="swatch" class:selected={tileId===id} aria-pressed={tileId===id} onclick={()=>chooseTile(id)}>
              {#if tileArt[id]?.[0]}<img src={tileArt[id][0]} alt="">{:else}<Layers3 size={22}/>{/if}
              <span>{id}</span>
            </button>
          {/snippet}</PagedList>
        </div>
      {:else}<p class="muted">{query ? 'No tiles match the search.' : 'Add a tile in Assets.'}</p>{/if}
      <div class="brush-options row">
        {#if room.layers[layerIndex]}
          <label>Layer <select aria-label="Layer" value={layerIndex} onchange={event=>onLayer(Number(event.currentTarget.value))}>
            {#each orderedLayers(room).reverse() as {item,index}}<option value={index}>{item.name}</option>{/each}
          </select></label>
          <button aria-pressed={Boolean(hidden[layerIndex])} onclick={toggleLayer}>{hidden[layerIndex] ? 'Show layer' : 'Hide layer'}</button>
          {#if hidden[layerIndex]}<small>Show the layer to paint it.</small>{/if}
        {/if}
        {#if tileArt[tileId]?.length > 1}
          <label>Variant <select aria-label="Variant" bind:value={variant}><option value="auto">Automatic</option>
            {#each tileArt[tileId] as _, index}<option value={String(index)}>{index+1}</option>{/each}
          </select></label>
        {/if}
      </div>
    </div>
  {/if}
</section>

<style>
  .map{overflow:hidden;}
  .maphead,.view-tools,.map-status{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.5rem;}
  .maphead{padding:.66rem .75rem;}
  h2{font-size:1rem;}
  .tools,.view-tools{padding:.4rem .7rem;border-top:1px solid var(--line);}
  .tools button.selected,.view-tools button[aria-pressed=true]{background:#313244;border-color:#b4befe;color:#cba6f7;}
  .viewport{height:clamp(245px,46vh,610px);overflow:auto;background:var(--well);overscroll-behavior:contain;border-block:1px solid var(--line);}
  .canvas-space{display:grid;place-items:center;box-sizing:border-box;width:max-content;min-width:100%;min-height:100%;padding:16px;}
  canvas{touch-action:none;cursor:crosshair;box-shadow:0 0 0 1px #514958,0 8px 25px #0007;}
  canvas.hand{cursor:grab;}
  canvas.select{cursor:pointer;}
  .map-status{color:var(--muted);padding:.45rem .7rem;font-size:.75rem;}
  .legend{display:flex;flex-wrap:wrap;gap:.55rem .8rem;padding:.25rem .7rem .45rem;font-size:.72rem;}
  .legend span::before{content:'';display:inline-block;width:.55rem;height:.55rem;margin-right:.25rem;background:currentColor;}
  .solid{color:#ffc875;} .one-way{color:#97d2f0;} .fluid{color:#78d3cc;} .ladder{color:#a8d4aa;}
  .dynamic{color:#f7a270;} .breakable{color:#f3a197;} .sensor{color:#c8a6f0;}
  .palette{padding:.62rem .7rem;border-top:1px solid var(--line);font-size:.8rem;}
  .palette-head input{width:min(11rem,40%);margin-left:auto;}
  .tile-list{display:flex;gap:.4rem;overflow:auto;margin:.5rem 0;padding:.2rem 0;}
  .tile-list button{display:grid;place-items:center;gap:.25rem;min-width:58px;max-width:110px;overflow-wrap:anywhere;padding:.26rem .4rem;font-size:.74rem;}
  .tile-list img{width:25px;height:25px;image-rendering:pixelated;object-fit:contain;}
  .brush-options{margin-top:.4rem;}
  label{display:flex;gap:.35rem;align-items:center;color:var(--muted);}
  select{width:auto;padding:.3rem .35rem;max-width:10rem;}
  @media(max-width:560px){.viewport{height:clamp(225px,42vh,390px);}.tools{gap:.32rem;}}
</style>
