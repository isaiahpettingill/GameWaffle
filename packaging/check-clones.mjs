import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileProject} from '../src/compiler.mjs';
import {pack} from '../src/pack.mjs';
import {formatScript,parseScript} from '../src/wafflescript.mjs';
import {Runtime,initSync} from '../web-built/runtime/runtime.js';

const demo=JSON.parse(await readFile('demo/project.json','utf8'));
const project={name:'Entity clone checks',start:'yard',tileSize:24,sprites:{hero:{...demo.sprites.maker,
  script:undefined,projectile:undefined,physics:{mode:'sensor',health:12}}},rooms:{
  yard:{cols:16,rows:12,entities:[{sprite:'hero',name:'Original',player:0,x:80,y:90}]},
  next:{cols:16,rows:12,entities:[{sprite:'hero',name:'New original',player:0,x:80,y:90}]},
}};
const hero=parseScript(`on init
  delete_clone()
  change global.initializations by 1
  flip_sprite_y(true)
  if flag.clone_on_init
    clone_entity(entity.id)
  end
end

on a
  local.points = 41
  clone_entity(entity.id)
  global.copy = entity.last_clone
  global.copied_immediately = entity.integer(entity.last_clone, "points")
  assign_entity_player(entity.last_clone, 2)
  local.points = 99
end

on clone
  change global.clones_started by 1
  global.copied_on_start = local.points
  global.parent = entity.clone_source
  local.points = 42
  set_position(entity.x + 50, entity.y)
  wait(2)
  ask("Close this prompt when the owner goes away")
  delete_clone()
  global.ran_after_delete = 1
end

on tick
  if entity.is_clone
    change global.clone_ticks by 1
  end
end
`);
const game=parseScript(`on tick
  if pressed.b
    clone_entity(entity.find("Original"))
  end
  if pressed.x
    set_display_resolution(320, 180)
  end
  if pressed.right
    room("next")
  end
  global.game_clone_result = entity.last_clone
end
`);
assert.deepEqual(parseScript(formatScript(hero)),hero);
const scripts=new Map([['hero',hero],['game',game]]);
await assert.rejects(compileProject('demo',{project,scripts:new Map([...scripts,['room:yard',parseScript('on clone\nend')]])}),/When cloned/);
const cartridge=await compileProject('demo',{project,scripts});
assert.equal(cartridge.runtimeAbi,14);

initSync({module:await readFile('web-built/runtime/runtime_bg.wasm')});
const runtime=Runtime.from_cartridge(pack(cartridge));
const step=(buttons=0)=>{
  const snapshot=JSON.parse(runtime.step_buttons(buttons));
  assert.deepEqual(snapshot.events.filter(event=>event.kind==='script_error'),[]);
  return snapshot;
};
const globals=()=>JSON.parse(runtime.save_game()).globals;
try{
  const initial=step();
  const original=initial.actors.find(actor=>actor.name==='Original');
  const baseline=runtime.save_game();
  assert.equal(globals().initializations,'1');

  let clone=step(16).actors.find(actor=>actor.cloneOf===original.id);
  assert.equal(clone.x,original.x);
  assert.equal(clone.y,original.y);
  assert.equal(clone.flip_y,true);
  assert.equal(clone.name,undefined);
  assert.equal(clone.player,1);
  assert.equal(globals().copied_immediately,'41');
  assert.equal(globals().clones_started,undefined);
  assert.equal(globals().clone_ticks,undefined);

  runtime.load_game(runtime.save_game());
  clone=step().actors.find(actor=>actor.cloneOf===original.id);
  assert.equal(clone.x,original.x+50);
  assert.equal(globals().clones_started,'1');
  assert.equal(globals().copied_on_start,'41');
  assert.equal(globals().parent,String(original.id));
  assert.equal(globals().clone_ticks,'1');
  assert.equal(JSON.parse(runtime.inspect_actor(original.id)).locals.points,'99');
  assert.equal(JSON.parse(runtime.inspect_actor(clone.id)).locals.points,'42');

  runtime.load_game(runtime.save_game());
  assert.ok(step().actors.some(actor=>actor.id===clone.id));
  const removed=step();
  assert.ok(!removed.actors.some(actor=>actor.id===clone.id));
  assert.ok(!removed.dialog);
  assert.equal(globals().initializations,'1');
  assert.equal(globals().clones_started,'1');
  assert.equal(globals().ran_after_delete,undefined);

  assert.equal(step(32).actors.find(actor=>actor.cloneOf===original.id).player,null);
  assert.ok(Number(globals().game_clone_result)>0);
  assert.equal(step(8).room,'next');
  assert.ok(!step().actors.some(actor=>actor.cloneOf));
  assert.equal(globals().game_clone_result,undefined);

  assert.deepEqual(step(64).gameSettings.display.resolution,[320,180]);
  runtime.load_game(baseline);
  assert.equal(JSON.parse(runtime.snapshot()).gameSettings?.display,undefined);
}finally{runtime.free();}
const initClone=await compileProject('demo',{project:{...project,flags:{clone_on_init:true}},scripts});
const initialized=Runtime.from_cartridge(pack(initClone));
try{
  assert.ok(JSON.parse(initialized.step_buttons(0)).actors.some(actor=>actor.cloneOf));
  assert.equal(JSON.parse(initialized.save_game()).globals.clone_ticks,undefined);
  initialized.step_buttons(0);
  assert.equal(JSON.parse(initialized.save_game()).globals.clone_ticks,'1');
}finally{initialized.free();}
console.log('Passed cloning, independent locals, clone startup and deletion, save restoration, and room cleanup');
