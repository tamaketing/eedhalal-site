// EED HALAL — admin runtime must carry no secrets or real business data.
//
// Scans the TRACKED backend code (tools/admin, scripts/menu-*). Fixtures in
// test/ are intentionally excluded (synthetic values by design). Real costs,
// phone numbers, tokens, and keys live only in the gitignored data dir.

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_FILES = [
  'tools/admin/server.mjs',
  'tools/admin/menu-central-ui.mjs',
  'tools/admin/app.mjs',
  'tools/admin/launcher.mjs',
  'tools/admin/index.html',
  'tools/admin/cost-planner.css',
  'tools/admin/style.css',
  'tools/admin/README.md',
  'tools/admin/start-admin.cmd',
  'tools/admin/start-admin.ps1',
  'scripts/menu-central.mjs',
  'scripts/menu-deploy.mjs',
  'scripts/menu-backups.mjs',
];

const FORBIDDEN = [
  /sk-(live|test)-[A-Za-z0-9]+/,
  /xox[bap]-/,
  /AKIA[0-9A-Z]{16}/,
  /BEGIN (RSA )?PRIVATE KEY/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /U[0-9a-f]{32}/,
  /0[689]\d-\d{3}-\d{4}/,
  /"phone"\s*:/,
  /"foodCost":\s*\d/,
];

test('tracked admin runtime contains no secrets or real data', async () => {
  const hits = [];
  for (const rel of RUNTIME_FILES) {
    let content = null;
    try {
      content = await readFile(path.join(ROOT, rel), 'utf8');
    } catch {
      hits.push(`${rel}: MISSING (must stay tracked)`);
      continue;
    }
    for (const pattern of FORBIDDEN) {
      const match = content.match(pattern);
      if (match) hits.push(`${rel}: ${pattern} -> ${JSON.stringify(match[0]).slice(0, 60)}`);
    }
  }
  // Private data filenames must never be committed anywhere near the code.
  for (const dir of ['tools/admin', 'scripts', 'data', 'js']) {
    let entries = [];
    try {
      entries = await readdir(path.join(ROOT, dir));
    } catch { continue; }
    for (const name of entries) {
      if (/^(owner-costs|menu-central|.*publish-state).*\.json$|\.bak$|\.tmp$/i.test(name)) {
        hits.push(`${dir}/${name}: private data file must stay gitignored`);
      }
    }
  }
  assert.deepEqual(hits, []);
});
