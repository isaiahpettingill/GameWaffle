import {drawWeather} from './room-weather.js';
import {shaderMaskLayers} from '../src/room-shaders.mjs';
import {postprocess} from './room-postprocess.js';
import {dialogue_lines,hd_frame} from '../web-built/runtime/runtime.js';
import {cameraView,fitFrame} from './camera.js';
const images = new WeakMap();
const rippleBuffers = new WeakMap();
const sceneBuffers = new WeakMap();
const frameBuffers = new WeakMap();

function bufferFor(cache,canvas,width,height){
  if(!cache.has(canvas))cache.set(canvas,document.createElement('canvas'));
  const buffer=cache.get(canvas);
  if(buffer.width!==width)buffer.width=width;
  if(buffer.height!==height)buffer.height=height;
  return buffer;
}
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

function drawShapes(ctx,shapes,hud,origin){
  if(!shapes?.length)return;
  ctx.save();
  ctx.translate(-origin[0],-origin[1]);
  const css=color=>'#'+color.toString(16).padStart(8,'0');
  let fillColor=-1,strokeColor=-1,lineWidth=-1;
  for(const shape of shapes){
    if(shape.hud!==hud)continue;
    const {kind,coords,fill,stroke,width}=shape;
    const [x,y,a,b,c,d]=coords;
    if(fillColor!==fill){ctx.fillStyle=css(fill);fillColor=fill;}
    if(strokeColor!==stroke){ctx.strokeStyle=css(stroke);strokeColor=stroke;}
    if(lineWidth!==width){ctx.lineWidth=width||1;lineWidth=width;}
    if(kind==='rect'){
      if(fill&255)ctx.fillRect(x,y,a,b);
      if(width&&(stroke&255))ctx.strokeRect(x,y,a,b);
      continue;
    }
    if(kind==='point'){
      if(width&&(stroke&255)){ctx.fillStyle=css(stroke);ctx.fillRect(x-width/2,y-width/2,width,width);fillColor=-1;}
      continue;
    }
    ctx.beginPath();
    if(kind==='ellipse')ctx.ellipse(x,y,Math.abs(a)*.5,Math.abs(b)*.5,0,0,2*Math.PI);
    else{
      ctx.moveTo(x,y);ctx.lineTo(a,b);
      if(kind==='triangle'){ctx.lineTo(c,d);ctx.closePath();}
    }
    if(kind!=='line'&&(fill&255))ctx.fill();
    if(width&&(stroke&255))ctx.stroke();
  }
  ctx.restore();
}

function drawMinimap(ctx,map,snapshot,width,height){
  if(!map || snapshot.menu || snapshot.dialog)return;
  const mode=snapshot.gameSettings?.minimap??map.mode;
  if(mode==='off')return;
  const explored=new Set(snapshot.explored??[]);
  const visible=new Map(Object.entries(map.rooms).filter(([id])=>mode==='world'||explored.has(id)));
  if(!visible.size)return;
  const rooms=[...visible.values()];
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const [x,y,w,h] of rooms){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+w);bottom=Math.max(bottom,y+h);}
  const scale=Math.min(3,64/Math.max(1,right-left),42/Math.max(1,bottom-top));
  const w=Math.ceil((right-left)*scale),h=Math.ceil((bottom-top)*scale),x0=width-w-7,y0=height-h-7;
  const point=(x,y)=>[Math.round(x0+(x-left)*scale),Math.round(y0+(y-top)*scale)];
  ctx.fillStyle='#181825dd';
  ctx.fillRect(x0-3,y0-3,w+6,h+6);
  ctx.strokeStyle='#888aa7';
  ctx.beginPath();
  for(const [a,b] of map.edges){
    const p=visible.get(a), q=visible.get(b);
    if(!p||!q)continue;
    ctx.moveTo(...point(p[0]+p[2]/2,p[1]+p[3]/2));
    ctx.lineTo(...point(q[0]+q[2]/2,q[1]+q[3]/2));
  }
  ctx.stroke();
  for(const [id,[x,y,w,h]] of visible){
    const [vx,vy]=point(x,y), tw=Math.max(1,Math.round(w*scale)),th=Math.max(1,Math.round(h*scale));
    ctx.fillStyle=id===snapshot.room?'#f9e2af':'#292c40';
    ctx.fillRect(vx,vy,tw,th);
    ctx.strokeStyle=id===snapshot.room?'#fff1bc':'#a6adc8';
    if(tw>1&&th>1)ctx.strokeRect(vx+.5,vy+.5,tw-1,th-1);
  }
}

