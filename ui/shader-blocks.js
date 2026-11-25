import * as Blockly from 'blockly/core';
import {readValue,slot} from './logic-blocks.js';

const parameterNames = parameter => Array.from({length:parameter.lanes},(_,index)=>
  'param:'+parameter.name+':'+index);

const parameters = definition => definition?.parameters.filter(parameter=>!parameter.automatic&&!parameter.hidden)??[];

export function registerShaderBlocks(registry, menu) {
  for(const op of ['apply_shaders','apply_background_shaders'])Blockly.Blocks['waffle_'+op] = {init(){
    const data=registry(this);
    this.appendDummyInput().appendField(op==='apply_background_shaders'?'Apply background shaders in order':data.gameScript?'Apply display shaders in order':'Apply room shaders in order');
    this.appendStatementInput('passes').setCheck('waffle_shader_pass');
    this.setPreviousStatement(true,'waffle');
    this.setNextStatement(true,'waffle');
    this.setStyle('shaders');
    this.setTooltip('Replace this pipeline. The top pass runs first. An empty pipeline clears it.');
  }};
  Blockly.Blocks.waffle_shader_pass = {init(){
    const data=registry(this);
    this.jsonInit({
      message0:'Shader pass %1',
      args0:[menu('shader',()=>Object.keys(data.shaders??{}),'Choose shader',
        ()=>Object.fromEntries(Object.entries(data.shaders??{}).map(([key,value])=>[key,value.title??key])))],
      previousStatement:'waffle_shader_pass',nextStatement:'waffle_shader_pass',style:'shaders',
    });
    this.getField('shader').setValidator(value=>{
      this.configureShader(value);
      return value;
    });
    this.configureShader(this.getFieldValue('shader'));
  },
  configureShader(value){
    const definition=registry(this).shaders?.[value], declared=parameters(definition);
    const shape=JSON.stringify(definition?.parameters??[]);
    if(value===this.shaderId&&shape===this.shaderShape)return;
    this.shaderId=value;this.shaderShape=shape;
    const attached=new Map();
    for(const input of [...this.inputList]){
      if(!input.name.startsWith('param:')&&input.name!=='engine')continue;
      const child=input.connection?.targetBlock();
      if(child)attached.set(input.name,child.isShadow()
        ? {shadow:input.connection.getShadowState(true)}
        : {connection:child.outputConnection});
      this.removeInput(input.name);
    }
    for(const parameter of declared){
      const type=parameter.lanes===1?parameter.kind:parameter.kind+' × '+parameter.lanes;
      for(const [index,key] of parameterNames(parameter).entries()){
        const input=this.appendValueInput(key).setCheck('WaffleValue');
        const axis=parameter.lanes===1?'':[' X',' Y',' Z',' W'][index];
        input.appendField(parameter.name+axis+(index===0?' · '+type:''));
        const previous=attached.get(key);
        if(previous?.shadow)input.connection.setShadowState(previous.shadow);
        else if(previous?.connection)input.connection.connect(previous.connection);
      }
    }
    const automatic=definition?.parameters.filter(parameter=>parameter.automatic&&!parameter.hidden)??[];
    if(automatic.length)this.appendDummyInput('engine').appendField('Auto · '+automatic.map(parameter=>parameter.name).join(', '));
    this.setTooltip('The pass takes the previous image as input. Empty parameter inputs use their defaults.');
  },
  saveExtraState(){return {shader:this.getFieldValue('shader')};},
  loadExtraState(state){this.configureShader(state.shader);}
  };
}

export function encodeShaderPipeline(block, registry, encodeValue=slot) {
  const first=block.passes.reduceRight((next,pass)=>{
    const inputs={};
    for(const parameter of parameters(registry?.[pass.shader])){
      parameterNames(parameter).forEach((key,index)=>{
        const value=pass.parameters?.[parameter.name]?.[index];
        if(value!==undefined)inputs[key]=encodeValue(value);
      });
    }
    return {type:'waffle_shader_pass',fields:{shader:pass.shader},extraState:{shader:pass.shader},inputs,
      ...(next?{next:{block:next}}:{})};
  },null);
  return first?{passes:{block:first}}:{};
}

export function decodeShaderPipeline(block, registry) {
  const passes=[];
  for(let pass=block.getInputTargetBlock('passes');pass;pass=pass.getNextBlock()){
    const shader=pass.getFieldValue('shader');
    const values=Object.create(null);
    for(const parameter of parameters(registry?.[shader])){
      const children=parameterNames(parameter).map(key=>pass.getInputTargetBlock(key));
      if(children.some(Boolean))values[parameter.name]=children.map((child,index)=>child?readValue(child):parameter.defaults?.[index]??0);
    }
    passes.push({shader,parameters:values});
  }
  return {op:block.type.slice(7),passes};
}
