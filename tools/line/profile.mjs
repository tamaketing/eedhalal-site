// EED HALAL — LINE profile transport (owner console names).
//
// The owner console should show a customer's LINE display name instead of a
// long `U...` identifier. LINE exposes the name to the bot through the
// Messaging API profile endpoint:
//
//   GET https://api.line.me/v2/bot/profile/{userId}
//   Authorization: Bearer <LINE_CHANNEL_ACCESS_TOKEN>
//
// This module lives under tools/ (not services/) on purpose: server/services/db
// must not contain outbound LINE transport code, as enforced by
// test/internal-api.test.mjs. It is fail-open: any error returns { ok: false }
// and never throws into the message pipeline.
import { PROFILE_TIMEOUT_MS, cleanDisplayName } from '../../services/lineProfile.mjs';

const PROFILE_URL = 'https://api.line.me/v2/bot/profile';

/**
 * Fetch a LINE user's display name.
 * @returns {Promise<{ok:boolean, displayName:string, error:string|null}>}
 */
export async function fetchLineProfile(userId, { token, timeoutMs = PROFILE_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const id = String(userId ?? '').trim();
  if (!id || !token) return { ok: false, displayName: '', error: 'not_configured' };

  let response;
  try {
    response = await fetchImpl(`${PROFILE_URL}/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, displayName: '', error: error?.name === 'TimeoutError' ? 'timeout' : 'fetch_failed' };
  }

  if (!response || !response.ok) {
    const status = response ? response.status : 0;
    return { ok: false, displayName: '', error: `http_${status}` };
  }

  try {
    const body = await response.json();
    const displayName = cleanDisplayName(body && body.displayName);
    if (!displayName) return { ok: false, displayName: '', error: 'empty_name' };
    return { ok: true, displayName, error: null };
  } catch {
    return { ok: false, displayName: '', error: 'bad_json' };
  }
}
