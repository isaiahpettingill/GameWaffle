const opposite={left:'right',right:'left',up:'down',down:'up'};
const directions={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]};
export const mapPositionLimit=32768;
export const validMapPosition=position=>Array.isArray(position)&&position.length===2&&
  position.every(axis=>Number.isInteger(axis)&&Math.abs(axis)<=mapPositionLimit);

export function seamlessNeighbor(rooms,id,edge){
  const exit=rooms[id]?.exits?.[edge];
  if(exit?.adjacent&&exit.mode==='fixed'&&exit.targets[0]!==id)return exit.targets[0];
}

export function roomMapPositions(rooms,routes,start){
  const ids=Object.keys(rooms);
  const links=new Map(ids.map(id=>[id,[]]));
  for(const id of ids)for(const edge of Object.keys(directions)){
    const target=seamlessNeighbor(routes,id,edge);
    if(!links.has(target))continue;
    links.get(id).push([target,edge]);
    links.get(target).push([id,opposite[edge]]);
  }
  const positions=Object.assign(Object.create(null),Object.fromEntries(ids.filter(id=>validMapPosition(rooms[id].mapPosition))
    .map(id=>[id,rooms[id].mapPosition])));
  let right=Math.max(0,...Object.entries(positions).map(([id,[x]])=>x+rooms[id].cols+3));
  const visited=new Set();
  for(const root of new Set([...Object.keys(positions),...(start?[start]:[]),...ids])){
    if(!Object.hasOwn(rooms,root)||visited.has(root))continue;
    if(!Object.hasOwn(positions,root))positions[root]=[right,0];
    const queue=[root];
    visited.add(root);
    for(const id of queue){
      const {cols,rows}=rooms[id], [x,y]=positions[id];
      right=Math.max(right,x+cols+3);
      for(const [target,edge] of links.get(id)){
        if(visited.has(target))continue;
        const [dx,dy]=directions[edge];
        positions[target]??=[x+dx*(dx>0?cols:rooms[target].cols),y+dy*(dy>0?rows:rooms[target].rows)];
        visited.add(target);
        queue.push(target);
      }
    }
  }
  return positions;
}

// Offsets and intervals are local to the source room and measured in tiles.
export function sharedRoomEdge(rooms,positions,id,edge,target){
  if(id===target||!positions[id]||!positions[target])return;
  const a=rooms[id], b=rooms[target], [x,y]=positions[id], [tx,ty]=positions[target];
  const horizontal=edge==='left'||edge==='right';
  const touching=({left:tx+b.cols===x,right:x+a.cols===tx,up:ty+b.rows===y,down:y+a.rows===ty})[edge];
  if(!touching)return;
  const offset=horizontal?ty-y:tx-x;
  const start=Math.max(0,offset), end=Math.min(horizontal?a.rows:a.cols,offset+(horizontal?b.rows:b.cols));
  if(start<end)return {offset,start,end};
}

export function growRoom(room,size,{left=0,top=0,right=0,bottom=0},layers=room.layers){
  return {...room,cols:room.cols+left+right,rows:room.rows+top+bottom,
    ...(room.mapPosition?{mapPosition:[room.mapPosition[0]-left,room.mapPosition[1]-top]}:{}),
    layers:left||top?layers.map(layer=>({...layer,cells:layer.cells.map(([x,y,...tile])=>[x+left,y+top,...tile])})):layers,
    entities:left||top?room.entities.map(entity=>({...entity,x:entity.x+left*size,y:entity.y+top*size})):room.entities};
}

export function growSeamNeighbors(rooms,id,size,growth,routes=rooms){
  if(rooms[id].mapPosition)return [];
  const pending=new Map();
  for(const [start,end,edges] of [['left','right',['up','down']],['top','bottom',['left','right']]]){
    if(!growth[start]&&!growth[end])continue;
    const visited=new Set([id]), queue=[id];
    for(const room of queue)for(const edge of edges){
      const target=seamlessNeighbor(routes,room,edge);
      if(!target||visited.has(target)||rooms[target]?.mapPosition||seamlessNeighbor(routes,target,opposite[edge])!==room)continue;
      visited.add(target);queue.push(target);
      Object.assign(pending.get(target)??pending.set(target,{}).get(target),{[start]:growth[start],[end]:growth[end]});
    }
  }
  return [...pending].map(([target,add])=>[target,growRoom(rooms[target],size,add)]);
}
