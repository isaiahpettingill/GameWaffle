<script>
  import {Search} from '@lucide/svelte';
  import Modal from './Modal.svelte';
  import {acceptsShaderType,shaderNodes} from '../src/shader-graph.mjs';
  import {shaderPalette} from './shader-palette.js';

  let {sourceType,onPick,onClose}=$props();
  let query=$state(''),category=$state('');
  const compatible=$derived(shaderPalette.filter(({kind})=>!sourceType||shaderNodes[kind].ports.some(
    ({type})=>acceptsShaderType(type,sourceType))));
  const categories=$derived([...new Set(compatible.map(node=>node.category))]);
  const matches=$derived(compatible.filter(node=>(!category||node.category===category)&&
    query.toLowerCase().trim().split(/\s+/).every(term=>
      [node.label,node.category,node.description].some(text=>text.toLowerCase().includes(term)))));
</script>

<Modal title="Add shader node" wide {onClose}>
  <div class="picker">
    <label class="search"><Search size={16} aria-hidden="true"/>
      <input aria-label="Search shader nodes" type="search" placeholder="Search nodes…" bind:value={query}
        onkeydown={event=>{if(event.key==='Enter'&&matches.length){event.preventDefault();onPick(matches[0].kind);}}}>
    </label>
    <div class="browser">
      <nav aria-label="Node categories">
        <button aria-pressed={category===''} onclick={()=>category=''}>All nodes</button>
        {#each categories as value}
          <button aria-pressed={category===value} onclick={()=>category=value}>{value}</button>
        {/each}
      </nav>
      <div class="cards" aria-label="Shader nodes">
        {#each matches as node (node.kind)}
          <button class="node-card" aria-label={node.label} aria-describedby={'node-description-'+node.kind} onclick={()=>onPick(node.kind)}>
            <strong>{node.label}</strong>
            <span id={'node-description-'+node.kind}>{node.description}</span>
          </button>
        {:else}
          <p role="status">No nodes match your search.</p>
        {/each}
      </div>
    </div>
    <div class="dialog-actions"><button type="button" onclick={onClose}>Cancel</button></div>
  </div>
</Modal>

<style>
  .picker{display:grid;gap:.65rem;min-width:0}
  .search{display:flex;align-items:center;gap:.5rem;color:var(--muted)}
  .search input{flex:1;min-width:0}
  .browser{display:grid;grid-template-columns:minmax(7rem,9rem) minmax(0,1fr);gap:.65rem;align-items:start}
  nav{display:flex;flex-direction:column;gap:.2rem}
  nav button{justify-content:start}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,12rem),1fr));gap:.45rem;max-height:57dvh;overflow:auto;padding:2px}
  .node-card{display:grid;align-content:start;gap:.3rem;min-width:0;text-align:left;padding:.65rem;white-space:normal}
  .node-card span{color:var(--muted);font-size:.74rem;line-height:1.35}
  @media(max-width:620px){.browser{grid-template-columns:minmax(0,1fr)}nav{flex-direction:row;flex-wrap:wrap}.cards{max-height:49dvh}}
</style>
