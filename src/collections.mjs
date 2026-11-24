import {constantType,variableName} from './script.mjs';

export const scalarTypes=['integer','real','boolean','string'];

export function validateCollections(input={}){
  const types=input.types??{}, inventories=input.inventories??{}, arrays=input.arrays??{};
  for(const group of [types,inventories,arrays]){
    if(typeof group!=='object'||Array.isArray(group)||Object.keys(group).length>64||Object.keys(group).some(id=>!variableName(id)))
      throw Error('Use up to 64 named object types, inventories, and arrays');
  }
  const checked=new Set(), active=new Set();
  function visit(id,depth){
    if(checked.has(id))return;
    if(active.has(id))throw Error('Circular object types are forbidden: '+[...active,id].join(' → '));
    if(depth>16)throw Error('Object types can be nested up to 16 levels');
    const fields=Object.hasOwn(types,id)?types[id]:null;
    if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).length>32)throw Error('Unknown or invalid object type '+id);
    active.add(id);
    for(const [name,field] of Object.entries(fields)){
      if(!variableName(name)||typeof field?.type!=='string')throw Error('Invalid property on '+id);
      if(scalarTypes.includes(field.type)){
        if(Object.hasOwn(field,'default')&&constantType(field.default)!==field.type)throw Error(`Default for ${id}.${name} must be ${field.type}`);
      }else{
        if(Object.hasOwn(field,'default'))throw Error('Object properties are created through their inventory paths');
        visit(field.type,depth+1);
      }
    }
    active.delete(id);checked.add(id);
  }
  for(const id of Object.keys(types))visit(id,1);
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
