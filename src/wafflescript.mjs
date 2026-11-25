import {Blocks,Events,controlTransfers,inputEvent,receivedEvent,timerEvent,controllerEvent} from './schema.mjs';
import {binaryMath, conditionalBranches, constantType, formatParameters, maxParameters, parseParameters, scopes, unaryMath} from './script.mjs';
import {validResourceText} from './resource-tables.mjs';

const symbols = {or:'or',and:'and','==':'equal','!=':'not_equal','<':'less','<=':'less_equal','>':'greater','>=':'greater_equal','+':'add','-':'subtract','*':'multiply','/':'divide','%':'remainder'};
const precedence = {or:1,and:2,'==':3,'!=':3,'<':3,'<=':3,'>':3,'>=':3,'+':4,'-':4,'*':5,'/':5,'%':5};
const operators = Object.fromEntries(Object.entries(symbols).map(([a,b])=>[b,a]));
const identifier = /^[A-Za-z_][A-Za-z_0-9]{0,63}$/;
export const locations = new WeakMap();
const constantLocations = new WeakMap();
const detachedComment='#@detached ';
function readDetachedBlocks(source){
  const detached=[];
  if(!source.includes(detachedComment))return detached;
  for(const line of source.split('\n')){
    if(!line.startsWith(detachedComment))continue;
    try{
      const block=JSON.parse(line.slice(detachedComment.length));
      if(block?.type && typeof block.type==='string')detached.push(block);
    }catch{}
  }
  return detached;
}
function error(message,from,to){throw Object.assign(Error(message),{from,to});}

