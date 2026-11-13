import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkPublicSite, listHtml } from '../scripts/check-public-site.mjs';

test('public pages have valid local references and SEO metadata', async () => {
  await checkPublicSite();
});

test('page discovery includes published language/blog pages and excludes local copies', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'eed-public-scope-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pages = ['index.html', 'blog/article.html', 'en/index.html', 'en/blog/article.html',
    'tmp/line-release/index.html', 'node_modules/example/index.html', 'owner-console/index.html'];
  for (const file of pages) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), '<html></html>');
  }
  assert.deepEqual((await listHtml(root)).sort(),
    ['blog/article.html', 'en/blog/article.html', 'en/index.html', 'index.html']);
});
