// EED HALAL — deploy-to-web orchestrator (tracked, no secrets).
//
// Completes the flow from the admin backend: verify -> commit ONLY the
// published files -> push with the machine's own git credentials -> confirm
// what GitHub Pages actually serves. No token ever enters the browser; the
// browser only sends {confirm:true} and polls the phase log.
//
// Safety rules (hard):
// - Never commit or push unrelated pending work: `git add` uses an explicit
//   pathspec of exactly DEPLOY_ALLOWLIST, and any OTHER unpushed commits
//   abort the run (pushing would bundle them).
// - Never push files that differ from a fresh pipeline build (hand edits in
//   the published files abort with a reason).
// - Never push with a dirty draft (central ahead of files aborts).
// - Push success is NOT deploy success: only verifyLiveRelease reporting
//   `live` for this file version counts as เผยแพร่แล้ว; otherwise the result
//   stays "ยังไม่ยืนยัน" (pushed:true, liveConfirmed:false).
//
// Deps are injected so tests simulate git/network without touching anything:
//   { runGit: async (args) => stdoutString,
//     verifyLive: async ({fileVersion, attempt}) => liveResult,
//     now: () => Date,
//     pollIntervalMs, pollTimeoutMs, branch, liveBaseUrl }

import {
  assertPublishSafe,
  buildMenuDataJs,
  buildPlannerOverrides,
  diffPublicChanges,
  loadPublished,
  parseMenuDataJs,
  PUBLISH_FILES,
  readPublishState,
  validateCentral,
  verifyLiveRelease,
  writePublishState,
} from './menu-central.mjs';

export const DEPLOY_ALLOWLIST = [...PUBLISH_FILES];

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

// Preflight only (no commit/push). Returns {ok, fileVersion?, reasons[]}.
export async function deployPreflight({ root, dataDir, deps }) {
  const reasons = [];
  void dataDir;
  const central = await deps.loadCentral();
  const validated = validateCentral(central);
  if (!validated.ok) return { ok: false, reasons: [`ฐานกลางไม่ผ่านการตรวจ: ${validated.errors.join(' | ')}`] };
  const published = await loadPublished(root);
  const menuDataMenus = await parseMenuDataJs(published.menuDataJs);
  const diff = diffPublicChanges(
    { ...validated.data, version: central.version ?? 0 },
    { overrides: published.overrides, menuDataMenus },
  );
  if (diff.hasChanges) {
    reasons.push('ฐานกลางยังใหม่กว่าฉบับไฟล์ — กด “ดูตัวอย่างและเผยแพร่” (สร้างไฟล์) ก่อนขึ้นเว็บ');
  }
  // Working-tree files must equal a fresh pipeline build (no hand edits).
  // Compare semantically (timestamps differ per build): strip volatile keys.
  const now = deps.now();
  const strip = (obj) => {
    const copy = JSON.parse(JSON.stringify(obj));
    delete copy.exportedAt;
    if (copy.release) delete copy.release.builtAt;
    return copy;
  };
  const localOverrides = JSON.parse(await deps.readFile('data/planner-overrides.json'));
  const freshParsed = JSON.parse(JSON.stringify(buildPlannerOverrides(
    { ...validated.data, version: central.version ?? 0 }, published.overrides, now,
  )));
  if (JSON.stringify(strip(localOverrides)) !== JSON.stringify(strip(freshParsed))) {
    reasons.push('ไฟล์เผยแพร่ในเครื่องถูกแก้ด้วยมือ (ไม่ตรงฉบับที่ pipeline สร้าง) — สร้างไฟล์ใหม่ก่อนขึ้นเว็บ');
  }
  const localJs = await deps.readFile('js/menu-data.js');
  const freshJs = buildMenuDataJs({ ...validated.data, version: central.version ?? 0 }, now);
  const normJs = (text) => text.replace(/^\/\*.*\*\/\n/, '/*HEADER*/\n');
  if (normJs(localJs) !== normJs(freshJs)) {
    reasons.push('js/menu-data.js ในเครื่องไม่ตรงฉบับที่ pipeline สร้าง — สร้างไฟล์ใหม่ก่อนขึ้นเว็บ');
  }
  try {
    assertPublishSafe({ overrides: localOverrides, menuDataJs: await deps.readFile('js/menu-data.js'), root });
  } catch (error) {
    reasons.push(`ไฟล์เผยแพร่ไม่ผ่านการตรวจ: ${error.message}`);
  }
  // Separation check: other unpushed commits would ride along on push.
  const branch = (await deps.runGit(['branch', '--show-current'])).trim() || 'main';
  let unpushed = '';
  try {
    unpushed = await deps.runGit(['log', '@{u}..HEAD', '--oneline']);
  } catch {
    unpushed = 'UNKNOWN';
  }
  if (unpushed === 'UNKNOWN') {
    reasons.push('ตรวจ unpushed commits ไม่สำเร็จ (ไม่มี upstream หรือ git ขัดข้อง) — หยุดเพื่อความปลอดภัย');
  } else if (unpushed.trim() !== '') {
    reasons.push(`มี commit อื่นรอ push อยู่ (${unpushed.trim().split('\n').length} commit) — push จะพ่วงงานอื่นไปด้วย จึงหยุด`);
  }
  // Report (not block): unrelated pending work stays out of this commit.
  let others = '';
  try {
    const porcelain = await deps.runGit(['status', '--porcelain', '--', ...DEPLOY_ALLOWLIST]);
    void porcelain;
    const full = await deps.runGit(['status', '--porcelain']);
    others = full.split('\n').map((line) => line.trim()).filter(Boolean)
      .filter((line) => !DEPLOY_ALLOWLIST.some((file) => line.endsWith(file)))
      .join('\n');
  } catch { /* best effort report only */ }
  const fileVersion = Number(central.version ?? 0);
  return { ok: reasons.length === 0, fileVersion, branch, unrelatedPending: others, reasons };
}

