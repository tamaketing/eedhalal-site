// One screen answer to "what happened today, what is still open".
//
//   node tools/agent/report.mjs
//   node tools/agent/report.mjs --json
//
// READ ONLY. Every number comes from a file or the owner's own tool; nothing is
// invented here and no secret is ever printed. Sections that need a service
// which is not running are reported as unavailable instead of guessed.
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

const adminBase = () => `http://127.0.0.1:${Number(process.env.EED_ADMIN_PORT || 4185)}`;

const readJson = async (relative) => JSON.parse(await readFile(path.join(ROOT, relative), 'utf8'));

async function tryAdmin() {
  const response = await fetch(`${adminBase()}/menu-publish-preview`, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) return null;
  const body = await response.json();
  return body && typeof body === 'object' ? body : null;
}

async function apiGet(route) {
  const secret = process.env.EED_INTERNAL_API_SECRET;
  if (!secret) return { ok: false, reason: 'ยังไม่ได้ตั้ง EED_INTERNAL_API_SECRET' };
  const base = `http://${process.env.INTERNAL_API_HOST || '127.0.0.1'}:${Number(process.env.INTERNAL_API_PORT || 8788)}`;
  try {
    const response = await fetch(`${base}${route}`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return { ok: false, reason: `Internal API ตอบกลับ ${response.status}` };
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, reason: 'Internal API ไม่ได้ทำงาน (เปิดด้วย npm run api:start)' };
  }
}

async function tryDrafts() {
  const result = await apiGet('/api/v1/drafts?status=WAITING_FOR_HUMAN&limit=1&order=desc');
  if (!result.ok) return { available: false, reason: result.reason };
  return { available: true, waiting: Number(result.body?.total ?? 0) };
}

/** The work funnel: quotations waiting for the owner and jobs per lead status. */
async function tryPipeline() {
  const [quotes, leads] = await Promise.all([
    apiGet('/api/v1/quotations?status=WAITING_FOR_HUMAN&limit=100'),
    apiGet('/api/v1/leads'),
  ]);
  const quotation = quotes.ok
    ? {
        available: true,
        waiting: Number(quotes.body?.total ?? 0),
        ready: (quotes.body?.quotations || []).filter((item) => item.readyForOwner).length,
      }
    : { available: false, reason: quotes.reason };
  const funnel = leads.ok
    ? { available: true, counts: leads.body?.counts || {} }
    : { available: false, reason: leads.reason };
  return { quotation, funnel };
}

async function tryGit() {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: ROOT });
    const files = stdout.split('\n').filter(Boolean);
    const changed = files.filter((line) => !line.startsWith('??'));
    const untracked = files.filter((line) => line.startsWith('??'));
    return { changed: changed.length, untracked: untracked.length, sample: files.slice(0, 8) };
  } catch {
    return null;
  }
}

const COSTS_PATH = path.join(ROOT, 'demo', 'owner-set-builder', 'owner-costs.json');
// A05 has data only when the owner's cost file exists (tools/admin/README.md).
// This report only checks that the source exists — the numbers stay inside
// finance.mjs so cost figures never travel through other tools.
async function hasCostsFile() {
  try {
    await readFile(COSTS_PATH);
    return true;
  } catch {
    return false;
  }
}

/** Run one project script (read-only checker) and keep the raw stdout. */
async function runNode(script, args = []) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [path.join(ROOT, script), ...args], {
      cwd: ROOT,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, stdout };
  } catch (error) {
    return { ok: false, stdout: error.stdout || '', reason: `ตัวตรวจล้มเหลว (exit ${(error.code ?? 'ไม่ทราบ')}) — ${script}` };
  }
}

/** Live measurements report.mjs can gather on its own: checks + sync + SEO discovery. */
async function tryKpiSources() {
  const [checks, sync, discovery, costsFile] = await Promise.all([
    runNode('tools/agent/checks.mjs'),
    runNode('scripts/check-business-sync.mjs', ['--check']),
    runNode('scripts/check-search-discovery.mjs'),
    hasCostsFile(),
  ]);
  return {
    systemChecks: checks.ok
      ? { ok: true, total: Number((checks.stdout.match(/ตรวจทั้ง (\d+) รายการ/) || [])[1]) || null }
      : { ok: false, reason: checks.reason },
    businessSync: sync.ok ? { ok: true } : { ok: false, reason: sync.reason },
    searchDiscovery: discovery.ok
      ? { ok: true, pages: Number((discovery.stdout.match(/Search discovery passed: (\d+) pages/) || [])[1]) || null }
      : { ok: false, reason: discovery.reason },
    ownerCostsFile: costsFile
      ? { available: true }
      : { available: false, reason: 'ยังไม่มีไฟล์ต้นทุน demo/owner-set-builder/owner-costs.json' },
  };
}

