// EED HALAL — deploy-to-web orchestration tests (fakes only, never git/push).
//
// Proves the backend flow refuses unsafe runs and never claims success:
//   - dirty draft / hand-edited files / foreign unpushed commits -> abort
//   - commit pathspec contains ONLY the two published files
//   - push ok + live match -> live confirmed; push ok + live timeout ->
//     "ยังไม่ยืนยัน" (never "เผยแพร่แล้ว"); push fail -> failed phase.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { deployMenuRelease, deployPreflight, DEPLOY_ALLOWLIST } from '../scripts/menu-deploy.mjs';
import { loadPublished, migrateCentral, parseMenuDataJs, parsePopularIds, readPublishState, saveCentral } from '../scripts/menu-central.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function seedTempRoot() {
  const dir = await mkdtemp(path.join(tmpdir(), 'eed-deploy-test-'));
  const dataDir = path.join(dir, 'local');
  await mkdir(path.join(dir, 'data'), { recursive: true });
  await mkdir(path.join(dir, 'js'), { recursive: true });
  await mkdir(dataDir, { recursive: true });
  const overrides = JSON.parse(await readFile(path.join(REPO, 'data', 'planner-overrides.json'), 'utf8'));
  const menuDataJs = await readFile(path.join(REPO, 'js', 'menu-data.js'), 'utf8');
  await writeFile(path.join(dir, 'data', 'planner-overrides.json'), JSON.stringify(overrides, null, 2), 'utf8');
  await writeFile(path.join(dir, 'js', 'menu-data.js'), menuDataJs, 'utf8');
  for (const image of new Set(Object.values(overrides.images))) {
    const target = path.join(dir, decodeURIComponent(String(image).replace(/^\/+/, '')));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, '', 'utf8');
  }
  const hydrateJs = await readFile(path.join(REPO, 'js', 'popular-menu-hydrate.js'), 'utf8');
  const central = migrateCentral({ menuDataMenus: await parseMenuDataJs(menuDataJs), planner: overrides, popularIds: parsePopularIds(hydrateJs) });
  // Publish once so draft == files (deploy requires a clean file build first).
  const { publishCentral } = await import('../scripts/menu-central.mjs');
  const saved = await saveCentral(dataDir, central);
  await publishCentral({ root: dir, dataDir, central: saved.data });
  const files = {
    'data/planner-overrides.json': await readFile(path.join(dir, 'data', 'planner-overrides.json'), 'utf8'),
    'js/menu-data.js': await readFile(path.join(dir, 'js', 'menu-data.js'), 'utf8'),
  };
  return { dir, dataDir, files };
}

// Programmable git/network fakes. gitBehavior controls scripted outputs.
function makeDeps({ dir, dataDir, files, gitBehavior = {}, liveQueue = [] }) {
  const gitCalls = [];
  const liveCalls = [];
  const behavior = { branch: 'main', unpushed: '', statusFull: '', failOn: null, ...gitBehavior };
  let clock = Date.parse('2026-09-27T00:00:00.000Z');
  const deps = {
    now: () => new Date((clock += 50)),
    pollIntervalMs: 1,
    pollTimeoutMs: 100,
    loadCentral: async () => {
      const { loadCentral } = await import('../scripts/menu-central.mjs');
      return loadCentral(dataDir);
    },
    readFile: async (rel) => files[rel],
    runGit: async (args) => {
      gitCalls.push(args);
      const [cmd] = args;
      if (behavior.failOn === cmd) throw new Error(`fake git ${cmd} failed`);
      if (cmd === 'branch') return `${behavior.branch}\n`;
      if (cmd === 'log') {
        if (args.includes('@{u}..HEAD')) return behavior.unpushed;
        return '';
      }
      if (cmd === 'status') return behavior.statusFull;
      if (cmd === 'add' || cmd === 'commit' || cmd === 'push') return `${cmd} ok`;
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    },
    verifyLive: async ({ fileVersion, attempt }) => {
      liveCalls.push({ fileVersion, attempt });
      return liveQueue.length ? liveQueue.shift() : { state: 'unverified', liveVersion: null, checkedAt: 't', reason: 'no live yet' };
    },
  };
  return { deps, gitCalls, liveCalls };
}

