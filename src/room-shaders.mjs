// The compiler samples each stock shader once. Players composite the samples
// over the room in screen space. The HUD uses a separate pass.
export const roomShaders = {
  hd: 'HD pixel smoothing',
  ripple: 'Water ripple',
  tint: 'Color wash',
  scanlines: 'Scanlines',
  grid: 'LCD grid',
  vignette: 'Vignette',
};

export function bakeRoomShader(settings, images) {
  if (!settings || settings.kind === 'none') return;
  const {kind, color = '#000000', strength = 35, spacing = 3, radius = 55} = settings;
  if (!Object.hasOwn(roomShaders, kind)) throw Error('Unknown room shader');
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw Error('Choose a six-digit shader color');
  for (const [value, min, max, label] of [[strength,0,100,'strength'],[spacing,2,12,'spacing'],[radius,0,95,'radius']]) {
    if (!Number.isInteger(value) || value < min || value > max) throw Error('Invalid room shader '+label);
  }
  if (strength === 0 || kind==='hd') return;
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
