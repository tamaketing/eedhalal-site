// Read and safely change the owner's private menu catalogue through the local
// admin server on 127.0.0.1. Never writes a data file directly.
//
//   node tools/agent/menu-set.mjs list
//   node tools/agent/menu-set.mjs show <id หรือชื่อ>
//   node tools/agent/menu-set.mjs set <id หรือชื่อ> price=135 hidden=true
//   node tools/agent/menu-set.mjs status
//
// Every change prints a diff and waits for the owner to confirm. --yes skips the
// prompt for scripted runs only. The published website files
// (data/planner-overrides.json, js/menu-data.js) are NOT touched here: that is
// the publish step, and it stays a separate owner action.
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

// Resolved on every call, never captured at import time: a stale constant would
// let a test talk to the owner's real admin server on 4185 instead of its own.
export function adminPort(env = process.env) {
  return Number(env.EED_ADMIN_PORT || 4185);
}

export function adminBase(env = process.env) {
  return `http://127.0.0.1:${adminPort(env)}`;
}

// Same guard the admin server uses for bulk hiding. Kept here so the agent
// cannot slip past it with a single command.
export const BULK_HIDE_LIMIT = 5;

// Each validator returns {ok:true, value} or {ok:false, error}. A validator must
// never return a bare value: name, image, desc and badge are legitimate strings,
// so a string alone cannot signal failure.
const text = (raw, { required = false } = {}) => {
  const value = String(raw).trim();
  if (required && !value) return { ok: false, error: 'ชื่อเมนูห้ามว่าง' };
  return { ok: true, value };
};

export const EDITABLE_FIELDS = {
  name: (value) => text(value, { required: true }),
  price: (value) => {
    const price = Number(value);
    return Number.isFinite(price) && price > 0
      ? { ok: true, value: Math.round(price * 100) / 100 }
      : { ok: false, error: 'ราคาต้องเป็นตัวเลขมากกว่า 0' };
  },
  tier: (value) => {
    const tier = String(value).trim();
    return ['classic', 'signature', 'executive'].includes(tier)
      ? { ok: true, value: tier }
      : { ok: false, error: 'ระดับต้องเป็น classic, signature หรือ executive' };
  },
  minPerMenu: (value) => {
    const min = Number(value);
    return Number.isInteger(min) && min >= 1
      ? { ok: true, value: min }
      : { ok: false, error: 'ขั้นต่ำต่อเมนูต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป' };
  },
  sortOrder: (value) => {
    const order = Number(value);
    return Number.isFinite(order)
      ? { ok: true, value: Math.round(order) }
      : { ok: false, error: 'ลำดับต้องเป็นตัวเลข' };
  },
  image: (value) => text(value),
  desc: (value) => ({ ok: true, value: String(value) }),
  badge: (value) => ({ ok: true, value: String(value) }),
  hidden: (value) => ({ ok: true, value: String(value).toLowerCase() === 'true' }),
  showPrice: (value) => ({ ok: true, value: String(value).toLowerCase() === 'true' }),
};

async function adminFetch(route, options = {}) {
  const base = adminBase(options.env || process.env);
  let response;
  try {
    response = await fetch(`${base}${route}`, {
      signal: AbortSignal.timeout(options.timeoutMs || 5000),
      ...options,
    });
  } catch {
    throw new Error(`เชื่อมต่อเครื่องมือจัดการเมนูที่ ${base} ไม่ได้ — เปิดด้วย start-server.bat แล้วลองอีกครั้ง`);
  }
  // Only ever talk to this project's own tool.
  if (response.headers.get('x-eed-local-tool') !== 'owner-set-builder') {
    throw new Error(`ที่ ${base} ไม่ใช่เครื่องมือจัดการเมนูของเรา — หยุดทำงานเพื่อความปลอดภัย`);
  }
  return response;
}

export async function readCentral() {
  const response = await adminFetch('/menu-central');
  if (!response.ok) throw new Error(`อ่านฐานเมนูกลางไม่สำเร็จ (${response.status})`);
  const central = await response.json();
  if (!Array.isArray(central?.menus)) throw new Error('รูปแบบฐานเมนูกลางไม่ถูกต้อง');
  return central;
}

export async function readPublishState() {
  const response = await adminFetch('/menu-publish-preview');
  if (!response.ok) throw new Error(`อ่านสถานะเผยแพร่ไม่สำเร็จ (${response.status})`);
  return response.json();
}

