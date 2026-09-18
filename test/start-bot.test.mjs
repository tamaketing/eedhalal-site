import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('Windows launcher recovers missing services and preserves existing listeners', { skip: process.platform !== 'win32' }, async () => {
  const command = `
    $ErrorActionPreference = 'Stop'
    $tokens = $null; $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($env:TEST_LAUNCHER_PATH, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw 'Launcher syntax error' }
    $function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Start-OrReuseBotService' }, $true)
    Invoke-Expression $function.Extent.Text
    $script:starts = 0; $script:checks = 0; $TunnelOnly = $false
    function Test-BotPort($Port) { return $script:occupied }
    function Test-BotServiceIdentity($Name, $Port, $Url) { $script:checks++; if ($script:unhealthy) { throw 'Unhealthy listener' }; return $true }
    function Wait-BotHealth($Name, $Url, $Process) { $script:checks++ }
    function Start-BotProcess($Name, $Executable, $Arguments) { $script:starts++; return @{ HasExited = $false } }
    $script:occupied = $true
    Start-OrReuseBotService 'gateway' 8787 'http://localhost/healthz' 'node' @('gateway')
    if ($script:starts -ne 0 -or $script:checks -ne 1) { throw 'Healthy service was not reused' }
    $script:occupied = $false
    Start-OrReuseBotService 'n8n' 5678 'http://localhost/healthz' 'node' @('n8n')
    if ($script:starts -ne 1 -or $script:checks -ne 2) { throw 'Missing service was not started and checked' }
    $TunnelOnly = $true; $rejected = $false
    try { Start-OrReuseBotService 'n8n' 5678 'http://localhost/healthz' 'node' @('n8n') } catch { $rejected = $true }
    if (-not $rejected -or $script:starts -ne 1) { throw 'TunnelOnly started a missing service' }
    $TunnelOnly = $false; $script:occupied = $true; $script:unhealthy = $true; $rejected = $false
    try { Start-OrReuseBotService 'gateway' 8787 'http://localhost/healthz' 'node' @('gateway') } catch { $rejected = $true }
    if (-not $rejected -or $script:starts -ne 1) { throw 'Unhealthy occupied port was replaced' }
  `;
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, TEST_LAUNCHER_PATH: fileURLToPath(new URL('../line-ai/start-bot.ps1', import.meta.url)) },
    timeout: 20000,
  });
});

