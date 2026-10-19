// Read the customer's message queue through the internal business API.
//
//   node tools/agent/inbox.mjs drafts          waiting for the owner
//   node tools/agent/inbox.mjs drafts --json
//   node tools/agent/inbox.mjs drafts --limit 5
//
// READ ONLY. There is no send, no approve and no write path here: the agent
// drafts an answer for the owner, and the owner presses Send in the Owner
// Console. The API secret is read from the environment and never printed.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

export const API_HOST = process.env.INTERNAL_API_HOST || '127.0.0.1';
export const API_PORT = Number(process.env.INTERNAL_API_PORT || 8788);
export const API_BASE = `http://${API_HOST}:${API_PORT}`;

function apiSecret(env = process.env) {
  const secret = env.EED_INTERNAL_API_SECRET;
  if (!secret) {
    throw new Error(
      'ยังไม่ได้ตั้ง EED_INTERNAL_API_SECRET — ต้องเปิด API ก่อนด้วย npm run api:start และตั้งค่า secret ในสภาพแวดล้อม',
    );
  }
  return secret;
}

export async function apiGet(route, { secret = apiSecret(), timeoutMs = 5000 } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${route}`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(`เชื่อมต่อ Internal API ที่ ${API_BASE} ไม่ได้ — เปิดด้วย npm run api:start แล้วลองอีกครั้ง`);
  }
  if (response.status === 401) throw new Error('Internal API ไม่ยอมรับ secret ที่ตั้งไว้ ตรวจ EED_INTERNAL_API_SECRET อีกครั้ง');
  if (!response.ok) throw new Error(`Internal API ตอบกลับ ${response.status}`);
  return response.json();
}

export async function listDrafts({ status = 'WAITING_FOR_HUMAN', limit = 20, order = 'desc' } = {}) {
  const query = new URLSearchParams({ status, limit: String(limit), order });
  const payload = await apiGet(`/api/v1/drafts?${query}`);
  return Array.isArray(payload?.drafts) ? payload.drafts : [];
}

function render(drafts) {
  if (!drafts.length) return 'ไม่มีข้อความที่รอตอบอยู่';
  const lines = [`ข้อความที่รอเจ้าของตอบ ${drafts.length} รายการ`, '='.repeat(60)];
  for (const draft of drafts) {
    const customer = draft.customer || {};
    lines.push('');
    lines.push(`[${draft.draftId || draft.id}] ${draft.channel || 'LINE'}`);
    lines.push(`  ลูกค้า : ${customer.displayName || 'ไม่ระบุชื่อ'}${customer.companyName ? ` (${customer.companyName})` : ''}`);
    lines.push(`  เข้ามา: ${draft.incomingMessage || '(ไม่มีข้อความ)'}`);
    if (draft.draftResponse) {
      lines.push(`  ร่างตอบ: ${draft.draftResponse}`);
    }
    if (draft.status) lines.push(`  สถานะ: ${draft.status}`);
  }
  lines.push('');
  lines.push('ร่างคำตอบได้ที่นี่ แต่กดส่งจริงที่ Owner Console เท่านั้น');
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.find((arg) => !arg.startsWith('-')) || 'drafts';
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : 20;

  if (command !== 'drafts') {
    process.stderr.write(`ไม่รู้จักคำสั่ง "${command}" — ใช้ได้แค่: drafts\n`);
    process.exitCode = 2;
    return;
  }

  const drafts = await listDrafts({ limit: Number.isFinite(limit) ? limit : 20 });
  process.stdout.write(`${args.includes('--json') ? JSON.stringify(drafts, null, 2) : render(drafts)}\n`);
}

if (isCli) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}