export async function buildReport() {
  const [rules, planner, admin, drafts, pipeline, git, kpiSources] = await Promise.all([
    readJson('data/business-rules.json').catch(() => null),
    readJson('data/planner-overrides.json').catch(() => null),
    tryAdmin().catch(() => null),
    tryDrafts(),
    tryPipeline(),
    tryGit(),
    tryKpiSources(),
  ]);

  const draftCentral = admin?.central?.version ?? null;
  const webVersion = admin?.file?.fileVersion ?? null;

  // The diff lists menus as added/changed/hidden and flags the rest as booleans.
  // Counting only the menus made a pending topping change look like nothing was
  // waiting, which is exactly the question this report exists to answer.
  const GROUPS = [
    ['toppingsChanged', 'ท็อปปิ้ง'],
    ['sideItemsChanged', 'อาหารรอง'],
    ['popularChanged', 'ลำดับยอดนิยม'],
    ['quoteOnlyChanged', 'สถานะขอใบเสนอราคา'],
  ];
  const pendingGroups = admin?.diff
    ? GROUPS.filter(([flag]) => admin.diff[flag]).map(([, label]) => label)
    : [];

  return {
    generatedAt: new Date().toISOString(),
    business: rules ? { name: rules.business?.name || '', revision: rules.revision || null } : null,
    catalogue: planner
      ? { menuCount: Object.keys(planner.prices || {}).length, exportedAt: planner.exportedAt || null }
      : null,
    publish: admin
      ? {
          available: true,
          draftVersion: draftCentral,
          webFileStatus: admin.file?.status ?? null,
          webFileVersion: webVersion,
          live: admin.live?.state ?? null,
          unpublishedChanges: Boolean(admin.diff?.hasChanges),
          changedCount: admin.diff?.hasChanges
            ? (admin.diff.added?.length || 0) + (admin.diff.changed?.length || 0) + (admin.diff.hidden?.length || 0)
            : 0,
          pendingGroups,
        }
      : { available: false, reason: `เครื่องมือจัดการเมนู (${adminBase()}) ไม่ได้ทำงาน — เปิดด้วย start-server.bat` },
    inbox: drafts,
    pipeline,
    kpi: buildKpiLayout({ inbox: drafts, pipeline, kpiSources }),
    workingTree: git,
  };
}

/**
 * Per-position KPI rows, following docs/agent-kpi.md:
 * - a measured row carries the value and the source it came from;
 * - a live-unavailable source is reported as unavailable with the reason;
 * - a KPI with no source in the system yet never gets a number — it is listed
 *   under "รอข้อมูล" exactly as the KPI rules require (no zeros, no guesses).
 */
