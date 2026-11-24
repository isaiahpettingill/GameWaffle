import {randomUUID} from 'node:crypto';

// Keep source-file undo separate from the manifest draft. Never replace a file
// that an external editor changed after Studio recorded the edit.
export function fileHistory(store){
  const entries=new Map();
  let bytes=0;
  async function read(path){
    try{return Buffer.from(await store.read(path));}
    catch(e){if(e.code==='ENOENT')return null;throw e;}
  }
  const same=(a,b)=>a===null?b===null:b!==null&&a.equals(b);
  async function saveMany(changes,commit,empty){
    const files=await Promise.all([...changes].map(async([path,value])=>({
      path,before:(await read(path))??empty?.get(path)??null,after:Buffer.from(value),
    })));
    await commit();
    const id=randomUUID(),size=files.reduce((total,{before,after})=>total+(before?.length??0)+after.length,0);
    entries.set(id,{files,size});bytes+=size;
    while(entries.size>50||bytes>96*1024*1024){const key=entries.keys().next().value;bytes-=entries.get(key).size;entries.delete(key);}
    return id;
  }
  return {
    save:(path,value,commit,empty=null)=>saveMany([[path,value]],commit,new Map([[path,empty]])),
    saveMany,
    async restore(id,back,recompile){
      const entry=entries.get(id);if(!entry)throw Error('File history has expired');
      const changes=new Map();
      for(const {path,before,after} of entry.files){
        if(!same(await read(path),back?after:before))throw Error('The source file changed outside this edit: '+path);
        changes.set(path,back?before:after);
      }
      const source={...store,
        read:async(name,encoding)=>{
          if(!changes.has(name))return store.read(name,encoding);
          const next=changes.get(name);
          if(next===null)throw Object.assign(Error('Missing file'),{code:'ENOENT'});
          return encoding?next.toString(encoding):next;
        },
        list:async(folder='')=>{
          const names=(await store.list(folder).catch(error=>{if(error.code==='ENOENT')return [];throw error;})).filter(k=>!changes.has(k));
          for(const [path,next] of changes)if(next!==null&&(!folder||path.startsWith(folder+'/')))names.push(path);
          return names;
        }};
      await recompile(undefined,undefined,()=>store.save([...changes]),source);
      return changes.has('project.json');
    }
  };
}
