@echo off
setlocal
title EED-HALAL-N8N
if not exist "%~dp0line-ai\start-bot.ps1" (
  echo ERROR: Missing line-ai\start-bot.ps1 in %~dp0
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0line-ai\start-bot.ps1" %*
set "botExit=%errorlevel%"
if /I "%~1"=="-CheckOnly" exit /b %botExit%
echo.
if not "%botExit%"=="0" echo Bot startup failed. See the error above.
pause
exit /b %botExit%
