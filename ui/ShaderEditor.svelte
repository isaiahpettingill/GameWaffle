<script>
  import {Plus,Trash2} from '@lucide/svelte';
  import {untrack} from 'svelte';
  import Modal from './Modal.svelte';
  import ShaderPreview from './ShaderPreview.svelte';
  import {acceptsShaderType,analyzeShaderGraph,isShaderParameter,makeShaderNode,MAX_SHADER_NODES,shaderNodes,shaderStarters,shaderTypeLabels,starterShader} from '../src/shader-graph.mjs';

  let {id,shader,room,onClose,onSave}=$props();
  const initialGraph=()=>shader?.graph?JSON.parse(JSON.stringify(shader.graph)):starterShader('empty');
  let graph=$state.raw(initialGraph()),name=$state(untrack(()=>shader?.title??''));
  let saving=$state(false),saveError=$state(''),compileError=$state('');
  let compiled=$state.raw(null);
  let analysis=$derived.by(()=>{
    try{return {data:analyzeShaderGraph(graph)};}
    catch(error){return {error:error.message};}
  });

  $effect(()=>{
    const state=graph, validation=analysis;
    compileError='';
    if(validation.error)return;
    const abort=new AbortController();
    const timer=setTimeout(async()=>{
      try{
        const response=await fetch('./api/shaders/preview',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify(state),signal:abort.signal});
        const result=await response.json();
        if(abort.signal.aborted)return;
        if(!response.ok)throw Error(result.error);
        compiled=result;
      }catch(error){if(!abort.signal.aborted)compileError=error.message;}
    },210);
    return ()=>{abort.abort();clearTimeout(timer);};
  });

  function label(node){return shaderNodes[node.kind].label+' '+node.id.slice(1);}
  function addNode(kind){
    if(!kind||graph.nodes.length>=MAX_SHADER_NODES)return;
    const index=Math.max(0,...graph.nodes.map(node=>Number(node.id.slice(1))))+1;
    graph={...graph,nodes:[...graph.nodes,makeShaderNode('n'+index,kind)]};
  }
  function update(node,edit){graph={...graph,nodes:graph.nodes.map(entry=>entry.id===node.id?{...entry,...edit}:entry)};}
  function setInput(node,index,source){
    const inputs=[...node.inputs];
    inputs[index]=source||null;
    update(node,{inputs});
  }
  function remove(node){
    const nodes=graph.nodes.filter(entry=>entry.id!==node.id)
      .map(entry=>({...entry,inputs:entry.inputs.map(link=>link===node.id?null:link)}));
    const output=graph.output===node.id?nodes.find(entry=>nodeType(entry)==='vec4')?.id??'':graph.output;
    graph={...graph,nodes,output};
  }
  function applyStarter(kind){
    if(!kind)return;
    if(!name.trim())name=shaderStarters[kind];
    graph=starterShader(kind);
  }
  function nodeType(node){return analysis.data?.definitions.get(node.id)?.type??shaderNodes[node.kind].type;}
  function connects(source,target){
    const visited=new Set();
    function visit(id){
      if(id===target)return true;
      if(visited.has(id))return false;
      visited.add(id);
      return graph.nodes.find(node=>node.id===id)?.inputs.some(link=>link&&visit(link))??false;
    }
    return visit(source);
  }
  function candidates(node,port,index){
    const current=node.inputs[index];
    return graph.nodes.filter(source=>source.id===current||
      (nodeType(source)==='number'||acceptsShaderType(port.type,nodeType(source)))&&!connects(source.id,node.id));
  }
  function defaultLabel(value){
    if(value==='uv')return 'UV coordinates';
    if(Array.isArray(value))return value.join(', ');
    return String(value);
  }
  function changeVector(node,index,value){
    const parts=[...node.value];parts[index]=value;
    update(node,{value:parts});
  }
  async function save(){
    if(saving||analysis.error||!name.trim())return;
    saving=true;saveError='';
    try{await onSave({id,name:name.trim(),graph});}
    catch(error){saveError=error.message;}finally{saving=false;}
  }
</script>

