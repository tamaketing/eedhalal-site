# EED HALAL — Canonical Facts & Sync Checklist

**ตั้งแต่ 10/9/2026:** กฎธุรกิจทั้งหมดอยู่ที่ `data/business-rules.json`; `data/planner-overrides.json` เก็บเฉพาะ catalog/UI override ไม่รวมค่าส่งหรือเกณฑ์ส่งฟรี ส่วน `js/business-data.js` และฐานความรู้ AI เป็นไฟล์ที่ต้องสร้างและตรวจให้ตรงด้วย `node scripts/check-system.mjs --write`

---

## 1. ราคาเริ่มต้น (Starting Price)

| ค่า | 60 THB/box |
|-----|-----------|
| FAQ (synchronized public copy) | `faq.html` — ข้อความ Q3 + JSON-LD FAQPage |
| llms.txt | `llms.txt:19` |
| llms-full.md | `llms-full.md:49`, `llms-full.md:69` |
| schema (index) | `index.html` — `FoodEstablishment.makesOffer.price` |
| schema (menu) | `popular-menu.html` — `MenuItem[].offers.price` |
| หน้า HTML เพิ่มเติม | `popular-menu.html`, `corporate.html`, area pages ทุกหน้า |
| EN counterpart | `en/` — ทุกไฟล์ที่เกี่ยวข้อง |
| Meta tags | `popular-menu.html` title + description |

**Checklist เมื่อเปลี่ยนราคา:**
- [ ] faq.html (JSON-LD + ข้อความ visible)
- [ ] llms.txt
- [ ] llms-full.md (2 จุด)
- [ ] index.html schema (`makesOffer`)
- [ ] popular-menu.html schema (`MenuItem[].offers`)
- [ ] popular-menu.html ข้อความ visible + title + meta
- [ ] corporate.html ข้อความ visible
- [ ] area pages ทุกหน้า (TH + EN)
- [ ] en/ counterparts ทั้งหมด

---

## 2. ขั้นต่ำการสั่ง (Minimum Order)

| ค่า | 20+ boxes (corporate) |
|-----|----------------------|
| FAQ (synchronized public copy) | `faq.html` — Q2 (JSON-LD + visible) |
| llms.txt | `llms.txt:17` |
| llms-full.md | `llms-full.md:47`, `llms-full.md:67` |
| หน้า HTML | `index.html`, `corporate.html`, area pages, `delivery-area.html` |
| EN counterpart | `en/` — ทุกไฟล์ที่เกี่ยวข้อง |

**ขั้นต่ำต่อเมนู (Per-Menu Minimum):**
| ประเภทเมนู | ขั้นต่ำ |
|-----------|--------|
| อาหารไทย | 5 กล่อง |
| อาหารอินเดีย | 10 กล่อง |

**Checklist เมื่อเปลี่ยนขั้นต่ำ:**
- [ ] faq.html (JSON-LD + visible)
- [ ] llms.txt
- [ ] llms-full.md (2 จุด)
- [ ] index.html schema (FAQPage)
- [ ] corporate.html
- [ ] area pages ทุกหน้า (TH + EN)
- [ ] delivery-area.html (TH + EN)
- [ ] en/ counterparts

---

## 3. ส่งฟรี (Free Delivery) — Tiered by Zone

> **ความจริงยึดตามโค้ด** (`js/business-data.js` → `shippingZones` + `shippingZoneFreeThresholds`)
> ตารางนี้คือสำเนาที่ต้องตรงกับโค้ด — ห้ามแก้ตารางโดยไม่แก้โค้ด และห้ามแก้โค้ดโดยไม่แก้ตาราง

