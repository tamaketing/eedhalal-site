# ผลตรวจ Google SEO / AEO / GEO — 6 ตุลาคม 2026

ตรวจทั้ง workspace และ https://eedhalal.com/ โดยคงข้อมูลธุรกิจและแคตตาล็อกกลางเดิม งานนี้ไม่ได้สั่ง commit, push หรือ deploy และไม่ได้ย้อนการแก้ไขเดิมของงานอื่นใน workspace

## ผลที่ยืนยันได้

- หน้าใน sitemap 89 หน้า ตอบ HTTP 200 ครบจากการตรวจเว็บจริง ไม่พบ noindex/nosnippet ใน robots meta ที่ตรวจ หรือ X-Robots-Tag ที่ปิดกั้น
- ไฟล์ robots.txt, sitemap.xml, llms.txt และ llms-full.md บนเว็บจริงตอบ HTTP 200
- ทดสอบหน้าแรกด้วย User-Agent 33 ชื่อ ตอบ HTTP 200 ครบ เป็นการทดสอบจาก IP ของเครื่องนี้ ไม่ใช่หลักฐานว่าบอทจริงมาเยี่ยมแล้ว
- ใน workspace ตัวตรวจผ่าน canonical, hreflang ไทย–อังกฤษ, sitemap, JSON-LD syntax, ชื่อหน้า, description, H1, viewport, ลิงก์ภายใน และลิงก์อ้างอิงในไฟล์ AI
- แคตตาล็อกปัจจุบันมี 26 เมนู ตัวตรวจหน้าเมนูทั้งสองภาษาและราคาเริ่มต้นผ่าน
- ตรวจหน้าที่เปลี่ยน 12 หน้าที่ viewport 390 × 844: ไม่พบการล้นแนวนอน ทุกหน้ายังมีลิงก์ LINE ภาพหน้า Cocktail และสุขุมวิทอ่านได้บนมือถือ

รายละเอียดคำขอเว็บจริงอยู่ใน [live-check.json](../artifacts/seo-ai-audit-2026-10-06/live-check.json) รวม 126 คำขอ (89 หน้า + 4 ไฟล์ discovery + 33 User-Agent probes)

## จุดที่แก้

1. **robots.txt:** เก็บชื่อเดิมครบ 30 ชื่อ เพิ่ม Googlebot, bingbot และ Applebot เป็นชื่อชัดเจน รวม 33 ชื่อพร้อม wildcard ใช้กฎร่วมกันเพื่อให้ข้อยกเว้นเครื่องมือภายในมีผลกับทุกกลุ่ม เปิดให้เรียก public JSON ที่ใช้แสดงเมนูได้ การไม่ระบุชื่อใหม่ไม่ได้แปลว่าถูกบล็อก เพราะ wildcard ยังอนุญาตหน้าสาธารณะ
2. **llms.txt / llms-full.md:** แก้คำแนะนำเก่าว่าเว็บไม่แสดงราคา, ตัวเลข 44 เมนู, การอ้าง MENU_CONTEXT ที่ไม่มีในช่องทางค้นหา และเพดานบุฟเฟต์ 1,000+ คนที่ข้อมูลกลางไม่ได้รับรอง ให้ AI อ้างราคาจากหน้าเมนูปัจจุบันและขอใบเสนอราคาสำหรับรายการไม่มีราคา/ยอดรวมงาน เก็บเส้นทางอ้างอิงเดิมไว้
3. **Cocktail / Set Menu / Table Service ทั้ง TH และ EN:** เพิ่ม Organization, WebPage, Service และ BreadcrumbList ใน head โดยสร้างจากข้อมูลกลางเดียวกับรายละเอียดบริการที่มองเห็น ไม่เพิ่มราคาหรือเงื่อนไขใหม่
4. **corporate, faq, huaykwang, ladprao, sukhumvit:** ซิงก์ WebPage.description ใน JSON-LD ให้ตรงกับ meta description ที่มีอยู่แล้ว รวมถึง schema ชุดเดิมที่อยู่ใน comment
5. **catering-brief:** เติม meta description อธิบายข้อมูลที่ลูกค้าควรเตรียมและการขอใบเสนอราคาผ่าน LINE ช่วยให้ผลค้นหาสื่อจุดประสงค์ของหน้าได้ชัดขึ้น
6. **ตัวตรวจถาวร:** ตรวจสิทธิ์ crawler ต่อทุก URL ใน sitemap, public resources, ข้อยกเว้นภายใน, metadata และคำแนะนำ AI ที่เลิกใช้ เชื่อมกับ check-public-site ซึ่ง CI เรียกอยู่แล้ว เพิ่ม catering sync ใน check-all และ regression tests ของ robots group precedence

ไม่มีการเปลี่ยนราคา ขั้นต่ำ เงื่อนไขธุรกิจ เนื้อหาหลักของหน้า รูป รีวิว หรือ CTA ใหม่ ส่วน meta description ที่เขียนใหม่ผ่านการอ่านแบบภาษาพูดตาม rule 12 และตรวจไม่พบถ้อยคำระบบที่ห้ามใช้ตาม rule 2 ข้อมูลบริการไทย–อังกฤษใน Schema ใช้ rules เดียวกัน

## ชื่อบอทที่คงไว้และตรวจ

Googlebot, bingbot, Applebot, GPTBot, ChatGPT-User, OAI-SearchBot, Google-Extended, Google-CloudVertexBot, ClaudeBot, Claude-SearchBot, Claude-User, anthropic-ai, Meta-ExternalAgent, FacebookBot, PerplexityBot, Perplexity-User, GrokBot, xAI-Grok, CopilotBot, MistralAI-User, Amazonbot, Applebot-Extended, Bytespider, cohere-ai, CCBot, YouBot, DuckAssistBot, iaskspider, KagiBot, Diffbot, omgili, omgilibot, img2dataset

