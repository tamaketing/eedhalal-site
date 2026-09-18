// Persist-first foundation only. No dispatch, AI calls, scheduling or sender.
import { randomUUID } from 'node:crypto';
import { isUniqueViolation } from '../db/index.mjs';
import { recordAudit } from './audit.mjs';
import { ConflictError, NotFoundError, ValidationError } from './errors.mjs';

export const AI_ERROR_CODES = Object.freeze(['AI_RATE_LIMIT', 'AI_TIMEOUT', 'AI_PROVIDER_ERROR', 'AI_INVALID_RESPONSE']);
const ERROR_DETAILS = {
  AI_RATE_LIMIT: 'AI provider rate limit reached.',
  AI_TIMEOUT: 'AI processing timed out.',
  AI_PROVIDER_ERROR: 'AI provider or agent failed.',
  AI_INVALID_RESPONSE: 'AI response failed validation.',
};

export function requireInboundObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('JSON object required');
}

function text(value, field, max, { nullable = false, empty = false } = {}) {
  if (value == null && nullable) return null;
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || value.includes('\u0000')) {
    throw new ValidationError(`invalid ${field}`);
  }
  return value; // No truncation/trim of identity or customer message content.
}

export function inboundId(value, field = 'id') {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ValidationError(`invalid ${field}`);
  }
  return value;
}

export async function getInboundMessage(repos, id) {
  const row = await repos.inboundMessages.findById(inboundId(id));
  if (!row) throw new NotFoundError('inbound message not found');
  return row;
}

async function audit(tx, row, action, before, actor = { type: 'SYSTEM', id: 'internal-api' }) {
  await recordAudit(tx, { entityType: 'inbound_message', entityId: row.id, action,
    actorType: actor.type, actorId: actor.id,
    beforeData: before ? { status: before.status, revision: before.revision } : null,
    afterData: { status: row.status, revision: row.revision, retryCount: row.retryCount,
      customerId: row.customerId, leadId: row.leadId, draftId: row.draftId, aiErrorCode: row.aiErrorCode } });
}

export async function receiveInboundMessage(repos, input = {}) {
  requireInboundObject(input);
  const row = {
    id: randomUUID(), customerId: null,
    lineUserId: text(input.lineUserId, 'lineUserId', 128, { nullable: true }),
    channel: input.channel ?? 'line', messageType: input.messageType ?? 'text',
    incomingMessage: text(input.incomingMessage ?? '', 'incomingMessage', 32000, { empty: true }),
    sourceEventId: text(input.sourceEventId, 'sourceEventId', 128, { nullable: true }),
    status: 'RECEIVED', aiErrorCode: null, aiErrorDetail: null, retryCount: 0, revision: 0,
    leadId: null, draftId: null, metadata: {}, // No arbitrary transport metadata accepted.
  };
  if (!['line', 'line-group', 'line-room'].includes(row.channel)) throw new ValidationError('invalid channel');
  if (!['text', 'image', 'video', 'audio', 'file', 'location', 'sticker', 'unknown'].includes(row.messageType)) {
    throw new ValidationError('invalid messageType');
  }
  if (row.messageType === 'text' && !row.incomingMessage.trim()) throw new ValidationError('incomingMessage is required');
  const existing = () => row.sourceEventId == null ? null : repos.inboundMessages.findBySourceEventId(row.sourceEventId);
  const found = await existing();
  if (found) return { inbound: found, deduped: true };
  try {
    const saved = await repos.transaction(async (tx) => {
      const created = await tx.inboundMessages.create(row);
      await audit(tx, created, 'INBOUND_RECEIVED');
      return created;
    });
    return { inbound: saved, deduped: false };
  } catch (error) {
    if (row.sourceEventId != null && isUniqueViolation(error)) {
      const winner = await existing();
      if (winner) return { inbound: winner, deduped: true };
    }
    throw error;
  }
}

// Every mutation requires the revision obtained from receive/get/last action.
// This prevents ABA races and stale callbacks from an earlier retry attempt.
async function mutate(repos, id, options, allowed, build, action) {
  requireInboundObject(options);
  if (!Number.isInteger(options.expectedRevision) || options.expectedRevision < 0) {
    throw new ValidationError('expectedRevision is required');
  }
  return repos.transaction(async (tx) => {
    const row = await getInboundMessage(tx, id);
    if (row.revision !== options.expectedRevision || !allowed.includes(row.status)) {
      throw new ConflictError('stale or invalid inbound transition');
    }
    const patch = await build(tx, row);
    const saved = await tx.inboundMessages.updateIfCurrent(row.id, { ...patch, revision: row.revision + 1 },
      { status: row.status, revision: row.revision });
    if (!saved) throw new ConflictError('inbound changed concurrently');
    if (action) await audit(tx, saved, action, row);
    return saved;
  });
}

export function attachCustomer(repos, id, options = {}) {
  return mutate(repos, id, options, ['RECEIVED', 'PROCESSING', 'AI_FAILED'], async (tx, row) => {
    const customerId = inboundId(options.customerId, 'customerId');
    const customer = await tx.customers.findById(customerId);
    if (!customer) throw new NotFoundError('customer not found');
    if ((row.customerId && row.customerId !== customerId) || (row.lineUserId && row.lineUserId !== customer.lineUserId)) {
      throw new ConflictError('conflicting customer linkage');
    }
    return { customerId };
  });
}

export function markProcessing(repos, id, options = {}) {
  return mutate(repos, id, options, ['RECEIVED'], async () => ({ status: 'PROCESSING' }));
}

export function markFailed(repos, id, options = {}) {
  return mutate(repos, id, options, ['PROCESSING'], async () => {
    if (!AI_ERROR_CODES.includes(options.errorCode)) throw new ValidationError('invalid errorCode');
    // Provider error strings can contain arbitrary secrets, URLs and payloads.
    // Persist only a bounded catalog description, NEVER the supplied detail.
    return { status: 'AI_FAILED', aiErrorCode: options.errorCode, aiErrorDetail: ERROR_DETAILS[options.errorCode].slice(0, 500) };
  }, 'INBOUND_FAILED');
}

export function retryInbound(repos, id, options = {}) {
  return mutate(repos, id, options, ['AI_FAILED'], async (_tx, row) => ({
    status: 'PROCESSING', retryCount: row.retryCount + 1, aiErrorCode: null, aiErrorDetail: null,
  }), 'INBOUND_RETRIED');
}

export function completeInbound(repos, id, options = {}) {
  return mutate(repos, id, options, ['PROCESSING'], async (tx, row) => {
    const draftId = inboundId(options.draftId, 'draftId');
    const leadId = options.leadId == null ? null : inboundId(options.leadId, 'leadId');
    const draft = await tx.drafts.findById(draftId);
    if (!draft) throw new NotFoundError('draft not found');
    if (!row.customerId || draft.customerId !== row.customerId || (draft.leadId || null) !== leadId ||
        (draft.sourceEventId || null) !== row.sourceEventId || draft.incomingMessage !== row.incomingMessage ||
        draft.status !== 'WAITING_FOR_HUMAN') throw new ConflictError('conflicting draft linkage or state');
    if (leadId) {
      const lead = await tx.leads.findById(leadId);
      if (!lead) throw new NotFoundError('lead not found');
      if (lead.customerId !== row.customerId || (lead.sourceEventId || null) !== row.sourceEventId) {
        throw new ConflictError('conflicting lead linkage');
      }
    }
    return { status: 'DRAFT_CREATED', leadId, draftId, aiErrorCode: null, aiErrorDetail: null };
  }, 'INBOUND_COMPLETED');
}
