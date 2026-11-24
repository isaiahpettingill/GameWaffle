// Compiled assets are immutable. Bound each cache by decoded/encoded bytes.
export function byteCache(limit) {
  const entries=new Map();
  let bytes=0;
  return {
    get(key) {
      const entry=entries.get(key);
      if(!entry)return;
      entries.delete(key);
      entries.set(key,entry);
      return entry.value;
    },
    put(key,value,size) {
      if(size>limit)return value;
      if(entries.has(key)){bytes-=entries.get(key).size;entries.delete(key);}
      while(bytes+size>limit || entries.size>=128){
        const oldest=entries.keys().next().value;
        bytes-=entries.get(oldest).size;
        entries.delete(oldest);
      }
      entries.set(key,{value,size});
      bytes+=size;
      return value;
    },
  };
}
