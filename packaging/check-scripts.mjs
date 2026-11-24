import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {decodeCbor} from '../src/cartridge.mjs';
import {compileScript} from '../src/script.mjs';
import {parseScript,formatScript,replaceScriptConstants} from '../src/wafflescript.mjs';
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

const typedSource=`
def label(visible: boolean, name: string)
  return name + "!"
end
on tick
  local_real.angle = 45.0
  local_bool.active = math.cos(local_real.angle) > 0.5
  local_string.title = label(local_bool.active, text.greeting)
  if local_bool.active
    repeat (1 + 2)
      change local_real.angle by 1.0
    end
    say(local_string.title)
  end
end`;
const typed=parseScript(typedSource);
assert.deepEqual(compileScript(parseScript(formatScript(typed))),compileScript(typed));
for(const [body, expected] of [
  ['local.angle = 1.0',/requires an integer/],
  ['local_real.angle = 1',/requires a real/],
  ['local_bool.enabled = "yes"',/requires a boolean/],
  ['local_string.message = true',/requires a string/],
  ['local.foo = 1 + 1.0',/requires an integer/],
  ['if "yes"\nwait(1)\nend',/requires a boolean/],
  ['wait(1.0)',/requires an integer/],
  ['say(123)',/requires a string/],
  ['local_string.message = label("yes", "hi")',/Parameter visible requires a boolean/],
]){
  assert.throws(()=>compileScript(parseScript(typedSource+'\non start\n'+body+'\nend\n')),expected);
}
assert.throws(()=>compileScript(parseScript('on tick\nsay(text.unknown)\nend'),{},undefined,{text:{}}),/Add .*key .*unknown/);
console.log('Passed typed literals and routine arguments, text round trips, and type errors');

for (const [number,zero] of [['-8','0'],['0.25','0.0']]) {
  const flag = expression => compileScript(parseScript(`on tick\n  flag.ready = ${expression}\nend`));
  assert.deepEqual(flag(number),flag(`${number} != ${zero}`),'Coercion uses a comparison to typed zero');
}

const tunables='const limit = 3 # Maximum shots\nconst gravity = 2.0\n\non tick\n  repeat const.limit\n    apply_gravity(const.gravity)\n  end\nend\n';
const constantUnit=parseScript(tunables);
assert.deepEqual(compileScript(parseScript(formatScript(constantUnit))),compileScript(constantUnit));
const edited=replaceScriptConstants(tunables,constantUnit,{limit:5,gravity:{real:2}});
assert.match(edited,/# Maximum shots/);
assert.equal(replaceScriptConstants(edited,parseScript(edited),{limit:5,gravity:{real:2}}),edited);
assert.throws(()=>compileScript(parseScript(tunables.replace('limit = 3','limit = 3.0'))),/repeat requires an integer/);
assert.throws(()=>compileScript(parseScript(tunables.replace('const limit = 3 # Maximum shots\n',''))),/Unknown constant limit/);
assert.throws(()=>parseScript('const speed = entity.x'),/literal/);

const chain='on tick\n  if action.right\n    velocity(2, 0)\n  elif action.left\n    velocity(-2, 0)\n  else\n    velocity(0, 0)\n  end\nend\n';
const nested=chain.replace('  elif action.left','  else\n    if action.left').replace('  end\nend','    end\n  end\nend');
assert.deepEqual(compileScript(parseScript(nested)),compileScript(parseScript(chain)));
assert.match(formatScript(parseScript(nested)),/^  elif action\.left$/m);
const longChain='on tick\nif false\n'+Array.from({length:40},()=> 'elif false\n').join('')+'end\nend\n';
assert.ok(compileScript(parseScript(longChain)).events.tick.b.length>0);
