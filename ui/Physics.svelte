<script>
  let { physics=$bindable(), fallback='none', onChange }=$props();
  const modes=['none','static','dynamic','kinematic','sensor','ladder','one_way','breakable','fluid'];
  const values=[
    ['mass','Mass (kg)',null,.0001,100000],['density','Density',1,.0001,100000],['elasticity','Elasticity',0,0,1],
    ['friction','Friction',.35,0,1],['gravity','Gravity scale',1,-8,8],['health','Health',1,.001,1000000],
    ['category','Collision category',1,1,65535],['mask','Collision mask',65535,0,65535],['group','Collision group',0,-32768,32767],
    ['buoyancy','Buoyancy',.75,0,4],['drag','Fluid drag',2,0,20],['damage','Fluid damage / sec',0,0,100000],
  ];
  function set(key,value) {
    if (value === '') delete physics[key];
    else physics[key] = value;
    onChange();
  }
</script>
<h3>Physics</h3>
<label>Mode
  <select value={physics.mode ?? fallback} onchange={event=>set('mode',event.currentTarget.value)}>
    {#each modes as mode}<option value={mode}>{mode.replaceAll('_',' ')}</option>{/each}
  </select>
</label>
<div class="fields">
  {#each values as [key,label,value,min,max]}
    {#if !['buoyancy','drag','damage'].includes(key) || (physics.mode ?? fallback) === 'fluid'}
      <label>{label}<input type="number" {min} {max} step={['category','mask','group'].includes(key) ? 1 : 'any'}
        placeholder={key==='mass' ? 'From density' : ''} value={physics[key] ?? value ?? ''}
        onchange={event=>set(key,event.currentTarget.value==='' ? '' : event.currentTarget.valueAsNumber)}></label>
    {/if}
  {/each}
</div>
<label class="check"><input type="checkbox" checked={physics.fixed ?? true} onchange={e=>set('fixed',e.currentTarget.checked)}> Lock rotation</label>
<style>
  h3{margin:.85rem 0 .5rem;font-size:.82rem;color:#e9d5bc;}
  label{display:grid;gap:.25rem;color:var(--muted);font-size:.73rem;}
  .fields{display:grid;grid-template-columns:1fr 1fr;gap:.48rem;margin-top:.5rem;}
  .check{display:flex;align-items:center;gap:.3rem;margin-top:.55rem;}
</style>
