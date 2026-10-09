# Deploy แบบไม่ต้องมีหลังบ้าน (ข้อมูลกลางจาก GitHub)

## วิธีใช้ (เจ้าของ)
1. แก้ข้อมูลธุรกิจทั้งหมด รวมถึงราคาเริ่มต้น ขั้นต่ำ เอกสาร lead time พื้นที่ส่ง และนโยบายค่าส่ง (ถามแอดมิน ไม่มีเรท/โซน/ยอดส่งฟรี) ที่ `data/business-rules.json`
2. จัดการเมนูที่หน้า **จัดการเมนู** (`budget-planner.html` ผ่าน local server ของแอดมิน):
   - กด **บันทึก** เพื่อเก็บฐานกลางในเครื่อง (สำรองอัตโนมัติก่อนทุกครั้ง เครื่องมือแอดมินใช้ทันที เว็บลูกค้ายังใช้ฉบับเดิม)
   - กด **ดูตัวอย่างและเผยแพร่** เพื่อเทียบกับฉบับไฟล์ก่อนยืนยัน — ขั้นนี้สร้างไฟล์ในเครื่องเท่านั้น สถานะคือ “เตรียมไฟล์แล้ว — รอขึ้นเว็บไซต์” **ยังไม่ถือว่าเผยแพร่แล้ว**
   - กด **เผยแพร่ขึ้นเว็บจริง** (การ์ด “ขึ้นเว็บจริง”) ระบบจะตรวจไฟล์อีกรอบ → commit **เฉพาะ** `data/planner-overrides.json` + `js/menu-data.js` → push → รอตรวจว่าเว็บจริงให้บริการฉบับนี้แล้ว ขึ้น “เผยแพร่แล้ว” ต่อเมื่อตรวจพบจริงเท่านั้น ถ้าตรวจไม่ได้จะขึ้น “ยังไม่ยืนยัน”
   - ห้ามแก้ `data/planner-overrides.json` หรือ `js/menu-data.js` ด้วยมือ ทั้งสองไฟล์สร้างจากฐานกลางเท่านั้น (deploy จะหยุดถ้าพบว่าไฟล์ถูกแก้ด้วยมือ หรือมี commit อื่นรอ push รวมอยู่)
3. **ซิงก์ไฟล์ที่ generate จากฐานกลาง — ห้ามข้ามขั้นนี้** กด publish เสร็จแล้วเว็บยังไม่ขึ้นข้อมูลใหม่จนกว่าจะรันครบทั้ง 3 คำสั่ง:
   ```
   node scripts/sync-catering-content.mjs --write   # ตาราง/การ์ดระดับ + การ์ดบริการ + JSON-LD + llms.txt/llms-full.md
   node scripts/popular-menu-page.mjs   --write   # รายการเมนู + ItemList บนหน้าเมนู (เมนูใหม่จะไม่โผล่ถ้าข้าม)
   node scripts/check-system.mjs        --write   # Calculator + ข้อมูลธุรกิจฝั่งเว็บ
   ```
   > **publish ≠ ขึ้นเว็บ** — ปุ่มเผยแพร่เขียนแค่ `data/planner-overrides.json` + `js/menu-data.js` เท่านั้น ถ้าแก้ **ระดับข้าวกล่อง** (เพิ่ม/ซ่อนชุด เปลี่ยนราคา เปลี่ยนชื่อ หรือเพิ่ม/เปลี่ยนราคา**อาหารเมนูที่ 2**) ต้องรัน 3 คำสั่งข้างบนด้วย ไม่งั้นหน้าเว็บจะยังพูดของเก่า
4. รันตัวตรวจให้ผ่านทั้งหมดก่อน commit:
   ```
   node scripts/sync-catering-content.mjs --check
   node scripts/check-system.mjs --check
   node scripts/popular-menu-page.mjs --check
   node scripts/check-starting-price.mjs
   node scripts/check-business-sync.mjs --check
   node scripts/check-public-site.mjs
   node --test
   ```
