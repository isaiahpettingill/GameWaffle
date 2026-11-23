const {chromium}=require('playwright-core');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
async function checkFormRows(page,view){
  const errors=await page.locator('.field-row,.record-form,.asset-source,.fields,.pair,form.row,.address').evaluateAll(rows=>{
    const errors=[];
    for(const row of rows){
      const controls=[...row.querySelectorAll('input,select,button')].filter(el=>
        el.getClientRects().length && !['checkbox','radio','range','file','hidden'].includes(el.type));
      for(const [index,control] of controls.entries()){
        const a=control.getBoundingClientRect();
        for(const other of controls.slice(index+1)){
          const b=other.getBoundingClientRect();
          if(Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1 &&
             (Math.abs(a.top-b.top)>1 || Math.abs(a.bottom-b.bottom)>1)){
            errors.push([control.outerHTML.slice(0,90),other.outerHTML.slice(0,90)]);
          }
        }
      }
    }
    return errors;
  });
  assert.deepEqual(errors,[],view+' form alignment');
}
(async()=>{
const fixture=await fs.mkdtemp(path.join(os.tmpdir(),'gw-editor-'));
const project=path.join(fixture,'demo');await fs.cp('demo',project,{recursive:true});
const server=require('node:child_process').spawn(process.execPath,['src/server.mjs','--project',project,'--port','0'],{stdio:['ignore','pipe','inherit'],env:{...process.env,HOME:fixture}});
process.on('exit',()=>server.kill());
const url=await new Promise((resolve,reject)=>{
  server.stdout.on('data',chunk=>{const port=String(chunk).match(/localhost:(\d+)/);if(port)resolve('http://127.0.0.1:'+port[1]);});
  server.once('exit',code=>reject(Error('Studio exited: '+code)));
});
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
for(const width of [1280,800,390,320]){
  const page=await browser.newPage({viewport:{width,height:760}});
  page.on('pageerror',err=>console.error(err));
  await page.goto(url+'/');
  const nav=page.getByRole('navigation',{name:'Editor views'});
  for(const tab of ['Room','World','Game','Assets','Actors','Code']){
    await nav.getByText(tab,{exact:true}).click();
    if(tab==='Assets'){
      const field=page.getByLabel('Find source files');
      const action=page.getByRole('button',{name:'Import file…',exact:true});
      const [a,b]=await Promise.all([field.boundingBox(),action.boundingBox()]);
      assert.equal(a.height,b.height,'Source search and import control heights');
      if(b.x>=a.x+a.width)assert.ok(Math.abs(a.y-b.y)<1,'Source search and import top edges');
      else assert.ok(b.y>=a.y+a.height,'Wrapped import button clears the search field');
    }
    if(tab==='World')await page.getByRole('button',{name:'right exit'}).click();
    if(tab==='Game'){
      const form=page.locator('.record-form');
      const fields=form.locator('select,input,button');
      assert.deepEqual(await fields.evaluateAll(nodes=>nodes.map(n=>n.tagName)),['SELECT','INPUT','INPUT','BUTTON']);
      const sizes=await fields.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));
      assert.equal(new Set(sizes).size,1,'Variable form control heights at '+width);
      for(const section of ['Controls','Items','Display']){
        await page.getByRole('button',{name:section,exact:true}).click();
        await checkFormRows(page,section);
      }
    }
    if(tab==='Actors')await page.getByRole('button',{name:'Combat',exact:true}).click();
    if(tab==='Code'){
      await page.locator('.blocklySvg').first().waitFor();
      await page.getByRole('button',{name:'Text',exact:true}).click();
      const source=page.locator('.cm-content');
      const original=await source.innerText();
      if(!original.includes('on '))throw Error('Text view has no events');
      await source.fill('on tick\n  jump(\nend');
      await page.locator('.cm-lintRange-error, .cm-lint-marker-error').first().waitFor();
      await page.locator('button[aria-pressed]').filter({hasText:/^Blocks$/}).click();
      await page.locator('.cm-content:visible').waitFor();
      if(width===1280){
        const sprite=await page.getByLabel('Script file').locator('option').first().innerText();
        await page.waitForFunction(async id=>(await(await fetch('./api/recovery/'+encodeURIComponent('./api/script/'+id))).json())?.source?.includes('jump('),sprite);
        await page.reload();await nav.getByText('Code',{exact:true}).click();
        await page.getByText('Recovered script draft').waitFor();
        assert.match(await page.locator('.cm-content').innerText(),/jump\(/);
      }
      await source.fill(original);
      await page.locator('button[aria-pressed]').filter({hasText:/^Blocks$/}).click();
      await page.locator('.blocklySvg:visible').first().waitFor();
      const discard=page.getByRole('button',{name:'Discard',exact:true});
      if(await discard.isVisible()){await discard.click();await discard.waitFor({state:'hidden'});}
    }
    await checkFormRows(page,tab);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    if(overflow)throw Error('Horizontal overflow '+width+' '+tab);
  }
  if(width===1280){
    await nav.getByText('Room',{exact:true}).click();
    await page.locator('.inspector').getByRole('button',{name:'Room',exact:true}).click();
    const name=page.getByLabel('Room name'), before=await name.inputValue();
    await name.fill('Recovered room');await name.press('Tab');
    await page.waitForFunction(async()=>Boolean(await(await fetch('./api/recovery/project')).json()));
    await page.reload();await page.getByRole('button',{name:'Recover edits'}).click();
    await page.locator('.inspector').getByRole('button',{name:'Room',exact:true}).click();
    assert.equal(await name.inputValue(),'Recovered room');
    await page.locator('summary').filter({hasText:'Edit'}).click();
    await page.getByRole('button',{name:'Undo project edit'}).click();assert.equal(await name.inputValue(),before);
    await page.locator('summary').filter({hasText:'Tools'}).click();
    await page.getByRole('button',{name:'Debug room'}).click();
    const pause=page.getByText(/^Paused at/);await pause.waitFor();
    const loc=await pause.textContent();await page.getByRole('button',{name:'Step instruction'}).click();
    await page.waitForFunction(loc=>[...document.querySelectorAll('[role=status]')].some(el=>el.textContent.startsWith('Paused at')&&el.textContent!==loc),loc);
    await page.getByLabel('Event',{exact:true}).fill('tick');
    await page.getByRole('button',{name:'Set breakpoint'}).click();await page.getByRole('button',{name:'Continue'}).click();
    await page.getByText(/^Paused at tick · instruction 0/).waitFor();
    await page.locator('.debugger code').waitFor();
    await page.getByRole('button',{name:'Close',exact:true}).click();
  }
  await page.goto(url+'/player.html');
  await page.getByText('Local game',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByText('Saved slot 1',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Load',exact:true}).click();
  await page.getByText('Loaded slot 1',{exact:true}).waitFor();
  console.log('Passed editor and player at',width);await page.close();
}
await browser.close();server.kill();await fs.rm(fixture,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exit(1);});
