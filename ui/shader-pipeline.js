const vertexSource = `
struct Out {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
}
@vertex fn fullscreen(@builtin(vertex_index) index: u32) -> Out {
  let uv = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
  return Out(vec4<f32>(uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0),
    vec4<f32>(1.0), uv);
}
`;
const upscale = {title:'Scale display', samplesScreen:true, wgsl:`
@group(0) @binding(0) var screen: texture_2d<f32>;
@group(0) @binding(1) var nearest: sampler;
@fragment fn waffle_fragment(@location(1) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(screen, nearest, uv);
}`};

let deviceState;
function getDevice() {
  if (deviceState) return deviceState;
  const state = deviceState = {status:'Compiling shaders…'};
  if (!globalThis.navigator?.gpu) {
    state.status = 'Custom shaders need WebGPU in this player.';
    return state;
  }
  (async () => {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw Error('A WebGPU adapter is unavailable.');
    const device = await adapter.requestDevice();
    state.device = device;
    state.vertex = device.createShaderModule({code:vertexSource});
    state.sampler = device.createSampler({magFilter:'nearest',minFilter:'nearest'});
    state.programs = new WeakMap();
    state.status = '';
    device.lost.then(() => {
      if (deviceState === state) deviceState = undefined;
    });
  })().catch(error => state.status = error.message);
  return state;
}

function programFor(gpu, definition) {
  const cached = gpu.programs.get(definition);
  if (cached) return cached;
  const program = {status:'Compiling shaders…'};
  gpu.programs.set(definition, program);
  const {device, vertex} = gpu;
  (async () => {
    const entries = [];
    if (definition.samplesScreen) {
      entries.push({binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}});
      entries.push({binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}});
    }
    if (definition.uniformSize)
      entries.push({binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform',minBindingSize:definition.uniformSize}});
    const bindings = device.createBindGroupLayout({entries});
    const module = device.createShaderModule({code:definition.wgsl,label:definition.title});
    const pipeline = await device.createRenderPipelineAsync({
      label:definition.title, layout:device.createPipelineLayout({bindGroupLayouts:[bindings]}),
      vertex:{module:vertex,entryPoint:'fullscreen'},
      fragment:{module,entryPoint:'waffle_fragment',targets:[{format:'rgba8unorm'}]},
      primitive:{topology:'triangle-list'},
    });
    program.layout = bindings;
    program.pipeline = pipeline;
    program.status = '';
  })().catch(error => program.status = (definition.title||'Shader')+' — '+error.message);
  return program;
}

export function previewShaderStatus(definition) {
  const gpu=getDevice();
  return gpu.device?programFor(gpu,definition).status:gpu.status;
}

const stages = new WeakMap();
const texture = (device,width,height)=>device.createTexture({size:[width,height],format:'rgba8unorm',
  usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});

