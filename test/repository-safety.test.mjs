import assert from 'node:assert/strict';
import test from 'node:test';
import { getForbiddenPaths } from '../scripts/check-repository-safety.mjs';

test('repository safety rules reject sensitive and generated paths', () => {
  assert.deepEqual(
    getForbiddenPaths([
      'line-ai/execution-46.json',
      'line-ai/live-workflow-export.json',
      'leads/customer.json',
      'tmp-chrome-profile/Default/History',
      'tmp-popular-menu-screen.png',
      '.env.production',
    ]),
    [
      'line-ai/execution-46.json',
      'line-ai/live-workflow-export.json',
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
      'line-ai/knowledge-pack.md',
      'line-ai/n8n-workflow.json',
      'scripts/check-system.mjs',
      '.env.example',
    ]),
    [],
  );
});
