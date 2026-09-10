# Deploy แบบไม่ต้องมีหลังบ้าน (ข้อมูลกลางจาก GitHub)

## วิธีใช้ (เจ้าของ)
1. แก้ข้อมูลธุรกิจ ราคาเริ่มต้น ขั้นต่ำ เอกสาร หรือ lead time ที่ `data/business-rules.json`
2. แก้ราคา/ขั้นต่ำรายเมนูและค่าส่งที่ `data/planner-overrides.json` หรือเปิด `budget-planner.html` ผ่าน local server ของแอดมินเพื่อส่งออกไฟล์นี้
3. รัน `node scripts/check-system.mjs --write` เพื่อซิงก์ Calculator และฐานความรู้ AI
4. รัน `node --test` ให้ผ่านทั้งหมด
5. ถ้าแก้กฎที่ LINE bot ใช้ ให้รัน `node scripts/check-system.mjs --write`, publish ผ่าน n8n UI/API ตาม `line-ai/OPERATIONS.md`, แล้วรัน `node scripts/smoke-production.mjs`
6. Commit และ Push ขึ้น GitHub

## การทำงาน
- `data/business-rules.json` เป็นข้อมูลกลางของกฎธุรกิจที่เว็บและ AI ต้องใช้ร่วมกัน
- `data/planner-overrides.json` เป็นข้อมูลกลางของเมนู ราคา ขั้นต่ำรายเมนู และโซนส่ง
- `js/business-data.js` และ `js/menu-data.js` เป็น compatibility files ที่สร้างให้หน้า static ใช้งาน และต้องตรงกับข้อมูลกลาง
- `line-ai/knowledge-pack.md` และ `line-ai/system-message-node.txt` เป็น generated files ห้ามแก้โดยตรง
- Calculator ยังรองรับ localStorage สำหรับ preview ในเครื่อง แต่ข้อมูลที่ deploy ให้ลูกค้าใช้มาจากไฟล์ใน repository
- CI จะหยุด deployment เมื่อข้อมูลธุรกิจ Calculator และ AI ไม่ตรงกัน
- `budget-planner.html`, `kitchen-order.html` และข้อมูลต้นทุนเป็นเครื่องมือภายใน จึงไม่ถูก deploy ไป GitHub Pages

## ทดสอบ
- รัน `node scripts/check-system.mjs`
- รัน `node --test`
- เปิดผ่าน GitHub Pages หรือใช้ `start-server.bat` แล้วเปิด `http://localhost:8000/budget-calculator.html`

## ไฟล์ที่เกี่ยวข้อง
- `data/business-rules.json` — ต้นทางกฎธุรกิจ ราคาเริ่มต้น เอกสาร และ lead time
- `data/planner-overrides.json` — ต้นทางเมนู ราคา ขั้นต่ำรายเมนู และค่าส่ง
- `js/business-data.js` — generated compatibility data สำหรับกฎธุรกิจบนหน้าเว็บ
- `js/menu-data.js` — generated compatibility data สำหรับเมนูบนหน้าเว็บ
- `js/budget-calculator.js` — แสดงข้อมูลจาก `menu-data.js` แบบ static
- `js/budget-planner.js` — เครื่องมือช่วยแก้/ส่งออกข้อมูลเมนูในเครื่อง
- `scripts/check-system.mjs` — สร้างไฟล์ AI และตรวจข้อมูลทุกส่วน
- `test/system-rules.test.mjs` — regression tests ของกฎธุรกิจ
