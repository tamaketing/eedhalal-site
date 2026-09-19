// EED HALAL — LINE Push provider (owner-approved sends only).
// Small isolated module: validates input, POSTs the Push API once per call,
// and classifies the outcome. It NEVER mutates Draft state, stores nothing,
// and logs nothing sensitive — the service layer owns state transitions.
// Tests inject fetchImpl; production passes the global fetch. No network call
// happens unless this function is explicitly invoked by the send service.

import { ValidationError } from './errors.mjs';

export const PUSH_URL = 'https://api.line.me/v2/bot/message/push';
export const PUSH_TIMEOUT_MS = 10000;
export const MAX_TEXT_LENGTH = 5000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// LINE user IDs issued to bots start with U followed by 32 hex characters.
const USER_ID_RE = /^U[0-9a-f]{32}$/i;
// A 409 means "already accepted" ONLY when the provider says the retry key
// (or an equivalent duplicate-delivery marker) is the cause. Any other 409
// is an ordinary non-retryable failure.
const ACCEPTED_409_RE = /already accepted|duplicate|retry key/i;

function fail(code, httpStatus) {
  const error = new Error(`line push failed: ${code}`);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

export async function sendPushMessage({ token, userId, text, retryKey, timeoutMs = PUSH_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  if (typeof token !== 'string' || !token) throw fail('NOT_CONFIGURED');
  if (typeof userId !== 'string' || !USER_ID_RE.test(userId)) {
    throw new ValidationError('line push needs a valid LINE user identity');
  }
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT_LENGTH) {
    throw new ValidationError('line push needs non-empty text within provider limits');
  }
  if (typeof retryKey !== 'string' || !UUID_RE.test(retryKey)) {
    throw new ValidationError('line push needs a UUID retry key');
  }
  let response;
  try {
    response = await fetchImpl(PUSH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Line-Retry-Key': retryKey,
      },
      body: JSON.stringify({ to: userId, messages: [{ type: 'text', text }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error && error.name === 'TimeoutError') return { outcome: 'RETRYABLE_FAILURE', code: 'TIMEOUT' };
    return { outcome: 'RETRYABLE_FAILURE', code: 'NETWORK_ERROR' };
  }
  const status = response.status;
  if (status >= 200 && status < 300) return { outcome: 'ACCEPTED', code: `HTTP_${status}`, httpStatus: status };
  let detail = '';
  try {
    const body = await response.text();
    detail = String(body || '').slice(0, 200);
  } catch {
    detail = '';
  }
  if (status === 409 && ACCEPTED_409_RE.test(detail)) {
    return { outcome: 'ALREADY_ACCEPTED', code: 'HTTP_409_ACCEPTED', httpStatus: status };
  }
  if (status >= 500) return { outcome: 'RETRYABLE_FAILURE', code: `HTTP_${status}`, httpStatus: status };
  return { outcome: 'NON_RETRYABLE_FAILURE', code: `HTTP_${status}`, httpStatus: status };
}
