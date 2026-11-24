import * as Blockly from 'blockly/core';
import { SearchDropdown } from './block-picker.js';
import { argumentInput, slot, readValue } from './logic-blocks.js';

const editIcon="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='white' stroke-linecap='round' stroke-width='1.5' d='M8 3v10M3 8h10'/%3E%3C/svg%3E";
const typedDefaults={integer:0,real:{real:0},boolean:false,string:''};
export const definitionBlock=block=>block?.type==='waffle_proc'||block?.type==='waffle_fn';
export const callBlock=block=>block?.type==='waffle_call'||block?.type==='waffle_function_call';
export function routineParameters(routine){
  return (routine.params??[]).map((name,index)=>({name,type:routine.paramTypes?.[index]??'integer'}));
}
export function routineSignature(parameters){
  const paramTypes=parameters.map(param=>param.type);
  return {params:parameters.map(param=>param.name),...(paramTypes.some(type=>type!=='integer')?{paramTypes}:{})};
}
export function enclosingRoutine(block){
  for(let current=block;current;current=current.getParent?.())if(definitionBlock(current))return current;
}
export function callArguments(block){
  return block.parameters.map(({type},index)=>{
    const child=block.getInputTargetBlock(argumentInput(index));
    return child?readValue(child):typedDefaults[type]??0;
  });
}

export function registerRoutineBlocks(registry){
  for(const [kind,isFunction] of [['waffle_proc',false],['waffle_fn',true]]){
    Blockly.Blocks[kind]={init(){
      this.parameters=[];
      this.setStyle('routines');
      this.appendDummyInput('heading')
        .appendField(isFunction?'Function':'Define')
        .appendField(new Blockly.FieldLabelSerializable(isFunction?'function':'procedure'),'name')
        .appendField(new Blockly.FieldImage(editIcon,16,16,'Edit name and parameters',()=>{
          if(!this.isInFlyout)registry(this).editRoutine(this);
        }));
      this.appendDummyInput('signature').appendField(new Blockly.FieldLabel(''),'signatureText');
      if(isFunction)this.appendValueInput('result').setCheck('WaffleValue').appendField('return');
      else this.setNextStatement(true,'waffle');
      this.setInputsInline(false);
      this.setTooltip('Open the + button to edit the name and typed parameters.');
      this.updateSignature=parameters=>{
        this.parameters=parameters;
        this.getInput('signature').setVisible(parameters.length>0);
        this.getField('signatureText').setValue(parameters.map(({name,type})=>name+' · '+type).join('   '));
      };
      this.saveExtraState=()=>({parameters:this.parameters});
      this.loadExtraState=state=>this.updateSignature(state.parameters??[]);
      this.updateSignature([]);
    }};
  }

  for(const [kind,isFunction] of [['waffle_call',false],['waffle_function_call',true]]){
    Blockly.Blocks[kind]={init(){
      this.parameters=[];
      this.rememberedName='';
      this.setStyle('routines');
      if(isFunction)this.setOutput(true,'WaffleValue');
      else{this.setPreviousStatement(true,'waffle');this.setNextStatement(true,'waffle');}
      const selected=new SearchDropdown(()=>{
        const options=registry(this).routineNames?.(isFunction)??[];
        const current=this.getField('name')?.getValue()||this.rememberedName;
        const available=[...options];
        if(current&&!available.includes(current))available.push(current);
        return available.length?available.map(name=>[name,name]):[[isFunction?'Choose a function':'Choose a procedure','']];
      });
      selected.maxDisplayLength=24;
      this.appendDummyInput('heading').appendField(isFunction?'Result of':'Call').appendField(selected,'name');
      this.setInputsInline(false);
      this.updateArguments=(parameters,rename=new Map())=>{
        if(!rename.size&&JSON.stringify(parameters)===JSON.stringify(this.parameters))return;
        const connections=new Map(),shadows=new Map();
        this.parameters.forEach(({name,type},index)=>{
          const input=this.getInput(argumentInput(index));
          const connection=input?.connection.targetConnection;
          if(connection){
            const target=connection.getSourceBlock(), key=rename.get(name)??name;
            if(target.isShadow())shadows.set(key,{type,block:Blockly.serialization.blocks.save(target,{saveIds:false})});
            else{
              input.connection.setShadowState(null);
              input.connection.disconnect();
              connections.set(key,connection);
            }
          }
          this.removeInput(argumentInput(index));
        });
        this.parameters=parameters;
        parameters.forEach(({name,type},index)=>{
          const input=this.appendValueInput(argumentInput(index)).setCheck('WaffleValue').appendField(name);
          const shadow=shadows.get(name);
          input.connection.setShadowState(shadow?.type===type&&shadow.block?shadow.block:slot(typedDefaults[type]??0).shadow);
          const connection=connections.get(name);
          if(connection)input.connection.connect(connection);
        });
      };
      this.saveExtraState=()=>({name:this.getFieldValue('name'),parameters:this.parameters});
      this.loadExtraState=state=>{
        this.rememberedName=state.name??'';
        this.updateArguments(state.parameters??[]);
      };
      selected.setValidator(name=>{
        if(!this.editingSignature){
          const parameters=registry(this).signature?.(name,isFunction);
          if(parameters)this.updateArguments(parameters);
        }
        return name;
      });
      const initial=selected.getValue();
      if(initial)this.updateArguments(registry(this).signature?.(initial,isFunction)??[]);
    }};
  }

  Blockly.Blocks.waffle_param={init(){
    this.setStyle('routines');
    this.appendDummyInput().appendField(new Blockly.FieldLabelSerializable('parameter'),'name');
    this.setOutput(true,'WaffleValue');
    this.setTooltip('Read a parameter of the current procedure or function.');
  }};
}
