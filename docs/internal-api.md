# EED HALAL Internal Business API (Phase 4A)

> Status: built and locally proven. **NOT YET CONNECTED TO PRODUCTION N8N.**
> Production LINE still ends at the n8n `Build Draft` static staging; this API
> is the persistent path that n8n and the Owner Console will use next.

## Current after Phase 4A (two separate tracks)

```
LINE production → Gateway → n8n → AI → Build Draft (static staging, unchanged)

Separately (new, proven locally):

n8n / Owner Console (future)
        ↓  Authorization: Bearer <EED_INTERNAL_API_SECRET> (loopback)
Internal Business API (server/internal-api.mjs)
        ↓
Domain Services (services/*) — the ONLY place with business logic
        ↓
Repositories (db/*: memory / file / postgres)
        ↓
PostgreSQL (production target)
```

## Next intended flow (Phase 4B, not built yet)

```
LINE → Gateway → n8n → AI → Internal API → Persistent WAITING_FOR_HUMAN Draft
→ Owner Console → Approve/Edit/Reject → future Sender Service → LINE
```

## Endpoint contract

Base `/api/v1`. Mutations require JSON + auth. Errors are
`{ error }` with 400/401/404/409 (conflict = illegal or stale transition),
never stack traces.

| Method | Path | Notes |
|---|---|---|
| GET | `/healthz` | no auth (process alive) |
| GET | `/readiness` | no auth (`{ ready, adapter }`, no secrets) |
| POST | `/customers/resolve` | `{ lineUserId, displayName? }`, idempotent |
| POST | `/leads/evaluate` | `{ customerId, message }` → `{ shouldCreate, signals, lead }` |
| POST | `/drafts` | status forced `WAITING_FOR_HUMAN`; caller cannot set SENT |
| GET | `/drafts?status=&limit=` | default `WAITING_FOR_HUMAN`, limit 1–100 |
| GET | `/drafts/:id` | UUID or human draftId |
| POST | `/drafts/:id/approve` | `{ ownerId?, expectedUpdatedAt?, expectedStatus? }` |
| POST | `/drafts/:id/edit` | `{ finalText, ... }`, AI draft preserved |
| POST | `/drafts/:id/reject` | `{ ... }` |

No sender, no regenerate-with-AI, no kitchen, no quotation/order/job/payment.

## Approval model

- Actor is always OWNER (server-forced from the authenticated request/ownerId).
- `draftResponse` = original AI draft, never overwritten.
- `ownerFinalResponse` = owner text; on plain approve it mirrors the AI draft
  (service rule) so "what the owner actually sent" is always recorded.
- Stale/double actions → HTTP 409 via `expectedUpdatedAt`/`expectedStatus`
  plus transition validation. Full PG row-lock fencing is Phase 4B work.

## Reply token findings (no sending decision made)

- `replyToken` stays in the repository (needed later) but is **stripped from
  every API response** (`server/present.mjs`).
- LINE reply requires a fresh replyToken (minutes, single conversation);
  push needs the channel access token and consumes quota. The future sender
  should prefer **push** (works after owner delay + group delivery), keeping
  reply only as an optimization when the token is still valid. Decision and
  implementation belong to the Sender phase, not here.

## Run locally

```powershell
$env:EED_INTERNAL_API_SECRET='local-dev-secret'
$env:DB_ADAPTER='memory'
node server/internal-api.mjs   # http://127.0.0.1:8788
```
