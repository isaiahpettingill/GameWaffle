export const assetLabels={
  sprite:'Sprites',tile:'Tilesets',font:'Bitfonts',background:'Backgrounds',cover:'Cover art',
  sound:'Sounds',music:'Music',soundfont:'SoundFonts',shader:'Shaders',source:'Source images',
};

export const editableArtFile = /\.(ase|aseprite)$/i;

export function assetKinds(filename){
  if(/\.(ase|aseprite|png)$/i.test(filename))return ['sprite','tile','font','background','cover','source'];
  if(/\.yaff$/i.test(filename))return ['font'];
  if(/\.(mid|midi)$/i.test(filename))return ['music'];
  if(/\.sf2$/i.test(filename))return ['soundfont'];
  if(/\.(wav|ogg|oga|qoa|opus)$/i.test(filename))return ['sound','music'];
  if(/\.(spv|spirv)$/i.test(filename))return ['shader'];
  return [];
}

export const assetGroups={
  sprite:'sprites',tile:'tiles',font:'fonts',background:'backgrounds',cover:'covers',
  sound:'audio',music:'audio',soundfont:'audio',shader:'shaders',source:'images',
};

export function tagList(tags) {
  return [...new Set((Array.isArray(tags)?tags:[]).map(tag=>String(tag).trim().slice(0,35)).filter(Boolean))].slice(0,16);
}

export function tileAssetTitle(name,tag) {
  const label=tag?.split(':')[0].trim();
  return label?name+' · '+label:name;
}

const base = path => path.split('/').at(-1).replace(/\.[^.]+$/,'');
const source = value => typeof value==='string'?value:value.source;

export function assetCatalog(project, files) {
  const refs=new Map();
  function link(kind, group, names){
    for(const [id,value] of Object.entries(group??{})){
      const path=source(value);
      if(!path)continue;
      let linked=refs.get(path);
      if(!linked)refs.set(path,linked=[]);
      linked.push({kind,id,label:names(value)??id});
    }
  }
  link('tile',project.tiles,value=>value.tag||value.title);
  link('sprite',project.sprites,value=>value.title);
  link('font',project.bitfonts,value=>value.name);
  link('sound',project.audio,value=>value.title);
  link('shader',project.shaders,value=>value.title);
  return files.map(path=>{
    const metadata=project.assetInfo?.[path], linked=refs.get(path)??[];
    const folder=path.split('/')[1];
    const fallback=assetKinds(path)[0]??'source';
    const kind=metadata?.kind??(/^assets\/audio\/.*\.(midi?|sf2)$/i.test(path)?fallback:
      linked[0]?.kind??Object.keys(assetGroups).find(kind=>assetGroups[kind]===folder)??fallback);
    return {path,kind,name:metadata?.name??linked.find(item=>item.kind===kind&&kind!=='tile')?.label??base(path),
      tags:tagList(metadata?.tags),linked};
  }).sort((a,b)=>(assetLabels[a.kind]??a.kind).localeCompare(assetLabels[b.kind]??b.kind)||a.name.localeCompare(b.name));
}
