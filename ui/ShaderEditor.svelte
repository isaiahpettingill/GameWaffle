<script>
  import {untrack} from 'svelte';
  import {Copy,LayoutGrid,Plus,Redo2,Trash2,Undo2} from '@lucide/svelte';
  import {Background,Controls,SvelteFlow} from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import ShaderNodePicker from './ShaderNodePicker.svelte';
  import ShaderNode from './ShaderNode.svelte';
  import ShaderPreview from './ShaderPreview.svelte';
  import {acceptsShaderType,analyzeShaderGraph,makeShaderNode,MAX_SHADER_NODES,shaderNodes} from '../src/shader-graph.mjs';
  import {fragmentOutput,nodeWidth,shaderDocument,shaderFlow,shaderWire,wireChange} from './shader-flow.js';

  let {id,name:initialName,document:sourceGraph,initialDraft,room,onSave,onDraft}=$props();
  const nodeTypes={shader:ShaderNode,fragment:ShaderNode};
  const initial=untrack(()=>shaderFlow(initialDraft?.graph??sourceGraph,nodeData));
  let nodes=$state.raw(initial.nodes),edges=$state.raw(initial.edges),viewport=$state(),canvas,workspace;
  let name=$state(untrack(()=>initialDraft?.name??initialName));
  let saved=$state(untrack(()=>{
    if(!id)return '';
    const {nodes,edges}=shaderFlow(sourceGraph,nodeData);
    return JSON.stringify({name:initialName,graph:shaderDocument(nodes,edges,{layout:true})});
  }));
  let picker=$state.raw(null),showPreview=$state(true);
  let canvasKey=$state(0),saving=$state(false),saveError=$state(''),compileError=$state('');
  let compiled=$state.raw(null),undoSteps=$state.raw([]),redoSteps=$state.raw([]);
  let keyboardSource=$state(''),reconnecting=null,dragStart,clipboard;
  let checkedGraph,wireChecks=new Map();
  const semantic=$derived(JSON.stringify(shaderDocument(nodes,edges)));
  const graph=$derived(JSON.parse(semantic));
  const inspection=$derived(analyzeShaderGraph(graph,{inspect:true}));
  const validation=$derived.by(()=>{
    try{analyzeShaderGraph(graph);return '';}
    catch(error){return error.message;}
  });
  const hasSelectedNodes=$derived(nodes.some(node=>node.selected&&node.id!==fragmentOutput));
  const hasSelection=$derived(hasSelectedNodes||edges.some(edge=>edge.selected));
  const working=$derived({name,graph:snapshot()});
  const dirty=$derived(JSON.stringify(working)!==saved);

  $effect(()=>{onDraft(dirty?working:null);});

  $effect(()=>{
    const payload=semantic, invalid=validation;
    compileError='';
    if(invalid)return;
    const abort=new AbortController();
    const timer=setTimeout(async()=>{
      try{
        const response=await fetch('./api/shaders/preview',{method:'POST',headers:{'Content-Type':'application/json'},
          body:payload,signal:abort.signal});
        const result=await response.json();
        if(abort.signal.aborted)return;
        if(!response.ok)throw Error(result.error);
        compiled=result;
      }catch(error){if(!abort.signal.aborted)compileError=error.message;}
    },210);
    return ()=>{abort.abort();clearTimeout(timer);};
  });

  function nodeData(entry){
    return {entry,type:id=>inspection.definitions.get(id)?.type??shaderNodes[entry.kind].type,
      connected:(id,handle)=>edges.some(edge=>edge.target===id&&edge.targetHandle===handle),update,keyboardWire};
  }
  function snapshot(){return shaderDocument(nodes,edges,{layout:true});}
  function checkpoint(prior=snapshot()){
    undoSteps=[...undoSteps.slice(-49),prior];
    redoSteps=[];
    saveError='';
  }
  function restore(document){
    ({nodes,edges}=shaderFlow(document,nodeData));
    keyboardSource='';
    saveError='';
  }
  function undo(){
    if(!undoSteps.length)return;
    redoSteps=[...redoSteps,snapshot()];
    restore(undoSteps.at(-1));
    undoSteps=undoSteps.slice(0,-1);
  }
  function redo(){
    if(!redoSteps.length)return;
    undoSteps=[...undoSteps,snapshot()];
    restore(redoSteps.at(-1));
    redoSteps=redoSteps.slice(0,-1);
  }
  function beginDrag(){dragStart??=snapshot();}
  function endDrag(){
    if(dragStart&&nodes.some(({id,position})=>dragStart.layout[id]?.[0]!==position.x||dragStart.layout[id]?.[1]!==position.y))
      checkpoint(dragStart);
    dragStart=undefined;
  }

  function nextIndex(){return Math.max(0,...nodes.filter(node=>node.id!==fragmentOutput).map(node=>Number(node.id.slice(1))))+1;}
  function positionNewNode(){
    const {x=0,y=0,zoom=1}=viewport??{};
    const origin={x:((canvas.clientWidth/2-x)/zoom)-nodeWidth/2,y:(canvas.clientHeight/2-y)/zoom-45};
    for(let offset=0;offset<nodes.length;offset++){
      const position={x:origin.x+(offset%3)*48,y:origin.y+Math.floor(offset/3)*58+(offset%3)*24};
      if(!nodes.some(node=>Math.abs(node.position.x-position.x)<80&&Math.abs(node.position.y-position.y)<52))return position;
    }
    return origin;
  }
  function flowNode(entry,position){
    return {id:entry.id,type:'shader',position,data:nodeData(entry),selected:true,dragHandle:'.shader-node-title'};
  }
  function openPicker(event,source){
    event?.preventDefault();
    if(nodes.length-1>=MAX_SHADER_NODES)return;
    const point=event?.changedTouches?.[0]??event;
    const bounds=canvas.getBoundingClientRect();
    const {x=0,y=0,zoom=1}=viewport??{};
    picker={source,sourceType:source?inspection.definitions.get(source)?.type:null,
      position:point?{x:(point.clientX-bounds.left-x)/zoom,y:(point.clientY-bounds.top-y)/zoom}:null};
  }
  function connectionEnded(event,{fromHandle,toHandle}){
    if(reconnecting||fromHandle?.type!=='source'||toHandle||!(event.target instanceof Element)||
      !canvas.contains(event.target)||event.target.closest('.svelte-flow__node,.svelte-flow__edge,.svelte-flow__panel'))return;
    openPicker(event,fromHandle.nodeId);
  }
  function addNode(kind){
    if(!kind||nodes.length-1>=MAX_SHADER_NODES)return;
    checkpoint();
    const entry=makeShaderNode('n'+nextIndex(),kind);
    nodes=[...nodes.map(node=>({...node,selected:false})),flowNode(entry,picker?.position??positionNewNode())];
    if(picker?.source&&picker.sourceType){
      const index=shaderNodes[kind].ports.findIndex(({type})=>acceptsShaderType(type,picker.sourceType));
      if(index>=0)edges=[...edges,shaderWire(picker.source,entry.id,String(index))];
    }
    picker=null;
  }
  function update(id,changes){
    const prior=nodes.find(node=>node.id===id);
    if(!prior||Object.entries(changes).every(([key,value])=>JSON.stringify(prior.data.entry[key])===JSON.stringify(value)))return;
    checkpoint();
    nodes=nodes.map(node=>node.id===id?{...node,data:nodeData({...node.data.entry,...changes})}:node);
  }
  function removeSelection(){
    if(!hasSelection)return;
    checkpoint();
    const removed=new Set(nodes.filter(node=>node.selected&&node.id!==fragmentOutput).map(node=>node.id));
    nodes=nodes.filter(node=>!removed.has(node.id));
    edges=edges.filter(edge=>!edge.selected&&!removed.has(edge.source)&&!removed.has(edge.target));
    keyboardSource='';
  }
  function selectedGraph(){
    const selected=nodes.filter(node=>node.selected&&node.id!==fragmentOutput);
    if(!selected.length)return null;
    const keys=new Set(selected.map(node=>node.id));
    return {nodes:selected.map(({data,position})=>({entry:data.entry,position})),
      edges:edges.filter(edge=>keys.has(edge.source)&&keys.has(edge.target))};
  }
  function paste(elements){
    if(!elements||nodes.length-1+elements.nodes.length>MAX_SHADER_NODES)return;
    checkpoint();
    let index=nextIndex();
    const ids=new Map(),names=new Set(nodes.map(node=>node.data.entry?.name).filter(Boolean));
    const added=elements.nodes.map(({entry,position})=>{
      const id='n'+index++;
      ids.set(entry.id,id);
      let name=entry.name;
      if(name){
        const base=name.slice(0,26);
        for(let i=2;names.has(name);i++)name=base+'_'+i;
        names.add(name);
      }
      return flowNode({...entry,id,...(name?{name}:{})},{x:position.x+34,y:position.y+34});
    });
    nodes=[...nodes.map(node=>({...node,selected:false})),...added];
    edges=[...edges.map(edge=>({...edge,selected:false})),...elements.edges.map(edge=>shaderWire(ids.get(edge.source),ids.get(edge.target),edge.targetHandle))];
  }
  function arrange(){
    checkpoint();
    restore(graph);
    viewport=undefined;
    canvasKey++;
  }

  function validWire(connection){
    const {source,target,targetHandle}=connection;
    const type=inspection.definitions.get(source)?.type;
    if(!type||source===target)return false;
    const entry=nodes.find(node=>node.id===target)?.data.entry;
    const expected=target===fragmentOutput&&targetHandle==='color'?'vec4':shaderNodes[entry?.kind]?.ports[Number(targetHandle)]?.type;
    if(!expected||!acceptsShaderType(expected,type))return false;
    if(checkedGraph!==graph){checkedGraph=graph;wireChecks=new Map();}
    const key=[source,target,targetHandle,reconnecting].join(':');
    if(!wireChecks.has(key)){
      const next=shaderDocument(nodes,wireChange(edges,connection,reconnecting));
      const after=analyzeShaderGraph(next,{inspect:true});
      const preservesOutput=!next.output||after.definitions.get(next.output)?.type==='vec4'||
        target!==fragmentOutput&&inspection.definitions.get(graph.output)?.type!=='vec4';
      const valid=preservesOutput&&(target===fragmentOutput||after.definitions.has(target))
        &&![...after.errors.keys()].some(node=>!inspection.errors.has(node));
      wireChecks.set(key,valid);
    }
    return wireChecks.get(key);
  }
  function connect(connection){
    if(validWire(connection)){
      const targetEdge=edges.find(edge=>edge.target===connection.target&&edge.targetHandle===connection.targetHandle);
      if(targetEdge?.source!==connection.source||reconnecting&&reconnecting!==targetEdge.id){
        checkpoint();
        edges=wireChange(edges,connection,reconnecting);
      }
    }
    keyboardSource='';
    return false;
  }
  function keyboardWire(id,handle,source){
    if(source){keyboardSource=keyboardSource===id?'':id;return;}
    if(keyboardSource)connect({source:keyboardSource,sourceHandle:'result',target:id,targetHandle:handle});
  }
  function keys(event){
    if(picker||!(event.target instanceof Element)||!workspace?.contains(event.target))return;
    const command=event.ctrlKey||event.metaKey,key=event.key.toLowerCase();
    if(command&&key==='s'){
      event.preventDefault();
      if(event.target.matches('input'))event.target.blur();
      save();
      return;
    }
    if(event.target.closest('input,select,textarea,[contenteditable=true]'))return;
    if(command&&key==='z'){
      event.preventDefault();if(event.shiftKey)redo();else undo();
    }else if(command&&key==='y'){
      event.preventDefault();redo();
    }else if(command&&key==='c'&&hasSelectedNodes){
      event.preventDefault();clipboard=selectedGraph();
    }else if(command&&key==='v'&&clipboard){
      event.preventDefault();paste(clipboard);
    }else if(command&&key==='d'&&hasSelectedNodes){
      event.preventDefault();paste(selectedGraph());
    }else if((key==='delete'||key==='backspace')&&hasSelection){
      event.preventDefault();removeSelection();
    }else if(!command&&key==='a'){
      event.preventDefault();openPicker();
    }else if(key==='escape'&&keyboardSource){
      event.preventDefault();keyboardSource='';
    }
  }
  async function save(){
    if(saving||validation||!name.trim()||!dirty)return;
    const previousName=name, data={name:name.trim(),graph:snapshot()};
    saving=true;saveError='';
    try{
      await onSave({id,...data});
      saved=JSON.stringify(data);
      if(name===previousName)name=data.name;
    }
    catch(error){saveError=error.message;}finally{saving=false;}
  }
