// EED HALAL — cost and margin report (A05).
//
//   node tools/agent/finance.mjs report [--boxes <n>] [--json]
//   node tools/agent/finance.mjs template
//
// READ ONLY. This tool never writes cost data: the cost file belongs to the
// owner, lives on this machine only, and must never reach the website.
//
// WHERE THE COST FILE LIVES
//   Default: demo/owner-set-builder/owner-costs.json
//   Override with EED_OWNER_COSTS_PATH.
//   `demo/` is gitignored and never published — the sanctioned home for
//   owner-only data (see tools/admin/README.md and .gitignore).
//   A file named owner-costs must NOT live under data/ or js/: those folders
//   are published and the publish check rejects the name.
//
// WHAT IT COMPARES
//   cost per box (owner data) vs the published selling price (data/planner-overrides.json).
//   The selling price is the authority for what the customer pays; this tool
//   never changes a price and never invents a cost.
//
// WHAT IT CANNOT DO
//   - move money, pay, or edit a confirmed account entry
//   - estimate a cost from the selling price
//   - put a cost, margin or profit number into any published file
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

export const DEFAULT_COSTS_PATH = path.join(ROOT, 'demo', 'owner-set-builder', 'owner-costs.json');
export const COSTS_PATH = process.env.EED_OWNER_COSTS_PATH
  ? path.resolve(process.env.EED_OWNER_COSTS_PATH)
  : DEFAULT_COSTS_PATH;

const TEMPLATE = {
  version: 1,
  note: 'ต้นทุนต่อกล่องของแต่ละเมนู (บาท) — ของเจ้าของเท่านั้น ห้ามขึ้นเว็บ',
  menus: {
    'เปลี่ยนเป็น id ของเมนู': { food: 0, packing: 0, labor: 0, delivery: 0 },
  },
  fixedPerDelivery: 0,
  updatedAt: '',
};

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Total cost of one box from the owner's numbers. Null when a piece is missing. */
export function boxCost(entry = {}) {
  const parts = ['food', 'packing', 'labor', 'delivery'].map((key) => num(entry[key]));
  if (parts.some((value) => value == null)) return null;
  return parts.reduce((sum, value) => sum + value, 0);
}

/**
 * One row per menu: cost, selling price and margin.
 * Returns { rows, missing } — missing lists menus whose cost is incomplete.
 */
export function marginRows(costs = {}, catalogue = {}, { boxes = null, fixedPerDelivery = 0 } = {}) {
  const rows = [];
  const missing = [];
  for (const [id, entry] of Object.entries(costs.menus || {})) {
    const menu = catalogue.menus?.[id] || {};
    const price = num(menu.price);
    const cost = boxCost(entry);
    if (cost == null) {
      missing.push({ id, name: menu.name || id, reason: 'ต้นทุนยังไม่ครบทุกส่วน' });
      continue;
    }
    const perBox = price == null ? null : price - cost;
    const fixedShare = boxes && fixedPerDelivery ? Number(fixedPerDelivery) / Number(boxes) : 0;
    const withFixed = perBox == null ? null : perBox - fixedShare;
    rows.push({
      id,
      name: menu.name || id,
      price,
      cost,
      marginPerBox: perBox,
      marginPct: perBox == null || !price ? null : (perBox / price) * 100,
      marginWithFixedShare: withFixed,
      marginPctWithFixedShare: withFixed == null || !price ? null : (withFixed / price) * 100,
    });
  }
  rows.sort((a, b) => (a.marginPerBox ?? Infinity) - (b.marginPerBox ?? Infinity));
  return { rows, missing };
}

export async function loadOwnerCosts(filePath = COSTS_PATH) {
  const raw = await readFile(filePath, 'utf8');
  // A file saved by a Windows editor can start with a BOM; JSON.parse hates it.
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  if (!parsed || typeof parsed !== 'object' || !parsed.menus) {
    throw new Error('ไฟล์ต้นทุนต้องมีคีย์ "menus"');
  }
  return parsed;
}

