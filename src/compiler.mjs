import {bakeRoomShader} from './room-shaders.mjs';
import {addSeams} from './seams.mjs';
import {pack} from './pack.mjs';
import {defaultFont} from './font.mjs';
import { effects, platformGravity, roomBorder } from './schema.mjs';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { encode as encodeQoa } from 'qoa-format';
import { readAseprite, tagFrames } from './ase.mjs';
import { decodeCbor } from './cartridge.mjs';
import {loadModules} from './modules.mjs';
import {parseScript} from './wafflescript.mjs';
import { compileScript, tileSizes, variableName } from './script.mjs';
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
  const pixels = list.reduce((total,[,image])=>total+(image.width+1)*(image.height+1),0);
  const estimate = 2 ** Math.ceil(Math.log2(Math.sqrt(Math.max(1,pixels))));
  const width = Math.max(512,Math.min(4096,estimate),...list.map(([,image])=>image.width));
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

const artFile = /\.(ase|aseprite|png)$/i;
const assetFile = /\.(ase|aseprite|png|wav|opus|ogg|oga|qoa)$/i;
async function readArt(file,read) {
  const data=await read(file);
  if(!file.toLowerCase().endsWith('.png'))return readAseprite(data);
  if(data.length<24||data.readUInt32BE(16)>4096||data.readUInt32BE(20)>4096)throw Error('PNG exceeds 4096 pixels per side');
  const {width,height,data:rgba}=PNG.sync.read(data);
  return {width,height,tags:[],frames:[{duration:100,rgba}]};
}
export async function discoverAssets(root,store) {
  if(store)return (await store.list('assets')).filter(file=>assetFile.test(file)).sort();
  const result = [];
  async function walk(path) {
    for (const entry of await readdir(resolve(root, path), { withFileTypes: true })) {
      const file = path + '/' + entry.name;
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && assetFile.test(entry.name)) result.push(file);
    }
  }
  await walk('assets').catch(error => { if (error.code !== 'ENOENT') throw error; });
  return result.sort();
}

export async function describeArt(root,store) {
  const files = (await discoverAssets(root,store)).filter(file => artFile.test(file));
  const descriptions = await Promise.all(files.map(async file => {
    try {
      const ase = await readArt(file,store?.read ?? (name=>readFile(projectPath(root,name))));
      return [file, { tags: ase.tags.map(tag => tag.name), width: ase.width, height: ase.height }];
    } catch (error) {
      return [file, { error: error.message, tags: [] }];
    }
  }));
  return Object.fromEntries(descriptions);
}

