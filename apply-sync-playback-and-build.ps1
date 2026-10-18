param(
    [string]$Repo = "D:\Lumenfix\Lumen-Fixed"
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Test-Path (Join-Path $Repo "package.json"))) {
    throw "Could not find a Lumen source checkout at $Repo"
}

Write-Host "Applying synchronized playback + Ctrl-wheel timeline pan..." -ForegroundColor Cyan
node (Join-Path $Here "apply.mjs") $Repo
if ($LASTEXITCODE -ne 0) { throw "Source patch failed. Nothing should be forced; send me the error." }

Set-Location $Repo

Write-Host ""
Write-Host "Running focused regression tests..." -ForegroundColor Cyan
npm test -- src/editor/playback-start.test.ts src/engine/playback-sync.test.ts src/features/timeline/wheel-nav.test.ts
if ($LASTEXITCODE -ne 0) { throw "Focused tests failed. Backups have .before-sync-playback.bak suffix." }

Write-Host ""
Write-Host "Running full test suite..." -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { throw "Full test suite failed." }

Write-Host ""
Write-Host "Running TypeScript checks..." -ForegroundColor Cyan
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "Typecheck failed." }

Write-Host ""
Write-Host "Building Windows installer..." -ForegroundColor Cyan
npm run dist
if ($LASTEXITCODE -ne 0) { throw "Installer build failed." }

Write-Host ""
Write-Host "Build complete." -ForegroundColor Green
Write-Host "Install from: $Repo\release" -ForegroundColor Yellow