export function buildKpiLayout({ inbox, pipeline, kpiSources }) {
  const measured = [];
  const unavailable = [];
  const push = (condition, position, kpi, value, source, fallbackPosition, fallbackKpi, reason) => {
    if (condition) measured.push({ position, kpi, value, source });
    else unavailable.push([fallbackPosition, fallbackKpi, reason]);
  };

  const quotation = pipeline?.quotation || {};
  push(
    quotation.available,
    'A04 ใบเสนอราคา',
    'ความครบถ้วนของข้อมูลที่ดึงได้',
    quotation.available
      ? { waiting: quotation.waiting, ready: quotation.ready, incomplete: Math.max(quotation.waiting - quotation.ready, 0) }
      : undefined,
    'GET /api/v1/quotations',
    'A04 ใบเสนอราคา', 'ความครบถ้วนของข้อมูลที่ดึงได้', quotation.reason || 'ดูไม่ได้',
  );

  const funnel = pipeline?.funnel || {};
  push(
    funnel.available,
    'A02 ขาย & CRM',
    'งานที่ค้างในแต่ละสถานะ (funnel)',
    funnel.available ? funnel.counts || {} : undefined,
    'GET /api/v1/leads',
    'A02 ขาย & CRM', 'งานที่ค้างในแต่ละสถานะ (funnel)', funnel.reason || 'ดูไม่ได้',
  );

  const drafts = inbox || {};
  push(
    drafts.available,
    'A02 ขาย & CRM',
    'draft ที่รอเจ้าของตอบ',
    drafts.available ? drafts.waiting : undefined,
    'GET /api/v1/drafts?status=WAITING_FOR_HUMAN',
    'A02 ขาย & CRM', 'draft ที่รอเจ้าของตอบ', drafts.reason || 'ดูไม่ได้',
  );

  const discovery = kpiSources?.searchDiscovery || {};
  push(
    discovery.ok,
    'A03 การตลาด & SEO',
    'การค้นหามองเห็นเว็บ (จำนวนหน้าที่ผ่าน)',
    discovery.ok ? discovery.pages : undefined,
    'node scripts/check-search-discovery.mjs',
    'A03 การตลาด & SEO', 'การค้นหามองเห็นเว็บ', discovery.reason || 'ตรวจไม่ได้',
  );

  const checks = kpiSources?.systemChecks || {};
  push(
    checks.ok,
    'A06 ระบบ & คุณภาพ',
    'ตัวตรวจระบบผลักผ่านทั้งหมด',
    checks.ok ? checks.total : undefined,
    'node tools/agent/checks.mjs',
    'A06 ระบบ & คุณภาพ', 'ตัวตรวจระบบผลักผ่านทั้งหมด', checks.reason || 'รันไม่ได้',
  );

  const sync = kpiSources?.businessSync || {};
  push(
    sync.ok,
    'A06 ระบบ & คุณภาพ',
    'ข้อมูลธุรกิจตรงกันทุกช่องทาง',
    sync.ok ? 'ผ่าน' : undefined,
    'node scripts/check-business-sync.mjs --check',
    'A06 ระบบ & คุณภาพ', 'ข้อมูลธุรกิจตรงกันทุกช่องทาง', sync.reason || 'ตรวจไม่ได้',
  );

  const costs = kpiSources?.ownerCostsFile || {};
  push(
    costs.available,
    'A05 การเงิน & ต้นทุน',
    'ไฟล์ต้นทุนของเจ้าของ (ต่อยอดได้ด้วย finance.mjs report)',
    costs.available ? 'มีไฟล์' : undefined,
    'demo/owner-set-builder/owner-costs.json',
    'A05 การเงิน & ต้นทุน', 'ต้นทุน/กำไร/เมนูเสี่ยงขาดทุน',
    costs.reason || 'ยังไม่มีแหล่งข้อมูล — รอไฟล์ต้นทุนของเจ้าของ (สร้างด้วย node tools/agent/finance.mjs template)',
  );

  // KPIs that no source exists for today — listed by name, never with a number.
  const pending = [
    ['A01 วิจัยตลาด', 'จำนวนโอกาสที่คัดกรองและบันทึกที่มา', 'ยังไม่มีแหล่งข้อมูล — ผลคัดกรองของ A01 ยังไม่ถูกบันทึกในระบบ'],
    ['A02 ขาย & CRM', 'ลูกค้าที่กลับมาสั่งซื้อซ้ำ', 'ยังไม่มีแหล่งข้อมูล — ต้องมีประวัติออเดอร์จริง'],
    ['A02 ขาย & CRM', 'เวลาตอบเฉลี่ย', 'ยังไม่มีแหล่งข้อมูล — ต้องมีเวลาที่เจ้าของกดส่งจริง'],
    ['A03 การตลาด & SEO', 'ต้นทุนต่อ lead / อัตราผู้เข้าชม→ผู้ติดต่อ', 'ยังไม่มีแหล่งข้อมูล — รอตัวเลขใน marketing/ads-performance.csv'],
    ['A04 ใบเสนอราคา', 'เวลาตั้งแต่รับบรีฟจนพร้อมเสนอราคา', 'ยังไม่มีแหล่งข้อมูล — ต้องมีประวัติตามเวลาของใบเสนอราคา'],
    ['ทั้งทีม', 'งานเปิดค้างที่มี jobId', 'ยังไม่มีแหล่งข้อมูลกลางที่รวบเอกสารมอบงาน'],
  ];

  return { measured, unavailable, pending };
}

/** KPI values render as their natural Thai shape; unknown shapes never crash the report. */
function renderKpiValue(value) {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    if (typeof value.waiting === 'number' && typeof value.ready === 'number') {
      return `รอ ${value.waiting} ฉบับ (ข้อมูลครบ ${value.ready} · ตกหล่น ${value.incomplete})`;
    }
    const parts = Object.entries(value)
      .filter(([, v]) => typeof v === 'number' && v > 0)
      .map(([k, v]) => `${k} ${v}`);
    return parts.join(' · ') || 'ไม่มีงานค้าง';
  }
  return '-';
}

