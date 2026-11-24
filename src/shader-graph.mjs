const port=(name,type,fallback)=>({name,type,fallback});
const scalar=(name,value=0)=>port(name,'float',value);
const numeric=(name,value=0)=>port(name,'number',value);
const vector=(name,value=[0,0])=>port(name,'vec2',value);
const color=(name,value=[0,0,0,1])=>port(name,'vec4',value);
const source=(label,type,value)=>({label,type,value,ports:[]});
const node=(label,type,ports,emit)=>({label,type,ports,emit});
const binary=(label,symbol)=>node(label,'number',[numeric('A'),numeric('B',1)],
  ([a,b])=>symbol.length===1?`(${a} ${symbol} ${b})`:`${symbol}(${a}, ${b})`);
const unary=(label,symbol)=>node(label,'number',[numeric('Value')],([value])=>symbol+'('+value+')');
const component=(label,axis,type='vector')=>node(label,'float',[port('Vector',type,[0,0,0,1].slice(0,type==='vec4'?4:2))],
  ([value])=>value+'.'+axis);
const noise=`
float waffle_noise(vec2 point) {
  vec2 cell = floor(point);
  vec2 edge = fract(point);
  vec2 t = edge * edge * (3.0 - 2.0 * edge);
  vec4 hash = fract(sin(vec4(dot(cell, vec2(127.1, 311.7))) + vec4(0.0, 127.1, 311.7, 438.8)) * 43758.5453);
  return mix(mix(hash.x, hash.y, t.x), mix(hash.z, hash.w, t.x), t.y);
}`;

export const shaderNodes={
  uv:source('UV coordinates','vec2'),
  time:source('Time','float'),
  resolution:source('Resolution','vec2'),
  screen:node('Sample screen','vec4',[vector('UV','uv')],([uv])=>'texture(screen, '+uv+')'),
  float:source('Number','float','float'),
  vec2:source('Vector','vec2','vec2'),
  color:source('Color','vec4','color'),
  boolean:source('Boolean','bool','boolean'),
  parameter:source('Number parameter','float','float'),
  vector_parameter:source('Vector parameter','vec2','vec2'),
  color_parameter:source('Color parameter','vec4','color'),
  add:binary('Add','+'),
  subtract:binary('Subtract','-'),
  multiply:binary('Multiply','*'),
  divide:binary('Divide','/'),
  modulo:binary('Modulo','mod'),
  min:binary('Minimum','min'),
  max:binary('Maximum','max'),
  pow:binary('Power','pow'),
  sin:unary('Sine','sin'),
  cos:unary('Cosine','cos'),
  abs:unary('Absolute value','abs'),
  sqrt:unary('Square root','sqrt'),
  floor:unary('Floor','floor'),
  fract:unary('Fractional part','fract'),
  mix:node('Mix','number',[numeric('From'),numeric('To',1),scalar('Amount',0.5)],([a,b,t])=>`mix(${a}, ${b}, ${t})`),
  clamp:node('Clamp','number',[numeric('Value'),numeric('Minimum'),numeric('Maximum',1)],args=>'clamp('+args.join(', ')+')'),
  step:node('Step','float',[scalar('Edge',0.5),scalar('Value')],args=>'step('+args.join(', ')+')'),
  smoothstep:node('Smooth step','float',[scalar('Start'),scalar('End',1),scalar('Value')],args=>'smoothstep('+args.join(', ')+')'),
  combine:node('Make vector','vec2',[scalar('X'),scalar('Y')],args=>'vec2('+args.join(', ')+')'),
  rgba:node('Make color','vec4',[scalar('Red'),scalar('Green'),scalar('Blue'),scalar('Alpha',1)],args=>'vec4('+args.join(', ')+')'),
  x:component('X / red','x'),
  y:component('Y / green','y'),
  z:component('Blue','z','vec4'),
  w:component('Alpha','w','vec4'),
  length:node('Length','float',[port('Vector','vector',[0,0])],args=>'length('+args.join(', ')+')'),
  normalize:node('Normalize','vec2',[vector('Vector',[1,0])],args=>'normalize('+args.join(', ')+')'),
  dot:node('Dot product','float',[vector('A'),vector('B')],args=>'dot('+args.join(', ')+')'),
  noise:node('Soft noise','float',[vector('UV','uv')],args=>'waffle_noise('+args.join(', ')+')'),
  less:node('Less than','bool',[scalar('A'),scalar('B',0.5)],([a,b])=>`(${a} < ${b})`),
  select:node('Select','number',[port('If','bool',false),numeric('Then',1),numeric('Else')],([test,a,b])=>`(${test} ? ${a} : ${b})`),
};
const parameters=new Set(['parameter','vector_parameter','color_parameter']);
export const isShaderParameter=kind=>parameters.has(kind);
export const MAX_SHADER_NODES=64;
export const shaderTypeLabels={float:'Number',vec2:'Vector',vec4:'Color',bool:'Boolean',vector:'Vector or color',number:'Number, vector, or color'};
export const acceptsShaderType=(expected,actual)=>expected===actual||expected==='number'&&actual!=='bool'||
  expected==='vector'&&['vec2','vec4'].includes(actual);
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e6;
const float=value=>String(value)+(/[.e]/i.test(String(value))?'':'.0');
const literal=(value,type)=>typeof value==='boolean'?String(value):Array.isArray(value)?type+'('+value.map(float).join(', ')+')':float(value);
const named=/^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const reserved=new Set(['resolution','time','delta_time']);
const inputId=/^n[1-9]\d{0,4}$/;

