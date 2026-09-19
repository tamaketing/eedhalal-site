// EED HALAL — draft persistence service.
// line-ai/draft-schema.mjs stays the single domain contract: this service
// builds domain drafts with createDraft(), validates them, maps them 1:1 to
// repository rows (id UUID PK + draftId human reference), and persists them
// through the configured repository. Business code never writes SQL.
//
// A draft may exist without a lead (leadId null): a customer saying hello
// must not conjure a fake lead.

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { sendPushMessage } from './linePush.mjs';
import {
  createDraft,
  DRAFT_STATUSES,
  transitionDraft,
  validateDraft,
} from '../line-ai/draft-schema.mjs';
import { isUniqueViolation } from '../db/index.mjs';
import { recordAudit } from './audit.mjs';
import { ConflictError, NotFoundError, ValidationError } from './errors.mjs';
import { sanitizeMetadata } from './sanitize.mjs';

export { DRAFT_STATUSES };

export function toDraftRow(draft) {
  return {
    id: draft.dbId || randomUUID(),
    draftId: draft.draftId,
    customerId: draft.customerId || null,
    leadId: draft.leadId || null,
    channel: draft.channel,
    incomingMessage: draft.incomingMessage,
    draftResponse: draft.draftResponse,
    ownerFinalResponse: draft.ownerFinalResponse || null,
    finalAction: draft.finalAction || null,
    sourceEventId: draft.sourceEventId || null,
    status: draft.status,
    source: draft.source,
    aiModel: draft.aiModel || '',
    ruleRevision: draft.ruleRevision || '',
    metadata: draft.metadata || {},
    history: draft.history || [],
    approvedAt: draft.approvedAt,
    sentAt: draft.sentAt,
  };
}

export function fromDraftRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    dbId: row.id,
    draftId: row.draftId,
    customerId: row.customerId || '',
    leadId: row.leadId || null,
    channel: row.channel,
    incomingMessage: row.incomingMessage,
    draftResponse: row.draftResponse,
    ownerFinalResponse: row.ownerFinalResponse || null,
    finalAction: row.finalAction || null,
    sourceEventId: row.sourceEventId || null,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    approvedAt: row.approvedAt || null,
    sentAt: row.sentAt || null,
    source: row.source,
    aiModel: row.aiModel || '',
    ruleRevision: row.ruleRevision || '',
    metadata: row.metadata || {},
    history: row.history || [],
  };
}

// Full pipeline for one incoming customer message AFTER the AI produced text:
// resolve -> (maybe lead) -> draft WAITING_FOR_HUMAN. Never sends to LINE.
export async function persistDraft(repos, input = {}, actor = { type: 'AI', id: '' }) {
  const metadata = sanitizeMetadata(input.metadata || {});
  const draft = createDraft({
    draftId: input.draftId,
    customerId: input.customerId || '',
    leadId: input.leadId || null,
    channel: input.channel || 'line',
    incomingMessage: input.incomingMessage || '',
    draftResponse: input.draftResponse || '',
    source: input.source || 'conversation-ai',
    aiModel: input.aiModel || '',
    ruleRevision: input.ruleRevision || '',
    metadata,
  });
  draft.sourceEventId = cleanEventId(input.sourceEventId);
  const errors = validateDraft(draft);
  if (errors.length) throw new Error(`invalid draft: ${errors.join('; ')}`);
  // Draft row + audit record commit together (one transaction on PostgreSQL).
  return repos.transaction(async (tx) => {
    const saved = await tx.drafts.create(toDraftRow(draft));
    await recordAudit(tx, {
      entityType: 'draft', entityId: saved.id, action: 'DRAFT_CREATED',
      actorType: actor.type || 'AI', actorId: actor.id || '',
      beforeData: null,
      afterData: { draftId: saved.draftId, status: saved.status, customerId: saved.customerId },
    });
    return fromDraftRow(saved);
  });
}

function cleanEventId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 128);
  return trimmed || null;
}

// Idempotent persist for webhook retries: the same LINE source event reuses
// the already-persisted draft ({ deduped: true }) instead of duplicating it.
// Genuinely new events (no or unknown id) create new drafts as before.
export async function persistDraftOnce(repos, input = {}, actor = { type: 'AI', id: '' }) {
  const eventId = cleanEventId(input.sourceEventId);
  if (eventId) {
    const existing = await repos.drafts.findBySourceEventId(eventId);
    if (existing) return { ...fromDraftRow(existing), deduped: true };
  }
  try {
    const created = await persistDraft(repos, { ...input, sourceEventId: eventId });
    return { ...created, deduped: false };
  } catch (error) {
    // Lost a unique race on source_event_id: reuse the winner.
    if (eventId && isUniqueViolation(error)) {
      const winner = await repos.drafts.findBySourceEventId(eventId);
      if (winner) return { ...fromDraftRow(winner), deduped: true };
    }
    throw error;
  }
}

