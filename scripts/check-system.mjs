import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

async function loadLegacyData(root = ROOT) {
  const context = {
    document: { readyState: 'complete', querySelectorAll: () => [] },
    window: {},
  };
  vm.createContext(context);
  vm.runInContext(await readFile(path.join(root, 'js/business-data.js'), 'utf8'), context);
  vm.runInContext(await readFile(path.join(root, 'js/menu-data.js'), 'utf8'), context);
  vm.runInContext(await readFile(path.join(root, 'js/snack-data.js'), 'utf8'), context);
  return {
    business: JSON.parse(JSON.stringify(context.EED)),
    menus: JSON.parse(JSON.stringify(context.EED_MENUS)),
    snackMinimumOrder: context.EED_SNACK_MIN_ORDER,
  };
}

export async function loadSystemData(root = ROOT) {
  const [rules, catalog, legacy] = await Promise.all([
    readJson(root, 'data/business-rules.json'),
    readJson(root, 'data/planner-overrides.json'),
    loadLegacyData(root),
  ]);
  return { rules, catalog, legacy };
}

export function getEffectiveMenus(menus, catalog) {
  const deleted = new Set(catalog.deleted || []);
  return menus
    .filter((menu) => !deleted.has(menu.id))
    .map((menu) => ({
      ...menu,
      name: catalog.names?.[menu.id] ?? menu.name,
      price: catalog.prices?.[menu.id] ?? menu.price,
      category: catalog.categories?.[menu.id] ?? menu.category,
      image: catalog.images?.[menu.id] ?? menu.image,
      minPerMenu: catalog.mins?.[menu.id] ?? menu.minPerMenu,
    }));
}

export function calculateShipping(rules, catalog, district, quantity) {
  assert.ok(Number.isInteger(quantity) && quantity > 0, 'quantity must be a positive integer');
  const entry = Object.entries(rules.delivery.zones).find(([, zone]) =>
    zone.districts.some((item) => item.toLocaleLowerCase('th-TH') === district.trim().toLocaleLowerCase('th-TH')),
  );
  if (!entry) return { found: false, fee: null, isFree: false, zoneId: null };

  const [zoneId, zone] = entry;
  const freeFrom = Number(zone.freeFrom) || null;
  const isFree = freeFrom !== null && quantity >= freeFrom;
  const vehicle = quantity > rules.delivery.carWhenQuantityAbove ? 'car' : 'moto';
  return {
    found: true,
    zoneId,
    zoneLabel: zone.label,
    vehicle,
    freeFrom,
    isFree,
    fee: isFree ? 0 : zone[vehicle],
  };
}

export function getLeadTime(rules, quantity) {
  return rules.leadTimes.find((range) =>
    quantity >= range.minQuantity && (range.maxQuantity === null || quantity <= range.maxQuantity),
  ) || null;
}

function formatRange(range) {
  if (range.maxQuantity === null && range.minimumBusinessDays) return `${range.minQuantity}+ กล่อง: แนะนำสั่งล่วงหน้าอย่างน้อย ${range.minimumBusinessDays} วัน`;
  if (range.maxQuantity === null) return `${range.minQuantity}+ กล่อง: ล่วงหน้า ${range.minimumWeeks}-${range.maximumWeeks} สัปดาห์`;
  return `${range.minQuantity}-${range.maxQuantity} กล่อง: ล่วงหน้า ${range.minimumBusinessDays}-${range.maximumBusinessDays} วันทำการ`;
}

