$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root '.env'

if (Test-Path -LiteralPath $envPath) {
  exit 0
}

Write-Host 'First-time LINE bot setup'
Write-Host 'Open LINE Developers > Messaging API channel > Basic settings > Channel secret.'
$secureSecret = Read-Host 'Paste LINE Channel Secret' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
try {
  $lineSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}

if ([string]::IsNullOrWhiteSpace($lineSecret)) {
  throw 'LINE Channel Secret cannot be empty.'
}

$bytes = New-Object byte[] 32
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $random.GetBytes($bytes)
} finally {
  $random.Dispose()
}
$forwardSecret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

$content = @(
  "LINE_CHANNEL_SECRET=$lineSecret"
  'N8N_INTERNAL_WEBHOOK_URL=http://127.0.0.1:5678/webhook/line-webhook'
  "EED_WEBHOOK_FORWARD_SECRET=$forwardSecret"
  'LINE_GATEWAY_HOST=127.0.0.1'
  'LINE_GATEWAY_PORT=8787'
  'BOT_MONITORING_ENABLED=false'
)
[IO.File]::WriteAllLines($envPath, $content, [Text.UTF8Encoding]::new($false))
Write-Host "Created $envPath"
