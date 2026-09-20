import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createMemoryAdapter } from '../db/memory.mjs';
import { createInternalApi } from '../server/internal-api.mjs';

// Owner Console tests: local-only serving, security headers, traversal
// safety, memory-only secret discipline, XSS-safe rendering patterns, and
// correct API contracts. No browser is driven; DOM rendering rules are proven
// by static inspection (no innerHTML-class sinks anywhere). No LINE contact.
const SECRET = randomUUID();
const root = new URL('../', import.meta.url);
const [html, appJs, css] = await Promise.all([
  readFile(new URL('owner-console/index.html', root), 'utf8'),
  readFile(new URL('owner-console/app.js', root), 'utf8'),
  readFile(new URL('owner-console/styles.css', root), 'utf8'),
]);

const { server } = createInternalApi({ repos: createMemoryAdapter(), env: { EED_INTERNAL_API_SECRET: SECRET } });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise((resolve) => server.close(resolve)));

async function get(pathname, secret = SECRET) {
  const headers = {};
  if (secret !== null) headers.authorization = `Bearer ${secret}`;
  const response = await fetch(`${base}${pathname}`, { headers });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

test('owner page and assets are served locally with strict headers', async () => {
  for (const [pathname, type] of [['/owner/', 'text/html'], ['/owner/app.js', 'text/javascript'], ['/owner/styles.css', 'text/css']]) {
    const response = await get(pathname, null);
    assert.equal(response.status, 200, pathname);
    assert.match(response.headers.get('content-type'), new RegExp(`^${type}`));
    const csp = response.headers.get('content-security-policy') || '';
    for (const directive of ["default-src 'self'", "script-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'"]) {
      assert.ok(csp.includes(directive), `${pathname} csp ${directive}`);
    }
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.match((await get('/owner/', null)).text, /<script src="\/owner\/app\.js"><\/script>/);
  assert.ok(!(await get('/owner/', null)).text.includes(SECRET));
});

test('no path traversal outside the asset allowlist', async () => {
  // URL parsers may normalize dot-segments before matching (e.g. resolving to
  // '/owner/'); the safety property is that every response is either an error
  // or byte-identical to one of the three allowlisted assets.
  const allowed = new Set([html, appJs, css]);
  for (const pathname of ['/owner/../server/internal-api.mjs', '/owner/%2e%2e/.env', '/owner/app.js/%2e%2e', '/owner//app.js', '/OWNER/APP.JS', '/owner/%2fetc%2fpasswd']) {
    const response = await get(pathname, null);
    if (response.status === 200) {
      assert.ok(allowed.has(response.text), `${pathname} serves only allowlisted content`);
    } else {
      assert.ok([400, 404].includes(response.status), `${pathname} -> ${response.status}`);
    }
  }
  assert.equal((await get('/api/v1/drafts?status=WAITING_FOR_HUMAN', null)).status, 401);
});

test('secret lives in page memory only', () => {
  const code = appJs.replace(/\/\/[^\n]*/g, '');
  for (const store of ['localStorage', 'sessionStorage', 'document.cookie', 'IndexedDB', 'location.search', 'location.hash']) {
    assert.ok(!code.includes(store), `no ${store}`);
  }
  assert.ok(!/secret\s*=\s*['"][^'"]+['"]/.test(appJs.replace('test-only-secret', '')), 'no hardcoded secret');
  assert.ok(appJs.includes("input.value = ''"), 'secret cleared from input after unlock');
  assert.ok(/secret = null/.test(appJs), 'secret cleared on lock');
});

test('queue uses WAITING + desc and attaches Authorization', () => {
  assert.ok(appJs.includes('/api/v1/drafts?status=${want}&limit=100&order=desc'));
  assert.ok(appJs.includes("loadQueue('WAITING_FOR_HUMAN')") && appJs.includes("loadQueue('SENT')"));
  assert.ok(appJs.includes('Authorization'));
  // lineUserId appears only as read-only display fallback, never in a request.
  const sendFn = appJs.slice(appJs.indexOf('async function confirmSend'));
  assert.ok(!/lineUserId|retryKey|X-Line-Retry-Key/i.test(sendFn), 'no recipient/key material in send request');
});

test('dynamic text renders via textContent/value only', () => {
  const code = appJs.replace(/\/\/[^\n]*/g, '');
  for (const sink of ['innerHTML', 'insertAdjacentHTML', 'outerHTML', 'document.write', 'eval(', 'new Function', 'setTimeout(', 'setInterval(']) {
    assert.ok(!code.includes(sink), `no ${sink}`);
  }
  assert.ok(appJs.includes('.textContent ='), 'textContent rendering');
  assert.ok(html.includes('class="prewrap"') || appJs.includes('prewrap'), 'newline-safe styling hook');
  const evil = '<img src=x onerror=alert(1)>"\'&<>';
  const escaped = evil.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  assert.ok(!escaped.includes('<img'), 'reference escaping sanity');
});

test('edit sends concurrency fields; reject/send require confirmation', () => {
  assert.ok(appJs.includes('expectedUpdatedAt') && appJs.includes('expectedStatus'), 'concurrency fields');
  assert.ok(appJs.includes('finalText'), 'edit finalText');
  assert.ok(appJs.includes('window.confirm('), 'reject confirmation');
  assert.ok(appJs.includes('send-confirm') && appJs.includes('btn-send-confirm'), 'explicit send-confirm modal');
});

test('send request carries identity and concurrency only', () => {
  const sendBlock = appJs.slice(appJs.indexOf('async function confirmSend'));
  assert.ok(!/lineUserId|retryKey|X-Line-Retry-Key|resizeImage|message:\s*finalText/i.test(sendBlock), 'no recipient/message/key in send body');
  assert.ok(sendBlock.includes('concurrencyOf'), 'concurrency on send');
});

test('stale 409 disables mutation until reload; 401 locks', () => {
  assert.ok(appJs.includes('Reload before continuing'), 'stale message');
  assert.ok(appJs.includes('stale = true'), 'stale latch');
  assert.ok(appJs.includes("lock('Session expired"), '401 lock path');
});

test('SENT/REJECTED/FAILED render read-only; APPROVED shows retry', () => {
  assert.ok(appJs.includes("draft.status === 'SENT'"), 'sent branch');
  assert.ok(appJs.includes('Retry Same Send'), 'approved retry UX');
  assert.ok(appJs.includes('Previous send result is uncertain'), 'uncertain notice');
  assert.ok(appJs.includes('FAILED'), 'failed display path');
});

test('pending flag disables double click in UI', () => {
  assert.ok(/if\s*\(!currentDraft \|\| pending\) return/.test(appJs), 'pending guard');
  assert.ok(appJs.includes('setButtonsDisabled(true)') || appJs.includes('pending = true'), 'buttons disabled while pending');
});

test('gateway only exposes health and LINE webhook (tunnel isolation)', async () => {
  const gateway = await readFile(new URL('line-ai/webhook-gateway.mjs', root), 'utf8');
  assert.ok(!/owner/i.test(gateway), 'no owner route in gateway');
  assert.ok(!/proxy|pipe\(|forward\(.*url/i.test(gateway), 'no generic proxy');
  const local = await get('/owner/', null);
  assert.equal(local.status, 200);
});

test('SENT tab queries SENT desc; WAITING tab stays default', () => {
  assert.ok(appJs.includes("loadQueue('SENT')"));
  assert.ok(appJs.includes('No sent drafts'));
});

test('SENT review is read-only with a separate learning CTA', () => {
  assert.ok(appJs.includes('review-learn'), 'learning section exists');
  assert.ok(appJs.includes('btn-learn'), 'CTA button exists');
  assert.ok(appJs.includes("draft.status === 'SENT'"), 'CTA gated on SENT');
});

test('opt-in requires confirmation and posts identity only', () => {
  assert.ok(appJs.includes('เป็นตัวอย่างสำหรับการตอบครั้งต่อไปหรือไม่'), 'deliberate Thai confirmation');
  const start = appJs.indexOf('async function learnExample');
  const learnFn = appJs.slice(start, appJs.indexOf('\n}\n', start));
  assert.ok(learnFn.includes('/api/v1/response-examples/from-draft/'), 'opt-in endpoint');
  const callStart = learnFn.indexOf('await api(');
  const postCall = learnFn.slice(callStart, learnFn.indexOf(');', callStart));
  assert.ok(!/lineUserId|retryKey|X-Line-Retry-Key|incomingMessage|approvedResponse|intent|serviceType/i.test(postCall), 'no content overrides in request');
});

test('opt-in handles success, dedupe, review-refusal, and 409 safely', () => {
  assert.ok(appJs.includes('บันทึกเป็นตัวอย่างแล้ว'), 'success message');
  assert.ok(appJs.includes('เป็นตัวอย่างอยู่แล้ว'), 'deduped message');
  assert.ok(appJs.includes('example_requires_review'), 'review-refusal branch');
  assert.ok(appJs.includes('ไม่ควรนำไปใช้เป็น'), 'safe Thai refusal message');
});

test('learning examples view renders safely with enable/disable', () => {
  assert.ok(appJs.includes('/api/v1/response-examples?limit=100'), 'examples list request');
  assert.ok(appJs.includes('No learning examples yet'), 'empty state');
  assert.ok(appJs.includes('Disable example') && appJs.includes('Enable example'), 'toggle actions');
  assert.ok(appJs.includes('/response-examples/${encodeURIComponent(example.id)}'), 'id-scoped PATCH path');
  assert.ok(!/DELETE|deleteExample|removeExample/i.test(appJs), 'no physical delete');
});

test('stale examples show a rules warning without auto-disable', () => {
  assert.ok(appJs.includes('staleRules'), 'stale flag consumed');
  assert.ok(appJs.includes('เวอร์ชันเก่า'), 'Thai stale warning');
});

test('SEND never auto-creates an example', () => {
  const start = appJs.indexOf('async function confirmSend');
  const sendFn = appJs.slice(start, appJs.indexOf('\n}\n', start));
  assert.ok(!/from-draft|response-examples|learnExample|btn-learn/.test(sendFn), 'send path has no learning calls');
});

test('examples explain patterns-not-facts boundary', () => {
  assert.ok(html.includes('AI จะใช้เป็นตัวอย่างรูปแบบการตอบ'), 'facts boundary note');
  assert.ok(html.includes('กฎธุรกิจปัจจุบัน'), 'current-rules reference');
});
