const {chromium}=require('playwright-core');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const initializers=rows=>(rows??[]).flatMap(row=>row.op==='init_properties'?row.body:[row]);
async function openPalette(view,workspace,name){
  const category=view.getByLabel('Block category',{exact:true});
  if(await category.isVisible())await category.selectOption({label:name});
  else await workspace.getByRole('treeitem',{name,exact:true}).click();
  return workspace.locator('.blocklyToolboxFlyout');
}
async function checkPalette(view,workspace,name,{includes,excludes=[]}){
  const flyout=await openPalette(view,workspace,name);
  for(const type of includes)await flyout.locator('.blocklyBlockCanvas > .waffle_'+type).waitFor();
  for(const type of excludes)assert.equal(await flyout.locator('.blocklyBlockCanvas > .waffle_'+type).count(),0,name+' should omit '+type);
}
async function checkBlockLayout(page,tab){
  const workspace=page.locator('.block-workspace:visible');
  await workspace.locator('.blocklySvg:visible').first().waitFor();
  for(const name of ['Combat','Entities','Routines','Sound']){
    await openPalette(page,workspace,name);
    const fit=await workspace.evaluate(element=>{
      const bounds=element.getBoundingClientRect();
      const flyout=element.querySelector('.blocklyToolboxFlyout');
      const blocks=[...flyout.querySelectorAll('.blocklyBlockCanvas > .blocklyDraggable')];
      const paletteEdge=flyout.querySelector('.blocklyFlyoutBackground').getBoundingClientRect().right;
      const clearBelow=flyout.style.clipPath || flyout.querySelector('[style*="clip-path"]')?.style.clipPath;
      return {
        count:blocks.length,
        allVisible:blocks.every(block=>block.getBoundingClientRect().right<=bounds.right),
        canvasSpace:bounds.right-paletteEdge,
        clearBelow:Boolean(clearBelow),
      };
    });
    assert.ok(fit.count>0 && fit.allVisible && fit.canvasSpace>20,tab+' should fit the '+name+' palette');
    if(name==='Sound')assert.ok(fit.clearBelow,'A short palette leaves the canvas underneath available');
  }
  await page.getByRole('button',{name:'Fit blocks',exact:true}).click();
  await workspace.locator('.blocklyToolboxFlyout').waitFor({state:'hidden'});
  const workspaceBottom=await workspace.evaluate(element=>element.getBoundingClientRect().bottom);
  const paneBottom=await page.locator('.code-pane').evaluate(element=>element.getBoundingClientRect().bottom);
  assert.ok(paneBottom-workspaceBottom<=2,tab+' should use the full height of the code pane');
}

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
const project=path.join(fixture,'demo art');await fs.cp('demo',project,{recursive:true});
const openLog=process.platform==='linux'&&!process.env.TERMUX_VERSION?path.join(fixture,'opened-asset'):null;
const studioEnv={...process.env,HOME:fixture};
if(openLog){
  await fs.writeFile(path.join(fixture,'xdg-open'),'#!/bin/sh\nprintf "%s\\n" "$1" > "$GW_EDITOR_OPEN_LOG"\n',{mode:0o755});
  Object.assign(studioEnv,{PATH:fixture+path.delimiter+process.env.PATH,TMPDIR:fixture,GW_EDITOR_OPEN_LOG:openLog});
}
async function startStudio(projectPath){
  const server=require('node:child_process').spawn(process.execPath,['src/server.mjs','--project',projectPath,'--port','0'],{stdio:['ignore','pipe','inherit'],env:studioEnv});
  const close=()=>server.kill();
  process.once('exit',close);
  const url=await new Promise((resolve,reject)=>{
    server.stdout.on('data',chunk=>{const port=String(chunk).match(/localhost:(\d+)/);if(port)resolve('http://127.0.0.1:'+port[1]);});
    server.once('exit',code=>{process.off('exit',close);reject(Error('Studio exited: '+code));});
  });
  return {url,server};
}
const {url,server}=await startStudio(project);
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
for(const width of [1280,800,390,320]){
  const page=await browser.newPage({viewport:{width,height:760}});
  const pageErrors=[];page.on('pageerror',err=>pageErrors.push(err.message));
  await page.goto(url+'/');
  await page.locator('.appbar .status').filter({hasText:/^(Ready|Unsaved project|Project saved)$/}).waitFor({state:'attached'});
  assert.deepEqual(await page.locator('.banner[role=alert]').allTextContents(),[],'Project opens without a startup error');
  const nav=page.getByRole('navigation',{name:'Editor views'});
  for(const tab of ['Room','World','Game','Assets','Resources','Entities','Code']){
    await nav.getByText(tab,{exact:true}).click();
    if(tab==='Assets'){
      await page.getByRole('region',{name:'Asset drop zone'}).getByRole('button',{name:'Load asset…',exact:true}).waitFor();
      const field=page.getByLabel('Search assets');
      await field.fill('key');
      await page.locator('.asset').filter({hasText:'key.png'}).waitFor();
      await field.clear();

    }
    if(tab==='World'){
      await page.getByRole('button',{name:'right exit'}).click();
      await page.getByRole('dialog',{name:'Edit Connection'}).getByRole('button',{name:'Cancel',exact:true}).click();
    }
    if(tab==='Game'){
      const game=page.getByRole('region',{name:'Game code'});
      await game.locator('.blocklySvg:visible').waitFor();
      assert.equal(await game.getByLabel('Script file').inputValue(),'game');
      assert.equal(await game.evaluate(editor=>Boolean(editor.closest('dialog'))),false);
      if(width===1280){
        const workspace=game.locator('.block-workspace');
        await checkPalette(game,workspace,'Input',{includes:['bind_input','controller_event','entity_controller_connected','set_first_controller']});
        await checkPalette(game,workspace,'Display shaders',{includes:['apply_shaders','shader_pass'],excludes:['set_room_shader','reset_room_shader']});
        await game.getByRole('button',{name:'Fit blocks',exact:true}).click();
      }
      for(const [button,title] of [['Room defaults…','New room defaults'],['Project settings…','Project settings']]){
        await game.getByRole('button',{name:button,exact:true}).click();
        const settings=page.getByRole('dialog',{name:title});
        assert.ok(await settings.evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth+1),title+' fits the window');
        await page.keyboard.press('Escape');
        await settings.waitFor({state:'hidden'});
      }
    }
    if(tab==='Resources')await page.getByRole('region',{name:'Resources'}).getByRole('button',{name:'Add text…',exact:true}).waitFor();
    if(tab==='Code'){
      await page.getByRole('button',{name:'Blocks',exact:true}).click();
      await page.locator('.blocklySvg:visible').first().waitFor();
      await page.getByRole('button',{name:'Text',exact:true}).click();
      const source=page.locator('.cm-content');
      const original=await source.innerText();
      if(!original.includes('on '))throw Error('Text view has no events');
      await source.fill('on tick\n  jump(\nend');
      await page.locator('.cm-lintRange-error, .cm-lint-marker-error').first().waitFor();
      if(width===1280){
        await page.getByRole('link',{name:'Play game',exact:true}).click();
        await page.locator('.banner[role="alert"]').filter({hasText:'Line 2: Expected a name'}).waitFor();
        await page.locator('.studio-menus summary').filter({hasText:/^File$/}).click();
        await page.getByRole('button',{name:'Export…',exact:true}).click();
        const exportDialog=page.getByRole('dialog',{name:'Export'});
        await exportDialog.getByRole('button',{name:'Export',exact:true}).click();
        await exportDialog.getByRole('alert').filter({hasText:'Line 2: Expected a name'}).waitFor();
        await page.keyboard.press('Escape');
        await exportDialog.waitFor({state:'hidden'});
      }
      await page.locator('button[aria-pressed]').filter({hasText:/^Blocks$/}).click();
      await page.locator('.cm-content:visible').waitFor();
      if(width===1280){
        const sprite=(await page.getByLabel('Script file').inputValue()).split(':')[1];
        await page.waitForFunction(async id=>(await(await fetch('./api/recovery/'+encodeURIComponent('./api/script/'+id))).json())?.source?.includes('jump('),sprite);
        await page.reload();await nav.getByText('Code',{exact:true}).click();
        await page.getByText('Recovered script draft').waitFor();
        assert.match(await page.locator('.cm-content').innerText(),/jump\(/);
      }
      await source.fill(original);
      await page.locator('button[aria-pressed]').filter({hasText:/^Blocks$/}).click();
      await page.locator('.blocklySvg:visible').first().waitFor();
      await page.locator('summary[aria-label="Script actions"]').click();
      const discard=page.getByRole('button',{name:'Discard draft…',exact:true});
      if(await discard.isVisible()){
        await discard.click();
        await page.getByRole('dialog',{name:'Discard Script Draft'}).getByRole('button',{name:'Discard draft'}).click();
        await discard.waitFor({state:'hidden'});
      }else await page.keyboard.press('Escape');
    }
    if(tab==='Code'){
      await checkBlockLayout(page,tab);
      const codePane=await page.locator('.code-pane').boundingBox(),mapPane=await page.locator('.map-pane').boundingBox();
      assert.ok(codePane?.height>0 && mapPane?.height>0,'Both authoring panes must stay visible in '+tab);
      assert.ok(width<=620 ? codePane.y>=mapPane.y+mapPane.height-1 : codePane.x>=mapPane.x+mapPane.width-1,'Authoring pane position');
    }else if(tab==='Room'){
      await page.getByLabel('Room map',{exact:true}).waitFor();
      assert.equal(await page.locator('.code-pane').isVisible(),false,'Room shows the map without the script editor');
      assert.equal(await page.getByRole('button',{name:'Select instance',exact:true}).getAttribute('aria-pressed'),'true');
      assert.equal(await page.getByRole('button',{name:'Brush',exact:true}).getAttribute('aria-pressed'),'false');
    }else if(tab==='Game'){
      assert.equal(await page.locator('.map-pane').isVisible(),false,'Game uses the workspace for its script');
    }else{
      assert.equal(await page.locator('.author-panes').isVisible(),false,'Project view should take the workspace in '+tab);
      assert.ok(await page.getByRole('region',{name:'Project tools'}).isVisible());
    }
    await checkFormRows(page,tab);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    if(overflow)throw Error('Horizontal overflow '+width+' '+tab);
  }
  if(width===1280){
    await nav.getByText('Room',{exact:true}).click();
    await page.evaluate(({path,room})=>{
      localStorage.setItem('gamewaffle.room-view.'+JSON.stringify([path,room]),
        JSON.stringify({zoom:1e-20,center:[100000,-100000]}));
    },{path:project,room:'yard'});
    await page.reload();
    const roomMap=page.getByLabel('Room map',{exact:true});
    const viewport=page.locator('.map-pane .viewport');
    const pan=()=>viewport.evaluate(el=>({x:el.scrollLeft,y:el.scrollTop,w:el.scrollWidth-el.clientWidth,h:el.scrollHeight-el.clientHeight}));
    await viewport.scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>document.querySelector('.map-pane .viewport').scrollLeft>0);
    assert.ok((await roomMap.boundingBox()).width>100,'A stale camera cannot collapse the room canvas');
    const beforePan=await pan();
    assert.ok(beforePan.w>200 && beforePan.h>100,'Room needs space beyond its edges');
    const viewBounds=await viewport.boundingBox(), px=viewBounds.x+viewBounds.width/2, py=viewBounds.y+viewBounds.height/2;
    await page.mouse.move(px,py);
    await page.mouse.down({button:'middle'});
    await page.mouse.move(px-65,py-35,{steps:5});
    await page.mouse.up({button:'middle'});
    assert.ok((await pan()).x>beforePan.x+40);
    const beforeZoom=(await roomMap.boundingBox()).width;
    await page.mouse.wheel(0,-120);
    await page.waitForFunction(previous=>document.querySelector('canvas[aria-label="Room map"]').getBoundingClientRect().width>previous,beforeZoom);
    const beforeControlZoom=(await roomMap.boundingBox()).width;
    await page.keyboard.down('Control');
    await page.mouse.wheel(0,-120);
    await page.keyboard.up('Control');
    await page.waitForFunction(previous=>document.querySelector('canvas[aria-label="Room map"]').getBoundingClientRect().width>previous,beforeControlZoom);
    assert.ok((await roomMap.boundingBox()).width/beforeControlZoom<1.12,'Ctrl+scroll zooms in a small step');
    const art=page.locator('.map-pane .pixel-art');
    await art.waitFor();
    assert.ok(await art.evaluate(canvas=>{
      const box=canvas.getBoundingClientRect();
      return Math.abs(box.width*devicePixelRatio-canvas.width)<.05
        && Math.abs(box.height*devicePixelRatio-canvas.height)<.05
        && !canvas.getContext('2d').imageSmoothingEnabled;
    }),'The stage art is drawn directly at the display pixel density');
    const beforeWheel=await pan();
    await page.mouse.wheel(34,20);
    await page.waitForFunction(previous=>document.querySelector('.map-pane .viewport').scrollLeft>previous,beforeWheel.x+14);
    const touchStart=await pan();
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
    const touchPoints=[{x:px-20,y:py,id:0},{x:px+20,y:py,id:1}];
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touchPoints.map(point=>({...point,x:point.x-42,y:point.y-24}))});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert.ok((await pan()).x>touchStart.x+25);
    const beforePinch=(await roomMap.boundingBox()).width;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touchPoints.map((point,index)=>({...point,x:point.x+(index===0?-18:18)}))});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(previous=>document.querySelector('canvas[aria-label="Room map"]').getBoundingClientRect().width>previous,beforePinch);
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
    await cdp.detach();
    await page.getByTitle('Fit and center room').click();
    const getProject=()=>page.evaluate(async()=> (await(await fetch('./api/project')).json()).project);
    const initial=(await getProject()).rooms.yard;
    const maker=initial.entities.find(actor=>actor.player===0);
    const spriteEntry=page.locator('.project .actor-entry').getByRole('button',{name:maker.sprite,exact:true});
    await page.getByRole('button',{name:'Brush',exact:true}).click();
    assert.equal(await spriteEntry.getAttribute('draggable'),'false');
    const tile=page.locator('.map .tile-list').getByRole('button',{name:'stone',exact:true});
    assert.equal(await tile.getAttribute('draggable'),'true');
    await roomMap.scrollIntoViewIfNeeded();
    const bounds=await roomMap.boundingBox(), size=(await getProject()).tileSize;
    const xy=(x,y)=>[bounds.x+x/(initial.cols*size)*bounds.width,bounds.y+y/(initial.rows*size)*bounds.height];
    const [tileX,tileY]=xy(60,60);
    const drop=async (type,value)=>{
      const dataTransfer=await page.evaluateHandle(([type,value])=>{
        const transfer=new DataTransfer();transfer.setData(type,value);return transfer;
      },[type,value]);
      await roomMap.dispatchEvent('drop',{dataTransfer,clientX:tileX,clientY:tileY});
      await dataTransfer.dispose();
    };
    await drop('application/x-gamewaffle-sprite',maker.sprite);
    const cellCenter=(x,y)=>xy((x+.5)*size,(y+.5)*size);
    const expectStone=async (label,y,variants)=>until(label,async()=>{
      const {layers}=(await getProject()).rooms.yard;
      return layers.some(layer=>variants.every((variant,index)=>layer.cells.some(
        ([x,row,id,selected])=>x===index+2&&row===y&&id==='stone'&&selected===variant)));
    },page);
    const originalRandom=await page.evaluateHandle(()=>Math.random);
    const setRandom=value=>page.evaluate(value=>{Math.random=()=>value;},value);
    try{
      await setRandom(.99);
      await drop('application/x-gamewaffle-tile','stone');
      await expectStone('Random variant on drop',2,[1]);

      const variant=page.getByLabel('Variant',{exact:true});
      assert.equal(await variant.locator('option:checked').textContent(),'Random');
      await page.mouse.move(...cellCenter(2,3));
      await page.mouse.down();
      await setRandom(.01);
      await page.mouse.move(...cellCenter(4,3),{steps:4});
      await page.mouse.up();
      await expectStone('Stable random variants during a stroke',3,[1,0,0]);

      await page.getByRole('button',{name:'Rectangle',exact:true}).click();
      await setRandom(.99);
      await page.mouse.move(...cellCenter(2,4));
      await page.mouse.down();
      await page.mouse.move(...cellCenter(4,4));
      await page.mouse.up();
      await expectStone('Random variants across a rectangle',4,[1,1,1]);

      await page.getByRole('button',{name:'Brush',exact:true}).click();
      await variant.selectOption('0');
      await page.mouse.click(...cellCenter(2,5));
      await expectStone('Explicit brush variant',5,[0]);
    }finally{
      await page.evaluate(random=>{Math.random=random;},originalRandom);
      await originalRandom.dispose();
    }
    assert.equal((await getProject()).rooms.yard.entities.length,initial.entities.length);

    await page.getByRole('button',{name:'Place entity',exact:true}).click();
    await roomMap.scrollIntoViewIfNeeded();
    const actorBounds=await roomMap.boundingBox();
    const fromX=actorBounds.x+maker.x/(initial.cols*size)*actorBounds.width;
    const fromY=actorBounds.y+maker.y/(initial.rows*size)*actorBounds.height;
    await page.mouse.move(fromX,fromY);
    await page.mouse.down();
    await page.mouse.move(fromX+actorBounds.width/initial.cols*2,fromY,{steps:5});
    await page.mouse.up();
    await page.waitForFunction(async previous=> (await(await fetch('./api/project')).json()).project.rooms.yard.entities.some(actor=>actor.player===0 && actor.x!==previous),maker.x);
    assert.equal((await getProject()).rooms.yard.entities.length,initial.entities.length,'Dragging an existing actor must not copy it');
    const inspector=page.locator('.inspector');
    await inspector.getByRole('button',{name:'Placed entities',exact:true}).click();
    await inspector.getByLabel('Name in this room').waitFor();
    assert.equal(await inspector.getByLabel('Controlled by').inputValue(),'0');
    assert.equal(await inspector.getByLabel('Respawn',{exact:true}).isVisible(),false);
    await inspector.getByText('Spawning and room visits',{exact:true}).click();
    await inspector.getByLabel('Respawn',{exact:true}).waitFor();
    const entityTags=inspector.getByLabel('Tags',{exact:true});
    await entityTags.fill('Room guard');
    await entityTags.press('Enter');
    await until('Placed entity tag',async()=> (await getProject()).rooms.yard.entities.some(
      actor=>actor.player===0&&actor.components?.includes('room_guard')),page);
    await inspector.getByRole('button',{name:'Remove tag Room guard',exact:true}).click();
    await until('Placed entity tag removal',async()=> !(await getProject()).rooms.yard.entities.some(
      actor=>actor.player===0&&actor.components?.includes('room_guard')),page);

    await page.locator('.inspector').getByRole('button',{name:'Room',exact:true}).click();
    const name=page.getByLabel('Room name'), before=await name.inputValue();
    await name.fill('Saved room');await name.press('Tab');
    await page.waitForFunction(async()=>Object.values((await(await fetch('./api/project')).json()).project.rooms).some(r=>r.title==='Saved room'));
    await page.locator('summary').filter({hasText:'Edit'}).click();
    await page.locator('.studio-menus').getByRole('button',{name:/^Undo rename of /}).click();assert.equal(await name.inputValue(),before);
    await page.getByRole('button',{name:'Background image',exact:true}).click();
    const backgroundPicker=page.getByRole('dialog',{name:'Background image'});
    await backgroundPicker.getByRole('searchbox').fill('key.png');
    await backgroundPicker.getByRole('button',{name:'key.png',exact:true}).click();
    await page.waitForFunction(async()=> (await(await fetch('./api/project')).json()).roomBackgrounds.yard==='assets/sprites/key.png');
    const imageResponse=await page.request.get(url+'/api/room-art?path=assets%2Fsprites%2Fkey.png');
    assert.equal(imageResponse.headers()['content-type'],'image/png');
    const fileChooser=page.waitForEvent('filechooser');
    await page.getByRole('button',{name:'Browse for background image'}).click();
    await (await fileChooser).setFiles({name:'Café at night.PNG',mimeType:'image/png',buffer:await imageResponse.body()});
    await page.waitForFunction(async()=> (await(await fetch('./api/project')).json()).roomBackgrounds.yard==='assets/backgrounds/cafe-at-night.png');
    await page.getByRole('button',{name:'Background image',exact:true}).filter({hasText:'cafe-at-night.png'}).waitFor();
    await page.getByRole('button',{name:'Open room script',exact:true}).click();
    await page.getByRole('button',{name:'Text',exact:true}).click();
    const roomSource=page.locator('.cm-content');
    const previousRoom=await roomSource.innerText();
    assert.match(previousRoom,/on init/);
    const changedRoom=previousRoom.replace(/camera_zoom\(1(?:\.0)?\)/,'camera_zoom(1.5)')
      .replace('set_camera_bottom_inset(0)','set_camera_bottom_inset(2)')
      .replace(/set_room_background\("#[0-9a-f]+"\)/i,'set_room_background("#bafffe")');
    await roomSource.fill(changedRoom);
    await until('Room camera init',async()=>{
      const unit=await(await page.request.get(url+'/api/room-script/yard')).json();
      return initializers(unit.events.init).some(row=>row.op==='camera_zoom'&&row.zoom.real===1.5)&&
        initializers(unit.events.init).some(row=>row.op==='set_camera_bottom_inset'&&row.tiles===2);
    },page);
    await page.getByRole('button',{name:'Blocks',exact:true}).click();
    const colorField=page.locator('.blocklyBlockCanvas .waffle_set_room_background');
    const swatch=colorField.locator('.block-color-swatch');
    const swatchColor=()=>swatch.evaluate(element=>getComputedStyle(element).fill);
    assert.equal(await swatchColor(),'rgb(186, 255, 254)');
    await colorField.getByText('#bafffe',{exact:true}).click();
    const colorInput=page.getByLabel('Choose color',{exact:true});
    assert.equal(await colorInput.inputValue(),'#bafffe');
    await colorInput.fill('#ff8844');
    await until('Color preview updates',async()=>await swatchColor()==='rgb(255, 136, 68)',page);
    await colorInput.press('Escape');
    await nav.getByText('Game',{exact:true}).click();
    await page.getByRole('button',{name:'Text',exact:true}).click();
    const gameSource=page.locator('.cm-content');
    const previousGame=await gameSource.innerText();
    assert.match(previousGame,/on game startup/);
    await gameSource.fill(previousGame.replace(/set_adaptive_display\([^\n]*\)/,'set_display_resolution(320, 180)'));
    await until('Fixed Game resolution',async()=>{
      const unit=await(await page.request.get(url+'/api/game-script')).json();
      return initializers(unit.events.game_startup).some(row=>row.op==='set_display_resolution'&&row.width===320&&row.height===180);
    },page);
    const fixedPlayer=await browser.newPage({viewport:{width:1000,height:660}});
    try{
      await fixedPlayer.goto(url+'/player.html?play=1');
      await fixedPlayer.getByText('Local game',{exact:true}).waitFor();
      const checkDisplay=async()=>assert.deepEqual(await fixedPlayer.getByLabel('Game display').evaluate(canvas=>
        [canvas.width,canvas.height,canvas.dataset.viewHeight]),[320,180,'120']);
      await checkDisplay();
      const checkPixels=scale=>fixedPlayer.waitForFunction(scale=>{
        const source=document.querySelector('[aria-label="Game display"]'), output=document.querySelector('.shader-output');
        if(output.hidden||output.width!==source.width*scale||output.height!==source.height*scale)return false;
        const box=output.getBoundingClientRect();
        if(Math.abs(box.width*devicePixelRatio-output.width)>.05||Math.abs(box.height*devicePixelRatio-output.height)>.05)return false;
        const rgba=canvas=>new Uint32Array(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.buffer);
        const colors=rgba(source), pixels=rgba(output);
        return colors.every((color,index)=>{
          const x=index%source.width*scale,y=Math.floor(index/source.width)*scale;
          for(let row=0;row<scale;row++)for(let col=0;col<scale;col++){
            if(pixels[(y+row)*output.width+x+col]!==color)return false;
          }
          return true;
        });
      },scale);
      await checkPixels(3);
      await fixedPlayer.setViewportSize({width:430,height:560});
      await fixedPlayer.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await checkDisplay();
      await checkPixels(1);
    }finally{await fixedPlayer.close();}
    await gameSource.fill(previousGame);
    await until('Adaptive resolution',async()=> initializers((await(await page.request.get(url+'/api/game-script')).json()).events.game_startup).some(row=>row.op==='set_adaptive_display'),page);
    await nav.getByText('Room',{exact:true}).click();
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
    await page.getByRole('button',{name:'Open script for maker',exact:true}).click();
    await page.getByRole('button',{name:'Text',exact:true}).click();
    const code='on start\n  set_health_bar(true, "#a6e3a1", "#313244")\nend\non tick\n  apply_gravity(none)\n  if pressed.x and actor.grounded\n    animate("idle")\n    jump_force(240)\n  end\nend\n';
    await page.locator('.cm-content').fill(code);
    await page.waitForFunction(async code=>(await(await fetch('./api/script/maker')).json()).source===code,code);
    await page.locator('.appbar .status').filter({hasText:'Script saved'}).waitFor();
    await page.getByRole('button',{name:'Blocks',exact:true}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll('.blocklyText')].some(el=>el.textContent.replaceAll('\u00a0',' ')==='On tick'));
    await page.getByRole('button',{name:'Fit blocks',exact:true}).click();
    await page.locator('.waffle_color').filter({hasText:'#a6e3a1'}).getByText('#a6e3a1',{exact:true}).click();
    await page.getByLabel('Choose color',{exact:true}).fill('#f38ba8');
    await page.getByLabel('Choose color',{exact:true}).press('Escape');
    await page.waitForFunction(async()=> (await(await fetch('./api/script/maker')).json()).events.start[0].fill==='#f38ba8');
    await page.getByRole('treeitem',{name:'Math & logic'}).click();
    await page.locator('.blocklyFlyout').getByText('sin (°)',{exact:true}).waitFor();
    await page.getByRole('treeitem',{name:'Math & logic'}).click();
    const stageActors=page.getByRole('region',{name:'Entities on the stage'});
    await stageActors.getByRole('button',{name:'pilot',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('select[aria-label="Script file"]')?.value==='entity:pilot');
    await page.getByRole('button',{name:'Play here'}).click();
    const preview=page.frameLocator('iframe[title="Game playtest"]');
    await preview.getByText('Local game',{exact:true}).waitFor();
    await preview.getByRole('button',{name:'Stop',exact:true}).click();
    await page.getByRole('button',{name:'Play here'}).waitFor();


    await nav.getByText('Resources',{exact:true}).click();
    const resources=page.getByRole('region',{name:'Resources'});
    await resources.getByRole('button',{name:'Add language',exact:true}).click();
    let languages=page.getByRole('dialog',{name:'Add language'});
    await languages.getByRole('searchbox').fill('English');
    await languages.getByRole('button',{name:'English',exact:true}).click();
    await resources.getByRole('button',{name:'Add text…',exact:true}).click();
    const addText=page.getByRole('dialog',{name:'Add text resource'});
    await addText.getByLabel('Resource name').fill('greeting');
    await addText.getByLabel('English text').fill('Hello!');
    await addText.getByRole('button',{name:'Add text',exact:true}).click();
    await resources.getByRole('button',{name:'Add language',exact:true}).click();
    languages=page.getByRole('dialog',{name:'Add language'});
    await languages.getByRole('searchbox').fill('Spanish');
    await languages.getByRole('button',{name:'Spanish',exact:true}).click();
    await resources.getByLabel('greeting',{exact:true}).fill('¡Hola!');
    await resources.getByLabel('greeting',{exact:true}).press('Tab');
    await page.waitForFunction(async()=> (await(await fetch('./api/project')).json()).project.localization?.tables.es?.greeting==='¡Hola!');
    await nav.getByText('Game',{exact:true}).click();
    const gameCode=page.getByRole('region',{name:'Game code'});
    await gameCode.getByRole('button',{name:'Text',exact:true}).click();
    const resourceSource=gameCode.getByLabel('WaffleScript source');
    const baseGame=await resourceSource.innerText();
    await resourceSource.fill('resource legacy_label = "Legacy"\n'+baseGame.replace(/(^on game startup\n[\s\S]*?)(^end$)/m,
      '$1  global_string.start_prompt = R["greeting"]\n$2'));
    const getGameScript=async()=> (await(await page.request.get(url+'/api/game-script')).json());
    const promptReference=async()=> (await getGameScript()).events.game_startup.find(row=>row.name==='start_prompt')?.value?.text;
    await until('Resource reference',async()=>await promptReference()==='greeting',page);
    await gameCode.getByRole('button',{name:'Blocks',exact:true}).click();
    await gameCode.getByRole('button',{name:'Fit blocks',exact:true}).click();
    const resourceChip=gameCode.locator('.blocklyBlockCanvas .waffle_localized .blocklyDropdownText');
    const resourcePicker=page.locator('.block-field-picker:visible');
    await resourceChip.filter({hasText:'greeting'}).click();
    await resourcePicker.getByRole('searchbox').fill('Start prompt');
    await resourcePicker.getByRole('button',{name:'+ Add resource…',exact:true}).click();
    assert.equal(await addText.getByLabel('Resource name').inputValue(),'Start prompt');
    await addText.getByLabel('English text').fill('Play');
    await addText.getByRole('button',{name:'Add text',exact:true}).click();
    await resourceChip.filter({hasText:'start_prompt'}).waitFor();
    await until('Resource stored and selected',async()=>
      (await getProject()).localization?.tables.en?.start_prompt==='Play'&&await promptReference()==='start_prompt',page);
    assert.deepEqual((await getGameScript()).declarations?.resources,{legacy_label:'Legacy'});

    await resourceChip.click();
    await resourcePicker.getByRole('button',{name:'Edit resource…',exact:true}).click();
    const editResource=page.getByRole('dialog',{name:'Edit text resource'});
    assert.equal(await editResource.getByLabel('English text').inputValue(),'Play');
    await editResource.getByLabel('English text').fill('Canceled edit');
    await editResource.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal((await getProject()).localization?.tables.en?.start_prompt,'Play');
    await resourceChip.click();
    await resourcePicker.getByRole('button',{name:'Edit resource…',exact:true}).click();
    await editResource.getByLabel('English text').fill('Start');
    await editResource.getByLabel('Resource language').selectOption('es');
    await editResource.getByLabel('Spanish text').fill('Jugar');
    await editResource.getByRole('button',{name:'Save text',exact:true}).click();
    await until('Quick resource edit',async()=>{
      const {tables}=(await getProject()).localization;
      return tables.en?.start_prompt==='Start'&&tables.es?.start_prompt==='Jugar';
    },page);
    assert.equal(await promptReference(),'start_prompt');
    await gameCode.getByRole('button',{name:'Text',exact:true}).click();
    assert.match(await resourceSource.innerText(),/global_string\.start_prompt = R\.start_prompt/);
    await gameCode.getByRole('button',{name:'Blocks',exact:true}).click();
    await nav.getByText('Resources',{exact:true}).click();
    const prompt=resources.getByRole('row').filter({hasText:'start_prompt'});
    await resources.getByLabel('Resource language').selectOption('es');
    await prompt.getByText('Start',{exact:true}).waitFor();
    assert.equal(await prompt.getByLabel('start_prompt',{exact:true}).inputValue(),'Jugar');
    await nav.getByText('Game',{exact:true}).click();
    await page.getByRole('button',{name:'Project settings…',exact:true}).click();
    const projectSettings=page.getByRole('dialog',{name:'Project settings'});
    const coverChooser=page.waitForEvent('filechooser');
    await page.getByRole('button',{name:'Choose cover image…'}).click();
    const {PNG}=require('pngjs');
    const wideCover=new PNG({width:80,height:40});
    for(let y=0;y<40;y++)for(let x=0;x<80;x++)
      wideCover.data.writeUInt32BE(x<40?0xff0000ff:0x0000ffff,(y*80+x)*4);
    await (await coverChooser).setFiles({name:'Cover art.png',mimeType:'image/png',buffer:PNG.sync.write(wideCover)});
    const coverDialog=page.getByRole('dialog',{name:'Crop cover art'});
    const coverCanvas=coverDialog.getByLabel('Cover crop preview');
    const coverPixel=()=>coverCanvas.evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(0,0,1,1).data));
    await coverDialog.getByRole('button',{name:'Fit',exact:true}).click();
    assert.deepEqual(await coverPixel(),[0,0,0,0]);
    await coverDialog.getByRole('button',{name:'Fill',exact:true}).click();
    const square=await coverCanvas.boundingBox();
    await page.mouse.move(square.x+square.width/2,square.y+square.height/2);
    await page.mouse.down();
    await page.mouse.move(square.x+4,square.y+square.height/2,{steps:4});
    await page.mouse.up();
    assert.ok(Number(await coverDialog.getByLabel('Horizontal position').inputValue())>.9);
    await coverDialog.getByRole('button',{name:'Save cover'}).click();
    await until('Cartridge cover',async()=> (await getProject()).coverImage==='assets/covers/cover-art.png',page);
    await page.getByAltText('Cartridge cover art').waitFor();
    await page.getByRole('button',{name:'Edit crop…'}).click();
    await coverDialog.getByLabel('Zoom').press('End');
    await coverDialog.getByLabel('Horizontal position').press('Home');
    assert.deepEqual(await coverPixel(),[255,0,0,255]);
    await coverDialog.getByRole('button',{name:'Save cover'}).click();
    await coverDialog.waitFor({state:'hidden'});
    assert.deepEqual((await getProject()).coverCrop,{x:0,y:.5,zoom:8});
    await projectSettings.getByRole('button',{name:'Done',exact:true}).click();

    const fileMenu=page.locator('summary').filter({hasText:/^File$/});
    await fileMenu.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    const dialog=page.getByRole('dialog',{name:'Export'});
    await dialog.getByLabel('Format').selectOption('project');
    assert.equal(await dialog.getByLabel('Language').count(),0);
    await dialog.getByLabel('Format').selectOption('cartridge');
    await dialog.getByLabel('Language').selectOption('es');
    const [download]=await Promise.all([page.waitForEvent('download'),dialog.getByRole('button',{name:'Export',exact:true}).click()]);
    assert.match(download.suggestedFilename(),/-es\.waffle$/);
    const {unpack}=await import('../src/cartridge.mjs');
    const published=unpack(await fs.readFile(await download.path()),{simulation:true});
    assert.equal(published.locale,'es');
    assert.equal(published.text.greeting,'¡Hola!');
    assert.equal(published.text.start_prompt,'Jugar');
    assert.ok(published.fontGlyphs['¡']>=96);
    const publishedCover=PNG.sync.read(Buffer.from(published.coverArt));
    assert.deepEqual([publishedCover.width,publishedCover.height],[512,512]);
    assert.deepEqual([...publishedCover.data.subarray(0,4)],[255,0,0,255]);
    await dialog.waitFor({state:'hidden'});
    assert.equal(await fileMenu.evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await dialog.waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'hidden'});

    await nav.getByText('Code',{exact:true}).click();
    await page.getByRole('button',{name:'Text',exact:true}).click();
    const typedCode=`on tick
  local.target = entity.find("maker")
  velocity(17, 1)
  local_real.speed = math.sin(30.0)
  if entity.touching(entity.last_spawn) then
    stop_sound(entity.id)
  end
  local_bool.run = local_real.speed > 0.0
  if local_bool.run
    repeat 2
      say(text.greeting)
    end
  end
end
`;
    await page.locator('.cm-content').fill(typedCode);
    await page.waitForFunction(async source=>(await(await fetch('./api/script/pilot')).json()).source===source,typedCode);
    await page.getByRole('button',{name:'Blocks',exact:true}).click();
    await page.locator('.blocklyBlockCanvas').getByText('sin (°)',{exact:true}).waitFor();
    await page.locator('.blocklyBlockCanvas').getByText('Touching entity',{exact:true}).waitFor({state:'attached'});
    await page.locator('.blocklyBlockCanvas').getByText('Stop playing sounds for',{exact:true}).waitFor({state:'attached'});
    await page.getByRole('button',{name:'Text',exact:true}).click();
    assert.equal((await page.locator('.cm-content').innerText()).trim(),typedCode.trim());
    await page.getByRole('button',{name:'Blocks',exact:true}).click();
    const fields=page.locator('.blocklyBlockCanvas .blocklyDropdownText');
    const entityField=fields.filter({hasText:/^maker$/});
    await entityField.click();
    const search=page.getByRole('searchbox',{name:'Search options'});
    await search.fill('runner');
    await search.press('Enter');
    await page.waitForFunction(async()=> (await(await fetch('./api/script/pilot')).json()).events?.tick?.some(row=>row.value?.call==='entity.find'&&row.value.args[0]==='runner'));
    await page.locator('.blocklyBlockCanvas').getByText('17',{exact:true}).click();
    const inlineNumber=page.locator('.blocklyHtmlInput');
    await inlineNumber.fill('0.75');
    await inlineNumber.press('Enter');
    await page.waitForFunction(async()=> (await(await fetch('./api/script/pilot')).json()).events?.tick?.some(row=>row.op==='velocity'&&row.x?.real===0.75));


  }
  await page.goto(url+'/player.html');
  await page.getByText('Choose a cartridge',{exact:true}).waitFor();
  await page.goto(url+'/player.html?play=1');
  await page.getByText('Local game',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByText('Saved slot 1',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Load',exact:true}).click();
  await page.getByText('Loaded slot 1',{exact:true}).waitFor();
  assert.deepEqual(pageErrors,[],'Uncaught page errors at '+width);
  console.log('Passed editor and player at',width);await page.close();
}
const setup=await browser.newPage({viewport:{width:390,height:760}});
await setup.goto(url+'/projects?action=manager');
const launch=setup.locator('main');
const openButton=launch.getByRole('button',{name:'Open Project',exact:true});
await openButton.click();
const openDialog=setup.getByRole('dialog',{name:'Open Project'});
assert.equal(await openDialog.getByRole('textbox').count(),0);
await openDialog.getByRole('button',{name:'Cancel'}).click();
assert.equal(await openButton.evaluate(el=>el===document.activeElement),true);

const launcher=new URL(setup.url()).origin;
const createButton=launch.getByRole('button',{name:'New Project',exact:true});
await createButton.click();
const create=setup.getByRole('dialog',{name:'New Project'});
const gameName="Café Racer: Red & Blue! 🚗";
const gameField=create.getByRole('textbox',{name:'Game name'});
assert.equal(await create.getByRole('textbox').count(),1);
assert.equal(await gameField.evaluate(el=>el===document.activeElement),true);
await gameField.fill(gameName);
await create.getByRole('button',{name:'Change…'}).click();
const folders=setup.getByRole('dialog',{name:'Choose a Folder'});
assert.equal(await folders.getByRole('textbox').count(),0);
await folders.getByRole('button',{name:'Use This Folder'}).click();
assert.equal(await gameField.inputValue(),gameName);
await create.getByLabel('First room').selectOption('top_down');
await create.getByRole('button',{name:'Create Project'}).click();
await setup.getByRole('navigation',{name:'Editor views'}).waitFor();
const created=await (await setup.request.get(new URL('/api/project',setup.url()).href)).json();
assert.equal(created.project.name,gameName);
assert.equal(path.basename(created.path),'cafe-racer-red-blue');
assert.equal(created.project.rooms.room.view,'top_down');

await setup.goto(launcher+'/?action=manager');
await openButton.click();
await openDialog.getByRole('button',{name:'cafe-racer-red-blue',exact:true}).click();
await openDialog.getByRole('button',{name:'Open This Project'}).click();
await setup.getByRole('navigation',{name:'Editor views'}).waitFor();

const request=action=>setup.request.post(launcher+'/',{headers:{Origin:launcher},form:action});
const duplicate=await request({action:'new',name:gameName});
assert.ok(duplicate.ok(),await duplicate.text());
assert.ok((await fs.stat(path.join(path.dirname(created.path),'cafe-racer-red-blue-2'))).isDirectory());
await setup.goto(launcher+'/?action=new');
await create.waitFor();
await gameField.fill('CON');
await create.getByText('Storage options').click();
await create.getByLabel('Save as').selectOption('archive');
await create.getByRole('button',{name:'Create Project'}).click();
await setup.getByRole('navigation',{name:'Editor views'}).waitFor();
const archived=await (await setup.request.get(new URL('/api/project',setup.url()).href)).json();
assert.equal(path.basename(archived.path),'con-game.waffleproj');
assert.equal(archived.project.name,'CON');
await setup.getByRole('button',{name:'Settings',exact:true}).click();
await setup.locator('.inspector').getByRole('button',{name:'Room',exact:true}).click();
const archivedChooser=setup.waitForEvent('filechooser');
await setup.getByRole('button',{name:'Browse for background image'}).click();
await (await archivedChooser).setFiles({name:'Night.png',mimeType:'image/png',buffer:await fs.readFile('demo/assets/sprites/key.png')});
await setup.waitForFunction(async()=> (await(await fetch('./api/project')).json()).roomBackgrounds.room==='assets/backgrounds/night.png');
await setup.close();
console.log('Passed project dialogs, safe project names, file browsing, and collision handling');

const authoring=await browser.newPage({viewport:{width:1280,height:800}});
await authoring.goto(url+'/');
async function until(label,check,page=authoring){
  const deadline=Date.now()+8000;
  do{
    if(await check())return;
    await new Promise(resolve=>setTimeout(resolve,120));
  }while(Date.now()<deadline);
  throw Error(label+' was not saved: '+await page.locator('[role=alert]').allTextContents());
}
const readProject=async()=> (await (await authoring.request.get(url+'/api/project')).json()).project;
const views=authoring.getByRole('navigation',{name:'Editor views'});
await views.getByRole('button',{name:'World',exact:true}).click();
await authoring.locator('.world').getByRole('button',{name:'Top-down Courtyard'}).click();
const connection=authoring.getByRole('dialog',{name:'Edit Connection'});
await authoring.getByRole('button',{name:'right exit'}).click();
const routing=connection.getByLabel('Routing');
await routing.selectOption('fixed');
await routing.selectOption('save');
const alternate=connection.getByRole('button',{name:'Remove alternate Cooling Vault'});
await alternate.waitFor();
await connection.getByRole('button',{name:'Destination',exact:true}).click();
await connection.getByRole('dialog',{name:'Destination'}).getByRole('button',{name:'Pump Hall'}).click();
await alternate.waitFor();
await connection.getByRole('button',{name:'Apply',exact:true}).click();
await until('Alternate destinations',async()=> (await readProject()).rooms.courtyard.exits.right.targets.join(',')==='arena,vault,yard');
await views.getByRole('button',{name:'Room',exact:true}).click();
await authoring.getByRole('button',{name:'Undo connection from Top-down Courtyard'}).click();
await until('Undo of the connection',async()=> (await readProject()).rooms.courtyard.exits.right.targets.join(',')==='yard,vault');

await views.getByRole('button',{name:'Game',exact:true}).click();
await authoring.getByRole('button',{name:'Room defaults…',exact:true}).click();
const getRoomInit=async id=>(await(await authoring.request.get(url+'/api/room-script/'+id)).json()).events.init;
const oldYardInit=await getRoomInit('yard');
const zoomDefault=authoring.getByRole('spinbutton',{name:'Camera zoom (×)',exact:true});
await zoomDefault.fill('1.75');
await authoring.getByRole('button',{name:'Apply defaults',exact:true}).click();
await until('Room defaults saved',async()=>(await readProject()).roomDefaults?.cameraZoom===1.75);
await views.getByRole('button',{name:'Room',exact:true}).click();
await authoring.getByRole('button',{name:'New room',exact:true}).click();
const newRoom=authoring.getByRole('dialog',{name:'New Room'});
await newRoom.getByLabel('Room name').fill('Upper Deck!');
await newRoom.getByRole('button',{name:'Create room'}).click();
await until('New room',async()=> (await readProject()).rooms.upper_deck?.title==='Upper Deck!');
const upperDeckInit=await getRoomInit('upper_deck');
assert.equal(upperDeckInit[0].op,'init_properties');
assert.equal(initializers(upperDeckInit).find(row=>row.op==='camera_zoom').zoom,1.75);
assert.deepEqual(await getRoomInit('yard'),oldYardInit);

await views.getByRole('button',{name:'Assets',exact:true}).click();
const assetLibrary=authoring.getByRole('region',{name:'Asset library'});
assert.equal(await assetLibrary.getByRole('button',{name:'New shader…',exact:true}).count(),0);
await assetLibrary.getByLabel('Search assets').fill('maker');
const makerAsset=assetLibrary.locator('.asset').filter({hasText:'maker.aseprite'});
await makerAsset.locator('img').waitFor();
if(openLog){
  const source='assets/sprites/maker.aseprite', file=path.join(project,source);
  const original=await fs.readFile(file), edited=await fs.readFile(path.join(project,'assets/sprites/pilot.aseprite'));
  const image=makerAsset.locator('img');
  await image.evaluate(img=>img.decode());
  const pixels=()=>image.evaluate(img=>{
    if(!img.complete||!img.naturalWidth)return null;
    const canvas=document.createElement('canvas');
    canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    canvas.getContext('2d').drawImage(img,0,0);
    return canvas.toDataURL();
  });
  const before=await pixels();
  async function saveArt(destination,bytes){
    await fs.writeFile(destination+'.save',bytes);
    await fs.rename(destination+'.save',destination);
  }
  await assetLibrary.getByRole('button',{name:'Open maker in default editor',exact:true}).click();
  await until('Default editor received original file',async()=> (await fs.readFile(openLog,'utf8').catch(()=>'')).trim()===file);
  await saveArt(file,edited);
  await until('Externally saved art reloaded in Assets',async()=>{const preview=await pixels();return preview&&preview!==before;});
  await saveArt(file,original);
  await until('Externally restored art reloaded',async()=>await pixels()===before);

  const archivePath=path.join(fixture,'art-edit.waffleproj');
  await fs.writeFile(archivePath,await (await authoring.request.get(url+'/api/archive')).body());
  const archived=await startStudio(archivePath);
  try{
    const denied=await authoring.request.post(archived.url+'/api/open-asset',{data:{path:'../maker.aseprite'}});
    assert.equal(denied.status(),400);
    const response=await authoring.request.post(archived.url+'/api/open-asset',{data:{path:source}});
    assert.ok(response.ok(),await response.text());
    const copy=(await fs.readFile(openLog,'utf8')).trim();
    assert.equal(path.basename(copy),'maker.aseprite');
    assert.notEqual(copy,file);
    assert.deepEqual(await fs.readFile(copy),original);
    await saveArt(copy,edited);
    const {unzipSync}=require('fflate');
    await until('External edit persisted in project archive',async()=>
      Buffer.from(unzipSync(await fs.readFile(archivePath))[source]).equals(edited));
  }finally{archived.server.kill();}
  console.log('Passed default editor launch and asset reload for folder and archive projects');
}
await assetLibrary.getByRole('button',{name:'Edit details for maker',exact:true}).click();
const details=authoring.getByRole('dialog',{name:'Asset details'});
await details.getByLabel('Tags',{exact:true}).fill('Player art');
await details.getByLabel('Tags',{exact:true}).press('Enter');
await details.getByRole('button',{name:'Remove tag Player art',exact:true}).waitFor();
await details.getByRole('button',{name:'Save details',exact:true}).click();
await until('Asset tag saved',async()=> (await readProject()).assetInfo?.['assets/sprites/maker.aseprite']?.tags?.[0]==='Player art');
await assetLibrary.getByLabel('Search assets').clear();
await assetLibrary.getByRole('button',{name:'Filter by tag Player art',exact:true}).click();
assert.equal(await assetLibrary.locator('tbody tr').count(),1);
await makerAsset.click();
await authoring.getByRole('region',{name:'Project tools'}).getByLabel('Entity type').waitFor();
assert.equal(await views.getByRole('button',{name:'Entities',exact:true}).getAttribute('aria-current'),'page');
await views.getByRole('button',{name:'Assets',exact:true}).click();
const assetSearch=assetLibrary.getByLabel('Search assets');
const assetTypeFilter=assetLibrary.getByLabel('Asset type filter');
const assetTagFilter=assetLibrary.getByLabel('Asset tag filter');
await assetSearch.fill('maker');
await assetTypeFilter.selectOption('sprite');
await assetTagFilter.selectOption('Player art');
const makerThumbnail=makerAsset.locator('img');
await makerThumbnail.evaluate(img=>img.decode());
const makerPreviewBeforeImport=await makerThumbnail.getAttribute('src');
await assetLibrary.getByLabel('Asset files',{exact:true}).setInputFiles({name:'Tag test.png',mimeType:'image/png',buffer:await fs.readFile('demo/assets/sprites/key.png')});
const loadAsset=authoring.getByRole('dialog',{name:'Load asset'});
await loadAsset.getByLabel('Asset type',{exact:true}).selectOption('source');
await loadAsset.getByLabel('Tags',{exact:true}).fill('Interface');
await loadAsset.getByLabel('Tags',{exact:true}).press('Enter');
await loadAsset.getByRole('button',{name:'Remove tag Interface',exact:true}).waitFor();
await loadAsset.getByRole('button',{name:'Load asset',exact:true}).click();
await loadAsset.waitFor({state:'hidden'});
assert.equal(await assetSearch.inputValue(),'maker');
assert.equal(await assetTypeFilter.inputValue(),'sprite');
assert.equal(await assetTagFilter.inputValue(),'Player art');
assert.ok(await makerAsset.isVisible());
assert.equal(await makerThumbnail.getAttribute('src'),makerPreviewBeforeImport);
await until('Tag saved with imported image',async()=> (await readProject()).assetInfo?.['assets/images/tag-test.png']?.tags?.[0]==='Interface');
await assetSearch.clear();
await assetTypeFilter.selectOption('');
await assetTagFilter.selectOption('');
assert.ok(await assetLibrary.locator('.asset').filter({hasText:'tag-test.png'}).isVisible());
await assetLibrary.getByRole('button',{name:'Bitfonts',exact:true}).click();
await assetLibrary.getByRole('button',{name:'Import bitfont…'}).click();
const bitfont=authoring.getByRole('dialog',{name:'Import Bitfont'});
const {PNG}=require('pngjs');
const sheet=new PNG({width:12,height:8});
sheet.data.fill(255);
await bitfont.locator('input[type=file]').setInputFiles({name:'Tiny.png',mimeType:'image/png',buffer:PNG.sync.write(sheet)});
await bitfont.getByLabel('Character for cell 1').fill('A');
await bitfont.getByLabel('Character for cell 1').press('Enter');
await bitfont.getByLabel('Character for cell 2').fill('á');
await bitfont.getByRole('button',{name:'Import',exact:true}).click();
await bitfont.waitFor({state:'hidden'});
await until('PNG bitfont',async()=>{
  const project=await readProject();
  return project.activeBitfont==='tiny' && project.bitfonts.tiny.assignments[1]==='á';
});
await authoring.getByRole('button',{name:'Import bitfont…'}).click();
await bitfont.locator('input[type=file]').setInputFiles({
  name:'YAFF Face.yaff',mimeType:'text/plain',
  buffer:Buffer.from("name: Test\ncell-size: 5 7\n'A':\n  .@.\n  @@@\n  @.@\n"),
});
await bitfont.getByRole('button',{name:'Import',exact:true}).click();
await bitfont.waitFor({state:'hidden'});
await until('YAFF bitfont',async()=> (await readProject()).activeBitfont==='yaff_face');
await authoring.getByRole('button',{name:'Import bitfont…'}).click();
const tagged=await fs.readFile(path.join(project,'assets','sprites','pilot.aseprite'));
const tagOffset=tagged.indexOf('idle');
assert.ok(tagOffset>=0);
tagged.write('U+41',tagOffset,'ascii');
await bitfont.locator('input[type=file]').setInputFiles({name:'Tagged.aseprite',mimeType:'application/octet-stream',buffer:tagged});
assert.equal(await bitfont.getByLabel('Glyph width (px)').count(),0);
await bitfont.getByRole('button',{name:'Import',exact:true}).click();
await bitfont.waitFor({state:'hidden'});
await until('Aseprite bitfont',async()=> (await readProject()).activeBitfont==='tagged');
const {unpack}=await import('../src/cartridge.mjs');
const renderedFont=unpack(new Uint8Array(await (await authoring.request.get(url+'/demo.waffle')).body()));
assert.ok(renderedFont.runtimeAbi>=11);
assert.equal(renderedFont.fontGlyphs.A,0);
assert.equal(renderedFont.fontLayout.width,24);
await views.getByRole('button',{name:'Code',exact:true}).click();
await authoring.locator('summary[aria-label="Script actions"]').click();
await authoring.getByRole('button',{name:'Movement preset…'}).click();
await authoring.getByRole('dialog',{name:'Add Movement Blocks'}).getByRole('button',{name:'Add blocks'}).click();
await until('Movement blocks',async()=> {
  const project=await readProject();
  const id=Object.keys(project.sprites)[0];
  const data=await (await authoring.request.get(url+'/api/script/'+id)).json();
  return data.events?.tick?.some(row=>row.condition?.actor==='is_player');
});
const scriptFile=authoring.getByLabel('Script file',{exact:true});
const stageRoom=authoring.getByRole('button',{name:'Stage room'});
const stageTitle=await stageRoom.innerText();
await scriptFile.selectOption('room:vault');
await until('Room script picker',async()=> await scriptFile.inputValue()==='room:vault');
assert.equal(await stageRoom.innerText(),stageTitle);
assert.equal(await views.getByRole('button',{name:'Code',exact:true}).getAttribute('aria-current'),'page');
await authoring.locator('summary[aria-label="Script actions"]').click();
await authoring.getByRole('button',{name:'Constants…',exact:true}).click();
const constantsDialog=authoring.getByRole('dialog',{name:'Script Constants'});
await constantsDialog.getByRole('button',{name:'Add constant'}).click();
await constantsDialog.getByLabel('Name').fill('default_zoom');
await constantsDialog.getByLabel('Type').selectOption('real');
await constantsDialog.getByLabel('Value').fill('1.25');
await constantsDialog.getByRole('button',{name:'Apply'}).click();
await constantsDialog.waitFor({state:'hidden'});
await until('Typed script constant',async()=> (await (await authoring.request.get(url+'/api/room-script/vault')).json()).constants?.default_zoom?.real===1.25);
await authoring.getByRole('treeitem',{name:'Variables',exact:true}).click();
await authoring.locator('.blocklyToolboxFlyout .waffle_constant').filter({hasText:/default_zoom/}).waitFor();
await authoring.getByRole('button',{name:'Text',exact:true}).click();
assert.match(await authoring.locator('.cm-content').innerText(),/const default_zoom = 1\.25/);
await authoring.getByRole('button',{name:'Blocks',exact:true}).click();
await authoring.getByRole('button',{name:'Upper Deck!',exact:true}).click();
await until('Sidebar selects room script',async()=> await scriptFile.inputValue()==='room:upper_deck');
assert.equal(await authoring.locator('.project').getByRole('button',{name:'Upper Deck!',exact:true}).getAttribute('aria-pressed'),'true');
assert.match(await stageRoom.innerText(),/Upper Deck!/);
assert.equal(await views.getByRole('button',{name:'Code',exact:true}).getAttribute('aria-current'),'page');
const roomCode=authoring.getByRole('region',{name:'Room code'});
const readDeclarations=async()=> (await(await authoring.request.get(url+'/api/game-script')).json()).declarations;
await roomCode.locator('summary[aria-label="Script actions"]').click();
await roomCode.getByRole('button',{name:'New event…'}).click();
const eventDialog=authoring.getByRole('dialog',{name:'New Event'});
await eventDialog.getByRole('textbox',{name:'Event name'}).fill('Door opened!');
await eventDialog.getByRole('button',{name:'Create event'}).click();
await until('New event registered',async()=> (await readDeclarations()).events?.door_opened==='Door opened!');
await roomCode.getByRole('button',{name:'Text',exact:true}).click();
await roomCode.locator('.cm-content').fill(`on start
  camera(220, 160)
  camera_zoom(1.5)
  set_room_shader("snow", 65)
  emit_event("door_opened")
  flag.found_key = false
end
on received.door_opened
  global.sender = entity.event_sender
  draw_text("notice", "A", "tagged", "bottom_right", 4, 6)
end
on tick
  if action.right
    camera(220, 160)
  else
    if action.left
      set_room_gravity(0)
    else
      reset_room_camera()
    end
  end
end
`);
await until('Room camera and shader script',async()=>{
  const response=await authoring.request.get(url+'/api/room-script/upper_deck');
  const script=await response.json();
  return script.events?.start?.[1]?.op==='camera_zoom' && script.events.start[2].shader==='snow' &&
    script.events['received.door_opened']?.[0]?.value?.actor==='event_sender'&&script.events['received.door_opened']?.[1]?.font==='tagged';
});
assert.equal((await readProject()).rooms.upper_deck.script,'scripts/rooms/upper_deck.cbor');
await roomCode.getByRole('button',{name:'Blocks',exact:true}).click();
await roomCode.getByRole('button',{name:'Fit blocks',exact:true}).click();
const roomWorkspace=roomCode.locator('.block-workspace:visible');
await roomWorkspace.locator('.waffle_received_event').filter({hasText:/Door\s+opened!/}).waitFor();
await roomWorkspace.locator('.waffle_emit_event').filter({hasText:/Door\s+opened!/}).waitFor();
await roomWorkspace.locator('.waffle_event_sender').waitFor();
await roomWorkspace.locator('.waffle_draw_text').filter({hasText:/bottom\s+right/}).waitFor();
const dropdownText=block=>roomWorkspace.locator('.blocklyBlockCanvas '+block+' .blocklyDropdownText');
const picker=authoring.locator('.block-field-picker:visible');
await dropdownText('.waffle_emit_event').filter({hasText:/Door\s+opened!/}).click();
await picker.getByRole('searchbox').fill('Gate opened!');
await picker.getByRole('button',{name:'New event…',exact:true}).click();
assert.equal(await eventDialog.getByRole('textbox',{name:'Event name'}).inputValue(),'Gate opened!');
await eventDialog.getByRole('button',{name:'Create event'}).click();
await dropdownText('.waffle_emit_event').filter({hasText:/Gate\s+opened!/}).waitFor();
await until('Event created and selected from Emit event',async()=>{
  const script=await (await authoring.request.get(url+'/api/room-script/upper_deck')).json();
  return (await readDeclarations()).events?.gate_opened==='Gate opened!'&&script.events?.start?.[3]?.event==='gate_opened';
});
await dropdownText('.waffle_received_event').filter({hasText:/Door\s+opened!/}).click();
await picker.getByRole('button',{name:'New event…',exact:true}).click();
await eventDialog.getByRole('textbox',{name:'Event name'}).fill('Cancelled event');
await eventDialog.getByRole('button',{name:'Cancel',exact:true}).click();
await dropdownText('.waffle_received_event').filter({hasText:/Door\s+opened!/}).waitFor();
assert.equal((await readDeclarations()).events.cancelled_event,undefined);
await dropdownText('.waffle_received_event').filter({hasText:/Door\s+opened!/}).click();
await picker.getByRole('button',{name:'Gate opened!',exact:true}).click();
await dropdownText('.waffle_received_event').filter({hasText:/Gate\s+opened!/}).waitFor();
await dropdownText('.waffle_set').filter({hasText:'found_key'}).click();
await picker.getByRole('searchbox').fill('Gate unlocked');
await picker.getByRole('searchbox').press('Enter');
const flagDialog=authoring.getByRole('dialog',{name:'New Flag'});
assert.equal(await flagDialog.getByRole('textbox',{name:'Flag name'}).inputValue(),'Gate unlocked');
await flagDialog.getByRole('button',{name:'Create flag'}).click();
await dropdownText('.waffle_set').filter({hasText:/Gate\s+unlocked/}).waitFor();
await until('Flag created and selected from Set',async()=>{
  const script=await (await authoring.request.get(url+'/api/room-script/upper_deck')).json();
  return (await readDeclarations()).flags?.gate_unlocked===false&&script.events?.start?.[4]?.name==='gate_unlocked';
});
const chain=roomWorkspace.locator('.blocklyBlockCanvas .waffle_if');
const addBranch=chain.locator('image[alt="Add branch"]');
const removeBranch=chain.locator('image[alt="Remove else-if branch"]');
assert.equal(await chain.count(),1,'A nested else containing a single if opens as one chain');
assert.equal(await removeBranch.count(),1);
await addBranch.click();
await until('Added else-if branch',async()=>await removeBranch.count()===2);
await removeBranch.first().click();
await until('Removed else-if branch',async()=> await removeBranch.count()===1);
const detachedBranch=roomWorkspace.locator('.blocklyBlockCanvas .waffle_set_room_gravity.gw-detached');
await detachedBranch.waitFor();
await chain.locator('[aria-label="Add branch"]').focus();
await authoring.keyboard.press('Control+z');
await until('Undid branch removal',async()=> await removeBranch.count()===2);
await detachedBranch.waitFor({state:'detached'});
await chain.locator('.waffle_set_room_gravity').waitFor();
await chain.locator('image[alt="Remove else branch"]').click();
await addBranch.click();
await authoring.getByRole('button',{name:'Add else',exact:true}).click();
await chain.locator('image[alt="Remove else branch"]').waitFor();
const roomCategories=await roomWorkspace.locator('.blocklyToolboxCategoryLabel').allTextContents();
assert.ok(!roomCategories.includes('Display')&&!roomCategories.includes('Display shaders'));
await checkPalette(roomCode,roomWorkspace,'Background',{includes:['set_room_background','set_room_background_image','set_background_gradient']});
await checkPalette(roomCode,roomWorkspace,'Events',{includes:['event_sender','event_entity','received_event','emit_event']});
await checkPalette(roomCode,roomWorkspace,'Camera',{includes:['camera_zoom','follow_player','reporter_camera_touching_edge'],excludes:['set_room_background','release_camera']});
await checkPalette(roomCode,roomWorkspace,'Room',{includes:['set_room_border','reporter_camera_touching_room_edge'],excludes:['camera_zoom']});
await checkPalette(roomCode,roomWorkspace,'Room shaders',{includes:['apply_shaders','shader_pass','set_room_shader','reset_room_shader']});
await checkPalette(roomCode,roomWorkspace,'Sound',{includes:['sound','set_room_music','set_room_ambience']});
await checkPalette(roomCode,roomWorkspace,'Tiles',{includes:['reporter_tile_touching','reporter_tile_touching_kind'],excludes:['set_tile_playback','entity_on_tile_top']});
await checkPalette(roomCode,roomWorkspace,'Motion',{includes:['move_entity','force_entity'],excludes:['move_by','velocity']});
await checkPalette(roomCode,roomWorkspace,'Combat',{includes:['damage_entity','heal_entity'],excludes:['damage','fire','fire_projectile']});
await roomCode.getByRole('button',{name:'Fit blocks',exact:true}).click();
const clipboardBlock=roomWorkspace.locator('.waffle_event_sender');
await clipboardBlock.click();
await authoring.keyboard.press('Control+c');
const copiedHint=roomWorkspace.locator('.blocklyToast[data-toast-id="copiedHint"]');
await copiedHint.waitFor({state:'attached'});
assert.equal(await copiedHint.isVisible(),false);
await authoring.keyboard.press('Control+v');
await until('Pasted block',async()=> await clipboardBlock.count()===2);
const zoomBlock=roomWorkspace.locator('.blocklyBlockCanvas .waffle_camera_zoom > .blocklyPath[role=figure]');
const shaderBlock=roomWorkspace.locator('.blocklyBlockCanvas .waffle_set_room_shader > .blocklyPath[role=figure]');
const drawTextBlock=roomWorkspace.locator('.waffle_received_event .waffle_draw_text > .blocklyPath[role=figure]');
const groupedBlocks=roomWorkspace.locator('.blocklyBlockCanvas .gw-block-selected');
// Locate the body of the block without clicking a field or a block on top of it.
async function clickBlock(path,modifiers=[]){
  const position=await path.evaluate(element=>{
    const rect=element.getBoundingClientRect();
    for(const row of [.5,.75,.3])for(const column of [.1,.8,.3,.6]){
      const x=rect.width*column,y=rect.height*row;
      const hit=document.elementFromPoint(rect.left+x,rect.top+y);
      if(hit?.closest('g[data-id]')===element.parentElement&&!hit.closest('.blocklyEditableField'))return {x,y};
    }
    return null;
  });
  assert.ok(position,'Block body is visible and clickable');
  await path.click({force:true,position,modifiers});
}
await authoring.getByRole('button',{name:'Fit blocks',exact:true}).click();
await clickBlock(zoomBlock);
await clickBlock(shaderBlock,['Control']);
await clickBlock(drawTextBlock,['Shift']);
await until('Modifier selection',async()=>await groupedBlocks.count()===3);
await clickBlock(drawTextBlock,['Control']);
await until('Toggle a block out of selection',async()=>await groupedBlocks.count()===2);
await clickBlock(drawTextBlock,['Shift']);
await until('Add a block back to selection',async()=>await groupedBlocks.count()===3);
await authoring.keyboard.press('Control+c');
await authoring.keyboard.press('Control+v');
const pastedStack=roomWorkspace.locator('.blocklyBlockCanvas .waffle_camera_zoom.gw-detached');
await pastedStack.locator('.waffle_set_room_shader').waitFor();
assert.equal(await pastedStack.locator('.waffle_emit_event').count(),0,'Unselected statements are left out');
const pastedDrawText=roomWorkspace.locator('.blocklyBlockCanvas .waffle_draw_text.gw-detached');
await pastedDrawText.waitFor();
await authoring.keyboard.press('Control+z');
await pastedStack.waitFor({state:'detached'});
assert.equal(await pastedDrawText.count(),0,'Undo removes the whole pasted group');
await scriptFile.selectOption('tile:water:0');
await until('Tile script picker',async()=>await scriptFile.inputValue()==='tile:water:0');
const tileCode=authoring.getByRole('region',{name:'Tile code'});
await checkPalette(tileCode,tileCode.locator('.block-workspace'),'Tiles',{includes:['reporter_tile_touching','entity_on_tile_top','set_tile_playback','set_tile_friction']});
await tileCode.getByRole('button',{name:'Fit blocks',exact:true}).click();
await clickBlock(authoring.locator('.blocklyBlockCanvas .waffle_init > .blocklyPath[role=figure]'));
await authoring.keyboard.press('Control+v');
await authoring.locator('.blocklyBlockCanvas .waffle_camera_zoom.gw-detached .waffle_set_room_shader').waitFor();
await authoring.locator('.blocklyBlockCanvas .waffle_draw_text.gw-detached').waitFor();
await authoring.keyboard.press('Escape');
assert.equal(await authoring.locator('.blocklyBlockCanvas .gw-block-selected').count(),0);
await authoring.getByRole('button',{name:'Text',exact:true}).click();
await authoring.locator('.cm-content').fill(`on init
  init_properties
    property mode = "fluid"
    property density = 2.5
    set_tile_playback("still")
  end
end
`);
await until('Tile playback saved',async()=>{
  const unit=await(await authoring.request.get(url+'/api/tile-script/water/0')).json();
  return unit.events?.init?.[0]?.body?.[2]?.mode==='still';
});
await authoring.getByRole('button',{name:'Blocks',exact:true}).click();
const propertyBlock=authoring.locator('.blocklyBlockCanvas .waffle_init > .waffle_init_properties');
await propertyBlock.getByText(/Init\s+tile\s+properties/).waitFor();
await propertyBlock.locator('.waffle_init_body').waitFor();
await propertyBlock.locator('.waffle_init_property').getByText('Density',{exact:true}).waitFor();
await authoring.getByRole('button',{name:'Text',exact:true}).click();
assert.match(await authoring.locator('.cm-content').innerText(),/property density = 2\.5/);
await scriptFile.selectOption('entity:maker');
await until('Entity script picker',async()=>await scriptFile.inputValue()==='entity:maker');
await authoring.getByRole('button',{name:'Text',exact:true}).click();
await authoring.locator('.cm-content').fill(`on a
  repeat 3
    if entity.grounded
      continue
    end
    clone_entity(entity.id)
    break
  end
  return
end
on clone
  delete_clone()
end
`);
await until('Clone script saved',async()=>{
  const unit=await(await authoring.request.get(url+'/api/script/maker')).json();
  return unit.events?.clone_start?.[0]?.op==='delete_clone';
});
await authoring.getByRole('button',{name:'Blocks',exact:true}).click();
for(const type of ['clone_start','clone_entity','delete_clone','return','break','continue'])
  await authoring.locator('.blocklyBlockCanvas .waffle_'+type).waitFor();
const entityCode=authoring.getByRole('region',{name:'Entity code'});
const entityWorkspace=entityCode.locator('.block-workspace');
const entityCategories=await entityWorkspace.locator('.blocklyToolboxCategoryLabel').allTextContents();
assert.ok(!entityCategories.includes('Legacy items'));
await checkPalette(entityCode,entityWorkspace,'Control',{includes:['return','break','continue']});
await checkPalette(entityCode,entityWorkspace,'Combat',{includes:['fire_projectile','damage','damage_entity'],excludes:['fire']});
for(const [category,type] of [['Control','if'],['Math & logic','arithmetic']]){
  const flyout=await openPalette(entityCode,entityWorkspace,category);
  assert.equal(await flyout.locator('.blocklyBlockCanvas > .waffle_'+type).count(),1);
}
await entityCode.getByRole('button',{name:'Fit blocks',exact:true}).click();
await authoring.getByRole('button',{name:'Text',exact:true}).click();
const cloneScript=await authoring.locator('.cm-content').innerText();
assert.match(cloneScript,/on clone\s+delete_clone\(\)/);
for(const keyword of ['return','break','continue'])assert.match(cloneScript,new RegExp('^ +'+keyword+'$','m'));
await authoring.locator('.cm-content').fill(`on tick
  if camera.touching_edge(entity.id, "left") and tile.touching(entity.id, "water", "any")
    local_string.note = string.letter(string.join("🪿", "ice"), 1)
    local.score = math.mod(-5, 3)
    local_real.scale = 2 + 0.5
  end
end
`);
await until('Sensing and operators saved from text',async()=>{
  const unit=await(await authoring.request.get(url+'/api/script/maker')).json();
  return unit.events?.tick?.[0]?.condition?.right?.call==='tile.touching';
});
await authoring.getByRole('button',{name:'Blocks',exact:true}).click();
const canvas=authoring.locator('.block-workspace:visible .blocklyBlockCanvas:not(.blocklyFlyout *)');
for(const type of ['camera_touching_edge','tile_touching','string_letter','string_join','math_mod'])
  await canvas.locator('.waffle_reporter_'+type).waitFor();
const tileContact=canvas.locator('.waffle_reporter_tile_touching');
await tileContact.locator('.waffle_self').getByText('This entity',{exact:true}).waitFor();
await tileContact.locator('.blocklyDropdownText').filter({hasText:/any\s+side/}).waitFor();
await authoring.getByRole('button',{name:'Fit blocks',exact:true}).click();
await canvas.locator('.waffle_arithmetic .waffle_integer .blocklyNumberField').click();
const inlineNumber=authoring.locator('.blocklyHtmlInput');
await inlineNumber.fill('2.75');
await inlineNumber.press('Enter');
await until('Inline real math operand saved',async()=>{
  const unit=await(await authoring.request.get(url+'/api/script/maker')).json();
  return unit.events?.tick?.[0]?.body?.find(row=>row.name==='scale')?.value.left.real===2.75;
});
await canvas.locator('.waffle_reporter_tile_touching .blocklyDropdownText').filter({hasText:/water/i}).click();
await authoring.getByLabel('Search options',{exact:true}).fill('water');
await authoring.locator('.block-field-options button').filter({hasText:/water/i}).click();
await canvas.locator('.waffle_reporter_camera_touching_edge .blocklyDropdownText').filter({hasText:/left/i}).click();
await authoring.getByRole('listbox').getByRole('option',{name:'right',exact:true}).click();
await until('Edge edited and saved from blocks',async()=>{
  const unit=await(await authoring.request.get(url+'/api/script/maker')).json();
  return unit.events?.tick?.[0]?.condition?.left?.args?.[1]==='right';
});
await authoring.getByRole('button',{name:'Text',exact:true}).click();
const roundTrip=await authoring.locator('.cm-content').innerText();
assert.match(roundTrip,/camera.touching_edge\(entity.id, "right"\)/);
assert.match(roundTrip,/tile.touching\(entity.id, "water", "any"\)/);
assert.match(roundTrip,/string.letter\(string.join\("🪿", "ice"\), 1\)/);
assert.match(roundTrip,/math.mod\(-5, 3\)/);
assert.match(roundTrip,/local_real.scale = \(2\.75 \+ 0\.5\)/);
const shadersTab=authoring.getByRole('navigation',{name:'Editor views'}).getByRole('button',{name:'Shaders',exact:true});
await shadersTab.click();
assert.equal(await shadersTab.getAttribute('aria-current'),'page');
await authoring.getByText('No project shaders yet.',{exact:true}).waitFor();
assert.equal(await authoring.getByLabel('Shader files',{exact:true}).getAttribute('accept'),'.spv,.spirv');
await authoring.getByRole('button',{name:'New shader…',exact:true}).click();
const templates=authoring.getByRole('region',{name:'Shader templates'});
await templates.getByRole('button',{name:'Heat shimmer',exact:true}).waitFor();
await templates.getByRole('button',{name:'Drifting mist',exact:true}).click();
const shaderEditor=authoring.getByRole('region',{name:'Shader editor'});
assert.equal(await shaderEditor.evaluate(element=>Boolean(element.closest('dialog'))),false);
await shaderEditor.getByRole('img',{name:'Live room preview'}).locator('canvas[data-view-width]').first().waitFor();
assert.equal(await shaderEditor.locator('form').count(),0);
const flow=shaderEditor.getByRole('region',{name:'Shader graph'});
await flow.locator('.svelte-flow').waitFor();
const output=flow.getByRole('button',{name:'Fragment output · Color input'});
const outputWire=flow.locator('.svelte-flow__edge[data-id="fragment-output:color"]');
await outputWire.waitFor();
await flow.locator('.svelte-flow__pane').click({button:'right',position:{x:12,y:12}});
const contextPicker=authoring.getByRole('dialog',{name:'Add shader node'});
await contextPicker.getByRole('button',{name:'Math',exact:true}).click();
await contextPicker.getByRole('button',{name:'Multiply',exact:true}).waitFor();
assert.equal(await contextPicker.getByRole('button',{name:'Sample screen',exact:true}).count(),0);
await contextPicker.getByRole('button',{name:'Cancel',exact:true}).click();
const previousWire=await outputWire.getAttribute('aria-label');
async function addShaderNode(kind){
  await shaderEditor.getByRole('button',{name:'Add shader node',exact:true}).click();
  const picker=authoring.getByRole('dialog',{name:'Add shader node'});
  await picker.getByRole('searchbox').fill(kind);
  const card=picker.getByRole('button',{name:kind,exact:true});
  assert.ok((await card.locator('span').innerText()).length>12);
  await card.click();
}
await addShaderNode('Number');
const numberNode=flow.getByRole('article',{name:/^Number \d+$/}).last();
await numberNode.getByRole('button',{name:/result$/}).press('Enter');
await output.press('Enter');
assert.equal(await outputWire.getAttribute('aria-label'),previousWire,'A number cannot feed the fragment color');
await addShaderNode('Color');
const colorNode=flow.getByRole('article',{name:/^Color \d+$/});
const resultPort=colorNode.getByRole('button',{name:/result$/});
await flow.getByRole('button',{name:'Fit View',exact:true}).click();
async function drag(from,to){
  const start=await from.boundingBox(),destination=await to.boundingBox();
  assert.ok(start&&destination,'Both shader ports are visible for dragging');
  await authoring.mouse.move(start.x+start.width/2,start.y+start.height/2);
  await authoring.mouse.down();
  await authoring.mouse.move(destination.x+destination.width/2,destination.y+destination.height/2,{steps:12});
  await authoring.mouse.up();
}
await drag(resultPort,output);
await until('Drag a color wire to fragment output',async()=>await outputWire.getAttribute('aria-label')!==previousWire);
const newWire=await outputWire.getAttribute('aria-label');
await shaderEditor.getByRole('button',{name:'Undo graph edit'}).click();
assert.equal(await outputWire.getAttribute('aria-label'),previousWire);
await shaderEditor.getByRole('button',{name:'Redo graph edit'}).click();
assert.equal(await outputWire.getAttribute('aria-label'),newWire);
const colorHeader=colorNode.locator('.shader-node-title');
const readPosition=()=>colorNode.evaluate(element=>{
  const position=new DOMMatrixReadOnly(element.closest('.svelte-flow__node').style.transform);
  return [position.e,position.f];
});
const originalPosition=await readPosition();
const beforeMove=await colorHeader.boundingBox();
await authoring.mouse.move(beforeMove.x+15,beforeMove.y+6);
await authoring.mouse.down();
await authoring.mouse.move(beforeMove.x+34,beforeMove.y+46,{steps:8});
await authoring.mouse.up();
assert.ok((await colorHeader.boundingBox()).y>beforeMove.y+20,'Shader nodes can be repositioned on the canvas');
const moved=await readPosition();
await shaderEditor.getByRole('button',{name:'Undo graph edit'}).click();
assert.deepEqual(await readPosition(),originalPosition);
await shaderEditor.getByRole('button',{name:'Redo graph edit'}).click();
assert.deepEqual(await readPosition(),moved);
await colorHeader.click();
await until('Select the moved color node',async()=>await colorNode.evaluate(node=>node.classList.contains('selected')));
await shaderEditor.getByRole('button',{name:'Duplicate selected nodes'}).click();
await until('Duplicate the color node',async()=>await flow.getByRole('article',{name:/^Color \d+$/}).count()===2);
await shaderEditor.getByRole('button',{name:'Delete selection'}).click();
await until('Delete the copied node',async()=>await flow.getByRole('article',{name:/^Color \d+$/}).count()===1);
await shaderEditor.getByRole('button',{name:'Save shader',exact:true}).click();

await until('Shader asset saved',async()=>{
  const unit=await(await authoring.request.get(url+'/api/project')).json();
  const graph=unit.project?.shaders?.drifting_mist?.graph;
  return graph?.nodes.some(node=>node.kind==='color'&&node.id===graph.output)&&
    graph.layout?.[graph.output]?.every((value,index)=>Math.abs(value-moved[index])<.05);
});
await shaderEditor.getByRole('region',{name:'Shader graph'}).getByRole('article',{name:/^Color \d+$/}).waitFor();
assert.equal(await shaderEditor.getByRole('button',{name:'Save shader',exact:true}).isDisabled(),true);
await shaderEditor.getByLabel('Shader name').fill('Purple mist');
await authoring.getByRole('navigation',{name:'Editor views'}).getByRole('button',{name:'Assets',exact:true}).click();
await shadersTab.click();
assert.equal(await shaderEditor.getByLabel('Shader name').inputValue(),'Purple mist','Switching tabs preserves the inline draft');
await shaderEditor.getByRole('button',{name:'Save shader',exact:true}).click();
await until('Shader edit keeps the original asset ID',async()=>{
  const unit=await(await authoring.request.get(url+'/api/project')).json();
  return unit.project?.shaders?.drifting_mist?.title==='Purple mist'&&Object.keys(unit.project.shaders).length===1;
});
await authoring.getByLabel('Shader files',{exact:true}).setInputFiles(path.resolve('src/shaders/presets.spv'));
const shaderImport=authoring.getByRole('dialog',{name:'Load shader'});
await shaderImport.getByLabel('Name',{exact:true}).fill('Imported scanlines');
await shaderImport.getByRole('button',{name:'Load shader',exact:true}).click();
await shaderImport.waitFor({state:'hidden'});
await authoring.getByRole('button',{name:/^Imported scanlines/}).waitFor();
await authoring.getByLabel('Search shaders').fill('Purple');
assert.equal(await authoring.getByRole('button',{name:/^Imported scanlines/}).count(),0);
await authoring.setViewportSize({width:390,height:760});
await authoring.getByRole('button',{name:/^Purple mist/}).click();
await shaderEditor.getByRole('region',{name:'Shader graph'}).waitFor();
assert.ok(await shaderEditor.evaluate(workspace=>workspace.scrollWidth<=workspace.clientWidth+1),'The inline shader workspace fits a narrow screen');
await shaderEditor.getByRole('button',{name:'Add shader node',exact:true}).click();
const mobilePicker=authoring.getByRole('dialog',{name:'Add shader node'});
assert.ok(await mobilePicker.evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth+1),'Node cards fit a narrow screen');
await mobilePicker.getByRole('button',{name:'Cancel',exact:true}).click();
await authoring.setViewportSize({width:1280,height:800});
await authoring.getByRole('button',{name:'Code',exact:true}).click();
await scriptFile.selectOption('room:vault');
await until('Room target for gradient script',async()=>await scriptFile.inputValue()==='room:vault');
await authoring.getByRole('button',{name:'Text',exact:true}).click();
await authoring.locator('.cm-content').fill(`on init
  set_background_gradient("radial", "smooth")
  set_gradient_focus(1, 0.2, 0.4, 0.5, "#cba6f7")
  set_gradient_focus(2, 0.8, 0.7, 0.5, "#f9e2af")
  apply_shaders
    shader("drifting_mist")
  end
end
`);
await until('Background gradient and authored shader saved to room',async()=>{
  const unit=await(await authoring.request.get(url+'/api/room-script/vault')).json();
  return unit.events?.init?.[3]?.passes?.[0]?.shader==='drifting_mist';
});
await authoring.getByRole('button',{name:'Blocks',exact:true}).click();
await canvas.locator('.waffle_set_background_gradient').waitFor();
assert.equal(await canvas.locator('.waffle_set_gradient_focus').count(),2);
await authoring.close();
console.log('Passed authoring, Blocks/Text round trips, shader node canvas and wiring, Shaders tab imports, and room gradient scripts');

await browser.close();server.kill();await fs.rm(fixture,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exit(1);});
