<script>
  import {Upload, Search, Image, AudioLines, File, Code, Type, Tag, Plus} from '@lucide/svelte';
  import Modal from './Modal.svelte';
  import GlyphGrid from './GlyphGrid.svelte';
  import SearchSelect from './SearchSelect.svelte';
  import ShaderEditor from './ShaderEditor.svelte';
  import CoverCrop from './CoverCrop.svelte';
  import {DEFAULT_COVER_CROP} from '../src/cover.mjs';
  import {assetCatalog,assetKinds,assetLabels,tagList} from '../src/asset-types.mjs';

  let {project,files,shaderDefinitions,room,onUpload,onEdit,onOpen,onSaveShader,initialKind='',shadersOnly=false}=$props();
  let query=$state(''), type=$state(''), tag=$state(''), selected=$state('');
  let picker=$state(), dragging=$state(false), queue=$state.raw([]), file=$state.raw(null);
  let suggestedKind='';
  let name=$state(''), tags=$state(''), kind=$state(''), error=$state(''), saving=$state(false);
  let soundFont=$state(''), compress=$state(true), tileCollision=$state(true);
  let width=$state(6), height=$state(8), assignments=$state({}), preview=$state('');
  let coverCrop=$state({...DEFAULT_COVER_CROP}), coverUpload=$state.raw(null);
  let shaderEditor=$state(null);
  const catalog=$derived(assetCatalog(project,files).filter(asset=>!shadersOnly||asset.kind==='shader'));
  const tagChoices=$derived([...new Set(catalog.flatMap(asset=>asset.tags))].sort((a,b)=>a.localeCompare(b)));
  const filtered=$derived(catalog.filter(asset=>(!type||asset.kind===type)&&(!tag||asset.tags.includes(tag))
    &&[asset.name,asset.path,...asset.tags].some(value=>value.toLowerCase().includes(query.trim().toLowerCase()))));
  const groups=$derived(Object.groupBy(filtered,asset=>asset.kind));
  const active=$derived(catalog.find(asset=>asset.path===selected));
  const shaderId=$derived(active?.linked.find(link=>link.kind==='shader')?.id);
  const shader=$derived(shaderDefinitions[shaderId]);
  function uploadKinds(name){
    const kinds=/\.(jpe?g|webp)$/i.test(name)?['cover']:assetKinds(name);
    return shadersOnly?kinds.filter(kind=>kind==='shader'):kinds;
  }
  const choices=$derived(file?uploadKinds(file.name):[]);
  const soundFonts=$derived(catalog.filter(asset=>asset.kind==='soundfont').map(asset=>({value:asset.path,label:asset.name})));
  const midi=$derived(/\.midi?$/i.test(file?.name??''));
  const sheet=$derived(kind==='font'&&/\.png$/i.test(file?.name??''));
  const accept=$derived(shadersOnly?'.spv,.spirv':'.png,.jpg,.jpeg,.webp,.ase,.aseprite,.yaff,.wav,.ogg,.oga,.opus,.qoa,.mid,.midi,.sf2,.spv,.spirv');
  const searchLabel=$derived(shadersOnly?'Search shaders':'Search assets');
  const loadLabel=$derived(shadersOnly?'Load shader':'Load asset');

  $effect(()=>{type=initialKind;});
  $effect(()=>{
    if(!sheet||!file){preview='';return;}
    const url=URL.createObjectURL(file);
    preview=url;
    return ()=>URL.revokeObjectURL(url);
  });

  function selectFile(next) {
    file=next;
    const types=uploadKinds(next.name);
    kind=types.includes(suggestedKind)?suggestedKind:types[0];
    name=next.name.replace(/\.[^.]+$/,'');
    tags='';soundFont=soundFonts.length===1?soundFonts[0].value:'';compress=true;tileCollision=true;
    width=6;height=8;assignments={};error='';
    coverCrop={...DEFAULT_COVER_CROP};coverUpload=null;
  }

  function enqueue(items) {
    const supported=Array.from(items).filter(file=>uploadKinds(file.name).length);
    supported.sort((a,b)=>Number(/\.sf2$/i.test(b.name))-Number(/\.sf2$/i.test(a.name)));
    if(!supported.length){error=shadersOnly?'Choose a .spv or .spirv file.':'Choose an image, font, audio, SoundFont, or SPIR-V file.';return;}
    queue=supported.slice(1);
    selectFile(supported[0]);
  }

  function nextFile() {
    const [next,...rest]=queue;
    queue=rest;
    if(next)selectFile(next);
    else file=null;
  }

  async function save() {
    const source=kind==='cover'?coverUpload:file;
    if(!source||!name.trim()||saving)return;
    saving=true;error='';
    try{
      const path=await onUpload({filename:source.name,data:new Uint8Array(await source.arrayBuffer()),kind,
        name:name.trim(),tags:tagList(tags.split(',')),soundFont,compress,tileCollision,
        ...(kind==='cover'?{coverCrop:$state.snapshot(coverCrop)}:{}),
        ...(sheet?{font:{glyphWidth:width,glyphHeight:height,assignments:$state.snapshot(assignments)}}:{})});
      type=kind;query='';tag='';selected=path;
      nextFile();
    }catch(err){error=err.message;}finally{saving=false;}
  }
  function acceptDrop(event) {
    if(!event.dataTransfer?.types.includes('Files'))return;
    event.preventDefault();
    dragging=true;
  }
  function loadDrop(event) {
    if(!event.dataTransfer?.files.length)return;
    event.preventDefault();
    dragging=false;
    suggestedKind=initialKind;
    if(!saving)enqueue(event.dataTransfer.files);
  }
  export function pick(type=initialKind) {
    suggestedKind=type;
    picker.click();
  }
  export function select(path) {
    query='';tag='';selected=path;
  }
  async function saveShader(data){
    const path=await onSaveShader(data);
    type='shader';query='';tag='';selected=path;shaderEditor=null;
  }
  const icons={shader:Code,font:Type,sound:AudioLines,music:AudioLines,soundfont:AudioLines,
    sprite:Image,tile:Image,background:Image,cover:Image,source:Image};
  const singular={sprite:'Sprite',tile:'Tileset',font:'Bitfont',background:'Background image',cover:'Cover image',
    sound:'Sound effect',music:'Music',soundfont:'SoundFont',shader:'SPIR-V shader',source:'Source image'};
