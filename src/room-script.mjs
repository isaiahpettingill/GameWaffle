import {platformGravity, roomBorder} from './schema.mjs';
import {shaderPresets} from './shader-presets.mjs';

export const roomScriptPath=id=>`scripts/rooms/${id}.cbor`;
export const roomSettingKeys=['cameraZoom','cameraBottomInset','border','closedEdges','gravity','background',
  'backgroundImage','backgroundParallax','ySort','music','ambience','shader','groupCamera'];

export function changeRoomView(unit,from,to){
  const before=initialRoomScript({view:from}).events.init;
  const after=initialRoomScript({view:to}).events.init;
  const changes=new Map();
  const init=unit.events?.init??[];
  for(const op of ['set_room_gravity','set_room_border','set_room_depth_sort']){
    const previous=before.find(block=>block.op===op);
    const replacement=after.find(block=>block.op===op);
    const index=init.findLastIndex(block=>block.op===op);
    const operand=Object.keys(previous).find(key=>key!=='op');
    if(index>=0&&init[index][operand]===previous[operand])changes.set(index,replacement);
  }
  return changes;
}

export function initialRoomScript(room,defaults={}){
  const settings={...defaults,...room};
  const topDown=room.view==='top_down';
  const start=[
    {op:'camera_zoom',zoom:settings.cameraZoom??1},
    {op:'set_camera_bottom_inset',tiles:settings.cameraBottomInset??0},
    {op:'set_room_border',border:roomBorder(settings,topDown)},
    {op:'set_room_gravity',gravity:room.gravity??(topDown?0:settings.gravity??platformGravity)},
    {op:'set_room_background',color:settings.background??'#101a23'},
    {op:'set_room_background_image',image:settings.backgroundImage??'',scroll:settings.backgroundParallax??1},
    {op:'set_room_depth_sort',enabled:settings.ySort??topDown},
    {op:'set_room_music',sound:settings.music??''},
    {op:'set_room_ambience',sound:settings.ambience??''},
  ];
  if(settings.shader?.kind&&settings.shader.kind!=='none'){
    const shader=settings.shader, parameters={};
    const exposed=shaderPresets['preset:'+shader.kind]?.parameters??[];
    for(const [key,value] of [['strength',shader.strength],['spacing',shader.spacing??shader.wavelength],['speed',shader.speed],['radius',shader.radius]])
      if(value!=null&&exposed.some(parameter=>parameter.name===key))parameters[key]=[value];
    if(exposed.some(parameter=>parameter.name==='tint')&&/^#[a-f0-9]{6}$/i.test(shader.color??''))parameters.tint=[1,3,5].map(i=>({real:Number.parseInt(shader.color.slice(i,i+2),16)/255}));
    start.push({op:'apply_shaders',passes:[{shader:'preset:'+shader.kind,parameters}]});
  }
  if(settings.groupCamera===true)start.push({op:'group_camera'});
  else if(settings.groupCamera===false)start.push({op:'follow_player',player:1});
  return {events:{init:start}};
}
