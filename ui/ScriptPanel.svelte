<script>
  import {initialScript} from '../src/schema.mjs';
  import {draftFile} from './recovery.js';
  import { onMount,tick } from 'svelte';
  import { blockCategories, mountBlocks } from './blocks.js';
  import {mountText,validateText} from './text-editor.js';
  import Modal from './Modal.svelte';
  import RoutineEditor from './RoutineEditor.svelte';
  import ScriptConstants from './ScriptConstants.svelte';
  import {Ellipsis, FileCode, Maximize} from '@lucide/svelte';
  import {validateCollections} from '../src/collections.mjs';
  import {movementPreset} from '../src/movement-preset.mjs';
  import {resourceName} from '../src/resource-name.mjs';
  import {formatScript,parseScript,replaceScriptConstants} from '../src/wafflescript.mjs';
  let modules=$state([]),selected=$state(''),newModule=$state(''),dialog=$state('');
  let preset=$state('platformer'),dynamic=$state(false),replaceLegacy=$state(false),dialogError=$state('');
  const endpoint=()=>selected?'./api/module/'+encodeURIComponent(selected):isGame?'./api/game-script':isTile?'./api/tile-script/'+encodeURIComponent(sprite)+'/'+variant:(isRoom?'./api/room-script/':'./api/script/')+encodeURIComponent(sprite);
  let textHost,textEditor,original;
  let { sprite, isRoom=false, isGame=false, isTile=false, variant=0, title=sprite, tileScripts=[], roomScripts, entityScripts, onSelectFile, sprites, actorDefinition, animations, newActor, items, textKeys, localization, menus, references, actions, onBeforeSave, hasLegacyMovement, initialMovement, onMovementPreset, dirty = $bindable(false), status=$bindable(''), mode=$bindable('blocks'), onSave,onFileEdit,onNewEvent,onNewField } = $props();
  const baseFile=$derived(isGame?'game':isTile?'tile:'+sprite+':'+variant:(isRoom?'room:':'entity:')+sprite);
  const currentFile=$derived(selected?'module:'+selected:baseFile);
  const registry=()=>({localization,shaders:references.shaders,collections:validateCollections(references.collections),propertyAliases:references.propertyAliases,fonts:references.fontsLabels,events:references.eventsLabels,constants:references.gameConstants,gameScript:isGame&&!selected,tileScript:isTile&&!selected,roomScript:selected?undefined:isRoom||isGame,tiles:Object.fromEntries((references.tiles??[]).map(id=>[id,true])),sounds:Object.fromEntries(references.sounds.map(id=>[id,true])),sprites:Object.fromEntries(sprites.map(id=>[id,true])),items:Object.fromEntries(items.map(id=>[id,true])),controls:Object.fromEntries(actions.map(id=>[id,true])),text:Object.fromEntries(textKeys.map(id=>[id,true])),menus:Object.fromEntries(menus.map(id=>[id,true])),flags:Object.fromEntries(references.flags.map(id=>[id,true]))});
  let timer,pendingSave,editNumber=0,saving=$state(false);
  let draft,recovered=$state(false);
  function changed(){
    if(!ready)return;
    editNumber++;dirty=true;
    clearTimeout(timer);timer=setTimeout(flush,650);
    draft.write(mode==='text'?{mode,source:textEditor.source()}:{mode,workspace:blockEditor.draft()});
  }
  let host, blockEditor=$state.raw(), version=0;
  let compactToolbox=$state(false), selectedCategory=$state(-1), routineEditor=$state.raw(null);
  let constantsEditor=$state.raw(null);
  let importsRequest=0;
  async function routineModules(imports){
    const current=++importsRequest;
    if(!imports.length){blockEditor?.setRoutineModules({});return;}
    try{
      const response=await fetch('./api/modules',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imports})});
      const modules=await response.json();
      if(current===importsRequest&&response.ok)blockEditor?.setRoutineModules(modules);
    }catch{}
  }
  $effect(()=>{blockEditor?.updateRegistry(sprites,items,actions,animations,textKeys,menus,references);});
  let error=$state(''), ready=$state(false), busy=$state(false);
  $effect(()=>{status=recovered?'Recovered script draft':saving?'Saving script…':dirty?'Unsaved script':'';});
  onMount(()=>{
    blockEditor=mountBlocks(host,changed,sprites,items,actions,animations,textKeys,menus,references,(compact,index)=>{
      compactToolbox=compact;selectedCategory=index;
    },definition=>routineEditor=definition,routineModules,isRoom||isGame,editConstants,isGame?undefined:onNewEvent,isGame?undefined:onNewField,isGame,isTile);
    fetch('./api/modules').then(r=>r.json()).then(data=>{if(Array.isArray(data))modules=data;}).catch(err=>error=err.message);
    open(sprite);
    return ()=>{clearTimeout(timer);version++;importsRequest++;status='';blockEditor.dispose();textEditor?.dispose();};
  });
  async function switchMode(next){
    if(mode===next || busy)return;
    busy=true;error='';
    try{
      if(pendingSave)await pendingSave;
      if(next==='text'){
        const unit=blockEditor.save();
        const source=original?.source && formatScript(original)===formatScript(unit)?original.source:formatScript(unit);
        mode=next;await tick();textEditor=mountText(textHost,source,changed,selected,registry);textEditor.focus();
      }else{
        const source=textEditor.source(),unit=await validateText(source,selected,registry());
        unit.layout=original?.layout;original={...unit,source};blockEditor.load(unit);
        textEditor.dispose();textEditor=null;mode=next;
      }
    }catch(err){error=err.message;}finally{busy=false;}
  }
  async function open(id,discard=false){
    const current=++version;
    ready=false;
    error='';
    try{
      let data=initialScript(actorDefinition);
      if(selected || !newActor){
        const response=await fetch(endpoint());
        data=await response.json();
        if(!response.ok)throw Error(data.error);
      }
      if(current!==version)return;
      draft=draftFile(endpoint(),message=>error=message);
      let previous=discard?(await draft.write(null),null):await draft.read();
      if(current!==version)return;
      if(previous?.mode==='text' && previous.source===(data.source??formatScript(data))){
        await draft.write(null);previous=null;
      }
      original=data;textEditor?.dispose();textEditor=null;
      blockEditor.setRoomContext((isRoom||isGame)&&!selected,isGame&&!selected,isTile&&!selected,Boolean(selected));
      blockEditor.load(data);
      recovered=!!previous;dirty=recovered;
      mode=previous?.mode??mode;
      if(mode==='text'){
        await tick();if(current!==version)return;
        textEditor=mountText(textHost,previous?.source??data.source??formatScript(data),changed,selected,registry);
      }else if(previous)blockEditor.restoreDraft(previous.workspace);
      ready=true;
      if(recovered){clearTimeout(timer);timer=setTimeout(flush,650);}
    }catch(err){if(current===version)error=err.message;}
  }
  export async function selectBase(){
    if(!selected)return true;
    if(!await flush())return false;
    selected='';
    await open(sprite);
    return true;
  }
  async function chooseFile(picker){
    const next=picker.value;
    if(next===currentFile)return;
    picker.value=currentFile;
    const [kind,id,variant]=next.split(':');
    if(next===baseFile){await selectBase();return;}
    if(kind==='module'){
      if(!await flush())return;
      selected=id;
      await open(sprite);
    }else await onSelectFile(kind,id,Number(variant));
  }
  export async function flush(){
    while(ready&&dirty){
      clearTimeout(timer);
      if(!pendingSave){
        if(busy){await tick();return false;}
        pendingSave=save().finally(()=>pendingSave=null);
      }
      if(!await pendingSave)return false;
    }
    return true;
  }
  async function save(){
    saving=true;
    const generation=editNumber;
    try{
      const source=mode==='text'?textEditor.source():null;
      const data=source!==null?await validateText(source,selected,registry()):blockEditor.save();
      if(source!==null){data.layout=original?.layout;data.source=source;}
      else if(original?.source && formatScript(original)===formatScript(data))data.source=original.source;
      if(!await onBeforeSave())return false;
      const result=await fetch(endpoint(),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      if(!result.ok)throw Error((await result.json()).error);
      onFileEdit((await result.json()).edit,'script edit in '+(selected||sprite));original=data;
      if(!selected)await onSave(sprite,isRoom,isGame,data,isTile);
      error='';
      if(generation===editNumber){dirty=false;recovered=false;await draft.write(null);}
      return true;
    }catch(err){error=err.message;return false;}finally{saving=false;}
  }
  function closeDiscard(){
    dialog='';
    if(dirty)timer=setTimeout(flush,650);
  }
  function editConstants(){
    try{
      const source=mode==='text'?textEditor.source():null;
      const unit=source===null?blockEditor.save():parseScript(source);
      constantsEditor={source,unit};error='';
    }catch(err){error=err.message;}
  }
  async function applyConstants(constants){
    const {source,unit}=constantsEditor;
    const next=source===null?formatScript({...unit,constants}):replaceScriptConstants(source,unit,constants);
    await validateText(next,selected,registry());
    if(source===null)blockEditor.setConstants(constants);
    else textEditor.replace(next);
    constantsEditor=null;
  }
  function chooseMovement(){
    preset=initialMovement;
    dynamic=!actorDefinition.physics?.mode || actorDefinition.physics.mode==='none';
    replaceLegacy=hasLegacyMovement;
    dialogError='';dialog='movement';
  }
  function addMovement(){
    try{
      const stack=movementPreset(preset),unit=parseScript('on tick\n'+stack+'end');
      if(mode==='text'){
        const source=textEditor.source();
        parseScript(source);
        const tick=/^\s*on tick(?:[ \t]*#[^\n]*)?[ \t]*\r?$/m.exec(source);
        if(tick){
          const lineEnd=source.indexOf('\n',tick.index+tick[0].length);
          textEditor.insert(lineEnd+1,stack);
        }else textEditor.insert(source.length,(source.endsWith('\n')?'':'\n')+'on tick\n'+stack+'end\n');
      }else{
        const data=blockEditor.save();
        data.events.tick=[...unit.events.tick,...(data.events.tick??[])];
        blockEditor.load(data);
        changed();
      }
      onMovementPreset({dynamic,replaceLegacy});
      dialog='';
    }catch(err){dialogError=err.message;}
  }
  async function createModule(){
    if(!newModule.trim() || busy)return;
    const name=resourceName(newModule,'module',[Object.fromEntries(modules.map(value=>[value,true]))]);
    busy=true;dialogError='';
    try{
      const r=await fetch('./api/module/'+name,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:{}})});
      if(!r.ok)throw Error((await r.json()).error);
      onFileEdit((await r.json()).edit,'creation of '+name);
      selected=name;modules=[...modules,name].sort();dialog='';await open(sprite);
    }catch(err){dialogError=err.message;}finally{busy=false;}
  }
  let scriptMenu=$state(), menuTrigger=$state();
  function closeScriptMenu(restoreFocus=false){
    if(!scriptMenu?.open)return;
    scriptMenu.open=false;
    if(restoreFocus)menuTrigger?.focus({preventScroll:true});
  }
  function scriptMenuKeys(event){
    if(!scriptMenu?.open)return;
    if(event.key==='Escape'){
      event.preventDefault();closeScriptMenu(true);return;
    }
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    const actions=[...scriptMenu.querySelectorAll('button:not(:disabled)')];
    if(!actions.length)return;
    event.preventDefault();
    const index=actions.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?actions.length-1:
      index<0?(event.key==='ArrowDown'?0:actions.length-1):
      (index+(event.key==='ArrowDown'?1:-1)+actions.length)%actions.length;
    actions[next].focus();
  }
