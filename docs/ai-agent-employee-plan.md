# แผน: พนักงาน AI เอเจนต์ EED HALAL (ผู้จัดการ + แผนก + ผู้คุมกฎ) บน OpenCode

สถานะ: **แผน (ยังไม่ได้ลงมือเขียนโค้ด)**
แทนที่แผนเดิมที่จะเขียน LLM client + REPL เอง รุ่นนี้ใช้ **OpenCode** เป็นเชลล์
(OpenCode TUI = เทอร์มินัล) และเป็นชั้นโมเดล AI (เลือก provider ได้ตามที่ OpenCode รองรับ)

เจ้าของเอกสาร: แผนนี้บรรยายวิธีสร้างเครื่องมือใหม่ ถ้าวันหนึ่งเครื่องมือนี้กลายเป็นขั้นตอนที่ต้องรันบ่อย
ให้ย้ายคำสั่งไป `tools/admin/README.md` หรือ `DEPLOY.md` ตามความรับผิดชอบของเอกสารแต่ละอัน
(ดู `AGENTS.md` หัวข้อ Document Responsibilities)

---

## 1. สิ่งที่เปลี่ยนจากแผนเดิม

รุ่นนี้ไม่ต้องเขียนซ้ำสิ่งที่ OpenCode มีอยู่แล้ว

