import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {crc32,deflateSync} from 'node:zlib';
import {PNG} from 'pngjs';
import {encode as encodeQoa} from 'qoa-format';
import {runCodec} from '../src/asset-codec.mjs';
import {readAseprite} from '../src/ase.mjs';
import {compileProject} from '../src/compiler.mjs';
import {unpack} from '../src/cartridge.mjs';
import {pack,preparePack} from '../src/pack.mjs';
import {decodePng} from '../src/png.mjs';

function pngChunk(type,data) {
  const bytes=Buffer.alloc(12+data.length);
  bytes.writeUInt32BE(data.length,0);
  bytes.write(type,4,'ascii');
  bytes.set(data,8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4,-4)),8+data.length);
  return bytes;
}
function fixturePng(width,height,depth,color,rows,{transparency,interlaced=false}={}) {
  const header=Buffer.alloc(13);
  header.writeUInt32BE(width,0);
  header.writeUInt32BE(height,4);
  header[8]=depth;
  header[9]=color;
  header[12]=Number(interlaced);
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),
    ...(transparency?[pngChunk('tRNS',transparency)]:[]),
    pngChunk('IDAT',deflateSync(Buffer.from(rows))),pngChunk('IEND',Buffer.alloc(0))
  ]);
}
function comparePng(png){
  const decoded=decodePng(png);
  const expected=PNG.sync.read(png);
  assert.deepEqual(decoded,{width:expected.width,height:expected.height,data:expected.data});
}

comparePng(fixturePng(4,1,2,0,[0,0x1b],{transparency:Buffer.from([0,1])}));
comparePng(fixturePng(2,1,8,2,[0,16,32,48,64,80,96],{transparency:Buffer.from([0,16,0,32,0,48])}));
comparePng(fixturePng(2,1,8,4,[0,80,99,255,123]));
comparePng(fixturePng(2,1,16,6,[0,0,254,1,0,131,157,0,129,255,255,127,0,40,40,254,254]));
const width=9,height=7,adam7=[];
for(const [x,y,dx,dy] of [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]){
  for(let row=y;row<height;row+=dy){
    adam7.push(0);
    for(let col=x;col<width;col+=dx)adam7.push(col*13,row*17,(col+row)*5,255-col);
  }
}
comparePng(fixturePng(width,height,8,6,adam7,{interlaced:true}));
assert.throws(()=>decodePng(fixturePng(4097,1,8,0,[])),/4096 pixels per side/);
assert.throws(()=>decodePng(Buffer.from('not an image')));

function aseChunk(type,data){
  const chunk=Buffer.alloc(6+data.length);
  chunk.writeUInt32LE(chunk.length);
  chunk.writeUInt16LE(type,4);
  chunk.set(data,6);
  return chunk;
}
function aseFrame(chunks,duration){
  const frame=Buffer.alloc(16);
  frame.writeUInt32LE(16+chunks.reduce((size,chunk)=>size+chunk.length,0));
  frame.writeUInt16LE(0xf1fa,4);
  frame.writeUInt16LE(chunks.length,6);
  frame.writeUInt16LE(duration,8);
  return Buffer.concat([frame,...chunks]);
}

const layer=Buffer.alloc(21);
layer.writeUInt16LE(1);
layer[12]=255;
layer.writeUInt16LE(3,16);
layer.write('cel',18);
const palette=Buffer.alloc(32);
palette.writeUInt32LE(2);
palette.writeUInt32LE(1,8);
palette.set([120,30,10,255],22);
palette.set([20,60,100,128],28);
const cel=Buffer.alloc(20);
cel[6]=255;
cel.writeUInt16LE(2,7);
cel.writeUInt16LE(2,16);
cel.writeUInt16LE(1,18);
const linked=Buffer.alloc(18);
linked[6]=255;
linked.writeInt16LE(-1,2);
linked.writeUInt16LE(1,7);
const first=aseFrame([aseChunk(0x2004,layer),aseChunk(0x2019,palette),
  aseChunk(0x2005,Buffer.concat([cel,deflateSync(Buffer.from([0,1]))]))],0);
const later=aseFrame([aseChunk(0x2005,linked)],200);
const ase=Buffer.alloc(128);
ase.writeUInt32LE(128+first.length+later.length);
ase.writeUInt16LE(0xa5e0,4);
ase.writeUInt16LE(2,6);
ase.writeUInt16LE(2,8);
ase.writeUInt16LE(1,10);
ase.writeUInt16LE(8,12);
ase.writeUInt32LE(1,14);
assert.deepEqual(readAseprite(Buffer.concat([ase,first,later])),{
  width:2,height:1,tags:[],frames:[
    {duration:100,rgba:Buffer.from([0,0,0,0,20,60,100,128])},
    {duration:200,rgba:Buffer.from([20,60,100,128,0,0,0,0])}
  ]
});
assert.throws(()=>readAseprite(Buffer.concat([ase,first,later.subarray(0,-1)])));