// Full run: preflight -> commit (allowlist only) -> push -> live confirm.
// Never throws a false success: failures record phase + reason and rethrow.
export async function deployMenuRelease({ root, dataDir, deps }) {
  await saveState(dataDir, { deploy: phaseRecord(null, 'checking', 'ตรวจความพร้อมก่อนขึ้นเว็บ'), error: null });
  const pre = await deployPreflight({ root, dataDir, deps });
  if (!pre.ok) {
    const detail = pre.reasons.join(' | ');
    await saveState(dataDir, { deploy: phaseRecord(null, 'aborted', detail), error: detail });
    const error = new Error(detail);
    error.code = 'EDEPLOYABORTED';
    throw error;
  }
  const { fileVersion, branch } = pre;
  const message = deployCommitMessage(fileVersion);
  await saveState(dataDir, { deploy: phaseRecord(null, 'committing', `commit เฉพาะ ${DEPLOY_ALLOWLIST.join(', ')}`) });
  await deps.runGit(['add', '--', ...DEPLOY_ALLOWLIST]);
  let commit = '';
  try {
    commit = (await deps.runGit(['commit', '-m', message])).trim();
  } catch (error) {
    const detail = `commit ไม่สำเร็จ: ${error.message}`;
    await saveState(dataDir, { deploy: phaseRecord(null, 'failed', detail), error: detail });
    throw new Error(detail);
  }
  await saveState(dataDir, { deploy: phaseRecord(null, 'pushing', `push ${branch} (commit นี้มีเฉพาะไฟล์เผยแพร่)`, { commit }) });
  try {
    await deps.runGit(['push', 'origin', branch]);
  } catch (error) {
    const detail = `push ไม่สำเร็จ: ${error.message} — เว็บจริงยังเป็นฉบับเดิม`;
    await saveState(dataDir, { deploy: phaseRecord(null, 'failed', detail, { commit }), error: detail });
    throw new Error(detail);
  }
  // Push done: now prove the live web serves this release (poll, not assume).
  await saveState(dataDir, { deploy: phaseRecord(null, 'verifying', 'รอตรวจว่าเว็บจริงให้บริการฉบับนี้แล้ว', { commit, pushed: true }) });
  const deadline = deps.now().getTime() + (deps.pollTimeoutMs ?? 10 * 60 * 1000);
  const interval = deps.pollIntervalMs ?? 15000;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const live = await deps.verifyLive({ fileVersion, attempt });
    if (live?.state === 'live' && Number(live.liveVersion) === Number(fileVersion)) {
      await saveState(dataDir, {
        live,
        deploy: phaseRecord(null, 'live', live.reason, { commit, pushed: true, liveConfirmed: true }),
        error: null,
      });
      return { ok: true, pushed: true, liveConfirmed: true, commit, fileVersion, live };
    }
    if (deps.now().getTime() >= deadline) {
      const detail = `push สำเร็จแต่ยังยืนยันเว็บจริงไม่ได้ในเวลาที่รอ (ตรวจ ${attempt} ครั้ง: ${live?.reason || 'no result'}) — สถานะ “ยังไม่ยืนยัน” ห้ามถือว่าเผยแพร่แล้ว`;
      await saveState(dataDir, {
        live: { ...(live || { state: 'unverified' }), checkedAt: deps.now().toISOString() },
        deploy: phaseRecord(null, 'unverified', detail, { commit, pushed: true, liveConfirmed: false }),
        error: null,
      });
      return { ok: true, pushed: true, liveConfirmed: false, commit, fileVersion, live, detail };
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

// Production dep wiring lives in the local server (never in the browser).
export function realDeployDeps({ root, execGit, fetchImpl = fetch, now = () => new Date(), pollIntervalMs, pollTimeoutMs, liveBaseUrl = 'https://eedhalal.com', loadCentral, readFile }) {
  return {
    now, pollIntervalMs, pollTimeoutMs,
    loadCentral,
    readFile: (rel) => readFile(`${root}/${rel}`, 'utf8'),
    runGit: (args) => execGit(args),
    verifyLive: async () => verifyLiveRelease({
      root,
      file: { status: 'staged', fileVersion: (await loadCentral()).version ?? 0 },
      liveBaseUrl, fetchImpl,
    }),
  };
}
