# Gắn icon + thông tin phiên bản vào HienNVAuto.exe sau khi build.
#
# Vì sao cần script này: electron-builder chỉ gắn icon khi signAndEditExecutable = true,
# nhưng bật cờ đó thì nó phải giải nén bộ winCodeSign — thao tác này tạo symlink cho
# phần macOS và thất bại trên Windows nếu chưa bật Developer Mode ("A required privilege
# is not held by the client"). Nên ta để cờ = false và tự chạy rcedit ở đây.
#
# Chạy: powershell -ExecutionPolicy Bypass -File scripts\set-exe-icon.ps1
# (npm run dist đã tự gọi)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe  = Join-Path $root 'release\win-unpacked\HienNVAuto.exe'
$icon = Join-Path $root 'build\icon.ico'

if (-not (Test-Path $exe))  { Write-Host "Bo qua: chua co $exe"; exit 0 }
if (-not (Test-Path $icon)) { Write-Host "Bo qua: chua co $icon"; exit 0 }

# rcedit nằm trong cache winCodeSign của electron-builder (đã tải sẵn khi build).
$cache = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign'
$rcedit = Get-ChildItem $cache -Recurse -Filter 'rcedit-x64.exe' -ErrorAction SilentlyContinue |
          Select-Object -First 1 -ExpandProperty FullName
if (-not $rcedit) { Write-Host "Bo qua: khong tim thay rcedit-x64.exe trong $cache"; exit 0 }

& $rcedit $exe --set-icon $icon `
  --set-version-string 'ProductName' 'HienNVAuto' `
  --set-version-string 'FileDescription' 'HienNVAuto - Antidetect Browser Manager' `
  --set-version-string 'CompanyName' 'HienNV'

if ($LASTEXITCODE -ne 0) { throw "rcedit that bai (exit $LASTEXITCODE)" }
Write-Host "Da gan icon vao $exe"