export function makeShaderNode(id,kind) {
  const spec=shaderNodes[kind];
  const value=spec.value==='vec2'?[0.5,0.5]:spec.value==='color'?'#ffffff':spec.value==='boolean'?false:0.5;
  return {id,kind,inputs:[],...(spec.value?{value}:{}),...(parameters.has(kind)?{name:'value_'+id.slice(1)}:{})};
}

function readValue(spec,node){
  const value=node.value;
  if (spec.value==='float'&&finite(value)) return value;
  if (spec.value==='boolean'&&typeof value==='boolean') return value;
  if (spec.value==='vec2'&&Array.isArray(value)&&value.length===2&&value.every(finite)) return value;
  if (spec.value==='color'&&typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value))
    return [1,3,5].map(index=>parseInt(value.slice(index,index+2),16)/255).concat(1);
  throw Error('Enter a valid '+spec.label.toLowerCase());
}

export function analyzeShaderGraph(graph,{inspect=false}={}){
  if(graph?.version!==1||!Array.isArray(graph.nodes)||graph.nodes.length>MAX_SHADER_NODES)
    throw Error('Use a shader graph with up to '+MAX_SHADER_NODES+' nodes');
  const ids=new Map(), definitions=new Map(), exposed=new Map(), order=[], visiting=new Set();
  for(const entry of graph.nodes){
    if(!entry||typeof entry.id!=='string'||!inputId.test(entry.id)||ids.has(entry.id)||
      !Object.hasOwn(shaderNodes,entry.kind)||!Array.isArray(entry.inputs)||entry.inputs.length>shaderNodes[entry.kind].ports.length)
      throw Error('Invalid shader node');
    ids.set(entry.id,entry);
  }
  function visit(id){
    if(definitions.has(id))return definitions.get(id);
    const entry=ids.get(id);
    if(!entry)throw Error('Choose an existing node');
    const spec=shaderNodes[entry.kind];
    const label=spec.label+' '+id.slice(1);
    if(visiting.has(id))throw Error(label+' creates a loop');
    visiting.add(id);
    const values=spec.ports.map(({name,type,fallback},index)=>{
      const link=entry.inputs[index];
      const chosen=link==null
        ? {type:fallback==='uv'?'vec2':Array.isArray(fallback)?'vec'+fallback.length:typeof fallback==='boolean'?'bool':'float',
            reference:fallback==='uv'?'uv':literal(fallback,Array.isArray(fallback)?'vec'+fallback.length:'float')}
        : visit(link);
      if(!acceptsShaderType(type,chosen.type))
        throw Error(label+' · '+name+' needs '+shaderTypeLabels[type].toLowerCase());
      return chosen;
    });
    const vectors=new Set(values.filter(({type},index)=>spec.ports[index].type==='number'&&type!=='float').map(({type})=>type));
    if(vectors.size>1)throw Error(label+' needs matching vector dimensions');
    const type=spec.type==='number'?vectors.values().next().value??'float':spec.type;
    const args=values.map(({type:actual,reference},index)=>spec.ports[index].type==='number'&&actual==='float'&&type!=='float'?type+'('+reference+')':reference);
    let expression;
    if(spec.value){
      const value=readValue(spec,entry);
      if(parameters.has(entry.kind)){
        const name=entry.name;
        if(typeof name!=='string'||!named.test(name)||name.startsWith('gl_')||name.includes('__')||reserved.has(name)||exposed.has(name))
          throw Error(label+' needs a unique parameter name');
        exposed.set(name,{type,value:Array.isArray(value)?value:[value]});
        expression='params.'+name;
      }else expression=literal(value,type);
    }else if(entry.kind==='uv')expression='uv';
    else if(['time','resolution'].includes(entry.kind))expression='params.'+entry.kind;
    else expression=spec.emit(args);
    const definition={type,expression,reference:'node_'+id,entry,dependencies:entry.inputs.filter(link=>link!=null)};
    definitions.set(id,definition);
    order.push(definition);
    visiting.delete(id);
    return definition;
  }
  if(inspect){
    const errors=new Map();
    for(const id of ids.keys()){
      try{visit(id);}
      catch(error){errors.set(id,error.message);visiting.clear();}
    }
    return {definitions,errors};
  }
  if(!graph.output)throw Error('Connect a color node to Fragment output');
  const output=visit(graph.output);
  if(output.type!=='vec4')throw Error('Connect a color node to Fragment output');
  for(const id of ids.keys())visit(id);

  // Leave unused branches out of the generated shader.
  const used=new Set();
  function mark(id){
    if(used.has(id))return;
    used.add(id);
    definitions.get(id).dependencies.forEach(mark);
  }
  mark(graph.output);
  return {order:order.filter(definition=>used.has(definition.entry.id)),definitions,exposed,output};
}

