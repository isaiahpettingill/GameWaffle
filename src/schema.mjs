export const effects=['sparks','dust','smoke','flame','bubbles','rain','snow'];
export const platformGravity = 16;
export const roomBorder = (room, topDown) => room.border ?? (room.closedEdges == null ? (topDown ? 'closed' : 'sides') : room.closedEdges ? 'closed' : 'open');
export const Events = ['start','use_item', 'restored', 'tick', 'a', 'b', 'x', 'menu', 'begin_contact', 'end_contact', 'damage', 'destroy'];
export const inputEvent=name=>/^(pressed|released)\.[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name);
export const Blocks = {
  follow_player:['Follow player %1',[['player','number',1]]],
  set_position:['Set position X %1 Y %2',[['x','number',0],['y','number',0]]],
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
  give_player:['Give %1 to player %2 count %3',[['item','text','coin'],['player','number',1],['count','number',1]]],
  take_player:['Take %1 from player %2 count %3',[['item','text','coin'],['player','number',1],['count','number',1]]],
  count_player:['Read %1 count for player %2',[['item','text','coin'],['player','number',1]]],
  group_camera:['Follow all players',[]],
  follow: ['Follow this instance', []],
  camera: ['Point camera at X %1 Y %2', [['x','number',0],['y','number',0]]],
  release_camera: ['Follow player 1', []],
  give: ['Give %1 × %2', [['item','text','coin'],['count','number',1]]],
  take: ['Remove %1 × %2', [['item','text','coin'],['count','number',1]]],
  say: ['Say %1', [['text','text','Hello!']]],
  counter: ['Show counter %1 with value %2', [['label','text','Coins'],['value','number',0]]],
  hide: ['Hide counter %1', [['label','text','Coins']]],
  walk: ['Move with D-pad at %1', [['speed', 'number', 4]]],
  jump: ['Jump at %1', [['speed', 'number', 8]]],
  damage: ['Deal %1 damage in a %2 × %3 attack box', [['amount', 'number', 1], ['range', 'number', 28], ['height', 'number', 24]]],
  fire: ['Fire %1 at speed %2 with %3 damage', [['aim', ['facing','position','trajectory','heat_seek'], 'facing'], ['speed','number',8], ['amount','number',1]]],
  chase: ['Find path to nearest player at speed %1', [['speed','number',2]]],
  sound: ['Play sound %1', [['sound','text','hit']]],
  velocity: ['Set velocity x %1 y %2', [['x','number',0], ['y','number',0]]],
  animate: ['Play animation %1', [['tag','text','idle']]],
  room: ['Go to room %1', [['room','text','yard']]],
  spawn: ['Create instance of %1 at offset X %2 Y %3', [['sprite','text','drone'],['x','number',0],['y','number',0]]],
};
export const Opcodes = Object.freeze({
  walk:0, jump:1, damage:2, fire:3, chase:4, sound:5, velocity:6, animate:7, room:8, spawn:9, give:18, take:19, say:20, counter:21, hide:22, follow:23, camera:24, release_camera:25, remove_self:26, burst:27, emit:28, stop_fx:29,group_camera:30,checkpoint:31,retry_checkpoint:32,ask:33,give_player:34,take_player:35,count_player:36,bar:37,use_player_item:38,item_icon:39,follow_player:40,set_position:41,
});
export const buttons = ['up','down','left','right','a','b','x','menu'];

export const readings=['id','x','y','vx','vy','health','grounded','player','other','damage','other_player','last_spawn','answer','item_count'];
