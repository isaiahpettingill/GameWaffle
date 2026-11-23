import {readFile,writeFile,mkdir,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {unzipSync} from 'fflate';
import {exportDesktop} from '../stage/src/desktop.mjs';

const folder=resolve('web-built/export-test');
await mkdir(folder,{recursive:true});
const cart=await readFile('web-built/demo.waffle');
const archive=await exportDesktop(cart);
for(const [name,data] of Object.entries(unzipSync(archive)))await writeFile(join(folder,name),data);
const exe=join(folder,'gamewaffle-player'+(process.platform==='win32'?'.exe':''));
await chmod(exe,0o755);
const result=spawnSync(exe,['--verify'],{cwd:folder,stdio:'inherit',timeout:30000,env:{...process.env,SDL_VIDEO_DRIVER:'dummy',SDL_AUDIO_DRIVER:'dummy'}});
if(result.status!==0)throw Error('The exported player could not open its cartridge');
