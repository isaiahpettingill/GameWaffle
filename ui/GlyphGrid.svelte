<script>
  let { url, width, height, assignments, onChange } = $props();
  let imageWidth=$state(0),imageHeight=$state(0),selected=$state(0),page=$state(0),character=$state('');
  const pageSize=40;
  const columns=$derived(Math.floor(imageWidth/width)||0);
  const count=$derived(columns*(Math.floor(imageHeight/height)||0));
  const ready=$derived(Boolean(width&&height&&count&&imageWidth%width===0&&imageHeight%height===0));
  const pages=$derived(Math.ceil(count/pageSize));
  const cells=$derived(Array.from({length:Math.min(pageSize,Math.max(0,count-page*pageSize))},(_,index)=>page*pageSize+index));
  let input=$state();
  $effect(()=>{
    if(selected>=count){selected=0;page=0;character=assignments[0]??'';}
  });
  function select(index,focus=false){
    selected=index;character=assignments[index]??'';
    if(focus){input?.focus();input?.select();}
  }
  function assign(value){
    const next={...assignments}, glyph=[...value].at(-1);
    if(glyph)next[selected]=glyph;
    else delete next[selected];
    character=glyph??'';
    onChange(next);
  }
  function next(){
    if(selected+1>=count)return;
    if((selected+1)%pageSize===0)page++;
    select(selected+1,true);
  }
</script>
<img hidden src={url} alt="" onload={event=>{imageWidth=event.currentTarget.naturalWidth;imageHeight=event.currentTarget.naturalHeight;select(0);}}>
{#if ready}
  <div class="glyph-controls">
    <label>Character for cell {selected+1}
      <input bind:this={input} value={character} autocomplete="off" spellcheck="false" placeholder="Unassigned"
        oninput={event=>{assign(event.currentTarget.value);event.currentTarget.value=character;}}
        onkeydown={event=>{if(event.key==='Enter'){event.preventDefault();next();}}}>
    </label>
    <button type="button" disabled={selected+1>=count} onclick={next}>Next cell</button>
  </div>
  <div class="glyph-grid">
    {#each cells as index (index)}
      {@const value=assignments[index]}
      <button type="button" class="glyph" aria-pressed={selected===index} aria-label={'Cell '+(index+1)+(value?' · '+(value===' '?'space':value):' · unassigned')}
        onclick={()=>select(index,true)}>
        <span class="pixel-preview" style:background-image={'url("'+url+'")'}
          style:background-size={(imageWidth/width*100)+'% '+(imageHeight/height*100)+'%'}
          style:background-position={((index%columns)/(columns-1||1)*100)+'% '+(Math.floor(index/columns)/(imageHeight/height-1||1)*100)+'%'}>
        </span>
        <small>{value===' '?'␣':value??'—'}</small>
      </button>
    {/each}
  </div>
  {#if pages>1}<div class="row"><button type="button" disabled={!page} onclick={()=>{page--;select(page*pageSize);}}>Previous cells</button>
    <small>{page+1} of {pages}</small>
    <button type="button" disabled={page+1>=pages} onclick={()=>{page++;select(page*pageSize);}}>More cells</button></div>
  {/if}
  <small>Assign characters to the cells you want to use. If a character appears twice, the first cell wins.</small>
{:else if imageWidth && width && height}
  <p class="error">The glyph size must divide this {imageWidth} × {imageHeight} pixel sheet evenly.</p>
{/if}
<style>
  .glyph-controls{display:flex;align-items:end;gap:.5rem;flex-wrap:wrap}
  label{display:grid;gap:.24rem;color:var(--muted);flex:1;min-width:9rem}
  .glyph-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(2.35rem,1fr));gap:.3rem}
  .glyph{display:grid;place-items:center;gap:.1rem;min-width:0;padding:.2rem}
  .glyph[aria-pressed="true"]{border-color:var(--accent)}
  .pixel-preview{width:1.35rem;height:1.35rem;background-repeat:no-repeat;image-rendering:pixelated;background-color:var(--well)}
  small{color:var(--muted)}
</style>