export function parseScript(source){
  const pattern = /[ \t\r]*(?:#[^\n]*|(\n|"(?:\\.|[^"\\\n])*"|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|<=|>=|==|!=|.))?/y;
  const tokens=[];
  while(pattern.lastIndex<source.length){
    const match=pattern.exec(source);
    if(!match[0])break;
    const token=match[1];
    if(token!==undefined)tokens.push({s:token,at:pattern.lastIndex-token.length});
  }
  let i=0;
  const peek=()=>tokens[i]?.s;
  const fail=msg=>error(msg,tokens[i]?.at??source.length,(tokens[i]?.at??source.length)+(peek()?.length??0));
  const eat=s=>peek()===s && (++i,true);
  const need=s=>{if(!eat(s))fail('Expected '+s);};
  const id=()=>{if(!identifier.test(peek()??''))fail('Expected a name');return tokens[i++].s;};
  const qualified=()=>{const name=id();return eat('.')?name+'.'+id():name;};
  function stringLiteral(){
    if(!peek()?.startsWith('"'))fail('Expected a quoted string');
    let value;
    try{value=JSON.parse(peek());}catch{fail('Invalid string');}
    i++;
    return value;
  }
  const eol=()=>{if(peek()!==undefined && !eat('\n'))fail('Start a new line');while(eat('\n')){}};
  const mark=(obj,start)=>{locations.set(obj,{from:start,to:tokens[i-1]?.at+tokens[i-1]?.s.length});return obj;};
  function args(){
    need('(');const values=[];
    if(!eat(')')){
      do{values.push(expr());}while(eat(','));need(')');
    }
    return values;
  }
  function numeric(sign=1){
    const token=tokens[i++].s;
    const result=sign*Number(token);
    if(!Number.isFinite(result))error('Use a finite number',tokens[i-1].at,tokens[i-1].at+token.length);
    return /[.eE]/.test(token)?{real:result}:result;
  }
  function expr(level=0){
    const start=tokens[i]?.at;let value;
    if(eat('(')){value=expr();need(')');}
    else if(eat('not'))value={calc:'not',left:expr(6)};
    else if(eat('-')){if(!/^\d/.test(peek()??''))fail('Expected a number');value=numeric(-1);}
    else if(/^\d/.test(peek()??''))value=numeric();
    else if(peek()?.startsWith('"'))value=stringLiteral();
    else if(eat('none'))value=null;
    else if(eat('true'))value=true;
    else if(eat('false'))value=false;
    else if(peek()==='R'&&tokens[i+1]?.s==='['){
      i+=2;
      const key=stringLiteral();
      if(!identifier.test(key))fail('Expected a resource key');
      need(']');value={text:key};
    }
    else {
      const name=qualified(),[scope,key]=name.split('.');
      if(peek()==='(')value={call:name==='controller_connected'?'entity.controller_connected':name,args:args()};
      else if(key && scopes.includes(scope))value={scope,get:key};
      else if(key && scope==='const')value={constant:key};
      else if(key && scope==='entity')value={actor:key};
      else if(key && scope==='R')value={text:key};
      else if(key && ['item','button','actor','action','pressed','released','text'].includes(scope))value={[scope]:key};
      else if(!key)value={param:name};
      else fail('Unknown name '+name);
    }
    while((precedence[peek()]??0)>level){
      const op=tokens[i++].s;
      value={calc:symbols[op],left:value,right:expr(precedence[op])};
    }
    return value!==null && typeof value==='object'?mark(value,start):value;
  }
  function body(){
    const rows=[];
    function branch(start){
      const condition=expr();eat('then');eol();
      return mark({op:'if',condition,body:body()},start);
    }
    while(peek()!==undefined && !['end','else','elif'].includes(peek())){
      const start=tokens[i].at;let row;
      if(peek()==='init_properties'&&tokens[i+1]?.s==='\n'){
        i++;eol();row={op:'init_properties',body:body()};need('end');
      }else if(peek()==='property'&&identifier.test(tokens[i+1]?.s??'')&&tokens[i+2]?.s==='='){
        i++;const name=id();need('=');row={op:'init_property',name,value:expr()};
      }else if(eat('apply_shaders')){
        eol();
        const passes=[];
        while(!eat('end')){
          const at=tokens[i]?.at??source.length;
          need('shader');need('(');
          const shader=expr(),parameters=Object.create(null);
          if(typeof shader!=='string')fail('Choose a shader asset name');
          while(eat(',')){
            const name=peek()?.startsWith('"')?expr():id();
            if(typeof name!=='string'||Object.hasOwn(parameters,name))fail('Use each shader parameter once');
            need(':');
            if(eat('[')){
              const values=[expr()];
              while(eat(','))values.push(expr());
              need(']');parameters[name]=values;
            }else parameters[name]=[expr()];
          }
          need(')');eol();
          passes.push(mark({shader,parameters},at));
          if(passes.length>8)fail('Use up to eight passes in a pipeline');
        }
        row={op:'apply_shaders',passes};
      }else if(eat('if')){
        row=branch(start);
        let tail=row;
        while(eat('elif')){
          const next=branch(tokens[i-1].at);
          tail.otherwise=[next];
          tail=next;
        }
        if(eat('else')){eol();tail.otherwise=body();}
        need('end');
      }else if(eat('while')){
        const condition=expr();eol();
        row={op:'while',condition,body:body()};
        need('end');
      }else if(peek()==='repeat' && (tokens[i+1]?.s!=='(' || tokens[i+1].at>tokens[i].at+6)){
        i++;
        const times=expr();eol();row={op:'repeat',times,body:body()};need('end');
      }else if(controlTransfers.includes(peek())){
        const op=id();
        if(eat('('))need(')');
        if(peek()!==undefined&&peek()!=='\n')fail('Use '+op+' without a value');
        row={op};
      }else if(peek()==='change' && scopes.includes(tokens[i+1]?.s) && tokens[i+2]?.s==='.'){
        i++;
        const [scope,name]=qualified().split('.');
        need('by');row={op:'change',scope,name,value:expr()};
      }else {
        const name=qualified();
        if(eat('=')){
          const [scope,key]=name.split('.');
          if(!key || !scopes.includes(scope))fail('Use a variable scope before the name');
          row={op:'set',scope,name:key,value:expr()};
        }else {
          const values=args();
          if(name==='wait' && values.length===1)row={op:'wait',ticks:values[0]};
          else if(Object.hasOwn(Blocks,name)){
            const fields=Blocks[name][1];
            if(values.length>fields.length || fields.slice(values.length).some(f=>f[3]!=='optional'))error(name+' takes '+fields.length+' arguments',start,tokens[i-1].at+1);
            row={op:name,...Object.fromEntries(fields.map(([key],j)=>[key,values[j]??null]))};
          }else row={op:'call',name,args:values};
        }
      }
      rows.push(mark(row,start));eol();
    }
    return rows;
  }
  const events=Object.create(null), routines=Object.create(null),constants=Object.create(null),imports=[],declarations=[];
  const game=Object.fromEntries(['globals','flags','events','controls','menus','resources'].map(kind=>[kind,Object.create(null)]));
  const collections={types:Object.create(null),inventories:Object.create(null),arrays:Object.create(null)};
  while(eat('\n')){}
  while(peek()!==undefined){
    const start=tokens[i].at;
    if(eat('use')){imports.push(id());eol();continue;}
    if(eat('object')){
      const name=id(),fields=Object.create(null);
      if(Object.hasOwn(collections.types,name))fail('Object type already exists');
      eol();
      while(!eat('end')){
        const field=id();if(Object.hasOwn(fields,field))fail('Duplicate object property');
        need(':');const type=id();fields[field]={type,...(eat('=')?{default:expr()}:{})};eol();
      }
      collections.types[name]=fields;eol();continue;
    }
    if(['game_properties','player_properties'].includes(peek())){
      const root=tokens[i++].s==='game_properties'?'game':'players';
      if(collections[root])fail('Properties already have an object type');
      need(':');collections[root]=id();eol();continue;
    }
    if(['inventory','array'].includes(peek())){
      const kind=tokens[i++].s,name=id(),group=kind==='inventory'?collections.inventories:collections.arrays;
      if(Object.hasOwn(group,name))fail('Collection name already exists');
      need(':');
      if(kind==='inventory'){const types=[id()];while(eat(','))types.push(id());group[name]=types;}
      else group[name]=id();
      eol();continue;
    }
    if(['input','menu'].includes(peek())){
      const kind=tokens[i++].s,name=id(),group=kind==='input'?game.controls:game.menus;
      if(Object.hasOwn(group,name))fail('Use a unique '+kind+' name');
      need('=');
      const read=kind==='input'?id:expr;
      const entries=[read()];while(eat(','))entries.push(read());
      if(kind==='menu'&&(entries.length<2||entries.some(label=>typeof label!=='string')))
        fail('Give the menu a title and one or more text options');
      group[name]=kind==='input'?entries:{title:entries[0],options:entries.slice(1)};
      eol();continue;
    }
    if(eat('resource')){
      const name=id();need('=');
      const text=expr();
      if(Object.hasOwn(game.resources,name)||!validResourceText(text))
        fail('Give each resource a unique name and a quoted string of up to 4096 bytes');
      game.resources[name]=text;eol();continue;
    }
    if(['global','flag','event'].includes(peek())){
      const kind=tokens[i++].s,name=id();
      const values=game[{global:'globals',flag:'flags',event:'events'}[kind]];
      const literal=kind==='event'?(eat('=')?expr():name.replaceAll('_',' ')):(need('='),expr());
      if(Object.hasOwn(values,name)||!constantType(literal)||(kind==='flag'&&typeof literal!=='boolean')||
        (kind==='event'&&(typeof literal!=='string'||!literal.trim()||literal.length>100)))
        fail('Use a unique name and a valid '+kind+' value');
      values[name]=literal;eol();continue;
    }
    if(eat('const')){
      const name=id();need('=');
      const literal=expr();
      if(Object.hasOwn(constants,name)||!constantType(literal))fail('Give each constant a unique name and a literal value');
      constants[name]=literal;
      declarations.push([start,tokens[i-1].at+tokens[i-1].s.length]);
      eol();continue;
    }
    if(eat('on')){
      let name;
      if(['after','every'].includes(peek())&&/^\d/.test(tokens[i+1]?.s??'')){
        const mode=id(),seconds=Number(tokens[i++].s);
        need('seconds');name=mode+'.'+Math.round(seconds*60);
        if(!timerEvent(name))fail('Use a timer between one tick and six hours');
      }else if(eat('controller')){
        const edge=id(),player=peek();
        if(!/^[1-4]$/.test(player??''))fail('Choose player 1 to 4.');
        i++;name='controller_'+edge+'.'+player;
      }else name=eat('game')?(need('startup'),'game_startup'):eat('collide')?'begin_contact':eat('clone')?'clone_start':qualified();
      if(!Events.includes(name)&&!inputEvent(name)&&!receivedEvent(name)&&!timerEvent(name)&&!controllerEvent(name)||Object.hasOwn(events,name))error('Unknown or duplicate event '+name,start,tokens[i-1].at+name.length);
      eol();events[name]=body();
    }else if(eat('def') || eat('proc')){
      const kind=tokens[i-1].s,name=id(),params=[];need('(');
      if(!eat(')')){
        do {
          const param=id();
          params.push(eat(':')?param+': '+id():param);
        } while(eat(','));
        need(')');
      }
      let signature;
      try{signature=parseParameters(params.join(', '));}catch(err){fail(err.message);}
      if(Object.hasOwn(routines,name) || params.length>maxParameters)fail('Use a unique routine name');
      eol();let routine;
      if(kind==='def'){need('return');routine={...signature,result:expr()};eol();}
      else routine={...signature,body:body()};
      routines[name]=mark(routine,start);
    }else fail('Expected a declaration, routine, or event handler');
    need('end');eol();
  }
  const detached=readDetachedBlocks(source);
  const script={events,routines,imports,...(declarations.length?{constants}:{}),
    ...(Object.values(game).some(group=>Object.keys(group).length)?{declarations:game}:{}),
    ...(Object.values(collections).some(group=>Object.keys(group).length)?{collections}:{}),...(detached.length?{detached}:{})};
  constantLocations.set(script,declarations);
  return script;
}

function value(v){
  if(v===null)return 'none';
  if(typeof v!=='object')return JSON.stringify(v);
  if(v.real!==undefined) {
    const text=String(v.real);
    return /[.eE]/.test(text)?text:text+'.0';
  }
  if(v.call)return v.call+'('+v.args.map(value).join(', ')+')';
  if(v.param)return v.param;
  if(v.constant!=null)return 'const.'+v.constant;
  if(v.get)return v.scope+'.'+v.get;
  if(v.text!==undefined)return identifier.test(v.text)?'R.'+v.text:'R['+JSON.stringify(v.text)+']';
  if(v.actor)return "entity."+v.actor;
  if(v.pressed)return 'pressed.'+v.pressed;
  if(v.released)return 'released.'+v.released;
  if(v.action)return 'action.'+v.action;
  if(v.button || v.item)return v.button?'button.'+v.button:'item.'+v.item;
  if(v.calc==='not')return '(not '+value(v.left)+')';
  if(unaryMath.includes(v.calc))return 'math.'+v.calc+'('+value(v.left)+')';
  if(binaryMath.includes(v.calc))return 'math.'+v.calc+'('+value(v.left)+', '+value(v.right)+')';
  return '('+value(v.left)+' '+operators[v.calc]+' '+value(v.right)+')';
}
const constantLines=constants=>Object.entries(constants??{}).map(([name,literal])=>'const '+name+' = '+value(literal));
export function replaceScriptConstants(source,script,constants){
  const ranges=constantLocations.get(script)??[];
  for(const [from,to] of [...ranges].reverse()){
    const start=source.lastIndexOf('\n',from-1)+1;
    const end=source.indexOf('\n',to);
    if(!source.slice(to,end===-1?undefined:end).trim())
      source=source.slice(0,start)+source.slice(end===-1?source.length:end+1);
    else source=source.slice(0,from)+source.slice(to);
  }
  const lines=constantLines(constants);
  if(!lines.length)return source;
  const separator=source&&!source.startsWith('\n')?'\n\n':'\n';
  return lines.join('\n')+separator+source;
}
export function formatScript(script){
  const lines=[];
  function body(rows,n){
    const pad='  '.repeat(n);
    for(const b of rows){
      if(b.op==='init_properties'){
        lines.push(pad+'init_properties');body(b.body,n+1);lines.push(pad+'end');continue;
      }
      if(b.op==='init_property'){
        lines.push(pad+'property '+b.name+' = '+value(b.value));continue;
      }
      if(b.op==='apply_shaders'){
        lines.push(pad+'apply_shaders');
        for(const pass of b.passes){
          const args=[JSON.stringify(pass.shader),...Object.entries(pass.parameters??{}).map(([key,values])=>
            (identifier.test(key)?key:JSON.stringify(key))+': '+(values.length===1?value(values[0]):'['+values.map(value).join(', ')+']'))];
          lines.push(pad+'  shader('+args.join(', ')+')');
        }
        lines.push(pad+'end');continue;
      }
      if(b.op==='if'){
        const {branches,otherwise}=conditionalBranches(b);
        for(const [index,branch] of branches.entries()){
          lines.push(pad+(index?'elif':'if')+' '+value(branch.condition)+' then');
          body(branch.body,n+1);
        }
        if(otherwise){lines.push(pad+'else');body(otherwise,n+1);}
        lines.push(pad+'end');continue;
      }
      if(b.op==='while'||b.op==='repeat'){
        lines.push(pad+b.op+' '+value(b.op==='repeat'?b.times:b.condition));body(b.body,n+1);
        lines.push(pad+'end');continue;
      }
      let line;
      if(b.op==='set')line=b.scope+'.'+b.name+' = '+value(b.value);
      else if(b.op==='change')line='change '+b.scope+'.'+b.name+' by '+value(b.value);
      else if(b.op==='wait')line='wait('+value(b.ticks)+')';
      else if(controlTransfers.includes(b.op))line=b.op;
      else if(b.op==='call')line=b.name+'('+b.args.map(value).join(', ')+')';
      else line=b.op+'('+Blocks[b.op][1].map(([key,,fallback,optional])=>value(Object.hasOwn(b,key)?b[key]:optional?null:fallback)).join(', ')+')';
      lines.push(pad+line);
    }
  }
  for(const name of script.imports??[])lines.push('use '+name);
  for(const [kind,collection] of [['global','globals'],['flag','flags'],['event','events']]){
    for(const [name,literal] of Object.entries(script.declarations?.[collection]??{}))lines.push(kind+' '+name+' = '+value(literal));
  }
  for(const [name,literal] of Object.entries(script.declarations?.resources??{}))lines.push('resource '+name+' = '+value(literal));
  for(const [name,keys] of Object.entries(script.declarations?.controls??{}))lines.push('input '+name+' = '+keys.join(', '));
  for(const [name,menu] of Object.entries(script.declarations?.menus??{}))
    lines.push('menu '+name+' = '+[menu.title,...menu.options].map(value).join(', '));
  for(const [name,fields] of Object.entries(script.collections?.types??{})){
    lines.push('object '+name);
    for(const [field,config] of Object.entries(fields))lines.push('  '+field+': '+config.type+(Object.hasOwn(config,'default')?' = '+value(config.default):''));
    lines.push('end','');
  }
  for(const [name,types] of Object.entries(script.collections?.inventories??{}))lines.push('inventory '+name+': '+types.join(', '));
  for(const [name,type] of Object.entries(script.collections?.arrays??{}))lines.push('array '+name+': '+type);
  if(script.collections?.game)lines.push('game_properties: '+script.collections.game);
  if(script.collections?.players)lines.push('player_properties: '+script.collections.players);
  const constants=constantLines(script.constants);
  if(constants.length)lines.push(...constants,'');
  for(const [name,r] of Object.entries(script.routines??{})){
    lines.push((r.body?'proc ':'def ')+name+'('+formatParameters(r)+')');
    if(r.body)body(r.body,1);else lines.push('  return '+value(r.result));
    lines.push('end','');
  }
  for(const [name,rows] of Object.entries(script.events??{})){
    const [kind,ticks]=name.split('.');
    const label=name==='game_startup'?'game startup':name==='clone_start'?'clone':controllerEvent(name)?kind.replace('_',' ')+' '+ticks:
      timerEvent(name)?kind+' '+Number((Number(ticks)/60).toFixed(6))+' seconds':name;
    lines.push('on '+label);body(rows,1);lines.push('end','');
  }
  for(const block of script.detached??[])lines.push(detachedComment+JSON.stringify(block));
  return lines.join('\n');
}
