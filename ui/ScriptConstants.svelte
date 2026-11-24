<script>
  import {Plus,Trash2} from '@lucide/svelte';
  import {constantType,parameterTypes,variableName} from '../src/script.mjs';
  import Modal from './Modal.svelte';

  let {constants,onApply,onClose}=$props();
  const initialRows=()=>Object.entries(constants).map(([name,literal])=>({
    name,type:constantType(literal),value:literal?.real??literal,
  }));
  let rows=$state(initialRows());
  let error=$state(''),busy=$state(false);
  const defaults={integer:0,real:0,boolean:false,string:''};

  async function apply(){
    let values=Object.create(null);
    for(const row of rows){
      const name=row.name.trim();
      const value=row.type==='real'?{real:row.value}:row.value;
      if(!variableName(name)||Object.hasOwn(values,name)){error='Give each constant a unique name using letters, numbers, or underscores.';return;}
      if(constantType(value)!==row.type){error='Enter a '+row.type+' value for '+name+'.';return;}
      values[name]=value;
    }
    busy=true;error='';
    try{await onApply(values);}catch(err){error=err.message;}finally{busy=false;}
  }
</script>

<Modal title="Script Constants" {busy} {onClose}>
  <form onsubmit={event=>{event.preventDefault();apply();}}>
    {#each rows as row,index (row)}
      <div class="constant-row">
        <label>Name<input bind:value={row.name} required maxlength="64" disabled={busy}></label>
        <label>Type<select value={row.type} disabled={busy} onchange={event=>{
          row.type=event.currentTarget.value;row.value=defaults[row.type];
        }}>
          {#each parameterTypes as type}<option value={type}>{type[0].toUpperCase()+type.slice(1)}</option>{/each}
        </select></label>
        <label>Value
          {#if row.type==='boolean'}
            <select value={String(row.value)} disabled={busy} onchange={event=>row.value=event.currentTarget.value==='true'}>
              <option value="false">False</option><option value="true">True</option>
            </select>
          {:else if row.type==='string'}
            <input bind:value={row.value} disabled={busy}>
          {:else}
            <input type="number" step={row.type==='integer'?1:'any'} bind:value={row.value} required disabled={busy}>
          {/if}
        </label>
        <button type="button" class="icon-button" aria-label={'Remove '+(row.name||'constant')} disabled={busy}
          onclick={()=>rows.splice(index,1)}><Trash2 size={15}/></button>
      </div>
    {/each}
    <button type="button" disabled={busy||rows.length>=128} onclick={()=>rows.push({name:'',type:'integer',value:0})}>
      <Plus size={15}/> Add constant
    </button>
    {#if error}<p role="alert" class="error">{error}</p>{/if}
    <div class="dialog-actions">
      <button type="button" disabled={busy} onclick={onClose}>Cancel</button>
      <button class="primary" disabled={busy}>Apply</button>
    </div>
  </form>
</Modal>

<style>
  .constant-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.75fr) minmax(0,1fr) auto;gap:.45rem;align-items:end}
  .constant-row label{min-width:0}
  form>button{justify-self:start}
</style>
