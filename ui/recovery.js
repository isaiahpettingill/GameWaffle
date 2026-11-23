// Serialize writes so a slow request cannot replace a more recent draft.
export function draftFile(key,report){
  const url='./api/recovery/'+encodeURIComponent(key);
  let writes=Promise.resolve(),pending;
  async function flush(){
    while(pending!==undefined){
      const value=pending;pending=undefined;
      const response=await fetch(url,value===null?{method:'DELETE'}:{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
      if(!response.ok)throw Error((await response.json()).error);
    }
  }
  return {
    async read(){await writes;const r=await fetch(url);if(!r.ok)throw Error('Cannot read recovery file');return r.json();},
    write(value){pending=value;writes=writes.then(flush).catch(e=>report('Recovery: '+e.message));return writes;}
  };
}
