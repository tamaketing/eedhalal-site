// EED HALAL — deploy-via-worktree tests (REAL temp git repos, fake live net).
//
// The admin checkout stays dirty throughout: a canary uncommitted change must
// survive every run byte-identical, and no commit/push ever happens there.
// Pushes go only to a scratch bare remote, never the real origin.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t', ...args], { cwd, timeout: 60000 });
  return stdout;
}

function seedCatalog() {
  return {
    prices: { 1: 65, 2: 70 },
    mins: { 1: 5, 2: 5 },
    images: { 1: 'img/a.jpg', 2: 'img/b.jpg' },
    names: { 1: 'เมนู ก', 2: 'เมนู ข' },
    tiers: { 1: 'classic', 2: 'classic' },
    deleted: [],
  };
}

function seedMenuJs() {
  return [
    '/* seed */',
    'var EED_DEFAULT_TOPPINGS = [];',
    'var EED_MENUS = [',
    '  { id: 1, name: "เมนู ก", price: 65, tier: "classic", image: "img/a.jpg", desc: "", badge: "", minPerMenu: 5 },',
    '  { id: 2, name: "เมนู ข", price: 70, tier: "classic", image: "img/b.jpg", desc: "", badge: "", minPerMenu: 5 }',
    '];',
    '',
  ].join('\n');
}

function seedCentral() {
  return {
    version: 9,
    updatedAt: '2026-09-27T00:00:00.000Z',
    menus: [
      { id: 1, name: 'เมนู ก', price: 65, tier: 'classic', image: 'img/a.jpg', desc: '', badge: '', minPerMenu: 5, hidden: false, sortOrder: 0, internalNote: '' },
      { id: 2, name: 'เมนู ข', price: 70, tier: 'classic', image: 'img/b.jpg', desc: '', badge: '', minPerMenu: 5, hidden: false, sortOrder: 1, internalNote: '' },
    ],
    toppings: [],
    popular: [1, 2],
  };
}

// Scratch world: bare remote + seeded clone (the "dirty admin checkout").
async function makeWorld() {
  const { mkdir } = await import('node:fs/promises');
  const base = await mkdtemp(path.join(tmpdir(), 'eed-deploy-'));
  const remote = path.join(base, 'remote.git');
  const workspace = path.join(base, 'workspace');
  const dataDir = path.join(base, 'data');
  await mkdir(dataDir, { recursive: true });
  await execFileAsync('git', ['init', '--bare', remote], { timeout: 30000 });
  await execFileAsync('git', ['clone', remote, workspace], { timeout: 30000 });
  await git(workspace, 'checkout', '-b', 'main');
  await mkdir(path.join(workspace, 'data',), { recursive: true });
  await mkdir(path.join(workspace, 'js'), { recursive: true });
  await mkdir(path.join(workspace, 'img'), { recursive: true });
  await writeFile(path.join(workspace, 'data', 'planner-overrides.json'), JSON.stringify(seedCatalog(), null, 2), 'utf8');
  await writeFile(path.join(workspace, 'js', 'menu-data.js'), seedMenuJs(), 'utf8');
  await writeFile(path.join(workspace, 'img', 'a.jpg'), 'a', 'utf8');
  await writeFile(path.join(workspace, 'img', 'b.jpg'), 'b', 'utf8');
  await writeFile(path.join(workspace, 'notes.txt'), 'seed\n', 'utf8');
  await git(workspace, 'add', '-A');
  await git(workspace, 'commit', '-m', 'seed');
  await git(workspace, 'push', '-u', 'origin', 'main');
  await writeFile(path.join(dataDir, 'menu-central.json'), JSON.stringify(seedCentral()), 'utf8');
  // Dirty canary: uncommitted work that must survive every run untouched.
  await writeFile(path.join(workspace, 'notes.txt'), 'seed + UNCOMMITTED owner work\n', 'utf8');
  const canary = await readFile(path.join(workspace, 'notes.txt'), 'utf8');
  const canaryMtime = (await stat(path.join(workspace, 'notes.txt'))).mtimeMs;
  const head = (await git(workspace, 'rev-parse', 'HEAD')).trim();
  return { base, remote, workspace, dataDir, canary, canaryMtime, head };
}

