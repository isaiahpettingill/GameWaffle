import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as English from 'blockly/msg/en';
import { Events, Blocks } from '../src/schema.mjs';

Blockly.setLocale(English);

const labels = {start:'Room start',tick:'Every tick',a:'Press A',b:'Press B',x:'Press X',menu:'Press Start',
  begin_contact:'Contact begins',end_contact:'Contact ends',damage:'Receive damage',destroy:'Destroyed'};
const colors = {walk:218,jump:218,velocity:218,damage:354,fire:354,chase:159,animate:280,sound:37,room:159};
const eventBlock = 'waffle_event';
Blockly.defineBlocksWithJsonArray([
  { type:eventBlock, message0:'When %1', args0:[{type:'field_dropdown',name:'event',options:Events.map(id=>[labels[id],id])}],
    nextStatement:'waffle',colour:41,tooltip:'Starts a stack of blocks when this event occurs.' },
  ...Object.entries(Blocks).map(([id,[message,fields]])=>({
    type:`waffle_${id}`, message0:message, colour:colors[id],
    args0:fields.map(([name,type,fallback])=> type === 'number' ? {type:'field_number',name,value:fallback,min:-10000,max:10000}
      : Array.isArray(type) ? {type:'field_dropdown',name,options:type.map(value=>[value.replaceAll('_',' '),value])}
      : {type:'field_input',name,text:fallback}),
    previousStatement:'waffle', nextStatement:'waffle',
  })),
]);

const theme = Blockly.Theme.defineTheme('gamewaffle',{
  name:'gamewaffle',base:Blockly.Themes.Classic,
  componentStyles:{
    workspaceBackgroundColour:'#242432',toolboxBackgroundColour:'#1b1b26',toolboxForegroundColour:'#ede9e3',
    flyoutBackgroundColour:'#343145',flyoutForegroundColour:'#ede9e3',flyoutOpacity:.98,
    insertionMarkerColour:'#fff3cc',scrollbarColour:'#737087',cursorColour:'#f4c77e',
  },
  fontStyle:{family:'system-ui, sans-serif',weight:'600',size:12},
});
const blocks = (ids)=>ids.map(id=>({kind:'block',type:`waffle_${id}`}));
export function mountBlocks(node, onChange) {
  const workspace = Blockly.inject(node,{
    theme, renderer:'zelos', trashcan:true, media:'./blockly-media/',
    grid:{spacing:22,length:2,colour:'#454052',snap:false},
    move:{scrollbars:{horizontal:true,vertical:true},drag:true,wheel:true},
    zoom:{controls:true,wheel:false,startScale:.95,minScale:.45,maxScale:1.6,scaleSpeed:1.15},
    toolbox:{kind:'categoryToolbox',contents:[
      {kind:'category',name:'Events',colour:41,contents:[{kind:'block',type:eventBlock}]},
      {kind:'category',name:'Motion',colour:218,contents:blocks(['walk','jump','velocity','chase'])},
      {kind:'category',name:'Combat',colour:354,contents:blocks(['damage','fire'])},
      {kind:'category',name:'Room & media',colour:159,contents:blocks(['animate','sound','room'])},
    ]},
  });
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
        let next;
        for (const {op,...fields} of [...items].reverse()) {
          if (!Object.hasOwn(Blocks,op)) continue;
          next = {type:`waffle_${op}`,fields,...(next ? {next:{block:next}} : {})};
        }
        return {type:eventBlock,x:position[0],y:position[1],fields:{event},...(next ? {next:{block:next}} : {})};
      });
      Blockly.serialization.workspaces.load({blocks:{languageVersion:0,blocks:savedBlocks}},workspace);
    } finally { Blockly.Events.enable(); changing = false; }
  }
  function save() {
    const events = {}, layout = {};
    for (const hat of workspace.getTopBlocks(true)) {
      if (hat.type !== eventBlock) throw Error('Connect each loose block to an event before saving');
      const event = hat.getFieldValue('event');
      if (Object.hasOwn(events,event)) throw Error(`Use one stack for “${labels[event]}”`);
      const p = hat.getRelativeToSurfaceXY();
      layout[event] = [p.x,p.y];
      events[event] = [];
      for (let block = hat.getNextBlock(); block; block = block.getNextBlock()) {
        const op = block.type.slice(7);
        const fields = Blocks[op][1].map(([name,type])=>[name,type === 'number' ? Number(block.getFieldValue(name)) : block.getFieldValue(name)]);
        events[event].push({op,...Object.fromEntries(fields)});
      }
    }
    return {events,layout};
  }
  return {load,save,dispose:()=>{observer.disconnect();workspace.dispose();}};
}
