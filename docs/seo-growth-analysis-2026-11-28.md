# EED HALAL SEO / GEO / AEO — วิเคราะห์เพื่อเพิ่มลูกค้าและยอดขาย

> วันที่ 2026-11-28 · ข้อมูลจริงจาก GSC/GBP ที่เชื่อมต่อแล้วเท่านั้น · **ยังไม่ Deploy / ไม่ Push / ไม่เปลี่ยนราคาหรือกฎธุรกิจ / ไม่สร้างรีวิวหรืออันดับ AI จำลอง**
>
> งานนี้ทำในเครื่องแล้วทิ้งไว้รออนุมัติเผยแพร่ตาม [DEPLOY.md](../DEPLOY.md) · ไม่สร้าง Dashboard ใหม่ ไม่ย้ายโดเมน ไม่กระทบระบบ GBP เดิม

## 1. หลักฐานจาก GSC จริง (aggregate + dimension แยกกัน)

ช่วงข้อมูลถึง 2026-11-25 (GSC lag 3 วัน) · search type `WEB`

| ช่วง | Clicks | Impressions | CTR | เทียบช่วงก่อนหน้า |
|---|---:|---:|---:|---|
| 7 วัน | 93 | 3,462 | 2.69% | 88 / 2,293 / 3.84% — คลิก +5, แสดงผล +1,169 แต่ CTR −1.15pp |
| 28 วัน | 345 | 8,646 | 3.99% | 221 / 3,960 / 5.58% — คลิก +124, แสดงผล +4,686, CTR −1.59pp |
| 90 วัน | 815 | 16,464 | 4.95% | 303 / 3,496 / 8.67% — คลิก +512, แสดงผล +12,968, CTR −3.72pp |

ผลรวมแถว dimension = 220 clicks / 7,656 impressions (Δ −595 / −8,808 จาก aggregate) → **ยืนยันว่าห้ามใช้ผลรวมแถวเป็น KPI**

คำค้นที่อันดับตกจริง (position เพิ่มขึ้น = แย่ลง; เป็นค่าจาก GSC ไม่ได้เดา):
- 7 วัน: `halal office` 8.3, `halal certificate` 5.1, `halal catering bangkok` 21.9, `halal buffet bangkok` 9.4
- 28 วัน: `ขอฮาลาล` 26.4, `halal catering bangkok` 17.2, `halal catering` 8.0
- 90 วัน: `cicot คือ` 3.8, `halal catering` 8.7, `catering halal` 5.0, `eed food` 7.4

คำค้นกลุ่มเป้าหมาย (90 วัน / 28 วัน):
- `halal catering bangkok` — 55 impr, pos 15.8, +55 impr (28 วัน: 42 impr, pos 17.2) → แสดงผลเพิ่มแต่ไม่ติดหน้าแรก
- `halal buffet bangkok` — 15 impr, pos 9.3, 0 clicks (28 วัน: 12 impr, pos 9.2)
- `snack box ฮา ลา ล` — 56 impr, pos 5.7; `snack box ฮาลาล` — 24 impr, pos 4.3, +6 clicks
- `ข้าวกล่องฮาลาล` — 124 impr, pos 2.2, +19 clicks (28 วัน: 35 impr, pos 1.4, +11 clicks)
- `ข้าวกล่องฮาลาล กรุงเทพ` และ `halal meal box bangkok` — **ไม่ปรากฏเป็นคำค้นจริงใน GSC** (ช่องว่างเชิงคำค้น ไม่ใช่คำที่เราแต่งขึ้นมาแทนข้อมูล)
- Branded 153 clicks / 2,012 impr เทียบ Non-branded 67 clicks / 5,644 impr → แบรนด์แข็ง แต่คำค้นGenericยังดึงคลิกได้น้อย

## 2. หลักฐานจาก GBP จริง (read-only)