export function renderKnowledge(rules, catalog, menus) {
  const meal = rules.services.mealBox;
  const snack = rules.services.snackBox;
  const buffet = rules.services.buffet;
  const liveCooking = rules.services.liveCooking;
  const cocktail = rules.services.cocktail;
  const tableService = rules.services.tableService;
  const setMenu = rules.services.setMenu;
  const payment = rules.paymentTerms;
  const specialMenus = getEffectiveMenus(menus, catalog)
    .filter((menu) => menu.minPerMenu === meal.specialMenuMinimum)
    .map((menu) => menu.name)
    .join(', ');
  const zoneLines = Object.entries(rules.delivery.zones).map(([zoneId, zone]) => {
    const freeFrom = Number(zone.freeFrom) || null;
    const deliveryText = freeFrom
      ? `ส่งฟรี ${freeFrom}+ กล่อง, ไม่ถึงเกณฑ์ มอเตอร์ไซค์ ${zone.moto} บาท รถยนต์ ${zone.car} บาท`
      : `ไม่มีส่งฟรี ต้องสอบถามก่อน ค่าส่งมอเตอร์ไซค์/รถยนต์ ${zone.moto}/${zone.car} บาท`;
    return `- ${zone.label} (${zone.districts.join(' ')}): ${deliveryText}`;
  }).join('\n');
  const leadTimeLines = rules.leadTimes.map((range) => `- ${formatRange(range)}`).join('\n');
  const guestRange = (minimum, maximum) => maximum === null ? `${minimum}+ คน (จำนวนที่รองรับให้ทีมยืนยันตามงาน)` : `${minimum}–${maximum} คน`;

  // Meal-box prices are NEVER baked into the prompt: the live Internal Menu
  // API (planner-backed) supplies MENU_CONTEXT per request. This section is
  // a strict runtime rule, not a catalog.

  return `# EED HALAL - Knowledge Pack สำหรับ LINE AI
> GENERATED FILE: สร้างจาก data/business-rules.json + data/planner-overrides.json (catalog only)
> Business rules revision: ${rules.revision} (schema ${rules.schemaVersion})
> ห้ามแก้ไฟล์นี้โดยตรง ให้แก้ข้อมูลต้นทางแล้วรัน node scripts/check-system.mjs --write

## 1. ตัวตนร้าน
- ชื่อ: ${rules.business.name} (ดำเนินงานในนาม ${rules.business.name})
- คำอธิบายธุรกิจ: ${rules.positioning.descriptionTh}
- Business description: ${rules.positioning.descriptionEn}
- ลำดับบริการหลัก (ฮาลาลทั้งหมด): ${rules.positioning.serviceNamesTh.join(" > ")}
- ใช้ลำดับนี้เมื่อแนะนำภาพรวมร้าน; หากลูกค้าระบุบริการแล้ว ให้ตอบบริการนั้นก่อน Snack Box / Coffee Break เป็นบริการเสริม
- เจ้าของ: ${rules.business.owner} สูตรครัวครอบครัว ${rules.business.experienceYears}+ ปี (ไทย+อินเดีย)
- ที่อยู่: ${rules.business.address}
- เวลาทำการ: ${rules.business.operatingDays} ${rules.business.operatingHours} (อาทิตย์ปิด)
- โทร: ${rules.business.phone}
- ช่องทางติดต่อ: แชท LINE นี้เลย ลูกค้าอยู่ในแชทนี้แล้ว ไม่ต้องแนะนำลิงก์ LINE ซ้ำ
- เว็บ: ${rules.urls.home}
- ฮาลาล: รับรอง CICOT เลขที่ ${rules.business.halalCertificate} ขอสำเนาในแชทนี้ได้

## 2. ราคาและขั้นต่ำ
- ข้าวกล่องมาตรฐาน: เริ่ม ${meal.priceFrom} บาท/กล่อง
- เมนูพรีเมียม: เริ่ม ${meal.premiumPriceFrom}-${meal.premiumPriceTo} บาท/กล่อง
- Snack Box: เริ่ม ${snack.priceFrom} บาท/กล่อง ขั้นต่ำ ${snack.minimumOrder} กล่อง
- ข้าวกล่องฮาลาล: เริ่ม ${meal.priceFrom} บาท/กล่อง ขั้นต่ำ ${meal.minimumOrder} กล่อง รองรับ ${meal.minimumOrder}+ กล่อง (จำนวนที่รองรับให้ทีมยืนยันตามงาน) ${meal.halalMaterial} ${meal.packaging} และ${meal.fulfillment}
- บุฟเฟต์ฮาลาล: เริ่ม ${buffet.priceFrom} บาท/หัว ขั้นต่ำ ${buffet.minimumGuests} คน รองรับ ${guestRange(buffet.minimumGuests, buffet.maximumGuests)} เมนู ${buffet.serviceCategories} หมวด ทีม${buffet.serviceTeam}
- Live Cooking / ซุ้มปรุงสด: เริ่ม ${liveCooking.priceFrom} บาท/หัว รองรับ ${guestRange(liveCooking.minimumGuests, liveCooking.maximumGuests)} ${liveCooking.serviceStyle} เหมาะกับ${liveCooking.recommendedFor}
- Cocktail / Finger Food ฮาลาล: เริ่ม ${cocktail.priceFrom} บาท/หัว ขั้นต่ำ ${cocktail.minimumGuests} คน รองรับ ${guestRange(cocktail.minimumGuests, cocktail.maximumGuests)} ${cocktail.serviceStyle} ทีม${cocktail.serviceTeam}
- โต๊ะจีน / โต๊ะไทย ฮาลาล: เริ่ม ${tableService.priceFromPerTable.toLocaleString('en-US')} บาท/โต๊ะ (${tableService.seatsFrom}–${tableService.seatsTo} ท่าน) ขั้นต่ำ ${tableService.minimumTables} โต๊ะ รองรับ ${tableService.minimumTables}+ โต๊ะ (จำนวนที่รองรับให้ทีมยืนยันตามงาน) เมนูคาว-หวาน ${tableService.courseCountFrom}–${tableService.courseCountTo} รายการ ทีม${tableService.serviceTeam}
- Set Menu / Sit-down Dinner ฮาลาล: เริ่ม ${setMenu.priceFrom} บาท/หัว ขั้นต่ำ ${setMenu.minimumGuests} คน รองรับ ${guestRange(setMenu.minimumGuests, setMenu.maximumGuests)} ${setMenu.serviceStyle} ${setMenu.courseCountFrom}–${setMenu.courseCountTo} คอร์ส ทีม${setMenu.serviceTeam}
- ขั้นต่ำออเดอร์องค์กร: ${meal.minimumOrder}+ กล่อง
- ขั้นต่ำต่อเมนู: เมนูทั่วไปส่วนมาก ${meal.standardMenuMinimum} กล่อง เมนูที่ต้องเตรียมพิเศษ ${meal.specialMenuMinimum} กล่อง ให้ยึดขั้นต่ำรายเมนูจากระบบ
- เมนูขั้นต่ำ ${meal.specialMenuMinimum} กล่องปัจจุบัน: ${specialMenus}
- สั่ง 1 กล่อง: ไม่รับผ่านเว็บ ให้ไปสั่งผ่าน LINEMAN
- มี ${meal.menuCountFrom}+ เมนู ปรับเผ็ดและเครื่องได้

## 3. ส่งฟรีและค่าส่ง
- กฎรถ: ออเดอร์ <=${rules.delivery.carWhenQuantityAbove} กล่องใช้เรทมอเตอร์ไซค์, >${rules.delivery.carWhenQuantityAbove} กล่องใช้เรทรถยนต์
${zoneLines}
- นอกแผนที่ เช่น นนทบุรี สมุทรปราการ ปทุมธานี และต่างจังหวัด: ไม่มีส่งฟรี ${rules.delivery.outsideBangkok}

## 4. เวลาสั่งล่วงหน้าและ cutoff
${leadTimeLines}
- งานบุฟเฟต์ ซุ้มปรุงสด Cocktail โต๊ะจีน/โต๊ะไทย และ Set Menu: แนะนำจองอย่างน้อย ${buffet.leadTimeDays} วัน
- ยืนยันจำนวน เมนู เวลา และจุดส่งภายใน ${rules.cutoff.time} น. ของ${rules.cutoff.description}
- ใบเสนอราคา: ปกติภายใน ${rules.documents.quoteWithinMinutes} นาทีหลังติดต่อเข้ามาในเวลาทำการ
- งานเร่งด่วนต้องส่งให้ทีมตรวจคิว ห้ามรับปากแทนครัว

## 5. VAT และเอกสาร
${rules.documents.vatCharge
  ? '- ราคาที่แจ้งเป็นไปตามเงื่อนไข VAT ในกฎธุรกิจปัจจุบัน ให้ยึดกฎธุรกิจเป็นหลักเท่านั้น'
  : `- ราคาที่แจ้งเป็นราคาสุทธิสุดท้าย ไม่บวก VAT เพิ่ม เพราะ EED ไม่ได้จดทะเบียน VAT และไม่เรียกเก็บ VAT จากลูกค้า
- ห้ามพูดว่า "ไม่รวม VAT" / "ยังไม่รวม VAT" / "excluding VAT" / "VAT excluded" / "บวก VAT เพิ่ม" — ประโยคเหล่านี้ทำให้ลูกค้าเข้าใจผิดว่าจะมี VAT เพิ่มภายหลัง
- ถ้าลูกค้าถามเรื่อง VAT โดยตรง: ตอบว่า EED ไม่ได้จดทะเบียน VAT ราคาที่แจ้งจึงไม่มี VAT เพิ่ม ออกได้แค่ใบเสนอราคา + ใบเสร็จรับเงินแบบธรรมดา และออกใบกำกับภาษี / Tax Invoice ไม่ได้ทุกกรณี
- VAT กับภาษีหัก ณ ที่จ่ายเป็นคนละเรื่องกัน ห้ามอนุมานเรื่องหัก ณ ที่จ่ายจากสถานะ VAT
- ถ้าลูกค้าถามเรื่องหัก ณ ที่จ่าย: ห้ามเดา ห้ามระบุอัตรา ห้ามบอกว่ามีหรือไม่มี ให้ตอบว่า "ขออนุญาตตรวจสอบเรื่องหัก ณ ที่จ่ายกับทางทีมก่อนนะคะ" แล้วส่งต่อให้ทีม`}
- ออกได้: ${rules.documents.available.join(' + ')}
- ออกใบกำกับภาษี / Tax Invoice ไม่ได้ทุกกรณี
- ฝ่ายจัดซื้อแจ้งชื่อบริษัทและที่อยู่ในแชทนี้เพื่อออกเอกสาร
- เงื่อนไขชำระเงิน: ชำระมัดจำ ${payment.bookingDepositPercent}% เพื่อยืนยันวันจอง; งานจัดเลี้ยงชำระส่วนที่เหลือก่อนวันงาน ${payment.cateringBalanceDaysBeforeEvent} วัน; ข้าวกล่องชำระส่วนที่เหลือก่อนส่งมอบ ${payment.mealBoxBalanceDaysBeforeDelivery} วัน

## 6. วิธีสั่งและปิดการขาย
1. ดูเมนูที่ ${rules.urls.menu}, ${rules.urls.catering} หรือ ${rules.urls.corporate}
2. แจ้งจำนวน งบต่อหัว วัน เวลา และสถานที่ในแชทนี้
3. AI ช่วยตรวจข้อมูล คำนวณเบื้องต้น และสรุป brief
4. ทีมงานตรวจราคา ค่าส่ง และคิวครัวก่อนยืนยันออเดอร์

## 7. กฎกันข้อมูลผิด
- ห้ามเดาราคา ขั้นต่ำ ค่าส่ง lead time VAT หรือข้อมูลฮาลาล
- ห้ามบอกว่าส่งทั่วประเทศ มีตะกร้าชำระเงินบนเว็บ หรือออก VAT ได้
- ถ้าข้อมูลธุรกิจ (เช่น ระยะเวลายืนราคา ค่าบริการเพิ่มเติม วิธีชำระเงินที่นอกเหนือจากที่ระบุ หรือภาษีหัก ณ ที่จ่าย) ไม่มีในกฎธุรกิจปัจจุบัน ห้ามเดาหรือสร้างนโยบายขึ้นเอง ให้ขอให้ทีมยืนยัน
- ถ้าไม่พบข้อมูล ให้ตอบส่วนที่ทราบและระบุส่วนที่ต้องให้ทีมตรวจสอบในแชทนี้ ขอเบอร์เฉพาะเมื่อลูกค้าต้องการให้โทรกลับ
- เรื่องราคา ส่ง และสั่งซื้อ ต้องแนบลิงก์อ้างอิงจากหัวข้อถัดไป

## 8. ลิงก์อ้างอิง
- ราคา/ขั้นต่ำ: ${rules.urls.faq}
- ข้าวกล่ององค์กร: ${rules.urls.corporate}
- Snack Box: ${rules.urls.snackBox}
- บุฟเฟต์: ${rules.urls.buffet}
- ค็อกเทล: ${rules.urls.cocktail}
- โต๊ะจีน / โต๊ะไทย: ${rules.urls.tableService}
- อาหารชุด: ${rules.urls.setMenu}
- ซุ้มปรุงสด: ${rules.urls.liveCooking}
- จัดเลี้ยงฮาลาล: ${rules.urls.catering}
- พื้นที่ส่ง: ${rules.urls.delivery}
- ฮาลาล: ${rules.urls.halal}
- ติดต่อ: ${rules.urls.contact}
- เกี่ยวกับร้าน: ${rules.urls.about}

## 9. ข้อเท็จจริงเมนูข้าวกล่อง (ใช้ MENU_CONTEXT รอบนั้นเท่านั้น)
ราคาและชื่อเมนูข้าวกล่องรายเมนูไม่ได้อยู่ใน system message นี้ ราคาขายปัจจุบันมาจาก Internal Menu API (planner-backed) ผ่าน MENU_CONTEXT ที่แนบมากับข้อความลูกค้าเท่านั้น
- เมื่อมี MENU_CONTEXT: ใช้เฉพาะชื่อ ราคา และขั้นต่ำรายเมนูที่ระบุในนั้น ห้ามเปลี่ยนราคา ห้ามเพิ่มเมนูที่ไม่มีในนั้น ห้ามใช้ราคาที่จำได้จากประวัติหรือเว็บ
- กฎความถูกต้องราคา: ทุกคู่ชื่อเมนู+ราคาที่ระบุในร่างคำตอบ ต้องมีอยู่ตรงกันใน MENU_CONTEXT ปัจจุบัน ถ้าไม่มีคู่ใดในนั้น ห้ามระบุราคาเมนูนั้น
- เมื่อลูกค้าถามราคาเมนูแต่ไม่มี MENU_CONTEXT ที่ใช้ได้: ห้ามเดา ให้แจ้งว่าขอเช็กราคากับทางทีมก่อน ห้ามใช้ "ราคาเริ่มต้น" แทนราคาเมนูที่ไม่ทราบ
- นโยบายธุรกิจ (ขั้นต่ำรวม จัดส่ง มัดจำ VAT ระยะเวลา) มาจากกฎธุรกิจข้างต้น ไม่ใช่จาก MENU_CONTEXT ชื่อเมนูไม่ใช่ข้อมูลส่วนผสมหรือสารก่อภูมิแพ้
`;
}

