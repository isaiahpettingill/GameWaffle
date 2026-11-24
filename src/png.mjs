import {runCodec} from './asset-codec.mjs';

export function encodePng(width,height,data) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 0xffffffff || height > 0xffffffff || !(data instanceof Uint8Array)) {
    throw Error('Invalid RGBA image dimensions or data');
  }
  return runCodec('encode_png',width,height,data);
}

export function decodePng(bytes) {
  const image=runCodec('decode_png',bytes);
  return {width:image.readUInt32LE(0),height:image.readUInt32LE(4),data:image.subarray(8)};
}
