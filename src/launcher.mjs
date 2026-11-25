import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,cp,mkdtemp,readFile,readdir,stat,rename} from 'node:fs/promises';
import {join,resolve,dirname,isAbsolute,sep} from 'node:path';
import {homedir} from 'node:os';
import {zipSync} from 'fflate';
import {projectStore} from './project-store.mjs';
import {projectBasename} from './resource-name.mjs';
import {encodeCbor} from './cartridge.mjs';
import {gameScriptPath,initialGameScript} from './game-script.mjs';
import {initialRoomScript,roomScriptPath} from './room-script.mjs';

export async function launch(port,open){
  const home=join(homedir(),'GameWaffle');
  await mkdir(home,{recursive:true});
  const settings=join(home,'.studio-location.json');
  let location=home,recent=[],resume=true,writes=Promise.resolve();
  try {
    const saved=JSON.parse(await readFile(settings,'utf8'));
    if(Array.isArray(saved.recent))recent=saved.recent.filter(entry=>typeof entry?.path==='string'&&isAbsolute(entry.path)&&typeof entry.name==='string').slice(0,20);
    if(isAbsolute(saved.folder)&&(await stat(saved.folder)).isDirectory())location=saved.folder;
  } catch {}
  function remember(folder,project){
    location=folder;
    if(project)recent=[project,...recent.filter(entry=>entry.path!==project.path)].slice(0,20);
    const data=JSON.stringify({folder,recent});
    writes=writes.catch(()=>{}).then(async()=>{
    const tmp=settings+'.'+crypto.randomUUID();
    await writeFile(tmp,data);
    await rename(tmp,settings);
    });
    return writes;
  }
  const children=new Set(),sessions=new Map();
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>process.exit());
  process.on('exit',()=>{for(const child of children)child.kill();});
  const site=resolve('web-built/site');
  const server=createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    try{
      if(req.method==='GET'){
        const path=new URL(req.url,'http://localhost').pathname;
        if(path==='/'||path==='/projects'){
          res.setHeader('Content-Type','text/html; charset=utf-8');
          res.end(await readFile(join(site,'projects.html')));return;
        }
        if(!/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css|svg)$/.test(path)){res.writeHead(404);res.end();return;}
        res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'image/svg+xml');
        res.end(await readFile(join(site,path)));return;
      }
      if(req.method!=='POST'||req.headers.origin!==`http://127.0.0.1:${server.address().port}` && req.headers.origin!==`http://localhost:${server.address().port}`)throw Error('Open Studio on this computer');
      let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw Error('Project path too long');}
      const form=new URLSearchParams(body),action=form.get('action');let project,title;
      function json(value){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));}
      if(action==='settings'){json({location,home:homedir(),sep,recent,resume});resume=false;return;}
      if(action==='forget'){
        recent=recent.filter(entry=>entry.path!==form.get('path'));
        await remember(location);json({recent});return;
      }
      if(action==='browse'){
        const path=form.get('path')||location;
        if(!isAbsolute(path))throw Error('Enter a full folder path.');
        const folder=resolve(path);
        const entries=await readdir(folder,{withFileTypes:true});
        const items=await Promise.all(entries.map(async entry=>{
          const path=join(folder,entry.name);
          const type=entry.isSymbolicLink()?await stat(path).catch(()=>null):entry;
          if(type?.isDirectory())return {name:entry.name,path,folder:true};
          if(type?.isFile()&&entry.name.endsWith('.waffleproj'))return {name:entry.name,path,folder:false};
        }));
        const drives=process.platform==='win32'?await Promise.all(Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ',async c=>{
          const drive=c+':'+sep;return (await stat(drive).catch(()=>null))?.isDirectory()?drive:null;
        })): [];
        json({folder,parent:dirname(folder),project:entries.some(e=>e.name==='project.json'),drives:drives.filter(Boolean),
          items:items.filter(Boolean).sort((a,b)=>Number(b.folder)-Number(a.folder)||a.name.localeCompare(b.name))});return;
      }
      if(action==='location'){
        const folder=form.get('path')||'';
        if(!isAbsolute(folder)||!(await stat(folder)).isDirectory())throw Error('Select a folder.');
        await remember(resolve(folder));json({location});return;
      }
      if(action==='open'){
        if(!isAbsolute(form.get('path')||''))throw Error('Select a project folder or file.');
        project=resolve(form.get('path'));title=JSON.parse(await (await projectStore(project)).read('project.json','utf8')).name;
      }else{

        if(action==='demo'){project=await mkdtemp(join(home,'basalt-works-'));await cp('demo',project,{recursive:true});title=JSON.parse(await readFile(join(project,'project.json'),'utf8')).name;}
        else{
          const name=form.get('name')?.trim();
          if(action!=='new'||!name||name.length>80||/[\p{Cc}\p{Cs}]/u.test(name))throw Error('Enter a game name of up to 80 characters.');
          const destination=form.get('parent')||location;
          if(!isAbsolute(destination)||!(await stat(destination)).isDirectory())throw Error('Select a project location.');
          title=name;
          const view=form.get('view')==='top_down'?'top_down':'platformer';
          const room={title:'First room',cols:24,rows:16,view,entities:[],layers:[{name:'Ground',order:0,collidable:true,cells:[]}]};
          const settings={name,start:'room',tileSize:16,physicsUnits:'pixels',sprites:{},tiles:{},audio:{},rooms:{room},gameScript:gameScriptPath};
          const manifest=JSON.stringify(settings,null,2);
          const script=encodeCbor(initialGameScript(settings,{examples:true}));
          const roomScript=encodeCbor(initialRoomScript(room,undefined,true));
          const archive=form.get('storage')==='archive';
          const base=projectBasename(name);
          const occupied=new Set((await readdir(destination)).map(entry=>entry.toLowerCase()));
          const data=archive?zipSync({'project.json':Buffer.from(manifest),[gameScriptPath]:script,[roomScriptPath('room')]:roomScript}):null;
          for(let suffix=1;;suffix++){
            const filename=base+(suffix>1?'-'+suffix:'')+(archive?'.waffleproj':'');
            if(occupied.has(filename))continue;
            project=join(destination,filename);
            try{
              if(archive)await writeFile(project,data,{flag:'wx'});
              else await mkdir(project);
              break;
            }catch(err){
              if(err.code!=='EEXIST')throw err;
            }
          }
          if(!archive){
            await mkdir(join(project,'assets'));
            await mkdir(join(project,'scripts'));
            await writeFile(join(project,gameScriptPath),script,{flag:'wx'});
            await mkdir(join(project,'scripts','rooms'));
            await writeFile(join(project,roomScriptPath('room')),roomScript,{flag:'wx'});
            await writeFile(join(project,'project.json'),manifest,{flag:'wx'});
          }
        }
      }
      if(!sessions.has(project))sessions.set(project,new Promise((ok,fail)=>{
        const child=spawn(process.execPath,['src/server.mjs','--project',project,'--port','0'],{stdio:['pipe','pipe','pipe'],env:{...process.env,GW_PARENT_PIPE:"1",GAMEWAFFLE_LAUNCHER:`http://127.0.0.1:${server.address().port}/`}});
        children.add(child);let log='';
        child.stderr.on('data',b=>log=(log+b).slice(-2000));
        child.on('error',err=>{children.delete(child);sessions.delete(project);fail(err);});child.on('exit',()=>{children.delete(child);sessions.delete(project);fail(Error(log||'Could not open project'));});
        child.stdout.on('data',b=>{const m=String(b).match(/localhost:(\d+)/);if(m)ok('http://127.0.0.1:'+m[1]);});
      }));
      const url=await sessions.get(project);
      await remember(action==='demo'?location:dirname(project),{path:project,name:title||project.split(sep).at(-1)});
      json({url});
    }catch(err){res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8'});res.end(err.code==='EEXIST'?'A project with this name already exists.':err.code==='ENOENT'?'The file or folder is missing. Browse to its current location.':err.message);}
  });
  return new Promise((ready,fail)=>server.once('error',fail).listen(port,'127.0.0.1',()=>{const url='http://127.0.0.1:'+server.address().port;console.log('GameWaffle listening on '+url);
    if(open){const win=process.platform==='win32';spawn(win?'rundll32.exe':process.env.TERMUX_VERSION?'termux-open-url':'xdg-open',win?['url.dll,FileProtocolHandler',url]:[url]).on('error',()=>{});}
    ready(url);
  }));
}
