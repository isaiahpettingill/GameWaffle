// Each digit is one row of three pixels. The built-in face uses small capitals.
const rows={
  A:'25755',B:'65656',C:'34443',D:'65556',E:'74647',F:'74644',G:'34553',
  H:'55755',I:'72227',J:'11152',K:'55655',L:'44447',M:'57755',N:'57775',
  O:'25552',P:'65644',Q:'25573',R:'65655',S:'34216',T:'72222',U:'55557',
  V:'55552',W:'55775',X:'55255',Y:'55222',Z:'71247',
  0:'75557',1:'26227',2:'71247',3:'71217',4:'55711',5:'74617',6:'64757',
  7:'71122',8:'75757',9:'75711','?':'71202','!':'22202','.':'00002',
  ',':'00024',':':'02020',';':'02024',"'":'22000','"':'55000','-':'00700',
  '+':'02720','/':'11244','(':'12421',')':'42124','=':'07070',' ':'00000',
  '%':'51245','*':'05250','_':'00007','#':'57575','<':'12421','>':'42124'
};
const accents = new Map([
  ['\u0300', [[1,0],[2,1]]], ['\u0301',[[3,0],[2,1]]],
  ['\u0302', [[2,0],[1,1],[3,1]]], ['\u0303',[[1,1],[2,0],[3,0]]],
  ['\u0304', [[1,0],[2,0],[3,0]]], ['\u0306',[[1,0],[2,1],[3,0]]],
  ['\u0307', [[2,0]]], ['\u0308',[[1,0],[3,0]]],
  ['\u030a', [[2,0],[1,1],[3,1]]], ['\u030b',[[2,0],[4,0],[1,1],[3,1]]],
  ['\u030c', [[1,0],[3,0],[2,1]]], ['\u0327',[[2,6],[1,7]]],
  ['\u0328', [[2,6],[3,7]]],
]);
const special = {
  'ß':'65656','Æ':'35756','æ':'35756','Ø':'25752','ø':'25752','Ł':'44647','ł':'44647',
  'Œ':'37573','œ':'37573','¡':'20222','¿':'02047','«':'02420','»':'04240',
};
export function defaultFont(){
  const extended = Array.from({length:0x180-0xc0},(_,i)=>String.fromCodePoint(0xc0+i))
    .flatMap(character=>{
      const [base,accent,...rest] = character.normalize('NFD');
      return !rest.length && rows[base.toUpperCase()] && accents.has(accent) ?
        [{character,glyph:rows[base.toUpperCase()],accent}] : [];
    });
  extended.push(...Object.entries(special).map(([character,glyph])=>({character,glyph})));
  const width=96,height=Math.ceil((96+extended.length)/16)*8,rgba=Buffer.alloc(width*height*4);
  function pixel(index,x,y) {
    const offset=4*((Math.floor(index/16)*8+y)*width+(index%16)*6+x);
    rgba.fill(255,offset,offset+4);
  }
  function draw(index,glyph,top){
    for(let y=0;y<5;y++)for(let x=0;x<3;x++)if(Number(glyph[y]) & (4>>x))pixel(index,x+1,y+top);
  }
  for(let i=0;i<96;i++)draw(i,rows[String.fromCharCode(i+32).toUpperCase()]??rows['?'],1);
  const glyphs=Object.fromEntries(extended.map(({character,glyph,accent},i)=>{
    const index=96+i;
    const marks=accents.get(accent)??[];
    draw(index,glyph,marks.some(([,y])=>y<2)?2:1);
    for(const [x,y] of marks)pixel(index,x,y);
    return [character,index];
  }));
  return {width,height,rgba,glyphs};
}

export const fontFile = /\.(yaff|ase|aseprite|png)$/i;

