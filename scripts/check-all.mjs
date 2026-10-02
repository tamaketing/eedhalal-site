// Consolidated validation runner - runs all checks sequentially
// Replaces individual check-* scripts with a single entry point
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exec = promisify(execFile);

const CHECKS = [
  {
    name: 'repository-safety',
    script: 'scripts/check-repository-safety.mjs',
    args: [],
  },
  {
    name: 'line-endings',
    script: 'scripts/check-line-endings.mjs',
    args: [],
  },
  {
    name: 'starting-price',
    script: 'scripts/check-starting-price.mjs',
    args: [],
  },
  {
    name: 'popular-menu-page',
    script: 'scripts/popular-menu-page.mjs',
    args: ['--check'],
  },
  {
    name: 'business-sync',
    script: 'scripts/check-business-sync.mjs',
    args: ['--check'],
  },
  {
    name: 'system',
    script: 'scripts/check-system.mjs',
    args: [],
  },
  {
    name: 'public-site',
    script: 'scripts/check-public-site.mjs',
    args: [],
  },
  {
    name: 'sync-business-content',
    script: 'scripts/sync-business-content.mjs',
    args: ['--check'],
  },
];

async function runCheck(check) {
  const scriptPath = path.join(ROOT, check.script);
  const start = Date.now();
  try {
    const { stdout, stderr } = await exec('node', [scriptPath, ...check.args], {
      cwd: ROOT,
      maxBuffer: 256 * 1024 * 1024,
      timeout: 120000,
    });
    const duration = Date.now() - start;
    return { name: check.name, ok: true, duration, output: stdout.trim() };
  } catch (error) {
    const duration = Date.now() - start;
    const output = (error.stdout || '') + (error.stderr || '');
    return { name: check.name, ok: false, duration, output: output.trim(), error };
  }
}

async function main() {
  console.log('=== Running all validation checks ===\n');
  const results = [];
  let hasFailure = false;

  for (const check of CHECKS) {
    process.stdout.write(`[${check.name}] `);
    const result = await runCheck(check);
    results.push(result);
    
    if (result.ok) {
      console.log(`✓ (${result.duration}ms)`);
    } else {
      console.log(`✗ (${result.duration}ms) FAILED`);
      hasFailure = true;
      console.error(`\n--- ${result.name} FAILED ---`);
      console.error(result.output);
    }
  }

  console.log('\n=== Summary ===');
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  console.log(`Total: ${CHECKS.length} checks | Passed: ${passed} | Failed: ${failed} | Time: ${totalDuration}ms`);

  if (hasFailure) {
    console.error('\n❌ Some checks failed. Fix the issues above before committing.');
    process.exit(1);
  } else {
    console.log('\n✅ All checks passed!');
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});