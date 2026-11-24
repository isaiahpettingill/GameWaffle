import * as Blockly from 'blockly/core';
import * as English from 'blockly/msg/en';
import './block-picker.js';
import {branchBody,branchCondition} from './conditional-block.js';
import { Events, Blocks, buttons, inputEvent, receivedEvent, messageInputs, entityQueries, roomCommands, valueInput } from '../src/schema.mjs';
import {roomShaders} from '../src/room-shaders.mjs';
import { conditionalBranches, parseParameters, variableName } from '../src/script.mjs';
import {callArguments, callBlock, definitionBlock, enclosingRoutine, registerRoutineBlocks, routineParameters, routineSignature} from './routine-blocks.js';
import { argumentInput, logicDefinitions, logicStatements, readValue, slot, queryPicker, referenceSlot, roomReadings } from './logic-blocks.js';

Blockly.setLocale(English);

const groups = {
  events: {name:'Events',color:'#925321',commands:['emit_event']},
  control: {name:'Control',color:'#925321'},
  sensing: {name:'Input & sensing',color:'#22665b'},
  operators: {name:'Operators',color:'#4d6729'},
  variables: {name:'Variables',color:'#8a472f'},
  motion: {name:'Motion',color:'#315d99',commands:['velocity','set_position','move_by','apply_gravity','force','impulse','jump_force','walk','jump','chase']},
  looks: {name:'Looks & sound',color:'#6a499c',commands:['animate','animate_once','flip_sprite_x','flip_sprite_y','set_sprite_rotation','rotate_sprite','set_sprite_shadow','set_health_bar','sound','burst','burst_at','emit','emit_for','stop_fx','say','ask','counter','bar','show_menu','show_inventory']},
  world: {name:'World & camera',color:'#345d79',commands:['spawn','remove_self','room','checkpoint','retry_checkpoint','follow_player','follow','group_camera','camera','release_camera',...roomCommands]},
  items: {name:'Items',color:'#725b26',commands:['use_selected_item','give','take','give_player','take_player','count_player','use_player_item','item_icon']},
  entities: {name:'Entities',color:'#337479',commands:['move_entity','entity_velocity','push_entity','set_respawn','respawn_when','damage_entity','heal_entity','break_entity','remove_entity','add_component','remove_component','set_entity_integer','set_entity_real','set_entity_boolean','set_entity_string']},
  combat: {name:'Combat',color:'#933c56',commands:['damage','fire','fire_projectile']},
  text: {name:'Text',color:'#5a536d',commands:['draw_text','set_hud_font','hide']},
  routines: {name:'Routines',color:'#773e78'},
};
const commandStyles = Object.fromEntries(Object.entries(groups).flatMap(([style,group])=>(group.commands??[]).map(id=>[id,style])));
const eventLabels = {
  start:'room starts', use_item:'an item is used', restored:'a save loads', tick:'every tick',
  a:'A is pressed', b:'B is pressed', x:'X is pressed', menu:'Start is pressed',
  begin_contact:'contact begins', end_contact:'contact ends', damage:'I take damage', destroy:'I am destroyed', animation_finished:'animation finishes', menu_selected:'a menu closes',
};
const worldEvents = Events.filter(id=>id!=='tick' && !buttons.includes(id));
const roomEvents = ['start','restored','menu_selected'];
const eventBlock = 'waffle_event', worldHat = 'waffle_world_event', roomHat='waffle_room_event', inputHat = 'waffle_input_event', receivedHat='waffle_received_event';
const conditionShape = new Blockly.zelos.ConstantProvider().SHAPES.HEXAGONAL;
const logic = Object.fromEntries(logicDefinitions(conditionShape).map(spec=>[spec.type,spec]));
const commandType = id => 'waffle_'+id+(messageInputs[id]?'_text':'');

const statementLabels={
  damage:'Attack for %1 damage in a %2 × %3 box',
  fire:'Fire %1 at %2 speed for %3 damage',
  draw_text:'HUD text %2\nnamed %1 in %3\nat %4 · X %5 Y %6',
  set_room_shader:'Set shader to %1\nat %2% strength',
  set_health_bar:'Show health bar %1\nfill %2 · background %3',
  push_entity:'Push %1\nwith impulse X %2 Y %3',
  fire_projectile:'Fire %1 toward %2\nat speed %3 with %4 damage',
  add_component:'On %1\nadd component %2',
  remove_component:'On %1\nremove component %2',
  damage_entity:'Damage %1\nby %2',
  set_respawn:'Respawn %1\n%2 · delay %3 ticks',
  respawn_when:'Respawn %1\nwhen %2 is %3',
  set_entity_integer:'On %1\nset integer %2 to %3',
  set_entity_real:'On %1\nset real %2 to %3',
  set_entity_boolean:'On %1\nset boolean %2 to %3',
  set_entity_string:'On %1\nset string %2 to %3',
  entity_velocity:'Set velocity of %1\nX %2 Y %3',
  move_entity:'Move %1\nby X %2 Y %3',
};

