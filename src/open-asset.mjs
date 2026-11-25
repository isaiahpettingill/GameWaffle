import {spawn} from 'node:child_process';

export function openAsset(file) {
  const windows=process.platform==='win32';
  const opener=windows?'powershell.exe':process.platform==='darwin'?'/usr/bin/open':
    process.env.TERMUX_VERSION||process.platform==='android'?'termux-open':'xdg-open';
  const args=windows?['-NoProfile','-NonInteractive','-Command',
    'Start-Process -FilePath $env:GAMEWAFFLE_ASSET_TO_OPEN -ErrorAction Stop']:[file];
  return new Promise((ready,fail)=>{
    const child=spawn(opener,args,{detached:true,stdio:'ignore',windowsHide:true,
      env:windows?{...process.env,GAMEWAFFLE_ASSET_TO_OPEN:file}:process.env});
    // Some desktop launchers stay alive for the duration of the editor session.
    let timer;
    const failed=()=>{
      clearTimeout(timer);
      fail(Error('Could not open the file. Set a default app for this file type in your system settings.'));
    };
    child.once('spawn',()=>{
      if(opener==='xdg-open')timer=setTimeout(ready,750);
      child.unref();
    });
    child.once('error',failed);
    child.once('exit',code=>{
      clearTimeout(timer);
      if(code===0)ready();else failed();
    });
  });
}
