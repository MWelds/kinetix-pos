# Kinetix POS — Push an update
# Run this any time you want to release a bug fix or update.

$ProjectDir = "C:\Claude Projects\POS\POS"
Set-Location $ProjectDir

Write-Host ""
Write-Host "=== Pushing update ===" -ForegroundColor Cyan

# Stage all changes
& git add .

# Show what's changed
Write-Host "Changed files:" -ForegroundColor Yellow
& git status --short

# Bump patch version (1.0.0 -> 1.0.1 -> 1.0.2 etc) and commit
& npm version patch --no-git-tag-version
$version = (Get-Content package.json | ConvertFrom-Json).version
& git add package.json
& git commit -m "Release v$version"

# Push code + tag (triggers GitHub Actions build)
& git tag "v$version"
& git push
& git push origin "v$version"

Write-Host ""
Write-Host "Done! v$version is building at:" -ForegroundColor Green
Write-Host "https://github.com/MWelds/kinetix-pos/actions" -ForegroundColor Cyan
Write-Host ""
Read-Host "Press Enter to close"
