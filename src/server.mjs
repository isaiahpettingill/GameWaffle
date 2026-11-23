import {checkUpdate,update,exportDesktop,nativeTarget} from './desktop.mjs';
import {parseScript,formatScript,locations} from './wafflescript.mjs';
import {compileScript} from './script.mjs';
import {loadModules} from './modules.mjs';
import {pack} from './pack.mjs';
import {fileHistory} from './file-history.mjs';
import {recoveryStore} from './recovery.mjs';
import {projectStore} from './project-store.mjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { compileProject, previewTiles, discoverAssets, describeArt, projectPath } from './compiler.mjs';
import { encodeCbor, decodeCbor } from './cartridge.mjs';
import { buttons,Opcodes } from './schema.mjs';
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

const initial = cartFile ? null : await compileProject(root,{store});
let bytes = cartFile ? await readFile(resolve(cartFile)) : pack(initial);
let editorBytes = initial ? pack(initial,{editor:true}) : null;
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
async function recompile(project, scripts, save, sourceStore=store) {
  const cartridge = await compileProject(root, { project, scripts, store:sourceStore });
  const updated = pack(cartridge);
  const preview = pack(cartridge,{editor:true});
  const simulation = createRuntime(updated);
  try {
    await save();
    bytes = updated;
    editorBytes = preview;
    revision++;
    sourceError = '';
  } finally { simulation.free(); }
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
      return send(res, 200, embedCartridge(await readFile(playerTemplate, 'utf8'), bytes), 'text/html; charset=utf-8');
    }
    if (url.pathname === '/demo.waffle') return send(res, 200, bytes, 'application/octet-stream');
    if (url.pathname === '/lan.waffle') return send(res, 200, connections.size ? clientsCart : bytes, 'application/octet-stream');
    if (url.pathname.startsWith('/api/')) {
      if (cartFile || !local(req) || !sameSite(req)) return send(res, 403, {error:'The editor is available on the host computer'});
      if(url.pathname==='/api/file-history' && req.method==='POST'){
        const {id,back}=await jsonBody(req);
        await change(()=>history.restore(id,back===true,recompile));
        return send(res,200,{ok:true});
      }
      if(url.pathname.startsWith('/api/recovery/')){
        const key=decodeURIComponent(url.pathname.slice('/api/recovery/'.length));
        if(!key||key.length>250||!['GET','PUT','DELETE'].includes(req.method))throw Error('Invalid draft request');
        const value=req.method==='PUT'?await jsonBody(req,16_000_000):null;
        return send(res,200,await change(()=>recover(key,req.method,value)));
      }
      if(url.pathname==='/api/desktop' && req.method==='GET'){
        await mutation;return send(res,200,await exportDesktop(bytes,url.searchParams.get('target')??nativeTarget),'application/zip');
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
      if (url.pathname === '/api/import' && req.method === 'POST') {
        const name=url.searchParams.get('name');
        if (!/^[\w .-]+\.(png|ase|aseprite|wav|ogg|opus|qoa)$/i.test(name??''))throw Error('Select an image or sound file');
        const chunks=[];let size=0;
        for await(const chunk of req){if((size+=chunk.length)>32*1024*1024)throw Error('File exceeds 32 MiB');chunks.push(chunk);}
        const group=/\.(wav|ogg|opus|qoa)$/i.test(name)?'audio':url.searchParams.get('kind')==='tile'?'tiles':'sprites';
        const path='assets/'+group+'/'+name;
        const edit=await change(async()=>{
          if((await store.list('assets')).includes(path))throw Error('An asset with this name exists');
          const data=Buffer.concat(chunks);
          return history.save(path,data,async()=>{await store.save([[path,data]]);revision++;});
        });
        return send(res,200,{path,edit});
      }
      if(url.pathname==='/api/tile-previews' && req.method==='POST'){
        const {tiles,size}=await jsonBody(req);
        return send(res,200,encodeCbor(await previewTiles(tiles,size,store.read)),'application/octet-stream');
      }
      if (url.pathname === '/api/preview' && req.method === 'GET') return send(res,200,editorBytes,'application/octet-stream');
      if (url.pathname === '/api/status' && req.method === 'GET') return send(res, 200, {revision, sourceError});
      if (url.pathname === '/api/rebuild' && req.method === 'POST') {
        await change(() => recompile(undefined, undefined, () => {}));
        return send(res, 200, {ok:true});
      }
      if (url.pathname === '/api/project' && req.method === 'GET') {
        await mutation;
        return send(res, 200, {path:root,project:JSON.parse(await store.read('project.json','utf8')), assets:await discoverAssets(root,store), art:await describeArt(root,store), revision});
      }
      if (url.pathname === '/api/project' && req.method === 'PUT') {
        const project = await jsonBody(req);
        await change(() => recompile(project, undefined, () => store.save([['project.json',JSON.stringify(project,null,2)+'\n']])));
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
            return history.save(path,source,()=>recompile(undefined,undefined,()=>store.save([[path,source]]),override));
          });
          return send(res,200,{ok:true,edit});
        }
      }
      if(url.pathname==='/api/modules' && req.method==='POST'){
        const {imports,moduleName}=await jsonBody(req);return send(res,200,await loadModules({imports},store.read,Object.create(null),new Set(moduleName?[moduleName]:[])));
      }
      const match = url.pathname.match(/^\/api\/script\/([a-zA-Z0-9_-]+)$/);
      if (match) {
        const id = match[1];
        if (req.method === 'GET') {
          await mutation;
          const project = JSON.parse(await store.read('project.json','utf8'));
          if (!Object.hasOwn(project.sprites,id)) return send(res, 404, {error:'Unknown sprite'});
          const file = project.sprites[id].script ?? `scripts/sprites/${id}.cbor`;
          const data = await store.read(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
          const script=data ? (file.endsWith('.ws') ? {...parseScript(data.toString()),source:data.toString()} : decodeCbor(data)) : {events:{}};
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
            Object.assign(names,{10:'constant',11:'load',12:'store',13:'calculate',14:'branch',15:'jump',16:'wait',17:'real'});
            const events={};
            compileScript(unit,modules,(event,op,node)=>(events[event]??=[]).push({...labels.get(node),op:names[op]}));
            return send(res,200,events);
          }
          return send(res,200,script);
        }
        if (req.method === 'PUT') {
          const script = await jsonBody(req);
          if(script.source!=null && formatScript(parseScript(script.source))!==formatScript(script))throw Error('Text and blocks differ');
          const edit=await change(async () => {
            const project = JSON.parse(await store.read('project.json','utf8'));
            if (!Object.hasOwn(project.sprites,id)) throw Error('Unknown sprite');
            const established = project.sprites[id].script;
            const file = established ?? `scripts/sprites/${id}.cbor`;
            project.sprites[id].script = established ?? `scripts/sprites/${id}.cbor`;
            const data=file.endsWith('.ws')?(script.source??formatScript(script)):encodeCbor(script);
            return history.save(file,data,()=>recompile(project,new Map([[id,script]]),async()=>{
              await store.save([[file,data],...(!established ? [['project.json',JSON.stringify(project,null,2)+'\n']] : [])]);
            }),file.endsWith('.ws')?Buffer.from(''):encodeCbor({events:{}}));
          });
          return send(res, 200, {ok:true,edit});
        }
      }
      return send(res, 404, {error:'Unknown editor route'});
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, {error:'Method not allowed'});
    const defaultPage = cartFile || !local(req) ? 'player.html' : 'index.html';
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
