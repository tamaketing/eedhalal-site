import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const FORBIDDEN_PATHS = [
  /^tmp-chrome-profile\//,
  /^tmp-.*\.png$/,
  /^leads\/(?!\.gitkeep$)/,
  // Runtime dumps and process logs must never be committed, wherever they land.
  /[^/]*workflow-export[^/]*\.json$/,
  /execution-[^/]+\.json$/,
  /.*\.(?:sqlite|db|log)$/,
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

// process.argv[1] is a filesystem path, while import.meta.url is a file URL.
// Comparing them as strings only works when both already use the same
// platform's separators. Resolve through pathToFileURL so direct execution is
// detected on Windows, macOS and Linux when this module is imported by tests.
export function isMainModule(invokedPath = process.argv[1]) {
  if (!invokedPath) return false;
  try {
    return pathToFileURL(path.resolve(invokedPath)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  await main();
}
