# Deploy แบบไม่ต้องมีหลังบ้าน (ราคา static จาก GitHub)

## วิธีใช้ (เจ้าของ)
1. แก้ราคา/ขั้นต่ำ/ท็อปปิ้งใน `js/menu-data.js` โดยตรง หรือเปิด `budget-planner.html?key=2024` เพื่อช่วยจัดเตรียมข้อมูล
2. ถ้าใช้ planner ให้กด **⬇ ดาวน์โหลดไฟล์ Deploy** แล้วนำไฟล์ `menu-data.js` ไปแทนที่ `js/menu-data.js` ใน repository
3. Commit และ Push ขึ้น GitHub

## การทำงาน
- `budget-calculator.html` อ่านเมนู/ราคา/ขั้นต่ำ/ท็อปปิ้งจาก `js/menu-data.js` เท่านั้น
- ราคาไม่ถูกอ่านจาก `localStorage` และไม่มีการ fetch override จาก server จึงไม่เปลี่ยนตามเครื่องหรือผู้เข้าชม
- เมื่อเปลี่ยนราคา ให้แก้ `js/menu-data.js` แล้ว Commit/Push ใหม่

## ทดสอบ
- เปิดผ่าน GitHub Pages หรือใช้ `start-server.bat` แล้วเปิด `http://localhost:8000/budget-calculator.html`

## ไฟล์ที่เกี่ยวข้อง
- `js/menu-data.js` — ต้นทางเดียวของเมนู ราคา ขั้นต่ำ และท็อปปิ้ง
- `js/budget-calculator.js` — แสดงข้อมูลจาก `menu-data.js` แบบ static
- `js/budget-planner.js` — เครื่องมือช่วยแก้/ส่งออก `menu-data.js` ในเครื่อง