function getPromptBody(markdown) {
  const lines = markdown.trim().split(/\r?\n/);
  const firstFence = lines.indexOf('```');
  const lastFence = lines.lastIndexOf('```');
  if (firstFence === -1 || lastFence <= firstFence) return markdown.trim();
  return lines.slice(firstFence + 1, lastFence).join('\n').trim();
}

function syncMenuSource(source, catalog) {
  const seen = new Set();
  const synced = source.split(/\r?\n/).map((line) => {
    const idMatch = line.match(/^\s*\{ id: (\d+),/);
    if (!idMatch) return line;
    const id = idMatch[1];
    seen.add(id);
    let next = line;
    const values = {
      name: catalog.names?.[id],
      price: catalog.prices?.[id],
      category: catalog.categories?.[id],
      image: catalog.images?.[id],
      minPerMenu: catalog.mins?.[id],
    };
    if (values.name !== undefined) next = next.replace(/name: "(?:[^"\\]|\\.)*"/, `name: ${JSON.stringify(values.name)}`);
    if (values.price !== undefined) next = next.replace(/price: \d+(?:\.\d+)?/, `price: ${values.price}`);
    if (values.category !== undefined) next = next.replace(/category: "(?:[^"\\]|\\.)*"/, `category: ${JSON.stringify(values.category)}`);
    if (values.image !== undefined) next = next.replace(/image: "(?:[^"\\]|\\.)*"/, `image: ${JSON.stringify(values.image)}`);
    if (values.minPerMenu !== undefined) next = next.replace(/minPerMenu: \d+/, `minPerMenu: ${values.minPerMenu}`);
    return next;
  }).join('\n');
  for (const id of Object.keys(catalog.prices)) assert.ok(seen.has(String(id)), `menu ${id} is missing from js/menu-data.js`);
  return `${synced.replace(/\n*$/, '')}\n`;
}

