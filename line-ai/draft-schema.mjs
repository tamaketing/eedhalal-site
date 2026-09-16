// EED HALAL — Draft data model (human-approval foundation).
//
// AI must NEVER send to LINE directly. Every customer message produces a
// Draft with status WAITING_FOR_HUMAN and the workflow ends there.
// The owner later moves the draft to APPROVED / EDITED / REGENERATED /
// REJECTED, and only an explicit owner-triggered sender may deliver it.
//
// Storage in this phase is temporary (n8n workflow static data via the
// Build Draft node, see buildDraftNodeCode in conversation-update.mjs).
// This module is the SINGLE schema definition so a future move to
// PostgreSQL (or any database) only replaces the store adapter —
// business logic and status transitions stay unchanged.
//
// DO NOT DO YET (out of scope): Accounting, Finance, Quotation PDF,
// Receipt, Invoice, Supplier, Job Costing, extra AI agents, full dashboard.

export const DRAFT_STATUSES = Object.freeze([
  'WAITING_FOR_HUMAN',
  'APPROVED',
  'EDITED',
  'REGENERATED',
  'REJECTED',
  'SENT',
  'FAILED',
]);

// Allowed owner/system transitions. AI may only create WAITING_FOR_HUMAN.
const ALLOWED_TRANSITIONS = Object.freeze({
  WAITING_FOR_HUMAN: ['APPROVED', 'EDITED', 'REGENERATED', 'REJECTED', 'FAILED'],
  REGENERATED: ['WAITING_FOR_HUMAN'],
  EDITED: ['APPROVED', 'REJECTED', 'SENT', 'FAILED'],
  APPROVED: ['SENT', 'FAILED'],
  FAILED: ['WAITING_FOR_HUMAN'],
  REJECTED: [],
  SENT: [],
});

export function isDraftStatus(value) {
  return DRAFT_STATUSES.includes(value);
}

export function allowedTransitionsFrom(status) {
  return [...(ALLOWED_TRANSITIONS[status] || [])];
}

function randomSuffix() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint32Array(2));
    return `${bytes[0].toString(36)}${bytes[1].toString(36)}`.slice(0, 6).toUpperCase();
  }
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function newDraftId(now = new Date()) {
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `LD-${stamp}-${randomSuffix()}`;
}

// Central Draft shape. Extra columns must be added here first so a future
// PostgreSQL migration (drafts table) maps 1:1 without logic changes.
export function createDraft(input = {}, now = new Date()) {
  const iso = now.toISOString();
  return {
    draftId: input.draftId || newDraftId(now),
    customerId: String(input.customerId || ''),
    channel: String(input.channel || 'line'),
    incomingMessage: String(input.incomingMessage || ''),
    draftResponse: String(input.draftResponse || ''),
    status: 'WAITING_FOR_HUMAN',
    createdAt: iso,
    updatedAt: iso,
    approvedAt: null,
    sentAt: null,
    source: String(input.source || 'conversation-ai'),
    aiModel: String(input.aiModel || ''),
    ruleRevision: String(input.ruleRevision || ''),
    metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {},
    history: [{ at: iso, from: null, to: 'WAITING_FOR_HUMAN', actor: 'system' }],
  };
}

export function validateDraft(draft) {
  const errors = [];
  if (!draft || typeof draft !== 'object') return ['draft must be an object'];
  for (const field of [
    'draftId',
    'customerId',
    'channel',
    'incomingMessage',
    'draftResponse',
    'status',
    'createdAt',
    'updatedAt',
    'source',
  ]) {
    if (draft[field] === undefined || draft[field] === null || draft[field] === '') {
      errors.push(`${field} is required`);
    }
  }
  if (draft.status && !isDraftStatus(draft.status)) errors.push(`unknown status: ${draft.status}`);
  // A draft is a human gate: it must never be created already-sent.
  if (draft.status === 'SENT' && !draft.sentAt) errors.push('SENT draft requires sentAt');
  if (draft.status === 'APPROVED' || draft.status === 'EDITED') {
    if (!draft.approvedAt) errors.push(`${draft.status} draft requires approvedAt`);
  }
  return errors;
}

// Owner/system transition with audit history. Throws on illegal moves so a
// future API layer can map the error to 409 without extra checks.
export function transitionDraft(draft, to, actor = 'owner', now = new Date()) {
  if (!draft || typeof draft !== 'object') throw new Error('draft must be an object');
  if (!isDraftStatus(to)) throw new Error(`unknown status: ${to}`);
  const allowed = allowedTransitionsFrom(draft.status);
  if (!allowed.includes(to)) {
    throw new Error(`illegal draft transition: ${draft.status} -> ${to}`);
  }
  const iso = now.toISOString();
  const next = { ...draft, status: to, updatedAt: iso };
  if (to === 'APPROVED' || to === 'EDITED') next.approvedAt = next.approvedAt || iso;
  if (to === 'SENT') next.sentAt = iso;
  next.history = [...(draft.history || []), { at: iso, from: draft.status, to, actor }];
  const errors = validateDraft(next);
  if (errors.length) throw new Error(`invalid draft after transition: ${errors.join('; ')}`);
  return next;
}

// Minimal store interface. Swap this adapter for PostgreSQL later;
// callers (tests, future API) only use save/get/listByStatus/update.
export function createMemoryDraftStore() {
  const rows = new Map();
  return {
    save(draft) {
      const errors = validateDraft(draft);
      if (errors.length) throw new Error(`invalid draft: ${errors.join('; ')}`);
      rows.set(draft.draftId, structuredClone(draft));
      return structuredClone(draft);
    },
    get(draftId) {
      const found = rows.get(draftId);
      return found ? structuredClone(found) : null;
    },
    listByStatus(status) {
      return [...rows.values()]
        .filter((row) => row.status === status)
        .map((row) => structuredClone(row));
    },
    update(draftId, patch) {
      const current = rows.get(draftId);
      if (!current) throw new Error(`draft not found: ${draftId}`);
      const next = { ...structuredClone(current), ...patch, draftId };
      const errors = validateDraft(next);
      if (errors.length) throw new Error(`invalid draft: ${errors.join('; ')}`);
      rows.set(draftId, next);
      return structuredClone(next);
    },
  };
}
