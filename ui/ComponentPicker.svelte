<script>
  import SearchSelect from './SearchSelect.svelte';
  import Modal from './Modal.svelte';
  let { components, selected=[], inherited=[], onChange, onCreate }=$props();
  let open=$state(false), name=$state('');
  const choices=$derived(Object.entries(components).filter(([id])=>!selected.includes(id)&&!inherited.includes(id))
    .map(([value,label])=>({value,label})));
  function create(){
    if(!name.trim())return;
    const id=onCreate(name.trim());
    if(!selected.includes(id)&&!inherited.includes(id))onChange([...selected,id]);
    open=false;
  }
</script>
{#if inherited.length || selected.length}
  <div class="row chips">
    {#each inherited as id}<small title="Inherited from entity type">{components[id]??id} · inherited</small>{/each}
    {#each selected as id}<button type="button" aria-label={'Remove component '+(components[id]??id)}
      onclick={()=>onChange(selected.filter(value=>value!==id))}>{components[id]??id} ×</button>{/each}
  </div>
{/if}
<div class="row picker">
  {#if choices.length}
    <SearchSelect label="Add component" value="" options={choices} onChange={id=>onChange([...selected,id])}/>
  {/if}
  <button type="button" onclick={()=>{name='';open=true;}}>New component…</button>
</div>
{#if open}
  <Modal title="New Component" onClose={()=>open=false}>
    <form onsubmit={event=>{event.preventDefault();create();}}>
      <label>Component name<input bind:value={name} required maxlength="64"></label>
      <div class="dialog-actions"><button type="button" onclick={()=>open=false}>Cancel</button><button class="primary">Add component</button></div>
    </form>
  </Modal>
{/if}
<style>
  .chips{margin:.4rem 0}.chips small{color:var(--muted)}.picker{align-items:end}
  .picker :global(.search-select){flex:1 1 10rem}
</style>
