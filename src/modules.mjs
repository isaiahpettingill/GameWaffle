import {parseScript} from './wafflescript.mjs';
import {variableName} from './script.mjs';

export async function loadModules(script,read,modules=Object.create(null),visiting=new Set()){
  for(const name of script.imports??[]){
    if(!variableName(name)||visiting.has(name))throw Error('Invalid or circular import '+name);
    if(Object.hasOwn(modules,name))continue;
    const path='scripts/modules/'+name+'.ws';
    let source;
    try{source=await read(path,'utf8');}catch(error){throw Error('Cannot read '+path,{cause:error});}
    const unit=parseScript(source);
    if(Object.keys(unit.events).length)throw Error('Move event handlers out of '+path);
    visiting.add(name);await loadModules(unit,read,modules,visiting);visiting.delete(name);
    modules[name]=unit;
  }
  return modules;
}
