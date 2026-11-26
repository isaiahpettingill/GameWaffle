import {gameCommands,roomCommands,roomEdges} from './schema.mjs';

export const physicsModes=['none','static','dynamic','kinematic','sensor','ladder','one_way','breakable','fluid'];
export const initialPhysicsFields={
  density:'Density',mass:'Mass',friction:'Friction',elasticity:'Elasticity',gravity:'Gravity scale',
  health:'Starting health',fixed:'Fixed rotation',buoyancy:'Fluid buoyancy',drag:'Fluid drag',damage:'Fluid damage per second',
  category:'Collision category',mask:'Collision mask',group:'Collision group',
};
export const spawnFields={spawn_flag:['Spawn flag','string'],spawn_when:['Spawn flag state','boolean']};
const respawnFields={respawn_mode:['Respawn mode',['default','never','on_entry','delay']],
  respawn_ticks:['Respawn delay (ticks)','integer'],respawn_flag:['Respawn flag','string'],respawn_when:['Respawn flag state','boolean']};
const entityFields={...spawnFields,...respawnFields,
  width:['Body width','number'],height:['Body height','number'],gravity_mode:['Gravity control',['room','script']],
  collider:['Collider shape',['box','silhouette']],always_active:['Run off camera','boolean'],remember_state:['Remember state','boolean']};
const tileFields={...spawnFields,remember_removal:['Remember destroyed tiles','boolean']};
const roomFields={room_view:['Room view',['platformer','top_down']]};
const gameFields={default_font:['Default bitfont','string']};
export const instanceFields={...spawnFields,...respawnFields,remember_state:entityFields.remember_state,
  layer:['Draw layer','integer'],health:['Starting health','number'],animation:['Starting animation','string'],
  flip_x:['Face left at start','boolean'],standard_movement:['Built-in movement','boolean'],player:['Player slot (0 for none)','integer']};
export const layerFields={...spawnFields,collidable:['Enable layer collision','boolean']};
const definitionFields={entity:entityFields,tile:tileFields,room:roomFields,game:gameFields};
const allDefinitionFields={...entityFields,...tileFields,...roomFields,...gameFields};
export const initialDefinitionFields=Object.fromEntries(Object.entries(allDefinitionFields).map(([name,[label]])=>[name,label]));
export function initialFieldsFor(scope){
  const physics=scope==='entity'||scope==='tile'?initialPhysicsFields:{};
  return {...physics,...Object.fromEntries(Object.entries(definitionFields[scope]??{}).map(([name,[label]])=>[name,label]))};
}
const placementKeys={spawn_flag:'flag',spawn_when:'when',remember_state:'rememberState',
  remember_removal:'persistRemoval',flip_x:'flipX',standard_movement:'standardMovement',layer:'layer',animation:'animation',
  width:'width',height:'height',gravity_mode:'gravityMode',collider:'collider',always_active:'alwaysActive',collidable:'collidable'};
const respawnKeys={respawn_mode:'mode',respawn_ticks:'ticks',respawn_flag:'flag',respawn_when:'when'};

export function initialPropertyRows(asset={},tile=false){
  const fields=tile?tileFields:entityFields;
  const rows=[];
  for(const name of ['mode',...Object.keys(initialPhysicsFields)]){
    if(Object.hasOwn(asset.physics??{},name))rows.push({op:'init_property',name,value:asset.physics[name]});
  }
  for(const name of Object.keys(fields)){
    const value=Object.hasOwn(respawnKeys,name)?asset.respawn?.[respawnKeys[name]]:asset[placementKeys[name]];
    if(value!=null)rows.push({op:'init_property',name,value});
  }
  return rows;
}
export const propertySets={
  game:new Set([...gameCommands,'apply_shaders','draw_hud_sprite']),
  room:new Set([...roomCommands,'apply_shaders','apply_background_shaders','camera','follow_player','group_camera','release_camera','draw_hud_sprite']),
  entity:new Set(['animate','set_emitter','set_sprite_shadow','set_health_bar','flip_sprite_x','flip_sprite_y','set_sprite_rotation',
    'set_entity_visible','set_entity_team','set_entity_layer','set_entity_persistence','set_entity_always_active','set_entity_max_health',
    'set_entity_integer','set_entity_real','set_entity_boolean','set_entity_string','add_component','remove_component','set_respawn','respawn_when']),
  tile:new Set(['set_tile_playback','set_tile_frame']),
};

export const initScope=({gameScript,roomScript,tileScript}={})=>gameScript?'game':roomScript?'room':tileScript?'tile':'entity';
export const initStatements=unit=>(unit?.events?.init??[]).flatMap(row=>row.op==='init_properties'?(row.body??[]):[row]);

