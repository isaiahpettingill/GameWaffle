import {pack} from './pack.mjs';
import {projectStore} from './project-store.mjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { compileProject, discoverAssets, describeArt, projectPath } from './compiler.mjs';
import { encodeCbor, decodeCbor } from './cartridge.mjs';
import { buttons } from './schema.mjs';
import { embedCartridge, playerTemplate } from './web-export.mjs';
import { Runtime, initSync } from '../web-built/runtime/runtime.js';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name)+1] : fallback;
const root = resolve(option('--project','demo'));
const cartFile = option('--cart');
const lan = args.includes('--lan');
const port = Number(option('--port','4871'));
const store = cartFile ? null : await projectStore(root);
const site = resolve('web-built/site');
const wasm = await readFile('web-built/runtime/runtime_bg.wasm');
initSync({ module: wasm });

const initial = cartFile ? null : await compileProject(root,{store});
let bytes = cartFile ? await readFile(resolve(cartFile)) : pack(initial);
let editorBytes = initial ? pack(initial,{editor:true}) : null;
let runtime = createRuntime(bytes);
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
async function jsonBody(req) {
  const data = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw Error('Request exceeds 2 MB');
    data.push(chunk);
  }
  return JSON.parse(Buffer.concat(data).toString());
}
function change(fn) {
  const result = mutation.then(fn);
  mutation = result.catch(() => {});
  return result;
}
async function recompile(project, scripts, save) {
  const cartridge = await compileProject(root, { project, scripts, store });
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/export.html' && req.method === 'GET') {
      return send(res, 200, embedCartridge(await readFile(playerTemplate, 'utf8'), bytes), 'text/html; charset=utf-8');
    }
    if (url.pathname === '/demo.waffle') return send(res, 200, bytes, 'application/octet-stream');
    if (url.pathname === '/lan.waffle') return send(res, 200, connections.size ? clientsCart : bytes, 'application/octet-stream');
    if (url.pathname.startsWith('/api/')) {
      if (cartFile || !local(req) || !sameSite(req)) return send(res, 403, {error:'The editor is available on the host computer'});
      if (url.pathname === '/api/archive' && req.method === 'GET') {
        await mutation;return send(res,200,await store.exportArchive(),'application/octet-stream');
      }
      if (url.pathname === '/api/import' && req.method === 'POST') {
        const name=url.searchParams.get('name');
        if (!/^[\w .-]+\.(png|ase|aseprite|wav|ogg|opus|qoa)$/i.test(name??''))throw Error('Select an image or sound file');
        const chunks=[];let size=0;
        for await(const chunk of req){if((size+=chunk.length)>32*1024*1024)throw Error('File exceeds 32 MiB');chunks.push(chunk);}
        await change(async()=>{
          const path='assets/'+name;
          if((await store.list('assets')).includes(path))throw Error('An asset with this name exists');
          await store.save([[path,Buffer.concat(chunks)]]);revision++;
        });
        return send(res,200,{ok:true});
      }
      if (url.pathname === '/api/preview' && req.method === 'GET') return send(res,200,editorBytes,'application/octet-stream');
      if (url.pathname === '/api/status' && req.method === 'GET') return send(res, 200, {revision, sourceError});
      if (url.pathname === '/api/rebuild' && req.method === 'POST') {
        await change(() => recompile(undefined, undefined, () => {}));
        return send(res, 200, {ok:true});
      }
      if (url.pathname === '/api/project' && req.method === 'GET') {
        await mutation;
        return send(res, 200, {project:JSON.parse(await store.read('project.json','utf8')), assets:await discoverAssets(root,store), art:await describeArt(root,store), revision});
      }
      if (url.pathname === '/api/project' && req.method === 'PUT') {
        const project = await jsonBody(req);
        await change(() => recompile(project, undefined, () => store.save([['project.json',JSON.stringify(project,null,2)+'\n']])));
        return send(res, 200, {ok:true});
      }
      const match = url.pathname.match(/^\/api\/script\/([a-zA-Z0-9_-]+)$/);
      if (match) {
        const id = match[1];
        if (req.method === 'GET') {
          await mutation;
          const project = JSON.parse(await store.read('project.json','utf8'));
          if (!Object.hasOwn(project.sprites,id)) return send(res, 404, {error:'Unknown sprite'});
          const file = project.sprites[id].script ?? `scripts/${id}.cbor`;
          const data = await store.read(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
          return send(res, 200, data ? decodeCbor(data) : {events:{}});
        }
        if (req.method === 'PUT') {
          const script = await jsonBody(req);
          await change(async () => {
            const project = JSON.parse(await store.read('project.json','utf8'));
            if (!Object.hasOwn(project.sprites,id)) throw Error('Unknown sprite');
            const established = project.sprites[id].script;
            const file = established ?? `scripts/${id}.cbor`;
            project.sprites[id].script = established ?? `scripts/${id}.cbor`;
            await recompile(project, new Map([[id,script]]), async () => {
              await store.save([[file,encodeCbor(script)],...(!established ? [['project.json',JSON.stringify(project,null,2)+'\n']] : [])]);
            });
          });
          return send(res, 200, {ok:true});
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
    if (!file || !/^assets[\\/]/.test(file)) return;
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
