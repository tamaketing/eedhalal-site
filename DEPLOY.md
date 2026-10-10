# EED HALAL — เตรียมไฟล์ ตรวจ และเผยแพร่เว็บไซต์

ไฟล์นี้ดูแลลำดับสร้างไฟล์และคำสั่งตรวจ/ขึ้นเว็บ ข้อมูลว่าแก้ต้นทางที่ไหนอยู่ที่ [FACTS.md](FACTS.md) กฎการทำงานและการเขียนอยู่ที่ [AGENTS.md](AGENTS.md) ส่วนวิธีเปิดเครื่องมือและสำรองข้อมูลอยู่ที่ [คู่มือแอดมิน](tools/admin/README.md)

## 1. แก้ต้นทางและเตรียมแคตตาล็อก

- กฎธุรกิจแก้ที่ `data/business-rules.json` ก่อน แล้วดูจุดซิงก์จาก `data/sync-manifest.json` และค้นหาสำเนาเพิ่มเติม
- เมนู ราคา รูป ระดับ ขั้นต่ำรายเมนู และอาหารเมนูที่ 2 แก้ผ่านหน้า **จัดการเมนู** ปุ่ม **บันทึก** เก็บฐานกลางในเครื่องและสำรองฉบับก่อนหน้า
- กด **ดูตัวอย่างและเผยแพร่** เพื่อตรวจรายการเปลี่ยนแปลงก่อนยืนยัน ขั้นนี้สร้าง `data/planner-overrides.json` และ `js/menu-data.js` ในเครื่อง สถานะ “เตรียมไฟล์แล้ว — รอขึ้นเว็บไซต์” ยังไม่ใช่การขึ้นเว็บจริง
- ห้ามแก้ไฟล์แคตตาล็อกทั้งสองด้วยมือ ราคาเริ่มต้นของระดับข้าวกล่องคำนวณจากชุดที่ขายได้ในแคตตาล็อก ไม่พิมพ์ตัวเลขราคาเริ่มต้นลงในกฎธุรกิจ
- ถ้าแก้เฉพาะเอกสารหรือข้อความที่ไม่กระทบข้อมูลกลาง ไม่ต้องเผยแพร่ฐานเมนูใหม่

## 2. สร้างไฟล์ที่ใช้ข้อมูลกลาง

เมื่อเปลี่ยนกฎธุรกิจหรือแคตตาล็อก ให้รันจาก root ของโปรเจกต์ตามลำดับ:

```powershell
node scripts/sync-catering-content.mjs --write
node scripts/popular-menu-page.mjs --write
node scripts/check-system.mjs --write
```

| คำสั่ง | ผลลัพธ์ |
|---|---|
| `sync-catering-content.mjs --write` | ตาราง/การ์ดระดับ การ์ดบริการ structured data และบล็อกข้อมูลกลางใน llms |
| `popular-menu-page.mjs --write` | รายการเมนูและ ItemList บนหน้าเมนูไทย–อังกฤษ |
| `check-system.mjs --write` | ซิงก์ข้อมูลธุรกิจ เมนู และ Snack Box ที่หน้าเว็บใช้ |

ตรวจ diff หลังสร้างไฟล์ และแก้ข้อความนอกบล็อกอัตโนมัติให้ตรงด้วย เช่น FAQ บทความ และ LINE OA ตัวตรวจ `check-business-sync.mjs` ไม่มีโหมด `--write` เพราะต้องรักษาความหมายและน้ำเสียงของข้อความเหล่านี้ด้วยมือ

## 3. ตรวจงานก่อนขึ้นเว็บ

```powershell
node scripts/check-repository-safety.mjs
node scripts/check-line-endings.mjs
node scripts/check-docs.mjs
node scripts/sync-business-content.mjs --check
node scripts/sync-catering-content.mjs --check
node scripts/check-system.mjs --check
node scripts/popular-menu-page.mjs --check
node scripts/check-starting-price.mjs
node scripts/check-business-sync.mjs --check
node scripts/check-public-site.mjs
node scripts/check-search-discovery.mjs
node --test --test-concurrency=1
```

ใช้ `--test-concurrency=1` เพราะบางชุดทดสอบแก้ข้อความในไฟล์จริงชั่วคราวเพื่อพิสูจน์ว่าตัวตรวจจับข้อมูลผิดได้ หากรันพร้อมกัน ตัวตรวจอีกชุดอาจอ่านจังหวะที่ไฟล์ยังไม่ถูกคืนค่า