| แผนเดิม (เขียนเอง) | รุ่นนี้ (ใช้ของ OpenCode) |
|-------------------|------------------------|
| `agent/llm/*` — client 4 เจ้า, retry, นับโทเคน | **ตัดทิ้ง** — ใช้ `models`/`providers` ของ OpenCode เลือกได้ทีหลังใน TUI |
| `tools/agent/eed.mjs` — REPL + ตัวแยกคำสั่ง | **ตัดทิ้ง** — เปิด `opencode` ในโฟลเดอร์โปรเจกต์ ได้ปุ่ม slash, tab, diff, approval ครบ |
| `agent/permissions.mjs` — capability gate | **ตัดทิ้ง** — ใช้ `permissions` ใน `opencode.jsonc` (เอกสาร: <https://opencode.ai/v2/docs/permissions/>) |
| `agent/manager.mjs` — วง delegate เอง | **ตัดทิ้ง** — ผู้จัดการคือ `primary` agent ที่เรียก `subagent` tool |
| `agent/departments/*.mjs` — prompt แยกตามแผนก | **ย้ายเป็น** `.opencode/agents/<แผนก>.md` แต่ละไฟล์ |
| `agent/context/business-context.mjs` | **กลายเป็น** สคริปต์ `tools/agent/context.mjs` ที่ agent เรียกใช้เอง |
| ต้องเขียน test ของ LLM client | **ไม่ต้อง** — เหลือแต่เทสต์สคริปต์ deterministic ที่เราเขียนเอง |

ที่เหลือจริง ๆ มี 3 อย่าง:
1. **นิยามองค์กร** — ผู้จัดการ 1 + แผนก 5 แผนก + ผู้คุมกฎ 1 เป็นไฟล์ `.opencode/agents/*.md`
2. **นโยบายความปลอดภัย** — `permissions` ใน `.opencode/opencode.jsonc` (อนุญาตให้ commit / push ได้ / ห้ามย้อนกลับไม่ได้ / ห้ามแตะของลับ)
3. **คำสั่ง deterministic** — สคริปต์ Node ใน `tools/agent/` ที่คำนวณเรื่องธุรกิจแบบไม่ใช้ LLM
   แล้วให้ agent เรียกผ่าน slash command / skill

---

## 2. สถาปัตยกรรม

```
เจ้าของพิมพ์ใน TUI
   │  "งบกล่องละ 120 จัดงานอบรม 80 คน"  /  /menu 120  /check
   ▼
OpenCode TUI  (โมเดล + permission engine + subagent runtime)
   │
   ├── agent: eed-manager (primary) ── ไม่มีสิทธิ์แก้ไฟล์/รันคำสั่งเลย
   │       และ subagent ที่เรียกได้มีแค่ 6 ตัวที่กำหนดไว้
   │       ▼
   │     ├── subagent: menu      → tools/agent/menu-match.mjs, menu-set.mjs (ผ่าน admin 4185)
   │     ├── subagent: content   → แก้ *.html / data/*.json แล้วรัน check ต่อท้าย
   │     ├── subagent: verify    → รัน check-* และ node --test อย่างเดียว
   │     ├── subagent: replies   → tools/agent/inbox.mjs (อ่านอย่างเดียว)
   │     ├── subagent: report    → tools/agent/report.mjs
   │     └── subagent: guardian  → ผู้คุมกฎ อ่านอย่างเดียว ตรวจงานก่อนสรุปให้เจ้าของ
   │
   ├── .opencode/commands/*.md   → /menu /check /sync /drafts /report /page  (deterministic)
   ├── .opencode/skills/*/SKILL.md → ขั้นตอนปฏิบัติงานที่ต้องทำตามลำดับ
   └── AGENTS.md (มีอยู่แล้ว)     → OpenCode โหลดเป็น instructions อัตโนมัติ ทุกเซสชัน
```

`AGENTS.md` ของโปรเจกต์นี้มีอยู่แล้วและ OpenCode โหลดให้ทุกเซสชันอยู่แล้ว
จึง **ไม่ต้องเขียนกฎซ้ำ** และตาม `AGENTS.md` ห้ามสร้างสำเนากฎไว้ที่อื่น
ไฟล์ agent ที่จะเขียนต้อง **อ้างอิง** `AGENTS.md` เท่านั้น ห้ามคัดลอกข้อความกฎไปใส่ใน prompt

---

## 3. ไฟล์ที่จะสร้าง

```
.opencode/
  opencode.jsonc ................ โมเดลเริ่มต้น + default_agent + permissions (หัวใจของความปลอดภัย)
  agents/
    eed-manager.md .............. ผู้จัดการ (primary)
    menu.md ..................... แผนกเมนูและราคา (subagent)
    content.md .................. แผนกเนื้อหาเว็บ ไทย/อังกฤษ (subagent)
    verify.md ................... แผนกตรวจสอบความถูกต้อง (subagent)
    replies.md .................. แผนกข้อความตอบลูกค้า (subagent)
    report.md ................... แผนกสรุปงาน (subagent)
    guardian.md ................. ผู้คุมกฎ (subagent อ่านอย่างเดียว มีสิทธิ์ยับยั้งงาน)
  commands/
    menu.md ..................... /menu <งบหรือชื่อเมนู>
    menu-set.md ................. /menu-set <ชื่อ> <ราคา>  (เสนอการแก้ แล้วถามยืนยัน)
    check.md .................... /check  (รัน check-all)
    sync.md ..................... /sync   (ตรวจ business sync)
    drafts.md ................... /drafts (คิวตอบ LINE)
    report.md ................... /report (สรุปงานวันนี้)
    page.md ..................... /page <url หรือชื่อหน้า> (งานเนื้อหา)
  skills/
    menu-change/SKILL.md ........ ขั้นตอนเปลี่ยนเมนู/ราคา แบบไม่หลุดกรอบ
    site-content/SKILL.md ....... ขั้นตอนแก้เนื้อหาเว็บตาม AGENTS.md
    release/SKILL.md ............ ขั้นตอนเผยแพร่เว็บ (commit/push ได้ / ปุ่ม deploy ให้เจ้าของกดเอง)

tools/agent/
  context.mjs ................... พิมพ์ข้อมูลธุรกิจจริง (ราคา/ขั้นต่ำ/นโยบาย) เป็นข้อความ
  menu-match.mjs ................ จับคู่เมนูตามงบแบบ deterministic
  menu-set.mjs .................. เทียบและแก้ฐานเมนูกลางผ่าน admin server (127.0.0.1:4185)
  inbox.mjs ..................... อ่าน drafts / leads ผ่าน Internal API (127.0.0.1:8788)
  report.mjs .................... สรุปสถานะวันนี้

services/
  budget-match.mjs .............. (โยกตรรกะจับคู่เมนูตามงบออกจาก tools/admin/app.mjs
                                  ให้ทั้งหน้าเว็บเครื่องมือ และ agent ใช้ตรรกะเดียวกัน)

docs/agent-employee.md .......... คู่มือใช้งาน (สร้างตอนเฟส 5)
test/agent-*.test.mjs ........... เทสต์ของสคริปต์ใน tools/agent/
```

`.opencode/` ไม่ถูกนำขึ้น GitHub Pages เพราะ workflow คัดลอกเฉพาะรายการที่อนุญาต
(`*.html`, `robots.txt`, `sitemap.xml`, `llms*`, `blog css img en data`, `js` ที่กรองแล้ว)
จึงไม่มีปัญหากับ `test/public-site.test.mjs`

---

## 4. นโยบายความปลอดภัย (หัวใจของงานนี้)

ข้อตกลง (แก้เมื่อ 2026-10-19): **เขียน/แก้ไฟล์ในเครื่องได้ และอนุญาตให้ commit / push ขึ้น `origin/main` ได้**

ขอบเขตที่ยังห้ามแม้ได้ commit/push:
- รูปแบบที่ย้อนกลับไม่ได้ — `git push --force`, `--force-with-lease`, `--delete`, refspec แบบ `:` (เช่น `HEAD:main`)
- `git reset --hard`, `git clean`, และการเพิ่ม/เปลี่ยน remote
- ของลับ — `menu-central.json`, `menu-publish-state.json`, `backups/`, `.env*` (อ่านค่าจริงจาก `process.env` เท่านั้น)
- commit ทั้งหมดโดยไม่อ่าน `git status` / `git diff` ก่อน และไม่สรุปให้เจ้าของฟังก่อน

ก่อน commit ต้องรันตัวตรวจผ่านก่อนเสมอ (`node scripts/check-all.mjs` และ `node --test --test-concurrency=1`)
และห้ามบอกว่า "ขึ้นเว็บแล้ว" จนกว่าสถานะจะเป็น `live` — push สำเร็จไม่ได้แปลว่าขึ้นเว็บแล้ว GitHub Pages ยังต้อง build อีก 2–3 นาที

OpenCode ใช้กฎแบบเรียงลำดับ **"ข้อที่ตรงท้ายสุดชนะ"**
ดังนั้นไฟล์ `opencode.jsonc` ต้องเรียง: กว้าง → ยกเว้น → **ห้ามเด็ดขาดท้ายสุด**

`.opencode/opencode.jsonc` (ร่าง)
```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "eed-manager",
  "model": "anthropic/claude-sonnet-4-5",   // เปลี่ยนได้ทีหลังใน TUI

  "permissions": [
    // 1) กว้าง: ทำอะไรที่ไม่ระบุไว้ = ถามเจ้าของก่อน
    { "action": "shell", "resource": "*", "effect": "ask" },
    { "action": "edit",  "resource": "*", "effect": "ask" },

    // 2) อ่านอย่างเดียว ปล่อยให้ทำได้เลย
    { "action": "read",  "resource": "*", "effect": "allow" },
    { "action": "glob",  "resource": "*", "effect": "allow" },
    { "action": "grep",  "resource": "*", "effect": "allow" },

    // 3) คำสั่งที่ปลอดภัย
    { "action": "shell", "resource": "git status*",  "effect": "allow" },
    { "action": "shell", "resource": "git diff*",    "effect": "allow" },
    { "action": "shell", "resource": "git log*",     "effect": "allow" },
    { "action": "shell", "resource": "git show*",    "effect": "allow" },
    { "action": "shell", "resource": "git ls-files*","effect": "allow" },
    // commit/push ได้เมื่อเจ้าของสั่ง + ทางกู้คืนงานที่ลบผิด
    { "action": "shell", "resource": "git add*",     "effect": "allow" },
    { "action": "shell", "resource": "git commit*",  "effect": "allow" },
    { "action": "shell", "resource": "git push*",    "effect": "allow" },
    { "action": "shell", "resource": "git restore*", "effect": "allow" },
    { "action": "shell", "resource": "node scripts/check-*.mjs*",  "effect": "allow" },
    { "action": "shell", "resource": "node scripts/check-all.mjs",  "effect": "allow" },
    { "action": "shell", "resource": "node scripts/sync-business-content.mjs --check", "effect": "allow" },
    { "action": "shell", "resource": "node scripts/sync-catering-content.mjs --check", "effect": "allow" },

    // 4) คำสั่งที่แก้ข้อมูลจริง = ถามทุกครั้ง
    { "action": "shell", "resource": "node tools/agent/*.mjs*", "effect": "ask" },
    { "action": "shell", "resource": "node --test*",           "effect": "ask" },

    // 5) ห้ามเด็ดขาด — ต้องอยู่หลัง allow ทุกข้อ
    { "action": "shell", "resource": "git *",     "effect": "deny" },
    { "action": "shell", "resource": "gh *",      "effect": "deny" },
    { "action": "shell", "resource": "wrangler *","effect": "deny" },
    { "action": "shell", "resource": "netlify *", "effect": "deny" },
    { "action": "shell", "resource": "npm publish*", "effect": "deny" },
    { "action": "shell", "resource": "del *",     "effect": "deny" },
    // 6) รูปแบบ git ที่ย้อนกลับไม่ได้ — ต้องอยู่หลัง allow ของ commit/push
    { "action": "shell", "resource": "git push*--force*",   "effect": "deny" },
    { "action": "shell", "resource": "git push*:*",         "effect": "deny" },
    { "action": "shell", "resource": "git reset --hard*",   "effect": "deny" },
    { "action": "shell", "resource": "git clean*",          "effect": "deny" },

    { "action": "edit",  "resource": "*.env",     "effect": "deny" },
    { "action": "edit",  "resource": "*.env.*",   "effect": "deny" },
    { "action": "read",  "resource": "*.env",     "effect": "deny" },

    // ผลลัพธ์ของ publish pipeline ห้ามแก้มือ ต้องไปทาง admin เท่านั้น
    { "action": "edit",  "resource": "data/planner-overrides.json", "effect": "deny" },
    { "action": "edit",  "resource": "js/menu-data.js",            "effect": "deny" },
    // ข้อมูลจริงของร้านอยู่ในโฟลเดอร์ gitignored ห้ามแก้มือ
    { "action": "edit",  "resource": "demo/**",     "effect": "deny" },
    // กฎและเอกสารควบคุมของโปรเจกต์ (docs/** แก้ได้ ต้องให้ตรงกับนโยบายล่าสุดเสมอ)
    { "action": "edit",  "resource": "AGENTS.md",  "effect": "deny" },
    { "action": "edit",  "resource": ".opencode/**","effect": "deny" },
    // ห้ามแก้เทสต์เพื่อให้ผ่าน
    { "action": "edit",  "resource": "test/**",     "effect": "deny" },

    { "action": "webfetch",   "resource": "*", "effect": "deny" },
    { "action": "websearch",  "resource": "*", "effect": "deny" }
  ],

  "agents": { "eed-manager": { "mode": "primary" } }
}
```

จุดที่ต้องระวัง
- `git *` deny ต้องมาหลัง `git status*` allow มิฉะนั้นจะไป deny ทั้งชุด
- deny รูปแบบอันตราย (`--force`, refspec `:`) ต้องมาหลัง `git push*` allow อีกทีหนึ่ง เพราะ "ข้อที่ตรงท้ายสุดชนะ"
- ไฟล์ `.env.example` ต้อง `allow` ไว้ท้ายสุด เพราะสิทธิ์ฐานของ OpenCode ตั้ง `.env*` เป็น ask
- `read *.env` deny ทำให้ agent อ่านของลับไม่ได้เลย แต่ `LINE_CHANNEL_ACCESS_TOKEN`
  ต้องอ่านจาก env ของ shell ตอนรันสคริปต์ ไม่ต้องให้ agent เห็นค่า

### 4.1 สิทธิ์ของผู้จัดการ — บังคับที่การตั้งค่า ไม่ใช่ที่ prompt
```yaml
# .opencode/agents/eed-manager.md frontmatter
permissions:
  - action: edit
    resource: "*"
    effect: deny        # ผู้จัดการแก้ไฟล์เองไม่ได้เลย
  - action: shell
    resource: "node *"
    effect: deny        # ผู้จัดการรันสคริปต์เองไม่ได้
  - action: subagent
    resource: "*"
    effect: deny        # เรียกได้แค่ 6 ตัวที่กำหนด
  - action: subagent
    resource: [menu, content, verify, replies, report, guardian]
    effect: allow
  - action: question
    resource: "*"
    effect: allow
```
แม้โมเดลจะ "อยาก" แก้ไฟล์เอง permission engine ก็บล็อกไว้ที่ชั้น runtime ไม่ใช่ชั้น prompt

### 4.2 ตารางสิทธิ์รายแผนก
| แผนก | edit | shell ที่อนุญาต | ห้ามเด็ดขาด |
|-------|------|----------------|------------|
| `eed-manager` | ทั้งหมด | ไม่มี | ต้อง delegate ทุกงาน |
| `menu` | deny ทั้งหมด | `node tools/agent/menu-*.mjs*` (ask), check-* (allow) | deploy / publish ขึ้นเว็บจริง |
| `content` | `ask` ทุกไฟล์ เว้นแต่ deny ตามรายการข้างบน | check-* (allow), sync-* --check (allow) | แตะ `test/**`, `AGENTS.md` |
| `verify` | deny ทั้งหมด | `node scripts/check-*`, `node --test*` | ทุกอย่างนอกนั้น |
| `replies` | deny ทั้งหมด | `node tools/agent/inbox.mjs*` (ask) | **ส่ง LINE จริง — ไม่มีทาง** |
| `report` | deny ทั้งหมด | `node tools/agent/report.mjs*` | ทุกอย่างนอกนั้น |
| `guardian` | deny ทั้งหมด | ไม่มี (อ่านอย่างเดียว) | แก้ไฟล์/รันคำสั่ง/อนุมัติงานเอง |

`replies` ไม่มี tool ส่งข้อความแม้แต่ตัวเดียว การส่งจริงทำที่ Owner Console โดยเจ้าของเท่านั้น

---

## 5. บทบาทของแต่ละแผนก (ร่าง prompt)

### ผู้จัดการ `.opencode/agents/eed-manager.md`
```
คุณคือผู้จัดการฝ่ายขายของ EED HALAL ที่ทำงานในเครื่องของเจ้าของ

หน้าที่ของคุณคือรับคำสั่งจากเจ้าของ แล้วเลือกแผนกที่ใช่ไปทำงานให้
แผนกที่คุณเรียกได้: menu (เมนู/ราคา), content (เนื้อหาเว็บ), verify (ตรวจสอบ),
replies (ข้อความตอบลูกค้า), report (สรุปงาน), guardian (ผู้คุมกฎ)

กฎเหล็ก:
- คุณไม่แก้ไฟล์และไม่รันคำสั่งเอง ทุกงานต้องส่งให้แผนก
- ตัวเลขราคา ขั้นต่ำ เงื่อนไขการส่ง ให้ถามแผนกที่อ่านไฟล์จริงเสมอ ห้ามตอบจากความจำ
- ก่อนสรุปงานที่แก้ข้อมูลธุรกิจ ต้องส่งให้แผนก verify ตรวจ แล้วค่อยรายงานผล
- งานที่แก้ข้อมูลธุรกิจหรือเนื้อหาที่ลูกค้าอ่าน ต้องผ่านผู้คุมกฎ (guardian) ก่อนสรุป
  ถ้า guardian บอกไม่ผ่าน ให้ส่งงานกลับไปแก้ ห้ามรายงานว่าเสร็จ
- ตอบเจ้าของเป็นภาษาไทย สั้น เป็นกันเอง เหมือนพนักงานขายกำลังพูด
- ทุกครั้งที่งานจบ ให้บอกว่าแตะไฟล์ไหน รันตรวจอะไร และผลเป็นอย่างไร
- กฎทั้งหมดของโปรเจกต์อยู่ใน AGENTS.md ให้ยึดและอ้างถึงไฟล์นั้น อย่าคัดลอกกฎมาเขียนซ้ำ

รายชื่อแผนกและขอบเขตแบบย่อ:
menu    — หาเมนูตามงบ/จำนวน/ประเภทงาน แก้ฐานเมนูกลาง และเตรียม preview
content — แก้เนื้อหาไทย-อังกฤษบนเว็บ ตาม Human Sales Page Rules ใน AGENTS.md
verify  — รัน check-* ทั้งหมด และรายงานว่าอะไรไม่ตรง
replies — ดูคิวข้อความลูกค้า และร่างคำตอบให้เจ้าของอนุมัติ (ไม่ส่งเอง)
report  — สรุปงานวันนี้และงานที่ค้างอยู่
guardian — ผู้คุมกฎ ตรวจว่างานทำตาม AGENTS.md หรือไม่ มีสิทธิ์ยับยั้ง
```

### แผนกเมนู `.opencode/agents/menu.md`
```
คุณเป็นแผนกเมนูและราคาของ EED HALAL

หน้าที่:
- ตอบคำถามเรื่องเมนู ราคา ขั้นต่ำ ชั้นสินค้า อาหารเมนูที่ 2 ท็อปปิง และการจับคู่ตามงบ
- เสนอการเปลี่ยนชื่อ/ราคา/ขั้นต่ำ/ลำดับ/สถานะแสดงผลของเมนู

วิธีทำงาน (ห้ามข้าม):
1. เริ่มจาก `node tools/agent/context.mjs` เพื่อดูราคาและเงื่อนไขจริงล่าสุดเสมอ
2. จับคู่ตามงบด้วย `node tools/agent/menu-match.mjs <งบ>` ห้ามคำนวณเอง
3. ถ้าจะแก้ฐานเมนูกลาง ใช้ `node tools/agent/menu-set.mjs ...` ซึ่งจะพิมพ์ diff ก่อน
   และถามยืนยัน ห้ามเขียนไฟล์เอง
4. ห้ามแตะ data/planner-overrides.json และ js/menu-data.js เด็ดขาด
   สองไฟล์นั้นเป็นผลลัพธ์ของ publish pipeline
5. ห้าม deploy หรือ commit/push เด็ดขาด
```

### แผนกเนื้อหา `.opencode/agents/content.md`
```
คุณเป็นแผนกเนื้อหาเว็บของ EED HALAL รับผิดชอบทั้งภาษาไทยและภาษาอังกฤษ

ก่อนแก้อะไร ให้โหลด skill `site-content` แล้วทำตามทีละขั้น
กฎทุกข้อของโปรเจกต์อยู่ใน AGENTS.md ห้ามคัดลอกมาเขียนซ้ำในไฟล์นี้

สรุปงานทุกครั้งด้วย: หน้าไหน ส่วนไหน ได้อะไร ตรวจแล้วหรือยัง
```

### แผนกตรวจสอบ `.opencode/agents/verify.md`
```
คุณเป็นแผนกตรวจสอบความถูกต้อง ห้ามแก้ไฟล์ใด ๆ ทั้งสิ้น

ลำดับที่ต้องรัน:
1. node scripts/check-business-sync.mjs --check   (ต้องผ่านทุกครั้งถ้ามีการแก้ข้อมูลธุรกิจ)
2. node scripts/check-all.mjs
3. node --test --test-concurrency=1   (ถ้ามีการแก้โค้ด)

รายงานผลเป็นรายการ: ผ่าน / ไม่ผ่าน พร้อมชื่อไฟล์และบรรทัดที่เกี่ยวข้อง
ห้ามแก้เทสต์หรือลบ check เพื่อให้ผ่าน
```

### แผนกข้อความลูกค้า `.opencode/agents/replies.md`
```
คุณเป็นแผนกข้อความตอบลูกค้าของ EED HALAL

- ดูคิวด้วย `node tools/agent/inbox.mjs drafts`
- เขียนคำตอบให้เจ้าของอ่านและอนุมัติ โดยยึดข้อมูลจริงจาก context
- ห้ามส่งข้อความจริงในทุกกรณี การส่งทำที่ Owner Console โดยเจ้าของเท่านั้น
- ถ้าข้อมูลที่ลูกค้าถามไม่มีในไฟล์จริง ให้บอกว่าไม่มี และเสนอให้เจ้าของตัดสินใจ
```

### ผู้คุมกฎ `.opencode/agents/guardian.md`
```
คุณเป็นผู้คุมกฎของ EED HALAL มีหน้าที่ตรวจงานก่อนส่งถึงเจ้าของเท่านั้น

- คุณอ่านอย่างเดียว แก้ไฟล์ไม่ได้ รันคำสั่งไม่ได้ อนุมัติงานเองไม่ได้
- เกณฑ์การตรวจอยู่ใน AGENTS.md, FACTS.md และ DEPLOY.md ให้อ้างถึงไฟล์นั้น
  ห้ามคัดลอกกฎมาเขียนซ้ำในไฟล์นี้
- งานที่แก้ข้อมูลธุรกิจต้องตรงกับ data/business-rules.json และเมนูกลาง
  งานที่ลูกค้าอ่านต้องผ่าน Naturalness Test และห้ามใช้ภาษาระบบต้องห้าม
- ตอบสั้น ๆ ว่า ผ่าน หรือ ไม่ผ่าน ถ้าไม่ผ่านให้ระบุข้อที่ผิด
  พร้อมชื่อไฟล์และบรรทัด แล้วส่งคืนให้ผู้จัดการสั่งแก้
- คำตัดสินของคุณถือเป็นที่สิ้นสุด ผู้จัดการห้ามรายงานว่างานเสร็จถ้าคุณยังไม่ให้ผ่าน
```

---

## 6. คำสั่งลัด (slash commands)

`.opencode/commands/` — พิมพ์ `/` ใน TUI เห็นทันที

| คำสั่ง | ทำอะไร |
|--------|--------|
| `/menu 120` | จับคู่เมนูตามงบ 120 บาท/กล่อง พร้อมอาหารเมนูที่ 2 และราคารวมสด |
| `/menu-set <ชื่อ> <ราคา>` | เสนอการเปลี่ยนราคาในฐานกลาง พิมพ์ diff แล้วถามยืนยัน |
| `/check` | รันตรวจทั้งหมดตาม `DEPLOY.md` ข้อ 3 |
| `/sync` | ตรวจว่าเนื้อหาทุกช่องทางตรงกับ `data/business-rules.json` |
| `/drafts` | แสดงคิวข้อความที่รอเจ้าของตอบ |
| `/report` | สรุปงานวันนี้ งานที่ค้าง และสถานะเผยแพร่เว็บ |
| `/page corporate` | งานเนื้อหาบนหน้าที่ระบุ (ส่งให้แผนก content) |

ตัวอย่างไฟล์:
```md title=".opencode/commands/menu.md"
---
description: จับคู่เมนู EED HALAL ตามงบต่อกล่อง
agent: menu
---

รันคำสั่งนี้แล้วแสดงผลลัพธ์ให้เจ้าของอ่าน:

!`node tools/agent/menu-match.mjs $ARGUMENTS`

อธิบายผลเป็นภาษาไทยแบบพนักงานขาย และถามว่าจะให้ทำอะไรต่อ
```

> หมายเหตุเรื่องความปลอดภัย: บล็อก `!` ในคำสั่งจะรันก่อนส่งเข้าโมเดล และอยู่นอกขั้นตอนขออนุญาต
> จึงใช้ได้เฉพาะคำสั่งที่เขียนเองในรีโปเท่านั้น ห้ามใส่อาร์กิวเมนต์ที่ไม่น่าเชื่อถือลงในบล็อกนี้

---

## 7. Skills — ขั้นตอนปฏิบัติงาน

`.opencode/skills/<id>/SKILL.md` — OpenCode จะเห็น `description` และเรียกโหลดเองเมื่อเกี่ยวข้อง

| Skill ID | ใช้เมื่อ | ขั้นตอนหลัก |
|----------|--------|-------------|
| `menu-change` | เปลี่ยนเมนู/ราคา/ขั้นต่ำ | context → menu-set (ดู diff) → ยืนยัน → sync check → guardian → สรุป |
| `site-content` | แก้หน้าเว็บ | อ่าน AGENTS.md → วางแผน → แก้ → Naturalness Test → check → guardian → สรุป |
| `release` | เผยแพร่ขึ้นเว็บจริง | ตรวจ → commit/push ขึ้น main ได้ → **ปุ่ม "อัปเดตเว็บทั้งหมด" ให้เจ้าของกดเอง** (ต้องมี `EED_ALLOW_GIT_DEPLOY=1`) แล้วรอสถานะ `live` |

ทุก skill ต้องจบด้วย "รายงานไฟล์ที่เปลี่ยน + คำสั่งตรวจที่รัน + ผล"
ตามข้อกำหนด Change Process ใน `AGENTS.md`

---

## 8. สคริปต์ deterministic ที่ต้องเขียน

เหตุผลที่ต้องมี: เรื่องราคา/ขั้นต่ำต้องถูกต้อง 100% และผลตรงกันทุกครั้ง
ไม่ควรให้โมเดลเดาหรือคำนวณเอง (ห้ามตามกฎ Business Data Source of Truth)

| สคริปต์ | หน้าที่ | ใช้ข้อมูลจาก |
|--------|-------|--------------|
| `context.mjs` | พิมพ์ราคาเริ่มต้นแต่ละชั้น ขั้นต่ำ นโยบายส่ง ตัดออเดอร์ ค่ามัดจำ เป็นข้อความล้วน | `data/business-rules.json`, `services/menus.mjs`, `scripts/mealbox-tiers.mjs` |
| `menu-match.mjs` | จับคู่เมนูตามงบ: `ราคาเมนู + อาหารเมนูที่ 2 + ตัวเลือก ≤ งบ` ตัวที่เกินงบไม่แสดง | `services/budget-match.mjs` (โยกจาก `tools/admin/app.mjs`) |
| `menu-set.mjs` | อ่านฐานกลาง → คำนวณ diff → พิมพ์ → ถามยืนยัน → บันทึกผ่าน admin server | admin `127.0.0.1:4185` |
| `inbox.mjs` | ดึง drafts / leads ผ่าน Internal API | Internal API `127.0.0.1:8788` + `EED_INTERNAL_API_SECRET` จาก env |
| `report.mjs` | รวมสถานะ: drafts ค้าง leads ใหม่ สถานะเผยแพร่เว็บ งานที่ค้างใน git | ข้างบน + `git status` |

ข้อกำหนดร่วม
- ห้ามพิมพ์ค่าลับใน output ใช้ `redactUrl()` และ `sanitizeMetadata()` ที่มีอยู่แล้ว
- `inbox.mjs` อ่าน `EED_INTERNAL_API_SECRET` จาก env เท่านั้น ถ้าไม่มีให้บอกว่าตั้งค่าอะไรตก
- ทุกสคริปต์ต้องมี `--help` และ exit code ชัดเจน
- ต้องมีเทสต์ `test/agent-*.test.mjs` และลงหมวดใน `scripts/run-tests.mjs`
  (ไฟล์เทสต์ที่ไม่ลงหมวดจะทำให้ runner พังทันที)

---

## 9. เฟสการทำงาน

### เฟส 1 — ตั้งค่า OpenCode + ผู้จัดการ (ไม่ต้องมีสคริปต์ใหม่)
ไฟล์: `.opencode/opencode.jsonc`, `.opencode/agents/eed-manager.md`,
agent 5 แผนกแบบโครงเปล่า และผู้คุมกฎ 1 ตัว
ผ่านเมื่อ:
- `opencode` ในโฟลเดอร์นี้แสดง agent ทั้ง 7 ตัว
- ผู้จัดการพยายามแก้ไฟล์ → ถูกบล็อก
- สั่ง `git push --dry-run` ผ่านผู้จัดการ → ถูกบล็อก
- พยายามแก้ `test/*.test.mjs` → ถูกบล็อก
- พยายามอ่าน `.env` → ถูกบล็อก

### เฟส 2 — ข้อมูลธุรกิจแบบ deterministic
ไฟล์: `services/budget-match.mjs`, `tools/agent/context.mjs`,
`tools/agent/menu-match.mjs`, `tools/agent/menu-set.mjs`,
`.opencode/commands/menu.md`, `.opencode/commands/menu-set.md`,
`test/agent-context.test.mjs`, `test/agent-menu-match.test.mjs`
งาน: โยกตรรกะจับคู่เมนูออกจาก `tools/admin/app.mjs` ให้ใช้ร่วมกัน
ผ่านเมื่อ: `/menu 120` ให้ผลตรงกับหน้าจับคู่เมนูที่ `http://127.0.0.1:4185/` แบบเดียวกันทุกเคส

### เฟส 3 — แผนกเนื้อหา + skill
ไฟล์: `.opencode/agents/content.md`, `.opencode/skills/site-content/SKILL.md`,
`.opencode/commands/page.md`, `test/agent-content-flow.test.mjs`
งาน: เขียนเนื้อหาจำลองแล้วผ่าน Naturalness Test + check-business-sync
ผ่านเมื่อ: แก้เนื้อหาจำลอง 1 หน้า แล้ว `node scripts/check-all.mjs` ผ่าน

### เฟส 4 — ตรวจสอบ + รายงาน
ไฟล์: `.opencode/agents/verify.md`, `.opencode/agents/report.md`,
`tools/agent/inbox.mjs`, `tools/agent/report.mjs`,
`.opencode/commands/check.md`, `.opencode/commands/sync.md`,
`.opencode/commands/drafts.md`, `.opencode/commands/report.md`
ผ่านเมื่อ: `/check` รันครบ 9 ข้อและ `/drafts` อ่านได้จาก Internal API

### เฟส 5 — คู่มือ + skill เผยแพร่
ไฟล์: `docs/agent-employee.md`, `.opencode/skills/menu-change/SKILL.md`,
`.opencode/skills/release/SKILL.md`
และเพิ่มลิงก์จาก `AGENTS.md` (หัวข้อ Document Responsibilities) เพื่อไม่ให้เอกสารกลายเป็นกฎซ้ำ

### เฟส 6 (ภายหลัง) — งานอัตโนมัติ
รัน `opencode run` เป็นรายวัน/รายสัปดาห์เพื่อทำรายงานและเช็ค business sync
ยังไม่ทำในเฟสแรก เพราะต้องดูว่า permission และผลลัพธ์น่าเชื่อถือพอก่อน

---

## 10. คำสั่งตรวจสอบก่อนจบทุกเฟส

```powershell
node --test --test-concurrency=1
node scripts/check-all.mjs
node scripts/check-repository-safety.mjs
node scripts/check-docs.mjs
node scripts/check-line-endings.mjs
```

เทสต์ที่ต้องมี:
- ผู้จัดการแก้ไฟล์ไม่ได้ และเรียก subagent นอกเหนือจาก 6 ตัวที่กำหนดไม่ได้
- คำสั่ง git ที่เขียน (commit/push/merge/rebase/reset/clean) ถูก deny
- `.env`, `test/**`, `AGENTS.md`, `data/planner-overrides.json`,
  `js/menu-data.js`, `demo/**` ถูก deny การแก้
- คำสั่งตรวจสอบถูก allow และรันได้จริง
- ตัวเลขทุกตัวที่ agent รายงานตรงกับ `services/menus.mjs` และ `data/business-rules.json`
- ไม่มีค่าลับในไฟล์ `.opencode/` (ตรวจด้วย `check-repository-safety.mjs`)

---

## 11. สิ่งที่จะไม่ทำ

- ไม่มีการ commit / push / deploy จาก agent เด็ดขาด (deny ที่ระดับ config)
- ไม่ส่งข้อความ LINE จริงจาก agent — ไม่มี tool ส่งในแผนก `replies`
- ไม่แก้เทสต์เพื่อให้ผ่าน และไม่ลบ `check-*`
- ไม่ใช้ `--force` กับ git
- ไม่คัดลอกกฎจาก `AGENTS.md` มาเขียนซ้ำในไฟล์ agent หรือ skill
  (ให้อ้างอิงไฟล์ต้นทางแทน ตาม Document Responsibilities)
- ไม่ใส่ค่า API key ลงไฟล์ `.opencode/` หรือ `opencode.jsonc`
- ไม่เปิด `webfetch`/`websearch` เพราะไม่จำเป็นต่องานนี้
- ไม่สร้าง dependency npm ใหม่ (ตอนนี้มีแค่ `pg`) — สคริปต์ทั้งหมดใช้ `node:builtins` ล้วน

---

## 12. ประมาณการ

| เฟส | ขนาดงาน | หมายเหตุ |
|-----|--------|---------|
| 1 | เล็ก | ไม่แตะโค้ดธุรกิจเลย แค่ตั้งค่า agent + permission |
| 2 | กลาง | ต้องดึงตรรกะจับคู่เมนูออกจากหน้า admin ให้ถูกต้อง ไม่ให้ต่างจากเดิม |
| 3 | กลาง-ใหญ่ | เขียนเนื้อหาเป็นส่วนที่ต้องคุมคุณภาพมากที่สุด |
| 4 | กลาง | ต่อกับ Internal API ต้องมี secret ใน env |
| 5 | เล็ก | เอกสารล้วน |
| 6 | เล็ก | ตัดสินใจทีหลัง |

เริ่มที่เฟส 1 ได้ทันที เพราะไม่ต้องเขียนโค้ดธุรกิจเลย
และได้ผลที่เห็นผลทันทีคือ agent ที่ถูกล็อกไว้ตามกฎที่ตกลงกัน