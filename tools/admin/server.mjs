import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { MAX_BODY_BYTES, readCosts, saveCosts, validateCosts } from './cost-store.mjs';
import { backupBeforeWrite, listBackups, liveNameFromBackup, restoreBackup } from '../../scripts/menu-backups.mjs';
import {
  computePublishStatus,
  diffPublicChanges,
  loadCentral,
  loadPublished,
  LIVE_STATE_TH,
  migrateCentral,
  parseMenuDataJs,
  parsePopularIds,
  publicProjectionOfCentral,
  startingPriceConsistency,
  publishCentral,
  PUBLISH_STATUS_TH,
  readPublishState,
  saveCentral,
  validateCentral,
  verifyLiveRelease,
  writePublishState,
} from '../../scripts/menu-central.mjs';
import { deployMenuRelease, realDeployDeps } from '../../scripts/menu-deploy.mjs';

const execFileAsync = promisify(execFile);
// Deploy-to-web stays OFF until the owner enables it explicitly. This round
// develops + tests the process only — no real push/deploy happens here.
const DEPLOY_ENABLED = process.env.EED_ALLOW_GIT_DEPLOY === '1';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

// Private data lives OUTSIDE version control (costs, central draft, backups,
// publish state). Default keeps the historic location so the existing machine
// keeps working with zero migration; override per machine/install:
//   EED_ADMIN_DATA_DIR=/path/to/private-data  (or --data-dir <path>)
function resolveDataDir(cliValue) {
  const fromCli = typeof cliValue === 'string' && cliValue.trim() ? cliValue.trim() : '';
  const fromEnv = typeof process.env.EED_ADMIN_DATA_DIR === 'string' ? process.env.EED_ADMIN_DATA_DIR.trim() : '';
  return path.resolve(fromCli || fromEnv || path.join(ROOT, 'demo', 'owner-set-builder'));
}

// First-run seed: empty-but-valid structures so a clean install opens,
// saves, and previews immediately. Clearly marked as a starting point —
// enter REAL costs before using recommendations. Never ships sample business
// data as truth.
const SEED_COSTS = {
  _note: 'ข้อมูลเริ่มต้น (ยังไม่มีทุนจริง) — กรอกทุนจริงที่หน้าจัดการเมนู/ต้นทุนก่อนใช้งาน',
  groupMeta: {},
  dishes: [],
  extras: [],
  toppings: [],
  fruit: { label: 'ผลไม้', cost: null, status: 'pending', note: 'เริ่มต้น — กรอกทุนจริงก่อนใช้' },
  boxes: {
    three: { label: 'กล่อง 3 ช่อง (เริ่มต้น)', cost: null, status: 'pending', note: '' },
  },
};
const SEED_SETTINGS = {
  _note: 'ตั้งค่าเริ่มต้น — ปรับตารางกำไรให้ตรงร้านก่อนใช้ระบบแนะนำ',
  profitTiers: [],
  maxResultsPerGroup: 6,
  maxResultsPerMain: 2,
};

