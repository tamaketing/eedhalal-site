import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MAX_TEXT_LENGTH, PUSH_TIMEOUT_MS, PUSH_URL, sendPushMessage } from '../services/linePush.mjs';

// Isolated provider tests: fetchImpl is always stubbed, so no test ever
// contacts api.line.me. Secrets below are synthetic fixtures only.
const TOKEN = 'test-server-side-token';
const USER = 'U' + 'a'.repeat(32);
const KEY = randomUUID();

function stubFetch({ status = 200, body = '{}', signal = null, hang = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (signal) signal.aborted = options.signal.aborted;
    if (hang) await new Promise(() => {});
    return { status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { calls, fetchImpl };
}

test('push uses correct URL, server-side auth, retry key, and text body', async () => {
  const { calls, fetchImpl } = stubFetch();
  const out = await sendPushMessage({ token: TOKEN, userId: USER, text: 'สวัสดีค่ะ', retryKey: KEY, fetchImpl });
  assert.equal(out.outcome, 'ACCEPTED');
  assert.equal(calls.length, 1);
  const [url, options] = [calls[0].url, calls[0].options];
  assert.equal(url, PUSH_URL);
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.equal(options.headers['X-Line-Retry-Key'], KEY);
  assert.deepEqual(JSON.parse(options.body), { to: USER, messages: [{ type: 'text', text: 'สวัสดีค่ะ' }] });
  assert.ok(options.signal instanceof AbortSignal);
});

test('2xx accepted; retry-key accepted 409 treated as accepted', async () => {
  for (const status of [200, 201, 202]) {
    const { fetchImpl } = stubFetch({ status });
    assert.equal((await sendPushMessage({ token: TOKEN, userId: USER, text: 'x', retryKey: KEY, fetchImpl })).outcome, 'ACCEPTED');
  }
  const { fetchImpl } = stubFetch({ status: 409, body: { message: 'The request has already been accepted with the retry key' } });
  const out = await sendPushMessage({ token: TOKEN, userId: USER, text: 'x', retryKey: KEY, fetchImpl });
  assert.equal(out.outcome, 'ALREADY_ACCEPTED');
  assert.equal(out.code, 'HTTP_409_ACCEPTED');
});

test('ordinary 4xx incl. 429 are non-retryable failures', async () => {
  for (const [status, body] of [[400, { message: 'bad request' }], [401, { message: 'unauthorized' }], [403, { message: 'forbidden' }], [409, { message: 'conflict' }], [429, { message: 'too many requests' }]]) {
    const { fetchImpl } = stubFetch({ status, body });
    const out = await sendPushMessage({ token: TOKEN, userId: USER, text: 'x', retryKey: KEY, fetchImpl });
    assert.equal(out.outcome, 'NON_RETRYABLE_FAILURE', `status ${status}`);
    assert.equal(out.code, `HTTP_${status}`);
  }
});

test('timeout, network failure, and 5xx are retryable failures', async () => {
  const timeoutErr = new Error('timed out');
  timeoutErr.name = 'TimeoutError';
  const hanging = async () => { throw timeoutErr; };
  assert.equal((await sendPushMessage({ token: TOKEN, userId: USER, text: 'x', retryKey: KEY, fetchImpl: hanging })).code, 'TIMEOUT');
  const netFail = async () => { throw new Error('socket hang up'); };
  assert.equal((await sendPushMessage({ token: TOKEN, userId: USER, text: 'x', retryKey: KEY, fetchImpl: netFail })).code, 'NETWORK_ERROR');
  for (const status of [500, 502, 503]) {
    const { fetchImpl } = stubFetch({ status, body: 'error' });
    assert.equal((await sendPushMessage({ token: TOKEN, userId: USER, text: 'x', retryKey: KEY, fetchImpl })).outcome, 'RETRYABLE_FAILURE');
  }
});

test('malformed provider response never throws unstructured errors', async () => {
  const { fetchImpl } = stubFetch({ status: 400, body: undefined });
  const broken = async () => ({ status: 400, text: async () => { throw new Error('no body'); } });
  assert.equal((await sendPushMessage({ token: TOKEN, userId: USER, text: 'x', retryKey: KEY, fetchImpl: broken })).outcome, 'NON_RETRYABLE_FAILURE');
  assert.deepEqual(Object.keys(await sendPushMessage({ token: TOKEN, userId: USER, text: 'x', retryKey: KEY, fetchImpl })).sort(), ['code', 'httpStatus', 'outcome']);
});

test('invalid input fails before any network call', async () => {
  const cases = [
    [{ userId: 'Cgroupisnotuser', text: 'x', retryKey: KEY }],
    [{ userId: USER, text: '   ', retryKey: KEY }],
    [{ userId: USER, text: 'x'.repeat(MAX_TEXT_LENGTH + 1), retryKey: KEY }],
    [{ userId: USER, text: 'x', retryKey: 'not-a-uuid' }],
  ];
  for (const [input] of cases) {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return { status: 200, text: async () => '{}' }; };
    await assert.rejects(sendPushMessage({ token: TOKEN, fetchImpl, ...input }), { name: 'ValidationError' });
    assert.equal(calls, 0);
  }
  await assert.rejects(sendPushMessage({ token: '', userId: USER, text: 'x', retryKey: KEY, fetchImpl: async () => ({}) }), /NOT_CONFIGURED/);
});

test('no secret material leaks through errors or results', async () => {
  const { fetchImpl } = stubFetch({ status: 401, body: { message: 'Bearer abcdefghijklmnopqrstuvwxyz0123456789 is invalid' } });
  const out = await sendPushMessage({ token: TOKEN, userId: USER, text: 'x', retryKey: KEY, fetchImpl });
  assert.ok(!JSON.stringify(out).includes(TOKEN));
  assert.ok(!JSON.stringify(out).includes('Bearer'));
});
