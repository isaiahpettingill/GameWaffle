import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileProject} from '../src/compiler.mjs';
import {pack} from '../src/pack.mjs';
import {decodeFrame} from '../src/frame.mjs';
import {parseScript} from '../src/wafflescript.mjs';

const args=process.argv.slice(2);
const outputIndex=args.indexOf('--write-fixtures');
const output=outputIndex<0?null:args.splice(outputIndex,2)[1];
if(outputIndex>=0&&!output)throw Error('Pass a directory to --write-fixtures');

const demo=JSON.parse(await readFile('demo/project.json','utf8'));
const actor={source:'assets/sprites/key.png',alwaysActive:true};
const placed=(count,columns,spacing)=>Array.from({length:count},(_,i)=>({
  sprite:'subject',x:12+(i%columns)*spacing,y:12+Math.floor(i/columns)*spacing,
}));
const cells=(cols,rows,tile)=>Array.from({length:cols*rows/2},(_,i)=>[
  (2*i)%cols,Math.floor(2*i/cols),tile,0,
]);
const inputs=0;
const fixtures=new Map([['demo',pack(await compileProject('demo'))]]);
const scenes=[
  ['fixed terrain',{tiles:{stone:demo.tiles.stone},cells:cells(96,32,'stone'),entities:placed(8,8,48)}],
  ['dynamic bodies',{physics:{mode:'dynamic',gravity:0},entities:placed(192,24,30)}],
  ['fluid zones',{tiles:{water:demo.tiles.water},cells:cells(48,32,'water'),
    physics:{mode:'dynamic',gravity:0},entities:placed(192,24,48)}],
  ['particles',{entities:placed(64,8,24),script:'on init\nset_emitter("snow", 240, 0, 0)\nend'}],
  ['script dispatch',{entities:placed(256,32,24),script:'on tick\nchange local.age by 1\nend'}],
];
for(const [name,{tiles={},cells=[],entities,physics,script}] of scenes){
  const project={name,tileSize:24,start:'test',tiles,sprites:{subject:{...actor,physics}},
    rooms:{test:{cols:96,rows:40,view:'top_down',border:'open',entities,layers:[{collidable:true,cells}]}}};
  const scripts=new Map(script?[['subject',parseScript(script)]]:[]);
  fixtures.set(name,pack(await compileProject('demo',{project,scripts})));
}
if(output){
  await mkdir(output,{recursive:true});
  for(const [name,cart] of fixtures)await writeFile(resolve(output,name.replaceAll(' ','-')+'.waffle'),cart);
}

const variants=[];
for(const label of args.length?args:['web-built/runtime']){
  const {Runtime,initSync}=await import(pathToFileURL(resolve(label,'runtime.js')));
  initSync({module:await readFile(resolve(label,'runtime_bg.wasm'))});
  variants.push({label,Runtime});
}
for(const [scene,cart] of fixtures){
  const ticks=scene==='demo'?4000:1000, warmup=200;
  for(const [phase,run] of [
    ['simulation',runtime=>runtime.advance_buttons(inputs,1)],
    ['snapshot encoding',runtime=>runtime.snapshot()],
    ['snapshot decoding',(_,bytes)=>decodeFrame(bytes)],
  ]){
    const timings=variants.map(()=>[]);
    let expected;
    for(let sample=0;sample<5;sample++)for(let offset=0;offset<variants.length;offset++){
      const index=(sample+offset)%variants.length;
      const runtime=variants[index].Runtime.from_cartridge(cart);
      try{
        runtime.set_seed(1);
        for(let i=0;i<warmup;i++)runtime.advance_buttons(inputs,1);
        const frame=runtime.snapshot();
        for(let i=0;i<50;i++)run(runtime,frame);
        const start=performance.now();
        for(let i=0;i<ticks;i++)run(runtime,frame);
        timings[index].push((performance.now()-start)*1000/ticks);
        const snapshot=decodeFrame(runtime.snapshot());
        if(expected)assert.deepEqual(snapshot,expected,scene+' '+phase+' changed the deterministic snapshot');
        else expected=snapshot;
      }finally{runtime.free();}
    }
    for(const [index,{label}] of variants.entries()){
      timings[index].sort((a,b)=>a-b);
      console.log(`${scene} · ${phase} · ${label}: ${timings[index][2].toFixed(2)} µs (median of five)`);
    }
  }
}
