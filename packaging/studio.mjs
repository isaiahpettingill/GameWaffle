import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const project=process.argv[2] && resolve(process.argv[2]);
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
process.argv=[process.execPath,'src/server.mjs',...(project?['--project',project]:[]),'--port','0','--open'];
await import('../src/server.mjs');
