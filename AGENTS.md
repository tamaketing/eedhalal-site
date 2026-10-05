# Project Rules

## Business Data Source of Truth

- `business-rules.json` is the single source of truth for all business rules and business data.
- Do not treat copied, rendered, translated, generated, or channel-specific content as the canonical source.
- Update `business-rules.json` first when changing any business rule or business data.

## Required Synchronization

- Never change business data in only one location.
- Before making a business-data change, search the entire repository for all related values, terms, identifiers, calculations, claims, and translations.
- Synchronize every affected representation so it remains consistent with `business-rules.json`.
- This requirement includes, but is not limited to:
  - Thai and English website content
  - JSON-LD structured data
  - SEO metadata and sitemaps
  - FAQs
  - Calculators and their formulas, labels, and outputs
  - `llms.txt`
  - `llms-full.md`
  - AI Knowledge content and datasets
  - LINE bot messages, flows, prompts, and data
  - n8n workflows, nodes, prompts, and data mappings
  - All other data files, generated content, integrations, and channel-specific copies

## Change Process

- Before editing, assess the impact of the change and identify every affected file, feature, channel, language, and integration.
- For business-data changes, look up `data/sync-manifest.json` first: it lists every file each fact must appear in, and `node scripts/check-business-sync.mjs --check` fails until ALL of them are updated (no `--write` by design: prose must be edited by hand to preserve SEO/tone).
- After editing, run all relevant existing tests, validation commands, builds, and/or linters available in the project.
- In the final summary, explicitly list every file changed and state which verification commands were run and their results.

## Content Preservation and SEO Evolution

- Preserve existing public-page content, internal links, useful search-intent coverage, media, reviews, and conversion paths unless the user explicitly asks to remove a specific item.
- Improve pages through targeted additions or replacements, not whole-page rewrites. Before removing material, identify its SEO, AI-discovery, and customer-journey impact.
- Keep legacy meal-box, menu, and calculator entry paths while adding catering content and clear service links.
- Review the diff and validate the page after every content change.

## Human Sales Page Rules

EED HALAL — HUMAN SALES PAGE RULES

เป้าหมาย: หน้าเว็บทุกหน้าต้องอ่านเหมือน “พนักงาน EED ที่เข้าใจลูกค้ากำลังแนะนำบริการ” ไม่ใช่ฐานข้อมูล คู่มือ หรือข้อความที่ AI สร้างเพื่อ SEO

These rules govern every customer-facing string in Thai and English: hero copy, section copy, tier/menu descriptions, CTAs, FAQ answers, page titles and meta descriptions, and any LINE bot or ad copy a customer reads. They never change business facts — `data/business-rules.json` and the menu central remain the source of truth, and rule 13 governs how database values reach the page.

### 1. Customer First

ก่อนเขียนทุก Section ให้ถาม:

- ลูกค้ามาหน้านี้เพราะต้องการอะไร?
- เขากังวลอะไร?
- เขาต้องรู้อะไรก่อนตัดสินใจ?
- เราจะช่วยให้การสั่งง่ายขึ้นอย่างไร?

ห้ามเริ่มจาก “เรามีอะไร” — ให้เริ่มจาก “ลูกค้ากำลังต้องการอะไร”

### 2. Human Language

ข้อความที่ลูกค้าเห็นต้องเป็นภาษาพูดธรรมชาติ สุภาพ เป็นกันเอง เหมือนเจ้าของร้านหรือพนักงานขายที่มีประสบการณ์กำลังคุยกับลูกค้า

หลีกเลี่ยงภาษาระบบ เช่น:

- `ราคาแสดงบนเว็บ`
- `เปิดขาย X รายการ`
- `รายการที่ active`
- `ชุดที่ราคาถูกที่สุดในระดับ`
- `ยังไม่มีรายการที่เปิดขาย`
- `ข้อมูลถูกดึงจากฐานข้อมูล`
- `ขั้นต่อไป`

ข้อมูลเหล่านี้ใช้ในระบบหลังบ้านได้ แต่ห้ามนำมาเป็น Sales Copy โดยตรง

### 3. Benefit Before Feature

อย่าบอกเพียงว่าเรามีอะไร ต้องบอกว่ามันช่วยลูกค้าอย่างไร

ตัวอย่าง:

- ไม่ใช่: “กล่อง 4 ช่อง”
- ให้เขียน: “เหมาะกับงานบริษัทที่ต้องการอาหารดูเรียบร้อยขึ้น แยกกับข้าวเป็นสัดส่วน และเสิร์ฟให้ลูกค้าได้ดูดี”

### 4. Contextual Copy

ทุกบริการต้องบอกสถานการณ์ใช้งานจริง เช่น:

- “ถ้าเป็นประชุม อบรม หรือสั่งพนักงานจำนวนมาก Classic เป็นตัวเลือกที่คุมงบง่ายที่สุด”
- “ถ้าเป็นงานรับรองลูกค้า หรือต้องการให้กล่องดูดีขึ้น เลือก Signature”
- “ถ้าเป็นผู้บริหาร VIP หรือคณะกรรมการ Executive Premium จะเหมาะกว่า”

### 5. Sell the Outcome

หัวข้อหลักต้องขาย “ผลลัพธ์” ไม่ใช่แค่ชื่อสินค้า

หลีกเลี่ยง: “เลือกเมนูสำหรับมื้อของคุณ”

ให้คิดในลักษณะ: “ข้าวกล่องฮาลาลสำหรับงานบริษัท เลือกง่ายตามงบและรูปแบบงาน”

