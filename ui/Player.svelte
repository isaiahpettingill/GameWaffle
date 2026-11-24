<script>
  import {decodeFrame} from '../src/frame.mjs';
  import {Square,RotateCcw,Save,FolderOpen,Volume2,VolumeX,Maximize,Settings2} from '@lucide/svelte';
  import productIcon from '../packaging/gamewaffle.svg?inline';
  import { onMount } from 'svelte';
  import { unpack } from '../src/cartridge.mjs';
  import { buttons } from '../src/schema.mjs';
  import { createRuntime } from './runtime.js';
  import { accessSaveSlot } from './save-store.js';
  import { createFrameClock } from './frame-clock.js';
  import { drawRoom, loadAtlas } from './render.js';
  import { createAudio } from './audio.js';

  let shaderStatus=$state('');
  let canvas, presentation, shell, fileInput;
  let cart = $state.raw(null), snapshot = $state.raw(null);
  let touch = $state(false), muted = $state(true), players = $state(1);
  let status = $state('Loading cartridge…'), error = $state(''), lanSlots = $state([]);
  let runtime, atlasImages = {}, socket, loop, loadVersion = 0, lanPaint=false;
  let slot=$state(1), savePending=$state(false);
  const audio = createAudio();
  const keys = new Set(), fingers = new Map(), taps = [new Set(),new Set()];
  const frameClock=createFrameClock();
  const embedded = document.getElementById('gamewaffle-cartridge');
  const hosted = !embedded && /^https?:$/.test(location.protocol);
  const query=new URLSearchParams(location.search);
  const playtest=hosted && query.has('playtest');
  let options=$state(false),stopped=false;
  function stop(){
    if(stopped)return;
    stopped=true;loadVersion++;cancelAnimationFrame(loop);disconnect();clear();audio.dispose();
    runtime?.free();runtime=null;
    if(window.parent!==window && new URLSearchParams(location.search).has('inline')){
      window.parent.postMessage('gamewaffle:stop-playtest',location.origin);
      return;
    }
    if(window.__GAMEWAFFLE_PLAYTEST__){location.replace('/__stop_playtest');return;}
    if(window.opener){window.opener.focus();window.close();}
    if(!window.closed)location.replace('./index.html');
  }
  let startingRoom, currentBytes;
  const keyboard = { ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right', KeyZ:'a',Semicolon:'a',Quote:'b',Space:'x',MouseLeft:'a',MouseRight:'b',KeyX:'b',KeyC:'x',Enter:'menu',KeyW:'up',KeyS:'down',KeyA:'left',KeyD:'right' };
  const second = { KeyI:'up',KeyK:'down',KeyJ:'left',KeyL:'right',KeyN:'a',KeyM:'b',Comma:'x',Period:'menu' };
  const gamepad = [12,13,14,15,0,1,2,9];
  const connectedPads=()=>Array.from(navigator.getGamepads?.()??[]).filter(pad=>pad?.connected);
  const padSlots=new Map();
  let padRange='';

  function cameraWindow(){
    const box=canvas?.parentElement?.getBoundingClientRect();
    return box?.width&&box?.height?[Math.floor(box.width),Math.floor(box.height)]:[640,480];
  }

  async function load(bytes, requestedRoom) {
    const next = unpack(bytes);
    const room = Object.hasOwn(next.rooms, requestedRoom) ? requestedRoom : next.start;
    const version = ++loadVersion;
    const firstAtlas = await loadAtlas(next.atlases[room]);
    const loadedRuntime = await createRuntime(bytes, room, Math.min(connectedPads().length,4),cameraWindow());
    if (version !== loadVersion) { loadedRuntime.free(); return; }
    runtime?.free();
    runtime = loadedRuntime;
    runtime.set_seed(crypto.getRandomValues(new Uint32Array(1))[0]);
    cart = next;
    currentBytes = bytes;
    startingRoom = room;
    atlasImages = {[room]:firstAtlas};
    audio.setCart(next);
    error = '';
    show(decodeFrame(runtime.snapshot()));
    status = 'Local game';
  }
  function show(frame,paint=true) {
    if (snapshot?.room!==frame.room || snapshot?.tick>frame.tick) {
      const current=cart;
      for(const id of cart.rooms[frame.room].neighbors??[]){
        loadAtlas(cart.atlases[id]).then(image=>{if(current===cart)atlasImages[id]=image;}).catch(e=>{if(current===cart)error=e.message;});
      }
    }
    snapshot = frame;
    if(paint)paintFrame(frame);
    const fault=frame.events?.find(event=>event.kind==='script_error');
    if (fault) error=`Script ${fault.actor}/${fault.event}: ${fault.message}`;
    audio.setRoom(frame.room,frame.roomSettings);
    for (const sound of frame.sounds) audio.play(sound,.65);
  }
  function paintFrame(frame){
    if (atlasImages[frame.room]) {
      if (canvas) shaderStatus=drawRoom(canvas,cart,frame,atlasImages,false,presentation)??'';
    } else if (cart.atlases[frame.room]) {
      const expected=cart;
      loadAtlas(cart.atlases[frame.room]).then(image=>{
        if (cart!==expected) return;
        atlasImages[frame.room]=image;
        if (canvas && snapshot?.room===frame.room) shaderStatus=drawRoom(canvas,cart,snapshot,atlasImages,false,presentation)??'';
      }).catch(err=>{error=String(err.message??err);});
    }
  }
  function disconnect() {
    const connection = socket;
    socket = null;
    connection?.close();
    lanSlots = [];
    lanPaint = false;
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
      connection.binaryType = 'arraybuffer';
      socket = connection;
      connection.onopen = () => {
        if (socket !== connection) return;
        connection.send(JSON.stringify({kind:'join',players}));
      };
      connection.onmessage = event => {
        if (socket !== connection) return;
        if (typeof event.data !== 'string') {
          show(decodeFrame(new Uint8Array(event.data)),false);
          lanPaint=true;
        } else {
          const msg = JSON.parse(event.data);
          if (msg.kind === 'slots') {
            lanSlots = msg.slots;
            status=lanSlots.length?'LAN game':'Waiting for a LAN slot…';
          }
        }
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
    for (const key of fingers.values()) if (key) result[0][key] = true;
    for(const [slot,pending] of taps.entries()){
      if(slot===0||players>1)for(const key of pending)result[slot][key]=true;
    }
    const pads=connectedPads();
    const end=socket?lanSlots.length:4;
    const authored=snapshot?.gameSettings?.firstControllerSlot;
    const first=Math.min(end-1,authored??0);
    const range=first+':'+end+':'+players;
    const order=Array.from({length:end},(_,slot)=>slot).filter(slot=>slot>=first);
    if(authored==null && players>1 && pads.length<players && order.length>1)order.push(order.shift());
    if(range!==padRange){padSlots.clear();padRange=range;}
    for(const id of padSlots.keys())if(!pads.some(pad=>pad.index===id))padSlots.delete(id);
    const occupied=new Set(padSlots.values());
    let connected=players>1?3:1;
    for (const pad of pads) {
      let slot=padSlots.get(pad.index);
      if(slot===undefined){
        slot=order.find(slot=>!occupied.has(slot));
        if(slot===undefined)continue;
        padSlots.set(pad.index,slot);
        occupied.add(slot);
      }
      connected|=1<<slot;
      for (const [i,button] of gamepad.entries()) if (pad.buttons[button]?.pressed) result[slot][buttons[i]] = true;
      for (const [i,on] of [pad.axes[1] < -.5,pad.axes[1] > .5,pad.axes[0] < -.5,pad.axes[0] > .5].entries()) {
        if (on) result[slot][buttons[i]] = true;
      }
    }
    if(runtime&&!socket)runtime.set_connected_players(connected);
    return result;
  }
  function tick(now) {
    try {
      let updated=false;
      frameClock.run(now,()=>{
        if(socket ? !lanSlots.length || socket.readyState!==WebSocket.OPEN || socket.bufferedAmount>=64_000 : !runtime)return false;
        const data = inputs();
        if (socket) {
          socket.send(JSON.stringify({kind:'input',slots:lanSlots,input:data}));
        } else {
          if(!updated && cart?.runtimeAbi>=15)runtime.set_camera_window(...cameraWindow(),true);
          runtime.set_view_size(Number(canvas.dataset.viewWidth)||canvas.width,Number(canvas.dataset.viewHeight)||canvas.height);
          const mask = data.reduce((bits,input,slot)=>buttons.reduce((value,button,index)=>
            input[button] ? value | (1 << (slot*8+index)) : value,bits),0) >>> 0;
          show(decodeFrame(runtime.step_buttons(mask)),false);
          updated=true;
        }
        for(const pending of taps)pending.clear();
      });
      if(updated||lanPaint){
        lanPaint=false;
        paintFrame(snapshot);
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
    taps[0].add(button);
    event.preventDefault();
  }
  function touchMove(event) {
    if (!fingers.has(event.pointerId)) return;
    const button = document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-button]')?.dataset.button;
    if (button && fingers.get(event.pointerId) !== button) taps[0].add(button);
    fingers.set(event.pointerId,button);
  }
  function mouseChange(event) {
    if (event.type === 'mousedown' && event.target !== canvas) return;
    const key = ['MouseLeft',null,'MouseRight'][event.button];
    if (!key) return;
    if (event.type === 'mousedown') { keys.add(key); taps[0].add(keyboard[key]); canvas.focus(); }
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
    if (!event.repeat) {
      if(button)taps[0].add(button);
      if(players>1 && second[event.code])taps[1].add(second[event.code]);
    }
    event.preventDefault();
  }
  function release(event) { keys.delete(event.code); }
  function clear() {
    keys.clear();fingers.clear();
    for(const pending of taps)pending.clear();
    frameClock.reset();
  }
  async function sound() {
    try { muted = await audio.toggle(); }
    catch { error = 'Audio is unavailable in this browser.'; }
  }
  async function progress(write){
    if(!runtime||socket||savePending)return;
    const engine=runtime, saveSlot=slot;
    savePending=true;
    try {
      const saved=await accessSaveSlot(engine.save_id(),saveSlot,write?engine.save_game():undefined);
      if(engine!==runtime||socket)return;
      if(!write){
        if(!saved)throw Error('This slot is empty');
        engine.load_game(saved);
        clear();
        show(decodeFrame(engine.snapshot()));
      }
      status=(write?'Saved':'Loaded')+' slot '+saveSlot;error='';
    }catch(err){
      if(engine===runtime&&!socket)error=String(err.message??err);
    }finally{savePending=false;}
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
        if (!encoded&&!playtest&&!(hosted&&query.has('play'))) { status='Choose a cartridge'; return; }
        const buffer=encoded
          ? Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))
          : new Uint8Array(await (await fetch('./game.waffle')).arrayBuffer());
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
      <button disabled={!cart||status==='LAN game'||savePending} onclick={()=>progress(true)}><Save/>Save</button>
      <button disabled={!cart||status==='LAN game'||savePending} onclick={()=>progress(false)}><FolderOpen/>Load</button>
      <button class="icon" title={muted?'Enable audio':'Mute audio'} aria-label={muted?'Enable audio':'Mute audio'} onclick={sound} aria-pressed={!muted}>{#if muted}<VolumeX/>{:else}<Volume2/>{/if}</button>
      {#if document.fullscreenEnabled}<button class="icon" aria-label="Fullscreen" title="Fullscreen" onclick={()=>document.fullscreenElement?document.exitFullscreen():shell.requestFullscreen().catch(()=>{})}><Maximize/></button>{/if}
      <button aria-label="Player options" title="Player options" aria-expanded={options} onclick={()=>options=!options}><Settings2/>Players</button>
      {#if !playtest}<button onclick={()=>fileInput.click()}>Open cartridge</button>{/if}
    </div>
  </header>
  <input hidden type="file" accept=".waffle" bind:this={fileInput} onchange={chooseFile} aria-label="Cartridge file">
  {#if options}<section class="options">
    <label>Players on this device <select bind:value={players} onchange={countChanged}>{#each [1,2,3,4] as n}<option value={n}>{n}</option>{/each}</select></label>
    <button onclick={()=>{touch=!touch;clear();}} aria-pressed={touch}>Touch controls</button>
    {#if hosted}<button onclick={join}>Join LAN</button>{/if}
    <small>Move with WASD or arrows. Use Z, X, C, and Enter for A, B, X, and Start.</small>
    <small>Local players share this screen. Connect a gamepad for each additional player.</small>
    {#if players>1}<small>Player 2 uses IJKL, N, M, comma, and period.</small>{/if}
  </section>{/if}
  <div class="feedback" role="status">{shaderStatus||status}{#if lanSlots.length} · P{lanSlots.map(n=>n+1).join(', P')}{/if}</div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <div class="playfield">
    <div class="screen">
      <canvas tabindex="-1" aria-label="Game display" bind:this={canvas} width="128" height="128"></canvas>
      <canvas class="shader-output" aria-hidden="true" hidden bind:this={presentation}></canvas>
    </div>
      {#if touch&&cart}
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
  .transport{gap:.25rem}.toolbar button,.options button,.toolbar select,.options select{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:.3rem;height:2rem;padding:0 .55rem;border:1px solid #45475a;border-radius:1px;background-color:#1e1e2e;color:inherit;font:500 .8125rem/1.2 system-ui}
  .toolbar select,.options select{display:inline-block;line-height:normal;padding-inline-end:1.75rem}
  .toolbar button :global(svg){width:15px;height:15px}.toolbar button.icon{width:2rem;padding:0}.toolbar .stop{color:#f38ba8}
  label{display:inline-flex;align-items:center;gap:.3rem;font-size:.8rem;color:#bac2de}select{width:auto}
  .feedback,.error{font-size:.75rem;padding:.22rem .6rem;background:#181825}.feedback{color:#bac2de}.error{color:#f38ba8}
  .playfield{flex:1;min-height:0;position:relative;display:flex;flex-direction:column}
  .screen{flex:1;min-height:0;position:relative;display:grid;place-items:center;overflow:hidden}
  canvas{width:100%;height:100%;position:absolute;inset:0;object-fit:contain}
  .shader-output{pointer-events:none}
  .touch{position:absolute;inset:0;pointer-events:none;touch-action:none;display:grid;grid-template-columns:1fr auto 1fr;align-items:end;padding:clamp(.35rem,2vw,1rem);}
  .touch button{pointer-events:auto;touch-action:none;user-select:none;background:#292537d9;border-color:#9d819ccc;color:#fff1d6;min-width:34px;min-height:34px;padding:.2rem;}
  @media (orientation:portrait){
    .touch{position:relative;inset:auto;flex:none;align-items:center;min-height:min(24dvh,10rem);padding:.6rem .9rem calc(.6rem + env(safe-area-inset-bottom));background:#181825;border-top:1px solid #45475a}
    .start{transform:translateY(.8rem)}
  }
  .dpad{justify-self:start;display:grid;grid-template:repeat(3,clamp(25px,7vw,47px))/repeat(3,clamp(25px,7vw,47px));gap:1px;}
  .dpad button{font-size:.8rem;min-width:0;min-height:0;}
  .dpad button:nth-child(1){grid-area:1/2;}
  .dpad button:nth-child(2){grid-area:2/1;}
  .dpad button:nth-child(3){grid-area:2/3;}
  .dpad button:nth-child(4){grid-area:3/2;}
  .actions{--face-size:clamp(34px,8vw,50px);display:grid;grid-template:repeat(4,calc(var(--face-size)/2))/repeat(2,var(--face-size));gap:2px 4px;justify-self:end;align-items:center}
  .actions [data-button=x]{grid-area:1/1/span 2}
  .actions [data-button=b]{grid-area:3/1/span 2}
  .actions [data-button=a]{grid-area:2/2/span 2}
  .actions button{width:var(--face-size);height:var(--face-size);border-radius:50%;font-weight:750;}
  .start{font-size:.73rem;}
  @media(pointer:coarse){.toolbar button,.options button,.toolbar select,.options select{height:2.75rem}.toolbar button.icon{width:2.75rem}}
</style>
