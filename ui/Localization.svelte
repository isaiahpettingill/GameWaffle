<script>
  import {Database, Plus, Search} from '@lucide/svelte';
  import SearchSelect from './SearchSelect.svelte';
  import {resourceTables,validResourceText} from '../src/resource-tables.mjs';

  let {value, resources={}, onChange, onAdd, onGameScript}=$props();
  let language=$state(''), query=$state(''), error=$state('');
  const effective=$derived(resourceTables(value,resources));
  const defaultLanguage=$derived(effective.locale);
  const base=$derived(effective.tables[defaultLanguage]??{});
  const locale=$derived(Object.hasOwn(effective.tables,language)?language:defaultLanguage);
  const edited=$derived(value?.tables?.[locale]??{});
  const translating=$derived(locale!==defaultLanguage);
  const search=$derived(query.trim().toLowerCase());
  const rows=$derived(Object.keys(base).sort().filter(key=>!search||[key,base[key],edited[key]??''].some(
    text=>text.toLowerCase().includes(search))));

  const languageNames=new Intl.DisplayNames(['en'],{type:'language',fallback:'none'});
  const alphabet='abcdefghijklmnopqrstuvwxyz';
  const nameOf=id=>languageNames.of(id)??id;
  const languageChoices=[...Array.from(alphabet,a=>Array.from(alphabet,b=>a+b)).flat(),
    'en-us','en-gb','es-419','pt-br','pt-pt','zh-hans','zh-hant','fr-ca']
    .map(value=>({value,label:languageNames.of(value)})).filter(entry=>entry.label)
    .sort((a,b)=>a.label.localeCompare(b.label));
  const available=$derived(languageChoices.filter(entry=>!Object.hasOwn(effective.tables,entry.value)));
  const languages=$derived(Object.keys(effective.tables).map(id=>({value:id,label:nameOf(id)})));

  function write(id,table,newDefault=defaultLanguage||id){
    const tables={...value?.tables,[id]:table};
    tables[newDefault]??={};
    onChange({locale:newDefault,tables});
    error='';
  }
  function addLanguage(id){
    if(!id||Object.hasOwn(effective.tables,id))return;
    write(id,{});
    language=id;
  }
  function setDefault(){
    const previous=Object.fromEntries(Object.entries(value?.tables?.[defaultLanguage]??{})
      .filter(([key])=>!Object.hasOwn(resources,key)));
    write(locale,{...previous,...edited},locale);
  }
  function translate(id,text){
    if(!validResourceText(text)){error='Use up to 4096 bytes per text resource.';return;}
    write(locale,{...edited,[id]:text});
  }
  function resetTranslation(id){
    const table={...edited};
    delete table[id];
    write(locale,table);
  }
</script>

<section class="resources card" aria-labelledby="resources-title">
  <header class="heading row">
    <h2 id="resources-title">Resources</h2>
    <div class="row">
      {#if Object.keys(resources).length}<button type="button" onclick={onGameScript}>Game script</button>{/if}
      <button type="button" class="primary" onclick={()=>onAdd(()=>{language='';query='';error='';})}><Plus size={15}/>Add text…</button>
    </div>
  </header>
  <div class="tools">
    <label class="search"><Search size={15} aria-hidden="true"/><input type="search" aria-label="Find a resource" placeholder="Find a resource…" bind:value={query}></label>
    {#if languages.length}
      <label class="stack">Language
        <select aria-label="Resource language" value={locale} onchange={event=>{language=event.currentTarget.value;error='';}}>
          {#each languages as entry}<option value={entry.value}>{entry.label}{entry.value===defaultLanguage?' (default)':''}</option>{/each}
        </select>
      </label>
    {/if}
    <SearchSelect label="Add language" value="" options={available} placeholder="Choose a language…" onChange={addLanguage}/>
    {#if translating}<button type="button" onclick={setDefault}>Use as default</button>{/if}
  </div>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  {#if rows.length}
    <table>
      <thead><tr><th scope="col">Key</th><th scope="col">{nameOf(defaultLanguage)}</th>
        {#if translating}<th scope="col">{nameOf(locale)}</th>{/if}</tr></thead>
      <tbody>{#each rows as id (id)}
        {@const defined=Object.hasOwn(resources,id)}
        <tr>
          <th scope="row"><code>{id}</code>{#if defined}<small>Game script</small>{/if}</th>
          <td>
            {#if translating||defined&&!Object.hasOwn(edited,id)}<span class="base-value">{base[id]}</span>
            {:else}
              <textarea rows="1" aria-label={id} maxlength="4096" value={base[id]} onchange={event=>translate(id,event.currentTarget.value)}></textarea>
              {#if defined}<button type="button" aria-label={'Use script text for '+id} onclick={()=>resetTranslation(id)}>Use script text</button>{/if}
            {/if}
          </td>
          {#if translating}<td class="translated">
            <textarea rows="1" aria-label={id} maxlength="4096" value={edited[id]??''} placeholder={base[id]}
              onchange={event=>translate(id,event.currentTarget.value)}></textarea>
            {#if Object.hasOwn(edited,id)}<button type="button" aria-label={'Use default for '+id} onclick={()=>resetTranslation(id)}>Use default</button>{/if}
          </td>{/if}
        </tr>
      {/each}</tbody>
    </table>
  {:else}
    <div class="empty">
      <Database size={22} aria-hidden="true"/>
      <strong>{query.trim()?'No matching resources':'No text resources yet'}</strong>
    </div>
  {/if}
</section>

<style>
  .resources{display:grid;gap:.75rem;padding:.75rem;min-width:0}
  h2{margin:0;font-size:1rem}
  .tools{display:flex;flex-wrap:wrap;align-items:end;gap:.5rem}
  .tools :global(.search-select),.tools .stack{flex:0 1 13rem;min-width:min(8rem,100%)}
  .search{display:flex;align-items:center;gap:.4rem;min-width:min(12rem,100%);flex:1;color:var(--muted)}
  .search input{flex:1;min-width:0}
  table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:.82rem}
  th,td{border-bottom:1px solid var(--line);padding:.48rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}
  th:first-child{width:24%}
  th small{display:block;margin-top:.18rem;color:var(--muted);font-weight:400}
  thead{background:var(--well);color:var(--muted)}
  textarea{box-sizing:border-box;width:100%;min-width:0;resize:vertical}
  .translated button{margin-top:.22rem;min-height:1.55rem}
  .base-value{white-space:pre-wrap}
  .empty{display:grid;justify-items:center;gap:.45rem;padding:2rem .6rem;color:var(--muted);text-align:center}
  .empty :global(svg){color:var(--accent)}
  @media(max-width:530px){
    .tools :global(.search-select),.tools .stack{flex:1 1 8rem}
    .search{flex-basis:100%}
    th,td{padding:.32rem}
    th:first-child{width:23%}
  }
</style>