function replaceValue(source, pattern, replacement, field) {
  assert.match(source, pattern, `cannot find ${field} in js/business-data.js`);
  return source.replace(pattern, replacement);
}

function syncBusinessSource(source, rules, catalog) {
  const meal = rules.services.mealBox;
  const values = {
    phoneDisplay: rules.business.phone,
    halalCertificate: rules.business.halalCertificate,
    operatingHoursTh: rules.business.operatingDays,
    startingPrice: String(meal.priceFrom),
    premiumPriceFrom: String(meal.premiumPriceFrom),
    premiumPriceTo: String(meal.premiumPriceTo),
    minOrder: String(meal.minimumOrder),
    thaiMinPerMenu: String(meal.standardMenuMinimum),
    indianMinPerMenu: String(meal.specialMenuMinimum),
    snackMinOrder: String(rules.services.snackBox.minimumOrder),
    freeDeliveryFrom: String(rules.delivery.freeThresholdDefault),
    menuCount: String(meal.menuCountFrom),
  };
  let synced = source;
  for (const [field, value] of Object.entries(values)) {
    const pattern = new RegExp(`(${field}:\\s*)'[^']*'`);
    synced = replaceValue(synced, pattern, `$1'${value}'`, field);
  }
  synced = replaceValue(
    synced,
    /(shippingCarMinQty:\s*)\d+/,
    `$1${rules.delivery.carWhenQuantityAbove}`,
    'shippingCarMinQty',
  );
  const leadText = `อย่างน้อย ${rules.services.mealBox.leadTimeDays} วัน`;
  const textValues = {
    quoteTimeTh: `ภายใน ${rules.documents.quoteWithinMinutes} นาทีหลังทัก LINE`,
    confirmDeadlineTh: `${rules.cutoff.time} น. ของ${rules.cutoff.description}`,
    leadSmallTh: leadText,
    leadMediumTh: leadText,
    leadLargeTh: leadText,
  };
  for (const [field, value] of Object.entries(textValues)) {
    const pattern = new RegExp(`(${field}:\\s*)'[^']*'`);
    synced = replaceValue(synced, pattern, `$1'${value}'`, field);
  }

  const thresholds = Object.entries(rules.delivery.zones)
    .map(([zoneId, zone]) => `    ${zoneId}: ${zone.freeFrom}`)
    .join(',\n');
  synced = replaceValue(
    synced,
    /  shippingZoneFreeThresholds: \{[\s\S]*?\n  \},/,
    `  shippingZoneFreeThresholds: {\n${thresholds}\n  },`,
    'shippingZoneFreeThresholds',
  );
  const zones = Object.entries(rules.delivery.zones)
    .map(([zoneId, zone]) => `    ${zoneId}: ${JSON.stringify(zone)}`)
    .join(',\n');
  synced = replaceValue(
    synced,
    /  shippingZones: \{[\s\S]*?\n  \},/,
    `  shippingZones: {\n${zones}\n  },`,
    'shippingZones',
  );
  return `${synced.replace(/\r\n/g, '\n').replace(/\n*$/, '')}\n`;
}

