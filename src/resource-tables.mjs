export const resourceTextLimit=4096;
const encoder=new TextEncoder();
export const validResourceText=value=>typeof value==='string'&&encoder.encode(value).length<=resourceTextLimit;

export function resourceTables(config, resources={}){
  const {locale:preferred='',tables={}}=config??{};
  if(!tables||typeof tables!=='object'||Array.isArray(tables))return {locale:preferred,tables};
  const entries=Object.values(tables);
  if(!entries.length&&!Object.keys(resources).length)return {locale:preferred,tables};
  const locale=entries.length?preferred:preferred||'en';
  if(entries.length&&(!Object.hasOwn(tables,locale)||entries.some(table=>!table||typeof table!=='object'||Array.isArray(table))))
    return {locale,tables};
  // Retain translations when a script declaration is removed. The key then
  // has an empty default until an author supplies a replacement in Resources.
  const fallback=Object.fromEntries(entries.flatMap(table=>Object.keys(table).map(key=>[key,''])));
  return {locale,tables:{...tables,[locale]:{...fallback,...resources,...tables[locale]}}};
}
