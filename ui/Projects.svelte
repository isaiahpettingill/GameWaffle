<script>
  import {onMount,tick} from 'svelte';
  import {Folder,FolderOpen,FolderPlus,FileArchive,ArrowUp,House,DoorOpen,ChevronRight,HardDrive,X} from '@lucide/svelte';
  import icon from '../packaging/gamewaffle.svg?inline';
  import {projectBasename} from '../src/resource-name.mjs';

  let recent=$state([]), ready=$state(false);
  let parent=$state(''), destination=$state(''), home=$state(''), name=$state(''),storage=$state('folder'),view=$state('platformer');
  let picker,createDialog,nameInput;
  let mode=$state('open'), listing=$state(null), page=$state(0);
  let error=$state(''), pickerError=$state(''), createError=$state(''), busy=$state(false), loading=$state(false), requestId=0;
  const entries=$derived((listing?.items??[]).filter(item=>(mode==='open'||item.folder)&&!item.name.startsWith('.')));
  const pageSize=30;
  const filename=$derived(name.trim()?projectBasename(name.trim())+(storage==='archive'?'.waffleproj':''):'');
  const pickerTitle=$derived(mode==='open'?'Open Project':'Choose a Folder');

  async function api(action,values={}){
    const res=await fetch('/',{method:'POST',body:new URLSearchParams({action,...values})});
    if(!res.ok)throw Error(await res.text());
    return res.json();
  }

  async function browse(path){
    const id=++requestId;
    loading=true;pickerError='';
    try{
      const next=await api('browse',{path});
      if(id!==requestId)return;
      listing=next;page=0;
    }catch(err){if(id===requestId)pickerError=err.message;}
    finally{if(id===requestId)loading=false;}
  }

  function pick(kind){
    mode=kind;pickerError='';listing=null;
    picker.showModal();
    return browse(kind==='destination'?destination:parent);
  }

  async function submit(action,values={}){
    if(busy)return;
    busy=true;error='';pickerError='';createError='';
    try{
      const result=await api(action,values);
      window.location.assign(result.url);
    }catch(err){
      if(picker.open)pickerError=err.message;
      else if(createDialog.open)createError=err.message;
      else error=err.message;
      busy=false;
    }
  }

  async function choose(){
    if(!listing||loading||busy)return;
    const path=listing.folder;
    if(mode==='open'){await submit('open',{path});return;}
    if(mode==='destination'){
      destination=path;
      picker.close();
      return;
    }
    try{
      parent=(await api('location',{path})).location;
      picker.close();
    }catch(err){pickerError=err.message;}
  }

  function newProject(){
    name='';storage='folder';view='platformer';destination=parent;createError='';
    createDialog.showModal();
    nameInput.focus();
  }

  function closeMenus(event){
    for(const menu of document.querySelectorAll('.export-menu[open]')){
      if(!menu.contains(event.target)||event.target.closest('button'))menu.open=false;
    }
  }

  function keys(event){
    if(picker.open||createDialog.open)return;
    if(event.key==='Escape'){
      for(const menu of document.querySelectorAll('.export-menu[open]')){
        menu.open=false;menu.querySelector('summary').focus();
      }
    }
    if(!ready||busy||!(event.metaKey||event.ctrlKey))return;
    if(event.key.toLowerCase()==='o'){
      event.preventDefault();pick('open');
    }
  }

  onMount(async()=>{
    try{
      const data=await api('settings');
      parent=data.location;home=data.home;recent=data.recent;ready=true;
      const action=new URLSearchParams(location.search).get('action');
      if(action==='open')await pick('open');
      else if(action==='new'){await tick();newProject();}
      else if(!action&&data.resume&&recent.length)await submit('open',{path:recent[0].path});
    }catch(err){error=err.message;}
  });
</script>

