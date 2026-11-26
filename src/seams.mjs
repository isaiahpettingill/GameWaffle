// Bake the visible edge of a fixed neighbor. A 512-pixel camera can see 256
// pixels past its center.
import {createHash} from 'node:crypto';
import {decodePng} from './png.mjs';
import {byteCache} from './compile-cache.mjs';
import {loadProjectRuntime} from './shader-assets.mjs';
const decodedAtlases=byteCache(48*1024*1024);
const maxRoomActors=4096;

async function paintGradient(rgba,w,h,sx,sy,room,backdrop){
  if(!backdrop.gradient)return;
  const {room_gradient_region}=await loadProjectRuntime();
  const settings=JSON.stringify(backdrop.gradient);
  const base='#'+backdrop.color.map(value=>value.toString(16).padStart(2,'0')).join('');
  const chunk=512;
  for(let y=0;y<h;y+=chunk)for(let x=0;x<w;x+=chunk){
    const width=Math.min(chunk,w-x),height=Math.min(chunk,h-y);
    const pixels=Buffer.from(room_gradient_region(width,height,sx+x,sy+y,room.width,room.height,settings,base));
    for(let row=0;row<height;row++)pixels.copy(rgba,4*((y+row)*w+x),4*row*width,4*(row+1)*width);
  }
}

