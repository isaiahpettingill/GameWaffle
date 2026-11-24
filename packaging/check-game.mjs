import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {PNG} from 'pngjs';
import {Runtime,initSync} from '../web-built/runtime/runtime.js';
import {projectStore} from '../src/project-store.mjs';
import {compileProject} from '../src/compiler.mjs';
import {pack} from '../src/pack.mjs';
import {decodeCbor,encodeCbor,unpack} from '../src/cartridge.mjs';
import {encodePng} from '../src/png.mjs';
import {readBitfont} from '../src/font.mjs';
import {drawRoom} from '../ui/render.js';
import {cameraView} from '../ui/camera.js';
initSync({module:await readFile('web-built/runtime/runtime_bg.wasm')});
const bytes=await readFile('web-built/demo.waffle');
const cart=unpack(bytes);
assert.equal(bytes[5],3);
assert.ok(bytes.readUInt32LE(18)>0);
for(const {png} of Object.values(cart.atlases))assert.equal(png[25],3);
for(const [colors,depth] of [[2,1],[4,2],[16,4],[256,8],[257,8]]){
  const pixels=Buffer.alloc(17*17*4);
  for(let i=0;i<pixels.length/4;i++){
    const color=i%colors;
    pixels.writeUInt32BE(color*65536+(color*37%256),i*4);
  }
  const png=encodePng(17,17,pixels);
  assert.equal(png[24],depth);
  assert.equal(png[25],colors<=256?3:6);
  assert.deepEqual(PNG.sync.read(png).data,pixels);
}
const wrongSize=Buffer.from(bytes);
wrongSize.writeUInt32LE(bytes.readUInt32LE(18)-1,18);
assert.throws(()=>unpack(wrongSize),/expanded cartridge section length/);
const mediaStored=pack({name:'Stored media',start:'room',rooms:{room:{}},atlases:{room:{png:randomBytes(32768)}}});
assert.equal(new DataView(mediaStored.buffer).getUint32(18,true),0);
assert.equal(unpack(mediaStored).name,'Stored media');

// Reassemble a signed v2 cartridge from the same simulation and media.
const simulationStart=22+bytes.readUInt32LE(14);
const simulationEnd=simulationStart+bytes.readUInt32LE(6);
const legacyHeader=Buffer.from(bytes.subarray(0,14));
legacyHeader[5]=2;
const card=decodeCbor(bytes.subarray(22,simulationStart));
const legacyPayload=Buffer.concat([legacyHeader,bytes.subarray(simulationStart,simulationEnd),encodeCbor({...card,...cart})]);
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const legacy=Buffer.concat([legacyPayload,publicKey.export({format:'der',type:'spki'}).subarray(-32),sign(null,legacyPayload,privateKey)]);
assert.deepEqual(unpack(legacy),cart);
Runtime.from_cartridge(legacy).free();

assert.equal(cart.camera.min_width,128);
assert.equal(cart.camera.min_height,128);
const emptyAtlas={entries:{}};
const smallRoom={width:416,height:256};
const wide=cameraView({zoom:4},smallRoom,emptyAtlas,[2560,1600],[410,252]);
assert.deepEqual([wide.x,wide.y,wide.width,wide.height],[0,0,416,256]);
const inset=cameraView({resolution:[320,180]},{...smallRoom,cameraHeight:224},emptyAtlas,[2560,1600],[360,240],2);
assert.deepEqual(inset,{x:256,y:134,width:160,height:90,resolution:[320,180]});
const seam=cameraView({resolution:[320,180]},{...smallRoom,seams:{down:true}},{entries:{'seam/down':[0,0,416,24]}},[320,180],[200,255]);
assert.equal(seam.y+seam.height,280,'Show only adjoining terrain that was actually baked');
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
  global_bool.held = action.dash
  if action.dash
    global.held_ticks = global.held_ticks + 1
  end
  if pressed.dash
    global.tick_presses = global.tick_presses + 1
  end
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
assert.equal(Number(inputSave.globals['bool.held']),1);
assert.equal(Number(inputSave.globals.held_ticks),4);
assert.equal(Number(inputSave.globals.tick_presses),2);
const scene=JSON.parse(inputRuntime.snapshot()),second=scene.actors.find(a=>a.player===1);
assert.deepEqual(scene.focus,[second.x,second.y]);
inputRuntime.free();
await assert.rejects(compileProject('demo',{project:inputProject,scripts:new Map([['maker',parseScript('on a\n give("unknown_item", 1)\nend')]])}),/Register item/);
await assert.rejects(compileProject('demo',{project:inputProject,scripts:new Map([['maker',parseScript('on pressed.typo\n jump(8)\nend')]])}),/Map action/);
console.log('Passed input action edges, held input, procedure arguments, camera target, and registry checks');

