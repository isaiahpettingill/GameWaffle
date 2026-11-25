import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileProject} from '../src/compiler.mjs';
import {decodeFrame} from '../src/frame.mjs';
import {decodeSave} from '../src/save.mjs';
import {pack} from '../src/pack.mjs';
import {parseScript} from '../src/wafflescript.mjs';
import {exportStandalone, aotMarker, cartridgeMarker} from '../src/web-export.mjs';
import {Runtime, compile_aot_scripts, initSync} from '../web-built/runtime/runtime.js';

const sample=JSON.parse(await readFile('demo/project.json','utf8'));
const project={name:'Ahead of time',tileSize:24,start:'test',
  sprites:{hero:{source:sample.sprites.maker.source}},
  rooms:{test:{title:'Test room',cols:12,rows:8,view:'top_down',entities:[{sprite:'hero',x:48,y:48,player:0}],layers:[]}},
};
const kernel=(value,factor)=>Array.from({length:9},()=>factor)
  .reduce((expr,op)=>'('+expr+op+')',value);
const startup=kernel('global_real.total',' * 1.02 - 0.01');
const tick=kernel('global_real.distance',' * 0.98 + 0.02');
const scripts=new Map([
  ['game',parseScript(`global total = 1.0
global distance = 0.5
on game startup
  global_real.total = ${startup}
end
on tick
  global_real.distance = ${tick}
end`)],
  ['hero',parseScript(`on tick\n  global_real.distance = ${tick}\nend`)],
]);
const cart=pack(await compileProject('demo',{project,scripts}));
initSync({module:await readFile('web-built/runtime/runtime_bg.wasm')});
const aot=compile_aot_scripts(cart);
const version='GW-AOT\x01';
const headerLength=version.length+64;
assert.equal(new TextDecoder().decode(aot.slice(0,version.length)),version);
assert.equal(WebAssembly.Module.exports(new WebAssembly.Module(aot.slice(headerLength))).length,2,
  'Equivalent regions share an export');
assert.deepEqual(aot,compile_aot_scripts(cart));
const embedded=(html,id)=>Buffer.from(html.match(new RegExp('<script\\b[^>]*id="'+id+'"[^>]*>([^<]*)</script>'))[1].trim(),'base64');
const html=await exportStandalone(cart);
assert.deepEqual(embedded(html,'gamewaffle-cartridge'),Buffer.from(cart));
assert.deepEqual(embedded(html,'gamewaffle-aot'),Buffer.from(aot));
assert.ok(!html.includes(aotMarker)&&!html.includes(cartridgeMarker));
const player=await readFile('web-built/standalone/gamewaffle-player.html','utf8');
assert.equal(embedded(player,'gamewaffle-cartridge').length,0);
assert.equal(embedded(player,'gamewaffle-aot').length,0);

const open=bytes=>Runtime.from_cartridge_with_aot(cart,bytes,undefined,undefined,640,480);
const compiled=open(aot), interpreted=open(new Uint8Array());
const incompatible=aot.slice();incompatible[version.length]^=1;
try{
  assert.equal(interpreted.jit_executions(),0);
  assert.equal(compiled.jit_executions(),1,'Use compiled code during game startup');
  interpreted.set_jit_enabled(false);
  for(let i=0;i<40;i++){
    compiled.advance_buttons(0,1);interpreted.advance_buttons(0,1);
    assert.deepEqual(decodeFrame(compiled.snapshot()),decodeFrame(interpreted.snapshot()));
  }
  assert.equal(compiled.jit_executions(),81,'Both copies of the tick kernel run from the first tick');
  assert.deepEqual(decodeSave(compiled.save_game()),decodeSave(interpreted.save_game()));
  for(const invalid of [incompatible,aot.slice(0,headerLength+3)]){
    const fallback=open(invalid);
    try{assert.equal(fallback.jit_executions(),0);fallback.advance_buttons(0,1);}
    finally{fallback.free();}
  }
}finally{compiled.free();interpreted.free();}
const withoutKernels=pack(await compileProject('demo',{project,scripts:new Map([['game',{events:{}}]])}));
assert.equal(compile_aot_scripts(withoutKernels).length,0);
assert.equal(embedded(await exportStandalone(withoutKernels),'gamewaffle-aot').length,0);
console.log('Passed standalone AOT export, startup execution, kernel sharing, interpreter parity, and fallback');
