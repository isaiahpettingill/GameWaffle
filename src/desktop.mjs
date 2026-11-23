import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {zipSync} from 'fflate';

const app=fileURLToPath(new URL('../',import.meta.url));
const cache=join(process.env.LOCALAPPDATA??process.env.XDG_DATA_HOME??join(homedir(),'.local','share'),'GameWaffle','updates');
const api='https://api.github.com/repos/isaiahpettingill/GameWaffle/releases/latest';
export const nativeTarget=process.arch==='x64'?({linux:'linux-x64',win32:'windows-x64'})[process.platform]:undefined;
const targets=['linux-x64','windows-x64'];
const binary=t=>t==='windows-x64'?'gamewaffle-player.exe':'gamewaffle-player';
export function runtimeAsset(t){if(!targets.includes(t))throw Error('Select Linux or Windows');return 'GameWaffle-Player-'+t+(t==='windows-x64'?'.exe':'');}
async function optional(file){try{return await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
async function bundledVersion(){return (await optional(join(app,'release-version')))?.toString().trim()??'development';}
function newer(tag,installed){
  if(!/^v\d+\.\d+\.\d+$/.test(tag))throw Error('Expected a stable release tag such as v2.0.0');
  if(!/^v\d+\.\d+\.\d+$/.test(installed))return true;
  const a=tag.slice(1).split('.').map(Number),b=installed.slice(1).split('.').map(Number);
  return (a.map((n,i)=>n-b[i]).find(n=>n!==0)??0)>0;
}
async function installedRuntime(t){
  const tag=(await optional(join(cache,t,'current')))?.toString();
  if(!tag || !/^v\d+\.\d+\.\d+$/.test(tag))return;
  const bundled=await bundledVersion();
  if(t===nativeTarget && bundled!=='development' && newer(bundled,tag))return;
  return {tag,path:join(cache,t,tag,binary(t))};
}
export async function checkUpdate(component,t=nativeTarget,request=fetch){
  if(!targets.includes(t)||!['studio','runtime'].includes(component))throw Error('Select a desktop platform and component');
  if(component==='studio' && t!==nativeTarget)throw Error('Select the installed Studio platform');
  const response=await request(api,{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(response.status===404?'No published release is available':'GitHub release check failed ('+response.status+')');
  const release=await response.json(),tag=release.tag_name;
  const name=component==='runtime'?runtimeAsset(t):t==='linux-x64'?'GameWaffle-x86_64.AppImage':'GameWaffle-Setup.exe';
  const asset=release.assets?.find(a=>a.name===name);
  const installed=(component==='runtime' && (await installedRuntime(t))?.tag) || (component==='studio'||t===nativeTarget?await bundledVersion():'none');
  const available=newer(tag,installed);
  if(!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest))throw Error('The release has no verified '+name);
  const url='https://github.com/isaiahpettingill/GameWaffle/releases/download/'+tag+'/'+name;
  if(asset.browser_download_url!==url)throw Error('Unexpected release asset URL');
  return {tag,installed,name,available,url,digest:asset.digest};
}
async function atomic(path,bytes,mode){
  await mkdir(dirname(path),{recursive:true});
  const temp=path+'.'+randomUUID();
  try{await writeFile(temp,bytes,{mode,flag:'wx'});await rename(temp,path);}finally{await rm(temp,{force:true});}
}
export async function update(component,t=nativeTarget,request=fetch){
  const info=await checkUpdate(component,t,request);
  if(!info.available)throw Error('This version is current');
  const res=await request(info.url,{signal:AbortSignal.timeout(180000)});
  if(!res.ok)throw Error('Release download failed');
  const bytes=Buffer.from(await res.arrayBuffer());
  if('sha256:'+createHash('sha256').update(bytes).digest('hex')!==info.digest)throw Error('Release checksum mismatch');
  const path=join(cache,t,info.tag,component==='runtime'?binary(t):info.name);
  await atomic(path,bytes,0o755);
  if(component==='runtime')await atomic(join(cache,t,'current'),info.tag,0o600);
  return {...info,path};
}
export async function exportDesktop(bytes,t=nativeTarget){
  runtimeAsset(t);
  const cached=await installedRuntime(t);
  let player=cached && await optional(cached.path);
  if(!player && t===nativeTarget)player=await optional(join(app,binary(t)));
  if(!player && t===nativeTarget)player=await optional(join(app,'web-built','native',binary(t)));
  if(!player)throw Error('Install the '+t+' runtime from Updates before export');
  return zipSync({[binary(t)]:[player,{os:3,attrs:(0o100755<<16)>>>0}],'game.waffle':bytes,'LICENSE':await readFile(join(app,'LICENSE'))},{level:4});
}
