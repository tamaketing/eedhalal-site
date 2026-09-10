import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const lineAi = new URL('../line-ai/', import.meta.url);
const [gateway, workflow, planner, plannerPage, envExample, retentionWorkflow, uptimeWorkflow, pagesWorkflow] = await Promise.all([
  readFile(new URL('../line-ai/webhook-gateway.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../line-ai/n8n-workflow.json', import.meta.url), 'utf8'),
  readFile(new URL('../js/budget-planner.js', import.meta.url), 'utf8'),
  readFile(new URL('../budget-planner.html', import.meta.url), 'utf8'),
  readFile(new URL('../.env.example', import.meta.url), 'utf8'),
  readFile(new URL('../line-ai/data-retention-workflow.json', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/uptime.yml', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8'),
]);

test('LINE gateway verifies the raw LINE signature before forwarding', () => {
  assert.match(gateway, /createHmac\('sha256', process\.env\.LINE_CHANNEL_SECRET\)/);
  assert.match(gateway, /timingSafeEqual/);
  assert.match(gateway, /x-line-signature/);
  assert.match(gateway, /EED_WEBHOOK_FORWARD_SECRET/);
  assert.match(gateway, /\/healthz/);
});

test('n8n workflow rejects requests that bypass the verified gateway', () => {
  const parsed = JSON.parse(workflow);
  assert.ok(parsed.nodes.some((node) => node.name === 'Verify Webhook Gateway'));
  assert.equal(parsed.connections['LINE Webhook'].main[0][0].node, 'Verify Webhook Gateway');
  assert.match(workflow, /EED_WEBHOOK_FORWARD_SECRET/);
});

test('planner no longer claims a browser PIN is authentication', () => {
  assert.doesNotMatch(planner, /var PIN\s*=/);
  assert.doesNotMatch(plannerPage, /PIN\s*2024|\?key=2024/);
  assert.match(plannerPage, /ไม่มีระบบยืนยันตัวตน/);
});

test('operation configuration is externalized and retention automation is defined', () => {
  for (const name of ['LINE_CHANNEL_SECRET', 'EED_WEBHOOK_FORWARD_SECRET', 'N8N_API_KEY', 'LEADS_DIR', 'LEAD_RETENTION_DAYS', 'BOT_HEALTH_URL', 'BOT_MONITORING_ENABLED']) {
    assert.match(envExample, new RegExp(`^${name}=`, 'm'));
  }
  assert.equal(JSON.parse(retentionWorkflow).name, 'EED HALAL - Purge Conversation Memory');
});

test('line-ai source has no direct SQLite manipulation scripts', async () => {
  const files = await readdir(lineAi);
  const scripts = files.filter((file) => file.endsWith('.js') || file.endsWith('.mjs'));
  const sources = await Promise.all(scripts.map((file) => readFile(new URL(file, lineAi), 'utf8')));
  assert.ok(sources.every((source) => !/require\([^)]*sqlite|database\.sqlite/i.test(source)));
});

test('production smoke checks run after Pages deploy and on a schedule', () => {
  assert.match(uptimeWorkflow, /node scripts\/smoke-production\.mjs/);
  assert.match(uptimeWorkflow, /cron:/);
  assert.match(pagesWorkflow, /needs: deploy/);
  assert.match(pagesWorkflow, /node scripts\/smoke-production\.mjs/);
  assert.match(pagesWorkflow, /! -name 'budget-planner\.html'/);
  assert.match(pagesWorkflow, /! -name 'kitchen-order\.html'/);
});
