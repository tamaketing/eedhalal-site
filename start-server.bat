@echo off
setlocal
rem Compatibility alias — ONE entry point for the whole local system.
rem tools\line\start-line.cmd starts: Internal API (127.0.0.1:8788) + Owner
rem Console, LINE gateway, cloudflared webhook tunnel and the weekly runner.
rem Keeping this file lets old instructions keep working without starting a
rem second backend on the same port.
chcp 65001 >nul
call "%~dp0tools\line\start-line.cmd" %*
exit /b %ERRORLEVEL%
