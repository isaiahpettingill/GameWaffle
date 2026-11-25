<script>
  import SearchSelect from './SearchSelect.svelte';
  let {rule,flags,onChange,inherit=false,inheritedRule}=$props();
  const names={default:'Standard behavior',never:'Never',on_entry:'On room re-entry',delay:'After a delay'};
  const mode=$derived(rule?.mode??(inherit?'inherit':'default'));
  function select(next){
    if(next==='inherit')onChange(undefined);
    else if(next==='delay')onChange({mode:next,ticks:rule?.ticks??60,flag:rule?.flag??'',when:rule?.when??true});
    else onChange({mode:next});
  }
</script>
<div class="respawn-settings">
  <label>Respawn
    <select aria-label="Respawn" value={mode} onchange={event=>select(event.currentTarget.value)}>
      {#if inherit}<option value="inherit">Entity default ({names[inheritedRule?.mode??'default']})</option>{/if}
      <option value="default">Standard behavior</option>
      <option value="never">Never</option>
      <option value="on_entry">On room re-entry</option>
      <option value="delay">After a delay</option>
    </select>
  </label>
  {#if mode==='delay'}
    <label>Delay (ticks)<input type="number" min="1" max="216000" step="1" value={rule?.ticks??60}
      onchange={event=>{const ticks=event.currentTarget.valueAsNumber;if(Number.isInteger(ticks)&&ticks>=1&&ticks<=216000)onChange({...rule,ticks});}}></label>
    <SearchSelect label="Require flag" value={rule?.flag??''} options={[{value:'',label:'Always'},...flags.map(value=>({value,label:value}))]}
      onChange={flag=>onChange({...rule,flag})}/>
    {#if rule?.flag}<label>Flag value<select value={String(rule.when??true)} onchange={event=>onChange({...rule,when:event.currentTarget.value==='true'})}>
      <option value="true">On</option><option value="false">Off</option>
    </select></label>{/if}
  {/if}
</div>
<style>
  .respawn-settings{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,8.5rem),1fr));gap:.35rem .55rem;margin:.35rem 0}
  label{display:grid;gap:.24rem;color:var(--muted)}
</style>
