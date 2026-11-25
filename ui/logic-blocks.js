import { buttons, controlTransfers, readings, realReadings, stringReadings, entityQueries, reporters } from '../src/schema.mjs';
import { binaryMath, scopes, unaryMath } from '../src/script.mjs';

const prefix = 'waffle_';
export const argumentInput=index=>'arg'+index;
const operatorLabels = {
  add: '+', subtract: '−', multiply: '×', divide: '÷', remainder: 'remainder',
  equal: '=', not_equal: '≠', less: '<', less_equal: '≤', greater: '>', greater_equal: '≥', and: 'and', or: 'or',
  sqrt: 'square root', abs: 'absolute value', sin: 'sin (°)', cos: 'cos (°)', tan: 'tan (°)',
  asin: 'asin → °', acos: 'acos → °', atan: 'atan → °', atan2: 'atan2 → °',
  pow: 'power', log: 'natural log', exp: 'exponential', min: 'minimum', max: 'maximum',
  to_real: 'integer → real', to_integer: 'to integer',
  floor: 'floor → integer', ceil: 'ceiling → integer', round: 'round → integer', trunc: 'truncate → integer',
};
const arithmetic = ['add', 'subtract', 'multiply', 'divide', 'remainder'];
const comparisons = ['equal', 'not_equal', 'less', 'less_equal', 'greater', 'greater_equal'];
const booleanOperators = ['and', 'or'];
const conditions = ['grounded','moving','is_player','is_clone'];
const conversions = ['to_real','to_integer','floor','ceil','round','trunc'];
const readingLabels = {
  id: 'ID', x: 'X position', y: 'Y position', vx: 'X velocity', vy: 'Y velocity',
  grounded: 'touching ground', other: 'other entity', other_player: 'other player',
  event_entity: 'entity from event',
  damage: 'damage received', last_spawn: 'last spawned entity', last_clone:'last clone', clone_source:'clone source', is_clone:'a clone', answer: 'dialogue answer',
  menu_choice:'menu choice', menu_item:'selected inventory item', menu_id:'last menu ID', used_item:'item just used', item_count: 'item count result', moving: 'moving', is_player: 'player-controlled',
  x_real:'X position', y_real:'Y position', vx_real:'X velocity', vy_real:'Y velocity', health_real:'health',
};
export const roomReadings = ['last_spawn','answer','item_count','menu_choice','menu_item','menu_id'];
const scopeLabels = {
  local:'entity integer', global:'game integer', flag:'game flag',
  local_real:'entity real', global_real:'game real', local_bool:'entity boolean', global_bool:'game boolean',
  local_string:'entity string', global_string:'game string',
};
const buttonLabels = {a: 'A', b: 'B', x: 'X', menu: 'Start'};
const options = (name, values, labels = {}) => ({
  type: 'field_dropdown', name, options: values.map(value => [labels[value] ?? value, value]),
});
const text = (name,value) => ({type:'field_input',name,text:value});
const number = (name,value) => ({type:'field_number',name,value});
const input = name => ({type:'input_value',name,check:'WaffleValue'});
const body = name => ({type:'input_statement',name,check:'waffle'});
const binary = ops => [input('left'), options('operation', ops, operatorLabels), input('right')];
export function queryPicker(query,index) {
  if(query==='find' && index===0)return 'instance_ref';
  if((query==='nearest' && index===0)||(query==='has' && index===1))return 'component_ref';
  if(['integer','real','boolean','string'].includes(query) && index===1)return 'entity_field_ref';
}
export function referenceSlot(type,value) {
  return {shadow:{type:prefix+type,...(value!==undefined?{fields:{value}}:{})}};
}
const entityLabels={
  find:'Entity %1',
  has:'Entity %1\nhas tag %2?',
  x:'X of %1', y:'Y of %1',
  vx:'X velocity of %1', vy:'Y velocity of %1',
  health:'Health of %1',
  integer:'Integer %2 of\n%1',
  real:'Real %2 of\n%1',
  boolean:'Boolean %2 of\n%1',
  string:'String %2 of\n%1',
};
export function entityQueryStyle(id) {
  if(id==='controller_connected')return 'input';
  if(id==='on_tile_top')return 'tile';
  if(id==='health')return 'combat';
  return 'entities';
}
const definitions = {
  ...Object.fromEntries(Object.entries(entityQueries).map(([id,[label, result, params]])=>[
    'entity_'+id, [entityQueryStyle(id),entityLabels[id]??label,params.map((_,index)=>input('arg'+index)),result==='boolean'?'condition':'value'],
  ])),
  instance_ref:['entities','%1',[text('value','')],'value'],
  self:['entities','This entity',[],'value','The entity running this script.'],
  component_ref:['entities','%1',[text('value','')],'value'],
  entity_field_ref:['entities','%1',[text('value','')],'value'],
  function_call:['routines','%1 %2 %3',[text('name','score'),input('a'),input('b')],'value'],
  param:['routines','Parameter %1',[text('name','amount')],'value'],
  call:['routines','Call %1 %2 %3',[text('name','apply'),input('a'),input('b')]],
  player:['input','%1',[options('value',['1','2','3','4'])],'value'],
  none:['operators','default',[],'optional','Use the command’s default value.'],
  event_sender:['events','Event sender',[],'value','The entity that emitted the event.'],
  event_entity:['events','Entity from event',[],'value','The entity passed along with the event.'],
  grounded:['motion','Touching ground?',[],'condition','True when this entity is standing on a surface.'],
  last_clone:['entities','Last clone',[],'value'],
  pressed:['input','%1 just pressed?',[text('pressed','x')],'condition','True on the first tick of a press.'],
  released:['input','%1 just released?',[text('released','x')],'condition','True on the first tick after a release.'],
  action:['input','%1 is down?', [text('action','jump')],'condition','True every tick while the input action is held.'],
  item_key:['collections','Item reference %1',[text('item','coin')],'value','Compare this to the item just used.'],
  item:['collections','Count of %1',[text('item','coin')],'value'],
  integer:['operators','%1',[number('value',0)],'value'],
  whole:['operators','%1',[{...number('value',0),precision:1}],'value','An exact integer.'],
  real:['operators','real %1',[number('value',0.5)],'value'],
  string:['text','text %1',[text('value','Hello')],'value'],
  color:['looks','%1',[{type:'field_color_picker',name:'value',text:'#a6e3a1'}],'value'],
  localized:['text','Resource %1',[text('key','greeting')],'value','Read a text resource in the cartridge’s language.'],
  join:['text','Join %1 and %2',[input('left'),input('right')],'value'],
  bool:['operators','%1',[options('value',['true','false'])],'condition'],
  get:['variables','%1 %2',[options('scope',scopes,scopeLabels),text('name','score')],'value'],
  constant:['variables','Constant %1',[text('name','')],'value'],
  actor:['entities','My %1',[options('actor',[...readings,...stringReadings],readingLabels)],'value'],
  room_reading:['text','Room %1',[options('actor',roomReadings,readingLabels)],'value'],
  actor_real:['entities','My %1 (real)',[options('actor',realReadings,readingLabels)],'value'],
  actor_condition:['entities','Am I %1?',[options('actor',conditions.slice(1),readingLabels)],'condition'],
  button:['input','Button %1 is down?',[options('button',buttons,buttonLabels)],'condition','Read a controller button directly.'],
  calc:['operators','%1 %2 %3',binary([...arithmetic,...comparisons,...booleanOperators]),'value'],
  arithmetic:['operators','%1 %2 %3',binary(arithmetic),'value'],
  compare:['operators','%1 %2 %3',binary(comparisons),'condition'],
  boolean_op:['operators','%1 %2 %3',binary(booleanOperators),'condition'],
  math_unary:['operators','%1 of %2',[options('operation',unaryMath.filter(op=>!conversions.includes(op)),operatorLabels),input('left')],'value'],
  math_binary:['operators','%1 of %2 and %3',[options('operation',binaryMath,operatorLabels),input('left'),input('right')],'value'],
  conversion:['operators','%1 %2',[options('operation',conversions,operatorLabels),input('left')],'value'],
  not:['operators','not %1',[input('left')],'condition'],
  set:['variables','Set %1 %2 to %3',[options('scope',scopes,scopeLabels),text('name','score'),input('value')]],
  change:['variables','Change %1 %2 by %3',[options('scope',['local','global','local_real','global_real'],scopeLabels),text('name','score'),input('value')]],
  repeat:['control','Repeat %1 times %2',[input('times'),body('body')]],
  if_then:['control','if %1 then %2',[input('condition'),body('body')]],
  while:['control','while %1 %2',[input('condition'),body('body')]],
  wait:['control','Wait %1 ticks',[input('ticks')]],
  return:['control','Return',[],null,'End this event handler or procedure.'],
  break:['control','Break',[],null,'Leave the nearest enclosing loop.'],
  continue:['control','Continue',[],null,'Skip to the next iteration of the nearest enclosing loop.'],
};