function blockDefinition(id, messageInput = false) {
  const [message,fields] = Blocks[id];
  return {
    type:messageInput?commandType(id):'waffle_'+id, message0:statementLabels[id]??message, style:commandStyles[id],
    args0:fields.map(([name,type,fallback,optional])=>{
      if (valueInput(type) || (messageInput && name===messageInputs[id]))
        return {type:'input_value',name,check:optional?['WaffleValue','WaffleNone']:'WaffleValue'};
      if (Array.isArray(type))
        return {type:'field_dropdown',name,options:type.map(value=>[(name==='shader'?roomShaders[value]??'None':value.replaceAll('_',' ')),value])};
      return {type:'field_input',name,text:fallback};
    }),
    inputsInline:true,previousStatement:'waffle',nextStatement:'waffle',
  };
}
const eventDefinition = (type,events) => ({
  type,message0:'When %1',args0:[{type:'field_dropdown',name:'event',options:events.map(id=>[eventLabels[id],id])}],
  nextStatement:'waffle',style:'events',
});
Blockly.defineBlocksWithJsonArray([
  eventDefinition(eventBlock,Events),
  eventDefinition(worldHat,worldEvents),
  eventDefinition(roomHat,roomEvents),
  ...Object.keys(Blocks).map(id=>blockDefinition(id)),
  ...Object.keys(messageInputs).map(id=>blockDefinition(id,true)),
  ...Object.values(logic).filter(spec=>!['waffle_call','waffle_function_call','waffle_param'].includes(spec.type)),
  {type:'waffle_tick',message0:'On tick',nextStatement:'waffle',style:'events',tooltip:'Run this stack on each simulation tick.'},
  {type:'waffle_use',message0:'Use module %1',args0:[{type:'field_input',name:'name',text:'common'}],style:'routines'},
]);
const registries = new WeakMap();
const buttonLabels = {a:'A',b:'B',x:'X',menu:'Start'};
function menu(field, values, empty, labels = {}, create) {
  return {type:'field_search_dropdown',name:field,options:()=>{
    const options = values();
    const names=typeof labels==='function'?labels():labels;
    const choices=options.map(value=>[names?.[value]??value,value]);
    if(create||!choices.length)choices.push([typeof empty==='function'?empty():empty,'']);
    return choices;
  },create};
}
const eventMenu=data=>menu('event',()=>data.events,'Choose event',()=>data.eventsLabels,
  ()=>data.createEvent&&{label:'New event…',open:data.createEvent});
