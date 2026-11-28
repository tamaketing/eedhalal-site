# Baseline ก่อนเผยแพร่ — Search Growth 2026-11-28

> สถานะ: **บันทึกก่อน Deploy** · branch `release/search-growth-20261128` · base `origin/main` + `release/search-growth-20261127` (4 prepared commits) · **ยังไม่ Push / ไม่ Deploy**

## แหล่งข้อมูล (ของจริง ไม่ใช่ข้อมูลจำลอง)
- GSC aggregate + dimension: `D:/eedhalal-runtime/gsc-report.json` generated `2026-11-28T02:58:43.637Z`, site `sc-domain:eedhalal.com`, search type `WEB`, ช่วง `2026-08-28 → 2026-11-25`
- GSC per-query trend: `D:/eedhalal-runtime/gsc-trend.json` generated `2026-11-28T03:22:08.407Z` (7/28/90 วัน เทียบช่วงก่อนหน้า)
- GBP snapshot: `GET /api/v1/gbp/snapshot` captured `2026-11-28T03:22:18.540Z`, source `local-live-snapshot`

## GSC KPI ก่อนเผยแพร่

| ช่วง | Clicks | Impressions | CTR | ช่วงก่อนหน้า (clicks/impr/CTR) |
|---|---:|---:|---:|---|
| 7 วัน | 93 | 3,462 | 2.69% | 88 / 2,293 / 3.84% |
| 28 วัน | 345 | 8,646 | 3.99% | 221 / 3,960 / 5.58% |
| 90 วัน | 815 | 16,464 | 4.95% | 303 / 3,496 / 8.67% |

- ผลรวม dimension rows = 220 clicks / 7,656 impressions (aggregate Delta −595 / −8,808) — KPI ใช้ aggregate เสมอ
- Branded 153 clicks / 2,012 impr; Non-branded 67 clicks / 5,644 impr
- คำค้นเป้าหมายก่อนเผยแพร่: `halal catering bangkok` 55 impr pos 15.8; `halal buffet bangkok` 15 impr pos 9.3; `snack box ฮา ลา ล` 56 impr pos 5.7; `snack box ฮาลาล` 24 impr pos 4.3; `ข้าวกล่องฮาลาล` 124 impr pos 2.2; English alias ยังไม่มีใน GSC

## GBP ก่อนเผยแพร่
- website `https://eedhalal.com/` ตรง source; reviews 4 รายการ เฉลี่ย 5.0, unanswered 0
- 60 keyword impressions (`restaurants` 2,541 · `halal` 183 · `eed halal` 48); performance metrics `UNKNOWN` (ไม่ใช้เป็นตัวเลข)
- `services: []`, category `Halal restaurant`, siteCheck ผ่านทุกข้อ
- **ไม่มีการ PATCH ไป Google** ในงานนี้

## ไฟล์ที่เตรียมเผยแพร่ (SHA-256 16 ตัวแรก ก่อน Deploy)
| ไฟล์ | hash |
|---|---|
| catering.html | d3585602c7eae2e3 |
| corporate.html | e1cb3f6bf38af83d |
| buffet.html | 14bb67a9e1ea5c8a |
| snack-box.html | 049429719c07faa5 |
| en/catering.html | 54fa0d693ac25fec |
| en/corporate.html | bfd4174dfcc75d0b |
| en/buffet.html | 1582777521c42ed2 |
| en/snack-box.html | f164b94b133ac80e |
| blog/cicot-explained.html | c41afbc0a65ef9f4 |
| faq.html | 30b0d5dfb3779cea |
| delivery-area.html | 73a7ea162e6bde26 |
| about.html | 7168f1fed6beb75c |
| llms.txt | 3cc3c5cae1368be4 |

หลัง Deploy ต้องเทียบ hash เหล่านี้กับไฟล์บน Hosting เพื่อยืนยันว่าได้ของชุดนี้จริง (ไม่ใช่การเดา)
