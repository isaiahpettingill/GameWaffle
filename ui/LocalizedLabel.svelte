<script>
  import SearchSelect from './SearchSelect.svelte';
  let {label,value='',entries,onChange}=$props();
  const reference=$derived(value.startsWith('text.'));
  let choosing=$state(false);
  const options=$derived(Object.entries(entries).map(([id,text])=>({value:'text.'+id,label:text||id})));
</script>
<div class="label-editor">
  {#if reference||choosing}
    <SearchSelect {label} {value} {options} onChange={next=>{onChange(next);choosing=false;}}/>
    <button type="button" onclick={()=>{if(reference)onChange(entries[value.slice(5)]??'');choosing=false;}}>Use plain text</button>
  {:else}
    <label>{label}<input value={value} onchange={event=>onChange(event.currentTarget.value)}></label>
    {#if options.length}<button type="button" onclick={()=>choosing=true}>Choose translation…</button>{/if}
  {/if}
</div>
<style>
  .label-editor{display:flex;align-items:end;gap:.4rem;flex-wrap:wrap}
  label,.label-editor :global(.search-select){display:grid;gap:.23rem;color:var(--muted);flex:1 1 9rem;min-width:0}
</style>