function syncSnackSource(source, rules) {
  return replaceValue(
    source,
    /(var EED_SNACK_MIN_ORDER = )\d+/,
    `$1${rules.services.snackBox.minimumOrder}`,
    'EED_SNACK_MIN_ORDER',
  );
}

function assertUnique(values, message) {
  assert.equal(new Set(values).size, values.length, message);
}

export function validateData(rules, catalog, legacy) {
  assert.equal(rules.schemaVersion, 1, 'unsupported business rules schema');
  assert.match(rules.revision, /^\d{4}-\d{2}-\d{2}$/, 'revision must use YYYY-MM-DD');
  assert.equal(rules.services.mealBox.minimumOrder, 20);
  assert.equal(rules.services.snackBox.minimumOrder, 30, 'Snack Box minimum must be 30');
  assert.deepEqual(
    new Set(Object.values(catalog.mins)),
    new Set([rules.services.mealBox.standardMenuMinimum, rules.services.mealBox.specialMenuMinimum]),
    'menu minimums must be 5 or 10',
  );

  assertUnique(legacy.menus.map((menu) => menu.id), 'menu IDs must be unique');
  assert.ok(Object.keys(rules.delivery.zones).length > 0, 'at least one delivery zone is required');
  const districts = Object.values(rules.delivery.zones).flatMap((zone) => zone.districts);
  assertUnique(districts, 'a district cannot belong to multiple delivery zones');
  for (const [zoneId, zone] of Object.entries(rules.delivery.zones)) {
    assert.ok(Number.isInteger(zone.moto) && zone.moto >= 0, `${zoneId} motorcycle fee must be valid`);
    assert.ok(Number.isInteger(zone.car) && zone.car >= 0, `${zoneId} car fee must be valid`);
    assert.ok(Number.isInteger(zone.freeFrom) && zone.freeFrom >= 0, `${zoneId} free threshold must be valid`);
    assert.ok(Array.isArray(zone.districts) && zone.districts.length > 0, `${zoneId} must contain districts`);
  }
  for (const field of ['shipZones', 'shipCarMinQty', 'shipFree', 'shipZoneFreeThresholds']) {
    assert.equal(catalog[field], undefined, `planner catalog must not define business delivery policy: ${field}`);
  }

  for (const menu of legacy.menus) {
    const id = String(menu.id);
    assert.equal(menu.name, catalog.names[id], `menu ${id} name drift`);
    assert.equal(menu.price, catalog.prices[id], `menu ${id} price drift`);
    assert.equal(menu.category, catalog.categories[id], `menu ${id} category drift`);
    assert.equal(menu.image, catalog.images[id], `menu ${id} image drift`);
    assert.equal(menu.minPerMenu, catalog.mins[id], `menu ${id} minimum drift`);
    if (menu.category === 'อาหารอินเดีย') {
      assert.equal(menu.minPerMenu, rules.services.mealBox.specialMenuMinimum, `Indian menu ${id} must use special minimum`);
    }
  }

  const eed = legacy.business;
  assert.equal(Number(eed.startingPrice), rules.services.mealBox.priceFrom, 'starting price drift');
  assert.equal(Number(eed.premiumPriceFrom), rules.services.mealBox.premiumPriceFrom, 'premium price drift');
  assert.equal(Number(eed.premiumPriceTo), rules.services.mealBox.premiumPriceTo, 'premium price drift');
  assert.equal(Number(eed.minOrder), rules.services.mealBox.minimumOrder, 'minimum order drift');
  assert.equal(Number(eed.thaiMinPerMenu), rules.services.mealBox.standardMenuMinimum, 'standard menu minimum drift');
  assert.equal(Number(eed.indianMinPerMenu), rules.services.mealBox.specialMenuMinimum, 'special menu minimum drift');
  assert.equal(Number(eed.snackMinOrder), rules.services.snackBox.minimumOrder, 'Snack Box minimum drift');
  assert.equal(legacy.snackMinimumOrder, rules.services.snackBox.minimumOrder, 'Snack Box runtime minimum drift');
  assert.equal(Number(eed.shippingCarMinQty), rules.delivery.carWhenQuantityAbove, 'vehicle threshold drift');
  assert.equal(eed.halalCertificate, rules.business.halalCertificate, 'halal certificate drift');
  assert.equal(eed.confirmDeadlineTh, `${rules.cutoff.time} น. ของ${rules.cutoff.description}`, 'cutoff drift');
  const expectedLead = `อย่างน้อย ${rules.services.mealBox.leadTimeDays} วัน`;
  assert.equal(eed.leadSmallTh, expectedLead, 'small lead time drift');
  assert.equal(eed.leadMediumTh, expectedLead, 'medium lead time drift');
  assert.equal(eed.leadLargeTh, expectedLead, 'large lead time drift');

  for (const [zoneId, zone] of Object.entries(rules.delivery.zones)) {
    assert.deepEqual(eed.shippingZones[zoneId], zone, `${zoneId} delivery data drift`);
    assert.equal(eed.shippingZoneFreeThresholds[zoneId], zone.freeFrom, `${zoneId} free threshold drift`);
  }
}

