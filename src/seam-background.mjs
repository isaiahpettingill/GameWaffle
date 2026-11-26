const color=value=>typeof value==='string'&&/^#[\da-f]{6}$/i.test(value)
  ?value.slice(1).match(/../g).map(part=>Number.parseInt(part,16)):null;
const real=value=>typeof value==='number'?value:value?.real;

export function initialBackdrop(unit,room){
  const backdrop={color:color(room.background)??[16,26,35],gradient:null,image:undefined,sprites:new Map()};
  for(const row of ['init','start'].flatMap(event=>(unit?.events?.[event]??[])
    .flatMap(block=>block.op==='init_properties'?block.body:[block]))){
    const {op}=row;
    if(op==='set_room_background'&&color(row.color))backdrop.color=color(row.color);
    if(op==='set_room_background_image'&&typeof row.image==='string')backdrop.image=row.image;
    if(op==='draw_background_sprite'){
      const x=real(row.x),y=real(row.y);
      if(typeof row.label==='string'&&typeof row.sprite==='string'&&Number.isFinite(x)&&Number.isFinite(y))
        backdrop.sprites.set(row.label,{id:row.sprite,x,y,scale:Number.isInteger(row.scale)?Math.max(1,Math.min(8,row.scale)):1});
    }
    if(op==='hide'&&typeof row.label==='string')backdrop.sprites.delete(row.label);
    if(op==='set_background_gradient'){
      if(row.kind==='none')backdrop.gradient=null;
      if(['linear','radial'].includes(row.kind)){
        backdrop.gradient??={axis:[0,0,0,1],stops:Array(8).fill(null),foci:Array(8).fill(null),palette:Array(16).fill(null)};
        Object.assign(backdrop.gradient,{kind:row.kind,dithered:row.colors==='dithered'});
      }
    }
    const gradient=backdrop.gradient;
    if(!gradient)continue;
    const coordinate=value=>Math.max(-4,Math.min(4,real(value)));
    if(op==='set_gradient_axis'){
      const axis=[row.x,row.y,row.end_x,row.end_y].map(coordinate);
      if(axis.every(Number.isFinite))gradient.axis=axis;
      continue;
    }
    const index=row.index-1;
    if(!Number.isInteger(index)||index<0)continue;
    const rgb=color(row.color);
    if(op==='set_gradient_stop'&&index<8&&rgb&&Number.isFinite(real(row.offset)))
      gradient.stops[index]={offset:Math.max(0,Math.min(1,real(row.offset))),color:rgb};
    if(op==='set_gradient_focus'&&index<8&&rgb){
      const center=[row.x,row.y].map(coordinate), radius=Math.max(.001,Math.min(8,real(row.radius)));
      if(center.every(Number.isFinite)&&Number.isFinite(radius))gradient.foci[index]={center,radius,color:rgb};
    }
    if(op==='set_gradient_palette_color'&&index<16&&rgb)gradient.palette[index]=rgb;
    if(op==='clear_gradient_slot'){
      const slots={stop:gradient.stops,focus:gradient.foci,palette:gradient.palette}[row.kind];
      if(index<slots?.length)slots[index]=null;
    }
  }
  return backdrop;
}