แล้วตามด้วยภาษาธรรมชาติ เช่น: “ไม่แน่ใจว่าจะเลือกอะไร บอกจำนวนคน งบ และวันใช้งานมาได้ครับ EED ช่วยจัดตัวเลือกให้เหมาะกับงานให้”

### 6. Remove Buying Friction

ลูกค้าต้องเข้าใจภายในไม่กี่วินาทีว่า:

- เริ่มต้นเท่าไร
- ขั้นต่ำเท่าไร
- เหมาะกับงานแบบไหน
- ร้านช่วยอะไรได้
- ต้องทำอะไรต่อ

อย่าโยนข้อมูลทั้งหมดให้ลูกค้าอ่านเอง

### 7. CTA Must Continue the Conversation

CTA ไม่ควรใช้คำว่า “สอบถาม” ซ้ำทุกจุด — เลือก CTA ตาม Intent เช่น:

- ดูเมนูที่เหมาะกับงบ
- ให้ EED ช่วยเลือกเมนู
- ขอราคาสำหรับงานนี้
- ส่งรายละเอียดงานให้ EED
- สนใจเมนูนี้
- ขอใบเสนอราคา

CTA ต้องบอกว่ากดแล้วลูกค้าจะได้อะไร

### 8. Proof Before Claim

เมื่อพูดว่า “เหมาะกับองค์กร”, “รับงานจำนวนมาก”, “มืออาชีพ”, “พรีเมียม” ควรมีหลักฐานรองรับใกล้ข้อความนั้น เช่น ภาพงานจริง / ลูกค้าองค์กร / รีวิว / ใบรับรองฮาลาล / ตัวอย่างแพ็กเกจ / ประสบการณ์จริง — และหลักฐานนั้นต้องมีอยู่จริง ห้ามสร้างขึ้น

### 9. One Section = One Job

แต่ละ Section มีหน้าที่เดียว เช่น:

- Hero = ทำให้รู้ว่าเราช่วยอะไร
- Trust = ทำให้มั่นใจ
- Product/Tier = ช่วยเลือก
- Menu = ช่วยตัดสินใจ
- Social Proof = ลดความกังวล
- FAQ = แก้ข้อโต้แย้ง
- CTA = ให้เริ่มคุย

ห้ามใส่ข้อมูลเพราะ “มีข้อมูลอยู่” ถ้าไม่ช่วยการตัดสินใจ ให้ย้ายหรือตัดออก

### 10. SEO / AEO / GEO Support Sales — Not Control Sales Copy

ต้องรักษา SEO, Schema, Entity, Internal Links, AEO/GEO, Business Facts, Structured Data — แต่ห้ามทำให้ข้อความที่มนุษย์อ่านแข็งหรือซ้ำ keyword

ข้อความบนหน้าต้อง Human First ข้อมูลสำหรับ Machine สามารถอยู่ใน metadata / schema / JSON-LD / semantic markup

### 11. Sales Page Flow

หน้าบริการสำคัญควรมี Flow โดยประมาณ:

Need → Solution → Why EED → Options → Proof → How it works → Objection handling → CTA

ไม่ใช่: ข้อมูล → ตาราง → ข้อมูล → รายการ → FAQ → ปุ่ม

### 12. Naturalness Test

ก่อนเผยแพร่ ให้อ่านทุกประโยคแล้วถามว่า: “ถ้าลูกค้ายืนอยู่ตรงหน้า เราจะพูดประโยคนี้กับเขาจริงไหม?” ถ้าไม่พูด ให้ Rewrite

### 13. Database ≠ Copy

ฐานข้อมูลเป็น Source of Truth สำหรับ ราคา / เมนู / Tier / รูป / สถานะ / Business Rules แต่ห้ามนำค่าจากฐานข้อมูลมาแสดงเป็นประโยคตรง ๆ ระบบต้องแปลงข้อมูลนั้นเป็น Customer-facing Copy ก่อน (เช่น ตัวเลขจำนวนกล่องต้องกลายเป็นประโยคที่อธิบายว่าเหมาะกับงานแบบไหน)

### 14. Page Improvement Authority

ถ้าการทำตามกฎเหล่านี้จำเป็นต้องเปลี่ยนโครงสร้างหน้า / ย้าย Section / เพิ่ม Section / ลด Section / เพิ่ม Landing Page / เพิ่มหน้าเฉพาะ Intent / ปรับ CTA / ปรับ Internal Link / ปรับ Schema / SEO / AEO / GEO ให้ทำได้ โดยต้องไม่เปลี่ยน Business Facts และยังใช้ฐานข้อมูลกลางเป็น Source of Truth

### Verifying Copy Changes

- Before delivering any customer-facing text change, run the naturalness test (rule 12) over every sentence you wrote or rewrote, and check the copy against rule 2's banned system phrasing.
- Keep Thai and English versions of the same message equivalent in meaning and tone, not word-for-word literal.
- State in the final summary which page and which section changed, what the customer gain is, and how the copy was verified.

## Proactive Website Improvement

- When following the SEO / AEO / GEO rules, the Human Sales Page Rules above, human-sounding writing, and decision-help guidance requires a new page or an update to an existing one, go ahead and do it without asking for confirmation again on work inside this scope. This includes page content, page structure, navigation menus, internal links, and data prepared for Google/AI.
- Every change must give a clear benefit to customers, use real data from the central source (`data/business-rules.json` / menu central), and keep the EED HALAL tone of voice.
- Never create duplicate pages just to capture more keywords, never invent prices, menus, reviews, or endorsements, and never change business conditions on your own.
- Before delivering, verify correctness, mobile usability, links, and Thai–English consistency, using the existing preview and publish steps (see `DEPLOY.md` and `tools/admin/README.md`).
- In the final summary, state what was added or changed, why, and what was verified.
