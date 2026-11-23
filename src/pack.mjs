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
export function pack(cart, { editor = false } = {}) {
  const { start, sprites, rooms, globals, flags, atlases, audio, camera, tilePreviews, spritePreviews, name } = cart;
  const metadata = encodeCbor({items:cart.items??{},id:cart.saveId??name,start, sprites, rooms, globals:globals??{}, flags:flags??{}});
  if (metadata.length > MAX_METADATA) throw Error('Cartridge simulation data exceeds 32 MiB');
  const compressed = deflateSync(metadata,{level:6});
  const views = Object.fromEntries(Object.entries(rooms).map(([id,room])=>[id,
    Object.fromEntries(['neighbors','seams','ripple','title','width','height','size','background','baked','ySort','music','ambience'].map(key=>[key,room[key]??null]))]));
  const media = encodeCbor({name,start,rooms:views,atlases,audio,camera,...(editor ? {tilePreviews,spritePreviews} : {})});
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

