import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,cp,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {projectStore} from './project-store.mjs';

export async function launch(port,open){
  const home=join(homedir(),'GameWaffle');
  const children=new Set();
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>process.exit());
  process.on('exit',()=>{for(const child of children)child.kill();});
  const page=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>GameWaffle Studio</title>
<style>body{background:#20202b;color:#eee;font:17px system-ui;margin:10vh auto;width:min(90%,34rem)}form{display:grid;gap:.7rem;margin:2rem 0}input,button{font:inherit;padding:.65rem;border-radius:.4rem}button{cursor:pointer}label{display:grid;gap:.4rem}</style>
<h1>GameWaffle Studio</h1><form method="post"><label>New project name<input name="name" required></label><button name="action" value="new">Create project</button></form>
<form method="post"><label>Existing project folder or .waffleproj file<input name="path" required></label><button name="action" value="open">Open project</button></form>
<form method="post"><button name="action" value="demo">Open Basalt Works example</button></form>`;
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
          project=join(home,name);await mkdir(project);
          await mkdir(join(project,'assets'));await mkdir(join(project,'scripts'));
          const room={title:'First room',cols:24,rows:16,view:'platformer',entities:[],layers:[{name:'Ground',order:0,collidable:true,cells:[]}]};
          await writeFile(join(project,'project.json'),JSON.stringify({name,start:'room',tileSize:16,sprites:{},tiles:{},audio:{},rooms:{room}},null,2));
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
