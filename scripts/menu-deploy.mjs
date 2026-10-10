// EED HALAL — deploy-to-web orchestrator (tracked, no secrets).
//
// The publish button must work even when the admin checkout is dirty:
// everything git-related happens in a DEDICATED worktree tracking remote
// main, never in the working checkout. Only the two built public files enter
// that worktree, built from the admin's central draft (dataDir) — the dirty
// workspace is only READ for the central data, never written, never pushed.
//
// Safety rules (hard):
// - `git add` uses an explicit pathspec of exactly DEPLOY_ALLOWLIST.
// - The worktree starts at the fetched remote sha; if the remote moves
//   between prepare and push, the run aborts (re-prepare instead). Never
//   --force (asserted in tests; push args are recorded).
// - Push success is NOT deploy success: only verifyLive reporting `live`
//   for this file version counts as published; otherwise "ยังไม่ยืนยัน".
// - Gates re-run INSIDE the worktree before commit (check-system,
//   check-public-site, menu pipeline tests).
//
// Deps are injected ({ runGit(args, opts), runGate(cmd, args, cwd),
// verifyLive, now, loadCentral }) so tests drive the REAL git binary against
// temp repos with only the network faked.

import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getForbiddenPaths } from './check-repository-safety.mjs';
import {
  assertPublishSafe,
  buildMenuDataJs,
  buildPlannerOverrides,
  loadPublished,
  PUBLISH_FILES,
  hashWebsiteFileBytes,
  readPublishState,
  sha256Hex,
  validateCentral,
  writePublishState,
} from './menu-central.mjs';

export const DEPLOY_ALLOWLIST = [...PUBLISH_FILES];
export const WORKTREE_MARKER = '.eed-publish-worktree';

// A complete website release contains the two catalog files plus every file
// the DEPLOY.md builders regenerate and every newly referenced menu image.
// Builder output is never trusted by extension or directory alone.
const GENERATED_TEXT_FILES = new Set([
  'js/business-data.js',
  'js/menu-data.js',
  'js/snack-data.js',
  'llms.txt',
  'llms-full.md',
]);
const INTERNAL_PAGES = new Set(['budget-planner.html', 'kitchen-order.html']);

export function isWebsiteReleaseFile(file) {
  const normalized = String(file || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) return false;
  if (normalized === WORKTREE_MARKER) return false;
  if (DEPLOY_ALLOWLIST.includes(normalized) || GENERATED_TEXT_FILES.has(normalized)) return true;
  if (normalized.endsWith('.html') && !INTERNAL_PAGES.has(normalized) && !normalized.startsWith('tools/')) return true;
  return /^img\/[^/]+\.(?:jpe?g|png|webp|gif|avif)$/i.test(normalized);
}

