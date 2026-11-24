import {assetGroups,assetKinds,tagList,tileAssetTitle} from './asset-types.mjs';
import {projectBasename,resourceName} from './resource-name.mjs';
import {initialTileScript,tileScriptPath,tileStartsAnimated} from './tile-script.mjs';
import {encodeCbor} from './cartridge.mjs';
import {inspectBitfont,previewRoomArt,previewTiles} from './compiler.mjs';
import {readAseprite} from './ase.mjs';
import {normalizeCoverCrop} from './cover.mjs';

const safeName=/^[^\\/\x00-\x1f]+\.[a-z0-9]+$/i;
const stem=filename=>filename.replace(/\.[^.]+$/,'');

export async function prepareAssetUpload(project, store, upload) {
  const {kind,filename,data}=upload;
  if(typeof filename!=='string'||!safeName.test(filename)||!assetKinds(filename).includes(kind))
    throw Error('Choose an asset type that matches the file');
  if(!(data instanceof Uint8Array)||!data.length)throw Error('Choose a file to upload');
  const limit=kind==='soundfont'?64:kind==='shader'?0.5:32;
  if(data.length>limit*1024*1024)throw Error('The selected file exceeds '+limit+' MiB');
  const title=typeof upload.name==='string'?upload.name.trim():'';
  if(!title||title.length>100)throw Error('Enter an asset name of up to 100 characters');
  const files=new Set((await store.list('assets').catch(error=>{
    if(error.code==='ENOENT')return [];
    throw error;
  })).map(path=>path.toLowerCase()));
  const ext=filename.slice(filename.lastIndexOf('.')).toLowerCase();
  const prefix='assets/'+assetGroups[kind]+'/'+projectBasename(title||stem(filename));
  let path=prefix+ext;
  for(let suffix=2;files.has(path.toLowerCase());suffix++)path=prefix+'-'+suffix+ext;
  const pending=new Map([[path,Buffer.from(data)]]);
  const read=(file,encoding)=>{
    const bytes=pending.get(file);
    return bytes?Promise.resolve(encoding?bytes.toString(encoding):bytes):store.read(file,encoding);
  };
  project.assetInfo??={};
  project.assetInfo[path]={kind,name:title,tags:tagList(upload.tags)};

  if(kind==='sprite'){
    const sprites=project.sprites??={};
    sprites[resourceName(title,'sprite',[sprites])]={title,source:path,physics:{},gravityMode:'room'};
  }else if(kind==='tile'){
    const tiles=project.tiles??={}, prefix=resourceName(title,'tiles',[tiles]).slice(0,34);
    const names=/\.png$/i.test(filename)?[]:readAseprite(pending.get(path)).tags.map(tag=>tag.name);
    const imports=Object.create(null);
    for(const [index,tag] of (names.length?names:['']).entries()){
      const key=tag?prefix+'_'+resourceName(tag.split(':')[0],'tile_'+(index+1)).slice(0,23):prefix;
      let id=key;
      for(let suffix=2;Object.hasOwn(tiles,id);suffix++)id=key+'_'+suffix;
      tiles[id]=imports[id]={source:path,title:tileAssetTitle(title,tag),setPrefix:prefix,tag,physics:{mode:upload.tileCollision===false?'none':'static'}};
      if(tag.includes(':fluid:')&&upload.tileCollision!==false)tiles[id].physics={};
    }
    const variants=await previewTiles(imports,project.tileSize??24,read);
    for(const [id,config] of Object.entries(imports))if(tileStartsAnimated(config)){
      const unit=encodeCbor(initialTileScript(config));
      for(let index=0;index<variants[id].variants.length;index++)pending.set(tileScriptPath(id,index),unit);
    }
  }else if(kind==='font'){
    const fonts=project.bitfonts??={};
    const config={name:title,source:path,...(ext==='.png'?{
      glyphWidth:upload.font?.glyphWidth,glyphHeight:upload.font?.glyphHeight,assignments:upload.font?.assignments,
    }:{})};
    await inspectBitfont(config,read);
    fonts[resourceName(title,'bitfont',[fonts,{builtin:true,legacy:true}])]=config;
  }else if(kind==='sound'||kind==='music'){
    const audio=project.audio??={};
    const config={source:path,title};
    if(/\.midi?$/i.test(filename)){
      if(typeof upload.soundFont!=='string'||!/^assets\/.+\.sf2$/i.test(upload.soundFont)||!files.has(upload.soundFont.toLowerCase()))
        throw Error('Choose an imported SoundFont for this MIDI track');
      config.soundFont=upload.soundFont;
    }else if(ext==='.wav')config.compress=upload.compress!==false;
    audio[resourceName(title,'sound',[audio])]=config;
  }else if(kind==='shader'){
    const shaders=project.shaders??={};
    shaders[resourceName(title,'shader',[shaders])]={source:path,title};
  }else if(kind==='cover'){
    project.coverImage=path;
    project.coverCrop=normalizeCoverCrop(upload.coverCrop);
  }
  if(['source','cover','background'].includes(kind))await previewRoomArt(path,read);
  pending.set('project.json',Buffer.from(JSON.stringify(project,null,2)+'\n'));
  return {path, pending, sourceStore:{...store,read}};
}
