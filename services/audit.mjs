// EED HALAL — audit service (append-only).
// Allowed actions in this phase (do not invent PAYMENT/QUOTATION/JOB events):
//   CUSTOMER_CREATED, LEAD_CREATED, LEAD_STATUS_CHANGED,
//   DRAFT_CREATED, DRAFT_STATUS_CHANGED, DRAFT_EDITED, DRAFT_REGENERATED, DRAFT_REJECTED
// actorType must be AI, OWNER, or SYSTEM.

import { randomUUID } from 'node:crypto';
import { sanitizeAuditData } from './sanitize.mjs';

export const AUDIT_ACTIONS = Object.freeze([
  'CUSTOMER_CREATED',
  'LEAD_CREATED',
  'LEAD_STATUS_CHANGED',
  'DRAFT_CREATED',
  'DRAFT_STATUS_CHANGED',
  'DRAFT_EDITED',
  'DRAFT_REGENERATED',
  'DRAFT_REJECTED',
]);

export const ACTOR_TYPES = Object.freeze(['AI', 'OWNER', 'SYSTEM']);

export async function recordAudit(repos, event) {
  if (!AUDIT_ACTIONS.includes(event.action)) throw new Error(`unknown audit action: ${event.action}`);
  if (!ACTOR_TYPES.includes(event.actorType)) throw new Error(`unknown actor type: ${event.actorType}`);
  if (!event.entityType || !event.entityId) throw new Error('audit event needs entityType and entityId');
  return repos.auditLogs.append({
    id: event.id || randomUUID(),
    entityType: String(event.entityType),
    entityId: String(event.entityId),
    action: event.action,
    actorType: event.actorType,
    actorId: String(event.actorId || ''),
    beforeData: event.beforeData === undefined ? null : sanitizeAuditData(event.beforeData),
    afterData: event.afterData === undefined ? null : sanitizeAuditData(event.afterData),
  });
}
