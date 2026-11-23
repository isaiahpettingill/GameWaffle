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
assert.equal(state.particles.reduce((total,batch)=>total+batch.points.length,0),24);
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

// A flag-controlled layer changes its visible tiles and collision bodies in play.
const conditional=await compileProject(resolve('demo'),{
  project:await (async()=>{
    const p=JSON.parse(await readFile('demo/project.json','utf8'));
    p.rooms.yard.layers.push({name:'Gate',flag:'found_key',collidable:true,cells:[[4,8,'stone']]});
    return p;
  })(),
  scripts:new Map([['maker',{events:{b:[{op:'set',scope:'flag',name:'found_key',value:true}]}}]])
});
const gated=Runtime.from_cartridge(pack(conditional));
const gatePresent=frame=>JSON.parse(frame).actors.some(a=>a.x===108 && a.y===204);
assert.equal(gatePresent(gated.snapshot()),false);
assert.equal(gatePresent(gated.step_buttons(32)),true);
gated.free();

const source=JSON.parse(await readFile('demo/project.json','utf8'));
source.rooms.yard.entities=source.rooms.yard.entities.filter(e=>e.player===0 || e.sprite==='drone');
const bossScript=new Map([['drone',{events:{tick:[{op:'velocity',x:1,y:0}]}}]]);
for(const alwaysActive of [false,true]){
  source.sprites.drone.alwaysActive=alwaysActive;
  const game=Runtime.from_cartridge(pack(await compileProject(resolve('demo'),{project:source,scripts:bossScript})));
  game.set_view_size(128,128);
  const drone=state=>JSON.parse(state).actors.find(a=>a.image.startsWith('sprite/drone/')).x;
  const before=drone(game.snapshot());
  for(let i=0;i<30;i++)game.step_buttons(0);
  assert.equal(drone(game.snapshot())>before,alwaysActive);
  game.free();
}

// Player two defeats a persistent boss and keeps the reward across a save.
const arena=JSON.parse(await readFile('demo/project.json','utf8'));
arena.rooms.yard.entities=[
  {sprite:'maker',player:0,x:48,y:96},
  {sprite:'runner',player:1,x:120,y:96},
  {sprite:'drone',name:'guardian',persistRemoval:true,x:142,y:96,physics:{health:1}},
];
const scripts=new Map([
  ['maker',{events:{start:[{op:'group_camera'}]}}],
  ['runner',{events:{b:[{op:'damage',amount:100,range:80,height:80}]}}],
  ['drone',{events:{damage:[{op:'give_player',item:'key',player:{actor:'other_player'},count:1}]}}],
]);
const battle=Runtime.from_cartridge(pack(await compileProject(resolve('demo'),{project:arena,scripts})));
battle.step_buttons(0);
battle.step_buttons(32<<8);
const checkpoint=battle.save_game(),progress=JSON.parse(checkpoint);
assert.equal(progress.personal[1].key,1);
assert.deepEqual(progress.removed.yard,['sprite/guardian']);
battle.reset();battle.load_game(checkpoint);
assert.ok(!JSON.parse(battle.snapshot()).actors.some(a=>a.image.startsWith('sprite/drone/')));
battle.free();

const shaderProject=JSON.parse(await readFile('demo/project.json','utf8'));
const startRoom=shaderProject.rooms[shaderProject.start];
for(const [kind,passes] of Object.entries({
  tint:['screen'],scanlines:['rows'],grid:['columns','rows'],vignette:['screen'],ripple:[],
})){
  startRoom.shader={kind,color:'#274869',strength:50,spacing:7};
  const packed=unpack(pack(await compileProject('demo',{project:shaderProject})));
  const names=Object.keys(packed.atlases[packed.start].entries).filter(k=>k.startsWith('post/')).sort();
  assert.deepEqual(names,passes.map(p=>'post/'+p));
  assert.deepEqual(packed.rooms[packed.start].ripple,kind==='ripple'?[6,32,1]:null);
}
startRoom.shader={kind:'ripple',wavelength:0};
await assert.rejects(compileProject('demo',{project:shaderProject}),/wavelength/);
console.log('Passed room shader cartridge and parameter checks');

// Two physical controls can hold one action across several input frames.
const {parseScript}=await import('../src/wafflescript.mjs');
const inputProject=structuredClone(arena);
inputProject.controls={dash:['a','x']};
const inputScript=parseScript(`proc count(amount)
  global.presses = global.presses + amount
end
on pressed.dash
  count(1)
  follow_player(2)
end
on released.dash
  global.releases = global.releases + 1
end
on tick
  global.held = action.dash
  if released.dash
    global.tick_releases = global.tick_releases + 1
  end
end`);
const inputScripts=new Map([['maker',inputScript]]);
const inputRuntime=Runtime.from_cartridge(pack(await compileProject(resolve('demo'),{project:inputProject,scripts:inputScripts})));
for(const bits of [0,16,80,64,0,16])inputRuntime.step_buttons(bits);
const inputSave=JSON.parse(inputRuntime.save_game());
assert.equal(Number(inputSave.globals.presses),2);
assert.equal(Number(inputSave.globals.releases),1);
assert.equal(Number(inputSave.globals.tick_releases),1);
assert.equal(Number(inputSave.globals.held),1);
const scene=JSON.parse(inputRuntime.snapshot()),second=scene.actors.find(a=>a.player===1);
assert.deepEqual(scene.focus,[second.x,second.y]);
inputRuntime.free();
await assert.rejects(compileProject('demo',{project:inputProject,scripts:new Map([['maker',parseScript('on a\n give("unknown_item", 1)\nend')]])}),/Register item/);
await assert.rejects(compileProject('demo',{project:inputProject,scripts:new Map([['maker',parseScript('on pressed.typo\n jump(8)\nend')]])}),/Map action/);
console.log('Passed input action edges, held input, procedure arguments, camera target, and registry checks');

const jumpSource=`on tick
  if not flag.float
    apply_gravity(none)
  end
  if pressed.x and actor.grounded
    global.jumps = global.jumps + 1
    animate("idle")
    jump_force(240)
  end
end`;
const jumpProject=structuredClone(source);
jumpProject.rooms.yard.entities.find(e=>e.player===0).standardMovement=true;
jumpProject.flags={...jumpProject.flags,float:false};
const jumpCart=await compileProject(resolve('demo'),{project:jumpProject,scripts:new Map([['maker',parseScript(jumpSource)]])});
const jumpRuntime=Runtime.from_cartridge(pack(jumpCart));
const stepJump=bits=>player(JSON.parse(jumpRuntime.step_buttons(bits)));
for(let i=0;i<90;i++)stepJump(0);
const rest=stepJump(0).y;
stepJump(64);
assert.ok(stepJump(64).y<rest,'Jump force must move the grounded player upward');
for(let i=0;i<240;i++)stepJump(64);
assert.equal(Number(JSON.parse(jumpRuntime.save_game()).globals.jumps),1);
const floatSave=JSON.parse(jumpRuntime.save_game());
floatSave.flags.push('float');floatSave.players={0:[62,150]};
jumpRuntime.load_game(JSON.stringify(floatSave));
const high=stepJump(0).y;
assert.ok(Math.abs(stepJump(0).y-high)<.01,'Skipping gravity must suspend a dynamic actor');
jumpRuntime.free();
console.log('Passed conditional gravity, grounded jump, and one press while held');
