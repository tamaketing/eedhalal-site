# Deploy แบบไม่ต้องมีหลังบ้าน (ข้อมูลกลางจาก GitHub)

## วิธีใช้ (เจ้าของ)
1. แก้ข้อมูลธุรกิจทั้งหมด รวมถึงราคาเริ่มต้น ขั้นต่ำ เอกสาร lead time พื้นที่ส่ง และนโยบายค่าส่ง (ถามแอดมิน ไม่มีเรท/โซน/ยอดส่งฟรี) ที่ `data/business-rules.json`
2. จัดการเมนูที่หน้า **จัดการเมนู** (`budget-planner.html` ผ่าน local server ของแอดมิน):
   - กด **บันทึก** เพื่อเก็บฐานกลางในเครื่อง (สำรองอัตโนมัติก่อนทุกครั้ง เครื่องมือแอดมินใช้ทันที เว็บลูกค้ายังใช้ฉบับเดิม)
   - กด **ดูตัวอย่างและเผยแพร่** เพื่อเทียบกับฉบับไฟล์ก่อนยืนยัน — ขั้นนี้สร้างไฟล์ในเครื่องเท่านั้น สถานะคือ “เตรียมไฟล์แล้ว — รอขึ้นเว็บไซต์” **ยังไม่ถือว่าเผยแพร่แล้ว**
   - กด **เผยแพร่ขึ้นเว็บจริง** (การ์ด “ขึ้นเว็บจริง”) ระบบจะตรวจไฟล์อีกรอบ → commit **เฉพาะ** `data/planner-overrides.json` + `js/menu-data.js` → push → รอตรวจว่าเว็บจริงให้บริการฉบับนี้แล้ว ขึ้น “เผยแพร่แล้ว” ต่อเมื่อตรวจพบจริงเท่านั้น ถ้าตรวจไม่ได้จะขึ้น “ยังไม่ยืนยัน”
   - ห้ามแก้ `data/planner-overrides.json` หรือ `js/menu-data.js` ด้วยมือ ทั้งสองไฟล์สร้างจากฐานกลางเท่านั้น (deploy จะหยุดถ้าพบว่าไฟล์ถูกแก้ด้วยมือ หรือมี commit อื่นรอ push รวมอยู่)
3. รัน `node scripts/check-system.mjs --write` เพื่อซิงก์ Calculator และฐานความรู้ AI
4. รัน `node scripts/check-public-site.mjs` (ตรวจว่าไฟล์สาธารณะไม่มีต้นทุน/ข้อมูลภายในหลุด) และ `node --test` ให้ผ่านทั้งหมด
5. ถ้าแก้กฎที่ LINE bot ใช้ ให้รัน `node scripts/check-system.mjs --write`, publish ผ่าน n8n UI/API ตาม `line-ai/OPERATIONS.md`, แล้วรัน `node scripts/smoke-production.mjs`
6. การขึ้นเว็บอัตโนมัติจากหลังบ้านยัง**ปิดอยู่โดยค่าเริ่มต้น** (ต้องตั้ง `EED_ALLOW_GIT_DEPLOY=1` แล้วเริ่ม server ใหม่) — เปิดแล้วปุ่ม “เผยแพร่ขึ้นเว็บจริง” จะ commit เฉพาะไฟล์เผยแพร่ + push ด้วย git ของเครื่องแอดมินเอง (ไม่ใช้ token ในเบราว์เซอร์) แล้วตรวจเว็บจริงต่อ ถ้ายังไม่เปิด ให้ commit/push เองตามปกติ (push คือขั้นตอนที่ขึ้น GitHub Pages จริง)

