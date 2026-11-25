import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import WebSocket from 'ws';
import {compileProject} from '../src/compiler.mjs';
import {decodeFrame} from '../src/frame.mjs';
import {pack} from '../src/pack.mjs';
import {decodeSave} from '../src/save.mjs';
import {parseScript} from '../src/wafflescript.mjs';
import {createFrameClock,TICK_MS} from '../ui/frame-clock.js';
import {Runtime,initSync} from '../web-built/runtime/runtime.js';

let now=0;
const clock=createFrameClock(()=>now);
assert.equal(clock.run(0,()=>assert.fail('A fresh clock should not advance')),0);
assert.equal(clock.run(500,()=>{now+=9;}),1,'A slow step yields before starting extra catch-up work');
assert.equal(clock.run(500+TICK_MS,()=>{}),2,'Only one tick of catch-up debt is retained');
assert.equal(clock.run(1500,()=>{}),3,'A large gap caps catch-up at three simulation ticks');
assert.equal(clock.run(1500+TICK_MS,()=>false),0,'Blocked delivery does not consume a tick');
assert.equal(clock.run(1500+2*TICK_MS,()=>{}),2,'A blocked step retries when delivery becomes available');
clock.reset();
assert.equal(clock.run(5000,()=>{}),0,'Focus changes discard accumulated wall time');

initSync({module:await readFile('web-built/runtime/runtime_bg.wasm')});
const blank=()=>JSON.parse(demoSource);
const demoSource=await readFile('demo/project.json','utf8');
function scenario(count){
  const project=blank();
  project.sprites.busy={source:'assets/sprites/key.png',physics:{mode:'none'},alwaysActive:true};
  project.rooms.yard.entities=[
    {sprite:'maker',player:0,x:80,y:235},
    {sprite:'runner',player:1,x:140,y:235},
    ...Array.from({length:count},(_,i)=>({sprite:'busy',x:40+i%20*12,y:150})),
  ];
  const scripts=new Map(Object.keys(project.sprites).map(id=>[id,{events:{}}]));
  return {project,scripts};
}

const pressure=scenario(300);
pressure.scripts.set('busy',parseScript(`on start
while true
 change local.resumed by 1
end
end
on tick
while true
 change local.ticked by 1
end
end`));
pressure.scripts.set('runner',parseScript(`on tick
if action.right
 change global.moves by 1
end
if pressed.a
 change global.attacks by 1
end
end
on pressed.a
 change global.presses by 1
 wait(1)
 change global.resumes by 1
end
on after 0.05 seconds
 change global.timers by 1
end`));
const overloaded=pack(await compileProject('demo',pressure));
const stressed=Runtime.from_cartridge(overloaded);
stressed.set_connected_players(3);
for(const mask of [0,24<<8,24<<8,8<<8])stressed.advance_buttons(mask,1);
const checkpoint=stressed.save_game();
const initial=decodeSave(checkpoint);
assert.equal(initial.globals.moves,'3');
assert.equal(initial.globals.attacks,'1');
assert.equal(initial.globals.presses,'1');
assert.equal(initial.globals.resumes,'1');
assert.equal(initial.globals.timers,'1');
assert.ok(initial.scene.resume_cursor && initial.scene.tick_cursor,'The overload fixture must exercise both rotations');
const replay=Runtime.from_cartridge(overloaded);
replay.set_connected_players(3);
replay.load_game(checkpoint);
for(const runtime of [stressed,replay])runtime.advance_buttons(0,12);
function work(runtime){
  return decodeSave(runtime.save_game()).scene.actors
    .filter(actor=>actor.sprite==='busy').map(actor=>actor.locals);
}
const all=work(stressed);
assert.equal(all.length,300);
assert.ok(all.every(({resumed,ticked})=>Number(resumed)>0&&Number(ticked)>0),'Every actor gets both a continuation and a tick under load');
assert.deepEqual(work(replay),all,'Scheduler order survives a save and restore');
stressed.free();
replay.free();

const flow=scenario(0);
flow.scripts.set('maker',parseScript(`proc first()
  repeat 8
    wait(1)
    change global.calls by 1
    return
  end
  global.unreachable = 1
end
on a
  repeat 3
    first()
    change global.after_call by 1
  end
  repeat 5
    change global.repeat_count by 1
    if global.repeat_count == 2
      continue
    end
    if global.repeat_count == 4
      break
    end
    change global.repeat_score by 1
  end
  while global.outer < 4
    change global.outer by 1
    if global.outer < 2
      continue
    end
    repeat 3
      change global.inner by 1
      break
    end
    change global.after_inner by 1
    if global.outer == 3
      break
    end
  end
  return
  global.unreachable = 2
end
on b
  global.other_event = 1
end`));
const flowCart=pack(await compileProject('demo',flow));
const running=Runtime.from_cartridge(flowCart), resumed=Runtime.from_cartridge(flowCart);
running.advance_buttons(48,1);
const suspended=running.save_game();
assert.equal(decodeSave(suspended).globals.other_event,'1');
assert.equal(decodeSave(suspended).globals.after_call,undefined);
resumed.load_game(suspended);
for(const runtime of [running,resumed]){
  runtime.advance_buttons(0,12);
  const globals=decodeSave(runtime.save_game()).globals;
  for(const [name,value] of Object.entries({calls:3,after_call:3,repeat_count:4,repeat_score:2,outer:3,inner:2,after_inner:2,other_event:1}))
    assert.equal(globals[name],String(value),name);
  assert.equal(globals.unreachable,undefined);
  runtime.free();
}

