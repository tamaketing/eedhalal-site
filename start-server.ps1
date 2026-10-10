# Owner entry point for the local admin tools (menu API + budget matcher).
# This only starts http://127.0.0.1:4185/ through tools/admin/start-admin.cmd.
# For a public website preview, use preview-public.ps1 instead.
$admin = Join-Path $PSScriptRoot 'tools/admin/start-admin.cmd'
& $admin @args
$code = $LASTEXITCODE
if ($code -ne 0) {
  Write-Host "Admin tools stopped with exit code $code." -ForegroundColor Red
  pause
}
exit $code