function sheetFont(image, {glyphWidth, glyphHeight, characters, assignments}) {
  for (const value of [glyphWidth, glyphHeight]) {
    if (!Number.isInteger(value) || value<1 || value>64) throw Error('Glyph width and height must be 1–64 pixels');
  }
  const {width,height,frames:[{rgba}]} = image;
  if (width % glyphWidth || height % glyphHeight) throw Error('The glyph size must divide the sheet width and height evenly');
  const columns = width/glyphWidth;
  const cells=columns*(height/glyphHeight);
  const entries=configAssignments(characters, assignments);
  const labels=new Map();
  for(const [index,label] of entries){
    if(!Number.isInteger(index)||index<0||index>=cells)throw Error('A glyph assignment is outside the sheet');
    if(!isGlyph(label))throw Error('Enter one character per glyph cell');
    if(!labels.has(label))labels.set(label,index);
  }
  if(!labels.size)throw Error('Assign at least one character to a sheet cell');
  return atlasFont(labels,glyphWidth,glyphHeight,(cell,row)=>[
    rgba,((Math.floor(cell/columns)*glyphHeight+row)*width+(cell%columns)*glyphWidth)*4,
  ]);
}

function isGlyph(label){
  return typeof label==='string' && [...label].length===1 && !/[\p{Cc}\p{Cs}]/u.test(label);
}

function configAssignments(characters,assignments){
  if(assignments==null)return [...(characters??'')].map((label,index)=>[index,label]);
  if(typeof assignments!=='object'||Array.isArray(assignments))throw Error('Provide glyph assignments for the sheet');
  const entries=Object.entries(assignments);
  if(entries.length>4096)throw Error('Assign up to 4096 glyphs');
  return entries.map(([index,label])=>[Number(index),label]).sort(([a],[b])=>a-b);
}

function asepriteFont(image){
  const {width:glyphWidth,height:glyphHeight,tags,frames}=image;
  if(glyphWidth>64||glyphHeight>64)throw Error('Aseprite glyph frames must fit within 64 × 64 pixels');
  const labels=new Map();
  for(const tag of tags){
    const label=isGlyph(tag.name)?tag.name:tag.name.toLowerCase()==='space'?' ':yaffLabel(tag.name);
    if(isGlyph(label)&&!labels.has(label))labels.set(label,tag.from);
  }
  if(!labels.size||labels.size>4096)throw Error('Name Aseprite tags after their characters, such as A, a, or U+0020');
  return atlasFont(labels,glyphWidth,glyphHeight,(frame,row)=>[frames[frame].rgba,row*glyphWidth*4]);
}

function atlasFont(labels,glyphWidth,glyphHeight,rowPixels){
  const columns=Math.min(64,labels.size),width=columns*glyphWidth,height=Math.ceil(labels.size/columns)*glyphHeight;
  const rgba=Buffer.alloc(width*height*4),glyphs=Object.create(null);
  [...labels].forEach(([label,sourceIndex],index)=>{
    glyphs[label]=index;
    const x=index%columns*glyphWidth,y=Math.floor(index/columns)*glyphHeight;
    for(let row=0;row<glyphHeight;row++){
      const [source,start]=rowPixels(sourceIndex,row);
      source.copy(rgba,((y+row)*width+x)*4,start,start+glyphWidth*4);
    }
  });
  return {width,height,rgba,glyphs,layout:{width:glyphWidth,height:glyphHeight,columns}};
}

function yaffLabel(label) {
  if (/^'.*'$/u.test(label)) {
    const chars=[...label.slice(1,-1)];
    return chars.length===1?chars[0]:null;
  }
  if (/^(?:u\+|0x)[\da-f]+$/i.test(label) || /^\d+$/.test(label)) {
    const code=/^\d+$/.test(label) ? Number(label) : Number.parseInt(label.slice(2),16);
    if(code<=0x10ffff && !(code>=0xd800 && code<=0xdfff))return String.fromCodePoint(code);
  }
  return null;
}

