import {shaderPresets} from './room-shaders.mjs';
export const effects=['sparks','dust','smoke','flame','bubbles','rain','snow'];
export const platformGravity = 16;
export const roomBorder = (room, topDown) => room.border ?? (room.closedEdges == null ? (topDown ? 'closed' : 'sides') : room.closedEdges ? 'closed' : 'open');
export const Events = ['init','start','clone_start','game_startup','use_item', 'restored', 'tick', 'a', 'b', 'x', 'menu', 'begin_contact', 'end_contact', 'damage', 'destroy', 'animation_finished', 'menu_selected'];
export const controlTransfers = ['return','break','continue'];
export const receivedEvent=name=>/^received\.[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name);
export const inputEvent=name=>/^(pressed|released)\.[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name);
export const controllerEvent=name=>/^controller_(connected|disconnected)\.[1-4]$/.test(name);
export const timerEvent=name=>/^(after|every)\.[1-9][0-9]{0,6}$/.test(name)&&Number(name.split('.')[1])<=1296000;
export function initialScript(actor){
  const init=[], self={actor:'id'}, events={};
  if(actor?.animation)init.push({op:'animate',tag:actor.animation});
  if(actor?.team!=null)init.push({op:'set_entity_team',entity:self,team:actor.team});
  if(actor?.emitter)init.push({op:'set_emitter',effect:actor.emitter.effect,rate:actor.emitter.rate,
    x:actor.emitter.offset?.[0]??0,y:actor.emitter.offset?.[1]??0});
  events.init=[{op:'init_properties',body:init}];
  if(actor?.scriptGravity&&actor.gravityMode!=='room')events.tick=[{op:'apply_gravity',modifier:null}];
  return {events};
}
export const hudAnchors=['top_left','top_center','top_right','center_left','center','center_right','bottom_left','bottom_center','bottom_right'];
export const Blocks = {
  instance_property:['Initial property of entity %1 · %2 = %3',[['instance','text',''],['name','text','animation'],['value','value','idle']]],
  layer_property:['Initial property of layer %1 · %2 = %3',[['layer','text',''],['name','text','spawn_flag'],['value','value','']]],
  set_display_resolution:['Set game resolution to %1 × %2',[['width','integer',320],['height','integer',224]]],
  set_adaptive_display:['Set adaptive display min %1 × %2 max %3 × %4 pixel zoom %5',[
    ['min_width','integer',128],['min_height','integer',128],['max_width','integer',512],['max_height','integer',512],['zoom','integer',2],
  ]],
  set_default_camera:['Set default camera to %1',[['target',['player','group'],'player']]],
  set_minimap:['Set minimap to %1',[['mode',['off','world','explored'],'off']]],
  set_first_controller:['First gamepad controls player %1',[['player','integer',2]]],
  set_split_screen:['Split screen %1 · merge within %2 pixels',[['enabled','boolean',true],['merge_distance','integer',0]]],
  set_entity_visible:['Show entity %1 %2',[['entity','integer',0],['visible','boolean',true]]],
  assign_entity_player:['Assign entity %1 to player %2',[['entity','integer',0],['player','integer',1]]],
  clone_entity:['Clone entity %1',[['entity','integer',{actor:'id'}]]],
  delete_clone:['Delete this clone',[]],
  set_entity_persistence:['Remember state of entity %1 between room visits %2',[['entity','integer',0],['enabled','boolean',true]]],
  set_entity_always_active:['Run entity %1 off camera %2',[['entity','integer',0],['enabled','boolean',true]]],
  set_tile_playback:['Play this tile %1',[['mode',['still','loop','once'],'loop']]],
  set_tile_frame:['Set this tile frame to %1',[['frame','integer',1]]],
  advance_tile_frame:['Advance this tile frame by %1',[['steps','integer',1]]],
  set_tile_friction:['Set this tile friction to %1',[['friction','number',{real:0.35}]]],
  set_tile_body:['Set this tile body to %1',[['mode',['none','static','dynamic','kinematic','sensor','one_way','breakable','fluid','ladder'],'static']]],
  force_entity:['Apply force to %1\nX %2 Y %3',[['entity','integer',0],['x','number',0],['y','number',-20]]],
  draw_space:['Draw in %1 coordinates',[['space',['world','hud'],'world']]],
  fill:['Fill shapes with %1',[['color','string','#cba6f7']]],
  no_fill:['No fill',[]],
  stroke:['Stroke shapes with %1',[['color','string','#cdd6f4']]],
  no_stroke:['No stroke',[]],
  stroke_width:['Stroke width %1 px',[['width','number',1]]],
  rect:['Rectangle at %1, %2 · %3 × %4',[['x','number',0],['y','number',0],['width','number',16],['height','number',16]]],
  ellipse:['Ellipse at %1, %2 · %3 × %4',[['x','number',8],['y','number',8],['width','number',16],['height','number',16]]],
  circle:['Circle at %1, %2 · diameter %3',[['x','number',8],['y','number',8],['diameter','number',16]]],
  line:['Line from %1, %2 to %3, %4',[['x','number',0],['y','number',0],['x2','number',16],['y2','number',16]]],
  triangle:['Triangle %1, %2 · %3, %4 · %5, %6',[['x','number',0],['y','number',0],['x2','number',16],['y2','number',0],['x3','number',8],['y3','number',16]]],
  point:['Point at %1, %2',[['x','number',0],['y','number',0]]],
  inventory_append:['Add new %2 to %1',[['inventory','text','backpack'],['object_type','text','item']]],
  inventory_remove:['Remove object %2 from %1',[['inventory','text','backpack'],['index','integer',1]]],
  inventory_set:['Set %3 of object %2 in %1 to %4',[['inventory','text','backpack'],['index','integer',1],['property','text','amount'],['value','value',1]]],
  inventory_create_child:['Create object in %3 of object %2 in %1',[['inventory','text','backpack'],['index','integer',1],['property','text','effect']]],
  inventory_remove_child:['Clear %3 of object %2 in %1',[['inventory','text','backpack'],['index','integer',1],['property','text','effect']]],
  array_append:['Add %2 to number array %1',[['array','text','scores'],['value','value',0]]],
  array_set:['Set number %2 in %1 to %3',[['array','text','scores'],['index','integer',1],['value','value',0]]],
  array_remove:['Remove number %2 from %1',[['array','text','scores'],['index','integer',1]]],
  draw_text:['Draw HUD text %2 named %1 in %3 at %4 with X %5 Y %6',[
    ['label','text','message'],['value','string','Hello!'],['font','text',''],['anchor',hudAnchors,'top_left'],
    ['x','number',4],['y','number',4],
  ]],
  set_hud_font:['Set HUD font to %1',[['font','text','']]],
  draw_hud_sprite:['Draw HUD sprite %2 named %1 at %3 · X %4 Y %5 · scale %6',[
    ['label','text','portrait'],['sprite','text',''],['anchor',hudAnchors,'top_left'],
    ['x','number',4],['y','number',4],['scale','integer',1,'optional'],
  ]],
  draw_background_sprite:['Draw background sprite %2 named %1 · X %3 Y %4 · scroll %5 · scale %6',[
    ['label','text','moon'],['sprite','text',''],['x','number',32],['y','number',24],['parallax','number',0],['scale','integer',1,'optional'],
  ]],
  emit_event:['Emit event %1',[['event','text','']]],
  emit_event_with_entity:['Emit event %1 with entity %2',[['event','text',''],['entity','integer',0]]],
  apply_gravity:['Apply gravity with modifier %1',[['modifier','number',1,'optional']]],
  force:['Apply force X %1 Y %2',[['x','number',0],['y','number',0]]],
  impulse:['Apply impulse X %1 Y %2',[['x','number',0],['y','number',0]]],
  follow_player:['Follow player %1',[['player','number',1]]],
  set_position:['Go to X %1 Y %2',[['x','number',0],['y','number',0]]],
  show_menu:['Show menu %1',[['menu','text','pause']]],
  show_inventory:['Show inventory menu',[]],
  use_selected_item:['Use selected inventory item',[]],
  respawn_when:['Entity %1 respawns when %2 is %3',[['entity','number',0],['flag','text',''],['when','boolean',true]]],
  emit_for:['Emit %1 at %2 per second for %3 ticks',[['effect',effects,'smoke'],['rate','number',18],['ticks','integer',60]]],
  burst_at:['Burst %1 at X %2 Y %3 offset',[['effect',effects,'sparks'],['x','number',0],['y','number',0]]],
  set_respawn:['Set entity %1 respawn to %2, delay %3 ticks',[['entity','number',0],['mode',['default','never','on_entry','delay'],'on_entry'],['ticks','integer',60]]],
  add_component:['Add tag %2 to entity %1',[['entity','number',0],['component','text','enemy']]],
  remove_component:['Remove tag %2 from entity %1',[['entity','number',0],['component','text','enemy']]],
  set_entity_integer:['Set entity %1 integer %2 to %3',[['entity','number',0],['field','text','score'],['value','integer',0]]],
  set_entity_real:['Set entity %1 real %2 to %3',[['entity','number',0],['field','text','speed'],['value','real',{real:0}]]],
  set_entity_boolean:['Set entity %1 boolean %2 to %3',[['entity','number',0],['field','text','ready'],['value','boolean',false]]],
  set_entity_string:['Set entity %1 string %2 to %3',[['entity','number',0],['field','text','label'],['value','string','']]],
  move_entity:['Move entity %1 by X %2 Y %3',[['entity','number',0],['x','number',1],['y','number',0]]],
  entity_velocity:['Set entity %1 velocity X %2 Y %3',[['entity','number',0],['x','number',0],['y','number',0]]],
  damage_entity:['Damage entity %1 by %2',[['entity','number',0],['amount','number',1]]],
  heal_entity:['Heal entity %1 by %2',[['entity','number',0],['amount','number',1]]],
  push_entity:['Push entity %1 with impulse X %2 Y %3',[['entity','number',0],['x','number',4],['y','number',0]]],
  break_entity:['Break entity %1',[['entity','number',0]]],
  remove_entity:['Remove entity %1',[['entity','number',0]]],
  animate_once:['Play animation %1 once',[['tag','text','idle']]],
  move_by:['Move by X %1 Y %2',[['x','number',1],['y','number',0]]],
  burst: ['Burst %1 with %2 particles', [['effect',effects,'sparks'],['count','number',12]]],
  emit: ['Emit %1 at %2 per second', [['effect',effects,'smoke'],['rate','number',16]]],
  stop_fx: ['Stop particle emitter', []],
  remove_self: ['Remove this instance', []],
  use_player_item:['Use %1 for player %2',[['item','text','key'],['player','number',1]]],
  item_icon:['Draw item %1 at X %2 Y %3',[['item','text','key'],['x','number',2],['y','number',2]]],
  bar:['Show bar %1 value %2 maximum %3',[['label','text','Health'],['value','number',1],['maximum','number',10]]],
  checkpoint:['Set checkpoint',[]],
  retry_checkpoint:['Return to checkpoint',[]],
  ask:['Ask yes or no %1',[['text','text','Open the door?']]],
  give_player:['Give %1 to player %2 count %3',[['item','text','coin'],['player','number',1],['count','number',1,'optional']]],
  take_player:['Take %1 from player %2 count %3',[['item','text','coin'],['player','number',1],['count','number',1,'optional']]],
  count_player:['Read %1 count for player %2',[['item','text','coin'],['player','number',1]]],
  group_camera:['Follow all players',[]],
  follow: ['Follow this instance', []],
  camera: ['Point camera at X %1 Y %2', [['x','number',0],['y','number',0]]],
  release_camera: ['Follow player 1', []],
  camera_follow_entity: ['Follow entity %1', [['entity','number',0]]],
  camera_zoom: ['Set camera zoom to %1×', [['zoom','number',1]]],
  reset_room_camera: ['Reset room camera', []],
  set_room_gravity: ['Set room gravity to %1', [['gravity','number',{real:9.8}]]],
  set_room_background_image: ['Set background image to %1\nat %2 scroll (0–1)', [['image','text',''],['scroll','number',1]]],
  set_entity_layer: ['Set draw layer of %1 to %2', [['entity','integer',0],['layer','integer',0]]],
  set_entity_team: ['Set team of %1 to %2', [['entity','integer',0],['team','integer',0]]],
  set_entity_max_health: ['Set health limit of %1 to %2', [['entity','integer',0],['health','number',1]]],
  set_entity_friction: ['Set friction of %1 to %2', [['entity','integer',0],['friction','number',{real:0.5}]]],
  set_emitter: ['Emit %1 at %2 particles per second\noffset X %3 Y %4', [['effect',effects,'smoke'],['rate','integer',16],['x','number',0],['y','number',0]]],
  set_room_border: ['Set room borders to %1', [['border',['open','sides','closed'],'sides']]],
  set_camera_bottom_inset: ['Set camera bottom inset to %1 tiles', [['tiles','integer',0]]],
  set_room_background: ['Set room background color to %1', [['color','string','#101a23']]],
  set_background_gradient:['Background gradient %1 · %2', [['kind',['none','linear','radial'],'linear'],['colors',['smooth','dithered'],'smooth']]],
  set_gradient_axis:['Gradient from X %1 Y %2 to X %3 Y %4', [['x','number',0],['y','number',0],['end_x','number',0],['end_y','number',1]]],
  set_gradient_stop:['Linear stop %1 at %2 · %3', [['index','integer',1],['offset','number',0],['color','string','#101a23']]],
  set_gradient_focus:['Radial focus %1 at X %2 Y %3\nradius %4 · %5', [['index','integer',1],['x','number',{real:.5}],['y','number',{real:.5}],['radius','number',{real:.7}],['color','string','#f9e2af']]],
  set_gradient_palette_color:['Gradient palette color %1 · %2', [['index','integer',1],['color','string','#313244']]],
  clear_gradient_slot:['Remove gradient %1 %2', [['kind',['stop','focus','palette'],'focus'],['index','integer',1]]],
  set_room_depth_sort: ['Sort entities by depth %1', [['enabled','boolean',true]]],
  set_room_music: ['Set room music to %1', [['sound','text','']]],
  set_room_ambience: ['Set room ambience to %1', [['sound','text','']]],
  set_room_shader: ['Set room shader to %1 at %2% strength', [['shader',shaderPresets,'fog'],['strength','number',55]]],
  reset_room_shader: ['Reset room shader', []],
  give: ['Give %1 × %2', [['item','text','coin'],['count','number',1,'optional']]],
  take: ['Remove %1 × %2', [['item','text','coin'],['count','number',1,'optional']]],
  say: ['Say %1', [['text','text','Hello!']]],
  counter: ['Show counter %1 with value %2', [['label','text','Coins'],['value','number',0]]],
  hide: ['Hide HUD element %1', [['label','text','Coins']]],
  walk: ['Move with D-pad at %1', [['speed', 'number', 4]]],
  flip_sprite_x:['Flip sprite horizontally %1',[['enabled','boolean',true]]],
  flip_sprite_y:['Flip sprite vertically %1',[['enabled','boolean',true]]],
  set_sprite_rotation:['Set sprite rotation to %1°',[['degrees','number',0]]],
  rotate_sprite:['Rotate sprite by %1°',[['degrees','number',90]]],
  set_sprite_shadow:['Set sprite shadow to %1 at %2% opacity',[
    ['placement',['behind','ground','none'],'behind'],['opacity','number',45,'optional'],
  ]],
  set_health_bar:['Show health bar %1 with fill %2 and background %3',[
    ['enabled','boolean',true],['fill','string','#a6e3a1','optional'],['track','string','#313244','optional'],
  ]],
  fire_projectile:['Fire %1 toward %2 at speed %3 with %4 damage',[
    ['projectile','text','spark'],['aim',['facing','position','trajectory','heat_seek'],'facing'],['speed','number',8],['amount','number',1],
  ]],
  jump_force: ['Jump with force %1', [['force','number',240]]],
  jump: ['Jump at speed %1', [['speed', 'number', 8]]],
  damage: ['Deal %1 damage in a %2 × %3 attack box', [['amount', 'number', 1], ['range', 'number', 28], ['height', 'number', 24]]],
  fire: ['Fire %1 at speed %2 with %3 damage', [['aim', ['facing','position','trajectory','heat_seek'], 'facing'], ['speed','number',8], ['amount','number',1]]],
  chase: ['Find path to nearest player at speed %1', [['speed','number',2]]],
  sound: ['Play sound %1', [['sound','text','hit']]],
  stop_sound: ['Stop playing sounds for %1', [['entity','integer',{actor:'id'}]]],
  velocity: ['Set velocity x %1 y %2', [['x','number',0], ['y','number',0]]],
  animate: ['Play animation %1', [['tag','text','idle']]],
  room: ['Go to room %1', [['room','text','yard']]],
  spawn: ['Create instance of %1 at offset X %2 Y %3', [['sprite','text','drone'],['x','number',0,'optional'],['y','number',0,'optional']]],
};
export const messageInputs = {say:'text',ask:'text',counter:'label',bar:'label',hide:'label'};
export const Opcodes = Object.freeze({
  walk:0, jump:1, damage:2, fire:3, chase:4, sound:5, velocity:6, animate:7, room:8, spawn:9, give:18, take:19, say:20, counter:21, hide:22, follow:23, camera:24, release_camera:25, remove_self:26, burst:27, emit:28, stop_fx:29,group_camera:30,checkpoint:31,retry_checkpoint:32,ask:33,give_player:34,take_player:35,count_player:36,bar:37,use_player_item:38,item_icon:39,follow_player:40,set_position:41,jump_force:42,apply_gravity:43,force:44,impulse:45,move_by:46,move_entity:51,entity_velocity:52,damage_entity:53,remove_entity:54,animate_once:55,show_menu:56,show_inventory:57,add_component:58,remove_component:59,set_entity_integer:60,set_entity_real:61,set_entity_boolean:62,set_entity_string:63,use_selected_item:64,set_respawn:65,respawn_when:66,emit_for:67,burst_at:68,flip_sprite_x:69,flip_sprite_y:70,set_sprite_rotation:71,rotate_sprite:72,fire_projectile:73,camera_follow_entity:74,camera_zoom:75,set_room_gravity:76,set_room_background:77,set_room_depth_sort:78,set_room_music:79,set_room_ambience:80,reset_room_camera:81,set_room_shader:82,reset_room_shader:83,emit_event:84,draw_text:85,set_hud_font:86,
  set_sprite_shadow:87,set_health_bar:88,heal_entity:89,push_entity:90,break_entity:91,
  set_display_resolution:92,set_adaptive_display:93,set_default_camera:94,set_minimap:95,set_first_controller:96,
  set_entity_visible:97,assign_entity_player:98,emit_event_with_entity:99,
  set_tile_playback:100,set_tile_frame:101,advance_tile_frame:102,set_tile_friction:103,set_tile_body:104,force_entity:105,
  draw_space:106,fill:107,no_fill:108,stroke:109,no_stroke:110,stroke_width:111,rect:112,ellipse:113,circle:114,line:115,triangle:116,point:117,
  inventory_append:118,inventory_remove:119,inventory_set:120,inventory_create_child:121,inventory_remove_child:122,
  array_append:123,array_set:124,array_remove:125,
  set_room_background_image:127,set_camera_bottom_inset:128,set_room_border:129,
  shader_begin:135,shader_add:136,shader_parameter:137,shader_commit:138,
  set_entity_persistence:139,set_entity_always_active:140,
  clone_entity:141,delete_clone:142,
  reporter:143,
  set_background_gradient:144,set_gradient_axis:145,set_gradient_stop:146,set_gradient_focus:147,
  set_gradient_palette_color:148,clear_gradient_slot:149,set_split_screen:150,
  stop_sound:151,
  draw_hud_sprite:152,
  draw_background_sprite:153,
  set_entity_layer:130,set_entity_team:131,set_entity_max_health:132,set_entity_friction:133,set_emitter:134,
});
export const collectionCommands=['inventory_append','inventory_remove','inventory_set','inventory_create_child','inventory_remove_child','array_append','array_set','array_remove'];
export const collectionQueries=['inventory.length','inventory.type','inventory.has','inventory.get','array.length','array.at'];
export const drawingCommands=['draw_space','fill','no_fill','stroke','no_stroke','stroke_width','rect','ellipse','circle','line','triangle','point'];
export const tileCommands=['set_tile_playback','set_tile_frame','advance_tile_frame','set_tile_friction','set_tile_body'];
export const gameCommands=['set_display_resolution','set_adaptive_display','set_default_camera','set_minimap','set_first_controller','set_split_screen'];
export const gradientCommands=['set_background_gradient','set_gradient_axis','set_gradient_stop','set_gradient_focus','set_gradient_palette_color','clear_gradient_slot'];
export const roomCommands = ['camera_follow_entity','camera_zoom','reset_room_camera','set_room_gravity',
  'set_room_background','set_room_background_image','draw_background_sprite','set_camera_bottom_inset','set_room_border','set_room_depth_sort','set_room_music','set_room_ambience','set_room_shader','reset_room_shader',...gradientCommands];
