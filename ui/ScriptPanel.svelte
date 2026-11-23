<script>
  import {draftFile} from './recovery.js';
  import { onMount,tick } from 'svelte';
  import { mountBlocks } from './blocks.js';
  import {mountText,validateText} from './text-editor.js';
  import {formatScript} from '../src/wafflescript.mjs';
  let modules=$state([]),selected=$state(''),newModule=$state(''),adding=$state(false);
  const endpoint=()=>selected?'./api/module/'+encodeURIComponent(selected):'./api/script/'+encodeURIComponent(sprite);
  let mode=$state('blocks'),textHost,textEditor,original;
  let { sprite, sprites, newActor, items, actions, onBeforeSave, dirty = $bindable(false), onSave,onFileEdit } = $props();
  const registry=()=>({items:Object.fromEntries(items.map(id=>[id,true])),controls:Object.fromEntries(actions.map(id=>[id,true]))});
  let draft,recovered=$state(false);
  function changed(){
    if(!ready)return;
    dirty=true;
    draft.write(mode==='text'?{mode,source:textEditor.source()}:{mode,workspace:blockEditor.draft()});
  }
  let host, blockEditor, version=0;
  let error=$state(''), ready=$state(false), busy=$state(false);
  onMount(()=>{
    blockEditor=mountBlocks(host,changed,sprites,items,actions);
    fetch('./api/modules').then(r=>r.json()).then(data=>{if(Array.isArray(data))modules=data;}).catch(err=>error=err.message);
    open(sprite);
    return ()=>{version++;blockEditor.dispose();textEditor?.dispose();};
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
      let data={events:{}};
      if(selected || !newActor){
        const response=await fetch(endpoint());
        data=await response.json();
        if(!response.ok)throw Error(data.error);
      }
      if(current!==version)return;
      draft=draftFile(endpoint(),message=>error=message);
      const previous=discard?(await draft.write(null),null):await draft.read();
      if(current!==version)return;
      original=data;textEditor?.dispose();textEditor=null;mode="blocks";blockEditor.load(data);
      recovered=!!previous;dirty=recovered;
      if(previous?.mode==='text'){
        mode='text';await tick();if(current!==version)return;
        textEditor=mountText(textHost,previous.source,changed,selected,registry());
      }else if(previous)blockEditor.restoreDraft(previous.workspace);
      ready=true;
    }catch(err){if(current===version)error=err.message;}
  }
  async function save(){
    if(!await onBeforeSave())return;
    busy=true;
    error='';
    try{
      const data=mode==='text'?await validateText(textEditor.source(),selected,registry()):blockEditor.save();
      if(mode==='text'){data.layout=original?.layout;data.source=textEditor.source();}
      else if(original?.source && formatScript(original)===formatScript(data))data.source=original.source;
      const result=await fetch(endpoint(),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      if(!result.ok)throw Error((await result.json()).error);
      onFileEdit((await result.json()).edit);dirty=false;recovered=false;await draft.write(null);
      original=data;if(!selected)await onSave(sprite);
    }catch(err){error=err.message;}finally{busy=false;}
  }
</script>
<section class="card">
  <div class="top row">
    <div><select aria-label="Script file" bind:value={selected} disabled={dirty || busy} onchange={()=>open(sprite)}>
      <option value="">{sprite}</option>{#each modules as name}<option value={name}>{name}.ws</option>{/each}
    </select><small>{recovered ? 'Recovered script draft' : dirty ? 'Unsaved script' : 'Actor script'}</small></div>
    <div class="row options">
      <button disabled={dirty||busy} onclick={()=>adding=!adding}>New module</button>
      <button aria-pressed={mode==='blocks'} disabled={!ready || busy} onclick={()=>switchMode('blocks')}>Blocks</button>
      <button aria-pressed={mode==='text'} disabled={!ready || busy} onclick={()=>switchMode('text')}>Text</button>
      {#if dirty}<button disabled={busy} onclick={()=>open(sprite,true)}>Discard</button>{/if}
      <button class="primary" disabled={!ready || !dirty || busy} onclick={save}>Save script</button>
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
  <div inert={busy||!ready} hidden={mode!=='blocks'} class="workspace" bind:this={host}></div>
  <div inert={busy||!ready} hidden={mode!=='text'} class="workspace" bind:this={textHost}></div>
</section>
<style>
  section{overflow:hidden;}
  .top{justify-content:space-between;padding:.7rem .8rem;}
  .workspace{height:clamp(400px,65vh,780px);width:100%;}
  .error{padding:0 .8rem .6rem;}
</style>
