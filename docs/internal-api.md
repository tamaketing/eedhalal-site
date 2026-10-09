# EED HALAL Internal Business API

> Status: built, running locally, and the only backend surface in this repo.
> The AI answer-drafting layer (LINE gateway, n8n workflows, AI prompt) has been
> removed. What remains is the data layer plus the owner console, where a
> person reviews and sends a reply to a customer on LINE.

## Current flow

```
Owner Console (http://127.0.0.1:8788/owner/)
        ↓  Authorization: Bearer <EED_INTERNAL_API_SECRET> (loopback)
Internal Business API (server/internal-api.mjs)
        ↓
Domain Services (services/*) — the ONLY place with business logic
        ↓
Repositories (db/*: memory / file / postgres)
        ↓
PostgreSQL (production target)
```

## Customer-facing channel

Customers reach the shop on the LINE Official Account (`@EEDHALAL`) and are
answered by a person. The website deep-links into that OA
(`https://lin.ee/CfvqJTd`) from every CTA, and `data/rich-menu.json` holds the
OA rich menu plus its keyword replies.

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
| POST | `/drafts/:id/send` | owner-triggered LINE Push; requires `LINE_CHANNEL_ACCESS_TOKEN`, fails closed when unset |
| GET | `/menus/mealbox?price=&maxPrice=&tier=&q=&limit=` | planner-backed meal-box catalog (`{ serviceType, source, filters, menus }`); `tier` is `classic` \| `signature` \| `executive` (anything else is a 400); default limit 20, max 100 |
| GET | `/owner/`, `/owner/app.js`, `/owner/styles.css` | the owner console UI (bearer-gated) |

No auto-sender, no AI regeneration, no kitchen, no quotation/order/job/payment.
Nothing sends to a customer unless an owner clicks Send.

## Approval model

- Actor is always OWNER (server-forced from the authenticated request/ownerId).
- `draftResponse` = original AI draft, never overwritten.
- `ownerFinalResponse` = owner text; on plain approve it mirrors the AI draft
  (service rule) so "what the owner actually sent" is always recorded.
- Stale/double actions → HTTP 409 via `expectedUpdatedAt`/`expectedStatus`
  plus transition validation. Full PG row-lock fencing is Phase 4B work.

## Reply token and sending

- `replyToken` is **stripped from every API response** (`server/present.mjs`).
  It is never persisted, so a delayed owner send cannot use it.
- The only send path is `POST /drafts/:id/send` (LINE Push, channel access
  token), and only an owner can call it. It claims the APPROVED row, pushes
  outside any transaction, then settles to SENT / FAILED.

## Run locally

```powershell
$env:EED_INTERNAL_API_SECRET='local-dev-secret'
$env:DB_ADAPTER='memory'
node server/internal-api.mjs   # http://127.0.0.1:8788
```

## Production deployment checklist

1. Create production database `eedhalal` + least-privilege app role
   (NOT `eedhalal_test` / `eedhalal_tester`).
2. Set `DB_ADAPTER=postgres` in the production host environment.
3. Set `DATABASE_URL` in the host secret manager (never in the repo).
4. Set `EED_INTERNAL_API_SECRET` in the host secret manager.
5. Set `LINE_CHANNEL_ACCESS_TOKEN` in the host secret manager
   (LINE Developers > Messaging API). Without it the send endpoint fails closed.
6. Run `node db/migrate.mjs status`, then `up`, until zero pending.
7. Start the Internal API; verify `/readiness` reports ready.
8. Open the owner console, approve one real draft, and confirm it arrives
   in the customer's LINE chat.