- Website `https://eedhalal.com/` ตรงกับ source of truth (`websiteVerification.match=true`)
- รีวิว 4 รายการ เฉลี่ย 5.0 **ตอบครบ 0 รอตอบ** — ไม่ได้สร้างรีวิวเพิ่ม
- Performance metrics ของ API ตอบ `UNKNOWN` (0 data points) — **ไม่นำมาเป็นตัวเลขยอดขาย**; มีkeyword impressions จริง 60 คำ (`restaurants` 2,541, `halal` 183, `eed halal` 48)
- Diff ที่ต้องอนุมัติแยก: ชื่อ/ที่อยู่/เวลาทำการ/หมวดหมู่ (`Halal restaurant` เดี่ยว) และ **`services` ยังว่าง** — หลักฐานว่า Local SEO ยังไม่ได้ระบุบริการข้าวกล่อง/บุฟเฟต์อย่างเป็นระบบ
- siteCheck ผ่านทุกข้อ (canonical TH/EN, LocalBusiness schema, เบอร์/ที่อยู่, ลิงก์ Maps และรีวิว, หน้ารีวิวเป็นข้อมูลเชิงสาระ)

## 3. คู่แข่งที่ตรวจพจริงจากผลค้นหาเว็บ (ไม่ได้เดาอันดับ)

| คู่แข่ง | หลักฐานที่เห็นจริง |
|---|---|
| ช้อนแกง `https://chonkaeng.com/lunchbox/` | ข้าวกล่องฮาลาล 100%, ส่งทั่วกรุงเทพฯและปริมณฑล, รับตั้งแต่ 10 กล่อง |
| จีระพันธ์ `https://jeerapancatering.com` / `https://www.jeerapandelivery.com/main/article.php?catid=21&id=116` | บริการฮาลาลเคเทอริ่งสำหรับองค์กร/ประชุม/สัมมนา และบริการจัดอาหารกล่องฮาลาล |
| โก๋ในซอย `https://www.kohnaisoi.com/en/halal-meal-box-catering-service/` | ใช้คำว่า "Halal Meal Box Catering Service" ตรงกับกลุ่มคำค้นเป้าหมาย |
| ChefVyn `https://chefvyn.com/...` | มีหมวดฮาลาลสำหรับองค์กร บริการเซตขนม/จัดเบรก |
| Halbox / FaFa (Facebook) | โพสต์จริงเรื่องรับจัดเลี้ยงฮาลาลกรุงเทพและข้าวกล่องฮาลาลสำหรับงานองค์กร |

ช่องว่างที่เห็นชัด: EED มีเนื้อหาฮาลาลและ CICOT ลึก แต่ **คำค้นภาษาอังกฤษที่คู่แข่งใช้ (`Halal Meal Box Bangkok`, `Halal Catering Bangkok`) ยังไม่มีข้อความบนหน้าเว็บอย่างชัดเจน**

## 4. การปรากฏใน AI — เฉพาะที่ตรวจได้จริง

| ระบบ | ผลที่ตรวจจริง | สถานะ |
|---|---|---|
| Gemini | เปิดได้เฉพาะหน้า landing ไม่ล็อกอิน ("Sign in") — ไม่ได้รันคำถาม | **ไม่ยืนยัน** (ห้ามอ้างว่าติด/ไม่ติด) |
| ChatGPT | ต้อง Log in ก่อนถาม | **ไม่ยืนยัน** |
| Perplexity | Cloudflare "Just a moment..." security verification | **ไม่ยืนยัน** |
| Google AI Overviews | พบแท็บ "โหมด AI" และข้อความ "กำลังคิด" แต่ในผลที่อ่านได้ **ไม่มีคำตอบ AI ที่อ้างอิง EED HALAL**; พบ EED HALAL เฉพาะในผลค้นเว็บธรรมดา (`/catering`, `/about`) และ "ผู้คนยังค้นหา" | **ไม่พบการอ้างอิงที่ยืนยันได้** |

> ไม่มีการสร้างข้อมูลอันดับ AI จำลอง และไม่ใช้ผล GSC มาแฝงเป็นผล AI; การตรวจด้วยบัญชีเจ้าของยังเป็นขั้นตอนที่รออยู่

## 5. Content gap / Entity / Local / Structured Data / Link / ความน่าเชื่อถือ