export async function addSeams(rooms,atlases,sprites,packAtlas,background){
  const originals=new Map();
  const image=id=>{
    if(!originals.has(id)){
      const png=atlases[id].png;
      let decoded=decodedAtlases.get(png);
      if(!decoded){decoded=decodePng(png);decodedAtlases.put(png,decoded,decoded.data.length);}
      originals.set(id,decoded);
    }
    return originals.get(id);
  };
  const updates={};
  const previews=new Map(Object.keys(rooms).map(id=>[id,new Map()]));
  const entities=Object.fromEntries(Object.entries(rooms).map(([id,room])=>[id,[...room.entities]]));
  const opposite={left:'right',right:'left',up:'down',down:'up'};
  for(const [id,room] of Object.entries(rooms))for(const [edge,exit] of Object.entries(room.exits)){
    if(!exit.seamSpan)continue;
    const target=exit.targets[0], [offset,start,end]=exit.seamSpan;
    previews.get(id).set(edge,[target,offset,start,end]);
    const incoming=previews.get(target);
    if(!incoming.has(opposite[edge]))
      incoming.set(opposite[edge],[id,-offset,start-offset,end-offset]);
  }
  for(const [id,room] of Object.entries(rooms)){
    room.seams={};room.neighbors=[];room.seamMargins=[0,0,0,0];
    const images=new Map();
    for(const [edge,[neighborId,offset,start,end]] of previews.get(id)){
      const other=rooms[neighborId];
      const horizontal=edge==='left'||edge==='right';
      room.seams[edge]=true;
      if(!room.neighbors.includes(neighborId))room.neighbors.push(neighborId);
      const w=horizontal?Math.min(256,other.width):end-start,h=horizontal?end-start:Math.min(256,other.height);
      room.seamMargins[['left','right','up','down'].indexOf(edge)]=horizontal?w:h;
      const sx=horizontal?(edge==='left'?other.width-w:0):start-offset;
      const sy=horizontal?start-offset:(edge==='up'?other.height-h:0);
      const left=horizontal?(edge==='left'?-w:room.width):start;
      const top=horizontal?start:(edge==='up'?-h:room.height);
      const rgba=Buffer.alloc(w*h*4);
      const backdrop=background(neighborId);
      rgba.fill(Buffer.from([...backdrop.color,255]));
      await paintGradient(rgba,w,h,sx,sy,other,backdrop);
      const source=image(neighborId);
      const paint=entry=>{
        const rect=atlases[neighborId].entries[entry.image];if(!rect)return;
        const x=Math.round(entry.x)-sx,y=Math.round(entry.y)-sy;
        const width=entry.width??rect[2],height=entry.height??rect[3];
        for(let dy=Math.max(0,-y);dy<Math.min(height,h-y);dy++)for(let dx=Math.max(0,-x);dx<Math.min(width,w-x);dx++){
          const i=4*((rect[1]+Math.floor(dy*rect[3]/height))*source.width+rect[0]+Math.floor(dx*rect[2]/width)),j=4*((y+dy)*w+x+dx),alpha=source.data[i+3]/255;
          for(let c=0;c<3;c++)rgba[j+c]=Math.round(source.data[i+c]*alpha+rgba[j+c]*(1-alpha));
        }
      };
      const backdropLayer=backdrop.image===undefined
        ?other.baked.find(layer=>layer.image==='room/background')
        :backdrop.image?{image:'room/background/'+backdrop.image,width:other.width,height:other.height}:null;
      if(backdropLayer)paint(backdropLayer);
      for(const {id,x,y,scale} of backdrop.sprites.values()){
        const sprite=sprites[id], frame=(sprite?.clips[sprite.animation]??sprite?.clips.default)?.frames[0];
        if(frame){
          const rect=atlases[neighborId].entries[frame.image];
          if(rect)paint({image:frame.image,x,y,width:rect[2]*scale,height:rect[3]*scale});
        }
      }
      const entries=other.baked.filter(layer=>layer.image!=='room/background'&&!layer.image.startsWith('seam/'));
      const copied=new Map();
      const copyFrame=frame=>{
        if(!copied.has(frame.image)){
          const [x,y,width,height]=atlases[neighborId].entries[frame.image];
          const key='seam/'+edge+'/fluid/'+copied.size, pixels=Buffer.alloc(width*height*4);
          for(let row=0;row<height;row++)pixels.set(source.data.subarray(4*((y+row)*source.width+x),4*((y+row)*source.width+x+width)),row*width*4);
          images.set(key,{width,height,rgba:pixels});
          copied.set(frame.image,key);
        }
        return {...frame,image:copied.get(frame.image)};
      };
      for(const entity of entities[neighborId]){
        if(entity.player!=null)continue;
        const sprite=sprites[entity.sprite], tile=entity.tile??entity.tileMark?.tile;
        const clip=entity.clip??sprite?.clips?.[entity.animation??sprite?.animation]?.frames??sprite?.clips?.default?.frames;
        if(entity.physics?.mode==='fluid'&&tile&&room.entities.length<maxRoomActors&&entity.x>=sx&&entity.x<sx+w&&entity.y>=sy&&entity.y<sy+h){
          room.entities.push({x:left+entity.x-sx,y:top+entity.y-sy,layer:entity.layer,physics:entity.physics,
            conditions:entity.conditions,tileMark:{tile,mode:'fluid'},...(clip?.length?{clip:clip.map(copyFrame)}:{})});
          continue;
        }
        if(!entity.sprite&&!entity.conditions?.length&&clip?.length)
          entries.push({image:clip[0].image,x:entity.x-other.size/2,y:entity.y-other.size/2,layer:entity.layer??0});
      }
      for(const entry of entries.sort((a,b)=>a.layer-b.layer))paint(entry);
      const key='seam/'+edge;images.set(key,{width:w,height:h,rgba});
      room.baked.push({image:key,layer:-10001,x:left,y:top});
    }
    if(!images.size)continue;
    if(room.entities.length!==entities[id].length)
      room.layoutKey=createHash('sha256').update(room.layoutKey).update(JSON.stringify(room.entities.slice(entities[id].length))).digest('hex');
    const src=image(id);
    for(const [key,[x,y,w,h]] of Object.entries(atlases[id].entries)){
      const rgba=Buffer.alloc(w*h*4);
      for(let row=0;row<h;row++)src.data.copy(rgba,row*w*4,4*((y+row)*src.width+x),4*((y+row)*src.width+x+w));
      images.set(key,{width:w,height:h,rgba});
    }
    updates[id]=packAtlas(images);
  }
  Object.assign(atlases,updates);
}
