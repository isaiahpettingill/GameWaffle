import {cp,access} from 'node:fs/promises';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {projectStore} from '../src/project-store.mjs';
import {writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const project = process.argv[2] ? resolve(process.argv[2]) : join(homedir(),'GameWaffle','Basalt Works');
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
try { await access(project); } catch {
  if(project.endsWith('.waffleproj'))await writeFile(project,await (await projectStore(resolve('demo'))).exportArchive(),{flag:'wx'});
  else await cp('demo',project,{recursive:true,errorOnExist:true,force:false});
}
process.argv = [process.execPath,'src/server.mjs','--project',project,'--port','0','--open'];
await import('../src/server.mjs');
