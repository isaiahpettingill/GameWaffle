<script>
  let {rooms,authoring,roomId,onSelect,onScript}=$props();
  const edgeNames={left:'Left',right:'Right',up:'Top',down:'Bottom'};
  const ids=$derived(Object.keys(rooms));
  const columns=$derived(Math.max(2,Math.ceil(Math.sqrt(ids.length))));
  const pos=id=>{const i=ids.indexOf(id);return [88+(i%columns)*176,48+Math.floor(i/columns)*96];};
  const routes=id=>authoring[id]?.exits??rooms[id]?.exits??{};
  const label=id=>rooms[id]?.title??id;
</script>

<section class="card">
  <h2>World map</h2>
  <div class="graph">
    <div class="world" style:height={Math.ceil(ids.length/columns)*72+'px'}>
      <svg width="100%" height="100%" viewBox={`0 0 ${columns*176} ${Math.ceil(ids.length/columns)*96}`} preserveAspectRatio="none" aria-label="Room connections">
        <defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6Z" fill="var(--accent)"/></marker></defs>
        {#each ids as id}{#each Object.values(routes(id)) as route}{#each route.targets as target}
          {@const a=pos(id)}{@const b=pos(target)}
          <line x1={a[0]} y1={a[1]} x2={b[0]+Math.sign(a[0]-b[0])*55} y2={b[1]+Math.sign(a[1]-b[1])*19} stroke="var(--accent)" marker-end="url(#arrow)"/>
        {/each}{/each}{/each}
      </svg>
      {#each ids as id}{@const p=pos(id)}
        <button class:selected={id===roomId} style:left={p[0]/(columns*176)*100+'%'} style:top={p[1]/(Math.ceil(ids.length/columns)*96)*100+'%'} style:max-width={92/columns+'%'} onclick={()=>onSelect(id)}>{label(id)}</button>
      {/each}
    </div>
  </div>
  <div class="row room-heading">
    <h3>{label(roomId)}</h3>
    <button type="button" onclick={onScript}>Open room script</button>
  </div>
  <dl class="connections">
    {#each Object.entries(edgeNames) as [edge,name]}
      {@const exit=routes(roomId)[edge]}
      <div><dt>{name}</dt><dd>{exit?.targets.length?exit.targets.map(label).join(', '):'No exit'}</dd></div>
    {/each}
  </dl>
</section>

<style>
  section{padding:.8rem}h2,h3{font-size:1rem;margin-bottom:.55rem}
  .graph{overflow-x:hidden;overflow-y:auto;max-height:34vh;background:var(--well);margin-bottom:.75rem}
  .world{position:relative}.world button{position:absolute;transform:translate(-50%,-50%);width:110px;font-size:.78rem;overflow-wrap:anywhere}
  .connections{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,10rem),1fr));gap:.45rem}
  .room-heading{justify-content:space-between}
  .connections{margin:.5rem 0 0}
  .connections div{padding:.4rem .55rem;border:1px solid var(--line);overflow-wrap:anywhere}
  dt{font-weight:600}
  dd{margin:0;color:var(--muted)}
</style>
