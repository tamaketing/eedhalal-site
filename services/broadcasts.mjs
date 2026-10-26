// EED HALAL — broadcast persistence service.
// Same discipline as services/drafts.mjs: business logic lives here, adapters
// only store rows, and every state change commits together with its audit
// record. The provider call always happens OUTSIDE any transaction and never
// mutates state; settle functions use compare-and-swap rows.
//
// Actor rules:
//  - Owner Console actions are ALWAYS the owner (the client never chooses
//    actor types).
//  - The runner (tools/line/broadcast-runner.mjs, outside server/services/db)
//    settles sends as SYSTEM 'broadcast-runner' and is the only caller of the
//    provider — PENDING_REVIEW rows can never reach the network.
//  - The weekly draft is SYSTEM 'broadcast-draft' and is idempotent per
//    ISO week (Asia/Bangkok).

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { sendBroadcastMessages, getMessageQuota, getMessageConsumption } from './lineBroadcast.mjs';
import {
  catchUpWindowEndBangkok,
  createBroadcastRow,
  isoWeekKeyBangkok,
  nextTuesday0900Bangkok,
  transitionBroadcast,
} from './broadcast-schema.mjs';
import { isUniqueViolation } from '../db/index.mjs';
import { recordAudit } from './audit.mjs';
import { ConflictError, NotFoundError, ValidationError } from './errors.mjs';
import { sanitizeMetadata } from './sanitize.mjs';

export { BROADCAST_STATUSES } from './broadcast-schema.mjs';
export const MAX_SEND_RETRIES = 3;

const ENTITY = 'broadcast';

export function toBroadcastRow(broadcast) {
  return {
    id: broadcast.id || randomUUID(),
    weekKey: broadcast.weekKey ?? null,
    theme: broadcast.theme ?? 'custom',
    menuId: broadcast.menuId ?? null,
    menuName: broadcast.menuName ?? null,
    menuPrice: broadcast.menuPrice ?? null,
    imageUrl: broadcast.imageUrl ?? null,
    draftText: broadcast.draftText ?? '',
    finalText: broadcast.finalText ?? null,
    status: broadcast.status,
    scheduledAt: broadcast.scheduledAt ?? null,
    approvedAt: broadcast.approvedAt ?? null,
    sentAt: broadcast.sentAt ?? null,
    sendAttempt: broadcast.sendAttempt ?? null,
    retryCount: broadcast.retryCount ?? 0,
    errorCode: broadcast.errorCode ?? null,
    metadata: broadcast.metadata || {},
    createdBy: broadcast.createdBy ?? 'SYSTEM',
    createdAt: broadcast.createdAt,
    updatedAt: broadcast.updatedAt,
  };
}

export function fromBroadcastRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    weekKey: row.weekKey ?? null,
    theme: row.theme,
    menuId: row.menuId ?? null,
    menuName: row.menuName ?? null,
    menuPrice: row.menuPrice == null ? null : Number(row.menuPrice),
    imageUrl: row.imageUrl ?? null,
    draftText: row.draftText ?? '',
    finalText: row.finalText ?? null,
    status: row.status,
    scheduledAt: row.scheduledAt || null,
    approvedAt: row.approvedAt || null,
    sentAt: row.sentAt || null,
    sendAttempt: row.sendAttempt ?? null,
    retryCount: row.retryCount ?? 0,
    errorCode: row.errorCode ?? null,
    metadata: row.metadata || {},
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function audit(tx, id, action, actorType, actorId, before, after) {
  return recordAudit(tx, {
    entityType: ENTITY,
    entityId: id,
    action,
    actorType,
    actorId: actorId || '',
    beforeData: before,
    afterData: after,
  });
}

function toServiceError(error) {
  if (error instanceof ConflictError || error instanceof NotFoundError || error instanceof ValidationError) throw error;
  const message = String(error?.message || '');
  if (message === 'broadcast not found') throw new NotFoundError('broadcast not found');
  if (message.startsWith('broadcast not found:')) throw new NotFoundError(message);
  if (/^unknown status:/.test(message) || /^invalid broadcast/.test(message) || message.includes('requires scheduledAt')) {
    throw new ValidationError(message);
  }
  if (/^illegal broadcast transition:/.test(message)) throw new ConflictError(message);
  throw error;
}