export const collectionReporters={
  'inventory.length':['Object count in %1',['inventory']],
  'inventory.type':['Type of object %2 in %1',['inventory','index']],
  'inventory.has':['Does object %2 in %1 have %3?',['inventory','index','property']],
  'inventory.get':['Read %3 of object %2 in %1',['inventory','index','property']],
  'array.length':['Number count in %1',['array']],
  'array.at':['Number %2 in %1',['array','index']],
};
export const collectionReporterType=name=>'waffle_'+name.replace('.','_');
export const reporterBlockType=name=>'waffle_reporter_'+name.replace('.','_');
export const reporterIsField=type=>Array.isArray(type)||type==='tile';
const reporterNames=Object.fromEntries(Object.keys(reporters).map(name=>[reporterBlockType(name),name]));

export function reporterBlock(name,args,inputSlot=(_,value,fallback)=>slot(value,fallback)){
  const fields={},inputs={};
  reporters[name][3].forEach(([type,fallback],index)=>{
    const key=argumentInput(index),value=args[index];
    if(reporterIsField(type)){
      if(value!==undefined)fields[key]=value;
    }else inputs[key]=inputSlot(type,value??fallback,fallback);
  });
  return {type:reporterBlockType(name),fields,inputs};
}

export function logicDefinitions(conditionShape) {
  const physicsLiterals=new Set(['whole','integer','real','bool','none']);
  return Object.entries(definitions).map(([id,[style,message0,args0,output,tooltip]])=>({
    type:prefix+id,style,message0,args0,tooltip,
    inputsInline:!args0.some(arg=>arg.type==='input_statement'),
    ...(output ? {output:physicsLiterals.has(id)?[output==='optional'?'WaffleNone':'WaffleValue','WafflePhysicsLiteral']:'WaffleValue',
      ...(output==='condition'?{outputShape:conditionShape}:{})} : {previousStatement:'waffle',nextStatement:'waffle'}),
  }));
}

