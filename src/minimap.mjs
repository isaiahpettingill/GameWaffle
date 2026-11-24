const directions={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]};

export function generateMinimap(rooms,start,mode) {
  if (!mode || mode==='off')return;
  if (!['world','explored'].includes(mode))throw Error('Choose World, Explored, or Off for the minimap');
  const ids=Object.keys(rooms), links=new Map(ids.map(id=>[id,[]])), edges=[];
  const drawn=new Set();
  for(const [id,room] of Object.entries(rooms)){
    for(const [exit,route] of Object.entries(room.exits)){
      const [dx,dy]=directions[exit];
      for(const target of route.targets){
        links.get(id).push([target,dx,dy]);
        links.get(target).push([id,-dx,-dy]);
        const pair=[id,target].sort(), key=JSON.stringify(pair);
        if(id!==target && !drawn.has(key)){drawn.add(key);edges.push(pair);}
      }
    }
  }
  const positions=new Map(), occupancy=new Set();
  function place(id,x,y,dx,dy){
    let deviation=0;
    while(occupancy.has(`${x},${y}`)){
      deviation++;
      // Try the next lane perpendicular to the connection.
      if(dx) y+=deviation%2?deviation:-deviation;
      else x+=deviation%2?deviation:-deviation;
    }
    occupancy.add(`${x},${y}`);
    positions.set(id,[x,y]);
  }
  let right=0;
  for(const root of [start,...ids]){
    if(positions.has(root))continue;
    place(root,right,0,0,1);
    const queue=[root];
    for(let head=0;head<queue.length;head++){
      const id=queue[head], [x,y]=positions.get(id);
      right=Math.max(right,x+3);
      for(const [target,dx,dy] of links.get(id)){
        if(positions.has(target))continue;
        place(target,x+dx,y+dy,dx,dy);
        queue.push(target);
      }
    }
  }
  return {mode,rooms:Object.fromEntries([...positions].map(([id,[x,y]])=>[id,[x*4,y*4,3,3]])),edges};
}
