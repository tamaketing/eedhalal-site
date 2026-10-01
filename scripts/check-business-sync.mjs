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
// artifacts/ holds generated audits and "before" snapshots. They intentionally
// keep the numbers they captured at capture time, so scanning them would report
// drift for content nobody is supposed to edit.
const FORBIDDEN_SCAN_SKIP_DIRS = new Set([
  '.git', '.github', 'node_modules', 'img', 'img_archive_local', 'tmp-chrome-profile',
  'artifacts',
]);

function getPath(obj, dotted) {
  return dotted.split('.').reduce((node, key) => node?.[key], obj);
}

// Cheapest published price among dishes whose name starts with a prefix.
// Some landing pages advertise a "starting at" figure for a dish family
// ("ข้าวหมก..."), and that number comes from the menu catalogue rather than
// business-rules.json. Without this the page can drift to any figure and
// nothing notices, which is exactly how one page said 90, another 100, and the
// cheapest dish was 85.
export function plannerMinPriceWhereNameStartsWith(planner, prefix) {
  const names = planner?.names || {};
  const prices = planner?.prices || {};
  const ids = Object.keys(names).filter((id) => String(names[id]).startsWith(prefix));
  if (!ids.length) throw new Error(`sync-manifest: no published dish name starts with "${prefix}"`);
  return Math.min(...ids.map((id) => Number(prices[id])));
}

// Every published price of a dish family, so a landing page that advertises the
// family can only quote figures the catalogue actually sells. A single page once
// carried four different numbers for the same three dishes (85 in prose, 90 in
// JSON-LD, 90 in the offer range, 100 in offer names); the prose check above
// cannot see that, because each wrong number appeared somewhere valid.
export function plannerPricesWhereNameStartsWith(planner, prefix) {
  const names = planner?.names || {};
  const prices = planner?.prices || {};
  const ids = Object.keys(names).filter((id) => String(names[id]).startsWith(prefix));
  if (!ids.length) throw new Error(`sync-manifest: no published dish name starts with "${prefix}"`);
  return [...new Set(ids.map((id) => Number(prices[id])))].sort((a, b) => a - b);
}

// Money a reader can see: "90 THB", "฿90", "90 บาท" ...
function visibleMoneyFigures(html) {
  const found = new Set();
  for (const match of html.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:THB|฿|บาท)/gi)) {
    found.add(Number(match[1].replace(/,/g, '')));
  }
  return [...found];
}

// The same prices again, but where machines read them.
function structuredPriceFigures(html) {
  const found = new Set();
  for (const match of html.matchAll(/"(?:price|lowPrice|highPrice)"\s*:\s*"?([\d.]+)"?/g)) {
    found.add(Number(match[1]));
  }
  return [...found];
}

function resolveVariant(template, rules, planner) {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, raw) => {
    const key = raw.trim();
    const plannerCall = /^planner\.minPriceWhereNameStartsWith:(.+)$/.exec(key);
    if (plannerCall) return String(plannerMinPriceWhereNameStartsWith(planner, plannerCall[1].trim()));
    const value = getPath(rules, key);
    if (value === undefined || value === null || value === false) {
      throw new Error(`sync-manifest references unknown business rule: ${key}`);
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
  const [rules, manifest, planner] = await Promise.all([
    readFile(path.join(root, 'data/business-rules.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'data/sync-manifest.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'data/planner-overrides.json'), 'utf8').then(JSON.parse),
  ]);

  const factFailures = [];
  let checkedCells = 0;
  for (const fact of manifest.facts) {
    const expected = fact.variants.map((variant) => resolveVariant(variant, rules, planner));
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

  const catalogueFailures = [];
  for (const rule of manifest.cataloguePrices ?? []) {
    const allowed = plannerPricesWhereNameStartsWith(planner, rule.prefix);
    for (const file of rule.files) {
      const content = await readFile(path.join(root, file), 'utf8').catch(() => null);
      if (content === null) {
        catalogueFailures.push({ rule: rule.id, file, detail: 'missing file (ลบไฟล์ทิ้ง?)' });
        continue;
      }
      const quoted = [...visibleMoneyFigures(content), ...structuredPriceFigures(content)];
      const invented = [...new Set(quoted.filter((value) => !allowed.includes(value)))].sort((a, b) => a - b);
      if (invented.length) {
        catalogueFailures.push({
          rule: rule.id,
          file,
          detail: `ราคา ${invented.join(', ')} ไม่มีในแคตตาล็อกที่ขายจริง (${rule.prefix}: ${allowed.join(', ')})`,
        });
      }
    }
  }

  if (factFailures.length > 0 || forbiddenHits.length > 0 || catalogueFailures.length > 0) {
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
    if (catalogueFailures.length > 0) {
      lines.push('[cataloguePrices: ราคาที่หน้าเว็บโชว์ต้องเป็นราคาที่ขายจริง]');
      for (const hit of catalogueFailures) lines.push(`  - ${hit.file} <- ${hit.rule}: ${hit.detail}`);
      lines.push('');
    }
    throw new Error(lines.join('\n'));
  }

  return {
    facts: manifest.facts.length,
    cells: checkedCells,
    scanned: scanFiles.length,
    cataloguePages: (manifest.cataloguePrices ?? []).reduce((sum, rule) => sum + rule.files.length, 0),
  };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const args = new Set(process.argv.slice(2));
  if (args.size > 1 || (args.size === 1 && !args.has('--check'))) {
    throw new Error('Usage: node scripts/check-business-sync.mjs [--check]');
  }
  const summary = await checkBusinessSync();
  console.log(`Business sync OK: ${summary.facts} facts x ${summary.cells} file cells + ${summary.scanned} files forbidden-scan + ${summary.cataloguePages} catalogue-price pages passed.`);
}
