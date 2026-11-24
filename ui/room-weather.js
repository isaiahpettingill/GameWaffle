const weather = {
  snow: [80,1,1,'240,246,255'],
  rain: [120,1,5,'177,213,245'],
  wind: [50,5,1,'220,232,244'],
};

export function drawWeather(ctx,shader,width,height,tick) {
  const preset=weather[shader.kind];
  if(!preset||!shader.strength)return;
  const [limit,dx,dy,rgb]=preset;
  const count=Math.ceil(limit*shader.strength/100);
  const time=(tick??0)%36000;
  const drift=Math.floor(time*dx/2);
  ctx.fillStyle='rgba('+rgb+','+(65+Math.floor(shader.strength*110/100))/255+')';
  ctx.beginPath();
  for(let i=0;i<count;i++){
    const length=shader.kind==='snow'?1+i%2:shader.kind==='rain'?1:7+i%10;
    const depth=shader.kind==='snow'?length:shader.kind==='rain'?5+i%4:1;
    const x=(i*67+i*i*17+drift)%(width+length)-length;
    const y=(i*53+i*i*23+time*dy)%(height+depth)-depth;
    ctx.rect(x,y,length,depth);
  }
  ctx.fill();
}
