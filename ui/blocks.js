import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as English from 'blockly/msg/en';
import { Events, Blocks,buttons,inputEvent } from '../src/schema.mjs';
import { logicDefinitions, logicStatements, readValue, writeValue } from './logic-blocks.js';

Blockly.setLocale(English);

const labels = {use_item:"Use item",restored:'Load saved game',start:'Room start',tick:'Every tick',a:'Press A',b:'Press B',x:'Press X',menu:'Press Start',
  begin_contact:'Contact begins',end_contact:'Contact ends',damage:'Receive damage',destroy:'Destroyed'};
const colors = {burst:24,emit:24,stop_fx:24,remove_self:187,camera:218,follow:218,release_camera:218,give:45,take:45,counter:286,hide:286,say:286,walk:218,jump:218,velocity:218,damage:354,fire:354,chase:159,animate:280,sound:37,room:159,spawn:187};
const eventBlock = 'waffle_event';

function blockDefinition(id) {
  const [message,fields] = Blocks[id];
  return {
    type:`waffle_${id}`, message0:message, colour:colors[id]??218,
    args0:fields.map(([name,type,fallback,optional])=> type === 'number' ? {type:'input_value',name,check:optional?['WaffleValue','WaffleNone']:'WaffleValue'}
      : Array.isArray(type) ? {type:'field_dropdown',name,options:type.map(value=>[value.replaceAll('_',' '),value])}
      : {type:'field_input',name,text:fallback}),
    inputsInline:true,previousStatement:'waffle', nextStatement:'waffle',
  };
}
Blockly.defineBlocksWithJsonArray([
  { type:eventBlock, message0:'When %1', args0:[{type:'field_dropdown',name:'event',options:Events.map(id=>[labels[id],id])}],
    nextStatement:'waffle',colour:41,tooltip:'Starts a stack of blocks when this event occurs.' },
  ...Object.keys(Blocks).filter(id=>id!=='spawn').map(blockDefinition),
  ...logicDefinitions(),
  {type:'waffle_tick',message0:'On tick',nextStatement:'waffle',colour:41},
  {type:'waffle_use',message0:'Use module %1',args0:[{type:'field_input',name:'name',text:'common'}],colour:200},
  {type:'waffle_proc',message0:'Procedure %1 parameters %2',args0:[{type:'field_input',name:'name',text:'apply'},{type:'field_input',name:'params',text:''}],nextStatement:'waffle',colour:200},
  {type:'waffle_fn',message0:'Function %1 parameters %2 return %3',args0:[
    {type:'field_input',name:'name',text:'double'},{type:'field_input',name:'params',text:'amount'},
    {type:'input_value',name:'result',check:'WaffleValue'}],colour:200},
]);
const registries=new WeakMap();
const inputHat='waffle_input_event';
function menu(field,values,empty){
  return {type:'field_dropdown',name:field,options:values.length?values.map(value=>[value==='menu'?'Start':value,value]):[[empty,'']]};
}
function registry(block){return registries.get(block.workspace.targetWorkspace??block.workspace)??{items:[],actions:buttons,sprites:[]};}
Blockly.Blocks[inputHat]={init(){this.jsonInit({type:inputHat,message0:'When %1 is %2',args0:[menu('action',registry(this).actions,'Select action'),{type:'field_dropdown',name:'edge',options:[['pressed','pressed'],['released','released']]}],nextStatement:'waffle',colour:41});}};
for(const [id,[,fields]] of Object.entries(Blocks)){
  if(!fields.some(([key])=>key==='sprite'||key==='item'||key==='tag'))continue;
  Blockly.Blocks['waffle_'+id]={init(){
    const spec=blockDefinition(id),data=registry(this);
    fields.forEach(([key],i)=>{
      if(key==='sprite')spec.args0[i]=menu(key,data.sprites,'Create an actor');
      if(key==='tag')spec.args0[i]={type:'field_dropdown',name:key,options:()=>data.animations.map(name=>[name,name])};
      if(key==='item')spec.args0[i]=menu(key,data.items,'Register an item');
    });
    this.jsonInit(spec);
  }};
}
for(const [id,key] of [['pressed','actions'],['released','actions'],['action','actions'],['item','items']]){
  Blockly.Blocks['waffle_'+id]={init(){const spec=logicDefinitions().find(spec=>spec.type==='waffle_'+id);
    spec.args0[0]=menu(id,registry(this)[key],id==='item'?'Register an item':'Select action');this.jsonInit(spec);
  }};
}
const playerShadow=n=>({type:'waffle_player',fields:{value:String(n)}});
const theme = Blockly.Theme.defineTheme('gamewaffle',{
  name:'gamewaffle',base:Blockly.Themes.Classic,
  componentStyles:{
    workspaceBackgroundColour:'#1e1e2e',toolboxBackgroundColour:'#1b1b26',toolboxForegroundColour:'#ede9e3',
    flyoutBackgroundColour:'#343145',flyoutForegroundColour:'#ede9e3',flyoutOpacity:.98,
    insertionMarkerColour:'#fff3cc',scrollbarColour:'#737087',cursorColour:'#f4c77e',
  },
  fontStyle:{family:'system-ui, sans-serif',weight:'500',size:12},
});
const blocks = ids=>ids.map(id=>({
  kind:'block',type:`waffle_${id}`,
  inputs:Object.fromEntries((Blocks[id]?.[1]??[]).filter(([,type])=>type==='number')
    .map(([key,,value,optional])=>[key,{shadow:optional?writeValue(null):id==='follow_player'?playerShadow(value):writeValue(value)}])),
}));
export function mountBlocks(node, onChange, sprites, items, actions, animations) {
  const workspace = Blockly.inject(node,{
    theme, renderer:'geras', trashcan:true, media:'./blockly-media/',
    grid:{spacing:22,length:2,colour:'#454052',snap:false},
    move:{scrollbars:{horizontal:true,vertical:true},drag:true,wheel:true},
    zoom:{controls:true,wheel:false,startScale:.65,minScale:.3,maxScale:1.6,scaleSpeed:1.15},
    toolbox:{kind:'categoryToolbox',contents:[
      {kind:'category',name:'Events',colour:41,contents:[{kind:'block',type:'waffle_tick'},{kind:'block',type:inputHat},{kind:'block',type:eventBlock}]},
      {kind:'category',name:'Routines',colour:200,contents:blocks(['proc','fn','call','function_call','param','use'])},
      {kind:'category',name:'Input & sensing',colour:156,contents:[...blocks(['pressed','released','action','grounded','actor'])]},
      {kind:'category',name:'Logic',colour:276,contents:[...blocks(['if','while']),{kind:'block',type:'waffle_calc',fields:{operation:'and'}},...blocks(['not','bool','none'])]},
      {kind:'category',name:'Programming',colour:276,contents:blocks(['set','wait','get','integer','button','calc'])},
      {kind:'category',name:'Items',colour:45,contents:blocks(['give','take','item','give_player','take_player','count_player','use_player_item','item_icon'])},
      {kind:'category',name:'Dialogue & HUD',colour:286,contents:blocks(['say','ask','counter','bar','hide'])},
      {kind:'category',name:'Particles',colour:24,contents:blocks(['burst','emit','stop_fx'])},
      {kind:'category',name:'Motion',colour:218,contents:blocks(['apply_gravity','force','impulse','velocity','set_position','jump_force'])},
      {kind:'category',name:'Camera',colour:218,contents:blocks(['follow_player','follow','group_camera','camera'])},
      {kind:'category',name:'Movement helpers',colour:218,contents:blocks(['walk','jump','chase'])},
      {kind:'category',name:'Combat',colour:354,contents:blocks(['damage','fire'])},
      {kind:'category',name:'Room & media',colour:159,contents:blocks(['spawn','remove_self','animate','sound','room','checkpoint','retry_checkpoint'])},
    ]},
  });
  const data={sprites,items,actions,animations:[...animations]};
  registries.set(workspace,data);
  const registryData=data,extraTags=new Set();
  let changing = false;
  workspace.addChangeListener(event=>{
    if (!changing && !event.isUiEvent && [Blockly.Events.BLOCK_CREATE,Blockly.Events.BLOCK_DELETE,Blockly.Events.BLOCK_CHANGE,Blockly.Events.BLOCK_MOVE].includes(event.type)) onChange();
  });
  const observer = new ResizeObserver(()=>Blockly.svgResize(workspace));
  observer.observe(node);
  function load(script) {
    changing = true;
    Blockly.Events.disable();
    try {
      const savedBlocks = Object.entries(script.events ?? {}).map(([event,items],index)=>{
        const position = script.layout?.[event] ?? [34+(index%2)*390,25+Math.floor(index/2)*155];
        const next = encodeStack(items);
        const input=inputEvent(event),[edge,action]=event.split('.');
        return {type:input?inputHat:event==='tick'?'waffle_tick':eventBlock,x:position[0],y:position[1],fields:input?{edge,action}:event==='tick'?{}:{event},...(next ? {next:{block:next}} : {})};
      });
      const add=(key,data)=>{
        const [x,y]=script.layout?.[key]??[34+(savedBlocks.length%2)*390,25+Math.floor(savedBlocks.length/2)*155];
        savedBlocks.push({...data,x,y});
      };
      for(const name of script.imports??[])add('use:'+name,{type:'waffle_use',fields:{name}});
      for(const [name,r] of Object.entries(script.routines??{})){
        const next=r.body && encodeStack(r.body);
        add('routine:'+name,r.body?{type:'waffle_proc',fields:{name,params:r.params.join(', ')},...(next?{next:{block:next}}:{})}:
          {type:'waffle_fn',fields:{name,params:r.params.join(', ')},inputs:{result:{block:writeValue(r.result)}}});
      }
      Blockly.serialization.workspaces.load({blocks:{languageVersion:0,blocks:savedBlocks}},workspace);
    } finally { Blockly.Events.enable(); changing = false; }
  }
  function encodeStack(items) {
    let next;
    for (const {op,...data} of [...items].reverse()) {
      if(op==='animate' && data.tag){extraTags.add(data.tag);if(!registryData.animations.includes(data.tag))registryData.animations.push(data.tag);}
      if(op==='release_camera'){
        next={type:'waffle_follow_player',inputs:{player:{shadow:playerShadow(1)}},...(next?{next:{block:next}}:{})};continue;
      }
      const inputs = {}, fields = {};
      const value = (key,fallback)=>{inputs[key]={block:writeValue(data[key]??fallback)};};
      const stack = key=>{const block=encodeStack(data[key]??[]);if(block)inputs[key]={block};};
      if (logicStatements.has(op)) {
        if(op==='call'){fields.name=data.name;(data.args??[]).forEach((v,i)=>inputs[['a','b'][i]]={block:writeValue(v)});}
        if (op==='set') { fields.scope=data.scope; fields.name=data.name; value('value',0); }
        if (op==='wait') value('ticks',1);
        if (op==='if' || op==='while') { value('condition',0); stack('body'); }
        if (op==='if') stack('otherwise');
      } else if (Object.hasOwn(Blocks,op)) {
        for (const [key,type,fallback,optional] of Blocks[op][1]) {
          if(op==='follow_player' && typeof (data[key]??fallback)==='number')inputs[key]={shadow:playerShadow(data[key]??fallback)};
          else if(optional)inputs[key]={shadow:writeValue(null),...(data[key]!=null?{block:writeValue(data[key])}:{})};
          else if (type==='number') value(key,fallback);
          else fields[key]=data[key]??fallback;
        }
      } else continue;
      next = {type:`waffle_${op}`,fields,inputs,...(next ? {next:{block:next}} : {})};
    }
    return next;
  }
  function decodeStack(first) {
    const result=[];
    for (let block=first;block;block=block.getNextBlock()) {
      const op=block.type.slice(7);
      const field=key=>block.getFieldValue(key);
      const value=(key,fallback)=>block.getInputTargetBlock(key) ? readValue(block.getInputTargetBlock(key)) : fallback;
      const stack=key=>decodeStack(block.getInputTargetBlock(key));
      if(op==='call'){
        if(block.getInputTargetBlock('b')&&!block.getInputTargetBlock('a'))throw Error('Connect the first argument.');
        result.push({op,name:field('name'),args:['a','b'].filter(k=>block.getInputTargetBlock(k)).map(k=>value(k,0))});
      }
      else if (op==='set') result.push({op,scope:field('scope'),name:field('name'),value:value('value',0)});
      else if (op==='wait') result.push({op,ticks:value('ticks',1)});
      else if (op==='if' || op==='while') result.push({op,condition:value('condition',0),body:stack('body'),
        ...(op==='if' ? {otherwise:stack('otherwise')} : {})});
      else result.push({op,...Object.fromEntries(Blocks[op][1].map(([key,type,fallback,optional])=>
        [key,type==='number' ? value(key,optional?null:fallback) : field(key)]))});
    }
    return result;
  }
  function save() {
    const events = {}, layout = {}, routines=Object.create(null),imports=[];
    for (const hat of workspace.getTopBlocks(true)) {
      const name=hat.getFieldValue('name'),position=hat.getRelativeToSurfaceXY();
      if(hat.type==='waffle_use'){imports.push(name);layout['use:'+name]=[position.x,position.y];continue;}
      if(['waffle_proc','waffle_fn'].includes(hat.type)){
        if(Object.hasOwn(routines,name))throw Error('Duplicate routine '+name);
        routines[name]=hat.type==='waffle_proc'?{params:(hat.getFieldValue('params')??'').split(',').map(s=>s.trim()).filter(Boolean),body:decodeStack(hat.getNextBlock())}:
          {params:hat.getFieldValue('params').split(',').map(s=>s.trim()).filter(Boolean),result:readValue(hat.getInputTargetBlock('result'))};
        layout['routine:'+name]=[position.x,position.y];continue;
      }
      if (hat.type !== eventBlock && hat.type!==inputHat && hat.type!=='waffle_tick') throw Error('Connect each loose block to an event before saving');
      const event = hat.type==='waffle_tick'?'tick':hat.type===inputHat?hat.getFieldValue('edge')+'.'+hat.getFieldValue('action'):hat.getFieldValue('event');
      if (Object.hasOwn(events,event)) throw Error(`Use one stack for “${labels[event]??event}”`);
      const p = hat.getRelativeToSurfaceXY();
      layout[event] = [p.x,p.y];
      events[event] = decodeStack(hat.getNextBlock());
    }
    return {events,layout,routines,imports};
  }
  return {load,save,updateRegistry(sprites,items,actions,tags){Object.assign(data,{sprites,items,actions,animations:[...new Set([...tags,...extraTags])]});},draft:()=>Blockly.serialization.workspaces.save(workspace),
    restoreDraft(value){Blockly.Events.disable();try{Blockly.serialization.workspaces.load(value,workspace);}finally{Blockly.Events.enable();}},
    dispose:()=>{observer.disconnect();workspace.dispose();}};
}
