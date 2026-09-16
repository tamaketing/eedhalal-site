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
  EDITED: 'DRAFT_EDITED',
  REGENERATED: 'DRAFT_REGENERATED',
  REJECTED: 'DRAFT_REJECTED',
});

export async function changeDraftStatus(repos, id, to, actor = { type: 'OWNER', id: '' }, patch = {}) {
  const current = await repos.drafts.findById(id);
  if (!current) throw new Error(`draft not found: ${id}`);
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
}

function sanitizedPatch(patch) {
  const out = { ...patch };
  if (out.metadata !== undefined) out.metadata = sanitizeMetadata(out.metadata);
  delete out.id;
  delete out.draftId;
  return out;
}
