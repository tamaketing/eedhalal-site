// Run the project checks and report only what is broken.
//
//   node tools/agent/checks.mjs            compact human list of problems
//   node tools/agent/checks.mjs --json     {ok, failures[]} for a program
//
// The full check output is thousands of tokens of progress lines the reader does
// not need. This prints one line per problem, so an agent can act on it without
// pulling the whole log into its context.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CHECKS } from '../../scripts/check-all.mjs';

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

export const MAX_PROBLEMS_PER_CHECK = 25;

// A line worth showing: it names a file, or it says something is missing/stale.
// The colon after the filename is not required — "popular-menu.html lists 30
// dishes but the catalogue has 26" is the most useful line that check prints,
// and demanding "file:line" threw it away.
const PROBLEM_HINT = /\.(?:html|json|js|mjs|md|txt|xml|csv|css|jpg|png)\b/i;
const PROBLEM_WORD = /\b(missing|stale|out of sync|mismatch|mismatched|failed|failure|not found|unknown|duplicate|invalid|non-indexable|does not|must be|expected)\b/i;

// Node prints `file:///path.mjs:260` plus the source line before the message
// itself. Both read like a file:line problem but say nothing about what broke,
// so a report built from them left the reader with no cause at all.
const STACK_FRAME = /^(?:file:\/\/\/|at\s)/;

export function extractProblems(output = '', limit = MAX_PROBLEMS_PER_CHECK) {
  const seen = new Set();
  const problems = [];
  for (const rawLine of String(output).split('\n')) {
    const line = rawLine.trim().replace(/^[-+]\s*/, '').replace(/^'|',?$/g, '').trim();
    if (!line) continue;
    if (line.startsWith('at ') || line.startsWith('code:') || line.startsWith('^')) continue;
    if (STACK_FRAME.test(line)) continue;
    if (!PROBLEM_HINT.test(line) && !PROBLEM_WORD.test(line)) continue;
    if (line.length > 300) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    problems.push(line);
    if (problems.length >= limit) break;
  }
  return problems;
}

async function runCheck(check, timeoutMs = 120000) {
  const started = Date.now();
  try {
    const { stdout } = await exec('node', [path.join(ROOT, check.script), ...check.args], {
      cwd: ROOT,
      maxBuffer: 256 * 1024 * 1024,
      timeout: timeoutMs,
    });
    return { name: check.name, ok: true, ms: Date.now() - started, problems: [], raw: stdout };
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`;
    const problems = extractProblems(output);
    return {
      name: check.name,
      ok: false,
      ms: Date.now() - started,
      problems: problems.length ? problems : ['ตรวจไม่ผ่าน แต่แยกสาเหตุไม่ได้ — รันสคริปต์นั้นตรงๆ เพื่อดูรายละเอียด'],
      raw: output,
    };
  }
}

export async function runChecks({ timeoutMs } = {}) {
  const results = [];
  for (const check of CHECKS) {
    results.push(await runCheck(check, timeoutMs));
  }
  const failures = results.filter((result) => !result.ok);
  return {
    ok: failures.length === 0,
    total: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    results: results.map(({ raw, ...rest }) => rest),
    failures: failures.flatMap((result) => result.problems.map((problem) => ({ check: result.name, problem }))),
  };
}

function render(report) {
  if (report.ok) return `ตรวจทั้ง ${report.total} รายการ ผ่านทั้งหมด`;
  const lines = [
    `ตรวจ ${report.total} รายการ — ผ่าน ${report.passed} ไม่ผ่าน ${report.failed}`,
    'ต้องแก้ (ไฟล์: ปัญหา)',
  ];
  let current = '';
  for (const failure of report.failures) {
    if (failure.check !== current) {
      current = failure.check;
      lines.push(`[${current}]`);
    }
    lines.push(`  ${failure.problem}`);
  }
  lines.push('');
  lines.push('รายละเอียดเต็ม: node scripts/check-all.mjs');
  return lines.join('\n');
}

async function main() {
  const report = await runChecks();
  const wantsJson = process.argv.includes('--json');
  process.stdout.write(`${wantsJson ? JSON.stringify(report, null, 2) : render(report)}\n`);
  if (!report.ok && !wantsJson) process.exitCode = 1;
}

if (isCli) {
  main().catch((error) => {
    process.stderr.write(`ตรวจไม่สำเร็จ: ${error.message}\n`);
    process.exitCode = 1;
  });
}