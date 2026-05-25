@echo off
setlocal

:: ============================================================
::  POS System - Developer Setup
::  Double-click this file to install all prerequisites.
:: ============================================================

title POS System - Setup

echo.
echo  ==========================================
echo   POS System - Developer Prerequisites
echo  ==========================================
echo.
echo  This will install:
echo    - Node.js LTS (if not installed)
echo    - Visual Studio Build Tools (C++ compiler)
echo    - npm dependencies
echo    - Native module rebuild for Electron
echo.
echo  An internet connection is required.
echo  The VS Build Tools download is ~1.5 GB.
echo.
pause

:: Run the PowerShell script from this file's directory
set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%Install-Prerequisites.ps1"

:: Check if PowerShell is available
where powershell >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: PowerShell not found. Please install PowerShell 5.1+
    pause
    exit /b 1
)

:: Launch PowerShell script (it self-elevates if needed)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%"

if %ERRORLEVEL% neq 0 (
    echo.
    echo  Setup encountered an error. See output above.
    pause
    exit /b 1
)

echo.
echo  Setup complete!
echo  You can now run:  npm run dev
echo.
pause
