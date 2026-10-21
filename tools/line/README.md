# LINE auto-reply server (เครื่องเจ้าของ)

เปิดระบบทั้งหมดด้วยการดับเบิลคลิก `start-line.cmd` — มันจะเริ่ม 3 อย่างให้พร้อมกัน:

1. **Internal API** (file DB ที่ `data/line-runtime/`) — เก็บลูกค้า/ข้อความ/draft และหน้า Owner Console
2. **LINE gateway** (`server/line-gateway.mjs`) — รับ webhook, อ่านบริบทด้วย AI, ตอบอัตโนมัติ
3. **cloudflared quick tunnel** — ให้ URL HTTPS สาธารณะเอาไปตั้ง webhook ที่ LINE

## เตรียมครั้งเดียว (ในไฟล์ `.env` ที่ root repo)

ไฟล์ `.env` ต้องมีค่าเหล่านี้ (ห้าม commit ค่าจริง):

| Key | จำเป็น? | ใช้ทำอะไร | เอามาจาก |
|---|---|---|---|
| `LINE_CHANNEL_SECRET` | ✅ ต้องมี | ตรวจลายเซ็น webhook กันของปลอม | LINE Developers > Messaging API > Channel secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | ต้องมีถ้าจะ**ส่งตอบ** | token ใช้ส่งข้อความกลับลูกค้า | LINE Developers > Messaging API > Channel access token |
| `AUTO_REPLY` | ตั้ง `1` ถึงจะตอบอัตโนมัติ | สวิตช์ฆ่า — `0` = โหมดเงา (แค่เก็บ draft ไม่ส่ง) | ตั้งเอง |
| `EED_INTERNAL_API_SECRET` | สร้างอัตโนมัติให้ | กุญแจปลดล็อก Owner Console | launcher สร้างให้ตอนเปิดครั้งแรก |
| `DB_ADAPTER` / `DB_DIR` | ไม่ต้องตั้ง (launcher บังคับ file) | ที่เก็บข้อมูล | อัตโนมัติ |

## เปิดใช้

1. ดับเบิลคลิก `start-line.cmd`
2. รอจนหน้าต่างพิมพ์ `Webhook URL: https://xxx.trycloudflare.com/`
3. เอา URL นั้นไปวางที่ **LINE Developers > Messaging API > Webhook URL** แล้วกด **Verify**
4. LINE ถึงจะยิงข้อความลูกค้าเข้ามาในเครื่องได้

## เรื่อง quick tunnel ที่ต้องรู้

- quick tunnel ให้ **URL ใหม่ทุกครั้งที่เปิดใหม่** — ต้องไปแก้ webhook URL ที่ LINE Developers ใหม่ทุกครั้งที่เปิดเครื่อง
- ถ้าอยากได้ URL คงที่ถาวร ให้ตั้ง **named tunnel** (login cloudflared ครั้งเดียว) แทน — แล้วแก้ launcher หรือเปิด cloudflared เองชี้ไปที่พอร์ต 5678

## ข้อจำกัด (ตามจริง)

- คอมต้อง**เปิดอยู่ตลอด** (หรือช่วงที่อยากให้ตอบอัตโนมัติ) — ปิดคอม = ลูกค้าทักมาไม่มีคนรับ
- ไฟตก/เน็ตหลุด = ระบบดับ ลูกค้าไม่ได้คำตอบ
- ถ้าจะให้รัน 24 ชม. จริงจัง แนะนำย้ายขึ้น VPS เล็กในภายหลัง (ดู DEPLOY.md)

## ที่เก็บข้อมูล: PostgreSQL (ระบบหลัก) + file DB (สำรอง)

ข้อมูลลูกค้า แชท และ draft เก็บใน **PostgreSQL** (ฐาน `eedhalal` บนเครื่องนี้) ไม่ใช่ไฟล์ JSON แล้ว
ข้อมูลเดิมที่เคยเป็นไฟล์ถูกย้ายเข้า PostgreSQL เรียบร้อย (ลูกค้าที่คุยทั้งเดือน ก.ย. และ ต.ค.
กลายเป็นคนเดียวกัน 1 thread)

