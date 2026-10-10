import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');

test('root starters delegate to the local admin launcher, not a static server', async () => {
  for (const file of ['start-server.bat', 'start-server.ps1']) {
    const script = await read(file);
    assert.match(script, /tools[/\\]admin[/\\]start-admin\.cmd/, `${file} must start the admin API launcher`);
    assert.match(script, /127\.0\.0\.1:4185/, `${file} must document the loopback admin address`);
    assert.doesNotMatch(script, /http\.server|npx serve/, `${file} must not expose the admin tools through a static server`);
  }
});

test('public previews stay on loopback and remain separate from the admin tools', async () => {
  for (const file of ['preview-public.bat', 'preview-public.ps1']) {
    const script = await read(file);
    assert.match(script, /127\.0\.0\.1/, `${file} must bind the preview to loopback only`);
    assert.match(script, /index\.html/, `${file} must open the public website preview`);
    assert.doesNotMatch(script, /4185|start-admin|menu-central|menu-deploy/, `${file} must not start admin APIs`);
  }
  for (const file of ['preview-public.bat', 'preview-public.ps1']) {
    const script = await read(file);
    assert.match(script, /--bind 127\.0\.0\.1/, `${file}: the Python preview must not listen on every interface`);
    assert.match(script, /tcp:\/\/127\.0\.0\.1:3000/, `${file}: the Node preview must not listen on every interface`);
  }
});
