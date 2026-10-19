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

## ความปลอดภัยที่ยึดไว้

- replyToken ใช้ครั้งเดียวในหน่วยความจำ ไม่ผ่าน DB
- เรื่องเงิน/สั่งซื้อ/ราคาพิเศษ → **ไม่ตอบอัตโนมัติ** เก็บ draft รอเจ้าของกดใน Owner Console (`http://127.0.0.1:8788/owner/`)
- ตั้ง `AUTO_REPLY=0` = ปิดส่งอัตโนมัติทันที กลับเป็นแค่ draft
