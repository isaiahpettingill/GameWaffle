import {platformGravity, roomBorder} from './schema.mjs';

export const roomScriptPath=id=>`scripts/rooms/${id}.cbor`;

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
  if(settings.shader?.kind&&settings.shader.kind!=='none')start.push({op:'set_room_shader',shader:settings.shader.kind,strength:settings.shader.strength??35});
  if(settings.groupCamera===true)start.push({op:'group_camera'});
  else if(settings.groupCamera===false)start.push({op:'follow_player',player:1});
  return {events:{init:start}};
}
