<script>
  import Modal from './Modal.svelte';
  import GlyphGrid from './GlyphGrid.svelte';
  import SearchSelect from './SearchSelect.svelte';
  import {resourceName} from '../src/resource-name.mjs';
  import {fontFile} from '../src/font.mjs';
  let { fonts, sources, controlsVisible=true, onSave }=$props();
  let editing=$state(null), name=$state(''), source=$state(''), width=$state(6), height=$state(8), assignments=$state({});
  let error=$state(''), busy=$state(false);
  const sheet=$derived(/\.png$/i.test(source));
  const preview=$derived(sheet?'./api/room-art?path='+encodeURIComponent(source):'');
  const sourceOptions=$derived([...new Set([...sources.filter(value=>fontFile.test(value)),...(source?[source]:[])])]
    .map(value=>({value,label:value.split('/').at(-1)})));

  export function open(id=''){
    const config=fonts[id];
    editing=id;name=config?.name??'';source=config?.source??'';width=config?.glyphWidth??6;height=config?.glyphHeight??8;
    assignments=config?.assignments??Object.fromEntries([...(config?.characters??'')].map((label,index)=>[index,label]));error='';
  }
  function choose(value){
    source=value;error='';assignments={};
    if(!name)name=value.split('/').at(-1).replace(/\.[^.]+$/,'');
  }
  async function save(){
    if(busy || !name.trim() || !source || (sheet&&!Object.keys(assignments).length))return;
    busy=true;error='';
    try{
      const config={name:name.trim(),source,...(sheet?{glyphWidth:width,glyphHeight:height,assignments:$state.snapshot(assignments)}:{} )};
      const response=await fetch('./api/bitfont',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(config)});
      const data=await response.json();
      if(!response.ok)throw Error(data.error);
      const id=editing || resourceName(config.name,'bitfont',[fonts,{builtin:true,legacy:true}]);
      onSave(id,config);
      editing=null;
    }catch(err){error=err.message;}finally{busy=false;}
  }
</script>

{#if controlsVisible&&sourceOptions.length}<button onclick={()=>open()}>Create bitfont from project file…</button>{/if}
{#if editing!==null}
  <Modal title={editing?'Edit Bitfont':'Create Bitfont'} {busy} onClose={()=>editing=null}>
    <form onsubmit={event=>{event.preventDefault();save();}}>
      <SearchSelect label="Source file" value={source} options={sourceOptions} disabled={busy}
        onChange={value=>{if(value!==source)choose(value);}}/>
      <label>Name<input bind:value={name} required maxlength="100" disabled={busy}></label>
      {#if sheet}
        <div class="font-size">
          <label>Glyph width (px)<input type="number" min="1" max="64" required bind:value={width} disabled={busy}></label>
          <label>Glyph height (px)<input type="number" min="1" max="64" required bind:value={height} disabled={busy}></label>
        </div>
        {#if preview}{#key preview}
          <GlyphGrid url={preview} {width} {height} {assignments} onChange={value=>assignments=value}/>
        {/key}{/if}
      {:else if /\.(ase|aseprite)$/i.test(source)}
        <small>Each tag names a character. GameWaffle uses the first frame of each tag and keeps the first tag for each character.</small>
      {:else if source}
        <small>GameWaffle reads glyphs and cell size from the YAFF file.</small>
      {/if}
      {#if error}<p role="alert" class="error">{error}</p>{/if}
      <div class="dialog-actions"><button type="button" disabled={busy} onclick={()=>editing=null}>Cancel</button>
        <button class="primary" disabled={busy||!source||(sheet&&!Object.keys(assignments).length)}>{busy?'Checking…':editing?'Apply':'Create'}</button></div>
    </form>
  </Modal>
{/if}

<style>
  .font-size{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
  label{display:grid;gap:.25rem;color:var(--muted);min-width:0}small{color:var(--muted)}
</style>
