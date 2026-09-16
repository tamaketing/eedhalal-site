import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Structural self-exclusion: ไฟล์ของโครงตรวจเองมีข้อความ pattern อยู่ในตัว
// (เช่น manifest เก็บ regex ต้องห้าม) จึงต้องไม่ถูกสแกนด้วยกฎ forbidden
const FORBIDDEN_SCAN_SELF_EXCLUDE = new Set([
  'data/sync-manifest.json',
  'scripts/check-business-sync.mjs',
  'test/business-sync-manifest.test.mjs',
]);

const FORBIDDEN_SCAN_EXTENSIONS = new Set(['.html', '.js', '.json', '.txt', '.md']);
const FORBIDDEN_SCAN_SKIP_DIRS = new Set([
  '.git', '.github', 'node_modules', 'img', 'img_archive_local', 'tmp-chrome-profile',
]);

function getPath(obj, dotted) {
  return dotted.split('.').reduce((node, key) => node?.[key], obj);
}

function resolveVariant(template, rules) {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, raw) => {
    const value = getPath(rules, raw.trim());
    if (value === undefined || value === null || value === false) {
      throw new Error(`sync-manifest references unknown business rule: ${raw.trim()}`);
    }
    return String(value);
  });
}

async function listScanFiles(root) {
  const result = [];
  const walk = async (dir) => {
    for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (FORBIDDEN_SCAN_SKIP_DIRS.has(entry.name)) continue;
        await walk(rel);
      } else if (FORBIDDEN_SCAN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        result.push(rel);
      }
    }
  };
  await walk('.');
  return result;
}

const isExcluded = (posixPath, exclude = []) =>
  FORBIDDEN_SCAN_SELF_EXCLUDE.has(posixPath) ||
  exclude.some((rule) => posixPath === rule || posixPath.startsWith(rule.endsWith('/') ? rule : `${rule}/`));

export async function checkBusinessSync(root = ROOT) {
  const [rules, manifest] = await Promise.all([
    readFile(path.join(root, 'data/business-rules.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'data/sync-manifest.json'), 'utf8').then(JSON.parse),
  ]);

  const factFailures = [];
  let checkedCells = 0;
  for (const fact of manifest.facts) {
    const expected = fact.variants.map((variant) => resolveVariant(variant, rules));
    const needles = expected.map((text) => text.toLowerCase());
    for (const file of fact.files) {
      checkedCells += 1;
      const content = await readFile(path.join(root, file), 'utf8').catch(() => null);
      if (content === null) {
        factFailures.push({ fact: fact.id, file, detail: 'missing file (ลบไฟล์ทิ้งหรือยังไม่สร้างคู่ EN?)' });
        continue;
      }
      if (!needles.some((needle) => content.toLowerCase().includes(needle))) {
        factFailures.push({ fact: fact.id, file, detail: `expected one of: ${expected.join(' | ')}` });
      }
    }
  }

  const forbiddenHits = [];
  const scanFiles = await listScanFiles(root);
  for (const rule of manifest.forbidden) {
    const pattern = new RegExp(rule.pattern, 'i');
    for (const file of scanFiles) {
      if (isExcluded(file, rule.exclude)) continue;
      const content = await readFile(path.join(root, file), 'utf8');
      const match = content.match(pattern);
      if (match) {
        forbiddenHits.push({ rule: rule.id, file, detail: `matched ${JSON.stringify(match[0].slice(0, 60))} (${rule.description})` });
      }
    }
  }

  if (factFailures.length > 0 || forbiddenHits.length > 0) {
    const byFact = new Map();
    for (const failure of factFailures) {
      if (!byFact.has(failure.fact)) byFact.set(failure.fact, []);
      byFact.get(failure.fact).push(`  - ${failure.file} (${failure.detail})`);
    }
    const lines = [
      `Business sync drift: data/business-rules.json กับไฟล์ที่เกี่ยวข้องไม่ตรงกัน (${factFailures.length} fact + ${forbiddenHits.length} forbidden)`,
      'แก้ไฟล์ให้ครบ “ทุกไฟล์” ในลิสต์ แล้วรันตรวจซ้ำ (ตั้งใจไม่มี --write: เนื้อความต้องแก้ด้วยมือเพื่อรักษา SEO/tone ดู FACTS.md ประกอบ)',
      '',
    ];
    for (const [fact, files] of byFact) lines.push(`[${fact}]`, ...files, '');
    if (forbiddenHits.length > 0) {
      lines.push('[forbidden: ข้อความต้องห้าม]');
      for (const hit of forbiddenHits) lines.push(`  - ${hit.file} <- ${hit.rule}: ${hit.detail}`);
      lines.push('');
    }
    throw new Error(lines.join('\n'));
  }

  return { facts: manifest.facts.length, cells: checkedCells, scanned: scanFiles.length };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const args = new Set(process.argv.slice(2));
  if (args.size > 1 || (args.size === 1 && !args.has('--check'))) {
    throw new Error('Usage: node scripts/check-business-sync.mjs [--check]');
  }
  const summary = await checkBusinessSync();
  console.log(`Business sync OK: ${summary.facts} facts x ${summary.cells} file cells + ${summary.scanned} files forbidden-scan passed.`);
}
