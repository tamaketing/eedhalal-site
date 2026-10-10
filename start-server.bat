@echo off
setlocal
rem Owner entry point for the local admin tools (menu API + budget matcher).
rem This only starts http://127.0.0.1:4185/ through tools\admin\start-admin.cmd.
rem For a public website preview, use preview-public.bat instead.
call "%~dp0tools\admin\start-admin.cmd" %*
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo Admin tools stopped with exit code %EXITCODE%.
  pause
)
exit /b %EXITCODE%