- **Content gap**: หน้า CICOT ได้ 4,062 impr แต่ 16 clicks — เนื้อหาตอบคำถามได้ดีแต่ไม่มีทางไปสู่ใบเสนอราคาที่ชัดเจน; หน้า FAQ/delivery-area มี impr สูงแต่ CTR ต่ำกว่าเฉลี่ย
- **Entity**: `about.html` มี areaServed (กรุงเทพ) และ sameAs (LINE/Facebook) แล้ว แต่ยังไม่มี Google Maps / รีวิว URL ใน schema (ทั้งที่หน้าเว็บมีลิงก์จริง และ siteCheck ผ่าน)
- **Local SEO**: หน้าเขต (สาทร สีลม สุขุมวิท ฯลฯ) มีใน sitemap แล้ว แต่คำค้น "ใกล้ฉัน" ยังไป降落ที่ delivery-area มากกว่าหน้าบริการหลัก
- **Structured Data**: ทุกหน้าที่ตรวจมี JSON-LD ถูกต้อง (invalid 0) และมี FAQ/Service/Product ครบ; สิ่งที่ขาดคือ alias ภาษาอังกฤษที่ GSC กำลังเห็น
- **Internal links**: มี `service-discovery` nav อยู่แล้วทุกหน้า แต่ขาดลิงก์ในบริบทเนื้อหา (ในบทความ/FAQ/พื้นที่ส่ง)
- **ความน่าเชื่อถือ**: CICOT (เลขที่ 926/2568), สูตรตำนาน 40 ปี, ใบเสนอราคาภายใน 15 นาที, รีวิว Google 4 × 5.0 — เป็นข้อเท็จจริงที่มีอยู่แล้ว **ไม่ต้องแต่งเพิ่ม**

## 6. แผนปรับปรุง 10 รายการ (เรียงตามผลที่คาดต่อยอดขาย)

| # | รายการ | หลักฐานจริง | Before → After | สถานะในเครื่อง |
|---|---|---|---|---|
| 1 | หน้า `catering.html` เจาะ `Halal Catering Bangkok` | 55 impr pos 15.8, ตกอันดับ 7/28 วัน | title/meta มีแต่ภาษาไทย → เพิ่ม alias ภาษาอังกฤษ + section พร้อม CTA ใบเสนอราคา | **แก้แล้ว ทดสอบผ่าน** |
| 2 | หน้า `corporate.html` เจาะ `Halal Meal Box Bangkok` | คู่แข่ง kohnaisoi ใช้คำนี้; `ข้าวกล่องฮาลาล` +19 clicks | ไม่มีคำนี้บนหน้า → title/meta + section อธิบายส่งกรุงเทพฯ + CTA | **แก้แล้ว ทดสอบผ่าน** |
| 3 | หน้า `buffet.html` เจาะ `Halal Buffet Bangkok` | 15 impr pos 9.3, 0 click | ไม่มี alias → title/meta + section + ลิงก์ขอใบเสนอราคา | **แก้แล้ว ทดสอบผ่าน** |
| 4 | หน้า `snack-box.html` ครอบรูปแบบคำค้น `snack box ฮา ลา ล` | 56 impr pos 5.7, 24 impr pos 4.3 | title/meta เน้นคำเดียว → เพิ่ม `Halal Snack Box Bangkok` + ลิงก์ข้ามบริการ | **แก้แล้ว ทดสอบผ่าน** |
| 5 | บทความ CICOT เพิ่มทางไปสั่ง | 4,062 impr / 16 clicks | จบที่เนื้อหา → เพิ่ม section "เลือกผู้ให้บริการฮาลาลหลังเข้าใจ CICOT" พร้อม 3 ลิงก์ | **แก้แล้ว ทดสอบผ่าน** |
| 6 | FAQ เพิ่มเส้นทางสั่งในกรุงเทพ | 267 impr, opportunity score 24.4 | มีคำตอบอย่างเดียว → เพิ่ม section ลิงก์ corporate/delivery/catering | **แก้แล้ว ทดสอบผ่าน** |
| 7 | `delivery-area.html` รับคำค้น "ใกล้ฉัน" | 250 impr; `ข้าวกล่อง ฮา ลา ล ใกล้ฉัน` pos 2.8 | มี FAQ อย่างเดียว → เพิ่ม section ลิงก์ corporate/catering/contact | **แก้แล้ว ทดสอบผ่าน** |
| 8 | `about.html` schema `sameAs` เพิ่ม Maps/รีวิว | siteCheck ผ่านแต่ schema sameAs มีแค่ LINE/Facebook | 2 รายการ → 4 รายการ (เพิ่ม Maps + writereview URL จริงจาก GBP) | **แก้แล้ว JSON-LD ถูกต้อง** |
| 9 | `llms.txt` เพิ่ม English query aliases | 33 named agents + wildcard; AI visibility ยังยืนยันไม่ได้ | มีเฉพาะ keyword ไทย → เพิ่ม alias อังกฤษ 4 รายการพร้อม URL | **แก้แล้ว ผ่าน search-discovery** |
| 10 | GBP `services`/หมวดหมู่/เวลาทำการให้ตรง source | `services: []`, category `Halal restaurant`, hours ต่างจาก source | ตาม snapshot จริง → เสนอเพิ่มบริการ 5 รายการ + ปรับ category/hours หลังอนุมัติ | **เสนออย่างเดียว — ไม่ PATCH ไม่แตะระบบ GBP** |