function assertNoBakedMenuCatalog(jsCode, owner) {
  const code = String(jsCode || '');
  assert.ok(!code.includes('const menus ='), `${owner} must not embed a menu catalog`);
  assert.ok(!code.includes('budgetContext'), `${owner} must not carry the retired budget candidate list`);
  assert.ok(!/"price"\s*:\s*\d+/.test(code), `${owner} must not embed menu prices`);
  assert.ok(!/\|\s*\d+\s*บาท\/กล่อง/.test(code), `${owner} must not embed menu price lines`);
}

function parseRevision(jsCode, nodeName) {
  const match = String(jsCode || '').match(/const RULE_REVISION = ("(?:[^"\\]|\\.)*");/);
  assert.ok(match, `${nodeName} node must embed RULE_REVISION`);
  return JSON.parse(match[1]);
}

export async function checkWorkflowFoundation(workflow, rules, catalog, legacy) {
  // Dynamic import: conversation-update.mjs imports this module, so a static
  // import here would create a module cycle.
  const {
    buildAiAgentText,
    buildConversationRouter,
    buildNormalizeNodeCode,
    buildPersistDraftJsonBody,
    buildVerifyDraftNodeCode,
    findCustomerSenders,
    findKitchenAutoPush,
    findPersistenceMisconfigurations,
    findStaticDraftStores,
  } = await import('../line-ai/conversation-update.mjs');
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
  const router = byId.get('deterministic-faq');
  const normalize = byId.get('normalize-event');
  const verify = byId.get('verify-draft');
  const agent = byId.get('ai-agent');
  const persist = byId.get('persist-draft');
  assert.ok(router && normalize && verify && agent && persist, 'workflow must contain the persistence chain (Deterministic FAQ, Normalize Event, Verify Draft, AI Agent, Persist Draft)');
  assert.ok(!byId.get('build-draft'), 'legacy Build Draft node must be removed (PostgreSQL is the Draft store)');
  assertNoBakedMenuCatalog(router.parameters.jsCode, 'Deterministic FAQ');
  assert.equal(
    router.parameters.jsCode,
    buildConversationRouter(),
    'Deterministic FAQ code is stale; run with --write',
  );
  assert.equal(
    agent.parameters.text,
    buildAiAgentText(),
    'AI Agent input is stale; run with --write',
  );
  assert.ok(
    normalize.parameters.jsCode.includes('menuContext'),
    'Normalize Event must pass MENU_CONTEXT; run with --write',
  );
  assert.ok(
    !normalize.parameters.jsCode.includes('budgetContext'),
    'Normalize Event must not carry the retired budget candidate list',
  );
  assert.equal(
    persist.parameters.jsonBody,
    buildPersistDraftJsonBody('Normalize Event'),
    'Persist Draft body is stale; run with --write',
  );
  assert.equal(parseRevision(normalize.parameters.jsCode, 'Normalize Event'), rules.revision, 'Normalize Event RULE_REVISION is stale; run with --write');
  assert.equal(
    normalize.parameters.jsCode,
    buildNormalizeNodeCode(rules.revision),
    'Normalize Event code is stale; run with --write',
  );
  assert.equal(
    verify.parameters.jsCode,
    buildVerifyDraftNodeCode(),
    'Verify Draft code is stale; run with --write',
  );
  const chain = workflow.connections;
  assert.equal(chain['AI Agent']?.main?.[0]?.[0]?.node, 'Normalize Event', 'AI output must enter normalization');
  assert.equal(chain['Normalize Event']?.main?.[0]?.[0]?.node, 'Resolve Customer', 'normalization must resolve the customer first');
  assert.equal(chain['Resolve Customer']?.main?.[0]?.[0]?.node, 'Evaluate Lead', 'customer must precede lead evaluation');
  assert.equal(chain['Evaluate Lead']?.main?.[0]?.[0]?.node, 'Persist Draft', 'lead evaluation must precede draft persistence');
  assert.equal(chain['Persist Draft']?.main?.[0]?.[0]?.node, 'Verify Draft', 'persistence must end at the Verify Draft guard');
  assert.deepEqual(findCustomerSenders(workflow), [], 'workflow must not contain customer auto-send nodes');
  assert.deepEqual(findKitchenAutoPush(workflow), [], 'workflow must not contain kitchen auto-push nodes');
  assert.deepEqual(findStaticDraftStores(workflow), [], 'workflow must not stage Drafts in static data');
  assert.deepEqual(
    findPersistenceMisconfigurations(workflow),
    [],
    `persistence nodes misconfigured:\n${findPersistenceMisconfigurations(workflow).join('\n')}`,
  );
}