const simultaneous=parseScript(`
on tick
  if action.right
    velocity(3, entity.vy_real)
    global.move_ticks = global.move_ticks + 1
  end
  if pressed.a
    global.attacks = global.attacks + 1
  end
  if action.right and action.a
    global.combo_ticks = global.combo_ticks + 1
  end
end`);
const simultaneousGame=Runtime.from_cartridge(pack(await compileProject('demo',{scripts:new Map([['maker',simultaneous]])})));
const initialX=player(JSON.parse(simultaneousGame.snapshot())).x;
for(let tick=0;tick<10;tick++)simultaneousGame.step_buttons(8|16);
const overlapping=JSON.parse(simultaneousGame.save_game()).globals;
assert.equal(overlapping.move_ticks,'10');
assert.equal(overlapping.attacks,'1');
assert.equal(overlapping.combo_ticks,'10');
assert.ok(player(JSON.parse(simultaneousGame.snapshot())).x>initialX);
simultaneousGame.step_buttons(0);
simultaneousGame.step_buttons(16);
assert.equal(JSON.parse(simultaneousGame.save_game()).globals.attacks,'2','The second if runs on its own');
simultaneousGame.free();
console.log('Passed simultaneous movement and attack in independent On tick blocks');

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

const typedProject=structuredClone(source);
typedProject.localization={locale:'en',tables:{
  en:{greeting:'Hello',score_label:'Score'},
  es:{greeting:'Hola'},
}};
const typedScript=parseScript(`def wave(angle: real)
  return math.sin(angle)
end
def enabled(value: boolean)
  return value
end
on tick
  if actor.is_player and not flag.done
    flag.done = true
    global_real.speed = wave(30.0) * 5.0
    global.distance = math.floor(global_real.speed)
    global_bool.ready = global.distance >= 2 and global_real.speed < 3.0
    global.int_value = math.to_integer(global_bool.ready)
    global_bool.coerced = -2.25
    global_bool.zero = 0.0
    if -1 and enabled(0.5) and not global_bool.zero
      global.truthy = 1
    end
    if 0.0 or 0
      global.truthy = 99
    end
    repeat (1 + 2)
      repeat 2
        change global.times by 1
      end
    end
    repeat -3
      change global.times by 100
    end
    global.real_division = math.round((3.0 / 2.0) * 10.0)
    global_string.message = text.greeting + "!"
    if global_string.message != ""
      counter(text.score_label, global.times)
      move_by(global_real.speed, 0)
      say(global_string.message)
    end
  end
end
on restored
  counter(text.score_label, math.floor(global_real.speed))
end`);
const localized=await compileProject(resolve('demo'),{project:typedProject,scripts:new Map([['maker',typedScript]])});
for (const [locale, greeting] of [['en','Hello!'],['es','Hola!']]) {
  const bytes=pack(localized,{locale});
  const info=unpack(bytes,{simulation:true});
  assert.equal(info.locale,locale);
  assert.deepEqual(info.text,{greeting:greeting.slice(0,-1),score_label:'Score'});
  assert.ok(!Object.hasOwn(info,'localization'));
  const runtime=Runtime.from_cartridge(bytes);
  const previous=player(JSON.parse(runtime.snapshot())).x;
  const frame=JSON.parse(runtime.step_buttons(0));
  assert.equal(frame.dialog,greeting);
  assert.ok(player(frame).x>previous+2);
  assert.equal(frame.counters.Score,6);
  const save=runtime.save_game(), values=JSON.parse(save).globals;
  assert.equal(values['bool.ready'],'1');
  assert.equal(values.int_value,'1');
  assert.equal(values['bool.coerced'],'1');
  assert.equal(values['bool.zero'],undefined);
  assert.equal(values.truthy,'1');
  assert.equal(values['text.message'],greeting);
  assert.ok(Math.abs(Number(values['real.speed'])-2.5)<1e-10);
  assert.equal(values.real_division,'15');
  runtime.reset();
  runtime.load_game(save);
  assert.deepEqual(JSON.parse(runtime.save_game()).globals,values);
  runtime.free();
}
assert.throws(()=>pack(localized,{locale:'ru'}),/Unknown language/);
console.log('Passed typed variables, trig, nested repeats, move by, localized dialogue, and single-language cartridges');