<Modal title={id?'Edit shader':'New shader'} wide busy={saving} {onClose}>
  <form onsubmit={event=>{event.preventDefault();save();}}>
    <div class="toolbar">
      <label class="name">Name<input aria-label="Shader name" maxlength="100" bind:value={name} required></label>
      <label>Starter graph<select aria-label="Starter graph" onchange={event=>{applyStarter(event.currentTarget.value);event.currentTarget.value='';}}>
        <option value="">Choose starter…</option>
        {#each Object.entries(shaderStarters) as [value,title]}<option {value}>{title}</option>{/each}
      </select></label>
    </div>
    <div class="layout">
      <div class="preview-column"><ShaderPreview {room} definition={compiled}/></div>
      <section class="graph" aria-label="Shader graph">
        <div class="graph-header">
          <label>Fragment output<select aria-label="Fragment output" value={graph.output} onchange={event=>graph={...graph,output:event.currentTarget.value}}>
            <option value="">Choose color node</option>
            {#each graph.nodes.filter(node=>node.id===graph.output||nodeType(node)==='vec4'||nodeType(node)==='number') as node (node.id)}
              <option value={node.id}>{label(node)}</option>
            {/each}
          </select></label>
          <label class="add"><span><Plus size={13}/>Node</span><select aria-label="Add shader node" disabled={graph.nodes.length>=MAX_SHADER_NODES}
            onchange={event=>{addNode(event.currentTarget.value);event.currentTarget.value='';}}>
            <option value="">Add node…</option>
            {#each Object.entries(shaderNodes).sort((a,b)=>a[1].label.localeCompare(b[1].label)) as [kind,spec]}
              <option value={kind}>{spec.label}</option>
            {/each}
          </select></label>
        </div>
        <div class="nodes">
          {#each graph.nodes as node (node.id)}
            {@const spec=shaderNodes[node.kind]}
            <article aria-label={label(node)}>
              <header><strong>{label(node)}</strong><small>{shaderTypeLabels[nodeType(node)]??'Numeric'}</small>
                <button type="button" class="icon-button" aria-label={'Remove '+label(node)} onclick={()=>remove(node)}><Trash2 size={14}/></button>
              </header>
              {#if isShaderParameter(node.kind)}
                <label>Parameter<input aria-label={label(node)+' name'} value={node.name} maxlength="32" oninput={event=>update(node,{name:event.currentTarget.value})}></label>
              {/if}
              {#if spec.value==='color'}
                <label>{isShaderParameter(node.kind)?'Default':'Color'}<input type="color" aria-label={label(node)+' color'} value={node.value} oninput={event=>update(node,{value:event.currentTarget.value})}></label>
              {:else if spec.value==='float'}
                <label>{isShaderParameter(node.kind)?'Default':'Value'}<input type="number" step="any" aria-label={label(node)+' value'} value={node.value} oninput={event=>update(node,{value:event.currentTarget.valueAsNumber})}></label>
              {:else if spec.value==='vec2'}
                <div class="pair">
                  {#each ['X','Y'] as axis,index}
                    <label>{axis}<input type="number" step="any" aria-label={label(node)+' '+axis} value={node.value[index]} oninput={event=>changeVector(node,index,event.currentTarget.valueAsNumber)}></label>
                  {/each}
                </div>
              {:else if spec.value==='boolean'}
                <label><input type="checkbox" aria-label={label(node)+' value'} checked={node.value} onchange={event=>update(node,{value:event.currentTarget.checked})}>True</label>
              {/if}
              {#each spec.ports as port,index}
                <label>{port.name}<select aria-label={label(node)+' · '+port.name} value={node.inputs[index]??''} onchange={event=>setInput(node,index,event.currentTarget.value)}>
                  <option value="">{defaultLabel(port.fallback)}</option>
                  {#each candidates(node,port,index) as source (source.id)}<option value={source.id}>{label(source)}</option>{/each}
                </select></label>
              {/each}
            </article>
          {/each}
        </div>
      </section>
    </div>
    <div class="footer">
      {#if saveError||analysis.error||compileError}<p role="alert" class="error">{saveError||analysis.error||compileError}</p>{/if}
      <div class="dialog-actions">
        <button type="button" disabled={saving} onclick={onClose}>Cancel</button>
        <button class="primary" disabled={saving||Boolean(analysis.error)||!name.trim()}>{saving?'Saving…':'Save shader'}</button>
      </div>
    </div>
  </form>
</Modal>

<style>
  .toolbar,.graph-header,.pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:.5rem}
  .toolbar{grid-template-columns:minmax(0,1fr) minmax(0,13rem)}
  .layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.35fr);gap:.8rem;align-items:start}
  .graph{display:grid;gap:.55rem;min-width:0}
  label{display:grid;gap:.22rem;color:var(--muted);font-size:.78rem;min-width:0}
  input,select{min-width:0}
  .add span{display:flex;gap:.25rem;align-items:center}
  .nodes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:.5rem;max-height:48vh;overflow:auto}
  article{display:grid;gap:.3rem;min-width:0;background:var(--well);border:1px solid var(--line);padding:.5rem}
  header{display:flex;align-items:center;gap:.3rem;justify-content:space-between;text-wrap:balance}
  header strong{font-size:.8rem}
  header small{color:var(--muted);font-size:.68rem;margin-left:auto}
  .footer{display:flex;align-items:center;gap:.5rem;justify-content:flex-end}
  .footer .error{margin-right:auto}
  @media(max-width:730px){.layout{grid-template-columns:minmax(0,1fr)}.preview-column{max-width:25rem}.nodes{max-height:none}}
  @media(max-width:450px){.nodes{grid-template-columns:minmax(0,1fr)}}
</style>