function render(report) {
  const lines = [`สรุปงาน EED HALAL — ${report.generatedAt}`, '='.repeat(60)];

  lines.push('เว็บไซต์');
  if (report.catalogue) {
    lines.push(`  แคตตาล็อก : ${report.catalogue.menuCount} เมนู (ออกเมื่อ ${report.catalogue.exportedAt || '-'})`);
  }
  if (report.publish.available) {
    lines.push(`  ร่างในเครื่อง : รุ่น ${report.publish.draftVersion ?? '-'}`);
    lines.push(`  ไฟล์บนเว็บ : ${report.publish.webFileStatus ?? '-'} รุ่น ${report.publish.webFileVersion ?? '-'}`);
    lines.push(`  เว็บจริง : ${report.publish.live ?? '-'}`);
    lines.push(
      report.publish.unpublishedChanges
        ? [
            `  ค้างที่ยังไม่ขึ้นเว็บ : ${report.publish.changedCount} เมนู`,
            report.publish.pendingGroups?.length
              ? `    รายการอื่นที่รอด้วย : ${report.publish.pendingGroups.join(', ')}`
              : null,
            '    (เผยแพร่เองที่แอดมิน)',
          ].filter(Boolean).join('\n')
        : '  ค้างที่ยังไม่ขึ้นเว็บ : ไม่มี',
    );
  } else {
    lines.push(`  สถานะเผยแพร่ : ดูไม่ได้ — ${report.publish.reason}`);
  }

  lines.push('');
  lines.push('ข้อความลูกค้า');
  if (report.inbox.available) {
    lines.push(`  รอเจ้าของตอบ : ${report.inbox.waiting} รายการ (ดูด้วย node tools/agent/inbox.mjs drafts)`);
  } else {
    lines.push(`  ดูไม่ได้ — ${report.inbox.reason}`);
  }

  const pipeline = report.pipeline || {};
  lines.push('');
  lines.push('งานที่รอ');
  if (pipeline.quotation?.available) {
    lines.push(`  ใบเสนอราคารอเจ้าของอนุมัติ : ${pipeline.quotation.waiting} ฉบับ (ข้อมูลครบ ${pipeline.quotation.ready} ฉบับ)`);
  } else if (pipeline.quotation) {
    lines.push(`  ใบเสนอราคา : ดูไม่ได้ — ${pipeline.quotation.reason}`);
  }
  if (pipeline.funnel?.available) {
    const counts = pipeline.funnel.counts || {};
    const parts = Object.entries(counts).filter(([, value]) => value > 0).map(([status, value]) => `${status} ${value}`);
    lines.push(`  งานที่ค้างในแต่ละสถานะ : ${parts.length ? parts.join(' · ') : 'ไม่มีงานค้าง'}`);
  } else if (pipeline.funnel) {
    lines.push(`  งานที่ค้าง : ดูไม่ได้ — ${pipeline.funnel.reason}`);
  }

  const kpi = report.kpi || { measured: [], unavailable: [], pending: [] };
  lines.push('');
  lines.push('KPI รายตำแหน่ง (เกณฑ์ที่ docs/agent-kpi.md)');
  if (kpi.measured.length || kpi.unavailable.length || kpi.pending.length) {
    for (const row of kpi.measured) {
      lines.push(`  ${row.position} · ${row.kpi} : ${renderKpiValue(row.value)}  — ที่มา ${row.source}`);
    }
    for (const [position, kpiName, reason] of kpi.unavailable) {
      lines.push(`  ${position} · ${kpiName} : ดูไม่ได้ — ${reason}`);
    }
    for (const [position, kpiName, reason] of kpi.pending) {
      lines.push(`  ${position} · ${kpiName} : ${reason}`);
    }
  }

  lines.push('');
  lines.push('ไฟล์ในเครื่อง');
  if (report.workingTree) {
    lines.push(`  แก้ไขแล้วยังไม่ commit : ${report.workingTree.changed} ไฟล์`);
    lines.push(`  ไฟล์ใหม่ที่ยังไม่ติดตาม : ${report.workingTree.untracked} ไฟล์`);
    for (const line of report.workingTree.sample) lines.push(`    ${line}`);
  } else {
    lines.push('  ดูสถานะ git ไม่ได้');
  }

  lines.push('');
  lines.push('='.repeat(60));
  return lines.join('\n');
}

async function main() {
  const report = await buildReport();
  process.stdout.write(`${process.argv.includes('--json') ? JSON.stringify(report, null, 2) : render(report)}\n`);
}

if (isCli) {
  main().catch((error) => {
    process.stderr.write(`สรุปงานไม่สำเร็จ: ${error.message}\n`);
    process.exitCode = 1;
  });
}