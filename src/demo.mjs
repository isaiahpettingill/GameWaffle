import { writeFile, mkdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { encodeCbor } from './cartridge.mjs';

const w = 24;
function chunk(type, data) {
  const header = Buffer.alloc(6);
  header.writeUInt32LE(data.length+6);
  header.writeUInt16LE(type,4);
  return Buffer.concat([header,data]);
}
function str(value) {
  const text = Buffer.from(value);
  const size = Buffer.alloc(2);
  size.writeUInt16LE(text.length);
  return Buffer.concat([size,text]);
}
function art(draw, n) {
  const data = Buffer.alloc(w*w*4);
  const rect = (x,y,width,height,hex) => {
    const rgb = Buffer.from(hex, 'hex');
    for (let row = y; row < y+height; row++) for (let col = x; col < x+width; col++) {
      if (col < 0 || col >= w || row < 0 || row >= w) continue;
      const offset = (row*w+col)*4;
      rgb.copy(data, offset);
      data[offset+3] = 255;
    }
  };
  draw(rect,n);
  return data;
}
function ase(draw, count, definitions) {
  const layer = Buffer.alloc(16);
  layer.writeUInt16LE(1,0);
  layer[12]=255;
  const tagHeader = Buffer.alloc(10);
  tagHeader.writeUInt16LE(definitions.length);
  const tags = definitions.map(([name,from,to,direction=0]) => {
    const b = Buffer.alloc(17);
    b.writeUInt16LE(from);
    b.writeUInt16LE(to,2);
    b[4] = direction;
    return Buffer.concat([b,str(name)]);
  });
  const all = Array.from({length:count},(_,index) => {
    const cel = Buffer.alloc(20);
    cel[6] = 255;
    cel.writeUInt16LE(2,7);
    cel.writeUInt16LE(w,16);
    cel.writeUInt16LE(w,18);
    const chunks = [chunk(0x2005, Buffer.concat([cel, deflateSync(art(draw,index))]))];
    if (!index) chunks.unshift(chunk(0x2004,Buffer.concat([layer,str('Art')])),chunk(0x2018,Buffer.concat([tagHeader,...tags])));
    const header = Buffer.alloc(16);
    header.writeUInt32LE(16+chunks.reduce((sum,b)=>sum+b.length,0));
    header.writeUInt16LE(0xf1fa,4);
    header.writeUInt16LE(chunks.length,6);
    header.writeUInt16LE(150,8);
    return Buffer.concat([header,...chunks]);
  });
  const header = Buffer.alloc(128);
  header.writeUInt32LE(128+all.reduce((sum,b)=>sum+b.length,0));
  header.writeUInt16LE(0xa5e0,4);
  header.writeUInt16LE(count,6);
  header.writeUInt16LE(w,8);
  header.writeUInt16LE(w,10);
  header.writeUInt16LE(32,12);
  header.writeUInt32LE(1,14);
  header[34]=1;
  header[35]=1;
  return Buffer.concat([header,...all]);
}
const colors = ['ffc875','92dac4','bda6ed','ee9e9f'];
const names = ['maker','runner','scout','pilot'];
const assets = {};
for (const [index,name] of names.entries()) assets[name] = ase((r,n)=>{
  const shift = n ? 1 : 0;
  r(5,3+shift,14,18-shift,'18162b');
  r(6,4+shift,12,15-shift,colors[index]);
  r(8,6+shift,8,6,'f4edd2');
  r(13,7+shift,2,3,'18162b');
  r(5,12,14,4,'765673');
  r(7,19,4,4,'30263f');
  r(14,19,4,4,'30263f');
},2,[['idle',0,1,2]]);
assets.stone = ase((r,n)=>{
  r(0,0,24,24,'34314c'); r(0,0,24,3,'79718e'); r(0,4,24,2,'5f567b');
  r(2+n*6,9,10,2,'494361'); r(13-n*6,17,8,2,'55506d'); r(0,22,24,2,'29283d');
},2,[['Basalt',0,1]]);
assets.crate = ase((r)=>{
  r(0,0,24,24,'503048'); r(2,2,20,20,'9b5b53'); r(4,4,16,16,'6f4254');
  r(4,5,12,2,'b37762'); r(5,11,14,2,'a87569'); r(6,17,11,2,'97565b');
},1,[['Crate',0,0]]);
assets.ladder = ase((r)=>{
  r(4,0,3,24,'bd9267');r(17,0,3,24,'bd9267');
  for (let y=3;y<24;y+=6) r(7,y,10,2,'deb781');
},1,[['Ladder',0,0]]);
assets.ledge = ase((r)=>{
  r(0,0,24,4,'9ec5ac');r(0,4,24,3,'567c80');
},1,[['Ledge:mirror-x:',0,0]]);
assets.water = ase((r,n)=>{
  r(0,6,24,18,'294b69');
  for(let x=-3;x<24;x+=8) r(x+n*2,5,5,2,'64aaa9');
  r(3+n*3,14,7,1,'447a94');
},3,[['Pool:animated::fluid:',0,2,2]]);
assets.drone = ase((r,n)=>{
  const shift=n%2;
  r(4,8+shift,16,11,'6d435f');r(3,7+shift,18,8,'a16b8c');
  r(7,8+shift,10,5,'31273e');r(9,9+shift,6,2,'f2a678');
  r(1,16,4,2,'c7a6ca');r(19,16,4,2,'c7a6ca');
},2,[['idle',0,1,2]]);
assets.spark = ase((r)=>{r(9,9,6,6,'ffca72');r(11,10,4,4,'fff3bb');},1,[['idle',0,0]]);

function wave(seconds, sample) {
  const rate = 24000, count = Math.floor(rate*seconds);
  const out = Buffer.alloc(44+count*2);
  out.write('RIFF',0);out.writeUInt32LE(out.length-8,4);out.write('WAVEfmt ',8);
  out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);
  out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*2,28);
  out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(count*2,40);
  for(let i=0;i<count;i++) out.writeInt16LE(Math.round(sample(i/rate)*30000),44+i*2);
  return out;
}
for(const dir of ['sprites','tiles','audio'])await mkdir('demo/assets/'+dir,{recursive:true});
await mkdir('demo/scripts/sprites',{recursive:true});
for (const [name,bytes] of Object.entries(assets)) await writeFile(`demo/assets/${['stone','crate','ledge','ladder','water'].includes(name)?'tiles':'sprites'}/${name}.aseprite`,bytes);
const tone = (t,f) => Math.sin(t*f*2*Math.PI);
await writeFile('demo/assets/audio/hit.wav',wave(.17,t=>.32*tone(t,160+500*t)*Math.exp(-28*t)));
await writeFile('demo/assets/audio/music.wav',wave(8,t=>{
  const f=[110,130.81,146.83,164.81,130.81,110,98,110][Math.floor(t)%8];
  const env = Math.sin(Math.PI*(t%1))**2;
  return env*(.095*tone(t,f)+.045*tone(t,f*2)+.025*tone(t,f*3));
}));
const sprites = Object.fromEntries(names.map(name=>[name,{
  source:`assets/sprites/${name}.aseprite`,script:`scripts/sprites/${name}.cbor`,animation:'idle',team:1,layer:4,
  width:20,height:23,projectile:'spark',physics:{mode:'dynamic',density:1,friction:.15,group:-1,health:7},
}]));
sprites.drone={source:'assets/sprites/drone.aseprite',script:'scripts/sprites/drone.cbor',animation:'idle',team:2,layer:4,
  width:20,height:20,physics:{mode:'dynamic',gravity:0,health:5,elasticity:.4}};
