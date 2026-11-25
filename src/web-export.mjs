import {pack} from './pack.mjs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unpack } from './cartridge.mjs';
import { compileProject } from './compiler.mjs';

export const playerTemplate = new URL('../web-built/standalone/player-template.html', import.meta.url);
export const cartridgeMarker = '__GAMEWAFFLE_CARTRIDGE_BASE64__';
export const aotMarker = '__GAMEWAFFLE_AOT_BASE64__';

function embed(template, marker, bytes) {
  const offset = template.indexOf(marker);
  if (offset < 0 || template.indexOf(marker, offset + marker.length) !== -1) {
    throw Error('Build the standalone player before exporting a web game');
  }
  const payload = Buffer.from(bytes).toString('base64');
  return template.slice(0, offset) + payload + template.slice(offset + marker.length);
}

let compiler;
async function aotCompiler() {
  const runtime = new URL('../web-built/runtime/', import.meta.url);
  const [{compile_aot_scripts, initSync}, module] = await Promise.all([
    import(new URL('runtime.js', runtime).href), readFile(new URL('runtime_bg.wasm', runtime)),
  ]);
  if (!compile_aot_scripts) throw Error('Rebuild the standalone player to enable ahead-of-time compilation');
  initSync({module});
  return compile_aot_scripts;
}

export async function exportStandalone(bytes) {
  const [template, compile] = await Promise.all([readFile(playerTemplate, 'utf8'), compiler ??= aotCompiler()]);
  return embed(embed(template, aotMarker, compile(bytes)), cartridgeMarker, bytes);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const input = resolve(process.argv[2] ?? 'demo');
  const output = resolve(process.argv[3] ?? 'web-built/game.html');
  const [flag,locale,...extra] = process.argv.slice(4);
  if (flag!==undefined && (flag!=='--locale' || !locale || extra.length)) throw Error('Use --locale followed by a language code');
  const project = input.endsWith('.waffleproj') || (await stat(input)).isDirectory();
  if (locale && !project) throw Error('Choose the export language from the source project');
  const bytes = project ? pack(await compileProject(input),{locale}) : await readFile(input);
  unpack(bytes);
  const html = await exportStandalone(bytes);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html);
  console.log(`Exported ${output}`);
}
