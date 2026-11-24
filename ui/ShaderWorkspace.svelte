<script>
  import {CloudFog,Focus,Grid3X3,Moon,ScanLine,Sparkles,Waves} from '@lucide/svelte';
  import AssetLibrary from './AssetLibrary.svelte';
  import {shaderTemplates,starterShader} from '../src/shader-graph.mjs';

  let {project,files,shaderDefinitions,room,target,drafts,onUpload,onEdit,onOpen,onShader,onTemplate,onSaveShader}=$props();
  const icons={empty:Focus,crt:ScanLine,mist:CloudFog,day:Moon,heat:Waves,pixelate:Grid3X3,duotone:Sparkles};
  const shader=$derived(target?.id?project.shaders?.[target.id]:null);
  const editable=$derived(Boolean(target&&(target.template||shader?.graph)));
  const editorModule=$derived(editable?import('./ShaderEditor.svelte'):null);
  const draftKey=target=>target.id??'template:'+target.template;

  function remember(session,state){
    if(!session)return;
    const key=draftKey(session);
    if(state)drafts.set(key,state);
    else drafts.delete(key);
  }
</script>

<div class="shader-workbench">
  <aside aria-label="Shaders" class="library-pane">
    <AssetLibrary {project} {files} {shaderDefinitions} {onUpload} {onEdit} {onOpen} {onShader}
      shadersOnly selectedPath={target?.path??''}/>
  </aside>
  <div class="editor-pane">
    {#if editable}
      {#await editorModule}
        <p role="status">Loading shader editor…</p>
      {:then {default:ShaderEditor}}
        {#key target.session}
          {@const session=target}
          <ShaderEditor id={target.id} name={shader?.title??shaderTemplates[session.template]?.title??'Shader'}
            document={shader?.graph??starterShader(session.template)} initialDraft={drafts.get(draftKey(session))}
            {room} onSave={data=>onSaveShader(data,session)} onDraft={state=>remember(session,state)}/>
        {/key}
      {:catch error}
        <p role="alert" class="error">{error.message}</p>
      {/await}
    {:else if target?.path}
      <section class="templates card" aria-label="Imported shader">
        <h2>{shader?.title??target.path.split('/').at(-1)}</h2>
        <p>Use this SPIR-V shader in a Room or Game shader pass.</p>
      </section>
    {:else}
      <section class="templates card" aria-labelledby="shader-template-title">
        <h2 id="shader-template-title">Shader templates</h2>
        <div class="template-cards">
          {#each Object.entries(shaderTemplates) as [kind,template]}
            {@const Icon=icons[kind]}
            <button class="template" type="button" aria-label={template.title} aria-describedby={'template-description-'+kind} onclick={()=>onTemplate(kind)}>
              <Icon size={19} aria-hidden="true"/>
              <strong>{template.title}</strong>
              <span id={'template-description-'+kind}>{template.description}</span>
            </button>
          {/each}
        </div>
      </section>
    {/if}
  </div>
</div>

<style>
  .shader-workbench{display:grid;grid-template-columns:minmax(9.75rem,13rem) minmax(0,1fr);gap:.5rem;min-height:0;min-width:0;height:100%}
  .library-pane{min-height:0;overflow:auto;align-self:stretch}
  .editor-pane{min-height:0;min-width:0}
  .templates{padding:.7rem;display:grid;gap:.65rem}
  h2{font-size:.9rem;margin:0}
  .template-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr));gap:.5rem}
  .template{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:.52rem;min-width:0;text-align:left;padding:.65rem;white-space:normal}
  .template :global(svg){color:var(--accent)}
  .template span{grid-column:2;color:var(--muted);font-size:.75rem;line-height:1.35}
  @media(max-width:840px){
    .shader-workbench{grid-template-columns:minmax(0,1fr);height:auto;align-content:start}
    .library-pane{max-height:35dvh}
  }
</style>
