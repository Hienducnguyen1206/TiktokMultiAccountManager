@echo off
REM ============================================================
REM  Khoi phuc du lieu HienNVAuto tu ban backup (session + DB)
REM  Chi chay khi can khoi phuc. DONG app truoc khi chay.
REM ============================================================
setlocal
set "DST=%APPDATA%\HienNVAuto\data"
set "SRC=%APPDATA%\HienNVAuto\backup_data"

if not exist "%SRC%" (
  echo [!] Khong tim thay ban backup: %SRC%
  echo     Ban chua chay backup-data.bat truoc do?
  pause
  exit /b 1
)

echo CANH BAO: se ghi de du lieu hien tai bang ban backup.
echo   Tu backup: %SRC%
echo   Vao:       %DST%
echo.
set /p OK="Go 'Y' de tiep tuc, phim khac de huy: "
if /I not "%OK%"=="Y" (
  echo Da huy.
  pause
  exit /b 0
)

if exist "%DST%" rmdir /s /q "%DST%"
robocopy "%SRC%" "%DST%" /E /R:1 /W:1 /NFL /NDL /NJH >nul

if %ERRORLEVEL% GEQ 8 (
  echo [!] Khoi phuc that bai. Kiem tra da DONG app chua.
  pause
  exit /b 1
)

echo [OK] Da khoi phuc xong. Mo lai app.
pause
endlocal
