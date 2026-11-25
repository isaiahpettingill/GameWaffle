<script>
  import {Upload, Search, Image, AudioLines, File, Code, Type, Plus, Ellipsis, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ExternalLink} from '@lucide/svelte';
  import Modal from './Modal.svelte';
  import GlyphGrid from './GlyphGrid.svelte';
  import SearchSelect from './SearchSelect.svelte';
  import CoverCrop from './CoverCrop.svelte';
  import TagInput from './TagInput.svelte';
  import {DEFAULT_COVER_CROP} from '../src/cover.mjs';
  import {assetCatalog,assetKinds,assetLabels,editableArtFile,tagList} from '../src/asset-types.mjs';

  let {project,files,shaderDefinitions,onUpload,onEdit,onOpen,onEditSource,onShader,previewFor=()=>'',fontTools,selectedPath='',initialKind='',shadersOnly=false}=$props();
  let query=$state(''), type=$state(''), tag=$state(''), selected=$state('');
  let sortBy=$state('name'), descending=$state(false), page=$state(0), details=$state.raw(null), destinations=$state.raw(null);
  let picker=$state(), dragging=$state(false), queue=$state.raw([]), file=$state.raw(null);
  let suggestedKind='';
  let name=$state(''), tags=$state([]), kind=$state(''), error=$state(''), saving=$state(false);
  let editName=$state(''), editTags=$state([]);
  let soundFont=$state(''), compress=$state(true), tileCollision=$state(true);
  let width=$state(6), height=$state(8), assignments=$state({}), preview=$state('');
  let coverCrop=$state({...DEFAULT_COVER_CROP}), coverUpload=$state.raw(null);
  const catalog=$derived(assetCatalog(project,files).filter(asset=>!shadersOnly||asset.kind==='shader'));
  const tagChoices=$derived([...new Set(catalog.flatMap(asset=>asset.tags))].sort((a,b)=>a.localeCompare(b)));
  const match=$derived(query.trim().toLowerCase());
  const filtered=$derived(catalog.filter(asset=>(!type||asset.kind===type)&&(!tag||asset.tags.includes(tag))
    &&(!match||[asset.name,asset.path,...asset.tags].some(value=>value.toLowerCase().includes(match)))));
  const pageSize=24;
  const order=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
  const sortValue=asset=>sortBy==='kind'?assetLabels[asset.kind]??asset.kind:asset.name;
  const sorted=$derived(filtered.toSorted((a,b)=>(descending?-1:1)*order.compare(sortValue(a),sortValue(b))||a.path.localeCompare(b.path)));
  const pageCount=$derived(Math.ceil(filtered.length/pageSize));
  const pageIndex=$derived(Math.min(page,Math.max(0,pageCount-1)));
  const visible=$derived(sorted.slice(pageIndex*pageSize,(pageIndex+1)*pageSize));
  const shader=$derived(shaderDefinitions[details?.linked.find(link=>link.kind==='shader')?.id]);
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
  $effect(()=>{query;type;tag;sortBy;descending;page=0;});
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
    tags=[];soundFont=soundFonts.length===1?soundFonts[0].value:'';compress=true;tileCollision=true;
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
        name:name.trim(),tags:tagList(tags),soundFont,compress,tileCollision,
        ...(kind==='cover'?{coverCrop:$state.snapshot(coverCrop)}:{}),
        ...(sheet?{font:{glyphWidth:width,glyphHeight:height,assignments:$state.snapshot(assignments)}}:{})});
      type=kind;query='';tag='';selected=path;
      if(shadersOnly)onShader(undefined,path);
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
    suggestedKind=type||initialKind;
    if(!saving)enqueue(event.dataTransfer.files);
  }
  export function pick(type=initialKind) {
    suggestedKind=type;
    picker.click();
  }
  export function select(path) {
    query='';tag='';selected=path;
  }
  function edit(asset){
    editName=asset.name;editTags=[...asset.tags];details=asset;
  }
  function applyMetadata(event){
    event.preventDefault();
    if(!editName.trim())return;
    onEdit(details,{name:editName.trim(),tags:tagList(editTags)});
    details=null;
  }
  function changeSort(field){
    if(sortBy===field)descending=!descending;
    else{sortBy=field;descending=false;}
  }
  function sortDirection(field){return sortBy===field?(descending?'descending':'ascending'):'none';}
  function activate(asset){
    selected=asset.path;
    if(asset.kind==='shader'){onShader(asset.linked.find(link=>link.kind==='shader')?.id,asset.path);return;}
    const links=asset.linked.filter(link=>link.kind===asset.kind&&['sprite','tile','font'].includes(link.kind));
    if(links.length===1)onOpen(links[0]);
    else if(links.length>1)destinations={asset,links};
    else edit(asset);
  }
  const icons={shader:Code,font:Type,sound:AudioLines,music:AudioLines,soundfont:AudioLines,
    sprite:Image,tile:Image,background:Image,cover:Image,source:Image};
  const singular={sprite:'Sprite',tile:'Tileset',font:'Bitfont',background:'Background image',cover:'Cover image',
    sound:'Sound effect',music:'Music',soundfont:'SoundFont',shader:'SPIR-V shader',source:'Source image'};
