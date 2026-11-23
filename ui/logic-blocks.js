import { operations, scopes } from '../src/script.mjs';

const prefix = 'waffle_';
const choices = values => values.map(value=>[value.replaceAll('_',' '),value]);
const options = (name, values) => ({type:'field_dropdown',name,options:choices(values)});
const text = (name,value) => ({type:'field_input',name,text:value});
const number = (name,value) => ({type:'field_number',name,value});
const input = name => ({type:'input_value',name,check:'WaffleValue'});
const body = name => ({type:'input_statement',name,check:'waffle'});
const definitions = {
  item:['Count of %1',[text('item','coin')],true],
  integer:['Number %1',[number('value',0)],true],
  bool:['%1',[options('value',['true','false'])],true],
  get:['Get %1 %2',[options('scope',scopes),text('name','score')],true],
  button:['Button %1 is down',[options('button',['up','down','left','right','a','b','x','menu'])],true],
  calc:['%1 %2 %3',[input('left'),options('operation',operations.filter(op=>op!=='not')),input('right')],true],
  not:['Not %1',[input('left')],true],
  set:['Set %1 %2 to %3',[options('scope',scopes),text('name','score'),input('value')]],
  if:['If %1 do %2 else %3',[input('condition'),body('body'),body('otherwise')]],
  while:['While %1 do %2',[input('condition'),body('body')]],
  wait:['Wait %1 ticks',[input('ticks')]],
};

export function logicDefinitions() {
  return Object.entries(definitions).map(([id,[message0,args0,value]])=>({
    type:prefix+id,message0,args0,colour:value?156:276,
    ...(value ? {output:'WaffleValue'} : {previousStatement:'waffle',nextStatement:'waffle'}),
  }));
}

export function readValue(block) {
  if (!block) return 0;
  const field = name=>block.getFieldValue(name);
  const child = name=>readValue(block.getInputTargetBlock(name));
  switch (block.type.slice(prefix.length)) {
    case 'item': return {item:field('item')};
    case 'integer': return Number(field('value'));
    case 'bool': return field('value') === 'true';
    case 'get': return {scope:field('scope'),get:field('name')};
    case 'button': return {button:field('button')};
    case 'calc': return {calc:field('operation'),left:child('left'),right:child('right')};
    case 'not': return {calc:'not',left:child('left')};
    default: throw Error('Unknown expression block');
  }
}

export function writeValue(value) {
  if (typeof value === 'boolean') return {type:prefix+'bool',fields:{value:String(value)}};
  if (typeof value === 'number') return {type:prefix+'integer',fields:{value}};
  if (value.item != null) return {type:prefix+'item',fields:{item:value.item}};
  if (value.get != null) return {type:prefix+'get',fields:{scope:value.scope,name:value.get}};
  if (value.button != null) return {type:prefix+'button',fields:{button:value.button}};
  const child = val=>({block:writeValue(val ?? 0)});
  if (value.calc === 'not') return {type:prefix+'not',inputs:{left:child(value.left)}};
  return {type:prefix+'calc',fields:{operation:value.calc},inputs:{left:child(value.left),right:child(value.right)}};
}

export const logicStatements = new Set(['if','while','set','wait']);
