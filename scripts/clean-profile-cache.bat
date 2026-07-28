@echo off
echo Dong app HienNVAuto truoc khi chay script nay, neu chua dong.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0clean-profile-cache.ps1" %*
echo.
pause
