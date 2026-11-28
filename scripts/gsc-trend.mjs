// Read-only GSC per-query trend fetch: 7/28/90 days vs the previous period.
// Uses the same OAuth vault, search type and lag as scripts/gsc-fetch.mjs.
// Writes JSON outside the repository; no credentials, tokens or PII in output.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { queryAnalytics, SCOPE } from '../tools/gsc/client.mjs';
import { SEARCH_TYPE, WINDOW_DAYS, windowDates } from './gsc-fetch.mjs';

const OUT = 'D:/eedhalal-runtime/gsc-trend.json';

export const FOCUS_PATTERNS = Object.freeze([
  ['ข้าวกล่องฮาลาล กรุงเทพ', /ข้าวกล่อง.*(ฮา\s*ลา\s*ล|halal).*(กรุงเทพ|bangkok)|(กรุงเทพ|bangkok).*ข้าวกล่อง/i],
  ['รับจัดเลี้ยงฮาลาล', /รับจัดเลี้ยง|จัดเลี้ยงฮาลาล|halal catering/i],
  ['บุฟเฟ่ต์ฮาลาล', /บุฟเฟ่ต์|buf(f|f)et.*halal|halal buf(f|f)et/i],
  ['Snack Box ฮาลาล', /snack\s*box/i],
  ['Halal Meal Box Bangkok', /halal meal box|halal box.*bangkok|ข้าวกล่องฮาลาล/i],
]);

const norm = (q) => String(q || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function rowsByQuery(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = norm(row.keys?.[0]);
    if (!key) continue;
    const cur = map.get(key) || { key, clicks: 0, impressions: 0, posWeighted: 0 };
    cur.clicks += row.clicks || 0;
    cur.impressions += row.impressions || 0;
    cur.posWeighted += (row.position || 0) * (row.impressions || 0);
    map.set(key, cur);
  }
  return [...map.values()].map((q) => ({
    key: q.key,
    clicks: q.clicks,
    impressions: q.impressions,
    ctr: q.impressions ? q.clicks / q.impressions : 0,
    position: q.impressions ? q.posWeighted / q.impressions : 0,
  }));
}

export function compareQueries(current, previous, siteCtr) {
  const prev = new Map(previous.map((q) => [q.key, q]));
  return current.map((q) => {
    const before = prev.get(q.key);
    const deltaClicks = q.clicks - (before?.clicks || 0);
    const deltaImpressions = q.impressions - (before?.impressions || 0);
    return {
      ...q,
      previousClicks: before?.clicks || 0,
      previousImpressions: before?.impressions || 0,
      deltaClicks,
      deltaImpressions,
      rankDrop: Boolean(before && q.position != null && before.position != null && q.position - before.position >= 0.5),
      belowSiteCtr: Boolean(q.impressions >= 5 && q.ctr < siteCtr),
    };
  });
}

async function fetchWindowRows(siteUrl, dates) {
  const rows = [];
  let startRow = 0;
  for (;;) {
    const response = await queryAnalytics({ siteUrl, payload: {
      startDate: dates.startDate,
      endDate: dates.endDate,
      dimensions: ['query'],
      type: SEARCH_TYPE,
      rowLimit: 25000,
      startRow,
    } });
    const batch = response.rows || [];
    rows.push(...batch);
    if (batch.length < 25000) break;
    startRow += 25000;
  }
  return rows;
}

export async function fetchTrend({
  site = process.env.EED_GSC_SITE_URL || 'sc-domain:eedhalal.com',
  now = new Date(),
  fetchRows = fetchWindowRows,
} = {}) {
  const windows = {};
  for (const days of WINDOW_DAYS) {
    const currentDates = windowDates(days, now);
    const previousDates = windowDates(days, now, 3, 1);
    const [currentRows, previousRows] = await Promise.all([
      fetchRows(site, currentDates),
      fetchRows(site, previousDates),
    ]);
    const current = rowsByQuery(currentRows);
    const previous = rowsByQuery(previousRows);
    const siteCtr = current.reduce((s, q) => s + q.clicks, 0) / Math.max(1, current.reduce((s, q) => s + q.impressions, 0));
    const compared = compareQueries(current, previous, siteCtr);
    const focus = FOCUS_PATTERNS.map(([label, pattern]) => ({
      label,
      queries: compared.filter((q) => pattern.test(q.key))
        .sort((a, b) => b.impressions - a.impressions).slice(0, 12),
    }));
    windows[`d${days}`] = {
      currentDates, previousDates,
      currentQueries: current.length, previousQueries: previous.length,
      siteCtr,
      focus,
      rankDrops: compared.filter((q) => q.rankDrop && (q.previousImpressions >= 5 || q.impressions >= 5))
        .sort((a, b) => (b.previousImpressions + b.impressions) - (a.previousImpressions + a.impressions)).slice(0, 40),
      growing: compared.filter((q) => q.deltaClicks > 0)
        .sort((a, b) => b.deltaClicks - a.deltaClicks).slice(0, 20),
      opportunities: compared.filter((q) => q.position >= 4 && q.position <= 20 && q.belowSiteCtr)
        .sort((a, b) => b.impressions - a.impressions).slice(0, 40),
    };
  }
  return {
    generatedAt: new Date().toISOString(), site, searchType: SEARCH_TYPE, scope: SCOPE, windows,
    note: 'position = GSC average position; lower is better. rankDrop = current - previous >= 0.5 (worse).',
  };
}

async function main() {
  const trend = await fetchTrend();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(trend, null, 2), 'utf8');
  console.log(JSON.stringify({
    ok: true, out: OUT,
    windows: Object.fromEntries(Object.entries(trend.windows).map(([key, w]) => [key, {
      current: w.currentQueries, previous: w.previousQueries,
      rankDrops: w.rankDrops.length, focus: w.focus.reduce((s, f) => s + f.queries.length, 0),
    }])),
    tokenLogged: false,
  }));
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`GSC trend ไม่สำเร็จ: ${String(error?.message || error).slice(0, 200)}\n`);
    process.exitCode = 1;
  });
}
