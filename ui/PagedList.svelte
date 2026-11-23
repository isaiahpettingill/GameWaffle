<script>
  import {ChevronLeft,ChevronRight} from '@lucide/svelte';
  let {items,label,children,size=8,query='',text=item=>String(item)}=$props();
  let requested=$state(0),last='';
  const matches=$derived(items.filter(item=>text(item).toLowerCase().includes(query.trim().toLowerCase())));
  const pages=$derived(Math.ceil(matches.length/size));
  const page=$derived(Math.min(requested,Math.max(0,pages-1)));
  $effect(()=>{if(last!==query){last=query;requested=0;}});
</script>
{#each matches.slice(page*size,(page+1)*size) as item}{@render children(item)}{/each}
{#if query&&!matches.length}<small>No matches</small>{/if}
{#if pages>1}
<div class="pager">
  <button class="icon-button" aria-label={'Previous '+label} disabled={!page} onclick={()=>requested=page-1}><ChevronLeft size={14}/></button>
  <small>{page+1} / {pages}</small>
  <button class="icon-button" aria-label={'Next '+label} disabled={page+1>=pages} onclick={()=>requested=page+1}><ChevronRight size={14}/></button>
</div>
{/if}
<style>.pager{display:flex;align-items:center;justify-content:flex-end;gap:.4rem;flex-basis:100%}</style>