async function assertCanaryIntact(world) {
  assert.equal(await readFile(path.join(world.workspace, 'notes.txt'), 'utf8'), world.canary);
  assert.equal((await stat(path.join(world.workspace, 'notes.txt'))).mtimeMs, world.canaryMtime);
  const status = await git(world.workspace, 'status', '--porcelain');
  assert.ok(status.trim().split('\n').every((line) => line.trim().endsWith('notes.txt')), `workspace gained changes:\n${status}`);
  assert.equal((await git(world.workspace, 'rev-parse', 'HEAD')).trim(), world.head, 'workspace HEAD must not move');
}

function makeDeps(world, { liveQueue = [], gateHook = null, gateFail = null } = {}) {
  const gitLog = [];
  let clock = Date.parse('2026-09-27T00:00:00.000Z');
  const liveCalls = [];
  const gateCalls = [];
  return {
    gitLog,
    liveCalls,
    gateCalls,
    deps: {
      remote: world.remote,
      branch: 'main',
      worktreeDir: path.join(world.base, 'publish'),
      now: () => new Date((clock += 100)),
      pollIntervalMs: 1,
      pollTimeoutMs: 500,
      loadCentral: async () => {
        const { loadCentral } = await import('../scripts/menu-central.mjs');
        return loadCentral(world.dataDir);
      },
      runGit: async (args, opts = {}) => {
        gitLog.push({ args, cwd: opts.cwd });
        if (args[0] !== 'worktree') assert.ok(!args.includes('--force'), 'force is never allowed outside worktree cleanup');
        return git(opts.cwd || world.workspace, ...args);
      },
      runGate: async (cmd, args, cwd) => {
        gateCalls.push({ cmd, args, cwd });
        if (gateFail === cmd) throw new Error(`fake gate failure: ${cmd}`);
        if (gateHook) await gateHook({ cmd, args, cwd, world });
      },
      verifyLive: async ({ fileVersion }) => {
        liveCalls.push(fileVersion);
        return liveQueue.length ? liveQueue.shift() : { state: 'unverified', liveVersion: null, checkedAt: 't', reason: 'no live yet' };
      },
    },
  };
}

test('worktree gates run serial tests and reference only existing files', async () => {
  const { WORKTREE_GATES } = await import('../scripts/menu-deploy.mjs');
  const { existsSync } = await import('node:fs');
  assert.ok(WORKTREE_GATES.length > 0);
  for (const gate of WORKTREE_GATES) {
    if (gate.cmd === '--test') {
      assert.ok(gate.args.includes('--test-concurrency=1'), 'worktree tests must run serially');
      for (const arg of gate.args.filter((item) => item.endsWith('.test.mjs'))) {
        assert.ok(existsSync(path.join(HERE, '..', arg)), `worktree gate references a missing test: ${arg}`);
      }
    } else {
      assert.ok(existsSync(path.join(HERE, '..', gate.cmd)), `worktree gate references a missing checker: ${gate.cmd}`);
    }
  }
  assert.ok(!WORKTREE_GATES.some((gate) => gate.args.includes('test/admin-logic.test.mjs')), 'the retired admin-logic test must not gate a deploy');
});

