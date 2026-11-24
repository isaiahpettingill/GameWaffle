import {decodeCbor} from './cartridge.mjs';

const header=[71,87,83,86,0,1]; // GWSV, encoding version 1

export function decodeSave(bytes){
  if(!header.every((byte,index)=>bytes[index]===byte))throw Error('Unsupported GameWaffle save version');
  return decodeCbor(bytes.subarray(header.length));
}
