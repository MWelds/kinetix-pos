# clock-skew-patch.ps1 — Apply 3-patch fix for commit 3b8c430
# Run on VM 201 (satellite terminal) to patch app.asar.unpacked override

# Find app.asar
$candidates = @(
    "$env:LOCALAPPDATA\Programs\Kinetix POS\resources\app.asar",
    "$env:LOCALAPPDATA\Kinetix POS\resources\app.asar"
)
$asarPath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $asarPath) { Write-Error "Cannot find app.asar in either candidate path"; exit 1 }
$appDir = Split-Path (Split-Path $asarPath)
Write-Host "Found asar: $asarPath"

# Extract index.js from asar using binary parsing
# Format: [4b sizePickle payload=4][4b headerPickle size][4b headerPickle payload size][4b JSON length][JSON...][file data]
$bytes = [System.IO.File]::ReadAllBytes($asarPath)
$headerSectionSize = [System.BitConverter]::ToUInt32($bytes, 4)
$jsonLength = [System.BitConverter]::ToUInt32($bytes, 12)
$headerJson = [System.Text.Encoding]::UTF8.GetString($bytes, 16, $jsonLength)
$hdr = $headerJson | ConvertFrom-Json
$fi = $hdr.files.out.files.main.files.'index.js'
if (-not $fi) { Write-Error "index.js not found in asar header"; exit 1 }
$offset = [long]$fi.offset
$size = [long]$fi.size
$dataStart = 8 + $headerSectionSize
$content = [System.Text.Encoding]::UTF8.GetString($bytes, ($dataStart + $offset), $size)
Write-Host "Extracted index.js: $size bytes, offset $offset"

# Patch 1: prefer lastPullServerTime over lastSyncAt as sync watermark
$p1old = 'const since = settingsService\.get\("lastSyncAt"\) \|\| "1970-01-01T00:00:00\.000Z";'
$p1new = 'const since = settingsService.get("lastPullServerTime") || settingsService.get("lastSyncAt") || "1970-01-01T00:00:00.000Z";'
$new = $content -replace $p1old, $p1new
if ($new -eq $content) { Write-Warning "Patch 1: NO MATCH - check regex" } else { Write-Host "Patch 1: APPLIED" }
$content = $new

# Patch 2: return json.serverTime from pullChanges
$p2old = 'applyBaselineSettings\(json\.baselineSettings\);\s+\}\s+\}'
$p2new = "applyBaselineSettings(json.baselineSettings);`n  }`n  return json.serverTime;`n}"
$new = $content -replace $p2old, $p2new
if ($new -eq $content) { Write-Warning "Patch 2: NO MATCH - check regex" } else { Write-Host "Patch 2: APPLIED" }
$content = $new

# Patch 3: capture serverTime returned from pullChanges and persist it
$p3old = 'await pullChanges\(serverUrl, apiKey, terminalId\);'
$p3new = 'const serverTime = await pullChanges(serverUrl, apiKey, terminalId);if (serverTime) settingsService.set("lastPullServerTime", serverTime);'
$new = $content -replace $p3old, $p3new
if ($new -eq $content) { Write-Warning "Patch 3: NO MATCH - check regex" } else { Write-Host "Patch 3: APPLIED" }
$content = $new

# Write patched override file
$outDir = "$appDir\resources\app.asar.unpacked\out\main"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outPath = "$outDir\index.js"
[System.IO.File]::WriteAllText($outPath, $content, [System.Text.Encoding]::UTF8)
$written = (Get-Item $outPath).Length
Write-Host "Written: $outPath ($written bytes)"

# Verify patch was written correctly
$verify = Get-Content $outPath -Raw
$ok1 = $verify -match 'lastPullServerTime'
$ok3 = $verify -match 'const serverTime = await pullChanges'
Write-Host "Verify patch1(lastPullServerTime): $ok1"
Write-Host "Verify patch3(serverTime capture): $ok3"

# Restart Kinetix POS
Write-Host "Stopping Kinetix POS..."
Get-Process | Where-Object { $_.Name -like "*Kinetix*" -or $_.MainWindowTitle -like "*Kinetix*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
$exe = Get-ChildItem $appDir -Filter "*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($exe) {
    Start-Process $exe.FullName
    Write-Host "Restarted: $($exe.FullName)"
} else {
    Write-Warning "Could not find .exe in $appDir to restart"
}
Write-Host "DONE. Wait 60-90s for first sync cycle."
