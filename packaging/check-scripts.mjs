import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {decodeCbor} from '../src/cartridge.mjs';
import {compileScript} from '../src/script.mjs';
import {parseScript,formatScript} from '../src/wafflescript.mjs';
import {loadModules} from '../src/modules.mjs';

const folder='demo/scripts/sprites';
for(const name of await readdir(folder)){
  const bytes=await readFile(folder+'/'+name);
  const blocks=name.endsWith('.ws') ? parseScript(bytes.toString('utf8')) : decodeCbor(bytes);
  assert.deepEqual(compileScript(parseScript(formatScript(blocks))),compileScript(blocks));
}
const source=`use score
def double(n)
  return n + n
end
proc award()
  global.points = score.bonus(double(double(1)), 3)
end
on a
  award()
end
`;
const script=parseScript(source);
const modules=await loadModules(script,(file,encoding)=>readFile('demo/'+file,encoding));
const inline=parseScript('on a\n  global.points = ((1 + 1) + (1 + 1)) * 3\nend\n');
assert.deepEqual(compileScript(script,modules),compileScript(inline));
assert.deepEqual(compileScript(script,modules),compileScript(parseScript(formatScript(script)),modules));
assert.throws(()=>compileScript(parseScript('proc spin()\nspin()\nend')),/Recursive/);
assert.throws(()=>compileScript(parseScript('def invalid(n)\nreturn typo\nend')),/parameter/);
assert.throws(()=>parseScript('on tick\n jump(\nend'),e=>e.from===14);
console.log('Passed WaffleScript round trips, module expansion, and diagnostics');
const gravity=compileScript(parseScript('on tick\n apply_gravity(none)\nend'));
for(const argument of ['','1'])assert.deepEqual(compileScript(parseScript('on tick\n apply_gravity('+argument+')\nend')),gravity);
assert.notDeepEqual(compileScript(parseScript('on tick\n apply_gravity(0)\nend')),gravity);
assert.throws(()=>compileScript(parseScript('on tick\n jump_force(none)\nend')),/optional/);
