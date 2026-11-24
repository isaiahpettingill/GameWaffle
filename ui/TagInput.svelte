<script>
  import {X} from '@lucide/svelte';
  let {value, onChange, disabled=false}=$props();
  let input=$state('');
  function add(){
    const tag=input.trim();
    if(!tag||value.length>=16)return;
    if(!value.some(item=>item.toLowerCase()===tag.toLowerCase()))onChange([...value,tag]);
    input='';
  }
</script>

<div class="tag-field">
  <label>
    <span>Tags</span>
    <input aria-label="Tags" placeholder="Type a tag and press Enter" maxlength="35" bind:value={input} disabled={disabled||value.length>=16}
      onblur={add} onkeydown={event=>{
        if(event.key==='Enter'&&!event.isComposing){event.preventDefault();add();}
      }}>
  </label>
  {#if value.length}
    <div class="chips" aria-label="Asset tags">
      {#each value as tag (tag)}
        <button type="button" aria-label={'Remove tag '+tag} {disabled} onclick={()=>onChange(value.filter(item=>item!==tag))}>
          <span>{tag}</span><X size={12} aria-hidden="true"/>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .tag-field,label{display:grid;gap:.3rem;min-width:0}
  label{color:var(--muted);font-size:.8rem}
  .chips{display:flex;flex-wrap:wrap;gap:.3rem}
  button{border-radius:1rem;padding:.1rem .45rem;min-height:1.4rem;max-width:100%;font-size:.72rem;background:var(--well)}
  button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  button :global(svg){flex-shrink:0}
</style>
