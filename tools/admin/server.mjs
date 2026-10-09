import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
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
  publishCentral,
  PUBLISH_STATUS_TH,
  readPublishState,
  saveCentral,
  tierPriceConsistency,
  validateCentral,
  verifyLiveRelease,
  writePublishState,
} from '../../scripts/menu-central.mjs';
import { computeTierFloors, normalizeTier, resolveSideChoices, setsFromPlanner, setsFromProjection, sideItemsFromProjection, tierDefinitions } from '../../scripts/mealbox-tiers.mjs';
import { deployMenuRelease, realDeployDeps } from '../../scripts/menu-deploy.mjs';

const execFileAsync = promisify(execFile);
// Deploy-to-web stays OFF until the owner enables it explicitly. This round
// develops + tests the process only — no real push/deploy happens here.
const DEPLOY_ENABLED = process.env.EED_ALLOW_GIT_DEPLOY === '1';

const MAX_BODY_BYTES = 128 * 1024;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

// Private data lives OUTSIDE version control (central draft, backups, publish
// state). Default keeps the historic location so the existing machine keeps
// working with zero migration; override per machine/install:
//   EED_ADMIN_DATA_DIR=/path/to/private-data  (or --data-dir <path>)
function resolveDataDir(cliValue) {
  const fromCli = typeof cliValue === 'string' && cliValue.trim() ? cliValue.trim() : '';
  const fromEnv = typeof process.env.EED_ADMIN_DATA_DIR === 'string' ? process.env.EED_ADMIN_DATA_DIR.trim() : '';
  return path.resolve(fromCli || fromEnv || path.join(ROOT, 'demo', 'owner-set-builder'));
}

// First-run seed: make sure the private data directory exists so a clean
// install opens and saves immediately.
export async function ensureSeedData(dataDir) {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dataDir, { recursive: true });
  await mkdir(path.join(dataDir, 'backups'), { recursive: true });
  return [];
}

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
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
    // published files. Nothing is invented.
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
// from the published files. Whitelist name/ID/tier/hidden only.
async function catalog(dataDir) {
  const central = await ensureCentral(dataDir);
  return central.menus.map((item) => ({
    id: item.id, name: item.name, tier: normalizeTier(item.tier), hidden: item.hidden === true,
  }));
}

// Sale price feed for the owner's budget matcher. Selling price ONLY: no cost
// data is read and no cost rule is applied. A menu qualifies when the owner has
// actually given it a price (price > 0) and has not switched the price off
// (showPrice === false) nor hidden it. Prices come from the central draft, so
// they match what "บันทึก" shows before publishing.
async function sellableMenus(dataDir) {
  const central = await ensureCentral(dataDir);
  const menus = central.menus
    .filter((menu) => menu.hidden !== true && menu.showPrice !== false && Number(menu.price) > 0)
    .map((menu) => ({
      id: menu.id,
      name: menu.name,
      price: menu.price,
      tier: normalizeTier(menu.tier),
      desc: menu.desc || '',
      image: menu.image || '',
      minPerMenu: Number(menu.minPerMenu) > 0 ? Number(menu.minPerMenu) : null,
    }))
    .sort((a, b) => a.price - b.price || a.id - b.id);
  const addons = (list) => (Array.isArray(list) ? list : [])
    .map((item) => ({ name: String(item.name), price: Number(item.price) || 0 }))
    .filter((item) => item.name && item.price > 0);
  return { menus, toppings: addons(central.toppings), secondDish: await secondDishGroups(central) };
}

// The second dish ("อาหารเมนูที่ 2") a tier may offer: WHICH tier can offer one
// comes from data/business-rules.json (sideChoices), the name and the extra price
// come from the central draft. A side whose price the kitchen has not confirmed
// yet is left out, so the matcher can only quote what the shop may actually
// charge, and an id business-rules.json points at but the draft cannot answer is
// simply not offered instead of being invented.
async function secondDishGroups(central) {
  const rules = await readFile(path.join(ROOT, 'data', 'business-rules.json'), 'utf8')
    .then((raw) => JSON.parse(raw))
    .catch(() => null);
  if (!rules) return {};
  const sideItems = sideItemsFromProjection(publicProjectionOfCentral(central));
  const groups = {};
  for (const tier of tierDefinitions(rules)) {
    const items = resolveSideChoices(tier, sideItems)
      .items
      .filter((item) => Number(item.priceAdjustment) > 0)
      .map((item) => ({ id: item.id, name: item.nameTh || item.nameEn, price: Number(item.priceAdjustment) }));
    if (items.length) {
      groups[tier.id] = { label: tier.sideChoiceLabelTh || 'อาหารเมนูที่ 2', max: 1, items };
    }
  }
  return groups;
}

