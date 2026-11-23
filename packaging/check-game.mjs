import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Runtime,initSync} from '../web-built/runtime/runtime.js';
import {projectStore} from '../src/project-store.mjs';
import {compileProject} from '../src/compiler.mjs';
import {pack} from '../src/pack.mjs';
import {unpack} from '../src/cartridge.mjs';
initSync({module:await readFile('web-built/runtime/runtime_bg.wasm')});
const bytes=await readFile('web-built/demo.waffle');
const cart=unpack(bytes);
assert.equal(cart.camera.min_width,128);
assert.equal(cart.camera.min_height,128);
const modified=Buffer.from(bytes);
modified[modified.length-97]^=1;
assert.throws(()=>Runtime.from_cartridge(modified));
assert.throws(()=>unpack(Uint8Array.from([71,87,65,70,0,1])));
const rt=Runtime.from_cartridge(bytes);
const frame=(bits=0)=>JSON.parse(rt.step_buttons(bits));
const player=state=>state.actors.find(actor=>actor.player===0);
function place(room,x,y){
  const save=JSON.parse(rt.save_game());
  save.room=room;save.players={0:[x,y]};
  rt.load_game(JSON.stringify(save));
}
// Traverse the gap from the stacked crates to the top ledge.
place('yard',349,276);
for(let i=0;i<20;i++)frame();
let state=frame(24);
for(let i=0;i<48;i++)state=frame(8);
for(let i=0;i<60;i++)state=frame();
assert.ok(player(state).x>432 && Math.abs(player(state).y-228)<2,JSON.stringify(player(state)));
// Cross a continuous edge and keep moving.
place('yard',669,320);
for(let i=0;i<8;i++)state=frame(8);
assert.equal(state.room,'vault');
assert.ok(player(state).x<30);
place('courtyard',84,220);
for(let i=0;i<3;i++)state=frame();
assert.ok(state.dialog);
assert.equal(state.counters.Keys,1);
const saved=rt.save_game();
assert.equal(JSON.parse(saved).inventory.key,1);
rt.reset();rt.load_game(saved);
assert.ok(JSON.parse(rt.save_game()).flags.includes('found_key'));
const tmp=await mkdtemp(join(tmpdir(),'gamewaffle-'));
try{
  const folder=await projectStore(resolve('demo'));
  const path=join(tmp,'test.waffleproj');
  await writeFile(path,await folder.exportArchive());
  const archive=await projectStore(path);
  const project=JSON.parse(await archive.read('project.json','utf8'));
  project.name='Archive test';
  await archive.save([['project.json',JSON.stringify(project)]]);
  assert.equal(unpack(pack(await compileProject(path))).name,project.name);
}finally{await rm(tmp,{recursive:true,force:true});rt.free();}
console.log('Passed cartridge, jump, room crossing, inventory, dialogue, save, PNG, and archive checks');
