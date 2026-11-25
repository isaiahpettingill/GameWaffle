import { actorReadings, Blocks, Events, controlTransfers, inputEvent, receivedEvent, timerEvent, controllerEvent, Opcodes, messageInputs, entityQueries, reporters, commandScopeError, collectionCommands, collectionQueries, valueInput } from './schema.mjs';
import {inventoryTypes,propertyAliases,propertyType,scalarTypes,validateCollections} from './collections.mjs';
import {validResourceText} from './resource-tables.mjs';
import {compileInitProperties} from './init-properties.mjs';
import {physicsArgumentDefault} from './physics-units.mjs';

const variableScopes = {local:0,global:1,flag:2,local_real:9,global_real:10,local_bool:11,global_bool:12,local_string:13,global_string:14};
export const scopes = Object.keys(variableScopes);
const scopeType = scope => {
  if (scope.endsWith('_real')) return 'real';
  if (scope==='flag' || scope.endsWith('_bool')) return 'boolean';
  if (scope.endsWith('_string')) return 'string';
  return 'integer';
};
export const parameterTypes = ['integer','real','boolean','string'];
export const maxParameters=8;
const types=parameterTypes;
const defaults = {integer:0,real:{real:0},boolean:false,string:''};
const validation = Symbol('validate routine result');
export const operations = [
  'add','subtract','multiply','divide','remainder','equal','less','less_equal','and','or','not',
  'not_equal','greater','greater_equal','min','max','abs','to_real','floor','ceil','round','trunc',
  'sqrt','sin','cos','tan','asin','acos','atan','atan2','pow','log','exp','to_integer',
];
const comparisons = ['equal','less','less_equal','not_equal','greater','greater_equal'];
const logic = ['and','or','not'];
const isNumeric = type => type==='integer'||type==='real';
export const unaryMath = ['abs','to_real','to_integer','floor','ceil','round','trunc','sqrt','sin','cos','tan','asin','acos','atan','log','exp'];
export const binaryMath = ['min','max','atan2','pow'];
const toInteger = ['floor','ceil','round','trunc'];
const realMath = [...unaryMath.slice(unaryMath.indexOf('sqrt')), 'atan2', 'pow'];
const reporterCodes=Object.keys(reporters);
const paramType = (routine, index) => routine.paramTypes?.[index] ?? 'integer';

export function formatParameters(routine) {
  return routine.params.map((name,index)=>name+(paramType(routine,index)==='integer'?'':': '+paramType(routine,index))).join(', ');
}

export function parseParameters(text) {
  const entries = text.trim() ? text.split(',').map(entry=>entry.trim().split(/\s*:\s*/)) : [];
  if (entries.some(([name,type,...rest])=>!variableName(name) || rest.length || (type && !types.includes(type)) || type==='')) {
    throw Error('Use parameter names such as amount or angle: real');
  }
  const params = entries.map(([name])=>name);
  if(params.length>maxParameters||new Set(params).size!==params.length)throw Error('Use up to '+maxParameters+' unique parameters');
  const paramTypes = entries.map(([,type])=>type??'integer');
  return {params,...(paramTypes.some(type=>type!=='integer')?{paramTypes}:{})};
}
export const tileSizes = [8,16,24,32];
export const variableName = name => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name);
export function constantType(value){
  if(Number.isSafeInteger(value))return 'integer';
  if(value&&typeof value==='object'&&Object.keys(value).length===1&&Number.isFinite(value.real))return 'real';
  if(typeof value==='boolean')return 'boolean';
  if(typeof value==='string'&&new TextEncoder().encode(value).length<=4096)return 'string';
}
export function conditionalBranches(block){
  const branches=[block];
  let otherwise=block.otherwise;
  while(otherwise?.length===1&&otherwise[0].op==='if'){
    const branch=otherwise[0];
    branches.push(branch);
    otherwise=branch.otherwise;
  }
  return {branches,otherwise};
}
const commands = {constant:10, load:11, store:12, calc:13, branch:14, jump:15, wait:16};
const buttons = ['up','down','left','right','a','b','x','menu'];

