// Wheel events may report pixels, lines, or pages.
export function wheelPixels(event,pageHeight){
  const units=event.deltaMode===1?16:event.deltaMode===2?pageHeight:1;
  return event.deltaY*units;
}

export function gamePixelSize(width,height,availableWidth,availableHeight){
  const fit=Math.min(availableWidth/width,availableHeight/height);
  const scale=fit>=1?Math.floor(fit):fit;
  return [width,height].map(axis=>Math.max(1,Math.round(axis*scale)));
}

export function positionPixels(canvas,parent,x,y,width,height,dpr){
  const css=[['left',x/dpr-parent.left],['top',y/dpr-parent.top],['width',width/dpr],['height',height/dpr]];
  for(const [property,value] of css){
    const pixels=+value.toFixed(4)+'px';
    if(canvas.style[property]!==pixels)canvas.style[property]=pixels;
  }
}

// Fractional editor zoom preserves source colors on the device-pixel canvas.
export function paintPixels(target,source,width,height,destination=[0,0,width,height]){
  if(target.width!==width)target.width=width;
  if(target.height!==height)target.height=height;
  const context=target.getContext('2d');
  context.imageSmoothingEnabled=false;
  context.clearRect(0,0,width,height);
  context.drawImage(source,...destination);
  return context;
}
