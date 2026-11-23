<script>
  import Sections from './Sections.svelte';
  let group=$state('Body');
  let { physics={}, fallback='none', onChange }=$props();
  const modes=['none','static','dynamic','kinematic','sensor','ladder','one_way','breakable','fluid'];
  const groups=[
    ['Body',[
      ['mass','Mass (kg)',null,.0001,100000],['density','Density',1,.0001,100000],
      ['elasticity','Elasticity',0,0,1],['friction','Friction',.35,0,1],['gravity','Gravity scale',1,-8,8],
    ]],
    ['Collision',[
      ['category','Category',1,1,65535,1],['mask','Mask',65535,0,65535,1],['group','Group',0,-32768,32767,1],
    ]],
    ['Health',[['health','Starting health',1,.001,1000000]]],
    ['Fluid',[
      ['buoyancy','Buoyancy',.75,0,4],['drag','Drag',2,0,20],['damage','Damage per second',0,0,100000],
    ]],
  ];
  const mode=$derived(physics.mode??fallback);
  function set(key,value) {
    const next={...physics};
    if(value==='')delete next[key];
    else next[key]=value;
    onChange(next);
  }
  function setNumber(input,key,min,max,step,old) {
    if(input.value===''){set(key,'');return;}
    const value=input.valueAsNumber;
    if(!Number.isFinite(value)||value<min||value>max||(step===1&&!Number.isInteger(value))){
      input.value=old??'';
      return;
    }
    set(key,value);
  }
</script>

<label>Physics mode
  <select aria-label="Physics mode" value={mode} onchange={event=>set('mode',event.currentTarget.value)}>
    {#each modes as value}<option {value}>{value.replaceAll('_',' ')}</option>{/each}
  </select>
</label>
<Sections labels={groups.map(([title])=>title).filter(title=>title!=='Fluid'||mode==='fluid')} bind:value={group}/>
{#each groups as [title,fields]}
  {#if title===(group==='Fluid' && mode!=='fluid'?'Body':group)}

      <div class="fields">
        {#each fields as [key,label,value,min,max,step]}
          <label>{label}<input type="number" {min} {max} step={step??'any'}
            placeholder={key==='mass' ? 'From density' : ''} value={physics[key]??value??''}
            onchange={e=>setNumber(e.currentTarget,key,min,max,step,physics[key]??value)}></label>
        {/each}
      </div>
      {#if title==='Body'}
        <label class="check"><input type="checkbox" checked={physics.fixed??true} onchange={e=>set('fixed',e.currentTarget.checked)}> Lock rotation</label>
      {/if}

  {/if}
{/each}
<style>
  label{display:grid;gap:.25rem;color:var(--muted);font-size:.75rem;}
  .fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.45rem;margin-top:.5rem;}
  .check{display:flex;align-items:center;gap:.3rem;margin-top:.55rem;}
</style>
