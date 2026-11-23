import {readFile,writeFile,rename,mkdir,readdir,unlink} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {zipSync,unzipSync} from 'fflate';

const limit=128*1024*1024;
function valid(name){
  if(!name || name.includes('\\') || name.includes(':') || name.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid project path');
  return name;
}
async function atomic(path,data){
  await mkdir(dirname(path),{recursive:true});
  const tmp=path+'.'+randomUUID()+'.tmp';
  try{await writeFile(tmp,data,{flag:'wx'});await rename(tmp,path);}finally{await unlink(tmp).catch(()=>{});}
}
export async function projectStore(path){
  const archive=path.endsWith('.waffleproj');
  let entries;
  if(archive){
    const data=await readFile(path);
    if(data.length>limit)throw Error('Project archive exceeds 128 MiB');
    let size=0,count=0;
    entries=new Map(Object.entries(unzipSync(data,{filter:file=>{
      if(file.name.endsWith('/'))return false;
      valid(file.name);
      if(++count>8192 || (size+=file.originalSize)>limit)throw Error('Project archive exceeds its limits');
      return true;
    }})));
    if(!entries.has('project.json'))throw Error('Project archive needs project.json');
  }
  async function read(name,encoding){
    valid(name);
    if(!archive)return readFile(resolve(path,name),encoding);
    if(!entries.has(name))throw Object.assign(Error('Missing project file: '+name),{code:'ENOENT'});
    const buffer=Buffer.from(entries.get(name));
    return encoding?buffer.toString(encoding):buffer;
  }
  async function list(folder=''){
    if(archive)return [...entries.keys()].filter(key=>!folder||key.startsWith(folder+'/'));
    const files=[];
    async function walk(dir){
      for(const entry of await readdir(resolve(path,dir),{withFileTypes:true})){
        const name=dir?dir+'/'+entry.name:entry.name;
        if(entry.isDirectory() && !entry.name.startsWith('.'))await walk(name);
        else if(entry.isFile())files.push(name);
      }
    }
    await walk(folder);
    return files;
  }
  function serialize(map){
    let size=0;
    if(map.size>8192)throw Error('Project has too many files');
    for(const value of map.values())if((size+=value.length)>limit)throw Error('Project exceeds 128 MiB');
    return zipSync(Object.fromEntries(map),{level:4});
  }
  async function save(changes){
    for(const [name] of changes)valid(name);
    if(!archive){for(const [name,data] of changes){if(data===null)await unlink(resolve(path,name));else await atomic(resolve(path,name),data); }return;}
    const next=new Map(entries);
    for(const [name,data] of changes){if(data===null)next.delete(name);else next.set(name,Buffer.from(data));}
    await atomic(path,serialize(next));entries=next;
  }
  async function exportArchive(){
    if(archive)return readFile(path);
    const map=new Map();
    for(const name of await list())map.set(name,await read(name));
    return serialize(map);
  }
  return {archive,read,list,save,exportArchive};
}