test('preflight aborts when the draft is ahead of the built files', async () => {
  const { dir, dataDir, files } = await seedTempRoot();
  const { loadCentral, saveCentral } = await import('../scripts/menu-central.mjs');
  const draft = await loadCentral(dataDir);
  const menus = draft.menus.map((m) => (m.id === 1 ? { ...m, name: 'เปลี่ยนชื่อ' } : m));
  await saveCentral(dataDir, { ...draft, menus });
  const { deps } = makeDeps({ dir, dataDir, files });
  const pre = await deployPreflight({ root: dir, dataDir, deps });
  assert.equal(pre.ok, false);
  assert.match(pre.reasons.join(' '), /ยังใหม่กว่า/);
});

test('preflight aborts on hand-edited published files', async () => {
  const { dir, dataDir, files } = await seedTempRoot();
  const tampered = { ...files };
  const parsed = JSON.parse(tampered['data/planner-overrides.json']);
  parsed.prices['1'] = 9999;
  tampered['data/planner-overrides.json'] = JSON.stringify(parsed);
  const { deps } = makeDeps({ dir, dataDir, files: tampered });
  const pre = await deployPreflight({ root: dir, dataDir, deps });
  assert.equal(pre.ok, false);
  assert.match(pre.reasons.join(' '), /แก้ด้วยมือ/);
});

test('preflight aborts when foreign commits would ride along', async () => {
  const { dir, dataDir, files } = await seedTempRoot();
  const { deps } = makeDeps({ dir, dataDir, files, gitBehavior: { unpushed: 'abc1234 previous work\n' } });
  const pre = await deployPreflight({ root: dir, dataDir, deps });
  assert.equal(pre.ok, false);
  assert.match(pre.reasons.join(' '), /commit อื่น/);
});

test('success: commit contains ONLY the published files, live confirmed', async () => {
  const { dir, dataDir, files } = await seedTempRoot();
  const central = await (await import('../scripts/menu-central.mjs')).loadCentral(dataDir);
  const liveQueue = [{ state: 'live', liveVersion: central.version, checkedAt: 't', reason: 'ok' }];
  const { deps, gitCalls } = makeDeps({
    dir, dataDir, files, liveQueue,
    gitBehavior: { statusFull: ' M about.html\n?? notes.txt\n' },
  });
  const result = await deployMenuRelease({ root: dir, dataDir, deps });
  assert.equal(result.ok, true);
  assert.equal(result.pushed, true);
  assert.equal(result.liveConfirmed, true);
  const add = gitCalls.find(([cmd]) => cmd === 'add');
  assert.deepEqual(add.slice(1), ['--', ...DEPLOY_ALLOWLIST]);
  assert.ok(!gitCalls.some((args) => args.join(' ').includes('about.html')), 'unrelated work must not enter git calls');
  const state = await readPublishState(dataDir);
  assert.equal(state.live.state, 'live');
  assert.equal(state.deploy.phase, 'live');
  assert.match(state.deploy.commit, /ok/);
});

test('push ok but live never matches -> ยังไม่ยืนยัน, never เผยแพร่แล้ว', async () => {
  const { dir, dataDir, files } = await seedTempRoot();
  const { deps } = makeDeps({ dir, dataDir, files, liveQueue: [] });
  const result = await deployMenuRelease({ root: dir, dataDir, deps });
  assert.equal(result.pushed, true);
  assert.equal(result.liveConfirmed, false);
  const state = await readPublishState(dataDir);
  assert.equal(state.deploy.phase, 'unverified');
  assert.equal(state.live.state, 'unverified');
});

test('push failure -> failed phase, web stays on the old release', async () => {
  const { dir, dataDir, files } = await seedTempRoot();
  const { deps } = makeDeps({ dir, dataDir, files, gitBehavior: { failOn: 'push' } });
  await assert.rejects(() => deployMenuRelease({ root: dir, dataDir, deps }), /push ไม่สำเร็จ/);
  const state = await readPublishState(dataDir);
  assert.equal(state.deploy.phase, 'failed');
});
