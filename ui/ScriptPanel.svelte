<script>
  import {initialScript} from '../src/schema.mjs';
  import {draftFile} from './recovery.js';
  import { onMount,tick } from 'svelte';
  import { mountBlocks } from './blocks.js';
  import {mountText,validateText} from './text-editor.js';
  import {formatScript} from '../src/wafflescript.mjs';
  let modules=$state([]),selected=$state(''),newModule=$state(''),adding=$state(false);
  const endpoint=()=>selected?'./api/module/'+encodeURIComponent(selected):'./api/script/'+encodeURIComponent(sprite);
  let mode=$state('blocks'),textHost,textEditor,original;
  let { sprite, sprites, actorDefinition, animations, newActor, items, actions, onBeforeSave, dirty = $bindable(false), onSave,onFileEdit } = $props();
  const registry=()=>({items:Object.fromEntries(items.map(id=>[id,true])),controls:Object.fromEntries(actions.map(id=>[id,true]))});
  let timer,pendingSave,editNumber=0,saving=$state(false);
  let draft,recovered=$state(false);
  function changed(){
    if(!ready)return;
    editNumber++;dirty=true;
    clearTimeout(timer);timer=setTimeout(flush,650);
    draft.write(mode==='text'?{mode,source:textEditor.source()}:{mode,workspace:blockEditor.draft()});
  }
  let host, blockEditor=$state.raw(), version=0;
  $effect(()=>{blockEditor?.updateRegistry(sprites,items,actions,animations);});
  let error=$state(''), ready=$state(false), busy=$state(false);
  onMount(()=>{
    blockEditor=mountBlocks(host,changed,sprites,items,actions,animations);
    fetch('./api/modules').then(r=>r.json()).then(data=>{if(Array.isArray(data))modules=data;}).catch(err=>error=err.message);
    open(sprite);
    return ()=>{clearTimeout(timer);version++;blockEditor.dispose();textEditor?.dispose();};
  });
  async function switchMode(next){
    if(mode===next || busy)return;
    busy=true;error='';
    try{
      if(next==='text'){
        const unit=blockEditor.save();
        const source=original?.source && formatScript(original)===formatScript(unit)?original.source:formatScript(unit);
        mode=next;await tick();textEditor=mountText(textHost,source,changed,selected,registry());textEditor.focus();
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
      original=data;textEditor?.dispose();textEditor=null;mode="blocks";blockEditor.load(data);
      recovered=!!previous;dirty=recovered;
      if(previous?.mode==='text'){
        mode='text';await tick();if(current!==version)return;
        textEditor=mountText(textHost,previous.source,changed,selected,registry());
      }else if(previous)blockEditor.restoreDraft(previous.workspace);
      ready=true;
      if(recovered){clearTimeout(timer);timer=setTimeout(flush,650);}
    }catch(err){if(current===version)error=err.message;}
  }
  export async function flush(){
    clearTimeout(timer);
    while(pendingSave)await pendingSave;
    if(!ready || !dirty)return true;
    if(busy){await tick();return false;}
    pendingSave=save().finally(()=>pendingSave=null);
    return pendingSave;
  }
  async function save(){
    busy=true;saving=true;error='';
    const generation=editNumber;
    try{
      const source=mode==='text'?textEditor.source():null;
      const data=source!==null?await validateText(source,selected,registry()):blockEditor.save();
      if(source!==null){data.layout=original?.layout;data.source=source;}
      else if(original?.source && formatScript(original)===formatScript(data))data.source=original.source;
      if(!await onBeforeSave())return false;
      const result=await fetch(endpoint(),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      if(!result.ok)throw Error((await result.json()).error);
      onFileEdit((await result.json()).edit);original=data;
      if(!selected)await onSave(sprite);
      if(generation===editNumber){dirty=false;recovered=false;await draft.write(null);}
      return !dirty;
    }catch(err){error=err.message;return false;}finally{saving=false;busy=false;}
  }
</script>
<section class="card">
  <div class="top row">
    <div><h2>{sprite} · Code</h2><select aria-label="Script file" bind:value={selected} disabled={dirty || busy} onchange={()=>open(sprite)}>
      <option value="">{sprite}</option>{#each modules as name}<option value={name}>{name}.ws</option>{/each}
    </select><small>{recovered ? 'Recovered script draft' : busy ? 'Saving…' : dirty ? 'Draft' : 'Saved'}</small></div>
    <div class="row options">
      <button disabled={dirty||busy} onclick={()=>adding=!adding}>New module</button>
      <button aria-pressed={mode==='blocks'} disabled={!ready || busy} onclick={()=>switchMode('blocks')}>Blocks</button>
      <button aria-pressed={mode==='text'} disabled={!ready || busy} onclick={()=>switchMode('text')}>Text</button>
      {#if dirty}<button disabled={busy} onclick={()=>open(sprite,true)}>Discard</button>{/if}
      <button class="primary" disabled={!ready || !dirty || busy} onclick={flush}>Save now</button>
    </div>
  </div>
  {#if adding}<form class="field-row" onsubmit={async e=>{
    e.preventDefault();if(!/^[A-Za-z_]\w{0,63}$/.test(newModule)||modules.includes(newModule)){error='Choose a unique module name';return;}
    try{
      const r=await fetch('./api/module/'+newModule,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:{}})});
      if(!r.ok)throw Error((await r.json()).error);
      onFileEdit((await r.json()).edit);selected=newModule;modules=[...modules,newModule].sort();newModule='';adding=false;await open(sprite);
    }catch(err){error=err.message;}
  }}><label>Module name<input bind:value={newModule}/></label><button>Create</button></form>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <div inert={(busy&&!saving)||!ready} hidden={mode!=='blocks'} class="workspace" bind:this={host}></div>
  <div inert={(busy&&!saving)||!ready} hidden={mode!=='text'} class="workspace" bind:this={textHost}></div>
</section>
<style>
  section{overflow:hidden;}
  h2{font-size:1rem;margin-bottom:.35rem}
  .top{justify-content:space-between;padding:.7rem .8rem;}
  .workspace{height:clamp(400px,65vh,780px);width:100%;}
  .error{padding:0 .8rem .6rem;}
</style>