</script>

<section class="card library">
  <header class="row heading"><h2>{shadersOnly?'Shaders':'Assets'}</h2>
    <button type="button" class:primary={shadersOnly} onclick={()=>shaderEditor={}}><Plus size={15}/>New shader…</button>
  </header>
  <div role="region" aria-label={shadersOnly?'Shader drop zone':'Asset drop zone'} class="dropzone" class:dragging
    ondragover={acceptDrop} ondragleave={event=>{if(!event.currentTarget.contains(event.relatedTarget))dragging=false;}} ondrop={loadDrop}>
    <Upload size={20} aria-hidden="true"/>
    <span>{shadersOnly?'Drop SPIR-V files here':'Drop asset files here'}</span>
    <button class:primary={!shadersOnly} onclick={()=>pick()} disabled={saving}>{loadLabel}…</button>
    <input hidden type="file" multiple {accept} bind:this={picker} aria-label={shadersOnly?'Shader files':'Asset files'}
      onchange={event=>{enqueue(event.currentTarget.files);event.currentTarget.value='';}}>
  </div>
  {#if error&&!file}<p class="error" role="alert">{error}</p>{/if}
  <div class="filters" class:shader-filters={shadersOnly}>
    <label class="filter-search"><Search size={15} aria-hidden="true"/><input aria-label={searchLabel} type="search" placeholder={searchLabel} bind:value={query}></label>
    {#if !shadersOnly}
      <select aria-label="Asset type filter" bind:value={type}><option value="">All types</option>
        {#each Object.entries(assetLabels) as [value,label]}<option {value}>{label}</option>{/each}
      </select>
    {/if}
    <select aria-label="Asset tag filter" bind:value={tag}><option value="">All tags</option>
      {#each tagChoices as value}<option {value}>{value}</option>{/each}
    </select>
  </div>
  <div class="content" class:details={active}>
    <div class="assets">
      {#each Object.entries(groups) as [kind,assets]}
        {#if !shadersOnly}<h3>{assetLabels[kind]??kind}</h3>{/if}
        {#each assets as asset (asset.path)}
          {@const Icon=icons[asset.kind]??File}
          <button class="asset" aria-pressed={selected===asset.path} type="button" onclick={()=>selected=asset.path}>
            <Icon size={16} aria-hidden="true"/>
            <span><strong>{asset.name}</strong><small>{asset.path.split('/').at(-1)}</small></span>
            {#if asset.tags.length}<span class="tag-summary">{asset.tags.join(', ')}</span>{/if}
          </button>
        {/each}
      {:else}
        <p class="muted">{shadersOnly?(catalog.length?'No shaders match the filters.':'No project shaders yet.'):(catalog.length?'No assets match the filters.':'Load an asset to start the library.')}</p>
      {/each}
    </div>
    {#if active}{#key active.path}
      <section class="asset-details" aria-label="Asset details">
        <label>Name<input aria-label="Asset name" value={active.name} maxlength="100"
          onchange={event=>onEdit(active,'name',event.currentTarget.value.trim()||active.name)}></label>
        <label>Tags<input aria-label="Asset tags" value={active.tags.join(', ')} placeholder="Add comma-separated tags"
          onchange={event=>onEdit(active,'tags',tagList(event.currentTarget.value.split(',')))}></label>
        <p class="file-path">{active.path}</p>
        {#if active.tags.length}<div class="tags">
          {#each active.tags as value}
            <button type="button" aria-pressed={tag===value} onclick={()=>tag=tag===value?'':value}><Tag size={13} aria-hidden="true"/>{value}</button>
          {/each}
        </div>{/if}
        {#if shader}
          {#if project.shaders?.[shaderId]?.graph}
            <button type="button" onclick={()=>shaderEditor={id:shaderId}}>Edit shader…</button>
          {/if}
          <h3>Shader parameters</h3>
          <dl class="uniforms">
            {#each shader.parameters as parameter}
              <dt>{parameter.name}</dt><dd>{parameter.automatic?'Automatic':parameter.kind+(parameter.lanes>1?' × '+parameter.lanes:'')}</dd>
            {:else}<dd>No uniforms</dd>{/each}
          </dl>
        {/if}
        {#each active.linked.filter(link=>['sprite','tile','font'].includes(link.kind)) as link}
          <button onclick={()=>onOpen(link)}>{link.kind==='tile'?'Edit tile '+link.label:link.kind==='font'?'Edit bitfont':'Open entity'}</button>
        {/each}
      </section>
    {/key}{/if}
  </div>
</section>

{#if shaderEditor}
  <ShaderEditor id={shaderEditor.id} shader={project.shaders?.[shaderEditor.id]} {room} onSave={saveShader} onClose={()=>shaderEditor=null}/>
{/if}

{#if file}
  <Modal title={loadLabel} busy={saving} onClose={()=>{file=null;queue=[];}}>
    <form onsubmit={event=>{event.preventDefault();save();}}>
      <small>{file.name}{queue.length?' · '+queue.length+' more queued':''}</small>
      {#if !shadersOnly}
        <label>Asset type<select bind:value={kind} disabled={saving}>
          {#each choices as value}<option {value}>{singular[value]}</option>{/each}
        </select></label>
      {/if}
      <label>Name<input bind:value={name} required maxlength="100" disabled={saving}></label>
      <label>Tags<input bind:value={tags} placeholder="Comma-separated tags" disabled={saving}></label>
      {#if kind==='tile'}
        <small>Tile size is {project.tileSize??24} × {project.tileSize??24} px.</small>
        <label class="check"><input type="checkbox" bind:checked={tileCollision}>Enable collision</label>
      {:else if kind==='cover'}
        <CoverCrop {file} bind:crop={coverCrop} bind:upload={coverUpload} disabled={saving}/>
      {:else if sheet}
        <div class="pair">
          <label>Glyph width (px)<input type="number" min="1" max="64" bind:value={width} required></label>
          <label>Glyph height (px)<input type="number" min="1" max="64" bind:value={height} required></label>
        </div>
        {#if preview}<GlyphGrid url={preview} {width} {height} {assignments} onChange={value=>assignments=value}/>{/if}
      {:else if midi}
        <SearchSelect label="SoundFont" value={soundFont} options={soundFonts} onChange={value=>soundFont=value}/>
        {#if !soundFonts.length}<small>Load an SF2 SoundFont to pair it with this MIDI track.</small>{/if}
      {:else if /\.wav$/i.test(file.name)}
        <label class="check"><input type="checkbox" bind:checked={compress}>Compress audio with QOA</label>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="dialog-actions"><button type="button" disabled={saving} onclick={nextFile}>{queue.length?'Skip file':'Cancel'}</button>
        <button class="primary" disabled={saving||!name.trim()||midi&&!soundFont||sheet&&!Object.keys(assignments).length||kind==='cover'&&!coverUpload}>{saving?'Loading…':loadLabel}</button>
      </div>
    </form>
  </Modal>
{/if}

<style>
  .library{display:grid;gap:.65rem;padding:.7rem;min-width:0}
  .dropzone{display:flex;align-items:center;justify-content:center;gap:.65rem;flex-wrap:wrap;
    padding:.65rem;border:1px dashed var(--line);background:var(--well);color:var(--muted)}
  .dropzone.dragging{border-color:var(--accent);color:var(--accent)}
  .filters{display:grid;grid-template-columns:minmax(0,1fr) repeat(2,minmax(0,10rem));gap:.45rem}
  .shader-filters{grid-template-columns:minmax(0,1fr) minmax(0,10rem)}
  .filter-search{display:flex;align-items:center;gap:.4rem;min-width:0}
  .filter-search input{width:100%;min-width:0}
  .content{display:grid;grid-template-columns:minmax(0,1fr);gap:.8rem}
  .content.details{grid-template-columns:minmax(0,1fr) minmax(13rem,.54fr)}
  .assets{display:grid;align-content:start;gap:.25rem;min-width:0}
  h3{font-size:.76rem;color:var(--muted);margin:.45rem 0 .1rem}
  .asset{display:grid;grid-template-columns:auto minmax(0,1fr) minmax(0,auto);gap:.55rem;align-items:center;text-align:left;min-width:0}
  .asset span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
  .asset span:first-of-type{display:grid}
  .asset small,.file-path,.tag-summary,small{color:var(--muted)}
  .asset small{overflow:hidden;text-overflow:ellipsis;font-size:.69rem}
  .tag-summary{font-size:.72rem}
  .asset-details{display:grid;gap:.45rem;align-content:start;min-width:0; padding:.55rem;border:1px solid var(--line)}
  .asset-details label,.pair label{display:grid;gap:.25rem;color:var(--muted);min-width:0}
  .file-path{overflow-wrap:anywhere;font-size:.72rem}
  .tags{display:flex;flex-wrap:wrap;gap:.3rem}
  .tags button{display:flex;align-items:center;gap:.25rem}
  .uniforms{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.25rem;font-size:.75rem}
  .uniforms dt{overflow-wrap:anywhere}
  .uniforms dd{color:var(--muted);margin:0}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
  label.check{display:flex;align-items:center;gap:.45rem}
  @media(max-width:700px){.content.details{grid-template-columns:minmax(0,1fr)}}
  @media(max-width:440px){.filters{grid-template-columns:1fr 1fr}.filter-search{grid-column:1/-1}.shader-filters{grid-template-columns:minmax(0,1fr)}}
</style>
