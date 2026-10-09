import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTierCards, renderTierTable, setsFromPlanner, sideChoiceSummary, sideItemsFromPlanner, tierContext } from './mealbox-tiers.mjs';

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

// Meal-box starting prices are computed from the published catalogue (see
// scripts/mealbox-tiers.mjs), so this module never holds a price figure. A tier
// with no published set is described as a table link, not as a number.
function tierPriceLine(rules, floors, en) {
  const classic = floors.classic?.priceFrom;
  if (!classic) {
    return en
      ? 'Each tier has its own starting price — see the meal-box tier table'
      : 'แต่ละระดับมีราคาเริ่มต้นของตัวเอง ดูรายละเอียดที่ตารางระดับข้าวกล่อง';
  }
  const money = classic.toLocaleString('en-US');
  const launchNote = (id) => {
    const tier = (rules.services.mealBox.tiers || []).find((item) => item.id === id);
    return tier?.launchStatus === 'launching'
      ? (en ? 'launching soon, price not published yet' : 'กำลังเตรียมเปิดตัว ยังไม่ประกาศราคา')
      : '';
  };
  // A tier that is still launching is named here without a number, so the fact
  // "we have three tiers" stays true and the tier is never silently dropped.
  const tiers = Object.entries(floors)
    .filter(([id]) => id !== 'classic')
    .map(([id, floor]) => {
      const name = tierNames(rules, id, en);
      if (floor) return `${name} ${en ? 'from' : 'เริ่ม'} ${floor.priceFrom.toLocaleString('en-US')}${en ? ' THB' : ' บาท'}`;
      const note = launchNote(id);
      return note ? `${name} (${note})` : '';
    })
    .filter(Boolean)
    .join(en ? '; ' : ' · ');
  return en
    ? `Classic from ${money} THB/box${tiers ? `; ${tiers}` : ''}`
    : `เริ่ม ${money} บาท/กล่อง${tiers ? ` · ${tiers}` : ''}`;
}

// nameTh carries its English name for the first mention on a Thai page, so the
// llms.txt / llms-full.md print the English name once instead of twice.
function tierBothNames(tier) {
  const th = tier.nameTh.startsWith(tier.nameEn)
    ? tier.nameTh.slice(tier.nameEn.length).replace(/^[\s—–-]+/, '')
    : tier.nameTh;
  return { en: tier.nameEn, th };
}

function tierNames(rules, id, en) {
  const tier = (rules.services.mealBox.tiers || []).find((item) => item.id === id);
  return String((en ? tier?.nameEn : tier?.nameTh) || id);
}

export function serviceFacts(rules, id, en, floors = null) {
  const s = rules.services[id];
  if (id === 'tableService') return en
    ? `From ${s.priceFromPerTable.toLocaleString('en-US')} THB/table; ${s.seatsFrom}–${s.seatsTo} guests/table; minimum ${s.minimumTables} tables. Book at least ${s.leadTimeDays} days ahead.`
    : `เริ่ม ${s.priceFromPerTable.toLocaleString('en-US')} บาท/โต๊ะ โต๊ะละ ${s.seatsFrom}–${s.seatsTo} ท่าน ขั้นต่ำ ${s.minimumTables} โต๊ะ อาหาร ${s.courseCountFrom}–${s.courseCountTo} รายการ จองล่วงหน้าอย่างน้อย ${s.leadTimeDays} วัน`;
  if (id === 'mealBox') {
    const price = floors ? tierPriceLine(rules, floors, en) : (en ? 'See the meal-box tier table for each starting price.' : 'ดูราคาเริ่มต้นของแต่ละระดับได้ที่ตารางระดับข้าวกล่อง');
    return en
      ? `${price}. Minimum ${s.minimumOrder} boxes. Order at least ${s.leadTimeDays} day ahead. Per-menu minimums: ${s.standardMenuMinimum} standard / ${s.specialMenuMinimum} special-preparation boxes.`
      : `${price} ขั้นต่ำ ${s.minimumOrder} กล่อง สั่งล่วงหน้าอย่างน้อย ${s.leadTimeDays} วัน ขั้นต่ำต่อเมนูทั่วไป ${s.standardMenuMinimum} กล่อง / เมนูเตรียมพิเศษ ${s.specialMenuMinimum} กล่อง`;
  }
  return en
    ? `From ${s.priceFrom} THB/guest; minimum ${s.minimumGuests} guests${s.maximumGuests ? `; maximum ${s.maximumGuests} guests` : '; capacity confirmed for each event'}. Book at least ${s.leadTimeDays} days ahead.`
    : `เริ่ม ${s.priceFrom} บาท/ท่าน ขั้นต่ำ ${s.minimumGuests} คน${s.maximumGuests ? ` สูงสุด ${s.maximumGuests} คน` : ' จำนวนที่รองรับให้ทีมยืนยันตามงาน'} จองล่วงหน้าอย่างน้อย ${s.leadTimeDays} วัน`;
}

