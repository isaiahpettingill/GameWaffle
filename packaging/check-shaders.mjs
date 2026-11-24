import assert from 'node:assert/strict';
import {cp,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assetCatalog} from '../src/asset-types.mjs';
import {prepareAssetUpload} from '../src/asset-upload.mjs';
import {compileProject,discoverAssets} from '../src/compiler.mjs';
import {pack} from '../src/pack.mjs';
import {projectStore} from '../src/project-store.mjs';
import {fileHistory} from '../src/file-history.mjs';
import {compileShader} from '../src/shader-assets.mjs';
import {compileShaderGraph} from '../src/compile-shader-graph.mjs';
import {starterShader} from '../src/shader-graph.mjs';
import {compileScript} from '../src/script.mjs';
import {parseScript,formatScript} from '../src/wafflescript.mjs';
import {Runtime,initSync,room_gradient_pixels} from '../web-built/runtime/runtime.js';

const temporary=await mkdtemp(join(tmpdir(),'waffle-shaders-'));
try{
  await cp('demo',temporary,{recursive:true});
  const store=await projectStore(temporary);
  const project=JSON.parse(await store.read('project.json','utf8'));
  const bytes=await readFile('src/shaders/presets.spv');
  const definition=await compileShader(bytes);
  assert.equal(definition.uniformSize,48);
  assert.deepEqual(definition.parameters.find(parameter=>parameter.name==='tint'),
    {name:'tint',offset:32,kind:'float',lanes:3});
  assert.match(definition.wgsl,/@fragment/);
  assert.match(definition.msl,/fragment /);
  await assert.rejects(compileShader(bytes.subarray(0,18)),/SPIR-V binary/);
  for(const kind of ['empty','crt','mist','day']){
    const graph=starterShader(kind), result=await compileShaderGraph(graph);
    assert.match(result.wgsl,/@fragment/,kind);
    assert.match(result.msl,/fragment /,kind);
    assert.ok(result.spirv.length>20,kind);
  }
  const graph=starterShader('crt');
  const first=await compileShaderGraph(graph);
  graph.nodes.find(node=>node.name==='strength').value=.5;
  const changed=await compileShaderGraph(graph);
  assert.equal(changed.fingerprint,first.fingerprint,'Uniform defaults reuse the compiled shader');
  assert.deepEqual(changed.parameters.find(parameter=>parameter.name==='strength').defaults,[.5]);
  const loop=starterShader('crt');
  loop.nodes.at(-1).inputs[0]=loop.output;
  await assert.rejects(compileShaderGraph(loop),/creates a loop/);
  const invalid=starterShader('empty');
  invalid.nodes[0].inputs=['n2'];
  invalid.nodes.push({id:'n2',kind:'time',inputs:[]});
  await assert.rejects(compileShaderGraph(invalid),/UV needs vector/);

  const upload=await prepareAssetUpload(project,store,{
    filename:'tint.spv',kind:'shader',name:'My Shader!',tags:['test','screen','test'],data:bytes,
  });
  assert.equal(upload.path,'assets/shaders/my-shader.spv');
  const history=fileHistory(store);
  const edit=await history.saveMany(upload.pending,()=>store.save([...upload.pending]));
  const restore=async(_,__,save,source)=>{
    await compileProject(temporary,{store:source});
    await save();
  };
  await history.restore(edit,true,restore);
  assert.ok(!(await discoverAssets(temporary,store)).includes(upload.path));
  assert.ok(!JSON.parse(await store.read('project.json','utf8')).shaders?.my_shader);
  await history.restore(edit,false,restore);
  const [asset]=assetCatalog(project,await discoverAssets(temporary,store)).filter(item=>item.kind==='shader');
  assert.equal(asset.name,'My Shader!');
  assert.deepEqual(asset.tags,['test','screen']);

  const game=parseScript(`on game startup
  apply_shaders
    shader("preset:scanlines", strength: 40)
    shader("my_shader", strength: 15, tint: [1.0, 0.5, 0.25])
  end
end
`);
  const room=parseScript(`on init
  apply_shaders
    shader("my_shader", strength: 75, tint: [0.75, 0.5, 0.25])
    shader("preset:fog")
  end
end
`);
  assert.deepEqual(parseScript(formatScript(room)),room);
  const scripts=new Map([['game',game],['room:'+project.start,room]]);
  const cart=await compileProject(temporary,{project,scripts,store});
  assert.equal(cart.runtimeAbi,13);
  assert.deepEqual(Object.keys(cart.shaders),['preset:scanlines','my_shader','preset:fog']);
  assert.throws(()=>compileScript(room,{},undefined,{roomScript:false,shaders:cart.shaderDefinitions}),/Room or Game/);
  assert.throws(()=>compileScript(parseScript('on init\n set_room_shader("fog",50)\nend'),{},undefined,{gameScript:true,roomScript:true}),/Room script/);
  assert.throws(()=>compileScript(parseScript('on init\napply_shaders\nshader("my_shader", tint: [1.0, 2.0])\nend\nend'),
    {},undefined,{roomScript:true,shaders:cart.shaderDefinitions}),/Invalid shader parameter tint/);

  initSync({module:await readFile('web-built/runtime/runtime_bg.wasm')});
  const runtime=Runtime.from_cartridge(pack(cart));
  try{
    const frame=JSON.parse(runtime.step_buttons(0));
    assert.deepEqual(frame.events.filter(event=>event.kind==='script_error'),[]);
    assert.deepEqual(frame.roomSettings.shaderPipeline.map(pass=>pass.shader),['my_shader','preset:fog']);
    assert.deepEqual(frame.gameSettings.postprocessing.map(pass=>pass.shader),['preset:scanlines','my_shader']);
    const roomUniforms=new Float32Array(new Uint32Array(frame.roomSettings.shaderPipeline[0].uniforms).buffer);
    assert.deepEqual([...roomUniforms.slice(8,11)],[.75,.5,.25]);
    const save=runtime.save_game();
    runtime.reset();
    runtime.load_game(save);
    const restored=JSON.parse(runtime.snapshot());
    assert.deepEqual(restored.roomSettings.shaderPipeline,frame.roomSettings.shaderPipeline);
    assert.deepEqual(restored.gameSettings.postprocessing,frame.gameSettings.postprocessing);
  }finally{runtime.free();}
  project.shaders.created_shader={title:'Created in Studio',source:'assets/shaders/created_shader.spv',graph};
  const gradientRoom=parseScript(`on init
  set_room_background("#242424")
  set_background_gradient("linear", "smooth")
  set_gradient_axis(0, 0, 1, 0)
  set_gradient_stop(1, 0, "#000000")
  set_gradient_stop(2, 0.5, "#ff0000")
  set_gradient_stop(3, 1, "#ffffff")
  apply_shaders
    shader("created_shader")
  end
end

on b
  set_background_gradient("linear", "dithered")
  set_gradient_palette_color(1, "#000000")
  set_gradient_palette_color(2, "#ffffff")
end

on x
  set_background_gradient("radial", "smooth")
  set_gradient_focus(1, 0.25, 0.5, 0.65, "#f00000")
  set_gradient_focus(2, 0.75, 0.5, 0.65, "#0000f0")
end

on a
  clear_gradient_slot("focus", 2)
end

on menu
  set_background_gradient("none", "smooth")
end
`);
  assert.deepEqual(parseScript(formatScript(gradientRoom)),gradientRoom);
  assert.throws(()=>compileScript(gradientRoom,{},undefined,{roomScript:false}),/room script/);
  const gradientCart=await compileProject(temporary,{project,scripts:new Map([['room:'+project.start,gradientRoom]]),store});
  assert.equal(gradientCart.runtimeAbi,16);
  const gradientRuntime=Runtime.from_cartridge(pack(gradientCart));
  try{
    const step=(input=0)=>{
      const frame=JSON.parse(gradientRuntime.step_buttons(input));
      assert.deepEqual(frame.events.filter(event=>event.kind==='script_error'),[]);
      return frame.roomSettings;
    };
    const draw=settings=>room_gradient_pixels(16,12,JSON.stringify(settings.backgroundGradient),settings.background);
    const pixel=(bytes,x,y)=>Array.from(bytes.slice((y*16+x)*4,(y*16+x)*4+3));
    const line=step();
    const lineColors=draw(line);
    assert.ok(pixel(lineColors,7,6)[0]>200);
    assert.ok(pixel(lineColors,7,6)[1]<30);
    assert.ok(pixel(lineColors,15,6)[1]>200);
    const pass=line.shaderPipeline[0], bytes=new Float32Array(new Uint32Array(pass.uniforms).buffer);
    assert.equal(bytes[changed.parameters.find(p=>p.name==='strength').offset/4],.5);
    const dither=step(32), pixels=draw(dither);
    assert.ok(dither.backgroundGradient.dithered);
    for(let i=0;i<pixels.length;i+=4){
      assert.ok([0,255].includes(pixels[i]));
      assert.equal(pixels[i],pixels[i+1]);
      assert.equal(pixels[i],pixels[i+2]);
    }
    assert.notDeepEqual([...new Set(pixels.slice(0,16*4).filter((_,index)=>index%4===0))],[0]);
    const radial=step(64), radialColors=draw(radial);
    assert.ok(pixel(radialColors,4,6)[0]>200);
    assert.ok(pixel(radialColors,12,6)[2]>200);
    const checkpoint=gradientRuntime.save_game();
    assert.equal(step(16).backgroundGradient.foci[1],null);
    gradientRuntime.load_game(checkpoint);
    assert.deepEqual(JSON.parse(gradientRuntime.snapshot()).roomSettings.backgroundGradient,radial.backgroundGradient);
    assert.equal(step(128)?.backgroundGradient,undefined);
  }finally{gradientRuntime.free();}
  console.log('Passed shader upload and graph compilation, pipeline scope and uniform defaults, gradient rendering and save restoration');
}finally{await rm(temporary,{recursive:true,force:true});}
