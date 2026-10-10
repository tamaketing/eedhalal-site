import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  CONTROL_DOCS,
  REQUIRED_ANCHORS,
  checkDocs,
  extractDocLinks,
  isMainModule,
} from '../scripts/check-docs.mjs';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CHECKER = path.join(HERE, '..', 'scripts', 'check-docs.mjs');

async function runChecker(dir, useDirAsRoot = false) {
  const args = useDirAsRoot ? [CHECKER, dir] : [CHECKER];
  try {
    const { stdout } = await run(process.execPath, args, { cwd: dir, timeout: 30000 });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.code, stdout: error.stdout || '', stderr: error.stderr || '' };
  }
}

async function writeValidDocs(dir, overrides = {}) {
  for (const doc of CONTROL_DOCS) {
    const anchors = [...(REQUIRED_ANCHORS[doc] || [])];
    if (doc === 'tools/admin/README.md') anchors.unshift('# EED HALAL admin manual');
    const body = overrides[doc] !== undefined ? overrides[doc] : `${anchors.join('\n')}\n`;
    const file = path.join(dir, ...doc.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body, 'utf8');
  }
}

test('doc links resolve parent-relative paths and drop fragments', () => {
  assert.deepEqual(extractDocLinks('See [deploy](../../DEPLOY.md) and [sync](FACTS.md#targets).'), [
    '../../DEPLOY.md',
    'FACTS.md',
  ]);
});

test('external, mail, anchor-only, code-span, and image links are ignored', () => {
  assert.deepEqual(
    extractDocLinks(
      'Docs [web](https://eedhalal.com/llms.txt) [mail](mailto:a@b.c) [top](#intro) ' +
        '`[fake](missing.md)` ![shot](img/a.png) end.',
    ),
    [],
  );
});

test('importing the checker never runs its docs scan', () => {
  assert.equal(isMainModule(), false);
});

test('direct execution on absolute and relative paths is detected the same way', () => {
  assert.equal(isMainModule(CHECKER), true);
  assert.equal(isMainModule(path.join('scripts', 'check-docs.mjs')), true);
});

test('a missing control document fails with its file name', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'eed-docs-'));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  await writeValidDocs(dir);
  await rm(path.join(dir, 'FACTS.md'));
  const { failures } = await checkDocs(dir);
  assert.match(failures.join('\n'), /FACTS\.md: control document is missing/);
});

test('a missing anchor fails with the anchor text', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'eed-docs-'));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  await writeValidDocs(dir, { 'AGENTS.md': '## Something Else\n' });
  const { failures } = await checkDocs(dir);
  assert.match(failures.join('\n'), /AGENTS\.md: required anchor is missing: ## Document Responsibilities/);
});

test('a dead cross-document link fails with the link target', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'eed-docs-'));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  await writeValidDocs(dir, { 'FACTS.md': 'See [gone](gone-doc.md) and data/sync-manifest.json data/business-rules.json\n' });
  const { failures } = await checkDocs(dir);
  assert.match(failures.join('\n'), /FACTS\.md: dead link \(missing\): gone-doc\.md/);
});

test('the checker passes on the real repository root', async () => {
  const result = await runChecker(ROOT);
  assert.equal(result.code, 0, `checker must pass on the repo root:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Docs OK: 4 control documents/);
});

test('a broken link fails direct execution with a nonzero status', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'eed-docs-'));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  await writeValidDocs(dir, { 'DEPLOY.md': 'See [gone](gone-doc.md). EED_ALLOW_GIT_DEPLOY=1\n' });
  const result = await runChecker(dir, true);
  assert.notEqual(result.code, 0, 'a dead doc link must fail the docs gate');
  assert.match(`${result.stdout}\n${result.stderr}`, /gone-doc\.md/);
});
