export const spriteDragType = 'application/x-gamewaffle-sprite';

function availableName(sprite, used) {
  const base = typeof sprite === 'string' ? sprite : 'Instance';
  let name = base.slice(0,64);
  for (let index = 2; used.has(name); index++) {
    const suffix = ` ${index}`;
    name = base.slice(0,64-suffix.length) + suffix;
  }
  return name;
}

export function instanceNames(entities) {
  const used = new Set(entities.map(entity => entity.name).filter(Boolean));
  return entities.map(entity => {
    if (entity.name) return entity.name;
    const name = availableName(entity.sprite, used);
    used.add(name);
    return name;
  });
}

export function newInstanceName(sprite, entities) {
  return availableName(sprite, new Set(instanceNames(entities)));
}
