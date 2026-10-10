import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { getForbiddenPaths, isMainModule } from '../scripts/check-repository-safety.mjs';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.join(HERE, '..', 'scripts', 'check-repository-safety.mjs');

async function git(dir, ...args) {
  await run('git', args, { cwd: dir, timeout: 30000 });
}

async function runChecker(dir) {
  try {
    const { stdout } = await run(process.execPath, [CHECKER], { cwd: dir, timeout: 30000 });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.code, stdout: error.stdout || '', stderr: error.stderr || '' };
  }
}

test('repository safety rules reject sensitive and generated paths', () => {
  assert.deepEqual(
    getForbiddenPaths([
      'execution-46.json',
      'live-workflow-export.json',
      'leads/customer.json',
      'tmp-chrome-profile/Default/History',
      'tmp-popular-menu-screen.png',
      '.env.production',
    ]),
    [
      'execution-46.json',
      'live-workflow-export.json',
      'leads/customer.json',
      'tmp-chrome-profile/Default/History',
      'tmp-popular-menu-screen.png',
      '.env.production',
    ],
  );
});

test('repository safety rules allow source and generated data required for deployment', () => {
  assert.deepEqual(
    getForbiddenPaths([
      'data/business-rules.json',
      'data/rich-menu.json',
      'scripts/check-system.mjs',
      '.env.example',
    ]),
    [],
  );
});

test('importing the checker never runs its repository scan', () => {
  assert.equal(isMainModule(), false);
});

test('direct execution on Linux and Windows paths is detected the same way', () => {
  assert.equal(isMainModule(CHECKER), true);
  assert.equal(isMainModule(path.join('scripts', 'check-repository-safety.mjs')), true);
});

test('a forbidden staged file fails direct execution with a nonzero status', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'eed-safety-'));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  await git(dir, 'init');
  await writeFile(path.join(dir, '.env.production'), 'secret\n', 'utf8');
  await git(dir, 'add', '.env.production');
  const result = await runChecker(dir);
  assert.notEqual(result.code, 0, 'a sensitive staged file must fail the safety gate');
  assert.match(`${result.stdout}\n${result.stderr}`, /\.env\.production/);
});

test('a clean repository passes direct execution', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'eed-safety-'));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  await git(dir, 'init');
  const result = await runChecker(dir);
  assert.equal(result.code, 0, `a clean repository must pass: ${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Repository safety check passed/);
});