export async function checkCandidateMenuLookup(candidate, rules) {
  const {
    buildAiAgentText,
    buildConversationRouter,
    buildMenuContextNodeCode,
    buildPersistDraftJsonBody,
    findMenuLookupMisconfigurations,
  } = await import('../line-ai/conversation-update.mjs');
  const byId = new Map(candidate.nodes.map((node) => [node.id, node]));
  for (const id of ['deterministic-faq', 'menu-lookup-needed', 'fetch-menu-catalog', 'build-menu-context', 'ai-agent']) {
    assert.ok(byId.get(id), `candidate must contain the menu branch node: ${id}`);
  }
  assert.equal(candidate.nodes.length, 25, 'candidate topology is stale; run with --write');
  assertNoBakedMenuCatalog(byId.get('deterministic-faq').parameters.jsCode, 'candidate Deterministic FAQ');
  assert.equal(
    byId.get('deterministic-faq').parameters.jsCode,
    buildConversationRouter(),
    'candidate Deterministic FAQ code is stale; run with --write',
  );
  assert.equal(
    byId.get('ai-agent').parameters.text,
    buildAiAgentText(),
    'candidate AI Agent input is stale; run with --write',
  );
  assert.equal(
    byId.get('build-menu-context').parameters.jsCode,
    buildMenuContextNodeCode(),
    'candidate Build Menu Context code is stale; run with --write',
  );
  assertNoBakedMenuCatalog(JSON.stringify(candidate), 'candidate workflow');
  assert.ok(!JSON.stringify(candidate).includes('budgetContext'), 'candidate must not carry the retired budget candidate list');
  assert.equal(
    byId.get('persist-draft').parameters.jsonBody,
    buildPersistDraftJsonBody('Normalize Response', { includeReplyToken: false }),
    'candidate Persist Draft body is stale; run with --write',
  );
  const chain = candidate.connections;
  const edge = (node) => chain[node]?.main;
  assert.equal(edge('Has Safe Answer?')?.[1]?.[0]?.node, 'Menu Lookup Needed?', 'menu branch must start at the AI fallback');
  assert.equal(edge('Menu Lookup Needed?')?.[0]?.[0]?.node, 'Fetch Menu Catalog', 'fetch branch wiring is stale');
  assert.equal(edge('Menu Lookup Needed?')?.[1]?.[0]?.node, 'Build Menu Context', 'skip branch wiring is stale');
  assert.equal(edge('Fetch Menu Catalog')?.[0]?.[0]?.node, 'Build Menu Context', 'fetch must feed context builder');
  assert.equal(edge('Build Menu Context')?.[0]?.[0]?.node, 'AI Agent', 'context must feed the AI agent');
  // Persist-first: the whole menu branch runs after inbound persistence.
  const seen = new Set();
  const queue = ['Persist Inbound'];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    for (const group of chain[name]?.main || []) for (const e of group || []) queue.push(e.node);
  }
  for (const name of ['Menu Lookup Needed?', 'Fetch Menu Catalog', 'Build Menu Context', 'AI Agent']) {
    assert.ok(seen.has(name), `persist-first violated: ${name} unreachable after Persist Inbound`);
  }
  assert.deepEqual(
    findMenuLookupMisconfigurations(candidate),
    [],
    `menu lookup nodes misconfigured:\n${findMenuLookupMisconfigurations(candidate).join('\n')}`,
  );
}

