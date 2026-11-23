import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,cp,mkdtemp,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {zipSync} from 'fflate';
import {projectStore} from './project-store.mjs';

export async function launch(port,open){
  const home=join(homedir(),'GameWaffle');
  const children=new Set();
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>process.exit());
  process.on('exit',()=>{for(const child of children)child.kill();});
  const icon='data:image/svg+xml;base64,'+(await readFile(new URL('../packaging/gamewaffle.svg',import.meta.url))).toString('base64');
  const page=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="${icon}"><title>GameWaffle Studio</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#1b2025;color:#e4e8ea;font:15px system-ui,sans-serif;color-scheme:dark}header{padding:.65rem 1rem;border-bottom:1px solid #42494f;background:#23292e;font-weight:650}main{max-width:37rem;margin:clamp(1rem,8vh,5rem) auto;padding:0 1rem}
h1{font-size:1.3rem}form{display:grid;gap:.65rem;background:#272d32;border:1px solid #42494f;padding:1rem;margin-top:-1px}label{display:grid;gap:.3rem;color:#c1cbd0}button,input,select{font:inherit;color:inherit;background:#1d2328;border:1px solid #58646b;padding:.5rem;border-radius:1px}button{justify-self:start;cursor:pointer;background:#344047}button:hover,button:focus-visible{border-color:#93ced6}button[value=new]{background:#e5bc72;color:#24282a}
</style><header><img src="${icon}" width="24" height="24" alt="" style="vertical-align:middle;margin-right:.5rem">GameWaffle Studio</header><main><h1>Projects</h1><form method="post"><label>New project name<input name="name" required maxlength="80"></label>
<label>Storage<select name="storage"><option value="folder">Project folder</option><option value="archive">Single project file (.waffleproj)</option></select></label>
<label>First room<select name="view"><option value="platformer">Platformer</option><option value="top_down">Top-down</option></select></label>
<button name="action" value="new">Create project</button></form>
<form method="post"><label>Existing project folder or .waffleproj file<input name="path" required></label><button name="action" value="open">Open project</button></form>
<form method="post"><button name="action" value="demo">Open Basalt Works example</button></form></main></html>`;
  const server=createServer(async(req,res)=>{
    try{
      if(req.method==='GET'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page);return;}
      if(req.method!=='POST'||req.headers.origin!==`http://127.0.0.1:${server.address().port}` && req.headers.origin!==`http://localhost:${server.address().port}`)throw Error('Open Studio on this computer');
      let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw Error('Project path too long');}
      const form=new URLSearchParams(body),action=form.get('action');let project;
      if(action==='open'){
        project=resolve(form.get('path')||'');await (await projectStore(project)).read('project.json');
      }else{
        await mkdir(home,{recursive:true});
        if(action==='demo'){project=await mkdtemp(join(home,'Basalt Works-'));await cp('demo',project,{recursive:true});}
        else{
          const name=form.get('name')?.trim();
          if(action!=='new'||!name||!/^[-\p{L}\p{N} _]{1,80}$/u.test(name))throw Error('Use letters, numbers, spaces, underscores, or hyphens');
          const view=form.get('view')==='top_down'?'top_down':'platformer';
          const room={title:'First room',cols:24,rows:16,view,entities:[],layers:[{name:'Ground',order:0,collidable:true,cells:[]}]};
          const manifest=JSON.stringify({name,start:'room',tileSize:16,sprites:{},tiles:{},audio:{},rooms:{room}},null,2);
          if(form.get('storage')==='archive'){
            project=join(home,name+'.waffleproj');
            await writeFile(project,zipSync({'project.json':Buffer.from(manifest)}),{flag:'wx'});
          }else{
            project=join(home,name);await mkdir(project);
            await mkdir(join(project,'assets'));await mkdir(join(project,'scripts'));
            await writeFile(join(project,'project.json'),manifest);
          }
        }
      }
      const url=await new Promise((ok,fail)=>{
        const child=spawn(process.execPath,['src/server.mjs','--project',project,'--port','0'],{stdio:['pipe','pipe','pipe'],env:{...process.env,GW_PARENT_PIPE:"1",GAMEWAFFLE_LAUNCHER:`http://127.0.0.1:${server.address().port}/`}});
        children.add(child);let log='';
        child.stderr.on('data',b=>log=(log+b).slice(-2000));
        child.on('error',fail);child.on('exit',()=>{children.delete(child);fail(Error(log||'Could not open project'));});
        child.stdout.on('data',b=>{const m=String(b).match(/localhost:(\d+)/);if(m)ok('http://127.0.0.1:'+m[1]);});
      });
      res.writeHead(303,{Location:url});res.end();
    }catch(err){res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8'});res.end(err.message);}
  });
  server.listen(port,'127.0.0.1',()=>{const url='http://127.0.0.1:'+server.address().port;console.log('GameWaffle listening on '+url);
    if(open){const win=process.platform==='win32';spawn(win?'rundll32.exe':process.env.TERMUX_VERSION?'termux-open-url':'xdg-open',win?['url.dll,FileProtocolHandler',url]:[url]).on('error',()=>{});}
  });
}
