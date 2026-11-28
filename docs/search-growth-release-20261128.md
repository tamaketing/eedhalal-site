# Release Plan — Search Growth 2026-11-28

> **ยังไม่ Push / ไม่ Deploy** — รออนุมัติเจ้าของตาม [DEPLOY.md](../DEPLOY.md)
> Branch: `release/search-growth-20261128` (base = `origin/main` + `release/search-growth-20261127`)
> หลักฐานวิเคราะห์: [seo-growth-analysis-2026-11-28.md](seo-growth-analysis-2026-11-28.md) · baseline: [search-growth-baseline-20261128.md](search-growth-baseline-20261128.md)

## 1. ขอบเขตที่ปล่อย
เฉพาะข้อความ/ลิงก์/entity บนหน้าเว็บ TH–EN และ `llms.txt` + สคริปต์อ่าน GSC แบบ read-only
**ไม่แตะ** ราคา/กฎธุรกิจ/db/DNS/domain/hosting · **ไม่ PATCH GBP** · **ไม่เปิดบอท LINE** · **ไม่สร้างรีวิวหรืออันดับ AI จำลอง**

## 2. Before / After (สรุป 10 รายการ)

| # | หน้า | Before | After |
|---|---|---|---|
| 1 | `catering.html` | title/meta ภาษาไทยอย่างเดียว | เพิ่ม `Halal Catering Bangkok` ใน title/meta + section พร้อม CTA ใบเสนอราคา |
| 2 | `corporate.html` | ไม่มีคำว่า `Halal Meal Box Bangkok` | title/meta + section อธิบายสั่งขั้นต่ำ 10 กล่อง ส่งในกรุงเทพฯ |
| 3 | `buffet.html` | title/meta ไม่มี alias อังกฤษตรงคำค้น | เพิ่ม `Halal Buffet Bangkok` + section/link ไปใบเสนอราคา |
| 4 | `snack-box.html` | ไม่มี `Halal Snack Box Bangkok` | title/meta + section + ลิงก์ข้ามบริการ |
| 5 | `en/catering.html` | ไม่มี section เจตนาสั่ง | English section + CTA ไป `/catering-brief.html` |
| 6 | `en/corporate.html` | ไม่มีวลี `Halal Meal Box Bangkok` | title/meta + English section |
| 7 | `en/buffet.html` / `en/snack-box.html` | ไม่มี section เจตนาสั่ง / ไม่มีคำว่า Bangkok ใน snack title | English sections; snack title/meta เพิ่ม Bangkok; CTA ไป root brief |
| 8 | `blog/cicot-explained.html` | 4,062 impr แต่ 16 clicks ไม่มีทางสู่ใบเสนอราคา | section "เลือกผู้ให้บริการฮาลาลหลังเข้าใจ CICOT" + 3 ลิงก์ |
| 9 | `faq.html`, `delivery-area.html` | มีคำตอบอย่างเดียว | section ลิงก์ corporate/catering/delivery/contact |
| 10 | `about.html`, `llms.txt` | sameAs มีแค่ LINE/Facebook; llms มี keyword ไทย | sameAs เพิ่ม Maps/รีวิว URL จริง; llms เพิ่ม English query aliases 4 รายการ |

GBP services/category/hours/address เป็น **ข้อเสนอแยก** ต้อง human approval — ไม่อยู่ในชุด Deploy นี้

## 3. ตรวจก่อนปล่อย (ผ่านแล้วใน sandbox)
- `check-business-sync` / `check-public-site` / `check-search-discovery` / `check-docs`
- `npm test` ใน worktree แยก พร้อม `EED_TEST_SANDBOX_DIR` — ไม่ mutate ไฟล์ Production `D:\eedhalal`
- JSON-LD ทุกหน้าที่แก้ parse ได้; canonical + hreflang (`th`, `en`, `x-default`) ครบ; ลิงก์ภายในมีปลายทางจริง
- Browser จริงบน preview loopback: ทุกหน้า HTTP 200, 0 console error

## 4. Rollback
1. หยุดก่อน push/deploy ถ้ายังไม่อนุมัติ — ไม่ต้องทำอะไรเพิ่ม
2. ถ้า Deploy แล้วต้องถอย: `git revert <commit>` ตามลำดับReverse ของ web → data → scripts → docs **ใน release branch** (ห้าม revert บน `main`)
3. หรือคืนไฟล์ 13 รายการจาก hash ใน baseline ด้วย `git checkout <base-commit> -- <paths>` แล้วรัน check ชุดเดิมอีกครั้ง
4. ห้ามลบข้อมูลลูกค้า/การเงิน/audit; rollback เป็นเฉพาะไฟล์เว็บสาธารณะ

## 5. แผนวัดผลหลังเผยแพร่ (7 / 14 / 28 วัน)
ทุกตัวเลขต้องมาจากแหล่งจริงในวันที่วัด — **ห้ามเติมค่าจำลองหรือคาดการณ์เป็นตัวเลข**

| วัน | GSC | GBP | AI Visibility |
|---|---|---|---|
| 7 | aggregate 7 วัน + เทียบ 7 วันก่อนหน้า; ดู `halal catering bangkok`, `halal buffet bangkok`, `snack box halal`, `ข้าวกล่องฮาลาล`; รัน `node scripts/gsc-trend.mjs` | `GET /api/v1/gbp/snapshot` — website match, reviews, keyword impressions; ยังไม่ PATCH | ลอง query เดิมใน Gemini/ChatGPT/Perplexity/Google AI Overviews ด้วยบัญชีเจ้าของ บันทึก "เห็น/ไม่เห็น/ล็อกอินไม่ได้" แยกจาก GSC |
| 14 | aggregate 28 วัน เทียบช่วงก่อนหน้า; ดู CTR ที่ยังต่ำและอันดับ 4–20; เปรียบ baseline 815/16,464 (90 วัน) | ดูว่า metrics ยัง `UNKNOWN` หรือเริ่มมีข้อมูลจริง; ถ้าไม่มีให้ระบุ "ยังไม่มี" | บันทึก URL/citation ที่ตรวจได้จริงเท่านั้น; ถ้าไม่มีให้เขียน "ไม่พบการอ้างอิงที่ยืนยันได้" |
| 28 | aggregate 90 วัน + per-query trend; วัดว่า English alias เริ่มมี impression หรือไม่; แยก Branded/Non-branded | ตรวจ diff ที่รออนุมัติยังเหมือนเดิม (ไม่ถูก auto PATCH) | สรุปเฉพาะผลที่ล็อกอินและเห็นจริง; ไม่ extrapolate |

เกณฑ์ตีความ: ถ้า impressions เพิ่มแต่ clicks ไม่เพิ่ม → ปรับ CTR/CTA; ถ้า keyword alias ยังไม่ปรากฏ → ยังไม่มีหลักฐานว่า GSC รับรู้คำนั้น; ถ้า AI ยังล็อกอินไม่ได้ → สถานะ "ไม่ยืนยัน" ไม่ใช่ "ไม่ติด"

## 6. ขั้นตอนที่รออนุมัติ
1. เจ้าของอนุมัติ Push ของ **release branch เฉพาะ** (ห้าม `git push origin main` ทั้งหมด)
2. รัน release verify ครบตาม DEPLOY.md แล้วDeploy โดยเจ้าของ
3. บันทึก hash หลัง Deploy เทียบ baseline
4. เริ่มนับ 7/14/28 วันจากวัน Deploy จริง ไม่ใช่วัน Commit
