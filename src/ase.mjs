import { inflateSync } from 'node:zlib';

const word = (b, i) => b.readUInt16LE(i);
const dword = (b, i) => b.readUInt32LE(i);
const string = (b, i) => b.toString('utf8', i + 2, i + 2 + word(b, i));

export function readAseprite(data) {
  if (data.length < 128 || word(data, 4) !== 0xa5e0) throw Error('Invalid Aseprite header');
  const count = word(data, 6), width = word(data, 8), height = word(data, 10);
  const depth = word(data, 12), transparent = data[28], useLayerOpacity = dword(data, 14) & 1;
  if (![8, 16, 32].includes(depth) || !count || !width || !height || width * height * count > 120_000_000)
    throw Error('Unsupported Aseprite dimensions or color depth');
  const layers = [], frames = [], tags = [];
  const palette = Array.from({ length: 256 }, (_, i) => [i, i, i, 255]);
  let offset = 128, modernPalette = false;
  for (let frame = 0; frame < count; frame++) {
    const end = offset + dword(data, offset);
    if (word(data, offset + 4) !== 0xf1fa || end > data.length || end < offset + 16) throw Error('Invalid Aseprite frame');
    const shortCount = word(data, offset + 6);
    const chunks = shortCount === 0xffff ? dword(data, offset + 12) : shortCount;
    const duration = word(data, offset + 8) || 100;
    const cels = new Map();
    let cursor = offset + 16;
    for (let chunk = 0; chunk < chunks; chunk++) {
      const size = dword(data, cursor), type = word(data, cursor + 4);
      if (size < 6 || cursor + size > end) throw Error('Invalid Aseprite chunk');
      const b = data.subarray(cursor + 6, cursor + size);
      cursor += size;
      if (type === 0x2004) {
        const level = word(b, 4);
        let parent = -1;
        for (let index = layers.length - 1; index >= 0 && level; index--) {
          if (layers[index].level < level) { parent = index; break; }
        }
        layers.push({ flags: word(b, 0), kind: word(b, 2), parent, level, blend: word(b, 10),
          opacity: useLayerOpacity ? b[12] / 255 : 1, name: string(b, 16) });
      } else if (type === 0x2005) {
        const layer = word(b, 0), kind = word(b, 7);
        const base = { layer, x: b.readInt16LE(2), y: b.readInt16LE(4), alpha: b[6] / 255, z: b.readInt16LE(9) };
        if (kind === 1) {
          const source = frames[word(b, 16)]?.cels.get(layer);
          if (!source) throw Error('Invalid linked Aseprite cel');
          cels.set(layer, { ...source, ...base });
        } else if (kind === 0 || kind === 2) {
          const w = word(b, 16), h = word(b, 18), length = w * h * (depth / 8);
          if (length > 64_000_000) throw Error('Aseprite cel exceeds size limit');
          const pixels = kind === 0 ? b.subarray(20) : inflateSync(b.subarray(20), { maxOutputLength: length });
          if (pixels.length !== length) throw Error('Invalid Aseprite cel pixels');
          cels.set(layer, { ...base, w, h, pixels });
        } else if (kind === 3) {
          throw Error('Flatten native Aseprite tilemap layers to image layers before importing');
        }
      } else if (type === 0x2018) {
        let p = 10;
        for (let n = 0; n < word(b, 0); n++) {
          const from = word(b, p), to = word(b, p + 2), direction = b[p + 4], repeat = word(b, p + 5);
          const name = string(b, p + 17);
          if (from > to || to >= count || direction > 3) throw Error('Invalid Aseprite tag range or direction');
          tags.push({ name, from, to, direction, repeat });
          p += 19 + word(b, p + 17);
        }
      } else if (type === 0x2019 && depth === 8) {
        modernPalette = true;
        let p = 20;
        const first = dword(b, 4), last = dword(b, 8);
        if (last > 255 && depth === 8) throw Error('Indexed palette exceeds 256 colors');
        for (let i = first; i <= last; i++) {
          const flags = word(b, p);
          palette[i] = [...b.subarray(p + 2, p + 6)];
          p += 6;
          if (flags & 1) p += 2 + word(b, p);
        }
      } else if (depth === 8 && (type === 4 || type === 0x11) && !modernPalette) {
        if (frame === 0 && data.readUInt16LE(32) > 256) continue;
        let p = 2, index = 0;
        for (let n = 0; n < word(b, 0); n++) {
          index += b[p++];
          const length = b[p++] || 256;
          for (let j = 0; j < length; j++) {
            const rgb = [...b.subarray(p, p + 3)];
            palette[index++] = [...rgb.map(v => type === 0x11 ? Math.round(v * 255 / 63) : v), 255];
            p += 3;
          }
        }
      }
    }
    frames.push({ duration, cels, palette: palette.slice() });
    offset = end;
  }

  const visibility = layers.map(layer => ({ visible: Boolean(layer.flags & 1), opacity: layer.opacity }));
  for (let i = 0; i < layers.length; i++) {
    const parent = layers[i].parent;
    if (parent >= 0) {
      visibility[i].visible &&= visibility[parent].visible;
      visibility[i].opacity *= visibility[parent].opacity;
    }
  }
  for (const frame of frames) {
    const rgba = Buffer.alloc(width * height * 4);
    const sorted = [...frame.cels.values()].sort((a, b) => a.layer + a.z - b.layer - b.z || a.layer - b.layer);
    for (const cel of sorted) {
      const layer = layers[cel.layer], state = visibility[cel.layer];
      if (!state?.visible) continue;
      if (layer.blend !== 0) throw Error(`Layer "${layer.name}" uses an unsupported blend mode. Flatten it before importing.`);
      for (let row = Math.max(0, -cel.y); row < Math.min(cel.h, height - cel.y); row++) {
        for (let col = Math.max(0, -cel.x); col < Math.min(cel.w, width - cel.x); col++) {
          const source = (row * cel.w + col) * (depth / 8);
          const id = cel.pixels[source];
          let [r,g,b,a] = depth === 32 ? cel.pixels.subarray(source, source + 4)
            : depth === 16 ? [id,id,id,cel.pixels[source + 1]]
            : id === transparent && !(layer.flags & 8) ? [0,0,0,0] : frame.palette[id];
          a *= cel.alpha * state.opacity;
          const dest = ((row + cel.y) * width + col + cel.x) * 4;
          const behind = rgba[dest + 3] * (1 - a / 255);
          const total = a + behind;
          if (!total) continue;
          rgba[dest] = (r * a + rgba[dest] * behind) / total;
          rgba[dest+1] = (g * a + rgba[dest+1] * behind) / total;
          rgba[dest+2] = (b * a + rgba[dest+2] * behind) / total;
          rgba[dest+3] = total;
        }
      }
    }
    frame.rgba = rgba;
  }
  return { width, height, frames, tags };
}

export function tagFrames(tag) {
  const frames = Array.from({ length: tag.to - tag.from + 1 }, (_, i) => i + tag.from);
  if (tag.direction === 1 || tag.direction === 3) frames.reverse();
  if (tag.direction >= 2) frames.push(...frames.slice(1, -1).reverse());
  return frames;
}
