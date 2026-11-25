<script>
  import {untrack} from 'svelte';
  import Modal from './Modal.svelte';
  import SearchSelect from './SearchSelect.svelte';
  import {roomShaders} from '../src/room-shaders.mjs';
  import {platformGravity} from '../src/schema.mjs';
  import {pixelsPerMeter} from '../src/physics-units.mjs';

  let {defaults, images, audio, pixelUnits=false, onApply, onClose}=$props();
  const scale=$derived(pixelUnits?pixelsPerMeter:1);
  let draft=$state(untrack(()=>({cameraZoom:1,cameraBottomInset:0,gravity:platformGravity*scale,...$state.snapshot(defaults)})));
  const none={value:'',label:'None'};
  const sounds=$derived(Object.entries(audio).map(([value,sound])=>({value,label:sound.title??value})));
  const shaders=[{value:'none',label:'None'},...Object.entries(roomShaders).map(([value,label])=>({value,label}))];

  function apply(event){
    event.preventDefault();
    onApply($state.snapshot(draft));
  }
</script>

<Modal title="New room defaults" {onClose}>
  <form onsubmit={apply}>
    <p>New rooms start with these values in their On init script.</p>
    <fieldset>
      <legend>Camera</legend>
      <label>Camera zoom (×)<input type="number" min=".25" max="4" step="any" required bind:value={draft.cameraZoom}></label>
      <label>Bottom inset (tiles)<input type="number" min="0" max="1023" step="1" required bind:value={draft.cameraBottomInset}></label>
    </fieldset>
    <fieldset>
      <legend>Physics</legend>
      <label>Platformer gravity ({pixelUnits?'px/s²':'m/s²'})<input type="number" min={-100*scale} max={100*scale} step="any" required bind:value={draft.gravity}></label>
      <label>Room borders<select value={draft.border??''}
        onchange={event=>{const value=event.currentTarget.value;if(value)draft.border=value;else delete draft.border;}}>
        <option value="">By room view</option><option value="sides">Side walls</option><option value="closed">All four walls</option><option value="open">Open</option>
      </select></label>
    </fieldset>
    <fieldset>
      <legend>Appearance</legend>
      <label>Background color<input type="color" value={draft.background??'#101a23'}
        oninput={event=>draft.background=event.currentTarget.value}></label>
      <SearchSelect label="Shader" value={draft.shader?.kind??'none'} options={shaders} onChange={kind=>draft.shader={kind}}/>
      <div class="wide"><SearchSelect label="Background image" value={draft.backgroundImage??''}
        options={[none,...images]} onChange={value=>draft.backgroundImage=value}/></div>
    </fieldset>
    <fieldset>
      <legend>Audio</legend>
      <SearchSelect label="Music" value={draft.music??''} options={[none,...sounds]} onChange={value=>draft.music=value}/>
      <SearchSelect label="Ambient sound" value={draft.ambience??''} options={[none,...sounds]} onChange={value=>draft.ambience=value}/>
    </fieldset>
    <div class="dialog-actions"><button type="button" onclick={onClose}>Cancel</button><button class="primary">Apply defaults</button></div>
  </form>
</Modal>

<style>
  p{margin:0;font-size:.8rem;color:var(--muted)}
  fieldset{margin:0;padding:.55rem;min-width:0;border:1px solid var(--line);display:grid;align-items:end;
    grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem}
  legend{font-size:.8rem;padding:0 .25rem;font-weight:600}
  label{display:grid;gap:.24rem;font-size:.8rem;color:var(--muted);min-width:0}
  input[type="color"]{width:100%}
  .wide{grid-column:1/-1}
</style>