> ลำดับ 1–9 เป็นการเพิ่มข้อความ/ลิงก์/entity บนโค้ดในเครื่อง **ไม่ลบเนื้อหา ไม่เปลี่ยน URL ไม่เปลี่ยนราคา/เมนู/กฎธุรกิจ**; #10 ต้องเจ้าของอนุมัติแยกตามกฎ AGENTS.md

## 7. งาน SEO ที่เตรียมไว้แล้วแต่ยังไม่ Deploy (กันทำงานซ้ำ)

- `docs/web-social-review-2026-11-25.md` บันทึกชัดว่าโค้ด tracking บน `about.html`, `contact.html`, `en/about.html`, `en/contact.html`, `js/main.js` แก้แล้ว **"ยังไม่เผยแพร่"** — งานนี้ไม่ไปแตะไฟล์เหล่านั้นอีก
- `docs/homepage-review-2026-11-24.md` บันทึกการเผยแพร่ชุดหนึ่งแล้ว (commit `3865ff...`) — ไม่ถือว่าเป็นการ deploy รอบนี้
- `dist/` มีแค่ `eedhalal-vm-source-20261124.tar.gz` (11/24) ขณะที่ไฟล์เว็บใน repo ใหม่กว่า → ยังไม่มีหลักฐาน deploy ของการแก้รอบนี้
- `DEPLOY.md` กำหนดให้ commit/push ด้วยอนุมัติและรัน release gate ก่อนเผยแพร่ — **รายงานนี้หยุดก่อนขั้นตอนนั้น**

## 8. ผลตรวจในเครื่อง

- `node scripts/check-business-sync.mjs --check` — ผ่าน (23 facts × 524 cells)
- `node scripts/check-public-site.mjs` + `node scripts/check-search-discovery.mjs` — ผ่าน 91 pages / 33 named agents + wildcard
- `node scripts/check-docs.mjs` — ผ่าน
- JSON-LD 8 หน้าที่แก้: parse ได้ทั้งหมด invalid 0
- Browser จริงผ่าน local preview (`127.0.0.1:8000`): 7 หน้าโหลด ครบ section ใหม่ **0 console error**
- ไม่มี PATCH ไป Google, ไม่สร้างรีวิว, ไม่เปิดบอท LINE, ไม่กระทบ manager/API/GBP worker ที่รันอยู่

## 9. สิ่งที่รออนุมัติ

1. อนุมัติเผยแพร่ชุดแก้ไข #1–9 ตาม DEPLOY.md (ยังไม่ Push/Deploy)
2. อนุมัติแยกสำหรับ #10 (GBP services/category/hours/address) — ต้องเป็น human approval ไม่ auto
3. เจ้าของล็อกอิน Gemini/ChatGPT/Perplexity/GSC UI เพื่อยืนยันการปรากฏจริง — ผลจะถูกบันทึกแยกจาก GSC เสมอ
