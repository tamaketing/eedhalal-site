# Customer Data Retention

## Policy
- Conversation brief held in n8n workflow static data: 24 hours.
- Follow-up lead record: 30 days after last activity, unless a customer requests deletion earlier.
- n8n execution records: configure pruning in n8n to retain successful and failed execution data for no more than 14 days.
- Do not store payment data, identity documents, or customer data in Git, website analytics, browser storage, or exported workflow files.

## Required deletion controls
1. Import and activate `data-retention-workflow.json`; it removes expired 24-hour conversation briefs each day.
2. Schedule `node line-ai/purge-leads.mjs` once per day with `LEADS_DIR` and `LEAD_RETENTION_DAYS=30` set in the service environment.
3. For an approved deletion request, run `node line-ai/purge-leads.mjs --user-id U...`; record only the request date and completion status in the private operations log.
4. In n8n, enable execution pruning and set both successful and failed execution retention to 14 days or less.

## Access and incident handling
- Restrict n8n, the lead directory, and environment files to named operators.
- Never send customer text, names, phone numbers, delivery details, or LINE user IDs to analytics or monitoring alerts.
- If customer data is exposed, rotate LINE and n8n secrets, suspend the affected workflow, delete exposed copies, and notify the owner.
