param([switch]$CheckOnly, [switch]$TunnelOnly)

$ErrorActionPreference = 'Stop'
try { $Host.UI.RawUI.WindowTitle = 'EED-HALAL-N8N' } catch {}
$root = Split-Path -Parent $PSScriptRoot
$children = [Collections.Generic.List[System.Diagnostics.Process]]::new()
$exitCode = 0

function Start-BotProcess($Name, $Executable, $Arguments) {
    $stdout = Join-Path $PSScriptRoot "$Name.stdout.log"
    $stderr = Join-Path $PSScriptRoot "$Name.stderr.log"
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $children.Add($process)
    return $process
}

function Wait-BotHealth($Name, $Url, $Process) {
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    do {
        if ($Process -and $Process.HasExited) { throw "$Name exited. See line-ai\$Name.stderr.log and $Name.stdout.log." }
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return }
        } catch {}
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "$Name did not become ready. See its logs in line-ai."
}

function Test-BotPort($Port) {
    $client = [Net.Sockets.TcpClient]::new()
    try {
        $connection = $client.ConnectAsync('127.0.0.1', $Port)
        return ($connection.Wait(1000) -and $client.Connected)
    } catch { return $false }
    finally { $client.Dispose() }
}

function Test-BotGatewayProbe($Port) {
    # Single-shot cryptographic proof that the listener is OUR gateway: only it
    # validates our HMAC and answers the LINE verification probe with accepted.
    # Returns $true/$false, never throws. No response bodies are logged.
    try {
        $secret = $env:LINE_CHANNEL_SECRET
        if ([string]::IsNullOrWhiteSpace($secret)) { return $false }
        $payload = '{"events":[]}'
        $hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($secret))
        try { $signature = [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($payload))) }
        finally { $hmac.Dispose() }
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/line-webhook" -Method Post -ContentType 'application/json' -Headers @{ 'x-line-signature' = $signature } -Body $payload -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -ne 200) { return $false }
        return ((($response.Content | ConvertFrom-Json).status) -eq 'accepted')
    } catch { return $false }
}

function Test-BotServiceIdentity($Name, $Port, $Url) {
    # Port open + HTTP 200 is NOT identity. Each service must additionally prove
    # its expected application shape before reuse. Returns $true/$false, never
    # throws; any doubt fails closed (caller throws without killing anything).
    try {
        if ($Name -eq 'internal-api') {
            $health = Invoke-RestMethod -Uri $Url -TimeoutSec 5
            return ($health -is [PSCustomObject] -and $health.ready -eq $true -and $health.adapter -eq 'postgres')
        }
        if ($Name -eq 'gateway') {
            $health = Invoke-RestMethod -Uri $Url -TimeoutSec 5
            if (-not ($health -is [PSCustomObject] -and $health.status -eq 'ok')) { return $false }
            return (Test-BotGatewayProbe $Port)
        }
        if ($Name -eq 'n8n') {
            $health = Invoke-RestMethod -Uri $Url -TimeoutSec 5
            return ($health -is [PSCustomObject] -and $health.status -eq 'ok')
        }
        return $false
    } catch { return $false }
}

function Start-OrReuseBotService($Name, $Port, $Url, $Executable, $Arguments) {
    if (Test-BotPort $Port) {
        Write-Host "Checking existing $Name on port $Port..."
        if (Test-BotServiceIdentity $Name $Port $Url) {
            Write-Host "Reusing verified $Name."
            return
        }
        throw "Port $Port is occupied by an unverified service (expected $Name with verified identity). Not reusing, not killing, not starting a duplicate. Stop the occupying process or free the port, then retry."
    }
    if ($TunnelOnly) { throw "$Name is not running. Run START-EED-BOT.cmd without -TunnelOnly to start missing services." }
    Write-Host "Starting $Name..."
    $serviceProcess = Start-BotProcess $Name $Executable $Arguments
    Wait-BotHealth $Name $Url $serviceProcess
}

