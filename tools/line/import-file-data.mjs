// EED HALAL — move the LINE runtime data from the file store into PostgreSQL.
//
// WHY THIS EXISTS
// The LINE server used to write everything into JSON files under
// data/line-runtime/. PostgreSQL is the source of truth (see docs/database.md)
// and already holds the earlier conversations, so this script MERGES the file
// store into PostgreSQL instead of replacing it: a customer who talked in
// September and again in October must stay ONE customer with one thread.
//
//   node tools/line/import-file-data.mjs --dry-run     report only
//   node tools/line/import-file-data.mjs               import
//
// Rules:
// - Customers merge on line_user_id (the LINE identity). A customer that
//   already exists in PostgreSQL keeps its id, so old drafts stay attached.
// - Every other row keeps its own id, and customer/lead/draft references are
//   remapped to the merged ids.
// - The run is idempotent: existing rows are skipped, never duplicated.
// - Inbound messages are linked to their customer and their draft here, so
//   the imported data is finally one connected thread instead of two
//   disconnected halves.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNTIME_DIR = path.join(ROOT, 'data', 'line-runtime');

const TABLES = ['customers', 'leads', 'drafts', 'inboundMessages', 'auditLogs', 'responseExamples'];

async function readStore() {
  const store = {};
  for (const name of TABLES) {
    const file = path.join(RUNTIME_DIR, `${name}.json`);
    const raw = await readFile(file, 'utf8').catch(() => '{}');
    const parsed = JSON.parse(raw || '{}');
    store[name] = Object.values(parsed || {});
  }
  return store;
}

/** Rows the file adapter keeps as {id: row}. */
export function rowsOf(parsed) {
  return Object.values(parsed || {});
}

