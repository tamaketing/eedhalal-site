import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = JSON.parse(await readFile(path.join(ROOT, 'data/business-rules.json'), 'utf8'));
export const thaiDelivery = rules.delivery.messageTh;
export const englishDelivery = rules.delivery.messageEn;

// Only explicitly marked generated sections may be rewritten. This prevents a
// policy sync from modifying unrelated prose, JSON, or structured data.
const targets = [
  ['faq.html', 'TH', thaiDelivery], ['en/faq.html', 'EN', englishDelivery],
];

function marker(language) {
  return language === 'TH'
    ? '<!-- BUSINESS-RULES:DELIVERY:TH -->'
    : '<!-- BUSINESS-RULES:DELIVERY:EN -->';
}

export function synchronize(source, language, expected) {
  const start = marker(language);
  const end = '<!-- /BUSINESS-RULES:DELIVERY -->';
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt);
  if (startAt < 0 || endAt < 0 || source.indexOf(start, startAt + start.length) >= 0) {
    throw new Error(`expected one ${start} section`);
  }
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const replacement = `${start}${eol}${expected}${eol}${end}`;
  return source.slice(0, startAt) + replacement + source.slice(endAt + end.length);
}

export async function syncBusinessContent({ check = false, dryRun = false } = {}) {
  if (check && dryRun) throw new Error('Use either --check or --dry-run, not both.');
  const changes = [];
  for (const [file, language, expected] of targets) {
    const absolute = path.join(ROOT, file);
    const source = await readFile(absolute, 'utf8');
    const next = synchronize(source, language, expected);
    if (next !== source) changes.push({ file, next });
  }
  if (check) {
    if (changes.length) throw new Error(`Business content is out of sync: ${changes.map(({ file }) => file).join(', ')}`);
    console.log('Business content is synchronized.');
    return changes;
  }
  if (dryRun) {
    changes.forEach(({ file }) => console.log(`Would update ${file}: delivery section`));
    console.log(`Dry run complete: ${changes.length} file(s) would change.`);
    return changes;
  }
  throw new Error('Refusing to write by default. Use --write after reviewing --dry-run.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  if ([...args].some((arg) => !['--check', '--dry-run', '--write'].includes(arg)) || args.size !== 1) {
    throw new Error('Usage: node scripts/sync-business-content.mjs --check|--dry-run|--write');
  }
  if (args.has('--write')) {
    const changes = await syncBusinessContent({ dryRun: true });
    for (const { file, next } of changes) {
      await writeFile(path.join(ROOT, file), next, 'utf8');
      console.log(`Updated ${file}: delivery section`);
    }
  } else {
    await syncBusinessContent({ check: args.has('--check'), dryRun: args.has('--dry-run') });
  }
}
