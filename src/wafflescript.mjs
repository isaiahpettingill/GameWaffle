import {Blocks,Events,inputEvent} from './schema.mjs';

const symbols = {or:'or',and:'and','==':'equal','<':'less','<=':'less_equal','+':'add','-':'subtract','*':'multiply','/':'divide','%':'remainder'};
const precedence = {or:1,and:2,'==':3,'<':3,'<=':3,'+':4,'-':4,'*':5,'/':5,'%':5};
const operators = Object.fromEntries(Object.entries(symbols).map(([a,b])=>[b,a]));
const identifier = /^[A-Za-z_][A-Za-z_0-9]{0,63}$/;
export const locations = new WeakMap();
function error(message,from,to){throw Object.assign(Error(message),{from,to});}

export function parseScript(source){
  const pattern = /[ \t\r]+|#[^\n]*|\n|"(?:\\.|[^"\\\n])*"|\d+(?:\.\d+)?|[A-Za-z_]\w*|<=|==|./gy;
  const tokens=[];
  for(const m of source.matchAll(pattern))if(!/^[ \t\r#]/.test(m[0]))tokens.push({s:m[0],at:m.index});
  let i=0;
  const peek=()=>tokens[i]?.s;
  const fail=msg=>error(msg,tokens[i]?.at??source.length,(tokens[i]?.at??source.length)+(peek()?.length??0));
  const eat=s=>peek()===s && (++i,true);
  const need=s=>{if(!eat(s))fail('Expected '+s);};
  const id=()=>{if(!identifier.test(peek()??''))fail('Expected a name');return tokens[i++].s;};
  const qualified=()=>{const name=id();return eat('.')?name+'.'+id():name;};
  const eol=()=>{if(peek()!==undefined && !eat('\n'))fail('Start a new line');while(eat('\n')){}};
  const mark=(obj,start)=>{locations.set(obj,{from:start,to:tokens[i-1]?.at+tokens[i-1]?.s.length});return obj;};
  function args(){
    need('(');const values=[];
    if(!eat(')')){
      do{values.push(expr());}while(eat(','));need(')');
    }
    return values;
  }
  function expr(level=0){
    const start=tokens[i]?.at;let value;
    if(eat('(')){value=expr();need(')');}
    else if(eat('not'))value={calc:'not',left:expr(6)};
    else if(eat('-')){if(!/^\d/.test(peek()??''))fail('Expected a number');value=-Number(tokens[i++].s);}
    else if(/^\d/.test(peek()??''))value=Number(tokens[i++].s);
    else if(peek()?.startsWith('"')){try{value=JSON.parse(tokens[i].s);}catch{fail('Invalid string');}i++;}
    else if(eat('none'))value=null;
    else if(eat('true'))value=true;
    else if(eat('false'))value=false;
    else {
      const name=qualified(),[scope,key]=name.split('.');
      if(peek()==='(')value={call:name,args:args()};
      else if(key && ['local','global','flag'].includes(scope))value={scope,get:key};
      else if(key && ['item','button','actor','action','pressed','released'].includes(scope))value={[scope]:key};
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
    while(peek()!==undefined && !['end','else'].includes(peek())){
      const start=tokens[i].at;let row;
      if(eat('if') || eat('while')){
        const op=tokens[i-1].s,condition=expr();eol();
        row={op,condition,body:body()};
        if(op==='if' && eat('else')){eol();row.otherwise=body();}
        need('end');
      }else {
        const name=qualified();
        if(eat('=')){
          const [scope,key]=name.split('.');
          if(!key || !['local','global','flag'].includes(scope))fail('Use local, global, or flag before the variable name');
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
  const events=Object.create(null), routines=Object.create(null),imports=[];
  while(eat('\n')){}
  while(peek()!==undefined){
    const start=tokens[i].at;
    if(eat('use')){imports.push(id());eol();continue;}
    if(eat('on')){
      const name=qualified();
      if(!Events.includes(name)&&!inputEvent(name)||Object.hasOwn(events,name))error('Unknown or duplicate event '+name,start,tokens[i-1].at+name.length);
      eol();events[name]=body();
    }else if(eat('def') || eat('proc')){
      const kind=tokens[i-1].s,name=id(),params=[];need('(');
      if(!eat(')')){do{params.push(id());}while(eat(','));need(')');}
      if(Object.hasOwn(routines,name) || params.length>2 || new Set(params).size!==params.length)fail('Use a unique name, up to two parameters');
      eol();let routine;
      if(kind==='def'){need('return');routine={params,result:expr()};eol();}
      else routine={params,body:body()};
      routines[name]=mark(routine,start);
    }else fail('Expected on, use, proc, or def');
    need('end');eol();
  }
  return {events,routines,imports};
}

function value(v){
  if(v===null)return 'none';
  if(typeof v!=='object')return JSON.stringify(v);
  if(v.call)return v.call+'('+v.args.map(value).join(', ')+')';
  if(v.param)return v.param;
  if(v.get)return v.scope+'.'+v.get;
  if(v.actor)return "actor."+v.actor;
  if(v.pressed)return 'pressed.'+v.pressed;
  if(v.released)return 'released.'+v.released;
  if(v.action)return 'action.'+v.action;
  if(v.button || v.item)return v.button?'button.'+v.button:'item.'+v.item;
  if(v.calc==='not')return '(not '+value(v.left)+')';
  return '('+value(v.left)+' '+operators[v.calc]+' '+value(v.right)+')';
}
export function formatScript(script){
  const lines=[];
  function body(rows,n){
    const pad='  '.repeat(n);
    for(const b of rows){
      if(b.op==='if'||b.op==='while'){
        lines.push(pad+b.op+' '+value(b.condition));body(b.body,n+1);
        if(b.otherwise?.length){lines.push(pad+'else');body(b.otherwise,n+1);}
        lines.push(pad+'end');continue;
      }
      let line;
      if(b.op==='set')line=b.scope+'.'+b.name+' = '+value(b.value);
      else if(b.op==='wait')line='wait('+value(b.ticks)+')';
      else if(b.op==='call')line=b.name+'('+b.args.map(value).join(', ')+')';
      else line=b.op+'('+Blocks[b.op][1].map(([key,,fallback,optional])=>value(Object.hasOwn(b,key)?b[key]:optional?null:fallback)).join(', ')+')';
      lines.push(pad+line);
    }
  }
  for(const name of script.imports??[])lines.push('use '+name);
  for(const [name,r] of Object.entries(script.routines??{})){
    lines.push((r.body?'proc ':'def ')+name+'('+r.params.join(', ')+')');
    if(r.body)body(r.body,1);else lines.push('  return '+value(r.result));
    lines.push('end','');
  }
  for(const [name,rows] of Object.entries(script.events??{})){lines.push('on '+name);body(rows,1);lines.push('end','');}
  return lines.join('\n');
}
