// EED HALAL — broadcast runner (the ONLY scheduled sender in the shop).
//
// Owner decision recorded in AGENTS.md (2026-10-26): the shop adds ONE
// owner-approved weekly LINE broadcast (วันอังคาร 09:00). This runner lives
// OUTSIDE server/services/db on purpose (the guard test Q+R keeps scheduler
// and sending code away from the API/domain layer) and does exactly two
// things per pass — both gated:
//
//   1. Make sure the current ISO week (Asia/Bangkok) HAS a draft built from
//      real business data (menu central + business rules). The draft lands
//      as PENDING_REVIEW and never sends on its own — the owner approves it
//      in the Owner Console first.
//   2. Deliver ONLY rows the owner already approved (SCHEDULED) when their
//      slot arrived. A row whose slot passed while the machine was off
//      becomes MISSED after the same-day 21:00 (Bangkok) catch-up window —
//      it never sends late on its own; the owner sees it and resends.
//
// Kill switch: BROADCAST_ENABLED=false in .env stops everything (no
// drafting, no sending) without touching the queue data.
//
// Runs alongside the LINE server: tools/line/launcher.mjs spawns this file.
// Usage: node tools/line/broadcast-runner.mjs [--once]

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAdapter } from '../../db/index.mjs';
import {
  broadcastQuotaSummary,
  ensureWeeklyBroadcast,
  failBroadcastWithCode,
  isBroadcastMissed,
  listDueBroadcasts,
  markMissedBroadcast,
  sendDueBroadcast,
} from '../../services/broadcasts.mjs';
import { buildWeeklyBroadcastDraft, broadcastSiteBaseUrl } from './broadcast-drafts.mjs';

const RUNNER_ACTOR = 'broadcast-runner';
const SWEEP_INTERVAL_MS = 60_000;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DB_DIR = path.join(ROOT, 'data', 'line-runtime');
const ENV_PATH = path.join(ROOT, '.env');
const RUNTIME_ENV_PATH = path.join(DB_DIR, 'runtime.env');