export async function checkSystem(root = ROOT) {
  const data = await loadSystemData(root);
  validateData(data.rules, data.catalog, data.legacy);
  const expectedKnowledge = renderKnowledge(data.rules, data.catalog, data.legacy.menus);
  const actualKnowledge = await readFile(path.join(root, 'line-ai/knowledge-pack.md'), 'utf8');
  assert.equal(actualKnowledge.replace(/\r\n/g, '\n'), expectedKnowledge, 'AI knowledge is stale; run with --write');
  const prompt = getPromptBody(await readFile(path.join(root, 'line-ai/system-prompt.md'), 'utf8'));
  const expectedNodeMessage = `${expectedKnowledge.trim()}\n\n${prompt}\n`;
  const actualNodeMessage = await readFile(path.join(root, 'line-ai/system-message-node.txt'), 'utf8');
  assert.equal(actualNodeMessage.replace(/\r\n/g, '\n'), expectedNodeMessage, 'combined n8n system message is stale; run with --write');
  const workflow = await readJson(root, 'line-ai/n8n-workflow.json');
  assert.equal(workflow.nodes.find((node) => node.id === 'ai-agent')?.parameters.options.systemMessage, expectedNodeMessage,
    'workflow system message is stale; run with --write');
  const candidate = await readJson(root, 'line-ai/n8n-workflow-b25-persist-first.json');
  assert.equal(candidate.nodes.find((node) => node.id === 'ai-agent')?.parameters.options.systemMessage, expectedNodeMessage,
    'candidate workflow system message is stale; run with --write');
  await checkWorkflowFoundation(workflow, data.rules, data.catalog, data.legacy);
  await checkCandidateMenuLookup(candidate, data.rules);
  return data;
}

async function writeGeneratedFiles(root = ROOT) {
  const { rules, catalog } = await loadSystemData(root);
  const businessPath = path.join(root, 'js/business-data.js');
  const syncedBusinessSource = syncBusinessSource(await readFile(businessPath, 'utf8'), rules, catalog);
  await writeFile(businessPath, syncedBusinessSource, 'utf8');
  const menuPath = path.join(root, 'js/menu-data.js');
  const syncedMenuSource = syncMenuSource(await readFile(menuPath, 'utf8'), catalog);
  await writeFile(menuPath, syncedMenuSource, 'utf8');
  const snackPath = path.join(root, 'js/snack-data.js');
  await writeFile(snackPath, syncSnackSource(await readFile(snackPath, 'utf8'), rules), 'utf8');
  const { legacy } = await loadSystemData(root);
  const knowledge = renderKnowledge(rules, catalog, legacy.menus);
  await writeFile(path.join(root, 'line-ai/knowledge-pack.md'), knowledge, 'utf8');
  const prompt = getPromptBody(await readFile(path.join(root, 'line-ai/system-prompt.md'), 'utf8'));
  await writeFile(path.join(root, 'line-ai/system-message-node.txt'), `${knowledge.trim()}\n\n${prompt}\n`, 'utf8');
  const { buildAiAgentText, buildConversationRouter, buildNormalizeNodeCode, buildPersistDraftJsonBody, buildVerifyDraftNodeCode, ensureCandidateMenuLookup } = await import('../line-ai/conversation-update.mjs');
  const workflow = await readJson(root, 'line-ai/n8n-workflow.json');
  workflow.nodes.find((node) => node.id === 'ai-agent').parameters.options.systemMessage = `${knowledge.trim()}\n\n${prompt}\n`;
  workflow.nodes.find((node) => node.id === 'ai-agent').parameters.text = buildAiAgentText();
  workflow.nodes.find((node) => node.id === 'deterministic-faq').parameters.jsCode =
    buildConversationRouter();
  workflow.nodes.find((node) => node.id === 'persist-draft').parameters.jsonBody =
    buildPersistDraftJsonBody('Normalize Event');
  workflow.nodes.find((node) => node.id === 'deterministic-faq').parameters.jsCode =
    buildConversationRouter();
  workflow.nodes.find((node) => node.id === 'normalize-event').parameters.jsCode =
    buildNormalizeNodeCode(rules.revision);
  workflow.nodes.find((node) => node.id === 'verify-draft').parameters.jsCode = buildVerifyDraftNodeCode();
  await writeFile(path.join(root, 'line-ai/n8n-workflow.json'), `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
  // The B2.5 persist-first candidate carries the same generated system prompt
  // plus the generator-owned deterministic menu branch, AI input, and
  // Persist Draft body (parameterized by normalize node name). B2.5-specific
  // node logic (Normalize Inbound/Response, lead/inbound handling) stays
  // hand-maintained and is guarded by tests, never rewritten here.
  let candidate = await readJson(root, 'line-ai/n8n-workflow-b25-persist-first.json');
  candidate.nodes.find((node) => node.id === 'ai-agent').parameters.options.systemMessage = `${knowledge.trim()}\n\n${prompt}\n`;
  candidate.nodes.find((node) => node.id === 'deterministic-faq').parameters.jsCode =
    buildConversationRouter();
  candidate = ensureCandidateMenuLookup(candidate);
  await writeFile(path.join(root, 'line-ai/n8n-workflow-b25-persist-first.json'), `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  if (process.argv.includes('--write')) await writeGeneratedFiles();
  await checkSystem();
  console.log('System data, calculator catalog, and AI knowledge are consistent.');
}
