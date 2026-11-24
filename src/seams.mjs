// Bake the visible edge of a fixed neighbor. A 512-pixel camera can see 256
// pixels past its center. Moving actors belong to the active simulation.
import {decodePng} from './png.mjs';
import {seamlessNeighbor} from './room-geometry.mjs';
import {byteCache} from './compile-cache.mjs';
const decodedAtlases=byteCache(48*1024*1024);
export function addSeams(rooms,atlases,sprites,packAtlas){
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
  for(const [id,room] of Object.entries(rooms)){
    room.seams={};room.neighbors=[];room.seamMargins=[0,0,0,0];
    const images=new Map();
    for(const edge of Object.keys(room.exits)){
      const neighborId=seamlessNeighbor(rooms,id,edge);
      if(!neighborId)continue;
      const other=rooms[neighborId];
      const horizontal=edge==='left'||edge==='right';
      if(horizontal?room.height!==other.height:room.width!==other.width)throw Error('Connected edges must have the same length');
      room.seams[edge]=true;
      if(!room.neighbors.includes(neighborId))room.neighbors.push(neighborId);
      const w=horizontal?Math.min(256,other.width):other.width,h=horizontal?other.height:Math.min(256,other.height);
      room.seamMargins[['left','right','up','down'].indexOf(edge)]=horizontal?w:h;
      const sx=edge==='left'?other.width-w:0,sy=edge==='up'?other.height-h:0;
      const rgba=Buffer.alloc(w*h*4);
      const color=parseInt(other.background.slice(1),16);
      rgba.fill(Buffer.from([color>>16,color>>8,color,255]));
      const source=image(neighborId);
      const entries=[...other.baked.filter(layer=>!layer.image.startsWith('seam/'))];
      for(const entity of other.entities){
        if(entity.player!=null || entity.conditions?.length || entity.sprite)continue;
        const sprite=sprites[entity.sprite];
        const frame=entity.clip?.[0]??sprite?.clips[entity.animation??sprite?.animation]?.frames[0]??sprite?.clips.default.frames[0];
        if(frame)entries.push({image:frame.image,x:entity.x-(sprite?.width??other.size)/2,y:entity.y-(sprite?.height??other.size)/2,layer:entity.layer??sprite?.layer??0});
      }
      for(const entry of entries.sort((a,b)=>a.layer-b.layer)){
        const rect=atlases[neighborId].entries[entry.image];if(!rect)continue;
        const x=Math.round(entry.x)-sx,y=Math.round(entry.y)-sy;
        const width=entry.width??rect[2],height=entry.height??rect[3];
        for(let dy=Math.max(0,-y);dy<Math.min(height,h-y);dy++)for(let dx=Math.max(0,-x);dx<Math.min(width,w-x);dx++){
          const i=4*((rect[1]+Math.floor(dy*rect[3]/height))*source.width+rect[0]+Math.floor(dx*rect[2]/width)),j=4*((y+dy)*w+x+dx),alpha=source.data[i+3]/255;
          for(let c=0;c<3;c++)rgba[j+c]=Math.round(source.data[i+c]*alpha+rgba[j+c]*(1-alpha));
        }
      }
      const key='seam/'+edge;images.set(key,{width:w,height:h,rgba});
      room.baked.push({image:key,layer:-10001,x:edge==='left'?-w:edge==='right'?room.width:0,y:edge==='up'?-h:edge==='down'?room.height:0});
    }
    if(!images.size)continue;
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