export function shaderSource(graph){
  const {order,exposed,output}=analyzeShaderGraph(graph);
  const types=new Set(order.map(({entry})=>entry.kind));
  const uniforms=[];
  if(types.has('resolution'))uniforms.push('vec2 resolution;');
  if(types.has('time'))uniforms.push('float time;');
  const defaults=Object.create(null);
  for(const {entry} of order){
    if(!parameters.has(entry.kind))continue;
    const {type,value}=exposed.get(entry.name);
    uniforms.push(type+' '+entry.name+';');
    defaults[entry.name]=value;
  }
  if(uniforms.reduce((size,member)=>size+(member.startsWith('vec4')?16:member.startsWith('vec2')?8:4),0)>224)
    throw Error('Use fewer shader parameters');
  const source=['#version 450','layout(location=1) in vec2 uv;', 'layout(location=0) out vec4 fragment_color;'];
  const previewSource=['#version 300 es','precision highp float;','in vec2 uv;', 'out vec4 fragment_color;'];
  if(types.has('screen'))source.push('layout(set=2, binding=0) uniform sampler2D screen;');
  if(types.has('screen'))previewSource.push('uniform sampler2D screen;');
  if(uniforms.length)source.push('layout(std140, set=3, binding=0) uniform Parameters {',...uniforms.map(line=>'  '+line),'} params;');
  if(uniforms.length)previewSource.push('struct Parameters {',...uniforms.map(line=>'  '+line),'};','uniform Parameters params;');
  const body=[...(types.has('noise')?[noise]:[]),'void main() {',
    ...order.map(({type,reference,expression})=>`  ${type} ${reference} = ${expression};`),
    '  fragment_color = '+output.reference+';','}'];
  return {source:[...source,...body].join('\n'),previewSource:[...previewSource,...body].join('\n'),defaults};
}

export const shaderStarters={empty:'Screen color',crt:'Moving scanlines',mist:'Drifting mist',day:'Day and night'};
export function starterShader(kind) {
  const nodes=[];
  const add=(kind,inputs=[],value,name)=>{
    const entry=makeShaderNode('n'+(nodes.length+1),kind);
    if(value!==undefined)entry.value=value;
    if(name!==undefined)entry.name=name;
    entry.inputs=inputs;
    nodes.push(entry);
    return entry.id;
  };
  const screen=add('screen');
  let output=screen;
  if(kind==='crt'){
    const rows=add('multiply',[add('y',[add('uv')]),add('y',[add('resolution')])]);
    const motion=add('multiply',[add('time'),add('parameter',[],2,'speed')]);
    const phase=add('multiply',[add('add',[rows,motion]),add('float',[],3.14159265)]);
    const wave=add('multiply',[add('add',[add('cos',[phase]),add('float',[],1)]),add('float',[],0.5)]);
    const dark=add('multiply',[screen,add('subtract',[add('float',[],1),add('parameter',[],0.22,'strength')])]);
    output=add('mix',[screen,dark,wave]);
  }else if(kind==='mist'){
    const scroll=add('multiply',[add('time'),add('parameter',[],0.18,'speed')]);
    const coords=add('add',[add('multiply',[add('uv'),add('vec2',[],[5,4])]),add('combine',[scroll])]);
    const ground=add('smoothstep',[add('float',[],0.05),add('float',[],0.9),add('y',[add('uv')])]);
    const amount=add('multiply',[add('multiply',[add('noise',[coords]),ground]),add('parameter',[],0.7,'density')]);
    output=add('mix',[screen,add('color_parameter',[],'#bac8dd','mist_color'),amount]);
  }else if(kind==='day'){
    const angle=add('multiply',[add('time'),add('parameter',[],0.4,'speed')]);
    const darkness=add('multiply',[add('add',[add('cos',[angle]),add('float',[],1)]),add('float',[],0.5)]);
    const night=add('multiply',[screen,add('color_parameter',[],'#5270a6','night_color')]);
    output=add('mix',[screen,night,darkness]);
  }
  return {version:1,nodes,output};
}
