// EED HALAL — privacy sanitizer. Every object persisted to metadata,
// audit data, or logs passes through here first.
//
// Drops: secrets/credentials/tokens, request headers, raw bodies, and any
// value that looks like a live credential. Truncates long strings so a chatty
// model cannot bloat the database.

const SENSITIVE_KEY = /(secret|password|passwd|api[_-]?key|authorization|cookie|credential|private[_-]?key|client[_-]?secret|access[_-]?key|session[_-]?id|x-[a-z-]+signature|(^|[_-])token([_-]|$))/i;
// replyToken is explicitly allowed: the future owner-approved sender needs it
// to reply in-window, and it is a short opaque value (never a bearer secret).
const ALLOWED_KEY = /^(replyToken)$/;
const BEARER_VALUE = /Bearer\s+[A-Za-z0-9\-_~+/=]{20,}/;
const LONG_TOKEN_VALUE = /\b[A-Za-z0-9\-_~+/=]{40,}\b/;
const MAX_STRING = 2000;
const MAX_DEPTH = 6;

export function looksLikeSecret(key, value) {
  if (ALLOWED_KEY.test(String(key || ''))) return false;
  if (SENSITIVE_KEY.test(String(key || ''))) return true;
  if (typeof value === 'string' && (BEARER_VALUE.test(value) || LONG_TOKEN_VALUE.test(value))) return true;
  return false;
}

function clean(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return '[truncated]';
  if (typeof value === 'string') {
    if (BEARER_VALUE.test(value) || LONG_TOKEN_VALUE.test(value)) return '[redacted]';
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}[truncated]` : value;
  }
  if (Array.isArray(value)) return value.map((item) => clean(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (!ALLOWED_KEY.test(key) && SENSITIVE_KEY.test(key)) continue;
      if (looksLikeSecret(key, item)) continue;
      out[key] = clean(item, depth + 1);
    }
    return out;
  }
  return value;
}

// Metadata stored on drafts/leads: plain data only, never transport details.
// Keys that look sensitive are dropped; suspicious VALUES under innocent keys
// are redacted/truncated by clean() (a long legit message must survive).
export function sanitizeMetadata(input) {
  if (!input || typeof input !== 'object') return {};
  const drop = new Set(['headers', 'rawBody', 'raw_body', 'authorization', 'cookie', 'signature', 'replyTokenRaw']);
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (drop.has(key)) continue;
    if (!ALLOWED_KEY.test(key) && SENSITIVE_KEY.test(key)) continue;
    out[key] = clean(value);
  }
  return out;
}

// Audit payloads: same rules, applied to before/after snapshots.
export function sanitizeAuditData(input) {
  if (input === null || input === undefined) return input;
  if (typeof input !== 'object') return clean(input);
  return clean(input);
}