// Exact-text helper: what is actually sent. Owner edits fill finalText;
// the original system draft (draftText) is never overwritten.
export function broadcastDisplayText(broadcast) {
  return broadcast.finalText || broadcast.draftText;
}

function validateSendableText(text) {
  const value = String(text || '');
  if (!value.trim()) throw new ValidationError('broadcast has no sendable text');
  if (value.length > 5000) throw new ValidationError('broadcast text exceeds the LINE limit (5000)');
  return value;
}

function normalizeScheduledAt(value, fallback = null) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new ValidationError('scheduledAt must be a valid date');
  return parsed.toISOString();
}

/** Fingerprint of one sendable announcement. Frozen attempts may only be
 *  reused when this still matches — an edited message always sends under a
 *  fresh key. */
function fingerprintSendAttempt(text, imageUrl) {
  return createHash('sha256').update(`${imageUrl || ''}\n${text}`).digest('hex').slice(0, 32);
}

function readAttempt(broadcast) {
  const attempt = broadcast.sendAttempt;
  if (!attempt || typeof attempt !== 'object' || typeof attempt.key !== 'string') return null;
  if (typeof attempt.fingerprint !== 'string') return null;
  return attempt;
}

// In-process serialization of owner/runner actions per row (same reason as
// drafts). Cross-process races are fenced by updateIfCurrent.
const broadcastLocks = new Map();
function withBroadcastLock(id, task) {
  const previous = broadcastLocks.get(id) || Promise.resolve();
  const next = previous.then(task, task);
  const tracked = next.catch(() => {});
  broadcastLocks.set(id, tracked);
  tracked.finally(() => {
    if (broadcastLocks.get(id) === tracked) broadcastLocks.delete(id);
  });
  return next;
}

function checkConcurrency(current, options = {}) {
  if (options.expectedStatus !== undefined && current.status !== options.expectedStatus) {
    throw new ConflictError(`stale broadcast: expected ${options.expectedStatus}, found ${current.status}`);
  }
  if (options.expectedUpdatedAt !== undefined && current.updatedAt !== options.expectedUpdatedAt) {
    throw new ConflictError('stale broadcast: updatedAt mismatch, refresh and retry');
  }
}

async function createBroadcast(repos, input, actor = { type: 'SYSTEM', id: 'broadcast-draft' }) {
  const row = createBroadcastRow({ ...input });
  // Fail closed before any write: the composed draft must be deliverable
  // text with a named theme (postgres has no draft_text CHECK, so this check
  // is the single gate for all adapters).
  validateSendableText(row.draftText);
  if (typeof row.theme !== 'string' || !row.theme.trim()) throw new ValidationError('broadcast draft needs a theme');
  return repos.transaction(async (tx) => {
    const saved = await tx.broadcastMessages.create(toBroadcastRow(row));
    await audit(tx, saved.id, 'BROADCAST_CREATED', actor.type || 'SYSTEM', actor.id || '',
      null, { status: saved.status, theme: saved.theme, weekKey: saved.weekKey });
    return fromBroadcastRow(saved);
  }).catch((error) => { throw toServiceError(error); });
}

export function getBroadcast(repos, id) {
  return repos.broadcastMessages.findById(id).then((row) => {
    if (!row) throw new NotFoundError('broadcast not found');
    return fromBroadcastRow(row);
  });
}

export async function listBroadcasts(repos, { status, limit = 50 } = {}) {
  const rows = status
    ? await repos.broadcastMessages.listByStatus(String(status))
    : await repos.broadcastMessages.list();
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return rows.slice(0, capped).map(fromBroadcastRow);
}

// Idempotent weekly draft. builder() must return the composed draft from
// REAL business data and may throw (e.g., menu catalogue problems) — the
// caller (runner) just retries on its next pass.
export async function ensureWeeklyBroadcast(repos, builder, { now = new Date() } = {}) {
  const weekKey = isoWeekKeyBangkok(now);
  const existing = await repos.broadcastMessages.findByWeekKey(weekKey);
  if (existing) return { broadcast: fromBroadcastRow(existing), deduped: true };
  const draft = await builder({ weekKey, now });
  const input = {
    ...draft,
    weekKey,
    createdBy: 'SYSTEM',
    metadata: { builtAt: (now instanceof Date ? now : new Date(now)).toISOString() },
  };
  try {
    return { broadcast: await createBroadcast(repos, input, { type: 'SYSTEM', id: 'broadcast-draft' }), deduped: false };
  } catch (error) {
    // Lost the unique week_key race against another runner: reuse the winner.
    if (isUniqueViolation(error)) {
      const winner = await repos.broadcastMessages.findByWeekKey(weekKey);
      if (winner) return { broadcast: fromBroadcastRow(winner), deduped: true };
    }
    throw error;
  }
}