const instanceCommands=new Set([
  'walk','jump','jump_force','chase','move_by','set_position','velocity','force','impulse','apply_gravity',
  'animate','animate_once','flip_sprite_x','flip_sprite_y','set_sprite_rotation','rotate_sprite',
  'damage','fire','fire_projectile','follow','remove_self','set_sprite_shadow','set_health_bar',
]);
export function commandScopeError(op,{gameScript,roomScript,tileScript}){
  if(gameCommands.includes(op)&&!gameScript)return 'Use '+op+' in the Game script';
  if(tileCommands.includes(op)&&!tileScript)return 'Use '+op+' in a tile script';
  if(roomCommands.includes(op)&&roomScript===false)return 'Use '+op+' in a room script';
  if(gameScript&&gradientCommands.includes(op))return 'Use '+op+' in a Room script';
  if(gameScript&&op==='draw_background_sprite')return 'Use '+op+' in a Room script';
  if(['set_room_shader','reset_room_shader'].includes(op)&&gameScript)
    return 'Room shader commands belong in the Room script. Use Apply display shaders in order for Game postprocessing.';
  if(roomScript&&instanceCommands.has(op))return 'Use '+op+' in an entity or tile script';
  if(op==='delete_clone'&&(roomScript||tileScript))return 'Use Delete this clone in an entity script';
  if(op==='clone_entity'&&tileScript)return 'Create clones in Game, Room, or entity scripts';
}
export const buttons = ['up','down','left','right','a','b','x','menu'];