<svelte:window onclick={closeMenus} onkeydown={keys}/>
<header class="projectbar"><img src={icon} width="26" height="26" alt=""><strong>GameWaffle Studio</strong></header>
<nav class="studio-menus" aria-label="Application menu">
  <details class="export-menu" name="menu"><summary>File</summary><div class="card">
    <button disabled={!ready||busy} onclick={newProject}>New Project…</button>
    <button disabled={!ready||busy} onclick={()=>pick('open')}>Open Project…</button>
  </div></details>
  <details class="export-menu" name="menu"><summary>Tools</summary><div class="card">
    <button disabled={!ready||busy} onclick={()=>pick('default')}>Choose projects folder…</button>
    <button disabled={!ready||busy} onclick={()=>submit('demo')}>Open Basalt Works example</button>
  </div></details>
</nav>

<main>
  <h1>Projects</h1>
  <div class="launch-actions row">
    <button class="primary" onclick={newProject} disabled={!ready||busy}><FolderPlus size={18}/>New Project</button>
    <button onclick={()=>pick('open')} disabled={!ready||busy}><FolderOpen size={18}/>Open Project</button>
  </div>
  {#if recent.length}
    <h2>Recent projects</h2>
    <div class="recent">
      {#each recent as project (project.path)}
        <div>
          <button class="recent-open" disabled={busy} onclick={()=>submit('open',{path:project.path})}>
            {#if project.path.endsWith('.waffleproj')}<FileArchive/>{:else}<Folder/>{/if}
            <span><strong>{project.name}</strong><small>{project.path}</small></span>
          </button>
          <button class="icon-button" aria-label={'Remove '+project.name+' from recent projects'} title="Remove from list" onclick={async()=>{
            try{recent=(await api('forget',{path:project.path})).recent;}catch(err){error=err.message;}
          }}><X/></button>
        </div>
      {/each}
    </div>
  {/if}
  <button class="example" disabled={!ready||busy} onclick={()=>submit('demo')}><DoorOpen size={16}/>Open Example</button>
  {#if error}<p role="alert">{error}</p>{/if}
</main>

<dialog class="new-project" bind:this={createDialog} aria-labelledby="new-heading" oncancel={event=>{if(busy)event.preventDefault();}}>
  <form onsubmit={event=>{event.preventDefault();submit('new',{parent:destination,name,storage,view});}}>
    <h2 id="new-heading">New Project</h2>
    <label>Game name<input bind:this={nameInput} bind:value={name} required maxlength="80" placeholder="My game" disabled={busy}></label>
    <label>First room<select bind:value={view} disabled={busy}>
      <option value="platformer">Platformer</option>
      <option value="top_down">Top-down</option>
    </select></label>
    <div class="location">
      <div><small>Save in</small><output>{destination}</output></div>
      <button type="button" onclick={()=>pick('destination')} disabled={busy}>Change…</button>
    </div>
    <details class="storage"><summary>Storage options</summary>
      <label>Save as<select bind:value={storage} disabled={busy}>
        <option value="folder">Project folder</option>
        <option value="archive">Single .waffleproj file</option>
      </select></label>
    </details>
    {#if filename}<small>Suggested {storage==='archive'?'file':'folder'} name <strong>{filename}</strong></small>{/if}
    {#if createError}<p role="alert">{createError}</p>{/if}
    <footer>
      <button type="button" disabled={busy} onclick={()=>createDialog.close()}>Cancel</button>
      <button type="submit" class="primary" disabled={busy||!name.trim()}>{busy?'Creating…':'Create Project'}</button>
    </footer>
  </form>
</dialog>

<dialog bind:this={picker} aria-labelledby="picker-heading" oncancel={event=>{if(busy)event.preventDefault();}}>
  <h2 id="picker-heading">{pickerTitle}</h2>
  <div class="address">
    <button class="icon-button" title="Home folder" aria-label="Home folder" disabled={busy} onclick={()=>browse(home)}><House size={17}/></button>
    <button class="icon-button" title="Parent folder" aria-label="Parent folder" disabled={busy||!listing||listing.parent===listing.folder} onclick={()=>browse(listing.parent)}><ArrowUp size={17}/></button>
    <output aria-label="Current folder">{listing?.folder??(mode==='destination'?destination:parent)}</output>
  </div>
  {#if listing?.drives.length}<div class="drives">{#each listing.drives as drive}
    <button disabled={busy} onclick={()=>browse(drive)}><HardDrive size={14}/>{drive}</button>
  {/each}</div>{/if}
  <div class="entries" aria-busy={loading}>
    {#if loading}<small>Loading…</small>{:else}
      {#each entries.slice(page*pageSize,(page+1)*pageSize) as entry}
        <button disabled={busy} onclick={()=>entry.folder?browse(entry.path):submit('open',{path:entry.path})}>
          {#if entry.folder}<Folder size={17}/>{:else}<FileArchive size={17}/>{/if}
          <span>{entry.name}</span>{#if entry.folder}<ChevronRight size={14}/>{/if}
        </button>
      {:else}<small>No {mode==='open'?'folders or projects':'subfolders'} here.</small>{/each}
    {/if}
  </div>
  {#if entries.length>pageSize}<div class="paging">
    <button disabled={!page||busy} onclick={()=>page--}>Previous</button>
    <small>{page+1} / {Math.ceil(entries.length/pageSize)}</small>
    <button disabled={(page+1)*pageSize>=entries.length||busy} onclick={()=>page++}>Next</button>
  </div>{/if}
  {#if pickerError}<p role="alert">{pickerError}</p>{/if}
  <footer>
    <button disabled={busy} onclick={()=>picker.close()}>Cancel</button>
    <button class="primary" disabled={loading||busy||!listing||(mode==='open'&&!listing.project)}
      onclick={choose}>{mode==='open'?(busy?'Opening…':'Open This Project'):'Use This Folder'}</button>
  </footer>
</dialog>

<style>
  .projectbar,.address,.location,footer,.paging,.drives{display:flex;align-items:center;gap:.55rem}
  .projectbar{padding:.4rem .75rem;background:var(--panel)}
  main{margin:clamp(1rem,6vh,4rem) auto;width:min(36rem,calc(100% - 2rem));overflow-wrap:anywhere}
  h1{font-size:1.4rem}h2{font-size:1rem}
  .launch-actions{margin:.8rem 0 1.3rem}
  .launch-actions button{flex:1 1 auto}
  .recent{border:1px solid var(--line);background:var(--panel);max-height:50dvh;overflow-y:auto;overflow-x:hidden;margin-top:.55rem}
  .recent>div{display:flex;align-items:center;gap:.5rem;border-bottom:1px solid var(--line);padding:.25rem .45rem}
  .recent>div:last-child{border-bottom:0}
  .recent .recent-open{flex:1;min-width:0;justify-content:flex-start;border:0;background:transparent;text-align:left}
  .recent-open span{min-width:0}.recent-open small{display:block}
  .example{margin-top:1rem}
  dialog{background:var(--panel);color:inherit;border:1px solid var(--line);width:min(34rem,calc(100% - 1.5rem));max-height:92dvh;padding:1rem;overflow-x:hidden;overflow-y:auto}
  dialog.new-project{width:min(27rem,calc(100% - 1.5rem))}
  dialog::backdrop{background:#11111bcc}
  form,label{display:grid;gap:.35rem}
  form{gap:.85rem}
  label{font-size:.85rem}
  .location{justify-content:space-between;align-items:end}
  .location>div{min-width:0}
  output{display:block;overflow-wrap:anywhere;font-size:.82rem}
  summary{cursor:pointer}.storage label{margin-top:.45rem}
  .address,.drives{margin:.7rem 0}
  .address output{min-width:0;flex:1;background:var(--well);padding:.4rem}
  .entries{min-height:5rem;max-height:42dvh;overflow-x:hidden;overflow-y:auto;background:var(--well);padding:.3rem}
  .entries button{width:100%;justify-content:flex-start!important;background:none;border:0;text-align:left}
  .entries button:hover{background:var(--line)}
  .entries button span{flex:1;min-width:0;overflow-wrap:anywhere}
  .entries small{display:block;padding:.4rem}
  footer,.paging{justify-content:flex-end;flex-wrap:wrap;margin-top:.55rem}
  form footer{margin-top:0}
  [role=alert]{color:#f38ba8;margin:.35rem 0;overflow-wrap:anywhere}
  .drives{flex-wrap:wrap}
</style>
