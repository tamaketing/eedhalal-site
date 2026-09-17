import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

test('gateway verifies LINE probes and forwards only actual signed events', async (t) => {
  const forwarded = [];
  let upstreamStatus = 200;
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    forwarded.push({ body: Buffer.concat(chunks).toString(), secret: req.headers['x-eed-webhook-secret'] });
    res.writeHead(upstreamStatus).end('{}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const secret = 'local-test-line-secret';
  const child = spawn(process.execPath, [fileURLToPath(new URL('../line-ai/webhook-gateway.mjs', import.meta.url))], {
    env: { ...process.env, LINE_CHANNEL_SECRET: secret, EED_WEBHOOK_FORWARD_SECRET: 'test-forward-secret',
      N8N_INTERNAL_WEBHOOK_URL: `http://127.0.0.1:${upstream.address().port}/webhook/line-webhook`,
      LINE_GATEWAY_HOST: '127.0.0.1', LINE_GATEWAY_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  });
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Gateway startup timed out')), 10000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Gateway exited before readiness')); });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
  });
  async function post(body, signed = true) {
    return fetch(`${base}/line-webhook`, {
      method: 'POST', body, headers: { 'content-type': 'application/json',
        ...(signed ? { 'x-line-signature': createHmac('sha256', secret).update(body).digest('base64') } : {}) },
    });
  }
  const probe = JSON.stringify({ destination: 'test-bot', events: [] });
  await t.test('unsigned verification cannot bypass signature validation', async () => {
    assert.equal((await post(probe, false)).status, 401);
    assert.equal(forwarded.length, 0);
  });
  await t.test('signed verification succeeds without involving n8n', async () => {
    upstreamStatus = 503;
    const response = await post(probe);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'accepted' });
    assert.equal(forwarded.length, 0);
  });
  await t.test('malformed signed payload is rejected', async () => {
    for (const body of ['{', 'null', '{}', '{"events":{}}']) assert.equal((await post(body)).status, 400);
    assert.equal(forwarded.length, 0);
  });
  await t.test('actual event keeps raw body and private forwarding secret', async () => {
    upstreamStatus = 200;
    const body = '{ "events": [{"type":"message","message":{"type":"text","text":"test"}}] }';
    assert.equal((await post(body)).status, 200);
    assert.deepEqual(forwarded, [{ body, secret: 'test-forward-secret' }]);
    upstreamStatus = 500;
    assert.equal((await post(body)).status, 503);
  });
  await t.test('browser GET cannot execute the webhook', async () => {
    assert.equal((await fetch(`${base}/line-webhook`)).status, 404);
  });
  await t.test('Windows launcher probe accepts valid gateway and rejects incorrect secrets', {
    skip: process.platform !== 'win32',
  }, async () => {
    const command = `
      $ErrorActionPreference = 'Stop'
      $tokens = $null; $parseErrors = $null
      $ast = [Management.Automation.Language.Parser]::ParseFile($env:TEST_LAUNCHER_PATH, [ref]$tokens, [ref]$parseErrors)
      if ($parseErrors.Count) { throw 'Launcher syntax error' }
      $function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Wait-BotWebhook' }, $true)
      Invoke-Expression $function.Extent.Text
      Wait-BotWebhook $env:TEST_GATEWAY_URL $null 0
      $env:LINE_CHANNEL_SECRET = 'incorrect-secret'
      $rejected = $false
      try { Wait-BotWebhook $env:TEST_GATEWAY_URL $null 0 } catch { $rejected = $true }
      if (-not $rejected) { throw 'Accepted invalid signature' }
    `;
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      env: { ...process.env, LINE_CHANNEL_SECRET: secret, TEST_GATEWAY_URL: base,
        TEST_LAUNCHER_PATH: fileURLToPath(new URL('../line-ai/start-bot.ps1', import.meta.url)) },
      timeout: 20000,
    });
  });
});
