param(
    [string]$Repo = "D:\Lumenfix\Lumen-Fixed"
)

$ErrorActionPreference = "Stop"
$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Engine = Join-Path $Repo "src\engine"
$Current = Join-Path $Engine "stills.ts"
$ExpectedSha = "eab80f96f534b1b88333dd843040ab472e49744f9b8fa7a63014cc7f1f9799e5"

if (-not (Test-Path $Current)) {
    throw "Could not find $Current"
}

$ActualSha = (Get-FileHash $Current -Algorithm SHA256).Hash.ToLower()
Write-Host "Current stills.ts SHA256: $ActualSha"

if ($ActualSha -ne $ExpectedSha) {
    throw "stills.ts changed since the file you uploaded. Expected $ExpectedSha but found $ActualSha. Nothing was changed."
}

$Backup = Join-Path $Engine "stills.ts.before-reader-pool.bak"
Copy-Item $Current $Backup -Force

Copy-Item (Join-Path $PackageRoot "files\src\engine\stills.ts") $Current -Force
Copy-Item (Join-Path $PackageRoot "files\src\engine\source-reader-pool.ts") (Join-Path $Engine "source-reader-pool.ts") -Force
Copy-Item (Join-Path $PackageRoot "files\src\engine\source-reader-pool.test.ts") (Join-Path $Engine "source-reader-pool.test.ts") -Force

Set-Location $Repo

Write-Host ""
Write-Host "Running reader-pool regression test..." -ForegroundColor Cyan
npm test -- src/engine/source-reader-pool.test.ts
if ($LASTEXITCODE -ne 0) { throw "Reader-pool regression test failed. Backup remains at $Backup" }

Write-Host ""
Write-Host "Running full test suite..." -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { throw "Full test suite failed. Backup remains at $Backup" }

Write-Host ""
Write-Host "Running TypeScript checks..." -ForegroundColor Cyan
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "Typecheck failed. Backup remains at $Backup" }

Write-Host ""
Write-Host "Building Windows installer..." -ForegroundColor Cyan
npm run dist
if ($LASTEXITCODE -ne 0) { throw "Installer build failed. Backup remains at $Backup" }

Write-Host ""
Write-Host "Build complete." -ForegroundColor Green
Write-Host "Installer: $Repo\release" -ForegroundColor Yellow
Write-Host "Backup:    $Backup"
