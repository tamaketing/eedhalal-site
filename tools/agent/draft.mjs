// EED HALAL — write path for the sales/quotation positions (A02, A04).
//
//   node tools/agent/draft.mjs resolve --line-user U123
//   node tools/agent/draft.mjs create  --customer <id> --message "..." --reply "..." [--lead <id>] [--source-event <id>] [--position A02] [--job <jobId>]
//   node tools/agent/draft.mjs lead    --customer <id> --message "..." [--position A02]
//   node tools/agent/draft.mjs memory  --customer <id> --message "..." [--summary "..."] [--position A02]
//
// Every write goes through the Internal API on loopback. The API secret comes
// from EED_INTERNAL_API_SECRET in the environment and is never printed.
//
// WHAT THIS TOOL CANNOT DO — by design, there is no code path here:
//   - it cannot approve, edit, reject or send a message
//   - it cannot move a lead to another status (the owner decides)
//   - it cannot read or write .env, the menu catalogue or any published file
// A draft always lands as WAITING_FOR_HUMAN; the owner presses Send in the
// Owner Console.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { apiGet, apiPost, flag, wantsHelp } from './api-client.mjs';

const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

const HELP = `เครื่องมือเขียนผ่าน Internal API (สำหรับตำแหน่งขายและใบเสนอราคา)

  resolve --line-user <id>            หา customerId จาก LINE user id
  create  --customer <id> --message "<ข้อความลูกค้า>" --reply "<ร่างตอบ>"
          [--lead <id>] [--source-event <id>] [--position <A02|A04>] [--job <jobId>]
  lead    --customer <id> --message "<ข้อความลูกค้า>" [--position <A02>]
  memory  --customer <id> --message "<ข้อความลูกค้า>" [--summary "<1 บรรทัด>"] [--position <A02>]

ตัวเลือกร่วม: --json (พิมพ์ผลลัพธ์ดิบ), --help

หมายเหตุ: เครื่องมือนี้ส่งข้อความจริงไม่ได้ ทุกร่างจะรอเจ้าของกดส่งที่ Owner Console`;

function need(value, name) {
  if (!value) throw new Error(`ขาดค่า --${name}`);
  return value;
}

async function resolveCustomerId(args) {
  const customerId = flag(args, 'customer');
  if (customerId) return customerId;
  const lineUserId = flag(args, 'line-user');
  if (!lineUserId) throw new Error('ขาดค่า --customer หรือ --line-user');
  const data = await apiPost('/api/v1/customers/resolve', { lineUserId });
  const id = data?.customer?.id;
  if (!id) throw new Error('Internal API ไม่คืน customer id');
  return id;
}

async function commandResolve(args) {
  const customerId = await resolveCustomerId(args);
  const data = await apiGet(`/api/v1/customers/${encodeURIComponent(customerId)}/thread`);
  const customer = data?.customer || null;
  return { customerId, customer };
}

async function commandCreate(args) {
  const customerId = await resolveCustomerId(args);
  const message = need(flag(args, 'message'), 'message');
  const reply = need(flag(args, 'reply'), 'reply');
  const position = flag(args, 'position', 'A02');
  const jobId = flag(args, 'job', '');
  const sourceEventId = flag(args, 'source-event', '');
  const leadId = flag(args, 'lead', '');
  const body = {
    customerId,
    incomingMessage: message,
    draftResponse: reply,
    channel: flag(args, 'channel', 'line'),
    source: `agent:${position}`,
    aiModel: 'opencode-agent',
    metadata: {
      writtenBy: 'opencode-agent',
      claimedBy: position,
      ...(jobId ? { jobId } : {}),
    },
    ...(leadId ? { leadId } : {}),
    ...(sourceEventId ? { sourceEventId } : {}),
  };
  const data = await apiPost('/api/v1/drafts', body);
  return { draft: data?.draft || null, deduped: Boolean(data?.deduped) };
}

async function commandLead(args) {
  const customerId = await resolveCustomerId(args);
  const message = need(flag(args, 'message'), 'message');
  const position = flag(args, 'position', 'A02');
  const data = await apiPost('/api/v1/leads/evaluate', {
    customerId,
    message,
    sourceEventId: flag(args, 'source-event', '') || null,
  });
  return {
    customerId,
    shouldCreate: Boolean(data?.shouldCreate),
    lead: data?.lead || null,
    signals: data?.signals || null,
    deduped: Boolean(data?.deduped),
    position,
  };
}

async function commandMemory(args) {
  const customerId = await resolveCustomerId(args);
  const message = need(flag(args, 'message'), 'message');
  const summary = flag(args, 'summary', '');
  const data = await apiPost(`/api/v1/customers/${encodeURIComponent(customerId)}/memory/observe`, {
    message,
    summary,
    source: summary ? 'ai' : 'rule',
  });
  return { customerId, memory: data?.memory || null };
}

function render(result) {
  const lines = [];
  if (result.customerId) lines.push(`customerId: ${result.customerId}`);
  if (result.draft) {
    lines.push(`ร่างตอบ: ${result.draft.draftId || result.draft.id}`);
    lines.push(`สถานะ: ${result.draft.status || 'WAITING_FOR_HUMAN'}`);
    lines.push(result.deduped ? 'หมายเหตุ: มีร่างของข้อความนี้อยู่แล้ว ไม่ได้สร้างซ้ำ' : 'สร้างร่างใหม่แล้ว');
  }
  if (result.lead) {
    lines.push(`lead: ${result.lead.id || ''} สถานะ ${result.lead.status || ''}`);
    lines.push(result.shouldCreate ? 'ตั้ง lead ใหม่ (ตามกฎที่ระบบกำหนด)' : 'ไม่ต้องสร้าง lead ตามกฎ');
  }
  if (result.memory) lines.push(`บันทึกความจำลูกค้าแล้ว${result.memory.summary ? `: ${result.memory.summary}` : ''}`);
  if (result.customer) {
    lines.push(`ลูกค้า: ${result.customer.displayName || 'ไม่ระบุชื่อ'}${result.customer.companyName ? ` (${result.customer.companyName})` : ''}`);
  }
  lines.push('ร่างตอบยังไม่ถูกส่ง — เจ้าของกดส่งที่ Owner Console เท่านั้น');
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (wantsHelp(args) || args.length === 0) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const command = args.find((arg) => !arg.startsWith('-')) || '';
  let result;
  if (command === 'resolve') result = await commandResolve(args);
  else if (command === 'create') result = await commandCreate(args);
  else if (command === 'lead') result = await commandLead(args);
  else if (command === 'memory') result = await commandMemory(args);
  else {
    process.stderr.write(`ไม่รู้จักคำสั่ง "${command}" — ใช้ได้แค่: resolve, create, lead, memory\n`);
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${args.includes('--json') ? JSON.stringify(result, null, 2) : render(result)}\n`);
}

if (isCli) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
