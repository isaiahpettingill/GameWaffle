<script>
  import SearchSelect from './SearchSelect.svelte';
  import Modal from './Modal.svelte';
  let {rooms,flags,roomId,onSelect,onEdit}=$props();
  const edges=['left','right','up','down'];
  const opposite={left:'right',right:'left',up:'down',down:'up'};
  const edgeNames={left:'Left',right:'Right',up:'Top',down:'Bottom'};
  const modes={fixed:'Fixed destination',save:'Random once per save',crossing:'Random on each crossing'};
  let draft=$state(null), error=$state('');
  const ids=$derived(Object.keys(rooms));
  const columns=$derived(Math.max(2,Math.ceil(Math.sqrt(ids.length))));
  const pos=id=>{const i=ids.indexOf(id);return [88+(i%columns)*176,48+Math.floor(i/columns)*96];};
  const room=$derived(rooms[roomId]);
  const choices=$derived(ids.map(value=>({value,label:rooms[value].title??value})));
  const label=id=>rooms[id]?.title??id;
  const partner=$derived(draft?.primary ? rooms[draft.primary].exits?.[opposite[draft.edge]] : null);
  const returnFits=$derived(partner?.mode==='fixed' && !partner.flag && partner.targets[0]===roomId);

  function open(edge){
    const exit=room.exits?.[edge], [primary='',...other]=exit?.targets??[];
    draft={edge,primary,mode:exit?.mode??'fixed',others:exit?.alternates??other,
      seamless:exit?.adjacent??false,flag:exit?.flag??'',when:exit?.when??true,replaceReturn:false};
    error='';
  }
  function apply(){
    const {edge,primary,mode,others,flag,when,replaceReturn}=draft;
    const seamless=draft.seamless&&mode==='fixed'&&!flag&&primary!==roomId;
    if(seamless && primary){
      const length=edge==='left'||edge==='right'?'rows':'cols';
      if(room[length]!==rooms[primary][length]){error='The two connected edges must have the same length.';return;}
      if(!returnFits && !replaceReturn){error='Confirm the return exit to make this connection seamless.';return;}
    }
    const changes={};
    function write(id,side,value){
      const next=changes[id]??={...rooms[id],exits:{...rooms[id].exits}};
      if(value)next.exits[side]=value;
      else delete next.exits[side];
    }
    const old=room.exits?.[edge], oldTarget=old?.targets[0], reverse=opposite[edge];
    const oldReturn=rooms[oldTarget]?.exits?.[reverse];
    if(old?.adjacent && (!seamless||oldTarget!==primary) && oldReturn?.adjacent && oldReturn.targets[0]===roomId){
      write(oldTarget,reverse,{...oldReturn,adjacent:false});
    }
    const alternates=[...new Set(others.filter(id=>id!==primary&&Object.hasOwn(rooms,id)))];
    write(roomId,edge,primary?{
      mode, targets:mode==='fixed'?[primary]:[primary,...alternates],
      ...(mode==='fixed' && alternates.length?{alternates}:{}),
      ...(flag?{flag,when}:{}), ...(seamless?{adjacent:true}:{}),
    }:null);
    if(seamless && primary)write(primary,reverse,{...(returnFits?partner:{}),mode:'fixed',targets:[roomId],adjacent:true});
    onEdit(changes,'connection from '+label(roomId));
    draft=null;
  }
  function setPrimary(value){
    if(draft.primary && draft.mode!=='fixed' && value!==draft.primary)draft.others=[...new Set([...draft.others,draft.primary])];
    draft.primary=value;draft.replaceReturn=false;error='';
    if(!value)draft.seamless=false;
  }
</script>

