import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const scriptPath = fileURLToPath(import.meta.url);
console.log('DEBUG: scriptPath:', scriptPath);
console.log('DEBUG: import.meta.url:', import.meta.url);

const ROOT = path.resolve(path.dirname(scriptPath), '..');
const TEST_DIR = path.join(ROOT, 'test');
console.log('DEBUG: ROOT:', ROOT);
console.log('DEBUG: TEST_DIR:', TEST_DIR);

import fs from 'node:fs';
console.log('DEBUG: Exists admin-logic:', fs.existsSync(path.join(TEST_DIR, 'admin-logic.test.mjs')));

const exec = promisify(execFile);

const TEST_CATEGORIES = {
  unit: [
    'admin-logic.test.mjs',
    'admin-runtime-clean.test.mjs',
    'business-facts-vat.test.mjs',
    'business-sync-manifest.test.mjs',
    'central-database.test.mjs',
    'customer-runtime.test.mjs',
    'db-contract.test.mjs',
    'inbound-messages.test.mjs',
    'line-endings.test.mjs',
    'line-human-approval.test.mjs',
    'line-operations.test.mjs',
    'line-push-provider.test.mjs',
    'menu-backups.test.mjs',
    'menu-context.test.mjs',
    'menu-intent.test.mjs',
    'order-draft.test.mjs',
    'response-examples.test.mjs',
    'response-examples-api.test.mjs',
    'response-examples-postgres.test.mjs',
    'starting-price.test.mjs',
    'system-rules.test.mjs',
    'line-human-approval.test.mjs',
    'line-operations.test.mjs',
    'line-push-provider.test.mjs',
  ],
  integration: [
    'admin-menu-ui.test.mjs',
    'bulk-costs.test.mjs',
    'inbound-api.test.mjs',
    'inbound-postgres.test.mjs',
    'internal-api.test.mjs',
    'menus-api.test.mjs',
    'menus.test.mjs',
    'menu-central-publish.test.mjs',
    'menu-deploy.test.mjs',
    'menu-intent.test.mjs',
    'order-draft.test.mjs',
    'persist-e2e.test.mjs',
    'response-examples.test.mjs',
    'response-examples-api.test.mjs',
    'response-examples-postgres.test.mjs',
    'system-rules.test.mjs',
    'workflow-b25-candidate.test.mjs',
    'workflow-b25-chain.test.mjs',
    'workflow-persist.test.mjs',
  ],
  e2e: [
    'browser-smoke.test.mjs',
    'line-push-provider.test.mjs',
    'line-operations.test.mjs',
    'start-bot.test.mjs',
    'workflow-b25-candidate.test.mjs',
    'workflow-b25-chain.test.mjs',
    'workflow-persist.test.mjs',
  ],
  contract: [
    'business-content-sync.test.mjs',
    'business-sync-manifest.test.mjs',
    'business-facts-vat.test.mjs',
    'line-endings.test.mjs',
    'starting-price.test.mjs',
    'check-line-endings.test.mjs',
    'check-public-site.test.mjs',
    'popular-menu-page.test.mjs',
    'check-public-site.test.mjs',
    'check-system.test.mjs',
    'check-repository-safety.test.mjs',
    'check-business-sync.test.mjs',
    'check-starting-price.test.mjs',
  ],
  db: [
    'inbound-postgres.test.mjs',
    'response-examples-postgres.test.mjs',
    'postgres-integration.test.mjs',
    'db-contract.test.mjs',
  ],
};

async function runCategory(category, files) {
  const existingFiles = files.filter(f => {
    try {
      return fs.existsSync(path.join(TEST_DIR, f));
    } catch {
      return false;
    }
  });
  
  if (existingFiles.length === 0) {
    console.log(`[${category}] No test files found, skipping`);
    return { passed: 0, failed: 0, skipped: 0 };
  }
  
  console.log(`[${category}] Running ${existingFiles.length} test files...`);
  
  try {
    const { stdout } = await exec('node', ['--test', '--test-reporter=tap', ...existingFiles.map(f => `test/${f}`)], {
      cwd: ROOT,
      maxBuffer: 256 * 1024 * 1024,
      timeout: 300000,
    });
    const passMatch = stdout.match(/# pass (\d+)/);
    const failMatch = stdout.match(/# fail (\d+)/);
    const skipMatch = stdout.match(/# skipped (\d+)/);
    const passed = passMatch ? parseInt(passMatch[1]) : 0;
    const failed = failMatch ? parseInt(failMatch[1]) : 0;
    const skipped = skipMatch ? parseInt(skipMatch[1]) : 0;
    return { passed, failed, skipped };
  } catch (error) {
    const output = (error.stdout || '') + (error.stderr || '');
    const passMatch = output.match(/# pass (\d+)/);
    const failMatch = output.match(/# fail (\d+)/);
    const skipMatch = output.match(/# skipped (\d+)/);
    const passed = passMatch ? parseInt(passMatch[1]) : 0;
    const failed = failMatch ? parseInt(failMatch[1]) : 0;
    const skipped = skipMatch ? parseInt(skipMatch[1]) : 0;
    return { passed, failed, skipped };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const category = args[0];
  
  if (!category) {
    console.log('Usage: node scripts/run-tests.mjs <category>');
    console.log('Categories:', Object.keys(TEST_CATEGORIES).join(', '), 'or "all"');
    process.exit(1);
  }
  
  if (category === 'all') {
    let totalPassed = 0, totalFailed = 0, totalSkipped = 0;
    for (const [category, files] of Object.entries(TEST_CATEGORIES)) {
      const result = await runCategory(category, files);
      console.log(`[${category}] Passed: ${result.passed}, Failed: ${result.failed}, Skipped: ${result.skipped}`);
      if (result.failed > 0) process.exitCode = 1;
    }
  } else if (TEST_CATEGORIES[category]) {
    const result = await runCategory(category, TEST_CATEGORIES[category]);
    console.log(`[${category}] Passed: ${result.passed}, Failed: ${result.failed}, Skipped: ${result.skipped}`);
    if (result.failed > 0) process.exitCode = 1;
  } else {
    console.error(`Unknown category: ${category}`);
    console.log('Available:', Object.keys(TEST_CATEGORIES).join(', '));
    process.exit(1);
  }
}

main().catch(console.error);