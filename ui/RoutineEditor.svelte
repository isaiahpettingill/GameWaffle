<script>
  import {untrack} from 'svelte';
  import Modal from './Modal.svelte';
  import {maxParameters,parameterTypes,variableName} from '../src/script.mjs';
  let {definition,onApply,onClose}=$props();
  let name=$state(untrack(()=>definition.name)),error=$state('');
  let nextId=0;
  let parameters=$state(untrack(()=>definition.parameters.map(param=>({...param,original:param.name,id:nextId++}))));
  function add(){
    let n=parameters.length+1;
    while(parameters.some(param=>param.name==='arg'+n))n++;
    parameters.push({name:'arg'+n,type:'integer',id:nextId++});
  }
  function submit(){
    const selected=name.trim();
    const cleaned=$state.snapshot(parameters).map(parameter=>({...parameter,name:parameter.name.trim()}));
    if(!variableName(selected)||cleaned.some(({name})=>!variableName(name)||['true','false','none','not','and','or'].includes(name))){
      error='Use a valid name for the routine and each parameter.';return;
    }
    if(new Set(cleaned.map(param=>param.name)).size!==cleaned.length){
      error='Use a different name for each parameter.';return;
    }
    try{onApply(selected,cleaned);}catch(err){error=err.message;}
  }
</script>

<Modal title={definition.isFunction?'Edit Function':'Edit Procedure'} {onClose}>
  <form onsubmit={event=>{event.preventDefault();submit();}}>
    <label>Name<input bind:value={name} required maxlength="64"></label>
    {#each parameters as parameter,index (parameter.id)}
      <div class="parameter">
        <label>Parameter {index+1}<input bind:value={parameter.name} required maxlength="64"></label>
        <label>Type<select bind:value={parameter.type}>
          {#each parameterTypes as value}<option {value}>{value[0].toUpperCase()+value.slice(1)}</option>{/each}
        </select></label>
        <button type="button" aria-label={'Remove parameter '+(index+1)}
          onclick={()=>parameters=parameters.filter(item=>item.id!==parameter.id)}>Remove</button>
      </div>
    {/each}
    {#if parameters.length<maxParameters}<button class="add" type="button" onclick={add}>Add parameter</button>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="dialog-actions"><button type="button" onclick={onClose}>Cancel</button><button class="primary">Apply</button></div>
  </form>
</Modal>
<style>
  .parameter{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.85fr) auto;gap:.45rem;align-items:end}
  label{display:grid;gap:.2rem;color:var(--muted);min-width:0}
  .add{justify-self:start}
</style>
