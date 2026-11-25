import {constantType,variableName} from './script.mjs';

export const scalarTypes=['integer','real','boolean','string'];

export function validateCollections(input={}){
  const types=input.types??{}, inventories=input.inventories??{}, arrays=input.arrays??{};
  for(const group of [types,inventories,arrays]){
    if(typeof group!=='object'||Array.isArray(group)||Object.keys(group).length>64||Object.keys(group).some(id=>!variableName(id)))
      throw Error('Use up to 64 named object types, inventories, and arrays');
  }
  const heights=new Map(), active=new Set();
  function visit(id){
    if(heights.has(id))return heights.get(id);
    if(active.has(id))throw Error('Circular object types are forbidden: '+[...active,id].join(' → '));
    const fields=Object.hasOwn(types,id)?types[id]:null;
    if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).length>32)throw Error('Unknown or invalid object type '+id);
    active.add(id);
    let height=1;
    for(const [name,field] of Object.entries(fields)){
      if(!variableName(name)||typeof field?.type!=='string')throw Error('Invalid property on '+id);
      if(scalarTypes.includes(field.type)){
        if(Object.hasOwn(field,'default')){
          const type=constantType(field.default);
          if(type!==field.type&&!(field.type==='real'&&type==='integer'))throw Error(`Default for ${id}.${name} must be ${field.type}`);
        }
      }else{
        if(Object.hasOwn(field,'default'))throw Error('Object properties are created through their inventory paths');
        height=Math.max(height,1+visit(field.type));
      }
    }
    if(height>16)throw Error('Object types can be nested up to 16 levels');
    active.delete(id);heights.set(id,height);
    return height;
  }
  for(const id of Object.keys(types))visit(id);
  for(const [id,allowed] of Object.entries(inventories)){
    if(['game','players'].includes(id)||!Array.isArray(allowed)||!allowed.length||new Set(allowed).size!==allowed.length||allowed.some(type=>!Object.hasOwn(types,type)))
      throw Error('Declare valid object types for inventory '+id);
  }
  for(const [id,type] of Object.entries(arrays))if(!['integer','real'].includes(type))throw Error('Array '+id+' must contain integers or reals');
  const roots={};
  for(const [root,type] of [['game',input.game],['players',input.players]]){
    if(type!=null){if(!Object.hasOwn(types,type))throw Error('Declare an object type for '+root);roots[root]=type;}
  }
  return {types,inventories,arrays,...roots};
}

export function inventoryTypes(schema,id){
  return ['game','players'].includes(id)?(schema[id]?[schema[id]]:null):Object.hasOwn(schema.inventories,id)?schema.inventories[id]:null;
}

export function propertyAliases(globals,flags,items){
  const game=Object.create(null),players=Object.create(null);
  for(const [name,value] of Object.entries(globals??{})){
    const type=constantType(value);
    if(type)game['globals.'+name]={name,type,scope:{integer:'global',real:'global_real',boolean:'global_bool',string:'global_string'}[type]};
  }
  for(const name of Object.keys(flags??{}))game['flags.'+name]={name,type:'boolean',scope:'flag'};
  for(const name of Object.keys(items??{}))players['items.'+name]={name,type:'integer'};
  return {game,players};
}

export function propertyType(schema,inventory,path){
  const names=typeof path==='string'?path.split('.'):[];
  if(!names.length||names.length>16||names.some(name=>!variableName(name)))throw Error('Choose a property path');
  const found=new Set();
  for(const object of inventoryTypes(schema,inventory)??[]){
    let type=object;
    for(const name of names){
      const fields=Object.hasOwn(schema.types,type)?schema.types[type]:null;
      type=fields&&Object.hasOwn(fields,name)?fields[name].type:null;
    }
    if(type)found.add(type);
  }
  if(found.size!==1)throw Error(`Choose a property with one type in ${inventory}: ${path}`);
  return [...found][0];
}
