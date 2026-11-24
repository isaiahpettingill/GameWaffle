import {decodeFrame} from '../src/frame.mjs';
import {decodeSave} from '../src/save.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileProject} from '../src/compiler.mjs';
import {pack} from '../src/pack.mjs';
import {reporters} from '../src/schema.mjs';
import {formatScript,parseScript} from '../src/wafflescript.mjs';
import {reporterBlock,readValue,writeValue} from '../ui/logic-blocks.js';
import {Runtime,initSync} from '../web-built/runtime/runtime.js';

const demo=JSON.parse(await readFile('demo/project.json','utf8'));
const project={name:'Sensing checks',start:'yard',tileSize:24,
  sprites:{hero:{...demo.sprites.maker,width:16,height:16,script:undefined,projectile:undefined,physics:{mode:'sensor'}}},
  tiles:{
    stone:{...demo.tiles.stone,physics:{mode:'static'}},
    ladder:{...demo.tiles.stone,physics:{mode:'ladder'}},
    paint:{...demo.tiles.stone,physics:{mode:'static'}},
  },
  rooms:{yard:{cols:20,rows:12,entities:[{sprite:'hero',name:'Hero',player:0,x:104,y:112}],
    layers:[{collidable:true,cells:[[4,5,'stone',0],[5,5,'ladder',0]]},{cells:[[4,5,'paint',0]]}]}},
};
const game=parseScript(`on game startup
  set_display_resolution(128, 96)
end
`);
const room=parseScript(`on init
  camera(168, 120)
end

on b
  camera_zoom(2)
end
`);
const actor=parseScript(`on tick
  global.left = camera.left()
  global.top = camera.top()
  global.right = camera.right()
  global.bottom = camera.bottom()
  global.width = camera.width()
  global.height = camera.height()
  flag.at_edge = camera.touching_edge(entity.id, "left")
  flag.visible = camera.on_screen(entity.id)
  flag.room_edge = camera.touching_room_edge(entity.id, "left")
  flag.stone = tile.touching(entity.id, "stone", "top")
  flag.wrong_side = tile.touching(entity.id, "stone", "bottom")
  flag.decor = tile.touching_kind(entity.id, "decorative", "any")
  flag.ladder = tile.touching_kind(entity.id, "ladder", "any")
  global.modulus = math.mod(-5, 3)
  global.remainder = -5 % 3
  global.clamped = math.clamp(9, 0, 4)
  global_real.mixed = math.lerp(10, 50, 0.25)
  global_real.hypotenuse = math.hypot(3, 4)
  global_real.root = math.sqrt(9)
  global.integer_part = math.to_integer(7.8)
  global.random = math.random_integer(-5, 5)
  global_real.fraction = math.random_real(2, 3)
  global_string.text = string.join("A", "🪿é")
  global.length = string.length(global_string.text)
  global_string.letter = string.letter(global_string.text, 2)
  global_string.outside = string.letter(global_string.text, 4)
  global_string.range = string.slice(global_string.text, 2, 3)
  flag.contains = string.contains(global_string.text, "🪿")
  global.found = string.index_of(global_string.text, "é")
  global.missing = string.index_of(global_string.text, "x")
  global_string.renamed = string.upper(string.replace(string.trim(" hi hi "), "hi", "go"))
  global_string.lower = string.lower("É")
  global_string.numbers = string.join(string.from_integer(4), string.from_real(0.5))
end

on a
  set_position(132, 124)
end

on x
  set_position(8, 112)
end
`);
assert.deepEqual(parseScript(formatScript(actor)),actor);

