import * as Blockly from 'blockly/core';

const groupPaster='gamewaffle-blocks';
const selectionClass='gw-block-selected';
const selections=new WeakMap();

function copyStates(workspace,selection){
  const states=[],covered=new Set();
  for(const root of workspace.getTopBlocks(true)){
    for(const block of root.getDescendants(false)){
      if(!selection.has(block)||covered.has(block))continue;
      let state=Blockly.serialization.blocks.save(block,{addCoordinates:true,addNextBlocks:false,saveIds:false});
      if(!state)continue;
      states.push(state);
      // Copy consecutive selected statements as one stack. Each statement's
      // inputs belong to it, even if an input was also selected separately.
      for(let current=block;current;){
        covered.add(current);
        const next=current.getNextBlock();
        for(const child of current.getChildren(false)){
          if(child!==next)for(const input of child.getDescendants(false))covered.add(input);
        }
        if(!selection.has(next))break;
        const nextState=Blockly.serialization.blocks.save(next,{addNextBlocks:false,saveIds:false});
        if(!nextState)break;
        state.next={block:nextState};
        state=nextState;
        current=next;
      }
    }
  }
  return states;
}

const positionKey=(x,y)=>Math.round(x)+':'+Math.round(y);

Blockly.clipboard.registry.register(groupPaster,{paste({states,origin},workspace,coordinate=origin){
  const select=selections.get(workspace);
  if(!select||workspace.isReadOnly())return null;
  const occupied=new Set(workspace.getAllBlocks(false).map(block=>{
    const {x,y}=block.getRelativeToSurfaceXY();
    return positionKey(x,y);
  }));
  let dx=coordinate.x-origin.x+24,dy=coordinate.y-origin.y+24;
  while(states.some(({x,y})=>occupied.has(positionKey(x+dx,y+dy)))){
    dx+=24;dy+=24;
  }
  const pasted=[];
  const previous=Blockly.Events.getGroup();
  if(!previous)Blockly.Events.setGroup(true);
  try{
    for(const state of states)pasted.push(Blockly.serialization.blocks.append(
      {...state,x:state.x+dx,y:state.y+dy},workspace,{recordUndo:true}));
  }finally{Blockly.Events.setGroup(previous);}
  const selected=[];
  for(const root of pasted)for(let block=root;block;block=block.getNextBlock())selected.push(block);
  select(selected);
  return pasted[0]??null;
}});

export function installBlockSelection(node,workspace){
  const selection=new Set();
  const focus=Blockly.getFocusManager();
  let pending;
  const eligible=block=>block?.workspace===workspace&&!block.isDeadOrDying()&&!block.isShadow()&&block.isCopyable();
  function blockAt(target){
    const root=target.closest?.('g[data-id]');
    let block=root&&workspace.getBlockById(root.dataset.id);
    if(block?.getSvgRoot()!==root)return null;
    while(block?.isShadow())block=block.getParent();
    return eligible(block)?block:null;
  }
  function clear(){
    pending=undefined;
    for(const block of selection)block.getSvgRoot()?.classList.remove(selectionClass);
    selection.clear();
  }
  function add(block){
    block.getSvgRoot().classList.add(selectionClass);
    selection.add(block);
  }
  function select(blocks){
    clear();
    for(const block of blocks)if(eligible(block))add(block);
    if(selection.size)focus.focusNode(workspace.getRootFocusableNode());
  }
  function toggle(block,anchor){
    if(!eligible(block))return;
    if(!selection.size&&eligible(anchor))add(anchor);
    if(selection.delete(block))block.getSvgRoot().classList.remove(selectionClass);
    else add(block);
    // A group owns keyboard focus on the workspace, even when its blocks span stacks.
    focus.focusNode(workspace.getRootFocusableNode());
  }
  function pointerDown(event){
    pending=undefined;
    if(event.button!==0)return;
    if(!(event.ctrlKey||event.shiftKey||event.metaKey)){clear();return;}
    const block=blockAt(event.target);
    if(!block)return;
    const anchor=workspace.getNavigator().getSourceBlockFromNode(focus.getFocusedNode());
    if(Blockly.browserEvents.isRightButton(event)||event.target.closest('.blocklyEditableField,.blocklyIconGroup')){
      event.preventDefault();
      event.stopPropagation();
      workspace.hideChaff(true);
      toggle(block,anchor);
      return;
    }
    pending={block,anchor,id:event.pointerId,x:event.clientX,y:event.clientY};
  }
  function pointerUp(event){
    const click=pending;
    pending=undefined;
    if(!click||event.pointerId!==click.id||workspace.isDragging()||blockAt(event.target)!==click.block||
      Math.hypot(event.clientX-click.x,event.clientY-click.y)>4)return;
    // Finish Blockly's own pointer gesture before updating its focus.
    queueMicrotask(()=>toggle(click.block,click.anchor));
  }
  function keyDown(event){
    if(event.target.closest?.('input,textarea,[contenteditable=true]')||focus.ephemeralFocusTaken()||workspace.isDragging())return;
    if(event.key==='Escape'&&selection.size){clear();focus.focusNode(workspace.getRootFocusableNode());return;}
    if(!(event.ctrlKey||event.metaKey)||event.altKey||event.shiftKey)return;
    const key=event.key.toLowerCase();
    if(key==='c'&&selection.size){
      const states=copyStates(workspace,selection);
      if(!states.length)return;
      const origin=new Blockly.utils.Coordinate(Math.min(...states.map(state=>state.x)),Math.min(...states.map(state=>state.y)));
      workspace.hideChaff();
      Blockly.clipboard.setLastCopiedData({paster:groupPaster,states,origin});
      Blockly.clipboard.setLastCopiedWorkspace(workspace);
      Blockly.clipboard.setLastCopiedLocation(origin);
      event.preventDefault();
      event.stopPropagation();
    }else if(key==='v'&&Blockly.clipboard.getLastCopiedData()?.paster===groupPaster){
      Blockly.clipboard.setLastCopiedWorkspace(workspace);
    }
  }
  function prune(event){
    if(event.type===Blockly.Events.BLOCK_DELETE){
      for(const block of selection)if(block.isDeadOrDying())selection.delete(block);
    }
  }
  function cancel(){pending=undefined;}
  selections.set(workspace,select);
  node.addEventListener('pointerdown',pointerDown,true);
  node.addEventListener('pointerup',pointerUp,true);
  node.addEventListener('pointercancel',cancel,true);
  node.addEventListener('keydown',keyDown,true);
  workspace.addChangeListener(prune);
  return {clear,dispose(){
    clear();
    selections.delete(workspace);
    node.removeEventListener('pointerdown',pointerDown,true);
    node.removeEventListener('pointerup',pointerUp,true);
    node.removeEventListener('pointercancel',cancel,true);
    node.removeEventListener('keydown',keyDown,true);
    workspace.removeChangeListener(prune);
  }};
}
