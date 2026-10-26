// EED HALAL — broadcast announcement repository contract, shared by the
// schemaless adapters (memory/file) and mirrored by migration 011.
// Domain rules (who may change what, when) belong to services/broadcasts.mjs;
// this module only fixes the row shape and the raw invariants every adapter
// must uphold.
//
// Lifecycle: the system builds ONE draft per ISO week (PENDING_REVIEW) → the
// owner approves it (SCHEDULED, with a send slot) → the runner outside
// server/services/db delivers it (SENT) or records FAILED / MISSED → the
// owner may resend (SCHEDULED) or discard (CANCELLED). PENDING_REVIEW never
// sends by itself — nothing but services/broadcasts settle functions may
// move a row toward SENT.

import { randomUUID } from 'node:crypto';

export const BROADCAST_STATUSES = Object.freeze([
  'PENDING_REVIEW', // ร่างที่ระบบสร้างไว้ รอเจ้าของอนุมัติ
  'SCHEDULED', // เจ้าของอนุมัติแล้ว รอเวลาที่ตั้งไว้
  'SENT',
  'FAILED',
  'MISSED', // ถึงเวลาแล้วแต่เครื่องไม่ได้เปิดในหน้าต่างที่กำหนด
  'CANCELLED', // เจ้าของเลือกไม่ใช้ร่างนี้
]);

export const BROADCAST_CREATORS = Object.freeze(['SYSTEM', 'OWNER']);

export const BROADCAST_MUTABLE_FIELDS = Object.freeze([
  'draftText', 'finalText', 'imageUrl', 'menuPrice',
  'status', 'scheduledAt', 'approvedAt', 'sentAt',
  'sendAttempt', 'retryCount', 'errorCode', 'metadata',
]);

const ISO_STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?Z?$/;

export function broadcastPatch(patch) {
  return Object.fromEntries(
    BROADCAST_MUTABLE_FIELDS.filter((key) => patch[key] !== undefined).map((key) => [key, patch[key]]),
  );
}

const NULLABLE_TEXT_FIELDS = ['weekKey', 'menuId', 'menuName', 'imageUrl', 'finalText', 'scheduledAt', 'approvedAt', 'sentAt'];

export function broadcastDefaults(row = {}) {
  const out = {
    id: row.id ?? randomUUID(),
    theme: 'custom',
    menuPrice: null,
    draftText: '',
    status: 'PENDING_REVIEW',
    retryCount: 0,
    errorCode: null,
    createdBy: 'SYSTEM',
  };
  for (const field of NULLABLE_TEXT_FIELDS) out[field] = null;
  if (row.sendAttempt === undefined) out.sendAttempt = null;
  if (row.metadata === undefined) out.metadata = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined) continue;
    if (key === 'weekKey' && value === null) { out.weekKey = null; continue; }
    out[key] = value;
  }
  return out;
}

export function validateBroadcastRow(row) {
  const errors = [];
  if (!row || typeof row !== 'object') return ['broadcast must be an object'];
  if (!BROADCAST_STATUSES.includes(row.status)) errors.push(`unknown status: ${row.status}`);
  if (!Number.isInteger(row.retryCount) || row.retryCount < 0) errors.push('retryCount must be a non-negative integer');
  if (typeof row.theme !== 'string' || !row.theme.trim()) errors.push('theme is required');
  if (row.draftText == null || !String(row.draftText).trim()) errors.push('draftText is required');
  if (String(row.draftText || '').length > 5000) errors.push('draftText exceeds LINE message limit (5000)');
  if (!BROADCAST_CREATORS.includes(row.createdBy)) errors.push('createdBy must be SYSTEM or OWNER');
  for (const field of [...NULLABLE_TEXT_FIELDS, 'errorCode']) {
    const value = row[field];
    if (value !== null && value !== undefined && typeof value !== 'string') {
      errors.push(`${field} must be a string or null`);
    }
  }
  for (const field of ['scheduledAt', 'approvedAt', 'sentAt']) {
    const value = row[field];
    if (value != null && !ISO_STAMP_RE.test(String(value))) errors.push(`${field} must be an ISO timestamp`);
  }
  if (row.status === 'SCHEDULED' && (row.scheduledAt == null || !String(row.scheduledAt).trim())) {
    errors.push('SCHEDULED broadcast requires scheduledAt');
  }
  if (row.menuPrice != null && (!Number.isFinite(Number(row.menuPrice)) || Number(row.menuPrice) <= 0)) {
    errors.push('menuPrice must be a positive number or null');
  }
  const attempt = row.sendAttempt;
  if (attempt != null && (typeof attempt !== 'object' || Array.isArray(attempt) || typeof attempt.key !== 'string')) {
    errors.push('sendAttempt must be an object with a key');
  }
  if (row.metadata != null && (typeof row.metadata !== 'object' || Array.isArray(row.metadata))) {
    errors.push('metadata must be an object');
  }
  return errors;
}
