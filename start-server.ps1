Write-Host "Starting EED HALAL local server..." -ForegroundColor Green
$port = 8000
$url = "http://localhost:$port/budget-planner.html?key=2024"

# Try Python
try {
  $py = Get-Command python -ErrorAction Stop
  Write-Host "Found Python - starting http.server on port $port" -ForegroundColor Cyan
  Start-Process $url
  python -m http.server $port
  exit
} catch {}

# Try Node
try {
  $npx = Get-Command npx -ErrorAction Stop
  Write-Host "Found Node - starting npx serve" -ForegroundColor Cyan
  Start-Process "http://localhost:3000/budget-planner.html?key=2024"
  npx serve . -l 3000
  exit
} catch {}

Write-Host "ERROR: Need Python or Node.js" -ForegroundColor Red
Write-Host "Install Python from https://python.org or Node from https://nodejs.org"
pause
