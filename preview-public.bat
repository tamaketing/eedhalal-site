@echo off
setlocal
rem Public website preview only (no admin API, no menu saving).
rem Serves this repository root on loopback only. For the owner admin tools,
rem use start-server.bat instead.
title EED HALAL public preview - local only - closing this window stops the preview
cd /d "%~dp0"
set PORT=8000
start "" "http://127.0.0.1:%PORT%/index.html"

where python >nul 2>&1
if %errorlevel%==0 (
  echo Serving public preview at http://127.0.0.1:%PORT%/ (loopback only)
  python -m http.server %PORT% --bind 127.0.0.1
  goto :end
)

where node >nul 2>&1
if %errorlevel%==0 (
  echo Serving public preview at http://127.0.0.1:3000/ (loopback only)
  npx --yes serve . -l tcp://127.0.0.1:3000
  goto :end
)

echo ERROR: Need Python or Node.js installed
echo Install Python from https://python.org or Node from https://nodejs.org
echo Then double-click this file again
pause

:end
endlocal
