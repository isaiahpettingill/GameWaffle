<script>
  import {onMount,tick} from 'svelte';
  import {Folder,FolderOpen,FolderPlus,FileArchive,ArrowUp,House,Search,DoorOpen,ChevronRight,HardDrive,History,X} from '@lucide/svelte';
  import icon from '../packaging/gamewaffle.svg?inline';
  let recent=$state([]),section=$state('recent'),recentFilter=$state('');
  let parent=$state(''),home=$state(''),sep=$state('/'),name=$state(''),storage=$state('folder'),view=$state('platformer');
  let dialog, nameInput=$state(), mode=$state(''),listing=$state(null),address=$state(''),query=$state(''),page=$state(0);
  let error=$state(''),pickerError=$state(''),busy=$state(false),loading=$state(false),requestId=0;
  const filtered=$derived((listing?.items??[]).filter(x=>(mode==='open'||x.folder)&&(!x.name.startsWith('.')||query.startsWith('.'))&&x.name.toLowerCase().includes(query.toLowerCase())));
  const destination=$derived(parent.replace(/[\\/]$/,'')+sep+(name.trim()||'…')+(storage==='archive'?'.waffleproj':''));
  async function api(action,values={}){
    const res=await fetch('/',{method:'POST',body:new URLSearchParams({action,...values})});
    if(!res.ok)throw Error(await res.text());
    return res.json();
  }
  async function browse(path){
    const id=++requestId; loading=true;pickerError='';
    try{
      const next=await api('browse',{path});
      if(id!==requestId)return;
      listing=next;address=next.folder;query='';page=0;
    }catch(e){if(id===requestId)pickerError=e.message;}
    finally{if(id===requestId)loading=false;}
  }
  async function pick(kind){
    mode=kind;error='';pickerError='';listing=null;address=parent;
    if(!dialog.open)dialog.showModal();
    await browse(parent);
  }
  async function submit(action,values={}){
    if(busy)return;
    busy=true;error='';pickerError='';
    try{const result=await api(action,values);window.location.assign(result.url);}
    catch(e){if(dialog.open)pickerError=e.message;else error=e.message;}
    finally{busy=false;}
  }
  async function choose(){
    if(!listing||loading)return;
    if(mode==='open'){await submit('open',{path:listing.folder});return;}
    try{parent=(await api('location',{path:listing.folder})).location;dialog.close();nameInput?.focus();}
    catch(e){pickerError=e.message;}
  }
  function closeMenus(event){
    for(const menu of document.querySelectorAll('.export-menu[open]')){
      if(!menu.contains(event.target)||event.target.closest('button'))menu.open=false;
    }
  }
  function keys(e){
    if(e.key==='Escape'){for(const m of document.querySelectorAll('.export-menu[open]')){m.open=false;m.querySelector('summary').focus();}}
    if(!dialog.open&&(e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='o'){e.preventDefault();pick('open');}
  }
  async function newProject(){section='new';await tick();nameInput.focus();nameInput.select();}
  onMount(async()=>{try{const data=await api('settings');parent=data.location;home=data.home;sep=data.sep;
    recent=data.recent;
    const action=new URLSearchParams(location.search).get('action');
    section=action==='new'?'new':'recent';
    if(action==='open')await pick('open');
    else if(!action&&data.resume&&recent.length)await submit('open',{path:recent[0].path});
    else if(action==='new')await newProject();
  }catch(e){error=e.message;}});
</script>
<svelte:window onclick={closeMenus} onkeydown={keys}/>
<header class="projectbar"><img src={icon} width="26" height="26" alt=""><strong>GameWaffle Studio</strong></header>
<nav class="studio-menus" aria-label="Application menu">
  <details class="export-menu" name="menu"><summary>File</summary><div class="card">
    <button onclick={()=>section='recent'}>Recent projects</button><button onclick={newProject}>New project</button><button onclick={()=>pick('open')}>Open project…</button>
  </div></details>
  <details class="export-menu" name="menu"><summary>Edit</summary><div class="card"><button onclick={newProject}>Edit new project name</button><button disabled={!name||section!=='new'} onclick={()=>{name='';nameInput.focus();}}>Clear project name</button></div></details>
  <details class="export-menu" name="menu"><summary>Tools</summary><div class="card"><button onclick={()=>pick('parent')}>Choose projects folder…</button><button onclick={()=>submit('demo')}>Open Basalt Works example</button></div></details>
</nav>
<main>
  <div class="heading"><h1>Project Manager</h1><button onclick={()=>pick('open')} disabled={!parent||busy}><FolderOpen size={17}/> Open project…</button></div>
  <div class="project-tabs"><button aria-pressed={section==='recent'} onclick={()=>section='recent'}><History size={16}/>Recent projects</button>
    <button aria-pressed={section==='new'} onclick={newProject}><FolderPlus size={16}/>New project</button></div>
  {#if section==='recent'}
    {#if recent.length>5}<input type="search" aria-label="Find recent projects" placeholder="Find recent projects" bind:value={recentFilter}>{/if}
    <div class="recent">
      {#each recent.filter(p=>(p.name+' '+p.path).toLowerCase().includes(recentFilter.toLowerCase())) as project}
        <div><button class="recent-open" disabled={busy} onclick={()=>submit('open',{path:project.path})}>
          {#if project.path.endsWith('.waffleproj')}<FileArchive/>{:else}<Folder/>{/if}
          <span><strong>{project.name}</strong><small>{project.path}</small></span>
        </button>
        <button class="icon-button" aria-label={'Remove '+project.name+' from recent projects'} title="Remove from list" onclick={async()=>{
          try{recent=(await api('forget',{path:project.path})).recent;}catch(e){error=e.message;}
        }}><X/></button></div>
      {:else}<p>{recent.length?'No matching projects.':'No recent projects.'}</p>{/each}
    </div>
  {:else}
  <form onsubmit={e=>{e.preventDefault();submit('new',{parent,name,storage,view});}}>
    <h2><FolderPlus size={18}/> New project</h2>
    <label>Project name<input bind:this={nameInput} bind:value={name} required maxlength="80" placeholder="My game"></label>
    <label for="project-location">Location</label>
    <div class="pathrow"><output id="project-location">{parent}</output><button type="button" onclick={()=>pick('parent')} disabled={!parent}><FolderOpen size={16}/> Browse…</button></div>
    <div class="fields"><label>Storage<select bind:value={storage}><option value="folder">Project folder</option><option value="archive">Single .waffleproj file</option></select></label>
    <label>First room<select bind:value={view}><option value="platformer">Platformer</option><option value="top_down">Top-down</option></select></label></div>
    <div class="destination"><small>Create at</small><output>{destination}</output></div>
    <button class="primary" disabled={!parent||busy}>Create project</button>
  </form>
  {/if}
  <button class="example" disabled={busy} onclick={()=>submit('demo')}><DoorOpen size={16}/> Open Basalt Works example</button>
  {#if error}<p role="alert">{error}</p>{/if}
</main>
<dialog bind:this={dialog} aria-labelledby="picker-heading">
  <h2 id="picker-heading">{mode==='open'?'Open project':'Choose project location'}</h2>
  <form class="address" onsubmit={e=>{e.preventDefault();browse(address);}}>
    <button class="icon-button" type="button" title="Home folder" aria-label="Home folder" onclick={()=>browse(home)}><House size={17}/></button>
    <button class="icon-button" type="button" title="Parent folder" aria-label="Parent folder" disabled={!listing||listing.parent===listing.folder} onclick={()=>browse(listing.parent)}><ArrowUp size={17}/></button>
    <input aria-label="Folder path" bind:value={address} required><button>Go</button>
  </form>
  {#if listing?.drives.length}<div class="drives">{#each listing.drives as drive}<button onclick={()=>browse(drive)}><HardDrive size={14}/>{drive}</button>{/each}</div>{/if}
  <label class="filter"><Search size={15}/><input aria-label="Filter files and folders" placeholder="Filter files and folders" bind:value={query} oninput={()=>page=0}></label>
  <div class="entries" aria-busy={loading}>
    {#if loading}<small>Loading…</small>{:else}
    {#each filtered.slice(page*40,page*40+40) as entry}
      <button disabled={busy} onclick={()=>entry.folder?browse(entry.path):submit('open',{path:entry.path})}>
        {#if entry.folder}<Folder size={17}/>{:else}<FileArchive size={17}/>{/if}{entry.name}{#if entry.folder}<ChevronRight size={14}/>{/if}
      </button>
    {:else}<small>No matching folders{mode==='open'?' or projects':''}.</small>{/each}{/if}
  </div>
  {#if filtered.length>40}<div class="paging"><button disabled={!page} onclick={()=>page--}>Previous</button><small>{page+1} / {Math.ceil(filtered.length/40)}</small><button disabled={(page+1)*40>=filtered.length} onclick={()=>page++}>Next</button></div>{/if}
  {#if pickerError}<p role="alert">{pickerError}</p>{/if}
  <footer><button onclick={()=>dialog.close()}>Cancel</button><button class="primary" disabled={loading||busy||!listing||(mode==='open'&&!listing.project)} onclick={choose}>{mode==='open'?'Open this project':'Use this folder'}</button></footer>
</dialog>
<style>
  .project-tabs{display:flex;gap:2px;margin-bottom:.6rem}.project-tabs [aria-pressed=true]{color:var(--accent);border-color:var(--accent)}
  .recent{border:1px solid var(--line);background:var(--panel);max-height:55dvh;overflow:auto}.recent>div{display:flex;align-items:center;gap:.5rem;border-bottom:1px solid var(--line);padding:.25rem .5rem}.recent p{padding:1rem;color:var(--muted)}
  .recent .recent-open{flex:1;min-width:0;justify-content:flex-start;border:0;background:transparent;text-align:left}.recent-open span{min-width:0}.recent-open small{display:block;overflow-wrap:anywhere}
  .projectbar,.heading,h2,.pathrow,.fields,.address,.filter,footer,.paging,.drives{display:flex;align-items:center;gap:.55rem}
  .projectbar{padding:.4rem .75rem;background:var(--panel)}main{margin:clamp(1rem,6vh,4rem) auto;width:min(38rem,calc(100% - 2rem))}
  .heading{justify-content:space-between;margin-bottom:1rem}h1{font-size:1.25rem}h2{font-size:1rem}
  main form{display:grid;gap:.7rem;padding:1.1rem;background:var(--panel);border:1px solid var(--line)}label{display:grid;gap:.3rem;font-size:.85rem}
  output{overflow-wrap:anywhere}.pathrow output,.destination{background:var(--well);padding:.5rem;font-family:monospace}
  .pathrow output,.fields label{flex:1;min-width:0}.pathrow button,.primary{flex:none}.destination{display:grid;gap:.2rem}.destination small{font-family:system-ui}
  main .primary,.example{justify-self:start}.example{margin-top:1rem}
  dialog{background:var(--panel);color:inherit;border:1px solid var(--line);width:min(38rem,96vw);max-height:92dvh;padding:1rem}
  dialog::backdrop{background:#11111bbd}.address,.filter,.drives{margin:.7rem 0}.address input,.filter input{min-width:0}
  .entries{height:min(16rem,35dvh);overflow:auto;background:var(--well);padding:.3rem}.entries button{width:100%;justify-content:flex-start!important;background:none;border:0;text-align:left;overflow-wrap:anywhere}.entries button:hover{background:var(--line)}.entries :global(svg:last-child:not(:first-child)){margin-left:auto}
  footer,.paging{justify-content:flex-end;margin-top:.7rem}.filter{color:var(--muted)}[role=alert]{color:#f38ba8;margin:.6rem 0}.drives{flex-wrap:wrap}
</style>