</script>

{#snippet thumbnail(asset)}
  {@const Icon=icons[asset.kind]??File}
  {@const url=previewFor(asset)}
  <span class="thumbnail" aria-hidden="true">
    {#if url}<img src={url} alt="" loading="lazy" decoding="async">{:else}<Icon size={17}/>{/if}
  </span>
{/snippet}
{#snippet actions(asset)}
  {#if onEditSource&&editableArtFile.test(asset.path)}
    <button type="button" class="icon-button asset-actions" aria-label={'Open '+asset.name+' in default editor'} title="Open in default editor"
      onclick={()=>onEditSource(asset.path)}><ExternalLink size={16}/></button>
  {/if}
  <button type="button" class="icon-button asset-actions" aria-label={'Edit details for '+asset.name} title="Edit name and tags" onclick={()=>edit(asset)}>
    <Ellipsis size={17}/>
  </button>
{/snippet}
{#snippet assetName(asset)}
  {@render thumbnail(asset)}
  <span class="asset-label">
    <strong>{asset.name}</strong><small>{asset.path.split('/').at(-1)}</small>
    {#if !shadersOnly}<small class="mobile-kind">{assetLabels[asset.kind]??asset.kind}</small>{/if}
  </span>
{/snippet}
{#snippet empty()}
  <p class="empty muted">{shadersOnly?(catalog.length?'No shaders match the filters.':'No project shaders yet.'):(catalog.length?'No assets match the filters.':'Load an asset to start the library.')}</p>
{/snippet}

<section class="card library" class:shader-library={shadersOnly} aria-label={shadersOnly?'Shader library':'Asset library'}>
  <header class="row heading">
    <h2>{shadersOnly?'Shaders':'Assets'}</h2>
    {#if shadersOnly}
      <button type="button" class="primary" onclick={()=>onShader()}><Plus size={15}/>New shader…</button>
    {:else}
      <button type="button" aria-pressed={type==='font'} onclick={()=>type=type==='font'?'':'font'}><Type size={15}/>Bitfonts</button>
    {/if}
  </header>
  <div role="region" aria-label={shadersOnly?'Shader drop zone':'Asset drop zone'} class="dropzone" class:dragging
    ondragover={acceptDrop} ondragleave={event=>{if(!event.currentTarget.contains(event.relatedTarget))dragging=false;}} ondrop={loadDrop}>
    {#if !shadersOnly}<Upload size={18} aria-hidden="true"/><span>Drop files to import</span>{/if}
    <button class:primary={!shadersOnly} onclick={()=>pick(type||initialKind)} disabled={saving}>{loadLabel}…</button>
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
    {#if !shadersOnly||tagChoices.length}
      <select aria-label="Asset tag filter" bind:value={tag}><option value="">All tags</option>
        {#each tagChoices as value}<option {value}>{value}</option>{/each}
      </select>
    {/if}
  </div>
  {#if shadersOnly}
    <div class="shader-list">
      {#each filtered as asset (asset.path)}
        <div class="shader-entry">
          <button type="button" class="asset" aria-pressed={selectedPath===asset.path} onclick={()=>activate(asset)}>
            {@render assetName(asset)}
          </button>
          {@render actions(asset)}
        </div>
      {:else}{@render empty()}{/each}
    </div>
  {:else}
    {@render fontTools?.(type==='font')}
    {#if filtered.length}
      <table aria-label="Project assets">
        <colgroup><col><col class="kind-column"><col class="tags-column"><col class="action-column"></colgroup>
        <thead><tr>
          <th scope="col" aria-sort={sortDirection('name')}><button type="button" class="sort" onclick={()=>changeSort('name')}>Asset
            {#if sortBy==='name'}{#if descending}<ChevronDown size={13}/>{:else}<ChevronUp size={13}/>{/if}{/if}
          </button></th>
          <th scope="col" class="kind-cell" aria-sort={sortDirection('kind')}><button type="button" class="sort" onclick={()=>changeSort('kind')}>Type
            {#if sortBy==='kind'}{#if descending}<ChevronDown size={13}/>{:else}<ChevronUp size={13}/>{/if}{/if}
          </button></th>
          <th scope="col" class="tag-cell">Tags</th>
          <th scope="col" aria-label="Actions"></th>
        </tr></thead>
        <tbody>
          {#each visible as asset (asset.path)}
            <tr class:chosen={selected===asset.path&&asset.kind==='tile'}>
              <td><button type="button" class="asset" onclick={()=>activate(asset)}>{@render assetName(asset)}</button></td>
              <td class="kind-cell">{assetLabels[asset.kind]??asset.kind}</td>
              <td class="tag-cell">
                <div class="tag-summary">
                  {#each asset.tags as value}
                    <button type="button" class="chip" aria-label={'Filter by tag '+value} aria-pressed={tag===value}
                      onclick={()=>tag=tag===value?'':value}>{value}</button>
                  {/each}
                </div>
              </td>
              <td><div class="asset-tools">{@render actions(asset)}</div></td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if pageCount>1}
        <div class="pager row">
          <small>{pageIndex*pageSize+1}–{Math.min((pageIndex+1)*pageSize,filtered.length)} of {filtered.length} assets</small>
          <button type="button" class="icon-button" aria-label="Previous assets" disabled={!pageIndex} onclick={()=>page=pageIndex-1}><ChevronLeft size={15}/></button>
          <button type="button" class="icon-button" aria-label="Next assets" disabled={pageIndex+1>=pageCount} onclick={()=>page=pageIndex+1}><ChevronRight size={15}/></button>
        </div>
      {/if}
    {:else}{@render empty()}{/if}
  {/if}
</section>

{#if details}
  <Modal title="Asset details" onClose={()=>details=null}>
    <form onsubmit={applyMetadata}>
      <div class="metadata-heading">
        {@render thumbnail(details)}
        <small class="file-path">{details.path}</small>
      </div>
      <label>Name<input aria-label="Asset name" bind:value={editName} maxlength="100" required></label>
      <TagInput value={editTags} onChange={value=>editTags=value}/>
      {#if shader}
        <h3>Shader parameters</h3>
        <dl class="uniforms">
          {#each shader.parameters as parameter}
            <dt>{parameter.name}</dt><dd>{parameter.automatic?'Automatic':parameter.kind+(parameter.lanes>1?' × '+parameter.lanes:'')}</dd>
          {:else}<dd>No uniforms</dd>{/each}
        </dl>
      {/if}
      <div class="dialog-actions"><button type="button" onclick={()=>details=null}>Cancel</button>
        <button class="primary" disabled={!editName.trim()}>Save details</button></div>
    </form>
  </Modal>
{/if}
{#if destinations}
  <Modal title={'Open '+destinations.asset.name} onClose={()=>destinations=null}>
    <div class="destinations">
      {#each destinations.links as link}
        <button type="button" onclick={()=>{destinations=null;onOpen(link);}}>{link.label}</button>
      {/each}
    </div>
    <div class="dialog-actions"><button type="button" onclick={()=>destinations=null}>Cancel</button></div>
  </Modal>
{/if}

{#if file}
  <Modal title={loadLabel} busy={saving} onClose={()=>{file=null;queue=[];}}>
    <form onsubmit={event=>{event.preventDefault();save();}}>
      <small>{file.name}{queue.length?' · '+queue.length+' more queued':''}</small>
      {#if !shadersOnly}
        <label>Asset type<select aria-label="Asset type" bind:value={kind} disabled={saving}>
          {#each choices as value}<option {value}>{singular[value]}</option>{/each}
        </select></label>
      {/if}
      <label>Name<input bind:value={name} required maxlength="100" disabled={saving}></label>
      <TagInput value={tags} onChange={value=>tags=value} disabled={saving}/>
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
  .library{display:grid;gap:.65rem;padding:.7rem;min-width:0;align-content:start}
  .heading{justify-content:space-between}
  h2{font-size:1rem;margin:0}
  .dropzone{display:flex;align-items:center;gap:.55rem;flex-wrap:wrap;
    padding:.45rem .6rem;border:1px dashed var(--line);background:var(--well);color:var(--muted)}
  .dropzone.dragging{border-color:var(--accent);color:var(--accent)}
  .library:not(.shader-library) .dropzone button{margin-left:auto}
  .filters{display:grid;grid-template-columns:minmax(0,1fr) repeat(2,minmax(0,10rem));gap:.45rem}
  .shader-filters{grid-template-columns:minmax(0,1fr)}
  .filter-search{display:flex;align-items:center;gap:.4rem;min-width:0}
  .filter-search input{width:100%;min-width:0}
  table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:.8rem}
  .kind-column{width:20%}.tags-column{width:31%}.action-column{width:4.4rem}
  .asset-tools{display:flex;justify-content:flex-end;gap:.1rem}
  td,th{overflow-wrap:anywhere;text-align:left;vertical-align:middle;border-bottom:1px solid var(--line)}
  td{padding:.25rem .4rem}
  td:first-child{padding:.15rem}
  th{padding:.28rem .4rem;color:var(--muted);font-size:.74rem;background:var(--well)}
  th:first-child{padding-left:.25rem}
  tbody tr{position:relative}
  tbody tr:hover,tbody tr:focus-within,.chosen{background:#252437}
  .sort{border:0;background:none;min-height:1.55rem;padding:.1rem .3rem;color:inherit}
  .asset{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.55rem;align-items:center;text-align:left;justify-content:start;width:100%;min-width:0;border-color:transparent;background:transparent;padding:.22rem}
  .asset:hover{border-color:var(--line)}
  td>.asset::after{position:absolute;inset:0;content:''}
  .asset[aria-pressed=true]{color:var(--accent);background:var(--well)}
  .asset-label{display:grid;min-width:0}
  .asset strong,.asset small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .asset small,.file-path,small{color:var(--muted);font-size:.72rem}
  .thumbnail{width:2.6rem;height:2.6rem;display:grid;place-items:center;background:var(--well);border:1px solid var(--line);color:var(--muted)}
  .thumbnail img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated}
  .mobile-kind{display:none}
  .tag-summary{display:flex;gap:.25rem;flex-wrap:wrap}
  .chip{min-height:1.45rem;max-width:100%;padding:.11rem .45rem;border-radius:1rem;display:block;overflow:hidden;text-overflow:ellipsis;font-size:.69rem}
  .chip,.asset-actions{position:relative}
  .asset-actions{padding:.2rem}
  .shader-library .dropzone{padding:.35rem}
  .shader-entry{display:grid;min-width:0;grid-template-columns:minmax(0,1fr) auto;align-items:center}
  .shader-entry .asset{gap:.28rem}
  .shader-entry .thumbnail{background:transparent;border:0;width:1.15rem;height:1.45rem}
  .shader-entry .asset-actions{width:1.65rem}
  .pager{justify-content:flex-end}
  .empty{padding:.9rem;text-align:center}
  .metadata-heading{display:flex;align-items:center;gap:.5rem}
  .file-path{overflow-wrap:anywhere}
  .destinations{display:grid;gap:.3rem}
  h3{font-size:.82rem;margin:0}
  .uniforms{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.25rem;font-size:.75rem;margin:0}
  .uniforms dt{overflow-wrap:anywhere}
  .uniforms dd{color:var(--muted);margin:0}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
  .pair label{display:grid;gap:.25rem;color:var(--muted);min-width:0}
  label.check{display:flex;align-items:center;gap:.45rem}
  @media(max-width:560px){
    .kind-column,.kind-cell,.tags-column,.tag-cell{display:none}
    .mobile-kind{display:block}
  }
  @media(max-width:440px){.filters{grid-template-columns:1fr 1fr}.filter-search{grid-column:1/-1}.shader-filters{grid-template-columns:minmax(0,1fr)}}
</style>
