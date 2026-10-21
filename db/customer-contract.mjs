// Shared schemaless-adapter checks matching migrations 006-007. Owner control
// over the auto-reply bot is per customer: an empty botPausedAt means the bot
// is replying normally, an empty botPauseReason means no reason was recorded.
// profileSyncedAt records when the LINE display name was last fetched; empty
// means "not fetched yet", so the next message or backfill retries.
// Domain rules (who may pause whom, what counts as a reason) belong to
// services/customers.mjs.
export const CUSTOMER_BOT_FIELDS = Object.freeze(['botPausedAt', 'botPauseReason']);
export const CUSTOMER_PROFILE_FIELDS = Object.freeze(['profileSyncedAt']);

// Empty stays empty (null), never undefined: a paused/never-paused customer is
// read back the same way on all three adapters, including rows written before
// migrations 006-007 existed.
export function customerDefaults(row = {}) {
  const next = { ...row };
  for (const field of [...CUSTOMER_BOT_FIELDS, ...CUSTOMER_PROFILE_FIELDS]) {
    if (next[field] === undefined) next[field] = null;
  }
  return next;
}