</script>

<svelte:window onkeydown={keys}/>
<section class="workspace card" aria-label="Shader editor" bind:this={workspace}>
    <header class="shader-toolbar">
      <input class="name" aria-label="Shader name" placeholder="Shader name" maxlength="100" bind:value={name}>
      <div class="save-actions">
        <small>{dirty?'Unsaved changes':'Saved'}</small>
        <button type="button" class="primary" onclick={save} disabled={saving||!dirty||Boolean(validation)||!name.trim()}>{saving?'Saving…':'Save shader'}</button>
      </div>
    </header>
    <div class="workspace-panes" class:with-preview={showPreview}>
      <div class="graph">
        <div class="graph-tools">
          <button type="button" aria-label="Add shader node" title="Add node (A)" onclick={()=>openPicker()}
            disabled={nodes.length-1>=MAX_SHADER_NODES}><Plus size={15}/>Add node…</button>
          <button type="button" class="icon-button" aria-label="Undo graph edit" title="Undo" disabled={!undoSteps.length} onclick={undo}><Undo2 size={16}/></button>
          <button type="button" class="icon-button" aria-label="Redo graph edit" title="Redo" disabled={!redoSteps.length} onclick={redo}><Redo2 size={16}/></button>
          <button type="button" class="icon-button" aria-label="Duplicate selected nodes" title="Duplicate" disabled={!hasSelectedNodes} onclick={()=>paste(selectedGraph())}><Copy size={15}/></button>
          <button type="button" class="icon-button" aria-label="Delete selection" title="Delete selection" disabled={!hasSelection} onclick={removeSelection}><Trash2 size={15}/></button>
          <button type="button" class="icon-button" aria-label="Arrange shader nodes" title="Arrange nodes" onclick={arrange}><LayoutGrid size={16}/></button>
          <button type="button" class="preview-toggle" aria-pressed={showPreview} onclick={()=>showPreview=!showPreview}>Preview</button>
        </div>
        <section class="canvas" aria-label="Shader graph" bind:this={canvas}>
          {#key canvasKey}
            <SvelteFlow bind:nodes bind:edges bind:viewport {nodeTypes} fitView fitViewOptions={{padding:0.12,maxZoom:1}}
              colorMode="dark" minZoom={0.16} maxZoom={2} panOnDrag={[0,1]} zoomOnDoubleClick={false}
              deleteKey={null} onbeforeconnect={connect} isValidConnection={validWire}
              onreconnectstart={(_,edge)=>reconnecting=edge.id} onreconnectend={()=>reconnecting=null}
              onbeforereconnect={connect} onnodedragstart={beginDrag} onnodedragstop={endDrag}
              onselectiondragstart={beginDrag} onselectiondragstop={endDrag}
              onpanecontextmenu={({event})=>openPicker(event)} onconnectend={connectionEnded}>
              <Background gap={20} size={1.25} color="#45475a"/>
              <Controls showLock={false}/>
            </SvelteFlow>
          {/key}
        </section>
        {#if keyboardSource}<small role="status">Select an input to connect this output.</small>{/if}
        {#if saveError||validation||compileError}<p role="alert" class="error">{saveError||validation||compileError}</p>{/if}
      </div>
      {#if showPreview}<aside class="preview-column" aria-label="Preview"><ShaderPreview {room} definition={compiled}/></aside>{/if}
    </div>
  </section>
{#if picker}<ShaderNodePicker sourceType={picker.sourceType} onPick={addNode} onClose={()=>picker=null}/>{/if}

<style>
  .workspace,.graph{display:flex;flex-direction:column;gap:.45rem;min-width:0;min-height:0}
  .workspace{height:100%;min-height:25rem;padding:.45rem}
  .shader-toolbar,.graph-tools,.save-actions{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap}
  .shader-toolbar input{min-width:0;max-width:100%}
  .name{flex:1 1 10rem}
  .save-actions{margin-left:auto}
  .workspace-panes{display:grid;flex:1;min-height:0;grid-template-columns:minmax(0,1fr);gap:.55rem}
  .workspace-panes.with-preview{grid-template-columns:minmax(0,1fr) minmax(12rem,.38fr)}
  .graph-tools{padding:.25rem;background:var(--panel)}
  .canvas{flex:1;min-height:21rem;min-width:0;overflow:hidden;border:1px solid var(--line);background:#181825}
  .preview-column{min-width:0}
  .preview-toggle{margin-left:auto}
  .canvas :global(.svelte-flow){--xy-background-color:#181825;--xy-edge-stroke:#a6adc8;--xy-edge-stroke-selected:#cba6f7;--xy-connectionline-stroke:#cba6f7}
  .canvas :global(.svelte-flow__edge-path){stroke-width:2}
  .canvas :global(.svelte-flow__controls-button){width:29px;height:29px;padding:5px}
  .error{margin:0}
  small{color:var(--muted)}
  @media(max-width:900px){
    .workspace{height:auto;min-height:100%}
    .workspace-panes{flex:none}
    .workspace-panes.with-preview{grid-template-columns:minmax(0,1fr)}
    .preview-column{max-width:27rem}
    .canvas{flex:none;height:53dvh}
  }
</style>
