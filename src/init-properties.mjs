import {gameCommands,roomCommands} from './schema.mjs';

export const physicsModes=['none','static','dynamic','kinematic','sensor','ladder','one_way','breakable','fluid'];
export const initialPhysicsFields={
  density:'Density',mass:'Mass (kg)',friction:'Friction',elasticity:'Elasticity',gravity:'Gravity scale',
  health:'Starting health',fixed:'Fixed rotation',buoyancy:'Fluid buoyancy',drag:'Fluid drag',damage:'Fluid damage per second',
  category:'Collision category',mask:'Collision mask',group:'Collision group',
};
export const propertySets={
  game:new Set([...gameCommands,'apply_shaders']),
  room:new Set([...roomCommands,'apply_shaders','camera','follow_player','group_camera','release_camera']),
  entity:new Set(['animate','set_emitter','set_sprite_shadow','set_health_bar','flip_sprite_x','flip_sprite_y','set_sprite_rotation',
    'set_entity_visible','set_entity_team','set_entity_layer','set_entity_persistence','set_entity_always_active','set_entity_max_health',
    'set_entity_integer','set_entity_real','set_entity_boolean','set_entity_string','add_component','remove_component','set_respawn','respawn_when']),
  tile:new Set(['set_tile_playback','set_tile_frame']),
};

export const initScope=({gameScript,roomScript,tileScript}={})=>gameScript?'game':roomScript?'room':tileScript?'tile':'entity';
export const initStatements=unit=>(unit?.events?.init??[]).flatMap(row=>row.op==='init_properties'?(row.body??[]):[row]);

function fail(node,message){throw Object.assign(Error(message),{node});}

function physicsValue(row){
  const {name,value}=row;
  if(name==='mode'){
    if(physicsModes.includes(value))return value;
    fail(row,'Choose a literal physics mode for the body');
  }
  if(!Object.hasOwn(initialPhysicsFields,name))fail(row,'Unknown initial physics property '+name);
  const label=initialPhysicsFields[name];
  if(name==='fixed'){
    if(typeof value==='boolean')return value;
    fail(row,label+' requires true or false');
  }
  if(name==='mass'&&value===null)return null;
  const real=value&&typeof value==='object'&&Object.keys(value).length===1?value.real:value;
  if(!Number.isFinite(real))fail(row,label+' requires a literal number');
  return real;
}

export function compileInitProperties(events,registry){
  if(events?.init?.[0]?.op!=='init_properties'&&events?.game_startup?.[0]?.op!=='init_properties')
    return {events};
  const scope=initScope(registry), physics=Object.create(null), source={...events};
  for(const event of ['init','game_startup']){
    if(!Array.isArray(events[event]))continue;
    const group=events[event][0];
    if(group?.op!=='init_properties')continue;
    if(event==='game_startup'&&registry&&scope!=='game')fail(group,'Game startup properties belong in the Game script');
    if(!Array.isArray(group.body))fail(group,'Expected a list of initial properties');
    const rows=[];
    for(const row of group.body){
      if(row.op==='init_property'){
        if(registry&&scope!=='entity'&&scope!=='tile')fail(row,'Physics properties belong to an entity type or tile variant');
        if(Object.hasOwn(physics,row.name))fail(row,'Set '+row.name+' only once');
        physics[row.name]=physicsValue(row);
        continue;
      }
      if(registry?!propertySets[scope].has(row.op):!Object.values(propertySets).some(set=>set.has(row.op)))
        fail(row,'Use '+row.op+' outside Init properties');
      if(propertySets.entity.has(row.op)&&Object.hasOwn(row,'entity')&&row.entity?.actor!=='id')
        fail(row,'Use This entity in Init properties');
      rows.push(row);
    }
    source[event]=[...rows,...events[event].slice(1)];
  }
  return {events:source,...(Object.keys(physics).length?{physics}:{})};
}