const ecsProject=structuredClone(source);
ecsProject.localization={locale:'en',tables:{en:{pause_title:'Paused',key_name:'Key'},es:{pause_title:'Pausa',key_name:'Llave'}}};
ecsProject.menus={pause:{title:'text.pause_title',options:['Resume','Restart']}};
ecsProject.sprites.drone.components=['enemy'];
ecsProject.rooms.yard.backgroundImage='assets/sprites/key.png';
ecsProject.rooms.yard.backgroundParallax=0.35;
ecsProject.items.key={...ecsProject.items.key,consumable:true,label:'text.key_name'};
ecsProject.rooms.yard.entities=[
  {sprite:'maker',name:'hero',player:0,x:48,y:96,physics:{mode:'none'}},
  {sprite:'drone',name:'test_enemy',x:80,y:96,physics:{mode:'none'}},
];
const ecsScript=parseScript(`on start
  local.target = entity.nearest("enemy", 100)
  if local.target == entity.find("test_enemy") and entity.exists(local.target)
    add_component(local.target, "tracked")
    set_entity_real(local.target, "speed", 1.5)
    set_entity_boolean(local.target, "alive", 2)
    set_entity_string(local.target, "label", "Scout")
    if entity.has(local.target, "tracked") and entity.boolean(local.target, "alive")
      global_string.label = entity.string(local.target, "label")
      move_entity(local.target, entity.real(local.target, "speed") * 4.0, 0)
    end
  end
  give("key", 1)
  burst("sparks", 5)
  animate_once("idle")
  spawn("drone", 180, 0)
  wait(4)
  global.resumed = 1
  show_menu("pause")
end
on menu_selected
  if actor.menu_id == "pause"
    global.choice = actor.menu_choice
    show_inventory()
  else
    use_selected_item()
  end
end
on use_item
  global_string.used = actor.menu_item
end
on animation_finished
  change global.animation_ends by 1
end`);
const ecsCart=await compileProject(resolve('demo'),{project:ecsProject,scripts:new Map([
  ['maker',ecsScript],['drone',{events:{}}],
])});
const ecsBytes=pack(ecsCart,{locale:'es'});
const ecsMedia=unpack(ecsBytes,{simulation:true});
assert.equal(ecsMedia.runtimeAbi,9);
assert.equal(ecsMedia.menus.pause.title,'Pausa');
const background=ecsMedia.rooms.yard.baked.find(layer=>layer.image==='room/background');
assert.deepEqual(background,{image:'room/background',layer:-10001,x:0,y:0,width:672,height:360,parallax:0.35});
assert.ok(ecsMedia.atlases.yard.entries['room/background']);
const ongoing=Runtime.from_cartridge(ecsBytes);
ongoing.step_buttons(0);
const beforeSave=JSON.parse(ongoing.step_buttons(0));
const inFlight=ongoing.save_game();
assert.equal(beforeSave.actors.filter(actor=>actor.image.startsWith('sprite/drone/')).length,2);
assert.ok(beforeSave.actors.some(actor=>actor.image.startsWith('sprite/drone/')&&actor.x===86));
assert.equal(JSON.parse(inFlight).globals['text.label'],'Scout');
ongoing.free();
const reloaded=Runtime.from_cartridge(ecsBytes);
reloaded.load_game(inFlight);
const afterSave=JSON.parse(reloaded.snapshot());
assert.equal(afterSave.tick,beforeSave.tick);
assert.deepEqual(afterSave.actors,beforeSave.actors);
assert.deepEqual(afterSave.particles,beforeSave.particles);
let menuFrame;
for(let i=0;i<6 && !menuFrame?.menu;i++)menuFrame=JSON.parse(reloaded.step_buttons(0));
assert.equal(menuFrame.menu.title,'Pausa');
assert.equal(JSON.parse(reloaded.save_game()).globals.resumed,'1');
const menuSave=reloaded.save_game();
reloaded.load_game(menuSave);
assert.equal(JSON.parse(reloaded.step_buttons(2)).menu.selected,1);
assert.equal(JSON.parse(reloaded.step_buttons(16)).menu.options[0],'Llave x 1');
assert.equal(JSON.parse(reloaded.save_game()).globals.choice,'2');
reloaded.step_buttons(0);
assert.equal(JSON.parse(reloaded.step_buttons(16)).menu,null);
const usedItem=JSON.parse(reloaded.save_game());
assert.equal(usedItem.globals['text.used'],'key');
assert.equal(usedItem.inventory.key,undefined);
for(let i=0;i<120;i++)reloaded.step_buttons(0);
assert.equal(JSON.parse(reloaded.save_game()).globals.animation_ends,'1');
reloaded.free();
console.log('Passed room artwork, component queries and fields, menus, animation completion, and resumed scripts');

