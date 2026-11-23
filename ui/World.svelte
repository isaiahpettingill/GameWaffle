<script>
  let {rooms,flags,roomId,onSelect,onEdit}=$props();
  let edge=$state('right');
  const ids=$derived(Object.keys(rooms));
  const columns=$derived(Math.max(2,Math.ceil(Math.sqrt(ids.length))));
  const pos=id=>{const i=ids.indexOf(id);return [88+(i%columns)*176,48+Math.floor(i/columns)*96];};
  const room=$derived(rooms[roomId]);
  const exit=$derived(room.exits?.[edge]??{mode:'fixed',targets:[],when:true});
  function update(fields){
    const value={...exit,...fields};
    const exits={...room.exits};
    if(value.targets.length)exits[edge]=value;else delete exits[edge];
    onEdit({...room,exits});
  }
</script>
<section class="card">
  <h2>World map</h2>
  <div class="graph">
    <div class="world" style:width={columns*176+'px'} style:height={Math.ceil(ids.length/columns)*96+'px'}>
      <svg width="100%" height="100%" aria-label="Room connections">
        <defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6Z" fill="#f4c77e"/></marker></defs>
        {#each ids as id}{#each Object.values(rooms[id].exits??{}) as route}{#each route.targets as target}
          {@const a=pos(id)}{@const b=pos(target)}
          <line x1={a[0]} y1={a[1]} x2={b[0]+Math.sign(a[0]-b[0])*55} y2={b[1]+Math.sign(a[1]-b[1])*19} stroke="#f4c77e" marker-end="url(#arrow)"/>
        {/each}{/each}{/each}
      </svg>
      {#each ids as id}{@const p=pos(id)}
        <button class:selected={id===roomId} style:left={p[0]+'px'} style:top={p[1]+'px'} onclick={()=>onSelect(id)}>{rooms[id].title??id}</button>
      {/each}
    </div>
  </div>
  <h3>{room.title??roomId}</h3>
  <div class="row">{#each ['left','right','up','down'] as side}<button aria-pressed={side===edge} class:selected={side===edge} onclick={()=>edge=side}>{side} exit</button>{/each}</div>
  <label>Destination<select value={exit.targets[0]??''} onchange={e=>update({targets:e.currentTarget.value?[e.currentTarget.value]:[]})}>
    <option value="">No exit</option>{#each ids as id}<option value={id}>{rooms[id].title??id}</option>{/each}
  </select></label>
  {#if exit.targets.length}
    <label>Choose destination<select value={exit.mode} onchange={e=>update({mode:e.currentTarget.value,targets:e.currentTarget.value==='fixed'?exit.targets.slice(0,1):exit.targets})}>
      <option value="fixed">Fixed</option><option value="save">Once per save</option><option value="crossing">On each crossing</option>
    </select></label>
    {#if exit.mode!=='fixed'}<div class="row">{#each ids.filter(id=>id!==exit.targets[0]) as id}
      <label><input type="checkbox" checked={exit.targets.includes(id)} onchange={e=>update({targets:e.currentTarget.checked?[...exit.targets,id]:exit.targets.filter(t=>t!==id)})}>{rooms[id].title??id}</label>
    {/each}</div>{/if}
    <label><input type="checkbox" checked={exit.adjacent??false} onchange={e=>update({adjacent:e.currentTarget.checked})}> Connect opposite edges</label>
    <label>Required flag<select value={exit.flag??''} onchange={e=>update({flag:e.currentTarget.value})}><option value="">Always open</option>{#each flags as flag}<option>{flag}</option>{/each}</select></label>
    {#if exit.flag}<label><input type="checkbox" checked={exit.when??true} onchange={e=>update({when:e.currentTarget.checked})}> Flag must be on</label>{/if}
  {/if}
</section>
<style>
  section{padding:.8rem;} h2,h3{font-size:1rem;margin-bottom:.55rem;}
  .graph{overflow:auto;max-height:44vh;background:var(--well);margin-bottom:.75rem;}
  .world{position:relative;}.world button{position:absolute;transform:translate(-50%,-50%);width:110px;font-size:.78rem;}
  label{display:block;margin-top:.45rem;}select{max-width:24rem;display:block;}
</style>
