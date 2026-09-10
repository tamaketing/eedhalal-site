# LINE AI Setup

See `OPERATIONS.md` for the required secure deployment path. This replaces the old direct-SQLite and temporary-tunnel instructions.

1. Keep LINE, Gemini, and OpenAI tokens only in n8n credentials or the host secret manager.
2. Run `START-EED-BOT-SECURE.cmd` from the Desktop and point LINE at its copied `/line-webhook` endpoint.
3. Import `n8n-workflow.json`, set credentials in n8n, then activate the workflow.
4. Import and activate `data-retention-workflow.json`; schedule `purge-leads.mjs` daily if leads are enabled.
5. Run `node scripts/check-system.mjs --write`, `node --test`, and `node scripts/smoke-production.mjs` before production changes.

The old follow-up template was removed because it stored customer text in local files and instructed operators to paste access tokens into workflow nodes. Reintroduce follow-up only after implementing it with n8n credentials, an approved data store, consent controls, and the retention policy in `DATA-RETENTION.md`.

When the bot runs only on an operator machine, it cannot reply while that machine is off. Keep `BOT_MONITORING_ENABLED=false`; use the manual health check in `OPERATIONS.md` every time the bot starts, and make sure staff have an off-hours/manual-response process in LINE OA.