| เขต (key ในโค้ด) | ส่งฟรีเมื่อ | ค่าส่งมอเตอร์ไซค์ (≤40 กล่อง) | ค่าส่งรถยนต์ (>40 กล่อง) |
|-----|-----------|-----------------|-----------------|
| กรุงเทพชั้นใน (`zone_1`: ยานนาวา บางคอแหลม สาทร คลองสาน ธนบุรี) | 50+ กล่อง | 60 บาท | 120 บาท |
| สุขุมวิท-ปทุมวัน (`zone_2`: บางรัก ปทุมวัน วัฒนา คลองเตย พระโขนง ดินแดง พญาไท ราชเทวี ป้อมปราบศัตรูพ่าย สัมพันธวงศ์) | 75+ กล่อง | 110 บาท | 180 บาท |
| ลาดพร้าว-ห้วยขวาง (`zone_3`: พระนคร ดุสิต ห้วยขวาง วังทองหลาง บางกะปิ สวนหลวง ประเวศ บางนา จตุจักร บางซื่อ บางกอกใหญ่ บางกอกน้อย ราษฎร์บูรณะ จอมทอง) | 75+ กล่อง | 189 บาท | 230 บาท |
| กรุงเทพรอบนอก (`zone_4`: ลาดพร้าว บึงกุ่ม สะพานสูง คันนายาว ดอนเมือง หลักสี่ บางเขน สายไหม บางพลัด ภาษีเจริญ ตลิ่งชัน ทุ่งครุ) | 100+ กล่อง | 240 บาท | 320 บาท |
| ปริมณฑล/ไกล (`zone_5`: มีนบุรี หนองจอก ลาดกระบัง คลองสามวา ทวีวัฒนา บางแค หนองแขม บางบอน บางขุนเทียน) | ไม่มีส่งฟรี (สอบถามก่อน) | 500 บาท | 500 บาท |
| นอก map (นนทบุรี สมุทรปราการ ปทุมธานี ต่างจังหวัด) | ไม่มีส่งฟรี (สอบถามก่อน) | สอบถาม | สอบถาม |

**กฎรถ:** `shippingCarMinQty: 40` — ออเดอร์ ≤40 กล่องใช้เรทมอเตอร์ไซค์, >40 กล่องใช้เรทรถยนต์
**Config อยู่ที่:** `js/business-data.js` → `shippingZones` (moto/car/districts/label) + `shippingZoneFreeThresholds`
**Fallback:** `freeDeliveryFrom: '50'` (ใช้ถ้าเขตไม่มีใน map)

**มติ 16/9/2026 — นโยบายค่าขนส่งแยกตามแบบบริการ:** ข้าวกล่อง/Snack Box ใช้ตารางโซนข้างบน (มีตัวเลข ห้ามถอด) / งานจัดเลี้ยงทุกแบบ (บุฟเฟต์ ค็อกเทล โต๊ะจีน/โต๊ะไทย Set Menu Live Cooking) **ไม่มีตารางค่าขนส่ง** เพราะรถ ทีม และอุปกรณ์ต่างกัน ให้ลูกค้าสอบถามเพื่อประเมินรายกรณี ทีมสรุปยอดในใบเสนอราคา — ห้ามเอาตารางโซนกล่องไปอ้างกับงานจัดเลี้ยง

**Checklist เมื่อเปลี่ยนเงื่อนไขส่งฟรี:**
- [ ] `js/business-data.js` → `shippingZoneFreeThresholds` + `shippingZones` (moto/car/districts/label) + `shippingCarMinQty` + `freeDeliveryFrom` + `shippingAutoNote`
- [ ] `data/planner-overrides.json` → `shipZoneFreeThresholds`
- [ ] `js/budget-calculator.js` → `getFreeThreshold(zone)`
- [ ] faq.html (JSON-LD + visible)
- [ ] llms.txt
- [ ] llms-full.md (2 จุด)
- [ ] index.html (visible + FAQPage schema)
- [ ] corporate.html
- [ ] area pages ทุกหน้า (TH + EN)
- [ ] delivery-area.html (TH + EN)
- [ ] en/ counterparts

---

## 4. VAT / ภาษี

| ค่า | ไม่รวม VAT 7% (ไม่ได้จด VAT) |
|-----|-----------------------------|
| FAQ (synchronized public copy) | `faq.html` — Q5 (JSON-LD + visible) |
| llms.txt | `llms.txt:24` |
| llms-full.md | `llms-full.md:57`, `llms-full.md:72` |
| schema | `index.html`, `faq.html` (FAQPage) |
| หน้า HTML | `index.html`, `corporate.html`, `faq.html` |
| EN counterpart | `en/` — ทุกไฟล์ที่เกี่ยวข้อง |

**Checklist เมื่อเปลี่ยนสถานะ VAT:**
- [x] faq.html (JSON-LD + visible)
- [x] llms.txt
- [x] llms-full.md (2 จุด)
- [x] index.html FAQPage schema + visible card
- [x] corporate.html
- [x] en/ counterparts
- [x] reviews.html (ใบกำกับภาษี → ใบเสร็จรับเงินแบบธรรมดา)
- [x] blog/ (10 หน้าใหม่) + blog/how-to-choose TH/EN