export function drawRoom(canvas, cart, snapshot, atlasImages, showGrid=false) {
  const room = cart?.rooms[snapshot?.room];
  const atlas = cart?.atlases[snapshot?.room];
  if (!room || !atlas) return;
  const box = canvas.parentElement.getBoundingClientRect();
  const settings=snapshot.roomSettings??{};
  const player=snapshot.actors.find(actor=>actor.player===0);
  const focus=snapshot.focus??(player?[player.x,player.y]:[room.width/2,room.height/2]);
  const {x,y,width,height,resolution}=cameraView(snapshot.gameSettings?.display??cart.camera??{},room,atlas,[box.width,box.height],focus,settings.zoom,settings.cameraHeight);
  const shader=settings.shader??room.shader;
  const hd=shader?(shader.kind==='hd'?shader.strength:0):room.hd;
  const ripple=shader?(shader.kind==='ripple'&&shader.strength>0?[Math.ceil(shader.strength*.12),32,1]:null):room.ripple;
  const scale=hd>0?2:1;
  canvas.dataset.viewWidth=width;canvas.dataset.viewHeight=height;
  const [displayWidth,displayHeight]=resolution??[width*scale,height*scale];
  if(canvas.width!==displayWidth)canvas.width=displayWidth;
  if(canvas.height!==displayHeight)canvas.height=displayHeight;
  const frame=displayWidth===width*scale&&displayHeight===height*scale
    ? canvas : bufferFor(frameBuffers,canvas,width*scale,height*scale);
  const scene=scale===2?bufferFor(sceneBuffers,canvas,width,height):frame;
  let ctx=scene.getContext('2d');
  ctx.setTransform(1,0,0,1,0,0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = settings.background??room.background;
  ctx.fillRect(0,0,width,height);
  ctx.translate(-x,-y);
  const image = atlasImages[snapshot.room];
  if (!image) return;
  const render = settings.backgroundImage==null?room.baked.slice():room.baked.filter(layer=>layer.image!=='room/background');
  if(settings.backgroundImage)render.push({image:'room/background/'+settings.backgroundImage,layer:-10001,
    width:room.width,height:room.height,parallax:settings.backgroundScroll});
  for(const actor of snapshot.actors){
    if(actor.shadow?.placement==='ground')render.push({layer:actor.layer,order:1,groundShadow:actor.shadow});
    render.push({...actor,order:2,depth:actor.image.startsWith('sprite/')?actor.y+actor.height/2:-Infinity});
  }
  render.sort((a,b)=>a.layer-b.layer || (a.order??0)-(b.order??0)
    || ((settings.ySort??room.ySort)&&a.order===2?a.depth-b.depth||0:0));
  const visible=(left,top,w,h)=>left<x+width&&left+w>x&&top<y+height&&top+h>y;
  for (const entry of render) {
    if(entry.groundShadow){
      const {rect:[left,top,w,h],opacity}=entry.groundShadow;
      if(visible(left,top,w,h)){
        ctx.fillStyle='rgba(0,0,0,'+(opacity/100)+')';
        ctx.beginPath();
        ctx.ellipse(left+w/2,top+h/2,w/2,h/2,0,0,2*Math.PI);
        ctx.fill();
      }
      continue;
    }
    const rect = atlas.entries[entry.image];
    if (!entry.order) {
      const scroll=entry.parallax??1, fixed=1-scroll;
      const left=(entry.x??0)+x*fixed, top=(entry.y??0)+y*fixed;
      const w=(entry.width??rect?.[2])*scroll+width*fixed;
      const h=(entry.height??rect?.[3])*scroll+height*fixed;
      if (rect && visible(left,top,w,h)) {
        ctx.drawImage(image,...rect,left,top,w,h);
      }
      continue;
    }
    const shadow=entry.shadow?.placement==='behind'?entry.shadow:null;
    if(!visible(entry.x-entry.width,entry.y-entry.height,entry.width*2,entry.height*2)
      && !(shadow&&visible(...shadow.rect)))continue;
    if (!rect) {
      ctx.fillStyle = '#ffc875';
      ctx.fillRect(entry.x-2,entry.y-2,4,4);
      continue;
    }
    if(shadow){
      const [left,top,w,h]=shadow.rect;
      ctx.save();
      ctx.globalAlpha=shadow.opacity/100;
      ctx.filter='brightness(0)';
      ctx.translate(left+w/2,top+h/2);
      ctx.rotate(entry.angle || 0);
      ctx.scale(entry.facing < 0 ? -1 : 1,entry.flip_y ? -1 : 1);
      ctx.drawImage(image,...rect,-w/2,-h/2,w,h);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(Math.round(entry.x), Math.round(entry.y));
    ctx.rotate(entry.angle || 0);
    ctx.scale(entry.facing < 0 ? -1 : 1,entry.flip_y ? -1 : 1);
    ctx.drawImage(image,...rect,-entry.width/2,-entry.height/2,entry.width,entry.height);
    ctx.restore();
  }
  if (showGrid) {
    ctx.strokeStyle = '#d1bad42e';
    ctx.beginPath();
    for (let x = 0; x < room.width; x += room.size) { ctx.moveTo(x+.5,0); ctx.lineTo(x+.5,room.height); }
    for (let y = 0; y < room.height; y += room.size) { ctx.moveTo(0,y+.5); ctx.lineTo(room.width,y+.5); }
    ctx.stroke();
  }
  for(const batch of snapshot.particles??[]){
    if(!batch.points.length)continue;
    ctx.fillStyle='#'+batch.color.toString(16).padStart(6,'0');
    for(const [px,py] of batch.points)ctx.fillRect(px,py,batch.size,batch.size);
  }
  for(const actor of snapshot.actors){
    const bar=actor.healthBar;
    if(!bar||!visible(...bar.rect))continue;
    const [left,top,w,h]=bar.rect;
    ctx.fillStyle='#'+bar.track.toString(16).padStart(6,'0');
    ctx.fillRect(left,top,w,h);
    ctx.fillStyle='#'+bar.fill.toString(16).padStart(6,'0');
    ctx.fillRect(left+1,top+1,Math.round((w-2)*bar.fraction),h-2);
  }
  ctx.setTransform(1,0,0,1,0,0);
  if(ripple?.[0]){
    const [amplitude,wavelength,speed]=ripple;
    const phase=(snapshot.tick%60)*speed/60;
    const gpu=postprocess(scene,width,height,0,[amplitude,wavelength,phase]);
    if(gpu)ctx.drawImage(gpu,0,0);
    else{
      const buffer=bufferFor(rippleBuffers,canvas,width,height);
      buffer.getContext('2d').drawImage(scene,0,0);
      for(let row=0;row<height;row+=2){
        const shift=Math.round(amplitude*Math.sin(2*Math.PI*(row/wavelength+phase)));
        if(!shift)continue;
        const band=Math.min(2,height-row);
        ctx.drawImage(buffer,0,row,width,band,shift,row,width,band);
        if(shift>0)ctx.drawImage(buffer,0,row,1,band,0,row,shift,band);
        if(shift<0)ctx.drawImage(buffer,width-1,row,1,band,width+shift,row,-shift,band);
      }
    }
  }
  if(!shader||shader.strength>0){
    const prefix=shader?'shader/'+shader.kind+'/':'post/';
    if(shader)ctx.globalAlpha=shader.strength/100;
    for(const layer of shaderMaskLayers){
      const r=atlas.entries[prefix+layer];
      if(r)ctx.drawImage(image,r[0],r[1],layer==='columns'?width:r[2],layer==='rows'?height:r[3],0,0,width,height);
    }
    if(shader){
      ctx.globalAlpha=1;
      drawWeather(ctx,shader,width,height,snapshot.tick);
    }
  }
  drawShapes(ctx,snapshot.shapes,false,[x,y]);
  if(scale===2){
    const gpu=postprocess(scene,width,height,hd);
    const pixels=gpu?null:ctx.getImageData(0,0,width,height).data;
    ctx=frame.getContext('2d');
    ctx.setTransform(1,0,0,1,0,0);
    ctx.imageSmoothingEnabled=false;
    if(gpu)ctx.drawImage(gpu,0,0);
    else{
      const result=hd_frame(pixels,width,height,hd);
      ctx.putImageData(new ImageData(new Uint8ClampedArray(result.buffer,result.byteOffset,result.length),width*2,height*2),0,0);
    }
  }
  if(!showGrid){ctx.setTransform(scale,0,0,scale,0,0);drawShapes(ctx,snapshot.shapes,true,[0,0]);drawMinimap(ctx,cart.minimap,snapshot,width,height);}
  if (!showGrid && atlas.entries['ui/font']) {
    ctx.setTransform(scale,0,0,scale,0,0);
    const painters=new Map();
    function fontPainter(name){
      if(painters.has(name))return painters.get(name);
      const named=name&&cart.fonts?.[name],entry=named&&atlas.entries['ui/font/'+name];
      const font=entry||atlas.entries['ui/font'];
      const layout=entry?named.layout:cart.fontLayout;
      const glyphs=entry?named.glyphs:cart.fontGlyphs;
      const glyphWidth=layout?.width??6, glyphHeight=layout?.height??8, glyphColumns=layout?.columns??16;
      const fallback=layout?atlas.entries['ui/font-fallback']:font;
      const fallbackGlyphs=layout?cart.fontFallbackGlyphs:glyphs;
      const text=(line,x,y)=>{
        for(const ch of line){
          const custom=layout ? glyphs?.[ch]??glyphs?.[ch.toUpperCase()]??glyphs?.[ch.toLowerCase()] : undefined;
          const code=ch.codePointAt(0);
          const i=custom??(code>=32&&code<127?code-32:fallbackGlyphs?.[ch]??31);
          const sheet=custom==null?fallback:font;
          const [cellWidth,cellHeight,columns]=custom==null?[6,8,16]:[glyphWidth,glyphHeight,glyphColumns];
          if(sheet)ctx.drawImage(image,sheet[0]+i%columns*cellWidth,sheet[1]+Math.floor(i/columns)*cellHeight,cellWidth,cellHeight,x,y,glyphWidth,glyphHeight);
          x+=glyphWidth;
        }
      };
      const painter={text,glyphWidth,glyphHeight};
      painters.set(name,painter);
      return painter;
    }
    const {text,glyphWidth,glyphHeight}=fontPainter(snapshot.hudFont??'');
    for(const entry of Object.values(snapshot.hudText??{})){
      const paint=fontPainter(entry.font||snapshot.hudFont||'');
      const lines=entry.value.split('\n');
      const [x,y]=entry.offset,anchor=entry.anchor;
      const textHeight=lines.length*paint.glyphHeight;
      let py=anchor.startsWith('bottom')?height-textHeight-y:anchor.startsWith('center')?Math.floor((height-textHeight)/2)+y:y;
      for(const line of lines){
        const textWidth=[...line].length*paint.glyphWidth;
        const px=anchor.endsWith('right')?width-textWidth-x:anchor.endsWith('center')?Math.floor((width-textWidth)/2)+x:x;
        if(py>-paint.glyphHeight&&py<height)paint.text(line,px,py);
        py+=paint.glyphHeight;
      }
    }
    for(const [id,[x,y]] of Object.entries(snapshot.icons??{})){
      const r=atlas.entries['ui/item/'+id];if(r)ctx.drawImage(image,...r,x,y,r[2],r[3]);
    }
    let y=2;
    ctx.fillStyle='#262334';
    for(const [label,value] of Object.entries(snapshot.counters??{})){
      const line=label+' '+value;
      ctx.fillRect(2,y,[...line].length*glyphWidth+4,glyphHeight+1);text(line,4,y);y+=glyphHeight+2;
    }
    for(const [label,[value,max]] of Object.entries(snapshot.bars??{})){
      text(label,4,y);y+=glyphHeight;ctx.fillStyle='#262334';ctx.fillRect(2,y,64,5);
      ctx.fillStyle='#92dac4';ctx.fillRect(3,y+1,62*value/max,3);y+=7;
    }
    ctx.fillStyle='#262334';
    if(snapshot.dialog || snapshot.menu){
      const columns=Math.max(1,Math.floor((width-8)/glyphWidth));
      const visibleRows=Math.max(1,Math.floor((height-10)/glyphHeight));
      let lines;
      if(snapshot.menu){
        const {title,options,selected,controls}=snapshot.menu, rows=Math.max(1,Math.min(8,visibleRows-2)), start=Math.max(0,selected-rows+1);
        const clip=value=>[...value].slice(0,columns).join('');
        lines=[clip(title),...options.slice(start,start+rows).map((label,i)=>clip((i+start===selected?'> ':'  ')+label)), clip(controls)];
      }else lines=[...dialogue_lines(snapshot.dialog,columns).split('\n').slice(0,Math.max(1,visibleRows-1)),'[A]'];
      y=Math.max(0,height-lines.length*glyphHeight-10);
      ctx.fillRect(1,y,width-2,height-y-1);
      for(const line of lines){text(line,4,y+1);y+=glyphHeight;}
    }
  }
  if(frame!==canvas){
    const display=canvas.getContext('2d');
    display.setTransform(1,0,0,1,0,0);
    display.imageSmoothingEnabled=false;
    display.fillStyle='#0e0e16';
    display.fillRect(0,0,displayWidth,displayHeight);
    display.drawImage(frame,...fitFrame(width,height,displayWidth,displayHeight));
  }
}