const lifecycleProject=structuredClone(source);
lifecycleProject.minimap='explored';
lifecycleProject.flags={...lifecycleProject.flags,allow_respawn:false};
lifecycleProject.rooms.yard.entities=[
  {sprite:'maker',name:'hero',player:0,x:48,y:96,physics:{mode:'none'}},
  {sprite:'drone',name:'waiting',x:96,y:96,physics:{mode:'none'},respawn:{mode:'delay',ticks:5,flag:'allow_respawn'}},
  {sprite:'drone',name:'once',x:144,y:96,physics:{mode:'none'},respawn:{mode:'never'}},
  {sprite:'drone',name:'on_return',x:192,y:96,physics:{mode:'none'},respawn:{mode:'on_entry'}},
  {sprite:'drone',name:'remembered',x:240,y:96,physics:{mode:'none'},rememberState:true},
];
lifecycleProject.rooms.vault.entities=[{sprite:'maker',name:'hero',player:0,x:48,y:96,physics:{mode:'none'}}];
const lifecycleScript=parseScript(`
on tick
  emit("smoke", 30)
end
on b
  remove_entity(entity.find("waiting"))
  remove_entity(entity.find("once"))
  remove_entity(entity.find("on_return"))
  remove_entity(entity.find("remembered"))
end
on a
  flag.allow_respawn = true
end
on menu
  if flag.left
    room("yard")
  else
    flag.left = true
    room("vault")
  end
end`);
const lifecycleCart=await compileProject(resolve('demo'),{project:lifecycleProject,scripts:new Map([
  ['maker',lifecycleScript],['drone',{events:{}}],
])});
const lifecycleBytes=pack(lifecycleCart);
const lifecycleMedia=unpack(lifecycleBytes);
assert.equal(lifecycleMedia.runtimeAbi,9);
const map=lifecycleMedia.minimap;
assert.equal(map.mode,'explored');
assert.ok(map.edges.some(edge=>edge.includes('yard')&&edge.includes('vault')));
assert.equal(new Set(Object.values(map.rooms).map(JSON.stringify)).size,Object.keys(map.rooms).length);
const lifecycle=Runtime.from_cartridge(lifecycleBytes);
const run=bits=>JSON.parse(lifecycle.step_buttons(bits));
const roomNames=frame=>frame.actors.map(actor=>actor.name);
assert.deepEqual(JSON.parse(lifecycle.snapshot()).explored,['yard']);
run(0);
assert.ok(!roomNames(run(32)).includes('waiting'));
for(let frames=0;frames<8;frames++)run(0);
assert.ok(!roomNames(JSON.parse(lifecycle.snapshot())).includes('waiting'));
assert.ok(JSON.parse(lifecycle.snapshot()).particles.some(batch=>batch.points.length),'Reasserting a low-rate effect must retain its emission phase');
const lifecycleSave=lifecycle.save_game();
lifecycle.load_game(lifecycleSave);
assert.ok(roomNames(run(16)).includes('waiting'));
const vault=run(128);
assert.equal(vault.room,'vault');
assert.deepEqual(vault.explored,['vault','yard']);
run(0);
const yard=run(128);
assert.equal(yard.room,'yard');
assert.ok(!roomNames(yard).includes('once'));
assert.ok(roomNames(yard).includes('on_return'));
assert.ok(roomNames(yard).includes('remembered'),'Remember state must allow a removed entity to return');
assert.ok(roomNames(yard).includes('waiting'));
const exploredSave=lifecycle.save_game();
lifecycle.reset();
assert.deepEqual(JSON.parse(lifecycle.snapshot()).explored,['yard']);
lifecycle.load_game(exploredSave);
assert.deepEqual(JSON.parse(lifecycle.snapshot()).explored,['vault','yard']);
lifecycle.free();
console.log('Passed conditional respawn, permanent defeat, room re-entry, minimap exploration and emitter continuity');