5. **รูปที่เพิ่มใหม่ต้อง `git add` ก่อน deploy** — ถ้าไฟล์รูปยังไม่ถูกติด git เว็บจะขึ้น 404 (ตรวจด้วย `git status --porcelain -- img/`)
6. การขึ้นเว็บอัตโนมัติจากหลังบ้านยัง**ปิดอยู่โดยค่าเริ่มต้น** (ต้องตั้ง `EED_ALLOW_GIT_DEPLOY=1` แล้วเริ่ม server ใหม่) — เปิดแล้วปุ่ม “เผยแพร่ขึ้นเว็บจริง” จะ commit เฉพาะไฟล์เผยแพร่ + push ด้วย git ของเครื่องแอดมินเอง (ไม่ใช้ token ในเบราว์เซอร์) แล้วตรวจเว็บจริงต่อ ถ้ายังไม่เปิด ให้ commit/push เองตามปกติ (push คือขั้นตอนที่ขึ้น GitHub Pages จริง)

## การทำงาน
- `data/business-rules.json` เป็นข้อมูลกลางของกฎธุรกิจที่เว็บ เครื่องคำนวณ API และเอกสารสำหรับ AI (`llms.txt` / `llms-full.md`) ต้องใช้ร่วมกัน
- ฐานกลางเมนู (`menu-central.json` ในโฟลเดอร์ข้อมูลแอดมิน, local only, gitignored) เป็นต้นทางของเมนูทั้งหมด: ชื่อ รูป **ระดับสินค้า (Classic / Signature / Executive)** คำอธิบาย ราคาขาย ขั้นต่ำ ลำดับแสดงผล และการซ่อน — อ้างอิงด้วย ID เมนูเดิม ส่วนราคาขายคือข้อมูลหลักของหน้านี้เท่านั้น **เมนูไม่มีหมวดหมู่อีกแล้ว: ระดับสินค้าใน `data/business-rules.json` คือกลุ่มเดียวที่ทั้งเว็บ เครื่องคำนวณ API และข้อความตอบแทนบน LINE ใช้ร่วมกัน**
- โค้ดหลังบ้านอยู่ใน `tools/admin/` (version control) ส่วนข้อมูลจริงอยู่ในโฟลเดอร์ข้อมูล (`EED_ADMIN_DATA_DIR`, ค่าเริ่มต้น `demo/owner-set-builder/`, gitignored) — เริ่มระบบด้วย `tools/admin/start-admin.cmd` ดูวิธีติดตั้ง/ย้ายเครื่องที่ `tools/admin/README.md`
- `data/planner-overrides.json` + `js/menu-data.js` เป็น**ฉบับเผยแพร่** (public, allowlist เฉพาะ ID/ชื่อ/รูป/ระดับสินค้า/คำอธิบาย/ราคาขาย/ขั้นต่ำ/ลำดับแสดงผล) สร้างจากฐานกลางด้วยปุ่มเผยแพร่เท่านั้น ห้ามมีข้อมูลภายในหรือหมายเหตุภายใน (คีย์ `categories`/`categoryList` เป็นของเก่า — publish แรกหลังเลิกหมวดจะตัดทิ้งให้เอง)
- `js/business-data.js` เป็น compatibility file สำหรับกฎธุรกิจบนหน้าเว็บ และต้องตรงกับข้อมูลกลาง
- `data/rich-menu.json` คือข้อมูล rich menu + keyword reply ของ LINE Official Account (ไม่ใช่บอทอัตโนมัติ) ราคาในไฟล์นี้ต้องตรงกับแคตตาล็อกที่เผยแพร่แล้วเสมอ
- ระดับข้าวกล่อง (Classic / Signature / Executive) และ**อาหารเมนูที่ 2** ถูกสร้างจาก `data/business-rules.json` + แคตตาล็อกที่เผยแพร่แล้ว ตัวเลขราคาเริ่มต้นไม่มีที่ไหนพิมพ์เอง — คำนวณจากชุดที่เปิดขายและถูกที่สุดของระดับนั้นเสมอ
- Calculator ยังรองรับ localStorage สำหรับ preview ในเครื่อง แต่ข้อมูลที่ deploy ให้ลูกค้าใช้มาจากไฟล์ใน repository
- CI จะหยุด deployment เมื่อข้อมูลธุรกิจและ Calculator ไม่ตรงกัน หรือเมื่อข้อเท็จจริงใน `data/sync-manifest.json` ตกหล่นจากไฟล์ใดไฟล์หนึ่ง
- `budget-planner.html`, `kitchen-order.html` และเครื่องมือหลังบ้านเป็นของภายใน จึงไม่ถูก deploy ไป GitHub Pages

## ทดสอบ
- รัน `node scripts/check-system.mjs`
- รัน `node --test`
- เปิดผ่าน GitHub Pages หรือใช้ `start-server.bat` แล้วเปิด `http://localhost:8000/popular-menu.html`

