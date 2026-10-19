// Print the business facts the agents must quote from, read live from the files
// that are the source of truth. Never a number typed by a model.
//
//   node tools/agent/context.mjs            human-readable Thai/English facts
//   node tools/agent/context.mjs --json     machine-readable
//
// Secrets are never read here. Prices come from the published catalogue, tier
// floors are computed from it, and the whole output is rebuilt on every run.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

const readJson = async (relative) => JSON.parse(await readFile(path.join(ROOT, relative), 'utf8'));

function tierFloorsFromPlanner(planner = {}) {
  const floors = new Map();
  const prices = planner.prices || {};
  const tiers = planner.tiers || {};
  const names = planner.names || {};
  const deleted = new Set((planner.deleted || []).map(Number));
  const quoteOnly = new Set((planner.quoteOnly || []).map(Number));

  for (const [id, raw] of Object.entries(prices)) {
    const menuId = Number(id);
    const price = Number(raw);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (deleted.has(menuId) || quoteOnly.has(menuId)) continue;
    const tier = String(tiers[id] || 'classic');
    const current = floors.get(tier);
    if (current === undefined || price < current.price) {
      floors.set(tier, { tier, price, id: menuId, name: names[id] || '' });
    }
  }
  return [...floors.values()].sort((a, b) => a.price - b.price);
}

export function buildBusinessContext({ rules, planner }) {
  const mealBox = rules?.services?.mealBox || {};
  const snackBox = rules?.services?.snackBox || {};
  const delivery = rules?.delivery || {};
  const documents = rules?.documents || {};
  const payment = rules?.paymentTerms || {};

  const tiers = (mealBox.tiers || []).map((tier) => {
    const floor = tierFloorsFromPlanner(planner).find((row) => row.tier === tier.id);
    return {
      id: tier.id,
      nameTh: tier.nameTh,
      nameEn: tier.nameEn,
      boxFormatTh: tier.boxFormatTh || '',
      boxFormatEn: tier.boxFormatEn || '',
      secondDishLabelTh: tier.sideChoiceLabelTh || null,
      priceFrom: floor ? floor.price : null,
      sourceMenuId: floor ? floor.id : null,
      sourceMenuName: floor ? floor.name : null,
    };
  });

  return {
    revision: rules?.revision || null,
    business: {
      name: rules?.business?.name || '',
      phone: rules?.business?.phone || '',
      address: rules?.business?.address || '',
      operatingHours: rules?.business?.operatingHours || '',
      halalCertificate: rules?.business?.halalCertificate || '',
    },
    mealBox: {
      minimumOrder: mealBox.minimumOrder ?? null,
      standardMenuMinimum: mealBox.standardMenuMinimum ?? null,
      specialMenuMinimum: mealBox.specialMenuMinimum ?? null,
      menuCountFrom: mealBox.menuCountFrom ?? null,
      leadTimeDays: mealBox.leadTimeDays ?? null,
      tiers,
    },
    snackBox: { priceFrom: snackBox.priceFrom ?? null, minimumOrder: snackBox.minimumOrder ?? null },
    delivery: {
      policy: delivery.policy || '',
      messageTh: delivery.messageTh || '',
      messageEn: delivery.messageEn || '',
      coverageTh: delivery.coverageTh || '',
      outsideBangkok: delivery.outsideBangkok || '',
    },
    cutoff: { time: rules?.cutoff?.time || '', description: rules?.cutoff?.description || '' },
    documents: {
      vatRegistered: documents.vatRegistered ?? null,
      taxInvoiceAvailable: documents.taxInvoiceAvailable ?? null,
      quoteWithinMinutes: documents.quoteWithinMinutes ?? null,
      available: documents.available || [],
    },
    paymentTerms: {
      bookingDepositPercent: payment.bookingDepositPercent ?? null,
      cateringBalanceDaysBeforeEvent: payment.cateringBalanceDaysBeforeEvent ?? null,
      mealBoxBalanceDaysBeforeDelivery: payment.mealBoxBalanceDaysBeforeDelivery ?? null,
    },
    leadTimes: rules?.leadTimes || [],
    catalogue: {
      exportedAt: planner?.exportedAt || null,
      releaseCentralVersion: planner?.release?.centralVersion ?? null,
      menuCount: Object.keys(planner?.prices || {}).length,
    },
  };
}