const itemProject=structuredClone(source);
(itemProject.items??={}).apple={label:'Apple',consumable:true};
const itemScript=parseScript(`
on start
  give_player("apple", 1, 1)
end
on a
  use_player_item("apple", 1)
end
on use_item
  wait(2)
  if entity.used_item == item_key("apple")
    global.used_apple = 1
  end
end`);
const itemCart=pack(await compileProject('demo',{project:itemProject,scripts:new Map([['maker',itemScript]])}));
assert.equal(unpack(itemCart).runtimeAbi,9);
const itemPlayer=Runtime.from_cartridge(itemCart);
itemPlayer.step_buttons(0);
itemPlayer.step_buttons(16);
const midUse=itemPlayer.save_game();
assert.equal(JSON.parse(midUse).globals.used_apple,undefined);
itemPlayer.load_game(midUse);
for(let i=0;i<4;i++)itemPlayer.step_buttons(0);
assert.equal(JSON.parse(itemPlayer.save_game()).globals.used_apple,'1');
itemPlayer.free();

const behaviorProject=structuredClone(source);
behaviorProject.sprites.maker.gravityMode='room';
behaviorProject.sprites.maker.legacyBuiltInJump=true;
const unreachable=parseScript(`on tick
  if false
    apply_gravity(0)
    jump_force(240)
  end
end`);
const behaviorCart=await compileProject('demo',{project:behaviorProject,scripts:new Map([['maker',unreachable]])});
assert.equal(behaviorCart.sprites.maker.scriptJump,false);
assert.equal(behaviorCart.sprites.maker.scriptGravity,false);

const read=async()=>Buffer.from("name: Test\ncell-size: 5 7\nu+0041:\n'A':\n  .@.\n  @@@\n  @.@\n\n'á':\n  ...\n  .@.\n  @@@\n");
const yaff=await readBitfont({source:'assets/test.yaff'},read);
assert.deepEqual(yaff.layout,{width:5,height:7,columns:2});
assert.equal(yaff.glyphs.A,0);
assert.equal(yaff.glyphs['á'],1);
const frames=[1,2,3].map(pixel=>({rgba:Buffer.from([pixel,0,0,255])}));
const aseprite=await readBitfont({source:'assets/test.aseprite'},read,async()=>({
  width:1,height:1,frames,tags:[{name:'A',from:0},{name:'A',from:1},{name:'b',from:2}],
}));
assert.deepEqual({...aseprite.glyphs},{A:0,b:1});
assert.deepEqual([...aseprite.rgba],[1,0,0,255,3,0,0,255]);
const glyphDraws=[];
const context={fillRect(){},setTransform(){},translate(){},drawImage(...args){glyphDraws.push(args);}};
const canvas={getContext:()=>context,dataset:{},parentElement:{getBoundingClientRect:()=>({width:256,height:256})}};
const fontImage={};
drawRoom(canvas,{
  rooms:{test:{width:128,height:128,baked:[]}},
  atlases:{test:{entries:{'ui/font':[12,5,2,1],'ui/font-fallback':[20,0,96,48]}}},
  fontLayout:aseprite.layout,fontGlyphs:aseprite.glyphs,
},{room:'test',actors:[],counters:{aB:1}},{test:fontImage});
assert.deepEqual(glyphDraws.slice(0,2).map(args=>args.slice(1,3)),[[12,5],[13,5]],'Missing exact case should use an alternate case glyph');

const png=await readBitfont({source:'assets/test.png',glyphWidth:1,glyphHeight:1,assignments:{0:'A',1:'A',2:'a'}},read,async()=>({
  width:3,height:1,frames:[{rgba:Buffer.concat(frames.map(frame=>frame.rgba))}],
}));
assert.deepEqual({...png.glyphs},{A:0,a:1});
assert.deepEqual([...png.rgba],[1,0,0,255,3,0,0,255]);
console.log('Passed explicit controller behavior, item event payloads across saves, and bitfont source layouts');

