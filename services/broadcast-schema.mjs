// EED HALAL — Broadcast data model (owner-approved weekly send).
//
// Policy (2026-10-26, owner decision recorded in AGENTS.md): the shop keeps
// "ไม่มีการส่งข้อความอัตโนมัติ" for customer chats — every reply still waits
// for the owner's send button. The ONE allowed scheduled channel is the
// weekly LINE broadcast: the system builds one draft per ISO week from real
// business data (never invented), the OWNER approves it in the Owner
// Console, and a reviewed runner outside server/services/db sends the
// approved row at its slot. Nothing else may call the send.
//
// This module is the single status/transition definition (mirrors
// draft-schema.mjs) so services/broadcasts.mjs and the runner share it.
// Row validation lives in db/broadcast-contract.mjs (shared with the
// schemaless adapters).

export const BROADCAST_STATUSES = Object.freeze([
  'PENDING_REVIEW',
  'SCHEDULED',
  'SENT',
  'FAILED',
  'MISSED',
  'CANCELLED',
]);

// Owner actions move rows; the runner moves SCHEDULED onward. MISSED/FAILED
// may only return to SCHEDULED through an explicit owner resend — never a
// silent automatic retry loop.
const ALLOWED_TRANSITIONS = Object.freeze({
  PENDING_REVIEW: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['SENT', 'FAILED', 'MISSED', 'CANCELLED'],
  SENT: [],
  FAILED: ['SCHEDULED', 'CANCELLED'],
  MISSED: ['SCHEDULED', 'CANCELLED'],
  CANCELLED: [],
});

export function isBroadcastStatus(value) {
  return BROADCAST_STATUSES.includes(value);
}

export function allowedBroadcastTransitionsFrom(status) {
  return [...(ALLOWED_TRANSITIONS[status] || [])];
}

// Asia/Bangkok is UTC+07:00 with no DST, so plain offset arithmetic is exact.
export const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

function shiftedMs(date) {
  return new Date(new Date(date).getTime() + BANGKOK_OFFSET_MS);
}

/** YYYY-Www (ISO week) in Asia/Bangkok — the dedupe key for the weekly draft. */
export function isoWeekKeyBangkok(now = new Date()) {
  const local = shiftedMs(now);
  const target = new Date(local.getTime());
  const day = target.getUTCDay() || 7; // Mon=1..Sun=7
  target.setUTCHours(0, 0, 0, 0);
  target.setUTCDate(target.getUTCDate() - day + 4); // Thursday decides the year
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Week number inside the ISO week key (1..53) — deterministic rotation seed. */
export function isoWeekNumber(weekKey) {
  const match = /^(\d{4})-W(\d{1,2})$/.exec(String(weekKey || ''));
  return match ? Number(match[2]) : 0;
}

/** Next Tuesday 09:00 Asia/Bangkok as a Date (UTC instants internally). */
export function nextTuesday0900Bangkok(now = new Date()) {
  const local = shiftedMs(now);
  const dow = local.getUTCDay() || 7; // Mon=1..Sun=7
  let daysAhead = (2 - dow + 7) % 7; // Tuesday = weekday 2
  const pastSlotToday = local.getUTCHours() > 9 ||
    (local.getUTCHours() === 9 && local.getUTCMinutes() >= 0);
  if (daysAhead === 0 && pastSlotToday) daysAhead = 7; // already 09:00+ Bangkok today
  const at = new Date(local.getTime());
  at.setUTCHours(0, 0, 0, 0);
  at.setUTCDate(at.getUTCDate() + daysAhead);
  // Slot: 09:00 Bangkok = 02:00 UTC.
  return new Date(at.getTime() - BANGKOK_OFFSET_MS + 9 * 60 * 60 * 1000);
}

/** End of the catch-up window for a scheduled instant: 21:00 of the same
 *  Bangkok day. After that the row becomes MISSED instead of late-sending. */
export function catchUpWindowEndBangkok(scheduledAt) {
  const local = shiftedMs(new Date(scheduledAt));
  local.setUTCHours(0, 0, 0, 0);
  // 21:00 Bangkok = 14:00 UTC of the same shifted day.
  return new Date(local.getTime() + 21 * 60 * 60 * 1000 - BANGKOK_OFFSET_MS);
}

/** YYYY-MM-DD in Bangkok — bucket key for logs and the console. */
export function bangkokDateString(now = new Date()) {
  const iso = shiftedMs(now).toISOString();
  return iso.slice(0, 10);
}

export function createBroadcastRow(input = {}, now = new Date()) {
  const iso = now.toISOString();
  return {
    id: input.id,
    weekKey: input.weekKey ?? null,
    theme: input.theme ?? 'custom',
    menuId: input.menuId ?? null,
    menuName: input.menuName ?? null,
    menuPrice: input.menuPrice ?? null,
    imageUrl: input.imageUrl ?? null,
    draftText: String(input.draftText || ''),
    finalText: null,
    status: 'PENDING_REVIEW',
    scheduledAt: input.scheduledAt ?? null,
    approvedAt: null,
    sentAt: null,
    sendAttempt: null,
    retryCount: 0,
    errorCode: null,
    metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {},
    createdBy: input.createdBy ?? 'SYSTEM',
    createdAt: iso,
    updatedAt: iso,
  };
}

// Domain transition with timestamps. Throws on illegal moves so the API maps
// to 409. `scheduledAt` (ISO) is required when moving to SCHEDULED.
export function transitionBroadcast(row, to, actor = 'owner', { scheduledAt, now } = {}) {
  if (!row || typeof row !== 'object') throw new Error('broadcast must be an object');
  if (!isBroadcastStatus(to)) throw new Error(`unknown status: ${to}`);
  const allowed = allowedBroadcastTransitionsFrom(row.status);
  if (!allowed.includes(to)) {
    throw new Error(`illegal broadcast transition: ${row.status} -> ${to}`);
  }
  const at = (now ?? new Date()).toISOString();
  const next = { ...row, status: to, updatedAt: at };
  if (to === 'SCHEDULED') {
    if (!scheduledAt) throw new Error('transition to SCHEDULED requires scheduledAt');
    next.scheduledAt = scheduledAt;
    next.approvedAt = next.approvedAt || at;
  }
  if (to === 'SENT') {
    if (next.sentAt) throw new Error('broadcast is already SENT');
    next.sentAt = at;
  }
  return next;
}
