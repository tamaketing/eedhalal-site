# Deploy แบบไม่ต้องมีหลังบ้าน (ข้อมูลกลางจาก GitHub)

## วิธีใช้ (เจ้าของ)
1. แก้ข้อมูลธุรกิจทั้งหมด รวมถึงราคาเริ่มต้น ขั้นต่ำ เอกสาร lead time พื้นที่ส่ง ค่าส่ง และเกณฑ์ส่งฟรี ที่ `data/business-rules.json`
2. แก้เฉพาะ catalog/UI override เช่น ราคา ชื่อ รูป และขั้นต่ำรายเมนูที่อนุญาต ที่ `data/planner-overrides.json` หรือเปิด `budget-planner.html` ผ่าน local server ของแอดมินเพื่อส่งออกไฟล์นี้
3. รัน `node scripts/check-system.mjs --write` เพื่อซิงก์ Calculator และฐานความรู้ AI
4. รัน `node --test` ให้ผ่านทั้งหมด
5. ถ้าแก้กฎที่ LINE bot ใช้ ให้รัน `node scripts/check-system.mjs --write`, publish ผ่าน n8n UI/API ตาม `line-ai/OPERATIONS.md`, แล้วรัน `node scripts/smoke-production.mjs`
6. Commit และ Push ขึ้น GitHub

## การทำงาน
- `data/business-rules.json` เป็นข้อมูลกลางของกฎธุรกิจที่เว็บและ AI ต้องใช้ร่วมกัน
- `data/planner-overrides.json` เป็นข้อมูล catalog/UI override เท่านั้น ไม่ใช่แหล่งกฎธุรกิจหรือโซนส่ง
- `js/business-data.js` และ `js/menu-data.js` เป็น compatibility files ที่สร้างให้หน้า static ใช้งาน และต้องตรงกับข้อมูลกลาง
- `line-ai/knowledge-pack.md` และ `line-ai/system-message-node.txt` เป็น generated files ห้ามแก้โดยตรง
- Calculator ยังรองรับ localStorage สำหรับ preview ในเครื่อง แต่ข้อมูลที่ deploy ให้ลูกค้าใช้มาจากไฟล์ใน repository
- CI จะหยุด deployment เมื่อข้อมูลธุรกิจ Calculator และ AI ไม่ตรงกัน
- `budget-planner.html`, `kitchen-order.html` และข้อมูลต้นทุนเป็นเครื่องมือภายใน จึงไม่ถูก deploy ไป GitHub Pages

## ทดสอบ
- รัน `node scripts/check-system.mjs`
- รัน `node --test`
- เปิดผ่าน GitHub Pages หรือใช้ `start-server.bat` แล้วเปิด `http://localhost:8000/popular-menu.html`

## ไฟล์ที่เกี่ยวข้อง
- `data/business-rules.json` — ต้นทางกฎธุรกิจทั้งหมด รวมพื้นที่ส่ง ค่าส่ง และเกณฑ์ส่งฟรี
- `data/planner-overrides.json` — ต้นทาง catalog override เช่น เมนู ราคา และขั้นต่ำรายเมนู
- `js/business-data.js` — generated compatibility data สำหรับกฎธุรกิจบนหน้าเว็บ
- `js/menu-data.js` — generated compatibility data สำหรับเมนูบนหน้าเว็บ
- `js/popular-menu-hydrate.js` — แสดงข้อมูลจาก `menu-data.js` แบบ static (หน้า `budget-calculator.html` และ `js/budget-calculator.js` ถูกถอดออกแล้ว)
- `js/budget-planner.js` — เครื่องมือช่วยแก้/ส่งออกข้อมูลเมนูในเครื่อง
- `scripts/check-system.mjs` — สร้างไฟล์ AI และตรวจข้อมูลทุกส่วน
- `test/system-rules.test.mjs` — regression tests ของกฎธุรกิจ