const spriteProject=structuredClone(source);
const sprite=spriteProject.sprites.maker;
sprite.width=sprite.height=24;
sprite.physics.health=4;
sprite.collider='silhouette';
sprite.frameColliders={
  0:[{kind:'circle',x:3,y:3,w:16,h:16}],
  1:[{kind:'rectangle',x:5,y:4,w:13,h:18},{kind:'pill',x:4,y:8,w:14,h:7}],
};
const spriteScript=parseScript(`
const bar_color = "#db758d"
const show_bar = true
on start
  flip_sprite_x(true)
  flip_sprite_y(true)
  set_sprite_rotation(20)
  rotate_sprite(70)
  set_sprite_shadow("behind", 60)
  set_health_bar(const.show_bar, const.bar_color, "#402530")
end
on a
  fire_projectile("spark", "facing", 8, 1)
end
on b
  set_sprite_shadow("ground", 40)
  damage_entity(entity.id, 1)
end
on x
  set_sprite_shadow("none")
  set_health_bar(false)
end`);
const spriteCart=await compileProject('demo',{project:spriteProject,scripts:new Map([['maker',spriteScript]])});
assert.equal(spriteCart.runtimeAbi,10);
assert.equal(spriteCart.sprites.maker.collider[0].kind,'polygon');
assert.equal(spriteCart.sprites.maker.frameColliders['sprite/maker/0'][0].kind,'circle');
assert.equal(spriteCart.sprites.maker.frameColliders['sprite/maker/1'].length,2);
const spriteRuntime=Runtime.from_cartridge(pack(spriteCart));
assert.equal(player(JSON.parse(spriteRuntime.snapshot())).healthBar,undefined);
spriteRuntime.step_buttons(0);
let spriteFrame=JSON.parse(spriteRuntime.step_buttons(16));
const visual=spriteFrame.actors.find(entity=>entity.player===0);
assert.equal(visual.facing,-1);
assert.equal(visual.flip_y,true);
assert.ok(Math.abs(visual.angle-Math.PI/2)<.002);
assert.deepEqual(visual.shadow,{placement:'behind',opacity:60,rect:[
  Math.round(visual.x)-visual.width/2+2,Math.round(visual.y)-visual.height/2+3,visual.width,visual.height,
]});
assert.deepEqual([visual.healthBar.fill,visual.healthBar.track,visual.healthBar.fraction],[0xdb758d,0x402530,1]);
assert.ok(spriteFrame.actors.some(entity=>entity.image.startsWith('sprite/spark/')));
spriteRuntime.load_game(spriteRuntime.save_game());
spriteFrame=JSON.parse(spriteRuntime.snapshot());
assert.equal(spriteFrame.actors.find(entity=>entity.player===0).flip_y,true);
assert.equal(player(spriteFrame).shadow.placement,'behind');
assert.equal(player(spriteFrame).healthBar.fill,0xdb758d);
spriteFrame=JSON.parse(spriteRuntime.step_buttons(32));
assert.equal(player(spriteFrame).shadow.placement,'ground');
assert.equal(player(spriteFrame).shadow.opacity,40);
assert.ok(player(spriteFrame).shadow.rect[1]>player(spriteFrame).y);
assert.equal(player(spriteFrame).healthBar.fraction,.75);
const hiddenVisual=player(JSON.parse(spriteRuntime.step_buttons(64)));
assert.equal(hiddenVisual.shadow,undefined);
assert.equal(hiddenVisual.healthBar,undefined);
for(let tick=0;tick<60;tick++)spriteRuntime.step_buttons(0);
spriteRuntime.free();
console.log('Passed per-frame colliders, sprite transforms, shadows, colored health bars, saved visual state, and projectile selection');

const objectsProject=structuredClone(source);
const objectArt={source:'assets/sprites/key.png',width:24,height:24};
objectsProject.sprites.crate={...objectArt,physics:{mode:'dynamic',mass:2,health:3}};
objectsProject.sprites.vase={...objectArt,physics:{mode:'breakable',health:3},respawn:{mode:'never'}};
objectsProject.rooms.yard.entities=objectsProject.rooms.yard.entities.filter(e=>e.player===0);
objectsProject.rooms.yard.entities.push({name:'Crate',sprite:'crate',x:98,y:323},{name:'Vase',sprite:'vase',x:240,y:323});
const objectsScript=parseScript(`
const strength = 3.0
on tick
  if action.right
    velocity(4, entity.vy_real)
  end
end
on a
  push_entity(entity.find("Crate"), const.strength, 0)
end
on b
  damage_entity(entity.find("Vase"), 2)
  heal_entity(entity.find("Vase"), 1)
end
on x
  break_entity(entity.find("Vase"))
end`);
const objects=Runtime.from_cartridge(pack(await compileProject('demo',{project:objectsProject,scripts:new Map([['maker',objectsScript]])})));
const object=(name)=>JSON.parse(objects.snapshot()).actors.find(actor=>actor.name===name);
for(let tick=0;tick<30;tick++)objects.step_buttons(8);
assert.ok(object('Crate').x>100,'A moving player can push a dynamic crate');
const crateX=object('Crate').x;
objects.step_buttons(16);
for(let tick=0;tick<10;tick++)objects.step_buttons(0);
assert.ok(object('Crate').x>crateX,'A scripted impulse pushes the crate');
objects.step_buttons(32);
assert.equal(object('Vase').health,2);
assert.equal(object('Vase').x,240);
objects.step_buttons(64);
assert.equal(object('Vase'),undefined);
objects.free();
console.log('Passed physical pushing, scripted impulses, damage, healing, and breakable entities');