## การสำรองและกู้คืน (ข้อมูลภายใน)
- ทุกครั้งที่บันทึก `menu-central.json` ผ่านหลังบ้าน ระบบสำรองฉบับก่อนหน้าไว้ที่ `<data-dir>/backups/` อัตโนมัติ (เก็บ 20 ฉบับต่อข้อมูล ชื่อมีวันเวลาถึงมิลลิวินาที) ถ้าสำรองไม่สำเร็จจะ**ไม่บันทึก**ต่อ
- กู้คืนที่การ์ด “ขึ้นเว็บจริง” (รายการสำรอง → กู้คืน) ระบบจะสำรองฉบับปัจจุบันไว้ก่อนกู้เสมอ
- **ข้อจำกัด:** สำรองในเครื่องเดียวกันกันแก้พลาด/เผยแพร่พลาดเท่านั้น **ไม่กันเครื่องเสียหรือเครื่องหาย** — คัดลอก `<data-dir>/backups/<วันที่>-*` ออกนอกเครื่องเป็นระยะ (ไดรฟ์ภายนอก/ที่เก็บส่วนตัว)
- ห้ามนำข้อมูลภายในเข้า public repository หรือไฟล์ deploy: ไฟล์สำรอง/ฐานกลางอยู่ในโฟลเดอร์ข้อมูล (gitignored, ไม่ขึ้น Pages) เท่านั้น มี CI guard (`checkPublishSafety`) ห้ามไฟล์เหล่านี้โผล่ใน `data/` `js/` `tools/` หรือ artifact

## ไฟล์ที่เกี่ยวข้อง
- `data/business-rules.json` — ต้นทางกฎธุรกิจทั้งหมด รวมนโยบายค่าส่งแบบถามแอดมิน
- `menu-central.json` (ในโฟลเดอร์ข้อมูลแอดมิน, local only, ไม่ commit) — ฐานกลางเมนู บันทึกจากหน้า “จัดการเมนู”
- `scripts/menu-central.mjs` — migrate/ตรวจ/diff/เผยแพร่เมนูจากฐานกลาง (ตรรกะเดียวกับปุ่มเผยแพร่; มีเทสที่ `test/menu-central-publish.test.mjs`)
- `data/planner-overrides.json` — ฉบับเผยแพร่ catalog (public allowlist) สร้างจากฐานกลางเท่านั้น ห้ามแก้ด้วยมือ
- `scripts/menu-central.mjs` — ฐานข้อมูลกลางทั้งเมนูและ `sideItems` (อาหารเมนูที่ 2) + migrate/ตรวจ/diff/เผยแพร่
- `scripts/mealbox-tiers.mjs` — กติการะดับข้าวกล่องทั้งหมด: ราคาเริ่มต้น, กล่อง, อาหารเมนูที่ 2, สถานะเปิดขาย (ทุกหน้า render จากที่นี่ที่เดียว)
- `scripts/sync-catering-content.mjs` — generate ตาราง/การ์ดระดับ + การ์ดบริการ + JSON-LD + `llms.txt`/`llms-full.md` จาก `business-rules.json`
- `scripts/popular-menu-page.mjs` — generate รายการเมนูและ ItemList บนหน้าเมนู (เมนูใหม่จะไม่โผล่บนเว็บถ้าไม่รัน)
- `data/sync-manifest.json` — ทะเบียนบอกว่าข้อเท็จจริงแต่ละข้อต้องอยู่ในไฟล์ไหนบ้าง ตัวตรวจจะแดงถ้าตกหล่น
- `js/business-data.js` — generated compatibility data สำหรับกฎธุรกิจบนหน้าเว็บ
- `js/menu-data.js` — generated compatibility data สำหรับเมนูบนหน้าเว็บ
- `js/popular-menu-hydrate.js` — แสดงข้อมูลจาก `menu-data.js` แบบ static (หน้า `budget-calculator.html` และ `js/budget-calculator.js` ถูกถอดออกแล้ว)
- `js/budget-planner.js` — เครื่องมือช่วยแก้/ส่งออกข้อมูลเมนูในเครื่อง
- `scripts/check-system.mjs` — สร้างไฟล์ข้อมูลฝั่งเว็บ และตรวจกฎธุรกิจกับแคตตาล็อกทุกส่วน
- `test/system-rules.test.mjs` — regression tests ของกฎธุรกิจ
