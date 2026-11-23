import {cp,mkdir,copyFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
const target=process.argv[2], windows=process.platform==='win32';
await mkdir(target,{recursive:true});
for(const file of ['src','package.json','demo','LICENSE','packaging/studio.mjs','web-built/runtime','web-built/site','web-built/standalone','web-built/demo.waffle','runtime/vendor/box2d-rs/LICENSE']){
  await cp(file,join(target,file),{recursive:true});
}
const packages=['ws','pngjs','qoa-format','fflate','cbor-x'];
const seen=new Set();
async function dependency(name){
  if(seen.has(name))return;
  seen.add(name);
  const path=join('node_modules',name);
  await cp(path,join(target,path),{recursive:true});
  const {readFile}=await import('node:fs/promises');
  for(const dep of Object.keys(JSON.parse(await readFile(join(path,'package.json'))).dependencies??{}))await dependency(dep);
}
for(const name of packages)await dependency(name);
if(process.argv.includes('--android-editor'))process.exit(0);
const ext=windows?'.exe':'';
await copyFile(process.execPath,join(target,'node'+ext));
await copyFile('player/target/release/gamewaffle-player'+ext,join(target,'gamewaffle-player'+ext));
if(!windows)for(const f of ['node','gamewaffle-player'])await chmod(join(target,f),0o755);
