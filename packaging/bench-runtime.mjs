import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileProject} from '../src/compiler.mjs';
import {pack} from '../src/pack.mjs';
import {compileScript} from '../src/script.mjs';
import {parseScript} from '../src/wafflescript.mjs';
import {decodeFrame} from '../src/frame.mjs';
import {decodeSave} from '../src/save.mjs';

const args=process.argv.slice(2);
const fixtureFlag=args.indexOf('--write-fixtures');
let fixtureDir;
if(fixtureFlag>=0){
  [,fixtureDir]=args.splice(fixtureFlag,2);
  if(!fixtureDir)throw Error('Pass a directory to --write-fixtures');
}

function compare(label,iterations,cases){
  for(const entry of cases)entry.samples=[];
  for(let sample=0;sample<5;sample++){
    for(let offset=0;offset<cases.length;offset++){
      const {run,setup,cleanup,samples}=cases[(sample+offset)%cases.length];
      const state=setup?.();
      try{
        for(let i=0;i<Math.min(iterations/5,1000);i++)run(state);
        const start=performance.now();
        for(let i=0;i<iterations;i++)run(state);
        samples.push((performance.now()-start)*1000/iterations);
      }finally{cleanup?.(state);}
    }
  }
  for(const {label:variant,samples} of cases){
    samples.sort((a,b)=>a-b);
    console.log(`${variant?`${variant} · `:''}${label}: ${samples[2].toFixed(2)} µs (median of five)`);
  }
}
const bench=(label,iterations,run)=>compare(label,iterations,[{run}]);

const scripts=[
  ['small script', 'on tick\nif action.a\n change global.total by 7\nend\nend',5000],
  ['280 assignments','on tick\n'+Array.from({length:280},(_,i)=>
    `global.value_${i} = (global.value_${i} + ${i+1}) * 2`).join('\n')+'\nend',300],
  ['100 routines',Array.from({length:100},(_,i)=>
    `def fn_${i}(x: integer)\nreturn x + ${i}\nend\n`).join('')+'on tick\nglobal.total = fn_0(7)\nend',200],
];
for(const [label,source,iterations] of scripts){
  const script=parseScript(source);
  bench(`${label}, parse`,iterations,()=>parseScript(source));
  bench(`${label}, compile`,iterations,()=>compileScript(script));
}

const project=JSON.parse(await readFile('demo/project.json','utf8'));
const demo=pack(await compileProject('demo',{project}));
const actorsWithoutScripts=new Map(Object.keys(project.sprites).map(id=>[id,{events:{}}]));
const repeatScripts=new Map(actorsWithoutScripts);
repeatScripts.set('maker',parseScript('on tick\nrepeat 64\nchange global.total by 7\nend\nend'));
const repeat=pack(await compileProject('demo',{project,scripts:repeatScripts}));

project.sprites.bench_actor={source:'assets/sprites/key.png',physics:{mode:'sensor'}};
project.rooms.yard.entities.push(...Array.from({length:96},(_,i)=>({
  sprite:'bench_actor',x:60+i%24*24,y:90+Math.floor(i/24)*35,
})));
actorsWithoutScripts.set('bench_actor',parseScript('on tick\nchange local.age by 1\nend'));
const crowded=pack(await compileProject('demo',{project,scripts:actorsWithoutScripts}));
const cartridges=[['demo',demo],['repeat',repeat],['crowded',crowded]];
if(fixtureDir){
  await mkdir(fixtureDir,{recursive:true});
  await Promise.all(cartridges.map(([name,bytes])=>writeFile(join(fixtureDir,name+'.waffle'),bytes)));
}

const runtimes=[];
for(const folder of args.length?args:['web-built/runtime']){
  const {Runtime,initSync}=await import(pathToFileURL(resolve(folder,'runtime.js')));
  initSync({module:await readFile(resolve(folder,'runtime_bg.wasm'))});
  const open=bytes=>{
    const runtime=Runtime.from_cartridge(bytes);
    runtime.set_seed(1);
    return runtime;
  };
  const probe=open(demo);
  const legacy=typeof probe.snapshot()==='string';
  probe.free();
  const frame=legacy?JSON.parse:decodeFrame;
  const save=legacy?JSON.parse:decodeSave;
  runtimes.push({label:folder,open,frame,save,advance:Boolean(Runtime.prototype.advance_buttons)});
}
const free=runtime=>runtime.free();
compare('demo, cartridge load',60,runtimes.map(({label,open})=>({label,run:()=>open(demo).free()})));
for(const [scenario,bytes] of cartridges){
  const ticks=scenario==='crowded'?6000:18000;
  compare(`${scenario}, tick + decoded snapshot`,ticks,runtimes.map(({label,open,frame,save})=>({
    label,setup:()=>open(bytes),run:runtime=>frame(runtime.step_buttons(16)),cleanup:runtime=>{
      assert.equal(frame(runtime.snapshot()).tick,ticks+1000);
      if(scenario==='repeat')assert.equal(save(runtime.save_game()).globals.total,String((ticks+1000)*64*7));
      runtime.free();
    },
  })));
}
compare('demo, decoded snapshot',18000,runtimes.map(({label,open,frame})=>({
  label,setup:()=>open(demo),run:runtime=>frame(runtime.snapshot()),cleanup:free,
})));
compare('crowded, save',300,runtimes.map(({label,open})=>({
  label,setup:()=>open(crowded),run:runtime=>runtime.save_game(),cleanup:free,
})));
const simulation=runtimes.filter(entry=>entry.advance);
if(simulation.length)compare('repeat, simulation only',18000,simulation.map(({label,open})=>({
  label,setup:()=>open(repeat),run:runtime=>runtime.advance_buttons(16,1),cleanup:free,
})));
