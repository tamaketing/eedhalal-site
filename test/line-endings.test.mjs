import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function checkLineEndings() {
  const { stdout } = await run(process.execPath, ['scripts/check-line-endings.mjs'], { cwd: process.cwd() });
  return stdout.trim();
}

// A CRLF blob reaches Linux CI as CRLF, which breaks every LF-based generator.
// That has bitten this repository three times (n8n JSON, popular-menu-page,
// the HTML blobs), so the committed tree is now guarded.
test('no tracked text file carries CRLF', async () => {
  const out = await checkLineEndings();
  assert.match(out, /all LF in the index/, out);
});

test('the guard reads the index, not the working tree', async () => {
  // core.autocrlf=true gives a Windows working tree CRLF on purpose, so a check
  // that walked the working tree would fail on every Windows machine and prove
  // nothing. Reading ":path" is what makes this guard meaningful.
  const source = await run('git', ['show', ':scripts/check-line-endings.mjs']).then((r) => r.stdout);
  assert.match(source, /:\$\{file\}/, 'must read the staged blob');
  assert.ok(!/readFile\(file/.test(source), 'must not read the working tree copy');
});

test('the guard is wired into both workflows', async () => {
  for (const file of ['.github/workflows/pages.yml', '.github/workflows/system-data-check.yml']) {
    // Read the staged copy so the check reflects what is about to be committed,
    // matching how the guard itself inspects the index.
    const { stdout } = await run('git', ['show', `:${file}`]);
    assert.match(stdout, /check-line-endings\.mjs/, `${file} must run the line-ending guard`);
  }
});