export async function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('ต้องมี DATABASE_URL (ดู data/line-runtime/runtime.env)');
  }
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  await client.connect();

  const store = await readStore();
  const report = { dryRun, customers: { inserted: 0, merged: 0 }, leads: 0, drafts: 0, inbound: 0, audits: 0, examples: 0 };

  try {
    // --- customers: merge on line_user_id -------------------------------
    const idMap = new Map(); // file customer id -> postgres customer id
    for (const row of store.customers) {
      const existing = row.lineUserId
        ? (await client.query('select id from customers where line_user_id = $1', [row.lineUserId])).rows[0]
        : null;
      if (existing) {
        idMap.set(row.id, existing.id);
        report.customers.merged += 1;
        if (!dryRun) {
          // Fill in what the newer file row knows and the old row lacks.
          await client.query(
            `update customers set
               display_name = coalesce(nullif(display_name,''), $2),
               phone = coalesce(phone, $3),
               email = coalesce(email, $4),
               company_name = coalesce(company_name, $5),
               tax_id = coalesce(tax_id, $6),
               address = coalesce(address, $7),
               notes = coalesce(notes, $8),
               bot_paused_at = coalesce(bot_paused_at, $9),
               bot_pause_reason = coalesce(bot_pause_reason, $10),
               profile_synced_at = coalesce(profile_synced_at, $11),
               updated_at = now()
             where id = $1`,
            [existing.id, row.displayName ?? '', row.phone ?? null, row.email ?? null, row.companyName ?? null,
              row.taxId ?? null, row.address ?? null, row.notes ?? null, row.botPausedAt ?? null,
              row.botPauseReason ?? null, row.profileSyncedAt ?? null],
          );
        }
        continue;
      }
      let targetId = row.id;
      const clash = (await client.query('select 1 from customers where id = $1', [targetId])).rowCount;
      if (clash) targetId = randomUUID();
      idMap.set(row.id, targetId);
      report.customers.inserted += 1;
      if (!dryRun) {
        await client.query(
          `insert into customers (id, line_user_id, display_name, phone, email, company_name, tax_id, address, notes,
             created_at, updated_at, bot_paused_at, bot_pause_reason, profile_synced_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce($10, now()),coalesce($11, now()),$12,$13,$14)
           on conflict do nothing`,
          [targetId, row.lineUserId ?? null, row.displayName ?? '', row.phone ?? null, row.email ?? null,
            row.companyName ?? null, row.taxId ?? null, row.address ?? null, row.notes ?? null,
            row.createdAt ?? null, row.updatedAt ?? null, row.botPausedAt ?? null, row.botPauseReason ?? null,
            row.profileSyncedAt ?? null],
        );
      }
    }

    // --- leads ------------------------------------------------------------
    const leadMap = new Map();
    for (const row of store.leads) {
      const customerId = idMap.get(row.customerId) || row.customerId;
      const existing = (await client.query('select id from leads where id = $1', [row.id])).rowCount;
      if (existing) { leadMap.set(row.id, row.id); continue; }
      leadMap.set(row.id, row.id);
      report.leads += 1;
      if (!dryRun) {
        await client.query(
          `insert into leads (id, customer_id, source, service_type, event_date, quantity, location,
             budget_per_person, status, summary, source_event_id, created_at, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,coalesce($12, now()),coalesce($13, now()))
           on conflict do nothing`,
          [row.id, customerId, row.source || 'line', row.serviceType ?? null, row.eventDate ?? null,
            row.quantity ?? null, row.location ?? null, row.budgetPerPerson ?? null, row.status || 'NEW',
            row.summary || '', row.sourceEventId ?? null, row.createdAt ?? null, row.updatedAt ?? null],
        );
      }
    }

    // --- drafts -----------------------------------------------------------
    for (const row of store.drafts) {
      const customerId = idMap.get(row.customerId) || row.customerId || null;
      const leadId = row.leadId ? (leadMap.get(row.leadId) || row.leadId) : null;
      report.drafts += 1;
      if (dryRun) continue;
      await client.query(
        `insert into drafts (id, draft_id, customer_id, lead_id, channel, incoming_message, draft_response,
           owner_final_response, final_action, status, source, ai_model, rule_revision, metadata, history,
           source_event_id, created_at, updated_at, approved_at, sent_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,coalesce($17, now()),coalesce($18, now()),$19,$20)
         on conflict do nothing`,
        [row.id, row.draftId, customerId, leadId, row.channel || 'line', row.incomingMessage || '',
          row.draftResponse || '', row.ownerFinalResponse ?? null, row.finalAction ?? null,
          row.status || 'WAITING_FOR_HUMAN', row.source || 'conversation-ai', row.aiModel || '',
          row.ruleRevision || '', JSON.stringify(row.metadata || {}), JSON.stringify(row.history || []),
          row.sourceEventId ?? null, row.createdAt ?? null, row.updatedAt ?? null,
          row.approvedAt ?? null, row.sentAt ?? null],
      );
    }

    // --- inbound messages (linked to customer AND draft) -------------------
    const draftByEvent = new Map();
    for (const row of store.drafts) {
      if (row.sourceEventId) draftByEvent.set(row.sourceEventId, row.id);
    }
    for (const row of store.inboundMessages) {
      const customerId = row.customerId ? (idMap.get(row.customerId) || row.customerId) : null;
      const resolvedCustomer = customerId || null;
      const draftId = row.draftId ? row.draftId : (row.sourceEventId ? (draftByEvent.get(row.sourceEventId) || null) : null);
      const leadId = row.leadId ? (leadMap.get(row.leadId) || row.leadId) : null;
      report.inbound += 1;
      if (dryRun) continue;
      await client.query(
        `insert into inbound_messages (id, customer_id, line_user_id, channel, message_type, incoming_message,
           source_event_id, status, ai_error_code, ai_error_detail, retry_count, revision, lead_id, draft_id,
           metadata, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,coalesce($16, now()),coalesce($17, now()))
         on conflict do nothing`,
        [row.id, resolvedCustomer, row.lineUserId ?? null, row.channel || 'line', row.messageType || 'text',
          row.incomingMessage || '', row.sourceEventId ?? null, row.status || 'RECEIVED',
          row.aiErrorCode ?? null, row.aiErrorDetail ?? null, row.retryCount ?? 0, row.revision ?? 0,
          leadId, draftId, JSON.stringify(row.metadata || {}), row.createdAt ?? null, row.updatedAt ?? null],
      );
      // Link the customer from the LINE identity when the row had none yet.
      if (!row.customerId && row.lineUserId) {
        const byLine = (await client.query('select id from customers where line_user_id = $1', [row.lineUserId])).rows[0];
        if (byLine) {
          await client.query(
            `update inbound_messages set customer_id = $2, updated_at = now()
             where id = $1 and customer_id is null`,
            [row.id, byLine.id],
          );
        }
      }
    }

    // --- audit logs (remap customer entity ids) ---------------------------
    for (const row of store.auditLogs) {
      report.audits += 1;
      if (dryRun) continue;
      const entityId = row.entityType === 'customer' ? (idMap.get(row.entityId) || row.entityId) : row.entityId;
      await client.query(
        `insert into audit_logs (id, entity_type, entity_id, action, actor_type, actor_id, before_data, after_data, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9, now()))
         on conflict do nothing`,
        [row.id, row.entityType, entityId, row.action, row.actorType || 'SYSTEM', row.actorId || '',
          row.beforeData === undefined ? null : JSON.stringify(row.beforeData),
          row.afterData === undefined ? null : JSON.stringify(row.afterData),
          row.createdAt ?? null],
      );
    }

    // --- response examples ------------------------------------------------
    for (const row of store.responseExamples) {
      report.examples += 1;
      if (dryRun) continue;
      const sourceDraftId = row.sourceDraftId;
      const draftExists = (await client.query('select 1 from drafts where id = $1', [sourceDraftId])).rowCount;
      if (!draftExists) continue; // the FK forbids an example without its draft
      await client.query(
        `insert into response_examples (id, source_draft_id, intent, service_type, incoming_example,
           approved_response, style_tags, reusable, business_rules_revision, fingerprint, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11, now()),coalesce($12, now()))
         on conflict do nothing`,
        [row.id, sourceDraftId, row.intent || 'general', row.serviceType ?? null, row.incomingExample || '',
          row.approvedResponse || '', JSON.stringify(row.styleTags || []), row.reusable ?? true,
          row.businessRulesRevision || '', row.fingerprint, row.createdAt ?? null, row.updatedAt ?? null],
      );
    }

    const counts = (await client.query(
      `select (select count(*) from customers) customers, (select count(*) from leads) leads,
              (select count(*) from drafts) drafts, (select count(*) from inbound_messages) inbound,
              (select count(*) from audit_logs) audits, (select count(*) from response_examples) examples`,
    )).rows[0];

    console.log(report.dryRun ? 'ตัวอย่างสิ่งที่จะนำเข้า:' : 'นำเข้าเสร็จแล้ว:');
    console.log(`  ลูกค้า  : เพิ่ม ${report.customers.inserted} · รวมกับของเดิม ${report.customers.merged}`);
    console.log(`  lead ${report.leads} · draft ${report.drafts} · ข้อความเข้า ${report.inbound} · audit ${report.audits} · ตัวอย่างคำตอบ ${report.examples}`);
    console.log(`  ตารางใน PostgreSQL ตอนนี้: ลูกค้า ${counts.customers} · lead ${counts.leads} · draft ${counts.drafts} · ข้อความ ${counts.inbound} · audit ${counts.audits} · ตัวอย่าง ${counts.examples}`);
    return { report, counts };
  } finally {
    await client.end();
  }
}

const isCli = process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`;
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`นำเข้าข้อมูลไม่สำเร็จ: ${error.message}\n`);
    process.exitCode = 1;
  });
}
