# 4B-4 Step 1 — owner-approved reusable response examples

Code + test database only. No prompt injection, no auto-learning, no Owner
Console UI changes in this phase.

## Model

Examples are created ONLY by explicit owner opt-in
(`POST /api/v1/response-examples/from-draft/:draftId`) on a SENT draft whose
`finalAction` is EDITED or APPROVED. Nothing is ingested automatically, and
the single historical SENT draft stays historical evidence only.

`EDITED + SENT` stores `ownerFinalResponse`; `APPROVED + SENT` stores
`ownerFinalResponse` when present else `draftResponse`. Original Draft rows
are never modified by example creation.

## Privacy

Before storage, both texts pass `sanitizeExampleText`: LINE user IDs,
emails, phones, dates/times, long identifiers, event IDs, URL query strings
and linked-customer names are redacted; one-off/exception pricing language
(`example_requires_review`) rejects creation instead of guessing. Stored rows
carry no customerId, lineUserId, sourceEventId, replyToken, or raw webhook.

## Facts vs style

`business_rules_revision` (copied from the source draft) pins every example
to the rules it was approved under. Retrieval flags `staleRules` when the
caller passes a newer revision. Examples teach communication patterns only;
prices, minima, zones, payment, and lead times stay sourced from
`business-rules.json`.

## Classification and retrieval

`classifyIntent` extends the deterministic lead-signal vocabulary with
greeting/menu/delivery/payment/minimum/availability/follow-up/complaint
rules (all deterministic, all tested). `serviceType` reuses
`extractLeadSignals`. Retrieval scores intent match, then service match,
then bounded keyword overlap, newest-first tie-break, maximum 3 rows,
`reusable = true` only. No vectors, no embeddings, no external AI calls.

## Dedupe and concurrency

`source_draft_id` UNIQUE plus content `fingerprint` (SHA-256) UNIQUE, with
the same find-first + unique-race-retry pattern as drafts/leads/inbound.
Concurrent opt-ins converge to one row; re-opt-in returns it deduped.

## Test database and deployment boundary

Provision `EED_TEST_DATABASE_URL` (migration role) and
`EED_TEST_RUNTIME_DATABASE_URL` (`eedhalal_app`), both ONLY loopback
`eedhalal_test`. Run PG suites serially:

    node --test --test-concurrency=1 test/response-examples-postgres.test.mjs ...

Runtime permission tests always roll back. No cluster role, ownership, or
server authentication changes. No production migration in this phase.
