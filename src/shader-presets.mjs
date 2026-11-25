// The offsets match the std140 block in shaders/presets.frag.
import {roomShaders} from './room-shaders.mjs';
const scalar=(name,offset,defaults)=>({name,offset,kind:'float',lanes:1,defaults:[defaults]});
const vector=(name,offset,defaults)=>({name,offset,kind:'float',lanes:defaults.length,defaults});
const automatic=[
  {name:'resolution',offset:0,kind:'float',lanes:2,automatic:'resolution'},
  {name:'time',offset:8,kind:'float',lanes:1,automatic:'time'},
  {name:'delta_time',offset:12,kind:'float',lanes:1,automatic:'delta_time'},
  {name:'room_origin',offset:48,kind:'float',lanes:2,automatic:'room_origin',hidden:true},
  {name:'room_resolution',offset:56,kind:'float',lanes:2,automatic:'room_resolution',hidden:true},
];
const presets=[
  ['tint',35,[0,0,0]], ['scanlines',35,[0,0,0],3], ['grid',35,[0,0,0],3],
  ['vignette',35,[0,0,0],null,null,55], ['ripple',35,null,32,1],
  ['fog',55,[0.77,0.83,0.89],null,1], ['volumetric',55,[1,0.88,0.66]],
  ['lens_flare',55,[1,0.84,0.69]], ['snow',55,[0.93,0.96,1],null,1],
  ['rain',55,[0.64,0.82,1],null,1], ['wind',55,[0.89,0.91,0.96],null,1], ['hd',35,null],
];
export const shaderPresets=Object.fromEntries(presets.map(([id,strength,tint,spacing,speed,radius],index)=>[
  'preset:'+id,{
    title:roomShaders[id],uniformSize:64,
    parameters:[
      ...automatic,{name:'preset',offset:16,kind:'int',lanes:1,defaults:[index],hidden:true},
      scalar('strength',20,strength),
      ...(spacing==null?[]:[scalar('spacing',24,spacing)]),
      ...(speed==null?[]:[scalar('speed',28,speed)]),
      ...(tint? [vector('tint',32,tint)]:[]),
      ...(radius==null?[]:[scalar('radius',44,radius)]),
    ],
  },
]));
