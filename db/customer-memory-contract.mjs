// Shared schemaless-adapter checks matching migration 009.
//
// One customer has ONE memory: the current situation plus the list of jobs
// that are already closed. The rules that decide what goes in (what counts as
// a fact, what the owner may lock) live in services/customerMemory.mjs.
//
// Empty stays empty (null), never undefined, so a row written before
// migration 009 existed reads back the same way on all three adapters.
export const MEMORY_STATUSES = Object.freeze(['OPEN', 'CLOSED']);
export const MEMORY_SOURCES = Object.freeze(['rule', 'ai', 'owner']);
export const MEMORY_SUMMARY_MAX = 800;
export const MEMORY_HISTORY_MAX = 5;

export function memoryDefaults(row = {}) {
  // A missing row stays missing: the adapters use this to return null for
  // "no memory yet" instead of an empty row that looks like a real one.
  if (row === null || row === undefined) return null;
  const next = { ...row };
  if (next.summary === undefined) next.summary = '';
  if (next.facts === undefined || next.facts === null) next.facts = {};
  if (next.history === undefined || next.history === null) next.history = [];
  if (next.status === undefined || next.status === null) next.status = 'OPEN';
  if (next.source === undefined || next.source === null) next.source = 'rule';
  if (next.ruleRevision === undefined || next.ruleRevision === null) next.ruleRevision = '';
  return next;
}

// The summary is a short situation note, not a transcript: a long one would
// bloat every prompt and hide the facts that matter.
export function validateMemoryRow(row = {}) {
  const errors = [];
  if (typeof row.summary !== 'string') errors.push('summary must be a string');
  if (row.summary.length > MEMORY_SUMMARY_MAX) errors.push('summary is too long');
  if (!MEMORY_STATUSES.includes(row.status)) errors.push('unknown memory status');
  if (!MEMORY_SOURCES.includes(row.source)) errors.push('unknown memory source');
  if (!row.facts || typeof row.facts !== 'object' || Array.isArray(row.facts)) errors.push('facts must be an object');
  if (!Array.isArray(row.history)) errors.push('history must be an array');
  if (row.history.length > MEMORY_HISTORY_MAX) errors.push('history is too long');
  return errors;
}
