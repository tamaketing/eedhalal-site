
param([switch]$DryRun)

$ErrorActionPreference = 'SilentlyContinue'
$targetIds = [System.Collections.Generic.HashSet[int]]::new()

foreach ($port in @(5678, 8787)) {
  $lines = netstat -ano | Select-String -Pattern (':'+$port+'\s+.*LISTENING\s+(\d+)\s*$')
  foreach ($line in $lines) {
    if ($line.Matches.Count -gt 0) {
      [void]$targetIds.Add([int]$line.Matches[0].Groups[1].Value)
    }
  }
}

Get-Process cloudflared -ErrorAction SilentlyContinue | ForEach-Object {
  [void]$targetIds.Add([int]$_.Id)
}

if ($targetIds.Count -eq 0) {
  Write-Host 'EED HALAL bot is not running.'
  exit 0
}

foreach ($id in $targetIds) {
  $process = Get-Process -Id $id -ErrorAction SilentlyContinue
  if (-not $process) { continue }
  if ($DryRun) {
    Write-Host "Would stop $($process.ProcessName) (PID $id)"
  } else {
    Stop-Process -Id $id -Force
    Write-Host "Stopped $($process.ProcessName) (PID $id)"
  }
}

