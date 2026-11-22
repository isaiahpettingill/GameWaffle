import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { encode as encodeQoa } from 'qoa-format';
import { readAseprite, tagFrames } from './ase.mjs';
import { decodeCbor, pack } from './cartridge.mjs';
import { Blocks, Events, Opcodes } from './schema.mjs';
import { instanceNames } from './instances.mjs';

export function projectPath(root, file) {
  const target = resolve(root, file);
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel))
    throw Error('File must be within the project folder');
  return target;
}

const safe = name => typeof name === 'string' && /^[a-zA-Z0-9_-]+$/.test(name)
  && !['__proto__', 'constructor', 'prototype'].includes(name);
const key = (name, label) => { if (!safe(name)) throw Error(`Invalid ${label} ID: ${name}`); return name; };
const number = (n, min, max, label) => {
  if (!Number.isFinite(n) || n < min || n > max) throw Error(`Invalid ${label}: ${n}`);
  return n;
};
const integer = (n, min, max, label) => {
  if (!Number.isInteger(n)) throw Error(`Expected an integer for ${label}`);
  return number(n, min, max, label);
};
const modes = ['none','static','dynamic','kinematic','sensor','ladder','one_way','breakable','fluid'];

function props(value = {}, defaultMode) {
  const mode = value.mode ?? defaultMode;
  if (!modes.includes(mode)) throw Error(`Unknown physics mode: ${mode}`);
  if (value.mass != null) number(value.mass, .0001, 100_000, 'mass');
  return { mode, mass: value.mass, density: number(value.density ?? 1, .0001, 100_000, 'density'),
    friction: number(value.friction ?? .35, 0, 1, 'friction'), elasticity: number(value.elasticity ?? 0, 0, 1, 'elasticity'),
    category: integer(value.category ?? 1, 1, 65535, 'collision category'),
    mask: integer(value.mask ?? 65535, 0, 65535, 'collision mask'),
    group: integer(value.group ?? 0, -32768, 32767, 'collision group'),
    gravity: number(value.gravity ?? 1, -8, 8, 'gravity scale'), fixed: value.fixed ?? true,
    health: number(value.health ?? 1, .001, 1_000_000, 'health'),
    buoyancy: number(value.buoyancy ?? .75, 0, 4, 'fluid buoyancy'),
    drag: number(value.drag ?? 2, 0, 20, 'fluid drag'), damage: number(value.damage ?? 0, 0, 100_000, 'fluid damage per second') };
}

export function scriptCode(script) {
  return Object.fromEntries(Object.entries(script.events ?? {}).map(([event, list]) => {
    if (!Events.includes(event) || !Array.isArray(list) || list.length > 256) throw Error(`Invalid event: ${event}`);
    return [event, list.map(block => {
      if (!Object.hasOwn(Blocks, block.op)) throw Error(`Invalid block: ${block.op}`);
      return [Opcodes[block.op], ...Blocks[block.op][1].map(([field, type, defaultValue]) => {
        const value = block[field] ?? defaultValue;
        if (type === 'number') return number(value, -10000, 10000, field);
        if (type === 'text' && typeof value === 'string' && value.length <= 96) return value;
        if (Array.isArray(type) && type.includes(value)) return value;
        throw Error(`Invalid block value for ${field}`);
      })];
    })];
  }));
}

function blit(src, dest, x, y) {
  for (let row = 0; row < src.height; row++) {
    const from = row * src.width * 4;
    const to = ((row + y) * dest.width + x) * 4;
    src.rgba.copy(dest.rgba, to, from, from + src.width * 4);
  }
}

function transformed(source, flags) {
  const rotate = flags.includes('rot-90');
  const width = rotate ? source.height : source.width, height = rotate ? source.width : source.height;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const mx = flags.includes('mirror-x') ? source.width - x - 1 : x;
    const my = flags.includes('mirror-y') ? source.height - y - 1 : y;
    const dx = rotate ? source.height - my - 1 : mx, dy = rotate ? mx : my;
    const from = (y * source.width + x) * 4;
    source.rgba.copy(rgba, (dy * width + dx) * 4, from, from + 4);
  }
  return { width, height, rgba };
}

function atlas(images) {
  const list = [...images].sort((a,b) => b[1].height - a[1].height || b[1].width - a[1].width);
  const width = Math.max(512, ...list.map(([, image]) => image.width));
  let x = 0, y = 0, height = 0;
  const entries = Object.create(null);
  for (const [id, image] of list) {
    if (x + image.width > width) { x = 0; y += height + 1; height = 0; }
    entries[id] = [x, y, image.width, image.height];
    x += image.width + 1;
    height = Math.max(height, image.height);
  }
  if (width > 4096 || y + height > 4096) throw Error('Room atlas exceeds 4096 pixels per side');
  const image = new PNG({ width, height: Math.max(1, y + height) });
  for (const [id, source] of list) blit(source, { width, rgba: image.data }, ...entries[id]);
  return { entries, png: PNG.sync.write(image) };
}

