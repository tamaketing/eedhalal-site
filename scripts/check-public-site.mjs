import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://eedhalal.com';
// Delivery is admin-quoted: the only promise any page may make is the policy
// message from business-rules.json. Zone rates, vehicle fees, and quantity
// free-delivery thresholds are retired everywhere.

async function listHtml(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const nextRelative = path.posix.join(relative, entry.name);
    const nextPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listHtml(nextPath, nextRelative);
    return entry.isFile() && entry.name.endsWith('.html') ? [nextRelative] : [];
  }));
  return files.flat();
}

function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((match) => match[0]);
}

function attribute(tag, name) {
  return new RegExp(`\\b${name}=["']([^"']*)["']`, 'i').exec(tag)?.[1] ?? null;
}

function pageUrl(file) {
  return `${ORIGIN}/${file === 'index.html' ? '' : file}`;
}

function localPath(url, sourceFile) {
  const clean = url.split('#')[0].split('?')[0];
  if (!clean || clean === '/') return 'index.html';
  const resolved = clean.startsWith('/') ? clean.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), clean));
  const rootRelative = resolved.replace(/^(?:\.\.\/)+/, '');
  return clean.endsWith('/') ? `${rootRelative}index.html` : rootRelative;
}

function isExternal(url) {
  return /^(?:https?:|mailto:|tel:|data:|javascript:|#)/i.test(url);
}

function htmlHasNoindex(html) {
  return /<meta\b(?=[^>]*\bname=["']robots["'])(?=[^>]*\bcontent=["'][^"']*noindex)[^>]*>/i.test(html);
}

function getCanonical(html) {
  return tags(html, 'link').find((tag) => attribute(tag, 'rel') === 'canonical') && attribute(tags(html, 'link').find((tag) => attribute(tag, 'rel') === 'canonical'), 'href');
}

function getHreflangs(html) {
  return Object.fromEntries(tags(html, 'link')
    .filter((tag) => attribute(tag, 'rel') === 'alternate' && attribute(tag, 'hreflang'))
    .map((tag) => [attribute(tag, 'hreflang'), attribute(tag, 'href')]));
}

function jsonLdBodies(html) {
  const activeHtml = html.replace(/<!--[\s\S]*?-->/g, '');
  return [...activeHtml.matchAll(/<script\b(?=[^>]*\btype=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1].trim());
}

const localFaqBaselines = {
  'ladprao.html': ['EED HALAL ส่งข้าวกล่องฮาลาลในลาดพร้าวฟรีไหม?', 'สั่งข้าวกล่องฮาลาลในลาดพร้าวขั้นต่ำกี่กล่อง?', 'EED HALAL มีใบรับรองฮาลาลหรือไม่?', 'ต้องสั่งข้าวกล่องฮาลาลล่วงหน้ากี่วัน?'],
  'rama3.html': ['EED HALAL ส่งข้าวกล่องฮาลาลในพระราม 3 ฟรีไหม?', 'สั่งข้าวกล่องฮาลาลในพระราม 3 ขั้นต่ำกี่กล่อง?', 'EED HALAL มีใบรับรองฮาลาลหรือไม่?', 'ต้องสั่งข้าวกล่องฮาลาลล่วงหน้ากี่วัน?'],
  'sathorn-silom.html': ['EED HALAL ส่งสาทร-สีลมฟรีไหม?', 'สั่งข้าวกล่องฮาลาลในสาทร-สีลมขั้นต่ำกี่กล่อง?', 'EED HALAL มีใบรับรองฮาลาลหรือไม่?', 'ต้องสั่งข้าวกล่องฮาลาลล่วงหน้ากี่วัน?'],
  'silom.html': ['มีบริการข้าวกล่องฮาลาลส่งถึงออฟฟิศในสีลมไหม?', 'ข้าวกล่องฮาลาลสีลมราคาเริ่มต้นเท่าไหร่?', 'รับทำข้าวกล่องฮาลาลสำหรับประชุมไหม?', 'EED HALAL ส่งข้าวกล่องฮาลาลในสีลมฟรีไหม?', 'สั่งข้าวกล่องฮาลาลในสีลมขั้นต่ำกี่กล่อง?', 'EED HALAL มีใบรับรองฮาลาลหรือไม่?', 'ต้องสั่งข้าวกล่องฮาลาลล่วงหน้ากี่วัน?'],
  'sukhumvit.html': ['EED HALAL ส่งข้าวกล่องฮาลาลในสุขุมวิทฟรีไหม?', 'สั่งข้าวกล่องฮาลาลในสุขุมวิทขั้นต่ำกี่กล่อง?', 'EED HALAL มีใบรับรองฮาลาลหรือไม่?', 'ต้องสั่งข้าวกล่องฮาลาลล่วงหน้ากี่วัน?'],
};

async function exists(relativePath) {
  try {
    return (await stat(path.join(ROOT, relativePath))).isFile();
  } catch {
    return false;
  }
}

// Menu publish safety: the published static catalog must carry public fields
// only. Costs, profit, internal notes/flags, secrets, and machine-local paths
// must never reach files that GitHub Pages serves (even unlinked direct URLs).
const PUBLISHED_INTERNAL_TOKENS = [
  'foodcost', 'internalnote', 'includesbox', 'showonwebsite', 'coststatus',
  'profit', 'marginpct', 'eed_internal_api_secret',
];
const PUBLISHED_LOCAL_TOKENS = ['localhost', '127.0.0.1', 'file://', 'owner-costs', 'C:\\', 'C:/'];

export async function checkPublishSafety(root = ROOT) {
  const failures = [];
  const overridesRaw = await readFile(path.join(root, 'data', 'planner-overrides.json'), 'utf8');
  const menuDataJs = await readFile(path.join(root, 'js', 'menu-data.js'), 'utf8');
  let overrides;
  try {
    overrides = JSON.parse(overridesRaw);
  } catch (error) {
    failures.push(`data/planner-overrides.json: invalid JSON (${error.message})`);
  }
  if (overrides) {
    const allowed = new Set([
      'prices', 'mins', 'images', 'names', 'categories',
      'descs', 'badges', 'sortOrder', 'popular', 'deleted',
      'newMenus', 'meats', 'toppings', 'noMeatMenus',
      'snackPrices', 'snackNames', 'snackCats', 'snackAddons',
      'exportedAt', 'release',
    ]);
    for (const key of Object.keys(overrides)) {
      if (!allowed.has(key)) failures.push(`data/planner-overrides.json: key not in public allowlist: ${key}`);
    }
    // Release marker proves the files came from the menu pipeline, so a
    // live-web check can confirm exactly which central version is served.
    if (!overrides.release || !Number.isFinite(Number(overrides.release.centralVersion))) {
      failures.push('data/planner-overrides.json: missing release.centralVersion (rebuild via menu publish)');
    }
  }
  // Internal data and backups must never sit next to deploy files or inside
  // the Pages artifact: costs/central/backups live under demo/ (gitignored,
  // undeployed) only.
  for (const dir of ['data', 'js']) {
    let entries = [];
    try {
      entries = await readdir(path.join(root, dir));
    } catch { /* missing dir is reported elsewhere */ }
    for (const name of entries) {
      if (/owner-costs|menu-central|internalnote/i.test(name)) {
        failures.push(`internal file must not live in deploy paths: ${dir}/${name}`);
      }
      if (/\.(bak|tmp)$|~$/.test(name)) failures.push(`stray backup/temp file in deploy paths: ${dir}/${name}`);
    }
  }
  // Owner-only scripts must stay out of the Pages artifact (see pages.yml).
  const pagesYml = await readFile(path.join(root, '.github', 'workflows', 'pages.yml'), 'utf8');
  for (const token of ['demo/', 'tools/', 'owner-costs', 'menu-central']) {
    if (new RegExp(`cp (-R )?["']?${token}`).test(pagesYml)) {
      failures.push(`.github/workflows/pages.yml: must not bundle ${token} into the artifact`);
    }
  }
  // Backend runtime holds no data files: data stays in the gitignored data
  // dir, never beside the code. Lock that shape (names only, not contents).
  let adminEntries = [];
  try {
    adminEntries = await readdir(path.join(root, 'tools', 'admin'));
  } catch {
    failures.push('tools/admin is missing (admin backend must be tracked)');
    adminEntries = [];
  }
  for (const name of adminEntries) {
    if (/owner-costs|menu-central\.json|publish-state|\.bak$|\.tmp$/i.test(name)) {
      failures.push(`private data must not live beside backend code: tools/admin/${name}`);
    }
  }
  for (const [label, content] of [['data/planner-overrides.json', overridesRaw], ['js/menu-data.js', menuDataJs]]) {
    const lower = content.toLowerCase();
    for (const token of PUBLISHED_INTERNAL_TOKENS) {
      if (lower.includes(token)) failures.push(`${label}: internal data leak (${token})`);
    }
    for (const token of PUBLISHED_LOCAL_TOKENS) {
      if (content.includes(token)) failures.push(`${label}: machine-local reference (${token})`);
    }
  }
  for (const excluded of ['budget-planner.html', 'kitchen-order.html', 'cost-data.js', 'budget-planner.js', 'kitchen-order.js']) {
    if (!pagesYml.includes(`! -name '${excluded}'`)) failures.push(`.github/workflows/pages.yml: must keep excluding ${excluded}`);
  }
  // Every published menu image must resolve to a file in the repo (web-safe).
  if (overrides) {
    for (const [id, image] of Object.entries(overrides.images || {})) {
      const ref = String(image || '');
      if (/^https?:\/\//i.test(ref)) {
        if (!/^https:\/\//i.test(ref) || /localhost|127\.0\.0\.1/.test(ref)) {
          failures.push(`data/planner-overrides.json: image id ${id} is not web-safe: ${ref}`);
        }
        continue;
      }
      if (ref.includes('\\') || /^[a-zA-Z]:/.test(ref) || ref.startsWith('file:') || ref.includes('..')) {
        failures.push(`data/planner-overrides.json: image id ${id} is not web-safe: ${ref}`);
        continue;
      }
      if (!await exists(ref.replace(/^\/+/, '').split('#')[0].split('?')[0])) {
        failures.push(`data/planner-overrides.json: image id ${id} missing from repo: ${ref}`);
      }
    }
  }
  assert.deepEqual(failures, [], `Publish safety validation failed:\n${failures.join('\n')}`);
  console.log('Publish safety validation passed (no internal data in public catalog).');
}

export async function checkPublicSite(root = ROOT) {
  const previousRoot = ROOT;
  if (root !== previousRoot) throw new Error('custom roots are not supported');
  const files = await listHtml(ROOT);
  const contents = new Map(await Promise.all(files.map(async (file) => [file, await readFile(path.join(ROOT, file), 'utf8')])));
  const publicFiles = files.filter((file) => !htmlHasNoindex(contents.get(file)));
  const failures = [];
  const canonicalUrls = new Set();
  const banned = [/100[–-]150/, /POPULARMENU_START89/, /within one day/i, /กรุงเทพฯ(?:ฯ)?\s*และปริมณฑล/, /Bangkok\s*(?:&amp;|and)\s*(?:the\s*)?metropolitan area/i];

  for (const file of publicFiles) {
    const html = contents.get(file);
    const canonical = getCanonical(html);
    if (!canonical) failures.push(`${file}: missing canonical URL`);
    else if (canonical !== pageUrl(file)) failures.push(`${file}: canonical must be ${pageUrl(file)}`);
    else canonicalUrls.add(canonical);

    const counterpart = file.startsWith('en/') ? file.slice(3) : `en/${file}`;
    if (contents.has(counterpart)) {
      const hreflangs = getHreflangs(html);
      const th = file.startsWith('en/') ? pageUrl(counterpart) : pageUrl(file);
      const en = file.startsWith('en/') ? pageUrl(file) : pageUrl(counterpart);
      if (hreflangs.th !== th || hreflangs.en !== en || hreflangs['x-default'] !== th) failures.push(`${file}: incomplete reciprocal hreflang links`);
    }

    const graphs = jsonLdBodies(html).flatMap((body) => {
      try {
        const parsed = JSON.parse(body);
        return parsed['@graph'] ?? [parsed];
      } catch (error) {
        failures.push(`${file}: invalid JSON-LD (${error.message})`);
        return [];
      }
    });

    if (localFaqBaselines[file]) {
      const types = new Set(graphs.map((node) => node['@type']));
      if (graphs.length !== 5) failures.push(`${file}: JSON-LD must contain exactly one copy of each required type`);
      for (const type of ['Organization', 'WebPage', 'Service', 'BreadcrumbList', 'FAQPage']) {
        if (!types.has(type)) failures.push(`${file}: JSON-LD is missing required ${type}`);
      }
      const faqs = graphs.filter((node) => node['@type'] === 'FAQPage');
      if (faqs.length !== 1) failures.push(`${file}: must contain exactly one FAQPage`);
      const questions = faqs[0]?.mainEntity ?? [];
      if (questions.length !== localFaqBaselines[file].length || !questions.every((question, index) => question.name === localFaqBaselines[file][index])) {
        failures.push(`${file}: FAQ JSON-LD does not match the baseline questions`);
      }
      if (questions.some((question) => /ส่งฟรี|free delivery/i.test(question.acceptedAnswer?.text || ''))) {
        failures.push(`${file}: FAQ JSON-LD must not promise free delivery`);
      }
      if (jsonLdBodies(html).some((body) => body.includes('priceValidUntil'))) failures.push(`${file}: JSON-LD must not include priceValidUntil`);
    }

    banned.forEach((pattern) => { if (pattern.test(html)) failures.push(`${file}: contains obsolete claim ${pattern}`); });

    for (const tag of [...tags(html, 'a'), ...tags(html, 'link'), ...tags(html, 'img'), ...tags(html, 'script')]) {
      const url = attribute(tag, tag.startsWith('<img') || tag.startsWith('<script') ? 'src' : 'href');
      if (!url || isExternal(url)) continue;
      const target = localPath(url, file);
      if (!target) { failures.push(`${file}: invalid local URL ${url}`); continue; }
      if (!await exists(target)) failures.push(`${file}: missing local file ${url}`);
      const fragment = url.split('#')[1];
      if (fragment && contents.has(target) && !new RegExp(`\\bid=["']${fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(contents.get(target))) failures.push(`${file}: missing fragment #${fragment}`);
    }
  }

  const sitemap = await readFile(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const sitemapUrls = new Set([...sitemap.matchAll(/<loc>(https:\/\/eedhalal\.com\/?[^<]*)<\/loc>/g)].map((match) => match[1]));
  canonicalUrls.forEach((url) => { if (!sitemapUrls.has(url)) failures.push(`sitemap.xml: missing ${url}`); });
  sitemapUrls.forEach((url) => { if (!canonicalUrls.has(url)) failures.push(`sitemap.xml: non-indexable or missing ${url}`); });

  const [thaiFaq, englishFaq, llms, richMenu] = await Promise.all([
    readFile(path.join(ROOT, 'faq.html'), 'utf8'),
    readFile(path.join(ROOT, 'en/faq.html'), 'utf8'),
    readFile(path.join(ROOT, 'llms.txt'), 'utf8'),
    readFile(path.join(ROOT, 'line-ai/rich-menu.json'), 'utf8'),
  ]);
  if (!thaiFaq.includes('180–250 บาท') || !englishFaq.includes('180–250 baht')) failures.push('FAQ: premium-set range must be 180–250 THB');
  if (!thaiFaq.includes('พื้นที่นอกกรุงเทพฯ สอบถามเป็นรายกรณี') || !englishFaq.includes('outside Bangkok is quoted case by case')) failures.push('FAQ: outside-Bangkok policy is missing');
  if (!llms.includes('premium sets range from 180-250 THB') || !llms.includes('outside Bangkok are quoted case by case')) failures.push('llms.txt: customer facts are stale');
  if (!richMenu.includes('เซ็ตพรีเมียม 180-250 บาท')) failures.push('line-ai/rich-menu.json: premium-set reply is stale');

  const rules = JSON.parse(await readFile(path.join(ROOT, 'data/business-rules.json'), 'utf8'));
  const thaiDeliveryPolicy = rules.delivery.messageTh;
  const englishDeliveryPolicy = rules.delivery.messageEn;
  const llmsFull = await readFile(path.join(ROOT, 'llms-full.md'), 'utf8');
  if (!thaiFaq.includes(thaiDeliveryPolicy) || !englishFaq.includes(englishDeliveryPolicy)) failures.push('FAQ: Thai and English delivery policy must match business rules');
  if (!thaiFaq.includes('10–50 กล่อง') || !thaiFaq.includes('51–100 กล่อง') || !thaiFaq.includes('101+ กล่อง')) failures.push('FAQ: Thai lead-time ranges must be exclusive');
  if (!englishFaq.includes('10–50 boxes') || !englishFaq.includes('51–100 boxes') || !englishFaq.includes('101+ boxes')) failures.push('FAQ: English lead-time ranges must be exclusive');
  if (!llms.includes(`minimum ${rules.services.snackBox.minimumOrder} boxes`) || !llmsFull.includes(`minimum ${rules.services.snackBox.minimumOrder} boxes`)) failures.push('LLM files: Snack Box minimum is stale');
  if (!llms.includes(englishDeliveryPolicy) || !llmsFull.includes(englishDeliveryPolicy)) failures.push('LLM files: delivery policy is stale');
  const obsoletePolicy = /(?:50[–-]75\+?\s*(?:กล่อง|boxes)|ขั้นต่ำ\s*50\s*กล่อง|minimum\s*50\s*boxes|ไม่ส่งปริมณฑล)/i;
  // Retired rate system: no zone tables, vehicle fees, free promises, or
  // quantity thresholds may appear in any public page.
  const retiredRates = [/ส่งฟรี/, /free[ -]delivery/i, /ไม่มีส่งฟรี/, /no free delivery/i, /has no free delivery/i,
    /zone\s+[1-5]\b/, /zone_[1-5]/, /มอเตอร์ไซค์\s*\d+\s*บาท/, /รถยนต์\s*\d+\s*บาท/, /ใช้เรท(มอเตอร์ไซค์|รถยนต์)/];
  for (const [file, html] of contents) {
    if (obsoletePolicy.test(html)) failures.push(`${file}: contains obsolete business-policy text`);
    for (const pattern of retiredRates) {
      if (pattern.test(html)) failures.push(`${file}: contains retired delivery-rate text ${pattern}`);
    }
  }
  // Policy presence is enforced exactly where it is generated (faq delivery
  // markers). Everywhere else, the retired-pattern bans above guarantee no old
  // promise survives; pages without delivery text comply by absence.

  assert.deepEqual(failures, [], `Public site validation failed:\n${failures.join('\n')}`);
  console.log(`Public site validation passed for ${publicFiles.length} indexable pages.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkPublishSafety();
  await checkPublicSite();
}
