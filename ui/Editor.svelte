<script>
  import { onMount } from 'svelte';
  import ScriptPanel from './ScriptPanel.svelte';
  import Physics from './Physics.svelte';
  import { unpack } from '../src/cartridge.mjs';
  import RoomMap from './RoomMap.svelte';

  let project=$state(null), assets=$state([]), art=$state({}), tab=$state('room'), roomId=$state(''), spriteId=$state(''),
    tileId=$state(''), layerIndex=$state(0), assetKind=$state('sprite'), scriptDirty=$state(false),
    dirty=$state(false), busy=$state(false), error=$state(''), status=$state('Opening project…'), newId=$state(''),
    newSource=$state(''), audioId=$state(''), audioSource=$state('');
  let tileArt=$state.raw({}), spriteArt=$state.raw({}), previewModes=$state.raw({});
  let historyVersion=$state(0), selectedEntity=$state(-1), roomPanel=$state('layers'), addPreset=$state(false);
  let savedRooms={}, dirtyOutsideRoom=false, history=new Map(), previewUrls=[];
  let dimensions=$state(null);
  let revision=-1, checking=false;
  let sourceError=$state('');
  let room=$derived(project?.rooms[roomId]), layer=$derived(room?.layers?.[layerIndex]);
  let sprite=$derived(project?.sprites?.[spriteId]), tile=$derived(project?.tiles?.[tileId]);
  let inspector=$derived(assetKind==='tile' ? tile : sprite);
  let artFiles=$derived(assets.filter(file=>/\.(ase|aseprite)$/i.test(file)));
  let audioFiles=$derived(assets.filter(file=>/\.(wav|ogg|oga|opus|qoa)$/i.test(file)));
  const tabs=[['room','Room'],['blocks','Blocks'],['assets','Assets']];
  const historyStatus=$derived.by(()=>{
    const revision=historyVersion;
    const edits=history.get(roomId);
    return { revision, canUndo:Boolean(edits?.undo.length), canRedo:Boolean(edits?.redo.length) };
  });
  const sortedLayers=$derived((room?.layers ?? []).map((layer,index)=>({layer,index,order:layer.order??index}))
    .sort((a,b)=>b.order-a.order || b.index-a.index));
  const maxTiles=$derived(Math.floor(4096/(project?.tileSize??24)));
  const roomView=$derived(room?.view ?? (Math.abs(room?.gravity??24) < .01 ? 'top_down' : 'platformer'));
  const actor=$derived(room?.entities[selectedEntity]);
  const exportName=$derived((project?.name??'game').toLowerCase().replace(/[^a-z0-9]+/g,'-') || 'game');

  async function request(path, method='GET', data) {
    const response=await fetch(path,{method,headers:data ? {'Content-Type':'application/json'} : {},body:data ? JSON.stringify(data) : undefined});
    const result=await response.json();
    if(!response.ok)throw Error(result.error ?? 'Request failed');
    return result;
  }
  async function updatePreviews() {
    const response=await fetch('./demo.waffle',{cache:'no-store'});
    if(!response.ok)throw Error('Could not open project preview');
    const next=unpack(new Uint8Array(await response.arrayBuffer()));
    for(const url of previewUrls) URL.revokeObjectURL(url);
    previewUrls=[];
    function png(bytes){
      const url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
      previewUrls.push(url);
      return url;
    }
    const tiles=next.tilePreviews??Object.fromEntries(Object.entries(next.thumbnails??{}).map(([id,bytes])=>[id,{variants:[bytes]}]));
    tileArt=Object.fromEntries(Object.entries(tiles).map(([id,data])=>[id,data.variants.map(png)]));
    previewModes=Object.fromEntries(Object.entries(tiles).map(([id,data])=>[id,data.mode]));
    spriteArt=Object.fromEntries(Object.entries(next.spritePreviews??{}).map(([id,data])=>[id,png(data)]));
  }
  async function load() {
    try{
      const value=await request('./api/project');
      project=value.project; assets=value.assets; art=value.art; revision=value.revision;
      savedRooms=JSON.stringify(value.project.rooms);
      audioSource=assets.find(file=>/\.(wav|ogg|oga|opus|qoa)$/i.test(file)) ?? '';
      roomId=project.start ?? Object.keys(project.rooms)[0];
      spriteId=Object.keys(project.sprites ?? {})[0] ?? '';
      tileId=Object.keys(project.tiles ?? {})[0] ?? '';
      newSource=assets.find(file=>/\.(ase|aseprite)$/i.test(file)) ?? '';
      layerIndex=chooseInitialLayer(project.rooms[roomId]);
      await updatePreviews();
      status='Ready';
    }catch(err){error=err.message;status='Project unavailable';}
  }
  onMount(()=>{
    load();
    const monitor=setInterval(checkAssets,1600);
    return ()=>{clearInterval(monitor);for(const url of previewUrls)URL.revokeObjectURL(url);};
  });
  async function checkAssets(){
    if(!project||busy||checking)return;
    checking=true;
    try{
      const state=await request('./api/status');
      sourceError=state.sourceError;
      if(state.revision!==revision){
        const current=await request('./api/project');
        if(busy)return;
        assets=current.assets;art=current.art;
        await updatePreviews();
        revision=current.revision;
        if(!dirty)status='Assets rebuilt';
      }
    }catch(err){sourceError=err.message;}finally{checking=false;}
  }
  function mark(){
    dirtyOutsideRoom=true;
    updateDirty();
  }
  function updateDirty(){
    dirty=dirtyOutsideRoom || JSON.stringify(project.rooms)!==savedRooms;
    status=dirty ? 'Unsaved project' : 'Ready';
  }
  function replaceRoom(next){
    if(busy)return;
    const before=JSON.stringify(room);
    const after=JSON.stringify(next);
    if(before===after)return;
    const edits=history.get(roomId)??{undo:[],redo:[]};
    edits.undo.push(before);
    if(edits.undo.length>50)edits.undo.shift();
    edits.redo.length=0;
    history.set(roomId,edits);
    applyRoom(after);
  }
  function applyRoom(serialized){
    project.rooms[roomId]=JSON.parse(serialized);
    layerIndex=Math.min(layerIndex,project.rooms[roomId].layers.length-1);
    if(selectedEntity>=project.rooms[roomId].entities.length)selectedEntity=-1;
    dimensions=null;
    historyVersion+=1;
    updateDirty();
  }
  function editRoom(change){
    const next=JSON.parse(JSON.stringify(room));
    change(next);
    replaceRoom(next);
  }
  function restoreRoom(back){
    if(busy)return;
    const edits=history.get(roomId);
    const active=back ? edits?.undo : edits?.redo;
    if(!active?.length)return;
    (back ? edits.redo : edits.undo).push(JSON.stringify(room));
    selectedEntity=-1;
    applyRoom(active.pop());
  }
  function setRoom(key,value){
    editRoom(next=>{if(value==='')delete next[key];else next[key]=value;});
  }
  function setView(view){
    editRoom(next=>{
      next.view=view;
      next.ySort=view==='top_down';
      next.closedEdges=view==='top_down';
      if(view==='platformer' && Math.abs(next.gravity??24)<.01)next.gravity=24;
    });
  }
  function resizeRoom(key,input){
    const value=input.valueAsNumber;
    if(!Number.isInteger(value)||value<1||value>maxTiles){input.value=room[key];return;}
    const next={...(dimensions??{cols:room.cols,rows:room.rows}),[key]:value};
    const size=project.tileSize??24;
    const cuts=room.layers.some(layer=>layer.cells.some(([x,y])=>x>=next.cols||y>=next.rows))
      || room.entities.some(entity=>entity.x>=next.cols*size||entity.y>=next.rows*size);
    if(cuts){dimensions=next;return;}
    editRoom(draft=>Object.assign(draft,next));
  }
  function cropRoom(){
    const {cols,rows}=dimensions;
    const size=project.tileSize??24;
    editRoom(next=>{
      Object.assign(next,{cols,rows});
      for(const layer of next.layers)layer.cells=layer.cells.filter(([x,y])=>x<cols&&y<rows);
      next.entities=next.entities.filter(entity=>entity.x<cols*size&&entity.y<rows*size);
    });
    selectedEntity=-1;
  }
  function chooseLayer(index){
    layerIndex=index;
    roomPanel='layers';
  }
  function changeLayer(key,value){
    if(key==='name' && !value.trim())return;
    editRoom(next=>{next.layers[layerIndex][key]=value;});
  }
  function moveLayer(direction){
    const index=sortedLayers.findIndex(entry=>entry.index===layerIndex);
    const neighbor=sortedLayers[index+direction];
    if(!neighbor)return;
    editRoom(next=>{
      if(neighbor.order===sortedLayers[index].order){
        const order=sortedLayers.map(item=>item.index);
        [order[index],order[index+direction]]=[order[index+direction],order[index]];
        const high=sortedLayers[0].order;
        const anchor=Math.max(-10000,high-order.length+1);
        order.reverse().forEach((layer,i)=>{next.layers[layer].order=anchor+i;});
      }else{
        next.layers[layerIndex].order=neighbor.order;
        next.layers[neighbor.index].order=sortedLayers[index].order;
      }
    });
  }
  function removeLayer(){
    if(room.layers.length<2)return;
    editRoom(next=>next.layers.splice(layerIndex,1));
  }
  function changeActor(key,value){
    if(!actor)return;
    const maximum=(key==='x'?room.cols:room.rows)*(project.tileSize??24);
    if((key==='x'||key==='y') && (!Number.isFinite(value)||value<0||value>=maximum))return;
    editRoom(next=>{
      if(key==='player'&&value!==''){
        const occupied=next.entities.find((entry,index)=>index!==selectedEntity && entry.player===Number(value));
        if(occupied)delete occupied.player;
      }
      if(value==='')delete next.entities[selectedEntity][key];
      else next.entities[selectedEntity][key]=key==='player' ? Number(value) : value;
    });
  }
  function openTab(id){
    if(scriptDirty && id!=='blocks'){error='Save or discard the current script first.';return;}
    error='';tab=id;
  }
  function selectSprite(id){
    if(scriptDirty && spriteId!==id){error='Save or discard the current script first.';return;}
    spriteId=id;assetKind='sprite';error='';
  }
  function chooseInitialLayer(map){
    const layers=(map?.layers??[]).map((item,index)=>({item,index}));
    return layers.sort((a,b)=>Number(Boolean(b.item.collidable))-Number(Boolean(a.item.collidable))
      || (b.item.order??b.index)-(a.item.order??a.index)).at(0)?.index??0;
  }
  function selectRoom(id){
    if(scriptDirty){openTab('room');return;}
    roomPanel='layers';selectedEntity=-1;dimensions=null;
    roomId=id;layerIndex=chooseInitialLayer(project.rooms[id]);
    openTab('room');
  }
  async function saveProject(){
    if(busy)return false;
    busy=true;error='';
    const saved=JSON.stringify(project);
    try{
      await request('./api/project','PUT',JSON.parse(saved));
      await updatePreviews();
      revision=(await request('./api/status')).revision;
      savedRooms=JSON.stringify(JSON.parse(saved).rooms);
      dirtyOutsideRoom=JSON.stringify(project)!==saved && dirtyOutsideRoom;
      updateDirty();
      if(!dirty)status='Project saved';
      return !dirty;
    }catch(err){error=err.message;return false;}finally{busy=false;}
  }
  async function saveScript(id){
    if(!project.sprites[id].script) project.sprites[id].script=`scripts/${id}.cbor`;
    await updatePreviews();
    revision=(await request('./api/status')).revision;
    status='Script saved';
  }
  async function rebuild(){
    busy=true;error='';
    try{
      await request('./api/rebuild','POST');
      const current=await request('./api/project');
      assets=current.assets; art=current.art; revision=current.revision;
      await updatePreviews();
      status=dirty ? 'Unsaved project' : 'Assets rebuilt';
    }catch(err){error=err.message;}finally{busy=false;}
  }
  function saveShortcut(event){
    if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='s' && project && tab==='room'){
      event.preventDefault();
      if(dirty)saveProject();
    }
  }
  async function saveThenOpen(event){
    if(busy){event.preventDefault();return;}
    if(scriptDirty){event.preventDefault();error='Save or discard the current script first.';return;}
    if(!dirty)return;
    event.preventDefault();
    const link=event.currentTarget;
    const href=link.href;
    const download=link.getAttribute('download');
    if(!await saveProject())return;
    if(download==null){location.assign(href);return;}
    const action=document.createElement('a');
    action.href=href;
    action.download=download;
    action.click();
  }
  function addLayer(){
    const order=Math.min(10000,Math.max(-1,...sortedLayers.map(item=>item.order))+1);
    editRoom(next=>next.layers.push({name:`Layer ${next.layers.length+1}`,order,collidable:false,cells:[]}));
    layerIndex=room.layers.length-1;
  }
  function addRoom(view){
    if(scriptDirty){openTab('room');return;}
    let index=1;
    while(project.rooms[`room${index}`])index++;
    const id=`room${index}`;
    const topDown=view==='top_down';
    project.rooms[id]={title:`Room ${index}`,cols:28,rows:15,background:'#171829',view,
      layers:[
        {name:topDown?'Ground':'Background',order:0,collidable:false,cells:[]},
        {name:topDown?'Walls':'Terrain',order:2,collidable:true,cells:[]},
      ],entities:[]};
    addPreset=false;
    selectRoom(id);
    updateDirty();
  }
  function addAsset(){
    if(!/^[a-zA-Z0-9_-]+$/.test(newId)||['__proto__','constructor','prototype'].includes(newId)||!newSource){
      error='Enter an asset ID with letters, numbers, hyphens, or underscores, then select a source file.';return;
    }
    const collection=assetKind==='tile' ? (project.tiles??={}) : (project.sprites??={});
    if(Object.hasOwn(collection,newId)){error='That asset ID already exists.';return;}
    collection[newId]={source:newSource,physics:{}};
    if(assetKind==='tile')tileId=newId;else spriteId=newId;
    newId='';error='';mark();
  }
  function addTags(){
    const source=art[newSource];
    if(!source?.tags?.length)return;
    const collection=project.tiles??={};
    const basename=newSource.split('/').at(-1).split('.')[0];
    for(const [index,tag] of source.tags.entries()){
      const slug=tag.split(':')[0].toLowerCase().replace(/[^a-z0-9_-]/g,'-').replace(/^-+|-+$/g,'');
      if(Object.values(collection).some(tile=>tile.source===newSource && (tile.tag??source.tags[0])===tag))continue;
      const stem=(newId || basename).toLowerCase().replace(/[^a-z0-9_-]/g,'-') || 'tile';
      const base=stem+'-'+(slug || String(index+1));
      let id=base, n=2;
      while(Object.hasOwn(collection,id))id=base+'-'+n++;
      collection[id]={source:newSource,tag,physics:{}};
      tileId=id;
    }
    mark();
  }
  function addAudio(){
    if(!/^[a-zA-Z0-9_-]+$/.test(audioId)||['__proto__','constructor','prototype'].includes(audioId)||!audioSource){
      error='Enter an audio ID and select an audio source.';return;
    }
    const registry=project.audio??={};
    if(Object.hasOwn(registry,audioId)){error='That audio ID already exists.';return;}
    registry[audioId]={source:audioSource};
    audioId='';error='';mark();
  }
  function toggleCompression(id,enabled){
    const item=project.audio[id];
    project.audio[id]={source:typeof item==='string'?item:item.source,compress:enabled};
    mark();
  }
  function set(target,key,value){
    if(value===''||value===undefined)delete target[key];else target[key]=value;
    mark();
  }
