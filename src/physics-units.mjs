export const pixelsPerMeter=24;

export function physicsArgumentDefault(op,key,value,pixelUnits){
  if(!pixelUnits)return value;
  const force=(op==='force'||op==='force_entity'||op==='impulse'||op==='push_entity')&&['x','y'].includes(key)
    ||op==='jump_force'&&key==='force';
  const distance=key==='speed'&&['walk','jump','chase','fire','fire_projectile'].includes(op)
    ||['velocity','entity_velocity'].includes(op)&&['x','y'].includes(key)
    ||op==='set_room_gravity'&&key==='gravity';
  if(!force&&!distance)return value;
  const scale=force?pixelsPerMeter**3:pixelsPerMeter;
  return typeof value==='number'?value*scale:{real:value.real*scale};
}
