<script>
  import {ChevronDown} from '@lucide/svelte';
  let {label,value,options,onChange,placeholder='Choose…',disabled=false,showLabel=true}=$props();
  let expanded=$state(false),query=$state(''),box=$state(''),button,search,list;
  const matches=$derived(options.filter(option=>option.label.toLowerCase().includes(query.trim().toLowerCase())));
  const selected=$derived(options.find(option=>option.value===value));

  function close(returnFocus=false){
    expanded=false;
    if(returnFocus)button?.focus();
  }

  async function open(){
    if(expanded){close(true);return;}
    const rect=button.getBoundingClientRect();
    const width=Math.min(window.innerWidth-16,Math.max(rect.width,220));
    const above=window.innerHeight-rect.bottom<230 && rect.top>230;
    box=`width:${width}px;left:${Math.max(8,Math.min(rect.left,window.innerWidth-width-8))}px;${above?'bottom:'+(window.innerHeight-rect.top+4):'top:'+(rect.bottom+4)}px`;
    query='';expanded=true;
    await Promise.resolve();
    search?.focus();
  }

  function choose(next){
    onChange(next);
    close(true);
  }

  function outside(event){
    if(expanded && !list?.contains(event.target) && !button?.contains(event.target))close();
  }

  function keys(event){
    if(!expanded)return;
    if(event.key==='Escape'){event.preventDefault();close(true);}
    else if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      const choices=[search,...list.querySelectorAll('[data-choice]')];
      const current=choices.indexOf(document.activeElement), step=event.key==='ArrowDown'?1:-1;
      choices[(current+step+choices.length)%choices.length]?.focus();
      event.preventDefault();
    }else if(event.key==='Enter'&&event.target===search){
      list.querySelector('[data-choice]')?.click();
      event.preventDefault();
    }
  }
</script>
<svelte:window onpointerdown={outside} onresize={()=>close()}/>
<div class="search-select">
  {#if showLabel}<span>{label}</span>{/if}
  <button type="button" bind:this={button} aria-label={label} aria-expanded={expanded} aria-haspopup="dialog" {disabled} onclick={open}
    onkeydown={event=>{if(event.key==='ArrowDown'&&!expanded){event.preventDefault();open();}}}>
    <span>{selected?.label??placeholder}</span><ChevronDown size={13}/>
  </button>
</div>
{#if expanded}
  <div role="dialog" aria-label={label} bind:this={list} class="search-options" style={box} onkeydown={keys}>
    <input type="search" bind:this={search} bind:value={query} aria-label={'Search '+label.toLowerCase()} placeholder="Search…">
    <div class="choices">
      {#each matches as option (option.value)}
        <button data-choice type="button" aria-pressed={value===option.value} onclick={()=>choose(option.value)}>{option.label}</button>
      {:else}<small>No matches</small>{/each}
    </div>
  </div>
{/if}
<style>
  .search-select{display:grid;gap:.24rem;min-width:0;color:var(--muted);font-size:var(--control-font,.8rem)}
  .search-select button{min-width:0;width:100%;justify-content:space-between}
  .search-select button span{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .search-options{position:fixed;z-index:50;background:var(--panel);border:1px solid var(--line);padding:.4rem;box-shadow:0 .3rem 1rem #0008}
  .choices{display:grid;max-height:min(12rem,27vh);overflow-x:hidden;overflow-y:auto;gap:.1rem;margin-top:.3rem}
  .choices button{justify-content:start;text-align:left;overflow-wrap:anywhere}
</style>
