# EED HALAL — Canonical Facts & Sync Checklist

ไฟล์นี้คือ **Source of Truth** สำหรับ facts ที่ต้อง sync ระหว่าง faq.html ↔ llms files ↔ schema ทุกครั้งที่แก้ไขค่าใดค่าหนึ่ง

---

## 1. ราคาเริ่มต้น (Starting Price)

| ค่า | 55 THB/box |
|-----|-----------|
| FAQ (source of truth) | `faq.html` — ข้อความ Q3 + JSON-LD FAQPage |
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
| FAQ (source of truth) | `faq.html` — Q2 (JSON-LD + visible) |
| llms.txt | `llms.txt:17` |
| llms-full.md | `llms-full.md:47`, `llms-full.md:67` |
| หน้า HTML | `index.html`, `corporate.html`, area pages, `delivery-area.html` |
| EN counterpart | `en/` — ทุกไฟล์ที่เกี่ยวข้อง |

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

## 3. ส่งฟรี (Free Delivery)

| ค่า | 50+ boxes |
|-----|-----------|
| FAQ (source of truth) | `faq.html` — Q2 (JSON-LD + visible) |
| llms.txt | `llms.txt:20` |
| llms-full.md | `llms-full.md:50`, `llms-full.md:70` |
| หน้า HTML | `index.html`, `corporate.html`, area pages, `delivery-area.html` |
| EN counterpart | `en/` — ทุกไฟล์ที่เกี่ยวข้อง |

**Checklist เมื่อเปลี่ยนเงื่อนไขส่งฟรี:**
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
| FAQ (source of truth) | `faq.html` — Q5 (JSON-LD + visible) |
| llms.txt | `llms.txt:24` |
| llms-full.md | `llms-full.md:57`, `llms-full.md:72` |
| schema | `index.html`, `faq.html` (FAQPage) |
| หน้า HTML | `index.html`, `corporate.html`, `faq.html` |
| EN counterpart | `en/` — ทุกไฟล์ที่เกี่ยวข้อง |

**Checklist เมื่อเปลี่ยนสถานะ VAT:**
- [ ] faq.html (JSON-LD + visible)
- [ ] llms.txt
- [ ] llms-full.md (2 จุด)
- [ ] index.html FAQPage schema + visible card
- [ ] corporate.html
- [ ] en/ counterparts

---

## 5. เอกสารองค์กร (Corporate Documents)

| ค่า | Quotation / Invoice / Receipt (ไม่มี VAT Invoice) |
|-----|--------------------------------------------------|
| FAQ (source of truth) | `faq.html` — Q5 |
| llms.txt | `llms.txt:25` |
| llms-full.md | `llms-full.md:58`, `llms-full.md:73` |

---

## 6. ใบรับรองฮาลาล (Halal Certificate)

| ค่า | CICOT HL-2024-0892 |
|-----|-------------------|
| FAQ (source of truth) | `faq.html` — Q1 |
| llms.txt | `llms.txt:26` |
| llms-full.md | `llms-full.md:76` |

**แก้ไขล่าสุด:** ลบ HL 926/2566 ทิ้งทั้งหมด ใช้ HL-2024-0892 ให้เอกภาพทั้งเว็บ (TH + EN, blog, schema, location pages)

---

## 7. Lead Time / Cutoff

| ค่า | รายละเอียด |
|-----|-----------|
| 20-50 boxes | 2-3 วันทำการล่วงหน้า |
| 50+ boxes | 5-7 วันทำการล่วงหน้า |
| Cutoff | ยืนยันรายละเอียดภายใน 15:00 น. ของวันทำการก่อนส่ง |
| FAQ (source of truth) | `faq.html` — Q6, Q7 |
| llms.txt | `llms.txt:21`, `llms.txt:22` |
| llms-full.md | `llms-full.md:51-54`, `llms-full.md:70-71` |

---

## กฎการ Sync (ใช้คู่กับ llms-full.md)

1. **FAQ = source of truth** — ความถูกต้องของตัวเลขต้องตรงกับ `faq.html` เสมอ
2. **llms files** — ตัวเลขใน `llms.txt` และ `llms-full.md` ต้องตรงกับ FAQ ทุกประการ
3. **Schema JSON-LD** — ราคาใน `makesOffer`, `MenuItem.offers`, `FAQPage` ต้องตรงกับ FAQ
4. **EN vs TH** — หน้า `en/` ทุกหน้าต้อง sync พร้อมกันกับฝั่งไทยเสมอ
5. **Local area pages** — หน้าพื้นที่ (sukhumvit, silom, sathon, rama3, ladprao) มีข้อมูลราคา/ขั้นต่ำ/ส่งฟรีซ้ำ ต้องเปลี่ยนทุกหน้า