- ตรวจ `git diff` และเลือกเฉพาะไฟล์ที่เกี่ยวกับงาน รวมไฟล์ที่สร้างจากข้อมูลกลาง
- รูปใหม่ต้องเข้า Git พร้อมงาน ตรวจด้วย `git status --porcelain -- img/` และเพิ่มไฟล์รูปที่ใช้จริงก่อน commit
- งานที่เปลี่ยนหน้าลูกค้า: เปิด `start-server.bat` แล้วใช้เครื่องมือแอดมินที่ `http://127.0.0.1:4185/budget-planner.html` หรือดูตัวอย่างเว็บไซต์สาธารณะด้วย `preview-public.bat` ที่ `http://127.0.0.1:8000/` ตรวจมือถือ ลิงก์ CTA ข้อความไทย–อังกฤษ และอ่านทวนตาม Naturalness Test ใน AGENTS
- CI ตรวจอีกครั้งก่อนสร้างเว็บไซต์ ดูคำสั่งที่ใช้งานจริงใน [.github/workflows/pages.yml](.github/workflows/pages.yml)

## 4. เผยแพร่และยืนยันผล

### งานที่มีหน้าเว็บ ข้อความ หรือไฟล์ที่สร้างใหม่

หลังข้อ 3 ผ่าน ให้ commit ไฟล์ที่เกี่ยวข้องครบชุดแล้ว push ไปสาขาที่ตั้งให้เผยแพร่ใน GitHub Pages workflow จากนั้นรอ build/deploy และ smoke test ผ่าน ตรวจหน้าเว็บจริงที่แก้ก่อนถือว่างานขึ้นครบแล้ว การ push สำเร็จอย่างเดียวยังไม่ยืนยันผลบนเว็บ

### ปุ่ม “เผยแพร่ขึ้นเว็บจริง” ของแอดมิน

ปุ่มนี้ปิดโดยค่าเริ่มต้น เปิดได้ด้วย `EED_ALLOW_GIT_DEPLOY=1` แล้วเริ่ม server ใหม่ การทำงานอยู่ใน [scripts/menu-deploy.mjs](scripts/menu-deploy.mjs):

ปุ่ม **อัปเดตเว็บทั้งหมด** รวมการดูตัวอย่าง เตรียมแคตตาล็อก สร้างไฟล์เว็บไซต์ และเรียกขั้นตอนขึ้นเว็บเดียวกันไว้ในครั้งเดียว ชื่อปุ่มไม่ได้หมายความว่าจะรวมงานที่แก้ค้างใน working checkout เข้าไปด้วย

- สร้าง worktree แยกจาก remote แล้วสร้างแคตตาล็อกก่อน
- คัดลอกรูปเมนูใหม่ที่ฐานกลางอ้างอิงจาก working checkout เข้า worktree ก่อนตรวจรูป โดยอ่านอย่างเดียว ไม่เขียน working checkout
- รันตัวสร้างเว็บไซต์ใน worktree ตามลำดับข้อ 2 ให้ครบ ได้แก่ หน้า HTML ไทย–อังกฤษ structured data ไฟล์ llms และข้อมูลเว็บที่ต้องสร้าง
- ตรวจราคา ข้อความ และคำแปลให้ตรงกันก่อน commit ถ้าไม่ตรงให้หยุดพร้อมระบุไฟล์
- รวบรวมรายการไฟล์เผยแพร่จาก diff พร้อม hash แล้ว commit/push เฉพาะไฟล์เหล่านั้น โดยใช้ Git ของเครื่องแอดมิน ไม่มี token ในเบราว์เซอร์
- รอตรวจไฟล์เผยแพร่ครบชุดที่เว็บจริงให้บริการ ถ้ายืนยันไม่ได้จะแสดง “ยังไม่ยืนยัน”

## ขอบเขตไฟล์สาธารณะ

- `llms.txt` และ `llms-full.md` ขึ้นเว็บไซต์สำหรับ AI อ่าน ส่วน AGENTS, FACTS และ DEPLOY เป็นคู่มือใน repository
- `budget-planner.html`, `kitchen-order.html` และ `tools/admin/` เป็นเครื่องมือภายใน ไม่เข้า GitHub Pages
- ฐานเมนูกลาง ไฟล์สำรอง และข้อมูลภายในไม่เข้า public repository หรือไฟล์ deploy; ดูวิธีสำรอง กู้คืน และย้ายเครื่องที่ [คู่มือแอดมิน](tools/admin/README.md)