export async function ensureSeedData(dataDir) {
  const { mkdir, writeFile: writeJsonFile } = await import('node:fs/promises');
  await mkdir(dataDir, { recursive: true });
  await mkdir(path.join(dataDir, 'backups'), { recursive: true });
  const seeded = [];
  try {
    await readCosts(dataDir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const saved = await saveCosts(dataDir, SEED_COSTS);
    if (!saved.ok) throw new Error(`seed owner-costs.json ไม่สำเร็จ: ${saved.errors.join(' | ')}`);
    seeded.push('owner-costs.json');
  }
  const settingsPath = path.join(dataDir, 'owner-settings.json');
  try {
    await readFile(settingsPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeJsonFile(settingsPath, `${JSON.stringify(SEED_SETTINGS, null, 2)}\n`, 'utf8');
    seeded.push('owner-settings.json');
  }
  return seeded;
}

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/logic.mjs', ['logic.mjs', 'text/javascript; charset=utf-8']],
  ['/recommend.mjs', ['recommend.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/cost-planner.mjs', ['cost-planner.mjs', 'text/javascript; charset=utf-8']],
  ['/cost-planner.css', ['cost-planner.css', 'text/css; charset=utf-8']],
  ['/menu-central-ui.mjs', ['menu-central-ui.mjs', 'text/javascript; charset=utf-8']],
]);

// The cost page itself lives in the repository root but is never published to Pages.
const rootFiles = new Map([
  ['/budget-planner.html', [path.join(ROOT, 'budget-planner.html'), 'text/html; charset=utf-8']],
]);

async function ensureCentral(dataDir) {
  try {
    return await loadCentral(dataDir);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ECENTRALINVALID') throw error;
    // First run (or unreadable draft): migrate deterministically from the
    // published files. Nothing is invented; costs stay in owner-costs.json.
    const menuDataJs = await readFile(path.join(ROOT, 'js/menu-data.js'), 'utf8');
    const overrides = JSON.parse(await readFile(path.join(ROOT, 'data/planner-overrides.json'), 'utf8'));
    const hydrateJs = await readFile(path.join(ROOT, 'js', 'popular-menu-hydrate.js'), 'utf8').catch(() => '');
    const migrated = migrateCentral({
      menuDataMenus: await parseMenuDataJs(menuDataJs),
      planner: overrides,
      popularIds: parsePopularIds(hydrateJs),
    });
    const saved = await saveCentral(dataDir, migrated);
    if (!saved.ok) throw new Error(`migrate ฐานกลางไม่สำเร็จ: ${saved.errors.join(' | ')}`);
    return saved.data;
  }
}

// Admin catalog: ALWAYS from the central draft (latest after "บันทึก"), never
// from the published files. Whitelist name/ID/category/hidden only: sale
// prices and toppings are never exposed here (the set builder must not use
// selling prices as costs).
async function catalog(dataDir) {
  const central = await ensureCentral(dataDir);
  return central.menus.map((item) => ({
    id: item.id, name: item.name, category: item.category, hidden: item.hidden === true,
  }));
}

async function publishOverview(dataDir) {
  const central = await ensureCentral(dataDir);
  const published = await loadPublished(ROOT);
  const menuDataMenus = await parseMenuDataJs(published.menuDataJs);
  // Costs decide the cost gate, so the preview must see them too. Without this
  // the dialog showed a price for every dish, including ones the ordering API
  // refuses, and the diff never marked them ask-for-quote.
  let costs = null;
  try {
    costs = await readCosts(dataDir);
  } catch {
    costs = null;
  }
  const diff = diffPublicChanges(central, { overrides: published.overrides, menuDataMenus }, costs);
  const state = (await readPublishState(dataDir)) || { file: null, live: null, deploy: null, error: null };
  const status = computePublishStatus({ diff, file: state.file, live: state.live });
  // The published "starting from" claim must match the cheapest dish a
  // customer can actually order, otherwise llms.txt / FAQ advertise a price
  // nobody can buy.
  let startingPrice = { ok: true, warnings: [] };
  try {
    const rules = JSON.parse(await readFile(path.join(ROOT, 'data', 'business-rules.json'), 'utf8'));
    startingPrice = startingPriceConsistency(rules, publicProjectionOfCentral(central, costs));
  } catch {
    startingPrice = { ok: true, warnings: [], declared: null, minOrderable: null, minServed: null, orderableCount: null, servedCount: null };
  }
  // Customer preview sample: first visible menus as the website would list
  // them after publish (public fields only, sorted for display). A quote-only
  // dish must never preview a price.
  const costBlocked = new Map(diff.costBlocked.map((item) => [String(item.id), item]));
  const preview = [...central.menus]
    .filter((menu) => !menu.hidden)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .slice(0, 8)
    .map((menu) => {
      const blocked = costBlocked.get(String(menu.id));
      return {
        id: menu.id,
        name: menu.name,
        category: menu.category,
        image: menu.image,
        price: blocked ? null : menu.price,
        quoteOnly: Boolean(blocked),
        ...(blocked ? { reason: blocked.reason } : {}),
      };
    });
  return {
    status,
    statusTh: PUBLISH_STATUS_TH[status],
    central: { version: central.version ?? 0, updatedAt: central.updatedAt ?? null },
    file: state.file,
    live: state.live ? { ...state.live, stateTh: LIVE_STATE_TH[state.live.state] || state.live.state } : null,
    deploy: state.deploy,
    error: state.error,
    deployEnabled: DEPLOY_ENABLED,
    startingPrice,
    diff: {
      added: diff.added, changed: diff.changed, shown: diff.shown,
      hidden: diff.hidden, removed: diff.removed, costBlocked: diff.costBlocked,
      quoteOnlyChanged: diff.quoteOnlyChanged,
      toppingsChanged: diff.toppingsChanged, meatsChanged: diff.meatsChanged,
      popularChanged: diff.popularChanged, hasChanges: diff.hasChanges,
    },
    preview,
  };
}

async function persistLiveCheck(dataDir) {
  const state = (await readPublishState(dataDir)) || { file: null, live: null, deploy: null, error: null };
  const live = await verifyLiveRelease({ root: ROOT, file: state.file });
  await writePublishState(dataDir, { ...state, live });
  return live;
}

let deployRunning = false;
async function runDeployInBackground(dataDir) {
  if (deployRunning) return;
  deployRunning = true;
  try {
    // The working checkout (ROOT) may be dirty: git runs either in ROOT for
    // read-only remote inspection or inside the dedicated publish worktree.
    // Commits and pushes never happen in ROOT.
    const execGit = async (args, opts = {}) => {
      const { stdout } = await execFileAsync('git', args, { cwd: opts.cwd || ROOT, timeout: 180000 });
      return stdout;
    };
    const runGate = async (cmd, args, cwd) => {
      await execFileAsync(process.execPath, [cmd, ...args], { cwd, timeout: 300000 });
    };
    const deps = realDeployDeps({
      root: ROOT,
      // Sibling of the checkout: outside the repo, never committed.
      worktreeDir: process.env.EED_PUBLISH_WORKTREE || path.join(path.dirname(ROOT), 'eedhalal-publish'),
      execGit,
      runGate,
      loadCentral: () => loadCentral(dataDir),
      liveBaseUrl: 'https://eedhalal.com',
    });
    await deployMenuRelease({ root: ROOT, dataDir, deps });
  } catch {
    // Phases + reasons are already recorded in the state file by the runner.
  } finally {
    deployRunning = false;
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(Object.assign(new Error('payload too large'), { code: 'EPAYLOADTOOBIG' }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', fail);
  });
}

export function createLocalServer({ dataDir = resolveDataDir() } = {}) {
  const server = createServer(async (request, response) => {
    const headers = {
      'Cache-Control': 'no-store, private',
      'X-EED-Local-Tool': 'owner-set-builder',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    };
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      response.writeHead(status, { ...headers, 'Content-Type': type });
      response.end(body);
    };
    const sendJson = (status, value) => send(status, JSON.stringify(value), 'application/json; charset=utf-8');

    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : 0;
    const expectedHost = `127.0.0.1:${port}`;
    const expectedOrigin = `http://${expectedHost}`;
    const pathname = new URL(request.url, expectedOrigin).pathname;
    const origin = request.headers.origin;
    const fetchSite = request.headers['sec-fetch-site'];
    // Owner UI pages may be opened from an external link (messenger, notes,
    // another program): only the top-level document GET itself is let through,
    // named path by path. Data endpoints, the save endpoint, and
    // subresource-style requests stay blocked cross-site.
    const UI_PAGES = new Set(['/', '/budget-planner.html']);
    const externalNavigation = request.method === 'GET' && UI_PAGES.has(pathname) && !origin &&
      request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-dest'] === 'document';
    // Cross-site requests (including DNS rebinding) are refused before any data is touched.
    if (request.socket.remoteAddress !== '127.0.0.1' || request.headers.host !== expectedHost ||
        (origin && origin !== expectedOrigin) ||
        (fetchSite === 'cross-site' && !externalNavigation)) return send(403, 'Local use only');
    if (request.method !== 'GET' && request.method !== 'POST') return send(405, 'GET/POST only');

    try {
      // --- Central menu database (local only) ---
      if (pathname === '/menu-central' && request.method === 'GET') {
        return send(200, JSON.stringify(await ensureCentral(dataDir)), 'application/json; charset=utf-8');
      }
      if (pathname === '/menu-central' && request.method === 'POST') {
        const sameOrigin = origin === expectedOrigin ||
          (!origin && ['same-origin', 'none'].includes(String(fetchSite || '')));
        if (!sameOrigin) return send(403, 'Local use only');
        const contentType = String(request.headers['content-type'] || '');
        if (!contentType.includes('application/json')) return send(415, 'Send application/json');
        const body = await readJsonBody(request);
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          return send(400, 'JSON ไม่ถูกต้อง');
        }
        // Automatic backup first: a failed backup aborts the save, never
        // proceeds silently (same-machine copy; see backups.mjs limits).
        try {
          await backupBeforeWrite(dataDir, 'menu-central.json');
        } catch (error) {
          return sendJson(500, { ok: false, errors: [error.message] });
        }
        const saved = await saveCentral(dataDir, parsed);
        if (!saved.ok) return sendJson(400, { ok: false, errors: saved.errors });
        return sendJson(200, { ok: true, version: saved.data.version, updatedAt: saved.data.updatedAt });
      }
      if (pathname === '/menu-verify-live' && request.method === 'POST') {
        const sameOrigin = origin === expectedOrigin ||
          (!origin && ['same-origin', 'none'].includes(String(fetchSite || '')));
        if (!sameOrigin) return send(403, 'Local use only');
        await readJsonBody(request).catch(() => '{}');
        try {
          const live = await persistLiveCheck(dataDir);
          return sendJson(200, { ok: true, live: { ...live, stateTh: LIVE_STATE_TH[live.state] || live.state } });
        } catch (error) {
          return sendJson(500, { ok: false, error: error.message });
        }
      }
      if (pathname === '/menu-deploy' && request.method === 'POST') {
        const sameOrigin = origin === expectedOrigin ||
          (!origin && ['same-origin', 'none'].includes(String(fetchSite || '')));
        if (!sameOrigin) return send(403, 'Local use only');
        const contentType = String(request.headers['content-type'] || '');
        if (!contentType.includes('application/json')) return send(415, 'Send application/json');
        let confirm = false;
        try {
          confirm = JSON.parse(await readJsonBody(request))?.confirm === true;
        } catch { confirm = false; }
        if (!DEPLOY_ENABLED) {
          return sendJson(409, { ok: false, error: 'การขึ้นเว็บอัตโนมัติยังไม่เปิด (EED_ALLOW_GIT_DEPLOY!=1) — รอบนี้พัฒนาและทดสอบกระบวนการเท่านั้น ยังไม่ push/deploy จริง' });
        }
        if (!confirm) return sendJson(400, { ok: false, error: 'ต้องยืนยัน (confirm:true) ก่อนขึ้นเว็บจริง' });
        if (deployRunning) return sendJson(409, { ok: false, error: 'มีงาน deploy กำลังทำงานอยู่แล้ว — รอให้จบก่อน' });
        runDeployInBackground(dataDir);
        return sendJson(202, { ok: true, started: true, note: 'เริ่มงาน deploy แล้ว ติดตามที่สถานะ/บันทึกขั้นตอน' });
      }
      if (pathname === '/menu-backups' && request.method === 'GET') {
        return send(200, JSON.stringify(await listBackups(dataDir)), 'application/json; charset=utf-8');
      }
      if (pathname === '/menu-restore' && request.method === 'POST') {
        const sameOrigin = origin === expectedOrigin ||
          (!origin && ['same-origin', 'none'].includes(String(fetchSite || '')));
        if (!sameOrigin) return send(403, 'Local use only');
        const contentType = String(request.headers['content-type'] || '');
        if (!contentType.includes('application/json')) return send(415, 'Send application/json');
        let file = '';
        try {
          file = String(JSON.parse(await readJsonBody(request))?.file || '');
        } catch {
          return send(400, 'JSON ไม่ถูกต้อง');
        }
        try {
          const validators = {
            'menu-central.json': validateCentral,
            'owner-costs.json': validateCosts,
            'owner-settings.json': (raw) => (raw && typeof raw === 'object'
              ? { ok: true, errors: [] }
              : { ok: false, errors: ['ไฟล์ตั้งค่าไม่ถูกต้อง'] }),
          };
          const liveName = liveNameFromBackup(file);
          const validate = validators[liveName];
          if (!validate) return sendJson(400, { ok: false, error: `กู้คืนได้เฉพาะ menu-central.json / owner-costs.json / owner-settings.json (${liveName})` });
          const result = await restoreBackup(dataDir, file, validate);
          return sendJson(200, { ok: true, ...result });
        } catch (error) {
          return sendJson(400, { ok: false, error: error.message });
        }
      }
      if (pathname === '/menu-publish-preview' && request.method === 'GET') {
        return send(200, JSON.stringify(await publishOverview(dataDir)), 'application/json; charset=utf-8');
      }
      if (pathname === '/menu-publish-state' && request.method === 'GET') {
        return send(200, JSON.stringify(await publishOverview(dataDir)), 'application/json; charset=utf-8');
      }
      if (pathname === '/menu-publish' && request.method === 'POST') {
        const sameOrigin = origin === expectedOrigin ||
          (!origin && ['same-origin', 'none'].includes(String(fetchSite || '')));
        if (!sameOrigin) return send(403, 'Local use only');
        const contentType = String(request.headers['content-type'] || '');
        if (!contentType.includes('application/json')) return send(415, 'Send application/json');
        await readJsonBody(request).catch(() => '{}');
        try {
          // Publish the saved central draft (single source), not the request
          // body: the preview the owner confirmed and the release must match.
          const central = await ensureCentral(dataDir);
          // Costs decide which served menus are orderable vs ask-for-quote
          // (business rule: data/business-rules.json -> menuPublishing). The
          // cost store is a separate file the owner may not have touched yet,
          // so a read failure must not silently publish every menu as
          // orderable — fall back to "no cost data" (same as the preview).
          let costs = null;
          try {
            costs = await readCosts(dataDir);
          } catch {
            costs = null;
          }
          const result = await publishCentral({ root: ROOT, dataDir, central, costs });
          return sendJson(200, { ok: true, record: result.record });
        } catch (error) {
          // Truthful failure only: the previous release is untouched and the
          // status stays "failed", never "success".
          const state = await readPublishState(dataDir);
          return sendJson(500, { ok: false, error: error.message, state });
        }
      }
      if (pathname === '/owner-costs' && request.method === 'POST') {
        // Saving costs is owner-only: same-origin browser request or an explicit local client.
        const sameOrigin = origin === expectedOrigin ||
          (!origin && ['same-origin', 'none'].includes(String(fetchSite || '')));
        if (!sameOrigin) return send(403, 'Local use only');
        const contentType = String(request.headers['content-type'] || '');
        if (!contentType.includes('application/json')) return send(415, 'Send application/json');
        const body = await readJsonBody(request);
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          return send(400, 'JSON ไม่ถูกต้อง');
        }
        // Automatic backup first (same rule as the central draft).
        try {
          await backupBeforeWrite(dataDir, 'owner-costs.json');
        } catch (error) {
          return sendJson(500, { ok: false, errors: [error.message] });
        }
        const saved = await saveCosts(dataDir, parsed);
        if (!saved.ok) return sendJson(400, { ok: false, errors: saved.errors });
        return sendJson(200, { ok: true, version: saved.data.version, updatedAt: saved.data.updatedAt });
      }
      if (request.method === 'POST') return send(405, 'GET only');
      if (pathname === '/readiness') return sendJson(200, { ready: true, app: 'owner-set-builder' });
      if (pathname === '/owner-costs') return send(200, JSON.stringify(await readCosts(dataDir)), 'application/json; charset=utf-8');
      if (pathname === '/owner-settings') return send(200, await readFile(path.join(dataDir, 'owner-settings.json')), 'application/json; charset=utf-8');
      if (pathname === '/menu-catalog') return send(200, JSON.stringify(await catalog(dataDir)), 'application/json; charset=utf-8');
      const rootFile = rootFiles.get(pathname);
      if (rootFile) return send(200, await readFile(rootFile[0]), rootFile[1]);
      const file = files.get(pathname);
      if (!file) return send(404, 'Not found');
      return send(200, await readFile(path.join(HERE, file[0])), file[1]);
    } catch (error) {
      console.error('Local demo failed:', error.code || error.message);
      return send(500, 'Local demo unavailable');
    }
  });
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.argv[2] ?? 4185);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Expected a local port between 1024 and 65535');
  const dataDirFlag = process.argv.find((arg) => arg.startsWith('--data-dir='))?.slice('--data-dir='.length);
  const dataDir = resolveDataDir(dataDirFlag);
  const seeded = await ensureSeedData(dataDir);
  if (seeded.length) console.log(`Seeded empty starter data in ${dataDir}: ${seeded.join(', ')} (enter real costs before use)`);
  console.log(`Private data dir: ${dataDir} (override with EED_ADMIN_DATA_DIR or --data-dir=)`);
  createLocalServer({ dataDir }).listen(port, '127.0.0.1', () => {
    console.log(`Owner-only admin tools: http://127.0.0.1:${port}/`);
  });
}
