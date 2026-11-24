import {generateKeyPairSync,sign,createPrivateKey,createPublicKey} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {deflateSync} from 'fflate';
import {encodeCbor} from './cartridge.mjs';
const privateKey=process.env.GAMEWAFFLE_SIGNING_KEY
  ? createPrivateKey(readFileSync(process.env.GAMEWAFFLE_SIGNING_KEY))
  : generateKeyPairSync('ed25519').privateKey;
if(privateKey.asymmetricKeyType!=='ed25519')throw Error('Use an Ed25519 cartridge signing key');
const publicKey=createPublicKey(privateKey);
const limit=256*1024*1024, MAX_METADATA=32*1024*1024, prefix=[71,87,65,70,0];
export function pack(cart, { editor = false, locale = cart.localization?.locale } = {}) {
  const { start, sprites, rooms, globals, flags, atlases, audio, camera, tilePreviews, spritePreviews, name } = cart;
  const tables = cart.localization?.tables ?? {};
  if (locale && !Object.hasOwn(tables,locale)) throw Error('Unknown language: '+locale);
  const text = locale ? {...tables[cart.localization.locale],...tables[locale]} : {};
  const label=value=>value.startsWith('text.')?text[value.slice(5)]??value:value;
  const menus=Object.fromEntries(Object.entries(cart.menus??{}).map(([id,menu])=>[id,{
    title:label(menu.title),options:menu.options.map(label),
  }]));
  const items=Object.fromEntries(Object.entries(cart.items??{}).map(([id,item])=>[id,{
    ...item,...(item.label?{label:label(item.label)}:{}),
  }]));
  const objects=cart.collections&&{...cart.collections,types:Object.fromEntries(Object.entries(cart.collections.types).map(([id,fields])=>[id,
    Object.fromEntries(Object.entries(fields).map(([name,field])=>[name,{type:field.type,
      ...(Object.hasOwn(field,'default')?{default:String(field.type==='real'?field.default.real:field.default)}:{})}]))]))};
  const metadata = encodeCbor({fonts:Object.keys(cart.fonts??{}),events:cart.events??[],controls:cart.controls??{},items,text,menus,minimap:cart.minimap?.mode??'off',id:cart.saveId??name,start,camera, sprites, rooms, globals:globals??{}, flags:flags??{},
    ...(cart.gameProgram?{initialGlobals:cart.initialGlobals,collections:objects}:{})});
  if (metadata.length > MAX_METADATA) throw Error('Cartridge simulation data exceeds 32 MiB');
  const compressed = deflateSync(metadata,{level:6});
  const views = Object.fromEntries(Object.entries(rooms).map(([id,room])=>[id,
    Object.fromEntries(['neighbors','seams','ripple','hd','shader','title','width','height','cameraHeight','size','background','baked','ySort','music','ambience'].map(key=>[key,room[key]??null]))]));
  // Keep the library's display metadata before the larger room and atlas data.
  const media = encodeCbor({name,...(locale?{locale}:{}),...(cart.coverArt?{coverArt:cart.coverArt}:{}),start,runtimeAbi:cart.runtimeAbi??4,...(Object.keys(cart.shaders??{}).length?{shaders:cart.shaders}:{}),rooms:views,atlases,audio,camera,...(cart.minimap?{minimap:cart.minimap}:{}),fontGlyphs:cart.fontGlyphs??{},fonts:cart.fonts??{},...(cart.fontLayout?{fontLayout:cart.fontLayout}:{}),...(cart.fontFallbackGlyphs?{fontFallbackGlyphs:cart.fontFallbackGlyphs}:{}),...(editor ? {tilePreviews,spritePreviews} : {})});
  const bytes = new Uint8Array(14 + compressed.length + media.length);
  if (bytes.length > limit) throw Error('Cartridge exceeds 256 MiB');
  bytes.set([...prefix,2]);
  const header = new DataView(bytes.buffer);
  header.setUint32(6,compressed.length,true);
  header.setUint32(10,metadata.length,true);
  bytes.set(compressed,14);
  bytes.set(media,14+compressed.length);
  const signed=new Uint8Array(bytes.length+96);
  if(signed.length>limit)throw Error('Cartridge exceeds 256 MiB');
  signed.set(bytes);
  signed.set(publicKey.export({format:'der',type:'spki'}).subarray(-32),bytes.length);
  signed.set(sign(null,bytes,privateKey),bytes.length+32);
  return signed;
}