function deployText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Local menu-image references that must be copied from the working checkout
// into the clean publish worktree before image verification. External URLs and
// blank fields are not files; anything outside img/ is out of scope for the
// menu-image handoff and is still verified by assertPublishSafe.
export function websiteImageRefs(central) {
  const refs = new Set();
  for (const menu of central?.menus || []) {
    const ref = deployText(menu?.image).replace(/^\/+/, '');
    if (!ref || /^https?:\/\//i.test(ref)) continue;
    if (ref.includes('\\') || /^[a-zA-Z]:/.test(ref) || ref.startsWith('file:') || ref.includes('..')) {
      throw new Error(`รูปเมนู id ${menu?.id} ใช้พาธไม่ปลอดภัย: ${menu?.image}`);
    }
    if (ref.startsWith('img/')) refs.add(ref);
  }
  return [...refs];
}

export async function syncWebsiteImages({ sourceRoot, worktreeDir, refs }) {
  const copied = [];
  for (const ref of refs || []) {
    const source = path.join(sourceRoot, ref);
    const target = path.join(worktreeDir, ref);
    let sourceBytes;
    try {
      sourceBytes = await readFile(source);
    } catch {
      throw new Error(`ไม่พบรูปใหม่ใน working checkout: ${ref} — เพิ่มไฟล์รูปก่อนขึ้นเว็บ`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    const current = await readFile(target).catch(() => null);
    if (!current || !Buffer.from(current).equals(sourceBytes)) {
      await copyFile(source, target);
      copied.push(ref);
    }
  }
  return copied;
}

export function hashWebsiteBytes(file, bytes) {
  return hashWebsiteFileBytes(file, bytes);
}

export function websiteReleaseDigest(files) {
  const canonical = JSON.stringify([...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
  return sha256Hex(canonical);
}

function parsePorcelainZ(output) {
  return String(output || '')
    .split('\0')
    .filter((entry) => entry.trim())
    .map((entry) => {
      const file = entry.slice(3).replace(/^"(.*)"$/, '$1');
      const arrow = file.indexOf(' -> ');
      return (arrow === -1 ? file : file.slice(arrow + 4)).trim();
    })
    .filter((file) => file && file !== WORKTREE_MARKER);
}

export async function websiteChangedFiles({ worktreeDir, runGit }) {
  const status = await runGit(['status', '--porcelain=v1', '-z'], { cwd: worktreeDir });
  return parsePorcelainZ(status);
}

export async function collectWebsiteRelease({ worktreeDir, runGit, files }) {
  const changed = await websiteChangedFiles({ worktreeDir, runGit });
  const wanted = [...new Set(files || [])].sort();
  if (JSON.stringify([...changed].sort()) !== JSON.stringify(wanted)) {
    throw new Error(`ไฟล์ใน worktree ไม่ตรงกับรายการเผยแพร่: พบ ${changed.join(', ') || 'ไม่มีไฟล์'}; ต้องการ ${wanted.join(', ')}`);
  }
  const forbidden = getForbiddenPaths(changed);
  if (forbidden.length) throw new Error(`ไฟล์ต้องห้ามอยู่ในรายการเผยแพร่: ${forbidden.join(', ')}`);
  const disallowed = changed.filter((file) => !isWebsiteReleaseFile(file));
  if (disallowed.length) throw new Error(`ไฟล์นอกขอบเขตเผยแพร่เว็บไซต์: ${disallowed.join(', ')}`);
  const hashed = [];
  for (const file of changed) {
    hashed.push({ path: file, sha256: hashWebsiteBytes(file, await readFile(path.join(worktreeDir, file))) });
  }
  return { files: hashed, contentHash: websiteReleaseDigest(hashed) };
}

export function deployCommitMessage(fileVersion, fileCount = DEPLOY_ALLOWLIST.length) {
  return `chore(menus): publish central v${fileVersion} to web (${fileCount} files)`;
}

function phaseRecord(deploy, phase, detail, extra = {}) {
  return { ...(deploy || null), phase, detail, at: new Date().toISOString(), ...extra };
}

async function currentState(dataDir) {
  return (await readPublishState(dataDir)) || { file: null, live: null, deploy: null, error: null };
}

async function saveState(dataDir, patch) {
  const state = await currentState(dataDir);
  const next = { ...state, ...patch };
  await writePublishState(dataDir, next);
  return next;
}

async function abort(dataDir, detail) {
  await saveState(dataDir, { deploy: phaseRecord(null, 'aborted', detail), error: detail });
  const error = new Error(detail);
  error.code = 'EDEPLOYABORTED';
  throw error;
}

// Remote sha without changing any local state (fetch first separately).
export async function remoteSha({ remote = 'origin', branch = 'main', repoRoot, runGit }) {
  const out = await runGit(['ls-remote', remote, `refs/heads/${branch}`], { cwd: repoRoot });
  const sha = out.trim().split(/\s+/)[0] || '';
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`อ่าน remote ${remote}/${branch} ไม่สำเร็จ`);
  return sha;
}

// Prepare (or reuse) the dedicated publish worktree at exactly baseSha.
// Reuse only when the marker matches AND HEAD matches AND the worktree is
// clean; otherwise rebuild from scratch. Never touches the working checkout.
export async function ensurePublishWorktree({ repoRoot, dir, remote = 'origin', branch = 'main', runGit }) {
  await runGit(['fetch', remote, branch], { cwd: repoRoot });
  const baseSha = await remoteSha({ remote, branch, repoRoot, runGit });
  let reuse = false;
  try {
    const marker = (await readFile(path.join(dir, WORKTREE_MARKER), 'utf8')).trim();
    const status = await runGit(['status', '--porcelain'], { cwd: dir });
    const head = (await runGit(['rev-parse', 'HEAD'], { cwd: dir })).trim();
    reuse = marker === baseSha && head === baseSha && status.trim() === '';
  } catch {
    reuse = false;
  }
  if (!reuse) {
    await runGit(['worktree', 'remove', '--force', dir], { cwd: repoRoot }).catch(() => {});
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.dirname(dir), { recursive: true });
    await runGit(['worktree', 'add', '--detach', dir, baseSha], { cwd: repoRoot });
    await writeFile(path.join(dir, WORKTREE_MARKER), `${baseSha}\n`, 'utf8');
  }
  return { dir, baseSha, reused: reuse };
}

// Build the two public files into the worktree from the admin central draft
// and verify the exact bytes on disk there (allowlist, leaks, images).
export async function buildIntoWorktree({ worktreeDir, central, now, sourceRoot = worktreeDir }) {
  const validated = validateCentral(central);
  if (!validated.ok) throw new Error(`ฐานกลางไม่ผ่านการตรวจ: ${validated.errors.join(' | ')}`);
  const clean = { ...validated.data, version: central.version ?? 0, updatedAt: central.updatedAt ?? null };
  const current = await loadPublished(worktreeDir);
  const overrides = buildPlannerOverrides(clean, current.overrides, now);
  const menuDataJs = buildMenuDataJs(clean, now);
  // A new image may exist only in the working checkout. Copy it into the clean
  // worktree before verification, so the release can prove the exact bytes it
  // will serve. The working checkout itself is only read, never modified.
  const copiedImages = await syncWebsiteImages({ sourceRoot, worktreeDir, refs: websiteImageRefs(clean) });
  assertPublishSafe({ overrides, menuDataJs, root: worktreeDir });
  await writeFile(path.join(worktreeDir, 'data', 'planner-overrides.json'), `${JSON.stringify(overrides, null, 2)}\n`, 'utf8');
  await writeFile(path.join(worktreeDir, 'js', 'menu-data.js'), menuDataJs, 'utf8');
  const diskOverrides = JSON.parse(await readFile(path.join(worktreeDir, 'data', 'planner-overrides.json'), 'utf8'));
  const diskJs = await readFile(path.join(worktreeDir, 'js', 'menu-data.js'), 'utf8');
  assertPublishSafe({ overrides: diskOverrides, menuDataJs: diskJs, root: worktreeDir });
  return { fileVersion: clean.version, overrides, menuDataJs, copiedImages };
}

// Website builders, in DEPLOY.md order. They run inside the clean publish
// worktree, so generated HTML, structured data, llms files and web runtime
// data follow the catalog that was just built there.
export const WEBSITE_BUILD_COMMANDS = [
  { cmd: 'scripts/sync-catering-content.mjs', args: ['--write'] },
  { cmd: 'scripts/popular-menu-page.mjs', args: ['--write'] },
  { cmd: 'scripts/check-system.mjs', args: ['--write'] },
];

// Gates that must pass INSIDE the worktree before anything is committed.
// Tests run serially because several suites temporarily rewrite repository
// files to prove drift is caught; parallel files could read a file before the
// suite that changed it restores it.
export const WEBSITE_VERIFY_COMMANDS = [
  { cmd: 'scripts/check-repository-safety.mjs', args: [] },
  { cmd: 'scripts/sync-business-content.mjs', args: ['--check'] },
  { cmd: 'scripts/sync-catering-content.mjs', args: ['--check'] },
  { cmd: 'scripts/check-system.mjs', args: ['--check'] },
  { cmd: 'scripts/popular-menu-page.mjs', args: ['--check'] },
  { cmd: 'scripts/check-starting-price.mjs', args: [] },
  { cmd: 'scripts/check-business-sync.mjs', args: ['--check'] },
  { cmd: 'scripts/check-public-site.mjs', args: [] },
  { cmd: '--test', args: ['--test-concurrency=1', 'test/menu-central-publish.test.mjs', 'test/menu-deploy.test.mjs', 'test/menu-backups.test.mjs', 'test/admin-menu-ui.test.mjs', 'test/admin-runtime-clean.test.mjs'] },
];

export const WORKTREE_GATES = [...WEBSITE_BUILD_COMMANDS, ...WEBSITE_VERIFY_COMMANDS];

export async function verifyWorktreeGates({ worktreeDir, runGate }) {
  for (const gate of WORKTREE_GATES) {
    try {
      await runGate(gate.cmd, gate.args, worktreeDir);
    } catch (error) {
      throw new Error(`gate ไม่ผ่านใน worktree (${gate.cmd}): ${error.message}`);
    }
  }
}

// Commit ONLY the exact website-release file list. Aborts when the worktree
// holds anything else uncommitted, or when the remote moved since prepare.
// Repository-safety and line-ending checks run after staging because both read
// the git index: only then do they see exactly the bytes about to be committed.
export async function commitPublishFiles({ worktreeDir, repoRoot, remote, branch, baseSha, message, files = DEPLOY_ALLOWLIST, runGit, runGate }) {
  const status = await runGit(['status', '--porcelain=v1', '-z'], { cwd: worktreeDir });
  const touched = parsePorcelainZ(status);
  const wanted = [...new Set(files || [])].sort();
  if (JSON.stringify([...touched].sort()) !== JSON.stringify(wanted)) {
    throw new Error(`worktree มีไฟล์อื่นปนนอกเหนือจากไฟล์เผยแพร่: พบ ${touched.join(', ') || 'ไม่มีไฟล์'}; ต้องการ ${wanted.join(', ')}`);
  }
  const forbidden = getForbiddenPaths(touched);
  if (forbidden.length) throw new Error(`ไฟล์ต้องห้ามอยู่ในรายการเผยแพร่: ${forbidden.join(', ')}`);
  const disallowed = touched.filter((file) => !isWebsiteReleaseFile(file));
  if (disallowed.length) throw new Error(`ไฟล์นอกขอบเขตเผยแพร่เว็บไซต์: ${disallowed.join(', ')}`);
  const now = await remoteSha({ remote, branch, repoRoot, runGit });
  if (now !== baseSha) {
    throw new Error(`remote ${branch} เปลี่ยนระหว่างเตรียม (${baseSha.slice(0, 7)} → ${now.slice(0, 7)}) — หยุดแล้วเตรียมใหม่ ห้าม force push`);
  }
  await runGit(['add', '--', ...wanted], { cwd: worktreeDir });
  if (!runGate) throw new Error('ต้องมี runGate สำหรับตรวจ index ก่อน commit');
  try {
    await runGate('scripts/check-repository-safety.mjs', [], worktreeDir);
    await runGate('scripts/check-line-endings.mjs', [], worktreeDir);
  } catch (error) {
    throw new Error(`gate ของไฟล์ที่จะ commit ไม่ผ่าน: ${error.message}`);
  }
  const commitOut = await runGit(['commit', '-m', message], { cwd: worktreeDir });
  return commitOut.trim();
}

// Push the worktree HEAD to the remote branch (fast-forward only — git
// refuses non-ff without --force, which is never passed anywhere here).
export async function pushWorktree({ worktreeDir, repoRoot, remote, branch, baseSha, runGit }) {
  const now = await remoteSha({ remote, branch, repoRoot, runGit });
  if (now !== baseSha) {
    throw new Error(`remote ${branch} เปลี่ยนก่อน push (${baseSha.slice(0, 7)} → ${now.slice(0, 7)}) — หยุดแล้วเตรียมใหม่ ห้าม force push`);
  }
  await runGit(['push', remote, `HEAD:${branch}`], { cwd: worktreeDir });
  return remoteSha({ remote, branch, repoRoot, runGit });
}

// Full run: prepare -> build -> gates -> commit -> push -> live confirm.
export async function deployMenuRelease({ root, dataDir, deps }) {
  const remote = deps.remote || 'origin';
  const branch = deps.branch || 'main';
  const worktreeDir = deps.worktreeDir;
  if (!worktreeDir) throw new Error('ต้องระบุ publish worktree แยกจาก working checkout');
  await saveState(dataDir, { deploy: phaseRecord(null, 'preparing', `เตรียม worktree เผยแพร่จาก ${remote}/${branch}`), error: null });
  let baseSha;
  try {
    ({ baseSha } = await ensurePublishWorktree({ repoRoot: root, dir: worktreeDir, remote, branch, runGit: deps.runGit }));
  } catch (error) {
    await abort(dataDir, error.message);
  }
  await saveState(dataDir, { deploy: phaseRecord(null, 'building', 'สร้างแคตตาล็อก รูป และไฟล์เว็บไซต์จากฐานกลางของแอดมิน', { baseSha }) });
  const central = await deps.loadCentral();
  const now = deps.now();
  let fileVersion;
  try {
    ({ fileVersion } = await buildIntoWorktree({ worktreeDir, central, now, sourceRoot: deps.sourceRoot || root }));
  } catch (error) {
    await saveState(dataDir, { deploy: phaseRecord(null, 'failed', error.message, { baseSha }), error: error.message });
    throw error;
  }
  await saveState(dataDir, { deploy: phaseRecord(null, 'verifying', 'รัน build/gates เว็บไซต์ใน worktree ก่อน commit', { baseSha, fileVersion }) });
  try {
    await verifyWorktreeGates({ worktreeDir, runGate: deps.runGate });
  } catch (error) {
    await abort(dataDir, `${error.message} (baseSha ${baseSha.slice(0, 7)}, fileVersion ${fileVersion})`);
  }
  let release;
  try {
    const changed = await websiteChangedFiles({ worktreeDir, runGit: deps.runGit });
    if (!changed.length) throw new Error('build เว็บไซต์ไม่ทำให้ไฟล์ใดเปลี่ยน — ไม่มีอะไรให้ commit');
    release = await collectWebsiteRelease({ worktreeDir, runGit: deps.runGit, files: changed });
    await saveState(dataDir, {
      file: {
        status: 'staged',
        fileVersion,
        builtAt: now.toISOString(),
        files: release.files.map((file) => file.path),
        hashes: { websiteContent: release.contentHash, websiteFiles: release.files },
      },
      error: null,
    });
  } catch (error) {
    await abort(dataDir, `${error.message} (baseSha ${baseSha.slice(0, 7)}, fileVersion ${fileVersion})`);
  }
  const message = deployCommitMessage(fileVersion, release.files.length);
  await saveState(dataDir, { deploy: phaseRecord(null, 'committing', `commit เฉพาะ ${release.files.length} ไฟล์เผยแพร่`, { baseSha, fileVersion }) });
  let commit;
  try {
    commit = await commitPublishFiles({ worktreeDir, repoRoot: root, remote, branch, baseSha, message, files: release.files.map((file) => file.path), runGit: deps.runGit, runGate: deps.runGate });
  } catch (error) {
    const wrapped = new Error(error.message);
    wrapped.code = error.code || 'EDEPLOYABORTED';
    await saveState(dataDir, { deploy: phaseRecord(null, 'aborted', error.message, { baseSha, fileVersion }), error: error.message });
    throw wrapped;
  }
  await saveState(dataDir, { deploy: phaseRecord(null, 'pushing', `push ${remote}/${branch} (fast-forward เท่านั้น)`, { baseSha, fileVersion, commit }) });
  try {
    await pushWorktree({ worktreeDir, repoRoot: root, remote, branch, baseSha, runGit: deps.runGit });
  } catch (error) {
    const detail = `push ไม่สำเร็จ: ${error.message} — เว็บจริงยังเป็นฉบับเดิม`;
    await saveState(dataDir, { deploy: phaseRecord(null, 'failed', detail, { baseSha, fileVersion, commit }), error: detail });
    throw new Error(detail);
  }
  await saveState(dataDir, { deploy: phaseRecord(null, 'live-checking', 'รอตรวจว่าเว็บจริงให้บริการฉบับนี้แล้ว', { baseSha, fileVersion, commit, pushed: true }) });
  const deadline = deps.now().getTime() + (deps.pollTimeoutMs ?? 10 * 60 * 1000);
  const interval = deps.pollIntervalMs ?? 15000;
  const expectedRelease = { centralVersion: fileVersion, files: release.files, contentHash: release.contentHash };
  for (;;) {
    const live = await deps.verifyLive({ fileVersion, expectedRelease });
    if (live?.state === 'live' && Number(live.liveVersion) === Number(fileVersion)) {
      await saveState(dataDir, { live, deploy: phaseRecord(null, 'live', live.reason, { baseSha, fileVersion, commit, pushed: true, liveConfirmed: true }), error: null });
      return { ok: true, pushed: true, liveConfirmed: true, commit, fileVersion, baseSha, live };
    }
    if (deps.now().getTime() >= deadline) {
      const detail = `push สำเร็จแต่ยังยืนยันเว็บจริงไม่ได้ในเวลาที่รอ — สถานะ “ยังไม่ยืนยัน” ห้ามถือว่าเผยแพร่แล้ว`;
      await saveState(dataDir, {
        live: { ...(live || { state: 'unverified' }), checkedAt: deps.now().toISOString() },
        deploy: phaseRecord(null, 'unverified', detail, { baseSha, fileVersion, commit, pushed: true, liveConfirmed: false }),
        error: null,
      });
      return { ok: true, pushed: true, liveConfirmed: false, commit, fileVersion, baseSha, live, detail };
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

// Production dep wiring lives in the local server (never in the browser).
export function realDeployDeps({ root, sourceRoot = root, worktreeDir, remote = 'origin', branch = 'main', execGit, runGate, fetchImpl = fetch, now = () => new Date(), pollIntervalMs, pollTimeoutMs, liveBaseUrl = 'https://eedhalal.com', loadCentral }) {
  return {
    now, pollIntervalMs, pollTimeoutMs, worktreeDir, remote, branch,
    sourceRoot,
    loadCentral,
    runGit: (args, opts = {}) => execGit(args, opts),
    runGate,
    verifyLive: async ({ fileVersion, expectedRelease }) => {
      const { verifyWebsiteRelease } = await import('./menu-central.mjs');
      return verifyWebsiteRelease({ root: worktreeDir, file: { status: 'staged', fileVersion }, expectedRelease, liveBaseUrl, fetchImpl });
    },
  };
}
