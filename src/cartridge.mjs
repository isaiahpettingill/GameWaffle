import { Encoder, Decoder } from 'cbor-x';
import { inflateSync } from 'fflate';

const options = { useRecords: false, structuredClone: false, mapsAsObjects: true, tagUint8Array:false };
const encoder = new Encoder(options);
const decoder = new Decoder(options);
export const encodeCbor = value => encoder.encode(value);
export const decodeCbor = bytes => decoder.decode(bytes);

const limit = 256 * 1024 * 1024;
const prefix = [71,87,65,70,0];
const MAX_METADATA = 32 * 1024 * 1024;

export function unpack(bytes, { simulation = false } = {}) {
  if (bytes.length > limit || !prefix.every((value,index)=>bytes[index]===value)) throw Error('Invalid GameWaffle cartridge');
  let cart;
  if (bytes[5] === 2 && bytes.length >= 14) {
    const header = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const end = 14 + header.getUint32(6,true);
    const size = header.getUint32(10,true);
    if (end <= 14 || end >= bytes.length-96 || !size || size > MAX_METADATA) throw Error('Invalid cartridge section lengths');
    cart = decodeCbor(bytes.subarray(end,-96));
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
