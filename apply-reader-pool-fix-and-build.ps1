param(
    [string]$Repo = "D:\Lumenfix\Lumen-Fixed"
)

$ErrorActionPreference = "Stop"
Set-Location $Repo

if (-not (Test-Path "src\engine\stills.ts")) {
    throw "Could not find Lumen source at $Repo"
}

$patch = Join-Path $PSScriptRoot "lumen-root-cause-reader-pool.patch"

Write-Host "Checking the root-cause patch..." -ForegroundColor Cyan
git apply --check $patch
if ($LASTEXITCODE -ne 0) {
    throw "Patch check failed. The source does not match the previous fixed build; send me src\engine\stills.ts and I will adapt it."
}

Write-Host "Applying reader-pool fix..." -ForegroundColor Cyan
git apply $patch
if ($LASTEXITCODE -ne 0) { throw "git apply failed." }

Write-Host "Running the regression test first..." -ForegroundColor Cyan
npm test -- src/engine/stills.test.ts
if ($LASTEXITCODE -ne 0) { throw "Reader-pool regression test failed." }

Write-Host "Running the full test suite..." -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { throw "Full test suite failed." }

Write-Host "Running TypeScript checks..." -ForegroundColor Cyan
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "Typecheck failed." }

Write-Host "Building the Windows installer..." -ForegroundColor Cyan
npm run dist
if ($LASTEXITCODE -ne 0) { throw "Installer build failed." }

Write-Host ""
Write-Host "Build finished." -ForegroundColor Green
Write-Host "Installer folder: $Repo\release" -ForegroundColor Yellow
