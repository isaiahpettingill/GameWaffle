import { crc32, deflateSync } from 'node:zlib';
import { PNG } from 'pngjs';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const end = chunk('IEND', Buffer.alloc(0));

function chunk(type, data) {
  const bytes = Buffer.allocUnsafe(12 + data.length);
  bytes.writeUInt32BE(data.length, 0);
  bytes.write(type, 4, 4, 'ascii');
  bytes.set(data, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, 8 + data.length)), 8 + data.length);
  return bytes;
}

export function encodePng(width, height, data) {
  const pixels = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const palette = new Map();
  for (let offset = 0; offset < pixels.byteLength; offset += 4) {
    const color = pixels.getUint32(offset);
    if (palette.has(color)) continue;
    if (palette.size === 256) {
      return PNG.sync.write({width, height, data}, {deflateLevel: 4, deflateStrategy: 0});
    }
    palette.set(color, palette.size);
  }

  const depth = palette.size <= 2 ? 1 : palette.size <= 4 ? 2 : palette.size <= 16 ? 4 : 8;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = 3;
  const colors = Buffer.allocUnsafe(palette.size * 3);
  const alpha = Buffer.allocUnsafe(palette.size);
  let alphaLength = 0;
  for (const [color, index] of palette) {
    colors[index * 3] = color >>> 24;
    colors[index * 3 + 1] = color >>> 16 & 255;
    colors[index * 3 + 2] = color >>> 8 & 255;
    alpha[index] = color & 255;
    if (alpha[index] !== 255) alphaLength = index + 1;
  }

  // Each row starts with PNG filter 0. Pack the leftmost index into the high bits.
  const stride = 1 + Math.ceil(width * depth / 8);
  const rows = Buffer.alloc(stride * height);
  for (let y = 0, offset = 0; y < height; y++) {
    const row = y * stride + 1;
    for (let x = 0; x < width; x++, offset += 4) {
      const bit = x * depth;
      rows[row + (bit >>> 3)] |= palette.get(pixels.getUint32(offset)) << (8 - depth - (bit & 7));
    }
  }
  const chunks = [signature, chunk('IHDR', header), chunk('PLTE', colors)];
  if (alphaLength) chunks.push(chunk('tRNS', alpha.subarray(0, alphaLength)));
  chunks.push(chunk('IDAT', deflateSync(rows, {level: 4})), end);
  return Buffer.concat(chunks);
}
