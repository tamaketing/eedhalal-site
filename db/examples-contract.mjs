// Shared response_examples checks matching migration 005. Owner opt-in,
// eligibility, sanitization, and audit live in services/responseExamples;
// adapters enforce only shape, FKs, and uniqueness here.
export const EXAMPLE_MUTABLE_FIELDS = Object.freeze([
  'intent', 'serviceType', 'styleTags', 'reusable',
]);

export function examplePatch(patch) {
  return Object.fromEntries(EXAMPLE_MUTABLE_FIELDS.filter((key) => patch[key] !== undefined).map((key) => [key, patch[key]]));
}

export function exampleDefaults(row) {
  return { serviceType: null, styleTags: [], reusable: true,
    businessRulesRevision: 'unknown', ...row };
}

export function validateExampleRow(row, exists) {
  if (!row.intent || !row.incomingExample || !row.approvedResponse || !row.fingerprint ||
      !row.businessRulesRevision) {
    throw Object.assign(new Error('invalid response example'), { code: '23514' });
  }
  if (!Array.isArray(row.styleTags)) throw Object.assign(new Error('invalid response example'), { code: '23514' });
  if (typeof row.reusable !== 'boolean') throw Object.assign(new Error('invalid response example'), { code: '23514' });
  if (row.sourceDraftId != null && !exists('drafts', row.sourceDraftId)) {
    throw Object.assign(new Error('missing reference'), { code: '23503' });
  }
}
