@echo off
REM ============================================================
REM  Sao luu toan bo du lieu HienNVAuto (session + profiles + DB)
REM  Chay TRUOC khi update len ban moi. DONG app truoc khi chay.
REM ============================================================
setlocal
set "SRC=%APPDATA%\HienNVAuto\data"
set "DST=%APPDATA%\HienNVAuto\backup_data"

if not exist "%SRC%" (
  echo [!] Khong tim thay du lieu: %SRC%
  echo     App chua chay lan nao tren may nay?
  pause
  exit /b 1
)

echo Dang sao luu:
echo   Tu:  %SRC%
echo   Den: %DST%
echo.

REM Xoa ban backup cu (neu co) roi copy moi
if exist "%DST%" rmdir /s /q "%DST%"
robocopy "%SRC%" "%DST%" /E /R:1 /W:1 /NFL /NDL /NJH >nul

if %ERRORLEVEL% GEQ 8 (
  echo [!] Sao luu that bai. Kiem tra da DONG app chua.
  pause
  exit /b 1
)

echo [OK] Da sao luu xong vao: %DST%
echo     Neu update loi, chay restore-data.bat de khoi phuc.
pause
endlocal
