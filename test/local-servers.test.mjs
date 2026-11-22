import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');

test('root starters delegate to the single system launcher, not a static server', async () => {
  // DEPLOY.md names tools/line/start-line.cmd as the one entry point. The root
  // start-server.* files are compatibility aliases for it; they start the whole
  // stack (Internal API + Owner Console + LINE gateway) on 127.0.0.1:8788, not
  // the old standalone admin launcher on 4185.
  for (const file of ['start-server.bat', 'start-server.ps1']) {
    const script = await read(file);
    assert.match(script, /tools[/\\]line[/\\]start-line\.cmd/, `${file} must start the single system launcher`);
    assert.doesNotMatch(script, /127\.0\.0\.1:4185/, `${file} must not document the old admin port`);
    assert.doesNotMatch(script, /tools[/\\]admin[/\\]start-admin\.cmd/, `${file} must not start the old standalone admin launcher`);
    assert.doesNotMatch(script, /http\.server|npx serve/, `${file} must not expose the admin tools through a static server`);
  }
  // The batch alias spells out the loopback address the whole stack now uses.
  assert.match(await read('start-server.bat'), /127\.0\.0\.1:8788/, 'a root starter must document the loopback Internal API address');
});

test('public previews stay on loopback and remain separate from the admin tools', async () => {
  for (const file of ['preview-public.bat', 'preview-public.ps1']) {
    const script = await read(file);
    assert.match(script, /127\.0\.0\.1/, `${file} must bind the preview to loopback only`);
    assert.match(script, /index\.html/, `${file} must open the public website preview`);
    assert.doesNotMatch(script, /4185|8788|start-admin|start-line|menu-central|menu-deploy/, `${file} must not start admin APIs`);
  }
  for (const file of ['preview-public.bat', 'preview-public.ps1']) {
    const script = await read(file);
    assert.match(script, /--bind 127\.0\.0\.1/, `${file}: the Python preview must not listen on every interface`);
    assert.match(script, /tcp:\/\/127\.0\.0\.1:3000/, `${file}: the Node preview must not listen on every interface`);
  }
});