const SPECIFIC_EVENTS = Object.freeze({
  APPROVED: 'DRAFT_APPROVED',
  EDITED: 'DRAFT_EDITED',
  REGENERATED: 'DRAFT_REGENERATED',
  REJECTED: 'DRAFT_REJECTED',
});

function checkConcurrency(current, options = {}) {
  // Optimistic concurrency: the owner console sends back the state it acted
  // on. Anything stale or already moved is a 409, never a silent overwrite.
  // updateIfCurrent() re-checks atomically at the database row, so this
  // pre-check is an early, friendly rejection — the row guard is final.
  if (options.expectedStatus !== undefined && current.status !== options.expectedStatus) {
    throw new ConflictError(`stale draft: expected ${options.expectedStatus}, found ${current.status}`);
  }
  if (options.expectedUpdatedAt !== undefined && current.updatedAt !== options.expectedUpdatedAt) {
    throw new ConflictError('stale draft: updatedAt mismatch, refresh and retry');
  }
}

// Serializes owner actions per draft inside this process so two concurrent
// approves cannot both read WAITING_FOR_HUMAN and overwrite each other: the
// loser re-reads the moved state and gets a 409. Cross-process races still
// need database fencing (Phase 4B).
const draftLocks = new Map();
function withDraftLock(id, task) {
  const previous = draftLocks.get(id) || Promise.resolve();
  const next = previous.then(task, task);
  const tracked = next.catch(() => {});
  draftLocks.set(id, tracked);
  tracked.finally(() => {
    if (draftLocks.get(id) === tracked) draftLocks.delete(id);
  });
  return next;
}

function toServiceError(error, id) {
  if (error instanceof ConflictError || error instanceof NotFoundError || error instanceof ValidationError) throw error;
  if (/^draft not found:/.test(error.message)) throw new NotFoundError(error.message);
  if (/^unknown status:/.test(error.message)) throw new ValidationError(error.message);
  if (/^illegal draft transition:/.test(error.message)) throw new ConflictError(error.message);
  if (/^invalid draft/.test(error.message)) throw new ValidationError(error.message);
  throw error;
}

// Every owner action runs as: in-process lock -> transaction -> re-read ->
// explicit client expectations -> domain transition -> ATOMIC compare-and-swap
// (updateIfCurrent guards on the freshly read status+updatedAt) -> audit.
// Losers get ConflictError (HTTP 409); state change + audit commit together.
async function applyOwnerAction(repos, id, to, { ownerId = '', patch = {}, auditActions = ['DRAFT_STATUS_CHANGED'], options = {} } = {}) {
  const owner = ownerId || 'owner';
  return withDraftLock(id, () => repos.transaction(async (tx) => {
    const current = await tx.drafts.findById(id);
    if (!current) throw new NotFoundError(`draft not found: ${id}`);
    checkConcurrency(current, options);
    const next = transitionDraft(fromDraftRow(current), to, owner);
    const finalPatch = { ...patch };
    if (to === 'APPROVED' && finalPatch.ownerFinalResponse === undefined) {
      // Approve-without-edit rule, computed from the fresh read so a racing
      // edit can never be regressed: the final text mirrors the AI draft.
      finalPatch.ownerFinalResponse = current.ownerFinalResponse || current.draftResponse;
      finalPatch.finalAction = 'APPROVED';
    }
    const saved = await tx.drafts.updateIfCurrent(
      current.id,
      { ...toDraftRow({ ...next, dbId: current.id }), ...finalPatch },
      { status: current.status, updatedAt: current.updatedAt },
    );
    if (!saved) throw new ConflictError('stale draft: changed concurrently, refresh and retry');
    for (const action of auditActions) {
      await recordAudit(tx, {
        entityType: 'draft', entityId: current.id, action,
        actorType: 'OWNER', actorId: ownerId,
        beforeData: { status: current.status }, afterData: { status: to },
      });
    }
    return fromDraftRow(saved);
  }).catch((error) => { throw toServiceError(error, id); }));
}

export function changeDraftStatus(repos, id, to, actor = { type: 'OWNER', id: '' }, patch = {}, options = {}) {
  const events = ['DRAFT_STATUS_CHANGED'];
  if (SPECIFIC_EVENTS[to]) events.push(SPECIFIC_EVENTS[to]);
  return applyOwnerAction(repos, id, to, {
    ownerId: actor.id || '',
    patch: sanitizedPatch(patch),
    auditActions: events,
    options,
  });
}