รายชื่อประกอบด้วยชื่อปัจจุบันและ legacy tokens ที่เว็บเคยอนุญาต การเก็บชื่อไว้ไม่ได้ยืนยันว่าทุกชื่อยังเป็น crawler ที่ผู้ให้บริการใช้งานจริง wildcard รองรับชื่อที่ไม่ได้ระบุด้วย

## ขอบเขตของคำว่า “AI ตรวจจับได้”

ยืนยันได้ว่าเว็บเปิดให้ค้นหาและอ่านข้อมูลได้ตามการตรวจครั้งนี้ ยังยืนยันไม่ได้ว่า Google จัดทำดัชนีครบ 89 หน้า หรือ AI ทุกค่ายอ่านและนำเว็บไปอ้างอิงแล้ว เพราะยังไม่ได้ตรวจ Search Console, Bing Webmaster Tools, สถิติอ้างอิงใน Analytics/GTM หรือ log บอทจริง ในโค้ดที่ตรวจไม่พบระบบแยกทราฟฟิกจาก AI โดยเฉพาะ และไม่สามารถสรุปการตั้งค่าภายใน GTM จาก repository ได้

Google ระบุว่าหลัก SEO เดิมใช้กับ AI Overviews/AI Mode ได้ ไม่มีไฟล์ AI หรือ Schema พิเศษที่ต้องเพิ่ม และการผ่านข้อกำหนดไม่รับประกันการเก็บดัชนีหรือการแสดงผล [Google Search Central](https://developers.google.com/search/docs/appearance/ai-features)

กฎ robots ของกลุ่มเฉพาะไม่รับกฎจาก wildcard โดยอัตโนมัติ จึงจัดกลุ่มกฎร่วมให้ชัดเจน robots.txt เป็นแนวทางสำหรับ crawler ไม่ใช่ระบบรักษาความลับ เครื่องมือภายในยังถูกตัดออกจากไฟล์ deploy ตามเดิม [Google robots specification](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec)

การอนุญาต bot สำหรับค้นหาแยกจาก bot สำหรับ training: OAI-SearchBot ใช้กับการค้นหา, Claude-SearchBot ใช้กับผลค้นหาของ Claude และ PerplexityBot ใช้กับการแสดงเว็บไซต์ในผลค้นหา นโยบายที่อนุญาตอยู่เดิมถูกเก็บไว้ [OpenAI](https://developers.openai.com/api/docs/bots), [Anthropic](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler), [Perplexity](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)

## คำสั่งตรวจและผล

| คำสั่ง | ผลล่าสุด |
| --- | --- |
| `node scripts/check-all.mjs` | ผ่าน 9/9: repository safety, line endings, starting price, menu page, business sync, system, catering content, public site, business content |
| `node --test --test-concurrency=1` | 362 รายการ: ผ่าน 359, ล้มเหลว 0, ข้าม 3 PostgreSQL integration เพราะไม่ได้ตั้ง EED_TEST_DATABASE_URL |
| `node scripts/check-public-site.mjs` | ผ่าน 89 หน้า พร้อม search-discovery guard ใหม่ |
| `node scripts/check-search-discovery.mjs` | ผ่าน 89 หน้า, 33 ชื่อ + wildcard และไฟล์ AI ทั้งสอง |
| `node scripts/check-business-sync.mjs --check` | ผ่าน 17 facts × 347 file cells, forbidden scan 132 ไฟล์ (รวมรายงานนี้) และ catalogue-price pages 2 หน้า |
| `node scripts/sync-catering-content.mjs --check` | ผ่าน ไม่มีไฟล์ค้างซิงก์ |
| `node scripts/check-system.mjs --check` | ผ่าน |
| `node scripts/popular-menu-page.mjs --check` | ผ่านทั้ง TH และ EN |
| `node scripts/check-starting-price.mjs` | ผ่านทุกระดับตามแคตตาล็อก |
| `node --test --test-isolation=none test/search-discovery.test.mjs` | ผ่าน 4/4 |
| `git diff --check` และ `git diff --cached --check` | ผ่าน |

ใช้สิทธิ์ subprocess ปกติเพื่อรันชุดทดสอบ เพราะ Windows sandbox ขัดขวางการ spawn และการคืนค่าบาง fixture ในรอบแรก รัน full suite แบบ sequential เพราะ regression tests เดิมแก้หน้าเว็บชั่วคราวระหว่างทดสอบ คืนค่า fixture แล้วและตรวจ business sync ซ้ำหลังจบ ผ่านทั้งหมดตามตาราง

## ไฟล์ที่เปลี่ยนในงานตรวจนี้

- `robots.txt`
- `llms.txt`
- `llms-full.md`
- `catering-brief.html`
- `cocktail.html`
- `en/cocktail.html`
- `set-menu.html`
- `en/set-menu.html`
- `table-service.html`
- `en/table-service.html`
- `corporate.html`
- `faq.html`
- `huaykwang.html`
- `ladprao.html`
- `sukhumvit.html`
- `scripts/sync-catering-content.mjs`
- `scripts/check-public-site.mjs`
- `scripts/check-search-discovery.mjs` (ใหม่)
- `scripts/check-all.mjs`
- `test/search-discovery.test.mjs` (ใหม่)
- `artifacts/seo-ai-audit-2026-10-06/live-check.json` (ผลตรวจใหม่)
- `docs/seo-ai-audit-2026-10-06.md` (รายงานนี้)

ไฟล์อื่นที่มีการแก้หรือ stage ไว้ใน workspace เป็นงานที่มีอยู่ก่อนหรือเกิดจากงานอื่น จึงไม่รวมว่าเป็นการแก้ SEO ครั้งนี้