function wavToQoa(b) {
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw Error('Invalid WAV header');
  let format, data;
  for (let offset = 12; offset + 8 <= b.length;) {
    const size = b.readUInt32LE(offset + 4);
    if (offset + 8 + size > b.length) throw Error('Truncated WAV chunk');
    const chunk = b.subarray(offset + 8, offset + 8 + size);
    if (b.toString('ascii', offset, offset + 4) === 'fmt ') format = chunk;
    if (b.toString('ascii', offset, offset + 4) === 'data') data = chunk;
    offset += 8 + size + size % 2;
  }
  if (!format || !data || format.length < 16) throw Error('WAV is missing format or samples');
  let type = format.readUInt16LE(0);
  if (type === 0xfffe && format.length >= 40) type = format.readUInt16LE(24);
  const channels = format.readUInt16LE(2), sampleRate = format.readUInt32LE(4), bits = format.readUInt16LE(14);
  const bytes = bits / 8;
  if (![1,2].includes(channels) || !sampleRate || sampleRate > 384000 || !(type === 1 && [8,16,24,32].includes(bits) || type === 3 && bits === 32))
    throw Error('Use mono or stereo PCM or float32 WAV, or set compress to false');
  const count = Math.floor(data.length / bytes / channels);
  if (!count) throw Error('WAV contains no complete samples');
  const channelData = Array.from({ length: channels }, () => new Float32Array(count));
  for (let i = 0; i < count; i++) for (let c = 0; c < channels; c++) {
    const offset = (i * channels + c) * bytes;
    const value = type === 3 ? data.readFloatLE(offset) : bits === 8 ? (data[offset] - 128) / 128
      : data.readIntLE(offset, bytes) / (2 ** (bits - 1));
    channelData[c][i] = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  }
  return encodeQoa({ channelData, sampleRate });
}

export async function discoverAssets(root) {
  const result = [];
  async function walk(path) {
    for (const entry of await readdir(resolve(root, path), { withFileTypes: true })) {
      const file = path + '/' + entry.name;
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && /\.(ase|aseprite|wav|opus|ogg|oga|qoa)$/i.test(entry.name)) result.push(file);
    }
  }
  await walk('assets').catch(error => { if (error.code !== 'ENOENT') throw error; });
  return result.sort();
}

export async function describeArt(root) {
  const files = (await discoverAssets(root)).filter(file => /\.(ase|aseprite)$/i.test(file));
  const descriptions = await Promise.all(files.map(async file => {
    try {
      const ase = readAseprite(await readFile(projectPath(root, file)));
      return [file, { tags: ase.tags.map(tag => tag.name), width: ase.width, height: ase.height }];
    } catch (error) {
      return [file, { error: error.message, tags: [] }];
    }
  }));
  return Object.fromEntries(descriptions);
}

