const siteUrl = process.env.SITE_URL;
const botHealthUrl = process.env.BOT_MONITORING_ENABLED === 'true' ? process.env.BOT_HEALTH_URL : '';
const alertWebhookUrl = process.env.ALERT_WEBHOOK_URL;

if (!siteUrl) throw new Error('SITE_URL is required.');
if (process.env.BOT_MONITORING_ENABLED === 'true' && !botHealthUrl) throw new Error('BOT_HEALTH_URL is required when BOT_MONITORING_ENABLED=true.');

function url(path) {
  return new URL(path, siteUrl).toString();
}

async function check(name, target, timeoutMs = 10000) {
  const startedAt = Date.now();
  const response = await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${name} returned ${response.status}`);
  return { name, status: response.status, durationMs: Date.now() - startedAt };
}

async function notify(message) {
  if (!alertWebhookUrl) return;
  await fetch(alertWebhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: message }),
    signal: AbortSignal.timeout(10000),
  });
}

try {
  const checks = await Promise.all([
    check('site_home', url('/')),
    check('site_calculator', url('/budget-calculator.html')),
    ...(botHealthUrl ? [check('bot_health', botHealthUrl)] : []),
  ]);
  console.log(JSON.stringify({ status: 'ok', checks }));
} catch (error) {
  const message = `EED HALAL smoke check failed: ${error.message}`;
  try { await notify(message); } catch {}
  throw error;
}