const roomProject=structuredClone(source);
roomProject.rooms.yard.script='scripts/rooms/yard.cbor';
roomProject.rooms.yard.cameraZoom=1.25;
roomProject.rooms.yard.entities.find(entity=>entity.sprite==='drone').name='Camera target';
const roomScript=parseScript(`
on start
  camera_follow_entity(entity.find("Camera target"))
  camera_zoom(1.5)
  set_room_gravity(0)
  set_room_background("#342850")
  set_room_depth_sort(true)
  set_room_music("")
  set_room_ambience("music")
  global.room_starts = global.room_starts + 1
end
on tick
  if action.x
    camera(280, 160)
    camera_zoom(2)
  end
  if pressed.a
    reset_room_camera()
  end
end
on restored
  global.room_restored = global.room_restored + 1
end`);
const roomCartridge=await compileProject('demo',{project:roomProject,scripts:new Map([['room:yard',roomScript]])});
assert.equal(roomCartridge.runtimeAbi,9);
const roomRuntime=Runtime.from_cartridge(pack(roomCartridge));
assert.equal(JSON.parse(roomRuntime.snapshot()).roomSettings?.zoom,undefined);
const roomFrame=(buttons=0)=>JSON.parse(roomRuntime.step_buttons(buttons));
let cameraFrame=roomFrame();
const target=cameraFrame.actors.find(entity=>entity.name==='Camera target');
assert.deepEqual(cameraFrame.focus,[target.x,target.y]);
assert.ok(cameraFrame.actors.every(entity=>entity.image!==''),'Room scripts are invisible and excluded from entity views');
assert.deepEqual(cameraFrame.roomSettings,{
  zoom:1.5,gravity:0,background:'#342850',ySort:true,music:'',ambience:'music',
});
cameraFrame=roomFrame(64);
assert.deepEqual(cameraFrame.focus,[280,160]);
assert.equal(cameraFrame.roomSettings.zoom,2);
const roomSave=roomRuntime.save_game();
roomRuntime.load_game(roomSave);
assert.deepEqual(JSON.parse(roomRuntime.snapshot()).roomSettings,cameraFrame.roomSettings);
cameraFrame=roomFrame(16);
assert.equal(cameraFrame.roomSettings.zoom,undefined);
assert.deepEqual(cameraFrame.focus,[player(cameraFrame).x,player(cameraFrame).y]);
assert.equal(JSON.parse(roomRuntime.save_game()).globals.room_starts,'1');
assert.equal(JSON.parse(roomRuntime.save_game()).globals.room_restored,'1');
roomRuntime.free();
await assert.rejects(compileProject('demo',{project:roomProject,scripts:new Map([['maker',roomScript]])}),/in a room script/);
console.log('Passed room scripts, held input, entity and point camera targets, zoom, room settings, and save restoration');

const weatherProject=structuredClone(roomProject);
weatherProject.rooms.yard.shader={kind:'fog',strength:45};
const weatherScript=parseScript(`
on init
  set_room_shader("fog", 45)
end
on start
  set_room_shader("snow", 130)
end
on tick
  if pressed.a
    set_room_shader("volumetric", 65)
  end
  if pressed.b
    reset_room_shader()
  end
  if pressed.x
    set_room_shader("lens_flare", 48.5)
  end
  if pressed.left
    set_room_shader("rain", 70)
  end
  if pressed.right
    set_room_shader("wind", 50)
  end
  if pressed.up
    set_room_shader("none", 0)
  end
end`);
const weatherBytes=pack(await compileProject('demo',{project:weatherProject,scripts:new Map([['room:yard',weatherScript]])}));
const weatherMedia=unpack(weatherBytes);
assert.equal(weatherMedia.runtimeAbi,9);
assert.equal(weatherMedia.rooms.yard.shader,null);
for(const mask of ['fog','volumetric','lens_flare'])assert.ok(weatherMedia.atlases.yard.entries['shader/'+mask+'/screen']);
const weatherRuntime=Runtime.from_cartridge(weatherBytes);
const shaderFrame=bits=>JSON.parse(weatherRuntime.step_buttons(bits)).roomSettings?.shader;
for(const [bits,kind,strength] of [[0,'snow',100],[16,'volumetric',65],[64,'lens_flare',49],[4,'rain',70],[8,'wind',50],[1,'none',0]]){
  assert.deepEqual(shaderFrame(bits),{kind,strength});
}
weatherRuntime.load_game(weatherRuntime.save_game());
assert.deepEqual(JSON.parse(weatherRuntime.snapshot()).roomSettings?.shader,{kind:'none',strength:0});
assert.equal(shaderFrame(32),undefined);
weatherRuntime.free();
console.log('Passed shader presets, script switching, strength limits, save restoration, and reset');