export async function compileProject(root, { project: draft, scripts = new Map(), store } = {}) {
  if (!store && root.endsWith('.waffleproj')) store=await (await import('./project-store.mjs')).projectStore(root);
  const read = store?.read ?? ((name,encoding)=>readFile(projectPath(root,name),encoding));
  const project = draft ?? JSON.parse(await read('project.json','utf8'));
  const frames = new Map(), sources = new Map();
  async function source(file) {
    if (!sources.has(file)) sources.set(file, await readArt(file,read));
    return sources.get(file);
  }
  function register(id, ase, index, flags = []) {
    const frame = ase.frames[index];
    const base = { width: ase.width, height: ase.height, rgba: frame.rgba };
    frames.set(id, flags.length ? transformed(base, flags) : base);
    return { image: id, ms: frame.duration };
  }

  const sprites = Object.create(null), dependencies = new Map();
  for (const [id, sprite] of Object.entries(project.sprites ?? {})) {
    key(id, 'sprite');
    const ase = await source(sprite.source);
    const all = ase.frames.map((_, i) => register(`sprite/${id}/${i}`, ase, i));
    const clips = Object.create(null);
    clips.default = { frames: all, repeat: 0 };
    for (const tag of ase.tags) clips[tag.name] = { frames: tagFrames(tag).map(i => all[i]), repeat: tag.repeat };
    let script = { events:{}, dependencies:new Set() };
    if (sprite.script) {
      try {
        const unit=scripts.get(id) ?? (sprite.script.endsWith('.ws') ? parseScript(await read(sprite.script,'utf8')) : decodeCbor(await read(sprite.script)));
        script=compileScript(unit,await loadModules(unit,read));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if(sprite.emitter && (!effects.includes(sprite.emitter.effect) || !Number.isInteger(sprite.emitter.rate) || sprite.emitter.rate<1 || sprite.emitter.rate>240))throw Error('Invalid particle emitter for '+id);
    dependencies.set(id,script.dependencies);
    sprites[id] = { clips, program:script.events, physics: props(sprite.physics, 'none'), width: sprite.width ?? ase.width,
      height: sprite.height ?? ase.height, layer: sprite.layer ?? 0, animation: sprite.animation ?? 'default',
      emitter:sprite.emitter??null, alwaysActive:sprite.alwaysActive??false, team: sprite.team ?? 0, projectile: sprite.projectile };
    number(sprites[id].width, 1, 8192, 'sprite width');
    number(sprites[id].height, 1, 8192, 'sprite height');
  }
  for (const [id, targets] of dependencies) for (const target of targets) {
    if (!Object.hasOwn(sprites,target)) throw Error(`Sprite "${id}" adds an instance of unknown sprite "${target}"`);
  }
  const size = project.tileSize ?? 24;
  if (!tileSizes.includes(size)) throw Error('Set the tile size to 8, 16, 24, or 32 pixels');
  function variables(values, flags) {
    return Object.fromEntries(Object.entries(values ?? {}).map(([name,value])=>{
      if (!variableName(name) || !(flags ? typeof value === 'boolean' : Number.isSafeInteger(value))) {
        throw Error(`Invalid initial value for ${name}`);
      }
      return [name,value];
    }));
  }
  const globals = variables(project.variables,false), flags = variables(project.flags,true);
  function conditions(...sources){
    return sources.filter(s=>s?.flag).map(s=>{
      if(!Object.hasOwn(flags,s.flag))throw Error('Unknown condition flag: '+s.flag);
      return [s.flag,s.when??true];
    });
  }
  const camera = {
    min_width:integer(project.camera?.min_width??128,128,512,'camera minimum width'),
    min_height:integer(project.camera?.min_height??128,128,512,'camera minimum height'),
    max_width:integer(project.camera?.max_width??512,128,512,'camera maximum width'),
    max_height:integer(project.camera?.max_height??512,128,512,'camera maximum height'),
    zoom:integer(project.camera?.zoom??2,1,8,'camera pixel zoom'),
  };
  if (camera.min_width>camera.max_width || camera.min_height>camera.max_height) throw Error('Camera minimum exceeds maximum');
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
    const data = await read(asset.source);
    audio[id] = extension === 'wav' && asset.compress !== false
      ? { format: 'qoa', data: wavToQoa(data) } : { format: extension, data };
  }

  const items={},itemIcons=new Map();
  for(const [id,item] of Object.entries(project.items??{})){
    if(!variableName(id))throw Error('Invalid item ID '+id);
    if(item.flag && !variableName(item.flag))throw Error('Invalid item flag '+item.flag);
    items[id]={consumable:item.consumable===true,flag:item.flag||null};
    if(item.icon){const art=await source(item.icon);itemIcons.set('ui/item/'+id,{width:art.width,height:art.height,rgba:art.frames[0].rgba});}
  }
  let font=defaultFont();
  if(project.font){
    const image=await source(project.font);
    if(image.width!==96 || image.height!==48)throw Error('Use a 96 × 48 pixel bitmap font sheet');
    font={width:96,height:48,rgba:image.frames[0].rgba};
  }
  const rooms = Object.create(null), atlases = Object.create(null);
  for (const [id, room] of Object.entries(project.rooms ?? {})) {
    key(id, 'room');
    const cols = integer(room.cols, 1, Math.floor(4096 / size), 'room columns');
    const rows = integer(room.rows, 1, Math.floor(4096 / size), 'room rows');
    const width = cols * size, height = rows * size;
    const view = room.view ?? (Math.abs(room.gravity ?? platformGravity) < .01 ? 'top_down' : 'platformer');
    if (!['platformer','top_down'].includes(view)) throw Error(`Unknown room view: ${view}`);
    const gravity = view === 'top_down' ? 0 : number(room.gravity ?? platformGravity, -100, 100, 'room gravity');
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
      for (const target of dependencies.get(sprite)) includeSprite(target);
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
      entities.push({ ...entry,persistence:entry.persistRemoval?'sprite/'+name:null, conditions:conditions(project.sprites[entry.sprite],entry), name, animation, physics });
    }
    for (const sound of [room.music, room.ambience].filter(Boolean)) {
      if (!Object.hasOwn(audio, sound)) throw Error(`Unknown room audio: ${sound}`);
    }
    for (const [index, layer] of (room.layers ?? []).entries()) {
      const order = integer(layer.order ?? index, -10000, 10000, 'visual layer');
      const cells = new Map(), zone = new Map();
      const chunks = new Map();
      const chunkSize = Math.floor(256/size);
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
        const gates=conditions(layer,project.tiles[tileId]);
        const dynamic = gates.length>0 || !['static','none'].includes(physics.mode);
        if (!dynamic && clip.length === 1) {
          const col = Math.floor(x/chunkSize)*chunkSize, row = Math.floor(y/chunkSize)*chunkSize;
          const image = `layer/${index}/${col}/${row}`;
          if (!chunks.has(image)) {
            const w = Math.min(chunkSize,cols-col)*size, h = Math.min(chunkSize,rows-row)*size;
            chunks.set(image,{width:w,height:h,rgba:Buffer.alloc(w*h*4),x:col*size,y:row*size});
          }
          const chunk = chunks.get(image);
          blit(frames.get(clip[0].image),chunk,x*size-chunk.x,y*size-chunk.y);
        } else {
          for (const frame of clip) images.set(frame.image, frames.get(frame.image));
          entities.push({ x: (x+.5)*size, y:(y+.5)*size, tile: tileId, clip,persistence:project.tiles[tileId].persistRemoval?`tile/${index}/${x}/${y}`:null,
            conditions:gates, blocker:gates.length && physics.mode==='static'?y*cols+x:null,
            physics: !gates.length && physics.mode === 'static' ? { ...physics, mode: 'none' } : physics, layer: order });
        }
        if (!gates.length && physics.mode === 'static') {
          zone.set(y * cols + x, physics);
          blockers.add(y * cols + x);
        }
      }
      for (const [image,chunk] of chunks) {
        images.set(image,chunk);
        baked.push({image,layer:order,x:chunk.x,y:chunk.y});
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
    const border = roomBorder(room, view === 'top_down');
    if (!['closed','sides','open'].includes(border)) throw Error('Invalid room border');
    if (border !== 'open') {
      const physics = props(undefined, 'static');
      const walls={
        left:{x:-size/2,y:height/2,width:size,height:height+size*16},
        right:{x:width+size/2,y:height/2,width:size,height:height+size*16},
        up:{x:width/2,y:-size/2,width,height:size},
        down:{x:width/2,y:height+size/2,width,height:size},
      };
      for(const edge of border==='closed'?Object.keys(walls):['left','right']){
        const exit=room.exits?.[edge],opposite={left:'right',right:'left',up:'down',down:'up'}[edge];
        const back=project.rooms[exit?.targets?.[0]]?.exits?.[opposite];
        if(exit?.adjacent && exit.mode==='fixed' && !exit.flag && back?.adjacent && back.mode==='fixed' && !back.flag && back.targets[0]===id)continue;
        solids.push({...walls[edge],physics});
      }
    }
    const ripple = bakeRoomShader(room.shader,images);
    images.set('ui/font',font);for(const [id,image] of itemIcons)images.set(id,image);
    const exits={};
    for(const [edge,exit] of Object.entries(room.exits??{})){
      if(!['left','right','up','down'].includes(edge)||!['fixed','save','crossing'].includes(exit.mode)
        || !exit.targets?.length || exit.targets.some(t=>!Object.hasOwn(project.rooms,t)))throw Error('Invalid exit in '+id);
      if(exit.flag && !Object.hasOwn(flags,exit.flag))throw Error('Unknown exit flag in '+id);
      exits[edge]={mode:exit.mode,targets:exit.targets,flag:exit.flag||null,when:exit.when??true,adjacent:exit.adjacent??false};
    }
    atlases[id] = atlas(images);
    rooms[id] = { title: room.title ?? id, ripple, exits, cols, rows, width, height, size, baked, solids, entities,
      blockers: [...blockers], background: room.background ?? '#101a23', music: room.music,
      ambience: room.ambience, group_camera:room.groupCamera===true, gravity, view, ySort };
  }
  addSeams(rooms,atlases,sprites,atlas);
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
  return { items,saveId:project.saveId??project.name, name: project.name ?? 'GameWaffle game', start, rooms, atlases, sprites, audio, globals, flags, camera,
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