export async function loadCatalogue(root = ROOT) {
  const raw = await readFile(path.join(root, 'data', 'planner-overrides.json'), 'utf8');
  const parsed = JSON.parse(raw);
  const menus = {};
  for (const [id, name] of Object.entries(parsed.names || {})) {
    menus[id] = { name, price: num(parsed.prices?.[id]) };
  }
  return { menus };
}

function flag(row) {
  const margin = row.marginWithFixedShare ?? row.marginPerBox;
  if (margin == null) return 'ไม่ทราบ';
  if (margin <= 0) return 'เสี่ยงขาดทุน';
  if (row.marginPct != null && row.marginPct < 10) return 'กำไรบาง';
  return 'ปกติ';
}

function render(result) {
  const lines = [];
  if (!result.available) {
    lines.push('ยังไม่มีข้อมูลต้นทุนในเครื่องนี้');
    lines.push(`ไฟล์ที่ระบบจะอ่าน: ${result.path}`);
    lines.push('ให้เจ้าของสร้างไฟล์นี้ด้วยตัวเอง (ข้อมูลต้นทุนเป็นของเจ้าของ และห้ามขึ้นเว็บ)');
    lines.push('รูปแบบไฟล์: รัน `node tools/agent/finance.mjs template` เพื่อดูตัวอย่าง');
    return lines.join('\n');
  }
  lines.push(`ต้นทุนต่อกล่อง เทียบราคาขายที่ประกาศไว้ (${result.costPath})`);
  lines.push('='.repeat(60));
  if (!result.rows.length) {
    lines.push('ยังไม่มีเมนูที่ใส่ต้นทุนไว้');
  }
  for (const row of result.rows) {
    lines.push('');
    lines.push(`${row.name} (${row.id})`);
    lines.push(`  ราคาขาย : ${row.price ?? '—'} บาท/กล่อง`);
    lines.push(`  ต้นทุน  : ${row.cost} บาท/กล่อง`);
    lines.push(`  กำไร   : ${row.marginPerBox == null ? '—' : `${row.marginPerBox} บาท/กล่อง`}${row.marginPct == null ? '' : ` (${row.marginPct.toFixed(1)}%)`}`);
    if (row.marginWithFixedShare != null && row.marginWithFixedShare !== row.marginPerBox) {
      lines.push(`  หลังหารค่าใช้จ่ายต่อการจัดส่ง ${result.boxes} กล่อง : ${row.marginWithFixedShare.toFixed(2)} บาท/กล่อง`);
    }
    lines.push(`  สถานะ : ${flag(row)}`);
  }
  if (result.missing.length) {
    lines.push('');
    lines.push(`ต้นทุนยังไม่ครบ ${result.missing.length} รายการ: ${result.missing.map((item) => item.name).join(', ')}`);
  }
  lines.push('');
  lines.push('ตัวเลขนี้อยู่ในเครื่องเท่านั้น ห้ามนำไปขึ้นเว็บหรือส่งให้ลูกค้า');
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.find((arg) => !arg.startsWith('-')) || 'report';
  if (command === 'template') {
    process.stdout.write(`${JSON.stringify(TEMPLATE, null, 2)}\n`);
    return;
  }
  if (command !== 'report') {
    process.stderr.write(`ไม่รู้จักคำสั่ง "${command}" — ใช้ได้แค่: report, template\n`);
    process.exitCode = 2;
    return;
  }
  const boxesIndex = args.indexOf('--boxes');
  const boxes = boxesIndex >= 0 ? Number(args[boxesIndex + 1]) : null;
  let result;
  try {
    const costs = await loadOwnerCosts();
    const catalogue = await loadCatalogue();
    const { rows, missing } = marginRows(costs, catalogue, {
      boxes: Number.isFinite(boxes) ? boxes : null,
      fixedPerDelivery: num(costs.fixedPerDelivery) || 0,
    });
    result = { available: true, rows, missing, boxes, costPath: COSTS_PATH };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      process.stderr.write(`อ่านข้อมูลต้นทุนไม่สำเร็จ: ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    result = { available: false, rows: [], missing: [], path: COSTS_PATH };
  }
  process.stdout.write(`${args.includes('--json') ? JSON.stringify(result, null, 2) : render(result)}\n`);
}

if (isCli) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