function wavFixture({bits=16,channels=2,float=false,extended=false,frames=5151}={}){
  const sampleRate=32000, bytes=bits/8, format=extended?40:16;
  const pcmLength=frames*channels*bytes;
  const pcmOffset=20+format+10+8;
  const data=Buffer.alloc(pcmOffset+pcmLength);
  data.write('RIFF');
  data.writeUInt32LE(data.length-8,4);
  data.write('WAVEfmt ',8);
  data.writeUInt32LE(format,16);
  data.writeUInt16LE(extended?0xfffe:float?3:1,20);
  data.writeUInt16LE(channels,22);
  data.writeUInt32LE(sampleRate,24);
  data.writeUInt32LE(sampleRate*channels*bytes,28);
  data.writeUInt16LE(channels*bytes,32);
  data.writeUInt16LE(bits,34);
  if(extended)data.writeUInt16LE(float?3:1,44);
  data.write('JUNK',20+format);
  data.writeUInt32LE(1,24+format);
  data.write('data',pcmOffset-8);
  data.writeUInt32LE(pcmLength,pcmOffset-4);
  const channelData=Array.from({length:channels},()=>new Float32Array(frames));
  for(let frame=0;frame<frames;frame++)for(let channel=0;channel<channels;channel++){
    const offset=pcmOffset+(frame*channels+channel)*bytes;
    const wave=Math.sin(frame*.093+channel*.13)*(frame%31===0?1:.5);
    if(float){
      const value=frame%117===0?NaN:frame%211===0?4:wave;
      data.writeFloatLE(value,offset);
      channelData[channel][frame]=Number.isFinite(value)?Math.max(-1,Math.min(1,value)):0;
    }else{
      const range=2**(bits-1), value=Math.floor(wave*(range-1));
      if(bits===8)data[offset]=value+128;
      else data.writeIntLE(value,offset,bytes);
      channelData[channel][frame]=value/range;
    }
  }
  return {data,sampleRate,channelData};
}

for(const options of [{bits:8,channels:1},{bits:16},{bits:24},{bits:32},{bits:32,float:true,extended:true}]){
  const {data,sampleRate,channelData}=wavFixture(options);
  const expected=Buffer.from(encodeQoa({sampleRate,channelData}));
  assert.deepEqual(runCodec('wav_to_qoa',data),expected,JSON.stringify(options));
  if(channelData.length===2)
    assert.deepEqual(runCodec('encode_stereo_qoa',sampleRate,...channelData),expected);
  assert.throws(()=>runCodec('wav_to_qoa',data.subarray(0,-1)),/Truncated WAV chunk/);
}

const project=JSON.parse(await readFile('demo/project.json','utf8'));
project.audio.profile={source:'assets/profile.wav'};
const firstSource=wavFixture({bits:24,frames:87}).data;
const secondSource=wavFixture({bits:24,frames:91}).data;
const compile=sample=>compileProject('demo',{project,store:{
  read:(file,encoding)=>file==='assets/profile.wav'?Promise.resolve(sample):readFile('demo/'+file,encoding),
}});
const game=await compile(firstSource);
const sameAudio=(await compile(Buffer.from(firstSource))).audio.profile;
assert.equal(sameAudio.data,game.audio.profile.data,'WAV cache reuses identical content');
assert.notDeepEqual((await compile(secondSource)).audio.profile.data,sameAudio.data,'WAV cache invalidates edited audio');
project.audio.profile.compress=false;
assert.deepEqual((await compile(firstSource)).audio.profile,{format:'wav',data:firstSource});

const both=preparePack(game);
const gameBytes=both(false),editorBytes=both(true);
assert.deepEqual(gameBytes,pack(game));
assert.deepEqual(editorBytes,pack(game,{editor:true}));
const media=unpack(Buffer.from(editorBytes));
assert.deepEqual(media.tilePreviews,game.tilePreviews);
assert.deepEqual(media.spritePreviews,game.spritePreviews);
assert.equal(unpack(gameBytes).tilePreviews,undefined);
assert.deepEqual(both(false),gameBytes);
console.log('Passed image decoding, WAV and QOA compatibility, audio caching, and shared cartridge packing');