const OWNER_AUDIT_ACTIONS = Object.freeze({
  approve: ['BROADCAST_STATUS_CHANGED', 'BROADCAST_APPROVED'],
  edit: ['BROADCAST_STATUS_CHANGED', 'BROADCAST_EDITED'],
  discard: ['BROADCAST_STATUS_CHANGED', 'BROADCAST_DISCARDED'],
  resend: ['BROADCAST_STATUS_CHANGED', 'BROADCAST_APPROVED'],
  reschedule: ['BROADCAST_RESCHEDULED'],
});

// Owner approval. PENDING_REVIEW -> SCHEDULED. A schedule that is already
// SCHEDULED, FAILED or MISSED cannot "re-approve"; use sendNow/postpone
// (resend) paths instead — they are the explicit routes to SCHEDULED again.
export function approveBroadcast(repos, id, { finalText, scheduledAt, ownerId = '', expectedUpdatedAt, expectedStatus } = {}) {
  const slot = normalizeScheduledAt(scheduledAt, nextTuesday0900Bangkok().toISOString());
  return withBroadcastLock(id, () => repos.transaction(async (tx) => {
    const current = await tx.broadcastMessages.findById(id);
    if (!current) throw new NotFoundError('broadcast not found');
    checkConcurrency(current, { expectedUpdatedAt, expectedStatus });
    if (current.status !== 'PENDING_REVIEW') {
      throw new ConflictError(`broadcast is ${current.status}; only PENDING_REVIEW can be approved`);
    }
    const text = validateSendableText(finalText === undefined ? broadcastDisplayText(fromBroadcastRow(current)) : finalText);
    const next = transitionBroadcast(fromBroadcastRow(current), 'SCHEDULED', 'owner', {
      scheduledAt: slot,
    });
    const attempt = {
      key: randomUUID(),
      fingerprint: fingerprintSendAttempt(text, current.imageUrl),
      createdAt: next.updatedAt,
    };
    const saved = await tx.broadcastMessages.updateIfCurrent(
      current.id,
      {
        ...toBroadcastRow({ ...next, id: current.id }),
        finalText: finalText === undefined ? current.finalText : String(finalText),
        sendAttempt: attempt,
      },
      { status: current.status, updatedAt: current.updatedAt },
    );
    if (!saved) throw new ConflictError('stale broadcast: changed concurrently, refresh and retry');
    await audit(tx, current.id, OWNER_AUDIT_ACTIONS.approve[0], 'OWNER', ownerId,
      { status: current.status }, { status: 'SCHEDULED', scheduledAt: saved.scheduledAt });
    await audit(tx, current.id, OWNER_AUDIT_ACTIONS.approve[1], 'OWNER', ownerId,
      { status: current.status }, { status: 'SCHEDULED', scheduledAt: saved.scheduledAt });
    return fromBroadcastRow(saved);
  }).catch((error) => { throw toServiceError(error); }));
}

