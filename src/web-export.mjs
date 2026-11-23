import {pack} from './pack.mjs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unpack } from './cartridge.mjs';
import { compileProject } from './compiler.mjs';

export const playerTemplate = new URL('../web-built/standalone/player-template.html', import.meta.url);
export const cartridgeMarker = '__GAMEWAFFLE_CARTRIDGE_BASE64__';

export function embedCartridge(template, bytes) {
  const offset = template.indexOf(cartridgeMarker);
  if (offset < 0 || template.indexOf(cartridgeMarker, offset + 1) !== -1) {
    throw Error('Build the standalone player before exporting a web game');
  }
  const payload = Buffer.from(bytes).toString('base64');
  return template.slice(0, offset) + payload + template.slice(offset + cartridgeMarker.length);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const input = resolve(process.argv[2] ?? 'demo');
  const output = resolve(process.argv[3] ?? 'web-built/game.html');
  const bytes = (input.endsWith('.waffleproj') || (await stat(input)).isDirectory()) ? pack(await compileProject(input)) : await readFile(input);
  unpack(bytes);
  const html = embedCartridge(await readFile(playerTemplate, 'utf8'), bytes);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html);
  console.log(`Exported ${output}`);
}
