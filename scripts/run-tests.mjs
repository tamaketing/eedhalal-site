// EED HALAL — supplemental test runner (tracked, no secrets).
//
// `node --test --test-concurrency=1` remains the release command. This helper
// only groups the same files for focused runs. `all` always discovers the
// current test directory instead of trusting a frozen list, so a renamed test
// cannot silently stop running. Every category validates that its entries
// exist: a missing file is an error, never a quiet skip.

import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const scriptPath = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(scriptPath), '..');
const TEST_DIR = path.join(ROOT, 'test');
const exec = promisify(execFile);

export const TEST_CATEGORIES = {
  unit: [
    'admin-runtime-clean.test.mjs',
    'business-data-runtime.test.mjs',
    'business-facts-vat.test.mjs',
    'business-sync-manifest.test.mjs',
    'central-database.test.mjs',
    'ci-test-command.test.mjs',
    'customer-runtime.test.mjs',
    'db-contract.test.mjs',
    'draft-send.test.mjs',
    'line-endings.test.mjs',
    'local-servers.test.mjs',
    'mealbox-tiers.test.mjs',
    'menus.test.mjs',
    'menus-api.test.mjs',
    'order-draft.test.mjs',
    'owner-console.test.mjs',
    'response-examples.test.mjs',
    'response-examples-api.test.mjs',
    'run-tests-categories.test.mjs',
    'search-discovery.test.mjs',
    'starting-price.test.mjs',
    'system-rules.test.mjs',
  ],
  integration: [
    'admin-menu-ui.test.mjs',
    'admin-tier-preview.test.mjs',
    'business-content-sync.test.mjs',
    'check-docs.test.mjs',
    'draft-send.test.mjs',
    'inbound-api.test.mjs',
    'inbound-messages.test.mjs',
    'internal-api.test.mjs',
    'menu-backups.test.mjs',
    'menu-central-publish.test.mjs',
    'menu-deploy.test.mjs',
    'menus.test.mjs',
    'menus-api.test.mjs',
    'owner-console.test.mjs',
    'popular-menu-page.test.mjs',
    'popular-menu-tier-link.test.mjs',
    'public-site.test.mjs',
    'repository-safety.test.mjs',
    'response-examples-api.test.mjs',
    'tier-sync-guards.test.mjs',
  ],
  e2e: [
    'browser-smoke.test.mjs',
  ],
  contract: [
    'admin-runtime-clean.test.mjs',
    'business-content-sync.test.mjs',
    'business-facts-vat.test.mjs',
    'business-sync-manifest.test.mjs',
    'check-docs.test.mjs',
    'ci-test-command.test.mjs',
    'line-endings.test.mjs',
    'local-servers.test.mjs',
    'mealbox-tiers.test.mjs',
    'popular-menu-page.test.mjs',
    'public-site.test.mjs',
    'repository-safety.test.mjs',
    'search-discovery.test.mjs',
    'starting-price.test.mjs',
    'system-rules.test.mjs',
    'tier-sync-guards.test.mjs',
  ],
  db: [
    'central-database.test.mjs',
    'db-contract.test.mjs',
    'inbound-postgres.test.mjs',
    'postgres-integration.test.mjs',
    'response-examples-postgres.test.mjs',
  ],
};

export function discoverTestFiles(testDir = TEST_DIR) {
  return fs.readdirSync(testDir)
    .filter((file) => file.endsWith('.test.mjs'))
    .sort();
}

export function filesForCategory(category, testDir = TEST_DIR) {
  const configured = TEST_CATEGORIES[category];
  if (!configured) throw new Error(`Unknown category: ${category}. Available: ${Object.keys(TEST_CATEGORIES).join(', ')} or "all"`);
  const missing = configured.filter((file) => !fs.existsSync(path.join(testDir, file)));
  if (missing.length) {
    throw new Error(`Test category "${category}" references missing file(s): ${missing.join(', ')}`);
  }
  return [...new Set(configured)];
}

export function categoryCoverage(testDir = TEST_DIR) {
  const actual = discoverTestFiles(testDir);
  const covered = new Set(Object.values(TEST_CATEGORIES).flat());
  return {
    actual,
    covered: [...covered].sort(),
    uncovered: actual.filter((file) => !covered.has(file)),
  };
}

function parseTap(output) {
  const count = (label) => {
    const match = output.match(new RegExp(`^# ${label} (\\d+)`, 'm'));
    return match ? Number(match[1]) : 0;
  };
  return { passed: count('pass'), failed: count('fail'), skipped: count('skipped') };
}

export async function runTestFiles(label, files) {
  const unique = [...new Set(files)];
  if (!unique.length) {
    console.log(`[${label}] No test files found, skipping`);
    return { passed: 0, failed: 0, skipped: 0 };
  }
  console.log(`[${label}] Running ${unique.length} test file(s) serially...`);
  const args = ['--test', '--test-concurrency=1', '--test-reporter=tap', ...unique.map((file) => `test/${file}`)];
  try {
    const { stdout } = await exec(process.execPath, args, {
      cwd: ROOT,
      maxBuffer: 256 * 1024 * 1024,
      timeout: 300000,
    });
    return parseTap(stdout);
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}`;
    const parsed = parseTap(output);
    const failed = parsed.failed > 0 ? parsed.failed : 1;
    console.error(`[${label}] test command failed before reporting TAP results (exit ${error.code ?? 'unknown'})`);
    if (output.trim()) console.error(output.slice(-8000));
    return { ...parsed, failed };
  }
}

export async function main(argv = process.argv.slice(2)) {
  const category = argv[0];
  if (!category) {
    console.log('Usage: node scripts/run-tests.mjs <category>');
    console.log('Categories:', [...Object.keys(TEST_CATEGORIES), 'all'].join(', '));
    process.exitCode = 1;
    return { passed: 0, failed: 1, skipped: 0 };
  }
  const files = category === 'all' ? discoverTestFiles() : filesForCategory(category);
  const result = await runTestFiles(category, files);
  console.log(`[${category}] Passed: ${result.passed}, Failed: ${result.failed}, Skipped: ${result.skipped}`);
  if (result.failed > 0) process.exitCode = 1;
  return result;
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  await main();
}