// Owner reschedule: pick another slot (or now) without touching the text.
// Works from SCHEDULED (move the slot), FAILED/MISSED (unday resend — new
// attempt key because the previous attempt ends), and never from
// SENT/CANCELLED. PENDING_REVIEW uses approveBroadcast (needs a full approval).
export function postponeBroadcast(repos, id, { scheduledAt, ownerId = '', expectedUpdatedAt } = {}) {
  const slot = normalizeScheduledAt(scheduledAt, nextTuesday0900Bangkok().toISOString());
  return withBroadcastLock(id, () => repos.transaction(async (tx) => {
    const current = await tx.broadcastMessages.findById(id);
    if (!current) throw new NotFoundError('broadcast not found');
    checkConcurrency(current, { expectedUpdatedAt });
    const text = validateSendableText(broadcastDisplayText(fromBroadcastRow(current)));
    if (current.status === 'SCHEDULED') {
      const saved = await tx.broadcastMessages.updateIfCurrent(
        current.id,
        { scheduledAt: slot },
        { status: current.status, updatedAt: current.updatedAt },
      );
      if (!saved) throw new ConflictError('stale broadcast: changed concurrently, refresh and retry');
      await audit(tx, current.id, OWNER_AUDIT_ACTIONS.reschedule[0], 'OWNER', ownerId,
        { status: 'SCHEDULED', scheduledAt: current.scheduledAt }, { status: 'SCHEDULED', scheduledAt: saved.scheduledAt });
      return fromBroadcastRow(saved);
    }
    if (current.status === 'PENDING_REVIEW') {
      const next = transitionBroadcast(fromBroadcastRow(current), 'SCHEDULED', 'owner', { scheduledAt: slot });
      const attempt = {
        key: randomUUID(),
        fingerprint: fingerprintSendAttempt(current.finalText || current.draftText, current.imageUrl),
        createdAt: next.updatedAt,
      };
      const saved = await tx.broadcastMessages.updateIfCurrent(
        current.id,
        { ...toBroadcastRow({ ...next, id: current.id }), sendAttempt: attempt },
        { status: current.status, updatedAt: current.updatedAt },
      );
      if (!saved) throw new ConflictError('stale broadcast: changed concurrently, refresh and retry');
      await audit(tx, current.id, OWNER_AUDIT_ACTIONS.approve[0], 'OWNER', ownerId,
        { status: current.status }, { status: 'SCHEDULED', scheduledAt: saved.scheduledAt });
      await audit(tx, current.id, OWNER_AUDIT_ACTIONS.approve[1], 'OWNER', ownerId,
        { status: current.status }, { status: 'SCHEDULED', scheduledAt: saved.scheduledAt });
      return fromBroadcastRow(saved);
    }
    if (current.status === 'FAILED' || current.status === 'MISSED') {
      const next = transitionBroadcast(fromBroadcastRow(current), 'SCHEDULED', 'owner', { scheduledAt: slot });
      const attempt = {
        key: randomUUID(),
        fingerprint: fingerprintSendAttempt(text, current.imageUrl),
        createdAt: next.updatedAt,
      };
      const saved = await tx.broadcastMessages.updateIfCurrent(
        current.id,
        { ...toBroadcastRow({ ...next, id: current.id }), sendAttempt: attempt, errorCode: null },
        { status: current.status, updatedAt: current.updatedAt },
      );
      if (!saved) throw new ConflictError('stale broadcast: changed concurrently, refresh and retry');
      await audit(tx, current.id, OWNER_AUDIT_ACTIONS.resend[0], 'OWNER', ownerId,
        { status: current.status }, { status: 'SCHEDULED', scheduledAt: saved.scheduledAt });
      await audit(tx, current.id, OWNER_AUDIT_ACTIONS.resend[1], 'OWNER', ownerId,
        { status: current.status }, { status: 'SCHEDULED', scheduledAt: saved.scheduledAt });
      return fromBroadcastRow(saved);
    }
    throw new ConflictError(`broadcast is ${current.status}; rescheduling is not allowed`);
  }).catch((error) => { throw toServiceError(error); }));
}

// "Send immediately": same gate as postpone with the current instant.
export function sendNowBroadcast(repos, id, { ownerId = '', expectedUpdatedAt } = {}) {
  return postponeBroadcast(repos, id, {
    scheduledAt: new Date().toISOString(),
    ownerId,
    expectedUpdatedAt,
  });
}

// Pre-approval text edit (draft stays PENDING_REVIEW).
export function editPendingBroadcast(repos, id, { finalText, ownerId = '', expectedUpdatedAt } = {}) {
  if (typeof finalText !== 'string' || !finalText.trim()) throw new ValidationError('edit needs owner finalText');
  validateSendableText(finalText);
  return withBroadcastLock(id, () => repos.transaction(async (tx) => {
    const current = await tx.broadcastMessages.findById(id);
    if (!current) throw new NotFoundError('broadcast not found');
    checkConcurrency(current, { expectedUpdatedAt });
    if (current.status !== 'PENDING_REVIEW') {
      throw new ConflictError(`broadcast is ${current.status}; only PENDING_REVIEW can be edited`);
    }
    const saved = await tx.broadcastMessages.updateIfCurrent(
      current.id,
      { finalText: String(finalText) },
      { status: current.status, updatedAt: current.updatedAt },
    );
    if (!saved) throw new ConflictError('stale broadcast: changed concurrently, refresh and retry');
    await audit(tx, current.id, OWNER_AUDIT_ACTIONS.edit[0], 'OWNER', ownerId,
      { status: current.status }, { status: current.status, edited: true });
    await audit(tx, current.id, OWNER_AUDIT_ACTIONS.edit[1], 'OWNER', ownerId,
      { status: current.status, edited: false }, { status: current.status, edited: true });
    return fromBroadcastRow(saved);
  }).catch((error) => { throw toServiceError(error); }));
}

