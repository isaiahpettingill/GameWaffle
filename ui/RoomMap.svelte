<script>
  import PagedList from './PagedList.svelte';
  let spriteFilter=$state('');
  import {Layers3,SquareUserRound,Brush,Eraser,Square,Pipette,CopyPlus,MousePointer2,Hand,Undo2,Redo2,Play,ZoomIn,ZoomOut,Grid3x3,ScanLine,Magnet} from '@lucide/svelte';
  const icons={paint:Brush,erase:Eraser,rect:Square,pick:Pipette,spawn:CopyPlus,select:MousePointer2,hand:Hand};
  import { platformGravity, roomBorder } from '../src/schema.mjs';
  import { onDestroy, tick } from 'svelte';
  import {draftFile} from './recovery.js';
  import {growRoom} from '../src/room-geometry.mjs';
  import { newInstanceName, spriteDragType } from '../src/instances.mjs';

  let {
    room, roomId, projectPath, size, tiles, sprites, tileArt, spriteArt, previewModes, previewImage: image, backgroundUrl, layerIndex,
    selectedEntity = $bindable(-1), tileId = $bindable(''), spriteId = $bindable(''), tool = $bindable('select'),placeAs=$bindable(''),
    undoLabel, redoLabel, onUndo, onRedo, onEdit, onLayer, onSprites, onAssets, onPlay, busy, previewOnly=false,
  } = $props();

  const tools = [
    ['paint', 'B', 'Brush'], ['erase', 'E', 'Eraser'], ['rect', 'R', 'Rectangle'],
    ['pick', 'I', 'Pick tile'], ['spawn', 'P', 'Place entity'], ['select', 'V', 'Select instance'],
    ['hand', 'H', 'Pan'],
  ];
  const collision = {
    static: '#ffc875', one_way: '#97d2f0', ladder: '#a8d4aa', fluid: '#78d3cc',
    dynamic: '#f7a270', kinematic: '#f7a270', breakable: '#f3a197', sensor: '#c8a6f0',
  };
  let variant = $state('auto'), query = $state('');
  let grid = $state(true), collisionView = $state(false), snap = $state(true);
  let zoom = $state(null), viewportWidth = $state(1), viewportHeight = $state(1);
  let viewport=$state(), canvas = $state(), overlay=$state(), draft = $state.raw(null), hover = $state.raw(null), gesture;
  let space = $state(false), hidden = $state({});
  let shift=$state.raw({left:0,top:0}), rightPaint=false, pendingOrigin;
  let viewReady=false,cameraTimer,lastCamera;
  const cameraKey=$derived('gamewaffle.room-view.'+JSON.stringify([projectPath,roomId]));
  const cameraStore=$derived(draftFile('room-view:'+roomId,()=>{}));
  let storedCamera;
  const maxTiles=$derived(Math.floor(4096/size));
  let background = $state.raw(null);
  const touches=new Map();
  let touchPan, touchingPan=false, previousMode, previousEntity, centeredMode, alignment=0;
  const panX=$derived(previewOnly?16:Math.max(64,Math.ceil(viewportWidth*.72)));
  const panY=$derived(previewOnly?16:Math.max(64,Math.ceil(viewportHeight*.72)));

  const view = $derived(draft ?? room);
  const width = $derived(view.cols * size);
  const height = $derived(view.rows * size);
  const fit = $derived(Math.min(2, Math.max(.02, Math.min(
    (viewportWidth - 32) / (room.cols*size), (viewportHeight - 32) / (room.rows*size),
  ))));
  const scale = $derived(zoom ?? fit);
  const spriteTool = $derived(tool === 'spawn' || tool === 'select');
  const tilePainter = $derived(tool==='paint'||tool==='rect');
  const paintContext=$derived(!previewOnly&&(tilePainter||tool==='erase'));
  const outsidePreview=$derived(tilePainter&&tileId&&hover&&
    (hover.x<0||hover.y<0||hover.x>=view.cols||hover.y>=view.rows));
  const tileDragType = 'application/x-gamewaffle-tile';
  const tileIds=$derived(Object.keys(tiles));
  const tileChoices=$derived(tileIds.filter(id=>id.toLowerCase().includes(query.trim().toLowerCase())));
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

  function drawArtwork() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = view.background ?? '#171829';
    ctx.fillRect(0,0,width,height);
    if (background?.complete && background.naturalWidth)ctx.drawImage(background,0,0,width,height);
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

    if (previewOnly) return;
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
  }

  function drawOverlay() {
    if(!overlay || previewOnly)return;
    const ctx=overlay.getContext('2d');
    ctx.clearRect(0,0,width,height);
    ctx.imageSmoothingEnabled=false;
    for (const [index,actor] of view.entities.entries()) {
      const [w,h] = spriteSize(actor);
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
      ? rectangle(displayCell(gesture.start),hover) : rectangle(hover,hover);
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
    if(!backgroundUrl){background=null;return;}
    let cancelled=false;
    const next=new Image();
    next.src=backgroundUrl;
    next.decode().then(()=>{if(!cancelled)background=next;}).catch(()=>{});
    return ()=>{cancelled=true;};
  });
  function draw(){drawArtwork();drawOverlay();}
  $effect(()=>{drawArtwork();});
  $effect(()=>{drawOverlay();});

  function centerRoom() {
    if(!canvas||!viewport)return;
    const roomBox=canvas.getBoundingClientRect(), viewBox=viewport.getBoundingClientRect();
    viewport.scrollLeft+=roomBox.left+roomBox.width/2-viewBox.left-viewport.clientWidth/2;
    viewport.scrollTop+=roomBox.top+roomBox.height/2-viewBox.top-viewport.clientHeight/2;
  }

  function keepRoomVisible(){
    if(!viewReady||gesture||!viewport?.clientWidth||!viewport.clientHeight||!canvas?.clientWidth)return;
    const box=canvas.getBoundingClientRect(), viewportBox=viewport.getBoundingClientRect();
    if(box.right<=viewportBox.left||box.left>=viewportBox.right||box.bottom<=viewportBox.top||box.top>=viewportBox.bottom){
      centerRoom();
      rememberCamera();
    }
  }

  $effect(()=>{
    if(!viewport||!canvas||viewportWidth<=1||viewportHeight<=1||centeredMode===previewOnly)return;
    centeredMode=previewOnly;
    restoreCamera(previewOnly);
  });
  $effect(()=>{
    if(!viewport||!canvas||viewportWidth<=1||viewportHeight<=1||!width||!height)return;
    let cancelled=false;
    requestAnimationFrame(()=>{if(!cancelled)keepRoomVisible();});
    return ()=>{cancelled=true;};
  });

  function cameraCenter(){
    const box=viewport.getBoundingClientRect();
    return [box.left+viewport.clientWidth/2,box.top+viewport.clientHeight/2];
  }

  function saveCamera(){
    clearTimeout(cameraTimer);
    if(!lastCamera)return;
    const encoded=JSON.stringify(lastCamera);
    if(encoded===storedCamera)return;
    storedCamera=encoded;
    try{localStorage.setItem(cameraKey,encoded);}catch{}
    cameraStore.write(lastCamera);
  }
  onDestroy(saveCamera);

  function rememberCamera(){
    if(!viewReady||previewOnly||!viewport||!canvas?.clientWidth||gesture?.growth)return;
    lastCamera={zoom,center:roomPoint(...cameraCenter())};
    clearTimeout(cameraTimer);
    cameraTimer=setTimeout(saveCamera,150);
  }

  async function restoreCamera(preview){
    const current=++alignment;
    viewReady=false;
    let saved;
    if(!preview){
      try{saved=lastCamera??JSON.parse(localStorage.getItem(cameraKey))??await cameraStore.read();}catch{}
    }
    if(current!==alignment||!viewport||!canvas)return;
    const validZoom=saved?.zoom==null||(Number.isFinite(saved.zoom)&&saved.zoom>=.02&&saved.zoom<=6);
    zoom=validZoom?saved?.zoom??null:null;
    await tick();
    if(current!==alignment||!viewport||!canvas)return;
    if(validZoom&&saved?.center?.length===2&&saved.center.every(Number.isFinite)){
      const [x,y]=cameraCenter(), box=canvas.getBoundingClientRect();
      viewport.scrollLeft+=box.left+saved.center[0]*box.width/canvas.width-x;
      viewport.scrollTop+=box.top+saved.center[1]*box.height/canvas.height-y;
    }else centerRoom();
    viewReady=true;
    keepRoomVisible();
  }

  function paintingPoint(event){
    const box=canvas.getBoundingClientRect();
    const left=Number(canvas.dataset.left),top=Number(canvas.dataset.top);
    const px=(event.clientX-box.left)*canvas.width/box.width-left*size;
    const py=(event.clientY-box.top)*canvas.height/box.height-top*size;
    return {x:Math.floor(px/size),y:Math.floor(py/size)};
  }

  function keepPaintOrigin(left,top){
    if(pendingOrigin){
      Object.assign(pendingOrigin,{left,top});
      return;
    }
    const box=canvas.getBoundingClientRect();
    const origin={x:box.left+Number(canvas.dataset.left)*size*box.width/canvas.width,
      y:box.top+Number(canvas.dataset.top)*size*box.height/canvas.height,left,top};
    pendingOrigin=origin;
    tick().then(()=>{
      pendingOrigin=null;
      if(!canvas?.clientWidth||!viewport)return;
      const next=canvas.getBoundingClientRect();
      viewport.scrollLeft+=next.left+origin.left*size*next.width/canvas.width-origin.x;
      viewport.scrollTop+=next.top+origin.top*size*next.height/canvas.height-origin.y;
      rememberCamera();
    });
  }

  function growTo(point){
    const add=gesture.growth;
    const x=Math.max(room.cols+add.right-maxTiles,Math.min(maxTiles-add.left-1,point.x));
    const y=Math.max(room.rows+add.bottom-maxTiles,Math.min(maxTiles-add.top-1,point.y));
    const before={...add};
    add.left=Math.max(add.left,-x);
    add.top=Math.max(add.top,-y);
    add.right=Math.max(add.right,x-room.cols+1);
    add.bottom=Math.max(add.bottom,y-room.rows+1);
    if(Object.keys(add).some(edge=>add[edge]!==before[edge])){
      zoom??=scale;
      if(add.left!==before.left||add.top!==before.top)keepPaintOrigin(add.left,add.top);
    }
    return {x,y};
  }

  const cellKey=(x,y)=>x+','+y;
  function displayCell(p){
    return {...p,x:p.x+shift.left,y:p.y+shift.top};
  }
  function clearDraft(commit){
    if(!commit&&(shift.left||shift.top))keepPaintOrigin(0,0);
    if(!commit&&gesture?.growth)zoom=gesture.originalZoom;
    shift={left:0,top:0};
    gesture=undefined;
    draft=null;
  }
  function contextMenu(event){
    if(rightPaint||(paintContext&&viewport?.contains(event.target)))event.preventDefault();
    rightPaint=false;
  }

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
    const key = cellKey(x,y);
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
        if(gesture.growth){
      shift={left:gesture.growth.left,top:gesture.growth.top};
      draft=growRoom(room,size,gesture.growth,layers);
    }else draft = {...room,layers};
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

  function touchCenter() {
    const [[x,y],[x2,y2]]=[...touches.values()];
    return [(x+x2)/2,(y+y2)/2,Math.max(1,Math.hypot(x-x2,y-y2))];
  }

  function startPointer(event) {
    if(previewOnly||busy)return;
    if(event.pointerType==='touch'){
      if(!touches.size){previousMode=tool;previousEntity=selectedEntity;}
      touches.set(event.pointerId,[event.clientX,event.clientY]);
      viewport.setPointerCapture(event.pointerId);
      if(touches.size>=2){
        if(!touchingPan){
          clearDraft(false);
          hover=null;
          tool=previousMode;
          selectedEntity=previousEntity;
        }
        touchingPan=true;
        const [x,y,distance]=touchCenter();
        touchPan={distance,scale,anchor:roomPoint(x,y)};
        event.preventDefault();
        return;
      }
      if(touchingPan)return;
    }
    down(event);
  }

  function movePointer(event) {
    if(previewOnly)return;
    if(touches.has(event.pointerId))touches.set(event.pointerId,[event.clientX,event.clientY]);
    if(touchingPan){
      if(touchPan&&touches.size>=2){
        const [x,y,distance]=touchCenter();
        zoomAt(touchPan.scale*distance/touchPan.distance,x,y,touchPan.anchor);
      }
      return;
    }
    move(event);
  }

  function endPointer(event,commit) {
    const removed=touches.delete(event.pointerId);
    if(touchingPan&&removed){
      if(touches.size>=2){
        const [x,y,distance]=touchCenter();
        touchPan={distance,scale,anchor:roomPoint(x,y)};
      }else touchPan=undefined;
      if(!touches.size)touchingPan=false;
      return;
    }
    finish(event,commit);
  }

  function down(event) {
    const erase = event.button === 2 && paintContext;
    canvas.focus({preventScroll:true});
    if (busy || gesture || (event.button !== 0 && event.button !== 1 && !erase)) return;
    const pan=tool==='hand'||space||event.button===1;
    const grow=event.button===0&&!pan&&tilePainter;
    if(!pan&&event.target!==canvas&&!(grow&&event.target.closest?.('.canvas-space')))return;
    let p=point(event);
    hover = pan?null:p;
    if (pan) {
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
    } else if (spriteTool) {
      selectedEntity = spriteAt(p);
      if (selectedEntity >= 0) {
        const actor = room.entities[selectedEntity];
        chooseTool('select');
        gesture = {kind:'select',id:event.pointerId,index:selectedEntity,actor,start:p,changed:false};
        onSprites();
      } else if (tool === 'spawn') {
        gesture = {kind:'place',id:event.pointerId,start:p};
      } else return;
    } else {
      const layer = room.layers[layerIndex];
      const kind = erase ? 'erase' : tool;
      if (!layer || hidden[layerIndex] || (kind !== 'erase' && !tileId)) return;
      gesture = {kind,id:event.pointerId,start:p,previous:p,layer:layerIndex,tile:tileId,variant:brushVariant(),
        cells:new Map(layer.cells.map(cell=>[cellKey(cell[0],cell[1]),cell])),changed:false};
      if(grow){
        gesture.growth={left:0,top:0,right:0,bottom:0};
        gesture.originalZoom=zoom;
        p=growTo(paintingPoint(event));
        gesture.start=gesture.previous=p;
      }
      if(kind!=='rect')stamp(p.x,p.y);
      publishCells();
      if(grow)hover=displayCell(p);
    }
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function placeInstance(id,p) {
    if (!Object.hasOwn(sprites,id)) return;
    const {px,py} = placement(p);
    const name = newInstanceName(id,room.entities);
    const entity={sprite:id,name,x:px,y:py};
    if(placeAs!==''){
      if(room.entities.some(other=>other.player===Number(placeAs)))return;
      entity.player=Number(placeAs);
      placeAs='';tool='select';
    }
    const entities = [...room.entities,entity];
    onEdit({...room,entities},'placement of '+(sprites[id].title??id));
    selectedEntity = entities.length-1;
    onSprites();
  }

  function acceptedDrag(event) {
    if (busy || previewOnly) return;
    if (spriteTool && event.dataTransfer.types.includes(spriteDragType)) return spriteDragType;
    if (tilePainter && room.layers[layerIndex] && !hidden[layerIndex] && event.dataTransfer.types.includes(tileDragType)) return tileDragType;
  }

  function dragOver(event) {
    if (!acceptedDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    hover = point(event);
  }

  function drop(event) {
    const type=acceptedDrag(event);
    if (!type) return;
    event.preventDefault();
    const id=event.dataTransfer.getData(type), p=point(event);
    if (type===spriteDragType && Object.hasOwn(sprites,id)) {
      spriteId = id;
      chooseTool('select');
      placeInstance(id,p);
    } else if (type===tileDragType && Object.hasOwn(tiles,id)) {
      chooseTile(id);
      const layers=[...room.layers], layer=layers[layerIndex];
      layers[layerIndex]={...layer,cells:[...layer.cells.filter(([x,y])=>x!==p.x||y!==p.y),[p.x,p.y,id]]};
      onEdit({...room,layers},'tile paint in '+(room.title??roomId));
    }
    hover = null;
  }

  function dragTile(event,id) {
    event.dataTransfer.setData(tileDragType,id);
    event.dataTransfer.effectAllowed='copy';
  }

  function move(event) {
    if (!canvas) return;
    const active=gesture?.id===event.pointerId;
    if(active&&gesture.kind==='hand'){
      viewport.scrollLeft=gesture.left+gesture.x-event.clientX;
      viewport.scrollTop=gesture.top+gesture.y-event.clientY;
      return;
    }
    if(active&&gesture.growth){
      const p=growTo(paintingPoint(event));
      if(gesture.kind!=='rect')stroke(gesture.previous,p);
      gesture.previous=p;
      publishCells();
      hover=displayCell(p);
      return;
    }
    if(!active&&event.target!==canvas){
      if(tilePainter&&tileId&&event.target.closest?.('.canvas-space')){
        const p=paintingPoint(event);
        hover=displayCell(p);
      }else hover=null;
      return;
    }
    const p=point(event);
    hover=p;
    if(!active)return;
    if (gesture.kind === 'place') {
      gesture.dragged ||= Math.hypot(p.px-gesture.start.px,p.py-gesture.start.py)*scale>=3;
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
    if (commit && gesture.kind === 'place' && !gesture.dragged)placeInstance(spriteId,gesture.start);
    if (commit && gesture.kind === 'rect') {
      const area = rectangle(gesture.start,gesture.growth?growTo(paintingPoint(event)):point(event));
      for (let y=area.y;y<area.y+area.rows;y++) {
        for (let x=area.x;x<area.x+area.cols;x++) stamp(x,y);
      }
      publishCells();
    }
    if (commit && gesture.changed && draft) {
      const label=gesture.kind==='select'?'entity movement in ':'tile paint in ';
      onEdit(draft,label+(room.title??roomId),gesture.growth);
    }
    clearDraft(commit);
    tick().then(rememberCamera);
    draw();
  }

  function roomPoint(x,y){
    const box=canvas.getBoundingClientRect();
    return [(x-box.left)*width/box.width,(y-box.top)*height/box.height];
  }

  async function zoomAt(next,x,y,anchor=roomPoint(x,y)){
    if(!Number.isFinite(next)||!anchor.every(Number.isFinite))return;
    const current=++alignment;
    zoom=Math.min(6,Math.max(Math.min(fit,.2),next));
    await tick();
    if(current!==alignment||!viewport||!canvas)return;
    const box=canvas.getBoundingClientRect();
    viewport.scrollLeft+=box.left+anchor[0]*box.width/width-x;
    viewport.scrollTop+=box.top+anchor[1]*box.height/height-y;
    viewReady=true;
    rememberCamera();
  }

  async function changeZoom(next){
    if(next==null){
      alignment++;
      zoom=null;
      await tick();
      centerRoom();rememberCamera();
      return;
    }
    const box=viewport.getBoundingClientRect();
    await zoomAt(next,box.left+viewport.clientWidth/2,box.top+viewport.clientHeight/2);
  }

  function wheel(event){
    const vertical=Math.abs(event.deltaY);
    // Discrete wheel steps zoom. Fine-grained touchpad scrolling pans.
    const discrete=event.deltaMode!==0 || (vertical>=100 && (vertical%100===0||vertical%120===0));
    const pinch=event.ctrlKey||event.metaKey;
    if(!vertical || (!pinch && (event.deltaX || event.shiftKey || space || !discrete)))return;
    event.preventDefault();
    const amount=event.deltaMode===1?event.deltaY*32:event.deltaY;
    zoomAt(scale*Math.exp(-Math.max(-240,Math.min(240,amount))*(pinch?.007:.0015)),event.clientX,event.clientY);
  }

  $effect(()=>{
    if(!viewport||previewOnly)return;
    const node=viewport;
    node.addEventListener('wheel',wheel,{passive:false});
    return ()=>node.removeEventListener('wheel',wheel);
  });

  function keydown(event) {
    if(previewOnly||!event.target.closest?.('.map-pane')||event.target.matches?.('input,select,textarea')||event.target.isContentEditable||busy)return;
    if(event.ctrlKey||event.metaKey||event.altKey)return;
    if(event.key==='Escape'&&(paintContext||tool==='pick'||tool==='spawn')){
      const pointer=gesture?.id;
      clearDraft(false);
      if(pointer!=null&&viewport?.hasPointerCapture(pointer))viewport.releasePointerCapture(pointer);
      hover=null;
      chooseTool('select');
      event.preventDefault();
      return;
    }
    if(gesture)return;
    if (event.code === 'Space' && !event.target.closest?.('button,a')) {
      space = true;
      event.preventDefault();
    }
    const match = tools.find(([,shortcut])=>shortcut.toLowerCase()===event.key.toLowerCase());
    if (match) chooseTool(match[0]);
    if (event.key === 'Delete' && room.entities[selectedEntity]) {
      onEdit({...room,entities:room.entities.filter((_,index)=>index!==selectedEntity)},'entity removal in '+(room.title??roomId));
      selectedEntity = -1;
    }
  }

  function toggleLayer() {
    hidden = {...hidden,[layerIndex]:!hidden[layerIndex]};
  }
</script>

<svelte:window onpagehide={saveCamera} onpointerdown={event=>{rightPaint=event.button===2&&paintContext&&viewport?.contains(event.target);}}
  oncontextmenu={contextMenu} onkeydown={keydown} onkeyup={event=>{if (event.code==='Space') space=false;}} onblur={()=>space=false} />
<section class="card map" class:preview={previewOnly}>
  {#if !previewOnly}<header class="maphead">
    <div>
      <h2 title={room.title??roomId}>{room.title??roomId}</h2>
      <small title="Room size in tiles">{room.cols} × {room.rows}</small>
    </div>
    <div class="row">
      <button class="icon-button" aria-label={undoLabel?'Undo '+undoLabel:'Undo'} title={undoLabel?'Undo '+undoLabel+' (Ctrl+Z)':'Undo'} disabled={!undoLabel || busy} onclick={onUndo}><Undo2 size={15}/></button>
      <button class="icon-button" aria-label={redoLabel?'Redo '+redoLabel:'Redo'} title={redoLabel?'Redo '+redoLabel+' (Ctrl+Shift+Z)':'Redo'} disabled={!redoLabel || busy} onclick={onRedo}><Redo2 size={15}/></button>
      {#if onPlay}<a class="button room-play" aria-label="Play room" title="Play the saved room" aria-disabled={busy}
        href={busy?undefined:`./player.html?playtest=1&room=${encodeURIComponent(roomId)}`} onclick={onPlay}><Play size={14}/><span>Play room</span></a>{/if}
    </div>
  </header>
  <div class="map-toolbar">
  <div class="tools row" role="group" aria-label="Map tools">
    {#each tools as [id,shortcut,label]}
      {@const Icon=icons[id]}
      <button class="icon-button" class:selected={tool===id} aria-pressed={tool===id} aria-label={label}
        title={`${label} (${shortcut})`} onclick={()=>chooseTool(id)}><Icon size={15}/></button>
    {/each}
  </div>
  <div class="view-tools row">
    <div class="row">
      <button class="icon-button" aria-label="Grid" title="Grid" aria-pressed={grid} onclick={()=>grid=!grid}><Grid3x3/></button>
      <button class="icon-button" aria-label="Collision" title="Collision" aria-pressed={collisionView} onclick={()=>collisionView=!collisionView}><ScanLine/></button>
      {#if spriteTool}<button class="icon-button" aria-label="Snap" title="Snap to grid" aria-pressed={snap} onclick={()=>snap=!snap}><Magnet/></button>{/if}
    </div>
    <div class="row">
      <button class="icon-button" aria-label="Zoom out" onclick={()=>changeZoom(scale/1.25)}><ZoomOut size={15}/></button>
      <button title="Fit and center room" onclick={()=>changeZoom(null)}>{zoom == null ? 'Fit' : `${Math.round(scale*100)}%`}</button>
      <button class="icon-button" aria-label="Zoom in" onclick={()=>changeZoom(scale*1.25)}><ZoomIn size={15}/></button>
    </div>
  </div>
  </div>
  {/if}
  <div class="viewport" role={previewOnly?'img':'application'} aria-label={previewOnly?'Preview of '+(room.title??roomId):'Room canvas'}
    bind:this={viewport} bind:clientWidth={viewportWidth} bind:clientHeight={viewportHeight}
    onpointerdown={startPointer} onpointermove={movePointer} onpointerup={event=>endPointer(event,true)}
    onpointercancel={event=>endPointer(event,false)} onlostpointercapture={event=>endPointer(event,false)}
    onscroll={rememberCamera}
    onauxclick={event=>{if(event.button===1)event.preventDefault();}} onpointerleave={()=>{if(!gesture)hover=null;}}>
    <div class="canvas-space" class:outside-grid={outsidePreview&&grid}
      style:--cell={size*scale+'px'} style:--pan-x={panX+'px'} style:--pan-y={panY+'px'}
      style:padding-inline={panX+'px'} style:padding-block={panY+'px'}>
      <div class="canvas-layer">
      <canvas tabindex={previewOnly?undefined:0} inert={previewOnly} aria-label="Room map" class:hand={tool==='hand' || space} class:select={tool==='pick' || tool==='select'}
        bind:this={canvas} {width} {height} data-left={shift.left} data-top={shift.top} style:width={`${width*scale}px`} style:height={`${height*scale}px`}
        ondragover={dragOver} ondrop={drop}></canvas>
      {#if !previewOnly}
        {#if grid && size*scale>=5}<div class="tile-grid" aria-hidden="true"></div>{/if}
        <canvas aria-hidden="true" class="overlay" bind:this={overlay} {width} {height}></canvas>
        {#if outsidePreview}
          {@const thumb=tileArt[tileId]?.[brushVariant()??0]}
          <div class="edge-preview" aria-hidden="true" style:left={hover.x*size*scale+'px'} style:top={hover.y*size*scale+'px'}
            style:background-image={thumb?`url("${thumb}")`:null}></div>
        {/if}
      {/if}
      </div>
    </div>
  </div>
  {#if !previewOnly}
  {#if collisionView}<div class="legend"><span class="solid">Solid</span><span class="one-way">One-way</span><span class="fluid">Fluid</span><span class="ladder">Ladder</span><span class="dynamic">Moving</span><span class="breakable">Breakable</span><span class="sensor">Sensor</span></div>{/if}
  {#if spriteTool}
    {#if tool==='spawn'}
      <div class="palette">
        <strong>Entity type</strong><div class="field-row"><label>Place as<select bind:value={placeAs}><option value="">No player</option>{#each [0,1,2,3] as slot}<option disabled={room.entities.some(e=>e.player===slot)} value={String(slot)}>Player {slot+1}</option>{/each}</select></label><label>Find an entity<input type="search" bind:value={spriteFilter}></label></div>
        <div class="tile-list">
          <PagedList items={Object.keys(sprites)} query={spriteFilter} label="sprite choices" size={12}>{#snippet children(id)}
            <button class="swatch" class:selected={spriteId===id} aria-pressed={spriteId===id}
              aria-label={`Use ${id} for placement`} onclick={()=>spriteId=id}>
              {#if spriteArt[id]}<img src={spriteArt[id]} alt="" draggable="false">{:else}<SquareUserRound size={22}/>{/if}
              <span>{id}</span>
            </button>
          {/snippet}</PagedList>
        </div>
      </div>
    {:else if room.entities[selectedEntity]}
      {@const instance=room.entities[selectedEntity]}
      <div class="palette">
        <strong>{instance.name??instance.sprite}</strong>
        <button onclick={()=>onSprites(true)}>Inspect entity</button>
      </div>
    {/if}
  {:else}
    <div class="palette">
      <div class="palette-head row">
        <strong>Tiles</strong>
        {#if tileIds.length}<input type="search" aria-label="Find a tile" placeholder="Find a tile" bind:value={query}>{/if}
        <button onclick={onAssets}>Manage tiles</button>
      </div>
      {#if tileChoices.length}
        <div class="tile-list">
          <PagedList items={tileChoices} query={query} label="tile choices" size={12}>{#snippet children(id)}
            <button class="swatch" class:selected={tileId===id} aria-pressed={tileId===id} draggable={tilePainter} ondragstart={event=>dragTile(event,id)} onclick={()=>chooseTile(id)}>
              {#if tileArt[id]?.[0]}<img src={tileArt[id][0]} alt="" draggable="false">{:else}<Layers3 size={22}/>{/if}
              <span>{id}</span>
            </button>
          {/snippet}</PagedList>
        </div>
      {:else if query}<p class="muted">No tiles match the search.</p>{/if}
      {#if tileIds.length}<div class="brush-options field-row">
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
      </div>{/if}
    </div>
  {/if}{/if}
</section>

<style>
  .map{display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto;container-type:inline-size}
  .preview .viewport{border-block:0}
  .maphead,.view-tools{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.5rem;}
  .maphead{flex:none;flex-wrap:nowrap;padding:.35rem .45rem}
  .maphead>div:first-child{display:flex;flex:1;align-items:baseline;gap:.4rem;min-width:0}
  .maphead>div:first-child small{white-space:nowrap}
  .maphead .row{flex:none;gap:.25rem}
  h2{font-size:.9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .map-toolbar{display:flex;align-items:center;justify-content:space-between;gap:.3rem;flex-wrap:wrap;
    flex:none;padding:.25rem .45rem;border-top:1px solid var(--line)}
  .map-toolbar :is(.row,.tools,.view-tools){gap:.2rem}
  .tools button.selected,.view-tools button[aria-pressed=true]{background:#313244;border-color:#b4befe;color:#cba6f7;}
  .viewport{flex:1 1 0;min-height:4rem;overflow:auto;background:var(--well);overscroll-behavior:contain;touch-action:none;overflow-anchor:none;border-block:1px solid var(--line);}
  .canvas-space{display:grid;place-items:center;box-sizing:border-box;width:max-content;min-width:100%;min-height:100%;padding:16px;}
  canvas{display:block;touch-action:none;cursor:crosshair;box-shadow:0 0 0 1px #514958,0 8px 25px #0007;}
  .canvas-layer{position:relative}
  .tile-grid{position:absolute;inset:0;pointer-events:none;--origin-x:0px;--origin-y:0px;
    background-image:
      repeating-linear-gradient(to right,#ece6fa35 var(--origin-x) calc(var(--origin-x) + 1px),transparent calc(var(--origin-x) + 1px) calc(var(--origin-x) + var(--cell))),
      repeating-linear-gradient(to bottom,#ece6fa35 var(--origin-y) calc(var(--origin-y) + 1px),transparent calc(var(--origin-y) + 1px) calc(var(--origin-y) + var(--cell)));
  }
  .outside-grid .tile-grid{inset:calc(-1 * var(--pan-y)) calc(-1 * var(--pan-x));--origin-x:var(--pan-x);--origin-y:var(--pan-y);}
  .outside-grid .canvas-layer>canvas:not(.overlay){box-shadow:0 0 0 1px #514958;}
  .edge-preview{position:absolute;pointer-events:none;width:var(--cell);height:var(--cell);
    outline:1px solid var(--accent);outline-offset:-1px;background-color:#cba6f720;background-size:100% 100%;image-rendering:pixelated;opacity:.75}
  canvas.overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;box-shadow:none}
  canvas.hand{cursor:grab;}
  canvas.select{cursor:pointer;}
  .legend{display:flex;flex-wrap:wrap;gap:.3rem .6rem;padding:.2rem .45rem;font-size:.71rem;flex:none}
  .legend span::before{content:'';display:inline-block;width:.55rem;height:.55rem;margin-right:.25rem;background:currentColor;}
  .solid{color:#ffc875;} .one-way{color:#97d2f0;} .fluid{color:#78d3cc;} .ladder{color:#a8d4aa;}
  .dynamic{color:#f7a270;} .breakable{color:#f3a197;} .sensor{color:#c8a6f0;}
  .palette{flex:0 0 auto;max-height:clamp(3rem,28%,13rem);overflow:auto;padding:.35rem .45rem;border-top:1px solid var(--line);font-size:.8rem;}
  .palette-head input{width:min(11rem,40%);margin-left:auto;}
  .tile-list{display:flex;flex-wrap:wrap;gap:.4rem;overflow:visible;margin:.5rem 0;padding:.2rem 0;}
  .tile-list button{display:grid;place-items:center;gap:.25rem;min-width:58px;max-width:110px;overflow-wrap:anywhere;padding:.26rem .4rem;font-size:.74rem;}
  .tile-list img{width:25px;height:25px;image-rendering:pixelated;object-fit:contain;}
  .brush-options{margin-top:.4rem;}
  label{display:flex;gap:.35rem;align-items:center;color:var(--muted);}
  select{width:auto;max-width:10rem;}
  @container(max-width:380px){
    .room-play span{display:none}
    :global(body.studio #app) .room-play{width:var(--control-height);padding:0}
  }
  @media(max-width:620px){
    .palette{max-height:clamp(2.7rem,23%,8rem)}
  }
</style>
