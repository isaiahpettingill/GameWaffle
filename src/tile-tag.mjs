export const tileTagName=tag=>tag.split(':',1)[0];

export function resolveTileTag(tags,savedTag) {
  if(!savedTag)return tags[0];
  if(tags.includes(savedTag))return savedTag;
  const name=tileTagName(savedTag);
  let match;
  for(const tag of tags){
    if(tileTagName(tag)!==name)continue;
    if(match!==undefined)return;
    match=tag;
  }
  return match;
}
