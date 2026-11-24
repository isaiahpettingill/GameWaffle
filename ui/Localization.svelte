<script>
  import SearchSelect from './SearchSelect.svelte';
  import {resourceName} from '../src/resource-name.mjs';
  let { value, onChange } = $props();
  let language=$state(''), code=$state(''), key=$state(''), error=$state('');
  const tables=$derived(value?.tables??{});
  const locales=$derived(Object.keys(tables));
  const locale=$derived(Object.hasOwn(tables,language)?language:value?.locale);
  const keys=$derived(Object.keys(tables[value?.locale]??{}).sort());

  const languageNames=new Intl.DisplayNames(['en'],{type:'language',fallback:'none'});
  const alphabet='abcdefghijklmnopqrstuvwxyz';
  const languageChoices=[...Array.from(alphabet,a=>Array.from(alphabet,b=>a+b)).flat(),
    'en-us','en-gb','es-419','pt-br','pt-pt','zh-hans','zh-hant','fr-ca']
    .map(value=>({value,label:languageNames.of(value)})).filter(entry=>entry.label)
    .sort((a,b)=>a.label.localeCompare(b.label));
  const available=$derived(languageChoices.filter(entry=>!Object.hasOwn(tables,entry.value)));
  const nameOf=id=>languageNames.of(id)??id;

  function addLanguage(event) {
    event.preventDefault();
    if(!code || Object.hasOwn(tables,code))return;
    onChange({locale:value?.locale??code,tables:{...tables,[code]:{}}});
    language=code;code='';error='';
  }

  function addKey(event) {
    event.preventDefault();
    const label=key.trim();
    if(!label)return;
    const id=resourceName(label,'text',[tables[value.locale]]);
    onChange({...value,tables:{...tables,[value.locale]:{...tables[value.locale],[id]:''}}});
    language=value.locale;key='';error='';
  }

  function setDefault(id) {
    onChange({locale:id,tables:{...tables,[id]:{...tables[value.locale],...tables[id]}}});
  }

  function translate(id, text) {
    if (new TextEncoder().encode(text).length>4096) {
      error='Use up to 4096 bytes per text entry.';
      return;
    }
    onChange({...value,tables:{...tables,[locale]:{...tables[locale],[id]:text}}});
    error='';
  }

  function resetTranslation(id) {
    const table={...tables[locale]};
    delete table[id];
    onChange({...value,tables:{...tables,[locale]:table}});
    error='';
  }
</script>

<section class="text-settings" aria-label="Text resources">
  <form class="record-form" onsubmit={addLanguage}>
    <SearchSelect label="Language to add" value={code} options={available} onChange={value=>code=value}/>
    <button type="submit" disabled={!code}>Add language</button>
  </form>
  {#if locales.length}
    <div class="field-row">
      <label>Default language <select value={value.locale} onchange={event=>setDefault(event.currentTarget.value)}>
        {#each locales as id}<option value={id}>{nameOf(id)}</option>{/each}
      </select></label>
      <label>Edit language <select value={locale} onchange={event=>language=event.currentTarget.value}>
        {#each locales as id}<option value={id}>{nameOf(id)}</option>{/each}
      </select></label>
    </div>
    <form class="record-form" onsubmit={addKey}>
      <label>Text name<input bind:value={key} placeholder="greeting" required></label>
      <button type="submit">Add text</button>
    </form>
    {#each keys as id (id)}
      {@const translated=Object.hasOwn(tables[locale],id)}
      <div class="translation">
        <label>{id}<textarea rows="2" value={tables[locale][id]??''} placeholder={tables[value.locale][id]} onchange={event=>translate(id,event.currentTarget.value)}></textarea></label>
        {#if locale!==value.locale && translated}
          <button onclick={()=>resetTranslation(id)}>Use default</button>
        {/if}
      </div>
    {/each}
  {/if}
  {#if error}<p role="alert" class="error">{error}</p>{/if}
</section>

<style>
  .text-settings{display:grid;gap:.7rem;margin-top:.75rem}
  .translation{display:flex;gap:.5rem;align-items:end}
  .translation label{display:grid;gap:.25rem;min-width:0;flex:1}
  textarea{width:100%;resize:vertical}
</style>