<section class="card">
  <h2>World map</h2>
  <div class="graph">
    <div class="world" style:height={Math.ceil(ids.length/columns)*72+'px'}>
      <svg width="100%" height="100%" viewBox={`0 0 ${columns*176} ${Math.ceil(ids.length/columns)*96}`} preserveAspectRatio="none" aria-label="Room connections">
        <defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6Z" fill="var(--accent)"/></marker></defs>
        {#each ids as id}{#each Object.values(rooms[id].exits??{}) as route}{#each route.targets as target}
          {@const a=pos(id)}{@const b=pos(target)}
          <line x1={a[0]} y1={a[1]} x2={b[0]+Math.sign(a[0]-b[0])*55} y2={b[1]+Math.sign(a[1]-b[1])*19} stroke="var(--accent)" marker-end="url(#arrow)"/>
        {/each}{/each}{/each}
      </svg>
      {#each ids as id}{@const p=pos(id)}
        <button class:selected={id===roomId} style:left={p[0]/(columns*176)*100+'%'} style:top={p[1]/(Math.ceil(ids.length/columns)*96)*100+'%'} style:max-width={92/columns+'%'} onclick={()=>onSelect(id)}>{label(id)}</button>
      {/each}
    </div>
  </div>
  <h3>{label(roomId)}</h3>
  <div class="connections">
    {#each edges as edge}
      {@const exit=room.exits?.[edge]}
      <button onclick={()=>open(edge)} aria-label={edge+' exit'}><strong>{edgeNames[edge]}</strong>
        <span>{exit?exit.targets.map(label).join(', '):'No exit'}</span>
      </button>
    {/each}
  </div>
</section>

{#if draft}
  <Modal title="Edit Connection" onClose={()=>draft=null}>
    <form onsubmit={event=>{event.preventDefault();apply();}}>
      <p>{label(roomId)} · {edgeNames[draft.edge]} edge</p>
      <SearchSelect label="Destination" value={draft.primary} options={[{value:'',label:'No exit'},...choices]} onChange={setPrimary}/>
      {#if draft.primary}
        <label>Routing<select bind:value={draft.mode} onchange={()=>error=''}>
          {#each Object.entries(modes) as [value,name]}<option {value}>{name}</option>{/each}
        </select></label>
        {#if draft.mode!=='fixed'}
          {#if draft.others.some(id=>id!==draft.primary)}
            <div class="row">
              {#each draft.others.filter(id=>id!==draft.primary) as id (id)}
                <button type="button" aria-label={'Remove alternate '+label(id)} onclick={()=>draft.others=draft.others.filter(other=>other!==id)}>{label(id)} ×</button>
              {/each}
            </div>
          {/if}
          <SearchSelect label="Add alternate destination" value="" options={choices.filter(({value})=>value!==draft.primary&&!draft.others.includes(value))}
            onChange={id=>draft.others=[...draft.others,id]}/>
        {/if}
        <SearchSelect label="Required flag" value={draft.flag} options={[{value:'',label:'Always open'},...flags.map(value=>({value,label:value}))]}
          onChange={flag=>{draft.flag=flag;error='';}}/>
        {#if draft.flag}
          <label>Required flag state<select value={String(draft.when)} onchange={event=>draft.when=event.currentTarget.value==='true'}>
            <option value="true">On</option><option value="false">Off</option>
          </select></label>
        {/if}
        {#if draft.mode==='fixed' && !draft.flag && draft.primary!==roomId}
          <label class="check"><input type="checkbox" bind:checked={draft.seamless}> Seamless two-way connection</label>
          {#if draft.seamless && !returnFits}
            <label class="check"><input type="checkbox" bind:checked={draft.replaceReturn}>
              {partner?'Replace':'Create'} return exit on {label(draft.primary)}’s {edgeNames[opposite[draft.edge]].toLowerCase()} edge
            </label>
          {/if}
        {/if}
      {/if}
      {#if error}<p role="alert" class="error">{error}</p>{/if}
      <div class="dialog-actions"><button type="button" onclick={()=>draft=null}>Cancel</button><button class="primary">Apply</button></div>
    </form>
  </Modal>
{/if}

<style>
  section{padding:.8rem}h2,h3{font-size:1rem;margin-bottom:.55rem}
  .graph{overflow-x:hidden;overflow-y:auto;max-height:34vh;background:var(--well);margin-bottom:.75rem}
  .world{position:relative}.world button{position:absolute;transform:translate(-50%,-50%);width:110px;font-size:.78rem;overflow-wrap:anywhere}
  .connections{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,10rem),1fr));gap:.45rem}
  .connections button {display:grid;justify-items:start;min-width:0;text-align:left;overflow-wrap:anywhere}
  .connections span{color:var(--muted)}
  .check{display:flex;align-items:center;gap:.4rem}
</style>
