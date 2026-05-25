; Custom NSIS installer script — included by electron-builder
; Adds a welcome message and a license page note.

!macro customHeader
  !system "echo '' > /dev/null"
!macroend

!macro customInit
  ; Check Windows version — require Windows 10 or later
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
  IntCmp $0 17763 win10ok win10old win10ok
  win10old:
    MessageBox MB_OK|MB_ICONEXCLAMATION \
      "POS System requires Windows 10 (build 17763) or later.$\n$\nPlease upgrade your operating system and try again."
    Abort
  win10ok:
!macroend

!macro customInstall
  ; Write a registry key for Add/Remove Programs extra info
  WriteRegStr HKCU "Software\POSSystem" "InstallPath" "$INSTDIR"
  WriteRegStr HKCU "Software\POSSystem" "Version"     "${VERSION}"
!macroend

!macro customUnInstall
  ; Clean up registry key on uninstall
  DeleteRegKey HKCU "Software\POSSystem"
!macroend
