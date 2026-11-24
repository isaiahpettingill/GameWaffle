// Keep polygons small for fast collision queries. Remove the least significant
// corners until the hull fits, keeping vertex order and convexity.
function limitPolygon(points) {
  const area=(a,b,c)=>Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]));
  while(points.length>8){
    let smallest=0, loss=Infinity;
    for(let i=0;i<points.length;i++){
      const triangle=area(points.at(i-1),points[i],points[(i+1)%points.length]);
      if(triangle<loss){smallest=i;loss=triangle;}
    }
    points.splice(smallest,1);
  }
  return points;
}

function alphaHull(frame,width,height) {
  const points=[];
  for(let y=0;y<height;y++){
    let left=width,right=-1;
    for(let x=0;x<width;x++)if(frame.rgba[(y*width+x)*4+3]>=128){
      left=Math.min(left,x);right=x;
    }
    if(right>=left)points.push([left,y],[left,y+1],[right+1,y],[right+1,y+1]);
  }
  points.sort(([a,b],[c,d])=>a-c||b-d);
  function chain(points){
    const result=[];
    for(const point of points){
      while(result.length>=2){
        const [a,b]=result.slice(-2);
        if((b[0]-a[0])*(point[1]-a[1])-(b[1]-a[1])*(point[0]-a[0])>0)break;
        result.pop();
      }
      result.push(point);
    }
    return result.slice(0,-1);
  }
  return limitPolygon([...chain(points),...chain(points.reverse())]);
}

export function compileColliders(sprite,art,definition,id) {
  const sx=definition.width/art.width,sy=definition.height/art.height;
  const local=([x,y])=>[(x-art.width/2)*sx,(y-art.height/2)*sy];
  const polygon=points=>({kind:'polygon',points:points.map(local)});
  const manual=Object.create(null);
  for(const [index,shapes] of Object.entries(sprite.frameColliders??{})){
    const frame=Number(index);
    if(!Number.isInteger(frame)||frame<0||frame>=art.frames.length||!Array.isArray(shapes)||shapes.length>8)
      throw Error('Each collider frame can have up to eight shapes');
    if(!shapes.length)continue;
    manual['sprite/'+id+'/'+frame]=shapes.map(({kind,x,y,w,h})=>{
      if(!['rectangle','circle','pill'].includes(kind)||![x,y,w,h].every(Number.isFinite)||
        x<0||y<0||w<1||h<1||x+w>art.width+.001||y+h>art.height+.001)
        throw Error('Draw collider shapes inside the sprite frame');
      if(kind==='rectangle')return polygon([[x,y],[x+w,y],[x+w,y+h],[x,y+h]]);
      if((kind==='circle'||(kind==='pill'&&w===h))&&Math.abs(w*sx-h*sy)<.001)return {kind:'circle',center:local([x+w/2,y+h/2]),radius:w*sx/2};
      if(kind==='circle'||(kind==='pill'&&w===h)){
        return polygon(Array.from({length:8},(_,n)=>{
          const angle=n*Math.PI/4;
          return [x+w/2+w/2*Math.cos(angle),y+h/2+h/2*Math.sin(angle)];
        }));
      }
      const horizontal=w>=h;
      const radius=Math.min(w,h)/2,long=Math.max(w,h),short=radius;
      const turn=horizontal?([a,b])=>[x+a,y+b]:([a,b])=>[x+b,y+a];
      return polygon(Array.from({length:8},(_,n)=>{
        const right=n<4, angle=(right?-90:90)+(n%4)*60, center=right?long-radius:radius;
        return turn([center+short*Math.cos(angle*Math.PI/180),radius+short*Math.sin(angle*Math.PI/180)]);
      }));
    });
  }
  let collider;
  if(sprite.collider==='silhouette'){
    const clip=definition.clips[definition.animation]??definition.clips.default;
    const frame=art.frames[Number(clip.frames[0].image.split('/').at(-1))];
    const points=alphaHull(frame,art.width,art.height);
    const shape=polygon(points);
    const boxArea=points.length?Math.abs(points.reduce((area,[x,y],index)=>{
      const [nx,ny]=points[(index+1)%points.length];
      return area+x*ny-y*nx;
    },0))*sx*sy:0;
    if(points.length>=3&&boxArea>.06&&shape.points.every((a,i)=>shape.points.slice(i+1).every(b=>
      (a[0]-b[0])**2+(a[1]-b[1])**2>.004)))collider=[shape];
  }
  return {collider,frameColliders:Object.keys(manual).length?manual:undefined};
}