function registry(block) {
  return registries.get(block.workspace.targetWorkspace??block.workspace)??{items:[],actions:buttons,sprites:[],animations:['default'],keys:[],menus:[],events:[],fonts:[],names:[],components:[],fields:[],rooms:[],sounds:[],flags:[]};
}
registerRoutineBlocks(registry);
Blockly.Blocks[inputHat]={init(){
  const data=registry(this);
  this.jsonInit({type:inputHat,message0:'When %1 is %2',args0:[menu('action',()=>data.actions,'Select action',buttonLabels),{type:'field_dropdown',name:'edge',options:[['pressed','pressed'],['released','released']]}],nextStatement:'waffle',style:'events'});
}};
Blockly.Blocks[receivedHat]={init(){
  const data=registry(this);
  this.jsonInit({type:receivedHat,message0:'When I receive %1',
    args0:[eventMenu(data)],nextStatement:'waffle',style:'events'});
}};
Blockly.Blocks.waffle_constant={init(){
  const data=registry(this);
  const spec=logic.waffle_constant;
  this.jsonInit({...spec,args0:[menu('name',()=>data.constantNames??[],'Add a constant')]});
}};
const dynamicFields = {font:['fonts','HUD font'],event:['events','Choose event'],projectile:['sprites','Choose projectile'],sprite:['sprites','Choose an entity type'],item:['items','Register an item'],tag:['animations','Add an animation'],menu:['menus','Create a menu'],room:['rooms','Choose room'],sound:['sounds','Choose sound'],component:['components','Choose component'],field:['fields','Choose field'],flag:['flags','Any flag state']};
for(const [id,[,fields]] of Object.entries(Blocks)){
  if(!fields.some(([key])=>Object.hasOwn(dynamicFields,key)))continue;
  Blockly.Blocks['waffle_'+id]={init(){
    const spec=blockDefinition(id),data=registry(this);
    if(id==='spawn'&&data.roomScript)spec.message0='Create instance of %1 at X %2 Y %3';
    fields.forEach(([key],i)=>{
      if(key==='event'){spec.args0[i]=eventMenu(data);return;}
      if(!Object.hasOwn(dynamicFields,key))return;
      const [list,empty]=dynamicFields[key];
      const nullable=key==='font'||key==='flag'||id==='set_room_music'||id==='set_room_ambience';
      spec.args0[i]=menu(key,()=>nullable?['',...data[list]]:data[list],empty,
        nullable?{'':key==='font'&&id==='set_hud_font'?'Game default':key==='flag'||key==='font'?empty:'None',...data[list+'Labels']}:data[list+'Labels']??{});
    });
    this.jsonInit(spec);
  }};
}
for(const [id,field,list,empty] of [
  ['pressed','pressed','actions','Select action'],['released','released','actions','Select action'],
  ['action','action','actions','Select action'],['item','item','items','Register an item'],
  ['item_key','item','items','Register an item'],
  ['localized','key','keys','Add a text key'],
  ['instance_ref','value','names','Choose entity'],
  ['component_ref','value','components','Choose component'],
  ['entity_field_ref','value','fields','Choose field'],
]){
  Blockly.Blocks['waffle_'+id]={init(){
    const data=registry(this),spec=logic[this.type];
    this.jsonInit({...spec,args0:[menu(field,()=>data[list],empty,list==='actions'?buttonLabels:data[list+'Labels']??{})]});
  }};
}
for(const id of ['set','change','get']){
  Blockly.Blocks['waffle_'+id]={init(){
    const spec=logic[this.type], data=registry(this);
    const scope=()=>this.getFieldValue('scope')??'global';
    const args0=spec.args0.map(arg=>{
      if(arg.name==='name')return menu('name',
        ()=>scope()==='flag'?data.flags:[...new Set([...data.fields,...Object.keys(data.variableLabels?.[scope()]??{})])],
        ()=>scope()==='flag'?'Choose flag':'Choose field',
        ()=>scope().startsWith('local')?data.fieldsLabels:data.variableLabels?.[scope()],
        ()=>{
          if(!data.createField)return;
          const selected=scope();
          const kind=selected==='flag'?'flag':selected.startsWith('global')?'variable':'field';
          return {label:'New '+kind+'…',open:(name,select)=>data.createField(selected,name,select)};
        });
      if(arg.name==='scope'&&data.roomScript)return {...arg,options:arg.options.map(([label,value])=>[label.replace(/^entity /,'room '),value])};
      return arg;
    });
    this.jsonInit({...spec,args0});
  }};
}
const playerShadow=n=>({type:'waffle_player',fields:{value:String(n)}});
const theme = Blockly.Theme.defineTheme('gamewaffle',{
  name:'gamewaffle',base:Blockly.Themes.Classic,
  blockStyles:Object.fromEntries(Object.entries(groups).map(([style,{color}])=>[style,{
    colourPrimary:color,...(style==='events'?{hat:'cap'}:{}),
  }])),
  componentStyles:{
    workspaceBackgroundColour:'#1e1e2e',toolboxBackgroundColour:'#181825',toolboxForegroundColour:'#e0e3f0',
    flyoutBackgroundColour:'#303044',flyoutForegroundColour:'#e0e3f0',flyoutOpacity:.99,
    insertionMarkerColour:'#fff3cc',scrollbarColour:'#737087',cursorColour:'#f4c77e',
  },
  fontStyle:{family:'system-ui, sans-serif',weight:'600',size:12},
});
const block = (id, fields, values) => ({
  kind:'block',type:'waffle_'+id,fields,
  ...(values?{inputs:Object.fromEntries(Object.entries(values).map(([name,value])=>[name,slot(value)]))}:{}),
});
const namedEntitySlot=()=>({shadow:{type:'waffle_entity_find',inputs:{arg0:referenceSlot('instance_ref')}}});
const colorSlot=value=>({shadow:{type:'waffle_color',fields:{value}}});
const roomToolCommands = {
  looks:['sound','burst_at','say','ask','counter','bar','show_menu','show_inventory'],
  world:['spawn','room','checkpoint','retry_checkpoint','follow_player','group_camera','camera','release_camera',...roomCommands],
};
const commands = (style,isRoom=false) => (groups[style].commands??[])
  .filter(id=>id!=='fire'&&(isRoom?(roomToolCommands[style]?.includes(id)??true):!roomCommands.includes(id)))
  .map(id=>({
  kind:'block',type:commandType(id),
  fields:Object.fromEntries(Blocks[id][1].filter(([,type])=>Array.isArray(type)).map(([key,,fallback])=>[key,fallback])),
  inputs:Object.fromEntries(Blocks[id][1].filter(([name,type])=>valueInput(type)||name===messageInputs[id])
    .map(([key,,value,optional])=>[key,key==='entity'?namedEntitySlot()
      :id==='follow_player'?{shadow:playerShadow(value)}
      :id==='set_health_bar'&&['fill','track'].includes(key)?colorSlot(value):slot(optional?null:value)])),
}));
const category = (style,contents) => ({kind:'category',name:groups[style].name,colour:groups[style].color,contents});
const toolbox = isRoom => [
  category('events',[block('tick'),block(isRoom?'room_event':'world_event'),block('received_event'),...commands('events'),
    ...(isRoom?[block('input_event',{action:'a',edge:'pressed'})]:[])]),
  category('control',[{...block('if',null,{condition:false}),extraState:{otherwise:false}},block('if',null,{condition:false}),
    block('repeat',null,{times:5}),block('while',null,{condition:false}),block('wait',null,{ticks:1})]),
  category('sensing',[block('action',{action:'a'}),block('pressed',{pressed:'a'}),block('released',{released:'a'}),
    block('button',{button:'a'}),block('event_sender'),...(isRoom?[block('room_reading')]:[
      block('grounded'),block('actor_condition'),block('actor_condition',{actor:'is_player'}),
      block('actor',{actor:'x'}),block('actor_real',{actor:'x_real'}),
    ])]),
  category('operators',[block('whole'),block('real'),block('bool'),
    block('arithmetic',{operation:'add'},{left:0,right:1}),block('compare',{operation:'equal'},{left:0,right:0}),
    block('boolean_op',{operation:'and'},{left:false,right:false}),block('not',null,{left:false}),
    block('math_unary',{operation:'sin'},{left:{real:45}}),block('math_binary',{operation:'pow'},{left:{real:2},right:{real:2}}),
    block('conversion',{operation:'to_real'},{left:0}),block('conversion',{operation:'floor'},{left:{real:0.5}}),
    block('none')]),
  {...category('variables',[]),custom:'WAFFLE_VARIABLES'},
  ...(isRoom?['looks','world','items']:['motion','looks','world','items','combat']).map(style=>category(style,[
    ...(style==='items'?[block('item'),block('item_key'),...(isRoom?[]:[block('actor',{actor:'used_item'})]),block('player')]:[]),
    ...commands(style,isRoom),
  ])),
  category('entities',[
    ...Object.entries(entityQueries).map(([id,[,,params]])=>({
      ...block('entity_'+id),
      inputs:Object.fromEntries(params.map(([,value],index)=>{
        const picker=queryPicker(id,index);
        return ['arg'+index,picker?referenceSlot(picker):params[index][0]==='integer'?namedEntitySlot():slot(value)];
      })),
    })),
    ...commands('entities'),
  ]),
  category('text',[block('string'),block('localized'),block('join',null,{left:'Hello, ',right:'world'}),...commands('text'),...commands('looks').filter(entry=>['waffle_say_text','waffle_ask_text'].includes(entry.type))]),
  {...category('routines',[]),custom:'WAFFLE_ROUTINES'},
];

