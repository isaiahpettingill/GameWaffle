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

export async function preload(cart) {
  return Object.fromEntries(await Promise.all(Object.entries(cart.atlases).map(async ([room,atlas])=>[room,await loadAtlas(atlas)])));
}

export function drawRoom(canvas, cart, snapshot, atlasImages, showGrid=false) {
  const room = cart?.rooms[snapshot?.room];
  const atlas = cart?.atlases[snapshot?.room];
  if (!room || !atlas) return;
  if (canvas.width !== room.width) canvas.width = room.width;
  if (canvas.height !== room.height) canvas.height = room.height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = room.background;
  ctx.fillRect(0,0,room.width,room.height);
  const image = atlasImages[snapshot.room];
  if (!image) return;
  const render = [
    ...snapshot.actors.map(actor=>({ ...actor, actor:true })),
    ...room.baked,
  ].sort((a,b)=>a.layer-b.layer || Number(!!a.actor)-Number(!!b.actor));
  for (const entry of render) {
    const rect = atlas.entries[entry.image];
    if (!entry.actor) {
      if (rect) ctx.drawImage(image,...rect,0,0,rect[2],rect[3]);
      continue;
    }
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
}