// Owner approval actions. Actor is ALWAYS the authenticated owner context —
// a client-supplied actorType is never trusted.
export function approveDraft(repos, id, { ownerId = '', expectedUpdatedAt, expectedStatus } = {}) {
  return applyOwnerAction(repos, id, 'APPROVED', {
    ownerId,
    auditActions: ['DRAFT_STATUS_CHANGED', 'DRAFT_APPROVED'],
    options: { expectedUpdatedAt, expectedStatus },
  });
}

export function editDraft(repos, id, { ownerId = '', finalText = '', expectedUpdatedAt, expectedStatus } = {}) {
  if (!String(finalText).trim()) throw new ValidationError('edit needs owner finalText');
  // The original AI draft (draftResponse) is never overwritten.
  return applyOwnerAction(repos, id, 'EDITED', {
    ownerId,
    patch: { ownerFinalResponse: String(finalText), finalAction: 'EDITED' },
    auditActions: ['DRAFT_STATUS_CHANGED', 'DRAFT_EDITED'],
    options: { expectedUpdatedAt, expectedStatus },
  });
}

export function rejectDraft(repos, id, { ownerId = '', expectedUpdatedAt, expectedStatus } = {}) {
  return applyOwnerAction(repos, id, 'REJECTED', {
    ownerId,
    auditActions: ['DRAFT_STATUS_CHANGED', 'DRAFT_REJECTED'],
    options: { expectedUpdatedAt, expectedStatus },
  });
}

// Owner-approved LINE send (Phase 4B-3A). The owner console is the ONLY
// caller: no n8n sender, no scheduler, no auto-send exists anywhere.
// Flow: CAS-claim APPROVED with a frozen attempt (one DB tx) -> LINE Push
// OUTSIDE any transaction -> settle to SENT / FAILED / stay APPROVED.
// The retry key is generated ONCE at freeze and reused for every retry of
// the same attempt, so the provider deduplicates replays. Retries never
// change text or recipient: both are re-derived and fingerprinted.
function fingerprintSendAttempt(recipient, text) {
  return createHash('sha256').update(`${recipient}\n${text}`).digest('hex').slice(0, 32);
}

function readSendAttempt(metadata) {
  const attempt = metadata && typeof metadata === 'object' ? metadata.sendAttempt : null;
  if (!attempt || typeof attempt !== 'object') return null;
  if (typeof attempt.key !== 'string' || typeof attempt.fingerprint !== 'string' || typeof attempt.recipient !== 'string') return null;
  return attempt;
}

function validSendAttempt(attempt, recipient, text) {
  return !!attempt && attempt.recipient === recipient && attempt.fingerprint === fingerprintSendAttempt(recipient, text);
}

function sendAudit(tx, id, action, ownerId, before, after) {
  return recordAudit(tx, {
    entityType: 'draft', entityId: id, action,
    actorType: 'OWNER', actorId: ownerId,
    beforeData: before, afterData: after,
  });
}