export const blockCategories=isRoom=>toolbox(isRoom).map(category=>category.name);

function variableDefault(scope,value) {
  if(scope.endsWith('_real'))return {real:value};
  if(scope.endsWith('_string'))return '';
  if(scope==='flag'||scope.endsWith('_bool'))return false;
  return value;
}

class ResponsiveFlyout extends Blockly.VerticalFlyout {
  getFlyoutScale(){
    const width=this.targetWorkspace.getMetricsManager().getViewMetrics().width;
    if(width<=0)return .72;
    const longest=this.getContents().reduce((max,item)=>
      Math.max(max,item.getElement().getBoundingRectangle().getWidth()),0);
    // Leave part of the canvas exposed as a place to drag blocks out of the palette.
    const canvasSpace=Math.min(180,Math.max(26,width*(width<460?.13:.24)));
    const flyoutSpace=width-canvasSpace-Blockly.Scrollbar.scrollbarThickness;
    const contentWidth=longest+this.MARGIN*1.5+this.tabWidth_;
    return Math.min(.72,Math.max(.05,flyoutSpace/contentWidth));
  }

  position(){
    super.position();
    if(!this.isVisible()||!this.svgGroup_)return;
    // Keep the canvas below short categories available for editing and dropping blocks.
    const bottom=this.getContents().reduce((max,item)=>
      Math.max(max,item.getElement().getBoundingRectangle().bottom),0);
    const blank=Math.max(0,this.getHeight()-Math.ceil((bottom+this.MARGIN)*this.getWorkspace().scale));
    this.svgGroup_.style.clipPath=blank>0?`inset(0 0 ${blank}px 0 round 0 6px 6px 0)`:'';
  }
}

Blockly.registry.register(Blockly.registry.Type.FLYOUTS_VERTICAL_TOOLBOX,'responsive',ResponsiveFlyout);

