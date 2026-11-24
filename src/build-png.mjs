import {execFileSync} from 'node:child_process';
import {mkdirSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const cwd=fileURLToPath(new URL('..',import.meta.url));
const target='asset-codec/target';
const output='web-built/png-codec';
const options={cwd,stdio:'inherit'};
execFileSync('cargo',['build','--locked','--release','--target','wasm32-unknown-unknown',
  '--manifest-path','asset-codec/Cargo.toml','--target-dir',target],options);
mkdirSync(new URL('../'+output+'/',import.meta.url),{recursive:true});
execFileSync('wasm-bindgen',['--target','nodejs','--no-typescript','--out-dir',output,'--out-name','png-codec',
  target+'/wasm32-unknown-unknown/release/gamewaffle_asset_codec.wasm'],options);
renameSync(new URL('../'+output+'/png-codec.js',import.meta.url),new URL('../'+output+'/png-codec.cjs',import.meta.url));
