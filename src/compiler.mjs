import {shaderPresets as pipelinePresets} from './shader-presets.mjs';
import {compileShader} from './shader-assets.mjs';
import {compileShaderGraph} from './compile-shader-graph.mjs';
import {createHash} from 'node:crypto';
import {atmospherePresets,bakeRoomShader,bakeShaderPreset} from './room-shaders.mjs';
import {compileColliders} from './colliders.mjs';
import {addSeams} from './seams.mjs';
import {generateMinimap} from './minimap.mjs';
import {byteCache} from './compile-cache.mjs';
import {compileMidi} from './midi.mjs';
import {readGameScript} from './game-script.mjs';
import {tileScriptPath} from './tile-script.mjs';
import {roomScriptPath} from './room-script.mjs';
import {propertyAliases,validateCollections} from './collections.mjs';
import {pack} from './pack.mjs';
import {defaultFont,readBitfont} from './font.mjs';
import { initialScript, buttons, effects, platformGravity, roomBorder } from './schema.mjs';
import {initStatements,physicsModes} from './init-properties.mjs';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodePng, encodePng } from './png.mjs';
import { COVER_SIZE, coverCropRect } from './cover.mjs';
import {runCodec} from './asset-codec.mjs';
import { readAseprite, tagFrames } from './ase.mjs';
import { decodeCbor } from './cartridge.mjs';
import {loadModules} from './modules.mjs';
import {parseScript} from './wafflescript.mjs';
import { compileScript, constantType, tileSizes, variableName } from './script.mjs';
import { instanceNames } from './instances.mjs';
import {resourceTables,validResourceText} from './resource-tables.mjs';

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
      if (!validResourceText(translation))
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

function props(value = {}, defaultMode) {
  const mode = value.mode ?? defaultMode;
  if (!physicsModes.includes(mode)) throw Error(`Unknown physics mode: ${mode}`);
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
  const atlasHeight = Math.max(1, y + height);
  const image = {width, rgba:Buffer.alloc(width * atlasHeight * 4)};
  for (const [id, source] of list) blit(source, image, ...entries[id]);
  const png = encodePng(width, atlasHeight, image.rgba);
  return atlasCache.put(key,{entries,png},png.length+list.length*96);
}

const wavCache=byteCache(48*1024*1024);
function wavToQoa(bytes) {
  const key=createHash('sha256').update(bytes).digest('hex');
  const cached=wavCache.get(key);
  if(cached)return cached;
  const audio=runCodec('wav_to_qoa',bytes);
  return wavCache.put(key,audio,audio.byteLength);
}

const artFile = /\.(ase|aseprite|png)$/i;
const assetFile = /\.(ase|aseprite|png|yaff|wav|opus|ogg|oga|qoa|mid|midi|sf2|spv|spirv)$/i;
const artCache=byteCache(64*1024*1024);
async function readArt(file,read) {
  const data=await read(file);
  const png=file.toLowerCase().endsWith('.png');
  const key=createHash('sha256').update(png?'png':'ase').update(data).digest('hex');
  const cached=artCache.get(key);
  if(cached)return cached;
  let art;
  if(png){
    const {width,height,data:rgba}=decodePng(data);
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
  return encodePng(width, height, frames[frame].rgba);
}

const coverCache = byteCache(8 * 1024 * 1024);
async function compileCover(file, crop, read) {
  if(!file)return;
  if(typeof file!=='string'||!file.startsWith('assets/')||file.split('/').includes('..')||!artFile.test(file))
    throw Error('Choose a project image for the cartridge cover');
  const {width,height,frames,revision}=await readArt(file,read);
  const {left,top,side}=coverCropRect(width,height,crop);
  const key=JSON.stringify([revision,left,top,side]);
  const cached=coverCache.get(key);
  if(cached)return cached;
  const source=frames[0].rgba;
  const data=Buffer.alloc(COVER_SIZE * COVER_SIZE * 4);
  const step=side / COVER_SIZE;
  const columns=Array.from({length:COVER_SIZE},(_,index)=>Math.floor(left + (index + .5) * step));
  for(let y=0;y<COVER_SIZE;y++){
    const row=Math.floor(top + (y + .5) * step);
    if(row<0||row>=height)continue;
    for(let x=0;x<COVER_SIZE;x++){
      const column=columns[x];
      if(column<0||column>=width)continue;
      const pixel=source.readUInt32LE((row * width + column) * 4);
      data.writeUInt32LE(pixel,(y * COVER_SIZE + x) * 4);
    }
  }
  const png=encodePng(COVER_SIZE,COVER_SIZE,data);
  return coverCache.put(key,png,png.length);
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
      return encodePng(image.width, image.height, image.rgba);
    })};
  }
  return result;
}