test('new menu images move from the working checkout into the clean worktree', async (t) => {
  const { syncWebsiteImages, websiteImageRefs } = await import('../scripts/menu-deploy.mjs');
  const base = await mkdtemp(path.join(tmpdir(), 'eed-deploy-images-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(base, { recursive: true, force: true });
  });
  const sourceRoot = path.join(base, 'workspace');
  const worktreeDir = path.join(base, 'worktree');
  await mkdir(path.join(sourceRoot, 'img'), { recursive: true });
  await mkdir(path.join(worktreeDir, 'img'), { recursive: true });
  await writeFile(path.join(sourceRoot, 'img', 'new-dish.jpg'), 'new-bytes', 'utf8');
  const central = { menus: [{ id: 1, image: 'img/new-dish.jpg' }, { id: 2, image: '' }] };
  assert.deepEqual(websiteImageRefs(central), ['img/new-dish.jpg']);
  assert.deepEqual(await syncWebsiteImages({ sourceRoot, worktreeDir, refs: websiteImageRefs(central) }), ['img/new-dish.jpg']);
  assert.equal(await readFile(path.join(worktreeDir, 'img', 'new-dish.jpg'), 'utf8'), 'new-bytes');
  assert.deepEqual(await syncWebsiteImages({ sourceRoot, worktreeDir, refs: websiteImageRefs(central) }), []);
  await assert.rejects(
    syncWebsiteImages({ sourceRoot, worktreeDir, refs: ['../outside.jpg'] }),
    /ไม่พบรูปใหม่/,
  );
});

test('unsafe image paths are rejected before any file is copied', async () => {
  const { websiteImageRefs } = await import('../scripts/menu-deploy.mjs');
  assert.throws(
    () => websiteImageRefs({ menus: [{ id: 1, image: '../outside.jpg' }] }),
    /พาธไม่ปลอดภัย/,
  );
});

test('website release collection hashes the exact changed files and rejects strays', async (t) => {
  const { collectWebsiteRelease, websiteReleaseDigest } = await import('../scripts/menu-deploy.mjs');
  const worktreeDir = await mkdtemp(path.join(tmpdir(), 'eed-deploy-release-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(worktreeDir, { recursive: true, force: true });
  });
  await mkdir(path.join(worktreeDir, 'img'), { recursive: true });
  await writeFile(path.join(worktreeDir, 'popular-menu.html'), '<p>a</p>\r\n', 'utf8');
  await writeFile(path.join(worktreeDir, 'img', 'new-dish.jpg'), Buffer.from([1, 2, 3]));
  const status = ' M popular-menu.html\0?? img/new-dish.jpg\0?? .eed-publish-worktree\0';
  const runGit = async () => status;
  const release = await collectWebsiteRelease({ worktreeDir, runGit, files: ['popular-menu.html', 'img/new-dish.jpg'] });
  assert.deepEqual(release.files.map((file) => file.path), ['popular-menu.html', 'img/new-dish.jpg']);
  assert.equal(release.contentHash, websiteReleaseDigest(release.files));
  await assert.rejects(
    collectWebsiteRelease({ worktreeDir, runGit, files: ['popular-menu.html', 'img/new-dish.jpg', 'stray.txt'] }),
    /ไม่ตรงกับรายการเผยแพร่/,
  );
});

test('happy path: dirty workspace untouched, remote gets exactly the website-release files', async () => {
  const { deployMenuRelease } = await import('../scripts/menu-deploy.mjs');
  const { readPublishState } = await import('../scripts/menu-central.mjs');
  const world = await makeWorld();
  const central = JSON.parse(await readFile(path.join(world.dataDir, 'menu-central.json'), 'utf8'));
  const liveQueue = [{ state: 'live', liveVersion: central.version, checkedAt: 't', reason: 'ok' }];
  const { deps, gitLog } = makeDeps(world, { liveQueue });
  const result = await deployMenuRelease({ root: world.workspace, dataDir: world.dataDir, deps });
  assert.equal(result.ok, true);
  assert.equal(result.pushed, true);
  assert.equal(result.liveConfirmed, true);
  // Remote main advanced by exactly one commit with only the 2 files.
  const show = await execFileAsync('git', ['--git-dir', world.remote, 'show', '--name-only', '--format=%s', 'main'], { timeout: 30000 });
  const names = show.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  assert.ok(names[0].includes('chore(menus): publish central v9 to web'), names[0]);
  assert.deepEqual(names.slice(1).sort(), ['data/planner-overrides.json', 'js/menu-data.js']);
  // Workspace canary intact; no commit/push happened there.
  await assertCanaryIntact(world);
  assert.ok(!gitLog.some((c) => c.args[0] === 'commit' && c.cwd === world.workspace));
  assert.ok(!gitLog.some((c) => c.args[0] === 'push' && c.cwd === world.workspace));
  const state = await readPublishState(world.dataDir);
  assert.equal(state.deploy.phase, 'live');
  assert.equal(state.live.state, 'live');
  assert.deepEqual(state.file.files.sort(), ['data/planner-overrides.json', 'js/menu-data.js']);
  assert.equal(state.file.hashes.websiteFiles.length, 2);
  assert.equal(typeof state.file.hashes.websiteContent, 'string');
});

