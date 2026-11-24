<script>
  import { onMount } from 'svelte';
  let { title, children, onClose, busy=false, wide=false } = $props();
  let dialog;
  onMount(()=>{
    const trigger=document.activeElement;
    dialog.showModal();
    return ()=>{
      dialog.close();
      if(trigger instanceof HTMLElement && trigger.isConnected)trigger.focus({preventScroll:true});
    };
  });
</script>

<dialog bind:this={dialog} class:wide aria-label={title} oncancel={event=>{event.preventDefault();if(!busy)onClose();}}>
  <h2>{title}</h2>
  {@render children()}
</dialog>

<style>
  dialog{box-sizing:border-box;width:min(31rem,calc(100% - 1.5rem));max-height:calc(100% - 1.5rem);padding:1rem;border:1px solid var(--line);background:var(--panel);color:inherit;overflow:auto}
  dialog.wide{width:min(66rem,calc(100% - 1.5rem))}
  dialog::backdrop{background:#10141bbb}
  h2{margin:0 0 .8rem;font-size:1.15rem}
  dialog :global(form){display:grid;gap:.65rem}
  dialog :global(form>label){display:grid;gap:.25rem}
  dialog :global(.dialog-actions){display:flex;justify-content:flex-end;flex-wrap:wrap;gap:.4rem;margin-top:.55rem}
  dialog :global(.dialog-actions button){width:auto}
</style>
