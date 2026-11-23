import {readFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const lock=JSON.parse(await readFile('package-lock.json','utf8'));
const root=lock.packages[''];
let ready=false;
try{
  const installed=JSON.parse(await readFile('node_modules/.package-lock.json','utf8')).packages;
  ready=Object.entries(lock.packages).every(([path,pkg])=>
    !path||(!installed[path]&&pkg.optional)||installed[path]?.integrity===pkg.integrity&&installed[path]?.version===pkg.version);
  const direct=Object.keys({...root.dependencies,...root.devDependencies});
  await Promise.all(direct.map(async name=>{
    const path='node_modules/'+name;
    const manifest=JSON.parse(await readFile(path+'/package.json','utf8'));
    if(manifest.version!==lock.packages[path].version)ready=false;
  }));
  await access(fileURLToPath(import.meta.resolve('@lucide/svelte')));
}catch{ready=false;}
if(!ready){
  console.log('Installing the dependencies listed in package-lock.json…');
  const npm=process.env.npm_execpath;
  if(!npm)throw Error('Start Studio with npm start or build it with npm run build.');
  const result=spawnSync(process.execPath,[npm,'ci','--include=dev','--no-audit','--no-fund'],{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
}