</script>
<svelte:window onpointerdown={event=>{if(!scriptMenu?.contains(event.target))closeScriptMenu();}}
  onkeydown={event=>{if(scriptMenu?.contains(event.target))scriptMenuKeys(event);}}/>
<section class="card script-editor">
  <header class="script-header">
    <div class="script-tools">
      <div class="file-picker">
        <FileCode size={16} aria-hidden="true"/>
        <select aria-label="Script file" title={selected?selected+'.ws':title} value={currentFile}
          disabled={!ready||busy} onchange={event=>chooseFile(event.currentTarget)}>
          <option value="game">Game script</option>
          {#if roomScripts.length}<optgroup label="Room scripts">
            {#each roomScripts as {id,title}}<option value={'room:'+id}>{title} · Room script</option>{/each}
          </optgroup>{/if}
          {#if entityScripts.length}<optgroup label="Entity scripts">
            {#each entityScripts as {id,title}}<option value={'entity:'+id}>{title}</option>{/each}
          </optgroup>{/if}
          {#if tileScripts.length}<optgroup label="Tile scripts">
            {#each tileScripts as {id,variant,title}}<option value={'tile:'+id+':'+variant}>{title}</option>{/each}
          </optgroup>{/if}
          {#if modules.length}<optgroup label="Modules">
            {#each modules as name}<option value={'module:'+name}>{name}.ws</option>{/each}
          </optgroup>{/if}
        </select>
      </div>
      {#if compactToolbox && mode==='blocks'}
        <select class="category-picker" aria-label="Block category" value={String(selectedCategory)} disabled={!ready||busy}
          onchange={event=>blockEditor.selectCategory(Number(event.currentTarget.value))}>
          <option value="-1">Add block</option>
          {#each blockCategories((isRoom||isGame)&&!selected,isGame&&!selected,isTile&&!selected,Boolean(selected)) as category,index}<option value={String(index)}>{category}</option>{/each}
        </select>
      {/if}
      <div class="edit-tools">
        <div class="view-switch" role="group" aria-label="Script view">
          <button aria-pressed={mode==='blocks'} disabled={!ready||busy} onclick={()=>switchMode('blocks')}>Blocks</button>
          <button aria-pressed={mode==='text'} disabled={!ready||busy} onclick={()=>switchMode('text')}>Text</button>
        </div>
        {#if mode==='blocks'}
          <button class="icon-button" aria-label="Fit blocks" title="Fit blocks" disabled={!ready||busy} onclick={()=>blockEditor.fit()}><Maximize/></button>
        {/if}
        <details class="script-menu" bind:this={scriptMenu}
          onfocusout={event=>{if(!scriptMenu.contains(event.relatedTarget))closeScriptMenu();}}>
          <summary bind:this={menuTrigger} aria-label="Script actions" title="Script actions"><Ellipsis size={18}/></summary>
          <div class="command-list card">
            <button onclick={()=>{closeScriptMenu(true);onNewEvent();}}>New event…</button>
            <button disabled={!ready||busy} onclick={()=>{closeScriptMenu(true);editConstants();}}>Constants…</button>
            <button disabled={dirty||busy} onclick={()=>{closeScriptMenu(true);newModule='';dialogError='';dialog='module';}}>New module…</button>
            {#if !selected&&!isRoom&&!isGame&&!isTile}<button disabled={!ready||busy} onclick={()=>{closeScriptMenu(true);chooseMovement();}}>Movement preset…</button>{/if}
            {#if dirty}<button disabled={busy||saving} onclick={()=>{closeScriptMenu(true);clearTimeout(timer);dialog='discard';}}>Discard draft…</button>{/if}
          </div>
        </details>
      </div>
    </div>
  </header>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <div inert={busy||!ready} hidden={mode!=='blocks'} class="workspace block-workspace" bind:this={host}></div>
  <div inert={busy||!ready} hidden={mode!=='text'} class="workspace" bind:this={textHost}></div>
</section>
{#if dialog==='movement'}
  <Modal title="Add Movement Blocks" {busy} onClose={()=>dialog=''}>
    <form onsubmit={event=>{event.preventDefault();addMovement();}}>
      <label>Movement<select bind:value={preset}><option value="platformer">Platformer</option><option value="top_down">Top-down</option></select></label>
      <p>The preset inserts editable input and movement blocks at the start of On tick.</p>
      <label class="check"><input type="checkbox" bind:checked={dynamic}> Set the entity’s body to Dynamic</label>
      {#if hasLegacyMovement}<label class="check"><input type="checkbox" bind:checked={replaceLegacy}> Turn off legacy movement on this entity’s instances</label>{/if}
      {#if dialogError}<p class="error" role="alert">{dialogError}</p>{/if}
      <div class="dialog-actions"><button type="button" onclick={()=>dialog=''}>Cancel</button><button class="primary">Add blocks</button></div>
    </form>
  </Modal>
{:else if dialog==='module'}
  <Modal title="New Module" {busy} onClose={()=>dialog=''}>
    <form onsubmit={event=>{event.preventDefault();createModule();}}>
      <label>Module name<input bind:value={newModule} required maxlength="100" disabled={busy}></label>
      {#if dialogError}<p class="error" role="alert">{dialogError}</p>{/if}
      <div class="dialog-actions"><button type="button" disabled={busy} onclick={()=>dialog=''}>Cancel</button><button class="primary" disabled={busy}>Create module</button></div>
    </form>
  </Modal>
{:else if dialog==='discard'}
  <Modal title="Discard Script Draft" {busy} onClose={closeDiscard}>
    <p>Discard the unsaved changes to {selected||sprite}?</p>
    <div class="dialog-actions"><button disabled={busy} onclick={closeDiscard}>Keep editing</button>
      <button class="primary" disabled={busy} onclick={()=>{dialog='';open(sprite,true);}}>Discard draft</button></div>
  </Modal>
{/if}
{#if routineEditor}
  <RoutineEditor definition={routineEditor} onClose={()=>routineEditor=null} onApply={(name,parameters)=>{
    blockEditor.editRoutine(routineEditor.id,name,parameters);routineEditor=null;
  }}/>
{/if}
{#if constantsEditor}
  <ScriptConstants constants={constantsEditor.unit.constants??{}} onClose={()=>constantsEditor=null} onApply={applyConstants}/>
{/if}
<style>
  .script-editor{display:flex;flex-direction:column;flex:1;min-height:0}
  .block-workspace :global(.blocklyToast[data-toast-id="copiedHint"]){display:none}
  .script-header{padding:.38rem;position:relative;z-index:4}
  .script-tools,.edit-tools,.file-picker,.view-switch{display:flex;align-items:center;min-width:0}
  .script-tools{gap:.45rem;justify-content:space-between;flex-wrap:wrap}
  .edit-tools{gap:.25rem;flex:none;margin-inline-start:auto}
  .file-picker{position:relative;flex:1 1 7rem;gap:.3rem;color:var(--muted)}
  .file-picker select{width:100%}
  .view-switch{gap:0}
  .view-switch button+button{margin-inline-start:-1px}
  .view-switch button[aria-pressed=true]{position:relative;background:#313244}
  .script-menu{position:relative}
  .script-menu summary{list-style:none;display:grid;place-items:center;box-sizing:border-box;width:var(--control-height);height:var(--control-height);
    border:1px solid var(--line);cursor:pointer}
  .script-menu summary::-webkit-details-marker{display:none}
  .script-menu[open] summary,.script-menu summary:hover{border-color:var(--accent)}
  .command-list{position:absolute;inset-block-start:calc(100% + .25rem);inset-inline-end:0;min-width:10rem;padding:.25rem;
    display:grid;gap:.2rem;box-shadow:0 4px 12px #0008}
  .command-list button{border-color:transparent}
  .workspace{flex:1 1 0;width:100%;min-height:0;overflow:hidden;border-top:1px solid var(--line)}
  .workspace[hidden]{display:none}
  .block-workspace :global(.gw-detached){opacity:.55}
  .block-workspace :global(.blocklyScrollbarHorizontal){display:none}
  .block-workspace :global(.blocklyToolboxCategory){margin:1px 0;padding-inline-end:.35rem}
  .block-workspace :global(.blocklyToolboxCategoryLabel){font-size:.75rem;font-weight:600}
  .category-picker{flex:0 1 auto;width:auto;max-width:100%}
  .error{flex:0 1 auto;overflow:auto;max-height:5rem;padding:0 .6rem .4rem}
</style>
