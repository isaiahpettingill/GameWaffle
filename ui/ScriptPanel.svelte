<script>
  import { onMount } from 'svelte';
  import { mountBlocks } from './blocks.js';
  let { sprite, dirty = $bindable(false), onSave } = $props();
  let host, blockEditor, version=0;
  let error=$state(''), ready=$state(false), busy=$state(false);
  onMount(()=>{
    blockEditor=mountBlocks(host,()=>{dirty=true;});
    open(sprite);
    return ()=>{version++;blockEditor.dispose();};
  });
  $effect(()=>{const id=sprite;if(blockEditor) open(id);});
  async function open(id){
    const current=++version;
    ready=false;
    error='';
    try{
      const response=await fetch(`./api/script/${encodeURIComponent(id)}`);
      const data=await response.json();
      if(!response.ok)throw Error(data.error);
      if(current!==version)return;
      blockEditor.load(data);
      dirty=false;
      ready=true;
    }catch(err){if(current===version)error=err.message;}
  }
  async function save(){
    busy=true;
    error='';
    try{
      const data=blockEditor.save();
      const result=await fetch(`./api/script/${encodeURIComponent(sprite)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      if(!result.ok)throw Error((await result.json()).error);
      dirty=false;
      await onSave(sprite);
    }catch(err){error=err.message;}finally{busy=false;}
  }
</script>
<section class="card">
  <div class="top row">
    <div><h2>{sprite}</h2><small>{dirty ? 'Unsaved script' : 'Sprite behavior'}</small></div>
    <div class="row options">
      {#if dirty}<button disabled={busy} onclick={()=>open(sprite)}>Discard</button>{/if}
      <button class="primary" disabled={!ready || !dirty || busy} onclick={save}>Save script</button>
    </div>
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <div class="workspace" bind:this={host}></div>
</section>
<style>
  section{overflow:hidden;}
  .top{justify-content:space-between;padding:.7rem .8rem;}
  h2{font-size:1rem;font-weight:700;}
  .workspace{height:clamp(400px,65vh,780px);width:100%;}
  .error{padding:0 .8rem .6rem;}
</style>
