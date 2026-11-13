import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Several suites temporarily rewrite repository files to prove that drift is
// caught. Parallel test files can therefore read a file while another suite
// has not restored it yet. Both CI entry points must run the same serialized
// command as the local release checklist.
for (const file of ['.github/workflows/pages.yml', '.github/workflows/system-data-check.yml']) {
  test(`${file} runs tests serially`, async () => {
    const workflow = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const commands = [...workflow.matchAll(/node --test[^\n]*/g)].map((match) => match[0]);
    assert.ok(commands.length > 0, `${file} must run the test suite`);
    for (const command of commands) {
      assert.ok(
        command.includes('--test-concurrency=1'),
        `${file} must serialize test files (${command.trim()})`,
      );
      assert.ok(command.includes('"test/*.test.mjs"'), `${file} must exclude temporary test copies`);
      assert.ok(command.includes('"tools/**/*.test.mjs"'), `${file} must retain tool tests`);
    }
  });
}

test('npm test serializes the same project-only suite', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.test, 'node --test --test-concurrency=1 "test/*.test.mjs" "tools/**/*.test.mjs"');
});