test('Windows launcher verifies service identity before reuse and fails closed', { skip: process.platform !== 'win32' }, async () => {
  const command = `
    $ErrorActionPreference = 'Stop'
    $tokens = $null; $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($env:TEST_LAUNCHER_PATH, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw 'Launcher syntax error' }
    foreach ($name in @('Test-BotGatewayProbe', 'Test-BotServiceIdentity')) {
      $function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
      if (-not $function) { throw "Missing function $name" }
      Invoke-Expression $function.Extent.Text
    }
    $env:LINE_CHANNEL_SECRET = 'test-only-secret'
    function Invoke-RestMethod($Uri, $TimeoutSec) {
      if ($script:webThrow) { throw 'connection failed' }
      return $script:webResponse
    }
    function Invoke-WebRequest($Uri, $Method, $ContentType, $Headers, $Body, [switch]$UseBasicParsing, $TimeoutSec) {
      if ($script:probeThrow) { throw 'probe failed' }
      return @{ StatusCode = $script:probeStatus; Content = $script:probeContent }
    }
    function check($Actual, $Label) { if (-not $Actual) { throw "Expected TRUE: $Label" } }
    function checkFalse($Actual, $Label) { if ($Actual) { throw "Expected FALSE: $Label" } }
    # 1. correct identities are reused
    $script:webThrow = $false
    $script:webResponse = [pscustomobject]@{ status = 'ok' }
    check (Test-BotServiceIdentity 'n8n' 5678 'http://localhost/healthz') 'n8n exact identity'
    $script:webResponse = [pscustomobject]@{ ready = $true; adapter = 'postgres' }
    check (Test-BotServiceIdentity 'internal-api' 8788 'http://localhost/readiness') 'internal-api exact identity'
    $script:webResponse = [pscustomobject]@{ status = 'ok' }
    $script:probeThrow = $false; $script:probeStatus = 200; $script:probeContent = '{"status":"accepted"}'
    check (Test-BotServiceIdentity 'gateway' 8787 'http://localhost/healthz') 'gateway signed identity'
    # 2. HTTP 200 + wrong identity is rejected
    $script:webResponse = [pscustomobject]@{ status = 'something-else' }
    checkFalse (Test-BotServiceIdentity 'n8n' 5678 'http://localhost/healthz') 'wrong n8n identity'
    $script:webResponse = [pscustomobject]@{ ready = $true; adapter = 'mysql' }
    checkFalse (Test-BotServiceIdentity 'internal-api' 8788 'http://localhost/readiness') 'wrong adapter'
    # 3. malformed body is rejected
    $script:webThrow = $true
    checkFalse (Test-BotServiceIdentity 'n8n' 5678 'http://localhost/healthz') 'malformed body'
    $script:webThrow = $false
    # 4. empty body is rejected
    $script:webResponse = $null
    checkFalse (Test-BotServiceIdentity 'n8n' 5678 'http://localhost/healthz') 'empty body'
    # 5. correct shape but unhealthy state is rejected
    $script:webResponse = [pscustomobject]@{ ready = $false; adapter = 'postgres' }
    checkFalse (Test-BotServiceIdentity 'internal-api' 8788 'http://localhost/readiness') 'not-ready api'
    $script:webResponse = [pscustomobject]@{ status = 'ok' }
    $script:probeStatus = 200; $script:probeContent = '{"status":"rejected"}'
    checkFalse (Test-BotServiceIdentity 'gateway' 8787 'http://localhost/healthz') 'failed gateway probe'
    $script:probeThrow = $true
    checkFalse (Test-BotServiceIdentity 'gateway' 8787 'http://localhost/healthz') 'probe transport failure'
    $script:probeThrow = $false
    # unknown service names fail closed; missing secret fails the gateway probe
    checkFalse (Test-BotServiceIdentity 'unknown' 9999 'http://localhost/healthz') 'unknown service'
    $env:LINE_CHANNEL_SECRET = ''
    $script:probeStatus = 200; $script:probeContent = '{"status":"accepted"}'
    checkFalse (Test-BotServiceIdentity 'gateway' 8787 'http://localhost/healthz') 'missing secret'
  `;
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, TEST_LAUNCHER_PATH: fileURLToPath(new URL('../line-ai/start-bot.ps1', import.meta.url)) },
    timeout: 20000,
  });
});

test('Windows launcher reuse never kills and only tracks processes it starts', { skip: process.platform !== 'win32' }, async () => {
  const command = `
    $ErrorActionPreference = 'Stop'
    $tokens = $null; $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($env:TEST_LAUNCHER_PATH, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw 'Launcher syntax error' }
    $function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Start-OrReuseBotService' }, $true)
    if ($function.Extent.Text -match 'Stop-Process|Stop-Service|taskkill') { throw 'Reuse path must not contain process-kill logic' }
    Invoke-Expression $function.Extent.Text
    $TunnelOnly = $false
    $script:tracked = @()
    function Test-BotPort($Port) { return $script:occupied }
    function Test-BotServiceIdentity($Name, $Port, $Url) { return $script:verified }
    function Start-BotProcess($Name, $Executable, $Arguments) { $p = @{ HasExited = $false }; $script:tracked += $p; return $p }
    function Wait-BotHealth($Name, $Url, $Process) {}
    # 9. verified reuse is not tracked
    $script:occupied = $true; $script:verified = $true
    Start-OrReuseBotService 'n8n' 5678 'http://localhost/healthz' 'node' @('n8n')
    if ($script:tracked.Count -ne 0) { throw 'Reused service was tracked for shutdown' }
    # 10. newly started service is tracked
    $script:occupied = $false
    Start-OrReuseBotService 'n8n' 5678 'http://localhost/healthz' 'node' @('n8n')
    if ($script:tracked.Count -ne 1) { throw 'Started service was not tracked for shutdown' }
    # 11. unverified occupant is rejected without starting anything
    $script:occupied = $true; $script:verified = $false; $rejected = $false
    try { Start-OrReuseBotService 'n8n' 5678 'http://localhost/healthz' 'node' @('n8n') } catch { $rejected = $true }
    if (-not $rejected -or $script:tracked.Count -ne 1) { throw 'Unverified occupant was replaced or duplicated' }
    # NOTE: cloudflared tunnel-reuse (existing tunnel + signed Wait-BotWebhook
    # verification) lives in the launcher main flow, not in a function, so it
    # has no isolated unit coverage here; it is verified by manual startup runs.
  `;
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, TEST_LAUNCHER_PATH: fileURLToPath(new URL('../line-ai/start-bot.ps1', import.meta.url)) },
    timeout: 20000,
  });
});
