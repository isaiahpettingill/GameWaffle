import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileProject} from '../src/compiler.mjs';
import {pack} from '../src/pack.mjs';
import {parseScript} from '../src/wafflescript.mjs';

const project=JSON.parse(await readFile('demo/project.json','utf8'));
const inputs=[['integer updates','change global.total by 7'],
  ['input and variable updates','if action.a\n  change global.total by 7\nend'],
  ['entity query and host command','if entity.exists(entity.id)\n  set_entity_visible(entity.id, true)\n  change global.total by 7\nend',32]];
const fixtures=[];
for(const [label,body,iterations=64] of inputs){
  const scripts=new Map(Object.keys(project.sprites).map(id=>[id,{events:{}}]));
  scripts.set('maker',parseScript('on tick\nrepeat '+iterations+'\n'+body+'\nend\nend'));
  fixtures.push([label,pack(await compileProject('demo',{project,scripts})),undefined,iterations]);
}
const realKernel=Array.from({length:15},()=> ' * 0.995 + 0.005').reduce((body,op)=>'('+body+op+')','global_real.total');
const kernelScripts=new Map(Object.keys(project.sprites).map(id=>[id,{events:{}}]));
kernelScripts.set('maker',parseScript('on tick\nrepeat 10\n global_real.total = '+realKernel+'\nend\nend'));
const kernel=pack(await compileProject('demo',{project,scripts:kernelScripts}));
for(const root of process.argv.slice(2).length?process.argv.slice(2):['web-built/runtime']){
  const folder=resolve(root);
  const {Runtime,initSync}=await import(pathToFileURL(join(folder,'runtime.js')));
  initSync({module:await readFile(join(folder,'runtime_bg.wasm'))});
  const modes=Runtime.prototype.set_jit_enabled?[...fixtures,['real kernel, interpreter',kernel,false],['real kernel, JIT',kernel,true]]:fixtures.slice(0,2);
  for(const [label,bytes,jit,iterations=10] of modes){
    const results=[];
    for(let run=0;run<5;run++){
      const runtime=Runtime.from_cartridge(bytes);
      if(jit!==undefined)runtime.set_jit_enabled(jit);
      for(let i=0;i<2000;i++)runtime.step_buttons(16);
      const start=performance.now();
      for(let i=0;i<15000;i++)runtime.step_buttons(16);
      const elapsed=performance.now()-start;
      const saved=JSON.parse(runtime.save_game());
      if(jit===undefined)assert.equal(saved.globals.total,String((2000+15000)*iterations*7));
      else{
        assert.ok(Number(saved.globals['real.total'])>.99);
        assert.equal(runtime.jit_executions()>0,jit);
      }
      results.push((elapsed*1e6)/(15000*iterations));
      runtime.free();
    }
    results.sort((a,b)=>a-b);
    console.log(`${folder} · ${label}: ${results[2].toFixed(1)} ns per loop iteration`);
  }
}
