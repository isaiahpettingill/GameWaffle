import {prepareAssetUpload} from './asset-upload.mjs';
import {compileShaderGraph} from './compile-shader-graph.mjs';
import {propertyAliases,validateCollections} from './collections.mjs';
import {checkUpdate,update,exportDesktop,nativeTarget} from './desktop.mjs';
import {parseScript,formatScript,locations} from './wafflescript.mjs';
import {compileScript} from './script.mjs';
import {loadModules} from './modules.mjs';
import {pack} from './pack.mjs';
import {fileHistory} from './file-history.mjs';
import {recoveryStore} from './recovery.mjs';
import {projectStore} from './project-store.mjs';
import {projectBasename} from './resource-name.mjs';
import {gameScriptPath,initialGameScript,readGameScript} from './game-script.mjs';
import {initialTileScript,tileScriptPath,tileStartsAnimated} from './tile-script.mjs';
import {changeRoomView,initialRoomScript,roomScriptPath,roomSettingKeys} from './room-script.mjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { compileProject, previewTiles, previewRoomArt, inspectBitfont, discoverAssets, describeArt, projectPath } from './compiler.mjs';
import { encodeCbor, decodeCbor } from './cartridge.mjs';
import { initialScript,buttons,Opcodes,platformGravity } from './schema.mjs';
import { embedCartridge, playerTemplate } from './web-export.mjs';
import { Runtime, initSync } from '../web-built/runtime/runtime.js';

if(process.env.GW_PARENT_PIPE){process.stdin.resume();process.stdin.once("end",()=>process.exit(0));}
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name)+1] : fallback;
if(!args.includes('--project') && !args.includes('--cart')){
  await (await import('./launcher.mjs')).launch(Number(option('--port','4871')),args.includes('--open'));
}else{
const root = resolve(option('--project','.'));
const cartFile = option('--cart');
const lan = args.includes('--lan');
const port = Number(option('--port','4871'));
const store = cartFile ? null : await projectStore(root);
const recover=recoveryStore(root),history=fileHistory(store);
const site = resolve('web-built/site');
const wasm = await readFile('web-built/runtime/runtime_bg.wasm');
initSync({ module: wasm });

let cartridge = cartFile ? null : await compileProject(root,{store});
let bytes = cartFile ? await readFile(resolve(cartFile)) : pack(cartridge);
let editorBytes = cartridge ? pack(cartridge,{editor:true}) : null;
let previewKey = cartridge ? thumbnailKey(cartridge) : '';
let runtime;
try{runtime=createRuntime(bytes);}
catch(error){console.error('Could not load the cartridge: '+String(error?.message??error));process.exit(1);}
let clientsCart = bytes;
let mutation = Promise.resolve();
let revision = 0, sourceError = '';
const slots = Array(4).fill(null);
const connections = new Set();

function createRuntime(data) {
  const runtime=Runtime.from_cartridge(data);
  runtime.set_seed(crypto.getRandomValues(new Uint32Array(1))[0]);
  return runtime;
}

const local = req => ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
function sameSite(req) {
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; }
  catch { return false; }
}
function send(res, status, value, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
}
async function jsonBody(req,limit=2_000_000) {
  const data = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Error('Request exceeds the size limit');
    data.push(chunk);
  }
  return JSON.parse(Buffer.concat(data).toString());
}
function change(fn) {
  const result = mutation.then(fn);
  mutation = result.catch(() => {});
  return result;
}
function explicitBehavior(project) {
  const legacyPlayerTypes=new Set(Object.values(project.rooms??{}).flatMap(room=>
    (room.entities??[]).filter(entity=>entity.standardMovement).map(entity=>entity.sprite)));
  let migrated=false;
  for(const [id,entity] of Object.entries(project.sprites??{})){
    const previous=cartridge?.sprites[id];
    if(!previous)continue;
    if(entity.gravityMode==null){
      entity.gravityMode=previous.scriptGravity?'script':'room';
      migrated=true;
    }
    if(legacyPlayerTypes.has(id)&&entity.legacyBuiltInJump==null){
      entity.legacyBuiltInJump=!previous.scriptJump;
      migrated=true;
    }
  }
  return migrated;
}