const lockstep=Array.from({length:2},()=>Runtime.from_cartridge(bytes));
for(const peer of lockstep)peer.set_seed(4321);
for(let tick=0;tick<180;tick++){
  const input=(tick%72<48?8:4)|(tick%72<2?64:0)|((tick%36<18?8:4)<<8);
  assert.equal(lockstep[0].step_buttons(input),lockstep[1].step_buttons(input),'Lockstep diverged at tick '+tick);
}
for(const peer of lockstep)peer.free();
console.log('Passed Rapier lockstep replay with two controller streams');

const signalProject=structuredClone(roomProject);
delete signalProject.rooms.yard.cameraZoom;
signalProject.events={arrived:'Arrived'};
signalProject.bitfonts={paper:{name:'Paper',source:'assets/paper.yaff'}};
const signalAssets={read:(name,encoding)=>name==='assets/paper.yaff'
  ? Promise.resolve(Buffer.from("name: Paper\ncell-size: 5 7\n'A':\n  .@.\n  @@@\n  @.@\n"))
  : readFile(join('demo',name),encoding)};
const emitScript=parseScript(`
on start
  emit_event("arrived")
  emit_event("arrived")
end`);
const receiveScript=parseScript(`
on start
  set_hud_font("paper")
  draw_text("notice", "A", "paper", "bottom_right", 4, 6)
end
on tick
  if pressed.right
    global.steps = global.steps + 1
  end
end
on received.arrived
  wait(2)
  if entity.exists(entity.event_sender)
    global.delivered = global.delivered + 1
    global.sender = entity.event_sender
  end
end`);
const signalBytes=pack(await compileProject('demo',{
  project:signalProject,store:signalAssets,scripts:new Map([['maker',emitScript],['room:yard',receiveScript]]),
}));
const signalMedia=unpack(signalBytes);
assert.equal(signalMedia.fonts.paper.layout.width,5);
assert.ok(signalMedia.atlases.yard.entries['ui/font/paper']);
assert.equal(signalMedia.atlases.vault.entries['ui/font/paper'],undefined);
const signalRun=Runtime.from_cartridge(signalBytes);
const emitted=JSON.parse(signalRun.step_buttons(0));
assert.equal(emitted.hudFont,'paper');
assert.deepEqual(emitted.hudText.notice,{value:'A',font:'paper',anchor:'bottom_right',offset:[4,6]});
const packet=()=>JSON.parse(signalRun.save_game());
assert.equal(packet().scene.broadcasts.length,2);
assert.equal(packet().globals.delivered,undefined);
signalRun.step_buttons(8);
signalRun.load_game(signalRun.save_game());
for(let tick=0;tick<8;tick++)signalRun.step_buttons(8);
assert.equal(packet().globals.delivered,'2');
assert.equal(packet().globals.sender,String(player(emitted).id));
assert.equal(packet().globals.steps,'1');
assert.deepEqual(JSON.parse(signalRun.snapshot()).hudText,emitted.hudText);
signalRun.free();

const coordinates=[];
const recorder={fillRect(){},setTransform(){},translate(){},drawImage(...args){coordinates.push(args.slice(-4));}};
const hudCanvas={getContext:()=>recorder,dataset:{},parentElement:{getBoundingClientRect:()=>({width:320,height:320})}};
drawRoom(hudCanvas,{rooms:{yard:{width:160,height:160,baked:[]}},atlases:{yard:signalMedia.atlases.yard},
  fonts:signalMedia.fonts,fontFallbackGlyphs:signalMedia.fontFallbackGlyphs}, {...emitted,actors:[],counters:{},bars:{},particles:[]},{yard:{}});
assert.deepEqual(coordinates,[[151,147,5,7]]);
console.log('Passed named broadcasts, saved event queues, sender queries, HUD font selection, and viewport anchors');
