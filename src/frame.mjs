import {Decoder} from 'cbor-x';

const decoder=new Decoder({useRecords:false,mapsAsObjects:true,int64AsNumber:true});
const stride=44;

export const decodeWireFrame=bytes=>decoder.decode(bytes);

export function decodeFrame(bytes){
  const frame=decodeWireFrame(bytes);
  const {data,details}=frame.actors;
  if(data.byteLength!==details.length*stride)throw Error('Invalid snapshot actor data');
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const actors=new Array(details.length);
  for(let i=0,offset=0;i<details.length;i++,offset+=stride){
    const [image,name,shadow,healthBar]=details[i];
    const flags=view.getUint32(offset+40,true);
    const actor={
      id:view.getUint32(offset,true),
      x:view.getFloat32(offset+8,true),y:view.getFloat32(offset+12,true),
      width:view.getFloat32(offset+16,true),height:view.getFloat32(offset+20,true),
      angle:view.getFloat32(offset+24,true),facing:view.getFloat32(offset+28,true),
      health:view.getFloat32(offset+32,true),layer:view.getInt32(offset+36,true),
      flip_y:Boolean(flags&1),player:flags>>1?(flags>>1)-1:null,image,
    };
    const cloneOf=view.getUint32(offset+4,true);
    if(cloneOf)actor.cloneOf=cloneOf;
    if(name!==null)actor.name=name;
    if(shadow!==null)actor.shadow=shadow;
    if(healthBar!==null)actor.healthBar=healthBar;
    actors[i]=actor;
  }
  frame.actors=actors;
  for(const batch of frame.particles??[]){
    const bytes=batch.points;
    if(!(bytes instanceof Uint8Array))continue;
    if(bytes.byteLength%4)throw Error('Invalid snapshot particle data');
    const coords=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const points=new Array(bytes.byteLength/4);
    for(let i=0,offset=0;i<points.length;i++,offset+=4){
      points[i]=[coords.getInt16(offset,true),coords.getInt16(offset+2,true)];
    }
    batch.points=points;
  }
  return frame;
}
