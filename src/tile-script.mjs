import {initialPropertyRows} from './init-properties.mjs';

export const tileScriptPath=(id,variant)=>`scripts/tiles/${id}/${variant}.cbor`;

export const tileStartsAnimated=tile=>Boolean(tile.tag?.includes(':animated:')||tile.tag?.includes(':fluid:'));

export function initialTileScript(tile){
  const animated=tileStartsAnimated(tile);
  const body=initialPropertyRows(tile,true);
  if(animated)body.push({op:'set_tile_playback',mode:'loop'});
  return {events:{init:[{op:'init_properties',body}]}};
}
