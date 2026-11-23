import { Encoder, Decoder } from 'cbor-x';
import { deflateSync, inflateSync } from 'fflate';

const options = { useRecords: false, structuredClone: false, mapsAsObjects: true, tagUint8Array:false };
const encoder = new Encoder(options);
const decoder = new Decoder(options);
export const encodeCbor = value => encoder.encode(value);
export const decodeCbor = bytes => decoder.decode(bytes);

const limit = 256 * 1024 * 1024;
const prefix = [71,87,65,70,0];
const MAX_METADATA = 32 * 1024 * 1024;

export function pack(cart, { editor = false } = {}) {
  const { start, sprites, rooms, globals, flags, atlases, audio, camera, tilePreviews, spritePreviews, name } = cart;
  const metadata = encodeCbor({start, sprites, rooms, globals:globals??{}, flags:flags??{}});
  if (metadata.length > MAX_METADATA) throw Error('Cartridge simulation data exceeds 32 MiB');
  const compressed = deflateSync(metadata,{level:6});
  const views = Object.fromEntries(Object.entries(rooms).map(([id,room])=>[id,
    Object.fromEntries(['title','width','height','size','background','baked','ySort','music','ambience'].map(key=>[key,room[key]??null]))]));
  const media = encodeCbor({name,start,rooms:views,atlases,audio,camera,...(editor ? {tilePreviews,spritePreviews} : {})});
  const bytes = new Uint8Array(14 + compressed.length + media.length);
  if (bytes.length > limit) throw Error('Cartridge exceeds 256 MiB');
  bytes.set([...prefix,2]);
  const header = new DataView(bytes.buffer);
  header.setUint32(6,compressed.length,true);
  header.setUint32(10,metadata.length,true);
  bytes.set(compressed,14);
  bytes.set(media,14+compressed.length);
  return bytes;
}

export function unpack(bytes, { simulation = false } = {}) {
  if (bytes.length > limit || !prefix.every((value,index)=>bytes[index]===value)) throw Error('Invalid GameWaffle cartridge');
  let cart;
  if (bytes[5] === 1) cart = decodeCbor(bytes.subarray(6));
  else if (bytes[5] === 2 && bytes.length >= 14) {
    const header = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const end = 14 + header.getUint32(6,true);
    const size = header.getUint32(10,true);
    if (end <= 14 || end >= bytes.length || !size || size > MAX_METADATA) throw Error('Invalid cartridge section lengths');
    cart = decodeCbor(bytes.subarray(end));
    if (simulation) {
      const inflated = inflateSync(bytes.subarray(14,end),{out:new Uint8Array(size)});
      if (inflated.length !== size) throw Error('Invalid simulation data length');
      Object.assign(cart,decodeCbor(inflated));
    }
  } else throw Error('Unsupported GameWaffle cartridge format');
  if (!cart?.rooms || !Object.hasOwn(cart.rooms,cart.start) || !Object.hasOwn(cart.atlases??{},cart.start)) {
    throw Error('Cartridge is missing the starting room');
  }
  return cart;
}
