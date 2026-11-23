import {createHash,randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {mkdir,readFile,rename,unlink,writeFile} from 'node:fs/promises';

// Keep drafts outside both project formats and outside the project watcher.
export function recoveryStore(projectPath){
  const id=createHash('sha256').update(projectPath).digest('hex');
  const folder=join(homedir(),'.gamewaffle','recovery',id);
  return async function recovery(key,method,data){
    const file=join(folder,createHash('sha256').update(key).digest('hex')+'.json');
    if(method==='GET'){
      try{return JSON.parse(await readFile(file,'utf8'));}
      catch(e){if(e.code==='ENOENT')return null;throw e;}
    }
    if(method==='DELETE'){await unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});return null;}
    await mkdir(folder,{recursive:true});
    const tmp=file+'.'+randomUUID();
    try{await writeFile(tmp,JSON.stringify(data),{mode:0o600});await rename(tmp,file);}
    finally{await unlink(tmp).catch(()=>{});}
    return null;
  };
}
