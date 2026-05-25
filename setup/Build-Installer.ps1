#Requires -Version 5.1
<#
.SYNOPSIS
    Builds the POS System Windows installer (.exe) using electron-builder.

.DESCRIPTION
    Runs the full build pipeline:
      1. TypeScript type-check
      2. electron-vite build (compiles everything to ./out/)
      3. electron-builder --win (packages into ./dist/)

    Output:
      dist/POS System-<version>-Setup.exe   — NSIS installer
      dist/POS System-<version>-Portable.exe — standalone portable exe

.EXAMPLE
    .\setup\Build-Installer.ps1

    # Skip type-check for a faster build:
    .\setup\Build-Installer.ps1 -SkipTypecheck
#>
param(
    [switch]$SkipTypecheck,
    [switch]$PortableOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step { param($n, $msg) Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Write-OK   { param($msg) Write-Host "  ✓  $msg" -ForegroundColor Green }
function Write-Fail { param($msg) Write-Host "  ✗  $msg" -ForegroundColor Red; exit 1 }

$ProjectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $ProjectRoot

Write-Host ""
Write-Host "  POS System — Windows Installer Build" -ForegroundColor Blue
Write-Host "  ─────────────────────────────────────"
Write-Host "  Project: $ProjectRoot"

# ── Check prerequisites ───────────────────────────────────────────────────────
Write-Step "0" "Checking prerequisites..."

$node = & node --version 2>$null
if (-not $node) { Write-Fail "Node.js not found. Run setup\setup.bat first." }
Write-OK "Node.js: $node"

if (-not (Test-Path (Join-Path $ProjectRoot 'node_modules'))) {
    Write-Fail "node_modules not found. Run: npm install --legacy-peer-deps"
}
Write-OK "node_modules found"

$ebPath = Join-Path $ProjectRoot 'node_modules\.bin\electron-builder.cmd'
if (-not (Test-Path $ebPath)) {
    Write-Fail "electron-builder not found. Run: npm install --legacy-peer-deps"
}
Write-OK "electron-builder found"

# ── TypeScript type-check ─────────────────────────────────────────────────────
if (-not $SkipTypecheck) {
    Write-Step "1" "Type-checking TypeScript..."
    & npm run typecheck
    if ($LASTEXITCODE -ne 0) { Write-Fail "Type errors found. Fix them before building." }
    Write-OK "No type errors"
}
else {
    Write-Step "1" "Type-check skipped (-SkipTypecheck)"
}

# ── Build with electron-vite ──────────────────────────────────────────────────
Write-Step "2" "Building with electron-vite..."
$env:NODE_ENV = 'production'
& npm run build
if ($LASTEXITCODE -ne 0) { Write-Fail "Build failed." }
Write-OK "Build complete (./out/)"

# ── Package with electron-builder ─────────────────────────────────────────────
$target = if ($PortableOnly) { "--win portable" } else { "--win" }
Write-Step "3" "Packaging installer ($target)..."
& npx electron-builder $target.Split()
if ($LASTEXITCODE -ne 0) { Write-Fail "Packaging failed." }

# ── Report output ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║  Build complete!                                     ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Output files:" -ForegroundColor Cyan

$distDir = Join-Path $ProjectRoot 'dist'
Get-ChildItem $distDir -Filter "*.exe" | ForEach-Object {
    $size = [math]::Round($_.Length / 1MB, 1)
    Write-Host "    $($_.Name)  ($size MB)" -ForegroundColor White
}
Write-Host ""
Write-Host "  Distribute the -Setup.exe to end users." -ForegroundColor Gray
Write-Host "  The -Portable.exe runs without installation." -ForegroundColor Gray
Write-Host ""
