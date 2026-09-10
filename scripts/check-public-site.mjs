import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://eedhalal.com';
const thaiAddressPolicy = 'ค่าจัดส่งและเงื่อนไขส่งฟรีขึ้นอยู่กับเขตของสถานที่จัดส่ง กรุณาระบุที่อยู่หรือพิกัดเพื่อเช็กค่าจัดส่ง';

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
      if (questions.some((question) => question.acceptedAnswer?.text.includes('ส่งฟรี') && question.acceptedAnswer.text !== thaiAddressPolicy)) {
        failures.push(`${file}: FAQ JSON-LD contains a non-canonical delivery answer`);
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
  const englishAddressPolicy = 'Delivery fees and free-delivery eligibility depend on the district of the delivery address. Please provide the address or location for confirmation.';
  const thaiDelivery = `zone 1 ${rules.delivery.zones.zone_1.freeFrom}+ กล่อง, zone 2 ${rules.delivery.zones.zone_2.freeFrom}+ กล่อง, zone 3 ${rules.delivery.zones.zone_3.freeFrom}+ กล่อง, zone 4 ${rules.delivery.zones.zone_4.freeFrom}+ กล่อง, zone 5 ไม่มีส่งฟรี`;
  const englishDelivery = `zone 1 ${rules.delivery.zones.zone_1.freeFrom}+ boxes, zone 2 ${rules.delivery.zones.zone_2.freeFrom}+ boxes, zone 3 ${rules.delivery.zones.zone_3.freeFrom}+ boxes, zone 4 ${rules.delivery.zones.zone_4.freeFrom}+ boxes; zone 5 has no free delivery`;
  const llmsFull = await readFile(path.join(ROOT, 'llms-full.md'), 'utf8');
  if (!thaiFaq.includes(thaiDelivery) || !englishFaq.includes(englishDelivery)) failures.push('FAQ: Thai and English delivery thresholds must match business rules');
  if (!thaiFaq.includes('10–50 กล่อง') || !thaiFaq.includes('51–100 กล่อง') || !thaiFaq.includes('101+ กล่อง')) failures.push('FAQ: Thai lead-time ranges must be exclusive');
  if (!englishFaq.includes('10–50 boxes') || !englishFaq.includes('51–100 boxes') || !englishFaq.includes('101+ boxes')) failures.push('FAQ: English lead-time ranges must be exclusive');
  if (!llms.includes(`minimum ${rules.services.snackBox.minimumOrder} boxes`) || !llmsFull.includes(`minimum ${rules.services.snackBox.minimumOrder} boxes`)) failures.push('LLM files: Snack Box minimum is stale');
  const obsoletePolicy = /(?:50[–-]75\+?\s*(?:กล่อง|boxes)|ขั้นต่ำ\s*50\s*กล่อง|minimum\s*50\s*boxes|ไม่ส่งปริมณฑล)/i;
  for (const [file, html] of contents) {
    if (obsoletePolicy.test(html)) failures.push(`${file}: contains obsolete business-policy text`);
  }
  for (const file of ['silom.html', 'sathorn.html', 'sathorn-silom.html', 'sukhumvit.html', 'rama3.html', 'ladprao.html']) {
    const content = contents.get(file);
    if (!content.includes(thaiAddressPolicy)) failures.push(`${file}: ambiguous local-area delivery policy is missing`);
    if (/(?:ส่งฟรี\s*(?:50|75)\+\s*กล่อง|ออเดอร์\s*(?:50|75)\s*กล่องขึ้นไป[^<"]*ส่งฟรี)/.test(content)) failures.push(`${file}: must not guarantee a threshold for an ambiguous local area`);
  }
  for (const file of ['en/silom.html', 'en/sathorn.html', 'en/sathorn-silom.html', 'en/sukhumvit.html', 'en/rama3.html', 'en/ladprao.html']) {
    const content = contents.get(file);
    if (!content.includes(englishAddressPolicy)) failures.push(`${file}: ambiguous local-area delivery policy is missing`);
    if (/(?:free delivery\s*(?:50|75)\+\s*boxes|orders of\s*(?:50|75)\+\s*boxes[^<"]*free delivery)/i.test(content)) failures.push(`${file}: must not guarantee a threshold for an ambiguous local area`);
  }

  assert.deepEqual(failures, [], `Public site validation failed:\n${failures.join('\n')}`);
  console.log(`Public site validation passed for ${publicFiles.length} indexable pages.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkPublicSite();
