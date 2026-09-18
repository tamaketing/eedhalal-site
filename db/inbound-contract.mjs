// Shared schemaless-adapter checks matching migration 004. Domain transitions
// and cross-entity ownership validation belong to services/inboundMessages.
export const INBOUND_STATUSES = Object.freeze(['RECEIVED', 'PROCESSING', 'AI_FAILED', 'DRAFT_CREATED']);
export const INBOUND_MUTABLE_FIELDS = Object.freeze([
  'customerId', 'status', 'aiErrorCode', 'aiErrorDetail', 'retryCount', 'revision', 'leadId', 'draftId',
]);

export function inboundPatch(patch) {
  return Object.fromEntries(INBOUND_MUTABLE_FIELDS.filter((key) => patch[key] !== undefined).map((key) => [key, patch[key]]));
}

export function inboundDefaults(row) {
  return { customerId: null, lineUserId: null, channel: 'line', messageType: 'text', incomingMessage: '',
    sourceEventId: null, status: 'RECEIVED', aiErrorCode: null, aiErrorDetail: null,
    retryCount: 0, revision: 0, leadId: null, draftId: null, metadata: {}, ...row };
}

export function validateInboundRow(row, exists) {
  if (!INBOUND_STATUSES.includes(row.status) || !Number.isInteger(row.retryCount) || row.retryCount < 0 ||
      !Number.isInteger(row.revision) || row.revision < 0) {
    throw Object.assign(new Error('invalid inbound state'), { code: '23514' });
  }
  for (const [field, table] of [['customerId', 'customers'], ['leadId', 'leads'], ['draftId', 'drafts']]) {
    if (row[field] != null && !exists(table, row[field])) {
      throw Object.assign(new Error('inbound reference not found'), { code: '23503' });
    }
  }
}
