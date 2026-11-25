<script>
  import ColliderEditor from './ColliderEditor.svelte';
  import Sections from './Sections.svelte';
  let group=$state('Body'), editColliders=$state(false);
  let { physics={}, fallback='none', collisionLayers, entity=null, art=null, pixelUnits=false, onEntityChange, onChange }=$props();
  const modes=['none','static','dynamic','kinematic','sensor','ladder','one_way','breakable','fluid'];
  const groups=$derived([
    ['Body',[
      ['mass',pixelUnits?'Mass (units)':'Mass (kg)',null,.0001,100000],['density',pixelUnits?'Density (water = 1)':'Density',1,.0001,100000],
      ['elasticity','Elasticity',0,0,1],['friction','Friction',.35,0,1],['gravity','Gravity scale',1,-8,8],
    ]],
    ['Collision',[]],
    ['Health',[['health','Starting health',1,.001,1000000]]],
    ['Fluid',[
      ['buoyancy','Buoyancy',pixelUnits?1:.75,0,4],['drag','Drag',2,0,20],['damage','Damage per second',0,0,100000],
    ]],
  ]);
  const mode=$derived(physics.mode??fallback);
  function toggleLayer(key,index){
    const current=physics[key]??(key==='category'?1:65535);
    const updated=current ^ (1<<index);
    if(key==='category'&&!updated)return;
    set(key,updated);
  }
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

      {#if title==='Collision'}
        {#if entity}
          <label>Default collider<select value={entity.collider??'box'} onchange={event=>onEntityChange('collider',event.currentTarget.value)}>
            <option value="box">Box</option><option value="silhouette">Generate from sprite silhouette</option>
          </select></label>
          <button disabled={!art?.width} onclick={()=>editColliders=true}>Edit frame colliders…</button>
        {/if}
        {#each [['category','Belongs to',1],['mask','Collides with',65535]] as [key,label,fallback]}
          {@const bits=physics[key]??fallback}
          <details><summary>{label} · {collisionLayers.filter((_,index)=>bits&(1<<index)).length} selected</summary>
            <div class="fields">
              {#each collisionLayers as name,index}
                <label class="check"><input type="checkbox" checked={Boolean(bits&(1<<index))} disabled={key==='category'&&bits===(1<<index)}
                  onchange={()=>toggleLayer(key,index)}> {name}</label>
              {/each}
            </div>
          </details>
        {/each}
        {#if physics.group}<small>Legacy collision group {physics.group}
          <button onclick={()=>set('group','')}>Clear</button></small>{/if}
      {/if}
      <div class="fields">
        {#each fields as [key,label,value,min,max,step]}
          <label>{label}<input type="number" {min} {max} step={step??'any'}
            placeholder={key==='mass' ? 'From density' : ''} value={physics[key]??value??''}
            onchange={e=>setNumber(e.currentTarget,key,min,max,step,physics[key]??value)}></label>
        {/each}
      </div>
      {#if title==='Body'}
        {#if entity}
          <div class="fields">
            {#each [['width','Body width'],['height','Body height']] as [key,label]}
              <label>{label}<input type="number" min="1" max="4096" value={entity[key]??''} placeholder="From source"
                onchange={event=>{const input=event.currentTarget;
                  if(input.value===''||(Number.isFinite(input.valueAsNumber)&&input.valueAsNumber>=1&&input.valueAsNumber<=4096))
                    onEntityChange(key,input.value===''?'':input.valueAsNumber);
                  else input.value=entity[key]??'';
                }}></label>
            {/each}
          </div>
          <label>Gravity control<select value={entity.gravityMode??'legacy'} onchange={event=>onEntityChange('gravityMode',event.currentTarget.value)}>
            {#if entity.gravityMode==null}<option value="legacy" disabled>Legacy automatic</option>{/if}
            <option value="room">Room gravity</option><option value="script">Script applies gravity each tick</option>
          </select></label>
        {/if}
        <label class="check"><input type="checkbox" checked={physics.fixed??true} onchange={e=>set('fixed',e.currentTarget.checked)}> Lock rotation</label>
      {/if}

  {/if}
{/each}
{#if editColliders && entity && art?.width}
  <ColliderEditor {entity} {art} onClose={()=>editColliders=false}
    onApply={value=>{onEntityChange('frameColliders',value);editColliders=false;}}/>
{/if}
<style>
  details{margin:.4rem 0} summary{cursor:pointer} small{color:var(--muted)}
  label{display:grid;gap:.25rem;color:var(--muted);font-size:.75rem;}
  .fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.45rem;margin-top:.5rem;}
  .check{display:flex;align-items:center;gap:.3rem;margin-top:.55rem;}
</style>
