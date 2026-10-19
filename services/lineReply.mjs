// EED HALAL — LINE Reply provider (auto-reply only).
//
// The Reply API answers the message that JUST arrived, using its replyToken.
// It is the free lane (no push quota) and must be used within LINE's short
// reply window, so this module is invoked in-memory right after drafting —
// the replyToken is never persisted and never crosses the Internal API.
//
// Same isolation discipline as linePush.mjs: validate input, POST once, and
// classify the outcome. It never mutates Draft state, stores nothing, and
// logs nothing sensitive. Tests inject fetchImpl.

import { ValidationError } from './errors.mjs';

export const REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
export const REPLY_TIMEOUT_MS = 10000;
export const MAX_TEXT_LENGTH = 5000;

// LINE reply tokens are opaque, ~20-60 chars, single-use. We only require a
// non-empty bounded string; the provider rejects a stale/used token at call.
const REPLY_TOKEN_RE = /^[A-Za-z0-9\-_~+/=]{10,256}$/;

function fail(code, httpStatus) {
  const error = new Error(`line reply failed: ${code}`);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

export async function sendReplyMessage({ token, replyToken, text, timeoutMs = REPLY_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  if (typeof token !== 'string' || !token) throw fail('NOT_CONFIGURED');
  if (typeof replyToken !== 'string' || !REPLY_TOKEN_RE.test(replyToken)) {
    throw new ValidationError('line reply needs a valid reply token');
  }
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT_LENGTH) {
    throw new ValidationError('line reply needs non-empty text within provider limits');
  }
  let response;
  try {
    response = await fetchImpl(REPLY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error && error.name === 'TimeoutError') return { outcome: 'RETRYABLE_FAILURE', code: 'TIMEOUT' };
    return { outcome: 'RETRYABLE_FAILURE', code: 'NETWORK_ERROR' };
  }
  const status = response.status;
  if (status >= 200 && status < 300) return { outcome: 'ACCEPTED', code: `HTTP_${status}`, httpStatus: status };
  if (status >= 500) return { outcome: 'RETRYABLE_FAILURE', code: `HTTP_${status}`, httpStatus: status };
  // 400 (bad/expired token), 401, 403 = the replyToken is gone; do not retry.
  return { outcome: 'NON_RETRYABLE_FAILURE', code: `HTTP_${status}`, httpStatus: status };
}