export function readValue(block) {
  if (!block) return 0;
  const field = name=>block.getFieldValue(name);
  const child = name=>readValue(block.getInputTargetBlock(name));
  const id=block.type.slice(prefix.length);
  const reporter=reporterNames[block.type];
  if(reporter)return {call:reporter,args:reporters[reporter][3].map(([type,fallback],index)=>{
    const key=argumentInput(index);
    return reporterIsField(type)?field(key):block.getInputTargetBlock(key)?child(key):fallback;
  })};
  if(id.startsWith('entity_') && Object.hasOwn(entityQueries,id.slice(7))) {
    const query=id.slice(7);
    return {call:'entity.'+query,args:entityQueries[query][2].map(([,fallback],index)=>{
      const key='arg'+index;
      return block.getInputTargetBlock(key)?child(key):fallback;
    })};
  }
  for(const [name,[,operands]] of Object.entries(collectionReporters)){
    if(block.type===collectionReporterType(name))return {call:name,args:operands.map(key=>key==='index'?(block.getInputTargetBlock(key)?child(key):1):field(key))};
  }
  switch (block.type.slice(prefix.length)) {
    case 'function_call': {
      return {call:field('name'),args:block.parameters.map((_,index)=>child(argumentInput(index)))};
    }
    case 'param': return {param:field('name')};
    case 'player': return Number(field('value'));
    case 'none':return null;
    case 'grounded': return {actor:'grounded'};
    case 'last_clone': return {actor:'last_clone'};
    case 'event_sender': return {actor:'event_sender'};
    case 'event_entity': return {actor:'event_entity'};
    case 'pressed': return {pressed:field('pressed')};
    case 'self': return {actor:'id'};
    case 'released': return {released:field('released')};
    case 'action': return {action:field('action')};
    case 'item': return {item:field('item')};
    case 'item_key': return {call:'item_key',args:[field('item')]};
    case 'whole':
    case 'integer': return Number(field('value'));
    case 'real': return {real:Number(field('value'))};
    case 'instance_ref':
    case 'component_ref':
    case 'entity_field_ref':
    case 'color':
    case 'string': return field('value');
    case 'constant': return {constant:field('name')};
    case 'localized': return {text:field('key')};
    case 'join': return {calc:'add',left:child('left'),right:child('right')};
    case 'math_binary': return {call:'math.'+field('operation'),args:[child('left'),child('right')]};
    case 'math_unary':
    case 'conversion': return {call:'math.'+field('operation'),args:[child('left')]};
    case 'bool': return field('value') === 'true';
    case 'get': return {scope:field('scope'),get:field('name')};
    case 'actor_condition':
    case 'actor_real':
    case 'room_reading':
    case 'actor':return {actor:field('actor')};
    case 'button': return {button:field('button')};
    case 'arithmetic':
    case 'compare':
    case 'boolean_op':
    case 'calc': return {calc:field('operation'),left:child('left'),right:child('right')};
    case 'not': return {calc:'not',left:child('left')};
    default: throw Error('Unknown expression block');
  }
}

