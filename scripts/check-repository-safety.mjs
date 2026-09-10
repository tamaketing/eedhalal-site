import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const FORBIDDEN_PATHS = [
  /^tmp-chrome-profile\//,
  /^tmp-.*\.png$/,
  /^leads\/(?!\.gitkeep$)/,
  /^line-ai\/execution-[^/]+\.json$/,
  /^line-ai\/[^/]*workflow-export[^/]*\.json$/,
  /^line-ai\/.*\.(?:sqlite|db|log)$/,
  /^\.env(?!\.example$)(?:\..+)?$/,
];

export function getForbiddenPaths(paths) {
  return paths.filter((file) => FORBIDDEN_PATHS.some((pattern) => pattern.test(file)));
}

async function getTrackedPaths() {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z']);
  const tracked = stdout.split('\0').filter(Boolean);
  const existing = await Promise.all(tracked.map(async (file) => {
    try {
      await access(path.resolve(file), constants.F_OK);
      return file;
    } catch {
      return null;
    }
  }));
  return existing.filter(Boolean);
}

async function main() {
  const forbidden = getForbiddenPaths(await getTrackedPaths());
  assert.deepEqual(
    forbidden,
    [],
    `Remove sensitive or generated files from Git:\n${forbidden.join('\n')}`,
  );
  console.log('Repository safety check passed.');
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  await main();
}