export function compileScript(script,modules={},trace,registry){
  const routines=Object.entries(script.routines??{});
  validateScriptDefinition(script,modules,routines,registry);
  const context={
    collections:registry?.collections??validateCollections(script.collections),
    aliases:registry?.propertyAliases??propertyAliases(script.declarations?.globals,script.declarations?.flags,registry?.items),
  };
  const {events,physics}=compileInitProperties(script.events,registry);
  const result=compileEvents(script,events,modules,trace,registry,context);
  for(const [name,r] of routines){
    const args=r.params.map((_,index)=>defaults[paramType(r,index)]);
    const block=r.body?{op:'call',name,args}:{op:validation,value:{call:name,args}};
    try{compileEvents(script,{start:[block]},modules,undefined,registry,context);}
    catch(error){if(error.node===block || !error.node)error.node=r;throw error;}
  }
  return physics?{...result,initPhysics:physics}:result;
}
function validateScriptDefinition(script,modules,routines,registry) {
  const constants=script.constants??{};
  if(typeof constants!=='object'||Array.isArray(constants)||Object.keys(constants).length>128)
    throw Error('Use up to 128 constants per script');
  for(const [name,value] of Object.entries(constants)){
    if(!variableName(name)||!constantType(value))throw Error('Invalid constant '+name);
  }
  if(registry&&!registry.gameScript&&(script.collections||Object.values(script.declarations??{}).some(group=>Object.keys(group).length)))
    throw Error('Use the Game script for global declarations, including resources');
  for(const [name,value] of Object.entries(script.declarations?.resources??{})){
    if(!variableName(name)||!validResourceText(value))throw Error('Invalid text resource '+name);
  }
  for(const name of script.imports??[])if(!Object.hasOwn(modules,name))throw Error('Unknown module '+name);
  for(const [name,r] of routines){
    if(!variableName(name) || Object.hasOwn(Blocks,name) || name==='wait' || controlTransfers.includes(name) || !Array.isArray(r.params) ||
       r.params.some(p=>!variableName(p)) || new Set(r.params).size!==r.params.length ||
       r.params.length>maxParameters || (r.paramTypes!=null && (!Array.isArray(r.paramTypes) || r.paramTypes.length!==r.params.length ||
       r.paramTypes.some(type=>!types.includes(type)))))throw Error('Invalid routine '+name);
  }
}
function compileEvents(script, sourceEvents, modules, trace, registry, {collections,aliases}) {
  let unit=script, parameters=new Map(), active=new Set(), current;
  function call(name,args,isFunction,run,checkArgument){
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
    const bindings=new Map(routine.params.map((param,index)=>[param,{value:args[index],unit,parameters,active:new Set(active),type:paramType(routine,index)}]));
    active.add(routine);unit=owner;parameters=bindings;
    let result;
    try { result=run(routine); } finally {unit=previousUnit;parameters=previousParams;active.delete(routine);}
    for(const [param,binding] of bindings)if(!binding.used)checkArgument(binding.value,binding.type,param);
    return result;
  }
  try {
  let scriptBorder=false,requiresAbi13=false,requiresAbi14=false,requiresAbi15=false,requiresAbi16=false,requiresAbi17=false,requiresAbi18=false,requiresAbi19=false,tileSensing=false;
  const dependencies = new Set(), shaderUses=new Set(), backgroundUses = new Set(), shaderPresets = new Set(), fontUses = new Set();
  let scriptGravity=false,scriptJump=false,requiresAbi10=false,requiresAbi12=false;
  const events = {};
  let nodes = 0;
  for (const [event, body] of Object.entries(sourceEvents ?? {})) {
    if (!Events.includes(event)&&!inputEvent(event)&&!receivedEvent(event)&&!timerEvent(event)&&!controllerEvent(event)) throw Error(`Unknown script event: ${event}`);
    if(controllerEvent(event)){
      if(registry&&!registry.gameScript)throw Error('Use controller connection events in the Game script');
      requiresAbi13=true;
      if(event.endsWith('.1'))requiresAbi18=true;
    }
    if(timerEvent(event))requiresAbi12=true;
    if(event==='game_startup'&&registry&&!registry.gameScript)throw Error('Use On game startup in the Game script');
    if(event==='clone_start'){
      if(registry&&(registry.roomScript||registry.tileScript))throw Error('Use When cloned in an entity script');
      requiresAbi14=true;
    }
    if(inputEvent(event)&&registry?.controls&&!Object.hasOwn(registry.controls,event.split('.')[1]))throw Error('Map action in the Game script: '+event);
    if(receivedEvent(event)&&registry?.events&&!Object.hasOwn(registry.events,event.slice(9)))throw Error('Choose an event from Game → Events');
    const bytes = [], names = {values:[]}, constants = {values:[]}, reals = {values:[]};
    let checking = 0;
    const intern = (pool,value) => {
      if(checking)return 0;
      const values=pool.values;
      // Keep the tiny pools common in editor scripts cheap and index larger ones.
      if(values.length<32){
        const index=values.indexOf(value);
        return index<0?values.push(value)-1:index;
      }
      if(!pool.index)pool.index=new Map(values.map((entry,index)=>[entry,index]));
      const found=pool.index.get(value);
      if(found!==undefined)return found;
      const index=values.push(value)-1;
      pool.index.set(value,index);
      return index;
    };
    const named = (name,scope) => {
      if (!variableName(name)) throw Error(`Invalid name: ${name}`);
      const type = scope==null || scope==='flag' ? 'integer' : scopeType(scope);
      const prefix = {real:'real.',boolean:'bool.',string:'text.'}[type]??'';
      return intern(names,prefix+name);
    };
    const scope = value => {
      const index = Object.hasOwn(variableScopes,value) ? variableScopes[value] : undefined;
      if (index === undefined) throw Error(`Unknown variable scope: ${value}`);
      return index;
    };
    const word = n => [n & 255,n >>> 8];
    const emit = (op,...operands) => {
      if(checking)return;
      if(trace)trace(event,op,current);
      bytes.push(op,...operands);
    };
    const promoteReal = register => emit(commands.calc,register,17,register,register);
    const patch = (offset,target) => { [bytes[offset],bytes[offset+1]] = word(target); };
    const jumpLater=()=>{
      emit(commands.jump,0,0);
      return bytes.length-2;
    };
    function patchAll(offsets,target=bytes.length){
      for(const offset of offsets)patch(offset,target);
    }
    function enter(depth) {
      if (++nodes > 2048 || depth > 32 || bytes.length > 60000) throw Error('Script is too large or too deeply nested');
    }
    const requireType = (actual, expected, context, target) => {
      if (actual===expected) return;
      if (expected==='real' && actual==='integer') {
        promoteReal(target);
        return;
      }
      if (expected==='boolean' && (actual==='integer'||actual==='real')) {
        const zero=target+1;
        expression(actual==='real'?{real:0}:0,zero,0);
        emit(commands.calc,target,operations.indexOf('not_equal'),target,zero);
        return;
      }
      const hint=expected==='integer'&&actual==='real'?'. Use an explicit conversion such as math.to_integer.':'';
      throw Error(context+' requires '+(expected==='integer'?'an ':'a ')+expected+' value'+hint);
    };
    function checkArgument(value,type,name,depth) {
      const node=current;
      checking++;
      try { requireType(expression(value,0,depth+1),type,'Parameter '+name,0); }
      finally { checking--;current=node; }
    }
    let repeatDepth = 0;
    function expression(value, target, depth) {
      enter(depth);
      if (target >= 64-repeatDepth) throw Error('Expression needs too many registers');
      if (typeof value==='string') {
        if (new TextEncoder().encode(value).length>4096)throw Error('Use up to 4096 bytes per string');
        emit(47,target,...word(intern(names,value)));
        return 'string';
      } else if (value?.text != null) {
        if(registry?.text && !Object.hasOwn(registry.text,value.text))throw Error('Add text key in Resources or the Game script: '+value.text);
        emit(48,target,...word(named(value.text)));
        return 'string';
      } else if (value?.real !== undefined || (typeof value==='number' && !Number.isInteger(value))) {
        const number = value?.real ?? value;
        if (!Number.isFinite(number)) throw Error('Use a finite real number');
        emit(17,target,...word(intern(reals,number.toString())));
        return 'real';
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        if (typeof value === 'number' && !Number.isSafeInteger(value)) throw Error('Use an exact integer in expressions');
        const number=Number(value);
        // CBOR's JavaScript writer encodes larger Numbers as floats.
        const integer=number >= -0x100000000 && number <= 0xffffffff ? number : BigInt(number);
        emit(commands.constant,target,...word(intern(constants,integer)));
        return typeof value==='boolean'?'boolean':'integer';
      } else if(value?.call){
        current=value;
        const namespace=value.call.split('.')[0];
        if(Object.hasOwn(reporters,value.call)&&!unit.imports?.includes(namespace)){
          const [,,result,params]=reporters[value.call];
          if(value.args.length!==params.length)throw Error(value.call+' takes '+params.length+' arguments');
          let numeric;
          const integerRegisters=[];
          for(const [index,[type]] of params.entries()){
            const arg=value.args[index], register=target+index;
            if(Array.isArray(type)&&!type.includes(arg))throw Error('Choose '+type.join(', ')+' for '+value.call);
            if(type==='tile'&&(typeof arg!=='string'||!arg||registry?.tiles&&!Object.hasOwn(registry.tiles,arg)))
              throw Error('Choose a project tile for '+value.call);
            const actual=expression(arg,register,depth+1);
            if(type==='numeric'){
              if(!isNumeric(actual))throw Error(value.call+' requires numeric values');
              if(actual==='integer')integerRegisters.push(register);
              if(actual==='real'||numeric===undefined)numeric=actual;
            }else requireType(actual,Array.isArray(type)||type==='tile'?'string':type==='entity'?'integer':type,value.call,register);
          }
          if(numeric==='real')for(const register of integerRegisters)promoteReal(register);
          emit(Opcodes.reporter,target,reporterCodes.indexOf(value.call),...Array.from({length:3},(_,i)=>word(params[i]?target+i:target)).flat());
          requiresAbi15=true;
          if(value.call==='text.lookup')requiresAbi17=true;
          if(value.call==='physics.gravity')requiresAbi19=true;
          if(namespace==='tile')tileSensing=true;
          return result==='numeric'?numeric:result;
        }
        if(collectionQueries.includes(value.call)){
          const operation=collectionQueries.indexOf(value.call), [id,index,path]=value.args;
          const inventory=operation<4;
          const count=[1,2,3,3,1,2][operation];
          const alias=(operation===2||operation===3)&&Object.hasOwn(aliases[id]??{},path)?aliases[id][path]:null;
          const fixedRoot=operation<2&&['game','players'].includes(id)&&!inventoryTypes(collections,id);
          if(value.args.length!==count||typeof id!=='string'||(inventory?!alias&&!fixedRoot&&!inventoryTypes(collections,id):!Object.hasOwn(collections.arrays,id)))
            throw Error(value.call+' requires a declared collection and '+count+' arguments');
          if(alias?.scope){
            if(index!==1)throw Error('Use slot 1 for a Game property');
            if(operation===2)return expression(true,target,depth+1);
            emit(commands.load,target,scope(alias.scope),...word(named(alias.name,alias.scope)));
            return alias.type;
          }
          if(alias||fixedRoot)requiresAbi13=true;
          const property=operation===2||operation===3?alias?.type??propertyType(collections,id,path):null;
          const result=['integer','string','boolean',property,'integer',collections.arrays[id]][operation];
          if(!scalarTypes.includes(result))throw Error('Read a scalar property through its inventory path');
          if(count>1)requireType(expression(index,target,depth+1),'integer','Collection index',target);
          emit(126,target,operation,...word(intern(names,id)),...word(target),...word(intern(names,property?path:'')));
          requiresAbi12=true;
          return result;
        }
        if(value.call==='item_key'){
          const [id]=value.args;
          if(value.args.length!==1||!variableName(id))throw Error('Choose a registered item for item_key');
          if(registry?.items&&!Object.hasOwn(registry.items,id))throw Error('Register item in Game → Items: '+id);
          return expression(id,target,depth+1);
        }
        if (value.call.startsWith('entity.') && !unit.imports?.includes('entity')) {
          const name=value.call.slice(7), query=Object.hasOwn(entityQueries,name)&&entityQueries[name];
          if(name==='on_tile_top'&&registry&&!registry.tileScript)throw Error('Use the tile top query in a tile script');
          if(!query)throw Error('Unknown entity query '+name);
          const operation=Object.keys(entityQueries).indexOf(name);
          if(operation>=13)requiresAbi12=true;
          if(operation>=18)requiresAbi14=true;
          if(name==='mass')requiresAbi19=true;
          const [,result,params]=query;
          if(value.args.length!==params.length)throw Error(value.call+' takes '+params.length+' arguments');
          params.forEach(([expected],index)=>{
            const register=target+index;
            const actual=expression(value.args[index],register,depth+1);
            if(expected==='number'){
              if(actual!=='integer'&&actual!=='real')throw Error(value.call+' requires a radius in pixels');
            }else requireType(actual,expected,value.call,register);
          });
          emit(50,target,operation,target,params.length===1?target:target+1);
          return result;
        }
        if (value.call.startsWith('math.') && !unit.imports?.includes('math')) {
          const name=value.call.slice(5), unary=unaryMath.includes(name);
          if (!unary && !binaryMath.includes(name)) throw Error('Unknown math function '+name);
          if (value.args.length!==(unary?1:2)) throw Error(value.call+' takes '+(unary?1:2)+' argument'+(unary?'':'s'));
          return calculate(name,value.args[0],value.args[1],target,depth);
        }
        return call(value.call,value.args,true,r=>expression(r.result,target,depth+1),(arg,type,name)=>checkArgument(arg,type,name,depth));
      } else if(value?.constant!=null){
        current=value;
        const literal=unit.constants?.[value.constant]??registry?.constants?.[value.constant];
        if(literal===undefined)throw Error('Unknown constant '+value.constant);
        if(!constantType(literal))throw Error('Invalid constant '+value.constant);
        return expression(literal,target,depth+1);
      } else if(value?.param){
        const binding=parameters.get(value.param);
        if(!binding)throw Error('Unknown parameter '+value.param);
        binding.used=true;
        const oldUnit=unit,oldParams=parameters,oldActive=active;
        unit=binding.unit;parameters=binding.parameters;active=binding.active;
        try {
          requireType(expression(binding.value,target,depth+1),binding.type,'Parameter '+value.param,target);
          return binding.type;
        } finally {unit=oldUnit;parameters=oldParams;active=oldActive;}
      } else if (value?.get != null) {
        emit(commands.load,target,scope(value.scope),...word(named(value.get,value.scope)));
        return scopeType(value.scope);
      } else if(value?.action!=null || value?.pressed!=null || value?.released!=null){
        const action=value.action??value.pressed??value.released;
        if(registry?.controls&&!Object.hasOwn(registry.controls,action))throw Error('Map action in the Game script: '+action);
        emit(commands.load,target,value.pressed!=null?7:value.released!=null?8:6,...word(named(action)));
        return 'boolean';
      } else if (value?.item != null) {
        if(registry?.items&&!Object.hasOwn(registry.items,value.item))throw Error('Register item in Game → Items: '+value.item);
        emit(commands.load,target,4,...word(named(value.item)));
      } else if(value?.actor){
        const index=Object.keys(actorReadings).indexOf(value.actor);
        if(index<0)throw Error('Unknown actor property '+value.actor);
        if(index>=28)requiresAbi14=true;
        if(value.actor==='mass')requiresAbi19=true;
        emit(commands.load,target,5,...word(index));
        return actorReadings[value.actor];
      } else if (value?.button != null) {
        const index = buttons.indexOf(value.button);
        if (index < 0) throw Error(`Unknown button: ${value.button}`);
        emit(commands.load,target,3,...word(index));
        return 'boolean';
      } else if (value?.calc) {
        return calculate(value.calc,value.left,value.right,target,depth);
      } else throw Error('Invalid expression');
      return 'integer';
    }
    function calculate(name,left,right,target,depth) {
      const op = operations.indexOf(name);
      if (op < 0) throw Error(`Unknown operation: ${name}`);
      const unary = name==='not' || unaryMath.includes(name);
      let type = expression(left===undefined?0:left,target,depth+1);
      const equality = name==='equal' || name==='not_equal';
      if(name==='to_integer'){
        if(type==='real')emit(commands.calc,target,21,target,target);
        else if(type!=='integer'&&type!=='boolean')throw Error(name+' requires a number or boolean');
        return 'integer';
      }
      if(name==='to_real'){
        if(!isNumeric(type))throw Error(name+' requires a number');
        if(type==='integer')promoteReal(target);
        return 'real';
      }
      const boolean = logic.includes(name);
      if(toInteger.includes(name)&&type==='integer')return 'integer';
      if (boolean) requireType(type,'boolean',name,target);
      else if (realMath.includes(name) || toInteger.includes(name)) {
        requireType(type,'real',name,target);
        type='real';
      }
      else if (!equality && !isNumeric(type) && !(type==='string' && name==='add')) {
        throw Error(name+' requires numeric operands'+(name==='add'?' or two strings':''));
      }
      if (!unary) {
        const other=expression(right===undefined?0:right,target+1,depth+1);
        if(!boolean&&isNumeric(type)&&isNumeric(other)&&type!==other){
          promoteReal(type==='integer'?target:target+1);
          type='real';
        }
        else requireType(other,boolean?'boolean':type,name,target+1);
      }
      emit(commands.calc,target,op,target,unary?target:target+1);
      if (comparisons.includes(name)||logic.includes(name)) return 'boolean';
      if (toInteger.includes(name)||name==='to_integer') return 'integer';
      return type;
    }
    function compileLoopBody(list,depth,flow){
      const loop={breaks:[],continues:[]};
      sequence(list,depth,{...flow,loop});
      return loop;
    }
    function sequence(list,depth,flow) {
      enter(depth);
      if (!Array.isArray(list)) throw Error('Expected a list of blocks');
      for (const block of list) {
        enter(depth);
        current=block;
        if(block.op==='init_properties')throw Error('Connect one Init properties block directly below On init or On game startup');
        if(block.op==='init_property')throw Error('Put static physics properties inside Init properties');
        if (block.op===validation)expression(block.value,0,depth+1);
        else if (block.op==='call')call(block.name,block.args,false,r=>{
          const returns=[];
          sequence(r.body,depth+1,{returns});
          patchAll(returns);
        },(arg,type,name)=>checkArgument(arg,type,name,depth));
        else if (block.op==='return') flow.returns.push(jumpLater());
        else if (block.op==='break'||block.op==='continue') {
          if(!flow.loop)throw Error('Use '+block.op+' inside a repeat or while loop');
          const targets=block.op==='break'?flow.loop.breaks:flow.loop.continues;
          targets.push(jumpLater());
        }
        else if (block.op === 'set' || block.op === 'change') {
          const variableScope = scope(block.scope), type = scopeType(block.scope);
          const amount = block.value === undefined ? defaults[type] : block.value;
          const value = block.op==='change'?{calc:'add',left:{scope:block.scope,get:block.name},right:amount}:amount;
          if (block.op==='change' && !['integer','real'].includes(type)) throw Error('Change by requires a numeric variable');
          requireType(expression(value,0,depth+1),type,'Variable '+block.name,0);
          emit(commands.store,variableScope,...word(named(block.name,block.scope)),0);
        } else if (block.op === 'if') {
          const {branches,otherwise}=conditionalBranches(block);
          const endTargets=[];
          for(const [index,branch] of branches.entries()){
            if(index)enter(depth);
            current=branch;
            requireType(expression(branch.condition===undefined?false:branch.condition,0,depth+1),'boolean','if',0);
            emit(commands.branch,0,0,0);
            const falseTarget=bytes.length-2;
            sequence(branch.body??[],depth+1,flow);
            if(index+1<branches.length||otherwise?.length)endTargets.push(jumpLater());
            patch(falseTarget,bytes.length);
          }
          if(otherwise?.length)sequence(otherwise,depth+1,flow);
          patchAll(endTargets);
        } else if(block.op==='inventory_set'&&block.inventory==='game'&&Object.hasOwn(aliases.game,block.property)){
          if(block.index!==1)throw Error('Use slot 1 for a Game property');
          const {type,name,scope:variableScope}=aliases.game[block.property];
          requireType(expression(block.value,0,depth+1),type,block.property,0);
          emit(commands.store,scope(variableScope),...word(named(name,variableScope)),0);
        } else if(block.op==='apply_shaders'){
          if(registry && !registry.gameScript && !registry.roomScript)throw Error('Apply shaders in a Room or Game script');
          if(!Array.isArray(block.passes)||block.passes.length>8)throw Error('Use up to eight passes in a shader pipeline');
          requiresAbi13=true;
          emit(Opcodes.shader_begin);
          for(const pass of block.passes){
            current=pass;
            const definition=Object.hasOwn(registry?.shaders??{},pass.shader)?registry.shaders[pass.shader]:null;
            if(!definition)throw Error('Choose a shader asset: '+pass.shader);
            shaderUses.add(pass.shader);
            emit(Opcodes.shader_add,...word(intern(names,pass.shader)),definition.uniformSize/4);
            const provided=pass.parameters??{};
            const parameters=definition.parameters.filter(param=>!param.automatic);
            for(const name of Object.keys(provided))
              if(!parameters.some(param=>param.name===name&&!param.hidden))throw Error('Unknown shader parameter '+name);
            for(const param of parameters){
              const name=param.name;
              const values=Object.hasOwn(provided,name)?provided[name]:param.defaults;
              if(values===undefined)continue;
              if(!Array.isArray(values)||param.lanes!==values.length)throw Error('Invalid shader parameter '+name);
              for(const [lane,value] of values.entries()){
                const type=expression(value,0,depth+1);
                if(param.kind==='float'?(type!=='real'&&type!=='integer'):type!=='integer')
                  throw Error('Shader parameter '+name+' requires '+(param.kind==='float'?'a number':'an integer'));
                emit(Opcodes.shader_parameter,...word(0),param.offset/4+lane,['float','int','uint'].indexOf(param.kind));
              }
            }
          }
          emit(Opcodes.shader_commit,registry?.gameScript?1:0);
        } else if (block.op === 'while') {
          const start = bytes.length;
          requireType(expression(block.condition===undefined?false:block.condition,0,depth+1),'boolean',block.op,0);
          emit(commands.branch,0,0,0);
          const falseTarget = bytes.length-2;
          const loop=compileLoopBody(block.body??[],depth+1,flow);
          patchAll(loop.continues,start);
          emit(commands.jump,...word(start));
          patch(falseTarget,bytes.length);
          patchAll(loop.breaks);
        } else if (block.op === 'repeat') {
          const count = 63-repeatDepth;
          requireType(expression(block.times===undefined?1:block.times,0,depth+1),'integer','repeat');
          expression(0,1,depth+1);
          emit(commands.calc,count,operations.indexOf('add'),0,1);
          repeatDepth++;
          const start = bytes.length;
          expression(0,0,depth+1);
          emit(commands.calc,0,operations.indexOf('less'),0,count);
          emit(commands.branch,0,0,0);
          const end = bytes.length-2;
          const loop=compileLoopBody(block.body??[],depth+1,flow);
          patchAll(loop.continues);
          expression(1,0,depth+1);
          emit(commands.calc,count,operations.indexOf('subtract'),count,0);
          emit(commands.jump,...word(start));
          patch(end,bytes.length);
          patchAll(loop.breaks);
          repeatDepth--;
        } else if (block.op === 'wait') {
          requireType(expression(block.ticks===undefined?1:block.ticks,0,depth+1),'integer','wait');
          emit(commands.wait,0);
        } else {
          if (!Object.hasOwn(Blocks,block.op)) throw Error(`Unknown block: ${block.op}`);
          if(registry?.items&&Blocks[block.op][1].some(([key])=>key==='item')&&!Object.hasOwn(registry.items,block.item??Blocks[block.op][1][0][2]))throw Error('Register item in Game → Items: '+(block.item??Blocks[block.op][1][0][2]));
          if (['give','take'].includes(block.op) && !variableName(block.item??'coin'))throw Error('Use an item ID with letters, numbers, or underscores');
          if(block.op==='follow_player'&&typeof block.player==='number'&&(!Number.isInteger(block.player)||block.player<1||block.player>4))throw Error('Select player 1 to 4.');
          if(block.op==='jump'||block.op==='jump_force')scriptJump=true;
          if(block.op==='apply_gravity')scriptGravity=true;
          if(Opcodes[block.op]>=87)requiresAbi10=true;
          if(Opcodes[block.op]>=92)requiresAbi12=true;
          if(Opcodes[block.op]>=139)requiresAbi13=true;
          if(Opcodes[block.op]>=141)requiresAbi14=true;
          if(Opcodes[block.op]>=144)requiresAbi16=true;
          if(block.op==='set_split_screen')requiresAbi18=true;
          const scopeError=registry&&commandScopeError(block.op,registry);
          if(scopeError)throw Error(scopeError);
          if(block.op==='set_health_bar')for(const key of ['fill','track']){
            if(typeof block[key]==='string'&&!/^#[0-9a-f]{6}$/i.test(block[key]))
              throw Error('Choose a health bar color such as #a6e3a1');
          }
          if(['set_room_music','set_room_ambience'].includes(block.op) && block.sound && registry?.sounds && !Object.hasOwn(registry.sounds,block.sound))
            throw Error('Choose a sound from Assets → Sounds');
          if(block.op==='set_room_border')scriptBorder=true;
          if(block.op==='set_room_background_image'&&block.image)backgroundUses.add(block.image);
          if(block.op==='set_room_shader')shaderPresets.add(block.shader??Blocks.set_room_shader[1][0][2]);
          if(block.op==='reset_room_shader')shaderPresets.add('none');
          if(block.op==='fire_projectile'){
            const projectile=block.projectile??'spark';
            if(registry?.sprites&&!Object.hasOwn(registry.sprites,projectile))throw Error('Choose a projectile entity type: '+projectile);
            dependencies.add(projectile);
          }
          if((block.op==='draw_text'||block.op==='set_hud_font') && block.font){
            if(!variableName(block.font)||registry?.fonts&&!Object.hasOwn(registry.fonts,block.font))
              throw Error('Choose a font from Game → Bitfonts');
            fontUses.add(block.font);
          }
          if(['emit_event','emit_event_with_entity'].includes(block.op)&&(!variableName(block.event)||registry?.events&&!Object.hasOwn(registry.events,block.event)))
            throw Error('Declare the event in the Game script');
          const message = messageInputs[block.op];
          const messageValue = message && (block[message]??Blocks[block.op][1][0][2]);
          const dynamicMessage = message && (typeof messageValue!=='string' || messageValue.length>96);
          let collectionValue;
          if(collectionCommands.includes(block.op)){
            if(block.op.startsWith('array_')){
              collectionValue=collections.arrays[block.array];
              if(!collectionValue)throw Error('Declare number array '+block.array+' in the Game script');
            }else{
              const alias=block.op==='inventory_set'&&Object.hasOwn(aliases[block.inventory]??{},block.property)?aliases[block.inventory][block.property]:null;
              if(alias)requiresAbi13=true;
              const types=inventoryTypes(collections,block.inventory)??(alias?[]:null);
              if(!types)throw Error('Declare inventory '+block.inventory+' in the Game script');
              if(['inventory_append','inventory_remove'].includes(block.op)&&['game','players'].includes(block.inventory))
                throw Error('Game and player property objects have fixed ownership');
              if(block.op==='inventory_append'&&!types.includes(block.object_type))throw Error('Choose an allowed object type');
              if(block.property!=null){
                collectionValue=alias?.type??propertyType(collections,block.inventory,block.property);
                if((block.op==='inventory_set')!==scalarTypes.includes(collectionValue))throw Error('Use scalar assignment or child object creation for this property type');
              }
            }
          }
          const operands = Blocks[block.op][1].map(([key,type,fallback,optional],index)=>{
            if(block[key]===null && !optional)throw Error('None requires an optional input: '+key);
            const value = block[key] ?? physicsArgumentDefault(block.op,key,fallback,registry?.pixelUnits);
            if (valueInput(type)) {
              const actual=expression(value,index,depth+1);
              if(key==='entity')requireType(actual,'integer',key,index);
              else if(type!=='number')requireType(actual,type==='value'?collectionValue:type,key,index);
              else if(actual!=='integer'&&actual!=='real')throw Error(key+' requires a numeric value');
              return index;
            }
            if (dynamicMessage && key===message) {
              requireType(expression(value,index,depth+1),'string',message);
              return index;
            }
            if (['field','component'].includes(key) && !variableName(value))throw Error('Use a valid '+(key==='component'?'tag':key)+' name');
            if (type === 'text' && typeof value === 'string' && value.length <= 96) return intern(names,value);
            if (Array.isArray(type) && type.includes(value)) return intern(names,value);
            throw Error(`Invalid block value for ${key}`);
          });
          if (block.op==='respawn_when' && block.flag && registry?.flags && !Object.hasOwn(registry.flags,block.flag))
            throw Error('Choose a respawn flag from Game → Variables');
          if (block.op==='show_menu' && registry?.menus && !Object.hasOwn(registry.menus,block.menu??'pause'))throw Error('Declare menu '+(block.menu??'pause')+' in the Game script');
          if (block.op === 'spawn') dependencies.add(block.sprite ?? 'drone');
          if(dynamicMessage)emit(49,Opcodes[block.op],operands[0],...word(operands[1]??0),...word(operands[2]??0));
          else emit(Opcodes[block.op],...operands.flatMap(word));
        }
      }
    }
    const returns=[];
    sequence(body,0,{returns});
    patchAll(returns);
    if (bytes.length >= 65535) throw Error('Script bytecode exceeds 64 KiB');
    if (bytes.length) events[event] = { b:typeof Buffer === "undefined" ? Uint8Array.from(bytes) : Buffer.from(bytes), n:names.values, k:constants.values, ...(reals.values.length ? {f:reals.values} : {}) };
  }
  return { events, dependencies, backgroundUses, scriptBorder, shaderUses, shaderPresets, fontUses, scriptGravity, scriptJump, requiresAbi10, requiresAbi12, requiresAbi13, requiresAbi14, requiresAbi15, requiresAbi16, requiresAbi17, requiresAbi18, requiresAbi19, tileSensing };
  } catch(error){error.node=current;throw error;}
}