function thumbnailKey(cart) {
  return createHash('sha256').update(encodeCbor([cart.tilePreviews,cart.spritePreviews,cart.coverArt])).digest('hex');
}

async function recompile(project, scripts, save, sourceStore=store) {
  const next = await compileProject(root, { project, scripts, store:sourceStore });
  const updated = pack(next);
  const preview = pack(next,{editor:true});
  const simulation = createRuntime(updated);
  try {
    await save();
    cartridge = next;
    bytes = updated;
    editorBytes = preview;
    previewKey = thumbnailKey(next);
    revision++;
    sourceError = '';
  } finally { simulation.free(); }
}
async function exportBytes(url) {
  await mutation;
  const locale = url.searchParams.get('locale');
  if (!locale || locale===cartridge?.localization.locale) return bytes;
  if (!cartridge) throw Error('Choose the export language from the source project');
  return pack(cartridge,{locale});
}
const files = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.gif':'image/gif', '.cur':'image/x-icon', '.mp3':'audio/mpeg', '.ogg':'audio/ogg', '.wav':'audio/wav', '.wasm':'application/wasm', '.txt':'text/plain; charset=utf-8' };

let launcher;
const server = createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  const url = new URL(req.url, 'http://localhost');
  try {
    if(url.pathname==='/projects' && local(req)){
      launcher??=process.env.GAMEWAFFLE_LAUNCHER||(await import('./launcher.mjs')).launch(0,false);
      res.writeHead(302,{Location:new URL('/'+url.search,await launcher).href});res.end();return;
    }
    if (url.pathname === '/export.html' && req.method === 'GET') {
      return send(res, 200, embedCartridge(await readFile(playerTemplate, 'utf8'), await exportBytes(url)), 'text/html; charset=utf-8');
    }
    if (url.pathname === '/game.waffle' || url.pathname === '/demo.waffle'){
      res.setHeader('Cache-Control','no-store');
      return send(res,200,await exportBytes(url),'application/octet-stream');
    }
    if (url.pathname === '/lan.waffle') return send(res, 200, connections.size ? clientsCart : bytes, 'application/octet-stream');
    if (url.pathname.startsWith('/api/')) {
      if (cartFile || !local(req) || !sameSite(req)) return send(res, 403, {error:'The editor is available on the host computer'});
      if(url.pathname==='/api/file-history' && req.method==='POST'){
        const {id,back}=await jsonBody(req);
        const manifestChanged=await change(()=>history.restore(id,back===true,recompile));
        return send(res,200,{ok:true,manifestChanged});
      }
      if(url.pathname.startsWith('/api/recovery/')){
        const key=decodeURIComponent(url.pathname.slice('/api/recovery/'.length));
        if(!key||key.length>250||!['GET','PUT','DELETE'].includes(req.method))throw Error('Invalid draft request');
        const value=req.method==='PUT'?await jsonBody(req,16_000_000):null;
        return send(res,200,await change(()=>recover(key,req.method,value)));
      }
      if(url.pathname==='/api/desktop' && req.method==='GET'){
        return send(res,200,await exportDesktop(await exportBytes(url),url.searchParams.get('target')??nativeTarget),'application/zip');
      }
      if(url.pathname==='/api/update' && req.method==='POST'){
        const {component,target,install}=await jsonBody(req);
        if(!install)return send(res,200,await checkUpdate(component,target));
        const info=await update(component,target);
        if(component==='studio'){
          if(process.platform==='linux' && process.env.APPIMAGE){
            const {copyFile,chmod}=await import('node:fs/promises');
            const dst=process.env.APPIMAGE,tmp=dst+'.'+randomUUID()+'.new';
            try{await copyFile(info.path,tmp);await chmod(tmp,0o755);await rename(tmp,dst);}finally{await unlink(tmp).catch(()=>{});}
          }else{
            const child=spawn(info.path,[],{detached:true,stdio:'ignore'});
            await new Promise((ok,fail)=>{child.once('spawn',ok);child.once('error',fail);});child.unref();
          }
        }
        if(component==='studio' && process.platform==='win32')res.once('finish',()=>process.exit(0));
        return send(res,200,info);
      }
      if (url.pathname === '/api/archive' && req.method === 'GET') {
        await mutation;return send(res,200,await store.exportArchive(),'application/octet-stream');
      }
      if(url.pathname==='/api/shaders/preview'&&req.method==='POST'){
        const graph=await jsonBody(req,65536);
        const {wgsl,previewSource,uniformSize,parameters,samplesScreen,fingerprint}=await compileShaderGraph(graph,{preview:true});
        return send(res,200,{wgsl,previewSource,uniformSize,parameters,samplesScreen,fingerprint,title:'Shader preview'});
      }
      if(url.pathname==='/api/shaders'&&req.method==='POST'){
        const {id,name,graph}=await jsonBody(req,65536);
        const title=typeof name==='string'?name.trim():'';
        if(!title||title.length>100)throw Error('Enter a shader name of up to 100 characters');
        const {spirv}=await compileShaderGraph(graph);
        const edited=await change(async()=>{
          const project=JSON.parse(await store.read('project.json','utf8'));
          const shaders=project.shaders??={};
          let path,pending,key=id;
          if(id!=null){
            const existing=Object.hasOwn(shaders,id)?shaders[id]:null;
            if(!existing?.graph||!/^assets\/shaders\/.+\.spv$/i.test(existing.source))
              throw Error('Choose a shader created in Studio');
            path=existing.source;
            pending=new Map([[path,Buffer.from(spirv)]]);
            project.assetInfo??={};
            project.assetInfo[path]={...project.assetInfo[path],kind:'shader',name:title};
          }else{
            const imported=await prepareAssetUpload(project,store,{kind:'shader',filename:'shader.spv',data:spirv,name:title});
            ({path,pending}=imported);
            key=Object.keys(shaders).find(id=>shaders[id].source===path);
          }
          shaders[key]={source:path,title,graph};
          pending.set('project.json',Buffer.from(JSON.stringify(project,null,2)+'\n'));
          const edit=await history.saveMany(pending,()=>recompile(project,undefined,()=>store.save([...pending])));
          return {id:key,path,edit,project,assets:await discoverAssets(root,store),art:await describeArt(root,store),
            shaderDefinitions:cartridge.shaderDefinitions,revision,previewKey};
        });
        return send(res,200,edited);
      }
      if(url.pathname==='/api/assets'&&req.method==='POST'){
        const chunks=[];let size=0;
        for await(const chunk of req){
          if((size+=chunk.length)>65*1024*1024)throw Error('Asset upload exceeds 65 MiB');
          chunks.push(chunk);
        }
        const upload=decodeCbor(Buffer.concat(chunks));
        const imported=await change(async()=>{
          const project=JSON.parse(await store.read('project.json','utf8'));
          const {path,pending,sourceStore}=await prepareAssetUpload(project,store,upload);
          const edit=await history.saveMany(pending,()=>recompile(project,undefined,()=>store.save([...pending]),sourceStore));
          return {path,edit,project,assets:await discoverAssets(root,store),art:await describeArt(root,store),
            shaderDefinitions:cartridge.shaderDefinitions,revision,previewKey};
        });
        return send(res,200,imported);
      }
      if (url.pathname === '/api/import' && req.method === 'POST') {
        const name=url.searchParams.get('name');
        const kind=url.searchParams.get('kind');
        const bitfont=kind==='font', background=kind==='background', cover=kind==='cover';
        const allowed=bitfont? /^[^\\/\x00-\x1f]+\.(yaff|ase|aseprite|png)$/i
          : background||cover? /^[^\\/\x00-\x1f]+\.(ase|aseprite|png)$/i : /^[^\\/\x00-\x1f]+\.(png|ase|aseprite|wav|ogg|oga|opus|qoa|mid|midi|sf2)$/i;
        if(!allowed.test(name??''))throw Error(background||cover?'Select a PNG or Aseprite image':'Select an image or sound file');
        const chunks=[];let size=0;
        const midiAsset=/\.(mid|midi|sf2)$/i.test(name);
        const limit=/\.sf2$/i.test(name)?64:32;
        for await(const chunk of req){if((size+=chunk.length)>limit*1024*1024)throw Error(`File exceeds ${limit} MiB`);chunks.push(chunk);}
        const group=bitfont?'fonts':background?'backgrounds':cover?'covers':/\.(wav|ogg|oga|opus|qoa|mid|midi|sf2)$/i.test(name)?'audio':kind==='tile'?'tiles':'sprites';
        let data=Buffer.concat(chunks),fontConfig;
        if(cover&&url.searchParams.get('preview')==='1'){
          const extension=extname(name).toLowerCase();
          return send(res,200,await previewRoomArt('assets/covers/preview'+extension,async()=>data),'image/png');
        }
        if(bitfont){
          ({data,fontConfig}=decodeCbor(data));
          if(!(data instanceof Uint8Array))throw Error('Choose a bitfont file');
          data=Buffer.from(data.buffer,data.byteOffset,data.byteLength);
        }
        const result=await change(async()=>{
          const files=new Map((await store.list('assets')).map(path=>[path.toLowerCase(),path]));
          const extension=extname(name);
          const filename=bitfont||background||cover||midiAsset?projectBasename(name.slice(0,-extension.length))+extension.toLowerCase():name;
          const base='assets/'+group+'/'+filename;
          if(bitfont)await inspectBitfont({...fontConfig,source:base},async()=>data);
          if(background||cover)await previewRoomArt(base,async()=>data);
          let path=base,index=0,digest;
          while(files.has(path.toLowerCase())){
            const existing=files.get(path.toLowerCase());
            if(data.equals(await store.read(existing)))return {path:existing};
            digest??=createHash('sha256').update(data).digest('hex').slice(0,12);
            const ext=extname(base);
            path=base.slice(0,-ext.length)+'-'+digest+(index?'-'+index:'')+ext;
            index++;
          }
          const edit=await history.save(path,data,async()=>{await store.save([[path,data]]);revision++;});
          return {path,edit};
        });
        return send(res,200,result);
      }
      if(url.pathname==='/api/tile-previews' && req.method==='POST'){
        const {tiles,size}=await jsonBody(req);
        return send(res,200,encodeCbor(await previewTiles(tiles,size,store.read)),'application/octet-stream');
      }
      if (url.pathname === '/api/bitfont' && req.method === 'POST') {
        return send(res,200,await inspectBitfont(await jsonBody(req),store.read));
      }
      if (url.pathname === '/api/room-art' && req.method === 'GET')
        return send(res,200,await previewRoomArt(url.searchParams.get('path'),store.read,Number(url.searchParams.get('frame')??0)),'image/png');
      if (url.pathname === '/api/preview' && req.method === 'GET') return send(res,200,editorBytes,'application/octet-stream');
      if (url.pathname === '/api/status' && req.method === 'GET') return send(res, 200, {revision, sourceError});
      if (url.pathname === '/api/rebuild' && req.method === 'POST') {
        await change(() => recompile(undefined, undefined, () => {}));
        return send(res, 200, {ok:true});
      }
      if (url.pathname === '/api/project' && req.method === 'GET') {
        await mutation;
        const project=JSON.parse(await store.read('project.json','utf8'));
        explicitBehavior(project);
        const gameScript=await readGameScript(project,store.read);
        return send(res, 200, {path:root,project, gameScript:gameScript&&{declarations:gameScript.declarations,constants:gameScript.constants,collections:gameScript.collections},
          shaderDefinitions:cartridge?.shaderDefinitions??{}, roomBackgrounds:cartridge?.roomPreviewBackgrounds??{}, assets:await discoverAssets(root,store), art:await describeArt(root,store), revision, previewKey});
      }
      const viewEdit=url.pathname.match(/^\/api\/room-view\/([A-Za-z0-9_-]+)$/);
      if(viewEdit&&req.method==='PUT'){
        const {view}=await jsonBody(req);
        if(!['platformer','top_down'].includes(view))throw Error('Choose a room view');
        const id=viewEdit[1];
        const result=await change(async()=>{
          const project=JSON.parse(await store.read('project.json','utf8'));
          const room=Object.hasOwn(project.rooms,id)&&project.rooms[id];
          if(!room)throw Error('Unknown room');
          const previous=room.view??(Math.abs(room.gravity??platformGravity)<.01?'top_down':'platformer');
          const path=room.script??roomScriptPath(id);
          const old=await store.read(path).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
          const source=old&&path.endsWith('.ws')?old.toString():null;
          const unit=source!=null?parseScript(source):old?decodeCbor(old):initialRoomScript(room);
          const replacements=changeRoomView(unit,previous,view);
          let nextSource=source;
          for(const [index,block] of [...replacements].sort(([left],[right])=>right-left)){
            if(source!=null){
              const loc=locations.get(unit.events.init[index]);
              const text=formatScript({events:{init:[block]}}).split('\n')[1].trim();
              nextSource=nextSource.slice(0,loc.from)+text+nextSource.slice(loc.to);
            }
            unit.events.init[index]=block;
          }
          room.view=view;
          room.script=path;
          for(const key of roomSettingKeys)delete room[key];
          if(unit.source!=null)delete unit.source;
          const files=new Map([[path,path.endsWith('.ws')?nextSource??formatScript(unit):encodeCbor(unit)],['project.json',JSON.stringify(project,null,2)+'\n']]);
          const edit=await history.saveMany(files,()=>recompile(project,new Map([['room:'+id,unit]]),()=>store.save([...files])));
          return {project,edit,revision,previewKey};
        });
        return send(res,200,result);
      }
      if (url.pathname === '/api/project' && req.method === 'PUT') {
        const project = await jsonBody(req);
        await change(async()=>{
          const old=JSON.parse(await store.read('project.json','utf8'));
          const files=[['project.json',JSON.stringify(project,null,2)+'\n']], scripts=new Map();
          for(const [id,room] of Object.entries(project.rooms??{}))if(!Object.hasOwn(old.rooms,id)&&!room.script){
            if(!/^[A-Za-z0-9_-]{1,64}$/.test(id))throw Error('Invalid room name');
            const unit=initialRoomScript(room,project.roomDefaults);
            scripts.set('room:'+id,unit);files.push([roomScriptPath(id),encodeCbor(unit)]);
          }
          const newAnimatedTiles=Object.fromEntries(Object.entries(project.tiles??{}).filter(([id,tile])=>
            !Object.hasOwn(old.tiles??{},id)&&tileStartsAnimated(tile)));
          if(Object.keys(newAnimatedTiles).length){
            const variants=await previewTiles(newAnimatedTiles,project.tileSize??24,store.read);
            for(const [id,previews] of Object.entries(variants)){
              const unit=initialTileScript(newAnimatedTiles[id]);
              for(let variant=0;variant<previews.variants.length;variant++){
                scripts.set('tile:'+id+':'+variant,unit);files.push([tileScriptPath(id,variant),encodeCbor(unit)]);
              }
            }
          }
          await recompile(project,scripts,()=>store.save(files));
        });
        return send(res, 200, {ok:true});
      }
      if(url.pathname==='/api/modules' && req.method==='GET'){
        return send(res,200,(await store.list('scripts').catch(err=>{if(err.code==='ENOENT')return [];throw err;}))
          .map(path=>path.match(/^scripts\/modules\/([A-Za-z_]\w*)\.ws$/)?.[1]).filter(Boolean).sort());
      }
      const mod=url.pathname.match(/^\/api\/module\/([A-Za-z_]\w{0,63})$/);
      if(mod){
        const path='scripts/modules/'+mod[1]+'.ws';
        if(req.method==='GET'){
          const source=await store.read(path,'utf8');return send(res,200,{...parseScript(source),source});
        }
        if(req.method==='PUT'){
          const draft=await jsonBody(req);
          const source=draft.source??formatScript(draft),unit=parseScript(source);
          if(Object.keys(unit.events).length)throw Error('Modules can contain procedures and functions only');
          const edit=await change(async()=>{
            const override={...store,read:(file,encoding)=>file===path?Promise.resolve(encoding?source:Buffer.from(source)):store.read(file,encoding)};
            const modules=await loadModules({imports:[mod[1]]},override.read);
            compileScript(unit,modules);
            const project=JSON.parse(await store.read('project.json','utf8'));
            const migrated=explicitBehavior(project);
            return history.save(path,source,()=>recompile(project,undefined,()=>store.save([
              [path,source],...(migrated?[['project.json',JSON.stringify(project,null,2)+'\n']]:[]),
            ]),override));
          });
          return send(res,200,{ok:true,edit});
        }
      }
      if(url.pathname==='/api/modules' && req.method==='POST'){
        const {imports,moduleName}=await jsonBody(req);return send(res,200,await loadModules({imports},store.read,Object.create(null),new Set(moduleName?[moduleName]:[])));
      }
      const match = url.pathname.match(/^\/api\/(script|room-script)\/([a-zA-Z0-9_-]+)$/);
      const tileMatch=url.pathname.match(/^\/api\/tile-script\/([a-zA-Z0-9_-]+)\/(\d{1,4})$/);
      const isTile=Boolean(tileMatch);
      const isGame=url.pathname==='/api/game-script';
      if (match || isGame || isTile) {
        const kind=match?.[1],id=tileMatch?.[1]??match?.[2], variant=Number(tileMatch?.[2]);
        const isRoom=kind==='room-script', collection=isRoom?'rooms':isTile?'tiles':'sprites';
        const defaultPath=isGame?gameScriptPath:isTile?tileScriptPath(id,variant):`scripts/${collection}/${id}.cbor`;
        if(isTile){
          await mutation;
          if(!cartridge.tilePreviews[id]?.variants[variant])throw Error('Choose a valid tile variant');
        }
        if (req.method === 'GET') {
          await mutation;
          const project = JSON.parse(await store.read('project.json','utf8'));
          if (!isGame&&!Object.hasOwn(project[collection],id)) return send(res, 404, {error:isRoom?'Unknown room':'Unknown entity type'});
          const file = (isGame?project.gameScript:isTile?null:project[collection][id].script) ?? defaultPath;
          const data = await store.read(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
          const script=data ? (isGame?await readGameScript(project,store.read):file.endsWith('.ws') ? {...parseScript(data.toString()),source:data.toString()} : decodeCbor(data)) :
            isGame?initialGameScript(project):isTile?initialTileScript(project.tiles[id]):isRoom?initialRoomScript(project.rooms[id]):initialScript(project.sprites[id]);
          if(url.searchParams.has('debug')){
            const labels=new WeakMap();
            function index(source,name){
              const tree=parseScript(source),lines=source.split('\n');
              function visit(node){
                if(!node||typeof node!=='object')return;
                const loc=locations.get(node);
                if(loc){const line=source.slice(0,loc.from).split('\n').length;labels.set(node,{file:name,line,text:lines[line-1].trim()});}
                Object.values(node).forEach(visit);
              }
              visit(tree);return tree;
            }
            const unit=index(script.source??formatScript(script),file);
            const modules=await loadModules(unit,store.read);
            for(const name of Object.keys(modules)){
              const path='scripts/modules/'+name+'.ws';
              modules[name]=index(await store.read(path,'utf8'),path);
            }
            const names=Object.fromEntries(Object.entries(Opcodes).map(([name,id])=>[id,name]));
            Object.assign(names,{10:'constant',11:'load',12:'store',13:'calculate',14:'branch',15:'jump',16:'wait',17:'real',47:'string',48:'localized text',49:'text command',50:'entity query'});
            const events={};
            const gameUnit=isGame?unit:await readGameScript(project,store.read);
            const aliases=propertyAliases({...project.variables,...gameUnit?.declarations?.globals},
              {...project.flags,...gameUnit?.declarations?.flags},project.items);
            compileScript(unit,modules,(event,op,node)=>(events[event]??=[]).push({...labels.get(node),op:names[op]}),
              {shaders:cartridge?.shaderDefinitions,tiles:project.tiles??{},collections:validateCollections(gameUnit?.collections),propertyAliases:aliases,gameScript:isGame,tileScript:isTile,roomScript:isRoom||isGame});
            return send(res,200,events);
          }
          return send(res,200,script);
        }
        if (req.method === 'PUT') {
          const script = await jsonBody(req);
          if((script.declarations||script.collections)&&!isGame)throw Error('Move game declarations into the Game script');
          if(script.source!=null && formatScript(parseScript(script.source))!==formatScript(script))throw Error('Text and blocks differ');
          const edit=await change(async () => {
            const project = JSON.parse(await store.read('project.json','utf8'));
            if (!isGame&&!Object.hasOwn(project[collection],id)) throw Error(isRoom?'Unknown room':'Unknown entity type');
            const migrated=explicitBehavior(project);
            const established = isGame?project.gameScript:isTile?defaultPath:project[collection][id].script;
            const file = established ?? defaultPath;
            if(isGame)project.gameScript=file;
            else if(!isTile)project[collection][id].script = file;
            const roomMigrated=isRoom&&roomSettingKeys.some(key=>Object.hasOwn(project.rooms[id],key));
            if(roomMigrated)for(const key of roomSettingKeys)delete project.rooms[id][key];
            const data=file.endsWith('.ws')?(script.source??formatScript(script)):encodeCbor(script);
            const previous=encodeCbor(isGame?initialGameScript(project):isTile?initialTileScript(project.tiles[id]):{events:{}});
            if(isGame)for(const key of ['variables','flags','events','controls','menus','camera','minimap'])delete project[key];
            const scriptId=isGame?'game':isTile?'tile:'+id+':'+variant:isRoom?'room:'+id:id;
            const files=[[file,data]];
            const manifest=isGame||migrated||roomMigrated||!established;
            if(manifest)files.push(['project.json',JSON.stringify(project,null,2)+'\n']);
            const commit=()=>recompile(project,new Map([[scriptId,script]]),()=>store.save(files));
            return manifest?history.saveMany(files,commit):history.save(file,data,commit,file.endsWith('.ws')?Buffer.from(''):previous);
          });
          return send(res, 200, {ok:true,edit});
        }
      }
      return send(res, 404, {error:'Unknown editor route'});
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, {error:'Method not allowed'});
    if(cartFile&&url.pathname==='/'){
      url.searchParams.set('play','1');
      res.writeHead(302,{Location:'/player.html'+url.search});res.end();return;
    }
    const defaultPage = !local(req) ? 'player.html' : 'index.html';
    const file = url.pathname === '/' ? defaultPage : decodeURIComponent(url.pathname.slice(1));
    if (file === 'gamewaffle-player.html') return send(res,200,await readFile('web-built/standalone/gamewaffle-player.html'),files['.html']);
    if (file === 'offline.html') return send(res, 200, await readFile('web-built/standalone/player.html'), files['.html']);
    if (!['index.html','player.html'].includes(file) && !/^(assets|blockly-media)\/[\w.-]+$/.test(file))
      return send(res, 404, {error:'Page not found'});
    const payload = await readFile(projectPath(site,file));
    send(res, 200, req.method === 'HEAD' ? undefined : payload, files[extname(file)] ?? 'application/octet-stream');
  } catch (error) {
    send(res, error.code === 'ENOENT' ? 404 : 400, {error:error.message});
  }
});