function components(value) {
  if(value==null)return [];
  if(!Array.isArray(value) || value.length>32 || value.some(name=>!variableName(name)))
    throw Error('Use up to 32 entity tag names with letters, numbers, and underscores');
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
  const gameUnit=scripts.get('game')??await readGameScript(project,read);
  const declarations=gameUnit?.declarations;
  const collections=validateCollections(gameUnit?.collections);
  const flagValues={...project.flags,...declarations?.flags};
  const initialGlobals=Object.fromEntries(Object.entries(declarations?.globals??{}).map(([name,value])=>{
    const type=constantType(value);
    if(!variableName(name)||!type)throw Error('Invalid game global '+name);
    return [{integer:'',real:'real.',boolean:'bool.',string:'text.'}[type]+name,
      type==='real'?String(value.real):type==='boolean'?String(+value):String(value)];
  }));
  const controls=Object.fromEntries(buttons.map((name,i)=>[name,1<<i]));
  const bindings=Object.entries(declarations?.controls??project.controls??{});
  if(bindings.length>64)throw Error('Use up to 64 input actions.');
  for(const [id,keys] of bindings){
    if(!variableName(id)||Object.hasOwn(controls,id)||!Array.isArray(keys)||!keys.length||keys.some(key=>!buttons.includes(key)))throw Error('Invalid input action: '+id);
    controls[id]=keys.reduce((mask,key)=>mask|(1<<buttons.indexOf(key)),0);
  }
  const localization = compileLocalization(resourceTables(project.localization,declarations?.resources));
  const menus=Object.fromEntries(Object.entries(declarations?.menus??project.menus??{}).map(([id,menu])=>{
    if(!variableName(id)||!safe(id)||typeof menu.title!=='string'||!Array.isArray(menu.options)||!menu.options.length||menu.options.length>8)
      throw Error('Give menu '+id+' a title and one to eight options');
    for(const label of [menu.title,...menu.options]){
      if(typeof label!=='string'||!label.trim()||Buffer.byteLength(label)>256)throw Error('Invalid label in menu '+id);
      if(label.startsWith('text.')&&!Object.hasOwn(localization.tables[localization.locale]??{},label.slice(5)))
        throw Error('Add text key '+label.slice(5)+' for menu '+id);
    }
    return [id,{title:menu.title,options:menu.options}];
  }));
  const events={...project.events,...declarations?.events};
  if(typeof events!=='object'||Array.isArray(events)||Object.keys(events).length>256
    ||Object.entries(events).some(([id,label])=>!variableName(id)||typeof label!=='string'||!label.trim()||label.length>100))
    throw Error('Use up to 256 named events in the Game script');
  const allShaders={...pipelinePresets},usedShaders=new Set();
  for(const [id,shader] of Object.entries(project.shaders??{})){
    if(!variableName(id)||typeof shader?.source!=='string'||!/^assets\/.+\.(spv|spirv)$/i.test(shader.source))
      throw Error('Choose a SPIR-V asset for shader '+id);
    try{
      const definition=shader.graph
        ? await compileShaderGraph(shader.graph) : await compileShader(await read(shader.source));
      allShaders[id]={...definition,title:shader.title??id};
    }catch(error){throw Error('Shader '+(shader.title??id)+': '+error.message);}
  }
  const registry={shaders:allShaders,tiles:project.tiles??{},fonts:{...project.bitfonts,builtin:true},controls,menus,events,sounds:project.audio??{},roomScript:false,
    sprites:project.sprites??{},flags:flagValues,constants:gameUnit?.constants,collections,items:project.items??{},
    propertyAliases:propertyAliases({...project.variables,...declarations?.globals},flagValues,project.items),text:localization.tables[localization.locale]??{}};
  const gameScript=gameUnit?compileScript(gameUnit,await loadModules(gameUnit,read),undefined,{...registry,gameScript:true,roomScript:true}):null;
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

  const scriptAbi=script=>script?.requiresAbi18?18:script?.requiresAbi17?17:script?.requiresAbi16?16:script?.requiresAbi15?15:script?.requiresAbi14?14:script?.requiresAbi13?13:script?.requiresAbi12?12:script?.requiresAbi10?10:9;
  let runtimeAbi=Math.max(scriptAbi(gameScript),gameUnit?12:9);
  let tileSensing=Boolean(gameScript?.tileSensing);
  for(const id of gameScript?.shaderUses??[])usedShaders.add(id);
  const sprites = Object.create(null), dependencies = new Map(), spriteFonts = new Map();
  if(Object.keys(gameScript?.events??{}).length)sprites['@game']={clips:{},program:gameScript.events,
    physics:props(undefined,'none'),width:1,height:1,layer:0,animation:'default',team:0};
  for (const [id, sprite] of Object.entries(project.sprites ?? {})) {
    key(id, 'sprite');
    const ase = await source(sprite.source);
    const all = ase.frames.map((_, i) => register(`sprite/${id}/${i}`, ase, i));
    const clips = Object.create(null);
    const clip=(frames,repeat)=>({frames,repeat,durationMs:frames.reduce((ms,frame)=>ms+Math.max(1,frame.ms),0)});
    clips.default=clip(all,0);
    for (const tag of ase.tags) clips[tag.name]=clip(tagFrames(tag).map(i=>all[i]),tag.repeat);
    let script = compileScript(initialScript(sprite));
    if (sprite.script || scripts.has(id)) {
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
    runtimeAbi=Math.max(runtimeAbi,scriptAbi(script));
    tileSensing||=script.tileSensing;
    dependencies.set(id,script.dependencies);
    spriteFonts.set(id,script.fontUses);
    sprites[id] = { clips, components:components(sprite.components), respawn:respawnRule(sprite.respawn,flagValues), scriptJump:sprite.legacyBuiltInJump==null?script.scriptJump:!sprite.legacyBuiltInJump, scriptGravity:sprite.gravityMode!=null?sprite.gravityMode==='script':Boolean(sprite.scriptGravity||script.scriptGravity), program:script.events, physics: props({...sprite.physics,...script.initPhysics}, 'none'), width: sprite.width ?? ase.width,
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
  const globals = variables(project.variables,false), flags = variables(flagValues,true);
  function conditions(...sources){
    return sources.filter(s=>s?.flag).map(s=>{
      if(!Object.hasOwn(flags,s.flag))throw Error('Unknown condition flag: '+s.flag);
      return [s.flag,s.when??true];
    });
  }
  const legacyCamera=gameUnit?undefined:project.camera;
  const camera = {
    min_width:integer(legacyCamera?.min_width??128,128,512,'camera minimum width'),
    min_height:integer(legacyCamera?.min_height??128,128,512,'camera minimum height'),
    max_width:integer(legacyCamera?.max_width??512,128,512,'camera maximum width'),
    max_height:integer(legacyCamera?.max_height??512,128,512,'camera maximum height'),
    zoom:integer(legacyCamera?.zoom??2,1,8,'camera pixel zoom'),
  };
  if (camera.min_width>camera.max_width || camera.min_height>camera.max_height) throw Error('Camera minimum exceeds maximum');
  const resolution=legacyCamera?.resolution;
  if(resolution!=null){
    if(!Array.isArray(resolution)||resolution.length!==2)throw Error('Set the resolution width and height');
    camera.resolution=resolution.map(value=>integer(value,64,512,'screen resolution'));
    runtimeAbi=Math.max(runtimeAbi,11);
  }
  const tiles = Object.create(null);
  for (const [id, tile] of Object.entries(project.tiles ?? {})) {
    key(id, 'tile');
    const ase = await source(tile.source);
    const {flags,variants}=tileClips(id,tile,ase,size);
    tiles[id] = {
      variants: variants.map((indices, v) => indices.map((i, f) => register(`tile/${id}/${v}/${f}`, ase, i, flags))),
      physics: props(tile.physics, flags.includes('fluid') ? 'fluid' : 'static'),
      hosts:[],variantPhysics:[],
    };
    const compiled=tiles[id];
    const sequence=compiled.variants.flat();
    for(let variant=0;variant<compiled.variants.length;variant++){
      const key='tile:'+id+':'+variant;
      const bytes=scripts.has(key)?null:await read(tileScriptPath(id,variant)).catch(error=>{if(error.code!=='ENOENT')throw error;});
      const unit=scripts.get(key)??(bytes?decodeCbor(bytes):null);
      if(!unit)continue;
      const script=compileScript(unit,await loadModules(unit,read),undefined,{...registry,tileScript:true});
      if(script.initPhysics)compiled.variantPhysics[variant]=props({...compiled.physics,...script.initPhysics},compiled.physics.mode);
      // A variant with only baked properties has no runtime script host.
      if(!Object.keys(script.events).length)continue;
      const name='@tile/'+id+'/'+variant;
      const clip=frames=>({frames,repeat:0,durationMs:frames.reduce((total,frame)=>total+frame.ms,0)});
      const clips={default:clip([compiled.variants[variant][0]]),sequence:clip(sequence)};
      for(const [index,frame] of sequence.entries())clips['frame_'+index]=clip([frame]);
      sprites[name]={clips,program:script.events,physics:compiled.variantPhysics[variant]??compiled.physics,width:size,height:size,layer:0,animation:'default',team:0};
      dependencies.set(name,script.dependencies);spriteFonts.set(name,script.fontUses);
      compiled.hosts[variant]=name;
      runtimeAbi=Math.max(runtimeAbi,scriptAbi(script),12);
      tileSensing||=script.tileSensing;
    }

  }

  const audio = Object.create(null);
  for (const [id, config] of Object.entries(project.audio ?? {})) {
    key(id, 'audio');
    const asset = typeof config === 'string' ? { source: config } : config;
    const extension = extname(asset.source).slice(1).toLowerCase();
    if (!['wav','ogg','oga','opus','qoa','mid','midi'].includes(extension)) throw Error(`Unsupported audio format: ${extension}`);
    const data = await read(asset.source);
    if(extension==='mid'||extension==='midi'){
      if(typeof asset.soundFont!=='string'||!/\.sf2$/i.test(asset.soundFont))throw Error(`Choose a SoundFont (.sf2) for ${id}`);
      audio[id]={format:'qoa',data:await compileMidi(data,await read(asset.soundFont))};
    }else audio[id] = extension === 'wav' && asset.compress !== false
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
  const rooms = Object.create(null), atlases = Object.create(null), roomPreviewBackgrounds=Object.create(null);
  for (const [id, room] of Object.entries(project.rooms ?? {})) {
    key(id, 'room');
    const scriptKey='room:'+id, file=room.script??roomScriptPath(id), isText=file.endsWith('.ws');
    const data=scripts.has(scriptKey)?null:await read(file,isText?'utf8':undefined).catch(error=>{
      if(error.code!=='ENOENT')throw error;
      return null;
    });
    const unit=scripts.get(scriptKey)??(data==null?null:isText?parseScript(data):decodeCbor(data));
    const settings=unit?{}:room;
    const cols = integer(room.cols, 1, Math.floor(4096 / size), 'room columns');
    const rows = integer(room.rows, 1, Math.floor(4096 / size), 'room rows');
    const width = cols * size, height = rows * size;
    const view = room.view ?? (Math.abs(room.gravity ?? platformGravity) < .01 ? 'top_down' : 'platformer');
    if (!['platformer','top_down'].includes(view)) throw Error(`Unknown room view: ${view}`);
    const gravity = view === 'top_down' ? 0 : number(settings.gravity ?? platformGravity, -100, 100, 'room gravity');
    const cameraZoom = number(settings.cameraZoom ?? 1, .25, 4, 'default camera zoom');
    if(cameraZoom!==1)runtimeAbi=Math.max(runtimeAbi,10);
    const bottomInset=Math.min(rows-1,integer(settings.cameraBottomInset??0,0,1023,'bottom camera inset'));
    if(bottomInset)runtimeAbi=Math.max(runtimeAbi,11);
    const ySort = settings.ySort ?? view === 'top_down';
    const images = new Map(), baked = [], entities = [], solids = [], blockers = new Set();
    if (settings.backgroundImage) {
      const art=await source(settings.backgroundImage);
      images.set('room/background',{width:art.width,height:art.height,rgba:art.frames[0].rgba});
      const parallax=number(settings.backgroundParallax??1,0,1,'background scroll');
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
    async function includeBackgrounds(paths){
      for(const path of paths){
        const art=await source(path);
        images.set('room/background/'+path,{width:art.width,height:art.height,rgba:art.frames[0].rgba});
      }
    }
    await includeBackgrounds(gameScript?.backgroundUses??[]);
    for(const sprite of gameScript?.dependencies??[])includeSprite(sprite);
    for(const font of gameScript?.fontUses??[])usedFonts.add(font);
    for(const kind of gameScript?.shaderPresets??[])bakeShaderPreset(kind,images);
    let scriptHost, scriptBorder=gameScript?.scriptBorder,roomTileSensing=tileSensing;
    const tileCells=new Map();
    if(unit){
      const background=initStatements(unit).findLast(block=>block.op==='set_room_background_image');
      roomPreviewBackgrounds[id]=background?.image??'';
      const script=compileScript(unit,await loadModules(unit,read),undefined,{...registry,roomScript:true});
      runtimeAbi=Math.max(runtimeAbi,scriptAbi(script));
      roomTileSensing||=script.tileSensing;
      for(const id of script.shaderUses)usedShaders.add(id);
      if (Object.keys(script.events).length) {
        scriptBorder||=script.scriptBorder;
        scriptHost='@room/'+id;
        sprites[scriptHost]={clips:{},program:script.events,physics:props(undefined,'none'),
          width:1,height:1,layer:0,animation:'default',team:0};
        for (const sprite of script.dependencies) includeSprite(sprite);
        for (const font of script.fontUses) usedFonts.add(font);
        await includeBackgrounds(script.backgroundUses);
        for (const kind of script.shaderPresets) bakeShaderPreset(kind,images);
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
    for (const sound of [settings.music, settings.ambience].filter(Boolean)) {
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
        const selected=variant ?? ((x * 37 + y * 17) % tile.variants.length);
        const clip = tile.variants[selected];
        if (!clip) throw Error(`Unknown variant for ${tileId}`);
        const definition=tile.variantPhysics[selected]??tile.physics;
        const physics = layer.collidable ? definition : { ...definition, mode: 'none' };
        const gates=conditions(layer,project.tiles[tileId]);
        const host=tile.hosts[selected];
        const dynamic = host || gates.length>0 || !['static','none'].includes(physics.mode);
        const bakedCell=!dynamic&&clip.length===1;
        const tileMark=roomTileSensing?{tile:tileId,mode:physics.mode}:null;
        if(tileMark&&bakedCell){
          const cell=y*cols+x;
          if(!tileCells.has(cell))tileCells.set(cell,[]);
          tileCells.get(cell).push(tileMark);
        }
        if(host){
          includeSprite(host);
          entities.push({x:(x+.5)*size,y:(y+.5)*size,sprite:host,...(tileMark?{tileMark}:{}),
            persistence:project.tiles[tileId].persistRemoval?`tile/${index}/${x}/${y}`:null,
            conditions:gates,layer:order,physics:physics.mode==='none'?{...physics,mode:'sensor'}:physics});
        }else if (bakedCell) {
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
          entities.push({ x: (x+.5)*size, y:(y+.5)*size, tile: tileId, clip,...(tileMark?{tileMark}:{}),persistence:project.tiles[tileId].persistRemoval?`tile/${index}/${x}/${y}`:null,
            conditions:gates, blocker:gates.length && physics.mode==='static'?y*cols+x:null,
            physics: !gates.length && physics.mode === 'static' ? { ...physics, mode: 'none' } : physics, layer: order });
        }
        if (!gates.length && physics.mode === 'static' && !host) {
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
    const border = roomBorder(settings, view === 'top_down');
    if (!['closed','sides','open'].includes(border)) throw Error('Invalid room border');
    if (scriptBorder || border !== 'open') {
      const physics = props(undefined, 'static');
      const walls={
        left:{x:-size/2,y:height/2,width:size,height:height+size*16},
        right:{x:width+size/2,y:height/2,width:size,height:height+size*16},
        up:{x:width/2,y:-size/2,width,height:size},
        down:{x:width/2,y:height+size/2,width,height:size},
      };
      for(const edge of scriptBorder||border==='closed'?Object.keys(walls):['left','right']){
        const exit=room.exits?.[edge],opposite={left:'right',right:'left',up:'down',down:'up'}[edge];
        const back=project.rooms[exit?.targets?.[0]]?.exits?.[opposite];
        if(exit?.adjacent && exit.mode==='fixed' && !exit.flag && back?.adjacent && back.mode==='fixed' && !back.flag && back.targets[0]===id)continue;
        const side=edge==='left'||edge==='right';
        solids.push({...walls[edge],physics,...(scriptBorder?{border:side?1:2,disabled:border==='open'||border==='sides'&&!side}:{})});
      }
    }
    const ripple = bakeRoomShader(settings.shader,images);
    let shader;
    if(atmospherePresets.includes(settings.shader?.kind)){
      shader={kind:settings.shader.kind,strength:settings.shader.strength??55};
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
    rooms[id] = { layoutKey, scriptHost, title: room.title ?? id, ripple, shader, hd:settings.shader?.kind==='hd'?(settings.shader.strength??35):0, exits, cols, rows, width, height, size, baked, solids, entities,
      ...(tileCells.size?{tileCells}:{}),
      blockers: [...blockers], background: settings.background ?? '#101a23', music: settings.music,
      ambience: settings.ambience, group_camera:(settings.groupCamera??legacyCamera?.groupCamera)===true,
      groupCameraOverride:settings.groupCamera,
      ...(cameraZoom===1?{}:{cameraZoom}), ...(bottomInset?{cameraHeight:height-bottomInset*size}:{}), gravity, view, ySort };
  }
  addSeams(rooms,atlases,sprites,atlas);
  const start = project.start ?? Object.keys(rooms)[0];
  if (!Object.hasOwn(rooms, start)) throw Error('Choose a valid starting room');
  const minimapMode=gameUnit?'off':project.minimap??'off';
  const minimap=generateMinimap(rooms,start,gameUnit&&minimapMode==='off'?'world':minimapMode);
  if(minimap)minimap.mode=minimapMode;
  function thumbnail(frame) {
    const { width, height, rgba: data } = frames.get(frame.image);
    return encodePng(width, height, data);
  }
  const tilePreviews = Object.fromEntries(Object.entries(tiles).map(([id, tile]) =>
    [id, { mode: tile.physics.mode, variantModes: tile.variants.map((_,index)=>tile.variantPhysics[index]?.mode??tile.physics.mode),
      variants: tile.variants.map(clip => thumbnail(clip[0])) }]));
  const spritePreviews = Object.fromEntries(Object.entries(sprites).filter(([id])=>!id.startsWith('@')).map(([id, sprite]) =>
    [id, thumbnail((sprite.clips[sprite.animation] ?? sprite.clips.default).frames[0])]));
  const coverArt=await compileCover(project.coverImage,project.coverCrop,read);
  const presetProgram=[...usedShaders].some(id=>id.startsWith('preset:'))
    ?await compileShader(await readFile(new URL('./shaders/presets.spv',import.meta.url))):null;
  return { runtimeAbi, controls,items,menus,events:Object.keys(events),localization,minimap,saveId:project.saveId??project.name, name: project.name ?? 'GameWaffle game', start, rooms, atlases, sprites, audio, globals, flags, camera,
    gameProgram:gameScript?.events,initialGlobals,collections,roomPreviewBackgrounds,
    shaders:Object.fromEntries([...usedShaders].map(id=>[id,id.startsWith('preset:')?{...presetProgram,...allShaders[id]}:allShaders[id]])),
    shaderDefinitions:Object.fromEntries(Object.entries(allShaders).map(([id,{title,uniformSize,parameters}])=>[id,{title,uniformSize,parameters}])) ,
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
