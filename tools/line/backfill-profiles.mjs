// Backfill LINE display names for customers that were saved before the profile
// sync existed. Safe to re-run: only customers with an empty displayName are
// fetched unless --all is passed.
//
//   node tools/line/backfill-profiles.mjs
//   node tools/line/backfill-profiles.mjs --all
//
// Reads .env (plus the real process environment) for:
//   LINE_CHANNEL_ACCESS_TOKEN, EED_INTERNAL_API_SECRET, INTERNAL_API_PORT
// The Internal API must already be running (start-line.cmd keeps it up).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanDisplayName } from '../../services/lineProfile.mjs';
import { fetchLineProfile } from './profile.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const ENV_PATH = path.join(ROOT, '.env');

export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = {
  ...(existsSync(ENV_PATH) ? parseEnvFile(readFileSync(ENV_PATH, 'utf8')) : {}),
  ...process.env,
};
const BASE = `http://127.0.0.1:${env.INTERNAL_API_PORT || 8788}`;
const SECRET = env.EED_INTERNAL_API_SECRET;
const TOKEN = env.LINE_CHANNEL_ACCESS_TOKEN;
const REFRESH_ALL = process.argv.includes('--all');
const DELAY_MS = 200;

if (!SECRET) {
  console.error('ไม่พบ EED_INTERNAL_API_SECRET — เปิด Internal API ก่อนแล้วลองใหม่');
  process.exit(1);
}
if (!TOKEN) {
  console.error('ไม่พบ LINE_CHANNEL_ACCESS_TOKEN — ใส่ใน .env หรือ set ใน environment ก่อน');
  process.exit(1);
}

async function call(method, route, body) {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${method} ${route} -> ${response.status} ${text.slice(0, 160)}`);
  }
  return response.json();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const data = await call('GET', '/api/v1/customers');
const customers = Array.isArray(data.customers) ? data.customers : [];
const targets = customers.filter((customer) => {
  if (!customer || !customer.lineUserId) return false;
  if (REFRESH_ALL) return true;
  return !cleanDisplayName(customer.displayName);
});

console.log(`ลูกค้าทั้งหมด ${customers.length} คน · ต้องดึงชื่อ ${targets.length} คน`);
let updated = 0;
let skipped = 0;
let failed = 0;

for (const customer of targets) {
  const label = cleanDisplayName(customer.displayName) || 'ยังไม่มีชื่อ';
  const result = await fetchLineProfile(customer.lineUserId, { token: TOKEN });
  if (!result.ok) {
    failed += 1;
    console.log(`- ${customer.id.slice(0, 8)} (${label}) ดึงไม่ได้: ${result.error}`);
    await sleep(DELAY_MS);
    continue;
  }
  if (result.displayName === cleanDisplayName(customer.displayName)) {
    skipped += 1;
    console.log(`- ${customer.id.slice(0, 8)} ชื่อเดิม: ${result.displayName}`);
    await sleep(DELAY_MS);
    continue;
  }
  try {
    await call('POST', `/api/v1/customers/${encodeURIComponent(customer.id)}/profile`, {
      displayName: result.displayName,
      syncedAt: new Date().toISOString(),
    });
    updated += 1;
    console.log(`- ${customer.id.slice(0, 8)} ${label} -> ${result.displayName}`);
  } catch (error) {
    failed += 1;
    console.log(`- ${customer.id.slice(0, 8)} บันทึกไม่สำเร็จ: ${error.message}`);
  }
  await sleep(DELAY_MS);
}

console.log(`\nเสร็จแล้ว: อัปเดต ${updated} · ไม่เปลี่ยน ${skipped} · พลาด ${failed}`);
if (failed) process.exitCode = 1;
