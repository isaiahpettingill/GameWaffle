<script>
  import {untrack} from 'svelte';
  import Modal from './Modal.svelte';
  import {resourceTextLimit,validResourceText} from '../src/resource-tables.mjs';

  let {suggestedName='',entry,locale,onAdd,onEdit,onClose}=$props();
  let name=$state(untrack(()=>suggestedName.slice(0,64))),initialText=$state('');
  let language=$state(untrack(()=>locale||'en')),changes=$state({});
  const names=new Intl.DisplayNames(['en'],{type:'language'});
  const languages=$derived(Object.keys(entry?.values??{}));
  const text=$derived(entry?changes[language]??entry.values[language]??'':initialText);
  const placeholder=$derived(entry&&language!==locale?changes[locale]??entry.values[locale]??'':'');
  const edited=$derived(Object.entries(changes).filter(([key,value])=>entry?.values[key]!==value));
  const valid=$derived(entry?edited.length>0&&edited.every(([,value])=>validResourceText(value)):Boolean(name.trim())&&validResourceText(text));

  function update(value){
    if(entry)changes[language]=value;
    else initialText=value;
  }
  function save(event){
    event.preventDefault();
    if(!valid)return;
    if(entry)onEdit(Object.fromEntries(edited));
    else onAdd(name.trim(),text);
  }
</script>

<Modal title={entry?'Edit text resource':'Add text resource'} {onClose}>
  <form onsubmit={save}>
    {#if entry}
      <div class="resource-key">Resource key <code>{entry.key}</code></div>
      {#if languages.length>1}
        <label>Language<select aria-label="Resource language" bind:value={language}>
          {#each languages as code}<option value={code}>{names.of(code)}{code===locale?' (default)':''}</option>{/each}
        </select></label>
      {/if}
    {:else}
      <label>Resource name<input required maxlength="64" bind:value={name} placeholder="Greeting"></label>
    {/if}
    <label>{names.of(language)} text<textarea rows="3" maxlength={resourceTextLimit} {placeholder} value={text}
      oninput={event=>update(event.currentTarget.value)}></textarea></label>
    {#if !validResourceText(text)||edited.some(([,value])=>!validResourceText(value))}
      <small role="alert">Use up to {resourceTextLimit} bytes of text per language.</small>
    {/if}
    <div class="dialog-actions"><button type="button" onclick={onClose}>Cancel</button>
      <button class="primary" disabled={!valid}>{entry?'Save text':'Add text'}</button></div>
  </form>
</Modal>

<style>.resource-key{color:var(--muted);overflow-wrap:anywhere}.resource-key code{margin-left:.35rem;color:var(--text)}</style>
