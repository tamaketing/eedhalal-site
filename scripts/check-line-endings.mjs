import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// CRLF must never reach a committed file.
//
// This has bitten the build three times: n8n workflow JSON failed the CI
// comparison, popular-menu-page failed its own check, and the HTML blobs came
// out CRLF so a Linux checkout served CRLF markup. Every one of them came from
// generating or editing on a Windows working copy.
//
// This inspects the INDEX (git show :path), not the working tree, because
// core.autocrlf=true deliberately gives a Windows working tree CRLF. Checking
// the working tree would fail on every Windows checkout and mean nothing. What
// must stay clean is the blob that gets committed and then checked out on CI.
const exec = promisify(execFile);
const TEXT = /\.(html|md|txt|json|js|mjs|css|xml|svg|csv|yml|yaml)$/i;

const { stdout } = await exec('git', ['ls-files', '-z'], { maxBuffer: 64 * 1024 * 1024 });
const files = stdout.split('\0').filter((f) => f && TEXT.test(f));

const offenders = [];
for (const file of files) {
  let blob;
  try {
    // ":path" reads the staged content, which is what the next commit stores.
    blob = (await exec('git', ['show', `:${file}`], { maxBuffer: 128 * 1024 * 1024, encoding: 'buffer' })).stdout;
  } catch {
    continue; // deleted or renamed in the index
  }
  if (blob.includes(0x0d)) offenders.push(file);
}

if (offenders.length === 0) {
  console.log(`Line endings: ${files.length} tracked text files, all LF in the index.`);
} else {
  console.error(`Line endings: ${offenders.length} of ${files.length} staged text files contain CRLF:`);
  for (const file of offenders.slice(0, 40)) console.error(`  ${file}`);
  if (offenders.length > 40) console.error(`  ...and ${offenders.length - 40} more`);
  console.error('');
  console.error('A CRLF blob reaches CI as CRLF, which breaks the LF-based generators.');
  console.error('Convert each file to LF and re-stage it.');
  process.exit(1);
}