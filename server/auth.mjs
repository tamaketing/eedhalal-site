// EED HALAL — internal API authentication (machine-to-machine shared secret).
// The secret comes from EED_INTERNAL_API_SECRET only: never hardcoded, never
// logged, never returned. Comparison is constant-time over SHA-256 digests so
// secret length does not leak. Designed to be swappable (token service, mTLS)
// without touching domain services: callers only use requireInternalAuth().

import { createHash, timingSafeEqual } from 'node:crypto';
import { UnauthorizedError } from '../services/errors.mjs';

function digest(value) {
  return createHash('sha256').update(String(value), 'utf8').digest();
}

export function extractBearer(headers) {
  const raw = headers.authorization || headers.Authorization;
  if (!raw) return null;
  const match = String(raw).match(/^Bearer\s+(\S+)$/);
  return match ? match[1] : null;
}

export function secretsMatch(received, expected) {
  if (!received || !expected) return false;
  const a = digest(received);
  const b = digest(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireInternalAuth(headers, env = process.env) {
  const expected = env.EED_INTERNAL_API_SECRET;
  if (!expected) throw new UnauthorizedError('internal api not configured');
  if (!secretsMatch(extractBearer(headers), expected)) throw new UnauthorizedError('unauthorized');
  return true;
}