function yaffFont(data) {
  const source=new TextDecoder('utf-8',{fatal:true}).decode(data);
  const properties=new Map(), definitions=[];
  let labels=[], glyph;
  for (const line of source.split(/\r\n?|\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const trimmed=line.trim();
    if (!/^\s/.test(line)) {
      if (trimmed.endsWith(':')) {
        labels.push(trimmed.slice(0,-1));
        glyph=undefined;
        continue;
      }
      const match=/^([\w-]+):\s*(.+)$/.exec(trimmed);
      if (match)properties.set(match[1],match[2]);
      continue;
    }
    if (labels.length) {
      glyph={labels,rows:[],properties:new Map()};
      labels=[];
      definitions.push(glyph);
    }
    if (!glyph) continue;
    const property=/^([\w-]+):\s*(.+)$/.exec(trimmed);
    if(property){glyph.properties.set(property[1],property[2]);continue;}
    const pixels=trimmed.replace(/\s/g,'');
    if(pixels==='-')continue;
    if(!/^[.@]+$/.test(pixels))throw Error('Use a monochrome YAFF font with . and @ pixels');
    if(glyph.rows.length && glyph.rows[0].length!==pixels.length)throw Error('YAFF glyph rows must have equal widths');
    glyph.rows.push(pixels);
  }
  const entries=new Map();
  let left=0,right=1,bottom=0,top=1;
  for(const glyph of definitions){
    const bearing=Number(glyph.properties.get('left-bearing')??properties.get('left-bearing')??0);
    const shift=Number(glyph.properties.get('shift-up')??properties.get('shift-up')??0);
    const advance=Number(glyph.properties.get('right-bearing')??properties.get('right-bearing')??0);
    if(![bearing,shift,advance].every(Number.isSafeInteger))throw Error('YAFF glyph metrics must be integers');
    const glyphLabels=glyph.labels.map(label=>yaffLabel(label)??(isGlyph(label)&&!/^\d$/.test(label)?label:null)).filter(isGlyph);
    if(!glyphLabels.length)continue;
    for(const label of glyphLabels)if(!entries.has(label))entries.set(label,{rows:glyph.rows,bearing,shift});
    left=Math.min(left,bearing);right=Math.max(right,bearing+(glyph.rows[0]?.length??0)+Math.max(0,advance));
    bottom=Math.min(bottom,shift);top=Math.max(top,shift+glyph.rows.length);
  }
  if (!entries.size || entries.size>4096) throw Error('YAFF fonts need 1–4096 single-character glyphs');
  const size=(properties.get('cell-size')??'').match(/^(\d+)\s+(\d+)$/);
  const glyphWidth=Math.max(right-left,Number(size?.[1]??0));
  const glyphHeight=Math.max(top-bottom,Number(size?.[2]??0),Number(properties.get('line-height')??0));
  if(!Number.isInteger(glyphHeight)||glyphWidth>64||glyphHeight>64)throw Error('YAFF glyph cells must fit within 64 × 64 pixels');
  const columns=Math.min(64,entries.size),width=columns*glyphWidth,height=Math.ceil(entries.size/columns)*glyphHeight;
  const rgba=Buffer.alloc(width*height*4),glyphs=Object.create(null);
  [...entries].forEach(([label,{rows,bearing,shift}],index)=>{
    glyphs[label]=index;
    const x=index%columns*glyphWidth+bearing-left;
    const y=Math.floor(index/columns)*glyphHeight+top-shift-rows.length;
    rows.forEach((row,dy)=>[...row].forEach((pixel,dx)=>{
      if(pixel==='@'){
        const offset=((y+dy)*width+x+dx)*4;
        rgba.fill(255,offset,offset+4);
      }
    }));
  });
  return {width,height,rgba,glyphs,layout:{width:glyphWidth,height:glyphHeight,columns}};
}

export async function readBitfont(config, read, readArt) {
  if (typeof config?.source!=='string' || !config.source.startsWith('assets/') ||
      config.source.split(/[\\/]/).includes('..') || !fontFile.test(config.source)) {
    throw Error('Choose a YAFF, Aseprite, or PNG font source');
  }
  if (/\.yaff$/i.test(config.source))return yaffFont(await read(config.source));
  const image=await readArt(config.source,read);
  return /\.png$/i.test(config.source)?sheetFont(image,config):asepriteFont(image);
}
