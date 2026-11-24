import { Encoder, Decoder } from 'cbor-x';
import { inflateSync } from 'fflate';

const options = { useRecords: false, structuredClone: false, mapsAsObjects: true, tagUint8Array:false };
const encoder = new Encoder(options);
const decoder = new Decoder(options);
export const encodeCbor = value => encoder.encode(value);
export const decodeCbor = bytes => decoder.decode(bytes);

export const MAX_CARTRIDGE = 256 * 1024 * 1024;
export const MAX_SIMULATION = 32 * 1024 * 1024;
export const MAX_CARD = 2 * 1024 * 1024 + 8192;
export const CARTRIDGE_MAGIC = [71, 87, 65, 70, 0];
export const CARTRIDGE_VERSION = 3;
export const HEADER_SIZE = 22;
export const SIGNATURE_SIZE = 96;

function inflateSection(bytes, size) {
  // fflate caps the returned length at the buffer size. Leave one byte to detect overflow.
  const plain = inflateSync(bytes, {out:new Uint8Array(size + 1)});
  if (plain.length !== size) throw Error('Invalid expanded cartridge section length');
  return plain;
}

export function unpack(bytes, { simulation = false } = {}) {
  if (bytes.length > MAX_CARTRIDGE || !CARTRIDGE_MAGIC.every((value,index)=>bytes[index]===value)) {
    throw Error('Invalid GameWaffle cartridge');
  }
  const legacy = bytes[5] === 2;
  if (!legacy && bytes[5] !== CARTRIDGE_VERSION) throw Error('Unsupported GameWaffle cartridge format');
  const headerSize = legacy ? 14 : HEADER_SIZE;
  const end = bytes.length - SIGNATURE_SIZE;
  if (end <= headerSize) throw Error('Invalid cartridge section lengths');
  const header = new DataView(bytes.buffer, bytes.byteOffset, headerSize);
  const simulationPacked = header.getUint32(6, true);
  const simulationSize = header.getUint32(10, true);
  const cardSize = legacy ? 0 : header.getUint32(14, true);
  const mediaSize = legacy ? 0 : header.getUint32(18, true);
  const simulationStart = headerSize + cardSize;
  const mediaStart = simulationStart + simulationPacked;
  if ((!legacy && !cardSize) || cardSize > MAX_CARD || !simulationPacked ||
      !simulationSize || simulationSize > MAX_SIMULATION || mediaStart >= end || mediaSize > MAX_CARTRIDGE) {
    throw Error('Invalid cartridge section lengths');
  }
  const media = bytes.subarray(mediaStart, end);
  let mediaData = mediaSize ? inflateSection(media, mediaSize) : media;
  if (mediaSize && typeof Buffer !== 'undefined' && Buffer.isBuffer(media)) {
    mediaData = Buffer.from(mediaData.buffer, mediaData.byteOffset, mediaData.byteLength);
  }
  const cart = decodeCbor(mediaData);
  if (!legacy) {
    const {name, locale, coverArt, runtimeAbi} = decodeCbor(bytes.subarray(headerSize, simulationStart));
    Object.assign(cart, {name, runtimeAbi}, locale === undefined ? {} : {locale}, coverArt === undefined ? {} : {coverArt});
  }
  if (simulation) {
    const data = inflateSection(bytes.subarray(simulationStart, mediaStart), simulationSize);
    Object.assign(cart, decodeCbor(data));
  }
  if (!cart?.rooms || !Object.hasOwn(cart.rooms,cart.start) || !Object.hasOwn(cart.atlases??{},cart.start)) {
    throw Error('Cartridge is missing the starting room');
  }
  return cart;
}
