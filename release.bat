@echo off
rem Bấm đúp để phát hành bản cập nhật lên GitHub (xem scripts/release.mjs).
chcp 65001 >nul
cd /d "%~dp0"
call npm run release -- %*
echo.
pause
