import {formatScript,locations,parseScript} from './wafflescript.mjs';

export function updateRoomExit(unit,edge,route){
  const rows=[{op:'room_exit',edge,room:route.targets[0]??'',routing:route.mode,
    flag:route.flag,when:route.when,seamless:route.adjacent},
    ...route.targets.slice(1).map(room=>({op:'alternate_exit',edge,room}))];
  const matches=row=>row.edge===edge&&(row.op==='room_exit'||row.op==='alternate_exit');
  const group=body=>({op:'init_properties',body});
  if(unit.source===undefined){
    const next=structuredClone(unit);
    next.events??={};
    const init=(next.events.init??=[]);
    if(init[0]?.op!=='init_properties')init.unshift(group([]));
    init[0].body=[...init[0].body.filter(row=>!matches(row)),...rows];
    return next;
  }
  let {source}=unit;
  const parsed=parseScript(source), init=parsed.events.init?.[0];
  const snippet=formatScript({events:{init:[group(rows)]}}).trimEnd();
  if(init?.op==='init_properties'){
    const closing=locations.get(init).to-3;
    const insertion=source.lastIndexOf('\n',closing-1)+1;
    const edits=init.body.filter(matches).map(row=>{
      const {from,to}=locations.get(row);
      return [source.lastIndexOf('\n',from-1)+1,source.indexOf('\n',to)+1,''];
    });
    edits.push([insertion,insertion,snippet.split('\n').slice(2,-2).join('\n')+'\n']);
    for(const [start,end,text] of edits.sort((a,b)=>b[0]-a[0]))
      source=source.slice(0,start)+text+source.slice(end);
  }else{
    const header=/^[ \t]*on[ \t]+init[ \t]*(?:#[^\n]*)?\r?\n/m.exec(source);
    if(header){
      const split=header.index+header[0].length;
      source=source.slice(0,split)+snippet.split('\n').slice(1,-1).join('\n')+'\n'+source.slice(split);
    }else source=source.trimEnd()+'\n\n'+snippet+'\n';
  }
  return {...parseScript(source),source,layout:unit.layout};
}
