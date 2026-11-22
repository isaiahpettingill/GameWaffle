import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { build } from 'vite';

const options = { stdio: 'inherit' };
execFileSync('cargo', ['build','--locked','--manifest-path','runtime/Cargo.toml','--release','--target','wasm32-unknown-unknown'], options);
await mkdir('web-built/runtime', { recursive: true });
execFileSync('wasm-bindgen', ['--target','web','--out-dir','web-built/runtime','--out-name','runtime',
  'runtime/target/wasm32-unknown-unknown/release/gamewaffle_runtime.wasm'], options);
await build();
await cp('node_modules/blockly/media','web-built/site/blockly-media',{ recursive:true });
process.env.GAMEWAFFLE_STANDALONE = (await readFile('web-built/demo.waffle')).toString('base64');
await build();
