<script>
  let {labels,value=$bindable()}=$props();
</script>
<div class="row sections">{#each labels as label}
  <button class:selected={label===value} aria-pressed={label===value} onclick={()=>value=label}>{label}</button>
{/each}</div>
<style>.sections{margin:.55rem 0;gap:.25rem;}.sections button{font-size:.8rem;padding:.35rem .5rem;}</style>
