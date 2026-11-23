import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {unzipSync} from 'fflate';

const temp=await mkdtemp(join(tmpdir(),'gamewaffle-update-'));
process.env.XDG_DATA_HOME=temp;
process.env.LOCALAPPDATA=temp;
const {update,exportDesktop,checkUpdate,runtimeAsset,nativeTarget}=await import('../src/desktop.mjs');
try{
  for(const platform of ['linux-x64','windows-x64']){
    const data=Buffer.from(platform),name=runtimeAsset(platform);
    const info={tag_name:'v2.1.0',assets:[{name,digest:'sha256:'+createHash('sha256').update(data).digest('hex'),
      browser_download_url:'https://github.com/isaiahpettingill/GameWaffle/releases/download/v2.1.0/'+name}]};
    const request=async url=>url.startsWith('https://api.')?Response.json(info):new Response(data);
    if(platform===nativeTarget){
      const version=JSON.parse(await readFile(new URL('../package.json',import.meta.url))).version;
      const local=await checkUpdate('runtime',undefined,request);
      assert.equal(local.installed,'v'+version);
      assert.equal(local.name,name);
    }
    assert.equal((await checkUpdate('runtime',platform,request)).available,true);
    await assert.rejects(update('runtime',platform,async url=>url.startsWith('https://api.')?Response.json(info):new Response('corrupt')),/checksum/);
    const installed=await update('runtime',platform,request);
    assert.deepEqual(await readFile(installed.path),data);
    assert.equal((await checkUpdate('runtime',platform,request)).available,false);
    const zip=unzipSync(await exportDesktop(Buffer.from('cart'),platform));
    assert.deepEqual(Buffer.from(zip['game.waffle']),Buffer.from('cart'));
    assert.deepEqual(Buffer.from(zip[platform==='linux-x64'?'gamewaffle-player':'gamewaffle-player.exe']),data);
  }
  console.log('Passed desktop update, checksum, and export checks');
}finally{await rm(temp,{recursive:true,force:true});}