## การทำงาน
- `data/business-rules.json` เป็นข้อมูลกลางของกฎธุรกิจที่เว็บและ AI ต้องใช้ร่วมกัน
- ฐานกลางเมนู (`demo/owner-set-builder/menu-central.json`, local only, gitignored) เป็นต้นทางของเมนูทั้งหมด: ชื่อ รูป หมวด คำอธิบาย ราคาขาย ขั้นต่ำ ลำดับแสดงผล และการซ่อน — อ้างอิงด้วย ID เมนูเดิม ส่วนต้นทุนอยู่ `owner-costs.json` (local only) เท่านั้น
- `data/planner-overrides.json` + `js/menu-data.js` เป็น**ฉบับเผยแพร่** (public, allowlist เฉพาะ ID/ชื่อ/รูป/หมวด/คำอธิบาย/ราคาขาย/ขั้นต่ำ/ลำดับแสดงผล) สร้างจากฐานกลางด้วยปุ่มเผยแพร่เท่านั้น ห้ามมีต้นทุน กำไร หรือหมายเหตุภายใน
- `js/business-data.js` เป็น compatibility file สำหรับกฎธุรกิจบนหน้าเว็บ และต้องตรงกับข้อมูลกลาง
- `line-ai/knowledge-pack.md` และ `line-ai/system-message-node.txt` เป็น generated files ห้ามแก้โดยตรง
- Calculator ยังรองรับ localStorage สำหรับ preview ในเครื่อง แต่ข้อมูลที่ deploy ให้ลูกค้าใช้มาจากไฟล์ใน repository
- CI จะหยุด deployment เมื่อข้อมูลธุรกิจ Calculator และ AI ไม่ตรงกัน
- `budget-planner.html`, `kitchen-order.html` และข้อมูลต้นทุนเป็นเครื่องมือภายใน จึงไม่ถูก deploy ไป GitHub Pages

## ทดสอบ
- รัน `node scripts/check-system.mjs`
- รัน `node --test`
- เปิดผ่าน GitHub Pages หรือใช้ `start-server.bat` แล้วเปิด `http://localhost:8000/popular-menu.html`

## การสำรองและกู้คืน (ข้อมูลภายใน)
- ทุกครั้งที่บันทึก `menu-central.json` / `owner-costs.json` ผ่านหลังบ้าน ระบบสำรองฉบับก่อนหน้าไว้ที่ `demo/owner-set-builder/backups/` อัตโนมัติ (เก็บ 20 ฉบับต่อข้อมูล ชื่อมีวันเวลาถึงมิลลิวินาที) ถ้าสำรองไม่สำเร็จจะ**ไม่บันทึก**ต่อ
- กู้คืนที่การ์ด “ขึ้นเว็บจริง” (รายการสำรอง → กู้คืน) ระบบจะสำรองฉบับปัจจุบันไว้ก่อนกู้เสมอ
- **ข้อจำกัด:** สำรองในเครื่องเดียวกันกันแก้พลาด/เผยแพร่พลาดเท่านั้น **ไม่กันเครื่องเสียหรือเครื่องหาย** — คัดลอก `demo/owner-set-builder/backups/<วันที่>-*` ออกนอกเครื่องเป็นระยะ (ไดรฟ์ภายนอก/ที่เก็บส่วนตัว)
- ห้ามนำข้อมูลต้นทุนหรือข้อมูลภายในเข้า public repository หรือไฟล์ deploy: ไฟล์สำรอง/ฐานกลาง/ต้นทุนอยู่ใต้ `demo/` (gitignored, ไม่ขึ้น Pages) เท่านั้น มี CI guard (`checkPublishSafety`) ห้ามไฟล์เหล่านี้โผล่ใน `data/` `js/` หรือ artifact

## ไฟล์ที่เกี่ยวข้อง
- `data/business-rules.json` — ต้นทางกฎธุรกิจทั้งหมด รวมนโยบายค่าส่งแบบถามแอดมิน
- `demo/owner-set-builder/menu-central.json` — ฐานกลางเมนู (local only, ไม่ commit) บันทึกจากหน้า “จัดการเมนู”
- `scripts/menu-central.mjs` — migrate/ตรวจ/diff/เผยแพร่เมนูจากฐานกลาง (ตรรกะเดียวกับปุ่มเผยแพร่; มีเทสที่ `test/menu-central-publish.test.mjs`)
- `data/planner-overrides.json` — ฉบับเผยแพร่ catalog (public allowlist) สร้างจากฐานกลางเท่านั้น ห้ามแก้ด้วยมือ
- `js/business-data.js` — generated compatibility data สำหรับกฎธุรกิจบนหน้าเว็บ
- `js/menu-data.js` — generated compatibility data สำหรับเมนูบนหน้าเว็บ
- `js/popular-menu-hydrate.js` — แสดงข้อมูลจาก `menu-data.js` แบบ static (หน้า `budget-calculator.html` และ `js/budget-calculator.js` ถูกถอดออกแล้ว)
- `js/budget-planner.js` — เครื่องมือช่วยแก้/ส่งออกข้อมูลเมนูในเครื่อง
- `scripts/check-system.mjs` — สร้างไฟล์ AI และตรวจข้อมูลทุกส่วน
- `test/system-rules.test.mjs` — regression tests ของกฎธุรกิจ
