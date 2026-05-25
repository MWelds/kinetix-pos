#Requires -Version 5.1
<#
.SYNOPSIS
    Installs all prerequisites needed to build and run the POS System.

.DESCRIPTION
    This script installs the following if not already present:
      - Node.js LTS (via winget, then fallback to direct download)
      - Visual Studio Build Tools 2022 (required to compile better-sqlite3)
      - npm dependencies  (npm install)
      - Native module rebuild (npm run rebuild)

    Run from an elevated (Administrator) PowerShell prompt, or the script
    will auto-elevate itself.

.EXAMPLE
    # From a normal PowerShell window:
    .\setup\Install-Prerequisites.ps1

    # Skip the rebuild step (if Electron is not yet installed):
    .\setup\Install-Prerequisites.ps1 -SkipRebuild
#>
param(
    [switch]$SkipRebuild,
    [switch]$NoPrompt
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Colour helpers ────────────────────────────────────────────────────────────
function Write-Step  { param($msg) Write-Host "`n▶  $msg" -ForegroundColor Cyan }
function Write-OK    { param($msg) Write-Host "  ✓  $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "  ⚠  $msg" -ForegroundColor Yellow }
function Write-Fail  { param($msg) Write-Host "  ✗  $msg" -ForegroundColor Red; exit 1 }

# ── Self-elevate if not already admin ─────────────────────────────────────────
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Warn "Not running as Administrator — re-launching elevated..."
    $args_ = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    if ($SkipRebuild) { $args_ += " -SkipRebuild" }
    if ($NoPrompt)    { $args_ += " -NoPrompt" }
    Start-Process powershell $args_ -Verb RunAs -Wait
    exit
}

# ── Banner ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔═══════════════════════════════════════╗" -ForegroundColor Blue
Write-Host "  ║      POS System — Prerequisite Setup  ║" -ForegroundColor Blue
Write-Host "  ╚═══════════════════════════════════════╝" -ForegroundColor Blue

# Resolve project root (parent of this script's directory)
$ProjectRoot = Split-Path $PSScriptRoot -Parent
Write-Host "  Project root: $ProjectRoot`n"

# ── 1. Node.js ────────────────────────────────────────────────────────────────
Write-Step "Checking Node.js..."

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $nodeVer = & node --version
    Write-OK "Node.js already installed: $nodeVer"

    # Warn if version is too old (need 18+)
    $major = [int]($nodeVer -replace 'v(\d+)\..*','$1')
    if ($major -lt 18) {
        Write-Warn "Node.js $nodeVer is too old. Minimum required: v18. Upgrading..."
        $nodeCmd = $null   # fall through to install
    }
}

if (-not $nodeCmd) {
    Write-Step "Installing Node.js LTS..."

    # Try winget first (available on Windows 10 1809+ and Windows 11)
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Host "  Using winget..."
        winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                    [System.Environment]::GetEnvironmentVariable('Path','User')
    }
    else {
        Write-Warn "winget not found — downloading Node.js installer directly..."
        $nodeUrl  = 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi'
        $nodeMsi  = "$env:TEMP\node-lts.msi"
        Write-Host "  Downloading from $nodeUrl ..."
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeMsi -UseBasicParsing
        Write-Host "  Installing (this may take a minute)..."
        Start-Process msiexec.exe -Wait -ArgumentList "/i `"$nodeMsi`" /quiet /norestart"
        Remove-Item $nodeMsi -Force -ErrorAction SilentlyContinue
        $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                    [System.Environment]::GetEnvironmentVariable('Path','User')
    }

    $nodeVer = & node --version 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Fail "Node.js installation failed. Please install manually: https://nodejs.org" }
    Write-OK "Node.js installed: $nodeVer"
}

# ── 2. npm ────────────────────────────────────────────────────────────────────
Write-Step "Checking npm..."
$npmVer = & npm --version
Write-OK "npm: v$npmVer"

# ── 3. Visual Studio Build Tools (for native modules like better-sqlite3) ─────
Write-Step "Checking Visual Studio Build Tools (C++ compiler)..."

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasBuildTools = $false

if (Test-Path $vswhere) {
    $vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json 2>$null | ConvertFrom-Json
    if ($vs) { $hasBuildTools = $true }
}

# Also check for windows-build-tools npm package workaround
$nodeGypOk = (Get-Command cl.exe -ErrorAction SilentlyContinue) -ne $null

if ($hasBuildTools -or $nodeGypOk) {
    Write-OK "C++ build tools found"
}
else {
    Write-Step "Installing Visual Studio 2022 Build Tools..."
    Write-Warn "This download is ~1.5 GB and may take several minutes."
    if (-not $NoPrompt) {
        $confirm = Read-Host "  Continue? [Y/n]"
        if ($confirm -match '^[Nn]') {
            Write-Warn "Skipping Build Tools. The app may fail to compile better-sqlite3."
            Write-Warn "Install manually: https://visualstudio.microsoft.com/visual-cpp-build-tools/"
        }
        else { $NoPrompt = $false }
    }

    if ($NoPrompt -or $confirm -notmatch '^[Nn]') {
        $vsUrl  = 'https://aka.ms/vs/17/release/vs_BuildTools.exe'
        $vsExe  = "$env:TEMP\vs_BuildTools.exe"
        Write-Host "  Downloading Visual Studio Build Tools installer..."
        Invoke-WebRequest -Uri $vsUrl -OutFile $vsExe -UseBasicParsing

        Write-Host "  Installing workloads: Desktop C++ + Node.js native..."
        $vsArgs = @(
            '--quiet', '--wait', '--norestart',
            '--add', 'Microsoft.VisualStudio.Workload.VCTools',
            '--add', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
            '--add', 'Microsoft.VisualStudio.Component.Windows11SDK.22000',
            '--includeRecommended'
        )
        Start-Process $vsExe -Wait -ArgumentList $vsArgs
        Remove-Item $vsExe -Force -ErrorAction SilentlyContinue
        Write-OK "Visual Studio Build Tools installed"
    }
}

# ── 4. npm install ─────────────────────────────────────────────────────────────
Write-Step "Installing npm dependencies..."
Set-Location $ProjectRoot

if (-not (Test-Path (Join-Path $ProjectRoot 'node_modules'))) {
    & npm install --legacy-peer-deps
    if ($LASTEXITCODE -ne 0) { Write-Fail "npm install failed." }
    Write-OK "Dependencies installed"
}
else {
    Write-OK "node_modules already exists — running npm install to sync..."
    & npm install --legacy-peer-deps
}

# ── 5. Rebuild native modules ──────────────────────────────────────────────────
if (-not $SkipRebuild) {
    Write-Step "Rebuilding native modules for Electron (better-sqlite3)..."
    & npm run rebuild
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "Rebuild failed. Try running: npm run rebuild"
        Write-Warn "If it keeps failing, ensure VS Build Tools are installed."
    }
    else {
        Write-OK "Native modules rebuilt successfully"
    }
}

# ── Done ───────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔═══════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║   Setup complete! Run: npm run dev    ║" -ForegroundColor Green
Write-Host "  ╚═══════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
