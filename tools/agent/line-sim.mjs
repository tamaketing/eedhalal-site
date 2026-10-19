// Try the LINE triage on pretend customer messages — no LINE involved.
//
//   node tools/agent/line-sim.mjs "ขั้นต่ำกี่กล่อง"
//   node tools/agent/line-sim.mjs --all
//
// READ ONLY. Prints the route, the intent and the exact auto answer for every
// message, using the real data files. Nothing is sent anywhere.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { classifyLineMessage } from '../../services/lineFaq.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

const SAMPLES = [
  'สวัสดี',
  'เปิดกี่โมง',
  'ขั้นต่ำกี่กล่อง',
  'กล่องละเท่าไหร่',
  'ร้านอยู่ไหน',
  'ส่งต่างจังหวัดไหม',
  'มีใบรับรองฮาลาลไหม',
  'ขอใบเสนอราคา',
  'เอา 50 กล่อง วันที่ 20 นี้',
  'งานแต่ง 200 คนลดได้ไหม',
  'เมนูมีอะไรบ้าง',
  'งบกล่องละ 120',
  'แล้วถ้าเพิ่มไข่ดาวล่ะ',
];

const ROUTE_TH = { auto: 'ตอบเองได้', agent: 'ส่งเอเจนต์', human: 'ส่งเจ้าของ', ignore: 'ข้าม' };

function render(message, result) {
  const lines = [`> ${message}`, `  เส้นทาง: ${ROUTE_TH[result.route] || result.route} (${result.intent || '-'}, มั่นใจ ${result.confidence})`];
  if (result.answer) lines.push(`  ตอบ: ${result.answer}`);
  if (result.sources.length) lines.push(`  อ้าง: ${result.sources.join(', ')}`);
  lines.push(`  เหตุผล: ${result.reason}`);
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const messages = args.includes('--all') ? SAMPLES : args.filter((arg) => !arg.startsWith('-'));
  if (!messages.length) {
    process.stdout.write('ใช้: node tools/agent/line-sim.mjs "ข้อความ" [...] หรือ --all\n');
    return;
  }
  const [rules, planner] = await Promise.all([
    JSON.parse(await readFile(path.join(ROOT, 'data/business-rules.json'), 'utf8')),
    JSON.parse(await readFile(path.join(ROOT, 'data/planner-overrides.json'), 'utf8')),
  ]);
  const blocks = messages.map((message) => render(message, classifyLineMessage(message, { rules, planner })));
  const counts = {};
  for (const message of messages) {
    const route = classifyLineMessage(message, { rules, planner }).route;
    counts[route] = (counts[route] || 0) + 1;
  }
  process.stdout.write(`${blocks.join('\n\n')}\n\nสรุป: ${Object.entries(counts).map(([route, count]) => `${ROUTE_TH[route]} ${count}`).join(' · ')}\n`);
}

if (isCli) {
  main().catch((error) => {
    process.stderr.write(`จำลองไม่สำเร็จ: ${error.message}\n`);
    process.exitCode = 1;
  });
}