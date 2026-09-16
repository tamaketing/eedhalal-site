// EED HALAL — draft persistence service.
// line-ai/draft-schema.mjs stays the single domain contract: this service
// builds domain drafts with createDraft(), validates them, maps them 1:1 to
// repository rows (id UUID PK + draftId human reference), and persists them
// through the configured repository. Business code never writes SQL.
//
// A draft may exist without a lead (leadId null): a customer saying hello
// must not conjure a fake lead.

import { randomUUID } from 'node:crypto';
import {
  createDraft,
  DRAFT_STATUSES,
  transitionDraft,
  validateDraft,
} from '../line-ai/draft-schema.mjs';
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
  const errors = validateDraft(draft);
  if (errors.length) throw new Error(`invalid draft: ${errors.join('; ')}`);
  const saved = await repos.drafts.create(toDraftRow(draft));
  await recordAudit(repos, {
    entityType: 'draft', entityId: saved.id, action: 'DRAFT_CREATED',
    actorType: actor.type || 'AI', actorId: actor.id || '',
    beforeData: null,
    afterData: { draftId: saved.draftId, status: saved.status, customerId: saved.customerId },
  });
  return fromDraftRow(saved);
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
  // Limitation (documented): check-then-write is not a row lock; full
  // PostgreSQL `UPDATE ... WHERE updated_at` fencing arrives in Phase 4B.
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

export function changeDraftStatus(repos, id, to, actor = { type: 'OWNER', id: '' }, patch = {}, options = {}) {
  return withDraftLock(id, async () => {
  try {
    const current = await repos.drafts.findById(id);
    if (!current) throw new NotFoundError(`draft not found: ${id}`);
    checkConcurrency(current, options);
    const next = transitionDraft(fromDraftRow(current), to, actor.id || actor.type || 'owner');
    const merged = { ...toDraftRow({ ...next, dbId: current.id }), ...sanitizedPatch(patch) };
    const saved = await repos.drafts.update(id, merged);
    const events = ['DRAFT_STATUS_CHANGED'];
    if (SPECIFIC_EVENTS[to]) events.push(SPECIFIC_EVENTS[to]);
    for (const action of events) {
      await recordAudit(repos, {
        entityType: 'draft', entityId: id, action,
        actorType: actor.type || 'OWNER', actorId: actor.id || '',
        beforeData: { status: current.status }, afterData: { status: to },
      });
    }
    return fromDraftRow(saved);
  } catch (error) {
    throw toServiceError(error, id);
  }
  });
}

// Owner approval actions. Actor is ALWAYS the authenticated owner context —
// a client-supplied actorType is never trusted.
export function approveDraft(repos, id, { ownerId = '', expectedUpdatedAt, expectedStatus } = {}) {
  return withDraftLock(id, async () => {
  try {
  const current = await repos.drafts.findById(id);
  if (!current) throw new NotFoundError(`draft not found: ${id}`);
  checkConcurrency(current, { expectedUpdatedAt, expectedStatus });
  // Approve-without-edit rule: the final text mirrors the AI draft so that
  // ownerFinalResponse is always the "what the owner actually sent" record.
  const saved = await repos.drafts.update(id, {
    ...toDraftRow({
      ...transitionDraft(fromDraftRow(current), 'APPROVED', ownerId || 'owner'),
      dbId: current.id,
      ownerFinalResponse: current.ownerFinalResponse || current.draftResponse,
      finalAction: 'APPROVED',
    }),
  }).catch((error) => { throw toServiceError(error, id); });
  await auditTransition(repos, current, 'APPROVED', ownerId, ['DRAFT_STATUS_CHANGED', 'DRAFT_APPROVED']);
  return fromDraftRow(saved);
  } catch (error) {
    throw toServiceError(error, id);
  }
  });
}

export function editDraft(repos, id, { ownerId = '', finalText = '', expectedUpdatedAt, expectedStatus } = {}) {
  return withDraftLock(id, async () => {
  try {
  if (!String(finalText).trim()) throw new ValidationError('edit needs owner finalText');
  const current = await repos.drafts.findById(id);
  if (!current) throw new NotFoundError(`draft not found: ${id}`);
  checkConcurrency(current, { expectedUpdatedAt, expectedStatus });
  // The original AI draft (draftResponse) is never overwritten.
  const saved = await repos.drafts.update(id, {
    ...toDraftRow({
      ...transitionDraft(fromDraftRow(current), 'EDITED', ownerId || 'owner'),
      dbId: current.id,
      ownerFinalResponse: String(finalText),
      finalAction: 'EDITED',
    }),
  }).catch((error) => { throw toServiceError(error, id); });
  await auditTransition(repos, current, 'EDITED', ownerId, ['DRAFT_STATUS_CHANGED', 'DRAFT_EDITED']);
  return fromDraftRow(saved);
  } catch (error) {
    throw toServiceError(error, id);
  }
  });
}

export function rejectDraft(repos, id, { ownerId = '', expectedUpdatedAt, expectedStatus } = {}) {
  return withDraftLock(id, async () => {
  try {
  const current = await repos.drafts.findById(id);
  if (!current) throw new NotFoundError(`draft not found: ${id}`);
  checkConcurrency(current, { expectedUpdatedAt, expectedStatus });
  const saved = await repos.drafts.update(id, {
    ...toDraftRow({ ...transitionDraft(fromDraftRow(current), 'REJECTED', ownerId || 'owner'), dbId: current.id }),
  }).catch((error) => { throw toServiceError(error, id); });
  await auditTransition(repos, current, 'REJECTED', ownerId, ['DRAFT_STATUS_CHANGED', 'DRAFT_REJECTED']);
  return fromDraftRow(saved);
  } catch (error) {
    throw toServiceError(error, id);
  }
  });
}

async function auditTransition(repos, current, to, ownerId, actions) {
  for (const action of actions) {
    await recordAudit(repos, {
      entityType: 'draft', entityId: current.id, action,
      actorType: 'OWNER', actorId: ownerId || '',
      beforeData: { status: current.status }, afterData: { status: to },
    });
  }
}

function sanitizedPatch(patch) {
  const out = { ...patch };
  if (out.metadata !== undefined) out.metadata = sanitizeMetadata(out.metadata);
  delete out.id;
  delete out.draftId;
  return out;
}