| เรื่อง | อยู่ที่ไหน |
|---|---|
| การเชื่อมต่อฐานข้อมูล + รหัสผ่าน | `data/line-runtime/runtime.env` (gitignored, อยู่แค่บนเครื่องนี้) |
| user ที่ใช้จริง | `eedhalal_app` (อ่าน/เขียนได้เฉพาะที่ต้อง) · `eedhalal_migrator` (แก้ schema) |
| ไฟล์ JSON เดิม | `data/line-runtime/*.json` — เป็นภาพ snapshot ก่อนย้าย (ไม่ถูกเขียนเพิ่มอีก) |
| สำรอง | `data/line-runtime/backups/eedhalal-<วัน>-<เวลา>.dump` (pg_dump) |

คำสั่งที่ใช้บ่อย:

```bat
node db/migrate.mjs status          ^ ดูว่ามี migration ค้างไหม
node db/migrate.mjs up              ^ ใช้ schema ใหม่ (ต้องเป็น eedhalal_migrator)
node tools/line/import-file-data.mjs --dry-run   ^ ดูว่าจะย้ายอะไรเข้า (ย้ายซ้ำได้ ข้ามของเดิม)
node tools/line/backfill-memories.mjs --ai       ^ สร้างความจำให้ลูกค้าเดิม (สรุปโดย AI)
node tools/line/backfill-pending-drafts.mjs --yes ^ ทำให้ข้อความที่ค้างโผล่ในคิวเจ้าของ
```

## ความจำลูกค้า (บอทจำข้ามบทสนทนาได้)

ทุกข้อความที่ลูกค้าทักมา ระบบจะจดไว้ 2 ชั้น:

| ชั้น | เก็บที่ไหน | ใครเขียน | ใช้ทำอะไร |
|---|---|---|---|
| **ข้อเท็จจริง** (facts) | `customer_memories.facts` | **กฎ** (อ่านจากคำของลูกค้าตรง ๆ เท่านั้น) | จำนวน/เมนู/วันที่/ที่อยู่/งบ/เบอร์/เลขภาษี/ข้อกำหนดอาหาร |
| **สรุป** (summary) | `customer_memories.summary` | **AI** เขียน 1 บรรทัด | ให้บอทตอบต่อจากที่คุยไว้ ไม่ถามซ้ำ |

- บอทเห็น "สถานะของลูกค้าคนนี้" ทุกข้อความ + บริบทสนทนา 30 รอบล่าสุด
- **เจ้าของแก้ได้** ในหน้า "ประวัติลูกค้า" — ที่เจ้าของพิมพ์เอง บอทจะไม่ทับ (`source='owner'`)
- กด "ปิดงานนี้" เมื่องานเสร็จ → สถานะปัจจุบันย้ายไปเก็บในประวัติ และข้อความใหม่เริ่มสถานะใหม่
- ข้อมูลที่เจ้าของยืนยัน (เบอร์/บริษัท/เลขภาษี/ที่อยู่) เก็บใน `customers` และบอทแก้ทับไม่ได้

> **สำรองก่อนทุกครั้งที่แตะข้อมูลจริง:**
> `pg_dump -h 127.0.0.1 -U eedhalal_migrator -d eedhalal -Fc -f data/line-runtime/backups/eedhalal-<วัน>.dump`
> (ใส่รหัสผ่านผ่าน `PGPASSWORD` หรืออ่านจาก `runtime.env` — ห้ามเขียนรหัสผ่านลงในไฟล์ที่ commit)

## ความเป็นส่วนตัว (PDPA)

| คำสั่ง | ทำอะไร |
|---|---|
| `node tools/line/privacy.mjs encrypt` | เข้ารหัสข้อมูลระบุตัวตนที่ยังเก็บเป็นข้อความธรรมดา |
| `node tools/line/privacy.mjs purge --months 24` | ลบข้อความสนทนาที่เก่ากว่า 24 เดือน (เพิ่ม `--dry-run` ดูก่อน) |
| `node tools/line/privacy.mjs forget --line-user-id Uxxxx --yes` | ลบข้อมูลลูกค้าคนนี้ทั้งหมดเมื่อลูกค้าขอ (ตามสิทธิการลบข้อมูล) |