</script>

<svelte:window onkeydown={saveShortcut} />

<header class="appbar">
  <div class="brand">
    <span class="logo" aria-hidden="true">{#each Array(9) as _}<i></i>{/each}</span>
    <div><h1>GameWaffle Studio</h1><small>{project?.name ?? 'Sprite game editor'}</small></div>
  </div>
  <div class="row actions">
    <span class="status" role="status">{status}</span>
    <button onclick={rebuild} disabled={busy||!project}>Rebuild assets</button>
    <button onclick={saveProject} disabled={!dirty||busy}>Save project</button>
    <details class="export-menu">
      <summary>Export</summary>
      <div class="card">
        <a download={exportName+'.html'} href="./export.html" onclick={saveThenOpen}>Standalone web game</a>
        <a download={exportName+'.waffle'} href="./demo.waffle" onclick={saveThenOpen}>Cartridge</a>
      </div>
    </details>
    <a class="button primary" href="./player.html" onclick={saveThenOpen}>Play game ↗</a>
  </div>
</header>
{#if error || sourceError}<p role="alert" class="error banner">{error || sourceError}</p>{/if}
{#if project}
  <main>
    <aside class="project card">
      <div class="heading row"><h2>Project</h2></div>
      <div class="category">
        <div class="heading row"><h3>Rooms</h3><button class="small-button" title="New room" aria-label="New room" aria-expanded={addPreset} disabled={busy} onclick={()=>addPreset=!addPreset}>+</button></div>
        {#if addPreset}<div class="presets">
          <button onclick={()=>addRoom('platformer')}>New platformer room</button>
          <button onclick={()=>addRoom('top_down')}>New top-down room</button>
        </div>{/if}
        {#each Object.entries(project.rooms) as [id,item]}
          <button class="item" class:selected={roomId===id} onclick={()=>selectRoom(id)}>
            <i class="room-icon"></i><span>{item.title??id}</span>
          </button>
        {/each}
      </div>
      <div class="category">
        <div class="heading row"><h3>Sprites</h3><button class="small-button" title="Add sprite" aria-label="Add sprite" onclick={()=>{assetKind='sprite';openTab('assets');}}>+</button></div>
        {#each Object.keys(project.sprites??{}) as id}
          <button class="item" class:selected={spriteId===id && tab!=='room'} onclick={()=>{selectSprite(id);openTab('blocks');}}>
            <i class="sprite-icon"></i><span>{id}</span>
          </button>
        {/each}
      </div>
      {#if tab!=='room'}<div class="category compact">
        <div class="heading row"><h3>Tiles</h3><button class="small-button" title="Add tile" aria-label="Add tile" onclick={()=>{assetKind='tile';openTab('assets');}}>+</button></div>
        {#each Object.keys(project.tiles??{}) as id}
          <button class="item" class:selected={tileId===id} onclick={()=>{tileId=id;assetKind='tile';if(tab!=='assets')openTab('room');}}>
            {#if tileArt[id]?.[0]}<img src={tileArt[id][0]} alt="">{:else}<i class="room-icon"></i>{/if}<span>{id}</span>
          </button>
        {/each}
      </div>
    {/if}</aside>
    <div class="work">
      <nav class="row" aria-label="Editor views">
        {#each tabs as [id,title]}<button class:active={tab===id} onclick={()=>openTab(id)}>{title}</button>{/each}
      </nav>
      {#if tab==='room' && room}
        {#key roomId}
          <RoomMap {room} {roomId} size={project.tileSize??24} tiles={project.tiles??{}} sprites={project.sprites??{}}
            {tileArt} {spriteArt} {previewModes} {layerIndex} bind:selectedEntity bind:tileId bind:spriteId {busy}
            canUndo={historyStatus.canUndo} canRedo={historyStatus.canRedo}
            onUndo={()=>restoreRoom(true)} onRedo={()=>restoreRoom(false)} onEdit={replaceRoom}
            onLayer={chooseLayer} onSprites={()=>roomPanel='sprites'} onAssets={()=>{assetKind='tile';openTab('assets');}}
            onPlay={saveThenOpen} />
        {/key}
      {:else if tab==='blocks'}
        {#if spriteId}
          {#key spriteId}<ScriptPanel sprite={spriteId} bind:dirty={scriptDirty} onSave={saveScript} />{/key}
        {:else}<p class="empty card">Add a sprite in Assets to give it behavior.</p>{/if}
      {:else if tab==='assets'}
        <section class="card asseteditor">
          <div class="row heading">
            <h2>Asset registry</h2>
            <div class="row"><button class:selected={assetKind==='sprite'} onclick={()=>assetKind='sprite'}>Sprites</button><button class:selected={assetKind==='tile'} onclick={()=>assetKind='tile'}>Tiles</button></div>
          </div>
          <label class="stack">Edit asset
            {#if assetKind==='sprite'}
              <select bind:value={spriteId}>{#each Object.keys(project.sprites??{}) as id}<option value={id}>{id}</option>{/each}</select>
            {:else}
              <select bind:value={tileId}>{#each Object.keys(project.tiles??{}) as id}<option value={id}>{id}</option>{/each}</select>
            {/if}
          </label>
          {#if inspector}
            <label class="stack">Source <select value={inspector.source} onchange={e=>{if(assetKind==='tile')delete inspector.tag;set(inspector,'source',e.currentTarget.value);}}>
              {#each artFiles as file}<option value={file}>{file}</option>{/each}
            </select></label>
            {#if assetKind==='tile'}
              <label class="stack">Aseprite tag
                <select value={tile.tag??''} onchange={e=>set(tile,'tag',e.currentTarget.value)}>
                  <option value="">First tag or all frames if untagged</option>
                  {#each art[tile.source]?.tags??[] as tag}<option value={tag}>{tag}</option>{/each}
                </select>
              </label>
            {:else}
              <div class="pair">
                <label class="stack">Visual layer <input type="number" value={sprite.layer??0} onchange={e=>set(sprite,'layer',e.currentTarget.valueAsNumber)}></label>
                <label class="stack">Team <input type="number" value={sprite.team??0} onchange={e=>set(sprite,'team',e.currentTarget.valueAsNumber)}></label>
                <label class="stack">Body width <input type="number" min="1" placeholder="From source" value={sprite.width??''} onchange={e=>set(sprite,'width',e.currentTarget.value===''?'':e.currentTarget.valueAsNumber)}></label>
                <label class="stack">Body height <input type="number" min="1" placeholder="From source" value={sprite.height??''} onchange={e=>set(sprite,'height',e.currentTarget.value===''?'':e.currentTarget.valueAsNumber)}></label>
                <label class="stack">Initial animation <input value={sprite.animation??''} placeholder="Default" onchange={e=>set(sprite,'animation',e.currentTarget.value)}></label>
                <label class="stack">Projectile <select value={sprite.projectile??''} onchange={e=>set(sprite,'projectile',e.currentTarget.value)}>
                  <option value="">Default</option>{#each Object.keys(project.sprites??{}).filter(id=>id!==spriteId) as id}<option value={id}>{id}</option>{/each}
                </select></label>
              </div>
            {/if}
          {/if}
          <h3>Add {assetKind}</h3>
          <div class="row add">
            <input bind:value={newId} placeholder="Asset ID" aria-label="Asset ID">
            <select bind:value={newSource} aria-label="Source file">{#each artFiles as file}<option value={file}>{file}</option>{/each}</select>
            <button onclick={addAsset}>Add</button>
          </div>
          {#if assetKind==='tile' && art[newSource]?.tags?.length}<button class="extra" onclick={addTags}>Add all tags as tiles</button>{/if}
          {#if art[newSource]?.error}<p class="error">{art[newSource].error}</p>{/if}
          <p class="muted">Put Aseprite and sound files in the project’s <code>assets/</code> folder. Use Rebuild assets to scan for files.</p>
          <h3>Audio registry</h3>
          {#each Object.entries(project.audio??{}) as [id,file]}
            {@const source=typeof file==='string'?file:file.source}
            <div class="audio-line"><code>{id}</code> <small>{source}</small>
              {#if /\.wav$/i.test(source)}<label class="check"><input type="checkbox" checked={typeof file==='string'||file.compress!==false}
                onchange={e=>toggleCompression(id,e.currentTarget.checked)}> QOA</label>{/if}
            </div>
          {/each}
          <div class="row add extra">
            <input bind:value={audioId} placeholder="Audio ID" aria-label="Audio ID">
            <select bind:value={audioSource} aria-label="Audio source">{#each audioFiles as file}<option value={file}>{file}</option>{/each}</select>
            <button onclick={addAudio}>Add audio</button>
          </div>
        </section>
      {/if}
    </div>
    <aside class="inspector card">
      {#if tab==='room' && room}
        <div class="panel-tabs row">
          {#each [['layers','Layers'],['room','Room'],['sprites','Sprites']] as [id,label]}
            <button class:selected={roomPanel===id} aria-pressed={roomPanel===id} onclick={()=>roomPanel=id}>{label}</button>
          {/each}
        </div>
        {#if roomPanel==='room'}
          <div class="row start-room">
            {#if (project.start??Object.keys(project.rooms)[0])===roomId}<small>Starting room</small>
            {:else}<button class="small-button" onclick={()=>set(project,'start',roomId)}>Set as starting room</button>{/if}
          </div>
          <label class="stack">Room name <input value={room.title??roomId} onchange={e=>setRoom('title',e.currentTarget.value)}></label>
          <label class="stack">Room view <select aria-label="Room view" value={roomView} onchange={e=>setView(e.currentTarget.value)}>
            <option value="platformer">Platformer</option><option value="top_down">Top-down</option>
          </select></label>
          <div class="pair">
            <label class="stack">Columns <input type="number" min="1" max={maxTiles} value={dimensions?.cols??room.cols} onchange={e=>resizeRoom('cols',e.currentTarget)}></label>
            <label class="stack">Rows <input type="number" min="1" max={maxTiles} value={dimensions?.rows??room.rows} onchange={e=>resizeRoom('rows',e.currentTarget)}></label>
            {#if roomView==='platformer'}
              <label class="stack">Gravity <input type="number" min="-100" max="100" step="any" value={room.gravity??24} onchange={e=>setRoom('gravity',e.currentTarget.valueAsNumber)}></label>
            {/if}
            <label class="stack">Background <input type="color" value={room.background??'#171829'} onchange={e=>setRoom('background',e.currentTarget.value)}></label>
          </div>
          {#if dimensions}
            <p class="crop-note">The new room size cuts off tiles or sprites.</p>
            <div class="row"><button onclick={cropRoom}>Resize and crop</button><button onclick={()=>dimensions=null}>Cancel</button></div>
          {/if}
          <label class="check"><input type="checkbox" checked={room.closedEdges??roomView==='top_down'} onchange={e=>setRoom('closedEdges',e.currentTarget.checked)}> Solid room edges</label>
          {#if roomView==='top_down'}
            <label class="check"><input type="checkbox" checked={room.ySort??true} onchange={e=>setRoom('ySort',e.currentTarget.checked)}> Draw lower sprites in front</label>
          {/if}
          {#each [['music','Music'],['ambience','Ambient sound']] as [key,label]}
            <label class="stack">{label}<select value={room[key]??''} onchange={e=>setRoom(key,e.currentTarget.value)}>
              <option value="">None</option>{#each Object.keys(project.audio??{}) as id}<option value={id}>{id}</option>{/each}
            </select></label>
          {/each}
        {:else if roomPanel==='layers'}
          <div class="heading row mini"><h3>Draw order</h3><button class="small-button" disabled={busy} onclick={addLayer}>Add layer</button></div>
          {#each sortedLayers as {layer:item,index}}
            <button class="item" class:selected={layerIndex===index} onclick={()=>chooseLayer(index)}>
              <span>{item.name}</span><small>{item.collidable?'Collision on':'Visual only'}</small>
            </button>
          {/each}
          {#if layer}
            <label class="stack">Layer name <input value={layer.name} onchange={e=>changeLayer('name',e.currentTarget.value)}></label>
            <label class="check"><input type="checkbox" checked={layer.collidable} onchange={e=>changeLayer('collidable',e.currentTarget.checked)}> Enable collision</label>
            <label class="stack">Layer order <input type="number" min="-10000" max="10000" value={layer.order??layerIndex} onchange={e=>{
              const value=e.currentTarget.valueAsNumber;
              if(Number.isInteger(value)&&Math.abs(value)<=10000)changeLayer('order',value);
            }}></label>
            <div class="row layer-actions">
              <button disabled={busy||sortedLayers[0]?.index===layerIndex} onclick={()=>moveLayer(-1)}>Move up</button>
              <button disabled={busy||sortedLayers.at(-1)?.index===layerIndex} onclick={()=>moveLayer(1)}>Move down</button>
            </div>
            {#if room.layers.length>1}<button class="small-button remove" onclick={removeLayer}>Remove layer</button>{/if}
          {/if}
        {:else}
          {#if !room.entities.length}<p class="muted">Use Place sprite to add a sprite.</p>{/if}
          {#each room.entities as entity,index}
            <button class="item" class:selected={selectedEntity===index} onclick={()=>selectedEntity=index}>
              <span>{entity.sprite}</span>{#if entity.player!=null}<small>Player {entity.player+1}</small>{/if}
            </button>
          {/each}
          {#if actor}
            <div class="pair">
              <label class="stack">X position <input type="number" min="0" value={actor.x} onchange={e=>changeActor('x',e.currentTarget.valueAsNumber)}></label>
              <label class="stack">Y position <input type="number" min="0" value={actor.y} onchange={e=>changeActor('y',e.currentTarget.valueAsNumber)}></label>
            </div>
            <label class="stack">Player slot <select aria-label="Sprite player slot" value={actor.player==null ? '' : String(actor.player)} onchange={e=>changeActor('player',e.currentTarget.value)}>
              <option value="">None</option>{#each [0,1,2,3] as player}<option value={String(player)}>Player {player+1}</option>{/each}
            </select></label>
            <button class="small-button remove" onclick={()=>{editRoom(next=>next.entities.splice(selectedEntity,1));selectedEntity=-1;}}>Remove sprite</button>
          {/if}
        {/if}
      {:else}
        {@const target=tab==='blocks' ? sprite : inspector}
        <div class="heading row"><h2>Sprite and tile settings</h2></div>
        {#if target}
          <p class="asset-name">{tab==='blocks'||assetKind==='sprite' ? spriteId : tileId}</p>
          {#if target.physics}
            <Physics bind:physics={target.physics} fallback={tab==='assets' && assetKind==='tile'
              ? (tile.tag??art[tile.source]?.tags?.[0]??'').includes(':fluid:') ? 'fluid' : 'static'
              : 'none'} onChange={mark} />
          {:else}
            <button onclick={()=>{target.physics={};mark();}}>Set physics</button>
          {/if}
        {/if}
      {/if}
    </aside>
  </main>
{/if}
<style>
  .appbar{display:flex;justify-content:space-between;align-items:center;gap:1rem;border-bottom:1px solid var(--line);padding:.8rem 1.1rem;}
  .status{font-size:.76rem;color:var(--muted);margin-right:.35rem;}
  .banner{margin:.6rem 1.1rem 0;padding:.55rem .65rem;border:1px solid #79505d;border-radius:7px;background:#30242f;}
  main{display:grid;grid-template-columns:minmax(155px,185px) minmax(300px,1fr) minmax(210px,255px);gap:.8rem;align-items:start;padding:.85rem 1.1rem;}
  .project,.inspector{padding:.65rem;}
  .work{min-width:0;}
  .heading{justify-content:space-between;margin-bottom:.55rem;}
  h2{font-size:.94rem;}
  h3{font-size:.72rem;font-weight:700;color:var(--muted);}
  .category{border-top:1px solid var(--line);padding-top:.58rem;margin-top:.65rem;}
  .category .heading{margin-bottom:.3rem;}
  .small-button{font-size:.72rem;min-width:1.55rem;padding:.18rem .3rem;}
  .item{display:flex;align-items:center;gap:.45rem;width:100%;border-color:transparent;background:none;text-align:left;font-size:.79rem;padding:.35rem .35rem;}
  .item.selected{background:#352e3e;border-color:#62536b;}
  .item small{margin-left:auto;font-size:.66rem;}
  .item i,.item img{width:12px;height:12px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;}
  .room-icon{border:1px solid #9e9cb4;border-radius:2px;background:#514765;}
  .sprite-icon{border:1px solid #abd8bc;border-radius:50%;background:#4d6b69;}
  nav{margin-bottom:.65rem;}
  nav button{background:none;border-color:transparent;font-size:.8rem;}
  nav .active{color:var(--accent);border-color:#6b5769;background:#322b3c;}
  .panel-tabs{border-bottom:1px solid var(--line);padding-bottom:.45rem;margin-bottom:.45rem;}
  .panel-tabs button,.layer-actions button{font-size:.73rem;padding:.3rem .35rem;}
  .layer-actions,.remove,.crop-note{margin-top:.55rem;}
  .crop-note{font-size:.75rem;color:var(--accent);margin-bottom:.35rem;}
  .presets{display:grid;gap:.25rem;margin-bottom:.45rem;}
  .presets button{font-size:.75rem;text-align:left;padding:.35rem;}
  .export-menu{position:relative;}
  .export-menu summary{padding:.42rem .62rem;border:1px solid var(--line);border-radius:7px;cursor:pointer;}
  .export-menu>div{position:absolute;right:0;top:calc(100% + 6px);z-index:5;display:grid;min-width:11rem;padding:.3rem;}
  .export-menu a{padding:.38rem .45rem;border-radius:5px;text-decoration:none;color:inherit;}
  .export-menu a:hover{background:#3b3248;color:var(--accent);}
  .inspector{max-height:calc(100dvh - 5.6rem);overflow:auto;}
  .stack{display:grid;gap:.23rem;color:var(--muted);font-size:.75rem;margin-top:.45rem;}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:0 .46rem;}
  .mini{margin-top:.75rem;margin-bottom:.26rem;}
  .check{display:flex;align-items:center;gap:.3rem;font-size:.75rem;color:var(--muted);margin-top:.4rem;}
  .asseteditor,.empty{padding:.8rem;}
  .asseteditor .stack{max-width:34rem;}
  .asseteditor h3{margin-top:1rem;margin-bottom:.38rem;}
  .asseteditor p{font-size:.78rem;margin-top:.45rem;}
  .add input,.add select{width:min(35%,15rem);}
  .audio-line{display:flex;gap:.5rem;align-items:baseline;margin-top:.32rem;font-size:.78rem;}
  .extra{margin-top:.55rem;}.start-room{margin-bottom:.15rem;}
  .asset-name{font-size:.85rem;color:var(--accent);}
  @media(max-width:880px){main{grid-template-columns:140px minmax(0,1fr);}.inspector{grid-column:2;max-height:none;}.status{display:none;}}
  @media(max-width:570px){.appbar{align-items:start;padding:.55rem;}.actions{justify-content:end;font-size:.72rem;}main{display:flex;flex-direction:column;padding:.55rem;}.project,.work,.inspector{width:100%;}.project{display:grid;grid-template-columns:repeat(3,1fr);gap:.3rem;}.project>.heading{grid-column:1/4;}.category{margin-top:0;}}
</style>
