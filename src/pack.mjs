import {generateKeyPairSync,sign,createPrivateKey,createPublicKey} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {deflateRawSync} from 'node:zlib';
import {
  CARTRIDGE_MAGIC, CARTRIDGE_VERSION, HEADER_SIZE, MAX_CARD, MAX_CARTRIDGE, MAX_SIMULATION, SIGNATURE_SIZE, encodeCbor,
} from './cartridge.mjs';
const privateKey=process.env.GAMEWAFFLE_SIGNING_KEY
  ? createPrivateKey(readFileSync(process.env.GAMEWAFFLE_SIGNING_KEY))
  : generateKeyPairSync('ed25519').privateKey;
if(privateKey.asymmetricKeyType!=='ed25519')throw Error('Use an Ed25519 cartridge signing key');
const publicKey=createPublicKey(privateKey).export({format:'der',type:'spki'}).subarray(-32);
export function pack(cart, { editor = false, locale = cart.localization?.locale } = {}) {
  return preparePack(cart, locale)(editor);
}

export function preparePack(cart, locale = cart.localization?.locale) {
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
  const metadata = encodeCbor({...(cart.pixelUnits?{pixelUnits:true}:{}),fonts:Object.keys(cart.fonts??{}),events:cart.events??[],controls:cart.controls??{},items,text,menus,minimap:cart.minimap?.mode??'off',id:cart.saveId??name,start,camera, sprites, rooms, globals:globals??{}, flags:flags??{},
    ...(cart.gameProgram?{initialGlobals:cart.initialGlobals,collections:objects}:{})});
  const simulationSize=metadata.length;
  if (simulationSize > MAX_SIMULATION) throw Error('Cartridge simulation data exceeds 32 MiB');
  const compressed = deflateRawSync(metadata, {level:6});
  const views = Object.fromEntries(Object.entries(rooms).map(([id,room])=>[id,
    Object.fromEntries(['neighbors','seams','ripple','hd','shader','title','width','height','cameraHeight','size','background','baked','ySort','music','ambience'].map(key=>[key,room[key]??null]))]));
  const card = encodeCbor({name,...(locale?{locale}:{}),...(cart.coverArt?{coverArt:cart.coverArt}:{}),runtimeAbi:cart.runtimeAbi??4});
  if (card.length > MAX_CARD) throw Error('Cartridge display data is too large');
  const media = {start,...(Object.keys(cart.shaders??{}).length?{shaders:cart.shaders}:{}),rooms:views,atlases,audio,camera,...(cart.minimap?{minimap:cart.minimap}:{}),fontGlyphs:cart.fontGlyphs??{},fonts:cart.fonts??{},...(cart.fontLayout?{fontLayout:cart.fontLayout}:{}),...(cart.fontFallbackGlyphs?{fontFallbackGlyphs:cart.fontFallbackGlyphs}:{})};
  return editor => bundle(card,compressed,simulationSize,
    encodeCbor(editor?{...media,tilePreviews,spritePreviews}:media));
}

function bundle(card, compressed, simulationSize, media) {
  if (media.length > MAX_CARTRIDGE) throw Error('Cartridge media exceeds 256 MiB');
  // Skip the inflate on load when media compression saves less than 64 bytes or 3.125%.
  const packedMedia = deflateRawSync(media, {level:3});
  const compressMedia = media.length - packedMedia.length >= Math.max(64, media.length / 32);
  const storedMedia = compressMedia ? packedMedia : media;
  const simulationStart = HEADER_SIZE + card.length;
  const mediaStart = simulationStart + compressed.length;
  const payloadSize = mediaStart + storedMedia.length;
  if (payloadSize + SIGNATURE_SIZE > MAX_CARTRIDGE) throw Error('Cartridge exceeds 256 MiB');
  const signed = new Uint8Array(payloadSize + SIGNATURE_SIZE);
  signed.set([...CARTRIDGE_MAGIC, CARTRIDGE_VERSION]);
  const header = new DataView(signed.buffer);
  header.setUint32(6,compressed.length,true);
  header.setUint32(10,simulationSize,true);
  header.setUint32(14, card.length, true);
  header.setUint32(18, compressMedia ? media.length : 0, true);
  signed.set(card, HEADER_SIZE);
  signed.set(compressed, simulationStart);
  signed.set(storedMedia, mediaStart);
  signed.set(publicKey, payloadSize);
  signed.set(sign(null, signed.subarray(0, payloadSize), privateKey), payloadSize + 32);
  return signed;
}

