# LINE AI Operations

## Human-approval foundation (current)

```
LINE customer
  -> webhook-gateway.mjs (verifies X-Line-Signature, forwards with EED_WEBHOOK_FORWARD_SECRET)
  -> n8n: LINE Webhook -> Verify Webhook Gateway -> Deterministic FAQ
  -> Has Safe Answer? -> AI Agent (or deterministic fallback)
  -> Normalize Event -> Resolve Customer (Internal API)
  -> Evaluate Lead (Internal API) -> Persist Draft (Internal API, PostgreSQL)
  -> Verify Draft (asserts WAITING_FOR_HUMAN, workflow ENDS here)
```

- No node in `n8n-workflow.json` may reply/push to a LINE customer or push
  to the kitchen group. `node scripts/check-system.mjs` (and
  `test/line-human-approval.test.mjs`) fails the build if a sender exists.
- AI output is a draft only. The owner reviews each persisted draft
  (Internal API list filtered by WAITING_FOR_HUMAN) and replies manually in
  LINE OA: approve/send as-is, edit first, ask the customer for missing info
  (regenerate next turn), or reject. Only a future owner-triggered sender
  node may deliver messages, never the AI path.
- Kitchen auto-push stays disabled until the approval sender exists.
  Do not re-add the old `Push to Kitchen Group` / `Upsert CRM Lead` nodes.
- Drafts persist in PostgreSQL via the Internal API chain (no static Draft
  staging on the success path). The schema in `line-ai/draft-schema.mjs` is
  the single domain contract; storage adapters only map it 1:1.
- Central database: see `docs/database.md`. `DB_ADAPTER` (memory/file/
  postgres), `DB_DIR`, `DATABASE_URL` live in the host environment, never in
  the repo. PostgreSQL is the durable Draft source of truth.