// Owner discards: cancel a draft, unsendable row, or an already-approved one
// before the runner's retry window closes. SENT rows stay history.
export function discardBroadcast(repos, id, { ownerId = '', expectedUpdatedAt } = {}) {
  return withBroadcastLock(id, () => repos.transaction(async (tx) => {
    const current = await tx.broadcastMessages.findById(id);
    if (!current) throw new NotFoundError('broadcast not found');
    checkConcurrency(current, { expectedUpdatedAt });
    const next = transitionBroadcast(fromBroadcastRow(current), 'CANCELLED', 'owner');
    const saved = await tx.broadcastMessages.updateIfCurrent(
      current.id,
      toBroadcastRow({ ...next, id: current.id }),
      { status: current.status, updatedAt: current.updatedAt },
    );
    if (!saved) throw new ConflictError('stale broadcast: changed concurrently, refresh and retry');
    await audit(tx, current.id, OWNER_AUDIT_ACTIONS.discard[0], 'OWNER', ownerId,
      { status: current.status }, { status: 'CANCELLED' });
    await audit(tx, current.id, OWNER_AUDIT_ACTIONS.discard[1], 'OWNER', ownerId,
      { status: current.status }, { status: 'CANCELLED' });
    return fromBroadcastRow(saved);
  }).catch((error) => { throw toServiceError(error); }));
}

// ---- Runner-side settling (called ONLY from tools/line/broadcast-runner.mjs) ----

export function listDueBroadcasts(repos, now = new Date()) {
  return repos.broadcastMessages.listByStatus('SCHEDULED').then((rows) =>
    rows.map(fromBroadcastRow).filter((row) => {
      const due = row.scheduledAt && new Date(row.scheduledAt).getTime() <= now.getTime();
      return due;
    }));
}

// Missed window: when the machine was off past the same-day 21:00 Bangkok
// cutoff, the row becomes MISSED instead of late-sending on its own.
export function isBroadcastMissed(row, now = new Date()) {
  return row.scheduledAt !== null &&
    now.getTime() > catchUpWindowEndBangkok(row.scheduledAt).getTime();
}

export function markMissedBroadcast(repos, id, { ownerId = '', expectedUpdatedAt } = {}) {
  return withBroadcastLock(id, () => repos.transaction(async (tx) => {
    const current = await tx.broadcastMessages.findById(id);
    if (!current) throw new NotFoundError('broadcast not found');
    checkConcurrency(current, { expectedUpdatedAt });
    const next = transitionBroadcast(fromBroadcastRow(current), 'MISSED', 'system');
    const saved = await tx.broadcastMessages.updateIfCurrent(
      current.id,
      toBroadcastRow({ ...next, id: current.id }),
      { status: current.status, updatedAt: current.updatedAt },
    );
    if (!saved) throw new ConflictError('stale broadcast: changed concurrently');
    await audit(tx, current.id, 'BROADCAST_STATUS_CHANGED', 'SYSTEM', ownerId || 'broadcast-runner',
      { status: current.status }, { status: 'MISSED' });
    await audit(tx, current.id, 'BROADCAST_MISSED', 'SYSTEM', ownerId || 'broadcast-runner',
      { status: current.status }, { status: 'MISSED', scheduledAt: saved.scheduledAt });
    return fromBroadcastRow(saved);
  }).catch((error) => { throw toServiceError(error); }));
}

