import {Blocks,Events,inputEvent,receivedEvent} from './schema.mjs';
import {binaryMath, conditionalBranches, constantType, formatParameters, maxParameters, parseParameters, scopes, unaryMath} from './script.mjs';

const symbols = {or:'or',and:'and','==':'equal','!=':'not_equal','<':'less','<=':'less_equal','>':'greater','>=':'greater_equal','+':'add','-':'subtract','*':'multiply','/':'divide','%':'remainder'};
const precedence = {or:1,and:2,'==':3,'!=':3,'<':3,'<=':3,'>':3,'>=':3,'+':4,'-':4,'*':5,'/':5,'%':5};
const operators = Object.fromEntries(Object.entries(symbols).map(([a,b])=>[b,a]));
const identifier = /^[A-Za-z_][A-Za-z_0-9]{0,63}$/;
export const locations = new WeakMap();
const constantLocations = new WeakMap();
const detachedComment='#@detached ';
function readDetachedBlocks(source){
  const detached=[];
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
  const pattern = /[ \t\r]+|#[^\n]*|\n|"(?:\\.|[^"\\\n])*"|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|<=|>=|==|!=|./gy;
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
    else if(peek()?.startsWith('"')){try{value=JSON.parse(tokens[i].s);}catch{fail('Invalid string');}i++;}
    else if(eat('none'))value=null;
    else if(eat('true'))value=true;
    else if(eat('false'))value=false;
    else {
      const name=qualified(),[scope,key]=name.split('.');
      if(peek()==='(')value={call:name,args:args()};
      else if(key && scopes.includes(scope))value={scope,get:key};
      else if(key && scope==='const')value={constant:key};
      else if(key && scope==='entity')value={actor:key};
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
      const condition=expr();eol();
      return mark({op:'if',condition,body:body()},start);
    }
    while(peek()!==undefined && !['end','else','elif'].includes(peek())){
      const start=tokens[i].at;let row;
      if(eat('if')){
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
  while(eat('\n')){}
  while(peek()!==undefined){
    const start=tokens[i].at;
    if(eat('use')){imports.push(id());eol();continue;}
    if(eat('const')){
      const name=id();need('=');
      const literal=expr();
      if(Object.hasOwn(constants,name)||!constantType(literal))fail('Give each constant a unique name and a literal value');
      constants[name]=literal;
      declarations.push([start,tokens[i-1].at+tokens[i-1].s.length]);
      eol();continue;
    }
    if(eat('on')){
      const name=qualified();
      if(!Events.includes(name)&&!inputEvent(name)&&!receivedEvent(name)||Object.hasOwn(events,name))error('Unknown or duplicate event '+name,start,tokens[i-1].at+name.length);
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
    }else fail('Expected on, const, use, proc, or def');
    need('end');eol();
  }
  const detached=readDetachedBlocks(source);
  const script={events,routines,imports,...(declarations.length?{constants}:{}),...(detached.length?{detached}:{})};
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
  if(v.text)return 'text.'+v.text;
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
      if(b.op==='if'){
        const {branches,otherwise}=conditionalBranches(b);
        for(const [index,branch] of branches.entries()){
          lines.push(pad+(index?'elif':'if')+' '+value(branch.condition));
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
      else if(b.op==='call')line=b.name+'('+b.args.map(value).join(', ')+')';
      else line=b.op+'('+Blocks[b.op][1].map(([key,,fallback,optional])=>value(Object.hasOwn(b,key)?b[key]:optional?null:fallback)).join(', ')+')';
      lines.push(pad+line);
    }
  }
  for(const name of script.imports??[])lines.push('use '+name);
  const constants=constantLines(script.constants);
  if(constants.length)lines.push(...constants,'');
  for(const [name,r] of Object.entries(script.routines??{})){
    lines.push((r.body?'proc ':'def ')+name+'('+formatParameters(r)+')');
    if(r.body)body(r.body,1);else lines.push('  return '+value(r.result));
    lines.push('end','');
  }
  for(const [name,rows] of Object.entries(script.events??{})){lines.push('on '+name);body(rows,1);lines.push('end','');}
  for(const block of script.detached??[])lines.push(detachedComment+JSON.stringify(block));
  return lines.join('\n');
}
