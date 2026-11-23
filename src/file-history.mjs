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
  return {
    async save(path,value,commit,empty=null){
      const before=(await read(path))??empty;
      const after=Buffer.from(value);
      await commit();
      const id=randomUUID(),size=(before?.length??0)+after.length;
      entries.set(id,{path,before,after,size});bytes+=size;
      while(entries.size>50||bytes>96*1024*1024){const key=entries.keys().next().value;bytes-=entries.get(key).size;entries.delete(key);}
      return id;
    },
    async restore(id,back,recompile){
      const entry=entries.get(id);if(!entry)throw Error('File history has expired');
      const {path}=entry,previous=back?entry.after:entry.before,next=back?entry.before:entry.after;
      if(!same(await read(path),previous))throw Error('The source file changed outside this edit');
      const source={...store,
        read:async(name,encoding)=>{
          if(name!==path)return store.read(name,encoding);
          if(next===null)throw Object.assign(Error('Missing file'),{code:'ENOENT'});
          return encoding?next.toString(encoding):next;
        },
        list:async(folder='')=>{
          const names=(await store.list(folder)).filter(k=>k!==path);
          if(next!==null&&(!folder||path.startsWith(folder+'/')))names.push(path);
          return names;
        }};
      await recompile(undefined,undefined,()=>store.save([[path,next]]),source);
    }
  };
}
