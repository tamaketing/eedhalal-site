// Match dishes against a customer's budget per box.
//
//   node tools/agent/menu-match.mjs 120            budget in baht per box
//   node tools/agent/menu-match.mjs 120 --json
//
// Reads the sellable catalogue straight from the owner's private admin server
// on 127.0.0.1 so the agent never quotes a price the owner has not published.
// The rule itself lives in services/budget-match.mjs and is shared with the
// owner tool. Nothing here writes anything.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { matchMenusByBudget, money } from '../../services/budget-match.mjs';

// Resolved on every call, never captured at import time: a stale constant would
// let a test read the owner's real admin server on 4185 instead of its own.
export function adminPort(env = process.env) {
  return Number(env.EED_ADMIN_PORT || 4185);
}

export class AgentUnavailableError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'AgentUnavailableError';
    this.hint = hint || '';
  }
}

/** Fetch the sellable catalogue, with a clear message when the tool is not running. */
export async function fetchSellableMenus({ port = adminPort(), timeoutMs = 5000 } = {}) {
  const base = `http://127.0.0.1:${port}`;
  let response;
  try {
    response = await fetch(`${base}/sellable-menus`, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new AgentUnavailableError(
      `เชื่อมต่อเครื่องมือจัดการเมนูที่ ${base} ไม่ได้`,
      'เปิดด้วย start-server.bat แล้วลองอีกครั้ง',
    );
  }
  // Only ever talk to this project's own tool.
  if (response.headers.get('x-eed-local-tool') !== 'owner-set-builder') {
    throw new AgentUnavailableError(`ที่ ${base} ไม่ใช่เครื่องมือจัดการเมนูของเรา`, 'หยุดทำงานเพื่อความปลอดภัย');
  }
  if (!response.ok) {
    throw new AgentUnavailableError(`เครื่องมือจัดการเมนูตอบกลับ ${response.status}`, 'เปิดด้วย start-server.bat แล้วลองอีกครั้ง');
  }
  const payload = await response.json();
  if (!Array.isArray(payload?.menus)) {
    throw new AgentUnavailableError('ข้อมูลจากเครื่องมือจัดการเมนูไม่ถูกต้อง', 'ลองเปิดหน้า http://127.0.0.1:4185/ ดูว่าขึ้นข้อความอะไร');
  }
  return payload;
}

export function buildBudgetReport(sellable, budget) {
  return matchMenusByBudget({
    menus: sellable.menus,
    toppings: sellable.toppings,
    secondDish: sellable.secondDish,
    budget,
  });
}

function render(report) {
  const lines = [];
  if (!report.budgetCents) {
    return 'ใส่งบต่อกล่องเป็นตัวเลข เช่น 120 เพื่อดูรายการ';
  }

  lines.push(`งบต่อกล่อง ${report.budget} บาท — จับคู่ได้ ${report.total} เมนู`);
  lines.push('='.repeat(60));
  lines.push('กติกา: ราคาเมนู + อาหารเมนูที่ 2 + ตัวเลือกที่เลือก ต้องไม่เกินงบ ตัวที่เกินงบไม่แสดง');
  lines.push('');

  for (const floor of report.tierFloors) {
    lines.push(`  ระดับ ${floor.tier}: เริ่ม ${floor.price} บาท/กล่อง`);
  }
  lines.push('');

  for (const match of report.matches) {
    const priceLabel = `${match.price} บาท`;
    if (match.secondDish) {
      lines.push(`- ${match.name} (${match.tier}) ${priceLabel}`);
      lines.push(`  ต้องมี${match.secondDish.label} 1 อย่าง: ต่ำสุด ${match.minTotal} บาท/กล่อง`);
      if (match.secondDish.offered.length) {
        for (const item of match.secondDish.offered) {
          lines.push(`    - ${item.name} (+${item.price}) รวม ${item.total} บาท`);
        }
      } else {
        lines.push(`    - งบนี้ไม่พอสำหรับ${match.secondDish.label}ของระดับนี้`);
      }
      if (match.secondDish.totalOmitted > 0) {
        lines.push(`    (ตัด${match.secondDish.totalOmitted} รายการที่เกินงบออก)`);
      }
    } else {
      lines.push(`- ${match.name} (${match.tier}) ${priceLabel}`);
    }
    if (match.toppings.length) {
      lines.push(`  ตัวเลือกเสริมที่เลือกแล้วยังไม่เกินงบ: ${match.toppings.map((t) => `${t.name} (+${t.price})`).join(', ')}`);
    }
    if (match.toppingOmitted > 0) {
      lines.push(`  (ตัด${match.toppingOmitted} ตัวเลือกที่เกินงบออก)`);
    }
    lines.push('');
  }

  if (!report.matches.length) {
    lines.push('ไม่มีเมนูที่ราคาไม่เกินงบนี้ ลองขึ้นงบ หรือให้เราช่วยหาทางอื่น');
  }

  return lines.join('\n').trimEnd();
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) {
    process.stdout.write('ใช้: node tools/agent/menu-match.mjs <งบต่อกล่อง> [--json]\n');
    return;
  }
  const budget = Number(args.find((arg) => !arg.startsWith('--')));
  if (!Number.isFinite(budget) || budget <= 0) {
    process.stderr.write('ใส่งบเป็นตัวเลขบาทต่อกล่อง เช่น 120\n');
    process.exitCode = 2;
    return;
  }

  try {
    const sellable = await fetchSellableMenus();
    const report = buildBudgetReport(sellable, budget);
    process.stdout.write(`${args.includes('--json') ? JSON.stringify(report, null, 2) : render(report)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${error.hint ? `${error.hint}\n` : ''}`);
    process.exitCode = 1;
  }
}

if (isCli) {
  main();
}