export function mountBlocks(node, onChange, sprites, items, actions, animations, keys, menus, references, onToolboxChange, onEditRoutine, onImports, isRoom=false, onEditConstants, createEvent, createField) {
  const workspace = Blockly.inject(node,{
    theme, renderer:'zelos', trashcan:true, media:'./blockly-media/',
    grid:{spacing:24,length:1,colour:'#4a485c',snap:false},
    move:{scrollbars:{horizontal:true,vertical:true},drag:true,wheel:true},
    zoom:{controls:true,wheel:false,startScale:.75,minScale:.16,maxScale:1.6,scaleSpeed:1.15},
    plugins:{flyoutsVerticalToolbox:'responsive'},
    toolbox:{kind:'categoryToolbox',contents:toolbox(isRoom)},
  });
  const data={sprites,items,actions,animations:[...animations],keys,menus,...references,fields:[],roomScript:isRoom,createEvent,createField};
  registries.set(workspace,data);
  let constants={};
  let externalRoutines={},loadingRoutines=null,routineScope,previousImports='';
  function declarations(){
    return workspace.getTopBlocks(false).filter(definitionBlock);
  }
  function signatures(isFunction){
    const entries=new Map();
    for(const [name,routine] of Object.entries(loadingRoutines??{})){
      if(!!routine.body!==isFunction)entries.set(name,routineParameters(routine));
    }
    for(const declaration of declarations()){
      if((declaration.type==='waffle_fn')===isFunction){
        const name=declaration.getFieldValue('name');
        if(!entries.has(name))entries.set(name,declaration.parameters);
      }
    }
    for(const [module,unit] of Object.entries(externalRoutines)){
      if(!workspace.getTopBlocks(false).some(block=>block.type==='waffle_use'&&block.getFieldValue('name')===module)&&!loadingRoutines)continue;
      for(const [name,routine] of Object.entries(unit.routines??{})){
        if(!!routine.body!==isFunction)entries.set(module+'.'+name,routineParameters(routine));
      }
    }
    return entries;
  }
  data.routineNames=isFunction=>[...signatures(isFunction).keys()];
  data.signature=(name,isFunction)=>signatures(isFunction).get(name);
  data.editRoutine=block=>onEditRoutine({
    id:block.id,name:block.getFieldValue('name'),parameters:block.parameters.map(param=>({...param})),isFunction:block.type==='waffle_fn',
  });

  function routineCall(kind,name,args=[]){
    const isFunction=kind==='waffle_function_call';
    const parameters=data.signature(name,isFunction)??args.map((_,index)=>({name:'Argument '+(index+1),type:'integer'}));
    return {type:kind,fields:{name},extraState:{name,parameters},
      inputs:Object.fromEntries(args.map((value,index)=>[argumentInput(index),slot(value)]))};
  }

  function refreshCalls(){
    for(const block of workspace.getAllBlocks(false)){
      if(!callBlock(block))continue;
      const parameters=data.signature(block.getFieldValue('name'),block.type==='waffle_function_call');
      if(parameters)block.updateArguments(parameters);
    }
  }
  function checkImports(){
    const imports=workspace.getTopBlocks(false).filter(block=>block.type==='waffle_use').map(block=>block.getFieldValue('name'));
    const signature=JSON.stringify(imports);
    if(signature===previousImports)return;
    previousImports=signature;
    onImports(imports);
  }
  workspace.registerToolboxCategoryCallback('WAFFLE_ROUTINES',()=>{
    const list=[block('proc'),block('fn',null,{result:0}),block('use')];
    for(const [isFunction,kind] of [[false,'waffle_call'],[true,'waffle_function_call']]){
      const name=data.routineNames(isFunction)[0];
      if(name)list.push({kind:'block',...routineCall(kind,name)});
    }
    if(routineScope&&workspace.getBlockById(routineScope.id)&&routineScope.parameters.length){
      list.unshift({kind:'label',text:routineScope.getFieldValue('name')+' parameters'},
        ...routineScope.parameters.map(({name})=>block('param',{name})),{kind:'sep',gap:14});
    }
    return list;
  });
  workspace.registerButtonCallback('WAFFLE_MANAGE_CONSTANTS',onEditConstants);
  workspace.registerToolboxCategoryCallback('WAFFLE_VARIABLES',()=>[
    {kind:'button',text:'Manage constants…',callbackKey:'WAFFLE_MANAGE_CONSTANTS'},
    ...Object.keys(constants).map(name=>block('constant',{name})),
    block('set',null,{value:0}),block('change',null,{value:1}),block('get'),
    block('set',{scope:'flag',name:'ready'},{value:false}),
  ]);
  function setConstants(next,notify=false){
    constants=next??{};
    data.constantNames=Object.keys(constants);
    if(notify){
      if(blockToolbox.getSelectedItem()?.getName?.()==='Variables')blockToolbox.refreshSelection();
      onChange();
    }
  }

  const registryData=data,extraTags=new Set();
  const known={names:new Set(),components:new Set(),fields:new Set(),flags:new Set()};
  let currentReferences=references;
  function remember(script) {
    const visit=value=>{
      if(!value||typeof value!=='object')return;
      if(typeof value.name==='string'&&value.name&&value.scope){
        if(value.scope==='flag')known.flags.add(value.name);
        else known.fields.add(value.name);
      }
      if(typeof value.get==='string'&&value.get)known[value.scope==='flag'?'flags':'fields'].add(value.get);
      if(typeof value.field==='string')known.fields.add(value.field);
      const constant=value.constant??(value.type==='waffle_constant'?value.fields?.name:undefined);
      if(typeof constant==='string'&&!data.constantNames?.includes(constant))data.constantNames?.push(constant);
      if(typeof value.component==='string')known.components.add(value.component);
      if(value.call?.startsWith('entity.'))value.args?.forEach((arg,i)=>{
        const picker=queryPicker(value.call.slice(7),i), list={instance_ref:'names',component_ref:'components',entity_field_ref:'fields'}[picker];
        if(list&&typeof arg==='string'&&arg)known[list].add(arg);
      });
      Object.values(value).forEach(visit);
    };
    visit(script);
    for(const [key,values] of Object.entries(known))data[key]=[...new Set([...(currentReferences[key]??[]),...values])].sort();
  }
  const blockToolbox=workspace.getToolbox();
  const roots=new Set([eventBlock,worldHat,roomHat,inputHat,receivedHat,'waffle_tick','waffle_use','waffle_proc','waffle_fn']);
  const activeRoot=block=>roots.has(block.type)&&(block.type!==receivedHat||block.getFieldValue('event'));
  function updateDetachedAppearance(){
    for(const block of workspace.getAllBlocks(false)){
      block.getSvgRoot()?.classList.toggle('gw-detached',!block.getParent()&&!activeRoot(block));
    }
  }
  let compact=false,changing=false;
  function reportToolbox(){
    const index=blockToolbox.getToolboxItems().indexOf(blockToolbox.getSelectedItem());
    onToolboxChange(compact,index);
  }
  function selectCategory(index){
    if(index<0)blockToolbox.clearSelection();
    else blockToolbox.selectItemByPosition(index);
    reportToolbox();
  }
  function setRoomContext(roomScript){
    if(data.roomScript===roomScript)return;
    data.roomScript=roomScript;
    blockToolbox.clearSelection();
    workspace.updateToolbox({kind:'categoryToolbox',contents:toolbox(roomScript)});
    reportToolbox();
  }
  workspace.addChangeListener(event=>{
    if(event.type===Blockly.Events.TOOLBOX_ITEM_SELECT)reportToolbox();
    if(event.type===Blockly.Events.SELECTED&&event.newElementId){
      const selected=workspace.getBlockById(event.newElementId);
      if(selected)routineScope=enclosingRoutine(selected);
      if(blockToolbox.getSelectedItem()?.getName?.()==='Routines')blockToolbox.refreshSelection();
    }
    if (!changing && !event.isUiEvent && [Blockly.Events.BLOCK_CREATE,Blockly.Events.BLOCK_DELETE,Blockly.Events.BLOCK_CHANGE,Blockly.Events.BLOCK_MOVE].includes(event.type)) {
      if(event.type===Blockly.Events.BLOCK_CHANGE){
        const block=workspace.getBlockById(event.blockId);
        if(['waffle_set','waffle_change','waffle_get'].includes(block?.type))remember({name:block.getFieldValue('name'),scope:true});
      }
      if(event.type===Blockly.Events.BLOCK_CREATE){
        const created=workspace.getBlockById(event.blockId);
        if(definitionBlock(created)){
          const base=created.getFieldValue('name');
          const used=new Set(declarations().filter(block=>block!==created).map(block=>block.getFieldValue('name')));
          let name=base;
          for(let index=2;used.has(name);index++)name=base+'_'+index;
          if(name!==base)created.setFieldValue(name,'name');
        }
      }
      checkImports();
      updateDetachedAppearance();
      onChange();
    }
  });
  let lastWidth=0,fitPending=false,resizeFrame=0;
  function fit(){
    workspace.getToolbox()?.clearSelection();
    workspace.zoomToFit();
  }
  function resize(){
    if(!node.clientWidth||!node.clientHeight)return;
    Blockly.svgResize(workspace);
    const narrow=node.clientWidth<540;
    if(compact!==narrow){
      compact=narrow;
      blockToolbox.setVisible(!narrow);
      reportToolbox();
    }
    const width=workspace.getMetricsManager().getViewMetrics().width;
    if(width!==lastWidth){
      lastWidth=width;
      const flyout=workspace.getFlyout();
      if(flyout?.isVisible())flyout.reflow();
    }
    if(fitPending){
      fitPending=false;
      const bounds=workspace.getBlocksBoundingBox();
      if((bounds.right-bounds.left)*workspace.scale+32>width)fit();
    }
  }
  const observer=new ResizeObserver(resize);
  const hideTooltip=()=>Blockly.Tooltip.hide();
  node.addEventListener('pointerleave',hideTooltip);
  function controlWheel(event){
    if(!(event.ctrlKey||event.metaKey)||!event.deltaY||event.target.closest?.('.blocklyDropDownDiv,.blocklyWidgetDiv'))return;
    event.preventDefault();
    event.stopPropagation();
    const box=workspace.getParentSvg().getBoundingClientRect();
    const amount=event.deltaMode===1?event.deltaY*16:event.deltaMode===2?event.deltaY*100:event.deltaY;
    workspace.zoom(event.clientX-box.left,event.clientY-box.top,-Math.max(-3,Math.min(3,amount/90)));
  }
  node.addEventListener('wheel',controlWheel,{capture:true,passive:false});
  observer.observe(node);
  function load(script) {
    changing = true;
    routineScope=null;
    setConstants(script.constants);
    loadingRoutines=script.routines??{};
    remember(script);
    Blockly.Events.disable();
    try {
      const scriptLayout=script.layout??{};
      const place=[];
      const savedBlocks = Object.entries(script.events ?? {}).map(([event,items])=>{
        const position=scriptLayout[event];
        if(!position)place.push(event);
        const next = encodeStack(items);
        const input=inputEvent(event),received=receivedEvent(event),[edge,action]=event.split('.');
        return {type:received?receivedHat:input?inputHat:event==='tick'?'waffle_tick':data.roomScript&&roomEvents.includes(event)?roomHat:worldEvents.includes(event)?worldHat:eventBlock,
          id:event,...(position?{x:position[0],y:position[1]}:{}),fields:received?{event:action}:input?{edge,action}:event==='tick'?{}:{event},...(next ? {next:{block:next}} : {})};
      });
      const add=(key,data)=>{
        const position=scriptLayout[key];
        if(!position)place.push(key);
        savedBlocks.push({...data,id:key,...(position?{x:position[0],y:position[1]}:{})});
      };
      for(const name of script.imports??[])add('use:'+name,{type:'waffle_use',fields:{name}});
      for(const [name,r] of Object.entries(script.routines??{})){
        const next=r.body && encodeStack(r.body);
        const signature={fields:{name},extraState:{parameters:routineParameters(r)}};
        add('routine:'+name,r.body?{type:'waffle_proc',...signature,...(next?{next:{block:next}}:{})}:
          {type:'waffle_fn',...signature,inputs:{result:slot(r.result)}});
      }
      for(const block of savedBlocks)upgradeBlock(block);
      Blockly.serialization.workspaces.load({blocks:{languageVersion:0,blocks:savedBlocks}},workspace);
      for(const state of script.detached??[]){
        const block=structuredClone(state);
        upgradeBlock(block);
        if(Blockly.Blocks[block.type])Blockly.serialization.blocks.append(block,workspace);
      }
      updateDetachedAppearance();
      if(place.length){
        Blockly.renderManagement.triggerQueuedRenders();
        const below = workspace.getTopBlocks(false).filter(block=>Object.hasOwn(scriptLayout,block.id))
          .map(block=>block.getRelativeToSurfaceXY().y+block.getHeightWidth().height+32);
        let y=Math.max(24,...below);
        for(const id of place){
          const block=workspace.getBlockById(id);
          block.moveBy(24,y);
          y+=block.getHeightWidth().height+32;
        }
      }
    } finally { Blockly.Events.enable(); changing = false; loadingRoutines=null; }
    checkImports();
    fitPending=true;
    cancelAnimationFrame(resizeFrame);
    resizeFrame=requestAnimationFrame(resize);
  }
  function encodeStack(items) {
    let next;
    for (const {op,...data} of [...items].reverse()) {
      if((op==='animate'||op==='animate_once') && data.tag){extraTags.add(data.tag);if(!registryData.animations.includes(data.tag))registryData.animations.push(data.tag);}
      if(op==='call'){
        next={...routineCall('waffle_call',data.name,data.args),...(next?{next:{block:next}}:{})};
        continue;
      }
      const inputs = {}, fields = {};
      let extraState;
      const value = (key,fallback)=>{inputs[key]=slot(data[key]===undefined?fallback:data[key],fallback);};
      const stack = key=>{const block=encodeStack(data[key]??[]);if(block)inputs[key]={block};};
      if (logicStatements.has(op)) {
        if (op==='set' || op==='change') {
          fields.scope=data.scope; fields.name=data.name;
          value('value',variableDefault(data.scope,op==='change'?1:0));
        }
        if (op==='wait') value('ticks',1);
        if (op==='while') { value('condition',false); stack('body'); }
        if (op==='repeat') { value('times',1); stack('body'); }
        if(op==='if'){
          const {branches,otherwise}=conditionalBranches(data);
          extraState={branches:branches.slice(1).map((_,i)=>i+1),otherwise:Boolean(otherwise)};
          branches.forEach((branch,index)=>{
            inputs[index?branchCondition(index):'condition']=slot(branch.condition??false,false);
            const body=encodeStack(branch.body??[]);
            if(body)inputs[index?branchBody(index):'body']={block:body};
          });
          const body=encodeStack(otherwise??[]);
          if(body)inputs.otherwise={block:body};
        }
      } else if (Object.hasOwn(Blocks,op)) {
        for (const [key,type,fallback,optional] of Blocks[op][1]) {
          if(op==='follow_player' && typeof (data[key]??fallback)==='number')inputs[key]={shadow:playerShadow(data[key]??fallback)};
          else if(op==='set_health_bar'&&['fill','track'].includes(key)&&/^#[0-9a-f]{6}$/i.test(data[key]??fallback))
            inputs[key]=colorSlot(data[key]??fallback);
          else if (valueInput(type) || key===messageInputs[op]) value(key,optional?null:fallback);
          else fields[key]=data[key]??fallback;
        }
      } else continue;
      next = {type:commandType(op),fields,inputs,...(extraState?{extraState}:{}),...(next ? {next:{block:next}} : {})};
    }
    return next;
  }
  function decodeStack(first) {
    const result=[];
    for (let block=first;block;block=block.getNextBlock()) {
      const kind=block.type.slice(7);
      const messageBlock=kind.endsWith('_text')&&Object.hasOwn(messageInputs,kind.slice(0,-5));
      const op=messageBlock?kind.slice(0,-5):kind;
      const field=key=>block.getFieldValue(key);
      const value=(key,fallback)=>block.getInputTargetBlock(key) ? readValue(block.getInputTargetBlock(key)) : fallback;
      const stack=key=>decodeStack(block.getInputTargetBlock(key));
      if(op==='call')result.push({op,name:field('name'),args:callArguments(block)});
      else if (op==='set' || op==='change') result.push({op,scope:field('scope'),name:field('name'),value:value('value',variableDefault(field('scope'),op==='change'?1:0))});
      else if (op==='wait') result.push({op,ticks:value('ticks',1)});
      else if (op==='repeat') result.push({op,times:value('times',1),body:stack('body')});
      else if(op==='if'||op==='if_then'){
        const head={op:'if',condition:value('condition',false),body:stack('body')};
        let tail=head;
        for(const id of block.branchIds??[]){
          const branch={op:'if',condition:value(branchCondition(id),false),body:stack(branchBody(id))};
          tail.otherwise=[branch];
          tail=branch;
        }
        if(block.hasElse)tail.otherwise=stack('otherwise');
        result.push(head);
      }
      else if(op==='while')result.push({op,condition:value('condition',false),body:stack('body')});
      else result.push({op,...Object.fromEntries(Blocks[op][1].map(([key,type,fallback,optional])=>
        [key,valueInput(type) || (messageBlock && key===messageInputs[op]) ? value(key,optional?null:fallback) : field(key)]))});
    }
    return result;
  }
  function save() {
    const events = {}, layout = {}, routines=Object.create(null),imports=[],detached=[];
    for (const hat of workspace.getTopBlocks(true)) {
      const name=hat.getFieldValue('name'),position=hat.getRelativeToSurfaceXY();
      if(hat.type==='waffle_use'){imports.push(name);layout['use:'+name]=[position.x,position.y];continue;}
      if(['waffle_proc','waffle_fn'].includes(hat.type)){
        if(Object.hasOwn(routines,name))throw Error('Duplicate routine '+name);
        const signature=routineSignature(hat.parameters);
        routines[name]=hat.type==='waffle_proc'?{...signature,body:decodeStack(hat.getNextBlock())}:
          {...signature,result:readValue(hat.getInputTargetBlock('result'))};
        layout['routine:'+name]=[position.x,position.y];continue;
      }
      if(!activeRoot(hat)){
        const data=Blockly.serialization.blocks.save(hat,{addCoordinates:true,saveIds:false});
        if(data)detached.push(data);
        continue;
      }
      const event = hat.type===receivedHat?'received.'+hat.getFieldValue('event'):hat.type==='waffle_tick'?'tick':hat.type===inputHat?hat.getFieldValue('edge')+'.'+hat.getFieldValue('action'):hat.getFieldValue('event');
      if (Object.hasOwn(events,event)) throw Error(`Use one stack for “${eventLabels[event]??event}”`);
      const p = hat.getRelativeToSurfaceXY();
      layout[event] = [p.x,p.y];
      events[event] = decodeStack(hat.getNextBlock());
    }
    return {events,layout,routines,imports,...(Object.keys(constants).length?{constants}:{}),...(detached.length?{detached}:{})};
  }
  function editRoutine(id,name,parameters){
    const definition=workspace.getBlockById(id);
    if(!definitionBlock(definition))return;
    if(!variableName(name)||Object.hasOwn(Blocks,name)||['wait','item_key'].includes(name))throw Error('Enter a valid routine name');
    if(declarations().some(block=>block!==definition&&block.getFieldValue('name')===name))throw Error('This routine name is already used');
    const oldName=definition.getFieldValue('name');
    const rename=new Map(parameters.filter(param=>param.original&&param.original!==param.name).map(param=>[param.original,param.name]));
    const configured=parameters.map(({name,type})=>({name,type}));
    Blockly.Events.disable();
    try{
      definition.setFieldValue(name,'name');
      definition.updateSignature(configured);
      for(const child of definition.getDescendants(false)){
        if(child.type!=='waffle_param')continue;
        const key=child.getFieldValue('name');
        if(rename.has(key))child.setFieldValue(rename.get(key),'name');
        else if(!configured.some(param=>param.name===key))child.unplug();
      }
      for(const block of workspace.getAllBlocks(false)){
        if(!callBlock(block)||block.getFieldValue('name')!==oldName||
          (block.type==='waffle_function_call')!==(definition.type==='waffle_fn'))continue;
        block.editingSignature=true;
        if(name!==oldName){block.rememberedName=name;block.setFieldValue(name,'name');}
        block.updateArguments(configured,rename);
        block.editingSignature=false;
      }
      routineScope=definition;
      updateDetachedAppearance();
    }finally{Blockly.Events.enable();}
    onChange();
  }

  function setRoutineModules(modules){
    externalRoutines=modules;
    Blockly.Events.disable();
    try{refreshCalls();}finally{Blockly.Events.enable();}
  }

  function upgradeBlock(block){
    if(!block||typeof block!=='object')return;
    if(block.type==='waffle_if_then'){
      block.type='waffle_if';
      block.extraState={otherwise:false};
    }
    if(data.roomScript&&block.type==='waffle_actor'&&roomReadings.includes(block.fields?.actor))block.type='waffle_room_reading';
    if(data.roomScript&&block.type===worldHat&&roomEvents.includes(block.fields?.event))block.type=roomHat;
    if((block.type==='waffle_call'||block.type==='waffle_function_call')&&!block.extraState){
      const name=block.fields?.name??'';
      const old=block.inputs??{};
      const pairs=['a','b'].map(key=>old[key]).filter(Boolean);
      block.extraState={name,parameters:pairs.map((_,index)=>({name:'Argument '+(index+1),type:'integer'}))};
      block.inputs=Object.fromEntries(pairs.map((input,index)=>[argumentInput(index),input]));
    }
    if((block.type==='waffle_proc'||block.type==='waffle_fn')&&!block.extraState){
      let parameters=[];
      try{parameters=routineParameters(parseParameters(block.fields?.params??''));}catch{}
      block.extraState={parameters};
      if(block.fields)delete block.fields.params;
    }
    for(const input of Object.values(block.inputs??{})){
      upgradeBlock(input.block);
      upgradeBlock(input.shadow);
    }
    upgradeBlock(block.next?.block);
  }
  return {load,save,fit,selectCategory,editRoutine,setRoutineModules,setRoomContext,setConstants:next=>setConstants(next,true),updateRegistry(sprites,items,actions,tags,keys,menus,references){currentReferences=references;Object.assign(data,{sprites,items,actions,keys,menus,...references,animations:[...new Set([...tags,...extraTags])]});remember(null);},draft:()=>({...Blockly.serialization.workspaces.save(workspace),scriptConstants:constants}),
    restoreDraft(value){Blockly.Events.disable();try{
      const draft=structuredClone(value);
      if(draft.scriptConstants)setConstants(draft.scriptConstants);
      delete draft.scriptConstants;
      remember(draft.blocks);
      for(const block of draft.blocks?.blocks??[])upgradeBlock(block);
      Blockly.serialization.workspaces.load(draft,workspace);
      refreshCalls();
      checkImports();
      updateDetachedAppearance();
    }finally{Blockly.Events.enable();}},
    dispose:()=>{observer.disconnect();node.removeEventListener('pointerleave',hideTooltip);node.removeEventListener('wheel',controlWheel,true);hideTooltip();cancelAnimationFrame(resizeFrame);workspace.dispose();}};
}
