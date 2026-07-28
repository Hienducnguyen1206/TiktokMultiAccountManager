<#
Don cache Chromium cua cac profile trong HienNVAuto (giu nguyen dang nhap).

CHI xoa: Cache, Code Cache, GPUCache, cac shader cache, Session Storage,
Service Worker CacheStorage, Shared Dictionary.

KHONG dung vao: Cookies, Local Storage, IndexedDB, Preferences, Local State,
Login Data, Web Data, Sync Data.

Cach dung:
  .\clean-profile-cache.ps1            -> xoa that
  .\clean-profile-cache.ps1 -WhatIf    -> chi xem se giai phong bao nhieu, khong xoa

LUU Y: dong app HienNVAuto (va moi cua so Chromium cua no) truoc khi chay,
neu khong cac file dang mo se bi bo qua.
#>

param(
    [switch]$WhatIf,
    [string]$Root = 'C:\Users\ADMIN\AppData\Roaming\hiennvauto'
)

$profilesRoot = Join-Path $Root 'data\profiles'

if (-not (Test-Path $profilesRoot)) {
    Write-Host "Khong tim thay thu muc profiles: $profilesRoot" -ForegroundColor Red
    exit 1
}

# Duong dan tuong doi tinh tu goc moi profile - chi gom nhung gi an toan xoa
$safeRelDirs = @(
    'Default\Cache'
    'Default\Code Cache'
    'Default\GPUCache'
    'Default\Service Worker\CacheStorage'
    'Default\Session Storage'
    'Default\Shared Dictionary'
    'Default\DawnGraphiteCache'
    'Default\DawnWebGPUCache'
    'Default\blob_storage'
    'GrShaderCache'
    'ShaderCache'
    'GraphiteDawnCache'
)

# Cache cua chinh cua so Electron app (goc $Root, khong phai trong data\profiles)
$appLevelDirs = @(
    'Cache'
    'Code Cache'
    'GPUCache'
    'DawnGraphiteCache'
    'DawnWebGPUCache'
)

function Get-FolderSizeMB($path) {
    if (-not (Test-Path $path)) { return 0 }
    $sum = (Get-ChildItem $path -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    if ($null -eq $sum) { return 0 }
    return [math]::Round($sum / 1MB, 1)
}

$profiles = Get-ChildItem $profilesRoot -Directory -Force -ErrorAction SilentlyContinue
Write-Host "Tim thay $($profiles.Count) profile trong $profilesRoot" -ForegroundColor Cyan
Write-Host ""

$totalMB = 0
$skipped = @()

foreach ($p in $profiles) {
    foreach ($rel in $safeRelDirs) {
        $target = Join-Path $p.FullName $rel
        if (-not (Test-Path $target)) { continue }
        $sizeMB = Get-FolderSizeMB $target
        if ($sizeMB -eq 0) { continue }

        if ($WhatIf) {
            Write-Host ("  [WhatIf] {0}\{1}  ({2} MB)" -f $p.Name, $rel, $sizeMB)
            $totalMB += $sizeMB
            continue
        }

        try {
            Remove-Item $target -Recurse -Force -ErrorAction Stop
            Write-Host ("  Da xoa: {0}\{1}  (-{2} MB)" -f $p.Name, $rel, $sizeMB) -ForegroundColor Green
            $totalMB += $sizeMB
        } catch {
            Write-Host ("  BO QUA (dang bi khoa?): {0}\{1}" -f $p.Name, $rel) -ForegroundColor Yellow
            $skipped += "$($p.Name)\$rel"
        }
    }
}

# Cache cua chinh cua so app (khong nam trong data\profiles)
foreach ($rel in $appLevelDirs) {
    $target = Join-Path $Root $rel
    if (-not (Test-Path $target)) { continue }
    $sizeMB = Get-FolderSizeMB $target
    if ($sizeMB -eq 0) { continue }

    if ($WhatIf) {
        Write-Host ("  [WhatIf] (app) {0}  ({1} MB)" -f $rel, $sizeMB)
        $totalMB += $sizeMB
        continue
    }

    try {
        Remove-Item $target -Recurse -Force -ErrorAction Stop
        Write-Host ("  Da xoa: (app) {0}  (-{1} MB)" -f $rel, $sizeMB) -ForegroundColor Green
        $totalMB += $sizeMB
    } catch {
        Write-Host ("  BO QUA (dang bi khoa?): (app) {0}" -f $rel) -ForegroundColor Yellow
        $skipped += "(app)\$rel"
    }
}

Write-Host ""
if ($WhatIf) {
    Write-Host ("Se giai phong khoang: {0} MB" -f [math]::Round($totalMB, 1)) -ForegroundColor Cyan
} else {
    Write-Host ("Da giai phong: {0} MB" -f [math]::Round($totalMB, 1)) -ForegroundColor Cyan
}

if ($skipped.Count -gt 0) {
    Write-Host ""
    Write-Host "Cac muc bi bo qua (co the dang bi Chrome/app khoa) - hay dong HienNVAuto va chay lai:" -ForegroundColor Yellow
    $skipped | ForEach-Object { Write-Host "  - $_" }
}
