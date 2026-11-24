export function resourceName(label,fallback,collections=[]) {
  const stem=label.normalize('NFKD').toLowerCase().replace(/\p{Mark}/gu,'')
    .replace(/[^a-z0-9_]+/g,'_').replace(/^_+|_+$/g,'').slice(0,48);
  const base=/^[a-z]/.test(stem)&&!['constructor','prototype'].includes(stem)?stem:fallback;
  let name=base;
  for(let suffix=2;collections.some(collection=>Object.hasOwn(collection,name));suffix++)name=base+'_'+suffix;
  return name;
}

export function projectBasename(title) {
  const stem=title.normalize('NFKD').toLowerCase().replace(/\p{Mark}/gu,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,56).replace(/-+$/,'');
  if(!stem)return 'game';
  return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(stem)?stem+'-game':stem;
}
