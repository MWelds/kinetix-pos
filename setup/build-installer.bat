@echo off
setlocal
title POS System - Build Installer

echo.
echo  ==========================================
echo   POS System - Build Windows Installer
echo  ==========================================
echo.
echo  This will:
echo    1. Type-check TypeScript
echo    2. Build the app (electron-vite)
echo    3. Package into a .exe installer
echo.
echo  Output: dist\POS System-x.x.x-Setup.exe
echo.

set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Build-Installer.ps1" %*

if %ERRORLEVEL% neq 0 (
    echo.
    echo  Build failed. See output above.
    pause
    exit /b 1
)
pause
