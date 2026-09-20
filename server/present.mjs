// EED HALAL — safe API representations.
// replyToken is time-sensitive and must never reach the Owner Console list or
// normal API responses: presenters strip it (and any secret-looking metadata)
// while the repository keeps it for the future approved sender (push-first).

import { sanitizeMetadata } from '../services/sanitize.mjs';

export function presentInboundMessage(row) {
  if (!row) return null;
  return {
    id: row.id, customerId: row.customerId, lineUserId: row.lineUserId,
    channel: row.channel, messageType: row.messageType, incomingMessage: row.incomingMessage,
    sourceEventId: row.sourceEventId, status: row.status, aiErrorCode: row.aiErrorCode,
    aiErrorDetail: row.aiErrorDetail, retryCount: row.retryCount, revision: row.revision,
    leadId: row.leadId, draftId: row.draftId, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function publicMetadata(metadata) {
  const cleaned = sanitizeMetadata(metadata || {});
  delete cleaned.replyToken;
  return cleaned;
}

export function presentResponseExample(row) {
  if (!row) return null;
  return {
    id: row.id,
    intent: row.intent,
    serviceType: row.serviceType,
    incomingExample: row.incomingExample,
    approvedResponse: row.approvedResponse,
    styleTags: row.styleTags || [],
    reusable: row.reusable,
    businessRulesRevision: row.businessRulesRevision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function presentCustomer(customer) {
  if (!customer) return null;
  return {
    id: customer.id,
    lineUserId: customer.lineUserId,
    displayName: customer.displayName,
    phone: customer.phone,
    email: customer.email,
    companyName: customer.companyName,
    taxId: customer.taxId,
    address: customer.address,
    notes: customer.notes,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

export function presentLead(lead) {
  if (!lead) return null;
  return { ...lead };
}

export function presentDraft(draft) {
  if (!draft) return null;
  return {
    id: draft.id,
    draftId: draft.draftId,
    customerId: draft.customerId,
    leadId: draft.leadId,
    channel: draft.channel,
    incomingMessage: draft.incomingMessage,
    draftResponse: draft.draftResponse,
    ownerFinalResponse: draft.ownerFinalResponse,
    finalAction: draft.finalAction,
    sourceEventId: draft.sourceEventId || null,
    status: draft.status,
    source: draft.source,
    aiModel: draft.aiModel,
    ruleRevision: draft.ruleRevision,
    metadata: publicMetadata(draft.metadata),
    history: draft.history,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    approvedAt: draft.approvedAt,
    sentAt: draft.sentAt,
  };
}