sprites.spark={source:'assets/sprites/spark.aseprite',width:8,height:8,physics:{mode:'none'}};
const playerCode = {events:{
  tick:[
    {op:'walk',speed:5.25},
    {op:'if',condition:{pressed:'a'},body:[{op:'jump',speed:9}]},
    {op:'if',condition:{pressed:'b'},body:[{op:'damage',amount:2,range:36,height:27},{op:'sound',sound:'hit'}]},
    {op:'if',condition:{pressed:'x'},body:[{op:'fire',aim:'heat_seek',speed:13,amount:2}]},
    {op:'if',condition:{pressed:'menu'},body:[{op:'room',room:'vault'}]},
  ],
}};
for (const name of names) await writeFile(`demo/scripts/sprites/${name}.cbor`,encodeCbor(playerCode));
await writeFile('demo/scripts/sprites/drone.cbor',encodeCbor({events:{
  tick:[{op:'chase',speed:1.8}],damage:[{op:'sound',sound:'hit'}],
}}));
const floor = Array.from({length:28},(_,x)=>[x,14,'stone']);
const playerSpawns = names.map((sprite,player)=>({sprite,player,x:62+player*30,y:311}));
const room = (title,background,obstacles,droneX)=>({
  title,background,cols:28,rows:15,music:'music',
  entities:[...playerSpawns,{sprite:'drone',x:droneX,y:230}],
  layers:[
    {name:'Scenery',order:0,collidable:false,cells:[[9,13,'water'],[10,13,'water'],[11,13,'water']]},
    {name:'Terrain',order:2,collidable:true,cells:[...floor,...obstacles]},
  ],
});
const courtyard = {
  title:'Top-down Courtyard', view:'top_down', background:'#252838', cols:22, rows:15, music:'music',
  entities:[
    ...names.map((sprite,player)=>({sprite,player,x:84+player*32,y:260})),
    {sprite:'drone',x:420,y:100},
  ],
  layers:[
    {name:'Ground',order:0,collidable:false,cells:[[8,5,'water'],[9,5,'water'],[8,6,'water'],[9,6,'water']]},
    {name:'Walls',order:2,collidable:true,cells:[
      ...Array.from({length:7},(_,i)=>[7+i,8,'stone']),
      [7,7,'stone'],[13,7,'stone'],[13,6,'stone'],[5,6,'crate'],[11,10,'crate'],[15,7,'crate'],
    ]},
  ],
};
const project={
  name:'Basalt Works',start:'yard',tileSize:24,sprites,
  tiles:Object.fromEntries(Object.entries({stone:'static',crate:'breakable',ladder:'ladder',ledge:'one_way',water:'fluid'})
    .map(([name,mode])=>[name,{source:`assets/tiles/${name}.aseprite`,physics:{mode}}])),
  audio:{hit:'assets/audio/hit.wav',music:'assets/audio/music.wav'},
  rooms:{
    yard:room('Foundry Yard','#171829',[[13,13,'crate'],[14,13,'crate'],[14,12,'crate'],[17,13,'ladder'],[17,12,'ladder'],
      [17,11,'ladder'],[17,10,'ladder'],[18,10,'ledge'],[19,10,'ledge'],[20,10,'ledge'],[23,13,'water'],[24,13,'water'],[25,13,'water']],532),
    courtyard,
    vault:room('Cooling Vault','#14252c',[[8,13,'crate'],[11,12,'ledge'],[12,12,'ledge'],[15,12,'stone'],[15,13,'stone'],
      [18,13,'water'],[19,13,'water'],[20,13,'water'],[23,13,'ladder'],[23,12,'ladder'],[24,11,'ledge']],587),
  },
};
const fixed=(target)=>({mode:'fixed',targets:[target],adjacent:true});
project.rooms.yard.exits={right:fixed('vault')};
project.rooms.vault.exits={left:fixed('yard')};
project.rooms.courtyard.exits={right:{mode:'save',targets:['yard','vault']}};
project.rooms.vault.exits.right={mode:'fixed',targets:['courtyard']};
project.flags={found_key:false};
const {PNG}=await import('pngjs');
const keyArt=new PNG({width:24,height:24});
for(let y=6;y<18;y++)for(let x=5;x<20;x++){
  if(!(x<12 && (x<=6||x>=10||y<8||y>15) || y===10 || y===11 || x>=16 && x%2===0 && y>11 && y<15))continue;
  keyArt.data.set([251,206,107,255],4*(24*y+x));
}
await writeFile('demo/assets/sprites/key.png',PNG.sync.write(keyArt));
project.sprites.key={source:'assets/sprites/key.png',script:'scripts/sprites/key.cbor',physics:{mode:'sensor'}};
project.rooms.courtyard.entities.push({sprite:'key',x:84,y:220,flag:'found_key',when:false});
await writeFile('demo/scripts/sprites/key.cbor',encodeCbor({events:{begin_contact:[
  {op:'if',condition:{calc:'not',left:{scope:'flag',get:'found_key'}},body:[
    {op:'burst',effect:'sparks',count:24},{op:'give',item:'key',count:1},{op:'set',scope:'flag',name:'found_key',value:true},
    {op:'counter',label:'Keys',value:{item:'key'}},{op:'say',text:'You found the courtyard key!'},{op:'remove_self'}
  ]}
]}}));
project.items={key:{icon:'assets/sprites/key.png'},pump_key:{icon:'assets/sprites/key.png'}};
project.sprites.guardian={...sprites.drone,script:'scripts/sprites/guardian.ws',width:36,height:36,alwaysActive:true,physics:{...sprites.drone.physics,health:12}};
project.rooms.arena=room('Pump Hall','#182b31',[],360);
project.rooms.arena.groupCamera=true;
project.rooms.arena.entities=[...playerSpawns.slice(0,2),{name:'Pump guardian',sprite:'guardian',persistRemoval:true,x:330,y:288}];
project.rooms.courtyard.exits.left={mode:'fixed',targets:['arena']};
project.rooms.arena.exits={left:{mode:'fixed',targets:['courtyard']}};
await writeFile('demo/scripts/sprites/guardian.ws',`on tick
  chase(1)
  bar("Guardian", actor.health, 12)
end

on damage
  if actor.health <= 0
    give_player("pump_key", actor.other_player, 1)
    flag.guardian_defeated = true
    hide("Guardian")
    burst("sparks", 32)
  end
end
`);
await writeFile('demo/project.json',JSON.stringify(project,null,2)+'\n');
