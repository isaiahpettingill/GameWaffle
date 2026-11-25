<script>
  import {X} from '@lucide/svelte';
  let {tags, selected=[], inherited=[], onChange, resolveTag}=$props();
  const list=$props.id();
  let name=$state('');
  const choices=$derived(Object.entries(tags).filter(([id])=>!selected.includes(id)&&!inherited.includes(id)));

  function add(){
    const label=name.trim();
    if(!label||selected.length>=32)return;
    const id=resolveTag(label);
    if(!selected.includes(id)&&!inherited.includes(id))onChange([...selected,id]);
    name='';
  }
</script>

<div class="tags">
  <label for={list+'-tag'}>Tags</label>
  {#if selected.length||inherited.length}
    <div class="row chips">
      {#each inherited as id}<small title="From the entity type">{tags[id]??id} <span>(from type)</span></small>{/each}
      {#each selected as id}<button type="button" class="chip" aria-label={'Remove tag '+(tags[id]??id)}
        onclick={()=>onChange(selected.filter(value=>value!==id))}>{tags[id]??id}<X size={12} aria-hidden="true"/></button>{/each}
    </div>
  {/if}
  <div class="tag-entry">
    <input id={list+'-tag'} list={list} bind:value={name} maxlength="64" placeholder="Add a tag" disabled={selected.length>=32}
      onkeydown={event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();add();}}}>
    <datalist id={list}>
      {#each choices as [id,label] (id)}<option value={label}></option>{/each}
    </datalist>
    <button type="button" aria-label="Add tag" disabled={!name.trim()||selected.length>=32} onclick={add}>Add</button>
  </div>
</div>

<style>
  .tags{display:grid;gap:.28rem;margin-top:.55rem;min-width:0}
  label,.chips small{color:var(--muted);font-size:.75rem}
  .chips small,.chip{min-width:0;overflow-wrap:anywhere}
  .chips small span{white-space:nowrap}
  .chip{border-radius:1rem;padding:.12rem .45rem;font-size:.72rem;text-align:start}
  .chip :global(svg){flex-shrink:0}
  .tag-entry{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.3rem}
</style>
