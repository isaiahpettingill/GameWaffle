import * as Blockly from 'blockly/core';
import {slot} from './logic-blocks.js';

const icon=path=>'data:image/svg+xml,'+encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="'+path+
  '" fill="none" stroke="white" stroke-linecap="round" stroke-width="1.5"/></svg>'
);
const plus=icon('M4 8h8M8 4v8'),minus=icon('M4 8h8');
export const branchCondition=id=>'elif_condition_'+id;
export const branchBody=id=>'elif_body_'+id;

function branchMenu(field,choices){
  const dropdown=Blockly.DropDownDiv;
  dropdown.hideWithoutAnimation();
  dropdown.clearContent();
  const menu=document.createElement('div');
  menu.className='block-field-options branch-options';
  const buttons=choices.map(([label,action])=>{
    const button=document.createElement('button');
    button.type='button';
    button.textContent=label;
    button.onclick=()=>{dropdown.hideWithoutAnimation();action();};
    menu.append(button);
    return button;
  });
  menu.onkeydown=event=>{
    if(event.key==='Escape'){event.preventDefault();dropdown.hideWithoutAnimation();}
    if(event.key==='ArrowUp'||event.key==='ArrowDown'){
      const step=event.key==='ArrowUp'?-1:1;
      buttons[(buttons.indexOf(document.activeElement)+step+buttons.length)%buttons.length].focus();
      event.preventDefault();
    }
    event.stopPropagation();
  };
  dropdown.getContentDiv().append(menu);
  dropdown.setColour('#232435','#51536d');
  dropdown.showPositionedByField(field);
  buttons[0].focus();
}

Blockly.Blocks.waffle_if={init(){
  this.branchIds=[];
  this.hasElse=false;
  this.setStyle('control');
  this.setPreviousStatement(true,'waffle');
  this.setNextStatement(true,'waffle');
  this.setInputsInline(false);
  this.appendValueInput('condition').setCheck('WaffleValue').appendField('if')
    .appendField(new Blockly.FieldImage(plus,15,15,'Add branch',field=>{
      if(this.isInFlyout)return;
      const addIf=()=>mutate([...this.branchIds,Math.max(0,...this.branchIds)+1],this.hasElse);
      if(this.hasElse)addIf();
      else branchMenu(field,[['Add else if',addIf],['Add else',()=>mutate(this.branchIds,true)]]);
    }));
  this.appendStatementInput('body').setCheck('waffle').appendField('then');

  const removeInput=name=>{
    const connection=this.getInput(name).connection;
    if(connection.targetBlock()?.isShadow()===false){
      connection.setShadowState(null);
      connection.disconnect();
    }
    this.removeInput(name);
  };
  this.saveExtraState=()=>({branches:this.branchIds,otherwise:this.hasElse});
  this.loadExtraState=({branches=[],otherwise=false,shadows={}})=>{
    for(const id of this.branchIds){
      if(branches.includes(id))continue;
      removeInput(branchCondition(id));
      removeInput(branchBody(id));
    }
    if(this.hasElse&&!otherwise)removeInput('otherwise');
    for(const id of branches){
      if(this.getInput(branchCondition(id)))continue;
      this.appendValueInput(branchCondition(id)).setCheck('WaffleValue').appendField('else if')
        .appendField(new Blockly.FieldImage(minus,15,15,'Remove else-if branch',()=>{
          if(!this.isInFlyout)mutate(this.branchIds.filter(branch=>branch!==id),this.hasElse);
        })).connection.setShadowState(shadows[id]??slot(false).shadow);
      this.appendStatementInput(branchBody(id)).setCheck('waffle').appendField('then');
    }
    if(otherwise&&!this.hasElse){
      this.appendStatementInput('otherwise').setCheck('waffle').appendField('else')
        .appendField(new Blockly.FieldImage(minus,15,15,'Remove else branch',()=>{
          if(!this.isInFlyout)mutate(this.branchIds,false);
        }));
    }
    const end=otherwise?'otherwise':null;
    for(const id of branches){
      this.moveInputBefore(branchCondition(id),end);
      this.moveInputBefore(branchBody(id),end);
    }
    this.branchIds=[...branches];
    this.hasElse=otherwise;
  };
  const state=()=>JSON.stringify({...this.saveExtraState(),shadows:Object.fromEntries(this.branchIds.map(id=>
    [id,this.getInput(branchCondition(id)).connection.getShadowState(true)]))});
  const mutate=(branches,otherwise)=>{
    const old=state(), group=Blockly.Events.getGroup();
    if(!group)Blockly.Events.setGroup(true);
    try{
      this.loadExtraState({branches,otherwise});
      Blockly.Events.fire(new Blockly.Events.BlockChange(this,'mutation',null,old,state()));
    }finally{if(!group)Blockly.Events.setGroup(false);}
  };
  this.loadExtraState({otherwise:true});
}};