export function renderCatalog(rules, en, detailId, floors = null) {
  const ids = detailId ? [detailId] : rules.positioning.servicePriority;
  const names = en ? rules.positioning.serviceNamesEn : rules.positioning.serviceNamesTh;
  const url = (id) => new URL(rules.urls[id === 'mealBox' ? 'corporate' : id]).pathname.replace(/^\//, en ? '/en/' : '/');
  const cards = ids.map((id) => {
    const name = names[rules.positioning.servicePriority.indexOf(id)];
    return `<article class="catering-fact-card" data-service="${id}"><h3><a href="${url(id)}">${escape(name)}</a></h3><p>${escape(serviceFacts(rules, id, en, floors))}</p></article>`;
  }).join('\n');
  const summary = rules.positioning[en ? 'descriptionEn' : 'descriptionTh'];
  const policy = en
    ? `All listed services are halal. Final menus, equipment, staffing, capacity and transport costs are confirmed in your quotation. Locations outside Bangkok are quoted case by case. Deposit ${rules.paymentTerms.bookingDepositPercent}%; catering balance due ${rules.paymentTerms.cateringBalanceDaysBeforeEvent} days before the event, meal-box balance ${rules.paymentTerms.mealBoxBalanceDaysBeforeDelivery} day before delivery.`
    : `บริการทั้งหมดเป็นฮาลาล เมนู อุปกรณ์ ทีมบริการ จำนวนที่รองรับ และค่าขนส่งให้ทีมยืนยันในใบเสนอราคาของแต่ละงาน พื้นที่นอกกรุงเทพฯ สอบถามเป็นรายกรณี มัดจำ ${rules.paymentTerms.bookingDepositPercent}% งานจัดเลี้ยงชำระส่วนที่เหลือก่อนวันงาน ${rules.paymentTerms.cateringBalanceDaysBeforeEvent} วัน ข้าวกล่องก่อนส่ง ${rules.paymentTerms.mealBoxBalanceDaysBeforeDelivery} วัน`;
  return `<!-- BUSINESS-RULES:CATERING -->\n<section class="section catering-facts" aria-label="${en ? 'Halal catering services' : 'บริการจัดเลี้ยงฮาลาล'}"><div class="container"><h2>${detailId ? (en ? 'Service details and booking' : 'รายละเอียดบริการและการจอง') : escape(summary)}</h2><div class="catering-facts-grid">${cards}</div><p>${escape(policy)}</p><p>${en ? `Additional service: halal Snack Box / Coffee Break from ${rules.services.snackBox.priceFrom} THB/box, minimum ${rules.services.snackBox.minimumOrder} boxes.` : `บริการเสริม: Snack Box / Coffee Break ฮาลาล เริ่ม ${rules.services.snackBox.priceFrom} บาท/กล่อง ขั้นต่ำ ${rules.services.snackBox.minimumOrder} กล่อง`}</p><a class="btn btn-primary" href="/catering-brief.html">${en ? 'Request an event quotation' : 'ขอใบเสนอราคาจัดเลี้ยง'}</a> <a class="btn btn-outline" href="/popular-menu.html">${en ? 'Browse meal-box menus' : 'ดูรายการข้าวกล่อง'}</a></div></section>\n<!-- /BUSINESS-RULES:CATERING -->`;
}

export async function syncCateringContent({ write = false } = {}) {
  const rules = JSON.parse(await read('data/business-rules.json'));
  // Tier prices come from the published catalogue; this module never stores one.
  const planner = JSON.parse(await read('data/planner-overrides.json'));
  const sets = setsFromPlanner(planner);
  const sideItems = sideItemsFromPlanner(planner);
  const { floors } = tierContext(rules, sets, sideItems);
  // Structured data may only quote a meal-box price range the catalogue backs.
  const prices = sets.map((set) => set.price).filter((price) => Number.isFinite(price) && price > 0);
  const boxRange = prices.length
    ? { min: Math.min(...prices), max: Math.max(...prices), count: prices.length }
    : null;
  const changes = [];
  // Compare and write with the file's own line endings, so a Windows checkout
  // and a CI checkout produce the same generated bytes.
  const plan = async (file, next) => {
    const old = await read(file).catch(() => '');
    const crlf = old.includes('\r\n');
    const lf = next.replaceAll('\r\n', '\n');
    const wanted = crlf ? lf.replaceAll('\n', '\r\n') : lf;
    if (old !== wanted) changes.push({ file, next: wanted });
  };
  const urls = rules.positioning.servicePriority.map(id => rules.urls[id === 'mealBox' ? 'corporate' : id]);
  const names = (en) => rules.positioning[en ? 'serviceNamesEn' : 'serviceNamesTh'];
  const details = { 'buffet.html': 'buffet', 'cocktail.html': 'cocktail', 'table-service.html': 'tableService', 'set-menu.html': 'setMenu', 'live-cooking-station.html': 'liveCooking' };
  const overviewPages = ['index.html', 'catering.html', 'about.html', 'faq.html'];
  const tierTablePages = ['popular-menu.html'];
  const tierCardPages = ['index.html'];
  for (const file of await htmlFiles()) {
    // Work in LF and let plan() restore the file's own convention on write.
    let html = (await read(file)).replaceAll('\r\n', '\n');
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
      const block = renderCatalog(rules, en, details[base], floors);
      if (html.includes('<!-- BUSINESS-RULES:CATERING -->')) html = html.replace(/<!-- BUSINESS-RULES:CATERING -->[\s\S]*?<!-- \/BUSINESS-RULES:CATERING -->/, block);
      else {
        const h1 = html.indexOf('</h1>');
        const end = html.indexOf('</section>', h1) + '</section>'.length;
        if (h1 < 0 || end < '</section>'.length) throw new Error(`${file}: missing hero section`);
        html = html.slice(0, end) + '\n' + block + html.slice(end);
      }
    }
    if (tierTablePages.includes(base)) {
      const block = renderTierTable({ rules, sets, overrides: planner, en });
      const re = /<!-- BUSINESS-RULES:MEALBOX-TIERS:(?:TH|EN) -->[\s\S]*?<!-- \/BUSINESS-RULES:MEALBOX-TIERS:(?:TH|EN) -->/;
      if (html.includes('<!-- BUSINESS-RULES:MEALBOX-TIERS:')) html = html.replace(re, block);
      else throw new Error(`${file}: place <!-- BUSINESS-RULES:MEALBOX-TIERS:${en ? 'EN' : 'TH'} --> where the tier table belongs (before the menu list)`);
    }
    if (tierCardPages.includes(base)) {
      const block = renderTierCards({ rules, sets, overrides: planner, en });
      const re = /<!-- BUSINESS-RULES:MEALBOX-TIER-CARDS:(?:TH|EN) -->[\s\S]*?<!-- \/BUSINESS-RULES:MEALBOX-TIER-CARDS:(?:TH|EN) -->/;
      if (html.includes('<!-- BUSINESS-RULES:MEALBOX-TIER-CARDS:')) html = html.replace(re, block);
      else throw new Error(`${file}: place <!-- BUSINESS-RULES:MEALBOX-TIER-CARDS:${en ? 'EN' : 'TH'} --> where the tier cards belong`);
    }
    // These service pages previously had no structured data. Keep their graph
    // generated from the same facts as the visible service details, in both languages.
    if (['cocktail.html', 'table-service.html', 'set-menu.html'].includes(base)) {
      const url = `${new URL(rules.urls[details[base]]).origin}/${file}`;
      const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
      const description = /<meta\b[^>]*name="description"[^>]*content="([^"]*)"/.exec(html)?.[1];
      const serviceName = names(en)[rules.positioning.servicePriority.indexOf(details[base])];
      const provider = { '@id': 'https://eedhalal.com/#organization' };
      const graph = {
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'Organization', ...provider, name: rules.business.name, url: 'https://eedhalal.com/', description: summary },
          { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: title, description, inLanguage: en ? 'en' : 'th', mainEntity: { '@id': `${url}#service` } },
          { '@type': 'Service', '@id': `${url}#service`, url, name: serviceName, description: serviceFacts(rules, details[base], en, floors), provider },
          { '@type': 'BreadcrumbList', itemListElement: [
            { '@type': 'ListItem', position: 1, name: en ? 'Home' : 'หน้าแรก', item: en ? 'https://eedhalal.com/en/index.html' : 'https://eedhalal.com/' },
            { '@type': 'ListItem', position: 2, name: serviceName, item: url },
          ] },
        ],
      };
      const block = `<!-- BUSINESS-RULES:SERVICE-SCHEMA -->\n<script type="application/ld+json">\n${JSON.stringify(graph, null, 2)}\n</script>\n<!-- /BUSINESS-RULES:SERVICE-SCHEMA -->`;
      const marker = /<!-- BUSINESS-RULES:SERVICE-SCHEMA -->[\s\S]*?<!-- \/BUSINESS-RULES:SERVICE-SCHEMA -->/;
      html = marker.test(html) ? html.replace(marker, block) : html.replace('</head>', `${block}\n</head>`);
    }
    // Provider identity belongs to the business; retain page-specific Service and article descriptions.
    html = html.replace(/(<script\b[^>]*type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi, (all, open, body, close) => {
      let graph;
      try { graph = JSON.parse(body); } catch { return all; }
      let changed = false;
      const catalog = { '@type': 'OfferCatalog', name: en ? 'Halal catering services' : 'บริการจัดเลี้ยงฮาลาล', itemListElement: rules.positioning.servicePriority.map((id, i) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: names(en)[i], url: new URL(urls[i]).origin + new URL(urls[i]).pathname.replace(/^\//, en ? '/en/' : '/'), description: serviceFacts(rules, id, en, floors) } })) };
      const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if ([node['@type']].flat().some(type => ['Organization', 'FoodEstablishment', 'LocalBusiness', 'Restaurant'].includes(type)) && /EED HALAL/i.test(node.name || '')) {
          if (node.description !== summary) { node.description = summary; changed = true; }
          if (overviewPages.includes(base)) {
            if (JSON.stringify(node.hasOfferCatalog) !== JSON.stringify(catalog)) { node.hasOfferCatalog = catalog; changed = true; }
          }
          // A meal-box price range is only published while sets exist; without
          // them the range is dropped rather than repeating an old figure.
          if (typeof node.priceRange === 'string' && /(บาท\/กล่อง|per box)/.test(node.priceRange)) {
            if (boxRange) {
              const nextRange = en ? `THB ${boxRange.min}-${boxRange.max} per box` : `${boxRange.min}-${boxRange.max} บาท/กล่อง`;
              if (node.priceRange !== nextRange) { node.priceRange = nextRange; changed = true; }
            } else if (delete node.priceRange) changed = true;
          }
        }
        // Meal-box AggregateOffer: min/max/count come from the published sets.
        if (node['@type'] === 'Product' && boxRange && /meal box|ข้าวกล่อง/i.test(`${node.name || ''} ${node.description || ''}`)) {
          const offer = node.offers && node.offers['@type'] === 'AggregateOffer' ? node.offers : null;
          if (offer) {
            const nextOffer = { ...offer, lowPrice: String(boxRange.min), highPrice: String(boxRange.max), offerCount: String(boxRange.count) };
            if (JSON.stringify(offer) !== JSON.stringify(nextOffer)) { node.offers = nextOffer; changed = true; }
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

  const tierKnowledge = (rules.services.mealBox.tiers || []).map((tier) => {
    const { en, th } = tierBothNames(tier);
    const floor = floors[tier.id];
    const launching = !floor && tier.launchStatus === 'launching';
    const price = floor
      ? `from ${floor.priceFrom} THB/box (cheapest set: ${floor.sourceName}, ID ${floor.sourceId})`
      : launching
        ? 'launching soon — not orderable yet, so never quote a price; invite the customer to ask on LINE to be told when it opens'
        : 'no set open for sale — ask the team for a quotation, never guess a price';
    const lines = [`- ${en}${th ? ` (${th})` : ''}: ${price}. Best for: ${tier.bestForEn}.`];
    if (launching && tier.launchNoteEn) lines.push(`  ${tier.launchNoteEn}`);
    if (tier.boxFormatEn) lines.push(`  Box: ${tier.boxFormatEn}.`);
    const sides = sideChoiceSummary(tier, sideItems, true);
    if (sides) lines.push(`  ${sides}`);
    if (tier.sideChoiceNoteEn) lines.push(`  ${tier.sideChoiceNoteEn}`);
    return lines.join('\n');
  }).join('\n');
  const knowledge = `## Service priority and canonical facts\n${rules.positioning.descriptionEn}\n${rules.positioning.descriptionTh}\n\n${rules.positioning.servicePriority.map((id, i) => `${i + 1}. ${names(false)[i]} / ${names(true)[i]} — ${serviceFacts(rules, id, true, floors)} ${urls[i]}`).join('\n')}\n\nAll services above are halal. Snack Box is an additional service: from ${rules.services.snackBox.priceFrom} THB/box, minimum ${rules.services.snackBox.minimumOrder} boxes.\n\n## Meal-box tiers\n${tierKnowledge}\nTier starting prices are computed from the sets open for sale, never typed by hand.\nBusiness data source: \`data/business-rules.json\`. Match the customer's specific service request; this priority is for general business introductions.\n`;
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
