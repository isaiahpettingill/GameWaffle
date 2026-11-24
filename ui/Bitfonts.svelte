<script>
  import Modal from './Modal.svelte';
  import GlyphGrid from './GlyphGrid.svelte';
  import {encodeCbor} from '../src/cartridge.mjs';
  import SearchSelect from './SearchSelect.svelte';
  import {resourceName} from '../src/resource-name.mjs';
  import {fontFile} from '../src/font.mjs';
  let { fonts, active, legacy, sources, onSelect, onSave, onImport }=$props();
  let editing=$state(null), name=$state(''), source=$state(''), width=$state(6), height=$state(8), assignments=$state({});
  let file=$state.raw(null), error=$state(''), busy=$state(false), picker=$state();
  const installed=$derived(fonts[active]);
  const sheet=$derived(/\.png$/i.test(source));
  let preview=$state('');
  $effect(()=>{
    if(!sheet){preview='';return;}
    if(!file){preview='./api/room-art?path='+encodeURIComponent(source);return;}
    const url=URL.createObjectURL(file);preview=url;
    return ()=>URL.revokeObjectURL(url);
  });
  const sourceOptions=$derived([...new Set([...sources.filter(value=>fontFile.test(value)),...(source?[source]:[])])]
    .map(value=>({value,label:value.split('/').at(-1)})));

  export function open(id=''){
    const config=fonts[id];
    editing=id;name=config?.name??'';source=config?.source??'';width=config?.glyphWidth??6;height=config?.glyphHeight??8;
    assignments=config?.assignments??Object.fromEntries([...(config?.characters??'')].map((label,index)=>[index,label]));file=null;error='';
  }
  function choose(value,nextFile=null){
    source=value;file=nextFile;error='';assignments={};
    if(!name)name=value.split('/').at(-1).replace(/\.[^.]+$/,'');
  }
  async function save(){
    if(busy || !name.trim() || !source || (sheet&&!Object.keys(assignments).length))return;
    busy=true;error='';
    try{
      const config={name:name.trim(),source,...(sheet?{glyphWidth:width,glyphHeight:height,assignments:$state.snapshot(assignments)}:{} )};
      if(file){
        const query=new URLSearchParams({kind:'font',name:file.name});
        const dataBytes=new Uint8Array(await file.arrayBuffer());
        const response=await fetch('./api/import?'+query,{method:'POST',body:encodeCbor({fontConfig:config,data:dataBytes})});
        const data=await response.json();
        if(!response.ok)throw Error(data.error);
        config.source=data.path;
        onImport(data);
      }else{
        const response=await fetch('./api/bitfont',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(config)});
        const data=await response.json();
        if(!response.ok)throw Error(data.error);
      }
      const id=editing || resourceName(config.name,'bitfont',[fonts,{builtin:true,legacy:true}]);
      onSave(id,config,editing==='');
      editing=null;
    }catch(err){error=err.message;}finally{busy=false;}
  }
</script>

<div class="bitfonts">
  <SearchSelect label="Game bitfont" value={active} options={[
    {value:'builtin',label:'Built-in'},
    ...(legacy?[{value:'legacy',label:'Original bitmap font'}]:[]),
    ...Object.entries(fonts).map(([value,font])=>({value,label:font.name})),
  ]} onChange={onSelect}/>
  <div class="row">
    <button onclick={()=>open()}>Import bitfont…</button>
    {#if installed}<button onclick={()=>open(active)}>Edit bitfont…</button>{/if}
  </div>
</div>
{#if editing!==null}
  <Modal title={editing?'Edit Bitfont':'Import Bitfont'} {busy} onClose={()=>editing=null}>
    <form onsubmit={event=>{event.preventDefault();save();}}>
      <div class="row font-source">
        <SearchSelect label="Source file" value={source} options={sourceOptions} disabled={busy}
          onChange={value=>{if(value!==source)choose(value);}}/>
        <button type="button" disabled={busy} onclick={()=>picker.click()}>Browse device…</button>
        <input hidden type="file" bind:this={picker} accept=".yaff,.ase,.aseprite,.png"
          onchange={event=>{const next=event.currentTarget.files[0];if(next)choose(next.name,next);event.currentTarget.value='';}}>
      </div>
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
        <button class="primary" disabled={busy||!source||(sheet&&!Object.keys(assignments).length)}>{busy?'Checking…':editing?'Apply':'Import'}</button></div>
    </form>
  </Modal>
{/if}

<style>
  .bitfonts{display:grid;gap:.65rem;max-width:26rem}
  .font-source{align-items:end}.font-source :global(.search-select){flex:1 1 10rem}
  .font-size{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
  label{display:grid;gap:.25rem;color:var(--muted);min-width:0}small{color:var(--muted)}
</style>