export async function sendDraft(repos, id, { ownerId = '', expectedUpdatedAt, expectedStatus } = {}, deps = {}) {
  const push = deps.push || sendPushMessage;
  const token = deps.token;
  const owner = ownerId || 'owner';
  return withDraftLock(id, async () => {
    // Phase 1: validate everything, then CAS-claim APPROVED + frozen attempt.
    const frozen = await repos.transaction(async (tx) => {
      const current = await tx.drafts.findById(id);
      if (!current) throw new NotFoundError(`draft not found: ${id}`);
      checkConcurrency(current, { expectedUpdatedAt, expectedStatus });
      if (current.status === 'SENT' || current.status === 'REJECTED') {
        throw new ConflictError(`draft is ${current.status}; send is not allowed`);
      }
      if (current.status === 'FAILED') {
        throw new ConflictError('draft failed; recover through WAITING_FOR_HUMAN first');
      }
      if (!['WAITING_FOR_HUMAN', 'EDITED', 'APPROVED'].includes(current.status)) {
        throw new ConflictError(`draft is ${current.status}; send is not allowed`);
      }
      const finalText = current.ownerFinalResponse || current.draftResponse;
      if (!finalText || !finalText.trim()) throw new ValidationError('draft has no sendable text');
      const customer = current.customerId ? await tx.customers.findById(current.customerId) : null;
      const recipient = customer && customer.lineUserId;
      if (!recipient) throw new ValidationError('draft customer has no LINE user identity');
      if (!token) throw new Error('line send not configured');
      const fingerprint = fingerprintSendAttempt(recipient, finalText);
      const existing = readSendAttempt(current.metadata);
      // A retry reuses the stored attempt only when it still matches the
      // frozen text/recipient. Anything else freezes a fresh attempt — never
      // silently, always under the same compare-and-swap guard.
      const attempt = (current.status === 'APPROVED' && existing && validSendAttempt(existing, recipient, finalText))
        ? existing
        : { key: randomUUID(), fingerprint, recipient, createdAt: new Date().toISOString() };
      const metadata = { ...sanitizeMetadata(current.metadata), sendAttempt: attempt };
      let patch;
      let auditActions;
      if (current.status === 'APPROVED') {
        patch = { metadata };
        auditActions = ['DRAFT_APPROVED'];
      } else {
        const next = transitionDraft(fromDraftRow(current), 'APPROVED', owner);
        patch = {
          ...toDraftRow({ ...next, dbId: current.id }),
          ownerFinalResponse: current.ownerFinalResponse || current.draftResponse,
          finalAction: 'APPROVED',
          metadata,
        };
        auditActions = ['DRAFT_STATUS_CHANGED', 'DRAFT_APPROVED'];
      }
      const saved = await tx.drafts.updateIfCurrent(current.id, patch, { status: current.status, updatedAt: current.updatedAt });
      if (!saved) throw new ConflictError('stale draft: changed concurrently, refresh and retry');
      for (const action of auditActions) {
        await sendAudit(tx, current.id, action, ownerId, { status: current.status }, { status: saved.status });
      }
      return { row: fromDraftRow(saved), attempt, finalText, recipient };
    }).catch((error) => { throw toServiceError(error, id); });

    // Phase 2: provider call outside any DB transaction.
    const result = await push({
      token, userId: frozen.recipient, text: frozen.finalText, retryKey: frozen.attempt.key,
    });

    // Phase 3: settle under a fresh CAS guard.
    return repos.transaction(async (tx) => {
      const current = await tx.drafts.findById(id);
      if (!current) throw new NotFoundError(`draft not found: ${id}`);
      if (current.status !== 'APPROVED') {
        throw new ConflictError(`draft is ${current.status}; send outcome cannot be recorded`);
      }
      if (result.outcome === 'ACCEPTED' || result.outcome === 'ALREADY_ACCEPTED') {
        const next = transitionDraft(fromDraftRow(current), 'SENT', owner);
        const saved = await tx.drafts.updateIfCurrent(
          current.id, toDraftRow({ ...next, dbId: current.id }),
          { status: current.status, updatedAt: current.updatedAt },
        );
        if (!saved) throw new ConflictError('stale draft: changed concurrently during send');
        for (const action of ['DRAFT_STATUS_CHANGED', 'DRAFT_SENT']) {
          await sendAudit(tx, current.id, action, ownerId, { status: current.status }, { status: 'SENT', providerCode: result.code });
        }
        return { draft: fromDraftRow(saved), send: { outcome: result.outcome, code: result.code, httpStatus: result.httpStatus ?? null } };
      }
      if (result.outcome === 'NON_RETRYABLE_FAILURE') {
        const next = transitionDraft(fromDraftRow(current), 'FAILED', owner);
        const saved = await tx.drafts.updateIfCurrent(
          current.id, toDraftRow({ ...next, dbId: current.id }),
          { status: current.status, updatedAt: current.updatedAt },
        );
        if (!saved) throw new ConflictError('stale draft: changed concurrently during send');
        for (const action of ['DRAFT_STATUS_CHANGED', 'LINE_SEND_FAILED']) {
          await sendAudit(tx, current.id, action, ownerId, { status: current.status }, { status: 'FAILED', providerCode: result.code });
        }
        return { draft: fromDraftRow(saved), send: { outcome: result.outcome, code: result.code, httpStatus: result.httpStatus ?? null } };
      }
      // RETRYABLE_FAILURE: delivery outcome unknown. Stay APPROVED with the
      // SAME frozen attempt so an explicit owner retry reuses the same key.
      // No silent resend, no new key, no SENT.
      await sendAudit(tx, current.id, 'LINE_SEND_RETRYABLE', ownerId,
        { status: current.status }, { status: current.status, providerCode: result.code });
      return { draft: fromDraftRow(current), send: { outcome: result.outcome, code: result.code, httpStatus: result.httpStatus ?? null } };
    }).catch((error) => { throw toServiceError(error, id); });
  }).catch((error) => { throw toServiceError(error, id); });
}

function sanitizedPatch(patch) {
  const out = { ...patch };
  if (out.metadata !== undefined) out.metadata = sanitizeMetadata(out.metadata);
  delete out.id;
  delete out.draftId;
  return out;
}