function Wait-BotWebhook($BaseUrl, $Process, $TimeoutSeconds = 90) {
    $payload = '{"events":[]}'
    $hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($env:LINE_CHANNEL_SECRET))
    try { $signature = [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($payload))) }
    finally { $hmac.Dispose() }
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $failure = 'No response'
    do {
        if ($Process -and $Process.HasExited) { throw 'Tunnel stopped before webhook verification completed.' }
        try {
            $health = Invoke-RestMethod -Uri "$BaseUrl/healthz" -TimeoutSec 5
            if ($health.status -ne 'ok') { throw 'Unexpected gateway health response.' }
            $response = Invoke-WebRequest -Uri "$BaseUrl/line-webhook" -Method Post -ContentType 'application/json' -Headers @{ 'x-line-signature' = $signature } -Body $payload -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200 -and ($response.Content | ConvertFrom-Json).status -eq 'accepted') { return }
            $failure = 'Unexpected webhook response'
        } catch { $failure = $_.Exception.Message }
        Start-Sleep -Seconds 1
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Webhook verification failed: $failure. Check the gateway and tunnel logs; no URL was copied."
}

try {
    Set-Location -LiteralPath $root
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $cloudflared = (Get-Command cloudflared.exe -ErrorAction Stop).Source
    $n8nCommand = (Get-Command n8n.cmd -ErrorAction Stop).Source
    $n8nEntry = Join-Path (Split-Path -Parent $n8nCommand) 'node_modules\n8n\bin\n8n'
    foreach ($path in @($n8nEntry, "$PSScriptRoot\webhook-gateway.mjs", "$PSScriptRoot\setup-local-env.ps1")) {
        if (-not (Test-Path -LiteralPath $path)) { throw "Missing required file: $path" }
    }
    Write-Host 'OK: Node.js, n8n, cloudflared and bot scripts are installed.' -ForegroundColor Green
    $envPath = Join-Path $root '.env'
    if ($CheckOnly) {
        if (Test-Path -LiteralPath $envPath) {
            Write-Host 'Local .env exists (secret values are not displayed).'
        } else {
            Write-Host 'First launch requires LINE Channel Secret; the setup prompt will create .env.' -ForegroundColor Yellow
        }
        exit 0
    }

    # Run setup in a child shell because the setup script uses exit.
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\setup-local-env.ps1"
    if ($LASTEXITCODE -ne 0) { throw 'Local setup did not finish. Run START-EED-BOT again and enter LINE Channel Secret.' }
    foreach ($line in [IO.File]::ReadAllLines($envPath)) {
        if ($line -match '^\s*(?:#|$)') { continue }
        if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { throw 'Invalid .env line. Use NAME=value format.' }
        $name = $Matches[1]
        $value = $Matches[2].Trim()
        if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
    foreach ($name in @('LINE_CHANNEL_SECRET', 'EED_WEBHOOK_FORWARD_SECRET', 'N8N_INTERNAL_WEBHOOK_URL')) {
        if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) { throw "Missing $name in .env." }
    }
    if ($env:N8N_INTERNAL_WEBHOOK_URL -ne 'http://127.0.0.1:5678/webhook/line-webhook') {
        throw 'This local launcher requires N8N_INTERNAL_WEBHOOK_URL=http://127.0.0.1:5678/webhook/line-webhook.'
    }
    if (-not $TunnelOnly) {
        $env:N8N_LISTEN_ADDRESS = '127.0.0.1'
        $env:N8N_PORT = '5678'
        $env:N8N_BLOCK_ENV_ACCESS_IN_NODE = 'false'
        if ([string]::IsNullOrWhiteSpace($env:INTERNAL_API_BASE_URL)) { $env:INTERNAL_API_BASE_URL = 'http://127.0.0.1:8788' }
        $env:LINE_GATEWAY_HOST = '127.0.0.1'
        $env:LINE_GATEWAY_PORT = '8787'
        # Internal Business API (production persistence). Secrets live in
        # D:\eedhalal-runtime\eedhalal-api.env (admin-only file, never echoed).
        $apiEnvPath = 'D:\eedhalal-runtime\eedhalal-api.env'
        if (-not (Test-Path -LiteralPath $apiEnvPath)) { throw "Missing Internal API env file: $apiEnvPath. See docs/database.md." }
        foreach ($line in [IO.File]::ReadAllLines($apiEnvPath)) {
            if ($line -match '^\s*(?:#|$)') { continue }
            if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { throw 'Invalid Internal API env line. Use NAME=value format.' }
            [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), 'Process')
        }
        foreach ($name in @('DB_ADAPTER', 'DATABASE_URL', 'EED_INTERNAL_API_SECRET')) {
            if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) { throw "Missing $name for Internal API." }
        }
    }
    Start-OrReuseBotService 'internal-api' 8788 'http://127.0.0.1:8788/readiness' $node @('"' + "$root\server\internal-api.mjs" + '"')
    Start-OrReuseBotService 'n8n' 5678 'http://127.0.0.1:5678/healthz' $node @('"' + $n8nEntry + '"', 'start')
    Start-OrReuseBotService 'gateway' 8787 'http://127.0.0.1:8787/healthz' $node @('"' + "$PSScriptRoot\webhook-gateway.mjs" + '"')
    Wait-BotWebhook 'http://127.0.0.1:8787' $null 10
    $env:SITE_URL = 'https://eedhalal.com'
    $env:BOT_MONITORING_ENABLED = 'true'
    $env:BOT_HEALTH_URL = 'http://127.0.0.1:8787/healthz'
    # This interactive check reports locally; it does not send alerts.
    $env:ALERT_WEBHOOK_URL = ''
    & $node "$root\scripts\smoke-production.mjs"
    if ($LASTEXITCODE -ne 0) { throw 'Startup health check failed.' }

    $existingTunnels = @(Get-Process cloudflared -ErrorAction SilentlyContinue)
    $webhook = $null
    if ($existingTunnels.Count -gt 0) {
        $log = Get-Content -LiteralPath "$PSScriptRoot\cloudflared.stderr.log" -Raw -ErrorAction SilentlyContinue
        $tunnelUrl = [regex]::Match([string]$log, 'https://[a-z0-9-]+\.trycloudflare\.com').Value
        if (-not $tunnelUrl) { throw 'An existing tunnel is running but its URL is unavailable. No existing process was stopped. Check line-ai\cloudflared.stderr.log.' }
        Write-Host 'Verifying the existing tunnel before reusing its URL...'
        Wait-BotWebhook $tunnelUrl $null
        $webhook = $tunnelUrl + '/line-webhook'
    } else {
        Write-Host 'Starting temporary webhook tunnel...'
        $tunnel = Start-BotProcess 'cloudflared' $cloudflared @('tunnel', '--url', 'http://127.0.0.1:8787', '--no-autoupdate')
        $deadline = [DateTime]::UtcNow.AddSeconds(60)
        $webhook = $null
        do {
            if ($tunnel.HasExited) { throw 'Tunnel exited. See line-ai\cloudflared.stderr.log.' }
            $log = Get-Content -LiteralPath "$PSScriptRoot\cloudflared.stderr.log" -Raw -ErrorAction SilentlyContinue
            if ($log -match 'https://[a-z0-9-]+\.trycloudflare\.com' -and $log -match 'Registered tunnel connection') {
                $tunnelUrl = [regex]::Match($log, 'https://[a-z0-9-]+\.trycloudflare\.com').Value
                $webhook = $tunnelUrl + '/line-webhook'
                break
            }
            Start-Sleep -Milliseconds 500
        } while ([DateTime]::UtcNow -lt $deadline)
        if (-not $webhook) { throw 'No tunnel URL received. See line-ai\cloudflared.stderr.log.' }
        Write-Host 'Checking public webhook reachability and signed LINE verification...'
        Wait-BotWebhook $tunnelUrl $tunnel
    }
    Write-Host "`nServices started. n8n editor: http://127.0.0.1:5678" -ForegroundColor Green
    Write-Host "LINE webhook URL: $webhook" -ForegroundColor Cyan
    Write-Host 'Verified: public gateway and signed empty-event POST both returned HTTP 200.' -ForegroundColor Green
    Write-Host 'Use this URL in LINE Developers > Messaging API > Webhook URL. Browser GET is not a webhook test.'
    try { Set-Clipboard -Value $webhook; Write-Host 'Webhook URL copied. Paste into LINE Developers and verify.' } catch { Write-Host 'Copy the webhook URL above manually.' }
    Write-Host 'Existing services are left running. This window only stops processes it started.'
    if ($children.Count -gt 0) { Write-Host 'Keep this window open. Press Ctrl+C to stop. A new tunnel gets a new URL.' }
    while ($children.Count -gt 0) {
        foreach ($process in $children) {
            if ($process.HasExited) { throw 'A bot service stopped. Check the logs in line-ai.' }
        }
        Start-Sleep -Seconds 2
    }
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    $exitCode = 1
} finally {
    foreach ($process in $children) {
        if (-not $process.HasExited) {
            & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
        }
    }
}
exit $exitCode