function stageFor(canvas, kind, gpu, width, height, source, scratch) {
  let pair = stages.get(canvas);
  if (!pair) stages.set(canvas,pair={});
  let stage = pair[kind];
  if (!stage || stage.device !== gpu.device) {
    const surface = new OffscreenCanvas(width,height);
    const context = surface.getContext('webgpu');
    if (!context) throw Error('WebGPU canvas rendering is unavailable.');
    stage = pair[kind] = {surface,context,device:gpu.device,slots:[]};
  }
  if (stage.width !== width || stage.height !== height || stage.sourceWidth !== source.width || stage.sourceHeight !== source.height) {
    stage.surface.width = stage.width = width;
    stage.surface.height = stage.height = height;
    stage.context.configure({device:gpu.device,format:'rgba8unorm',alphaMode:'opaque',
      usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
    for (const texture of stage.textures??[]) texture.destroy();
    stage.input?.destroy();
    stage.sourceWidth=source.width;
    stage.sourceHeight=source.height;
    stage.input=source.width===width&&source.height===height?null:texture(gpu.device,source.width,source.height);
    stage.textures=[texture(gpu.device,width,height)];
    stage.views=[stage.textures[0].createView()];
    stage.inputView=stage.input?.createView();
    for (const slot of stage.slots) slot?.buffer?.destroy();
    stage.slots.length = 0;
  }
  if(scratch&&stage.textures.length===1){
    stage.textures.push(texture(gpu.device,width,height));
    stage.views.push(stage.textures[1].createView());
  }
  return stage;
}

function bindStage(stage, gpu, definition, program, index, sourceIndex) {
  let slot = stage.slots[index];
  if (slot?.program === program && slot.sourceIndex === sourceIndex) return slot;
  slot?.buffer?.destroy();
  const entries = [];
  if (definition.samplesScreen)
    entries.push({binding:0,resource:sourceIndex<0?stage.inputView:stage.views[sourceIndex]}, {binding:1,resource:gpu.sampler});
  const buffer = definition.uniformSize ? gpu.device.createBuffer({
    size:definition.uniformSize,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,
  }) : null;
  if (buffer) entries.push({binding:2,resource:{buffer}});
  return stage.slots[index] = {
    program,sourceIndex,buffer,
    words:buffer?new Uint32Array(definition.uniformSize/4):null,
    group:gpu.device.createBindGroup({layout:program.layout,entries}),
  };
}

function writeUniforms(queue, slot, definition, data, width, height, tick) {
  if (!slot.buffer) return;
  slot.words.fill(0);
  slot.words.set(data.slice(0,slot.words.length));
  const floats = new Float32Array(slot.words.buffer);
  for (const param of definition.parameters) {
    const offset = param.offset/4;
    if (param.automatic==='resolution') { floats[offset]=width;floats[offset+1]=height; }
    if (param.automatic==='time') floats[offset]=tick/60;
    if (param.automatic==='delta_time') floats[offset]=1/60;
  }
  queue.writeBuffer(slot.buffer,0,slot.words);
}

export function runShaderPipeline(owner, kind, source, shaders, passes, tick, size) {
  if (!passes?.length) return {};
  const gpu = getDevice();
  if (!gpu.device) return {status:gpu.status};
  const {device} = gpu;
  const pipeline = [];
  for (const pass of passes) {
    const definition = Object.hasOwn(shaders??{},pass.shader)?shaders[pass.shader]:null;
    if (!definition) return {status:'Missing shader '+pass.shader};
    const program = programFor(gpu,definition);
    if (!program.pipeline) return {status:program.status};
    pipeline.push({definition,program,uniforms:pass.uniforms});
  }
  const [width,height] = size??[source.width,source.height];
  const scaling=width!==source.width||height!==source.height;
  if(scaling){
    const program=programFor(gpu,upscale);
    if(!program.pipeline)return {status:program.status};
    pipeline.unshift({definition:upscale,program});
  }
  try {
    const stage = stageFor(owner,kind,gpu,width,height,source,passes.length>1);
    device.queue.copyExternalImageToTexture({source},{texture:stage.input??stage.textures[0]},[source.width,source.height]);
    const encoder = device.createCommandEncoder();
    for (const [index,{definition,program,uniforms}] of pipeline.entries()) {
      const from = (index-Number(scaling)) % 2;
      const slot = bindStage(stage,gpu,definition,program,index,from);
      writeUniforms(device.queue,slot,definition,uniforms,width,height,tick);
      const view = index===pipeline.length-1 ? stage.context.getCurrentTexture().createView() : stage.views[from<0?0:1-from];
      const commands = encoder.beginRenderPass({colorAttachments:[{view,clearValue:[0,0,0,1],loadOp:'clear',storeOp:'store'}]});
      commands.setPipeline(program.pipeline);
      commands.setBindGroup(0,slot.group);
      commands.draw(3);
      commands.end();
    }
    device.queue.submit([encoder.finish()]);
    return {image:stage.surface.transferToImageBitmap()};
  } catch (error) {
    return {status:error.message};
  }
}