export function writeValue(value,imports) {
  const input=(value,fallback)=>slot(value,fallback,imports);
  if(value===null)return {type:prefix+'none'};
  if (typeof value === 'boolean') return {type:prefix+'bool',fields:{value:String(value)}};
  if (typeof value === 'string') return {type:prefix+'string',fields:{value}};
  if (typeof value === 'number') return {type:prefix+(Number.isInteger(value)?'whole':'real'),fields:{value}};
  if (value.real!==undefined) return {type:prefix+'real',fields:{value:value.real}};
  if (value.text!==undefined) return {type:prefix+'localized',fields:{key:value.text}};
  if(value.actor==='id')return {type:prefix+'self'};
  if(value.actor==='event_sender')return {type:prefix+'event_sender'};
  if(value.actor==='event_entity')return {type:prefix+'event_entity'};
  if(value.actor==='grounded')return {type:prefix+'grounded'};
  if(value.actor==='last_clone')return {type:prefix+'last_clone'};
  if(value.pressed)return {type:prefix+'pressed',fields:{pressed:value.pressed}};
  if(value.released)return {type:prefix+'released',fields:{released:value.released}};
  if(value.action)return {type:prefix+'action',fields:{action:value.action}};
  if(value.param)return {type:prefix+'param',fields:{name:value.param}};
  if(value.constant!=null)return {type:prefix+'constant',fields:{name:value.constant}};
  if(value.call){
    const imported=imports?.has(value.call.split('.')[0]);
    if(!imported&&Object.hasOwn(reporters,value.call) && value.args.length===reporters[value.call][3].length)
      return reporterBlock(value.call,value.args,(_,value,fallback)=>input(value,fallback));
    if(Object.hasOwn(collectionReporters,value.call)){
      const fields={},inputs={};
      collectionReporters[value.call][1].forEach((key,i)=>{
        if(key==='index')inputs[key]=input(value.args[i],1);else fields[key]=value.args[i];
      });
      return {type:collectionReporterType(value.call),fields,inputs};
    }
    if(value.call==='item_key'&&typeof value.args[0]==='string')return {type:prefix+'item_key',fields:{item:value.args[0]}};
    const query=!imported&&value.call.startsWith('entity.')?value.call.slice(7):'';
    if(Object.hasOwn(entityQueries,query) && value.args.length===entityQueries[query][2].length)
      return {type:prefix+'entity_'+query,inputs:Object.fromEntries(value.args.map((arg,i)=>{
        const picker=queryPicker(query,i);
        return ['arg'+i,picker&&typeof arg==='string'?referenceSlot(picker,arg):input(arg,entityQueries[query][2][i][1])];
      }))};
    const op=!imported&&value.call.startsWith('math.')?value.call.slice(5):'';
    if(unaryMath.includes(op) && value.args.length===1)
      return {type:prefix+(conversions.includes(op)?'conversion':'math_unary'),fields:{operation:op},inputs:{left:input(value.args[0])}};
    if(binaryMath.includes(op) && value.args.length===2)
      return {type:prefix+'math_binary',fields:{operation:op},inputs:{left:input(value.args[0]),right:input(value.args[1])}};
    return {type:prefix+'function_call',fields:{name:value.call},extraState:{name:value.call,
      parameters:value.args.map((_,i)=>({name:'Argument '+(i+1),type:'integer'}))},
      inputs:Object.fromEntries(value.args.map((arg,i)=>[argumentInput(i),input(arg)]))};
  }
  if (value.item != null) return {type:prefix+'item',fields:{item:value.item}};
  if (value.get != null) return {type:prefix+'get',fields:{scope:value.scope,name:value.get}};
  if(value.actor){
    const type=conditions.includes(value.actor)?'actor_condition':realReadings.includes(value.actor)?'actor_real':'actor';
    return {type:prefix+type,fields:{actor:value.actor}};
  }
  if (value.button != null) return {type:prefix+'button',fields:{button:value.button}};
  if(unaryMath.includes(value.calc))return writeValue({call:'math.'+value.calc,args:[value.left]},imports);
  if(binaryMath.includes(value.calc))return writeValue({call:'math.'+value.calc,args:[value.left,value.right]},imports);
  const logical = value.calc==='not' || booleanOperators.includes(value.calc);
  const child = val=>input(val===undefined?(logical?false:0):val);
  if(value.calc==='add' && [value.left,value.right].some(operand=>typeof operand==='string'||operand?.text!==undefined||operand?.scope?.endsWith('_string')))
    return {type:prefix+'join',inputs:{left:child(value.left),right:child(value.right)}};
  if (value.calc === 'not') return {type:prefix+'not',inputs:{left:child(value.left)}};
  const type=arithmetic.includes(value.calc)?'arithmetic':comparisons.includes(value.calc)?'compare':
    booleanOperators.includes(value.calc)?'boolean_op':'calc';
  return {type:prefix+type,fields:{operation:value.calc},inputs:{left:child(value.left),right:child(value.right)}};
}

export function slot(value, fallback, imports) {
  const block = writeValue(value,imports);
  if (value===null || typeof value!=='object' || value.real!==undefined) return {shadow:block};
  return {...(fallback!==undefined?{shadow:writeValue(fallback,imports)}:{}),block};
}

export const logicStatements = new Set(['if','while','repeat','set','change','wait','call',...controlTransfers]);
