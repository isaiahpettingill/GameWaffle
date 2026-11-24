import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const directory=new URL('../web-built/asset-codec/',import.meta.url);
let codec;

export function runCodec(operation,...args) {
  if (!codec) {
    if (!['asset-codec.cjs','asset-codec_bg.wasm'].every(file=>existsSync(new URL(file,directory)))) {
      const builder=fileURLToPath(new URL('./build-assets.mjs',import.meta.url));
      execFileSync(process.execPath,[builder],{stdio:'inherit'});
    }
    codec=require(fileURLToPath(new URL('asset-codec.cjs',directory)));
  }
  try {
    const bytes=codec[operation](...args);
    return Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  } catch (error) {
    throw error instanceof Error ? error : Error(String(error));
  }
}
