// EED HALAL — LINE Broadcast provider (owner-approved scheduled sends only).
// Same shape as services/linePush.mjs: small isolated module, no state, no
// storage, no logging of message content, injectable fetchImpl, and it is
// called ONLY from services/broadcasts.mjs settle functions (runner outside
// server/services/db). This is the single reviewed file allowed to contain
// the /v2/bot/message/broadcast endpoint (test Q+R); multicast stays
// forbidden everywhere.
//
// Why an endpoint-specific module exists at all: X-Line-Retry-Key (UUID)
// makes replays after a crash espace-safe, and every retry of one
// announcement reuses the SAME frozen key, so LINE deduplicates delivery.

import { ValidationError } from './errors.mjs';

export const BROADCAST_URL = 'https://api.line.me/v2/bot/message/broadcast';
export const QUOTA_URL = 'https://api.line.me/v2/bot/message/quota';
export const CONSUMPTION_URL = 'https://api.line.me/v2/bot/message/quota/consumption';
export const TIMEOUT_MS = 10000;
export const MAX_MESSAGES = 5;
export const MAX_TEXT_LENGTH = 5000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTPS_URL_RE = /^https:\/\/\S+$/i;
const ACCEPTED_409_RE = /already accepted|duplicate|retry key/i;

function fail(code, httpStatus) {
  const error = new Error(`line broadcast failed: ${code}`);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

// messages: at most 5 LINE messages; text ≤ 5000 chars; image needs absolute
// https urls ( Broadcast image messages are fetched from a public url, e.g.
// the published site menu photos at https://eedhalal.com/img/... ).
export function validateBroadcastMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGES) {
    throw new ValidationError('line broadcast needs 1-5 messages');
  }
  for (const message of messages) {
    if (!message || typeof message !== 'object') throw new ValidationError('invalid broadcast message');
    if (message.type === 'text') {
      if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > MAX_TEXT_LENGTH) {
        throw new ValidationError('line broadcast text must be 1-5000 characters');
      }
    } else if (message.type === 'image') {
      if (!HTTPS_URL_RE.test(String(message.originalContentUrl || ''))) {
        throw new ValidationError('broadcast image originalContentUrl must be https');
      }
      if (!HTTPS_URL_RE.test(String(message.previewImageUrl || ''))) {
        throw new ValidationError('broadcast image previewImageUrl must be https');
      }
    } else {
      throw new ValidationError(`unsupported broadcast message type: ${message.type}`);
    }
  }
}

export async function sendBroadcastMessages({ token, messages, retryKey, timeoutMs = TIMEOUT_MS, fetchImpl = fetch } = {}) {
  if (typeof token !== 'string' || !token) throw fail('NOT_CONFIGURED');
  validateBroadcastMessages(messages);
  if (typeof retryKey !== 'string' || !UUID_RE.test(retryKey)) {
    throw new ValidationError('line broadcast needs a UUID retry key');
  }
  let response;
  try {
    response = await fetchImpl(BROADCAST_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Line-Retry-Key': retryKey,
      },
      body: JSON.stringify({ messages }),
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
  // A monthly-limit 429 will not clear by retrying. Fail closed as
  // QUOTA_EXHAUSTED so the owner sees the real reason instead of three
  // identical retries ending in RETRY_EXHAUSTED.
  if (status === 429 && /monthly limit/i.test(detail)) {
    return { outcome: 'NON_RETRYABLE_FAILURE', code: 'QUOTA_EXHAUSTED', httpStatus: status };
  }
  // Other 429s (short rate limits) and 5xx stay retryable: the runner replays
  // the same frozen key and the owner sees FAILED only after the budget.
  if (status === 429 || status >= 500) return { outcome: 'RETRYABLE_FAILURE', code: `HTTP_${status}`, httpStatus: status };
  return { outcome: 'NON_RETRYABLE_FAILURE', code: `HTTP_${status}`, httpStatus: status };
}

// Quota + usage probes. ok=false keeps the reason code so the runner can
// surface 'NOT_CONFIGURED' vs a transient LINE problem without guessing.
export async function getMessageQuota({ token, fetchImpl = fetch } = {}) {
  if (typeof token !== 'string' || !token) return { ok: false, code: 'NOT_CONFIGURED' };
  try {
    const response = await fetchImpl(QUOTA_URL, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return { ok: false, code: `HTTP_${response.status}` };
    const body = await response.json();
    // LINE returns { type: 'limited', value: N }; keep our internal shape as
    // { ok: true, type: 'limited', limit: N } so callers have a stable field.
    return { ok: true, type: body.type, limit: body.type === 'limited' ? Number(body.value) : null };
  } catch {
    return { ok: false, code: 'NETWORK_ERROR' };
  }
}

export async function getMessageConsumption({ token, fetchImpl = fetch } = {}) {
  if (typeof token !== 'string' || !token) return { ok: false, code: 'NOT_CONFIGURED' };
  try {
    const response = await fetchImpl(CONSUMPTION_URL, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return { ok: false, code: `HTTP_${response.status}` };
    const body = await response.json();
    // LINE returns { totalUsage: N } from /v2/bot/message/quota/consumption.
    const total = Number(body.totalUsage);
    return { ok: true, total: Number.isFinite(total) ? total : 0 };
  } catch {
    return { ok: false, code: 'NETWORK_ERROR' };
  }
}
