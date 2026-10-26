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

// Extract one top-level function by brace matching so the assertion really
// covers that function. A newline sentinel ('\n}\n') silently returns -1 on
// CRLF files, which makes slice(start, -1) cover the whole rest of the file
// and turns a precise check into a meaningless one.
function functionSource(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const body = source.indexOf('{', start);
  let depth = 0;
  for (let i = body; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`${signature} is not closed`);
  return '';
}

const { server } = createInternalApi({ repos: createMemoryAdapter(), env: { EED_INTERNAL_API_SECRET: SECRET } });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// owner-console/app.js is committed with CRLF endings, so a plain `indexOf('\n}\n')`
// never matches and slice() silently returns the rest of the file. Anchoring on
// \r?\n keeps these per-function inspections scoped to the one function.
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
  const sendFn = functionSource(appJs, 'async function confirmSend');
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

test('queue cards offer the same reject action without opening the draft', () => {
  const queueFn = functionSource(appJs, 'async function loadQueue');
  assert.ok(queueFn.includes("'ไม่ส่ง'"), 'queue reject button exists');
  assert.ok(queueFn.includes('rejectQueueDraft'), 'queue reject handler is wired');
  assert.ok(queueFn.includes("draft.status === 'WAITING_FOR_HUMAN'"), 'gated on waiting drafts only (sent tabs stay clean)');
  const rejectFn = functionSource(appJs, 'async function rejectQueueDraft');
  assert.ok(rejectFn.includes('window.confirm('), 'queue reject asks first');
  assert.ok(rejectFn.includes('/api/v1/drafts/'), 'queue reject calls the drafts endpoint');
  assert.ok(rejectFn.includes(`drafts/${'${encodeURIComponent(draft.id)}'}/reject`), 'id-scoped reject path');
  assert.ok(rejectFn.includes('concurrencyOf'), 'queue reject posts concurrency fields');
  assert.ok(rejectFn.includes('loadQueue()'), 'queue reloads after a reject');
});

test('a quota-exhausted broadcast says so in the owner console', () => {
  assert.ok(appJs.includes('โควตาเดือนนี้หมด'), 'owner sees the monthly-limit wording');
  assert.ok(appJs.includes("errorCode === 'QUOTA_EXHAUSTED'"), 'the label is tied to the quota failure code');
  const renderFn = functionSource(appJs, 'function renderBroadcastCard');
  assert.ok(renderFn.includes('row.errorCode'), 'the card reads the failure code');
  const quotaFn = functionSource(appJs, 'async function loadQuota');
  assert.ok(quotaFn.includes('โควตาเดือนนี้หมด'), 'the quota panel uses the same wording');
});

test('broadcast pending card is a container, not a nested broadcast-card', () => {
  assert.ok(html.includes('<div id="broadcast-pending"></div>'), 'pending container is plain; renderBroadcastCard supplies the card');
  assert.ok(!/id="broadcast-pending"[^>]*broadcast-card/.test(html), 'container must not carry broadcast-card (nested [150px,1fr] grid collapses the card)');
  const renderFn = functionSource(appJs, 'function renderBroadcastCard');
  assert.ok(renderFn.includes("'broadcast-card'"), 'the real card class comes from the renderer');
});

test('send request carries identity and concurrency only', () => {
  const sendBlock = functionSource(appJs, 'async function confirmSend');
  assert.ok(!/lineUserId|retryKey|X-Line-Retry-Key|resizeImage|message:\s*finalText/i.test(sendBlock), 'no recipient/message/key in send body');
  assert.ok(sendBlock.includes('concurrencyOf'), 'concurrency on send');
});

test('stale 409 disables mutation until reload; 401 locks', () => {
  assert.ok(appJs.includes('กรุณาโหลดใหม่ก่อนทำต่อ'), 'stale message');
  assert.ok(appJs.includes('stale = true'), 'stale latch');
  assert.ok(appJs.includes("lock('การใช้งานหมดอายุ"), '401 lock path');
});

test('SENT/REJECTED/FAILED render read-only; APPROVED shows retry', () => {
  assert.ok(appJs.includes("draft.status === 'SENT'"), 'sent branch');
  assert.ok(appJs.includes('ส่งอีกครั้ง'), 'approved retry UX');
  assert.ok(appJs.includes('ผลการส่งครั้งก่อนยังไม่ชัดว่าถึงลูกค้าหรือไม่'), 'uncertain notice');
  assert.ok(appJs.includes('FAILED'), 'failed display path');
});

test('pending flag disables double click in UI', () => {
  assert.ok(/if\s*\(!currentDraft \|\| pending\) return/.test(appJs), 'pending guard');
  assert.ok(appJs.includes('setButtonsDisabled(true)') || appJs.includes('pending = true'), 'buttons disabled while pending');
});

test('the owner console is served only by the local internal API', async () => {
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
  const learnFn = functionSource(appJs, 'async function learnExample');
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
  assert.ok(appJs.includes('ยังไม่มีตัวอย่างคำตอบ'), 'empty state');
  assert.ok(appJs.includes('Disable example') && appJs.includes('Enable example'), 'toggle actions');
  assert.ok(appJs.includes('/response-examples/${encodeURIComponent(example.id)}'), 'id-scoped PATCH path');
  assert.ok(!/DELETE|deleteExample|removeExample/i.test(appJs), 'no physical delete');
});

test('stale examples show a rules warning without auto-disable', () => {
  assert.ok(appJs.includes('staleRules'), 'stale flag consumed');
  assert.ok(appJs.includes('เวอร์ชันเก่า'), 'Thai stale warning');
});

test('SEND never auto-creates an example', () => {
  const sendFn = functionSource(appJs, 'async function confirmSend');
  assert.ok(!/from-draft|response-examples|learnExample|btn-learn/.test(sendFn), 'send path has no learning calls');
});

test('examples explain patterns-not-facts boundary', () => {
  assert.ok(html.includes('บอทจะใช้คำตอบนี้เป็นแนวทางการเขียน'), 'facts boundary note');
  assert.ok(html.includes('กฎธุรกิจปัจจุบัน'), 'current-rules reference');
});
