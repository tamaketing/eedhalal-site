import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(ROOT, file), 'utf8');
const escape = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const htmlFiles = async (dir = '') => {
  const entries = await readdir(path.join(ROOT, dir), { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const file = path.posix.join(dir, entry.name);
    if (entry.isDirectory() && ['en', 'blog'].includes(entry.name)) result.push(...await htmlFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.html')) result.push(file);
  }
  return result;
};

export function serviceFacts(rules, id, en) {
  const s = rules.services[id];
  if (id === 'tableService') return en
    ? `From ${s.priceFromPerTable.toLocaleString('en-US')} THB/table; ${s.seatsFrom}–${s.seatsTo} guests/table; minimum ${s.minimumTables} tables; ${s.courseCountFrom}–${s.courseCountTo} courses. Book at least ${s.leadTimeDays} days ahead.`
    : `เริ่ม ${s.priceFromPerTable.toLocaleString('en-US')} บาท/โต๊ะ โต๊ะละ ${s.seatsFrom}–${s.seatsTo} ท่าน ขั้นต่ำ ${s.minimumTables} โต๊ะ อาหาร ${s.courseCountFrom}–${s.courseCountTo} รายการ จองล่วงหน้าอย่างน้อย ${s.leadTimeDays} วัน`;
  if (id === 'mealBox') return en
    ? `From ${s.priceFrom} THB/box; minimum ${s.minimumOrder} boxes. Order at least ${s.leadTimeDays} day ahead. Per-menu minimums: ${s.standardMenuMinimum} standard / ${s.specialMenuMinimum} special-preparation boxes.`
    : `เริ่ม ${s.priceFrom} บาท/กล่อง ขั้นต่ำ ${s.minimumOrder} กล่อง สั่งล่วงหน้าอย่างน้อย ${s.leadTimeDays} วัน ขั้นต่ำต่อเมนูทั่วไป ${s.standardMenuMinimum} กล่อง / เมนูเตรียมพิเศษ ${s.specialMenuMinimum} กล่อง`;
  return en
    ? `From ${s.priceFrom} THB/guest; minimum ${s.minimumGuests} guests${s.maximumGuests ? `; maximum ${s.maximumGuests} guests` : '; capacity confirmed for each event'}. Book at least ${s.leadTimeDays} days ahead.`
    : `เริ่ม ${s.priceFrom} บาท/ท่าน ขั้นต่ำ ${s.minimumGuests} คน${s.maximumGuests ? ` สูงสุด ${s.maximumGuests} คน` : ' จำนวนที่รองรับให้ทีมยืนยันตามงาน'} จองล่วงหน้าอย่างน้อย ${s.leadTimeDays} วัน`;
}

export function renderCatalog(rules, en, detailId) {
  const ids = detailId ? [detailId] : rules.positioning.servicePriority;
  const names = en ? rules.positioning.serviceNamesEn : rules.positioning.serviceNamesTh;
  const url = (id) => new URL(rules.urls[id === 'mealBox' ? 'corporate' : id]).pathname.replace(/^\//, en ? '/en/' : '/');
  const cards = ids.map((id) => {
    const name = names[rules.positioning.servicePriority.indexOf(id)];
    return `<article class="catering-fact-card" data-service="${id}"><h3><a href="${url(id)}">${escape(name)}</a></h3><p>${escape(serviceFacts(rules, id, en))}</p></article>`;
  }).join('\n');
  const summary = rules.positioning[en ? 'descriptionEn' : 'descriptionTh'];
  const policy = en
    ? `All listed services are halal. Final menus, equipment, staffing, capacity and transport costs are confirmed in your quotation. Locations outside Bangkok are quoted case by case. Deposit ${rules.paymentTerms.bookingDepositPercent}%; catering balance due ${rules.paymentTerms.cateringBalanceDaysBeforeEvent} days before the event, meal-box balance ${rules.paymentTerms.mealBoxBalanceDaysBeforeDelivery} day before delivery.`
    : `บริการทั้งหมดเป็นฮาลาล เมนู อุปกรณ์ ทีมบริการ จำนวนที่รองรับ และค่าขนส่งให้ทีมยืนยันในใบเสนอราคาของแต่ละงาน พื้นที่นอกกรุงเทพฯ สอบถามเป็นรายกรณี มัดจำ ${rules.paymentTerms.bookingDepositPercent}% งานจัดเลี้ยงชำระส่วนที่เหลือก่อนวันงาน ${rules.paymentTerms.cateringBalanceDaysBeforeEvent} วัน ข้าวกล่องก่อนส่ง ${rules.paymentTerms.mealBoxBalanceDaysBeforeDelivery} วัน`;
  return `<!-- BUSINESS-RULES:CATERING -->\n<section class="section catering-facts" aria-label="${en ? 'Halal catering services' : 'บริการจัดเลี้ยงฮาลาล'}"><div class="container"><h2>${detailId ? (en ? 'Service details and booking' : 'รายละเอียดบริการและการจอง') : escape(summary)}</h2><div class="catering-facts-grid">${cards}</div><p>${escape(policy)}</p><p>${en ? `Additional service: halal Snack Box / Coffee Break from ${rules.services.snackBox.priceFrom} THB/box, minimum ${rules.services.snackBox.minimumOrder} boxes.` : `บริการเสริม: Snack Box / Coffee Break ฮาลาล เริ่ม ${rules.services.snackBox.priceFrom} บาท/กล่อง ขั้นต่ำ ${rules.services.snackBox.minimumOrder} กล่อง`}</p><a class="btn btn-primary" href="/catering-brief.html">${en ? 'Request an event quotation' : 'ขอใบเสนอราคาจัดเลี้ยง'}</a> <a class="btn btn-outline" href="/popular-menu.html">${en ? 'Browse meal-box menus' : 'ดูรายการข้าวกล่อง'}</a></div></section>\n<!-- /BUSINESS-RULES:CATERING -->`;
}

export async function syncCateringContent({ write = false } = {}) {
  const rules = JSON.parse(await read('data/business-rules.json'));
  const changes = [];
  const plan = async (file, next) => {
    const old = await read(file).catch(() => '');
    if (old !== next) changes.push({ file, next });
  };
  const urls = rules.positioning.servicePriority.map(id => rules.urls[id === 'mealBox' ? 'corporate' : id]);
  const names = (en) => rules.positioning[en ? 'serviceNamesEn' : 'serviceNamesTh'];
  const details = { 'buffet.html': 'buffet', 'cocktail.html': 'cocktail', 'table-service.html': 'tableService', 'set-menu.html': 'setMenu', 'live-cooking-station.html': 'liveCooking' };
  const overviewPages = ['index.html', 'catering.html', 'about.html', 'faq.html'];
  for (const file of await htmlFiles()) {
    let html = await read(file);
    if (/<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html)) continue;
    const en = file.startsWith('en/');
    const base = en ? file.slice(3) : file;
    const summary = rules.positioning[en ? 'descriptionEn' : 'descriptionTh'];
    const links = urls.map((url, i) => `<a href="${new URL(url).pathname.replace(/^\//, en ? '/en/' : '/')}">${escape(names(en)[i])}</a>`).join(' · ');
    const nav = `<!-- BUSINESS-RULES:SERVICE-LINKS -->\n<nav class="service-discovery container" aria-label="${en ? 'Explore halal services' : 'เลือกบริการฮาลาล'}"><p>${escape(summary)}</p>${links}</nav>\n<!-- /BUSINESS-RULES:SERVICE-LINKS -->`;
    if (html.includes('<!-- BUSINESS-RULES:SERVICE-LINKS -->')) html = html.replace(/<!-- BUSINESS-RULES:SERVICE-LINKS -->[\s\S]*?<!-- \/BUSINESS-RULES:SERVICE-LINKS -->/, nav);
    else html = html.replace(/(<div id="footer"[^>]*>)/, `${nav}\n$1`);
    if (!html.includes('<!-- BUSINESS-RULES:SERVICE-LINKS -->')) throw new Error(`${file}: missing footer insertion point`);
    if (overviewPages.includes(base) || details[base]) {
      const block = renderCatalog(rules, en, details[base]);
      if (html.includes('<!-- BUSINESS-RULES:CATERING -->')) html = html.replace(/<!-- BUSINESS-RULES:CATERING -->[\s\S]*?<!-- \/BUSINESS-RULES:CATERING -->/, block);
      else {
        const h1 = html.indexOf('</h1>');
        const end = html.indexOf('</section>', h1) + '</section>'.length;
        if (h1 < 0 || end < '</section>'.length) throw new Error(`${file}: missing hero section`);
        html = html.slice(0, end) + '\n' + block + html.slice(end);
      }
    }
    // Provider identity belongs to the business; retain page-specific Service and article descriptions.
    html = html.replace(/(<script\b[^>]*type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi, (all, open, body, close) => {
      let graph;
      try { graph = JSON.parse(body); } catch { return all; }
      let changed = false;
      const catalog = { '@type': 'OfferCatalog', name: en ? 'Halal catering services' : 'บริการจัดเลี้ยงฮาลาล', itemListElement: rules.positioning.servicePriority.map((id, i) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: names(en)[i], url: new URL(urls[i]).origin + new URL(urls[i]).pathname.replace(/^\//, en ? '/en/' : '/'), description: serviceFacts(rules, id, en) } })) };
      const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if ([node['@type']].flat().some(type => ['Organization', 'FoodEstablishment', 'LocalBusiness', 'Restaurant'].includes(type)) && /EED HALAL/i.test(node.name || '')) {
          if (node.description !== summary) { node.description = summary; changed = true; }
          if (overviewPages.includes(base)) {
            if (JSON.stringify(node.hasOfferCatalog) !== JSON.stringify(catalog)) { node.hasOfferCatalog = catalog; changed = true; }
          }
        }
        if (node['@type'] === 'Service' && ['index.html', 'catering.html'].includes(base) && node['@id']) {
          const next = { name: en ? 'Halal Catering Bangkok | EED HALAL' : 'รับจัดเลี้ยงฮาลาล กรุงเทพ | EED HALAL', description: summary, offers: catalog.itemListElement };
          for (const [key, value] of Object.entries(next)) if (JSON.stringify(node[key]) !== JSON.stringify(value)) { node[key] = value; changed = true; }
        }
        if (node['@type'] === 'WebPage') {
          const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
          const description = /<meta\b[^>]*name="description"[^>]*content="([^"]*)"/.exec(html)?.[1];
          if (title && node.name !== title) { node.name = title; changed = true; }
          if (description && node.description !== description) { node.description = description; changed = true; }
        }
        Object.values(node).forEach(visit);
      };
      visit(graph);
      return changed ? `${open}\n${JSON.stringify(graph, null, 2)}\n${close}` : all;
    });
    if (!html.includes('href="/llms.txt"')) html = html.replace('</head>', '<link rel="llms.txt" href="/llms.txt">\n</head>');
    await plan(file, html);
  }

  const knowledge = `## Service priority and canonical facts\n${rules.positioning.descriptionEn}\n${rules.positioning.descriptionTh}\n\n` + rules.positioning.servicePriority.map((id, i) => `${i + 1}. ${names(false)[i]} / ${names(true)[i]} — ${serviceFacts(rules, id, true)} ${urls[i]}`).join('\n') + `\n\nAll services above are halal. Snack Box is an additional service: from ${rules.services.snackBox.priceFrom} THB/box, minimum ${rules.services.snackBox.minimumOrder} boxes.\nBusiness data source: \`data/business-rules.json\`. Match the customer's specific service request; this priority is for general business introductions.\n`;
  for (const file of ['llms.txt', 'llms-full.md']) {
    let s = await read(file);
    const block = `<!-- BUSINESS-RULES:AI -->\n${knowledge}<!-- /BUSINESS-RULES:AI -->`;
    s = s.includes('<!-- BUSINESS-RULES:AI -->') ? s.replace(/<!-- BUSINESS-RULES:AI -->[\s\S]*?<!-- \/BUSINESS-RULES:AI -->/, block) : s.replace(/^(#[^\n]*\n)/, `$1\n${block}\n`);
    await plan(file, s);
  }
  const brief = changes.find(c => c.file === 'catering-brief.html')?.next ?? await read('catering-brief.html');
  await plan('catering-brief.html', brief.replace(/(<select name="service" required>)[\s\S]*?(<\/select>)/, `$1<option value="">เลือกรูปแบบ</option>${names(false).map(n => `<option>${escape(n)}</option>`).join('')}$2`));
  if (!write && changes.length) throw new Error(`Catering content is out of sync: ${changes.map(c => c.file).join(', ')}. Run node scripts/sync-catering-content.mjs --write`);
  if (write) for (const { file, next } of changes) await writeFile(path.join(ROOT, file), next, 'utf8');
  console.log(`Catering content ${write ? 'updated' : 'verified'}: ${changes.length} changed file(s).`);
  return changes.map(c => c.file);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || !['--check', '--write'].includes(process.argv[2])) throw new Error('Use --check or --write');
  await syncCateringContent({ write: process.argv[2] === '--write' });
}
