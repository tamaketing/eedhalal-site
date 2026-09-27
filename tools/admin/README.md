# EED HALAL — เครื่องมือแอดมิน (local only, ไม่ขึ้นเว็บ)

รันบนเครื่องแอดมินเท่านั้น ผ่าน loopback `127.0.0.1` ไม่มี auth ในตัว —
การป้องกันคือเปิดได้เฉพาะเครื่องนี้ ห้ามเปิดพอร์ตออกนอกเครื่อง ห้ามส่งต่อ

## โครง (โค้ด vs ข้อมูลแยกกันชัด)
- `tools/admin/*.mjs|html|css` — **โค้ด** (version control, ไม่มีข้อมูลจริง/ความลับ)
- `EED_ADMIN_DATA_DIR` (ค่าเริ่มต้น: `demo/owner-set-builder/`) — **ข้อมูลจริง**:
  `menu-central.json`, `owner-costs.json`, `owner-settings.json`,
  `menu-publish-state.json`, `backups/` — ทั้งหมด gitignored ห้าม commit
- `scripts/menu-{central,deploy,backups}.mjs` — ตรรกะ pipeline ที่ปุ่มเรียกใช้

## เริ่มระบบ
```bat
tools\admin\start-admin.cmd
```
หรือ `node tools/admin/server.mjs 4185` (กำหนดโฟลเดอร์ข้อมูลด้วย
`EED_ADMIN_DATA_DIR=<path>` หรือ `--data-dir=<path>`) แล้วเปิด
`http://127.0.0.1:4185/` (จัดชุด) และ `http://127.0.0.1:4185/budget-planner.html`
(จัดการเมนู) ครั้งแรกที่รันจะ seed โครงเปล่าให้ (ต้องกรอกทุนจริงก่อนใช้)

## สำรองและกู้คืน
- ทุกครั้งที่บันทึกผ่านหลังบ้าน ระบบสำรองฉบับก่อนหน้าไว้ที่
  `<data-dir>/backups/<วัน>-<เวลา>-<ชื่อไฟล์>.json` อัตโนมัติ (เก็บ 20 ฉบับ)
- กู้คืนที่การ์ด “ขึ้นเว็บจริง” → รายการสำรอง → กู้คืน (สำรองฉบับปัจจุบันไว้ก่อนเสมอ)
- **ข้อจำกัด:** สำรองในเครื่องกันแก้พลาดเท่านั้น **ไม่กันเครื่องเสีย/หาย** —
  คัดลอก `<data-dir>/backups/` ออกนอกเครื่องเป็นระยะ (ไดรฟ์ภายนอก/ที่เก็บส่วนตัว)
- ย้ายเครื่อง: ติดตั้ง repo นี้ + คัดลอกโฟลเดอร์ข้อมูลเดิมมา แล้วตั้ง
  `EED_ADMIN_DATA_DIR` ชี้ไปที่นั้น (อย่า commit โฟลเดอร์ข้อมูล)

## ความปลอดภัย
- ไม่มี token ในเบราว์เซอร์หรือในโค้ด (`test/admin-runtime-clean.test.mjs` กันไว้)
- ไฟล์ใน `tools/` ไม่เข้า GitHub Pages artifact (มี CI guard ห้าม)
- deploy อัตโนมัติปิดอยู่ (`EED_ALLOW_GIT_DEPLOY!=1` ปฏิเสธพร้อมเหตุผล)

## เทส
- `node --test test/admin-logic.test.mjs test/admin-runtime-clean.test.mjs`
  รันใน CI ได้ (fixtures ใช้ชื่อ/ตัวเลขสมมติเท่านั้น — ห้ามฝังชื่อเมนูจริง
  คู่กับต้นทุนจริง)
- `demo/` เดิมยังมี `cost-store.test.mjs` / `recommend.test.mjs` ที่ผูกกับ
  ข้อมูลจริงของเครื่อง จึงรันเฉพาะในเครื่อง (`node --test demo/owner-set-builder/`)
  ไม่เข้า CI — อย่าย้ายเข้า `test/` ทั้งที่ยังอ้างข้อมูลจริง
