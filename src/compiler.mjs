import {createHash} from 'node:crypto';
import {atmospherePresets,bakeRoomShader,bakeShaderPreset} from './room-shaders.mjs';
import {compileColliders} from './colliders.mjs';
import {addSeams} from './seams.mjs';
import {generateMinimap} from './minimap.mjs';
import {byteCache} from './compile-cache.mjs';
import {pack} from './pack.mjs';
import {defaultFont,readBitfont} from './font.mjs';
import { initialScript, buttons, effects, platformGravity, roomBorder } from './schema.mjs';
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

function compileLocalization(config = {locale:'',tables:{}}) {
  const {locale,tables} = config;
  if (!tables || typeof tables!=='object' || Array.isArray(tables)) throw Error('Expected language tables');
  const languages = Object.keys(tables);
  if (!languages.length && locale==='') return {locale,tables:{}};
  if (!Object.hasOwn(tables,locale)) throw Error('Select a default language');
  if (languages.length>64) throw Error('Use up to 64 languages');
  const encoded = Object.fromEntries(Object.entries(tables).map(([language,entries])=>{
    if (!/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(language) || language.length>40)
      throw Error('Invalid language code: '+language);
    if (!entries || typeof entries!=='object' || Array.isArray(entries)) throw Error('Expected a text table for '+language);
    return [language,Object.fromEntries(Object.entries(entries).map(([id,translation])=>{
      if (!variableName(id) || !safe(id) || !Object.hasOwn(tables[locale],id))
        throw Error('Add text key to the default language: '+id);
      if (typeof translation!=='string' || Buffer.byteLength(translation)>4096)
        throw Error('Use up to 4096 bytes of text for '+id);
      return [id,translation];
    }))];
  }));
  return {locale,tables:encoded};
}

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