async function publishOverview(dataDir) {
  const central = await ensureCentral(dataDir);
  const published = await loadPublished(ROOT);
  const menuDataMenus = await parseMenuDataJs(published.menuDataJs);
  const diff = diffPublicChanges(central, { overrides: published.overrides, menuDataMenus });
  const state = (await readPublishState(dataDir)) || { file: null, live: null, deploy: null, error: null };
  const status = computePublishStatus({ diff, file: state.file, live: state.live });
  // The published "starting from" claim must match the cheapest set a customer
  // can actually order, otherwise llms.txt / FAQ advertise a price nobody can
  // buy. Tier prices are computed from the draft, never typed in.
  const rules = await readFile(path.join(ROOT, 'data', 'business-rules.json'), 'utf8')
    .then((raw) => JSON.parse(raw))
    .catch(() => null);
  const tierList = rules ? tierDefinitions(rules) : [];
  const tierPrices = rules
    ? tierPriceConsistency(rules, publicProjectionOfCentral(central))
    : { ok: true, warnings: [], tiers: [], unassigned: [] };
  // What each tier will show after this publish, next to the tier it shows now.
  const publishedSets = setsFromPlanner(published.overrides);
  const draftSets = setsFromProjection(publicProjectionOfCentral(central));
  const nextFloors = computeTierFloors(draftSets).floors;
  const liveFloors = computeTierFloors(publishedSets).floors;
  const tierChanges = tierList.map((tier) => ({
    id: tier.id,
    nameTh: tier.nameTh,
    nameEn: tier.nameEn,
    boxFormatTh: tier.boxFormatTh,
    boxFormatEn: tier.boxFormatEn,
    from: liveFloors[tier.id]?.priceFrom ?? null,
    to: nextFloors[tier.id]?.priceFrom ?? null,
    sourceId: nextFloors[tier.id]?.sourceId ?? null,
    sourceName: nextFloors[tier.id]?.sourceName ?? null,
  }));
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
        tier: normalizeTier(menu.tier),
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
    tiers: tierList,
    tierPrices,
    tierChanges,
    diff: {
      added: diff.added, changed: diff.changed, shown: diff.shown,
      hidden: diff.hidden, removed: diff.removed, costBlocked: diff.costBlocked,
      quoteOnlyChanged: diff.quoteOnlyChanged,
      toppingsChanged: diff.toppingsChanged,
      sideItemsChanged: diff.sideItemsChanged,
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
          };
          const liveName = liveNameFromBackup(file);
          const validate = validators[liveName];
          if (!validate) return sendJson(400, { ok: false, error: `กู้คืนได้เฉพาะ menu-central.json (${liveName})` });
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
          const result = await publishCentral({ root: ROOT, dataDir, central });
          return sendJson(200, { ok: true, record: result.record });
        } catch (error) {
          // Truthful failure only: the previous release is untouched and the
          // status stays "failed", never "success".
          const state = await readPublishState(dataDir);
          return sendJson(500, { ok: false, error: error.message, state });
        }
      }
      if (request.method === 'POST') return send(405, 'GET only');
      if (pathname === '/readiness') return sendJson(200, { ready: true, app: 'owner-set-builder' });
      if (pathname === '/sellable-menus') return send(200, JSON.stringify(await sellableMenus(dataDir)), 'application/json; charset=utf-8');
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
  await ensureSeedData(dataDir);
  console.log(`Private data dir: ${dataDir} (override with EED_ADMIN_DATA_DIR or --data-dir=)`);
  createLocalServer({ dataDir }).listen(port, '127.0.0.1', () => {
    console.log(`Owner-only admin tools: http://127.0.0.1:${port}/`);
  });
}
