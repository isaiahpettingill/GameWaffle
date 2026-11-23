<script>
  import {Square,RotateCcw,Save,FolderOpen,Volume2,VolumeX,Maximize,Settings2} from '@lucide/svelte';
  import productIcon from '../packaging/gamewaffle.svg?inline';
  import { onMount } from 'svelte';
  import { unpack } from '../src/cartridge.mjs';
  import { buttons } from '../src/schema.mjs';
  import { createRuntime } from './runtime.js';
  import { drawRoom, loadAtlas } from './render.js';
  import { createAudio } from './audio.js';

  let canvas, shell, fileInput;
  let cart = $state.raw(null), snapshot = $state.raw(null);
  let touch = $state(false), muted = $state(true), players = $state(1);
  let status = $state('Loading cartridge…'), error = $state(''), lanSlots = $state([]);
  let runtime, atlasImages = {}, socket, loop, last = 0, elapsed = 0, loadVersion = 0;
  let slot=$state(1);
  const audio = createAudio();
  const keys = new Set(), fingers = new Map(), taps = new Set();
  const embedded = document.getElementById('gamewaffle-cartridge');
  const hosted = !embedded && /^https?:$/.test(location.protocol);
  const playtest=hosted && new URLSearchParams(location.search).has('playtest');
  let options=$state(false),stopped=false;
  function stop(){
    if(stopped)return;
    stopped=true;loadVersion++;cancelAnimationFrame(loop);disconnect();clear();audio.dispose();
    runtime?.free();runtime=null;
    if(window.__GAMEWAFFLE_PLAYTEST__){location.replace('/__stop_playtest');return;}
    if(window.opener){window.opener.focus();window.close();}
    if(!window.closed)location.replace('./index.html');
  }
  let startingRoom, currentBytes;
  const keyboard = { ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right', KeyZ:'a',Semicolon:'a',Quote:'b',Space:'x',MouseLeft:'a',MouseRight:'b',KeyX:'b',KeyC:'x',Enter:'menu',KeyW:'up',KeyS:'down',KeyA:'left',KeyD:'right' };
  const second = { KeyI:'up',KeyK:'down',KeyJ:'left',KeyL:'right',KeyN:'a',KeyM:'b',Comma:'x',Period:'menu' };
  const gamepad = [12,13,14,15,0,1,2,9];

  async function load(bytes, requestedRoom) {
    const next = unpack(bytes);
    const room = Object.hasOwn(next.rooms, requestedRoom) ? requestedRoom : next.start;
    const version = ++loadVersion;
    const firstAtlas = await loadAtlas(next.atlases[room]);
    const loadedRuntime = await createRuntime(bytes, room);
    if (version !== loadVersion) { loadedRuntime.free(); return; }
    runtime?.free();
    runtime = loadedRuntime;
    runtime.set_seed(crypto.getRandomValues(new Uint32Array(1))[0]);
    cart = next;
    currentBytes = bytes;
    startingRoom = room;
    atlasImages = {[room]:firstAtlas};
    audio.setCart(next);
    show(JSON.parse(runtime.snapshot()));
    status = 'Local game';
    error = '';
  }
  function show(frame) {
    if (snapshot?.room!==frame.room || snapshot?.tick>frame.tick) {
      const current=cart;
      for(const id of cart.rooms[frame.room].neighbors??[]){
        loadAtlas(cart.atlases[id]).then(image=>{if(current===cart)atlasImages[id]=image;}).catch(e=>{if(current===cart)error=e.message;});
      }
    }
    snapshot = frame;
    if (atlasImages[frame.room]) {
      if (canvas) drawRoom(canvas,cart,frame,atlasImages);
    } else if (cart.atlases[frame.room]) {
      const expected=cart;
      loadAtlas(cart.atlases[frame.room]).then(image=>{
        if (cart!==expected) return;
        atlasImages[frame.room]=image;
        if (canvas && snapshot?.room===frame.room) drawRoom(canvas,cart,snapshot,atlasImages);
      }).catch(err=>{error=String(err.message??err);});
    }
    const fault=frame.events?.find(event=>event.kind==='script_error');
    if (fault) error=`Script ${fault.actor}/${fault.event}: ${fault.message}`;
    audio.setRoom(frame.room);
    for (const sound of frame.sounds) audio.play(sound,.65);
  }
  function disconnect() {
    const connection = socket;
    socket = null;
    connection?.close();
    lanSlots = [];
  }
  async function join() {
    disconnect();
    error = '';
    try {
      status = 'Connecting…';
      const response = await fetch('./lan.waffle');
      if (!response.ok) throw Error('Cannot load the LAN cartridge');
      await load(new Uint8Array(await response.arrayBuffer()));
      status = 'Connecting…';
      const connection = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/lan`);
      socket = connection;
      connection.onopen = () => {
        if (socket !== connection) return;
        status = 'LAN game';
        connection.send(JSON.stringify({kind:'join',players}));
      };
      connection.onmessage = event => {
        if (socket !== connection) return;
        const msg = JSON.parse(event.data);
        if (msg.kind === 'slots') lanSlots = msg.slots;
        if (msg.kind === 'snapshot') show(msg.data);
      };
      connection.onclose = () => {
        if (socket !== connection) return;
        socket = null;
        lanSlots = [];
        status = 'Local game';
        error = 'LAN connection closed. Start the host with --lan and connect again.';
      };
    } catch (err) { error = String(err.message ?? err); status = 'Local game'; }
  }
  async function chooseFile(event) {
    const file = event.currentTarget.files[0];
    if (!file) return;
    disconnect();
    try { await load(new Uint8Array(await file.arrayBuffer())); }
    catch(err) { error = String(err.message ?? err); }
    event.target.value = '';
  }
  function inputs() {
    const result = [{},{},{},{}];
    for (const key of keys) {
      if (keyboard[key]) result[0][keyboard[key]] = true;
      if (players > 1 && second[key]) result[1][second[key]] = true;
    }
    for (const key of [...fingers.values(),...taps]) if (key) result[0][key] = true;
    const pads = [...(navigator.getGamepads?.() ?? [])].filter(Boolean).slice(0,players);
    for (const [index,pad] of pads.entries()) {
      const slot = pads.length === players ? index : Math.min(players - 1,index+1);
      for (const [i,button] of gamepad.entries()) if (pad.buttons[button]?.pressed) result[slot][buttons[i]] = true;
      for (const [i,on] of [pad.axes[1] < -.5,pad.axes[1] > .5,pad.axes[0] < -.5,pad.axes[0] > .5].entries()) {
        if (on) result[slot][buttons[i]] = true;
      }
    }
    return result;
  }
  function tick(now) {
    try {
      elapsed = Math.min(elapsed + (last ? now - last : 0),100);
      last = now;
      while (elapsed >= 1000/60) {
        elapsed -= 1000/60;
        const data = inputs();
        taps.clear();
        if (socket?.readyState === WebSocket.OPEN) {
          if (socket.bufferedAmount < 64_000) socket.send(JSON.stringify({kind:'input',input:data}));
         } else if (runtime && !socket) {
          runtime.set_view_size(Number(canvas.dataset.viewWidth)||canvas.width,Number(canvas.dataset.viewHeight)||canvas.height);
          const mask = data.reduce((bits,input,slot)=>buttons.reduce((value,button,index)=>
            input[button] ? value | (1 << (slot*8+index)) : value,bits),0) >>> 0;
          show(JSON.parse(runtime.step_buttons(mask)));
        }
      }
    } catch (err) {
      error = String(err.message ?? err);
      runtime?.free();
      runtime = null;
    }
    loop = requestAnimationFrame(tick);
  }
  function touchDown(event) {
    const button = event.target.closest('[data-button]')?.dataset.button;
    if (!button) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    fingers.set(event.pointerId,button);
    taps.add(button);
    event.preventDefault();
  }
  function touchMove(event) {
    if (!fingers.has(event.pointerId)) return;
    const button = document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-button]')?.dataset.button;
    if (button && fingers.get(event.pointerId) !== button) taps.add(button);
    fingers.set(event.pointerId,button);
  }
  function mouseChange(event) {
    if (event.type === 'mousedown' && event.target !== canvas) return;
    const key = ['MouseLeft',null,'MouseRight'][event.button];
    if (!key) return;
    if (event.type === 'mousedown') { keys.add(key); taps.add(keyboard[key]); canvas.focus(); }
    else keys.delete(key);
  }
  function touchUp(event) { fingers.delete(event.pointerId); }
  function press(event) {
    if(event.code==='Escape'){
      if(options)options=false;
      else if(playtest)stop();
      else return;
      event.preventDefault();return;
    }
    if (event.target.matches?.('input,select,textarea') || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.target.matches?.('button,a') && ['Enter','Space'].includes(event.code)) return;
    const button = keyboard[event.code];
    if (!button && !second[event.code]) return;
    keys.add(event.code);
    if (!event.repeat && button && ['a','b','x','menu'].includes(button)) taps.add(button);
    event.preventDefault();
  }
  function release(event) { keys.delete(event.code); }
  function clear() { keys.clear(); fingers.clear(); taps.clear(); }
  async function sound() {
    try { muted = await audio.toggle(); }
    catch { error = 'Audio is unavailable in this browser.'; }
  }
  function progress(write){
    try {
      const key=JSON.stringify(['GameWaffle',runtime.save_id(),slot]);
      if(write)localStorage.setItem(key,runtime.save_game());
      else {const saved=localStorage.getItem(key);if(!saved)throw Error('This slot is empty');runtime.load_game(saved);clear();show(JSON.parse(runtime.snapshot()));}
      status=(write?'Saved':'Loaded')+' slot '+slot;error='';
    }catch(err){error=String(err.message??err);}
  }
  function localReset() {
    disconnect();
    if (cart) load(currentBytes, startingRoom).catch(err=>{ error=String(err.message ?? err); });
  }
  function countChanged() {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({kind:'join',players}));
  }
  onMount(() => {
    if(playtest && new URLSearchParams(location.search).has('waiting')){status='Saving project…';return;}
    touch = matchMedia('(pointer:coarse)').matches;
    (async () => {
      try {
        const encoded=embedded?.textContent.trim();
        if (embedded && !encoded) { status='Choose a cartridge'; return; }
        const buffer=encoded
          ? Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))
          : new Uint8Array(await (await fetch('./demo.waffle')).arrayBuffer());
        const room = hosted ? new URLSearchParams(location.search).get('room') : undefined;
        await load(buffer, room);
      } catch (err) { error=String(err.message ?? err); status='Choose a cartridge'; }
    })();
    loop = requestAnimationFrame(tick);
    return () => {
      loadVersion++;
      cancelAnimationFrame(loop);
      disconnect();
      runtime?.free();
      audio.dispose();
    };
  });
</script>

<svelte:window onkeydown={press} onkeyup={release} onblur={clear} onmousedown={mouseChange} onmouseup={mouseChange} oncontextmenu={event=>{if(event.target===canvas)event.preventDefault();}} />
<main bind:this={shell} class="player">
  <header class="toolbar">
    <div class="identity"><img src={productIcon} width="24" height="24" alt=""><div><strong>{cart?.name??'GameWaffle'}</strong><small>{cart?.rooms[snapshot?.room]?.title??'Cartridge player'}</small></div></div>
    <div class="row transport">
      {#if playtest}<button class="stop" onclick={stop} title="Stop playtest (Esc)"><Square/>Stop</button>{/if}
      <button onclick={localReset} disabled={!cart} title="Restart game"><RotateCcw/>Reset</button>
      <label>Slot <select bind:value={slot}>{#each [1,2,3] as n}<option value={n}>{n}</option>{/each}</select></label>
      <button disabled={!cart||status==='LAN game'} onclick={()=>progress(true)}><Save/>Save</button>
      <button disabled={!cart||status==='LAN game'} onclick={()=>progress(false)}><FolderOpen/>Load</button>
      <button class="icon" title={muted?'Enable audio':'Mute audio'} aria-label={muted?'Enable audio':'Mute audio'} onclick={sound} aria-pressed={!muted}>{#if muted}<VolumeX/>{:else}<Volume2/>{/if}</button>
      {#if document.fullscreenEnabled}<button class="icon" aria-label="Fullscreen" title="Fullscreen" onclick={()=>document.fullscreenElement?document.exitFullscreen():shell.requestFullscreen().catch(()=>{})}><Maximize/></button>{/if}
      <button class="icon" aria-label="Player options" title="Player options" aria-expanded={options} onclick={()=>options=!options}><Settings2/></button>
      {#if !playtest}<button onclick={()=>fileInput.click()}>Open cartridge</button>{/if}
    </div>
  </header>
  <input hidden type="file" accept=".waffle" bind:this={fileInput} onchange={chooseFile} aria-label="Cartridge file">
  {#if options}<section class="options">
    <label>Players <select bind:value={players} onchange={countChanged}>{#each [1,2,3,4] as n}<option value={n}>{n}</option>{/each}</select></label>
    <button onclick={()=>{touch=!touch;clear();}} aria-pressed={touch}>Touch controls</button>
    {#if hosted}<button onclick={join}>Join LAN</button>{/if}
    <small>Move with WASD or arrows. Use Z, X, C, and Enter for A, B, X, and Start.</small>
    {#if players>1}<small>Player 2 uses IJKL, N, M, comma, and period.</small>{/if}
  </section>{/if}
  <div class="feedback" role="status">{status}{#if lanSlots.length} · P{lanSlots.map(n=>n+1).join(', P')}{/if}</div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="screen">
      <canvas tabindex="-1" aria-label="Game display" bind:this={canvas} width="128" height="128"></canvas>
      {#if touch}
        <div role="group" aria-label="Touch controls" class="touch" onpointerdown={touchDown} onpointermove={touchMove} onpointerup={touchUp} onpointercancel={touchUp} onlostpointercapture={touchUp}>
          <div class="dpad">
            <button data-button="up" aria-label="Up">▲</button>
            <button data-button="left" aria-label="Left">◀</button>
            <button data-button="right" aria-label="Right">▶</button>
            <button data-button="down" aria-label="Down">▼</button>
          </div>
          <button class="start" data-button="menu">Start</button>
          <div class="actions"><button data-button="x">X</button><button data-button="b">B</button><button data-button="a">A</button></div>
        </div>
      {/if}
    </div>
</main>

<style>
  main{height:100dvh;min-height:12rem;display:flex;flex-direction:column;background:#11111b;color:#cdd6f4}
  .toolbar,.options{display:flex;align-items:center;flex-wrap:wrap;gap:.4rem .7rem;padding:.35rem .6rem;background:#181825;border-bottom:1px solid #45475a}
  .identity{display:flex;align-items:center;gap:.45rem;margin-right:auto;min-width:0}.identity strong,.identity small{display:block}.identity strong{font-size:.92rem}.identity small,.options small{color:#bac2de;font-size:.75rem}
  .transport{gap:.25rem}.toolbar button,.options button,.toolbar select,.options select{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:.3rem;height:2rem;padding:0 .55rem;border:1px solid #45475a;border-radius:1px;background:#1e1e2e;color:inherit;font:500 .8125rem/1.2 system-ui}
  .toolbar button :global(svg){width:15px;height:15px}.toolbar button.icon{width:2rem;padding:0}.toolbar .stop{color:#f38ba8}
  label{display:inline-flex;align-items:center;gap:.3rem;font-size:.8rem;color:#bac2de}select{width:auto}
  .feedback,.error{font-size:.75rem;padding:.22rem .6rem;background:#181825}.feedback{color:#bac2de}.error{color:#f38ba8}
  .screen{flex:1;min-height:0;position:relative;display:grid;place-items:center;overflow:hidden}
  canvas{width:100%;height:100%;position:absolute;inset:0;object-fit:contain}
  .touch{position:absolute;inset:0;pointer-events:none;touch-action:none;display:flex;align-items:end;justify-content:space-between;padding:clamp(.35rem,2vw,1rem);}
  .touch button{pointer-events:auto;touch-action:none;user-select:none;background:#292537d9;border-color:#9d819ccc;color:#fff1d6;min-width:34px;min-height:34px;padding:.2rem;}
  .dpad{display:grid;grid-template:repeat(3,clamp(25px,7vw,47px))/repeat(3,clamp(25px,7vw,47px));gap:1px;}
  .dpad button{font-size:.8rem;min-width:0;min-height:0;}
  .dpad button:nth-child(1){grid-area:1/2;}
  .dpad button:nth-child(2){grid-area:2/1;}
  .dpad button:nth-child(3){grid-area:2/3;}
  .dpad button:nth-child(4){grid-area:3/2;}
  .actions{display:grid;grid-template-columns:repeat(2,clamp(32px,8vw,50px));gap:.25rem;}
  .actions button:first-child{grid-column:1/3;justify-self:center;}
  .actions button{border-radius:50%;aspect-ratio:1;font-weight:750;}
  .start{font-size:.73rem;}
  @media(pointer:coarse){.toolbar button,.options button,.toolbar select,.options select{height:2.75rem}.toolbar button.icon{width:2.75rem}}
</style>