- Internal business API: see `docs/internal-api.md`. Phase 4B-2 defines the
  persistence chain in git, but DO NOT import it into live n8n, activate it,
  or change production credentials until the owner approves after review.
  n8n authenticates with the `EED Internal API` HTTP Header Auth credential
  and `$env.INTERNAL_API_BASE_URL` (default http://127.0.0.1:8788).
- PostgreSQL runtime: see `docs/database.md` (fail-closed startup, lifecycle,
  `/readiness`, migrations, real-PG integration gate). Production n8n stays
  disconnected; no sender, no kitchen push.
- Business data always derives from `data/business-rules.json` +
  `data/planner-overrides.json` via `node scripts/check-system.mjs --write`
  (knowledge pack, system message, router menus, draft revision).
  Never edit the prompt or prices directly in the n8n UI.

## Required environment
Copy `.env.example` to the service environment and set every LINE, n8n, retention, and monitoring value there. Secrets belong in the host secret manager or n8n credentials, never in workflow JSON, JavaScript, GitHub Actions logs, or URLs.

## Secure webhook path
1. On this Windows machine, run `START-EED-BOT-SECURE.cmd` from the Desktop. It starts n8n, the gateway, a temporary cloudflared tunnel to port `8787`, and a local health smoke check.
2. Set the LINE Developers webhook URL to `https://bot.example.com/line-webhook`.
3. Keep n8n reachable only from the gateway/private network.
4. Set `EED_WEBHOOK_FORWARD_SECRET` in both the gateway service and n8n environment.
5. Import `n8n-workflow.json`, configure n8n credentials in its UI, publish it, and verify the `Verify Webhook Gateway` node remains first after the webhook.

The gateway validates LINE's raw-body `X-Line-Signature` with `LINE_CHANNEL_SECRET` using a timing-safe comparison. n8n rejects requests without the internal forwarding secret.

On the first launch, the launcher asks once for the LINE Channel Secret and creates the ignored `D:\eedhalal\.env`; it generates the internal forwarding secret automatically. `START-EED-BOT.cmd` delegates to the secure launcher and tunnels only to the verified gateway.

The Desktop launchers call `D:\eedhalal\START-EED-BOT.cmd`, which runs `line-ai/start-bot.ps1`. If a Desktop launcher is missing, run the project copy directly. Run `START-EED-BOT.cmd -CheckOnly` to check installed dependencies without starting services or prompting for secrets. Startup failures remain visible in the console; service logs are saved to ignored `line-ai/*.log` files. Keep the launcher window open while the bot is running; Ctrl+C stops its child services. The existing Desktop `STOP-EED-BOT.cmd` can also stop the launcher and its process tree.

## Workflow changes
- Run `node scripts/check-system.mjs --write` after changing the prompt or menu source; this synchronizes the knowledge pack, combined system message, template agent prompt, deterministic router menus, and draft revision.
- After the owner approves the Phase 4B-2 workflow for import: re-import
  `n8n-workflow.json` in n8n (it deactivates on CLI import — publish again),
  create the `EED Internal API` header-auth credential, verify the chain ends
  at `Verify Draft`, then send one controlled test message and confirm a
  PostgreSQL Draft with `status: WAITING_FOR_HUMAN` and zero outbound LINE.
  Until then, live n8n keeps running the previously approved workflow.
- Import workflow templates through the n8n UI. For the existing conversation workflow, `node line-ai/publish-workflow.mjs` updates only the conversation nodes while preserving its model credentials and LINE/CRM integrations; set `N8N_BASE_URL`, `N8N_API_KEY`, and `N8N_LINE_WORKFLOW_ID` first, then publish the saved draft in n8n.
- The `Deterministic FAQ` node in the existing workflow now prepares conversation input: text must set `hasSafeAnswer=false` so it reaches AI Agent and memory. Only unsupported message types receive a fixed fallback. Explicit per-box budgets are filtered against current menu prices before the AI call.
- Without an API key, use supported n8n export/import commands. `prepare-conversation-update.mjs` reads the ignored `live-workflow-export-before.json` backup, selects `N8N_LINE_WORKFLOW_ID`, and generates a candidate plus a manual-only evaluation workflow. CLI import deactivates a workflow; publish it again and restart n8n to load the new version. Never execute a production workflow as a test: it can send LINE messages and update CRM records.
- Do not write, inspect, migrate, or repair n8n's SQLite database directly. Use the n8n UI/API, workflow templates, and n8n's supported export/import features.
- Configure LINE, Gemini, and OpenAI credentials in n8n's credential store. Do not paste access tokens into HTTP Request nodes.

## Planner and kitchen tools
- `budget-planner.html` and `kitchen-order.html` are deliberately excluded from the GitHub Pages artifact. They are local-only convenience tools, not an admin application.
- A browser PIN, query-string key, or `localStorage` flag is not authentication. The previous Planner PIN gate was removed.
- If staff need shared remote access, place a server-backed admin app behind SSO/VPN or an identity-aware proxy, with role-based access, audit logs, and a real data store. Do not publish the current browser-only tools.

## Post-deploy and uptime
- The scheduled GitHub workflow always checks the public website. Leave `BOT_MONITORING_ENABLED` unset or `false` when the bot runs only on an operator's machine.
- Each time the operator starts the bot, run `SITE_URL=https://eedhalal.com BOT_MONITORING_ENABLED=true BOT_HEALTH_URL=http://127.0.0.1:8787/healthz node scripts/smoke-production.mjs` before accepting customer traffic.
- Set `BOT_MONITORING_ENABLED=true` only after moving the bot to an always-on host; then add `BOT_HEALTH_URL` and `ALERT_WEBHOOK_URL` as GitHub Actions secrets/variables.
- Configure `ALERT_WEBHOOK_URL` to receive only component/status failures, never request bodies or customer data.
- Enable the repository `Production Uptime` workflow and add `BOT_HEALTH_URL` plus `ALERT_WEBHOOK_URL` as GitHub Actions secrets.
