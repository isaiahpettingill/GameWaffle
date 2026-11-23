const {chromium}=require('playwright-core');
(async()=>{
const server=require('node:child_process').spawn(process.execPath,['src/server.mjs','--project','demo','--port','0'],{stdio:['ignore','pipe','inherit']});
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
  for(const tab of ['Room','World','Game','Assets','Blocks']){
    await nav.getByText(tab,{exact:true}).click();
    if(tab==='World')await page.getByRole('button',{name:'right exit'}).click();
    if(tab==='Game')await page.getByRole('button',{name:'Display',exact:true}).click();
    if(tab==='Assets')await page.getByRole('button',{name:'Combat',exact:true}).click();
    if(tab==='Blocks'){
      await page.locator('.blocklySvg').first().waitFor();
      await page.getByRole('button',{name:'Text',exact:true}).click();
      const source=page.locator('.cm-content');
      const original=await source.innerText();
      if(!original.includes('on '))throw Error('Text view has no events');
      await source.fill('on tick\n  jump(\nend');
      await page.locator('.cm-lintRange-error, .cm-lint-marker-error').first().waitFor();
      await page.locator('button[aria-pressed]').filter({hasText:/^Blocks$/}).click();
      await page.locator('.cm-content:visible').waitFor();
      await source.fill(original);
      await page.locator('button[aria-pressed]').filter({hasText:/^Blocks$/}).click();
      await page.locator('.blocklySvg:visible').first().waitFor();
    }
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    if(overflow)throw Error('Horizontal overflow '+width+' '+tab);
  }
  await page.goto(url+'/player.html');
  await page.getByText('Local game',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByText('Saved slot 1',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Load',exact:true}).click();
  await page.getByText('Loaded slot 1',{exact:true}).waitFor();
  console.log('Passed editor and player at',width);await page.close();
}
await browser.close();server.kill();
})().catch(e=>{console.error(e);process.exit(1);});
