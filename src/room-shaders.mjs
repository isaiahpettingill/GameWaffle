// The compiler samples each stock shader once. Players composite the samples
// over the room in screen space. The HUD uses a separate pass.
export const roomShaders = {
  hd: 'HD pixel smoothing',
  ripple: 'Water ripple',
  tint: 'Color wash',
  scanlines: 'Scanlines',
  grid: 'LCD grid',
  vignette: 'Vignette',
  fog: 'Fog',
  volumetric: 'Volumetric lighting',
  lens_flare: 'Lens flare',
  snow: 'Snow',
  rain: 'Rain',
  wind: 'Wind',
};

export const atmospherePresets = ['fog','volumetric','lens_flare','snow','rain','wind'];
export const shaderPresets = ['none',...Object.keys(roomShaders)];
export const shaderMaskLayers = ['screen','rows','columns'];

const atmosphereMasks = new Map();
function atmosphereMask(kind) {
  if(atmosphereMasks.has(kind))return atmosphereMasks.get(kind);
  const size=128, rgba=Buffer.alloc(size*size*4);
  const gaussian=(x,y,r)=>Math.exp(-(x*x+y*y)/(r*r));
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/(size-1), v=y/(size-1), i=(y*size+x)*4;
    let color, alpha;
    if(kind==='fog'){
      color=[197,212,224];
      const bank=Math.max(0,v-.34-.045*Math.sin(u*12)-.025*Math.sin(u*29));
      alpha=.12+.76*bank;
    }else if(kind==='volumetric'){
      color=[255,224,168];
      const ray=(origin,width)=>gaussian(u-origin-v*.47,0,width*(1+v));
      alpha=(.42*ray(.13,.044)+.30*ray(.25,.025)+.32*ray(.39,.055))*(1-.69*v);
    }else{
      color=[255,215,175];
      const x0=u-.24,y0=v-.29;
      const glare=.42*gaussian(x0,y0,.06)+.61*gaussian(x0,y0,.015);
      const streak=.24*gaussian(x0*.17,y0,.023);
      const ghosts=.23*gaussian(u-.52,v-.46,.034)+.15*gaussian(u-.64,v-.53,.018)+.16*gaussian(u-.82,v-.64,.06);
      alpha=glare+streak+ghosts;
    }
    rgba.set([...color,Math.min(255,Math.round(alpha*255))],i);
  }
  const mask={width:size,height:size,rgba};
  atmosphereMasks.set(kind,mask);
  return mask;
}

export function bakeShaderPreset(kind,images) {
  if(['none','hd','ripple','snow','rain','wind'].includes(kind))return;
  if(atmospherePresets.includes(kind)){
    images.set('shader/'+kind+'/screen',atmosphereMask(kind));
    return;
  }
  const masks=new Map();
  bakeRoomShader({kind,strength:100},masks);
  for(const [key,mask] of masks)images.set('shader/'+kind+'/'+key.slice(5),mask);
}

export function bakeRoomShader(settings, images) {
  if (!settings || settings.kind === 'none') return;
  const {kind, color = '#000000', strength = 35, spacing = 3, radius = 55} = settings;
  if (!Object.hasOwn(roomShaders, kind)) throw Error('Unknown room shader');
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw Error('Choose a six-digit shader color');
  for (const [value, min, max, label] of [[strength,0,100,'strength'],[spacing,2,12,'spacing'],[radius,0,95,'radius']]) {
    if (!Number.isInteger(value) || value < min || value > max) throw Error('Invalid room shader '+label);
  }
  if (strength === 0 || kind==='hd' || atmospherePresets.includes(kind)) return;
  if (kind==='ripple') {
    const {wavelength=32,speed=1}=settings;
    if (!Number.isInteger(wavelength)||wavelength<8||wavelength>128||!Number.isInteger(speed)||speed<0||speed>8) throw Error('Invalid ripple wavelength or speed');
    return [Math.ceil(strength*0.12),wavelength,speed];
  }
  const rgb = Number.parseInt(color.slice(1),16);
  function mask(id,width,height,opacity) {
    const rgba = Buffer.alloc(width*height*4);
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
      const i=4*(y*width+x);
      rgba[i]=rgb>>16; rgba[i+1]=rgb>>8; rgba[i+2]=rgb;
      rgba[i+3]=Math.round(255*strength/100*opacity(x,y));
    }
    images.set('post/'+id,{width,height,rgba});
  }
  if (kind==='tint') mask('screen',1,1,()=>1);
  if (kind==='scanlines' || kind==='grid') mask('rows',1,512,(_,y)=>Number(y%spacing===spacing-1));
  if (kind==='grid') mask('columns',512,1,x=>Number(x%spacing===spacing-1));
  if (kind==='vignette') mask('screen',128,128,(x,y)=>{
    const distance=Math.hypot((x-63.5)/63.5,(y-63.5)/63.5);
    const t=Math.min(1,Math.max(0,(distance-radius/100)/(1.42-radius/100)));
    return t*t*(3-2*t);
  });
}