function render(context) {
  const lines = [];
  const push = (line = '') => lines.push(line);

  push(`EED HALAL — ข้อมูลธุรกิจจริง (revision ${context.revision || 'ไม่ระบุ'})`);
  push('='.repeat(60));
  push(`ร้าน      : ${context.business.name}`);
  if (context.business.phone) push(`โทร       : ${context.business.phone}`);
  if (context.business.operatingHours) push(`เวลาทำการ : ${context.business.operatingHours}`);
  push('');
  push('ข้าวกล่องฮาลาล');
  push(`  ขั้นต่ำสั่งรวม      : ${context.mealBox.minimumOrder ?? '-'} กล่อง`);
  push(`  ขั้นต่ำต่อเมนู     : ${context.mealBox.standardMenuMinimum ?? '-'}`);
  push(`  จำนวนเมนูขั้นต่ำ  : ${context.mealBox.menuCountFrom ?? '-'}`);
  push(`  เตรียมสินค้าล่วงหน้า : ${context.mealBox.leadTimeDays ?? '-'} วัน`);
  push('  ราคาเริ่มต้นต่อระดับ:');
  for (const tier of context.mealBox.tiers) {
    const price = tier.priceFrom === null ? 'ไม่มีเมนูที่เปิดขาย' : `${tier.priceFrom} บาท/กล่อง`;
    push(`    - ${tier.nameTh || tier.id}: ${price}`);
    if (tier.boxFormatTh) push(`      ${tier.boxFormatTh}`);
    if (tier.secondDishLabelTh) push(`      มี${tier.secondDishLabelTh}ให้เลือก 1 อย่างต่อกล่อง`);
  }
  push('');
  push('Snack Box');
  push(`  ราคาเริ่มต้น : ${context.snackBox.priceFrom ?? '-'} บาท`);
  push(`  ขั้นต่ำ     : ${context.snackBox.minimumOrder ?? '-'} ชิ้น`);
  push('');
  push('การจัดส่ง');
  if (context.delivery.messageTh) push(`  ${context.delivery.messageTh}`);
  if (context.delivery.coverageTh) push(`  พื้นที่: ${context.delivery.coverageTh}`);
  if (context.delivery.outsideBangkok) push(`  นอกเขต: ${context.delivery.outsideBangkok}`);
  push('');
  push('เงื่อนไขอื่น');
  if (context.cutoff.time) push(`  ตัดออเดอร์: ${context.cutoff.time} (${context.cutoff.description})`);
  if (context.paymentTerms.bookingDepositPercent !== null) {
    push(`  มัดจำจองงาน: ${context.paymentTerms.bookingDepositPercent}%`);
  }
  if (context.documents.quoteWithinMinutes) {
    push(`  ตอบใบเสนอราคาภายใน: ${context.documents.quoteWithinMinutes} นาที`);
  }
  push(`  VAT: ${context.documents.vatRegistered ? 'มี' : 'ไม่มี'} · ใบกำกับภาษี: ${context.documents.taxInvoiceAvailable ? 'มี' : 'ไม่มี'}`);
  push('');
  push(`แคตตาล็อก: ${context.catalogue.menuCount} เมนู · ออกเมื่อ ${context.catalogue.exportedAt || '-'}`);
  push('='.repeat(60));
  return lines.join('\n');
}

export async function loadBusinessContext() {
  const [rules, planner] = await Promise.all([
    readJson('data/business-rules.json'),
    readJson('data/planner-overrides.json'),
  ]);
  return buildBusinessContext({ rules, planner });
}

async function main() {
  const context = await loadBusinessContext();
  const wantsJson = process.argv.slice(2).includes('--json');
  process.stdout.write(`${wantsJson ? JSON.stringify(context, null, 2) : render(context)}\n`);
}

if (isCli) {
  main().catch((error) => {
    process.stderr.write(`อ่านข้อมูลธุรกิจไม่สำเร็จ: ${error.message}\n`);
    process.exitCode = 1;
  });
}