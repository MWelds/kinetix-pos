# Kinetix POS — One-click Git Setup & First Push

$ProjectDir = "C:\Claude Projects\POS\POS"
$RepoUrl = "https://github.com/MWelds/kinetix-pos.git"

Write-Host ""
Write-Host "=== Kinetix POS — Git Setup ===" -ForegroundColor Cyan
Write-Host ""

Set-Location $ProjectDir
Write-Host "Working in: $ProjectDir" -ForegroundColor Gray
Write-Host ""

# 1. Remove any old broken .git and init fresh with main branch
Write-Host "1. Initializing git repository..." -ForegroundColor Yellow
if (Test-Path ".git") { Remove-Item -Recurse -Force ".git" }
& git init -b main
& git config user.email "mavwelds@gmail.com"
& git config user.name "Mavrick Welds"
Write-Host "   Done." -ForegroundColor Green

# 2. Stage all files
Write-Host "2. Staging all files..." -ForegroundColor Yellow
& git add .
Write-Host "   Done." -ForegroundColor Green

# 3. Commit
Write-Host "3. Creating initial commit..." -ForegroundColor Yellow
& git commit -m "Initial release v1.0.0"
Write-Host "   Done." -ForegroundColor Green

# 4. Add remote
Write-Host "4. Adding GitHub remote..." -ForegroundColor Yellow
& git remote add origin $RepoUrl
Write-Host "   Done." -ForegroundColor Green

# 5. Push
Write-Host "5. Pushing to GitHub (a browser login may open)..." -ForegroundColor Yellow
& git push -u origin main
Write-Host "   Done." -ForegroundColor Green

# 6. Tag v1.0.0 to trigger GitHub Actions build
Write-Host "6. Tagging v1.0.0 to trigger release build..." -ForegroundColor Yellow
& git tag v1.0.0
& git push origin v1.0.0
Write-Host "   Done." -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " All done! Installer building now." -ForegroundColor Green
Write-Host " Ready in ~5-10 min at:" -ForegroundColor Green
Write-Host " https://github.com/MWelds/kinetix-pos/releases" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Future updates:" -ForegroundColor White
Write-Host "  npm version patch" -ForegroundColor Gray
Write-Host "  git push && git push --tags" -ForegroundColor Gray
Write-Host ""
Read-Host "Press Enter to close"