/** Find one menu by numeric id, or by exact then partial name. */
export function findMenu(central, reference) {
  const needle = String(reference ?? '').trim();
  if (!needle) return null;
  const byId = central.menus.find((menu) => String(menu.id) === needle);
  if (byId) return byId;
  const lower = needle.toLowerCase();
  const exact = central.menus.find((menu) => String(menu.name || '').trim().toLowerCase() === lower);
  if (exact) return exact;
  return central.menus.find((menu) => String(menu.name || '').toLowerCase().includes(lower)) || null;
}

/** Parse `key=value` pairs and validate every field before anything is changed. */
export function parseChanges(pairs = []) {
  const changes = {};
  const errors = [];
  for (const pair of pairs) {
    const index = String(pair).indexOf('=');
    if (index < 1) {
      errors.push(`รูปแบบไม่ถูกต้อง: ${pair} (ต้องเป็น ชื่อฟิลด์=ค่า)`);
      continue;
    }
    const key = String(pair).slice(0, index).trim();
    const raw = String(pair).slice(index + 1);
    const validate = EDITABLE_FIELDS[key];
    if (!validate) {
      errors.push(`แก้ฟิลด์ "${key}" ไม่ได้ (ใช้ได้: ${Object.keys(EDITABLE_FIELDS).join(', ')})`);
      continue;
    }
    const result = validate(raw);
    if (!result?.ok) {
      errors.push(`${key}: ${result?.error || 'ค่าไม่ถูกต้อง'}`);
      continue;
    }
    changes[key] = result.value;
  }
  return { changes, errors };
}

/** Apply changes to a copy of the central document and describe what moved. */
export function applyChanges(central, menuId, changes) {
  const menus = central.menus.map((menu) => (menu.id === menuId ? { ...menu, ...changes } : menu));
  const diff = [];
  const before = central.menus.find((menu) => menu.id === menuId);
  for (const key of Object.keys(changes)) {
    const from = before?.[key];
    const to = changes[key];
    if (String(from ?? '') !== String(to ?? '')) diff.push({ field: key, from, to });
  }
  const newlyHidden = menus.filter((menu) => menu.hidden === true && central.menus.find((row) => row.id === menu.id)?.hidden !== true)
    .map((menu) => menu.id);
  return { next: { ...central, menus }, diff, newlyHidden };
}

export function renderDiff(before, diff, newlyHidden) {
  const lines = ['จะเปลี่ยนในฐานเมนูกลาง (ยังไม่ขึ้นเว็บ):', '-'.repeat(52)];
  lines.push(`  เมนู       : ${before.name} (id ${before.id})`);
  for (const change of diff) {
    lines.push(`  ${change.field}: ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}`);
  }
  if (newlyHidden.length > BULK_HIDE_LIMIT) {
    lines.push(`  ซ่อนพร้อมกัน ${newlyHidden.length} รายการ (เกิน ${BULK_HIDE_LIMIT}) ต้องยืนยันเป็นพิเศษ`);
  }
  lines.push('-'.repeat(52));
  lines.push('ขั้นตอนถัดไป: ตรวจในหน้าแอดมิน แล้วสั่งเผยแพร่เองที่ปุ่มขึ้นเว็บจริง');
  return lines.join('\n');
}

export async function writeCentral(next, expectedVersion) {
  const response = await adminFetch('/menu-central', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: adminBase() },
    body: JSON.stringify(next),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const detail = payload?.errors?.join(' | ') || text || `HTTP ${response.status}`;
    throw new Error(`บันทึกไม่สำเร็จ: ${detail}`);
  }
  // The admin endpoint writes without an optimistic check, so the agent owns
  // the compare-and-swap: someone else must not have written in between.
  if (Number.isFinite(expectedVersion) && Number(payload.version) !== expectedVersion + 1) {
    throw new Error(`รุ่นไม่ตรงกับที่คาดไว้ (คาด ${expectedVersion + 1} แต่ได้ ${payload.version}) — มีคนแก้ฐานเมนูพร้อมกัน ให้โหลดใหม่แล้วลองอีกครั้ง`);
  }
  return payload;
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

function parseCli(argv) {
  const [command, reference, ...rest] = argv;
  return {
    command: command || 'help',
    reference,
    rest,
    yes: rest.includes('--yes') || rest.includes('-y'),
    pairs: rest.filter((arg) => !arg.startsWith('--') && !arg.startsWith('-')),
  };
}

