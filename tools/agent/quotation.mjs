// EED HALAL — quotation tool for the quotation position (A04).
//
//   node tools/agent/quotation.mjs create --customer <id> --message "<ข้อความลูกค้า>" --quote "<ข้อความใบเสนอราคา>"
//            [--quantity <n>] [--event-date <YYYY-MM-DD>] [--location "<สถานที่>"] [--budget <n>]
//            [--service-type <mealbox|buffet|...>] [--source-event <id>]
//   node tools/agent/quotation.mjs list [--limit <n>] [--status <status>]
//   node tools/agent/quotation.mjs show <quotationId>
//
// A quotation is a lead (structured job data the deterministic rules extracted)
// plus the draft the owner reviews and sends. This tool records that pair and
// shows what is still missing.
//
// WHAT THIS TOOL CANNOT DO — there is no code path here:
//   - it cannot approve, send, or move a lead
//   - it cannot compute a price (use menu-match.mjs) or a delivery fee
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { apiGet, apiPost, flag, wantsHelp } from './api-client.mjs';

const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

const HELP = `เครื่องมือใบเสนอราคา (สำหรับตำแหน่ง A04)

  create --customer <id> --message "<ข้อความลูกค้า>" --quote "<ข้อความใบเสนอราคา>"
         [--quantity <n>] [--event-date <YYYY-MM-DD>] [--location "<สถานที่>"] [--budget <n>]
         [--service-type <ประเภทบริการ>] [--source-event <id>]
  list   [--limit <n>] [--status <สถานะ>]
  show   <quotationId>

ตัวเลือกร่วม: --json (พิมพ์ผลลัพธ์ดิบ), --help

หมายเหตุ: ใบเสนอราคายังไม่ถูกส่ง — เจ้าของกดส่งที่ Owner Console เท่านั้น`;

function need(value, name) {
  if (!value) throw new Error(`ขาดค่า --${name}`);
  return value;
}

function numberOrNull(value) {
  if (value === '' || value === undefined || value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function commandCreate(args) {
  const body = {
    customerId: need(flag(args, 'customer'), 'customer'),
    message: need(flag(args, 'message'), 'message'),
    quoteText: need(flag(args, 'quote'), 'quote'),
    quantity: numberOrNull(flag(args, 'quantity')),
    eventDate: flag(args, 'event-date') || null,
    location: flag(args, 'location') || null,
    budgetPerPerson: numberOrNull(flag(args, 'budget')),
    serviceType: flag(args, 'service-type') || null,
    sourceEventId: flag(args, 'source-event') || null,
  };
  const data = await apiPost('/api/v1/quotations', body);
  return { quotation: data?.quotation || null, deduped: Boolean(data?.deduped) };
}

async function commandList(args) {
  const query = new URLSearchParams({
    limit: String(Number(flag(args, 'limit', '20')) || 20),
    status: flag(args, 'status', 'WAITING_FOR_HUMAN'),
  });
  const data = await apiGet(`/api/v1/quotations?${query}`);
  return { quotations: Array.isArray(data?.quotations) ? data.quotations : [], total: data?.total ?? 0 };
}

async function commandShow(args) {
  const id = args.find((arg) => !arg.startsWith('-') && arg !== 'show');
  if (!id) throw new Error('ขาดรหัสใบเสนอราคา');
  const data = await apiGet(`/api/v1/quotations/${encodeURIComponent(id)}`);
  return { quotation: data?.quotation || null };
}

function render(result) {
  const lines = [];
  const quotations = result.quotations ? result.quotations : result.quotation ? [result.quotation] : [];
  if (result.deduped) lines.push('หมายเหตุ: มีใบเสนอราคาของข้อความนี้อยู่แล้ว ไม่ได้สร้างซ้ำ');
  if (!quotations.length) {
    lines.push('ยังไม่มีใบเสนอราคาในคิว');
    return lines.join('\n');
  }
  for (const q of quotations) {
    lines.push('');
    lines.push(`[${q.quotationId || '-'}] สถานะ ${q.status || '-'} · lead ${q.leadStatus || '-'}`);
    lines.push(`  ลูกค้า : ${q.customerName || 'ไม่ระบุชื่อ'}${q.companyName ? ` (${q.companyName})` : ''}`);
    lines.push(`  งาน   : ${q.quantity ?? '?'} คน · ${q.eventDate || 'ไม่ระบุวันที่'} · ${q.location || 'ไม่ระบุสถานที่'}`);
    if (q.budgetPerPerson != null) lines.push(`  งบ    : ${q.budgetPerPerson} บาท/กล่อง`);
    if (q.quoteText) lines.push(`  ร่าง  : ${q.quoteText}`);
    for (const gap of q.blocking || []) lines.push(`  ขาด   : ${gap.label} — ${gap.why}`);
    for (const gap of q.advisory || []) lines.push(`  หมายเหตุ: ${gap.label} — ${gap.why}`);
    lines.push(q.readyForOwner ? '  สถานะ : ข้อมูลครบ รอเจ้าของอนุมัติ' : '  สถานะ : ข้อมูลยังไม่ครบ');
  }
  lines.push('');
  lines.push('ใบเสนอราคายังไม่ถูกส่ง — เจ้าของกดส่งที่ Owner Console เท่านั้น');
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
  if (command === 'create') result = await commandCreate(args);
  else if (command === 'list') result = await commandList(args);
  else if (command === 'show') result = await commandShow(args);
  else {
    process.stderr.write(`ไม่รู้จักคำสั่ง "${command}" — ใช้ได้แค่: create, list, show\n`);
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
