import {dialogue_lines} from '../web-built/runtime/runtime.js';
const images = new WeakMap();
export function loadAtlas(atlas) {
  if (!images.has(atlas)) {
    images.set(atlas, new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(new Blob([atlas.png], { type:'image/png' }));
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(Error('Cannot read the room atlas')); };
      image.src = url;
    }));
  }
  return images.get(atlas);
}

export function drawRoom(canvas, cart, snapshot, atlasImages, showGrid=false) {
  const room = cart?.rooms[snapshot?.room];
  const atlas = cart?.atlases[snapshot?.room];
  if (!room || !atlas) return;
  const ctx = canvas.getContext('2d');
  const box = canvas.parentElement.getBoundingClientRect();
  const config = cart.camera ?? {};
  const zoom = Math.max(1,config.zoom ?? 2);
  const clamp = (n,lo,hi)=>Math.max(lo,Math.min(hi,n));
  const minWidth=clamp(config.min_width??128,128,512), minHeight=clamp(config.min_height??128,128,512);
  const width=clamp(Math.floor(box.width/zoom),minWidth,clamp(config.max_width??512,minWidth,512));
  const height=clamp(Math.floor(box.height/zoom),minHeight,clamp(config.max_height??512,minHeight,512));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const player = snapshot.actors.find(actor=>actor.player===0);
  const x = clamp(Math.round(snapshot.focus?.[0] ?? player?.x ?? room.width/2)-Math.floor(width/2),room.seams?.left?-Math.floor(width/2):0,Math.max(0,room.width-(room.seams?.right?Math.ceil(width/2):width)));
  const y = clamp(Math.round(snapshot.focus?.[1] ?? player?.y ?? room.height/2)-Math.floor(height/2),room.seams?.up?-Math.floor(height/2):0,Math.max(0,room.height-(room.seams?.down?Math.ceil(height/2):height)));
  ctx.setTransform(1,0,0,1,0,0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = room.background;
  ctx.fillRect(0,0,width,height);
  ctx.translate(-x,-y);
  const image = atlasImages[snapshot.room];
  if (!image) return;
  const render = [
    ...snapshot.actors.map(actor=>({ ...actor, actor:true, depth:actor.image.startsWith('sprite/') ? actor.y+actor.height/2 : -Infinity })),
    ...room.baked,
  ].sort((a,b)=>a.layer-b.layer || Number(!!a.actor)-Number(!!b.actor) || (room.ySort && a.actor && b.actor ? a.depth-b.depth || 0 : 0));
  for (const entry of render) {
    const rect = atlas.entries[entry.image];
    if (!entry.actor) {
      const left=entry.x??0, top=entry.y??0;
      if (rect && left<x+width && left+rect[2]>x && top<y+height && top+rect[3]>y) {
        ctx.drawImage(image,...rect,left,top,rect[2],rect[3]);
      }
      continue;
    }
    if (entry.x+entry.width<x || entry.x-entry.width>x+width || entry.y+entry.height<y || entry.y-entry.height>y+height) continue;
    if (!rect) {
      ctx.fillStyle = '#ffc875';
      ctx.fillRect(entry.x-2,entry.y-2,4,4);
      continue;
    }
    ctx.save();
    ctx.translate(Math.round(entry.x), Math.round(entry.y));
    ctx.rotate(entry.angle || 0);
    ctx.scale(entry.facing < 0 ? -1 : 1,1);
    ctx.drawImage(image,...rect,-entry.width/2,-entry.height/2,entry.width,entry.height);
    ctx.restore();
  }
  if (showGrid) {
    ctx.strokeStyle = '#d1bad42e';
    ctx.beginPath();
    for (let x = 0; x < room.width; x += room.size) { ctx.moveTo(x+.5,0); ctx.lineTo(x+.5,room.height); }
    for (let y = 0; y < room.height; y += room.size) { ctx.moveTo(0,y+.5); ctx.lineTo(room.width,y+.5); }
    ctx.stroke();
  } else {
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    for (const actor of snapshot.actors.filter(actor=>actor.player != null)) {
      ctx.fillStyle = '#f1ddbb';
      ctx.fillText(String(actor.player+1), Math.round(actor.x), Math.round(actor.y-actor.height/2-5));
    }
  }
  const font=atlas.entries['ui/font'];
  if (!showGrid && font) {
    ctx.setTransform(1,0,0,1,0,0);
    const text=(line,x,y)=>{
      for(const ch of line){
        const code=ch.codePointAt(0), i=(code>=32&&code<127?code:63)-32;
        ctx.drawImage(image,font[0]+i%16*6,font[1]+Math.floor(i/16)*8,6,8,x,y,6,8);
        x+=6;
      }
    };
    let y=2;
    ctx.fillStyle='#262334';
    for(const [label,value] of Object.entries(snapshot.counters??{})){
      const line=label+' '+value;
      ctx.fillRect(2,y,line.length*6+4,9);text(line,4,y);y+=10;
    }
    if(snapshot.dialog){
      const lines=dialogue_lines(snapshot.dialog,Math.floor((width-8)/6)).split('\n');
      y=height-(lines.length+1)*8-4;
      ctx.fillRect(1,y,width-2,height-y-1);
      for(const line of [...lines,'[A]']){text(line,4,y+1);y+=8;}
    }
  }
}
