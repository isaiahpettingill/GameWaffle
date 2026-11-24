<script>
  import {Handle,Position} from '@xyflow/svelte';
  import {isShaderParameter,shaderNodes,shaderTypeLabels} from '../src/shader-graph.mjs';

  let {id,data,selected=false}=$props();
  const entry=$derived(data.entry);
  const spec=$derived(entry&&shaderNodes[entry.kind]);
  const label=$derived(spec?spec.label+' '+id.slice(1):'Fragment output');
  const outputType=$derived(entry?data.type(id):'vec4');
  const ports=$derived(spec?.ports??[{name:'Color',type:'vec4'}]);
  const tint={float:'#fab387',vec2:'#89b4fa',vec4:'#a6e3a1',bool:'#f38ba8',number:'#cba6f7',vector:'#89dceb'};
  const toggle=(event,handle,source)=>{
    if(event.key!=='Enter'&&event.key!==' ')return;
    event.preventDefault();event.stopPropagation();
    data.keyboardWire(id,handle,source);
  };
  function setNumber(value,index){
    if(!Number.isFinite(value))return;
    if(index===undefined)data.update(id,{value});
    else data.update(id,{value:entry.value.map((part,i)=>i===index?value:part)});
  }
</script>

<article class:selected class:fragment={!entry} aria-label={label}>
  <header class="shader-node-title">
    <strong>{spec?.label??'Fragment output'}</strong>
    {#if entry?.name}<small title={entry.name}>{entry.name}</small>{/if}
  </header>
  {#if spec?.value}
    <div class="values nodrag nopan">
      {#if isShaderParameter(entry.kind)}
        <input aria-label={label+' name'} title="Parameter name" value={entry.name} maxlength="32"
          onchange={event=>data.update(id,{name:event.currentTarget.value})}>
      {/if}
      {#if spec.value==='color'}
        <input type="color" aria-label={label+' color'} title="Color" value={entry.value}
          onchange={event=>data.update(id,{value:event.currentTarget.value})}>
      {:else if spec.value==='float'}
        <input type="number" step="any" aria-label={label+' value'} title="Value" value={entry.value}
          onchange={event=>setNumber(event.currentTarget.valueAsNumber)}>
      {:else if spec.value==='vec2'}
        <div class="vector">
          {#each ['X','Y'] as axis,index}
            <label>{axis}<input type="number" step="any" aria-label={label+' '+axis} value={entry.value[index]}
              onchange={event=>setNumber(event.currentTarget.valueAsNumber,index)}></label>
          {/each}
        </div>
      {:else if spec.value==='boolean'}
        <label class="boolean"><input type="checkbox" aria-label={label+' value'} checked={entry.value}
          onchange={event=>data.update(id,{value:event.currentTarget.checked})}>True</label>
      {/if}
    </div>
  {/if}
  {#each ports as port,index}
    {@const handle=entry?String(index):'color'}
    <div class="port inbound">
      <Handle id={handle} type="target" position={Position.Left} isConnectableStart={false}
        aria-label={label+' · '+port.name+' input'} tabindex="0" onkeydown={event=>toggle(event,handle,false)}
        style={'--socket:'+tint[port.type]} />
      <span>{port.name}</span>
      {#if !data.connected(id,handle)&&port.fallback!==undefined}
        <small title="Default value">{port.fallback==='uv'?'UV':String(port.fallback)}</small>
      {/if}
    </div>
  {/each}
  {#if entry}
    <div class="port outbound">
      <span>{shaderTypeLabels[outputType]??'Value'}</span>
      <Handle id="result" type="source" position={Position.Right} isConnectableEnd={false}
        aria-label={label+' result'} tabindex="0" onkeydown={event=>toggle(event,'result',true)}
        style={'--socket:'+tint[outputType]} />
    </div>
  {/if}
</article>

<style>
  article{width:176px;box-sizing:border-box;background:#242537;border:1px solid #51536d;border-radius:9px;color:#cdd6f4;box-shadow:0 4px 10px #11111b66}
  article.selected{border-color:#cba6f7;box-shadow:0 0 0 1px #cba6f7}
  article.fragment{border-color:#8876a9;background:#342b45}
  header{padding:.42rem .58rem;background:#303147;border-radius:8px 8px 0 0;cursor:grab;display:grid;min-width:0}
  .fragment header{background:#413451}
  header strong{font-size:.83rem}
  header small{font-size:.68rem;color:#bac2de;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .values{display:grid;gap:.3rem;padding:.35rem .53rem}
  input{box-sizing:border-box;width:100%;min-width:0;font-size:.75rem;min-height:1.5rem;padding:.18rem .28rem}
  input[type=color]{height:1.75rem}
  input[type=checkbox]{width:auto;min-height:0;margin:0}
  .boolean{display:flex;align-items:center;gap:.35rem;font-size:.73rem}
  .vector{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.34rem}
  .vector label{font-size:.72rem}
  .port{position:relative;display:flex;align-items:center;min-height:1.55rem;padding:0 .68rem;gap:.36rem;font-size:.73rem}
  .port small{color:#a6adc8;font-size:.66rem;margin-left:auto}
  .outbound{justify-content:flex-end;color:#bac2de}
  .port :global(.svelte-flow__handle){height:11px;width:11px;background:var(--socket);border:2px solid #181825;cursor:crosshair}
  .port :global(.svelte-flow__handle.valid),.port :global(.svelte-flow__handle:focus-visible){outline:2px solid var(--socket);outline-offset:1px}
</style>
