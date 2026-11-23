export const Events = ['start', 'tick', 'a', 'b', 'x', 'menu', 'begin_contact', 'end_contact', 'damage', 'destroy'];
export const Blocks = {
  walk: ['Move with D-pad at %1', [['speed', 'number', 4]]],
  jump: ['Jump at %1', [['speed', 'number', 8]]],
  damage: ['Deal %1 damage in a %2 × %3 attack box', [['amount', 'number', 1], ['range', 'number', 28], ['height', 'number', 24]]],
  fire: ['Fire %1 at speed %2 with %3 damage', [['aim', ['facing','position','trajectory','heat_seek'], 'facing'], ['speed','number',8], ['amount','number',1]]],
  chase: ['Find path to nearest player at speed %1', [['speed','number',2]]],
  sound: ['Play sound %1', [['sound','text','hit']]],
  velocity: ['Set velocity x %1 y %2', [['x','number',0], ['y','number',0]]],
  animate: ['Play animation %1', [['tag','text','idle']]],
  room: ['Go to room %1', [['room','text','yard']]],
  spawn: ['Add instance of %1 at offset X %2 Y %3', [['sprite','text','drone'],['x','number',0],['y','number',0]]],
};
export const Opcodes = Object.freeze({
  walk:0, jump:1, damage:2, fire:3, chase:4, sound:5, velocity:6, animate:7, room:8, spawn:9,
});
export const buttons = ['up','down','left','right','a','b','x','menu'];