export const actorReadings = {
  id:'integer',x:'integer',y:'integer',vx:'integer',vy:'integer',health:'integer',
  grounded:'boolean',player:'integer',other:'integer',damage:'integer',other_player:'integer',
  last_spawn:'integer',answer:'integer',item_count:'integer',moving:'boolean',is_player:'boolean',facing:'integer',
  x_real:'real',y_real:'real',vx_real:'real',vy_real:'real',health_real:'real',
  menu_choice:'integer',menu_item:'string',menu_id:'string',used_item:'string',event_sender:'integer',event_entity:'integer',
  last_clone:'integer',clone_source:'integer',is_clone:'boolean',mass:'real',
};
const readingNames=Object.keys(actorReadings);
export const readings=readingNames.filter(name=>['integer','boolean'].includes(actorReadings[name]));
export const realReadings=readingNames.filter(name=>actorReadings[name]==='real');
export const stringReadings=readingNames.filter(name=>actorReadings[name]==='string');

export const entityQueries = {
  find: ['Entity named %1','integer',[['string','enemy']]],
  nearest: ['Nearest entity tagged %1 within %2 px','integer',[['string','enemy'],['number',96]]],
  exists: ['Entity %1 exists?','boolean',[['integer',0]]],
  has: ['Entity %1 has tag %2?','boolean',[['integer',0],['string','enemy']]],
  x: ['X position of entity %1','real',[['integer',0]]],
  y: ['Y position of entity %1','real',[['integer',0]]],
  vx: ['X velocity of entity %1','real',[['integer',0]]],
  vy: ['Y velocity of entity %1','real',[['integer',0]]],
  health: ['Health of entity %1','real',[['integer',0]]],
  integer: ['Entity %1 integer %2','integer',[['integer',0],['string','score']]],
  real: ['Entity %1 real %2','real',[['integer',0],['string','speed']]],
  boolean: ['Entity %1 boolean %2','boolean',[['integer',0],['string','ready']]],
  string: ['Entity %1 string %2','string',[['integer',0],['string','label']]],
  controller_connected: ['Player %1 controller connected?','boolean',[['integer',2]]],
  is_player: ['Entity %1 is a player?','boolean',[['integer',0]]],
  player: ['Player controlling entity %1','integer',[['integer',0]]],
  has_property: ['Entity %1 has property %2?','boolean',[['integer',0],['string','ready']]],
  on_tile_top: ['Entity %1 touches the top of this tile?','boolean',[['integer',0]]],
  is_clone: ['Entity %1 is a clone?','boolean',[['integer',0]]],
  clone_source: ['Source of clone %1','integer',[['integer',0]]],
  mass: ['Mass of entity %1','real',[['integer',0]]],
  touching: ['Touching entity %1?','boolean',[['integer',0]]],
};


