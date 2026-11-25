<script>
  import productIcon from '../packaging/gamewaffle.svg?inline';
  import {Network,Blocks,Images,Settings2,Play,DoorOpen as RoomIcon,Layers3,Search,SquareUserRound,Plus,Sparkles,Database,ExternalLink} from '@lucide/svelte';
  const viewIcons={world:Network,room:RoomIcon,actors:SquareUserRound,blocks:Blocks,assets:Images,shaders:Sparkles,resources:Database,game:Settings2};
  import { buttons, platformGravity } from '../src/schema.mjs';
  import {roomSettingKeys} from '../src/room-script.mjs';
  import {initStatements} from '../src/init-properties.mjs';
  import {propertyAliases} from '../src/collections.mjs';
  import PagedList from './PagedList.svelte';
  import AssetLibrary from './AssetLibrary.svelte';
  import ShaderWorkspace from './ShaderWorkspace.svelte';
  import {editableArtFile,tileAssetTitle} from '../src/asset-types.mjs';
  import {resolveTileTag,tileTagName} from '../src/tile-tag.mjs';
  let projectPath=$state(''),filter=$state(''),instanceFilter=$state('');
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
  import ResourceDialog from './ResourceDialog.svelte';
  import {resourceTables} from '../src/resource-tables.mjs';
  import EntityTags from './EntityTags.svelte';
  let bitfontsPanel=$state();
  import Bitfonts from './Bitfonts.svelte';
  import Modal from './Modal.svelte';
  import CoverCrop from './CoverCrop.svelte';
  import {normalizeCoverCrop} from '../src/cover.mjs';
  import SearchSelect from './SearchSelect.svelte';
  import ColliderEditor from './ColliderEditor.svelte';
  import {resourceName} from '../src/resource-name.mjs';
  import {formatScript, locations, parseScript} from '../src/wafflescript.mjs';
  import ExportDialog from './ExportDialog.svelte';
  import { tileSizes } from '../src/script.mjs';
  import { decodeCbor, encodeCbor } from '../src/cartridge.mjs';
  import {growSeamNeighbors} from '../src/room-geometry.mjs';
  import RoomMap from './RoomMap.svelte';
  import { instanceNames, newInstanceName, spriteDragType } from '../src/instances.mjs';

  let project=$state(null), assets=$state([]), art=$state({}), tab=$state('room'), roomId=$state(''), spriteId=$state(''),
    roomCode=$state(''), scriptMode=$state('blocks'), scriptStatus=$state(''), tileId=$state(''), layerIndex=$state(0), assetKind=$state('sprite'), scriptDirty=$state(false),
    dirty=$state(false), busy=$state(false), error=$state(''), status=$state('Opening project…'), newId=$state(''),
    newSource=$state('');
  let importFile=$state.raw(null), filePicker=$state(), assetError=$state('');
  let roomOperation=$state(''), newRoomName=$state(''), newRoomView=$state('platformer');
  let pendingTileSize=$state(null), editingColliders=$state('');
  const tileSets=$derived(groupTiles(project?.tiles??{}));
  let tileArt=$state.raw({}), spriteArt=$state.raw({}), previewModes=$state.raw({}), authoredVariants=$state.raw({});
  let historyVersion=$state(0), selectedEntity=$state(-1), roomPanel=$state('layers');
  let scriptPanel=$state(),assetLibrary=$state(),projectTimer,projectWrite;
  let shaderTarget=$state.raw(null),shaderSession=0;
  const shaderDrafts=new Map();
  let savedProject=$state(''), currentProject='';
  let previewEntries=new Map(), previewImages=new Map(), previewKey;
  const previewImage=url=>previewImages.get(url);
  const undo=[],redo=[];
  const draft=draftFile('project',message=>error=message);
  let recovery=$state.raw(null);
  let dimensions=$state(null);
  let placementSprite=$state(''), mapTool=$state('select'), addForm=$state(false);
  let revision=-1, checking=false;
  let sourceError=$state(''), scriptBlocker=$state('');
  $effect(()=>{if(!scriptDirty)scriptBlocker='';});
  let backgroundPicker=$state(), importingBackground=$state(false), roomBackgrounds=$state({});
  let coverPicker=$state(), coverEdit=$state.raw(null), coverCrop=$state(normalizeCoverCrop());
  let coverUpload=$state.raw(null), coverReady=$state(false), coverSaving=$state(false), coverError=$state(''), coverPreview=$state('');
  let room=$derived(project?.rooms[roomId]), roomBackground=$derived(roomBackgrounds[roomId]??room?.backgroundImage), layer=$derived(room?.layers?.[layerIndex]);
  let sprite=$derived(project?.sprites?.[spriteId]), tile=$derived(project?.tiles?.[tileId]);
  let artFiles=$derived(assets.filter(file=>/\.(ase|aseprite|png)$/i.test(file)));
  let nameDialog=$state.raw(null),newName=$state(''),resourceDialog=$state.raw(null);
  let codeOpened=$state(false),mobilePane=$state('Editor');
  const tabs=[['world','World'],['room','Room'],['actors','Entities'],['blocks','Code'],['assets','Assets'],['shaders','Shaders'],['resources','Resources'],['game','Game']];

  const historyStatus=$derived.by(()=>{
    const revision=historyVersion;
    return { revision, undo:undo.at(-1)?.label, redo:redo.at(-1)?.label };
  });
  const sortedLayers=$derived((room?.layers ?? []).map((layer,index)=>({layer,index,order:layer.order??index}))
    .sort((a,b)=>b.order-a.order || b.index-a.index));
  const maxTiles=$derived(Math.floor(4096/(project?.tileSize??24)));
  let roomAuthoring=$state.raw({});
  const roomView=$derived(roomAuthoring[roomId]?.view??room?.view??(Math.abs(room?.gravity??platformGravity)<.01?'top_down':'platformer'));
  const actor=$derived(room?.entities[selectedEntity]);
  const exportName=$derived((project?.name??'game').toLowerCase().replace(/[^a-z0-9]+/g,'-') || 'game');

  let exportDialog, fileMenu;
  const localization=$derived(resourceTables(project?.localization,gameScript?.declarations?.resources));
  const textEntries=$derived(localization.tables[localization.locale]??{});
  const textKeys=$derived(Object.keys(textEntries).sort());
  const gameControls=$derived(gameScript?.declarations?.controls??project?.controls??{});
  const gameMenus=$derived(gameScript?.declarations?.menus??project?.menus??{});
  const entityTagLabels=$derived({
    ...Object.fromEntries([...Object.values(project?.sprites??{}).flatMap(type=>type.components??[]),
      ...Object.values(project?.rooms??{}).flatMap(room=>(room.entities??[]).flatMap(entity=>entity.components??[]))].map(id=>[id,id])),
    ...project?.components,
  });
  function resolveEntityTag(label){
    const existing=Object.keys(entityTagLabels).find(id=>entityTagLabels[id].toLowerCase()===label.toLowerCase());
    if(existing)return existing;
    const id=resourceName(label,'tag',[entityTagLabels,{transform:1,sprite:1,body:1,player:1,health:1,script:1}]);
    (project.components??={})[id]=label;
    return id;
  }
  let shaderDefinitions=$state.raw({});
  let gameScript=$state.raw(null), gameCode=$state(false), codeTile=$state(''), codeVariant=$state(0), codeSpriteId=$state('');
  const codeSprite=$derived(project?.sprites?.[codeSpriteId]);
  let editTileVariant=$state('0');
  const activeTileCode=$derived(!gameCode&&Boolean(codeTile));
  const gameFlags=$derived({...project?.flags,...gameScript?.declarations?.flags});
  const gameGlobals=$derived({...project?.variables,...gameScript?.declarations?.globals});
  const gameEvents=$derived({...project?.events,...gameScript?.declarations?.events});
  const blockReferences=$derived({
    pixelUnits:project?.physicsUnits==='pixels',
    createResource:openResourceDialog,
    editResource:openResourceEdit,
    names:[...new Set(Object.values(project?.rooms??{}).flatMap(room=>instanceNames(room.entities??[])))].sort(),
    componentsLabels:entityTagLabels,
    spritesLabels:Object.fromEntries(Object.entries(project?.sprites??{}).map(([id,sprite])=>[id,sprite.title??id])),
    itemsLabels:Object.fromEntries(Object.entries(project?.items??{}).map(([id,item])=>[id,item.label?.startsWith('text.')?textEntries[item.label.slice(5)]??id:item.label??id])),
    components:[...new Set(['transform','sprite','body','player','health','script',...Object.keys(entityTagLabels)])].sort(),
    fields:[...new Set(['health','label','ready','score','speed',...Object.keys(gameGlobals),...Object.keys(project?.entityFields??{})])],
    fieldsLabels:project?.entityFields??{},variableLabels:project?.variableLabels??{},
    rooms:Object.keys(project?.rooms??{}),
    tiles:Object.keys(project?.tiles??{}),
    tileLabels:Object.fromEntries(Object.entries(project?.tiles??{}).map(([id,tile])=>[id,tile.title??tile.tag??id])),
    sounds:Object.keys(project?.audio??{}),
    shaders:shaderDefinitions,
    backgrounds:artFiles.filter(file=>!art[file]?.error),
    backgroundsLabels:Object.fromEntries(artFiles.map(file=>[file,file.split('/').at(-1)])),
    collections:gameScript?.collections,
    propertyAliases:propertyAliases(gameGlobals,gameFlags,project?.items),
    events:Object.keys(gameEvents),eventsLabels:gameEvents,gameConstants:gameScript?.constants??{},
    fonts:['builtin',...Object.keys(project?.bitfonts??{})],
    fontsLabels:{builtin:'Built-in',...Object.fromEntries(Object.entries(project?.bitfonts??{}).map(([id,font])=>[id,font.name??id]))},
    flags:Object.keys(gameFlags),
  });
  const codeRoomId=$derived(roomCode||(!codeSpriteId?roomId:''));
  const codeRoom=$derived(project?.rooms[codeRoomId]);
  const activeRoomCode=$derived(!gameCode&&!activeTileCode&&Boolean(codeRoom));
  const roomScripts=$derived(Object.entries(project?.rooms??{}).map(([id,room])=>({id,title:room.title??id})));
  const tileScripts=$derived(Object.entries(project?.tiles??{}).flatMap(([id,tile])=>
    (tileArt[id]??[]).map((_,variant)=>({id,variant,title:(tile.title??tile.tag??id)+' · Variant '+(variant+1)}))));
  const entityScripts=$derived(Object.entries(project?.sprites??{}).map(([id,sprite])=>({id,title:sprite.title??id})));
  const authoringView=$derived(tab==='room'||tab==='blocks');
  const hasInspector=$derived(tab==='room'||(tab==='assets'&&assetKind==='tile'));

  function askName(kind,query,register,select){
    newName=query.slice(0,100);
    nameDialog={kind,register,select};
  }
  function openResourceDialog(suggestedName='',select){
    resourceDialog={suggestedName,select};
  }
  function openResourceEdit(key){
    if(!Object.hasOwn(textEntries,key))return;
    const values=Object.fromEntries(Object.entries(localization.tables).map(([locale,table])=>[locale,
      Object.hasOwn(table,key)?table[key]:undefined]));
    resourceDialog={entry:{key,values}};
  }
  async function addTextResource(name,text){
    const locale=localization.locale||'en';
    const key=resourceName(name,'text',[textEntries]);
    const tables=project.localization?.tables;
    project.localization={locale,tables:{...tables,[locale]:{...tables?.[locale],[key]:text}}};
    mark('resource '+key);
    const {select}=resourceDialog;
    resourceDialog=null;
    await tick();
    select?.(key);
  }
  function editTextResource(changes){
    const {key}=resourceDialog.entry;
    const locale=localization.locale;
    const tables={...project.localization?.tables};
    tables[locale]??={};
    for(const [language,text] of Object.entries(changes))tables[language]={...tables[language],[key]:text};
    project.localization={locale,tables};
    mark('edit resource '+key);
    resourceDialog=null;
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
  async function prepareExport(){
    if(!await saveEdits())throw Error(scriptBlocker||error||'Wait for Studio to finish the current edit.');
    return true;
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
    const response=await fetch('./api/thumbnails',{cache:'no-store'});
    if(!response.ok)throw Error('Could not open project preview');
    const next=decodeCbor(new Uint8Array(await response.arrayBuffer()));
    let tiles=next.tilePreviews??{};
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
    const nextModes=Object.fromEntries(Object.entries(tiles).map(([id,data])=>[id,data.variantModes??data.variants.map(()=>data.mode)]));
    const nextCounts=Object.fromEntries(Object.entries(tiles).map(([id,data])=>[id,data.authoredVariants??data.variants.length]));
    const nextSprites=Object.fromEntries(Object.entries(next.spritePreviews??{}).map(([id,bytes])=>[id,png('sprite/'+id,bytes)]));
    const nextCover=next.coverArt?png('cover',next.coverArt):'';
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
    if(JSON.stringify(authoredVariants)!==JSON.stringify(nextCounts))authoredVariants=nextCounts;
    if(JSON.stringify(spriteArt)!==JSON.stringify(nextSprites))spriteArt=nextSprites;
    coverPreview=nextCover;
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
      projectPath=value.path;project=value.project;gameScript=value.gameScript; shaderDefinitions=value.shaderDefinitions??{}; roomBackgrounds=value.roomBackgrounds; roomAuthoring=value.roomAuthoring; assets=value.assets; art=value.art; revision=value.revision;
      currentProject=savedProject=JSON.stringify(value.project);
      recovery=await draft.read();
      if(recovery===savedProject){recovery=null;await draft.write(null);}
      roomId=project.start ?? Object.keys(project.rooms)[0];
      spriteId=Object.keys(project.sprites ?? {})[0] ?? '';
      codeSpriteId=spriteId;
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
        if(JSON.stringify(shaderDefinitions)!==JSON.stringify(current.shaderDefinitions))shaderDefinitions=current.shaderDefinitions??{};
        if(JSON.stringify(roomBackgrounds)!==JSON.stringify(current.roomBackgrounds))roomBackgrounds=current.roomBackgrounds;
        roomAuthoring=current.roomAuthoring;
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
    if(growth)for(const [id,neighbor] of growSeamNeighbors(project.rooms,roomId,project.tileSize??24,growth,roomAuthoring))project.rooms[id]=neighbor;
    project.rooms[roomId]=next;
    updateDirty(label);
  }
  function applyProject(serialized,record){
    const previousTiles=JSON.stringify(project.tiles);
    project=JSON.parse(serialized);
    if(!project.rooms[roomId])roomId=project.start??Object.keys(project.rooms)[0];
    if(roomCode&&!project.rooms[roomCode])roomCode=roomId;
    if(!project.sprites?.[spriteId])spriteId=Object.keys(project.sprites??{})[0]??'';
    if(!project.sprites?.[codeSpriteId])codeSpriteId=spriteId;
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
      if(!await saveProject())return;
      busy=true;error='';
      try{
        const restored=await request('./api/file-history','POST',{id:entry.id,back});
        active.pop();(back?redo:undo).push(entry);historyVersion++;scriptVersion++;
        const latest=await request('./api/project');
        if(restored.manifestChanged){
          savedProject=JSON.stringify(latest.project);
          applyProject(savedProject,false);
          gameScript=latest.gameScript;
          roomBackgrounds=latest.roomBackgrounds??{};
        }
        roomAuthoring=latest.roomAuthoring;
        shaderDefinitions=latest.shaderDefinitions??{};
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
    const existing=initStatements(unit).findLast(block=>block.op==='set_room_background_image');
    const group=init[0]?.op==='init_properties'?init[0]:null;
    const block=existing?{...existing,image:path}:{op:'set_room_background_image',image:path,scroll:1};
    if(existing)Object.assign(existing,block);else (group?.body??init).push(block);
    if(parsed){
      const snippet=formatScript({events:{init:[block]}});
      const source=unit.source,command=snippet.split('\n')[1];
      const oldCommands=parsed.events.init;
      const old=locations.get(initStatements(parsed).findLast(row=>row.op==='set_room_background_image'));
      if(old)unit.source=source.slice(0,old.from)+command.trimStart()+source.slice(old.to);
      else if(group){
        const {to}=locations.get(oldCommands[0]);
        const at=source.lastIndexOf('\n',to-1)+1;
        unit.source=source.slice(0,at)+'  '+command+'\n'+source.slice(at);
      }
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
  function chooseCover(input){
    const file=input.files[0];
    input.value='';
    if(file&&!busy)openCover({file});
  }
  function openCover(source){
    coverCrop=normalizeCoverCrop(source.path?project.coverCrop:undefined);
    coverUpload=null;coverReady=false;coverError='';coverEdit=source;
  }
  async function saveCover(){
    if(!coverReady||coverSaving)return;
    coverSaving=true;coverError='';
    try{
      const crop=$state.snapshot(coverCrop);
      if(coverEdit.file){
        const name=coverEdit.file.name.replace(/\.[^.]+$/,'').trim().slice(0,100)||'Cover art';
        await uploadLibraryAsset({kind:'cover',filename:coverUpload.name,name,coverCrop:crop,
          data:new Uint8Array(await coverUpload.arrayBuffer())});
      }else{
        project.coverCrop=crop;
        mark('cover crop');
        if(!await saveProject())throw Error(error||'Could not save the cover crop');
        await checkAssets();
      }
      coverEdit=null;
    }catch(err){coverError=err.message;}finally{coverSaving=false;}
  }
  function removeCover(){
    delete project.coverImage;
    delete project.coverCrop;
    mark('cover removal');
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
    editRoom(next=>{next.entities[selectedEntity][key]=value;});
  }
  let inlinePlaytest=$state(false), playtestFrame=$state(), playtestRoom=$state('');
  function stopInlinePlaytest(){
    inlinePlaytest=false;
  }
  function handlePlaytestMessage(event){
    if(event.origin===location.origin && event.source===playtestFrame?.contentWindow && event.data==='gamewaffle:stop-playtest')stopInlinePlaytest();
  }
  async function startInlinePlaytest(){
    if(!await finishScript() || (dirty && !await saveProject()) || tab!=='blocks')return;
    playtestRoom=activeRoomCode?codeRoomId:roomId;
    inlinePlaytest=true;
  }
  function openTab(id){
    if(id!=='blocks')inlinePlaytest=false;
    else codeOpened=true;
    mobilePane='Editor';

    if(id==='actors')assetKind='sprite';
    if(id==='assets'&&assetKind==='sprite')assetKind='source';
    error='';tab=id;
    if(id==='blocks'||id==='room')requestAnimationFrame(()=>document.querySelector(id==='blocks'?'.code-pane':'.map-pane')?.focus({preventScroll:true}));
  }
  function openShaderWorkspace(id,path){
    if(path&&!id)id=Object.keys(project.shaders??{}).find(key=>project.shaders[key].source===path);
    if(!path&&id)path=project.shaders?.[id]?.source;
    if(path!==shaderTarget?.path||!path)shaderTarget=path?{session:++shaderSession,id,path}:null;
    openTab('shaders');
  }
  function useShaderTemplate(template){
    shaderTarget={session:++shaderSession,template};
  }
  async function selectEntityScript(id){
    if(!gameCode&&!activeTileCode&&!activeRoomCode&&codeSpriteId===id&&scriptPanel&&!await scriptPanel.selectBase())return false;
    if((gameCode||activeTileCode||activeRoomCode||codeSpriteId!==id) && !await finishScript())return false;
    gameCode=false;codeTile='';roomCode='';codeSpriteId=id;error='';
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
  function selectView(id){
    openTab(id);
  }
  async function openGameScript(){
    if(!await finishScript())return false;
    if(gameCode&&scriptPanel&&!await scriptPanel.selectBase())return false;
    gameCode=true;codeTile='';
    openTab('blocks');
    return true;
  }
  async function openTileScript(id,variant){
    if(!tileArt[id]?.[variant]||!await finishScript())return false;
    gameCode=false;codeTile=id;codeVariant=variant;
    openTab('blocks');return true;
  }
  async function selectScriptFile(kind,id,variant){
    if(kind==='game')return openGameScript();
    if(kind==='tile')return openTileScript(id,variant);
    return kind==='room'?selectRoomScript(id):selectEntityScript(id);
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
  async function openDefinition(id,view='actors'){
    if(view==='actors')spriteId=id;
    else if(!await selectEntityScript(id))return;
    openTab(view);
  }
  function openEntityForm(){
    if(busy)return;
    newId='';newSource='';importFile=null;assetError='';addForm=true;
  }
  function openTiles(){
    assetKind='tile';
    openTab('assets');
  }
  async function uploadTiles(){
    if(busy)return;
    openTiles();
    await tick();
    assetLibrary?.pick('tile');
  }
  async function selectTileset(path,id){
    openTiles();
    tileId=id;
    editTileVariant='0';
    await tick();
    assetLibrary?.select(path);
  }
  function chooseInitialLayer(map){
    const layers=(map?.layers??[]).map((item,index)=>({item,index}));
    return layers.sort((a,b)=>Number(Boolean(b.item.collidable))-Number(Boolean(a.item.collidable))
      || (b.item.order??b.index)-(a.item.order??a.index)).at(0)?.index??0;
  }
  async function selectRoom(id,from='open'){
    if(tab==='blocks'&&from==='sidebar'){
      if(await selectRoomScript(id))mobilePane='Editor';
      return;
    }
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
    await tick();
    scriptBlocker=scriptPanel?.reportSaveError() || error || 'The script editor is busy. Try again when it is ready.';
    return false;
  }
  async function saveProject(){
    clearTimeout(projectTimer);
    if(projectWrite)await projectWrite;
    if(!dirty)return true;
    if(projectWrite)return projectWrite;
    const saved=JSON.stringify(project);
    projectWrite=(async()=>{
      try{
        const result=await request('./api/project','PUT',JSON.parse(saved));
        roomAuthoring=result.roomAuthoring;
        savedProject=saved;updateDirty(undefined,false);
        if(!dirty)status='Project saved';
        return !dirty;
      }catch(err){error=err.message;return false;}
    })().finally(()=>projectWrite=null);
    return projectWrite;
  }
  function saveScript(id,isRoom,isGame,data,isTile,authoring){
    if(authoring)roomAuthoring=authoring;
    if(isTile){status='Script saved';return;}
    if(isRoom){
      const background=initStatements(data).findLast(row=>row.op==='set_room_background_image')?.image;
      if(background==null)delete roomBackgrounds[id];else roomBackgrounds[id]=background;
      const baseline=JSON.parse(savedProject);
      for(const key of roomSettingKeys){delete project.rooms[id][key];if(baseline.rooms[id])delete baseline.rooms[id][key];}
      savedProject=JSON.stringify(baseline);
      updateDirty(undefined,false);
    }
    if(isGame){
      gameScript={declarations:data.declarations,constants:data.constants,collections:data.collections};
      const baseline=JSON.parse(savedProject);
      for(const key of ['flags','events','variables','controls','menus','camera','minimap']){delete project[key];delete baseline[key];}
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
  function setName(path){return project.assetInfo?.[path]?.name??path.split('/').pop().replace(/\.[^.]+$/,'');}
  function selectSource(path,file=null){
    importFile=file;newSource=path;assetError='';
    if(!newId)newId=path.split('/').at(-1).replace(/\.[^.]+$/,'');
  }
  async function createEntity(){
    if(busy)return;
    const label=newId.trim();
    if(!newSource||!label)return;
    const id=resourceName(label,'entity',[project.sprites??{}]);
    busy=true;assetError='';
    try{
      if(importFile){
        const response=await fetch('./api/import?name='+encodeURIComponent(importFile.name)+'&kind=sprite',{method:'POST',body:importFile});
        const result=await response.json();
        if(!response.ok)throw Error(result.error);
        recordFile(result.edit);newSource=result.path;importFile=null;
        const current=await request('./api/project');assets=current.assets;art=current.art;
      }
      if(art[newSource]?.error)throw Error(art[newSource].error);
      (project.sprites??={})[id]={source:newSource,title:label,physics:{},gravityMode:'room'};
      spriteId=id;
      mark('creation of '+label);
      addForm=false;
    }catch(err){assetError=String(err.message??err);}
    finally{busy=false;}
  }
  function tagSlug(tag){return tileTagName(tag).toLowerCase().replace(/[^a-z0-9_-]+/g,'-');}
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
      for(const id of ids){
        const tile=project.tiles[id];
        if(!tile.tag)continue;
        const resolved=resolveTileTag(tags,tile.tag);
        if(resolved!==undefined && resolved!==tile.tag){
          tile.tag=resolved;
          added=true;
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
    const assigned=new Set(existing.map(([,tile])=>resolveTileTag(tags,tile.tag)??tile.tag??''));
    let first=existing[0]?.[0];
    let added=false;
    for(const [index,tag] of (tags.length?tags:['']).entries()){
      if(assigned.has(tag))continue;
      const slug=tagSlug(tag);
      const base=tag?stem+'-'+(slug||String(index+1)):stem;
      let id=base,n=2;
      while(Object.hasOwn(collection,id))id=base+'-'+n++;
      const name=project.assetInfo?.[path]?.name;
      collection[id]={source:path,setPrefix:stem,tag,physics:{},...(name?{title:tileAssetTitle(name,tag)}:{})};
      assigned.add(tag);
      added=true;
      first??=id;
    }
    return {first,added};
  }
  async function uploadLibraryAsset(data){
    if(!await saveEdits())throw Error('Save the current project or script before loading assets');
    busy=true;
    try{
      const response=await fetch('./api/assets',{method:'POST',body:encodeCbor(data)});
      return (await applyLibraryAsset(response,'import of '+data.name,'Asset loaded')).path;
    }finally{busy=false;}
  }
  async function saveLibraryShader(data,session){
    if(!await saveEdits())throw Error('Save the current project or script before saving the shader');
    busy=true;
    try{
      const response=await fetch('./api/shaders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      const result=await applyLibraryAsset(response,'shader edit in '+data.name,'Shader saved');
      shaderDrafts.delete(session.id??'template:'+session.template);
      if(shaderTarget?.session===session.session)shaderTarget={session:session.session,id:result.id,path:result.path};
      return result;
    }finally{busy=false;}
  }
  async function applyLibraryAsset(response,label,message){
    const result=await response.json();
    if(!response.ok)throw Error(result.error);
    project=result.project;
    assets=result.assets;art=result.art;revision=result.revision;
    shaderDefinitions=result.shaderDefinitions??{};
    savedProject=JSON.stringify(project);
    updateDirty(undefined,false);
    recordFile(result.edit,label);
    await updatePreviews(result.previewKey);
    status=message;
    return result;
  }
  function editLibraryAsset(asset,{name,tags}){
    if(name===asset.name&&JSON.stringify(tags)===JSON.stringify(asset.tags))return;
    const info=(project.assetInfo??={})[asset.path]??={kind:asset.kind};
    Object.assign(info,{name,tags});
    if(name!==asset.name)for(const link of asset.linked){
      const collection={shader:'shaders',sprite:'sprites',tile:'tiles',font:'bitfonts',sound:'audio'}[link.kind];
      if(!collection)continue;
      const object=project[collection]?.[link.id];
      if(typeof object==='string')project[collection][link.id]={source:object,title:name};
      else if(object)object[link.kind==='font'?'name':'title']=link.kind==='tile'?tileAssetTitle(name,object.tag):name;
    }
    mark('asset details');
  }
  function libraryPreview(asset){
    const entry=asset.linked.find(link=>link.kind===asset.kind);
    if(asset.kind==='sprite'&&spriteArt[entry?.id])return spriteArt[entry.id];
    if(asset.kind==='tile'&&tileArt[entry?.id]?.[0])return tileArt[entry.id][0];
    if(asset.kind==='cover'&&project.coverImage===asset.path&&coverPreview)return coverPreview;
    const image=art[asset.path];
    return image&&!image.error?'./api/room-art?path='+encodeURIComponent(asset.path)+'&revision='+image.revision:'';
  }
  async function openLibraryAsset(link){
    if(link.kind==='sprite')openDefinition(link.id);
    else if(link.kind==='tile'){
      tileId=link.id;editTileVariant='0';assetKind='tile';
      if(innerWidth<=1100)mobilePane='Settings';
    }else if(link.kind==='font')bitfontsPanel?.open(link.id);
  }
  async function editSourceFile(path){
    error='';
    try{await request('./api/open-asset','POST',{path});}
    catch(err){error=err.message;}
  }
  function set(target,key,value){
    if(value===''||value===undefined)delete target[key];else target[key]=value;
    mark();
  }
</script>

{#snippet editSource(path)}
  {#if editableArtFile.test(path??'')}
    <button type="button" class="icon-button" aria-label="Open source in default editor" title="Open source in default editor"
      onclick={()=>editSourceFile(path)}><ExternalLink size={16}/></button>
  {/if}
{/snippet}

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
      <button onclick={debugRoom} disabled={busy||!project}>Debug room</button>
      <button onclick={rebuild} disabled={busy||!project}>Rebuild assets</button>
        <button onclick={()=>{updatesOpen=!updatesOpen;if(updatesOpen)checkReleases();}}>Updates</button>
    </div></details>
</nav>
<ExportDialog bind:this={exportDialog} basename={exportName} {localization} onSave={prepareExport} onClose={()=>fileMenu.querySelector('summary').focus()}/>
{#if inlinePlaytest && project.rooms[playtestRoom]}
  <Modal title="Play room" wide onClose={stopInlinePlaytest}>
    <div class="playtest-toolbar row">
      <SearchSelect label="Playtest room" value={playtestRoom} options={roomScripts.map(({id,title})=>({value:id,label:title}))}
        onChange={value=>playtestRoom=value}/>
      <button type="button" onclick={stopInlinePlaytest}>Close</button>
    </div>
    <iframe bind:this={playtestFrame} class="inline-playtest" title="Game playtest" onload={()=>playtestFrame?.focus()}
      src={'./player.html?playtest=1&inline=1&room='+encodeURIComponent(playtestRoom)}></iframe>
  </Modal>
{/if}
{#if coverEdit}
  <Modal title="Crop cover art" busy={coverSaving} onClose={()=>coverEdit=null}>
    <form onsubmit={event=>{event.preventDefault();saveCover();}}>
      <CoverCrop file={coverEdit.file} path={coverEdit.path} bind:crop={coverCrop}
        bind:upload={coverUpload} bind:ready={coverReady} disabled={coverSaving}/>
      {#if coverError}<p class="error" role="alert">{coverError}</p>{/if}
      <div class="dialog-actions">
        <button type="button" disabled={coverSaving} onclick={()=>coverEdit=null}>Cancel</button>
        <button class="primary" disabled={!coverReady||coverSaving}>{coverSaving?'Saving…':'Save cover'}</button>
      </div>
    </form>
  </Modal>
{/if}
{#if resourceDialog}
  <ResourceDialog suggestedName={resourceDialog.suggestedName} entry={resourceDialog.entry} locale={localization.locale}
    onAdd={addTextResource} onEdit={editTextResource} onClose={()=>resourceDialog=null}/>
{/if}
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
{#if scriptBlocker || error || sourceError}<p role="alert" class="error banner">{scriptBlocker || error || sourceError}</p>{/if}
{#if debugging}<Debugger room={roomId} onClose={()=>debugging=false}/>
{:else if recovery}
  <section class="row card" role="alert"><strong>Unsaved project edits</strong>
    <button onclick={()=>{applyProject(recovery,true);recovery=null;if(importNewTags())updatePreviews().catch(err=>error=err.message);}}>Recover edits</button>
    <button onclick={()=>{recovery=null;draft.write(null);}}>Discard draft</button>
  </section>
{:else if project}
  <div class="mobile-tabs"><Sections labels={hasInspector?['Editor','Project','Settings']:['Editor','Project']} bind:value={mobilePane}/></div>
  <main class:coding={tab==='blocks'} class:shader-mode={tab==='shaders'} class:wide={['actors','game','world','shaders','resources'].includes(tab)||(tab==='assets'&&['audio','source'].includes(assetKind))} data-pane={mobilePane}>
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
        <div class="heading row"><h3>Entities</h3><button class="small-button icon-button" title="Create entity" aria-label="Create entity" onclick={openEntityForm}><Plus size={14}/></button></div>
        <PagedList items={Object.keys(project.sprites??{})} label="entities" query={filter} text={id=>project.sprites[id].title??id}>{#snippet children(id)}
          {@const selected=tab==='room'?mapTool==='spawn'&&placementSprite===id:tab==='actors'?spriteId===id:tab==='blocks'&&!gameCode&&!activeTileCode&&!activeRoomCode&&codeSpriteId===id}
          <div class="actor-entry"><button class="item" class:selected
            aria-pressed={tab==='blocks'?selected:undefined}
            draggable={tab==='room' && ['spawn','select'].includes(mapTool)} ondragstart={event=>dragDefinition(event,id)}
            title={tab==='room' ? 'Choose entity for placement' : 'Select entity'}
            onclick={()=>chooseDefinition(id)}>
            {#if spriteArt[id]}<img src={spriteArt[id]} alt="" draggable="false">{:else}<SquareUserRound size={14}/>{/if}<span>{project.sprites[id].title??id}</span>
          </button><button class="script-link" title={'Open script for '+id} aria-label={'Open script for '+id} onclick={()=>openDefinition(id,'blocks')}>Code</button></div>
        {/snippet}</PagedList>
      </div>
      {#if tab!=='room'}<div class="category compact">
        <div class="heading row"><h3>Tile sets</h3><button class="small-button icon-button" title="Add tile set" aria-label="Add tile set" onclick={uploadTiles}><Plus size={14}/></button></div>
        <PagedList items={Object.keys(tileSets)} label="tile sets" query={filter} text={path=>setName(path)+' '+path}>{#snippet children(path)}
          {@const first=tileSets[path][0]}
          <button class="item" title={path} class:selected={tab==='assets' && assetKind==='tile' && tile?.source===path} onclick={()=>selectTileset(path,first)}>
            {#if tileArt[first]?.[0]}<img src={tileArt[first][0]} alt="">{:else}<Layers3 size={14}/>{/if}<span>{setName(path)}</span>
          </button>
        {/snippet}</PagedList>
      </div>
    {/if}</aside>
    <div class="work">
      <nav class="row" aria-label="Editor views">
        {#each tabs as [id,title]}{@const Icon=viewIcons[id]}<button class:active={tab===id} aria-current={tab===id?'page':undefined} onclick={()=>selectView(id)}><Icon size={15}/>{title}</button>{/each}
      </nav>
      <div class="author-panes" hidden={!authoringView}>
        <section tabindex="-1" class="map-pane" hidden={tab!=='room'} aria-label="Room editor">
        {#if room}
        {#key roomId}
          <RoomMap {room} {roomId} {projectPath} size={project.tileSize??24} tiles={project.tiles??{}} sprites={project.sprites??{}}
            {tileArt} {spriteArt} {previewModes} {authoredVariants} {previewImage} backgroundUrl={roomBackground?'./api/room-art?path='+encodeURIComponent(roomBackground)+'&revision='+(art[roomBackground]?.revision??''):undefined} {layerIndex} bind:selectedEntity bind:tileId bind:spriteId={placementSprite} bind:tool={mapTool} authoring={roomAuthoring[roomId]} {busy}
            undoLabel={historyStatus.undo} redoLabel={historyStatus.redo}
            onUndo={()=>restoreEdit(true)} onRedo={()=>restoreEdit(false)} onEdit={replaceRoom}
            onLayer={chooseLayer} onSprites={inspect=>{roomPanel='instances';if(inspect)mobilePane='Settings';}} onAssets={openTiles}
            onPlay={playtest} />
        {/key}
        {/if}
        </section>
        {#if codeOpened}
        <section tabindex="-1" class="code-pane" hidden={tab!=='blocks'} aria-label={gameCode?'Game code':activeTileCode?'Tile code':activeRoomCode?'Room code':'Entity code'}>
          <div class="code-actions row">
            <button type="button" disabled={busy||!room} onclick={startInlinePlaytest}><Play size={15}/>Play room…</button>
          </div>
        {#if gameCode||activeTileCode||activeRoomCode||codeSpriteId}
          {#key (gameCode?'game':activeTileCode?'tile:'+codeTile+':'+codeVariant:activeRoomCode?'room:'+codeRoomId:'entity:'+codeSpriteId)+':'+scriptVersion}<ScriptPanel bind:this={scriptPanel} isRoom={activeRoomCode} isGame={gameCode} isTile={activeTileCode} variant={codeVariant}
            title={gameCode?'Game script':activeTileCode?(tileScripts.find(tile=>tile.id===codeTile&&tile.variant===codeVariant)?.title??codeTile):activeRoomCode?(codeRoom.title??codeRoomId)+' · Room script':codeSprite?.title??codeSpriteId}
            {roomScripts} {entityScripts} {tileScripts} onSelectFile={selectScriptFile} bind:mode={scriptMode}
            actorDefinition={gameCode||activeTileCode||activeRoomCode?null:codeSprite} newActor={!gameCode&&!activeTileCode&&!Object.hasOwn(JSON.parse(savedProject)[activeRoomCode?'rooms':'sprites']??{},activeRoomCode?codeRoomId:codeSpriteId)} onBeforeSave={async()=>!dirty||await saveProject()} onFileEdit={recordFile} onNewEvent={newEvent} onNewField={newScriptField}
            hasLegacyMovement={Object.values(project.rooms).some(room=>room.entities.some(entity=>entity.sprite===codeSpriteId&&entity.standardMovement))}
            initialMovement={roomView} onMovementPreset={({replaceLegacy})=>{
              if(!replaceLegacy)return;
              for(const map of Object.values(project.rooms)){
                for(const entity of map.entities)if(entity.sprite===codeSpriteId)delete entity.standardMovement;
              }
              updateDirty('movement settings for '+(codeSprite.title??codeSpriteId));
            }} sprite={gameCode?'game':activeTileCode?codeTile:activeRoomCode?codeRoomId:codeSpriteId} sprites={Object.keys(project.sprites??{})} animations={[...new Set(['default',...(art[codeSprite?.source]?.tags??[])])]} items={Object.keys(project.items??{})} {textKeys} localization={project.localization} menus={Object.keys(gameMenus)} references={activeRoomCode?{...blockReferences,names:instanceNames(codeRoom.entities??[]),layerNames:(codeRoom.layers??[]).map(layer=>layer.name).filter(Boolean)}:blockReferences} actions={[...buttons,...Object.keys(gameControls)]} bind:dirty={scriptDirty} bind:status={scriptStatus} onSave={saveScript} />{/key}
        {:else}<p class="empty card">Create an entity to edit its script.</p>{/if}
        </section>
        {/if}
      </div>
      {#if !authoringView}<section class="aux-pane" aria-label="Project tools">
      {#if tab==='world' && room}
        <World rooms={project.rooms} authoring={roomAuthoring} {roomId} onSelect={id=>selectRoom(id,'world')} onScript={openRoomScript}/>
      {:else if tab==='game'}
        <section class="card asseteditor" aria-label="Game settings">
          <div class="row heading"><h2>Game</h2><button type="button" onclick={openGameScript}><Blocks size={15}/>Open game script</button></div>
          <div class="project-options">
            <section aria-label="Tile grid">
              <h3>Tile grid</h3>
              <div class="row"><span>Tile size</span><strong>{project.tileSize??24} × {project.tileSize??24} px</strong>
                <button type="button" onclick={()=>pendingTileSize=project.tileSize??24}>Change tile size…</button>
              </div>
            </section>
            <section aria-label="Cartridge cover">
              <h3>Cartridge cover</h3>
              <div class="row">
                {#if project.coverImage&&coverPreview}<img class="cover-preview" src={coverPreview} alt="Cartridge cover art">{/if}
                <button type="button" disabled={busy} onclick={()=>coverPicker.click()}>Choose cover image…</button>
                {#if project.coverImage}
                  <button type="button" disabled={busy} onclick={()=>openCover({path:project.coverImage})}>Edit crop…</button>
                  <button type="button" disabled={busy} onclick={removeCover}>Remove cover</button>
                {/if}
                <input hidden type="file" aria-label="Cartridge cover image file" accept=".png,.jpg,.jpeg,.webp,.ase,.aseprite"
                  bind:this={coverPicker} onchange={event=>chooseCover(event.currentTarget)}>
              </div>
            </section>
          </div>
        </section>
      {:else if tab==='resources'}
        <Localization value={project.localization} resources={gameScript?.declarations?.resources}
          onChange={value=>set(project,'localization',value)} onAdd={select=>openResourceDialog('',select)} onGameScript={openGameScript}/>
      {:else if tab==='shaders'}
        <ShaderWorkspace {project} files={assets} {shaderDefinitions} room={roomId} target={shaderTarget} drafts={shaderDrafts}
          onUpload={uploadLibraryAsset} onEdit={editLibraryAsset} onOpen={openLibraryAsset} onShader={openShaderWorkspace}
          onTemplate={useShaderTemplate} onSaveShader={saveLibraryShader}/>
      {:else if tab==='assets'}
        <AssetLibrary bind:this={assetLibrary} {project} files={assets} {shaderDefinitions} initialKind={assetKind==='tile'?'tile':''}
          previewFor={libraryPreview} onUpload={uploadLibraryAsset} onEdit={editLibraryAsset} onOpen={openLibraryAsset} onEditSource={editSourceFile} onShader={openShaderWorkspace}>
          {#snippet fontTools(visible)}
            <Bitfonts bind:this={bitfontsPanel} controlsVisible={visible} fonts={project.bitfonts??{}}
              sources={assets} onImport={data=>{recordFile(data.edit,'font source import');if(!assets.includes(data.path))assets=[...assets,data.path].sort();}}
              onSave={(id,config)=>{
                (project.bitfonts??={})[id]=config;
                updateDirty('bitfont settings');
              }}/>
          {/snippet}
        </AssetLibrary>
      {:else if tab==='actors'}
        <section class="card asseteditor">
          <div class="row heading"><h2>Entities</h2><button onclick={openEntityForm}><Plus size={16}/>New entity…</button></div>
          <div class="field-row"><label>Entity type<select aria-label="Entity type" bind:value={spriteId}>
            {#each Object.keys(project.sprites??{}) as id}<option value={id}>{project.sprites[id].title??id}</option>{/each}
          </select></label>
          {#if spriteId}<button class="primary" onclick={()=>openDefinition(spriteId,'blocks')}><Blocks size={15}/>Open script</button>{/if}</div>
          {#if sprite}
              <div class="asset-source entity-art-source">
                <label class="stack">Source file <select value={sprite.source} onchange={e=>{
                  if(sprite.source!==e.currentTarget.value){
                    delete sprite.animation;
                    set(sprite,'source',e.currentTarget.value);
                  }
                }}>
                  {#each artFiles as file}<option value={file}>{file}</option>{/each}
                </select></label>
                {@render editSource(sprite.source)}
              </div>
              <div class="row">
                <button disabled={!art[sprite.source]?.width} onclick={()=>editingColliders=spriteId}>Edit frame colliders…</button>
              </div>
              {#key spriteId}
                <EntityTags tags={entityTagLabels} selected={sprite.components??[]} resolveTag={resolveEntityTag} onChange={value=>set(sprite,'components',value)}/>
              {/key}
          {/if}
        </section>
      {/if}
      </section>{/if}
    </div>
    {#if hasInspector}<aside class="inspector card">
      {#if tab==='room' && room}
        <div class="panel-tabs row">
          {#each [['layers','Layers'],['room','Room'],['instances','Placed entities']] as [id,label]}
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
          <p class="muted">{roomView==='top_down'?'Top-down':'Platformer'}</p>
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
              <Layers3 size={14}/><span>{item.name}</span><small>{(roomAuthoring[roomId]?.collision[index]??item.collidable)?'Collision on':'Visual only'}</small>
            </button>
          {/each}
          {#if layer}
            <label class="stack">Layer name <input value={layer.name} onchange={e=>changeLayer('name',e.currentTarget.value)}></label>
            <button class="small-button" onclick={openRoomScript}>Configure layer in script</button>
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
          {#if !room.entities.length}<p class="muted">Use Place entity on the room toolbar to add one.</p>{/if}
          <div class="instance-list">
            {#if room.entities.length>8}<input type="search" aria-label="Find placed entities" placeholder="Find placed entities" bind:value={instanceFilter}>{/if}
            <PagedList items={Object.entries(room.entities)} text={entry=>(entry[1].name??'')+' '+entry[1].sprite} query={room.entities.length>8?instanceFilter:''} label="placed entities">{#snippet children([key,entity])}
              {@const index=Number(key)}
              {@const player=roomAuthoring[roomId]?.players[entity.name??entity.sprite] ?? (roomAuthoring[roomId]?null:entity.player)}
              <button class="item" class:selected={selectedEntity===index} onclick={()=>{selectedEntity=index;mapTool='select';}}>
                <span>{entity.name ?? entity.sprite}</span>{#if player!=null}<small>Player {player+1}</small>{/if}
              </button>
            {/snippet}</PagedList>
          </div>
          {#if actor}
            {@const definition=project.sprites[actor.sprite]}
            <div class="row instance-source">
              <small>Entity type: {actor.sprite}</small>
              <button class="small-button" onclick={()=>openDefinition(actor.sprite)}>Edit type</button>
              <button class="small-button" onclick={()=>openDefinition(actor.sprite,'blocks')}>Open script</button>
            </div>
            <label class="stack">Name in this room <input maxlength="64" value={actor.name} onchange={e=>changeActor('name',e.currentTarget.value)}></label>
            <div class="pair">
              <label class="stack">X position <input type="number" min="0" value={actor.x} onchange={e=>changeActor('x',e.currentTarget.valueAsNumber)}></label>
              <label class="stack">Y position <input type="number" min="0" value={actor.y} onchange={e=>changeActor('y',e.currentTarget.valueAsNumber)}></label>
            </div>
            {#key actor.name}
              <EntityTags tags={entityTagLabels} selected={actor.components??[]} inherited={definition?.components??[]}
                resolveTag={resolveEntityTag} onChange={value=>changeActor('components',value)}/>
            {/key}
            <button class="small-button" onclick={openRoomScript}>Configure in room script</button>
            <button class="small-button remove" onclick={()=>{editRoom(next=>next.entities.splice(selectedEntity,1));selectedEntity=-1;}}>Remove from room</button>
          {/if}
        {/if}
      {:else}
        <div class="heading row"><h2>Tile script</h2></div>
        {#if tileArt[tileId]?.length}
          {@const variant=Math.min(Number(editTileVariant),tileArt[tileId].length-1)}
          <div class="row">
            <SearchSelect label="Tile script variant" value={String(variant)}
              options={tileArt[tileId].map((_,index)=>({value:String(index),label:'Variant '+(index+1)}))}
              onChange={value=>editTileVariant=value}/>
            <button class="primary" onclick={()=>openTileScript(tileId,variant)}>Edit tile script</button>
          </div>
        {/if}
      {/if}
    </aside>{/if}
  </main>
  {#if editingColliders && project.sprites[editingColliders]}
    {@const entity=project.sprites[editingColliders]}
    <ColliderEditor {entity} art={art[entity.source]} onClose={()=>editingColliders=''}
      onApply={value=>{set(entity,'frameColliders',value);editingColliders='';}}/>
  {/if}
  {#if addForm}
    <Modal title="New entity" {busy} onClose={()=>addForm=false}>
      <form onsubmit={event=>{event.preventDefault();createEntity();}}>
        <label>Name<input bind:value={newId} required maxlength="100" disabled={busy}></label>
        <div class="row asset-source">
          <SearchSelect label="Source file" value={newSource}
            options={[...new Set([...(importFile?[importFile.name]:[]),...artFiles])].map(value=>({value,label:project.assetInfo?.[value]?.name??value.split('/').at(-1)}))}
            onChange={value=>{if(value!==importFile?.name)selectSource(value);}} disabled={busy}/>
          <button type="button" disabled={busy} onclick={()=>filePicker.click()}>Browse device…</button>
          <input hidden type="file" bind:this={filePicker} accept=".ase,.aseprite,.png"
            onchange={event=>{const file=event.currentTarget.files[0];if(file)selectSource(file.name,file);event.currentTarget.value='';}}>
        </div>
        {#if assetError}<p class="error" role="alert">{assetError}</p>{/if}
        <div class="dialog-actions">
          <button type="button" disabled={busy} onclick={()=>addForm=false}>Cancel</button>
          <button class="primary" disabled={busy||!newSource}>{busy?'Creating…':'Create'}</button>
        </div>
      </form>
    </Modal>
  {/if}
  {#if roomOperation==='create'}
    <Modal title="New Room" onClose={()=>roomOperation=''}>
      <form onsubmit={event=>{event.preventDefault();addRoom();}}>
        <label>Room name<input bind:value={newRoomName} maxlength="100" required></label>
        <label>Room template<select bind:value={newRoomView}><option value="platformer">Platformer</option><option value="top_down">Top-down</option></select></label>
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
  .asseteditor,.empty{padding:.8rem;}
  .asseteditor .stack{max-width:34rem;}
  .start-room{margin-bottom:.15rem;}
  .asset-source{align-items:end;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.45rem;}
  .project-options{display:grid;gap:.75rem}
  .project-options section{display:grid;gap:.38rem;border-top:1px solid var(--line);padding-top:.5rem}
  .project-options h3{color:var(--text);font-size:.83rem;margin:0}
  .code-actions{justify-content:flex-end;padding-bottom:.3rem}
  .cover-preview{width:4rem;height:4rem;object-fit:contain;background:var(--well);border:1px solid var(--line)}
  .instance-list{display:grid;gap:1px;}
  .instance-source{margin-top:.55rem;}
  .instance-source small{flex-basis:100%;font-size:.72rem;}
  .entity-art-source,.asseteditor :global(.tags){max-width:34rem;}
  .mobile-tabs{display:none;}
  main.wide{grid-template-columns:minmax(155px,185px) minmax(0,1fr);}
  main.shader-mode{grid-template-columns:minmax(0,1fr)}
  main.shader-mode[data-pane="Editor"]>.project{display:none}
  .pair{grid-template-columns:repeat(2,minmax(0,1fr));}
  option,label{overflow-wrap:anywhere}
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
  .inline-playtest{display:block;width:100%;height:min(70dvh,48rem);border:0;background:#12121a}
  .playtest-toolbar{margin-bottom:.55rem}
  .work{display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden;min-height:0}
  .author-panes[hidden]{display:none}
  .author-panes{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:.35rem;min-height:0}
  .code-pane,.map-pane{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
  .code-pane{contain:paint}
  .code-pane[hidden],.map-pane[hidden]{display:none}
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
</style>
