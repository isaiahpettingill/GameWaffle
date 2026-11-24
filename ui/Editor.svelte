<script>
  import productIcon from '../packaging/gamewaffle.svg?inline';
  import {Network,Blocks,Images,Settings2,Play,DoorOpen as RoomIcon,Layers3,Search,SquareUserRound,Plus} from '@lucide/svelte';
  import {roomShaders} from '../src/room-shaders.mjs';
  const viewIcons={world:Network,room:RoomIcon,actors:SquareUserRound,blocks:Blocks,assets:Images,game:Settings2};
  import { buttons, platformGravity, roomBorder } from '../src/schema.mjs';
  import PagedList from './PagedList.svelte';
  let projectPath=$state(''),filter=$state(''),instanceFilter=$state('');
  import InputMap from './InputMap.svelte';
  import Sections from './Sections.svelte';
  import World from './World.svelte';
  import {draftFile} from './recovery.js';
  import { onMount, tick } from 'svelte';
  import Debugger from './Debugger.svelte';
  let debugging=$state(false);
  async function debugRoom(){
    if(!await finishScript())return;
    if(!dirty||await saveProject())debugging=true;
  }
  import ScriptPanel from './ScriptPanel.svelte';
  import Localization from './Localization.svelte';
  import GameMenus from './GameMenus.svelte';
  import ComponentPicker from './ComponentPicker.svelte';
  import Bitfonts from './Bitfonts.svelte';
  import Modal from './Modal.svelte';
  import SearchSelect from './SearchSelect.svelte';
  import RespawnSettings from './RespawnSettings.svelte';
  import {resourceName} from '../src/resource-name.mjs';
  import {formatScript, locations, parseScript} from '../src/wafflescript.mjs';
  import ExportDialog from './ExportDialog.svelte';
  import Physics from './Physics.svelte';
  import { tileSizes } from '../src/script.mjs';
  import { unpack, decodeCbor } from '../src/cartridge.mjs';
  import {growSeamNeighbors} from '../src/room-geometry.mjs';
  import RoomMap from './RoomMap.svelte';
  import { instanceNames, newInstanceName, spriteDragType } from '../src/instances.mjs';

  let project=$state(null), assets=$state([]), art=$state({}), tab=$state('room'), roomId=$state(''), spriteId=$state(''),
    roomCode=$state(''), scriptMode=$state('blocks'), scriptStatus=$state(''), tileId=$state(''), layerIndex=$state(0), assetKind=$state('sprite'), scriptDirty=$state(false),
    dirty=$state(false), busy=$state(false), error=$state(''), status=$state('Opening project…'), newId=$state(''),
    newSource=$state('');
  let importFile=$state.raw(null), filePicker=$state(), assetError=$state('');
  let createKind=$state('sprite'), roomOperation=$state(''), newRoomName=$state(''), newRoomView=$state('platformer');
  let pendingTileSize=$state(null), collisionLayer=$state(0);
  const createLabel=$derived(createKind==='sprite'?'entity':createKind==='tile'?'tile set':'sound');
  const assetLabel=$derived(assetKind==='audio'?'sound':assetKind==='sprite'?'entity':'tile set');
  const tileSets=$derived(groupTiles(project?.tiles??{}));
  const sources=$derived(createKind==='audio'?audioFiles:artFiles);
  let tileArt=$state.raw({}), spriteArt=$state.raw({}), previewModes=$state.raw({});
  let historyVersion=$state(0), selectedEntity=$state(-1), roomPanel=$state('layers');
  let scriptPanel=$state(),projectTimer,projectWrite;
  let savedProject=$state(''), currentProject='';
  let previewEntries=new Map(), previewImages=new Map(), previewKey;
  const previewImage=url=>previewImages.get(url);
  const undo=[],redo=[];
  const draft=draftFile('project',message=>error=message);
  let recovery=$state.raw(null);
  let dimensions=$state(null);
  let placementSprite=$state(''), mapTool=$state('select'), addForm=$state(false);
  let revision=-1, checking=false;
  let sourceError=$state('');
  let backgroundPicker=$state(), importingBackground=$state(false), roomBackgrounds=$state({});
  let coverPicker=$state(), importingCover=$state(false);
  let room=$derived(project?.rooms[roomId]), roomBackground=$derived(roomBackgrounds[roomId]??room?.backgroundImage), layer=$derived(room?.layers?.[layerIndex]);
  let sprite=$derived(project?.sprites?.[spriteId]), tile=$derived(project?.tiles?.[tileId]);
  let inspector=$derived(assetKind==='tile' ? tile : sprite);
  let artFiles=$derived(assets.filter(file=>/\.(ase|aseprite|png)$/i.test(file)));
  let audioFiles=$derived(assets.filter(file=>/\.(wav|ogg|oga|opus|qoa|mid|midi)$/i.test(file)));
  let soundFonts=$derived(assets.filter(file=>/\.sf2$/i.test(file)));
  let newSoundFont=$state(''), soundFontFile=$state.raw(null), soundFontPicker=$state();
  const midiSource=$derived(createKind==='audio'&&/\.midi?$/i.test(newSource));
  let stageFilter=$state(''), sourceFilter=$state(''),placeAs=$state(''),sourcePicker=$state();
  let nameDialog=$state.raw(null),newName=$state('');
  let gameSection=$state('Game script'),instanceSection=$state('Placement'),mobilePane=$state('Editor');
  const tabs=[['world','World'],['room','Room'],['actors','Entities'],['blocks','Code'],['assets','Assets'],['game','Game']];

  const historyStatus=$derived.by(()=>{
    const revision=historyVersion;
    return { revision, undo:undo.at(-1)?.label, redo:redo.at(-1)?.label };
  });
  const sortedLayers=$derived((room?.layers ?? []).map((layer,index)=>({layer,index,order:layer.order??index}))
    .sort((a,b)=>b.order-a.order || b.index-a.index));
  const maxTiles=$derived(Math.floor(4096/(project?.tileSize??24)));
  const roomView=$derived(room?.view ?? (Math.abs(room?.gravity ?? platformGravity) < .01 ? 'top_down' : 'platformer'));
  const actor=$derived(room?.entities[selectedEntity]);
  const exportName=$derived((project?.name??'game').toLowerCase().replace(/[^a-z0-9]+/g,'-') || 'game');

  let exportDialog, fileMenu;
  const textEntries=$derived(project?.localization?.tables?.[project?.localization?.locale]??{});
  const textKeys=$derived(Object.keys(textEntries).sort());
  const componentLabels=$derived({
    ...Object.fromEntries([...Object.values(project?.sprites??{}).flatMap(type=>type.components??[]),
      ...Object.values(project?.rooms??{}).flatMap(room=>(room.entities??[]).flatMap(entity=>entity.components??[]))].map(id=>[id,id])),
    ...project?.components,
  });
  const collisionLayers=$derived(Array.from({length:16},(_,index)=>project?.collisionLayers?.[index]??(index===0?'Default':'Layer '+(index+1))));
  function createComponent(label){
    const existing=Object.keys(componentLabels).find(id=>componentLabels[id].toLowerCase()===label.toLowerCase());
    if(existing)return existing;
    const id=resourceName(label,'component',[componentLabels,{transform:1,sprite:1,body:1,player:1,health:1,script:1}]);
    (project.components??={})[id]=label;
    return id;
  }
  let gameScript=$state.raw(null), gameCode=$state(false), codeTile=$state(''), codeVariant=$state(0);
  let editTileVariant=$state('0');
  const activeTileCode=$derived(Boolean(codeTile));
  const gameFlags=$derived({...project?.flags,...gameScript?.declarations?.flags});
  const gameGlobals=$derived({...project?.variables,...gameScript?.declarations?.globals});
  const gameEvents=$derived({...project?.events,...gameScript?.declarations?.events});
  const blockReferences=$derived({
    names:[...new Set(Object.values(project?.rooms??{}).flatMap(room=>instanceNames(room.entities??[])))].sort(),
    componentsLabels:componentLabels,
    spritesLabels:Object.fromEntries(Object.entries(project?.sprites??{}).map(([id,sprite])=>[id,sprite.title??id])),
    itemsLabels:Object.fromEntries(Object.entries(project?.items??{}).map(([id,item])=>[id,item.label?.startsWith('text.')?textEntries[item.label.slice(5)]??id:item.label??id])),
    components:[...new Set(['transform','sprite','body','player','health','script',...Object.keys(componentLabels)])].sort(),
    fields:[...new Set(['health','label','ready','score','speed',...Object.keys(gameGlobals),...Object.keys(project?.entityFields??{})])],
    fieldsLabels:project?.entityFields??{},variableLabels:project?.variableLabels??{},
    rooms:Object.keys(project?.rooms??{}),
    sounds:Object.keys(project?.audio??{}),
    backgrounds:artFiles.filter(file=>!art[file]?.error),
    backgroundsLabels:Object.fromEntries(artFiles.map(file=>[file,file.split('/').at(-1)])),
    collections:gameScript?.collections,
    events:Object.keys(gameEvents),eventsLabels:gameEvents,gameConstants:gameScript?.constants??{},
    fonts:['builtin',...Object.keys(project?.bitfonts??{})],
    fontsLabels:{builtin:'Built-in',...Object.fromEntries(Object.entries(project?.bitfonts??{}).map(([id,font])=>[id,font.name??id]))},
    flags:Object.keys(gameFlags),
  });
  const codeRoomId=$derived(roomCode||(!spriteId?roomId:''));
  const codeRoom=$derived(project?.rooms[codeRoomId]);
  const activeRoomCode=$derived(!gameCode&&!activeTileCode&&Boolean(codeRoom));
  const roomScripts=$derived(Object.entries(project?.rooms??{}).map(([id,room])=>({id,title:room.title??id})));
  const tileScripts=$derived(Object.entries(project?.tiles??{}).flatMap(([id,tile])=>
    (tileArt[id]??[]).map((_,variant)=>({id,variant,title:(tile.title??tile.tag??id)+' · Variant '+(variant+1)}))));
  const entityScripts=$derived(Object.entries(project?.sprites??{}).map(([id,sprite])=>({id,title:sprite.title??id})));
  const authoringView=$derived(tab==='room'||tab==='blocks');
  const hasInspector=$derived(tab==='room'||tab==='actors'||(tab==='assets'&&assetKind==='tile'));

  function askName(kind,query,register,select){
    newName=query.slice(0,100);
    nameDialog={kind,register,select};
  }
  function newEvent(query='',select){
    askName('event',query,async title=>{
      const id=resourceName(title,'event',[gameEvents]);
      return defineInGame('events',id,title);
    },select);
  }
  async function defineInGame(group,id,value){
    if(dirty&&!await saveProject())throw Error('Save the project before adding a declaration');
    let unit=await request('./api/game-script');
    const definition={declarations:{[group]:{[id]:value}}};
    unit.declarations??={};
    (unit.declarations[group]??={})[id]=value;
    if(unit.source!=null){
      const source=formatScript(definition)+'\n'+unit.source;
      unit={...unit,...parseScript(source),source};
    }
    const result=await request('./api/game-script','PUT',unit);
    recordFile(result.edit,'declaration of '+id);
    saveScript('game',false,true,unit);
    return id;
  }
  async function registerScriptField(scope,title){
    const local=scope.startsWith('local');
    const kind=scope==='flag'?'flag':local?'field':'variable';
    const labels=local?project.entityFields:project.variableLabels?.[scope];
    const values=scope==='flag'?gameFlags:local?undefined:gameGlobals;
    const id=resourceName(title,kind,[values??{},labels??{}]);
    if(scope==='flag')await defineInGame('flags',id,false);
    else if(!local)await defineInGame('globals',id,scope.endsWith('_real')?{real:0}:scope.endsWith('_bool')?false:scope.endsWith('_string')?'':0);
    const next={...labels,[id]:title};
    if(local)project.entityFields=next;
    else project.variableLabels={...project.variableLabels,[scope]:next};
    mark('creation of '+title);
    return id;
  }
  function newScriptField(scope,query,select){
    const kind=scope==='flag'?'flag':scope.startsWith('global')?'variable':'field';
    askName(kind,query,title=>registerScriptField(scope,title),select);
  }
  async function submitName(){
    const title=newName.trim();
    if(!title)return;
    const {register,select}=nameDialog;
    try{
      const id=await register(title);
      nameDialog=null;
      if(select){await tick();select(id);}
    }catch(err){error=err.message;}
  }

  function openExport() {
    fileMenu.open=false;
    exportDialog.open();
  }
  async function saveEdits() {
    if (busy) return false;
    return await finishScript() && (!dirty || await saveProject());
  }

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
  async function request(path, method='GET', data) {
    const response=await fetch(path,{method,headers:data ? {'Content-Type':'application/json'} : {},body:data ? JSON.stringify(data) : undefined});
    const result=await response.json();
    if(!response.ok)throw Error(result.error ?? 'Request failed');
    return result;
  }
  let previewVersion=0;
  async function updatePreviews(key) {
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
    const entries=new Map(), created=[];
    function png(id,bytes){
      let entry=previewEntries.get(id);
      if(!entry||entry.bytes.length!==bytes.length||!bytes.every((value,index)=>entry.bytes[index]===value)){
        const url=URL.createObjectURL(new Blob([bytes],{type:'image/png'})), image=new Image();
        image.src=url;
        entry={bytes,url,image};
        created.push(entry);
      }
      entries.set(id,entry);
      return entry.url;
    }
    const nextTiles=Object.fromEntries(Object.entries(tiles).map(([id,data])=>
      [id,data.variants.map((bytes,index)=>png('tile/'+id+'/'+index,bytes))]));
    const nextModes=Object.fromEntries(Object.entries(tiles).map(([id,data])=>[id,data.mode]));
    const nextSprites=Object.fromEntries(Object.entries(next.spritePreviews??{}).map(([id,bytes])=>[id,png('sprite/'+id,bytes)]));
    await Promise.allSettled(created.map(({image})=>image.decode()));
    if(version!==previewVersion){
      for(const {url} of created)URL.revokeObjectURL(url);
      return;
    }
    const retired=[];
    for(const [id,entry] of previewEntries)if(entries.get(id)!==entry)retired.push(entry.url);
    previewEntries=entries;
    previewImages=new Map([...entries.values()].map(({url,image})=>[url,image]));
    previewKey=key;
    if(JSON.stringify(tileArt)!==JSON.stringify(nextTiles))tileArt=nextTiles;
    if(JSON.stringify(previewModes)!==JSON.stringify(nextModes))previewModes=nextModes;
    if(JSON.stringify(spriteArt)!==JSON.stringify(nextSprites))spriteArt=nextSprites;
    await tick();
    for(const url of retired)URL.revokeObjectURL(url);
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
      projectPath=value.path;project=value.project;gameScript=value.gameScript; roomBackgrounds=value.roomBackgrounds; assets=value.assets; art=value.art; revision=value.revision;
      currentProject=savedProject=JSON.stringify(value.project);
      recovery=await draft.read();
      if(recovery===savedProject){recovery=null;await draft.write(null);}
      roomId=project.start ?? Object.keys(project.rooms)[0];
      spriteId=Object.keys(project.sprites ?? {})[0] ?? '';
      placementSprite=spriteId;
      tileId=Object.keys(project.tiles ?? {})[0] ?? '';
      layerIndex=chooseInitialLayer(project.rooms[roomId]);
      if(!recovery)importNewTags();
      await updatePreviews(value.previewKey);
      status=dirty?'Unsaved project':'Ready';
    }catch(err){error=err.message;status='Project unavailable';}
  }
  onMount(()=>{
    load();
    const monitor=setInterval(checkAssets,1600);
    return ()=>{
      clearTimeout(projectTimer);clearInterval(monitor);previewVersion++;
      for(const {url} of previewEntries.values())URL.revokeObjectURL(url);
    };
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
        if(JSON.stringify(assets)!==JSON.stringify(current.assets))assets=current.assets;
        if(JSON.stringify(art)!==JSON.stringify(current.art)){
          const previousArt=art;
          art=current.art;
          if(!recovery)importNewTags(previousArt);
        }
        if(JSON.stringify(roomBackgrounds)!==JSON.stringify(current.roomBackgrounds))roomBackgrounds=current.roomBackgrounds;
        if(current.previewKey!==previewKey)await updatePreviews(current.previewKey);
        revision=current.revision;
      }
    }catch(err){sourceError=err.message;}finally{checking=false;}
  }
  function mark(label){
    updateDirty(label);
  }
  function updateDirty(label='project edit',record=true){
    const next=JSON.stringify(project);
    if(record && next!==currentProject){
      undo.push({snapshot:currentProject,label});
      if(undo.length>50)undo.shift();
      redo.length=0;
    }
    currentProject=next;historyVersion++;
    dirty=next!==savedProject;
    status=dirty?'Unsaved project':'Ready';
    draft.write(dirty?next:null);
    clearTimeout(projectTimer);
    if(dirty)projectTimer=setTimeout(saveProject,800);
  }
  function replaceRoom(next,label='edit to '+(room.title??roomId),growth){
    if(busy)return;
    if(growth)for(const [id,neighbor] of growSeamNeighbors(project.rooms,roomId,project.tileSize??24,growth))project.rooms[id]=neighbor;
    project.rooms[roomId]=next;
    updateDirty(label);
  }
  function applyProject(serialized,record){
    const previousTiles=JSON.stringify(project.tiles);
    project=JSON.parse(serialized);
    if(!project.rooms[roomId])roomId=project.start??Object.keys(project.rooms)[0];
    if(roomCode&&!project.rooms[roomCode])roomCode=roomId;
    if(!project.sprites?.[spriteId])spriteId=Object.keys(project.sprites??{})[0]??'';
    if(!project.tiles?.[tileId])tileId=Object.keys(project.tiles??{})[0]??'';
    layerIndex=chooseInitialLayer(project.rooms[roomId]);
    placementSprite=spriteId;selectedEntity=-1;dimensions=null;
    updateDirty('recovered edits',record);
    if(JSON.stringify(project.tiles)!==previousTiles)updatePreviews().catch(err=>error=err.message);
  }
  function editRoom(change,label){
    const next=JSON.parse(JSON.stringify(room));
    change(next);
    replaceRoom(next,label);
  }
  function recordFile(id,label='file edit'){
    if(!id)return;
    undo.push({id,label});if(undo.length>50)undo.shift();redo.length=0;historyVersion++;
  }
  let scriptVersion=$state(0);
  async function restoreEdit(back){
    if(busy||scriptDirty)return;
    const active=back?undo:redo;
    if(!active.length)return;
    const entry=active.at(-1);
    if(entry.id){
      busy=true;error='';
      try{
        await request('./api/file-history','POST',{id:entry.id,back});
        active.pop();(back?redo:undo).push(entry);historyVersion++;scriptVersion++;
        const latest=await request('./api/project');
        assets=latest.assets;art=latest.art;revision=latest.revision;await updatePreviews(latest.previewKey);
      }catch(e){error=e.message;}finally{busy=false;}
      return;
    }
    (back?redo:undo).push({snapshot:currentProject,label:entry.label});
    active.pop();
    applyProject(entry.snapshot,false);
  }
  function setRoom(key,value){
    const names={title:'rename of ',backgroundImage:'background image in ',groupCamera:'camera target in ',cameraZoom:'camera zoom in '};
    editRoom(next=>{if(value==='')delete next[key];else next[key]=value;},
      (names[key]??'settings in ')+(room.title??roomId));
  }
  async function setRoomBackground(id,path){
    if(!await finishScript()||!await saveProject())return;
    const endpoint='./api/room-script/'+encodeURIComponent(id);
    const unit=await request(endpoint);
    const parsed=unit.source!=null?parseScript(unit.source):null;
    const init=unit.events.init??=[];
    const existing=init.findLastIndex(block=>block.op==='set_room_background_image');
    const block=existing>=0?{...init[existing],image:path}:{op:'set_room_background_image',image:path,scroll:1};
    if(existing>=0)init[existing]=block;else init.push(block);
    if(parsed){
      const snippet=formatScript({events:{init:[block]}});
      const source=unit.source,command=snippet.split('\n')[1];
      const oldCommands=parsed.events.init;
      const old=locations.get(oldCommands?.[existing]);
      if(old)unit.source=source.slice(0,old.from)+command.trimStart()+source.slice(old.to);
      else if(oldCommands){
        const last=locations.get(oldCommands.at(-1));
        const from=last?source.indexOf('\n',last.to)+1:/^\s*on[ \t]+init\b[^\n]*\n/m.exec(source)?.index;
        const at=last?from:source.indexOf('\n',from)+1;
        unit.source=source.slice(0,at)+command+'\n'+source.slice(at);
      }else unit.source=source.trimEnd()+'\n\n'+snippet;
    }
    const result=await request(endpoint,'PUT',unit);
    recordFile(result.edit,'background image in '+id);
    saveScript(id,true,false,unit,false);
    const current=await request('./api/project');
    roomBackgrounds=current.roomBackgrounds;
    await updatePreviews(current.previewKey);
  }

  async function importBackground(input){
    const file=input.files[0], id=roomId;
    input.value='';
    if(!file||importingBackground||busy)return;
    importingBackground=true;error='';
    try{
      const response=await fetch('./api/import?kind=background&name='+encodeURIComponent(file.name),{method:'POST',body:file});
      const result=await response.json();
      if(!response.ok)throw Error(result.error);
      recordFile(result.edit,'import of '+file.name);
      const current=await request('./api/project');
      assets=current.assets;art=current.art;
      if(project.rooms[id])await setRoomBackground(id,result.path);
    }catch(err){error=err.message;}finally{importingBackground=false;}
  }
  async function importCover(input){
    const file=input.files[0];
    input.value='';
    if(!file||importingCover||busy)return;
    importingCover=true;error='';
    try{
      let name=file.name,body=file;
      if(/\.(jpe?g|webp)$/i.test(name)){
        const image=await createImageBitmap(file);
        try{
          const scale=Math.min(1,512/Math.max(image.width,image.height));
          const canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round(image.width*scale));
          canvas.height=Math.max(1,Math.round(image.height*scale));
          canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
          body=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Could not convert the cover image')),'image/png'));
          name=name.replace(/\.[^.]+$/,'.png');
        }finally{image.close();}
      }
      const r=await fetch('./api/import?kind=cover&name='+encodeURIComponent(name),{method:'POST',body});
      const result=await r.json();
      if(!r.ok)throw Error(result.error);
      recordFile(result.edit,'cover art import');
      set(project,'coverImage',result.path);
    }catch(err){error=err.message;}finally{importingCover=false;}
  }
  function setView(view){
    if(view===roomView)return;
    // Store the current settings before changing defaults associated with the view.
    editRoom(next=>{
      next.ySort??=roomView==='top_down';
      next.border??=roomBorder(room,roomView==='top_down');
      next.view=view;
    },'room view');
  }
  function openResize(){
    dimensions={cols:room.cols,rows:room.rows};
    roomOperation='resize';
  }
  const crops=$derived.by(()=>{
    if(!dimensions || !room)return {tiles:0,entities:0};
    const {cols,rows}=dimensions,size=project.tileSize??24;
    return {
      tiles:room.layers.reduce((total,layer)=>total+layer.cells.filter(([x,y])=>x>=cols||y>=rows).length,0),
      entities:room.entities.filter(entity=>entity.x>=cols*size||entity.y>=rows*size).length,
    };
  });
  function cropRoom(){
    const {cols,rows}=dimensions;
    if(![cols,rows].every(value=>Number.isInteger(value)&&value>=1&&value<=maxTiles))return;
    const size=project.tileSize??24;
    editRoom(next=>{
      Object.assign(next,{cols,rows});
      if(next.cameraBottomInset>=rows)next.cameraBottomInset=rows-1;
      for(const layer of next.layers)layer.cells=layer.cells.filter(([x,y])=>x<cols&&y<rows);
      next.entities=next.entities.filter(entity=>entity.x<cols*size&&entity.y<rows*size);
    },'resize of '+(room.title??roomId));
    selectedEntity=-1;roomOperation='';dimensions=null;
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
    editRoom(next=>next.layers.splice(layerIndex,1),'removal of '+layer.name);
    layerIndex=Math.min(layerIndex,room.layers.length-1);
    roomOperation='';
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
      if(key==='player' && value!=='' && next.entities.some((entry,index)=>index!==selectedEntity && entry.player===Number(value)))return;
      const entity=next.entities[selectedEntity];
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
  let inlinePlaytest=$state(false), playtestFrame=$state();
  function stopInlinePlaytest(){
    inlinePlaytest=false;
    requestAnimationFrame(()=>document.querySelector('.stage-tools button.primary')?.focus());
  }
  function handlePlaytestMessage(event){
    if(event.origin===location.origin && event.source===playtestFrame?.contentWindow && event.data==='gamewaffle:stop-playtest')stopInlinePlaytest();
  }
  async function startInlinePlaytest(){
    if(!await finishScript() || (dirty && !await saveProject()) || tab!=='blocks')return;
    inlinePlaytest=true;
    requestAnimationFrame(()=>playtestFrame?.focus());
  }
  function openTab(id){
    if(id!=='blocks')inlinePlaytest=false;
    mobilePane='Editor';

    if(id==='actors')assetKind='sprite';
    if(id==='assets'&&assetKind==='sprite')assetKind='source';
    error='';tab=id;
    if(id==='blocks'||id==='room')requestAnimationFrame(()=>document.querySelector(id==='blocks'?'.code-pane':'.map-pane')?.focus({preventScroll:true}));
  }
  async function selectSprite(id){
    if(!gameCode&&!activeTileCode&&!activeRoomCode&&spriteId===id&&scriptPanel&&!await scriptPanel.selectBase())return false;
    if((gameCode||activeTileCode||activeRoomCode||spriteId!==id) && !await finishScript())return false;
    gameCode=false;codeTile='';roomCode='';spriteId=id;assetKind='sprite';error='';
    return true;
  }
  async function selectRoomScript(id){
    if(!project.rooms[id] || ((gameCode||activeTileCode||codeRoomId!==id) && !await finishScript()))return false;
    if(!gameCode&&!activeTileCode&&codeRoomId===id&&scriptPanel&&!await scriptPanel.selectBase())return false;
    gameCode=false;codeTile='';roomCode=id;error='';
    return true;
  }
  async function openRoomScript(){
    if(await selectRoomScript(roomId))openTab('blocks');
  }
  async function openGameScript(){
    if(!await finishScript())return false;
    gameCode=true;codeTile='';
    openTab('blocks');
    return true;
  }
  async function openTileScript(id,variant){
    if(!tileArt[id]?.[variant]||!await finishScript())return false;
    gameCode=false;codeTile=id;codeVariant=variant;
    openTab('blocks');return true;
  }
  function selectScriptFile(kind,id,variant){
    return kind==='game'?openGameScript():kind==='tile'?openTileScript(id,variant):kind==='room'?selectRoomScript(id):selectSprite(id);
  }
  function chooseDefinition(id){
    if(tab==='room'){
      selectSprite(id);mobilePane='Editor';placementSprite=id;
      mapTool='spawn';
      return;
    }
    openDefinition(id,tab==='actors'?'actors':'blocks');
  }
  function dragDefinition(event,id){
    event.dataTransfer.setData(spriteDragType,id);
    event.dataTransfer.effectAllowed='copy';
  }
  async function openDefinition(id,view='actors'){
    if(await selectSprite(id))openTab(view);
  }
  function openAssets(kind,adding=false){
    if(busy)return;

    if(adding){
      createKind=kind;
      newId='';newSource='';importFile=null;newSoundFont='';soundFontFile=null;assetError='';addForm=true;
    }else{
      assetKind=kind;
      openTab(kind==='sprite'?'actors':'assets');
    }
  }
  function chooseInitialLayer(map){
    const layers=(map?.layers??[]).map((item,index)=>({item,index}));
    return layers.sort((a,b)=>Number(Boolean(b.item.collidable))-Number(Boolean(a.item.collidable))
      || (b.item.order??b.index)-(a.item.order??a.index)).at(0)?.index??0;
  }
  async function selectRoom(id,from='open'){
    const followRoom=from==='sidebar'||(activeRoomCode&&codeRoomId===roomId);
    if(followRoom&&!await selectRoomScript(id))return;
    if(id!==roomId){
      roomPanel='layers';selectedEntity=-1;dimensions=null;mapTool='select';
      roomId=id;layerIndex=chooseInitialLayer(project.rooms[id]);
      inlinePlaytest=false;
    }
    if(from==='open')openTab('room');
    if(from==='sidebar'&&authoringView)mobilePane='Editor';
  }
  async function finishScript(){
    if(!scriptDirty || await scriptPanel?.flush())return true;
    error='Fix the script error before you run or export the game.';return false;
  }
  async function saveProject(){
    clearTimeout(projectTimer);
    if(projectWrite)await projectWrite;
    if(!dirty)return true;
    if(projectWrite)return projectWrite;
    const saved=JSON.stringify(project);
    projectWrite=(async()=>{
      try{
        await request('./api/project','PUT',JSON.parse(saved));
        savedProject=saved;updateDirty(undefined,false);
        if(!dirty)status='Project saved';
        return !dirty;
      }catch(err){error=err.message;return false;}
    })().finally(()=>projectWrite=null);
    return projectWrite;
  }
  function saveScript(id,isRoom,isGame,data,isTile){
    if(isTile){status='Script saved';return;}
    if(isRoom){
      const background=data.events?.init?.findLast(row=>row.op==='set_room_background_image')?.image;
      if(background==null)delete roomBackgrounds[id];else roomBackgrounds[id]=background;
    }
    if(isGame){
      gameScript={declarations:data.declarations,constants:data.constants,collections:data.collections};
      const baseline=JSON.parse(savedProject);
      for(const key of ['flags','events','variables']){delete project[key];delete baseline[key];}
      project.gameScript??='scripts/game.cbor';
      baseline.gameScript=project.gameScript;
      savedProject=JSON.stringify(baseline);
      updateDirty(undefined,false);
      status='Script saved';
      return;
    }
    const collection=isRoom?'rooms':'sprites';
    if(!project[collection][id].script){
      const path=`scripts/${collection}/${id}.cbor`;
      project[collection][id].script=path;
      const baseline=JSON.parse(savedProject);
      if(baseline[collection][id])baseline[collection][id].script=path;
      savedProject=JSON.stringify(baseline);updateDirty(undefined,false);
    }
    status='Script saved';
  }
  async function rebuild(){
    busy=true;error='';
    try{
      await request('./api/rebuild','POST');
      const current=await request('./api/project');
      assets=current.assets; art=current.art; revision=current.revision;
      importNewTags();
      await updatePreviews(current.previewKey);
      status=dirty ? 'Unsaved project' : 'Assets rebuilt';
    }catch(err){error=err.message;}finally{busy=false;}
  }
  function dismissMenu(event){
    const menu=document.querySelector('.studio-menus details[open]');
    if(!menu)return;
    if(!menu.contains(event.target))menu.open=false;
    else if(event.target.closest('button,a')){
      menu.open=false;
      if(menu.contains(document.activeElement))menu.querySelector('summary').focus();
    }
  }
  function menuKeys(event){
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    const menu=event.target.closest?.('.studio-menus details');
    if(!menu || (!menu.open && !['ArrowDown','ArrowUp'].includes(event.key)))return;
    const actions=[...menu.querySelectorAll('button:not(:disabled),a[href]')];
    if(!actions.length)return;
    menu.open=true;
    const index=actions.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?actions.length-1:
      index<0?(event.key==='ArrowDown'?0:actions.length-1):
      (index+(event.key==='ArrowDown'?1:-1)+actions.length)%actions.length;
    event.preventDefault();
    actions[next].focus();
  }
  function saveShortcut(event){
    if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
    menuKeys(event);
    if(event.defaultPrevented)return;
    if(event.key==='Escape'){
      const menu=document.querySelector('.studio-menus details[open]');
      if(menu){menu.open=false;menu.querySelector('summary').focus();event.preventDefault();return;}
    }
    if(!(event.ctrlKey||event.metaKey) || !project || debugging || recovery)return;
    const key=event.key.toLowerCase();
    if(key==='s'){
      event.preventDefault();
      const field=document.activeElement;
      if(field?.matches('main input, main textarea, main select') && !field.closest('.workspace')) {
        field.blur();
        field.focus({preventScroll:true});
      }
      saveEdits();
    }else if(!event.target.closest?.('input,textarea,select,[contenteditable=true],.workspace') && ['z','y'].includes(key)){
      event.preventDefault();
      if(!scriptDirty && !busy)restoreEdit(key==='z'&&!event.shiftKey);
    }
  }
  async function playtest(event){
    event.preventDefault();
    if(busy)return;
    const url=new URL(event.currentTarget.href);
    url.searchParams.set('playtest','1');
    if(window.__GAMEWAFFLE_STUDIO__){
      if(!await finishScript() || dirty&&!await saveProject())return;
      url.pathname='/__playtest';
      location.assign(url);
      return;
    }
    const pending=new URL(url);
    if(dirty||scriptDirty)pending.searchParams.set('waiting','1');
    const player=window.open(pending,'GameWafflePlaytest','popup,width=960,height=640');
    if(!player){error='Allow Studio to open a playtest window.';return;}
    if(pending.searchParams.has('waiting')){
      if(!await finishScript() || !await saveProject()){player.close();return;}
      if(!player.closed)player.location.replace(url);
    }
    player.focus();
  }
  async function saveThenOpen(event){
    if(busy){event.preventDefault();return;}
    if(!dirty && !scriptDirty)return;
    event.preventDefault();
    const link=event.currentTarget;
    const href=link.href;
    const download=link.getAttribute('download');
    if(!await finishScript() || !await saveProject())return;
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
  function addRoom(){
    const title=newRoomName.trim();
    if(!title)return;
    const id=resourceName(title,'room',[project.rooms]);
    const topDown=newRoomView==='top_down';
    project.rooms[id]={title,cols:28,rows:15,view:newRoomView,
      layers:[
        {name:topDown?'Ground':'Background',order:0,collidable:false,cells:[]},
        {name:topDown?'Walls':'Terrain',order:2,collidable:true,cells:[]},
      ],entities:[]};
    roomOperation='';
    selectRoom(id);
    updateDirty('creation of '+title);
  }
  const tileSizeConflict=$derived(pendingTileSize!=null && (
    Object.values(project?.tiles??{}).some(tile=>art[tile.source]?.width!==pendingTileSize||art[tile.source]?.height!==pendingTileSize)
    || Object.values(project?.rooms??{}).some(room=>Math.max(room.cols,room.rows)*pendingTileSize>4096)
  ));
  function changeTileSize(){
    if(tileSizeConflict || !tileSizes.includes(pendingTileSize))return;
    const scale=pendingTileSize/(project.tileSize??24);
    for(const room of Object.values(project.rooms)){
      for(const entity of room.entities){entity.x*=scale;entity.y*=scale;}
    }
    project.tileSize=pendingTileSize;
    pendingTileSize=null;
    updateDirty('project tile size');
  }
  function groupTiles(tiles){
    const sets=Object.create(null);
    for(const [id,tile] of Object.entries(tiles))(sets[tile.source]??=[]).push(id);
    return sets;
  }
  function setName(path){return path.split('/').pop().replace(/\.[^.]+$/,'');}
  function assetCollection(){
    return createKind==='tile'?project.tiles:createKind==='sprite'?project.sprites:project.audio;
  }
  function selectSource(path,file=null){
    importFile=file;newSource=path;assetError='';
    if(!newId)newId=path.split('/').at(-1).replace(/\.[^.]+$/,'');
  }
  async function createAsset(){
    if(busy)return;
    const label=newId.trim();
    if(!newSource||!label||midiSource&&!newSoundFont)return;
    const kind=createKind;
    const id=resourceName(label,kind==='sprite'?'entity':kind==='tile'?'tiles':'sound',[assetCollection()??{}]);
    busy=true;assetError='';
    try{
      if(importFile){
        const response=await fetch('./api/import?name='+encodeURIComponent(importFile.name)+'&kind='+kind,{method:'POST',body:importFile});
        const result=await response.json();
        if(!response.ok)throw Error(result.error);
        recordFile(result.edit);newSource=result.path;importFile=null;
        const current=await request('./api/project');assets=current.assets;art=current.art;
      }
      if(midiSource&&soundFontFile){
        const response=await fetch('./api/import?name='+encodeURIComponent(soundFontFile.name)+'&kind=audio',{method:'POST',body:soundFontFile});
        const result=await response.json();
        if(!response.ok)throw Error(result.error);
        recordFile(result.edit);newSoundFont=result.path;soundFontFile=null;
        assets=(await request('./api/project')).assets;
      }
      if(art[newSource]?.error)throw Error(art[newSource].error);
      if(kind==='tile'){
        const source=art[newSource],size=project.tileSize??24;
        if(source?.width!==size||source?.height!==size)throw Error(`Tile art must be ${size}×${size} pixels.`);
        tileId=addTags(newSource,id).first;
      }else if(kind==='audio'){
        (project.audio??={})[id]={source:newSource,title:label,...(midiSource?{soundFont:newSoundFont}:{})};
      }else{
        (project.sprites??={})[id]={source:newSource,title:label,physics:{},gravityMode:'room'};
        await selectSprite(id);
      }
      mark('creation of '+label);
      if(kind==='tile')await updatePreviews();
      addForm=false;
      openAssets(kind);
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
    project.audio[id]=typeof item==='string'?{source:item,compress:enabled}:{...item,compress:enabled};
    mark();
  }
  function set(target,key,value){
    if(value===''||value===undefined)delete target[key];else target[key]=value;
    mark();
  }
</script>

<svelte:window onkeydown={saveShortcut} onclick={dismissMenu} onmessage={handlePlaytestMessage} />

<header class="appbar">
  <div class="brand">
    <img src={productIcon} width="32" height="32" alt="">
    <div><h1>GameWaffle Studio</h1><small>{project?.name ?? 'Sprite game editor'}</small></div>
  </div>
  <div class="row actions">

    <span class="status" role="status" title={scriptStatus||status}>{scriptStatus||status}</span>
    <a class="button primary" href="./player.html?playtest=1" onclick={playtest}><Play size={14}/>Play game</a>
  </div>
</header>
<nav class="studio-menus" aria-label="Application menu">
    <details bind:this={fileMenu} name="studio-menu" class="export-menu"><summary>File</summary><div class="card">
        <a href="./projects?action=manager" onclick={saveThenOpen}>Project Manager</a>
        <a href="./projects?action=new" onclick={saveThenOpen}>New project…</a>
        <a href="./projects?action=open" onclick={saveThenOpen}>Open project…</a>
        <button onclick={saveEdits} disabled={(!dirty&&!scriptDirty)||busy||debugging||!!recovery} aria-keyshortcuts="Control+S Meta+S">Save</button>
        <button onclick={openExport} disabled={!project||busy||debugging||!!recovery}>Export…</button>
      </div>
    </details>
    <details name="studio-menu" class="export-menu"><summary>Edit</summary><div class="card">
      <button disabled={scriptDirty||!historyStatus.undo} onclick={()=>restoreEdit(true)}>{historyStatus.undo?'Undo '+historyStatus.undo:'Undo'}</button>
      <button disabled={scriptDirty||!historyStatus.redo} onclick={()=>restoreEdit(false)}>{historyStatus.redo?'Redo '+historyStatus.redo:'Redo'}</button>
    </div></details>
    <details name="studio-menu" class="export-menu"><summary>Tools</summary><div class="card">
      <button onclick={()=>{gameSection='Controls';openTab('game');}}>Input map</button>
      <button onclick={debugRoom} disabled={busy||!project}>Debug room</button>
      <button onclick={rebuild} disabled={busy||!project}>Rebuild assets</button>
        <button onclick={()=>{updatesOpen=!updatesOpen;if(updatesOpen)checkReleases();}}>Updates</button>
    </div></details>
</nav>
<ExportDialog bind:this={exportDialog} basename={exportName} localization={project?.localization} onSave={saveEdits} onClose={()=>fileMenu.querySelector('summary').focus()}/>
{#if nameDialog}
  {@const kind=nameDialog.kind}
  {@const label=kind[0].toUpperCase()+kind.slice(1)}
  <Modal title={'New '+label} onClose={()=>nameDialog=null}>
    <form onsubmit={event=>{event.preventDefault();submitName();}}>
      <label>{label} name<input bind:value={newName} required maxlength="100"></label>
      <div class="dialog-actions"><button type="button" onclick={()=>nameDialog=null}>Cancel</button>
        <button class="primary" disabled={!newName.trim()}>Create {kind}</button></div>
    </form>
  </Modal>
{/if}
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
  <div class="mobile-tabs"><Sections labels={hasInspector?['Editor','Project','Settings']:['Editor','Project']} bind:value={mobilePane}/></div>
  <main class:coding={tab==='blocks'} class:wide={tab==='game'||tab==='world'||(tab==='assets'&&['audio','source'].includes(assetKind))} data-pane={mobilePane}>
    <aside class="project card">
      <div class="heading row"><h2>Project</h2></div>
      <small class="project-path">{projectPath}</small>
      <label class="project-filter"><Search size={14}/><input type="search" aria-label="Find rooms, sprites, and tiles" placeholder="Find…" bind:value={filter}></label>
      <div class="category">
        <div class="heading row"><h3>Rooms</h3><button class="small-button icon-button" title="New room" aria-label="New room" disabled={busy}
          onclick={()=>{newRoomName='';newRoomView='platformer';roomOperation='create';}}><Plus size={14}/></button></div>
        <PagedList items={Object.entries(project.rooms)} label="rooms" query={filter} text={entry=>entry[0]+' '+(entry[1].title??'')}>{#snippet children([id,item])}
          <button class="item" class:selected={tab==='blocks'?activeRoomCode&&codeRoomId===id:roomId===id}
            aria-pressed={tab==='blocks'?activeRoomCode&&codeRoomId===id:roomId===id} onclick={()=>selectRoom(id,'sidebar')}>
            <RoomIcon size={14}/><span>{item.title??id}</span>
          </button>
        {/snippet}</PagedList>
      </div>
      <div class="category">
        <div class="heading row"><h3>Entities</h3><button class="small-button icon-button" title="Create entity" aria-label="Create entity" onclick={()=>openAssets('sprite',true)}><Plus size={14}/></button></div>
        <PagedList items={Object.keys(project.sprites??{})} label="entities" query={filter} text={id=>project.sprites[id].title??id}>{#snippet children(id)}
          <div class="actor-entry"><button class="item" class:selected={tab==='room' ? mapTool==='spawn' && placementSprite===id : spriteId===id && (tab==='actors'||(tab==='blocks'&&!activeRoomCode))}
            aria-pressed={tab==='blocks'?!activeRoomCode&&spriteId===id:undefined}
            draggable={tab==='room' && ['spawn','select'].includes(mapTool)} ondragstart={event=>dragDefinition(event,id)}
            title={tab==='room' ? 'Choose entity for placement' : 'Select entity'}
            onclick={()=>chooseDefinition(id)}>
            {#if spriteArt[id]}<img src={spriteArt[id]} alt="" draggable="false">{:else}<SquareUserRound size={14}/>{/if}<span>{project.sprites[id].title??id}</span>
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
        {#each tabs as [id,title]}{@const Icon=viewIcons[id]}<button class:active={tab===id} aria-current={tab===id?'page':undefined} onclick={()=>openTab(id)}><Icon size={15}/>{title}</button>{/each}
      </nav>
      <div class="author-panes" hidden={!authoringView}>
        <section tabindex="-1" class="map-pane" aria-label="Room editor">
        {#if tab==='blocks'}
          <div class="stage-tools row">
            <SearchSelect label="Stage room" value={roomId} options={Object.entries(project.rooms).map(([value,room])=>({value,label:room.title??value}))}
              onChange={value=>selectRoom(value,'stage')}/>
            <div class="row">
              {#if inlinePlaytest}<button onclick={stopInlinePlaytest}>Stop</button>
              {:else}<button onclick={()=>openTab('room')}>Edit room</button>
                <button class="primary" disabled={busy || !room} onclick={startInlinePlaytest}><Play size={14}/> Play here</button>
              {/if}
            </div>
          </div>
        {/if}
        {#if tab==='blocks' && inlinePlaytest}
          <iframe bind:this={playtestFrame} class="inline-playtest" title="Game playtest" src={'./player.html?playtest=1&inline=1&room='+encodeURIComponent(roomId)}></iframe>
        {:else if room}
        {#key roomId}
          <RoomMap {room} {roomId} {projectPath} size={project.tileSize??24} tiles={project.tiles??{}} sprites={project.sprites??{}}
            {tileArt} {spriteArt} {previewModes} {previewImage} backgroundUrl={roomBackground?'./api/room-art?path='+encodeURIComponent(roomBackground)+'&revision='+(art[roomBackground]?.revision??''):undefined} {layerIndex} bind:selectedEntity bind:tileId bind:spriteId={placementSprite} bind:tool={mapTool} bind:placeAs {busy}
            undoLabel={historyStatus.undo} redoLabel={historyStatus.redo}
            onUndo={()=>restoreEdit(true)} onRedo={()=>restoreEdit(false)} onEdit={replaceRoom}
            onLayer={chooseLayer} onSprites={inspect=>{roomPanel='instances';if(inspect)mobilePane='Settings';if(actor)selectSprite(actor.sprite);}} onAssets={()=>openAssets('tile')}
            onPlay={playtest} previewOnly={tab==='blocks'} />
        {/key}
        {/if}
        {#if tab==='blocks'}
          <section class="stage-actors card" aria-label="Entities on the stage">
            <div class="heading row"><h2>Entities</h2><button class="small-button icon-button" aria-label="Create entity" title="Create entity" onclick={()=>openAssets('sprite',true)}><Plus size={14}/></button></div>
            {#if Object.keys(project.sprites??{}).length>8}
              <input type="search" bind:value={stageFilter} aria-label="Find an entity type" placeholder="Find an entity type…">
            {/if}
            <div class="stage-actor-list">
              <PagedList items={Object.keys(project.sprites??{})} label="entities" size={8} query={stageFilter}>{#snippet children(id)}
                <button aria-pressed={!activeRoomCode&&spriteId===id} onclick={()=>selectSprite(id)}>
                  {#if spriteArt[id]}<img src={spriteArt[id]} alt="" draggable="false">{:else}<SquareUserRound size={18}/>{/if}
                  <span>{id}</span>
                </button>
              {/snippet}</PagedList>
            </div>
          </section>
        {/if}
        </section>
        <section tabindex="-1" class="code-pane" hidden={tab!=='blocks'} aria-label={gameCode?'Game code':activeTileCode?'Tile code':activeRoomCode?'Room code':'Entity code'}>
        {#if gameCode||activeTileCode||activeRoomCode||spriteId}
          {#key (gameCode?'game':activeTileCode?'tile:'+codeTile+':'+codeVariant:activeRoomCode?'room:'+codeRoomId:'entity:'+spriteId)+':'+scriptVersion}<ScriptPanel bind:this={scriptPanel} isRoom={activeRoomCode} isGame={gameCode} isTile={activeTileCode} variant={codeVariant}
            title={gameCode?'Game script':activeTileCode?(tileScripts.find(tile=>tile.id===codeTile&&tile.variant===codeVariant)?.title??codeTile):activeRoomCode?(codeRoom.title??codeRoomId)+' · Room script':sprite?.title??spriteId}
            {roomScripts} {entityScripts} {tileScripts} onSelectFile={selectScriptFile} bind:mode={scriptMode}
            actorDefinition={gameCode||activeTileCode||activeRoomCode?null:sprite} newActor={!gameCode&&!activeTileCode&&!Object.hasOwn(JSON.parse(savedProject)[activeRoomCode?'rooms':'sprites']??{},activeRoomCode?codeRoomId:spriteId)} onBeforeSave={async()=>!dirty||await saveProject()} onFileEdit={recordFile} onNewEvent={newEvent} onNewField={newScriptField}
            hasLegacyMovement={Object.values(project.rooms).some(room=>room.entities.some(entity=>entity.sprite===spriteId&&entity.standardMovement))}
            initialMovement={roomView} onMovementPreset={({dynamic,replaceLegacy})=>{
              if(dynamic)(sprite.physics??={}).mode='dynamic';
              if(replaceLegacy)for(const map of Object.values(project.rooms)){
                for(const entity of map.entities)if(entity.sprite===spriteId)delete entity.standardMovement;
              }
              updateDirty('movement settings for '+(sprite.title??spriteId));
            }} sprite={gameCode?'game':activeTileCode?codeTile:activeRoomCode?codeRoomId:spriteId} sprites={Object.keys(project.sprites??{})} animations={[...new Set(['default',...(art[sprite?.source]?.tags??[])])]} items={Object.keys(project.items??{})} {textKeys} menus={Object.keys(project.menus??{})} references={activeRoomCode?{...blockReferences,names:instanceNames(codeRoom.entities??[])}:blockReferences} actions={[...buttons,...Object.keys(project.controls??{})]} bind:dirty={scriptDirty} bind:status={scriptStatus} onSave={saveScript} />{/key}
        {:else}<p class="empty card">Create an entity to edit its script.</p>{/if}
        </section>
      </div>
      {#if !authoringView}<section class="aux-pane" aria-label="Project tools">
      {#if tab==='world' && room}
        <World rooms={project.rooms} flags={Object.keys(gameFlags)} {roomId} onSelect={id=>selectRoom(id,'stage')} onEdit={(changes,label)=>{Object.assign(project.rooms,changes);updateDirty(label);}}/>
      {:else if tab==='game'}
        <section class="card asseteditor">
          <h2>Game</h2>
          <Sections labels={['Game script','Room defaults','Controls','Text','Menus','Bitfonts','Project assets']} bind:value={gameSection}/>
          {#if gameSection==='Game script'}
            <button class="primary" onclick={openGameScript}><Blocks size={15}/>Open Game script</button>
          {:else if gameSection==='Controls'}
            <InputMap controls={project.controls??{}} onChange={controls=>set(project,'controls',controls)}/>
          {:else if gameSection==='Menus'}
            <GameMenus menus={project.menus??{}} entries={textEntries} onChange={value=>set(project,'menus',value)}/>
          {:else if gameSection==='Bitfonts'}
            <Bitfonts fonts={project.bitfonts??{}} active={project.activeBitfont??(project.font?'legacy':'builtin')}
              legacy={project.font} sources={assets} onImport={data=>{recordFile(data.edit,'font source import');if(!assets.includes(data.path))assets=[...assets,data.path].sort();}}
              onSelect={value=>set(project,'activeBitfont',value)}
              onSave={(id,config,activate)=>{
                (project.bitfonts??={})[id]=config;
                if(activate)project.activeBitfont=id;
                updateDirty('bitfont settings');
              }}/>
          {:else if gameSection==='Text'}
            <Localization value={project.localization} onChange={value=>set(project,'localization',value)}/>
          {:else if gameSection==='Room defaults'}
            {@const defaults=project.roomDefaults??{}}
            <p class="muted">New rooms copy these values into their On init script.</p>
            <div class="field-row">
              <label class="stack">Camera zoom (×)<input type="number" min="0.25" max="4" step="any" value={defaults.cameraZoom??1}
                onchange={e=>{const input=e.currentTarget;if(input.validity.valid&&Number.isFinite(input.valueAsNumber))set(project,'roomDefaults',{...defaults,cameraZoom:input.valueAsNumber});}}></label>
              <label class="stack">Platformer gravity<input type="number" min="-100" max="100" step="any" value={defaults.gravity??platformGravity}
                onchange={e=>{const input=e.currentTarget;if(input.validity.valid&&Number.isFinite(input.valueAsNumber))set(project,'roomDefaults',{...defaults,gravity:input.valueAsNumber});}}></label>
              <label class="stack">Camera bottom inset (tiles)<input type="number" min="0" max="1023" step="1" value={defaults.cameraBottomInset??0}
                onchange={e=>{const input=e.currentTarget;if(input.validity.valid&&Number.isInteger(input.valueAsNumber))set(project,'roomDefaults',{...defaults,cameraBottomInset:input.valueAsNumber});}}></label>
              <label class="stack">Room borders<select value={defaults.border??''}
                onchange={e=>set(project,'roomDefaults',{...defaults,border:e.currentTarget.value||undefined})}>
                <option value="">By room view</option><option value="sides">Side walls</option><option value="closed">All four walls</option><option value="open">Open</option>
              </select></label>
              <label class="stack">Background color<input type="color" value={defaults.background??'#101a23'}
                onchange={e=>set(project,'roomDefaults',{...defaults,background:e.currentTarget.value})}></label>
              <SearchSelect label="Shader" value={defaults.shader?.kind??'none'}
                options={[{value:'none',label:'None'},...Object.entries(roomShaders).map(([value,label])=>({value,label}))]}
                onChange={value=>set(project,'roomDefaults',{...defaults,shader:{kind:value}})}/>
            </div>
            <SearchSelect label="Background image" value={defaults.backgroundImage??''}
              options={[{value:'',label:'None'},...artFiles.filter(file=>!art[file]?.error).map(value=>({value,label:value.split('/').at(-1)}))]}
              onChange={value=>set(project,'roomDefaults',{...defaults,backgroundImage:value})}/>
            {#each [['music','Music'],['ambience','Ambient sound']] as [key,label]}
              <SearchSelect {label} value={defaults[key]??''}
                options={[{value:'',label:'None'},...Object.keys(project.audio??{}).map(value=>({value,label:value}))]}
                onChange={value=>set(project,'roomDefaults',{...defaults,[key]:value})}/>
            {/each}
          {:else if gameSection==='Project assets'}
            <div class="stack cover-setting">
              <span>Cartridge cover art</span>
              <div class="row">
                {#if project.coverImage}<img class="cover-preview" src={'./api/room-art?path='+encodeURIComponent(project.coverImage)} alt="Cartridge cover art">{/if}
                <button disabled={busy||importingCover} onclick={()=>coverPicker.click()}>Choose cover image…</button>
                {#if project.coverImage}<button disabled={busy||importingCover} onclick={()=>set(project,'coverImage','')}>Remove cover</button>{/if}
                <input hidden type="file" aria-label="Cartridge cover image file" accept=".png,.jpg,.jpeg,.webp,.ase,.aseprite"
                  bind:this={coverPicker} onchange={event=>importCover(event.currentTarget)}>
              </div>
            </div>
            <div class="row"><span>Project tile size</span><strong>{project.tileSize??24} × {project.tileSize??24} px</strong>
              <button onclick={()=>pendingTileSize=project.tileSize??24}>Change…</button>
            </div>
            <div class="field-row">
              <label>Collision layer<select bind:value={collisionLayer}>
                {#each collisionLayers as label,index}<option value={index}>{label}</option>{/each}
              </select></label>
              <label>Layer name<input value={collisionLayers[collisionLayer]} maxlength="45"
                onchange={event=>set(project.collisionLayers??={},collisionLayer,event.currentTarget.value.trim())}></label>
            </div>
          {/if}
        </section>
      {:else if tab==='actors'||tab==='assets'}
        <section class="card asseteditor">
          <div class="row heading">
            <h2>{tab==='actors'?'Entities':'Assets'}</h2>
            {#if tab==='assets'}<div class="row">
              {#each [['source','Source files'],['tile','Tiles'],['audio','Sounds']] as [id,label]}
                <button class:selected={assetKind===id} aria-pressed={assetKind===id} onclick={()=>openAssets(id)}>{label}</button>
              {/each}
            </div>{/if}
          </div>
          {#if assetKind==='source'}
            <div class="field-row"><label>Find source files<input type="search" bind:value={sourceFilter}></label>
              <button onclick={()=>sourcePicker.click()}>Import file…</button>
              <input hidden type="file" bind:this={sourcePicker} accept=".ase,.aseprite,.png,.wav,.qoa,.ogg,.oga,.opus,.mid,.midi,.sf2" onchange={async e=>{
                const input=e.currentTarget,file=input.files[0];if(!file)return;
                try{const r=await fetch('./api/import?name='+encodeURIComponent(file.name),{method:'POST',body:file});const result=await r.json();if(!r.ok)throw Error(result.error);recordFile(result.edit);await checkAssets();}
                catch(err){error=err.message;}finally{input.value='';}
              }}></div>
            <PagedList items={assets} query={sourceFilter} label="source files">{#snippet children(file)}<p>{file}</p>{/snippet}</PagedList>
          {:else}
          <div class="row asset-bar">
            <h3>{assetKind==='audio'?'Sounds':assetKind==='tile'?'Tiles':'Entities'}</h3>
            <button onclick={()=>openAssets(assetKind,true)}><Plus size={16}/>New {assetLabel}…</button>
          </div>
          {#if assetKind==='tile'&&tileId&&tileArt[tileId]?.length}
            {@const variant=Math.min(Number(editTileVariant),tileArt[tileId].length-1)}
            <div class="row">
              <SearchSelect label="Tile script variant" value={String(variant)}
                options={tileArt[tileId].map((_,index)=>({value:String(index),label:'Variant '+(index+1)}))}
                onChange={value=>editTileVariant=value}/>
              <button onclick={()=>openTileScript(tileId,variant)}>Edit tile script</button>
            </div>
          {/if}
          {#if assetKind==='audio'}
            {#each Object.entries(project.audio??{}) as [id,file]}
              {@const source=typeof file==='string'?file:file.source}
              <div class="audio-line row"><strong>{file.title??id}</strong> <small>{source}</small>
                {#if file.soundFont}<small>{file.soundFont.split('/').at(-1)}</small>{/if}
                {#if /\.wav$/i.test(source)}<label class="check"><input type="checkbox" checked={typeof file==='string'||file.compress!==false}
                  onchange={e=>toggleCompression(id,e.currentTarget.checked)}> QOA</label>{/if}
              </div>
            {:else}<p class="muted">Add an audio file to use it in the game.</p>{/each}
          {:else}
            {#if assetKind==='sprite'}
              <div class="field-row"><label>Entity type<select value={spriteId} onchange={e=>selectSprite(e.currentTarget.value)}>{#each Object.keys(project.sprites??{}) as id}<option value={id}>{id}</option>{/each}</select></label>
                {#if spriteId}<button onclick={()=>openDefinition(spriteId,'blocks')}><Blocks size={15}/>Open script</button>{/if}</div>
            {:else}
              <label class="stack">Tile set<select value={tile?.source??''} onchange={e=>tileId=tileSets[e.currentTarget.value][0]}>{#each Object.keys(tileSets) as path}<option value={path}>{setName(path)}</option>{/each}</select></label>
              <label class="stack">Tile<select bind:value={tileId} aria-label="Tile definition">{#each tileSets[tile?.source]??[] as id}<option value={id}>{project.tiles[id].tag??id}</option>{/each}</select></label>
            {/if}
            {#if inspector}
              {#if assetKind==='tile'}
              <label class="stack">Active flag<select value={inspector.flag??''} onchange={e=>set(inspector,'flag',e.currentTarget.value)}>
                <option value="">Always active</option>{#each Object.keys(gameFlags) as flag}<option>{flag}</option>{/each}
              </select></label>
              {#if inspector.flag}<label class="check"><input type="checkbox" checked={inspector.when??true} onchange={e=>set(inspector,'when',e.currentTarget.checked)}> Flag must be on</label>{/if}
              {/if}
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
                <SearchSelect label="Spawn when flag" value={sprite.flag??''}
                  options={[{value:'',label:'Always'},...blockReferences.flags.map(value=>({value,label:value}))]}
                  onChange={value=>set(sprite,'flag',value)}/>
                {#if sprite.flag}<label class="check"><input type="checkbox" checked={sprite.when??true}
                  onchange={e=>set(sprite,'when',e.currentTarget.checked)}> Flag must be on</label>{/if}
                <label class="check"><input type="checkbox" checked={sprite.rememberState??false}
                  onchange={e=>set(sprite,'rememberState',e.currentTarget.checked)}> Remember state between room visits</label>
                <label class="check"><input type="checkbox" checked={sprite.alwaysActive??false}
                  onchange={e=>set(sprite,'alwaysActive',e.currentTarget.checked)}> Run scripts off camera</label>
                <ComponentPicker components={componentLabels} selected={sprite.components??[]} onCreate={createComponent} onChange={value=>set(sprite,'components',value)}/>
              {/if}
            {/if}
          {/if}
          {/if}
        </section>
      {/if}
      </section>{/if}
    </div>
    {#if hasInspector}<aside class="inspector card">
      {#if tab==='room' && room}
        <div class="panel-tabs row">
          {#each [['layers','Layers'],['room','Room'],['instances','Instances']] as [id,label]}
            <button class:selected={roomPanel===id} aria-pressed={roomPanel===id} onclick={()=>roomPanel=id}>{label}</button>
          {/each}
        </div>
        {#if roomPanel==='room'}
          <button class="small-button" onclick={openRoomScript}>Open room script</button>
          <div class="row start-room">
            {#if (project.start??Object.keys(project.rooms)[0])===roomId}<small>Starting room</small>
            {:else}<button class="small-button" onclick={()=>set(project,'start',roomId)}>Set as starting room</button>{/if}
          </div>
          <label class="stack">Room name <input value={room.title??roomId} onchange={e=>setRoom('title',e.currentTarget.value)}></label>
          <label class="stack">Room view <select aria-label="Room view" value={roomView} onchange={e=>setView(e.currentTarget.value)}>
            <option value="platformer">Platformer</option><option value="top_down">Top-down</option>
          </select></label>
          <div class="row"><span>{room.cols} × {room.rows} tiles</span><button onclick={openResize}>Resize room…</button></div>
          <div class="stack asset-source">
            <SearchSelect label="Background image" value={roomBackground??''} disabled={busy||importingBackground}
              options={[{value:'',label:'None'},...artFiles.filter(file=>!art[file]?.error).map(value=>({value,label:value.split('/').at(-1)}))]}
              onChange={async value=>{try{await setRoomBackground(roomId,value);}catch(err){error=err.message;}}}/>
            <button aria-label="Browse for background image" disabled={busy||importingBackground}
              onclick={()=>backgroundPicker.click()}>Browse…</button>
            <input hidden type="file" aria-label="Background image file" bind:this={backgroundPicker} accept=".png,.ase,.aseprite"
              onchange={e=>importBackground(e.currentTarget)}>
          </div>
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
              <option value="">Always active</option>{#each Object.keys(gameFlags) as flag}<option>{flag}</option>{/each}
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
            {#if room.layers.length>1}<button class="small-button remove" onclick={()=>{if(layer.cells.length)roomOperation='removeLayer';else removeLayer();}}>Remove layer</button>{/if}
          {/if}
        {:else}
          <div class="heading row mini">
            <h3>Room instances</h3>
          </div>
          {#if !room.entities.length}<p class="muted">Choose an entity type to place an instance.</p>{/if}
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
              <small>Entity type: {actor.sprite}</small>
              <button class="small-button" onclick={()=>openDefinition(actor.sprite)}>Open entity</button>
              <button class="small-button" onclick={()=>openDefinition(actor.sprite,'blocks')}>Open script</button>
            </div>
            <label class="stack">Controlled by <select aria-label="Controlled by" value={actor.player==null ? '' : String(actor.player)} onchange={e=>changeActor('player',e.currentTarget.value)}>
              <option value="">No player</option>{#each [0,1,2,3] as player}<option disabled={room.entities.some((entry,index)=>index!==selectedEntity&&entry.player===player)} value={String(player)}>Player {player+1}</option>{/each}
            </select></label>
            {#if actor.standardMovement}<button onclick={()=>changeActor('standardMovement',false)}>Disable legacy movement</button>{/if}
            <Sections labels={['Placement','Lifecycle','Overrides']} bind:value={instanceSection}/>
            {#if instanceSection==='Placement'}<label class="stack">Instance name <input maxlength="64" value={actor.name} onchange={e=>changeActor('name',e.currentTarget.value)}></label>
            <div class="pair">
              <label class="stack">X position <input type="number" min="0" value={actor.x} onchange={e=>changeActor('x',e.currentTarget.valueAsNumber)}></label>
              <label class="stack">Y position <input type="number" min="0" value={actor.y} onchange={e=>changeActor('y',e.currentTarget.valueAsNumber)}></label>
            </div>

            {:else if instanceSection==='Lifecycle'}
              <RespawnSettings rule={actor.respawn} flags={blockReferences.flags} inherit inheritedRule={definition?.respawn}
                onChange={value=>changeActor('respawn',value??'')}/>
              <label class="stack">State between room visits<select value={actor.rememberState==null?(actor.persistRemoval?'legacy':''):String(actor.rememberState)}
                onchange={event=>{const value=event.currentTarget.value;editRoom(next=>{
                  const instance=next.entities[selectedEntity];
                  delete instance.persistRemoval;
                  if(value==='')delete instance.rememberState;
                  else instance.rememberState=value==='true';
                },'state policy for '+actor.name);}}>
                {#if actor.persistRemoval}<option value="legacy" disabled>Legacy: remember state and removal</option>{/if}
                <option value="">Entity default ({definition?.rememberState?'remember':'reset'})</option>
                <option value="true">Remember state</option><option value="false">Reset state</option>
              </select></label>
              <SearchSelect label="Additional spawn flag" value={actor.flag??''}
                options={[{value:'',label:'Use entity defaults'},...blockReferences.flags.map(value=>({value,label:value}))]}
                onChange={value=>changeActor('flag',value)}/>
              {#if actor.flag}<label class="check"><input type="checkbox" checked={actor.when??true}
                onchange={e=>changeActor('when',e.currentTarget.checked)}> Flag must be on</label>{/if}
              <ComponentPicker components={componentLabels} selected={actor.components??[]} inherited={definition?.components??[]}
                onCreate={createComponent} onChange={value=>changeActor('components',value)}/>
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
              <label class="check"><input type="checkbox" checked={actor.flipX??false} onchange={e=>changeActor('flipX',e.currentTarget.checked || '')}> Face left at start</label>
            {/if}
            <button class="small-button remove" onclick={()=>{editRoom(next=>next.entities.splice(selectedEntity,1));selectedEntity=-1;}}>Remove instance</button>
          {/if}
        {/if}
      {:else}
        {@const target=tab==='blocks' ? sprite : inspector}
        <div class="heading row"><h2>Physics settings</h2></div>
        {#if target}
          <p class="asset-name">{tab==='blocks'||assetKind==='sprite' ? spriteId : tileId}</p>
          <Physics physics={target.physics} {collisionLayers} entity={assetKind==='sprite'?target:null} art={art[target.source]}
            onEntityChange={(key,value)=>set(target,key,value)} fallback={tab==='assets' && assetKind==='tile'
            ? (tile.tag??art[tile.source]?.tags?.[0]??'').includes(':fluid:') ? 'fluid' : 'static'
            : 'none'} onChange={value=>set(target,'physics',value)} />
        {/if}

      {/if}
    </aside>{/if}
  </main>
  {#if addForm}
    <Modal title={'New '+createLabel} {busy} onClose={()=>addForm=false}>
      <form onsubmit={event=>{event.preventDefault();createAsset();}}>
        <label>Name<input bind:value={newId} required maxlength="100" disabled={busy}></label>
        <div class="row asset-source">
          <SearchSelect label="Source file" value={newSource}
            options={[...new Set([...(importFile?[importFile.name]:[]),...sources])].map(value=>({value,label:value.split('/').at(-1)}))}
            onChange={value=>{if(value!==importFile?.name)selectSource(value);}} disabled={busy}/>
          <button type="button" disabled={busy} onclick={()=>filePicker.click()}>Browse device…</button>
          <input hidden type="file" bind:this={filePicker} accept={createKind==='audio'?'.wav,.qoa,.ogg,.oga,.opus,.mid,.midi':'.ase,.aseprite,.png'}
            onchange={event=>{const file=event.currentTarget.files[0];if(file)selectSource(file.name,file);event.currentTarget.value='';}}>
        </div>
        {#if midiSource}
          <div class="row asset-source">
            <SearchSelect label="SoundFont" value={newSoundFont}
              options={[...new Set([...(soundFontFile?[soundFontFile.name]:[]),...soundFonts])].map(value=>({value,label:value.split('/').at(-1)}))}
              onChange={value=>{if(value!==soundFontFile?.name){newSoundFont=value;soundFontFile=null;}}} disabled={busy}/>
            <button type="button" disabled={busy} onclick={()=>soundFontPicker.click()}>Browse SoundFonts…</button>
            <input hidden type="file" accept=".sf2" bind:this={soundFontPicker}
              onchange={event=>{const file=event.currentTarget.files[0];if(file){soundFontFile=file;newSoundFont=file.name;}event.currentTarget.value='';}}>
          </div>
        {/if}
        {#if assetError}<p class="error" role="alert">{assetError}</p>{/if}
        <div class="dialog-actions">
          <button type="button" disabled={busy} onclick={()=>addForm=false}>Cancel</button>
          <button class="primary" disabled={busy||!newSource||midiSource&&!newSoundFont}>{busy?'Creating…':'Create'}</button>
        </div>
      </form>
    </Modal>
  {/if}
  {#if roomOperation==='create'}
    <Modal title="New Room" onClose={()=>roomOperation=''}>
      <form onsubmit={event=>{event.preventDefault();addRoom();}}>
        <label>Room name<input bind:value={newRoomName} maxlength="100" required></label>
        <label>Room view<select bind:value={newRoomView}><option value="platformer">Platformer</option><option value="top_down">Top-down</option></select></label>
        <div class="dialog-actions"><button type="button" onclick={()=>roomOperation=''}>Cancel</button><button class="primary">Create room</button></div>
      </form>
    </Modal>
  {:else if roomOperation==='resize'}
    <Modal title="Resize Room" onClose={()=>{roomOperation='';dimensions=null;}}>
      <form onsubmit={event=>{event.preventDefault();cropRoom();}}>
        <div class="pair">
          <label>Columns<input type="number" min="1" max={maxTiles} required bind:value={dimensions.cols}></label>
          <label>Rows<input type="number" min="1" max={maxTiles} required bind:value={dimensions.rows}></label>
        </div>
        {#if crops.tiles||crops.entities}
          <p role="status">Resizing will remove {crops.tiles} {crops.tiles===1?'tile':'tiles'} and {crops.entities} {crops.entities===1?'entity':'entities'} outside the new bounds.</p>
        {/if}
        <div class="dialog-actions"><button type="button" onclick={()=>{roomOperation='';dimensions=null;}}>Cancel</button>
          <button class="primary">{crops.tiles||crops.entities?'Resize and crop':'Resize'}</button></div>
      </form>
    </Modal>
  {:else if roomOperation==='removeLayer'}
    <Modal title="Remove Layer" onClose={()=>roomOperation=''}>
      <p>Remove “{layer.name}” and its {layer.cells.length} painted {layer.cells.length===1?'tile':'tiles'}?</p>
      <div class="dialog-actions"><button onclick={()=>roomOperation=''}>Cancel</button><button class="primary" onclick={removeLayer}>Remove layer</button></div>
    </Modal>
  {/if}
  {#if pendingTileSize!=null}
    <Modal title="Project Tile Size" onClose={()=>pendingTileSize=null}>
      <form onsubmit={event=>{event.preventDefault();changeTileSize();}}>
        <label>Tile size<select bind:value={pendingTileSize}>
          {#each tileSizes as size}<option value={size}>{size} × {size} px</option>{/each}
        </select></label>
        {#if tileSizeConflict}
          <p role="status">The new size must match your registered tile art and keep every room within 4096 pixels per side.</p>
        {:else}
          <p>Changing the grid resizes all rooms and scales instance positions to match.</p>
        {/if}
        <div class="dialog-actions"><button type="button" onclick={()=>pendingTileSize=null}>Cancel</button>
          <button class="primary" disabled={tileSizeConflict||pendingTileSize===(project.tileSize??24)}>Apply</button></div>
      </form>
    </Modal>
  {/if}
{/if}
<style>
  .actor-entry{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center}.script-link{color:var(--accent);background:transparent}
  .update-panel{display:grid;gap:.45rem;padding:.55rem .75rem}.update-panel strong{min-width:8rem}
  .project-path{display:block;overflow-wrap:anywhere;font-size:.69rem;margin-bottom:.4rem}.project-filter{display:flex;align-items:center;gap:.3rem}.project-filter input{min-width:0}.actions{flex:1;}
  .actions{min-width:0;flex-wrap:nowrap}.actions .status{flex:1;text-align:end;margin-left:auto;}
  .appbar{display:flex;justify-content:space-between;align-items:center;gap:1rem;border-bottom:1px solid var(--line);padding:.4rem .65rem;}
  .status{font-size:.76rem;color:var(--muted);margin-right:.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
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
  .layer-actions,.remove{margin-top:.55rem;}
  .inspector{max-height:calc(100dvh - 5.6rem);overflow:auto;}
  .stack{display:grid;gap:.23rem;color:var(--muted);font-size:.75rem;margin-top:.45rem;}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:0 .46rem;}
  .mini{margin-top:.75rem;margin-bottom:.26rem;}
  .check{display:flex;align-items:center;gap:.3rem;font-size:.75rem;color:var(--muted);margin-top:.4rem;}
  .asseteditor,.empty{padding:.8rem;}
  .asseteditor .stack{max-width:34rem;}
  .asseteditor h3{margin-top:1rem;margin-bottom:.38rem;}
  .asseteditor p{font-size:.78rem;margin-top:.45rem;}
  .audio-line{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-top:.32rem;font-size:.78rem;}
  .start-room{margin-bottom:.15rem;}
  .asset-name{font-size:.85rem;color:var(--accent);margin-bottom:.6rem;}
  .asset-source{align-items:end;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.45rem;}
  .cover-setting{margin-bottom:.65rem}
  .cover-preview{width:4rem;height:4rem;object-fit:contain;background:var(--well);border:1px solid var(--line)}
  .asset-bar{justify-content:space-between;margin-top:.65rem;}
  .instance-list{display:grid;gap:1px;}
  .instance-source{margin-top:.55rem;}
  .instance-source small{flex-basis:100%;font-size:.72rem;}
  .mobile-tabs{display:none;}
  main.wide{grid-template-columns:minmax(155px,185px) minmax(0,1fr);}
  .pair{grid-template-columns:repeat(2,minmax(0,1fr));}
  option,label,.asseteditor p{overflow-wrap:anywhere}
  .project,.inspector{min-width:0;}.item span{overflow-wrap:anywhere;}
  @media(min-width:1101px){
    :global(.studio #app){height:100dvh;display:flex;flex-direction:column;}
    main{min-height:0;flex:1;}
    .work,.project,.inspector{overflow:auto;min-height:0;max-height:none;scrollbar-gutter:stable;}
  }
  @media(max-width:1100px){
    main,main.wide{display:block;padding:.4rem;min-height:0;overflow:auto;flex:1;}
    :global(.studio #app){height:100dvh;display:flex;flex-direction:column;}
    .mobile-tabs{display:block;margin:0 .5rem;}
    main[data-pane="Editor"]>aside,main[data-pane="Project"]>:not(.project),main[data-pane="Settings"]>:not(.inspector){display:none;}
    main.wide[data-pane="Settings"]>.work{display:block;}
    .appbar{padding:.4rem;gap:.3rem;}.actions{justify-content:flex-end}.status{font-size:.68rem;}
    .inspector,.instance-list{max-height:none;overflow:visible;}
  }

  main.coding{grid-template-columns:minmax(155px,185px) minmax(0,1fr)}
  .coding .author-panes{grid-template-columns:minmax(0,1fr) minmax(0,1.8fr)}
  .stage-tools{justify-content:space-between;align-items:end;padding:.3rem 0 .5rem}
  .stage-tools :global(.search-select){flex:1 1 9rem}
  .stage-actors h2{font-size:1rem;margin:0}
  .inline-playtest{display:block;width:100%;flex:1 1 0;min-height:0;border:0;background:#12121a}
  .stage-actors{margin-top:.35rem;padding:.5rem;max-height:35%;overflow:auto;flex:none}
  .stage-actor-list{display:flex;flex-wrap:wrap;gap:.35rem}
  .stage-actor-list button{display:grid;justify-items:center;gap:.2rem;min-width:4.25rem;max-width:100%;overflow-wrap:anywhere}
  .stage-actor-list img{width:28px;height:28px;object-fit:contain;image-rendering:pixelated}
  .work{display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden;min-height:0}
  .author-panes[hidden]{display:none}
  .author-panes{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:.35rem;min-height:0}
  .code-pane,.map-pane{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
  .code-pane{contain:paint}
  .code-pane[hidden]{display:none}
  .aux-pane{min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain}
  @media(max-width:1100px){
    main[data-pane]{display:flex;flex-direction:column;overflow:hidden}
    main[data-pane]>.work{display:grid;order:0}
    main:is([data-pane="Project"],[data-pane="Settings"])>.work{flex:0 0 auto}
    main:is([data-pane="Project"],[data-pane="Settings"]) .work>:not(nav){display:none}
    main[data-pane="Project"]>.project,main[data-pane="Settings"]>.inspector{order:1;overflow:auto;flex:1}
    main.wide[data-pane="Settings"]>.work{display:grid}
    .work{flex:1;min-height:0}
  }
  @media(max-width:620px){
    .coding .author-panes{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(13rem,2fr) minmax(14rem,3fr);
      overflow:auto;overscroll-behavior:contain}
    .stage-actors{max-height:28%}
  }
</style>
