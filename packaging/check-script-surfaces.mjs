import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileProject} from '../src/compiler.mjs';
import {initialRoomScript} from '../src/room-script.mjs';
import {pack} from '../src/pack.mjs';
import {parseScript,formatScript} from '../src/wafflescript.mjs';
import {Runtime,initSync} from '../web-built/runtime/runtime.js';

const sample=JSON.parse(await readFile('demo/project.json','utf8'));
const project={name:'Script surfaces',tileSize:24,start:'yard',
  sprites:{hero:{...sample.sprites.maker,script:undefined,projectile:undefined,physics:{mode:'dynamic',health:20,fixed:true}}},
  tiles:{stone:sample.tiles.stone},
  rooms:{yard:{title:'Script surfaces',cols:12,rows:8,view:'platformer',
    entities:[{sprite:'hero',x:60,y:76,player:0,name:'Hero'},{sprite:'hero',x:147,y:76,player:1,name:'Spare'}],
    layers:[{collidable:true,cells:[[2,5,'stone',0],...Array.from({length:8},(_,i)=>[i+3,5,'stone',1])]}]}},
};
const kernel=Array.from({length:9},()=> ' * 1.02 - 0.01').reduce((body,op)=>'('+body+op+')','global_real.energy');
const game=parseScript(`object effect
  strength: real = 1.5
end
object item
  amount: integer = 1
  enchantment: effect
end
object player
  ready: boolean = false
end
inventory backpack: item
array ranks: integer
game_properties: item
player_properties: player
global energy = 1.0
global score = 2
global last_x = 0.0
global spike_hits = 0
global timers = 0
flag touched_top = false
const damage = 3
event spike = "Spike"

on init
  inventory_append("backpack", "item")
  inventory_create_child("backpack", 1, "enchantment")
  inventory_set("backpack", 1, "enchantment.strength", 2.0)
  inventory_set("game", 1, "amount", 8)
  inventory_set("players", 2, "ready", true)
  array_append("ranks", inventory.get("backpack", 1, "amount"))
  array_append("ranks", inventory.get("game", 1, "amount"))
end

on game startup
  set_display_resolution(320, 180)
  set_minimap("explored")
  set_first_controller(2)
end

on after 1 seconds
  change global.score by 1
end

on tick
  global_real.energy = ${kernel}
  set_entity_visible(entity.find("Spare"), controller_connected(2))
  if pressed.a
    assign_entity_player(entity.find("Hero"), 2)
    assign_entity_player(entity.find("Spare"), 1)
  end
  draw_space("hud")
  fill("#ff0000")
  no_stroke()
  rect(12, 10, 8, 9)
end
`);
assert.equal(formatScript(parseScript(formatScript(game))),formatScript(game));
const tile=parseScript(`on start
  set_tile_playback("still")
  set_tile_friction(0.02)
end
on every 0.25 seconds
  advance_tile_frame(1)
  change global.timers by 1
end
on collide
  if entity.is_player(entity.other) and entity.on_tile_top(entity.other)
    flag.touched_top = true
    global_real.last_x = entity.x(entity.other)
    set_entity_boolean(entity.other, "stable", true)
    damage_entity(entity.other, const.damage)
    emit_event_with_entity("spike", entity.other)
    set_tile_playback("once")
    force_entity(entity.other, 0, -40)
  end
end
`);
const hero=parseScript(`on received.spike
  if entity.event_entity == entity.id
    change global.spike_hits by 1
  end
end
`);
assert.equal(formatScript(parseScript(formatScript(tile))),formatScript(tile));
const room=initialRoomScript(project.rooms.yard,{cameraZoom:1.5, cameraBottomInset:2, background:'#223344', backgroundImage:'assets/sprites/key.png',border:'open'});
const scripts=new Map([['game',game],['tile:stone:0',tile],['hero',hero],['room:yard',room]]);
const mismatch=parseScript('array ranks: boolean');
await assert.rejects(compileProject('demo',{project,scripts:new Map([['game',mismatch]])}),/must contain integers or reals/);
const cyclic=parseScript('object box\n  inside: box\nend\ninventory backpack: box');
await assert.rejects(compileProject('demo',{project,scripts:new Map([['game',cyclic]])}),/Circular object types/);
const cartridge=await compileProject('demo',{project,scripts});
assert.equal(cartridge.runtimeAbi,12);
initSync({module:await readFile('web-built/runtime/runtime_bg.wasm')});
const runtime=Runtime.from_cartridge(pack(cartridge));
const frame=buttons=>{
  const snapshot=JSON.parse(runtime.step_buttons(buttons));
  assert.deepEqual(snapshot.events.filter(event=>event.kind==='script_error'),[]);
  return snapshot;
};
assert.deepEqual(JSON.parse(runtime.snapshot()).gameSettings.display.resolution,[320,180]);
let current=frame(0);
assert.equal(current.roomSettings.zoom,1.5);
assert.equal(current.roomSettings.cameraHeight,144);
assert.equal(current.roomSettings.border,0);
assert.equal(current.roomSettings.background,'#223344');
assert.equal(current.roomSettings.backgroundImage,'assets/sprites/key.png');
assert.ok(Object.hasOwn(cartridge.atlases.yard.entries,'room/background/assets/sprites/key.png'));
assert.equal(current.actors.some(actor=>actor.name==='Spare'),false);
assert.deepEqual(current.shapes[0].coords,[12,10,8,9,0,0]);
assert.equal(current.shapes[0].hud,true);
runtime.set_connected_players(3);
current=frame(0);
assert.equal(current.actors.find(actor=>actor.name==='Spare').player,1);
for(let i=0;i<85;i++)current=frame(0);
const saved=JSON.parse(runtime.save_game());
assert.equal(saved.globals.score,'3');
assert.ok(runtime.jit_executions()>0,'WebAssembly ran a generated numeric kernel');
const interpreted=Runtime.from_cartridge(pack(cartridge));
interpreted.set_jit_enabled(false);
interpreted.step_buttons(0);
interpreted.set_connected_players(3);
for(let i=0;i<86;i++)interpreted.step_buttons(0);
assert.equal(JSON.parse(interpreted.save_game()).globals['real.energy'],saved.globals['real.energy']);
assert.equal(interpreted.jit_executions(),0);
interpreted.free();
assert.deepEqual(saved.collections.arrays.ranks,[{Integer:1},{Integer:8}]);
assert.ok(saved.collections.inventories.backpack[0].properties.enchantment);
assert.ok(saved.collections.inventories.players[1].properties.ready);
assert.ok(Number(saved.globals.timers)>4);
assert.ok(Number(saved.globals.spike_hits)>0);
assert.ok(Number(saved.globals['real.last_x'])>50);
assert.ok(current.actors.find(actor=>actor.name==='Hero').health<20);
current=frame(16);
assert.equal(current.actors.find(actor=>actor.name==='Hero').player,1);
assert.equal(current.actors.find(actor=>actor.name==='Spare').player,0);
const checkpoint=runtime.save_game();
runtime.reset();
assert.equal(JSON.parse(runtime.snapshot()).actors.find(actor=>actor.name==='Hero').player,0);
runtime.load_game(checkpoint);
assert.equal(JSON.parse(runtime.snapshot()).actors.find(actor=>actor.name==='Hero').player,1);
runtime.free();
console.log('Passed Game and room initialization, typed collections, tile events, controller assignment, drawing, Wasm JIT parity, and save restoration');
