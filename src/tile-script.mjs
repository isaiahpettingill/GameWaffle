export const tileScriptPath=(id,variant)=>`scripts/tiles/${id}/${variant}.cbor`;

export const tileStartsAnimated=tile=>Boolean(tile.tag?.includes(':animated:')||tile.tag?.includes(':fluid:'));

export function initialTileScript(tile){
  const animated=tileStartsAnimated(tile);
  return {events:{init:[{op:'init_properties',body:animated?[{op:'set_tile_playback',mode:'loop'}]:[]}]}};
}
