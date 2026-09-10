import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { syncBusinessContent } from '../scripts/sync-business-content.mjs';

const root = new URL('../', import.meta.url);
const thaiAddressPolicy = 'ค่าจัดส่งและเงื่อนไขส่งฟรีขึ้นอยู่กับเขตของสถานที่จัดส่ง กรุณาระบุที่อยู่หรือพิกัดเพื่อเช็กค่าจัดส่ง';
const localFaqBaselines = {
  'ladprao.html': ['EED HALAL ส่งข้าวกล่องฮาลาลในลาดพร้าวฟรีไหม?', 'สั่งข้าวกล่องฮาลาลในลาดพร้าวขั้นต่ำกี่กล่อง?', 'EED HALAL มีใบรับรองฮาลาลหรือไม่?', 'ต้องสั่งข้าวกล่องฮาลาลล่วงหน้ากี่วัน?'],
  'rama3.html': ['EED HALAL ส่งข้าวกล่องฮาลาลในพระราม 3 ฟรีไหม?', 'สั่งข้าวกล่องฮาลาลในพระราม 3 ขั้นต่ำกี่กล่อง?', 'EED HALAL มีใบรับรองฮาลาลหรือไม่?', 'ต้องสั่งข้าวกล่องฮาลาลล่วงหน้ากี่วัน?'],
  'sathorn-silom.html': ['EED HALAL ส่งสาทร-สีลมฟรีไหม?', 'สั่งข้าวกล่องฮาลาลในสาทร-สีลมขั้นต่ำกี่กล่อง?', 'EED HALAL มีใบรับรองฮาลาลหรือไม่?', 'ต้องสั่งข้าวกล่องฮาลาลล่วงหน้ากี่วัน?'],
  'silom.html': ['มีบริการข้าวกล่องฮาลาลส่งถึงออฟฟิศในสีลมไหม?', 'ข้าวกล่องฮาลาลสีลมราคาเริ่มต้นเท่าไหร่?', 'รับทำข้าวกล่องฮาลาลสำหรับประชุมไหม?', 'EED HALAL ส่งข้าวกล่องฮาลาลในสีลมฟรีไหม?', 'สั่งข้าวกล่องฮาลาลในสีลมขั้นต่ำกี่กล่อง?', 'EED HALAL มีใบรับรองฮาลาลหรือไม่?', 'ต้องสั่งข้าวกล่องฮาลาลล่วงหน้ากี่วัน?'],
  'sukhumvit.html': ['EED HALAL ส่งข้าวกล่องฮาลาลในสุขุมวิทฟรีไหม?', 'สั่งข้าวกล่องฮาลาลในสุขุมวิทขั้นต่ำกี่กล่อง?', 'EED HALAL มีใบรับรองฮาลาลหรือไม่?', 'ต้องสั่งข้าวกล่องฮาลาลล่วงหน้ากี่วัน?'],
};

function jsonLd(html) {
  const activeHtml = html.replace(/<!--[\s\S]*?-->/g, '');
  return [...activeHtml.matchAll(/<script\b(?=[^>]*\btype=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap((match) => JSON.parse(match[1])['@graph']);
}

test('business-content sync check is idempotent', async () => {
  assert.deepEqual(await syncBusinessContent({ check: true }), []);
  assert.deepEqual(await syncBusinessContent({ dryRun: true }), []);
});

test('local pages preserve complete JSON-LD graphs and FAQ baseline semantics', async () => {
  for (const [file, names] of Object.entries(localFaqBaselines)) {
    const html = await readFile(new URL(file, root), 'utf8');
    const graph = jsonLd(html);
    assert.equal(graph.length, 5);
    assert.deepEqual(new Set(graph.map((node) => node['@type'])), new Set(['Organization', 'WebPage', 'Service', 'BreadcrumbList', 'FAQPage']));
    const faq = graph.find((node) => node['@type'] === 'FAQPage');
    assert.equal(faq.mainEntity.length, names.length);
    assert.deepEqual(faq.mainEntity.map((question) => question.name), names);
    assert.equal(faq.mainEntity.find((question) => question.name.includes('ฟรีไหม'))?.acceptedAnswer.text, thaiAddressPolicy);
    assert.doesNotMatch(JSON.stringify(graph), /priceValidUntil/);
  }
});

test('ambiguous neighborhood pages do not guarantee a delivery threshold', async () => {
  for (const file of ['en/huaykwang.html', 'en/donmueang.html']) {
    const html = await readFile(new URL(file, root), 'utf8');
    assert.match(html, /Delivery fees and free-delivery eligibility depend on the district/);
    assert.doesNotMatch(html, /free delivery across .*?(?:75|100)\+ boxes/i);
  }
});
