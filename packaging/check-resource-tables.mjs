import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {unpack} from '../src/cartridge.mjs';
import {decodeWireFrame} from '../src/frame.mjs';
import {compileProject} from '../src/compiler.mjs';
import {loadModules} from '../src/modules.mjs';
import {pack} from '../src/pack.mjs';
import {compileScript} from '../src/script.mjs';
import {formatScript,parseScript} from '../src/wafflescript.mjs';
import {readValue,writeValue} from '../ui/logic-blocks.js';
import {Runtime,initSync} from '../web-built/runtime/runtime.js';

const game=parseScript(`resource greeting = "Hello"
resource pause_title = "Paused"
on game startup
  global_string.prefix = "gree"
  global_string.greeting = text.lookup(global_string.prefix + "ting")
  global_string.pause = text.pause_title
  global_string.missing = text.lookup("missing") + "!"
end
`);
assert.equal(parseScript(formatScript(game)).declarations.resources.pause_title,'Paused');
assert.throws(()=>parseScript('resource greeting = string.join("a", "b")'),/quoted string/);
assert.throws(()=>parseScript('resource greeting = "hi"\nresource greeting = "hello"'),/unique name/);
assert.throws(()=>compileScript(game,{},undefined,{gameScript:false}),/Game script/);
assert.throws(()=>compileScript(parseScript('on tick\n  say(text.lookup(42))\nend')),/requires a string/);
await assert.rejects(loadModules({imports:['wrong_scope']},async()=> 'resource greeting = "Hello"'),/Game script/);

const lookup=game.events.game_startup[1].value;
const block=writeValue(lookup);
assert.match(block.type,/text_lookup/);
const mock=state=>({
  type:state.type,getFieldValue:key=>state.fields?.[key],
  getInputTargetBlock:key=>state.inputs?.[key]&&(mock(state.inputs[key].block??state.inputs[key].shadow)),
});
assert.deepEqual(readValue(mock(block)),lookup);

const project=JSON.parse(await readFile('demo/project.json','utf8'));
const scripts=new Map([['game',game]]);
const implicit=await compileProject('demo',{project,scripts});
assert.equal(implicit.localization.locale,'en');
assert.equal(implicit.localization.tables.en.greeting,'Hello');
project.localization={locale:'en',tables:{en:{},es:{greeting:'¡Hola!'}}};
const cart=await compileProject('demo',{project,scripts});
assert.equal(cart.runtimeAbi,17);
initSync({module:await readFile('web-built/runtime/runtime_bg.wasm')});
for(const [locale,greeting] of [['en','Hello'],['es','¡Hola!']]){
  const bytes=pack(cart,{locale});
  const {text}=unpack(bytes,{simulation:true});
  assert.deepEqual(text,{greeting,pause_title:'Paused'});
  const runtime=Runtime.from_cartridge(bytes);
  runtime.step_buttons(0);
  const {globals}=decodeWireFrame(runtime.inspect_actor(0));
  assert.equal(globals['text.greeting'],greeting);
  assert.equal(globals['text.pause'],'Paused');
  assert.equal(globals['text.missing'],'!');
  runtime.free();
}
console.log('Passed static resource declarations, Blockly lookup round trips, localized cartridges, and dynamic lookups');
