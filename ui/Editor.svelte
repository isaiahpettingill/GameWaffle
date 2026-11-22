<script>
  import { onMount } from 'svelte';
  import ScriptPanel from './ScriptPanel.svelte';
  import Physics from './Physics.svelte';
  import { unpack } from '../src/cartridge.mjs';
  import { createRuntime } from './runtime.js';
  import { drawRoom, preload } from './render.js';

  let project=$state(null), assets=$state([]), art=$state({}), tab=$state('room'), roomId=$state(''), spriteId=$state(''),
    tileId=$state(''), layerIndex=$state(0), tool=$state('paint'), assetKind=$state('sprite'), scriptDirty=$state(false),
    dirty=$state(false), busy=$state(false), error=$state(''), status=$state('Opening project…'), newId=$state(''),
    newSource=$state(''), audioId=$state(''), audioSource=$state(''), variant=$state(''), slot=$state(''), showGrid=$state(true);
  let cart=$state.raw(null), thumbs=$state({}), atlases={}, canvas=$state(), helperSnapshot=$state.raw(null);
  let revision=-1, checking=false;
  let sourceError=$state('');
  let room=$derived(project?.rooms[roomId]), layer=$derived(room?.layers?.[layerIndex]);
  let sprite=$derived(project?.sprites?.[spriteId]), tile=$derived(project?.tiles?.[tileId]);
  let inspector=$derived(assetKind==='tile' ? tile : sprite);
  let artFiles=$derived(assets.filter(file=>/\.(ase|aseprite)$/i.test(file)));
  let audioFiles=$derived(assets.filter(file=>/\.(wav|ogg|oga|opus|qoa)$/i.test(file)));
  const tabs=[['room','Room'],['blocks','Blocks'],['assets','Assets']];
  const paletteColors=['#ffc875','#92dac4','#bda6ed','#ee9e9f'];

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
    atlases=await preload(next);
    for(const url of Object.values(thumbs)) URL.revokeObjectURL(url);
    thumbs=Object.fromEntries(Object.entries(next.thumbnails??{}).map(([id,bytes])=>[id,URL.createObjectURL(new Blob([bytes],{type:'image/png'}))]));
    cart=next;
  }
  async function load() {
    try{
      const value=await request('./api/project');
      project=value.project; assets=value.assets; art=value.art; revision=value.revision;
      audioSource=assets.find(file=>/\.(wav|ogg|oga|opus|qoa)$/i.test(file)) ?? '';
      roomId=project.start ?? Object.keys(project.rooms)[0];
      spriteId=Object.keys(project.sprites ?? {})[0] ?? '';
      tileId=Object.keys(project.tiles ?? {})[0] ?? '';
      newSource=assets.find(file=>/\.(ase|aseprite)$/i.test(file)) ?? '';
      layerIndex=Math.max(0,(project.rooms[roomId]?.layers?.length ?? 1)-1);
      await updatePreviews();
      status='Ready';
    }catch(err){error=err.message;status='Project unavailable';}
  }
  onMount(()=>{
    load();
    const monitor=setInterval(checkAssets,1600);
    return ()=>{clearInterval(monitor);for(const url of Object.values(thumbs))URL.revokeObjectURL(url);};
  });
  $effect(()=>{
    const next=cart,id=roomId;
    helperSnapshot=null;
    if(!next?.rooms?.[id])return;
    let cancelled=false;
    createRuntime(next,id).then(runtime=>{
      try{
        const state=JSON.parse(runtime.snapshot());
        if(!cancelled)helperSnapshot=state;
      }finally{runtime.free();}
    }).catch(err=>{if(!cancelled)error=String(err.message ?? err);});
    return ()=>{cancelled=true;};
  });
  $effect(()=>{
    const target=canvas, view=room, data=cart, state=helperSnapshot, grid=showGrid;
    if(!target || !view)return;
    const tileSize=project.tileSize ?? 24;
    const all=view.layers.map(entry=>[...entry.cells]);
    const placed=view.entities.map(entity=>({...entity}));
    const draft=dirty;
    const background=view.background ?? '#171829';
    if(!draft && state && data) {
      drawRoom(target,data,state,atlases,grid);
      return;
    }
    target.width=view.cols*tileSize;target.height=view.rows*tileSize;
    const ctx=target.getContext('2d');
    ctx.imageSmoothingEnabled=false;
    ctx.fillStyle=background;ctx.fillRect(0,0,target.width,target.height);
    let current=true;
    const loaded=Object.fromEntries(Object.entries(thumbs).map(([id,url])=>{
      const image=new Image();image.src=url;return [id,image];
    }));
    Promise.allSettled(Object.values(loaded).map(image=>image.decode())).then(()=>{
      if(!current)return;
      for(const cells of all)for(const [x,y,id] of cells){
        const image=loaded[id];
        if(image?.naturalWidth)ctx.drawImage(image,x*tileSize,y*tileSize,tileSize,tileSize);
        else {ctx.fillStyle='#736485';ctx.fillRect(x*tileSize,y*tileSize,tileSize,tileSize);}
      }
      for(const e of placed){
        ctx.fillStyle=paletteColors[e.player]??'#a16b8c';
        ctx.fillRect(e.x-6,e.y-7,12,14);
      }
      if(grid){
        ctx.strokeStyle='#d1bad42e';ctx.beginPath();
        for(let x=0;x<target.width;x+=tileSize){ctx.moveTo(x+.5,0);ctx.lineTo(x+.5,target.height);}
        for(let y=0;y<target.height;y+=tileSize){ctx.moveTo(0,y+.5);ctx.lineTo(target.width,y+.5);}
        ctx.stroke();
      }
    });
    return ()=>{current=false;};
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
  function mark(){dirty=true;status='Unsaved project';}
  function openTab(id){
    if(scriptDirty && id!=='blocks'){error='Save or discard the current script first.';return;}
    error='';tab=id;
  }
  function selectSprite(id){
    if(scriptDirty && spriteId!==id){error='Save or discard the current script first.';return;}
    spriteId=id;assetKind='sprite';error='';
  }
  function selectRoom(id){
    roomId=id;layerIndex=Math.max(0,(project.rooms[id]?.layers?.length??1)-1);
    openTab('room');
  }
  async function saveProject(){
    busy=true;error='';
    try{
      await request('./api/project','PUT',project);
      await updatePreviews();
      revision=(await request('./api/status')).revision;
      dirty=false; status='Project saved';
    }catch(err){error=err.message;}finally{busy=false;}
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
  function paint(event){
    if(!room || !canvas)return;
    if(event.type==='pointermove' && !(event.buttons&1))return;
    if(event.type==='pointermove' && tool==='spawn')return;
    const rect=canvas.getBoundingClientRect(), size=project.tileSize??24;
    const px=(event.clientX-rect.left)/rect.width*canvas.width, py=(event.clientY-rect.top)/rect.height*canvas.height;
    const x=Math.floor(px/size),y=Math.floor(py/size);
    if(x<0||y<0||x>=room.cols||y>=room.rows)return;
    if(tool==='spawn'){
      if(!spriteId)return;
      if(slot!=='')room.entities=room.entities.filter(actor=>actor.player!==Number(slot));
      room.entities.push({sprite:spriteId,x:Math.round(px),y:Math.round(py),...(slot==='' ? {} :{player:Number(slot)})});
      mark();return;
    }
    if(!layer)return;
    const index=layer.cells.findIndex(cell=>cell[0]===x&&cell[1]===y);
    if(tool==='erase'){
      if(index>=0){layer.cells.splice(index,1);mark();}
      return;
    }
    if(!tileId)return;
    const after=[x,y,tileId,...(variant===''?[]:[Number(variant)])];
    if(index>=0){
      if(JSON.stringify(layer.cells[index])===JSON.stringify(after))return;
      layer.cells[index]=after;
    }else layer.cells.push(after);
    mark();
  }
  function addLayer(){
    room.layers.push({name:`Layer ${room.layers.length+1}`,order:room.layers.length+1,collidable:false,cells:[]});
    layerIndex=room.layers.length-1;mark();
  }
  function addRoom(){
    let index=1;
    while(project.rooms[`room${index}`])index++;
    const id=`room${index}`;
    project.rooms[id]={title:`Room ${index}`,cols:28,rows:15,background:'#171829',layers:[{name:'Terrain',order:1,collidable:true,cells:[]}],entities:[]};
    selectRoom(id);mark();
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

<header class="appbar">
  <div class="brand">
    <span class="logo" aria-hidden="true">{#each Array(9) as _}<i></i>{/each}</span>
    <div><h1>GameWaffle Studio</h1><small>{project?.name ?? 'Sprite game editor'}</small></div>
  </div>
  <div class="row actions">
    <span class="status" role="status">{status}</span>
    <button onclick={rebuild} disabled={busy||!project}>Rebuild assets</button>
    <a class="button download" download={`${(project?.name??'game').toLowerCase().replace(/[^a-z0-9]+/g,'-')}.waffle`} href="./demo.waffle">Export cartridge</a>
    <a class="button primary" href="./player.html">Play ↗</a>
  </div>
</header>
{#if error || sourceError}<p role="alert" class="error banner">{error || sourceError}</p>{/if}
{#if project}
  <main>
    <aside class="project card">
      <div class="heading row"><h2>Project</h2><button class="small-button" onclick={saveProject} disabled={!dirty||busy}>Save</button></div>
      <div class="category">
        <div class="heading row"><h3>Rooms</h3><button class="small-button" title="New room" aria-label="New room" onclick={addRoom}>+</button></div>
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
      <div class="category compact">
        <div class="heading row"><h3>Tiles</h3><button class="small-button" title="Add tile" aria-label="Add tile" onclick={()=>{assetKind='tile';openTab('assets');}}>+</button></div>
        {#each Object.keys(project.tiles??{}) as id}
          <button class="item" class:selected={tileId===id} onclick={()=>{tileId=id;assetKind='tile';if(tab!=='assets')openTab('room');}}>
            {#if thumbs[id]}<img src={thumbs[id]} alt="">{:else}<i class="room-icon"></i>{/if}<span>{id}</span>
          </button>
        {/each}
      </div>
    </aside>
    <div class="work">
      <nav class="row" aria-label="Editor views">
        {#each tabs as [id,title]}<button class:active={tab===id} onclick={()=>openTab(id)}>{title}</button>{/each}
      </nav>
      {#if tab==='room' && room}
        <section class="card map">
          <div class="maphead row">
            <div><h2>{room.title??roomId}</h2><small>{room.cols} × {room.rows} tiles · {project.tileSize??24} px</small></div>
            <div class="row mode">
              <button class:selected={tool==='paint'} onclick={()=>tool='paint'}>Paint</button>
              <button class:selected={tool==='erase'} onclick={()=>tool='erase'}>Erase</button>
              <button class:selected={tool==='spawn'} onclick={()=>tool='spawn'}>Place sprite</button>
              <button aria-pressed={showGrid} onclick={()=>showGrid=!showGrid}>Grid</button>
            </div>
          </div>
          <div class="canvas-wrap">
            <canvas aria-label="Room map" bind:this={canvas} onpointerdown={paint} onpointermove={paint}></canvas>
          </div>
          <div class="mapfoot row">
            {#if tool==='spawn'}
              <label>Sprite <select bind:value={spriteId}>{#each Object.keys(project.sprites??{}) as id}<option value={id}>{id}</option>{/each}</select></label>
              <label>Player <select bind:value={slot}><option value="">None</option>{#each [0,1,2,3] as id}<option value={String(id)}>{id+1}</option>{/each}</select></label>
            {:else}
              <label>Layer <select bind:value={layerIndex}>{#each room.layers as item,index}<option value={index}>{item.name}</option>{/each}</select></label>
              <label>Tile <select bind:value={tileId}>{#each Object.keys(project.tiles??{}) as id}<option value={id}>{id}</option>{/each}</select></label>
              <label>Variant <input type="number" min="0" step="1" placeholder="Auto" value={variant} onchange={e=>variant=e.currentTarget.value}></label>
            {/if}
            <small>{dirty?'Save to update the playable cartridge.':'Click or drag on the map.'}</small>
          </div>
        </section>
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
      <div class="heading row"><h2>{tab==='room' ? 'Room settings' : 'Sprite & tile settings'}</h2></div>
      {#if tab==='room' && room}
        <div class="row start-room">
          {#if (project.start??Object.keys(project.rooms)[0])===roomId}<small>Starting room</small>
          {:else}<button class="small-button" onclick={()=>set(project,'start',roomId)}>Set as starting room</button>{/if}
        </div>
        <label class="stack">Room name <input value={room.title??roomId} onchange={e=>set(room,'title',e.currentTarget.value)}></label>
        <div class="pair">
          <label class="stack">Columns <input type="number" min="1" max="170" value={room.cols} onchange={e=>set(room,'cols',e.currentTarget.valueAsNumber)}></label>
          <label class="stack">Rows <input type="number" min="1" max="170" value={room.rows} onchange={e=>set(room,'rows',e.currentTarget.valueAsNumber)}></label>
          <label class="stack">Gravity <input type="number" min="-100" max="100" step="any" value={room.gravity??24} onchange={e=>set(room,'gravity',e.currentTarget.valueAsNumber)}></label>
          <label class="stack">Background <input type="color" value={room.background??'#171829'} onchange={e=>set(room,'background',e.currentTarget.value)}></label>
        </div>
        {#each [['music','Music'],['ambience','Ambient FX']] as [key,label]}
          <label class="stack">{label}<select value={room[key]??''} onchange={e=>set(room,key,e.currentTarget.value)}>
            <option value="">None</option>{#each Object.keys(project.audio??{}) as id}<option value={id}>{id}</option>{/each}
          </select></label>
        {/each}
        <div class="heading row mini"><h3>Visual layers</h3><button class="small-button" title="Add layer" aria-label="Add layer" onclick={addLayer}>+</button></div>
        {#each room.layers as item,index}
          <button class="item" class:selected={layerIndex===index} onclick={()=>layerIndex=index}><span>{item.name}</span><small>{item.collidable?'Solid':'Visual'}</small></button>
        {/each}
        {#if layer}
          <label class="stack">Layer name <input value={layer.name} onchange={e=>set(layer,'name',e.currentTarget.value)}></label>
          <label class="stack">Draw order <input type="number" value={layer.order??layerIndex} onchange={e=>set(layer,'order',e.currentTarget.valueAsNumber)}></label>
          <label class="check"><input type="checkbox" checked={layer.collidable} onchange={e=>set(layer,'collidable',e.currentTarget.checked)}> Collidable layer</label>
        {/if}
        <div class="heading row mini"><h3>Placed sprites</h3></div>
        {#each room.entities as actor,index}
          <div class="actor row"><span>{actor.sprite}{actor.player==null ? '' : ' · P'+(actor.player+1)}</span><button class="small-button" aria-label={`Remove ${actor.sprite}`} onclick={()=>{room.entities.splice(index,1);mark();}}>×</button></div>
        {/each}
      {:else}
        {@const target=tab==='blocks' ? sprite : inspector}
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
  .map{overflow:hidden;}
  .maphead{justify-content:space-between;padding:.65rem .7rem;}
  .mode{font-size:.74rem;}
  .canvas-wrap{background:#171721;min-height:160px;display:grid;place-items:center;}
  canvas{width:100%;max-height:65vh;object-fit:contain;touch-action:none;cursor:crosshair;}
  .mapfoot{padding:.6rem .7rem;font-size:.75rem;}
  .mapfoot label{display:flex;align-items:center;gap:.32rem;color:var(--muted);}
  .mapfoot input{width:4.5rem;}
  .mapfoot small{margin-left:auto;}
  .inspector{max-height:calc(100dvh - 5.6rem);overflow:auto;}
  .stack{display:grid;gap:.23rem;color:var(--muted);font-size:.75rem;margin-top:.45rem;}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:0 .46rem;}
  .mini{margin-top:.75rem;margin-bottom:.26rem;}
  .check{display:flex;align-items:center;gap:.3rem;font-size:.75rem;color:var(--muted);margin-top:.4rem;}
  .actor{justify-content:space-between;font-size:.75rem;padding:.2rem .28rem;}
  .asseteditor,.empty{padding:.8rem;}
  .asseteditor .stack{max-width:34rem;}
  .asseteditor h3{margin-top:1rem;margin-bottom:.38rem;}
  .asseteditor p{font-size:.78rem;margin-top:.45rem;}
  .add input,.add select{width:min(35%,15rem);}
  .audio-line{display:flex;gap:.5rem;align-items:baseline;margin-top:.32rem;font-size:.78rem;}
  .extra{margin-top:.55rem;}.start-room{margin-bottom:.15rem;}
  .asset-name{font-size:.85rem;color:var(--accent);}
  @media(max-width:880px){main{grid-template-columns:140px minmax(0,1fr);}.inspector{grid-column:2;max-height:none;}.status{display:none;}}
  @media(max-width:570px){.appbar{align-items:start;padding:.55rem;}.actions{justify-content:end;font-size:.72rem;}.download{display:none;}main{display:flex;flex-direction:column;padding:.55rem;}.project,.work,.inspector{width:100%;}.project{display:grid;grid-template-columns:repeat(3,1fr);gap:.3rem;}.project>.heading{grid-column:1/4;}.category{margin-top:0;}.mapfoot small{margin-left:0;}}
</style>
