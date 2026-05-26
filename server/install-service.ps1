# ============================================================
# Kinetix POS Sync Server — Windows Service Installer
# Run as Administrator in PowerShell
# ============================================================
# Requirements:
#   - Node.js 20+ installed (https://nodejs.org)
#   - NSSM installed (https://nssm.cc) and on PATH
#     or place nssm.exe in the same directory as this script
# ============================================================

param(
  [string]$ServiceName  = "KinetixPOSServer",
  [string]$DisplayName  = "Kinetix POS Sync Server",
  [string]$Port         = "3030",
  [string]$ApiKey       = "",
  [string]$DbPath       = "C:\KinetixPOS\data"
)

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerDir  = $ScriptDir
$NodeExe    = (Get-Command node -ErrorAction SilentlyContinue)?.Source
$NssmExe    = (Get-Command nssm -ErrorAction SilentlyContinue)?.Source ?? "$ScriptDir\nssm.exe"

# ── Preflight checks ────────────────────────────────────────────────────────
if (-not $NodeExe) {
  Write-Error "Node.js not found. Install from https://nodejs.org and re-run."
  exit 1
}
if (-not (Test-Path $NssmExe)) {
  Write-Error "nssm.exe not found. Download from https://nssm.cc and place it in $ScriptDir."
  exit 1
}
if (-not (Test-Path "$ServerDir\dist\index.js")) {
  Write-Host "Building server..." -ForegroundColor Cyan
  Push-Location $ServerDir
  npm install
  npm run build
  Pop-Location
}

# ── Create data directory ────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $DbPath | Out-Null
Write-Host "Database directory: $DbPath" -ForegroundColor Cyan

# ── Install / update service ─────────────────────────────────────────────────
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Stopping existing service..." -ForegroundColor Yellow
  & $NssmExe stop $ServiceName confirm
  & $NssmExe remove $ServiceName confirm
}

Write-Host "Installing Windows Service '$ServiceName'..." -ForegroundColor Cyan
& $NssmExe install $ServiceName $NodeExe "$ServerDir\dist\index.js"
& $NssmExe set $ServiceName DisplayName  $DisplayName
& $NssmExe set $ServiceName Description  "Kinetix POS multi-terminal sync server"
& $NssmExe set $ServiceName AppDirectory $ServerDir
& $NssmExe set $ServiceName Start        SERVICE_AUTO_START

# Environment variables
$env  = "PORT=$Port"
$env += "`nDB_PATH=$DbPath"
if ($ApiKey) { $env += "`nSYNC_API_KEY=$ApiKey" }
& $NssmExe set $ServiceName AppEnvironmentExtra $env

# Stdout / stderr logs
$LogDir = "$DbPath\logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
& $NssmExe set $ServiceName AppStdout "$LogDir\server.log"
& $NssmExe set $ServiceName AppStderr "$LogDir\server-error.log"
& $NssmExe set $ServiceName AppRotateFiles 1

# ── Start the service ────────────────────────────────────────────────────────
Write-Host "Starting service..." -ForegroundColor Cyan
& $NssmExe start $ServiceName

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc?.Status -eq 'Running') {
  Write-Host ""
  Write-Host "✅  Kinetix POS Sync Server is running on port $Port" -ForegroundColor Green
  Write-Host "    Point terminals to: http://<this-server-ip>:$Port" -ForegroundColor Green
  if ($ApiKey) {
    Write-Host "    API Key configured. Enter it in Settings → Sync Server on each terminal." -ForegroundColor Green
  } else {
    Write-Host "    ⚠️  No API key set. Re-run with -ApiKey <secret> for production use." -ForegroundColor Yellow
  }
} else {
  Write-Error "Service failed to start. Check logs at $LogDir"
}
