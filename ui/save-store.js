let database;

function open(){
  return database??=new Promise((resolve,reject)=>{
    const request=indexedDB.open('GameWaffle Saves',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('slots');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  }).catch(error=>{
    database=undefined;
    throw error;
  });
}

export async function accessSaveSlot(game,slot,bytes){
  const db=await open();
  const transaction=db.transaction('slots',bytes?'readwrite':'readonly');
  const store=transaction.objectStore('slots'),key=[game,slot];
  const request=bytes?store.put(bytes,key):store.get(key);
  return new Promise((resolve,reject)=>{
    transaction.oncomplete=()=>resolve(request.result);
    transaction.onabort=()=>reject(transaction.error??Error('Save transaction was interrupted'));
  });
}