**เมนู:** ห้ามมีเมนูหมูในเว็บฮาลาล — Q3 faq.html ใช้ "ข้าวกระเทียมผัดไก่สับ" แทน "ข้าวหมูสับผัดซอส"

---

## 5. เอกสารองค์กร (Corporate Documents)

| ค่า | Quotation / Invoice / Receipt (ไม่มี VAT Invoice) |
|-----|--------------------------------------------------|
| FAQ (synchronized public copy) | `faq.html` — Q5 |
| llms.txt | `llms.txt:25` |
| llms-full.md | `llms-full.md:58`, `llms-full.md:73` |

---

## 6. ใบรับรองฮาลาล (Halal Certificate)

| ค่า | CICOT HL-2024-0892 |
|-----|-------------------|
| FAQ (synchronized public copy) | `faq.html` — Q1 |
| llms.txt | `llms.txt:26` |
| llms-full.md | `llms-full.md:76` |

**แก้ไขล่าสุด:** ลบ HL 926/2566 ทิ้งทั้งหมด ใช้ HL-2024-0892 ให้เอกภาพทั้งเว็บ (TH + EN, blog, schema, location pages)

---

## 7. Lead Time / Cutoff

| ค่า | รายละเอียด |
|-----|-----------|
| ข้าวกล่อง 20+ กล่อง | แนะนำสั่งล่วงหน้าอย่างน้อย 1 วัน |
| งานจัดเลี้ยงทุกประเภท | แนะนำจองอย่างน้อย 7 วัน |
| Cutoff | ยืนยันรายละเอียดภายใน 15:00 น. ของวันทำการก่อนส่ง |
| FAQ (synchronized public copy) | `faq.html` — Q6, Q7 |
| llms.txt | `llms.txt:22`, `llms.txt:23` |
| llms-full.md | `llms-full.md:53-57` |

---

## 8. บริการจัดเลี้ยงฮาลาลและการชำระเงิน

| บริการ | ราคาเริ่มต้น / ขั้นต่ำ / ขอบเขตบริการ |
|--------|-----------------------------------------|
| บุฟเฟต์ฮาลาล | 200 บาท/หัว, ขั้นต่ำ 30 คน, รองรับ 30+ คน, เมนู 7 หมวด, ทีมจัดไลน์ เติมอาหาร และดูแลหน้างาน |
| Live Cooking / ซุ้มปรุงสด | 200 บาท/หัว, รองรับ 30+ คน, เชฟปรุงสดจานต่อจาน ออกแบบตามธีม เหมาะกับงาน VIP อีเวนต์ และงานเปิดตัว |
| Cocktail / Finger Food | 200 บาท/หัว, ขั้นต่ำ 30 คน, รองรับ 30+ คน, ชิ้นพอดีคำดีไซน์พรีเมียม พร้อมทีมจัดดิสเพลย์ เดินเสิร์ฟ และดูแลหน้างาน |
| โต๊ะจีน / โต๊ะไทย | 3,000 บาท/โต๊ะ (8–10 ท่าน), ขั้นต่ำ 3 โต๊ะ, รองรับ 3+ โต๊ะ, คาว-หวาน 7–8 รายการ พร้อมทีมเซ็ตติ้งและเสิร์ฟตามคอร์ส |
| Set Menu / Sit-down Dinner | 350 บาท/หัว, ขั้นต่ำ 30 คน, รองรับ 30–500 คน, 3–5 คอร์ส พร้อมทีมเสิร์ฟและดูแลหน้างานระดับ VIP |
| ข้าวกล่องฮาลาล | 60 บาท/กล่อง, ขั้นต่ำ 20 กล่อง, รองรับ 20–1000+ กล่อง, วัตถุดิบฮาลาล 100% ซีลปิดมิดชิด และจัดส่งตรงเวลา |
| การชำระเงิน | มัดจำ 50% เพื่อยืนยันวันจอง; งานจัดเลี้ยงชำระส่วนที่เหลือก่อนวันงาน 7 วัน; ข้าวกล่องชำระส่วนที่เหลือก่อนส่งมอบ 1 วัน |

---

## 9. Entity (About Page) — ข้อมูลธุรกิจที่ AI ใช้อ้างอิง

