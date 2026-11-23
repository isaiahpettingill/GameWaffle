Unicode true
RequestExecutionLevel user
Name "GameWaffle"
OutFile "..\GameWaffle-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\GameWaffle"
Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles
Section
  SetOutPath "$INSTDIR"
  File /r "..\stage\*"
  CreateDirectory "$SMPROGRAMS\GameWaffle"
  CreateShortcut "$SMPROGRAMS\GameWaffle\Studio.lnk" "$INSTDIR\node.exe" '"$INSTDIR\packaging\studio.mjs"'
  CreateShortcut "$SMPROGRAMS\GameWaffle\Player.lnk" "$INSTDIR\gamewaffle-player.exe"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd
Section "Uninstall"
  RMDir /r "$SMPROGRAMS\GameWaffle"
  Delete "$INSTDIR\node.exe"
  Delete "$INSTDIR\gamewaffle-player.exe"
  Delete "$INSTDIR\package.json"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR\src"
  RMDir /r "$INSTDIR\demo"
  RMDir /r "$INSTDIR\packaging"
  RMDir /r "$INSTDIR\web-built"
  RMDir /r "$INSTDIR\node_modules"
  RMDir /r "$INSTDIR\runtime"
  RMDir "$INSTDIR"
SectionEnd