const broadcasts=scenario(100);
broadcasts.scripts.set('busy',parseScript('on received.pulse\n change local.messages by 1\nend'));
broadcasts.scripts.set('maker',parseScript('on pressed.a\nrepeat 96\nemit_event("pulse")\nend\nend'));
broadcasts.scripts.set('game',parseScript('event pulse = "Pulse"'));
const listener=Runtime.from_cartridge(pack(await compileProject('demo',broadcasts)));
listener.advance_buttons(16,1);
listener.advance_buttons(0,6);
assert.ok(decodeSave(listener.save_game()).scene.actors
  .filter(actor=>actor.sprite==='busy').every(actor=>actor.locals.messages==='96'),
  'Broadcast recipients survive delivery-queue backpressure');
listener.free();

const split=scenario(0);
split.scripts.set('game',parseScript(`on game startup
 set_split_screen(true, 96)
end
on pressed.a
 set_split_screen(false, 0)
end`));
const splitCartridge=await compileProject('demo',split);
assert.equal(splitCartridge.runtimeAbi,18);
const splitRuntime=Runtime.from_cartridge(pack(splitCartridge));
assert.equal(decodeFrame(splitRuntime.snapshot()).gameSettings.splitScreen,96);
const splitSave=splitRuntime.save_game();
splitRuntime.advance_buttons(16,1);
assert.equal(decodeFrame(splitRuntime.snapshot()).gameSettings?.splitScreen,undefined);
splitRuntime.load_game(splitSave);
assert.equal(decodeFrame(splitRuntime.snapshot()).gameSettings.splitScreen,96);
splitRuntime.free();
split.scripts.set('maker',parseScript('on start\n set_split_screen(true, 0)\nend'));
await assert.rejects(compileProject('demo',split),/Use set_split_screen in the Game script/);

const multiplayer=scenario(0);
multiplayer.scripts.set('game',parseScript(`on tick
 global.seats = 0
 if controller_connected(1)
  change global.seats by 1
 end
 if controller_connected(2)
  change global.seats by 2
 end
 counter("Seats", global.seats)
end
on controller connected 2
 counter("Joined", 1)
end
on controller disconnected 1
 counter("P1 left", 1)
end`));
multiplayer.scripts.set('runner',parseScript(`on tick
 if pressed.right
  change local.controls by 1
 end
 if pressed.a
  change local.controls by 2
 end
 counter("P2 controls", local.controls)
end`));
const temp=await mkdtemp(join(tmpdir(),'gw-scheduler-'));
const file=join(temp,'lan.waffle');
await writeFile(file,pack(await compileProject('demo',multiplayer)));
const server=spawn(process.execPath,['src/server.mjs','--cart',file,'--lan','--port','0'],{stdio:['ignore','pipe','inherit']});
const clients=[];
try{
  const port=await new Promise((resolve,reject)=>{
    server.once('exit',code=>reject(Error('LAN host exited with '+code)));
    server.stdout.on('data',chunk=>{
      const match=String(chunk).match(/localhost:(\d+)/);
      if(match)resolve(Number(match[1]));
    });
  });
  async function joinSeat(players){
    const client=new WebSocket('ws://127.0.0.1:'+port+'/lan',{origin:'http://127.0.0.1:'+port});
    clients.push(client);
    const state={client};
    client.on('message',(bytes,binary)=>{
      if(binary)state.frame=decodeFrame(bytes);
      else{
        const data=JSON.parse(bytes.toString());
        if(data.kind==='slots')state.slots=data.slots;
      }
    });
    await once(client,'open');
    client.send(JSON.stringify({kind:'join',players}));
    return state;
  }
  async function until(label,ready){
    const end=performance.now()+4000;
    while(!ready()){
      if(performance.now()>end)throw Error('Timed out waiting for '+label);
      await delay(10);
    }
  }
  const first=await joinSeat(1);
  await until('P1 seat',()=>first.slots?.[0]===0 && first.frame?.counters.Seats===1);
  const second=await joinSeat(1);
  await until('P2 seat and joined event',()=>second.slots?.[0]===1 && second.frame?.counters.Seats===3 && second.frame.counters.Joined===1);
  for(const input of [[{right:true,a:true}],[{}]])second.client.send(JSON.stringify({kind:'input',input}));
  await until('both P2 control branches',()=>second.frame?.counters['P2 controls']===3);
  first.client.close();
  await until('exact connected roster',()=>second.frame?.counters.Seats===2 && second.frame.counters['P1 left']===1);
  const multiple=await joinSeat(3);
  await until('three couch seats on a LAN client',()=>multiple.slots?.length===3);
  const waiting=await joinSeat(1);
  await until('full lobby acknowledgement',()=>waiting.slots?.length===0);
  multiple.client.close();
  await until('waiting client inherits a free seat',()=>waiting.slots?.length===1);
}finally{
  for(const client of clients)client.terminate();
  server.kill();
  await rm(temp,{recursive:true,force:true});
}
console.log('Passed catch-up limits, script fairness and restore, broadcast backlog, independent control branches, split-screen settings, and LAN seat assignment');
