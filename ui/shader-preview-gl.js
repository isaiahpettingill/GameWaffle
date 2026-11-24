const vertexSource=`#version 300 es
out vec2 uv;
void main(){
  vec2 p=vec2((gl_VertexID << 1) & 2,gl_VertexID & 2);
  uv=vec2(p.x,1.0-p.y);
  gl_Position=vec4(p*2.0-1.0,0.0,1.0);
}`;

export function createShaderPreviewGL(){
  const canvas=document.createElement('canvas');
  const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:false,stencil:false});
  if(!gl)return null;
  function compile(type,source){
    const shader=gl.createShader(type);
    gl.shaderSource(shader,source);
    gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){
      const message=gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw Error(message);
    }
    return shader;
  }
  const vertex=compile(gl.VERTEX_SHADER,vertexSource);
  const texture=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  let program,parameters=[],samples=false,sourceWidth=0,sourceHeight=0;
  return {
    prepare(definition){
      if(gl.isContextLost())return false;
      const fragment=compile(gl.FRAGMENT_SHADER,definition.previewSource);
      const next=gl.createProgram();
      gl.attachShader(next,vertex);
      gl.attachShader(next,fragment);
      gl.linkProgram(next);
      gl.deleteShader(fragment);
      if(!gl.getProgramParameter(next,gl.LINK_STATUS)){
        const message=gl.getProgramInfoLog(next);
        gl.deleteProgram(next);
        throw Error(message);
      }
      if(program)gl.deleteProgram(program);
      program=next;
      samples=definition.samplesScreen;
      parameters=definition.parameters.map(parameter=>({...parameter,
        location:gl.getUniformLocation(program,'params.'+parameter.name)}));
      return true;
    },
    run(source,words,tick,size=[source.width,source.height]){
      if(gl.isContextLost())return {status:'The WebGL shader preview was interrupted.'};
      const [width,height]=size;
      if(canvas.width!==width)canvas.width=width;
      if(canvas.height!==height)canvas.height=height;
      gl.viewport(0,0,width,height);
      gl.useProgram(program);
      if(samples){
        if(sourceWidth!==source.width||sourceHeight!==source.height){
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
          sourceWidth=source.width;sourceHeight=source.height;
        }else gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,source);
      }
      const values=new Float32Array(words.buffer,words.byteOffset,words.length);
      for(const {automatic,lanes,location,offset} of parameters){
        if(location===null)continue;
        if(automatic==='resolution')gl.uniform2f(location,width,height);
        else if(automatic==='time')gl.uniform1f(location,tick/60);
        else{
          const i=offset/4;
          if(lanes===1)gl.uniform1f(location,values[i]);
          else if(lanes===2)gl.uniform2f(location,values[i],values[i+1]);
          else gl.uniform4f(location,values[i],values[i+1],values[i+2],values[i+3]);
        }
      }
      gl.drawArrays(gl.TRIANGLES,0,3);
      return {image:canvas};
    },
    dispose(){
      if(program)gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteTexture(texture);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
