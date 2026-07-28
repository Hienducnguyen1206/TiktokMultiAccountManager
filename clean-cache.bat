@echo off
REM ==================================================================
REM  Don cache cac profile HienNVAuto (giai phong dung luong)
REM  - XOA: Cache, Code Cache, GPUCache, Crashpad, ShaderCache...
REM  - GIU NGUYEN: cookie/dang nhap, Local Storage, IndexedDB
REM  Hay DONG app truoc khi chay.
REM ==================================================================
setlocal
chcp 65001 >nul

set "PROOT=%APPDATA%\HienNVAuto\data\profiles"

if not exist "%PROOT%" (
  echo [!] Khong tim thay du lieu profile: %PROOT%
  echo     App chua chay lan nao tren may nay?
  pause
  exit /b 1
)

REM --- Kiem tra app dang chay ---
tasklist /FI "IMAGENAME eq HienNVAuto.exe" 2>nul | find /I "HienNVAuto.exe" >nul
if not errorlevel 1 (
  echo [!] HienNVAuto dang chay. Hay DONG app roi chay lai file nay.
  pause
  exit /b 1
)

REM --- Do dung luong TRUOC ---
for /f %%S in ('powershell -NoProfile -Command "[math]::Round((Get-ChildItem '%PROOT%' -Recurse -File -ErrorAction SilentlyContinue ^| Measure-Object Length -Sum).Sum/1MB,1)"') do set "BEFORE=%%S"

echo Dang don cache cac profile...
echo.

for /d %%P in ("%PROOT%\*") do (
  call :cleanBase "%%~P"
  call :cleanBase "%%~P\Default"
  echo   - da xu ly: %%~nxP
)

REM --- Do dung luong SAU ---
for /f %%S in ('powershell -NoProfile -Command "[math]::Round((Get-ChildItem '%PROOT%' -Recurse -File -ErrorAction SilentlyContinue ^| Measure-Object Length -Sum).Sum/1MB,1)"') do set "AFTER=%%S"

echo.
echo ==================================================================
echo  Thu muc profiles:  %BEFORE% MB  --^>  %AFTER% MB
echo  Da giu nguyen dang nhap va IndexedDB.
echo ==================================================================
pause
exit /b 0

:cleanBase
rmdir /s /q "%~1\Cache" 2>nul
rmdir /s /q "%~1\Code Cache" 2>nul
rmdir /s /q "%~1\GPUCache" 2>nul
rmdir /s /q "%~1\Crashpad" 2>nul
rmdir /s /q "%~1\Component Crash Reports" 2>nul
rmdir /s /q "%~1\ShaderCache" 2>nul
rmdir /s /q "%~1\GrShaderCache" 2>nul
rmdir /s /q "%~1\DawnCache" 2>nul
rmdir /s /q "%~1\DawnGraphiteCache" 2>nul
rmdir /s /q "%~1\DawnWebGPUCache" 2>nul
rmdir /s /q "%~1\Service Worker\CacheStorage" 2>nul
rmdir /s /q "%~1\Service Worker\ScriptCache" 2>nul
goto :eof
