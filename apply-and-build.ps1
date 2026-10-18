param(
    [string]$Repo = "."
)

$ErrorActionPreference = "Stop"
Set-Location $Repo

if (-not (Test-Path "package.json")) {
    throw "Run this from the root of a Lumen v1.4.0 source checkout, or pass -Repo C:\path\to\repo"
}

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
if ($version -ne "1.4.0") {
    Write-Warning "Patch was prepared against Lumen 1.4.0; this checkout reports $version."
}

$patch = Join-Path $PSScriptRoot "lumen-long-export-stability.patch"
git apply --check $patch
git apply $patch

Write-Host "Patch applied. Installing dependencies..."
npm ci

Write-Host "Running unit tests..."
npm test
if ($LASTEXITCODE -ne 0) { throw "Tests failed." }

Write-Host "Running TypeScript checks..."
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "Typecheck failed." }

Write-Host "Building Windows installer..."
npm run dist
if ($LASTEXITCODE -ne 0) { throw "Installer build failed." }

Write-Host ""
Write-Host "Build complete. Look in: $((Resolve-Path '.\release').Path)"
