<script>
  import productIcon from '../packaging/gamewaffle.svg?inline';
  import {Network,Blocks,Images,Settings2,Play,DoorOpen as RoomIcon,Layers3,Search,SquareUserRound,Plus} from '@lucide/svelte';
  import {roomShaders} from '../src/room-shaders.mjs';
  const viewIcons={world:Network,room:RoomIcon,actors:SquareUserRound,blocks:Blocks,assets:Images,game:Settings2};
  import { buttons, effects, platformGravity, roomBorder } from '../src/schema.mjs';
  import PagedList from './PagedList.svelte';
  let projectPath=$state(''),filter=$state(''),instanceFilter=$state('');
  import InputMap from './InputMap.svelte';
  import Sections from './Sections.svelte';
  import World from './World.svelte';
  import {draftFile} from './recovery.js';
  import { onMount } from 'svelte';
  import Debugger from './Debugger.svelte';
  let debugging=$state(false);
  async function debugRoom(){
    if(scriptDirty){error='Save the current script first.';return;}
    if(!dirty||await saveProject())debugging=true;
  }
  import ScriptPanel from './ScriptPanel.svelte';
  import Physics from './Physics.svelte';
  import { tileSizes, variableName } from '../src/script.mjs';
  import { unpack, decodeCbor } from '../src/cartridge.mjs';
  import RoomMap from './RoomMap.svelte';
  import { instanceNames, newInstanceName, spriteDragType } from '../src/instances.mjs';

  let project=$state(null), assets=$state([]), art=$state({}), tab=$state('room'), roomId=$state(''), spriteId=$state(''),
    tileId=$state(''), layerIndex=$state(0), assetKind=$state('sprite'), scriptDirty=$state(false),
    dirty=$state(false), busy=$state(false), error=$state(''), status=$state('Opening project…'), newId=$state(''),
    newSource=$state('');
  let importFile=$state(null), filePicker=$state(), assetError=$state('');
  const assetLabel=$derived(assetKind==='audio'?'sound':assetKind==='sprite'?'actor':'tile set');
  const tileSets=$derived(groupTiles(project?.tiles??{}));
  const sources=$derived(assetKind==='audio'?audioFiles:artFiles);
  let tileArt=$state.raw({}), spriteArt=$state.raw({}), previewModes=$state.raw({});
  let historyVersion=$state(0), selectedEntity=$state(-1), roomPanel=$state('layers'), addPreset=$state(false);
  let savedProject=$state(''), currentProject='', previewUrls=[];
  const undo=[],redo=[];
  const draft=draftFile('project',message=>error=message);
  let recovery=$state.raw(null);
  let dimensions=$state(null);
  let placementSprite=$state(''), mapTool=$state('paint'), addForm=$state(false);
  let revision=-1, checking=false;
  let sourceError=$state('');
  let room=$derived(project?.rooms[roomId]), layer=$derived(room?.layers?.[layerIndex]);
  let sprite=$derived(project?.sprites?.[spriteId]), tile=$derived(project?.tiles?.[tileId]);
  let inspector=$derived(assetKind==='tile' ? tile : sprite);
  let artFiles=$derived(assets.filter(file=>/\.(ase|aseprite|png)$/i.test(file)));
  let audioFiles=$derived(assets.filter(file=>/\.(wav|ogg|oga|opus|qoa)$/i.test(file)));
  let newItem=$state(''),itemId=$state(''),sourceFilter=$state(''),placeAs=$state(''),sourcePicker=$state();
  let initialNumber=$state(0),initialFlag=$state(false);
  let gameSection=$state('Variables'),spriteSection=$state('Appearance'),roomSection=$state('Size'),instanceSection=$state('Placement'),mobilePane=$state('Editor');
  const tabs=[['world','World'],['room','Room'],['actors','Actors'],['blocks','Code'],['assets','Assets'],['game','Game']];
  let variableId=$state(''), variableKind=$state('variables');
  function addVariable() {
    const id=variableId.trim();
    if(!variableName(id)||['__proto__','prototype','constructor'].includes(id)){error='Use a name with letters, digits, and underscores.';return;}
    const table=project[variableKind]??={};
    if(Object.hasOwn(table,id)){error='This name is already in use.';return;}
    if(variableKind==='variables'&&!Number.isSafeInteger(initialNumber)){error='Enter a whole number.';return;}
    table[id]=variableKind==='flags' ? initialFlag : initialNumber;
    variableId='';error='';mark();
  }
  const historyStatus=$derived.by(()=>{
    const revision=historyVersion;
    return { revision, canUndo:undo.length>0, canRedo:redo.length>0 };
  });
  const sortedLayers=$derived((room?.layers ?? []).map((layer,index)=>({layer,index,order:layer.order??index}))
    .sort((a,b)=>b.order-a.order || b.index-a.index));
  const maxTiles=$derived(Math.floor(4096/(project?.tileSize??24)));
  const roomView=$derived(room?.view ?? (Math.abs(room?.gravity ?? platformGravity) < .01 ? 'top_down' : 'platformer'));
  const actor=$derived(room?.entities[selectedEntity]);
  const exportName=$derived((project?.name??'game').toLowerCase().replace(/[^a-z0-9]+/g,'-') || 'game');

  let updatesOpen=$state(false),releases=$state([]),checkingUpdates=$state(false);
  const components=[['studio','Studio'],['runtime','Desktop runtime']];
  async function checkReleases(){
    if(checkingUpdates)return;
    checkingUpdates=true;error='';
    try{
      releases=await Promise.all(components.map(async ([component,label])=>({
        component,label,...await request('./api/update','POST',{component})
      })));
    }catch(err){error=err.message;}finally{checkingUpdates=false;}
  }
  async function installRelease(release){
    busy=true;error='';
    try{
      const info=await request('./api/update','POST',{component:release.component,install:true});
      releases=releases.map(r=>r.component!==release.component?r:{...r,available:false,installed:info.tag});
      status=release.component==='studio'?'Restart Studio to finish the update':'Runtime installed';
    }catch(err){error=err.message;}finally{busy=false;}
  }
  async function downloadDesktop(event){
    event.preventDefault();
    const href=event.currentTarget.href;
    if(busy)return;
    if(scriptDirty){error='Save the script first';return;}
    if(dirty && !await saveProject())return;
    try{
      const res=await fetch(href);
      if(!res.ok)throw Error((await res.json()).error);
      const url=URL.createObjectURL(await res.blob()),a=document.createElement('a');
      a.href=url;a.download=exportName+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
    }catch(err){error=err.message;}
  }
  async function request(path, method='GET', data) {
    const response=await fetch(path,{method,headers:data ? {'Content-Type':'application/json'} : {},body:data ? JSON.stringify(data) : undefined});
    const result=await response.json();
    if(!response.ok)throw Error(result.error ?? 'Request failed');
    return result;
  }
  let previewVersion=0;
  async function updatePreviews() {
    const version=++previewVersion;
    const response=await fetch('./api/preview',{cache:'no-store'});
    if(!response.ok)throw Error('Could not open project preview');
    const next=unpack(new Uint8Array(await response.arrayBuffer()));
    let tiles=next.tilePreviews??Object.fromEntries(Object.entries(next.thumbnails??{}).map(([id,bytes])=>[id,{variants:[bytes]}]));
    if(project && JSON.stringify(project.tiles??{})!==JSON.stringify(JSON.parse(savedProject).tiles??{})){
      const r=await fetch('./api/tile-previews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tiles:project.tiles??{},size:project.tileSize??24})});
      if(!r.ok)throw Error((await r.json()).error);
      tiles=decodeCbor(new Uint8Array(await r.arrayBuffer()));
    }
    if(version!==previewVersion)return;
    for(const url of previewUrls) URL.revokeObjectURL(url);
    previewUrls=[];
    function png(bytes){
      const url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
      previewUrls.push(url);
      return url;
    }
    tileArt=Object.fromEntries(Object.entries(tiles).map(([id,data])=>[id,data.variants.map(png)]));
    previewModes=Object.fromEntries(Object.entries(tiles).map(([id,data])=>[id,data.mode]));
    spriteArt=Object.fromEntries(Object.entries(next.spritePreviews??{}).map(([id,data])=>[id,png(data)]));
  }
  async function load() {
    try{
      const value=await request('./api/project');
      for (const map of Object.values(value.project.rooms)) {
        map.entities??=[];
        map.layers??=[];
        const names=instanceNames(map.entities);
        map.entities.forEach((entity,index)=>{entity.name=names[index];});
      }
      projectPath=value.path;project=value.project; assets=value.assets; art=value.art; revision=value.revision;
      currentProject=savedProject=JSON.stringify(value.project);
      recovery=await draft.read();
      if(recovery===savedProject){recovery=null;await draft.write(null);}
      roomId=project.start ?? Object.keys(project.rooms)[0];
      spriteId=Object.keys(project.sprites ?? {})[0] ?? '';
      placementSprite=spriteId;
      tileId=Object.keys(project.tiles ?? {})[0] ?? '';
      layerIndex=chooseInitialLayer(project.rooms[roomId]);
      if(!recovery)importNewTags();
      await updatePreviews();
      status=dirty?'Unsaved project':'Ready';
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
        const previousArt=art;
        assets=current.assets;art=current.art;
        if(!recovery)importNewTags(previousArt);
        await updatePreviews();
        revision=current.revision;
        if(!dirty)status='Assets rebuilt';
      }
    }catch(err){sourceError=err.message;}finally{checking=false;}
  }
  function mark(){
    updateDirty();
  }
  function updateDirty(record=true){
    const next=JSON.stringify(project);
    if(record && next!==currentProject){
      undo.push(currentProject);
      if(undo.length>50)undo.shift();
      redo.length=0;
    }
    currentProject=next;historyVersion++;
    dirty=next!==savedProject;
    status=dirty?'Unsaved project':'Ready';
    draft.write(dirty?next:null);
  }
  function replaceRoom(next){
    if(busy)return;
    project.rooms[roomId]=next;
    dimensions=null;
    updateDirty();
  }
  function applyProject(serialized,record){
    const previousTiles=JSON.stringify(project.tiles);
    project=JSON.parse(serialized);
    if(!project.rooms[roomId])roomId=project.start??Object.keys(project.rooms)[0];
    if(!project.sprites?.[spriteId])spriteId=Object.keys(project.sprites??{})[0]??'';
    if(!project.tiles?.[tileId])tileId=Object.keys(project.tiles??{})[0]??'';
    layerIndex=chooseInitialLayer(project.rooms[roomId]);
    placementSprite=spriteId;selectedEntity=-1;dimensions=null;
    updateDirty(record);
    if(JSON.stringify(project.tiles)!==previousTiles)updatePreviews().catch(err=>error=err.message);
  }
  function editRoom(change){
    const next=JSON.parse(JSON.stringify(room));
    change(next);
    replaceRoom(next);
  }
  function recordFile(id){
    if(!id)return;
    undo.push({id});if(undo.length>50)undo.shift();redo.length=0;historyVersion++;
  }
  let scriptVersion=$state(0);
  async function restoreRoom(back){
    if(busy||scriptDirty)return;
    const active=back?undo:redo;
    if(!active.length)return;
    const entry=active.at(-1);
    if(typeof entry==='object'){
      busy=true;error='';
      try{
        await request('./api/file-history','POST',{id:entry.id,back});
        active.pop();(back?redo:undo).push(entry);historyVersion++;scriptVersion++;
        const latest=await request('./api/project');
        assets=latest.assets;art=latest.art;revision=latest.revision;await updatePreviews();
      }catch(e){error=e.message;}finally{busy=false;}
      return;
    }
    (back?redo:undo).push(currentProject);
    applyProject(active.pop(),false);
  }
  function setRoom(key,value){
    editRoom(next=>{if(value==='')delete next[key];else next[key]=value;});
  }
  function setView(view){
    editRoom(next=>{
      next.view=view;
      next.ySort=view==='top_down';
      delete next.closedEdges;
      delete next.border;
      if(view==='platformer' && Math.abs(next.gravity ?? platformGravity)<.01)next.gravity=platformGravity;
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
    if(key==='name'){
      value=value.trim() || newInstanceName(actor.sprite,room.entities.filter((_,index)=>index!==selectedEntity));
      if(room.entities.some((entry,index)=>index!==selectedEntity && entry.name===value)){
        error='Use a different name for each instance in this room.';
        return;
      }
      error='';
    }
    if(key==='layer' && value!=='' && (!Number.isInteger(value)||Math.abs(value)>10000))return;
    if(key==='health' && value!=='' && (!Number.isFinite(value)||value<.001||value>1000000))return;
    editRoom(next=>{
      if(key==='player'&&value!==''){
        const occupied=next.entities.find((entry,index)=>index!==selectedEntity && entry.player===Number(value));
        if(occupied)delete occupied.player;
      }
      const entity=next.entities[selectedEntity];
      if(key==='player'&&value!==''&&entity.player==null&&!project.sprites[entity.sprite]?.script){
        entity.standardMovement=true;
        if(!entity.physics?.mode&&(!project.sprites[entity.sprite]?.physics?.mode||project.sprites[entity.sprite].physics.mode==='none'))(entity.physics??={}).mode='dynamic';
      }
      if(key==='health'){
        if(value!=='') (entity.physics??={}).health=value;
        else if(entity.physics){
          delete entity.physics.health;
          if(!Object.keys(entity.physics).length)delete entity.physics;
        }
      }else if(value==='')delete entity[key];
      else entity[key]=key==='player' ? Number(value) : value;
    });
  }
  function openTab(id){
    mobilePane='Editor';
    if(scriptDirty && id!=='blocks'){error='Save or discard the current script first.';return;}
    if(id==='actors')assetKind='sprite';
    if(id==='assets'&&assetKind==='sprite')assetKind='source';
    error='';tab=id;
  }
  function selectSprite(id){
    if(scriptDirty && spriteId!==id){error='Save or discard the current script first.';return;}
    spriteId=id;assetKind='sprite';error='';
  }
  function chooseDefinition(id){
    if(tab==='room'){
      mobilePane='Editor';placementSprite=id;
      mapTool='spawn';
      return;
    }
    openDefinition(id,tab==='actors'?'actors':'blocks');
  }
  function dragDefinition(event,id){
    event.dataTransfer.setData(spriteDragType,id);
    event.dataTransfer.effectAllowed='copy';
  }
  function openDefinition(id,view='actors'){
    if(scriptDirty && (view!=='blocks' || id!==spriteId)){
      error='Save or discard the current script first.';
      return;
    }
    selectSprite(id);
    openTab(view);
  }
  function openAssets(kind,adding=false){
    if(busy)return;
    if(scriptDirty){openTab('assets');return;}
    assetKind=kind;
    newId='';newSource='';importFile=null;assetError='';
    addForm=adding;
    openTab(kind==='sprite'?'actors':'assets');
  }
  function chooseInitialLayer(map){
    const layers=(map?.layers??[]).map((item,index)=>({item,index}));
    return layers.sort((a,b)=>Number(Boolean(b.item.collidable))-Number(Boolean(a.item.collidable))
      || (b.item.order??b.index)-(a.item.order??a.index)).at(0)?.index??0;
  }
  function selectRoom(id){
    if(scriptDirty){openTab('room');return;}
    roomPanel='layers';selectedEntity=-1;dimensions=null;mapTool='paint';
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
      savedProject=saved;
      updateDirty();
      if(!dirty)status='Project saved';
      return !dirty;
    }catch(err){error=err.message;return false;}finally{busy=false;}
  }
  async function saveScript(id){
    if(!project.sprites[id].script){
      const path=`scripts/sprites/${id}.cbor`;
      project.sprites[id].script=path;
      const baseline=JSON.parse(savedProject);
      if(baseline.sprites[id])baseline.sprites[id].script=path;
      savedProject=JSON.stringify(baseline);updateDirty(false);
    }
    await updatePreviews();
    status='Script saved';
  }
  async function rebuild(){
    busy=true;error='';
    try{
      await request('./api/rebuild','POST');
      const current=await request('./api/project');
      assets=current.assets; art=current.art; revision=current.revision;
      importNewTags();
      await updatePreviews();
      status=dirty ? 'Unsaved project' : 'Assets rebuilt';
    }catch(err){error=err.message;}finally{busy=false;}
  }
  function dismissMenu(event){
    const menu=document.querySelector('details.export-menu[open]');
    if(menu && (!menu.contains(event.target) || event.target.closest('button,a')))menu.open=false;
  }
  function saveShortcut(event){
    if((event.ctrlKey||event.metaKey)&&!event.target.closest('input,textarea,select,[contenteditable=true],.blocklySvg')&&tab!=='blocks'&&['z','y'].includes(event.key.toLowerCase())&&!event.defaultPrevented){
      event.preventDefault();restoreRoom(event.key.toLowerCase()==='z'&&!event.shiftKey);return;
    }
    if(event.key==='Escape'){
      const menu=document.querySelector('details.export-menu[open]');
      if(menu){menu.open=false;menu.querySelector('summary').focus();event.preventDefault();return;}
    }
    if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='s' && project && tab==='room'){
      event.preventDefault();
      if(dirty)saveProject();
    }
  }
  async function playtest(event){
    event.preventDefault();
    if(busy)return;
    if(scriptDirty){error='Save or discard the current script first.';return;}
    const url=new URL(event.currentTarget.href);
    url.searchParams.set('playtest','1');
    if(window.__GAMEWAFFLE_STUDIO__){
      if(dirty&&!await saveProject())return;
      url.pathname='/__playtest';
      location.assign(url);
      return;
    }
    const pending=new URL(url);
    if(dirty)pending.searchParams.set('waiting','1');
    const player=window.open(pending,'GameWafflePlaytest','popup,width=960,height=640');
    if(!player){error='Allow Studio to open a playtest window.';return;}
    if(dirty){
      if(!await saveProject()){player.close();return;}
      if(!player.closed)player.location.replace(url);
    }
    player.focus();
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
  function groupTiles(tiles){
    const sets=Object.create(null);
    for(const [id,tile] of Object.entries(tiles))(sets[tile.source]??=[]).push(id);
    return sets;
  }
  function setName(path){return path.split('/').pop().replace(/\.[^.]+$/,'');}
  function assetCollection(){
    return assetKind==='tile'?project.tiles:assetKind==='sprite'?project.sprites:project.audio;
  }
  function selectSource(path,file=null){
    importFile=file;newSource=path;assetError='';
    const stem=path.split('/').at(-1).replace(/\.[^.]+$/,'').toLowerCase().replace(/[^a-z0-9_-]+/g,'_').replace(/^_+|_+$/g,'')||assetLabel;
    newId=stem;
    let suffix=2;
    while(Object.hasOwn(assetCollection()??{},newId)||['__proto__','constructor','prototype'].includes(newId))newId=stem+'_'+suffix++;
  }
  async function createAsset(){
    if(busy)return;
    let id=newId.trim();
    if(!newSource||!id)return;
    if(!/^[a-zA-Z0-9_-]+$/.test(id)||['__proto__','constructor','prototype'].includes(id)){
      assetError='Use letters, numbers, underscores, or hyphens in the name.';return;
    }
    if(assetKind!=='tile'){
      const stem=id;
      for(let suffix=2;Object.hasOwn(assetCollection()??{},id);suffix++)id=stem+'_'+suffix;
    }
    busy=true;assetError='';
    try{
      if(importFile){
        const response=await fetch('./api/import?name='+encodeURIComponent(importFile.name)+'&kind='+assetKind,{method:'POST',body:importFile});
        const result=await response.json();
        if(!response.ok)throw Error(result.error);
        recordFile(result.edit);newSource=result.path;importFile=null;
        const current=await request('./api/project');assets=current.assets;art=current.art;
      }
      if(art[newSource]?.error)throw Error(art[newSource].error);
      if(assetKind==='tile'){
        const source=art[newSource],size=project.tileSize??24;
        if(source?.width!==size||source?.height!==size)throw Error(`Tile art must be ${size}×${size} pixels.`);
        tileId=addTags(newSource,id).first;
      }else if(assetKind==='audio'){
        (project.audio??={})[id]={source:newSource};
      }else{
        (project.sprites??={})[id]={source:newSource,physics:{}};
        spriteId=id;
      }
      mark();
      if(assetKind==='tile')await updatePreviews();
      addForm=false;
    }catch(err){assetError=String(err.message??err);}
    finally{busy=false;}
  }
  function tagSlug(tag){return tag.split(':')[0].toLowerCase().replace(/[^a-z0-9_-]+/g,'-');}
  function importNewTags(previousArt){
    let added=false;
    for(const [path,ids] of Object.entries(groupTiles(project.tiles??{}))){
      const tags=art[path]?.tags;
      if(!tags?.length)continue;
      const previous=previousArt?.[path]?.tags;
      if(previous && previous[0]!==tags[0]){
        for(const id of ids){
          const tile=project.tiles[id];
          if(tile.tag==null && (!previous.length || tags.includes(previous[0]))){
            tile.tag=previous[0]??'';
            added=true;
          }
        }
      }
      const first=project.tiles[ids[0]];
      const suffix=first.tag && '-'+tagSlug(first.tag);
      const stem=first.setPrefix ?? (suffix && ids[0].endsWith(suffix)
        ? ids[0].slice(0,-suffix.length) : ids[0]);
      const result=addTags(path,stem);
      if(result.added)added=true;
    }
    if(added)mark();
    return added;
  }
  function addTags(path,stem){
    const tags=art[path]?.tags??[];
    const collection=project.tiles??={};
    const existing=Object.entries(collection).filter(([,tile])=>tile.source===path);
    let first=existing[0]?.[0];
    let added=false;
    for(const [index,tag] of (tags.length?tags:['']).entries()){
      if(existing.some(([,tile])=>(tile.tag??tags[0]??'')===tag))continue;
      const slug=tagSlug(tag);
      const base=tag?stem+'-'+(slug||String(index+1)):stem;
      let id=base,n=2;
      while(Object.hasOwn(collection,id))id=base+'-'+n++;
      collection[id]={source:path,setPrefix:stem,tag,physics:{}};
      added=true;
      first??=id;
    }
    return {first,added};
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

<svelte:window onkeydown={saveShortcut} onclick={dismissMenu} />

<header class="appbar">
  <div class="brand">
    <img src={productIcon} width="32" height="32" alt="">
    <div><h1>GameWaffle Studio</h1><small>{project?.name ?? 'Sprite game editor'}</small></div>
  </div>
  <div class="row actions">

    <span class="status" role="status">{status}</span>
    <a class="button primary" href="./player.html?playtest=1" onclick={playtest}><Play size={14}/>Play game</a>
  </div>
</header>
<nav class="studio-menus" aria-label="Application menu">
    <details name="studio-menu" class="export-menu"><summary>File</summary><div class="card">
        <a href="./projects?action=manager" onclick={e=>{if((dirty||scriptDirty)&&!confirm('Leave with unsaved changes?'))e.preventDefault();}}>Project Manager</a>
        <a href="./projects?action=new" onclick={e=>{if((dirty||scriptDirty)&&!confirm('Leave with unsaved changes?'))e.preventDefault();}}>New project…</a>
        <a href="./projects?action=open" onclick={e=>{if((dirty||scriptDirty)&&!confirm('Leave with unsaved changes?'))e.preventDefault();}}>Open project…</a>
        <button onclick={saveProject} disabled={!dirty||busy}>Save project</button>
        <a download={exportName+'.waffleproj'} href="./api/archive" onclick={saveThenOpen}>Editable project</a>
        <a download={exportName+'.html'} href="./export.html" onclick={saveThenOpen}>Standalone web game</a>
        <a href="./api/desktop?target=linux-x64" onclick={downloadDesktop}>Linux game</a>
        <a href="./api/desktop?target=windows-x64" onclick={downloadDesktop}>Windows game</a>

        <a download="gamewaffle-player.html" href="./gamewaffle-player.html">Web player</a>
        <a download={exportName+'.waffle'} href="./demo.waffle" onclick={saveThenOpen}>Cartridge</a>
      </div>
    </details>
    <details name="studio-menu" class="export-menu"><summary>Edit</summary><div class="card">
      <button disabled={scriptDirty||!historyStatus.canUndo} onclick={()=>restoreRoom(true)}>Undo project edit</button>
      <button disabled={scriptDirty||!historyStatus.canRedo} onclick={()=>restoreRoom(false)}>Redo project edit</button>
    </div></details>
    <details name="studio-menu" class="export-menu"><summary>Tools</summary><div class="card">
      <button onclick={()=>{gameSection='Controls';openTab('game');}}>Input map</button>
      <button onclick={()=>{gameSection='Items';openTab('game');}}>Item registry</button>
      <button onclick={debugRoom} disabled={busy||!project}>Debug room</button>
      <button onclick={rebuild} disabled={busy||!project}>Rebuild assets</button>
        <button onclick={()=>{updatesOpen=!updatesOpen;if(updatesOpen)checkReleases();}}>Updates</button>
    </div></details>
</nav>
{#if updatesOpen}
  <section class="card update-panel" aria-label="Release updates">
    {#each releases as release}
      <div class="row"><strong>{release.label}</strong><span>{release.installed}</span>
        {#if release.available}<button disabled={busy||checkingUpdates} onclick={()=>installRelease(release)}>Install {release.tag}</button>{:else}<small>Current</small>{/if}
      </div>
    {/each}
    <div class="row"><button disabled={busy||checkingUpdates} onclick={checkReleases}>{checkingUpdates?'Checking…':'Check again'}</button><button onclick={()=>updatesOpen=false}>Close</button></div>
  </section>
{/if}
{#if error || sourceError}<p role="alert" class="error banner">{error || sourceError}</p>{/if}
{#if debugging}<Debugger room={roomId} onClose={()=>debugging=false}/>
{:else if recovery}
  <section class="row card" role="alert"><strong>Unsaved project edits</strong>
    <button onclick={()=>{applyProject(recovery,true);recovery=null;if(importNewTags())updatePreviews().catch(err=>error=err.message);}}>Recover edits</button>
    <button onclick={()=>{recovery=null;draft.write(null);}}>Discard draft</button>
  </section>
{:else if project}
  <div class="mobile-tabs"><Sections labels={['Editor','Project','Settings']} bind:value={mobilePane}/></div>
  <main class:wide={tab==='game'||tab==='world'||(tab==='assets'&&['audio','source'].includes(assetKind))} data-pane={mobilePane}>
    <aside class="project card">
      <div class="heading row"><h2>Project</h2></div>
      <small class="project-path">{projectPath}</small>
      <label class="project-filter"><Search size={14}/><input type="search" aria-label="Find rooms, sprites, and tiles" placeholder="Find…" bind:value={filter}></label>
      <div class="category">
        <div class="heading row"><h3>Rooms</h3><button class="small-button icon-button" title="New room" aria-label="New room" aria-expanded={addPreset} disabled={busy} onclick={()=>addPreset=!addPreset}><Plus size={14}/></button></div>
        {#if addPreset}<div class="presets">
          <button onclick={()=>addRoom('platformer')}>New platformer room</button>
          <button onclick={()=>addRoom('top_down')}>New top-down room</button>
        </div>{/if}
        <PagedList items={Object.entries(project.rooms)} label="rooms" query={filter} text={entry=>entry[0]+' '+(entry[1].title??'')}>{#snippet children([id,item])}
          <button class="item" class:selected={roomId===id} onclick={()=>selectRoom(id)}>
            <RoomIcon size={14}/><span>{item.title??id}</span>
          </button>
        {/snippet}</PagedList>
      </div>
      <div class="category">
        <div class="heading row"><h3>Actors</h3><button class="small-button icon-button" title="Create actor" aria-label="Create actor" onclick={()=>openAssets('sprite',true)}><Plus size={14}/></button></div>
        <PagedList items={Object.keys(project.sprites??{})} label="sprites" query={filter}>{#snippet children(id)}
          <div class="actor-entry"><button class="item" class:selected={tab==='room' ? mapTool==='spawn' && placementSprite===id : spriteId===id && (tab==='actors'||tab==='blocks')}
            draggable={tab==='room'} ondragstart={event=>dragDefinition(event,id)}
            title={tab==='room' ? 'Click to place or drag to the map' : 'Select actor'}
            onclick={()=>chooseDefinition(id)}>
            {#if spriteArt[id]}<img src={spriteArt[id]} alt="">{:else}<SquareUserRound size={14}/>{/if}<span>{id}</span>
          </button><button class="script-link" title={'Open script for '+id} aria-label={'Open script for '+id} onclick={()=>openDefinition(id,'blocks')}>Code</button></div>
        {/snippet}</PagedList>
      </div>
      {#if tab!=='room'}<div class="category compact">
        <div class="heading row"><h3>Tile sets</h3><button class="small-button icon-button" title="Add tile set" aria-label="Add tile set" onclick={()=>openAssets('tile',true)}><Plus size={14}/></button></div>
        <PagedList items={Object.keys(tileSets)} label="tile sets" query={filter}>{#snippet children(path)}
          {@const first=tileSets[path][0]}
          <button class="item" title={path} class:selected={tab==='assets' && assetKind==='tile' && tile?.source===path} onclick={()=>{openAssets('tile');tileId=first;}}>
            {#if tileArt[first]?.[0]}<img src={tileArt[first][0]} alt="">{:else}<Layers3 size={14}/>{/if}<span>{setName(path)}</span>
          </button>
        {/snippet}</PagedList>
      </div>
    {/if}</aside>
    <div class="work">
      <nav class="row" aria-label="Editor views">
        {#each tabs as [id,title]}{@const Icon=viewIcons[id]}<button class:active={tab===id} onclick={()=>{if(id==='blocks' && tab==='room')openDefinition((mapTool==='spawn'?placementSprite:actor?.sprite)||spriteId,id);else openTab(id);}}><Icon size={15}/>{title}</button>{/each}
      </nav>
      {#if tab==='world' && room}
        <World rooms={project.rooms} flags={Object.keys(project.flags??{})} {roomId} onSelect={id=>{roomId=id;layerIndex=chooseInitialLayer(project.rooms[id]);selectedEntity=-1;}} onEdit={replaceRoom}/>
      {:else if tab==='room' && room}
        {#key roomId}
          <RoomMap {room} {roomId} size={project.tileSize??24} tiles={project.tiles??{}} sprites={project.sprites??{}}
            {tileArt} {spriteArt} {previewModes} {layerIndex} bind:selectedEntity bind:tileId bind:spriteId={placementSprite} bind:tool={mapTool} bind:placeAs {busy}
            canUndo={historyStatus.canUndo} canRedo={historyStatus.canRedo}
            onUndo={()=>restoreRoom(true)} onRedo={()=>restoreRoom(false)} onEdit={replaceRoom}
            onPlayer={value=>changeActor('player',value)} onLayer={chooseLayer} onSprites={()=>roomPanel='instances'} onAssets={()=>openAssets('tile')}
            onPlay={playtest} />
        {/key}
      {:else if tab==='blocks'}
        {#if spriteId}
          {#key spriteId+':'+scriptVersion}<ScriptPanel newActor={!Object.hasOwn(JSON.parse(savedProject).sprites??{},spriteId)} onBeforeSave={async()=>!dirty||await saveProject()} onFileEdit={recordFile} sprite={spriteId} sprites={Object.keys(project.sprites??{})} items={Object.keys(project.items??{})} actions={[...buttons,...Object.keys(project.controls??{})]} bind:dirty={scriptDirty} onSave={saveScript} />{/key}
        {:else}<p class="empty card">Create an actor to edit its script.</p>{/if}
      {:else if tab==='game'}
        <section class="card asseteditor">
          <h2>Game settings</h2>
          <Sections labels={['Variables','Controls','Items','Display']} bind:value={gameSection}/>
          {#if gameSection==='Controls'}
            <InputMap controls={project.controls??{}} onChange={controls=>set(project,'controls',controls)}/>
          {:else if gameSection==='Items'}
            <form class="record-form" onsubmit={e=>{e.preventDefault();if(!/^[A-Za-z_]\w{0,63}$/.test(newItem)||['__proto__','constructor','prototype'].includes(newItem)||Object.hasOwn(project.items??{},newItem)){error='Choose a unique item ID';return;}set(project.items??={},newItem,{consumable:false});itemId=newItem;newItem='';}}>
              <label>Item name<input placeholder="key" required bind:value={newItem}></label><button class="primary" disabled={!newItem.trim()}>Register item</button>
            </form>
            {#if Object.keys(project.items??{}).length}
              <label class="stack">Registered item<select value={itemId||Object.keys(project.items)[0]} onchange={e=>itemId=e.currentTarget.value}>{#each Object.keys(project.items) as id}<option>{id}</option>{/each}</select></label>
            {/if}
            {#if project.items?.[itemId||Object.keys(project.items??{})[0]]}
              {@const item=project.items[itemId||Object.keys(project.items)[0]]}<label class="stack">Icon<select value={item.icon??''} onchange={e=>set(item,'icon',e.currentTarget.value)}><option value="">None</option>{#each artFiles as file}<option>{file}</option>{/each}</select></label>
              <label class="check"><input type="checkbox" checked={item.consumable} onchange={e=>set(item,'consumable',e.currentTarget.checked)}>Consume on use</label>
              <label class="stack">Set flag on use<select value={item.flag??''} onchange={e=>set(item,'flag',e.currentTarget.value)}><option value="">None</option>{#each Object.keys(project.flags??{}) as f}<option>{f}</option>{/each}</select></label>
            {/if}
          {:else if gameSection==='Variables'}
            <form class="record-form" onsubmit={e=>{e.preventDefault();addVariable();}}>
              <label>Type<select bind:value={variableKind}><option value="variables">Variable</option><option value="flags">Flag</option></select></label>
              <label>Name<input aria-label="Variable name" required placeholder={variableKind==='flags'?'door_open':'score'} bind:value={variableId}></label>
              <label>Initial value{#if variableKind==='flags'}<select bind:value={initialFlag}><option value={false}>False</option><option value={true}>True</option></select>{:else}<input type="number" required step="1" bind:value={initialNumber}>{/if}</label>
              <button class="primary" disabled={!variableId.trim()}>Create {variableKind==='flags'?'flag':'variable'}</button>
            </form>
            {#each Object.entries(project.variables??{}) as [id,value]}
              <label class="row variable">{id}<input type="number" step="1" {value} onchange={e=>{
                const next=e.currentTarget.valueAsNumber;
                if(Number.isSafeInteger(next))set(project.variables,id,next);
                else e.currentTarget.value=value;
              }}></label>
            {/each}
            {#each Object.entries(project.flags??{}) as [id,value]}
              <label class="check"><input type="checkbox" checked={value} onchange={e=>set(project.flags,id,e.currentTarget.checked)}>{id}</label>
            {/each}

          {:else}
            <div class="pair">
              {#each [['min_width','Minimum width',128,128],['min_height','Minimum height',128,128],['max_width','Maximum width',512,128],['max_height','Maximum height',512,128],['zoom','Pixel zoom',2,1]] as [key,label,fallback,min]}
                <label class="stack">{label}<input type="number" {min} max={key==='zoom'?8:512} value={project.camera?.[key]??fallback} onchange={e=>{
                  const value=e.currentTarget.valueAsNumber;
                  if(Number.isInteger(value)&&value>=min&&value<=(key==='zoom'?8:512))set((project.camera??={}),key,value);
                  else e.currentTarget.value=project.camera?.[key]??fallback;
                }}></label>
              {/each}
            </div>
            <label class="stack">Bitmap font<select value={project.font??''} onchange={e=>set(project,'font',e.currentTarget.value)}>
              <option value="">Built-in</option>{#each artFiles.filter(f=>art[f]?.width===96 && art[f]?.height===48) as file}<option>{file}</option>{/each}
            </select></label>
          {/if}
        </section>
      {:else if tab==='actors'||tab==='assets'}
        <section class="card asseteditor">
          <div class="row heading">
            <h2>{tab==='actors'?'Actors':'Assets'}</h2>
            {#if tab==='assets'}<div class="row">
              {#each [['source','Source files'],['tile','Tiles'],['audio','Sounds']] as [id,label]}
                <button class:selected={assetKind===id} aria-pressed={assetKind===id} onclick={()=>openAssets(id)}>{label}</button>
              {/each}
            </div>{/if}
          </div>
          {#if assetKind==='source'}
            <div class="field-row"><label>Find source files<input type="search" bind:value={sourceFilter}></label>
              <button onclick={()=>sourcePicker.click()}>Import file…</button>
              <input hidden type="file" bind:this={sourcePicker} accept=".ase,.aseprite,.png,.wav,.qoa,.ogg,.opus" onchange={async e=>{
                const input=e.currentTarget,file=input.files[0];if(!file)return;
                try{const r=await fetch('./api/import?name='+encodeURIComponent(file.name),{method:'POST',body:file});const result=await r.json();if(!r.ok)throw Error(result.error);recordFile(result.edit);await checkAssets();}
                catch(err){error=err.message;}finally{input.value='';}
              }}></div>
            <PagedList items={assets} query={sourceFilter} label="source files">{#snippet children(file)}<p>{file}</p>{/snippet}</PagedList>
          {:else}
          <div class="row asset-bar">
            <h3>{addForm?'New '+assetLabel:assetKind==='audio'?'Sounds':assetKind==='tile'?'Tiles':'Actors'}</h3>
            {#if !addForm}<button onclick={()=>openAssets(assetKind,true)}><Plus size={16}/>New {assetLabel}…</button>{/if}
          </div>
          {#if assetKind==='tile'}
            <label class="stack">Tile size
              <select aria-label="Tile size" value={project.tileSize??24} onchange={e=>set(project,'tileSize',Number(e.currentTarget.value))}>
                {#each tileSizes as size}<option value={size}>{size} × {size}</option>{/each}
              </select>
            </label>
          {/if}
          {#if addForm}
            <form class="asset-create" onsubmit={e=>{e.preventDefault();createAsset();}}>
              <label for="asset-source">Source file</label>
              <div class="asset-source">
                <select id="asset-source" value={newSource} onchange={e=>selectSource(e.currentTarget.value)} disabled={busy}>
                  <option disabled value="">Choose a project file</option>
                  {#if importFile}<option value={importFile.name}>{importFile.name}</option>{/if}
                  {#each sources as file}<option value={file}>{file}</option>{/each}
                </select>
                <button type="button" disabled={busy} onclick={()=>filePicker.click()}>Browse device…</button>
                <input hidden type="file" bind:this={filePicker} accept={assetKind==='audio'?'.wav,.qoa,.ogg,.opus':'.ase,.aseprite,.png'}
                  onchange={e=>{const file=e.currentTarget.files[0];if(file)selectSource(file.name,file);e.currentTarget.value='';}}>
              </div>
              <label class="stack">{assetKind==='sprite'?'Actor name':assetKind==='tile'?'Tile ID prefix':'Sound name'}
                <input bind:value={newId} required disabled={busy} placeholder="Choose a source file first">
              </label>
              {#if assetError}<p class="error" role="alert">{assetError}</p>{/if}
              <div class="row"><button class="primary" disabled={busy||!newSource||!newId.trim()}>{'Create '+assetLabel}</button>
                <button type="button" disabled={busy} onclick={()=>addForm=false}>Cancel</button></div>
            </form>
          {:else if assetKind==='audio'}
            {#each Object.entries(project.audio??{}) as [id,file]}
              {@const source=typeof file==='string'?file:file.source}
              <div class="audio-line row"><code>{id}</code> <small>{source}</small>
                {#if /\.wav$/i.test(source)}<label class="check"><input type="checkbox" checked={typeof file==='string'||file.compress!==false}
                  onchange={e=>toggleCompression(id,e.currentTarget.checked)}> QOA</label>{/if}
              </div>
            {:else}<p class="muted">Add an audio file to use it in the game.</p>{/each}
          {:else}
            {#if assetKind==='sprite'}
              <div class="field-row"><label>Actor<select bind:value={spriteId}>{#each Object.keys(project.sprites??{}) as id}<option value={id}>{id}</option>{/each}</select></label>
                {#if spriteId}<button onclick={()=>openDefinition(spriteId,'blocks')}><Blocks size={15}/>Open script</button>{/if}</div>
            {:else}
              <label class="stack">Tile set<select value={tile?.source??''} onchange={e=>tileId=tileSets[e.currentTarget.value][0]}>{#each Object.keys(tileSets) as path}<option value={path}>{setName(path)}</option>{/each}</select></label>
              <label class="stack">Tile<select bind:value={tileId} aria-label="Tile definition">{#each tileSets[tile?.source]??[] as id}<option value={id}>{project.tiles[id].tag??id}</option>{/each}</select></label>
            {/if}
            {#if inspector}
              <label class="stack">Active flag<select value={inspector.flag??''} onchange={e=>set(inspector,'flag',e.currentTarget.value)}>
                <option value="">Always active</option>{#each Object.keys(project.flags??{}) as flag}<option>{flag}</option>{/each}
              </select></label>
              {#if inspector.flag}<label class="check"><input type="checkbox" checked={inspector.when??true} onchange={e=>set(inspector,'when',e.currentTarget.checked)}> Flag must be on</label>{/if}
              {#if assetKind==='sprite'}<label class="stack">Source <select value={inspector.source} onchange={e=>{
                const previous=inspector.source;
                if(previous!==e.currentTarget.value){
                  delete inspector.animation;
                  set(inspector,'source',e.currentTarget.value);
                }
              }}>
                {#each artFiles as file}<option value={file}>{file}</option>{/each}
              </select></label>
              {/if}
              {#if assetKind==='tile'}
                <label class="check"><input type="checkbox" checked={tile.persistRemoval??false} onchange={e=>set(tile,'persistRemoval',e.currentTarget.checked)}> Remember destroyed tiles</label>
                <p class="muted">{tile.source}{tile.tag?' · '+tile.tag:''}</p>
              {:else}
                <div class="record-form"><label>Player<select bind:value={placeAs}><option value="">Choose a player</option>{#each [0,1,2,3] as slot}<option disabled={room?.entities.some(e=>e.player===slot)} value={String(slot)}>Player {slot+1}</option>{/each}</select></label>
                <button disabled={placeAs===''||!room||room.entities.some(e=>e.player===Number(placeAs))} onclick={()=>{placementSprite=spriteId;mapTool='spawn';openTab('room');}}>Place player in room</button></div>
                <Sections labels={['Appearance','Combat','Particles']} bind:value={spriteSection}/>
                {#if spriteSection==='Appearance'}
                  <div class="pair">
                    <label class="stack">Visual layer <input type="number" value={sprite.layer??0} onchange={e=>set(sprite,'layer',e.currentTarget.valueAsNumber)}></label>
                    <label class="stack">Starting animation <select value={sprite.animation??''} onchange={e=>set(sprite,'animation',e.currentTarget.value)}>
                      <option value="">Default</option>
                      {#each (art[sprite.source]?.tags??[]).filter(tag=>tag!=='default') as tag}<option value={tag}>{tag}</option>{/each}
                    </select></label>
                    <label class="stack">Body width <input type="number" min="1" placeholder="From source" value={sprite.width??''} onchange={e=>set(sprite,'width',e.currentTarget.value===''?'':e.currentTarget.valueAsNumber)}></label>
                    <label class="stack">Body height <input type="number" min="1" placeholder="From source" value={sprite.height??''} onchange={e=>set(sprite,'height',e.currentTarget.value===''?'':e.currentTarget.valueAsNumber)}></label>
                  </div>
                {:else if spriteSection==='Combat'}
                  <div class="pair">
                    <label class="stack">Team <input type="number" value={sprite.team??0} onchange={e=>set(sprite,'team',e.currentTarget.valueAsNumber)}></label>
                    <label class="stack">Projectile <select value={sprite.projectile??''} onchange={e=>set(sprite,'projectile',e.currentTarget.value)}>
                      <option value="">Default</option>{#each Object.keys(project.sprites??{}).filter(id=>id!==spriteId) as id}<option value={id}>{id}</option>{/each}
                    </select></label>
                  </div>
                  <label class="check"><input type="checkbox" checked={sprite.alwaysActive??false} onchange={e=>set(sprite,'alwaysActive',e.currentTarget.checked)}> Run scripts off camera</label>
                {:else}
                  <label class="stack">Emitter<select value={sprite.emitter?.effect??''} onchange={e=>set(sprite,'emitter',e.currentTarget.value?{effect:e.currentTarget.value,rate:sprite.emitter?.rate??16}:'')}>
                    <option value="">None</option>{#each effects as effect}<option>{effect}</option>{/each}
                  </select></label>
                  {#if sprite.emitter}<label class="stack">Particles per second<input type="number" min="1" max="240" value={sprite.emitter.rate} onchange={e=>{
                    const n=e.currentTarget.valueAsNumber;if(Number.isInteger(n)&&n>=1&&n<=240)set(sprite,'emitter',{...sprite.emitter,rate:n});
                  }}></label>{/if}
                {/if}
              {/if}
            {/if}
          {/if}
          {/if}
        </section>
      {/if}
    </div>
    {#if tab!=='game' && tab!=='world' && (tab!=='assets' || !['audio','source'].includes(assetKind))}<aside class="inspector card">
      {#if tab==='room' && room}
        <div class="panel-tabs row">
          {#each [['layers','Layers'],['room','Room'],['instances','Instances']] as [id,label]}
            <button class:selected={roomPanel===id} aria-pressed={roomPanel===id} onclick={()=>roomPanel=id}>{label}</button>
          {/each}
        </div>
        {#if roomPanel==='room'}
          <Sections labels={['Size','Physics','Sound & color','Shader']} bind:value={roomSection}/>
          {#if roomSection==='Size'}<div class="row start-room">
            {#if (project.start??Object.keys(project.rooms)[0])===roomId}<small>Starting room</small>
            {:else}<button class="small-button" onclick={()=>set(project,'start',roomId)}>Set as starting room</button>{/if}
          </div>
          <label class="check"><input type="checkbox" checked={room.groupCamera??false} onchange={e=>setRoom('groupCamera',e.currentTarget.checked)}> Follow all players</label>
          <label class="stack">Room name <input value={room.title??roomId} onchange={e=>setRoom('title',e.currentTarget.value)}></label>
          <label class="stack">Room view <select aria-label="Room view" value={roomView} onchange={e=>setView(e.currentTarget.value)}>
            <option value="platformer">Platformer</option><option value="top_down">Top-down</option>
          </select></label>
          <div class="pair">
            <label class="stack">Columns <input type="number" min="1" max={maxTiles} value={dimensions?.cols??room.cols} onchange={e=>resizeRoom('cols',e.currentTarget)}></label>
            <label class="stack">Rows <input type="number" min="1" max={maxTiles} value={dimensions?.rows??room.rows} onchange={e=>resizeRoom('rows',e.currentTarget)}></label>
          </div>
          {#if dimensions}
            <p class="crop-note">The new room size cuts off tiles or sprites.</p>
            <div class="row"><button onclick={cropRoom}>Resize and crop</button><button onclick={()=>dimensions=null}>Cancel</button></div>
          {/if}
          {:else if roomSection==='Physics'}
            {#if roomView==='platformer'}
              <label class="stack">Gravity <input type="number" min="-100" max="100" step="any" value={room.gravity ?? platformGravity} onchange={e=>setRoom('gravity',e.currentTarget.valueAsNumber)}></label>
            {/if}
            <label class="stack">Room borders <select value={roomBorder(room,roomView==='top_down')} onchange={e=>setRoom('border',e.currentTarget.value)}>
              <option value="sides">Side walls</option><option value="closed">All four walls</option><option value="open">Open</option>
            </select></label>
          {:else if roomSection==='Shader'}
            <label class="stack">Room shader<select value={room.shader?.kind??'none'} onchange={e=>setRoom('shader',{...room.shader,kind:e.currentTarget.value})}>
              <option value="none">None</option>{#each Object.entries(roomShaders) as [value,label]}<option {value}>{label}</option>{/each}
            </select></label>
            {#if room.shader && room.shader.kind!=='none'}
              {#if !['ripple','hd'].includes(room.shader.kind)}<label class="stack">Color<input type="color" value={room.shader.color??'#000000'} onchange={e=>setRoom('shader',{...room.shader,color:e.currentTarget.value})}></label>{/if}
              <label class="stack">Strength ({room.shader.strength??35}%)<input type="range" min="0" max="100" value={room.shader.strength??35} onchange={e=>setRoom('shader',{...room.shader,strength:e.currentTarget.valueAsNumber})}></label>
              {#if ['scanlines','grid'].includes(room.shader.kind)}
                <label class="stack">Spacing ({room.shader.spacing??3} px)<input type="range" min="2" max="12" value={room.shader.spacing??3} onchange={e=>setRoom('shader',{...room.shader,spacing:e.currentTarget.valueAsNumber})}></label>
              {:else if room.shader.kind==='ripple'}
                <label class="stack">Wavelength ({room.shader.wavelength??32} px)<input type="range" min="8" max="128" value={room.shader.wavelength??32} onchange={e=>setRoom('shader',{...room.shader,wavelength:e.currentTarget.valueAsNumber})}></label>
                <label class="stack">Speed ({room.shader.speed??1} cycles/s)<input type="range" min="0" max="8" value={room.shader.speed??1} onchange={e=>setRoom('shader',{...room.shader,speed:e.currentTarget.valueAsNumber})}></label>
              {:else if room.shader.kind==='vignette'}
                <label class="stack">Clear radius ({room.shader.radius??55}%)<input type="range" min="0" max="95" value={room.shader.radius??55} onchange={e=>setRoom('shader',{...room.shader,radius:e.currentTarget.valueAsNumber})}></label>
              {/if}
            {/if}
          {:else}
            <label class="stack">Background <input type="color" value={room.background??'#171829'} onchange={e=>setRoom('background',e.currentTarget.value)}></label>
            {#if roomView==='top_down'}
              <label class="check"><input type="checkbox" checked={room.ySort??true} onchange={e=>setRoom('ySort',e.currentTarget.checked)}> Draw lower sprites in front</label>
            {/if}
            {#each [['music','Music'],['ambience','Ambient sound']] as [key,label]}
              <label class="stack">{label}<select value={room[key]??''} onchange={e=>setRoom(key,e.currentTarget.value)}>
                <option value="">None</option>{#each Object.keys(project.audio??{}) as id}<option value={id}>{id}</option>{/each}
              </select></label>
            {/each}
          {/if}
        {:else if roomPanel==='layers'}
          <div class="heading row mini"><h3>Draw order</h3><button class="small-button" disabled={busy} onclick={addLayer}>Add layer</button></div>
          {#each sortedLayers as {layer:item,index}}
            <button class="item" class:selected={layerIndex===index} onclick={()=>chooseLayer(index)}>
              <Layers3 size={14}/><span>{item.name}</span><small>{item.collidable?'Collision on':'Visual only'}</small>
            </button>
          {/each}
          {#if layer}
            <label class="stack">Layer name <input value={layer.name} onchange={e=>changeLayer('name',e.currentTarget.value)}></label>
            <label class="check"><input type="checkbox" checked={layer.collidable} onchange={e=>changeLayer('collidable',e.currentTarget.checked)}> Enable collision</label>
            <label class="stack">Layer flag<select value={layer.flag??''} onchange={e=>changeLayer('flag',e.currentTarget.value)}>
              <option value="">Always active</option>{#each Object.keys(project.flags??{}) as flag}<option>{flag}</option>{/each}
            </select></label>
            {#if layer.flag}<label class="check"><input type="checkbox" checked={layer.when??true} onchange={e=>changeLayer('when',e.currentTarget.checked)}> Flag must be on</label>{/if}
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
          <div class="heading row mini">
            <h3>Room instances</h3>
            <button class="small-button" disabled={!placementSprite} onclick={()=>{if(actor)placementSprite=actor.sprite;mapTool='spawn';}}>Add Sprite</button>
          </div>
          {#if !room.entities.length}<p class="muted">Choose an actor to place an instance.</p>{/if}
          <div class="instance-list">
            {#if room.entities.length>8}<input type="search" aria-label="Find instances" placeholder="Find instances" bind:value={instanceFilter}>{/if}
            <PagedList items={Object.entries(room.entities)} text={entry=>(entry[1].name??'')+' '+entry[1].sprite} query={room.entities.length>8?instanceFilter:''} label="instances">{#snippet children([key,entity])}
              {@const index=Number(key)}
              <button class="item" class:selected={selectedEntity===index} onclick={()=>{selectedEntity=index;mapTool='select';}}>
                <span>{entity.name ?? entity.sprite}</span>{#if entity.player!=null}<small>Player {entity.player+1}</small>{/if}
              </button>
            {/snippet}</PagedList>
          </div>
          {#if actor}
            {@const definition=project.sprites[actor.sprite]}
            <div class="row instance-source">
              <small>Actor: {actor.sprite}</small>
              <button class="small-button" onclick={()=>openDefinition(actor.sprite)}>Open actor</button>
              <button class="small-button" onclick={()=>openDefinition(actor.sprite,'blocks')}>Open script</button>
            </div>
            <label class="stack">Controlled by <select aria-label="Controlled by" value={actor.player==null ? '' : String(actor.player)} onchange={e=>changeActor('player',e.currentTarget.value)}>
              <option value="">No player</option>{#each [0,1,2,3] as player}<option value={String(player)}>Player {player+1}</option>{/each}
            </select></label>
            {#if actor.player!=null}<label class="check"><input type="checkbox" checked={actor.standardMovement??false} onchange={e=>changeActor('standardMovement',e.currentTarget.checked)}>Built-in movement</label>{/if}
            <Sections labels={['Placement','Overrides']} bind:value={instanceSection}/>
            {#if instanceSection==='Placement'}<label class="stack">Instance name <input maxlength="64" value={actor.name} onchange={e=>changeActor('name',e.currentTarget.value)}></label>
            <div class="pair">
              <label class="stack">X position <input type="number" min="0" value={actor.x} onchange={e=>changeActor('x',e.currentTarget.valueAsNumber)}></label>
              <label class="stack">Y position <input type="number" min="0" value={actor.y} onchange={e=>changeActor('y',e.currentTarget.valueAsNumber)}></label>
            </div>

            {:else}
              <div class="pair">
                <label class="stack">Draw layer <input type="number" min="-10000" max="10000" placeholder={String(definition?.layer??0)} value={actor.layer??''}
                  onchange={e=>changeActor('layer',e.currentTarget.value===''?'':e.currentTarget.valueAsNumber)}></label>
                <label class="stack">Health <input type="number" min=".001" max="1000000" step="any" placeholder={String(definition?.physics?.health??1)} value={actor.physics?.health??''}
                  onchange={e=>changeActor('health',e.currentTarget.value===''?'':e.currentTarget.valueAsNumber)}></label>
              </div>
              <label class="stack">Starting animation <select value={actor.animation??''} onchange={e=>changeActor('animation',e.currentTarget.value)}>
                <option value="">Definition default</option>
                {#each new Set(['default',...(art[definition?.source]?.tags??[])]) as tag}<option value={tag}>{tag}</option>{/each}
              </select></label>
              <label class="check"><input type="checkbox" checked={actor.persistRemoval??false} onchange={e=>changeActor('persistRemoval',e.currentTarget.checked)}> Save instance state</label>
              <label class="check"><input type="checkbox" checked={actor.flipX??false} onchange={e=>changeActor('flipX',e.currentTarget.checked || '')}> Face left at start</label>
              <label class="stack">Spawn flag<select value={actor.flag??''} onchange={e=>changeActor('flag',e.currentTarget.value)}>
                <option value="">Always</option>{#each Object.keys(project.flags??{}) as flag}<option>{flag}</option>{/each}
              </select></label>
              {#if actor.flag}<label class="check"><input type="checkbox" checked={actor.when??true} onchange={e=>changeActor('when',e.currentTarget.checked)}> Flag must be on</label>{/if}
            {/if}
            <button class="small-button remove" onclick={()=>{editRoom(next=>next.entities.splice(selectedEntity,1));selectedEntity=-1;}}>Remove instance</button>
          {/if}
        {/if}
      {:else}
        {@const target=tab==='blocks' ? sprite : inspector}
        <div class="heading row"><h2>Physics settings</h2></div>
        {#if target}
          <p class="asset-name">{tab==='blocks'||assetKind==='sprite' ? spriteId : tileId}</p>
          <Physics physics={target.physics} fallback={tab==='assets' && assetKind==='tile'
            ? (tile.tag??art[tile.source]?.tags?.[0]??'').includes(':fluid:') ? 'fluid' : 'static'
            : 'none'} onChange={value=>set(target,'physics',value)} />
        {/if}

      {/if}
    </aside>{/if}
  </main>
{/if}
<style>
  .actor-entry{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center}.script-link{color:var(--accent);background:transparent}
  .update-panel{display:grid;gap:.45rem;padding:.55rem .75rem}.update-panel strong{min-width:8rem}
  .project-path{display:block;overflow-wrap:anywhere;font-size:.69rem;margin-bottom:.4rem}.project-filter{display:flex;align-items:center;gap:.3rem}.project-filter input{min-width:0}.actions{flex:1;}
  .actions .status{margin-left:auto;}
  .appbar{display:flex;justify-content:space-between;align-items:center;gap:1rem;border-bottom:1px solid var(--line);padding:.4rem .65rem;}
  .status{font-size:.76rem;color:var(--muted);margin-right:.35rem;}
  .banner{margin:.6rem 1.1rem 0;padding:.55rem .65rem;border:1px solid #79505d;border-radius:7px;background:#30242f;}
  main{display:grid;grid-template-columns:minmax(155px,185px) minmax(300px,1fr) minmax(210px,255px);gap:1px;align-items:stretch;padding:0;background:var(--line);}
  .project,.inspector{padding:.65rem;}
  .work{min-width:0;background:var(--bg);padding:.45rem;}
  .heading{justify-content:space-between;margin-bottom:.55rem;}
  h2{font-size:.94rem;}
  h3{font-size:.72rem;font-weight:700;color:var(--muted);}
  .category{border-top:1px solid var(--line);padding-top:.58rem;margin-top:.65rem;}
  .category .heading{margin-bottom:.3rem;}
  .item{display:flex;align-items:center;gap:.45rem;width:100%;border-color:transparent;background:none;text-align:left;font-size:.79rem;padding:.35rem .35rem;}
  .item.selected{background:#352e3e;border-color:#62536b;}
  .item small{margin-left:auto;font-size:.66rem;}
  .item img{width:12px;height:12px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;}
  nav{margin-bottom:.4rem;border-bottom:1px solid var(--line);gap:1px;}
  nav button{background:none;border-color:transparent;font-size:.8rem;}
  nav .active{color:var(--accent);border-bottom:2px solid var(--accent);background:var(--panel);}
  .panel-tabs{border-bottom:1px solid var(--line);padding-bottom:.45rem;margin-bottom:.45rem;}
  .layer-actions,.remove,.crop-note{margin-top:.55rem;}
  .crop-note{font-size:.75rem;color:var(--accent);margin-bottom:.35rem;}
  .presets{display:grid;gap:.25rem;margin-bottom:.45rem;}
  .presets button{text-align:left;}
  .export-menu{position:relative;}
  .export-menu>div{position:absolute;left:0;top:calc(100% + 6px);z-index:5;display:grid;min-width:11rem;padding:.3rem;}
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
  .audio-line{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-top:.32rem;font-size:.78rem;}
  .extra{margin-top:.55rem;}.start-room{margin-bottom:.15rem;}
  .asset-name{font-size:.85rem;color:var(--accent);margin-bottom:.6rem;}
  .variable input{max-width:9rem;margin-left:auto;}
  .variable{margin-top:.45rem;}
  .asset-create{display:grid;gap:.5rem;max-width:34rem;margin-top:.65rem;}
  .asset-create>label{font-size:var(--control-font);color:var(--muted);}
  .asset-source{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.45rem;}
  .asset-bar{justify-content:space-between;margin-top:.65rem;}
  .instance-list{display:grid;gap:1px;}
  .instance-source{margin-top:.55rem;}
  .instance-source small{flex-basis:100%;font-size:.72rem;}
  .mobile-tabs{display:none;}
  main.wide{grid-template-columns:minmax(155px,185px) minmax(0,1fr);}
  .pair{grid-template-columns:repeat(2,minmax(0,1fr));}
  .project,.inspector{min-width:0;}.item span{overflow-wrap:anywhere;}
  @media(min-width:881px){
    :global(.studio #app){height:100dvh;display:flex;flex-direction:column;}
    main{min-height:0;flex:1;}
    .work,.project,.inspector{overflow:auto;min-height:0;max-height:none;scrollbar-gutter:stable;}
  }
  @media(max-width:880px){
    main,main.wide{display:block;padding:.4rem;min-height:0;overflow:auto;flex:1;}
    :global(.studio #app){height:100dvh;display:flex;flex-direction:column;}
    .mobile-tabs{display:block;margin:0 .5rem;}
    main[data-pane="Editor"]>aside,main[data-pane="Project"]>:not(.project),main[data-pane="Settings"]>:not(.inspector){display:none;}
    main.wide[data-pane="Settings"]>.work{display:block;}
    .appbar{padding:.4rem;gap:.3rem;}.actions{justify-content:flex-end}.status{display:none;}
    .inspector,.instance-list{max-height:none;overflow:visible;}
  }
</style>
