import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { build } from 'vite';
import { cartridgeMarker, embedCartridge, playerTemplate } from './web-export.mjs';

const options = { stdio: 'inherit' };
if (process.argv.includes('--native')) {
  execFileSync('cargo',['build','--locked','--release','--features','bundled','--manifest-path','player/Cargo.toml'],options);
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const name = 'gamewaffle-player' + suffix;
  await mkdir('web-built/native',{recursive:true});
  await cp('player/target/release/' + name,'web-built/native/' + name);
  process.exit(0);
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
await writeFile('web-built/standalone/gamewaffle-player.html',template.replace(cartridgeMarker,''));
if (!process.argv.includes('--player-only')) {
  const demo = await readFile('web-built/demo.waffle');
  await writeFile(player,embedCartridge(template,demo));
}