if (!cartFile && !store.archive) {
  let rebuildTimer;
  const watcher = watch(root, { recursive:true, persistent:false }, (_, file) => {
    if (!file || !/^(assets|scripts)[\\/]/.test(file)) return;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      change(() => recompile(undefined, undefined, () => {}))
        .catch(error => { sourceError = error.message; });
    }, 275);
  });
  watcher.on('error', error => { sourceError = error.message; });
}

const wss = new WebSocketServer({ noServer:true, maxPayload:4096 });
server.on('upgrade',(request,socket,head)=>{
  if (!lan || request.url !== '/lan' || !sameSite(request) || wss.clients.size >= 12) return socket.destroy();
  wss.handleUpgrade(request,socket,head,client=>wss.emit('connection',client));
});
const wsSend = (client, value) => {
  if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 512_000) client.send(value);
};
wss.on('connection', client => {
  if (!connections.size && bytes !== clientsCart) {
    runtime.free();
    clientsCart = bytes;
    runtime = createRuntime(clientsCart);
  }
  const state = { client, slots:[], input:[{},{},{},{}], alive:true };
  connections.add(state);
  client.on('pong',()=>{ state.alive = true; });
  client.on('error',()=>client.terminate());
  client.on('message', buffer => {
    try {
      const msg = JSON.parse(buffer.toString());
      if (msg.kind === 'join') {
        const desired = Math.min(4, Math.max(1, Number.isInteger(msg.players) ? msg.players : 1));
        while (state.slots.length > desired) {
          const id = state.slots.pop();
          slots[id] = null;
          state.input[id] = {};
        }
        while (state.slots.length < desired && slots.includes(null)) {
          const id = slots.indexOf(null);
          slots[id] = state;
          state.slots.push(id);
        }
        wsSend(client,JSON.stringify({kind:'slots',slots:state.slots}));
      } else if (msg.kind === 'input' && Array.isArray(msg.input)) {
        for (const [index,id] of state.slots.entries()) {
          const input = msg.input[index];
          const entry = Object.fromEntries(buttons.map(button=>[button,input?.[button] === true]));
          const previous = state.input[id];
          for (const button of ['a','b','x','menu']) {
            if (entry[button] && !previous.raw?.[button]) previous.pressed = (previous.pressed ?? 0) | (1 << buttons.indexOf(button));
          }
          previous.raw = entry;
        }
      }
    } catch { /* Ignore malformed input. */ }
  });
  client.on('close',()=>{
    for (const id of state.slots) slots[id] = null;
    connections.delete(state);
  });
});
let outgoingSounds = [], outgoingEvents = [], count = 0;
if (lan) {
  setInterval(()=>{
    if (!connections.size) return;
    const input = slots.map((state, id)=>{
      const previous = state?.input[id];
      if (!previous?.raw) return {};
      const current = {...previous.raw};
      for (const [index,button] of buttons.entries()) if (previous.pressed & (1 << index)) current[button] = true;
      previous.pressed = 0;
      return current;
    });
    runtime.set_connected_players(slots.reduce((mask,state,slot)=>state?mask|(1<<slot):mask,1));
    const data = JSON.parse(runtime.step(JSON.stringify(input)));
    outgoingSounds.push(...data.sounds);
    outgoingEvents.push(...data.events);
    if (++count % 2) return;
    data.sounds = outgoingSounds;
    data.events = outgoingEvents;
    outgoingSounds = [];
    outgoingEvents = [];
    const snapshot = JSON.stringify({kind:'snapshot',data});
    for (const {client} of connections) wsSend(client,snapshot);
  },1000/60);
  setInterval(()=>{
    for (const state of connections) {
      if (!state.alive) { state.client.terminate(); continue; }
      state.alive = false;
      state.client.ping();
    }
  },15000).unref();
}
server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', ()=>{
  console.log(`GameWaffle listening on http://localhost:${server.address().port}`);
  if (args.includes('--open')) {
    const url = `http://127.0.0.1:${server.address().port}`;
    const browser = process.platform === 'win32' ? ['rundll32.exe','url.dll,FileProtocolHandler'] : [process.env.TERMUX_VERSION || process.platform==='android' ? 'termux-open-url' : 'xdg-open'];
    spawn(browser[0],[...browser.slice(1),url],{stdio:'ignore'}).on('error',()=>console.log(url));
  }
  if (lan) console.log('Open /player.html at this computer’s LAN address on other devices and select Join LAN.');
});

}