async function main() {
  const { command, reference, pairs, yes } = parseCli(process.argv.slice(2));

  if (command === 'help' || command === '--help') {
    process.stdout.write(
      [
        'ใช้:',
        '  node tools/agent/menu-set.mjs list',
        '  node tools/agent/menu-set.mjs show <id หรือชื่อ>',
        '  node tools/agent/menu-set.mjs set <id หรือชื่อ> price=135 hidden=true',
        '  node tools/agent/menu-set.mjs status',
        '',
        'แก้ได้เฉพาะ: ' + Object.keys(EDITABLE_FIELDS).join(', '),
        'ต้องพิมพ์ y เพื่อยืนยัน (ใช้ --yes ได้เฉพาะงานสคริปต์)',
        '',
      ].join('\n'),
    );
    return;
  }

  const central = await readCentral();

  if (command === 'list') {
    const rows = central.menus
      .slice()
      .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
      .map((menu) => `  ${String(menu.id).padStart(3)} ${menu.name} — ${menu.price} บาท [${menu.tier}]${menu.hidden ? ' (ซ่อน)' : ''}${menu.showPrice === false ? ' (ขอใบเสนอราคา)' : ''}`);
    process.stdout.write(`ฐานเมนูกลาง รุ่น ${central.version} · ${rows.length} เมนู\n${rows.join('\n')}\n`);
    return;
  }

  if (command === 'status') {
    const state = await readPublishState();
    const lines = [
      'สถานะเผยแพร่:',
      `  ร่างในเครื่อง  : รุ่น ${state.central?.version ?? '-'}`,
      `  ไฟล์บนเว็บ   : ${state.file?.status ?? '-'} รุ่น ${state.file?.fileVersion ?? '-'}`,
      `  เว็บจริง      : ${state.live?.state ?? '-'}`,
      `  มีการเปลี่ยนที่ยังไม่ขึ้นเว็บ: ${state.diff?.hasChanges ? 'มี' : 'ไม่มี'}`,
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
    return;
  }

  if (command === 'show') {
    const menu = findMenu(central, reference);
    if (!menu) {
      process.stderr.write(`หาเมนู "${reference}" ไม่พบ\n`);
      process.exitCode = 1;
      return;
    }
    const { internalNote, noLock, ...visible } = menu;
    process.stdout.write(`${JSON.stringify(visible, null, 2)}\n`);
    return;
  }

  if (command === 'set') {
    const menu = findMenu(central, reference);
    if (!menu) {
      process.stderr.write(`หาเมนู "${reference}" ไม่พบ — ด้วย node tools/agent/menu-set.mjs list\n`);
      process.exitCode = 1;
      return;
    }
    const { changes, errors } = parseChanges(pairs);
    if (errors.length) {
      process.stderr.write(`${errors.join('\n')}\n`);
      process.exitCode = 2;
      return;
    }
    if (!Object.keys(changes).length) {
      process.stderr.write('ไม่ได้ระบุค่าที่จะเปลี่ยน เช่น price=135\n');
      process.exitCode = 2;
      return;
    }

    const { next, diff, newlyHidden } = applyChanges(central, menu.id, changes);
    if (!diff.length) {
      process.stdout.write('ค่าที่ใส่มาเท่าเดิมอยู่แล้ว ไม่มีอะไรต้องแก้\n');
      return;
    }

    process.stdout.write(`${renderDiff(menu, diff, newlyHidden)}\n`);

    const bulkWarning = newlyHidden.length > BULK_HIDE_LIMIT;
    const approved = yes
      ? true
      : await confirm(bulkWarning ? `ซ่อนพร้อมกัน ${newlyHidden.length} รายการ ยืนยันไหม (y/n) ` : 'บันทึกไหม (y/n) ');
    if (!approved) {
      process.stdout.write('ยกเลิก ไม่ได้แก้อะไร\n');
      return;
    }

    const payload = newlyHidden.length > BULK_HIDE_LIMIT ? { ...next, confirmBulkHide: true } : next;
    const result = await writeCentral(payload, Number(central.version));
    process.stdout.write(`บันทึกแล้ว รุ่น ${result.version} · ยังไม่ขึ้นเว็บ ต้องกดเผยแพร่เองที่แอดมิน\n`);
    return;
  }

  process.stderr.write(`ไม่รู้จักคำสั่ง "${command}" — ดูด้วย node tools/agent/menu-set.mjs help\n`);
  process.exitCode = 2;
}

if (isCli) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}