- **เข้ารหัสอัตโนมัติ** — เบอร์โทร อีเมล บริษัท เลขประจำตัวผู้เสียภาษี ที่อยู่ และหมายเหตุ (กุญแจ `EED_DATA_KEY` ใน `runtime.env`)
- **ประวัติการทำรายการของร้านยังอยู่** แต่ไม่มีชื่อ เบอร์ หรือข้อความของลูกค้าอยู่ในนั้น
- **หน้า "ความเป็นส่วนตัว"** บนเว็บ (`/privacy.html`, `/en/privacy.html`) อธิบายให้ลูกค้าทราบว่าเก็บอะไร เก็บนานเท่าไร และขอลบได้อย่างไร

## สำรองข้อมูล

| คำสั่ง | ทำอะไร |
|---|---|
| `node tools/line/backup-postgres.mjs` | `pg_dump` → เข้ารหัส → เก็บใน `data/line-runtime/backups/` (เก็บ 30 วัน) |
| `node tools/line/backup-postgres.mjs --dest "C:\Users\me\My Drive\EED"` | เขียนตรงเข้าโฟลเดอร์ Google Drive (แอป Google Drive for Desktop อัปโหลดให้เอง) |
| `node tools/line/restore-backup.mjs --file <ไฟล์>.dump.enc --yes` | กู้คืน (สำรองของเดิมไว้ก่อนกู้) |

- ไฟล์สำรอง **เข้ารหัสเสมอ** — แม้ไฟล์จะอยู่บนคลาวด์ก็อ่านไม่ออก
- แนะนำให้ตั้ง Windows Task Scheduler รันทุกคืน 03:00 (ปรับ path ตามเครื่อง)

## ที่เก็บแชทของบอท แยกจากของเจ้าของ

ทุกครั้งที่ลูกค้าทัก LINE มา บอทจะเรียก `opencode run` หนึ่งครั้งเพื่อร่างคำตอบ
ถ้าปล่อยให้ใช้ที่เก็บ OpenCode ชุดเดียวกับเจ้าของ **ข้อความลูกค้าจะไปโผล่ในรายการแชท
ของ OpenCode ที่เจ้าของเปิดใช้** และข้อความลูกค้า (เบอร์โทร เลขภาษี ที่อยู่) จะไปอยู่ใน
ที่เก็บส่วนตัวของเจ้าด้วย

ระบบจึงแยกที่เก็บให้เองโดยอัตโนมัติตอนเปิดเครื่อง:

| ที่เก็บ | ที่อยู่ | มีอะไร |
|---|---|---|
| ของเจ้าของ | `~/.local/share/opencode/opencode.db` | งานของเจ้าของเท่านั้น |
| ของบอท | `data/line-runtime/opencode-bot.db` | แชทลูกค้า (เก็บ 7 วัน แล้วล้างอัตโนมัติ) |

- ไฟล์ของบอทอยู่ใน `data/line-runtime/` ที่ gitignore ไว้ → ไม่ขึ้น Git ไม่ขึ้นเว็บ
- ถ้าเตรียมไม่สำเร็จ บอทจะกลับไปใช้ที่เก็บร่วมแบบเดิม (ดู log ตอนเปิด) — ไม่ล้ม
- ล้างเอง: `node tools/line/clean-bot-sessions.mjs`
- ล้างแชทเก่าที่หลงอยู่ในที่เก็บของเจ้าของ: `node tools/line/clean-bot-sessions.mjs --owner`
  แล้วสั่ง `opencode service restart` เพื่อให้รายการในแอปเปลี่ยนตาม
- ตรวจว่าระบบแยกถูกต้อง: `node scripts/check-line-bot-store.mjs`

## ความปลอดภัยที่ยึดไว้

- replyToken ใช้ครั้งเดียวในหน่วยความจำ ไม่ผ่าน DB
- เรื่องเงิน/สั่งซื้อ/ราคาเฉพาะ → **ไม่ตอบอัตโนมัติ** เก็บ draft รอเจ้าของกดใน Owner Console (`http://127.0.0.1:8788/owner/`)
- ตั้ง `AUTO_REPLY=0` = ปิดส่งอัตโนมัติทันที กลับเป็นแค่ draft
- แชทของลูกค้าไม่โผล่ในรายการแชท OpenCode ของเจ้าของ และข้อความลูกค้าไม่ถูกส่งออกนอกเครื่อง
