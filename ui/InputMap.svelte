<script>
  import {buttons} from '../src/schema.mjs';
  import {resourceName} from '../src/resource-name.mjs';
  let {controls,onChange}=$props();
  let name=$state(''),button=$state('a'),error=$state('');
  const label=key=>key==='menu'?'Start':key.length===1?key.toUpperCase():key[0].toUpperCase()+key.slice(1);
  const keys=['W / ↑','S / ↓','A / ←','D / →','; / Z','\' / X','Space / C','Enter'];
  function add(){
    if(!name.trim())return;
    const id=resourceName(name,'action',[controls,Object.fromEntries(buttons.map(key=>[key,true]))]);
    onChange({...controls,[id]:[button]});name='';error='';
  }
  function toggle(id,key){
    const old=controls[id],next=old.includes(key)?old.filter(x=>x!==key):[...old,key];
    if(!next.length){error='Keep at least one control for this action.';return;}
    error='';onChange({...controls,[id]:next});
  }
</script>
<form class="record-form" onsubmit={e=>{e.preventDefault();add();}}>
  <label>Action name<input bind:value={name} placeholder="jump" required></label>
  <label>Control<select bind:value={button}>{#each buttons as key}<option value={key}>{label(key)}</option>{/each}</select></label>
  <button class="primary" disabled={!name.trim()}>Create action</button>
</form>
{#if error}<p role="alert">{error}</p>{/if}
{#each Object.entries(controls) as [id,bound]}
  <fieldset><legend>{id}</legend><div class="row">{#each buttons as key}
    <button aria-pressed={bound.includes(key)} class:selected={bound.includes(key)} onclick={()=>toggle(id,key)}>{label(key)}</button>
  {/each}</div></fieldset>
{/each}
<details><summary>Keyboard controls</summary>
<table><thead><tr><th>Control</th><th>Keyboard</th></tr></thead><tbody>{#each buttons as key,i}<tr><td>{label(key)}</td><td>{keys[i]}</td></tr>{/each}</tbody></table></details>
<style>fieldset{border:1px solid var(--line);margin:.65rem 0;padding:.5rem}table{border-collapse:collapse;font-size:.82rem;margin:.5rem 0}th,td{text-align:left;padding:.25rem 1rem .25rem 0}th{color:var(--muted)}</style>