// Minimal .env parser (same style as the launcher; the project has no dotenv).
function parseEnvFile(text) {
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

// Precedence matches the launcher: .env -> runtime.env -> real process env.
export function loadRunnerEnv(env = process.env) {
  const parsed = {};
  for (const file of [ENV_PATH, RUNTIME_ENV_PATH]) {
    if (!existsSync(file)) continue;
    try {
      Object.assign(parsed, parseEnvFile(readFileSync(file, 'utf8')));
    } catch {
      // An unreadable file must not block the runner; process env still works.
    }
  }
  return { ...parsed, ...env };
}

export function isBroadcastEnabled(env = {}) {
  return String(env.BROADCAST_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
}

/** Weekly draft wiring for production. Tests inject their own builder. */
export function weeklyDraftBuilder({ env }) {
  return async ({ now }) => buildWeeklyBroadcastDraft({
    now,
    plannerPath: env.EED_PLANNER_PATH || undefined,
    rulesPath: env.EED_BROADCAST_RULES_PATH || undefined,
    siteBaseUrl: broadcastSiteBaseUrl(env),
  });
}

/**
 * One runner pass. All external effects flow through deps so tests run dry:
 * the draft builder (file/catalog reads), the quota probes, and the provider
 * all stay injectable. Nothing here schedules by itself — callers own the
 * loop.
 */
export async function runBroadcastSweep({
  repos,
  env = {},
  now = new Date(),
  send,
  quota,
  consumption,
  builder,
  log = () => {},
} = {}) {
  if (!isBroadcastEnabled(env)) {
    return { disabled: true };
  }
  const summary = {
    disabled: false,
    draftState: null, // created | exists | error
    pendingCount: 0,
    scheduledCount: 0,
    sent: 0,
    failed: 0,
    missed: 0,
    retried: 0,
    errors: 0,
  };

  // 1) Weekly draft. Errors here are not fatal: the catalogue or rules file
  //    may be mid-edit; the next pass retries. Never invent content instead.
  if (typeof builder === 'function') {
    try {
      const { deduped } = await ensureWeeklyBroadcast(repos, builder, { now });
      summary.draftState = deduped ? 'exists' : 'created';
    } catch (error) {
      summary.draftState = 'error';
      log(`[broadcast] สร้างร่างของสัปดาห์นี้ไม่สำเร็จ (${error.message}) — จะลองใหม่รอบถัดไป`);
    }
  }
  for (const [status, key] of [['PENDING_REVIEW', 'pendingCount'], ['SCHEDULED', 'scheduledCount']]) {
    const rows = await repos.broadcastMessages.listByStatus(status);
    summary[key] = rows.length;
  }

  // 2) Deliver only owner-approved rows whose slot arrived.
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    if (summary.scheduledCount > 0) {
      log('[broadcast] ยังไม่มี LINE_CHANNEL_ACCESS_TOKEN ใน .env — ขาดส่งเฉพาะข้อความที่อนุมัติไว้ (ร่างยังเตรียมตามปกติ)');
    }
    return summary;
  }
  const due = await listDueBroadcasts(repos, now);
  for (const row of due) {
    try {
      if (isBroadcastMissed(row, now)) {
        await markMissedBroadcast(repos, row.id, { ownerId: RUNNER_ACTOR });
        summary.missed += 1;
        continue;
      }
      // Quota floor: stop loudly when LINE already says the month is empty
      // instead of burning API calls all night.
      const quotaStatus = await broadcastQuotaSummary({ token, quota, consumption });
      if (quotaStatus.ok && quotaStatus.type === 'limited' && quotaStatus.remaining !== null && quotaStatus.remaining <= 0) {
        await failBroadcastWithCode(repos, row.id, 'QUOTA_EXHAUSTED');
        summary.failed += 1;
        continue;
      }
      const result = await sendDueBroadcast(repos, row.id, { now, token, send });
      const outcome = result?.send?.outcome;
      if (outcome === 'ACCEPTED' || outcome === 'ALREADY_ACCEPTED') summary.sent += 1;
      else if (outcome === 'RETRYABLE_FAILURE') summary.retried += 1;
      else summary.failed += 1;
    } catch (error) {
      summary.errors += 1;
      log(`[broadcast] จัดการข้อความ ${row.id} ไม่สำเร็จ: ${error.message}`);
    }
  }
  return summary;
}

function describeSummary(summary) {
  const parts = [];
  if (summary.draftState === 'created') parts.push('สร้างร่างรายสัปดาห์ให้แล้ว (รอเจ้าของอนุมัติ)');
  if (summary.draftState === 'error') parts.push('สร้างร่างไม่สำเร็จ — จะลองใหม่รอบถัดไป');
  if (summary.pendingCount > 0) parts.push(`รายการรอเจ้าของอนุมัติ ${summary.pendingCount} ชุด`);
  if (summary.scheduledCount > 0) parts.push(`รอเวลาส่ง ${summary.scheduledCount} ชุด`);
  if (summary.sent) parts.push(`ส่งแล้ว ${summary.sent} ชุด`);
  if (summary.missed) parts.push(`ข้ามเพราะเครื่องปิดเกินหน้าต่างเวลา ${summary.missed} ชุด`);
  if (summary.failed) parts.push(`ส่งไม่สำเร็จ ${summary.failed} ชุด`);
  if (summary.retried) parts.push(`ส่งไม่ติดและจะลองใหม่ ${summary.retried} ชุด`);
  if (summary.errors) parts.push(`เกิดปัญหาอย่างอื่น ${summary.errors} ชุด`);
  return parts.join(' · ') || 'ไม่มีอะไรต้องทำในรอบนี้';
}

/** Only print when the pass actually did something — every minute is silent. */
export function logBroadcastSummary(summary, log = console.log) {
  if (summary.disabled) return;
  const active = summary.draftState === 'created' || summary.draftState === 'error' ||
    summary.sent || summary.failed || summary.missed || summary.retried || summary.errors;
  log(`[broadcast] ${describeSummary(summary)}`);
  return active;
}

export function describeQuota(quotaStatus) {
  if (!quotaStatus.ok) return `ตรวจโควตาไม่ได้ (${quotaStatus.code})`;
  if (quotaStatus.type === 'limited') {
    return `โควตาเดือนนี้ใช้ไป ${quotaStatus.used ?? '-'} จาก ${quotaStatus.limit} ข้อความ เหลือ ${quotaStatus.remaining ?? '-'}`;
  }
  return 'แพ็กเกจของร้านไม่จำกัดโควตาการกระจายข้อมูล';
}

async function main() {
  const once = process.argv.includes('--once');
  const env = loadRunnerEnv();
  if (!isBroadcastEnabled(env)) {
    console.log('[broadcast] หยุดชั่วคราวตามค่าที่ตั้งไว้ (BROADCAST_ENABLED=false) — ตัวรันจะไม่สร้างร่างและไม่ส่ง');
    return;
  }
  // Same adapter resolution as the internal API: launcher sets DB_ADAPTER
  // explicitly; a manual run falls back to PostgreSQL when configured, else
  // the file DB in data/line-runtime/.
  const resolved = { ...env };
  if (!resolved.DB_ADAPTER) {
    resolved.DB_ADAPTER = resolved.DATABASE_URL ? 'postgres' : 'file';
    resolved.DB_DIR = resolved.DB_DIR || DB_DIR;
  }
  const repos = createAdapter(resolved);
  await repos.ping();
  const builder = weeklyDraftBuilder({ env: resolved });
  console.log(`Broadcast runner เริ่มทำงาน (ตรวจทุก ${Math.round(SWEEP_INTERVAL_MS / 1000)} วินาที${once ? ' รอบเดียว' : ''})`);

  let busy = false;
  const sweep = async () => {
    if (busy) return;
    busy = true;
    try {
      const summary = await runBroadcastSweep({
        repos,
        env: resolved,
        builder,
        log: console.log,
      });
      logBroadcastSummary(summary, console.log);
    } catch (error) {
      console.error(`[broadcast] รอบการทำงานพลาด: ${error.message}`);
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => { void sweep(); }, SWEEP_INTERVAL_MS);
  const shutdown = () => {
    clearInterval(timer);
    repos.close?.().catch(() => {}).finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await sweep();
  if (once) shutdown();
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  await main();
}
