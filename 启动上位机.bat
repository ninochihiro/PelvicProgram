@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo 正在打开上位机服务终端...

start "MPPS 上位机服务" cmd /k "npm start"

start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:5173/sensor'"

exit
