<script>
  const formats = {
    cartridge: {label:'Cartridge (.waffle)', extension:'waffle', path:'./game.waffle', localized:true},
    web: {label:'Standalone web game (.html)', extension:'html', path:'./export.html', localized:true},
    linux: {label:'Linux game (.zip)', extension:'zip', path:'./api/desktop?target=linux-x64', localized:true},
    windows: {label:'Windows game (.zip)', extension:'zip', path:'./api/desktop?target=windows-x64', localized:true},
    project: {label:'Editable project (.waffleproj)', extension:'waffleproj', path:'./api/archive'},
    player: {label:'Web player (.html)', extension:'html', path:'./gamewaffle-player.html', name:'gamewaffle-player'},
  };

  let { basename, localization, onSave, onClose } = $props();
  let dialog, controller;
  let choice=$state('cartridge'), language=$state(''), exporting=$state(false), error=$state('');
  const format=$derived(formats[choice]);
  const languages=$derived(Object.keys(localization?.tables??{}));
  const locale=$derived(format.localized?(languages.includes(language)?language:localization?.locale??''):'');
  const filename=$derived((format.name??basename)+(locale?'-'+locale:'')+'.'+format.extension);

  export function open() {
    error='';
    dialog.showModal();
  }

  function close() {
    controller?.abort();
    dialog.close();
  }

  async function download(event) {
    event.preventDefault();
    if (exporting) return;
    const task=new AbortController();
    controller=task;
    const url=new URL(format.path,location.href);
    if(locale)url.searchParams.set('locale',locale);
    const name=filename;
    exporting=true;
    error='';
    try {
      if (!await onSave()) throw Error('Fix the current edit before exporting.');
      if (task.signal.aborted) return;
      const response=await fetch(url,{signal:task.signal});
      if (!response.ok) {
        const detail=await response.json().catch(()=>({}));
        throw Error(detail.error??'Export failed.');
      }
      const link=document.createElement('a');
      link.href=URL.createObjectURL(await response.blob());
      link.download=name;
      link.click();
      setTimeout(()=>URL.revokeObjectURL(link.href),2000);
      dialog.close();
    } catch (err) {
      if (!task.signal.aborted) error=err.message;
    } finally {
      controller=null;
      exporting=false;
    }
  }
</script>

<dialog bind:this={dialog} aria-labelledby="export-heading" onclose={onClose} oncancel={()=>controller?.abort()}>
  <form onsubmit={download}>
    <h2 id="export-heading">Export</h2>
    <label>Format
      <select bind:value={choice} disabled={exporting}>
        {#each Object.entries(formats) as [id,entry]}<option value={id}>{entry.label}</option>{/each}
      </select>
    </label>
    {#if format.localized && languages.length}
      <label>Language
        <select value={locale} onchange={event=>language=event.currentTarget.value} disabled={exporting}>
          {#each languages as id}<option>{id}</option>{/each}
        </select>
      </label>
    {/if}
    <p class="filename">Filename <output>{filename}</output></p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <footer class="row">
      <button type="button" onclick={close}>Cancel</button>
      <button type="submit" class="primary" disabled={exporting}>{exporting?'Exporting…':'Export'}</button>
    </footer>
  </form>
</dialog>

<style>
  dialog{color:inherit;background:var(--panel);border:1px solid var(--line);width:min(26rem,calc(100% - 2rem));padding:1rem}
  dialog::backdrop{background:#11111bcf}
  form,label{display:grid;gap:.4rem}
  form{gap:.95rem}
  h2{font-size:1.15rem}
  label,.filename{font-size:.85rem;color:var(--muted)}
  .filename{display:grid;gap:.25rem}
  output{color:inherit;overflow-wrap:anywhere;font-family:monospace}
  footer{justify-content:flex-end}
</style>