// Exercise the same Blockly encoding and decoding used by the editor for every selector.
function blockModel(state) {
  return {type:state.type,
    getFieldValue:name=>state.fields?.[name],
    getInputTargetBlock:name=>{
      const child=state.inputs?.[name]?.block??state.inputs?.[name]?.shadow;
      return child?blockModel(child):null;
    }};
}
for (const [name,[,,,parameters]] of Object.entries(reporters)) {
  const args=parameters.map(([type,value])=>type==='tile'?'stone':value);
  const expression={call:name,args};
  assert.deepEqual(readValue(blockModel(reporterBlock(name,args))),expression,name);
  assert.deepEqual(readValue(blockModel(writeValue(expression))),expression,name);
}
const importedClamp={call:'math.clamp',args:[1,2,3]};
const importedBlock=writeValue({call:'string.from_integer',args:[importedClamp]},new Set(['math']));
assert.equal(importedBlock.inputs.arg0.block.type,'waffle_function_call');
assert.equal(importedBlock.inputs.arg0.block.fields.name,'math.clamp');

const cartridge=await compileProject('demo',{project,scripts:new Map([['game',game],['room:yard',room],['hero',actor]])});
assert.equal(cartridge.runtimeAbi,15);
initSync({module:await readFile('web-built/runtime/runtime_bg.wasm')});
const runtime=Runtime.from_cartridge(pack(cartridge));
const step=(mask=0)=>{
  const frame=decodeFrame(runtime.step_buttons(mask));
  assert.equal(frame.events.find(event=>event.kind==='script_error')?.message,undefined);
  return {frame,...decodeSave(runtime.save_game())};
};
const {frame,globals,flags}=step();
assert.deepEqual(frame.viewport,[104,72,128,96]);
assert.deepEqual(['left','top','right','bottom','width','height'].map(key=>Number(globals[key])),[104,72,232,168,128,96]);
assert.equal(flags.includes('at_edge'),true);
assert.equal(flags.includes('visible'),true);
assert.equal(flags.includes('room_edge'),false);
assert.equal(flags.includes('stone'),true);
assert.equal(flags.includes('wrong_side'),false);
assert.equal(flags.includes('decor'),true);
assert.equal(flags.includes('ladder'),false);
for(const [key,value] of Object.entries({modulus:1,remainder:-2,clamped:4,'real.mixed':20,'real.hypotenuse':5,'real.root':3,integer_part:7,length:3,found:3,missing:0}))
  assert.equal(Number(globals[key]??0),value,key);
for(const [key,value] of Object.entries({text:'A🪿é',letter:'🪿',outside:'',range:'🪿é',renamed:'GO GO',lower:'é',numbers:'40.5'}))
  assert.equal(globals['text.'+key]??'',value,key);
assert.equal(flags.includes('contains'),true);
assert.ok(Number(globals.random)>=-5&&Number(globals.random)<=5);
assert.ok(Number(globals['real.fraction'])>=2&&Number(globals['real.fraction'])<3);
const checkpoint=runtime.save_game(),next=step();
runtime.load_game(checkpoint);
const repeated=step();
assert.equal(repeated.globals.random,next.globals.random);
assert.equal(repeated.globals['real.fraction'],next.globals['real.fraction']);
assert.deepEqual(step(32).frame.viewport,[136,88,64,64]);
assert.equal(step().flags.includes('visible'),false);
step(16);
assert.equal(step().flags.includes('ladder'),true);
step(64);
assert.equal(step().flags.includes('room_edge'),true);
runtime.free();
const startupCamera=parseScript(`on game startup
  set_adaptive_display(128, 128, 512, 512, 2)
  global.startup_width = camera.width()
end
`);
const adaptive=await compileProject('demo',{project,scripts:new Map([['game',startupCamera]])});
const adaptiveRuntime=Runtime.from_cartridge_with_view(pack(adaptive),undefined,1,undefined,400,300,false);
assert.equal(decodeSave(adaptiveRuntime.save_game()).globals.startup_width,'200');
assert.deepEqual(decodeFrame(adaptiveRuntime.snapshot()).viewport.slice(2),[200,150]);
adaptiveRuntime.set_camera_window(520,320,false);
assert.deepEqual(decodeFrame(adaptiveRuntime.snapshot()).viewport.slice(2),[260,160]);
adaptiveRuntime.free();
console.log('Passed viewport geometry, tile contact, Unicode text, numeric reporters, saved random state, and shared Blockly reporter conversion');