function fail(node,message){throw Object.assign(Error(message),{node});}

function literal(row, fields){
  const {name,value}=row;
  if(!Object.hasOwn(fields,name))fail(row,'Unknown initial property '+name);
  const [label,type]=fields[name];
  const number=value&&typeof value==='object'&&Object.keys(value).length===1?value.real:value;
  const valid=Array.isArray(type)?type.includes(value):type==='number'?Number.isFinite(number):
    type==='integer'?Number.isSafeInteger(value):typeof value===type&&(type!=='string'||value.length<=96);
  if(!valid)fail(row,label+' requires '+(Array.isArray(type)?type.join(', '):'a literal '+type));
  return type==='number'?number:value;
}

export function placementProperties(base,settings){
  if(!settings)return base;
  const result={...base};
  for(const [name,key] of Object.entries(placementKeys)){
    if(Object.hasOwn(settings,name))result[key]=settings[name];
  }
  if(settings.health!=null)result.physics={...base.physics,health:settings.health};
  if(settings.player!=null)result.player=settings.player===0?null:settings.player-1;
  for(const [name,key] of Object.entries(respawnKeys)){
    if(Object.hasOwn(settings,name))result.respawn={...result.respawn,[key]:settings[name]};
  }
  return result;
}

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
  const scope=initScope(registry), physics=Object.create(null), definition=Object.create(null), instances=new Map(), layers=new Map(), exits=new Map(), source={...events};
  for(const event of ['init','game_startup']){
    if(!Array.isArray(events[event]))continue;
    const group=events[event][0];
    if(group?.op!=='init_properties')continue;
    if(event==='game_startup'&&registry&&scope!=='game')fail(group,'Game startup properties belong in the Game script');
    if(!Array.isArray(group.body))fail(group,'Expected a list of initial properties');
    const rows=[];
    for(const row of group.body){
      if(row.op==='init_property'){
        if(Object.hasOwn(initialDefinitionFields,row.name)){
          if(Object.hasOwn(definition,row.name))fail(row,'Set '+row.name+' only once');
          definition[row.name]=literal(row,registry?definitionFields[scope]:allDefinitionFields);
          continue;
        }
        if(registry&&scope!=='entity'&&scope!=='tile')fail(row,'Physics properties belong to an entity type or tile variant');
        if(Object.hasOwn(physics,row.name))fail(row,'Set '+row.name+' only once');
        physics[row.name]=physicsValue(row);
        continue;
      }
      if(row.op==='instance_property'||row.op==='layer_property'){
        const instance=row.op==='instance_property', values=instance?instances:layers;
        const name=instance?row.instance:row.layer;
        if(registry&&scope!=='room')fail(row,'Set placed entity and layer properties in the Room script');
        if(typeof name!=='string'||!name.trim()||name.length>96)fail(row,'Choose a name from the room');
        const record=values.get(name)??Object.create(null);
        if(Object.hasOwn(record,row.name))fail(row,'Set '+row.name+' only once for '+name);
        record[row.name]=literal(row,instance?instanceFields:layerFields);
        if(row.name==='player'&&(record.player<0||record.player>4))fail(row,'Choose player 1 to 4 or 0 for none');
        values.set(name,record);
        continue;
      }
      if(row.op==='room_exit'||row.op==='alternate_exit'){
        if(registry&&scope!=='room')fail(row,'Define room exits in the Room script');
        const {edge,room:target}=row;
        if(!roomEdges.includes(edge)||typeof target!=='string'||!/^([A-Za-z0-9_-]{1,64})?$/.test(target))
          fail(row,'Choose an edge and a destination room');
        if(row.op==='alternate_exit'){
          const exit=exits.get(edge);
          if(!target||!exit?.targets.length||exit.mode==='fixed')fail(row,'Define a random exit before adding alternates');
          if(!exit.targets.includes(target))exit.targets.push(target);
        }else{
          if(exits.has(edge))fail(row,'Set the '+edge+' exit only once');
          const mode=row.routing??'fixed',flag=row.flag??'',when=row.when??true,adjacent=row.seamless??false;
          if(!['fixed','save','crossing'].includes(mode)||typeof flag!=='string'||typeof when!=='boolean'||typeof adjacent!=='boolean')
            fail(row,'Use literal exit routing, flag and seamless settings');
          if(adjacent&&(mode!=='fixed'||!target))fail(row,'Seamless exits need a fixed destination');
          exits.set(edge,{mode,targets:target?[target]:[],flag,when,adjacent});
        }
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
  return {events:source,...(Object.keys(physics).length?{physics}:{}),
    ...(Object.keys(definition).length?{definition}:{}),...(instances.size?{instances}:{}),...(layers.size?{layers}:{}),...(exits.size?{exits}:{})};
}
