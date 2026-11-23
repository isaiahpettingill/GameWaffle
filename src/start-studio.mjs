import {access,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {studioBuildId} from './studio-build-state.mjs';

function run(command,args){
  const result=spawnSync(command,args,{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
}
const id=await studioBuildId();
let ready=false;
try{
  await Promise.all(['site/projects.html','site/index.html','runtime/runtime_bg.wasm','runtime/runtime.js','standalone/gamewaffle-player.html','demo.waffle'].map(p=>access('web-built/'+p)));
  ready=(await readFile('web-built/studio-build-id','utf8'))===id;
}catch{}
if(!ready){
  run(process.execPath,['src/compiler.mjs']);
  run(process.execPath,['src/build.mjs']);
}
const args=process.argv.slice(2);
if(args[0]==='--browser')run(process.execPath,['src/server.mjs','--open',...args.slice(1)]);
else run('cargo',['run','--locked','--manifest-path','studio/Cargo.toml','--',...args]);
