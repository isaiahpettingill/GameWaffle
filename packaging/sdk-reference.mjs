import {Blocks,Events,Opcodes,readings} from '../src/schema.mjs';
import {writeFile} from 'node:fs/promises';
const rows=Object.keys(Blocks).sort().map(key=>{
  const fields=Blocks[key][1];
  const call=key+'('+fields.map(([name])=>name).join(', ')+')';
  const label=Blocks[key][0].replace(/%(\d+)/g,(_,n)=>fields[Number(n)-1][0]);
  return '| `'+call+'` | '+label+' | '+Opcodes[key]+' |';
});
await writeFile('docs/blocks.md',['# WaffleScript engine commands','','| Command | Block | Opcode |','| --- | --- | --- |',...rows,'','## Events','',Events.map(e=>'`'+e+'`').join(', '),'','Use `pressed.name` or `released.name` for an input action. Read `action.name` to test whether a control for that action is held.','','## Actor readings','',readings.map(e=>'`actor.'+e+'`').join(', '),''].join('\n'));
