import {decodeCbor} from './cartridge.mjs';
import {parseScript} from './wafflescript.mjs';

export const gameScriptPath='scripts/game.cbor';

export function initialGameScript(project,{examples=false}={}){
  const camera=project.camera??{};
  const display=camera.resolution
    ? {op:'set_display_resolution',width:camera.resolution[0],height:camera.resolution[1]}
    : {op:'set_adaptive_display',min_width:camera.min_width??128,min_height:camera.min_height??128,
      max_width:camera.max_width??512,max_height:camera.max_height??512,zoom:camera.zoom??2};
  const startup=[display,{op:'set_default_camera',target:camera.groupCamera?'group':'player'},
    {op:'set_minimap',mode:project.minimap??'off'},{op:'set_first_controller',player:2}];
  return {
    events:{init:[],game_startup:startup},
    declarations:{globals:{...(examples?{score:0}:{}),...project.variables},
      flags:{...(examples?{level_complete:false}:{}),...project.flags},
      events:{...(examples?{level_finished:'Level finished'}:{}),...project.events}},
    ...(examples?{
      constants:{starting_lives:3},
      collections:{types:{item:{amount:{type:'integer',default:1}}},inventories:{backpack:['item']},arrays:{scores:'integer'}},
    }:{}),
  };
}

export async function readGameScript(project,read){
  const path=project.gameScript??gameScriptPath;
  const data=await read(path).catch(error=>{if(error.code!=='ENOENT')throw error;});
  if(!data)return null;
  if(!path.endsWith('.ws'))return decodeCbor(data);
  const source=data.toString();
  return {...parseScript(source),source};
}
