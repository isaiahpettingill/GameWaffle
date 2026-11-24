import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const directory=new URL('../web-built/png-codec/',import.meta.url);
let encode;

export function encodePng(width,height,data) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 0xffffffff || height > 0xffffffff || !(data instanceof Uint8Array)) {
    throw Error('Invalid RGBA image dimensions or data');
  }
  if (!encode) {
    if (!['png-codec.cjs','png-codec_bg.wasm'].every(file=>existsSync(new URL(file,directory)))) {
      const builder=fileURLToPath(new URL('./build-png.mjs',import.meta.url));
      execFileSync(process.execPath,[builder],{stdio:'inherit'});
    }
    encode=require(fileURLToPath(new URL('png-codec.cjs',directory))).encode_png;
  }
  try {
    const png=encode(width,height,data);
    return Buffer.from(png.buffer,png.byteOffset,png.byteLength);
  } catch (error) {
    throw error instanceof Error ? error : Error(String(error));
  }
}
