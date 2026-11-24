// Keep the framebuffer on the graphics path. The caller retains the CPU
// implementation for browser sessions with WebGL disabled.
const processors=new WeakMap();
const vertex=`#version 300 es
void main() {
  vec2 p=vec2((gl_VertexID << 1) & 2,gl_VertexID & 2);
  gl_Position=vec4(p*2.0-1.0,0.0,1.0);
}`;
const fragment=`#version 300 es
precision highp float;
precision highp int;
uniform sampler2D scene;
uniform ivec2 size;
uniform int strength;
uniform vec3 ripple;
out vec4 color;

ivec3 pixel(ivec2 p) {
  return ivec3(round(texelFetch(scene,clamp(p,ivec2(0),size-1),0).rgb*255.0));
}
int difference(ivec3 a,ivec3 b) {
  ivec3 d=abs(a-b);
  return (2*d.r+4*d.g+d.b)/7;
}
void main() {
  ivec2 outSize=strength>0 ? size*2 : size;
  ivec2 q=ivec2(int(gl_FragCoord.x),outSize.y-1-int(gl_FragCoord.y));
  if(strength==0) {
    int y=q.y/2*2;
    int shift=int(round(ripple.x*sin(6.28318530718*(float(y)/ripple.y+ripple.z))));
    color=vec4(vec3(pixel(q-ivec2(shift,0)))/255.0,1.0);
    return;
  }
  ivec2 p=q/2;
  int dx=q.x%2*2-1,dy=q.y%2*2-1;
  ivec3 c=pixel(p),u=pixel(p+ivec2(dx,0)),v=pixel(p+ivec2(0,dy));
  if(all(equal(c,u)) && all(equal(c,v))) {
    color=vec4(vec3(c)/255.0,1.0);
    return;
  }
  int du=difference(c,u),dv=difference(c,v);
  int threshold=min(du,dv)/2;
  bool corner=difference(u,v)<threshold &&
    difference(u,pixel(p-ivec2(dx,0)))>threshold &&
    difference(v,pixel(p-ivec2(0,dy)))>threshold;
  int weight=(corner?80:max(0,28-max(du,dv)/3))*strength/100;
  color=vec4(vec3((c*(256-2*weight)+(u+v)*weight+128)/256)/255.0,1.0);
}`;

function create(){
  const canvas=document.createElement('canvas');
  const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:false,stencil:false});
  if(!gl)return null;
  function compile(type,source){
    const shader=gl.createShader(type);
    gl.shaderSource(shader,source);
    gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));
    return shader;
  }
  const program=gl.createProgram();
  gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));
  gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));
  gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const texture=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  const uniforms=Object.fromEntries(['size','strength','ripple'].map(name=>[name,gl.getUniformLocation(program,name)]));
  return {gl,canvas,uniforms,sourceWidth:0,sourceHeight:0};
}

export function postprocess(source,width,height,strength=0,ripple=[0,1,0]){
  if(!processors.has(source)){
    try{processors.set(source,create());}catch{processors.set(source,null);}
  }
  const entry=processors.get(source);
  if(!entry||entry.gl.isContextLost())return null;
  const {gl,canvas,uniforms}=entry;
  const outWidth=strength?width*2:width,outHeight=strength?height*2:height;
  if(canvas.width!==outWidth||canvas.height!==outHeight){
    canvas.width=outWidth;canvas.height=outHeight;
  }
  gl.viewport(0,0,outWidth,outHeight);
  if(entry.sourceWidth!==source.width||entry.sourceHeight!==source.height){
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
    entry.sourceWidth=source.width;entry.sourceHeight=source.height;
  }else gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,source);
  gl.uniform2i(uniforms.size,width,height);
  gl.uniform1i(uniforms.strength,strength);
  gl.uniform3f(uniforms.ripple,...ripple);
  gl.drawArrays(gl.TRIANGLES,0,3);
  return canvas;
}