| ค่า | รายละเอียด |
|-----|-----------|
| Entity page (TH) | `about.html` — canonical: https://eedhalal.com/about.html |
| Entity page (EN) | `en/about.html` — canonical: https://eedhalal.com/en/about.html |
| ชื่อธุรกิจ | EED HALAL (ไม่มีชื่อนิติบุคคล — ดำเนินการในนาม EED HALAL) |
| เจ้าของ/ผู้ก่อตั้ง | เชฟและผู้ก่อตั้ง พี่อี๊ด (EN: Chef and founder Eed) |
| ประสบการณ์ | สูตรครัวครอบครัวกว่า 40 ปี (อาหารไทย+อินเดีย) |
| ที่ตั้ง | 478/3 ซอยเจริญราษฎร์ 1 แขวงยานนาวา เขตสาทร กทม. 10120 |
| พื้นที่บริการ | ทั่วกรุงเทพฯ (zone 1: 50+, zone 2-3: 75+, zone 4: 100+ กล่อง, zone 5 ไม่มีส่งฟรี) ชื่อย่าน ถนน อาคาร และ landmark ต้องตรวจจากเขตของที่อยู่จริง นอกกรุงเทพสอบถามรายกรณี |
| เวลาทำการ | จันทร์-เสาร์ 08:00-18:00 (อาทิตย์ปิด) |
| ประเภทธุรกิจ | ร้านอาหารฮาลาล / ข้าวกล่อง+จัดเลี้ยงองค์กร (ไม่ระบุรูปแบบนิติบุคคล) |
| เอกสาร | ใบเสนอราคา + ใบเสร็จรับเงินแบบธรรมดา (ไม่ออกใบกำกับภาษี/Invoice) |
| Schema | Organization `@id = https://eedhalal.com/#organization` ใช้ร่วมทุกหน้า (contact, index, about) — ห้ามสร้าง @id ใหม่ เช่น `#org` |
| สถานะ NAV | ลิงก์ About ใน nav desktop+mobile และ footer (TH+EN) = `js/main.js` (`ABOUT_PATH`) |

**แก้ไขล่าสุด:** สร้าง `about.html` + `en/about.html` ครบ 12 หัวข้อตามคำขอ (ใคร/ชื่อ/เจ้าของ/ประสบการณ์/ที่ตั้ง/พื้นที่/ประเภท/CICOT/บริการ/ขั้นต่ำ/ราคา/ช่องทางติดต่อ) + Founder schema (Person `#founder`); แก้ `js/main.js` 3 จุดที่ขัดข้อเท็จจริง: footer EN "Tax Invoice Available"→"Regular Receipt Issued", footer TH "ออกใบกำกับภาษีได้"→"ออกใบเสร็จรับเงินได้", FAQ schema inject "จดทะเบียนบริษัทถูกต้อง...ใบแจ้งหนี้"→"ออกใบเสนอราคา+ใบเสร็จรับเงินแบบธรรมดา ไม่ได้จดทะเบียน VAT"; รวม @id `#org`→`#organization`

---

## 9. Tone & Voice — มาตรฐานภาษาเขียนทั้งเว็บ (ตั้งแต่ 15/8/2026)

**หลัก:** เขียนแบบ "พนักงานขายจริงคุยกับลูกค้าคนเดียว" — พูดกับ "คุณ" ลงท้าย "ครับ" ให้ทางออกและเชิญชวนคุย ก่อนอื่นคือทำให้รู้สึกว่ามีคนช่วยจัดอาหาร ไม่ใช่ลง keyword

**ประโยคตัวอย่างที่ใช้ได้ในทุกหน้า:**
- "กำลังหาข้าวกล่องสำหรับประชุมอยู่ไหมครับ?"
- "บอกจำนวนคนกับงบประมาณมาได้เลย เดี๋ยวช่วยจัดเมนูให้ครับ"
- "ถ้าเป็นงานบริษัทและต้องใช้เอกสาร เราจัดเตรียมให้ได้ครับ"
- "ไม่แน่ใจว่าจะเลือกเมนูไหนดี? ส่งงบมาให้เราช่วยเลือกได้เลย"
- EN: "Looking for meeting meal boxes?" / "Tell us your headcount and budget and we'll plan the menu." / "Need documents for your company? We can sort those out too." / "Not sure which menu to pick? Send us your budget and we'll help you choose."

