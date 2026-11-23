import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';

export async function studioBuildId(){
  const hash=createHash('sha256');
  async function visit(path){
    const entries=await readdir(path,{withFileTypes:true});
    for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
      const child=join(path,entry.name);
      if(entry.isDirectory())await visit(child);
      else if(entry.isFile())await add(child);
    }
  }
  async function add(path){hash.update(path);hash.update('\0');hash.update(await readFile(path));}
  for(const path of ['src','ui','runtime/src','runtime/vendor','demo'])await visit(path);
  for(const path of ['runtime/Cargo.lock','runtime/Cargo.toml','package-lock.json','vite.config.js','index.html','projects.html','player.html','packaging/gamewaffle.svg'])await add(path);
  return hash.digest('hex');
}
