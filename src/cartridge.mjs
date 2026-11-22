import { Encoder, Decoder } from 'cbor-x';
const magic = new Uint8Array([71,87,65,70,0,1]); // GWAF, format version 1
const options = { useRecords: false, structuredClone: false, mapsAsObjects: true };
const encoder = new Encoder(options);
const decoder = new Decoder(options);
export const encodeCbor = value => encoder.encode(value);
export const decodeCbor = bytes => decoder.decode(bytes);
export function pack(cart) {
  const bytes = encodeCbor(cart);
  const output = new Uint8Array(magic.length + bytes.length);
  output.set(magic);
  output.set(bytes, magic.length);
  return output;
}
export function unpack(bytes) {
  if (!magic.every((byte, i) => bytes[i] === byte)) throw Error('Unsupported GameWaffle cartridge format');
  const cart = decodeCbor(bytes.subarray(magic.length));
  if (!cart?.rooms?.[cart.start] || !cart?.atlases?.[cart.start]) throw Error('Cartridge is missing the starting room');
  return cart;
}
