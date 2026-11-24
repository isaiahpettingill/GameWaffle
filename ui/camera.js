const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export function cameraView(config,room,atlas,window,focus,zoom,cameraHeight=room.cameraHeight){
  const resolution=config.resolution?.map(axis=>clamp(axis,64,512));
  const fitting=(pixels,min,max)=>{
    min=clamp(min??128,128,512);
    return clamp(Math.floor(pixels/Math.max(1,config.zoom??2)),min,clamp(max??512,min,512));
  };
  const fullHeight=Math.max(1,room.height);
  const extent=[Math.max(1,room.width),clamp(cameraHeight??room.height,1,fullHeight)];
  const [width,height]=(resolution??[
    fitting(window[0],config.min_width,config.max_width),
    fitting(window[1],config.min_height,config.max_height),
  ]).map((axis,i)=>Math.min(zoom?clamp(Math.floor(axis/zoom),64,512):axis,extent[i]));
  const seam=(edge,axis)=>room.seams?.[edge]?(atlas.entries['seam/'+edge]?.[axis]??0):0;
  const origin=(center,size,limit,before,after)=>{
    const half=Math.floor(size/2);
    return clamp(Math.round(center)-half,-Math.min(half,before),limit-size+Math.min(size-half,after));
  };
  return {
    x:origin(focus[0],width,extent[0],seam('left',2),seam('right',2)),
    y:origin(focus[1],height,extent[1],seam('up',3),cameraHeight==null||cameraHeight===fullHeight?seam('down',3):0),
    width,height,resolution,
  };
}

export function fitFrame(width,height,displayWidth,displayHeight){
  const w=Math.max(1,Math.min(displayWidth,Math.floor(displayHeight*width/height)));
  const h=Math.max(1,Math.min(displayHeight,Math.floor(displayWidth*height/width)));
  return [Math.floor((displayWidth-w)/2),Math.floor((displayHeight-h)/2),w,h];
}
