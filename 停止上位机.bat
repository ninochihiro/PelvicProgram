@echo off
chcp 65001 >nul

echo 正在停止上位机服务...

cd /d "%~dp0"
node stop-all.js

echo.
pause