export const valueInput=type=>['value','number','integer','real','boolean','string'].includes(type);

const sides=['any','left','right','top','bottom'];
const tileKinds=['any','solid','static','dynamic','kinematic','one_way','breakable','fluid','ladder','sensor','decorative'];
const target=['entity',{actor:'id'}];
// Order is the opcode's selector. Blockly and WaffleScript use the same types and choices.
export const reporters={
  'camera.touching_edge':['camera','%1 reaches %2 edge of viewport?','boolean',[target,[sides,'any']]],
  'camera.on_screen':['camera','%1 overlaps the viewport?','boolean',[target]],
  'camera.touching_room_edge':['world','%1 reaches %2 edge of room?','boolean',[target,[sides,'any']]],
  'camera.left':['camera','Viewport left X','integer',[]],
  'camera.top':['camera','Viewport top Y','integer',[]],
  'camera.right':['camera','Viewport right X','integer',[]],
  'camera.bottom':['camera','Viewport bottom Y','integer',[]],
  'camera.width':['camera','Viewport width','integer',[]],
  'camera.height':['camera','Viewport height','integer',[]],
  'tile.touching':['tile','%1 touches tile %2 on %3?','boolean',[target,['tile',''],[sides,'any']]],
  'tile.touching_kind':['tile','%1 touches %2 tiles on %3?','boolean',[target,[tileKinds,'solid'],[sides,'any']]],
  'string.join':['text','Join %1 and %2','string',[['string','Hello '],['string','world']]],
  'string.length':['text','Length of %1','integer',[['string','Hello']]],
  'string.letter':['text','Letter %2 of %1','string',[['string','Hello'],['integer',1]]],
  'string.slice':['text','Letters %2 through %3 of %1','string',[['string','Hello'],['integer',1],['integer',3]]],
  'string.contains':['text','%1 contains %2?','boolean',[['string','Hello'],['string','ell']]],
  'string.index_of':['text','Position of %2 in %1','integer',[['string','Hello'],['string','lo']]],
  'string.upper':['text','Uppercase %1','string',[['string','Hello']]],
  'string.lower':['text','Lowercase %1','string',[['string','Hello']]],
  'string.trim':['text','Trim spaces from %1','string',[['string',' Hello ']]],
  'string.replace':['text','In %1 replace %2 with %3','string',[['string','Hello'],['string','ell'],['string','i']]],
  'string.from_integer':['text','Integer %1 as text','string',[['integer',42]]],
  'string.from_real':['text','Real %1 as text','string',[['real',{real:0.5}]]],
  'math.mod':['operators','%1 modulo %2','numeric',[['numeric',-5],['numeric',3]]],
  'math.clamp':['operators','Clamp %1 from %2 to %3','numeric',[['numeric',7],['numeric',0],['numeric',10]]],
  'math.lerp':['operators','Interpolate %1 to %2 by %3','real',[['real',{real:0}],['real',{real:10}],['real',{real:.5}]]],
  'math.hypot':['operators','Hypotenuse of %1 and %2','real',[['real',{real:3}],['real',{real:4}]]],
  'math.random_integer':['operators','Random integer from %1 to %2','integer',[['integer',1],['integer',10]]],
  'math.random_real':['operators','Random real from %1 to %2','real',[['real',{real:0}],['real',{real:1}]]],
  'text.lookup':['text','Look up text for %1','string',[['string','greeting']]],
  'physics.gravity':['motion','Room gravity','real',[]],
  'math.random_chance':['operators','%1% chance?','boolean',[['real',{real:50}]]],
  'math.random_sign':['operators','Random sign (−1 or 1)','integer',[]],
};