// Quota exhaustion is a loud stop (no silent skip): the row fails with
// QUOTA_EXHAUSTED so the owner sees it and can act (top-ups the plan or
// discard the row). The message itself is preserved.
export function failBroadcastWithCode(repos, id, code, { ownerId = '' } = {}) {
  return withBroadcastLock(id, () => repos.transaction(async (tx) => {
    const current = await tx.broadcastMessages.findById(id);
    if (!current) throw new NotFoundError('broadcast not found');
    if (current.status !== 'SCHEDULED') {
      throw new ConflictError(`broadcast is ${current.status}; failure cannot be recorded`);
    }
    const next = transitionBroadcast(fromBroadcastRow(current), 'FAILED', 'system');
    const saved = await tx.broadcastMessages.updateIfCurrent(
      current.id,
      { ...toBroadcastRow({ ...next, id: current.id }), errorCode: String(code) },
      { status: current.status, updatedAt: current.updatedAt },
    );
    if (!saved) throw new ConflictError('stale broadcast: changed concurrently');
    await audit(tx, current.id, 'BROADCAST_SEND_FAILED', 'SYSTEM', ownerId || 'broadcast-runner',
      { status: current.status }, { status: 'FAILED', providerCode: String(code) });
    return fromBroadcastRow(saved);
  }).catch((error) => { throw toServiceError(error); }));
}

