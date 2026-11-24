import {shaderNodes} from '../src/shader-graph.mjs';

export const fragmentOutput='fragment-output';
export const nodeWidth=176;
const columnGap=238;

export function shaderWire(source,target,targetHandle){
  return {id:target+':'+targetHandle,source,sourceHandle:'result',target,targetHandle,reconnectable:true};
}

function positionsFor(graph){
  const byId=new Map(graph.nodes.map(node=>[node.id,node]));
  const depths=new Map();
  function depth(id, path=new Set()){
    if(depths.has(id))return depths.get(id);
    if(path.has(id)||!byId.has(id))return 0;
    path.add(id);
    const dependencies=byId.get(id).inputs.filter(source=>source&&byId.has(source));
    const result=dependencies.length?Math.max(...dependencies.map(source=>depth(source,path)))+1:0;
    path.delete(id);
    depths.set(id,result);
    return result;
  }
  const columns=new Map();
  for(const node of graph.nodes){
    const x=depth(node.id);
    if(!columns.has(x))columns.set(x,[]);
    columns.get(x).push(node);
  }
  const positions={};
  for(const [column,nodes] of columns){
    const heights=nodes.map(node=>{
      const spec=shaderNodes[node.kind];
      return 104+27*spec.ports.length+(spec.value?32:0)+(node.name?31:0);
    });
    let y=-heights.reduce((sum,height)=>sum+height,0)/2;
    nodes.forEach((node,index)=>{
      positions[node.id]={x:column*columnGap,y};
      y+=heights[index];
    });
  }
  const next=Math.max(0,...columns.keys())+1;
  positions[fragmentOutput]={x:next*columnGap,y:positions[graph.output]?.y??0};
  return positions;
}

export function shaderFlow(graph,dataFor){
  const positions=positionsFor(graph);
  const position=id=>{
    const point=graph.layout?.[id];
    return Array.isArray(point)&&point.length===2&&point.every(value=>Number.isFinite(value)&&Math.abs(value)<=1000000)
      ?{x:point[0],y:point[1]}:positions[id];
  };
  const nodes=graph.nodes.map(({inputs,...entry})=>({id:entry.id,type:'shader',position:position(entry.id),
    data:dataFor(entry),dragHandle:'.shader-node-title'}));
  nodes.push({id:fragmentOutput,type:'fragment',position:position(fragmentOutput),deletable:false,data:dataFor(null),
    ariaLabel:'Fragment output',dragHandle:'.shader-node-title'});
  const edges=graph.nodes.flatMap(node=>node.inputs.flatMap((source,index)=>source?[shaderWire(source,node.id,String(index))]:[]));
  if(graph.output)edges.push(shaderWire(graph.output,fragmentOutput,'color'));
  return {nodes,edges};
}

export function shaderDocument(nodes,edges,{layout=false}={}){
  const incoming=new Map(nodes.map(node=>[node.id,[]]));
  for(const edge of edges){
    if(edge.target!==fragmentOutput&&incoming.has(edge.target))
      incoming.get(edge.target)[Number(edge.targetHandle)]=edge.source;
  }
  return {version:1,nodes:nodes.flatMap(node=>node.id===fragmentOutput?[]:[{...node.data.entry,inputs:incoming.get(node.id)}]),
    output:edges.find(edge=>edge.target===fragmentOutput)?.source??'',
    ...(layout?{layout:Object.fromEntries(nodes.map(({id,position:{x,y}})=>[id,[x,y]]))}:{})};
}

export function wireChange(edges,{source,target,targetHandle},replace){
  return [...edges.filter(edge=>edge.id!==replace&&(edge.target!==target||edge.targetHandle!==targetHandle)),
    shaderWire(source,target,targetHandle)];
}
