import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { build } from 'vite';
import { aotMarker, cartridgeMarker, playerTemplate } from './web-export.mjs';

const options = { stdio: 'inherit' };
if (process.argv.includes('--native')) {
  execFileSync('cargo',['build','--locked','--release','--features','bundled','--manifest-path','player/Cargo.toml'],options);
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const name = 'gamewaffle-player' + suffix;
  await mkdir('web-built/native',{recursive:true});
  await cp('player/target/release/' + name,'web-built/native/' + name);
  process.exit(0);
}
if (!process.argv.includes('--player-only')) {
  execFileSync(process.execPath,['src/build-assets.mjs'],options);
  if (process.argv.includes('--check-demo')) execFileSync(process.execPath,['src/compiler.mjs'],options);
}
execFileSync('cargo', ['build','--locked','--manifest-path','runtime/Cargo.toml','--release','--target','wasm32-unknown-unknown'], options);
await mkdir('web-built/runtime', { recursive: true });
execFileSync('wasm-bindgen', ['--target','web','--out-dir','web-built/runtime','--out-name','runtime',
  'runtime/target/wasm32-unknown-unknown/release/gamewaffle_runtime.wasm'], options);
if (!process.argv.includes('--player-only')) {
  await build();
  await cp('node_modules/blockly/media','web-built/site/blockly-media',{ recursive:true });
}
process.env.GAMEWAFFLE_STANDALONE = '1';
await build();
const player = 'web-built/standalone/player.html';
await rename(player, playerTemplate);
const template = await readFile(playerTemplate,'utf8');
const empty=template.replace(cartridgeMarker,'').replace(aotMarker,'');
await Promise.all([writeFile('web-built/standalone/gamewaffle-player.html',empty),writeFile(player,empty)]);
if (!process.argv.includes('--player-only')) {
  if(process.argv.includes('--check-demo')){
    const demo = await readFile('web-built/demo.waffle');
    const {Runtime,initSync}=await import('../web-built/runtime/runtime.js');
    initSync({module:await readFile('web-built/runtime/runtime_bg.wasm')});
    Runtime.from_cartridge(demo).free();
  }
  const {studioBuildId}=await import('./studio-build-state.mjs');
  await writeFile('web-built/studio-build-id',await studioBuildId());
}
