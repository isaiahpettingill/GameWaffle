const opposite={left:'right',right:'left',up:'down',down:'up'};

export function seamlessNeighbor(rooms,id,edge){
  const exit=rooms[id]?.exits?.[edge];
  if(!exit?.adjacent||exit.mode!=='fixed'||exit.flag)return;
  const target=exit.targets[0];
  const back=rooms[target]?.exits?.[opposite[edge]];
  if(back?.adjacent&&back.mode==='fixed'&&!back.flag&&back.targets[0]===id)return target;
}

export function growRoom(room,size,{left=0,top=0,right=0,bottom=0},layers=room.layers){
  return {...room,cols:room.cols+left+right,rows:room.rows+top+bottom,
    layers:left||top?layers.map(layer=>({...layer,cells:layer.cells.map(([x,y,...tile])=>[x+left,y+top,...tile])})):layers,
    entities:left||top?room.entities.map(entity=>({...entity,x:entity.x+left*size,y:entity.y+top*size})):room.entities};
}

export function growSeamNeighbors(rooms,id,size,growth,routes=rooms){
  const pending=new Map();
  for(const [start,end,edges] of [['left','right',['up','down']],['top','bottom',['left','right']]]){
    if(!growth[start]&&!growth[end])continue;
    const visited=new Set([id]), queue=[id];
    for(const room of queue)for(const edge of edges){
      const target=seamlessNeighbor(routes,room,edge);
      if(!target||visited.has(target))continue;
      visited.add(target);queue.push(target);
      Object.assign(pending.get(target)??pending.set(target,{}).get(target),{[start]:growth[start],[end]:growth[end]});
    }
  }
  return [...pending].map(([target,add])=>[target,growRoom(rooms[target],size,add)]);
}
