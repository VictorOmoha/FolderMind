# Fix electron-builder winCodeSign symlink issue on Windows
# Pre-extracts the cache manually, replacing symlinks with dummy files

$cacheDir = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0"
$tempZip  = "$env:TEMP\winCodeSign.7z"
$sevenZip = "C:\Users\omoha\FolderMind\node_modules\7zip-bin\win\x64\7za.exe"

Write-Host "Downloading winCodeSign..." -ForegroundColor Cyan
Invoke-WebRequest -Uri "https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z" -OutFile $tempZip

Write-Host "Creating cache directory..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

Write-Host "Extracting (ignoring symlink errors)..." -ForegroundColor Cyan
# Extract and ignore exit code 2 (symlink errors on Windows)
& $sevenZip x -bd $tempZip "-o$cacheDir" -y 2>$null
# Exit code 2 = warnings only (symlinks), not fatal — continue

Write-Host "Creating dummy symlink files..." -ForegroundColor Cyan
$dummyPaths = @(
  "$cacheDir\darwin\10.12\lib\libcrypto.dylib",
  "$cacheDir\darwin\10.12\lib\libssl.dylib"
)
foreach ($p in $dummyPaths) {
  $dir = Split-Path $p
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  if (-not (Test-Path $p)) {
    New-Item -ItemType File -Path $p | Out-Null
    Write-Host "  Created dummy: $p" -ForegroundColor Gray
  }
}

Write-Host ""
Write-Host "Done! winCodeSign cache is ready." -ForegroundColor Green
Write-Host "Now run: npx electron-builder --win --x64" -ForegroundColor Yellow