const atlasCache=byteCache(32*1024*1024);
function atlas(images) {
  const list = [...images].sort((a,b) => b[1].height - a[1].height || b[1].width - a[1].width);
  const hash=createHash('sha256');
  for(const [id,image] of list){
    hash.update(JSON.stringify([id,image.width,image.height]));
    hash.update(image.rgba);
  }
  const key=hash.digest('hex'), cached=atlasCache.get(key);
  if(cached)return cached;
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
  const png=PNG.sync.write(image);
  return atlasCache.put(key,{entries,png},png.length+list.length*96);
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
const assetFile = /\.(ase|aseprite|png|yaff|wav|opus|ogg|oga|qoa)$/i;
const artCache=byteCache(64*1024*1024);
async function readArt(file,read) {
  const data=await read(file);
  const png=file.toLowerCase().endsWith('.png');
  const key=createHash('sha256').update(png?'png':'ase').update(data).digest('hex');
  const cached=artCache.get(key);
  if(cached)return cached;
  let art;
  if(png){
    if(data.length<24||data.readUInt32BE(16)>4096||data.readUInt32BE(20)>4096)throw Error('PNG exceeds 4096 pixels per side');
    const {width,height,data:rgba}=PNG.sync.read(data);
    art={width,height,tags:[],frames:[{duration:100,rgba}]};
  }else art=readAseprite(data);
  return artCache.put(key,{...art,revision:key},art.frames.reduce((bytes,frame)=>bytes+frame.rgba.length,0));
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

export async function previewRoomArt(file, read, frame=0) {
  if (!file?.startsWith('assets/') || file.split('/').includes('..') || !artFile.test(file)) throw Error('Choose a project image');
  const {width,height,frames}=await readArt(file,read);
  if(!Number.isInteger(frame)||frame<0||!frames[frame])throw Error('Choose an available image frame');
  return PNG.sync.write({width,height,data:frames[frame].rgba});
}

async function compileCover(file,read) {
  if(!file)return;
  if(typeof file!=='string'||!file.startsWith('assets/')||file.split('/').includes('..')||!artFile.test(file))
    throw Error('Choose a project image for the cartridge cover');
  const {width,height,frames}=await readArt(file,read);
  const scale=Math.min(1,512/Math.max(width,height));
  const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  const source=frames[0].rgba;
  if(w===width&&h===height)return PNG.sync.write({width,height,data:source});
  const data=Buffer.alloc(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const offset=4*(Math.floor(y*height/h)*width+Math.floor(x*width/w));
    source.copy(data,4*(y*w+x),offset,offset+4);
  }
  return PNG.sync.write({width:w,height:h,data});
}

export async function inspectBitfont(config, read) {
  const {layout,glyphs}=await readBitfont(config,read,readArt);
  return {...layout,glyphCount:Object.keys(glyphs).length};
}

export async function describeArt(root,store) {
  const files = (await discoverAssets(root,store)).filter(file => artFile.test(file));
  const descriptions = await Promise.all(files.map(async file => {
    try {
      const ase = await readArt(file,store?.read ?? (name=>readFile(projectPath(root,name))));
      return [file, { tags: ase.tags.map(tag => tag.name), width: ase.width, height: ase.height, frames:ase.frames.length, revision:ase.revision }];
    } catch (error) {
      return [file, { error: error.message, tags: [] }];
    }
  }));
  return Object.fromEntries(descriptions);
}

function tileClips(id,tile,ase,size) {
  if(ase.width!==size || ase.height!==size)throw Error(`${id}: tile art must be ${size}×${size}`);
  const tag = tile.tag ? ase.tags.find(entry => entry.name === tile.tag) : ase.tags[0];
  if (tile.tag && !tag) throw Error(`Missing tile tag "${tile.tag}" for ${id}`);
  const flags = (tag?.name ?? '').split(':').slice(1, -1).filter(flag => ['animated','fluid','mirror-x','mirror-y','rot-90'].includes(flag));
  const indices = tag ? tagFrames(tag) : ase.frames.map((_, i) => i);
  const animated = flags.includes('animated') || flags.includes('fluid');
  const variants = animated ? [indices] : indices.map(i => [i]);
  return {flags,variants};
}

export async function previewTiles(tiles,size,read) {
  const sources=new Map(), result=Object.create(null);
  for(const [id,tile] of Object.entries(tiles)){
    key(id,'tile');
    if(!sources.has(tile.source))sources.set(tile.source,await readArt(tile.source,read));
    const ase=sources.get(tile.source);
    const {flags,variants}=tileClips(id,tile,ase,size);
    result[id]={mode:tile.physics?.mode??(flags.includes('fluid')?'fluid':'static'),variants:variants.map(([index])=>{
      const base={width:ase.width,height:ase.height,rgba:ase.frames[index].rgba};
      const image=flags.length?transformed(base,flags):base;
      return PNG.sync.write({width:image.width,height:image.height,data:image.rgba});
    })};
  }
  return result;
}

function components(value) {
  if(value==null)return [];
  if(!Array.isArray(value) || value.length>32 || value.some(name=>!variableName(name)))
    throw Error('Use up to 32 component names with letters, numbers, and underscores');
  return [...new Set(value)];
}

function respawnRule(config,flags) {
  if(config==null || config.mode==='default')return;
  if(!['never','on_entry','delay'].includes(config.mode))throw Error('Choose a respawn rule');
  if(config.mode!=='delay')return {mode:config.mode};
  const ticks=integer(config.ticks??60,1,216000,'respawn delay');
  if(config.flag && !Object.hasOwn(flags??{},config.flag))throw Error('Unknown respawn flag: '+config.flag);
  return {mode:config.mode,ticks,flag:config.flag??null,when:config.when??true};
}

export async function compileProject(root, { project: draft, scripts = new Map(), store } = {}) {
  if (!store && root.endsWith('.waffleproj')) store=await (await import('./project-store.mjs')).projectStore(root);
  const read = store?.read ?? ((name,encoding)=>readFile(projectPath(root,name),encoding));
  const project = draft ?? JSON.parse(await read('project.json','utf8'));
  const controls=Object.fromEntries(buttons.map((name,i)=>[name,1<<i]));
  const bindings=Object.entries(project.controls??{});
  if(bindings.length>64)throw Error('Use up to 64 input actions.');
  for(const [id,keys] of bindings){
    if(!variableName(id)||Object.hasOwn(controls,id)||!Array.isArray(keys)||!keys.length||keys.some(key=>!buttons.includes(key)))throw Error('Invalid input action: '+id);
    controls[id]=keys.reduce((mask,key)=>mask|(1<<buttons.indexOf(key)),0);
  }
  const localization = compileLocalization(project.localization);
  const menus=Object.fromEntries(Object.entries(project.menus??{}).map(([id,menu])=>{
    if(!variableName(id)||!safe(id)||typeof menu.title!=='string'||!Array.isArray(menu.options)||!menu.options.length||menu.options.length>8)
      throw Error('Give menu '+id+' a title and one to eight options');
    for(const label of [menu.title,...menu.options]){
      if(typeof label!=='string'||!label.trim()||Buffer.byteLength(label)>256)throw Error('Invalid label in menu '+id);
      if(label.startsWith('text.')&&!Object.hasOwn(localization.tables[localization.locale]??{},label.slice(5)))
        throw Error('Add text key '+label.slice(5)+' for menu '+id);
    }
    return [id,{title:menu.title,options:menu.options}];
  }));
  const events=project.events??{};
  if(typeof events!=='object'||Array.isArray(events)||Object.keys(events).length>256
    ||Object.entries(events).some(([id,label])=>!variableName(id)||typeof label!=='string'||!label.trim()||label.length>100))
    throw Error('Use up to 256 named events in Game → Events');
  const registry={fonts:{...project.bitfonts,builtin:true},controls,menus,events,sounds:project.audio??{},roomScript:false,sprites:project.sprites??{},flags:project.flags??{},items:project.items??{},text:localization.tables[localization.locale]??{}};
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

  let runtimeAbi=9;
  const sprites = Object.create(null), dependencies = new Map(), spriteFonts = new Map();
  for (const [id, sprite] of Object.entries(project.sprites ?? {})) {
    key(id, 'sprite');
    const ase = await source(sprite.source);
    const all = ase.frames.map((_, i) => register(`sprite/${id}/${i}`, ase, i));
    const clips = Object.create(null);
    const clip=(frames,repeat)=>({frames,repeat,durationMs:frames.reduce((ms,frame)=>ms+Math.max(1,frame.ms),0)});
    clips.default=clip(all,0);
    for (const tag of ase.tags) clips[tag.name]=clip(tagFrames(tag).map(i=>all[i]),tag.repeat);
    let script = compileScript(initialScript(sprite));
    if (sprite.script) {
      try {
        const unit=scripts.get(id) ?? (sprite.script.endsWith('.ws') ? parseScript(await read(sprite.script,'utf8')) : decodeCbor(await read(sprite.script)));
        script=compileScript(unit,await loadModules(unit,read),undefined,registry);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if(sprite.gravityMode!=null && !['room','script'].includes(sprite.gravityMode))throw Error('Invalid gravity control for '+id);
    if(sprite.emitter && (!effects.includes(sprite.emitter.effect) || !Number.isInteger(sprite.emitter.rate) || sprite.emitter.rate<1 || sprite.emitter.rate>240
      || (sprite.emitter.offset!=null && (!Array.isArray(sprite.emitter.offset)||sprite.emitter.offset.length!==2||sprite.emitter.offset.some(value=>!Number.isFinite(value)||Math.abs(value)>4096)))))
      throw Error('Invalid particle emitter for '+id);
    if(script.requiresAbi10)runtimeAbi=10;
    dependencies.set(id,script.dependencies);
    spriteFonts.set(id,script.fontUses);
    sprites[id] = { clips, components:components(sprite.components), respawn:respawnRule(sprite.respawn,project.flags), scriptJump:sprite.legacyBuiltInJump==null?script.scriptJump:!sprite.legacyBuiltInJump, scriptGravity:sprite.gravityMode!=null?sprite.gravityMode==='script':Boolean(sprite.scriptGravity||script.scriptGravity), program:script.events, physics: props(sprite.physics, 'none'), width: sprite.width ?? ase.width,
      height: sprite.height ?? ase.height, layer: sprite.layer ?? 0, animation: sprite.animation ?? 'default',
      emitter:sprite.emitter?{effect:sprite.emitter.effect,rate:sprite.emitter.rate,offset:sprite.emitter.offset??[0,0]}:null, alwaysActive:sprite.alwaysActive??false, team: sprite.team ?? 0, projectile: sprite.projectile };
    number(sprites[id].width, 1, 8192, 'sprite width');
    number(sprites[id].height, 1, 8192, 'sprite height');
    if(sprite.collider==='silhouette'||Object.keys(sprite.frameColliders??{}).length){
      const config=compileColliders(sprite,ase,sprites[id],id);
      for(const [key,value] of Object.entries(config))if(value)sprites[id][key]=value;
    }
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
  const resolution=project.camera?.resolution;
  if(resolution!=null){
    if(!Array.isArray(resolution)||resolution.length!==2)throw Error('Set the resolution width and height');
    camera.resolution=resolution.map(value=>integer(value,64,512,'screen resolution'));
    runtimeAbi=11;
  }
  const tiles = Object.create(null);
  for (const [id, tile] of Object.entries(project.tiles ?? {})) {
    key(id, 'tile');
    const ase = await source(tile.source);
    const {flags,variants}=tileClips(id,tile,ase,size);
    tiles[id] = {
      variants: variants.map((indices, v) => indices.map((i, f) => register(`tile/${id}/${v}/${f}`, ase, i, flags))),
      physics: props(tile.physics, flags.includes('fluid') ? 'fluid' : 'static'),
    };

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

  const items=Object.create(null),itemIcons=new Map();
  for(const [id,item] of Object.entries(project.items??{})){
    if(!variableName(id))throw Error('Invalid item ID '+id);
    if(item.flag && !variableName(item.flag))throw Error('Invalid item flag '+item.flag);
    if(item.label?.startsWith('text.')&&!Object.hasOwn(localization.tables[localization.locale]??{},item.label.slice(5)))
      throw Error('Add text key '+item.label.slice(5)+' for item '+id);
    items[id]={consumable:item.consumable===true,flag:item.flag||null,...(item.label?{label:item.label}:{})};
    if(item.icon){const art=await source(item.icon);itemIcons.set('ui/item/'+id,{width:art.width,height:art.height,rgba:art.frames[0].rgba});}
  }
  const builtinFont=defaultFont();
  const namedFonts=new Map();
  async function loadFont(id){
    if(!namedFonts.has(id))namedFonts.set(id,id==='builtin'?builtinFont:await readBitfont(project.bitfonts[id],read,readArt));
    return namedFonts.get(id);
  }
  let font=builtinFont;
  if(project.activeBitfont && !['builtin','legacy'].includes(project.activeBitfont)){
    const config=project.bitfonts?.[project.activeBitfont];
    if(!config)throw Error('Choose an installed bitfont');
    font=await loadFont(project.activeBitfont);
  }else if(project.font && project.activeBitfont!=='builtin'){
    const image=await source(project.font);
    const characters=[...(project.fontCharacters??'')];
    const height=Math.ceil((96+characters.length)/16)*8;
    if(characters.length>4096 || new Set(characters).size!==characters.length ||
      characters.some(character=>character.codePointAt(0)<128 || /\s/u.test(character))) {
      throw Error('List unique non-ASCII bitmap glyphs in sheet order');
    }
    if(image.width!==96 || image.height!==height)throw Error(`Use a 96 × ${height} pixel bitmap font sheet`);
    font={width:96,height,rgba:image.frames[0].rgba,
      glyphs:Object.fromEntries(characters.map((character,index)=>[character,96+index]))};
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
    const cameraZoom = number(room.cameraZoom ?? 1, .25, 4, 'default camera zoom');
    if(cameraZoom!==1)runtimeAbi=Math.max(runtimeAbi,10);
    const bottomInset=Math.min(rows-1,integer(room.cameraBottomInset??0,0,1023,'bottom camera inset'));
    if(bottomInset)runtimeAbi=11;
    const ySort = room.ySort ?? view === 'top_down';
    const images = new Map(), baked = [], entities = [], solids = [], blockers = new Set();
    if (room.backgroundImage) {
      const art=await source(room.backgroundImage);
      images.set('room/background',{width:art.width,height:art.height,rgba:art.frames[0].rgba});
      const parallax=number(room.backgroundParallax??1,0,1,'background scroll');
      baked.push({image:'room/background',layer:-10001,x:0,y:0,width,height,...(parallax===1?{}:{parallax})});
    }
    const usedSprites = new Set(), usedFonts = new Set();
    function includeSprite(sprite) {
      if (usedSprites.has(sprite)) return;
      const definition = sprites[sprite];
      if (!definition) throw Error(`Unknown sprite: ${sprite}`);
      usedSprites.add(sprite);
      for (const clip of Object.values(definition.clips)) for (const frame of clip.frames) images.set(frame.image, frames.get(frame.image));
      if (definition.projectile) includeSprite(definition.projectile);
      for (const target of dependencies.get(sprite)) includeSprite(target);
      for (const font of spriteFonts.get(sprite)) usedFonts.add(font);
    }
    let scriptHost;
    if (room.script) {
      const isText=room.script.endsWith('.ws');
      const data=scripts.has('room:'+id)?null:await read(room.script,isText?'utf8':undefined).catch(error=>{
        if(error.code!=='ENOENT')throw error;
        return null;
      });
      const unit=scripts.get('room:'+id) ?? (data==null?null:isText?parseScript(data):decodeCbor(data));
      if(unit){
        const script=compileScript(unit,await loadModules(unit,read),undefined,{...registry,roomScript:true});
        if(script.requiresAbi10)runtimeAbi=Math.max(runtimeAbi,10);
        if (Object.keys(script.events).length) {
          scriptHost='@room/'+id;
          sprites[scriptHost]={clips:{},program:script.events,physics:props(undefined,'none'),
            width:1,height:1,layer:0,animation:'default',team:0};
          for (const sprite of script.dependencies) includeSprite(sprite);
          for (const font of script.fontUses) usedFonts.add(font);
          for (const kind of script.shaderPresets) bakeShaderPreset(kind,images);
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
      const type=project.sprites[entry.sprite];
      const rememberState=entry.rememberState??(entry.persistRemoval===true?true:type.rememberState??false);
      const rememberRemoval=entry.persistRemoval===true && entry.rememberState==null;
      entities.push({ ...entry, components:components(entry.components), standardRespawn:entry.respawn?.mode==='default',
        respawn:respawnRule(entry.respawn??type.respawn,flags), persistence:rememberState?'sprite/'+name:null,
        ...(rememberState&&!rememberRemoval?{rememberRemoval:false}:{}), conditions:conditions(type,entry), name, animation, physics });
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
    let shader;
    if(atmospherePresets.includes(room.shader?.kind)){
      shader={kind:room.shader.kind,strength:room.shader.strength??55};
      bakeShaderPreset(shader.kind,images);
    }
    images.set('ui/font',font);
    if(font.layout||usedFonts.size)images.set('ui/font-fallback',builtinFont);
    for(const id of usedFonts)images.set('ui/font/'+id,await loadFont(id));
    for(const [id,image] of itemIcons)images.set(id,image);
    const exits={};
    for(const [edge,exit] of Object.entries(room.exits??{})){
      if(!['left','right','up','down'].includes(edge)||!['fixed','save','crossing'].includes(exit.mode)
        || !exit.targets?.length || exit.targets.some(t=>!Object.hasOwn(project.rooms,t)))throw Error('Invalid exit in '+id);
      if(exit.flag && !Object.hasOwn(flags,exit.flag))throw Error('Unknown exit flag in '+id);
      exits[edge]={mode:exit.mode,targets:exit.targets,flag:exit.flag||null,when:exit.when??true,adjacent:exit.adjacent??false};
    }
    atlases[id] = atlas(images);
    const layoutKey=createHash('sha256').update(JSON.stringify({size,gravity,cols,rows,solids,entities,scriptHost})).digest('hex');
    rooms[id] = { layoutKey, scriptHost, title: room.title ?? id, ripple, shader, hd:room.shader?.kind==='hd'?(room.shader.strength??35):0, exits, cols, rows, width, height, size, baked, solids, entities,
      blockers: [...blockers], background: room.background ?? '#101a23', music: room.music,
      ambience: room.ambience, group_camera:(room.groupCamera??project.camera?.groupCamera)===true,
      ...(cameraZoom===1?{}:{cameraZoom}), ...(bottomInset?{cameraHeight:height-bottomInset*size}:{}), gravity, view, ySort };
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
  const spritePreviews = Object.fromEntries(Object.entries(sprites).filter(([id])=>!id.startsWith('@room/')).map(([id, sprite]) =>
    [id, thumbnail((sprite.clips[sprite.animation] ?? sprite.clips.default).frames[0])]));
  const coverArt=await compileCover(project.coverImage,read);
  return { runtimeAbi, controls,items,menus,events:Object.keys(events),localization,minimap:generateMinimap(rooms,start,project.minimap),saveId:project.saveId??project.name, name: project.name ?? 'GameWaffle game', start, rooms, atlases, sprites, audio, globals, flags, camera,
    coverArt,tilePreviews, spritePreviews, fontGlyphs:font.glyphs,fontLayout:font.layout, fontFallbackGlyphs:font.layout||namedFonts.size?builtinFont.glyphs:undefined,
    fonts:Object.fromEntries([...namedFonts].map(([id,font])=>[id,{layout:font.layout,glyphs:font.glyphs}])) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(process.argv[2] ?? 'demo');
  const output = resolve(process.argv[3] ?? 'web-built/demo.waffle');
  const [flag,locale,...extra] = process.argv.slice(4);
  if (flag!==undefined && (flag!=='--locale' || !locale || extra.length)) throw Error('Use --locale followed by a language code');
  const bytes = pack(await compileProject(root),{locale});
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes);
  console.log(`Built ${output} (${bytes.length} bytes)`);
}
