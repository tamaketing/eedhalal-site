# Public website preview only (no admin API, no menu saving).
# Serves this repository root on loopback only. For the owner admin tools,
# use start-server.ps1 instead.
Set-Location -LiteralPath $PSScriptRoot
$port = 8000
$url = "http://127.0.0.1:$port/index.html"
Start-Process $url

try {
  $null = Get-Command python -ErrorAction Stop
  Write-Host "Serving public preview at http://127.0.0.1:$port/ (loopback only)" -ForegroundColor Cyan
  python -m http.server $port --bind 127.0.0.1
  exit $LASTEXITCODE
} catch {}

try {
  $null = Get-Command node -ErrorAction Stop
  Write-Host 'Serving public preview at http://127.0.0.1:3000/ (loopback only)' -ForegroundColor Cyan
  npx --yes serve . -l tcp://127.0.0.1:3000
  exit $LASTEXITCODE
} catch {}

Write-Host 'ERROR: Need Python or Node.js' -ForegroundColor Red
Write-Host 'Install Python from https://python.org or Node from https://nodejs.org'
pause
