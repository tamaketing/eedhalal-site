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

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertPublishSafe,
  buildMenuDataJs,
  buildPlannerOverrides,
  loadPublished,
  PUBLISH_FILES,
  readPublishState,
  validateCentral,
  writePublishState,
} from './menu-central.mjs';

export const DEPLOY_ALLOWLIST = [...PUBLISH_FILES];
export const WORKTREE_MARKER = '.eed-publish-worktree';

export function deployCommitMessage(fileVersion) {
  return `chore(menus): publish central v${fileVersion} to web`;
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
export async function buildIntoWorktree({ worktreeDir, central, now }) {
  const validated = validateCentral(central);
  if (!validated.ok) throw new Error(`ฐานกลางไม่ผ่านการตรวจ: ${validated.errors.join(' | ')}`);
  const clean = { ...validated.data, version: central.version ?? 0, updatedAt: central.updatedAt ?? null };
  const current = await loadPublished(worktreeDir);
  const overrides = buildPlannerOverrides(clean, current.overrides, now);
  const menuDataJs = buildMenuDataJs(clean, now);
  assertPublishSafe({ overrides, menuDataJs, root: worktreeDir });
  await writeFile(path.join(worktreeDir, 'data', 'planner-overrides.json'), `${JSON.stringify(overrides, null, 2)}\n`, 'utf8');
  await writeFile(path.join(worktreeDir, 'js', 'menu-data.js'), menuDataJs, 'utf8');
  const diskOverrides = JSON.parse(await readFile(path.join(worktreeDir, 'data', 'planner-overrides.json'), 'utf8'));
  const diskJs = await readFile(path.join(worktreeDir, 'js', 'menu-data.js'), 'utf8');
  assertPublishSafe({ overrides: diskOverrides, menuDataJs: diskJs, root: worktreeDir });
  return { fileVersion: clean.version, overrides, menuDataJs };
}

// Gates that must pass INSIDE the worktree before anything is committed.
export const WORKTREE_GATES = [
  { cmd: 'scripts/check-system.mjs', args: [] },
  { cmd: 'scripts/check-public-site.mjs', args: [] },
  { cmd: '--test', args: ['test/menu-central-publish.test.mjs', 'test/menu-deploy.test.mjs', 'test/menu-backups.test.mjs', 'test/admin-logic.test.mjs', 'test/admin-runtime-clean.test.mjs'] },
];

export async function verifyWorktreeGates({ worktreeDir, runGate }) {
  for (const gate of WORKTREE_GATES) {
    try {
      await runGate(gate.cmd, gate.args, worktreeDir);
    } catch (error) {
      throw new Error(`gate ไม่ผ่านใน worktree (${gate.cmd}): ${error.message}`);
    }
  }
}

// Commit ONLY the allowlist. Aborts when the worktree holds anything else
// uncommitted, or when the remote moved since prepare.
export async function commitPublishFiles({ worktreeDir, repoRoot, remote, branch, baseSha, message, runGit }) {
  const full = await runGit(['status', '--porcelain'], { cwd: worktreeDir });
  const touched = full.split('\n').map((line) => line.trim()).filter(Boolean)
    .filter((line) => !DEPLOY_ALLOWLIST.some((file) => line.endsWith(file)) && !line.endsWith(WORKTREE_MARKER));
  if (touched.length) throw new Error(`worktree มีไฟล์อื่นปนนอกเหนือจากไฟล์เผยแพร่: ${touched.join(', ')}`);
  const now = await remoteSha({ remote, branch, repoRoot, runGit });
  if (now !== baseSha) {
    throw new Error(`remote ${branch} เปลี่ยนระหว่างเตรียม (${baseSha.slice(0, 7)} → ${now.slice(0, 7)}) — หยุดแล้วเตรียมใหม่ ห้าม force push`);
  }
  await runGit(['add', '--', ...DEPLOY_ALLOWLIST], { cwd: worktreeDir });
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
  await saveState(dataDir, { deploy: phaseRecord(null, 'building', 'สร้างไฟล์สาธารณะจากฐานกลางของแอดมิน', { baseSha }) });
  const central = await deps.loadCentral();
  const now = deps.now();
  let fileVersion;
  try {
    ({ fileVersion } = await buildIntoWorktree({ worktreeDir, central, now }));
  } catch (error) {
    await saveState(dataDir, { deploy: phaseRecord(null, 'failed', error.message, { baseSha }), error: error.message });
    throw error;
  }
  await saveState(dataDir, { deploy: phaseRecord(null, 'verifying', 'รัน gates ใน worktree ก่อน commit', { baseSha, fileVersion }) });
  try {
    await verifyWorktreeGates({ worktreeDir, runGate: deps.runGate });
  } catch (error) {
    await abort(dataDir, `${error.message} (baseSha ${baseSha.slice(0, 7)}, fileVersion ${fileVersion})`);
  }
  const message = deployCommitMessage(fileVersion);
  await saveState(dataDir, { deploy: phaseRecord(null, 'committing', `commit เฉพาะ ${DEPLOY_ALLOWLIST.join(', ')}`, { baseSha, fileVersion }) });
  let commit;
  try {
    commit = await commitPublishFiles({ worktreeDir, repoRoot: root, remote, branch, baseSha, message, runGit: deps.runGit });
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
  for (;;) {
    const live = await deps.verifyLive({ fileVersion });
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
export function realDeployDeps({ root, worktreeDir, remote = 'origin', branch = 'main', execGit, runGate, fetchImpl = fetch, now = () => new Date(), pollIntervalMs, pollTimeoutMs, liveBaseUrl = 'https://eedhalal.com', loadCentral }) {
  return {
    now, pollIntervalMs, pollTimeoutMs, worktreeDir, remote, branch,
    loadCentral,
    runGit: (args, opts = {}) => execGit(args, opts),
    runGate,
    verifyLive: async ({ fileVersion }) => {
      const { verifyLiveRelease } = await import('./menu-central.mjs');
      return verifyLiveRelease({ root: worktreeDir, file: { status: 'staged', fileVersion }, liveBaseUrl, fetchImpl });
    },
  };
}