test('remote moves mid-run: abort before commit, their commit stands alone', async () => {
  const { deployMenuRelease } = await import('../scripts/menu-deploy.mjs');
  const world = await makeWorld();
  let moved = false;
  const gateHook = async () => {
    if (moved) return;
    moved = true;
    // Someone else pushes to remote main while we verify: must abort, no force.
    const other = path.join(world.base, 'other');
    await execFileAsync('git', ['clone', world.remote, other], { timeout: 30000 });
    await git(other, 'checkout', 'main');
    await writeFile(path.join(other, 'other.txt'), 'theirs\n', 'utf8');
    await git(other, 'add', '-A');
    await git(other, 'commit', '-m', 'theirs');
    await git(other, 'push', 'origin', 'main');
  };
  const { deps } = makeDeps(world, { gateHook });
  await assert.rejects(() => deployMenuRelease({ root: world.workspace, dataDir: world.dataDir, deps }), /เปลี่ยนระหว่างเตรียม|เปลี่ยนก่อน push/);
  const names = (await execFileAsync('git', ['--git-dir', world.remote, 'log', '--format=%s', 'main'], { timeout: 30000 })).stdout;
  assert.ok(!names.includes('chore(menus)'), 'our commit must not exist on the remote');
  assert.ok(names.includes('theirs'));
  await assertCanaryIntact(world);
});

test('gate failure aborts before any commit', async () => {
  const { deployMenuRelease } = await import('../scripts/menu-deploy.mjs');
  const world = await makeWorld();
  const { deps } = makeDeps(world, { gateFail: 'scripts/check-system.mjs' });
  await assert.rejects(() => deployMenuRelease({ root: world.workspace, dataDir: world.dataDir, deps }), /gate ไม่ผ่าน/);
  const count = (await execFileAsync('git', ['--git-dir', world.remote, 'rev-list', '--count', 'main'], { timeout: 30000 })).stdout.trim();
  assert.equal(count, '1', 'remote keeps only the seed commit');
  await assertCanaryIntact(world);
});

test('push ok but live never matches: ยังไม่ยืนยัน, never published', async () => {
  const { deployMenuRelease } = await import('../scripts/menu-deploy.mjs');
  const { readPublishState } = await import('../scripts/menu-central.mjs');
  const world = await makeWorld();
  const { deps } = makeDeps(world, { liveQueue: [] });
  const result = await deployMenuRelease({ root: world.workspace, dataDir: world.dataDir, deps });
  assert.equal(result.pushed, true);
  assert.equal(result.liveConfirmed, false);
  const state = await readPublishState(world.dataDir);
  assert.equal(state.deploy.phase, 'unverified');
  await assertCanaryIntact(world);
});

test('stray file in worktree aborts the commit', async () => {
  const { deployMenuRelease } = await import('../scripts/menu-deploy.mjs');
  const world = await makeWorld();
  const gateHook = async ({ cwd }) => {
    await writeFile(path.join(cwd, 'stray.txt'), 'not ours\n', 'utf8');
  };
  const { deps } = makeDeps(world, { gateHook });
  await assert.rejects(() => deployMenuRelease({ root: world.workspace, dataDir: world.dataDir, deps }), /ไฟล์นอกขอบเขต/);
  const count = (await execFileAsync('git', ['--git-dir', world.remote, 'rev-list', '--count', 'main'], { timeout: 30000 })).stdout.trim();
  assert.equal(count, '1');
});
