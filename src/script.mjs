import { readings, Blocks, Events, inputEvent, Opcodes } from './schema.mjs';

export const scopes = ['local','global','flag'];
export const operations = ['add','subtract','multiply','divide','remainder','equal','less','less_equal','and','or','not'];
export const tileSizes = [8,16,24,32];
export const variableName = name => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name);
const commands = {constant:10, load:11, store:12, calc:13, branch:14, jump:15, wait:16};
const buttons = ['up','down','left','right','a','b','x','menu'];

export function compileScript(script,modules={},trace,registry){
  const result=compileEvents(script,modules,trace,registry);
  for(const [name,r] of Object.entries(script.routines??{})){
    const args=r.params.map(()=>0);
    const block=r.body?{op:'call',name,args}:{op:'wait',ticks:{call:name,args}};
    try{compileEvents({...script,events:{start:[block]}},modules,undefined,registry);}
    catch(error){if(error.node===block || !error.node)error.node=r;throw error;}
  }
  return result;
}
function compileEvents(script, modules, trace, registry) {
  let unit=script, parameters=new Map(), active=new Set(), current;
  function call(name,args,isFunction,run){
    const parts=name.split('.');
    const qualified=parts.length===2;
    if(parts.length>2 || (qualified && !unit.imports?.includes(parts[0])))throw Error('Import the module before calling '+name);
    const owner=qualified ? modules[parts[0]] : unit;
    const key=parts.at(-1);
    const routine=owner && Object.hasOwn(owner.routines??{},key) && owner.routines[key];
    if(!routine || isFunction===Array.isArray(routine.body))throw Error('Unknown '+(isFunction?'function ':'procedure ')+name);
    if(active.has(routine))throw Error('Recursive call to '+name);
    if(args.length!==routine.params.length)throw Error(name+' takes '+routine.params.length+' arguments');
    const previousUnit=unit, previousParams=parameters;
    const bindings=new Map(routine.params.map((param,index)=>[param,{value:args[index],unit,parameters,active:new Set(active)}]));
    active.add(routine);unit=owner;parameters=bindings;
    try{run(routine);}finally{unit=previousUnit;parameters=previousParams;active.delete(routine);}
  }
  for(const name of script.imports??[])if(!Object.hasOwn(modules,name))throw Error('Unknown module '+name);
  for(const [name,r] of Object.entries(script.routines??{})){
    if(!variableName(name) || Object.hasOwn(Blocks,name) || name==='wait' || !Array.isArray(r.params) ||
       r.params.some(p=>!variableName(p)) || new Set(r.params).size!==r.params.length ||
       r.params.length>2)throw Error('Invalid routine '+name);
  }
  try {
  const dependencies = new Set();
  const events = {};
  let nodes = 0;
  for (const [event, body] of Object.entries(script.events ?? {})) {
    if (!Events.includes(event)&&!inputEvent(event)) throw Error(`Unknown script event: ${event}`);
    if(inputEvent(event)&&registry&&!Object.hasOwn(registry.controls,event.split('.')[1]))throw Error('Map action in Game → Controls: '+event);
    const bytes = [], names = [], constants = [], reals = [];
    const intern = (pool,value) => {
      let index = pool.indexOf(value);
      if (index < 0) { index = pool.length; pool.push(value); }
      return index;
    };
    const named = name => {
      if (!variableName(name)) throw Error(`Invalid variable name: ${name}`);
      return intern(names,name);
    };
    const scope = value => {
      const index = scopes.indexOf(value);
      if (index < 0) throw Error(`Unknown variable scope: ${value}`);
      return index;
    };
    const word = n => [n & 255,n >>> 8];
    const emit = (op,...operands) => {
      if(trace)trace(event,op,current);
      bytes.push(op,...operands);
    };
    const patch = (offset,target) => { [bytes[offset],bytes[offset+1]] = word(target); };
    function enter(depth) {
      if (++nodes > 2048 || depth > 32 || bytes.length > 60000) throw Error('Script is too large or too deeply nested');
    }
    function expression(value, target, depth) {
      enter(depth);
      if (target > 63) throw Error('Expression needs too many registers');
      if (typeof value === 'number' || typeof value === 'boolean') {
        if (typeof value === 'number' && !Number.isSafeInteger(value)) throw Error('Use an exact integer in expressions');
        emit(commands.constant,target,...word(intern(constants,Number(value))));
      } else if(value?.call){
        current=value;call(value.call,value.args,true,r=>expression(r.result,target,depth+1));
      } else if(value?.param){
        const binding=parameters.get(value.param);
        if(!binding)throw Error('Unknown parameter '+value.param);
        const oldUnit=unit,oldParams=parameters,oldActive=active;
        unit=binding.unit;parameters=binding.parameters;active=binding.active;
        try{expression(binding.value,target,depth+1);}finally{unit=oldUnit;parameters=oldParams;active=oldActive;}
      } else if (value?.get != null) {
        emit(commands.load,target,scope(value.scope),...word(named(value.get)));
      } else if(value?.action!=null){
        if(registry&&!Object.hasOwn(registry.controls,value.action))throw Error('Map action in Game → Controls: '+value.action);
        emit(commands.load,target,6,...word(named(value.action)));
      } else if (value?.item != null) {
        if(registry&&!Object.hasOwn(registry.items,value.item))throw Error('Register item in Game → Items: '+value.item);
        emit(commands.load,target,4,...word(named(value.item)));
      } else if(value?.actor){
        const index=readings.indexOf(value.actor);
        if(index<0)throw Error('Unknown actor property '+value.actor);
        emit(commands.load,target,5,...word(index));
      } else if (value?.button != null) {
        const index = buttons.indexOf(value.button);
        if (index < 0) throw Error(`Unknown button: ${value.button}`);
        emit(commands.load,target,3,...word(index));
      } else if (value?.calc) {
        const op = operations.indexOf(value.calc);
        if (op < 0) throw Error(`Unknown operation: ${value.calc}`);
        expression(value.left ?? 0,target,depth+1);
        if (value.calc !== 'not') expression(value.right ?? 0,target+1,depth+1);
        emit(commands.calc,target,op,target,value.calc === 'not' ? target : target+1);
      } else throw Error('Invalid expression');
    }
    function sequence(list,depth) {
      enter(depth);
      if (!Array.isArray(list)) throw Error('Expected a list of blocks');
      for (const block of list) {
        enter(depth);
        current=block;
        if (block.op==='call')call(block.name,block.args,false,r=>sequence(r.body,depth+1));
        else if (block.op === 'set') {
          expression(block.value ?? 0,0,depth+1);
          emit(commands.store,scope(block.scope),...word(named(block.name)),0);
        } else if (block.op === 'if' || block.op === 'while') {
          const start = bytes.length;
          expression(block.condition ?? 0,0,depth+1);
          emit(commands.branch,0,0,0);
          const falseTarget = bytes.length-2;
          sequence(block.body ?? [],depth+1);
          if (block.op === 'while') {
            emit(commands.jump,...word(start));
            patch(falseTarget,bytes.length);
          } else if (block.otherwise?.length) {
            emit(commands.jump,0,0);
            const endTarget = bytes.length-2;
            patch(falseTarget,bytes.length);
            sequence(block.otherwise,depth+1);
            patch(endTarget,bytes.length);
          } else patch(falseTarget,bytes.length);
        } else if (block.op === 'wait') {
          expression(block.ticks ?? 1,0,depth+1);
          emit(commands.wait,0);
        } else {
          if (!Object.hasOwn(Blocks,block.op)) throw Error(`Unknown block: ${block.op}`);
          if(registry&&Blocks[block.op][1].some(([key])=>key==='item')&&!Object.hasOwn(registry.items,block.item??Blocks[block.op][1][0][2]))throw Error('Register item in Game → Items: '+(block.item??Blocks[block.op][1][0][2]));
          if (['give','take'].includes(block.op) && !variableName(block.item??'coin'))throw Error('Use an item ID with letters, numbers, or underscores');
          if(block.op==='follow_player'&&typeof block.player==='number'&&(!Number.isInteger(block.player)||block.player<1||block.player>4))throw Error('Select player 1 to 4.');
          const operands = Blocks[block.op][1].map(([key,type,fallback],index)=>{
            const value = block[key] ?? fallback;
            if (type === 'number') {
              if (typeof value === 'number' && !Number.isInteger(value)) {
                if (!Number.isFinite(value) || Math.abs(value)>10000) throw Error(`Invalid value for ${key}`);
                emit(17,index,...word(intern(reals,value.toString())));
              } else expression(value,index,depth+1);
              return index;
            }
            if (type === 'text' && typeof value === 'string' && value.length <= 96) return intern(names,value);
            if (Array.isArray(type) && type.includes(value)) return intern(names,value);
            throw Error(`Invalid block value for ${key}`);
          });
          if (block.op === 'spawn') dependencies.add(block.sprite ?? 'drone');
          emit(Opcodes[block.op],...operands.flatMap(word));
        }
      }
    }
    sequence(body,0);
    if (bytes.length >= 65535) throw Error('Script bytecode exceeds 64 KiB');
    if (bytes.length) events[event] = { b:typeof Buffer === "undefined" ? Uint8Array.from(bytes) : Buffer.from(bytes), n:names, k:constants, ...(reals.length ? {f:reals} : {}) };
  }
  return { events, dependencies };
  } catch(error){error.node=current;throw error;}
}