// Three-phase send of ONE due broadcast (mirrors sendDraft):
//   1. transaction: claim row + frozen attempt (new messages get fresh keys)
//   2. provider call outside any transaction (X-Line-Retry-Key dedupes)
//   3. transaction: settle SENT / FAILED, or stay SCHEDULED for a retry (same
//      frozen key); the runner's next pass turns exhausted retries into
//      FAILED 'RETRY_EXHAUSTED'.
export async function sendDueBroadcast(repos, id, { now = new Date(), send = sendBroadcastMessages, token } = {}) {
  const ownedSend = send || sendBroadcastMessages;
  if (!token) throw new Error('line send not configured');
  return withBroadcastLock(id, async () => {
    // Phase 1
    const frozen = await repos.transaction(async (tx) => {
      const current = await tx.broadcastMessages.findById(id);
      if (!current) throw new NotFoundError('broadcast not found');
      if (current.status !== 'SCHEDULED') {
        throw new ConflictError(`broadcast is ${current.status}; runner send is not allowed`);
      }
      if (!current.scheduledAt || new Date(current.scheduledAt).getTime() > now.getTime()) {
        throw new ConflictError('broadcast is not due yet');
      }
      if (current.retryCount >= MAX_SEND_RETRIES) {
        // Every allowed attempt already ended with an unknown delivery
        // outcome (RETRYABLE). Close the row loudly so the owner sees it and
        // can resend from the console — never retry forever on the same key.
        const next = transitionBroadcast(fromBroadcastRow(current), 'FAILED', 'system');
        const saved = await tx.broadcastMessages.updateIfCurrent(
          current.id,
          { ...toBroadcastRow({ ...next, id: current.id }), errorCode: 'RETRY_EXHAUSTED' },
          { status: current.status, updatedAt: current.updatedAt },
        );
        if (!saved) throw new ConflictError('stale broadcast: changed concurrently, refresh and retry');
        for (const action of ['BROADCAST_STATUS_CHANGED', 'BROADCAST_SEND_FAILED']) {
          await audit(tx, current.id, action, 'SYSTEM', 'broadcast-runner',
            { status: current.status, retryCount: current.retryCount },
            { status: 'FAILED', providerCode: 'RETRY_EXHAUSTED' });
        }
        return { broadcast: fromBroadcastRow(saved), send: null };
      }
      const text = validateSendableText(current.finalText || current.draftText);
      const fingerprint = fingerprintSendAttempt(text, current.imageUrl);
      const existing = readAttempt(current);
      // A fresh attempt is always committed under CAS *in this same
      // transaction* (records the exact key that phase 2 will use), so a
      // crash before settle still replays with the SAME key. Only a
      // fingerprint match reuses the frozen attempt.
      const attempt = existing && existing.fingerprint === fingerprint
        ? existing
        : { key: randomUUID(), fingerprint, createdAt: new Date().toISOString() };
      if (attempt !== existing) {
        const saved = await tx.broadcastMessages.updateIfCurrent(
          current.id,
          { sendAttempt: attempt },
          { status: current.status, updatedAt: current.updatedAt },
        );
        if (!saved) throw new ConflictError('stale broadcast: changed concurrently, refresh and retry');
      }
      return { id: current.id, attempt, text, imageUrl: current.imageUrl };
    }).catch((error) => { throw toServiceError(error); });

    // Phase 1 may close the row itself (retry budget spent): hand that
    // result back without touching the network.
    if (!frozen.attempt) return frozen;

    // Phase 2 (outside transactions)
    const messages = [];
    if (frozen.imageUrl) {
      messages.push({ type: 'image', originalContentUrl: frozen.imageUrl, previewImageUrl: frozen.imageUrl });
    }
    messages.push({ type: 'text', text: frozen.text });
    const result = await ownedSend({ token, messages, retryKey: frozen.attempt.key });

    // Phase 3
    return repos.transaction(async (tx) => {
      const current = await tx.broadcastMessages.findById(id);
      if (!current) throw new NotFoundError('broadcast not found');
      if (current.status !== 'SCHEDULED') {
        throw new ConflictError(`broadcast is ${current.status}; send outcome cannot be recorded`);
      }
      if (result.outcome === 'ACCEPTED' || result.outcome === 'ALREADY_ACCEPTED') {
        const next = transitionBroadcast(fromBroadcastRow(current), 'SENT', 'system');
        const saved = await tx.broadcastMessages.updateIfCurrent(
          current.id,
          toBroadcastRow({ ...next, id: current.id }),
          { status: current.status, updatedAt: current.updatedAt },
        );
        if (!saved) throw new ConflictError('stale broadcast: changed concurrently during send');
        for (const action of ['BROADCAST_STATUS_CHANGED', 'BROADCAST_SENT']) {
          await audit(tx, current.id, action, 'SYSTEM', 'broadcast-runner',
            { status: current.status }, { status: 'SENT', providerCode: result.code });
        }
        return { broadcast: fromBroadcastRow(saved), send: { outcome: result.outcome, code: result.code, httpStatus: result.httpStatus ?? null } };
      }
      if (result.outcome === 'NON_RETRYABLE_FAILURE') {
        const next = transitionBroadcast(fromBroadcastRow(current), 'FAILED', 'system');
        const saved = await tx.broadcastMessages.updateIfCurrent(
          current.id,
          { ...toBroadcastRow({ ...next, id: current.id }), errorCode: String(result.code) },
          { status: current.status, updatedAt: current.updatedAt },
        );
        if (!saved) throw new ConflictError('stale broadcast: changed concurrently during send');
        for (const action of ['BROADCAST_STATUS_CHANGED', 'BROADCAST_SEND_FAILED']) {
          await audit(tx, current.id, action, 'SYSTEM', 'broadcast-runner',
            { status: current.status }, { status: 'FAILED', providerCode: result.code });
        }
        return { broadcast: fromBroadcastRow(saved), send: { outcome: result.outcome, code: result.code, httpStatus: result.httpStatus ?? null } };
      }
      // RETRYABLE_FAILURE: delivery outcome unknown. Stay SCHEDULED with the
      // SAME frozen attempt. The next runner pass retries the send; once
      // retryCount reaches MAX_SEND_RETRIES phase 1 closes it as FAILED.
      const saved = await tx.broadcastMessages.updateIfCurrent(
        current.id,
        { retryCount: current.retryCount + 1 },
        { status: current.status, updatedAt: current.updatedAt },
      );
      if (!saved) throw new ConflictError('stale broadcast: changed concurrently during retry');
      await audit(tx, current.id, 'BROADCAST_SEND_RETRYABLE', 'SYSTEM', 'broadcast-runner',
        { status: current.status, retryCount: current.retryCount },
        { status: 'SCHEDULED', retryCount: saved.retryCount, providerCode: result.code });
      return { broadcast: fromBroadcastRow(saved), send: { outcome: result.outcome, code: result.code, httpStatus: result.httpStatus ?? null } };
    }).catch((error) => { throw toServiceError(error); });
  }).catch((error) => { throw toServiceError(error); });
}

// Owner-facing quota + usage (reads LINE, never a secret).
export async function broadcastQuotaSummary({ token, quota = getMessageQuota, consumption = getMessageConsumption } = {}) {
  const [limitStatus, usage] = await Promise.all([quota({ token }), consumption({ token })]);
  if (!limitStatus.ok) return { ok: false, code: limitStatus.code };
  return {
    ok: true,
    type: limitStatus.type || 'limited',
    limit: limitStatus.type === 'limited' ? limitStatus.limit : null,
    used: usage.ok ? usage.total : null,
    remaining: limitStatus.type === 'limited' && limitStatus.limit != null && usage.ok
      ? Math.max(limitStatus.limit - usage.total, 0)
      : null,
  };
}