export async function compileProject(root, { project: draft, scripts = new Map() } = {}) {
  const project = draft ?? JSON.parse(await readFile(resolve(root, 'project.json'), 'utf8'));
  const frames = new Map(), sources = new Map();
  async function source(file) {
    if (!sources.has(file)) sources.set(file, readAseprite(await readFile(projectPath(root, file))));
    return sources.get(file);
  }
  function register(id, ase, index, flags = []) {
    const frame = ase.frames[index];
    const base = { width: ase.width, height: ase.height, rgba: frame.rgba };
    frames.set(id, flags.length ? transformed(base, flags) : base);
    return { image: id, ms: frame.duration };
  }

  const sprites = Object.create(null);
  for (const [id, sprite] of Object.entries(project.sprites ?? {})) {
    key(id, 'sprite');
    const ase = await source(sprite.source);
    const all = ase.frames.map((_, i) => register(`sprite/${id}/${i}`, ase, i));
    const clips = Object.create(null);
    clips.default = { frames: all, repeat: 0 };
    for (const tag of ase.tags) clips[tag.name] = { frames: tagFrames(tag).map(i => all[i]), repeat: tag.repeat };
    let code = {};
    if (sprite.script) {
      try {
        code = scriptCode(scripts.get(id) ?? decodeCbor(await readFile(projectPath(root, sprite.script))));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    sprites[id] = { clips, code, physics: props(sprite.physics, 'none'), width: sprite.width ?? ase.width,
      height: sprite.height ?? ase.height, layer: sprite.layer ?? 0, animation: sprite.animation ?? 'default',
      team: sprite.team ?? 0, projectile: sprite.projectile };
    number(sprites[id].width, 1, 8192, 'sprite width');
    number(sprites[id].height, 1, 8192, 'sprite height');
  }
  for (const [id, sprite] of Object.entries(sprites)) {
    for (const instructions of Object.values(sprite.code)) {
      for (const [opcode, target] of instructions) {
        if (opcode === Opcodes.spawn && !Object.hasOwn(sprites, target)) {
          throw Error(`Sprite "${id}" adds an instance of unknown sprite "${target}"`);
        }
      }
    }
  }
  const size = integer(project.tileSize ?? 24, 4, 128, 'tile size');
  const tiles = Object.create(null);
  for (const [id, tile] of Object.entries(project.tiles ?? {})) {
    key(id, 'tile');
    const ase = await source(tile.source);
    const tag = tile.tag ? ase.tags.find(entry => entry.name === tile.tag) : ase.tags[0];
    if (tile.tag && !tag) throw Error(`Missing tile tag "${tile.tag}" for ${id}`);
    const flags = (tag?.name ?? '').split(':').slice(1, -1).filter(flag => ['animated','fluid','mirror-x','mirror-y','rot-90'].includes(flag));
    const indices = tag ? tagFrames(tag) : ase.frames.map((_, i) => i);
    const animated = flags.includes('animated') || flags.includes('fluid');
    const variants = animated ? [indices] : indices.map(i => [i]);
    tiles[id] = {
      variants: variants.map((indices, v) => indices.map((i, f) => register(`tile/${id}/${v}/${f}`, ase, i, flags))),
      physics: props(tile.physics, flags.includes('fluid') ? 'fluid' : 'static'),
    };
    for (const variant of tiles[id].variants) for (const frame of variant) {
      const image = frames.get(frame.image);
      if (image.width !== size || image.height !== size) throw Error(`${id}: tile art must be ${size}×${size}`);
    }
  }

  const audio = Object.create(null);
  for (const [id, config] of Object.entries(project.audio ?? {})) {
    key(id, 'audio');
    const asset = typeof config === 'string' ? { source: config } : config;
    const extension = extname(asset.source).slice(1).toLowerCase();
    if (!['wav','ogg','oga','opus','qoa'].includes(extension)) throw Error(`Unsupported audio format: ${extension}`);
    const data = await readFile(projectPath(root, asset.source));
    audio[id] = extension === 'wav' && asset.compress !== false
      ? { format: 'qoa', data: wavToQoa(data) } : { format: extension, data };
  }

  const rooms = Object.create(null), atlases = Object.create(null);
  for (const [id, room] of Object.entries(project.rooms ?? {})) {
    key(id, 'room');
    const cols = integer(room.cols, 1, Math.floor(4096 / size), 'room columns');
    const rows = integer(room.rows, 1, Math.floor(4096 / size), 'room rows');
    const width = cols * size, height = rows * size;
    const view = room.view ?? (Math.abs(room.gravity ?? 24) < .01 ? 'top_down' : 'platformer');
    if (!['platformer','top_down'].includes(view)) throw Error(`Unknown room view: ${view}`);
    const gravity = view === 'top_down' ? 0 : number(room.gravity ?? 24, -100, 100, 'room gravity');
    const ySort = room.ySort ?? view === 'top_down';
    const images = new Map(), baked = [], entities = [], solids = [], blockers = new Set();
    const usedSprites = new Set();
    function includeSprite(sprite) {
      if (usedSprites.has(sprite)) return;
      const definition = sprites[sprite];
      if (!definition) throw Error(`Unknown sprite: ${sprite}`);
      usedSprites.add(sprite);
      for (const clip of Object.values(definition.clips)) for (const frame of clip.frames) images.set(frame.image, frames.get(frame.image));
      if (definition.projectile) includeSprite(definition.projectile);
      for (const instructions of Object.values(definition.code)) {
        for (const [opcode, target] of instructions) {
          if (opcode === Opcodes.spawn) includeSprite(target);
        }
      }
    }
    const players = new Set();
    const names = instanceNames(room.entities ?? []);
    const usedNames = new Set();
    for (const [index, entry] of (room.entities ?? []).entries()) {
      includeSprite(entry.sprite);
      const name = names[index];
      if (typeof name !== 'string' || !name.trim() || name.length > 64 || /[\x00-\x1f\x7f]/.test(name)) {
        throw Error(`Invalid instance name in room "${id}"`);
      }
      if (usedNames.has(name)) throw Error(`Duplicate instance name "${name}" in room "${id}"`);
      usedNames.add(name);
      const definition = sprites[entry.sprite];
      if (entry.layer != null) integer(entry.layer, -10000, 10000, 'instance visual layer');
      const animation = entry.animation != null && Object.hasOwn(definition.clips, entry.animation) ? entry.animation : undefined;
      if (entry.flipX != null && typeof entry.flipX !== 'boolean') throw Error(`Invalid facing for instance "${name}"`);
      number(entry.x, 0, width, 'entity x');
      number(entry.y, 0, height, 'entity y');
      if (entry.player != null) {
        integer(entry.player, 0, 3, 'player slot');
        if (players.has(entry.player)) throw Error(`Duplicate player slot in ${id}`);
        players.add(entry.player);
      }
      const physics = entry.physics ? props({ ...definition.physics, ...entry.physics }, definition.physics.mode) : undefined;
      entities.push({ ...entry, name, animation, physics });
    }
    for (const sound of [room.music, room.ambience].filter(Boolean)) {
      if (!Object.hasOwn(audio, sound)) throw Error(`Unknown room audio: ${sound}`);
    }
    for (const [index, layer] of (room.layers ?? []).entries()) {
      const order = integer(layer.order ?? index, -10000, 10000, 'visual layer');
      const cells = new Map(), zone = new Map();
      let sheet;
      for (const cell of layer.cells ?? []) {
        const [x,y,tileId,variant] = cell;
        integer(x, 0, cols-1, 'tile x');
        integer(y, 0, rows-1, 'tile y');
        const tile = tiles[tileId];
        if (!tile) throw Error(`Unknown tile: ${tileId}`);
        if (cells.has(y * cols + x)) throw Error(`Duplicate tile in room ${id} at ${x}, ${y}`);
        cells.set(y * cols + x, cell);
        const clip = tile.variants[variant ?? ((x * 37 + y * 17) % tile.variants.length)];
        if (!clip) throw Error(`Unknown variant for ${tileId}`);
        const physics = layer.collidable ? tile.physics : { ...tile.physics, mode: 'none' };
        const dynamic = !['static','none'].includes(physics.mode);
        if (!dynamic && clip.length === 1) {
          sheet ??= { width, height, rgba: Buffer.alloc(width * height * 4) };
          blit(frames.get(clip[0].image), sheet, x * size, y * size);
        } else {
          for (const frame of clip) images.set(frame.image, frames.get(frame.image));
          entities.push({ x: (x+.5)*size, y:(y+.5)*size, tile: tileId, clip,
            physics: physics.mode === 'static' ? { ...physics, mode: 'none' } : physics, layer: order });
        }
        if (physics.mode === 'static') {
          zone.set(y * cols + x, physics);
          blockers.add(y * cols + x);
        }
      }
      if (sheet) {
        const image = `layer/${index}`;
        images.set(image, sheet);
        baked.push({ image, layer: order });
      }
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols;) {
        const physics = zone.get(y * cols + x);
        if (!physics) { x++; continue; }
        let end = x + 1;
        while (end < cols && zone.get(y * cols + end) === physics) end++;
        solids.push({ x: (x + end)*size/2, y: (y+.5)*size, width: (end-x)*size, height:size, physics });
        x = end;
      }
    }
    if (room.closedEdges ?? view === 'top_down') {
      const physics = props(undefined, 'static');
      solids.push(
        { x: -size/2, y: height/2, width: size, height: height+size*2, physics },
        { x: width+size/2, y: height/2, width: size, height: height+size*2, physics },
        { x: width/2, y: -size/2, width, height:size, physics },
        { x: width/2, y: height+size/2, width, height:size, physics },
      );
    }
    atlases[id] = atlas(images);
    rooms[id] = { title: room.title ?? id, cols, rows, width, height, size, baked, solids, entities,
      blockers: [...blockers], background: room.background ?? '#101a23', music: room.music,
      ambience: room.ambience, gravity, view, ySort };
  }
  const start = project.start ?? Object.keys(rooms)[0];
  if (!Object.hasOwn(rooms, start)) throw Error('Choose a valid starting room');
  function thumbnail(frame) {
    const { width, height, rgba: data } = frames.get(frame.image);
    return PNG.sync.write({ width, height, data });
  }
  const tilePreviews = Object.fromEntries(Object.entries(tiles).map(([id, tile]) =>
    [id, { mode: tile.physics.mode, variants: tile.variants.map(clip => thumbnail(clip[0])) }]));
  const spritePreviews = Object.fromEntries(Object.entries(sprites).map(([id, sprite]) =>
    [id, thumbnail((sprite.clips[sprite.animation] ?? sprite.clips.default).frames[0])]));
  return { name: project.name ?? 'GameWaffle game', start, rooms, atlases, sprites, audio,
    tilePreviews, spritePreviews };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(process.argv[2] ?? 'demo');
  const output = resolve(process.argv[3] ?? 'web-built/demo.waffle');
  const bytes = pack(await compileProject(root));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes);
  console.log(`Built ${output} (${bytes.length} bytes)`);
}
