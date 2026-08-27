@echo off
echo Starting EED HALAL local server...
echo Opening http://localhost:8000/budget-planner.html?key=2024
echo.

REM Try python first
python --version >nul 2>&1
if %errorlevel%==0 (
  echo Found Python - starting http.server on port 8000
  start http://localhost:8000/budget-planner.html?key=2024
  python -m http.server 8000
  goto :end
)

REM Try npx
where npx >nul 2>&1
if %errorlevel%==0 (
  echo Found Node - starting npx serve
  start http://localhost:3000/budget-planner.html?key=2024
  npx serve . -l 3000
  goto :end
)

echo ERROR: Need Python or Node.js installed
echo Install Python from https://python.org or Node from https://nodejs.org
echo Then double-click this file again
pause

:end
