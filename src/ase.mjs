import {runCodec} from './asset-codec.mjs';

export function readAseprite(bytes) {
  const asset=runCodec('decode_aseprite',bytes);
  const width=asset.readUInt32LE(0),height=asset.readUInt32LE(4);
  const frameCount=asset.readUInt32LE(8),tagCount=asset.readUInt32LE(12);
  let offset=16;
  const tags=Array.from({length:tagCount},()=>{
    const from=asset.readUInt16LE(offset),to=asset.readUInt16LE(offset+2);
    const direction=asset[offset+4],repeat=asset.readUInt16LE(offset+5);
    const length=asset.readUInt16LE(offset+7);
    offset+=9;
    const name=asset.toString('utf8',offset,offset+length);
    offset+=length;
    return {name,from,to,direction,repeat};
  });
  const size=width*height*4;
  const frames=Array.from({length:frameCount},()=>{
    const duration=asset.readUInt16LE(offset);
    offset+=2;
    const rgba=asset.subarray(offset,offset+size);
    offset+=size;
    return {duration,rgba};
  });
  return {width,height,frames,tags};
}

export function tagFrames(tag) {
  const frames = Array.from({ length: tag.to - tag.from + 1 }, (_, i) => i + tag.from);
  if (tag.direction === 1 || tag.direction === 3) frames.reverse();
  if (tag.direction >= 2) frames.push(...frames.slice(1, -1).reverse());
  return frames;
}