**กฎ 6 ข้อ:**
1. **ห้าม Copy แบบ "SEO จ๋า"** — keyword หลัก 1 คำต่อหน้า + คำแปรผันธรรมชาติ (ฮาลาล, อาหารประชุม, ข้าวกล่องบริษัท, catering) เท่านั้น ห้ามยัด keyword ซ้ำทุกประโยค
2. **ตัวเลขจริงแต่งด้วยภาษาคน** — เช่น "เริ่ม 60 บาท/กล่องครับ สั่งเยอะขึ้นปรับงบต่อหัวให้ถูกลงได้" (ตัวเลขต้องตรง business-data.js เสมอ)
3. **ทุก CTA ตอบคำถามเงียบๆ ของลูกค้า** — งบเท่าไหร่? เอกสารครบไหม? ส่งทันงานไหม? -> "บอกงบมาได้เลยครับ"
4. **ใช้ "เรา/ทีม" แทน "ทางร้าน"** เมื่อคุยกับลูกค้า และลงท้าย "ครับ" (EN: friendly, short sentences)
5. **ห้ามคำโฆษณาเกินจริง** — No.1, อันดับหนึ่ง, ดีที่สุด, ราคาถูกที่สุด (ห้ามทุกภาษา)
6. **ห้ามเปลี่ยนข้อเท็จจริงเพื่อให้ประโยคสวย** — ข้อจำกัดเดิมยังบังคับ: ไม่มีใบกำกับภาษี นอกกรุงเทพ สอบถามและประเมินรายกรณี ไม่รับงานเดียวกันถ้าไม่อยู่ในเกณฑ์

---

## กฎการ Sync (ใช้คู่กับ llms-full.md)

0. **ข้อมูลกลางแบบ machine-readable** — กฎธุรกิจอยู่ที่ `data/business-rules.json` และเมนู/ราคา/ค่าส่งอยู่ที่ `data/planner-overrides.json` จากนั้นรัน `node scripts/check-system.mjs --write` และ `node --test` ทุกครั้ง
- **ทะเบียนไฟล์ที่ต้องแก้ครบ (`data/sync-manifest.json`)** — 8 facts (ราคาเริ่ม/ขั้นต่ำข้าวกล่อง/เลขฮาลาล/คำสัญญา 15 นาที/cutoff/VAT/มัดจำ/ขั้นต่ำ Snack Box) ผูกกับไฟล์ที่ต้องมีข้อความนั้นรวม 260 จุด + สแกนข้อความต้องห้าม (เลขฮาลาลเก่า, อ้างออกเอกสารภาษีที่ออกไม่ได้, อ้างราคารวมภาษีแล้ว) — `node scripts/check-business-sync.mjs --check` จะลิสต์ไฟล์ที่แก้ไม่ครบให้ทั้งหมด เพิ่มไฟล์ใหม่เข้าเว็บต้องเพิ่มชื่อไฟล์ลง manifest ด้วย

1. **business-rules.json = source of truth** — แก้ `data/business-rules.json` ก่อน แล้วซิงก์ FAQ เว็บ และฐานความรู้ AI ให้ตรงกัน
2. **llms files** — ตัวเลขใน `llms.txt` และ `llms-full.md` ต้องตรงกับ FAQ ทุกประการ
3. **Schema JSON-LD** — ราคาใน `makesOffer`, `MenuItem.offers`, `FAQPage` ต้องตรงกับ FAQ
4. **EN vs TH** — หน้า `en/` ทุกหน้าต้อง sync พร้อมกันกับฝั่งไทยเสมอ
5. **Local area pages** — หน้าพื้นที่ (sukhumvit, silom, sathon, rama3, ladprao) มีข้อมูลราคา/ขั้นต่ำ/ส่งฟรีซ้ำ ต้องเปลี่ยนทุกหน้า
6. **About / Entity** — ข้อมูลตัวตนธุรกิจ (เจ้าของ ชื่อ ที่อยู่ เวลาทำการ) อ้างอิง `about.html` + `en/about.html` เป็นหลัก ข้อมูลต้องตรงกับ Organization schema `#organization` ทุกหน้า
7. **เอกสาร/Invoice** — ห้ามเขียนว่า EED HALAL ออกใบกำกับภาษี/Invoice ได้ทุกที่ (HTML, JS, llms, schema) — ออกได้แค่ใบเสนอราคา + ใบเสร็จรับเงินแบบธรรมดา
8. **คำสัญญามาตรฐาน** — ใบเสนอราคา: TH ภายใน 15 นาทีหลังทัก LINE / EN within 15 minutes after messaging us on LINE — พื้นที่ส่ง: TH ทั่วกรุงเทพฯ / EN Bangkok (ปกติแล้วทั้งเว็บ 13/8/2026) ห้ามใช้ภายในวันเดียวกัน / กรุงเทพฯและปริมณฑล ในเนื้อหาใหม่
