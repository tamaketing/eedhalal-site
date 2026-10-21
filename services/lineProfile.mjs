// EED HALAL — LINE customer profile helpers.
//
// The owner console should show a customer's LINE display name instead of a
// long `U...` identifier. These helpers are pure: the network call lives in
// tools/line/profile.mjs so the domain/services layer stays free of LINE
// transport code (enforced by the repository safety test).
//
// Profile sync is fail-open: a missing token, a blocked bot, a timeout, or a
// malformed response simply leaves the name empty; messages keep flowing.
export const PROFILE_TIMEOUT_MS = 3000;
// Refresh once a week: names change rarely, and every refresh costs one call.
export const PROFILE_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_DISPLAY_NAME = 100;

/** Keep the name printable and bounded before it reaches storage/UI. */
export function cleanDisplayName(value) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DISPLAY_NAME);
}

/**
 * True when the stored name is missing or older than the refresh window.
 * Customers created before this feature have no profileSyncedAt, so they are
 * picked up by the next message or by the backfill script.
 */
export function needsProfileRefresh(customer, now = Date.now()) {
  if (!customer) return true;
  if (!cleanDisplayName(customer.displayName)) return true;
  const syncedAt = Date.parse(String(customer.profileSyncedAt || ''));
  if (!Number.isFinite(syncedAt)) return true;
  return now - syncedAt >= PROFILE_REFRESH_MS;
}
