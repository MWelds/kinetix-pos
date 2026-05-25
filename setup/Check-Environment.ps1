#Requires -Version 5.1
<#
.SYNOPSIS
    Checks whether all prerequisites are installed without installing anything.
    Safe to run as a regular user (no elevation needed).
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'SilentlyContinue'

function Write-Check {
    param($label, $value, $ok)
    $status = if ($ok) { "✓" } else { "✗" }
    $color  = if ($ok) { "Green" } else { "Red" }
    Write-Host ("  {0,-8} {1,-28} {2}" -f $status, $label, $value) -ForegroundColor $color
}

Write-Host ""
Write-Host "  POS System — Environment Check" -ForegroundColor Cyan
Write-Host "  ─────────────────────────────────────────"

# Node.js
$node = & node --version 2>$null
$nodeOk = $node -match 'v(\d+)\.' -and [int]$Matches[1] -ge 18
Write-Check "Node.js" ($node ?? "NOT FOUND") $nodeOk

# npm
$npm = & npm --version 2>$null
Write-Check "npm"     ($npm ? "v$npm" : "NOT FOUND") ($null -ne $npm)

# Git (optional but useful)
$git = & git --version 2>$null
Write-Check "Git"     ($git ?? "not found (optional)") $true

# C++ compiler (cl.exe or vswhere)
$cl = Get-Command cl.exe -ErrorAction SilentlyContinue
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasVS = $false
if (Test-Path $vswhere) {
    $vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 2>$null
    $hasVS = $vs -ne $null
}
$cppOk = ($cl -ne $null) -or $hasVS
Write-Check "C++ Tools" $(if ($cppOk) { "Visual Studio Build Tools found" } else { "NOT FOUND — run setup.bat" }) $cppOk

# node_modules
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$nmExists = Test-Path (Join-Path $ProjectRoot 'node_modules')
Write-Check "node_modules" $(if ($nmExists) { "installed" } else { "run npm install" }) $nmExists

# better-sqlite3 (native module)
$sqlite3Path = Join-Path $ProjectRoot 'node_modules\better-sqlite3\build\Release\better_sqlite3.node'
$sqliteBuilt = Test-Path $sqlite3Path
Write-Check "better-sqlite3" $(if ($sqliteBuilt) { "built for Electron" } else { "run npm run rebuild" }) $sqliteBuilt

Write-Host "  ─────────────────────────────────────────"

if ($nodeOk -and $cppOk -and $nmExists -and $sqliteBuilt) {
    Write-Host "  ✓ All checks passed — run: npm run dev" -ForegroundColor Green
}
else {
    Write-Host "  ✗ Issues found — run setup\setup.bat to fix" -ForegroundColor Yellow
}
Write-Host ""
