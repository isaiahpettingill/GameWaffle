<script>
  import {resourceName} from '../src/resource-name.mjs';
  import SearchSelect from './SearchSelect.svelte';
  import LocalizedLabel from './LocalizedLabel.svelte';
  import Modal from './Modal.svelte';
  let { menus, entries, onChange } = $props();
  let id=$state(''), selected=$state(''), error=$state(''), adding=$state(false);
  const menu=$derived(menus[selected]);
  function create(){
    const title=id.trim();
    if(!title)return;
    const name=resourceName(title,'menu',[menus]);
    onChange({...menus,[name]:{title,options:['Resume']}});
    selected=name;id='';error='';adding=false;
  }
  function update(next){
    if(!next.title.trim()||next.options.some(option=>!option.trim())){
      error='Enter a title and a label for each option.';
      return;
    }
    onChange({...menus,[selected]:next});error='';
  }
  function changeOption(index,value){
    const options=[...menu.options];options[index]=value;
    update({...menu,options});
  }
</script>

<div class="menu-tools row">
  {#if Object.keys(menus).length}
    <SearchSelect label="Menu" value={selected} options={Object.entries(menus).map(([value,{title}])=>({
      value,label:title.startsWith('text.')?entries[title.slice(5)]??value:title,
    }))} onChange={value=>{selected=value;error='';}}/>
  {/if}
  <button onclick={()=>{id='';adding=true;}}>New menu…</button>
</div>
{#if menu}
  <div class="menu-options">
    <LocalizedLabel label="Title" value={menu.title} {entries} onChange={title=>update({...menu,title})}/>
    {#each menu.options as value,index}
      <div class="menu-option">
        <LocalizedLabel label={'Option '+(index+1)} {value} {entries} onChange={next=>changeOption(index,next)}/>
        {#if menu.options.length>1}<button aria-label={'Remove option '+(index+1)}
          onclick={()=>update({...menu,options:menu.options.filter((_,i)=>i!==index)})}>Remove</button>{/if}
      </div>
    {/each}
    {#if menu.options.length<8}<button onclick={()=>update({...menu,options:[...menu.options,'New option']})}>Add option</button>{/if}
  </div>
{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if adding}
  <Modal title="New Game Menu" onClose={()=>adding=false}>
    <form onsubmit={event=>{event.preventDefault();create();}}>
      <label>Menu title<input bind:value={id} required maxlength="100"></label>
      <div class="dialog-actions"><button type="button" onclick={()=>adding=false}>Cancel</button><button class="primary">Create menu</button></div>
    </form>
  </Modal>
{/if}
<style>
  .menu-tools{align-items:end}.menu-tools :global(.search-select){min-width:min(100%,14rem)}
  .menu-options{display:grid;gap:.6rem;margin-top:.6rem;max-width:34rem;justify-items:start}
  .menu-option{display:flex;gap:.4rem;align-items:end;flex-wrap:wrap;width:100%}
  .menu-option :global(.label-editor){flex:1 1 12rem}
</style>
