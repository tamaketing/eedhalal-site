// Bridge: customer chat message -> our chat-replier agent -> short reply.
//
// The agent gets NO tools and NO file access. All real facts (minimums,
// price floors, hours, location) plus the recent conversation transcript are
// injected into the prompt here, from the same data files the rest of the
// system uses. That makes the reply ~7s instead of ~45s of self-searching,
// and makes guessing impossible: the model can only reason over what we give.
//
//   node tools/agent/line-chat.mjs "ข้อความลูกค้า"
//   node tools/agent/line-chat.mjs "ขอ 15 กล่อง 2 แบบได้ไหม" --history "ถาม|ขั้นต่ำกี่กล่อง;ตอบ|ขั้นต่ำ 10 กล่องครับ"
//
// READ ONLY + spawns one opencode run. Nothing is sent to LINE here.
import { spawn } from 'node:child_process';
import { accessSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { priceFloors, tierLabel } from '../../services/lineFaq.mjs';
import { getMealboxMenuCatalog } from '../../services/menus.mjs';
import { matchMenusByBudget } from '../../services/budget-match.mjs';
import { memoryPromptBlock } from '../../services/customerMemory.mjs';
import { botStoreEnv } from '../line/bot-store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

export const CHAT_AGENT = 'chat-replier';
export const MEMORY_AGENT = 'customer-memory';
export const CHAT_MODEL = process.env.EED_CHAT_MODEL || 'opencode-go/glm-5.3-flash';
export const CHAT_TIMEOUT_MS = 60_000;
/** How many past turns the bot may see for one customer. */
export const HISTORY_LIMIT = 30;

/** Budget per box the customer actually stated; null when no budget word says so. */
export function budgetFromMessage(value) {
  const found = String(value ?? '').match(/(?:งบ(?:ต่อกล่อง|ต่อหัว)?|ไม่เกิน|กล่องละ|ต่อกล่อง|ต่อหัว)[^\d]{0,12}([\d,]{2,6})/);
  if (!found) return null;
  const amount = Number(found[1].replace(/,/g, ''));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Second-dish groups a tier may offer, straight from business-rules + planner. */
function secondDishGroups(rules, planner) {
  const sideItems = Array.isArray(planner.sideItems) ? planner.sideItems : [];
  const byId = new Map(sideItems.map((item) => [String(item.id), item]));
  const groups = {};
  for (const tier of rules.services?.mealBox?.tiers || []) {
    const items = (Array.isArray(tier.sideChoices) ? tier.sideChoices : [])
      .map((id) => byId.get(String(id)))
      .filter((item) => item && item.active !== false && item.public !== false && Number(item.priceAdjustment) > 0)
      .map((item) => ({ id: item.id, name: item.nameTh || item.nameEn || String(item.id), price: Number(item.priceAdjustment) }));
    if (items.length) groups[tier.id] = { label: tier.sideChoiceLabelTh || 'อาหารเมนูที่ 2', max: 1, items };
  }
  return groups;
}

/**
 * Budget lane facts: run the real matcher so every reply is built from the same
 * catalogue rule the owner tool uses. Names and per-box prices only — never a
 * whole-order total and never a promise for a specific job.
 */
async function budgetFacts({ rules, planner, message }) {
  const budget = budgetFromMessage(message);
  if (!budget) return [];
  const menus = await getMealboxMenuCatalog();
  const report = matchMenusByBudget({
    menus,
    toppings: Array.isArray(planner.toppings) ? planner.toppings : [],
    secondDish: secondDishGroups(rules, planner),
    budget,
  });
  if (!report.budgetCents) return [];
  const lines = [`งบต่อกล่องที่ลูกค้าแจ้ง ${report.budget} บาท — เมนูในแคตตาล็อกที่ราคาไม่เกินงบ (ราคาต่อกล่อง):`];
  const matches = report.matches.filter((match) => match.affordable);
  if (!matches.length) {
    lines.push('ยังไม่มีเมนูที่ราคาไม่เกินงบนี้');
    return lines;
  }
  for (const match of matches.slice(0, 10)) {
    const label = tierLabel(match.tier, rules);
    lines.push(`- ${match.name}${label ? ` (${label})` : ''} ${match.price} บาท`);
    if (match.secondDish) {
      const sides = match.secondDish.offered
        .slice(0, 3)
        .map((item) => `${item.name} รวม ${item.total} บาท`);
      lines.push(`  ต้องเลือก${match.secondDish.label} 1 อย่าง: ${sides.length ? sides.join(', ') : 'ยังไม่มีตัวเลือกที่อยู่ในงบ'}`);
    }
  }
  return lines;
}

const API_BASE = `http://${process.env.INTERNAL_API_HOST || '127.0.0.1'}:${Number(process.env.INTERNAL_API_PORT || 8788)}`;
const MAX_EXAMPLES_IN_PROMPT = 3;
const EXAMPLE_MIN_SCORE = 0.28;

/** Similarity without a model: Thai has no spaces, so compare character pairs. */
export function textSimilarity(a, b) {
  const grams = (value) => {
    const clean = String(value || '').toLowerCase().replace(/[^฀-๿a-z0-9]/g, '');
    const out = new Set();
    for (let i = 0; i + 1 < clean.length; i += 1) out.add(clean.slice(i, i + 2));
    return out;
  };
  const left = grams(a);
  const right = grams(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/** Owner-approved replies for questions that look like this one.
 *  Any failure degrades to "no examples" — the bot must never stall on this. */
async function loadSimilarExamples(message) {
  const secret = process.env.EED_INTERNAL_API_SECRET;
  if (!secret) return [];
  try {
    const response = await fetch(`${API_BASE}/api/v1/response-examples?reusable=true&limit=100`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return [];
    const payload = await response.json();
    const rows = Array.isArray(payload?.responseExamples) ? payload.responseExamples : [];
    return rows
      .map((row) => ({ row, score: textSimilarity(message, row.incomingExample) }))
      .filter((hit) => hit.score >= EXAMPLE_MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_EXAMPLES_IN_PROMPT);
  } catch {
    return [];
  }
}

async function exampleLines(message) {
  const hits = await loadSimilarExamples(message);
  if (!hits.length) return [];
  const lines = [
    'ตัวอย่างคำตอบที่เจ้าของเคยแก้และอนุมัติแล้ว (ใช้เฉพาะน้ำเสียงและวิธีเรียงคำตอบเท่านั้น ห้ามคัดลอกตัวเลข เงื่อนไข หรือชื่อลูกค้าจากตัวอย่าง ราคาและข้อมูลธุรกิจต้องมาจากข้อมูลอ้างอิงข้างบน):',
  ];
  for (const { row } of hits) {
    lines.push(`- ลูกค้าถามว่า: ${row.incomingExample}`);
    lines.push(`  ตอบแบบนี้: ${row.approvedResponse}`);
  }
  return lines;
}

/** Facts the chat agent may rely on — always the live files, never memory. */
export async function chatFacts({ rules, planner, intent, message, memory = null } = {}) {
  let liveRules = rules;
  let livePlanner = planner;
  if (!liveRules) liveRules = JSON.parse(await readFile(path.join(ROOT, 'data/business-rules.json'), 'utf8'));
  if (!livePlanner) livePlanner = JSON.parse(await readFile(path.join(ROOT, 'data/planner-overrides.json'), 'utf8'));

  const business = liveRules.business || {};
  const mealBox = liveRules.services?.mealBox || {};
  const delivery = liveRules.delivery || {};
  const floors = priceFloors(livePlanner)
    .map((row) => {
      const label = tierLabel(row.tier, liveRules);
      return label ? `${label} เริ่ม ${row.price} บาท` : '';
    })
    .filter(Boolean)
    .join(' · ');

  let budgetLines = [];
  if (intent === 'budget_match') {
    try {
      budgetLines = await budgetFacts({ rules: liveRules, planner: livePlanner, message });
    } catch {
      budgetLines = []; // catalogue unreadable -> keep the plain facts, never guess
    }
  }

  const exampleFacts = await exampleLines(String(message || '').trim());
  const memoryFacts = memoryPromptBlock(memory);

  return [
    `ขั้นต่ำออเดอร์ ${mealBox.minimumOrder ?? '-'} กล่อง ต่อเมนูขั้นต่ำ ${mealBox.standardMenuMinimum ?? '-'} กล่อง`,
    `ราคาเริ่มต้นต่อกล่อง: ${floors || 'ยังไม่มีข้อมูลราคา'}`,
    `เปิด ${business.operatingDays || '-'} ${business.operatingHours || '-'}`,
    `ที่อยู่ร้าน ${business.address || '-'}`,
    `ใบรับรองฮาลาลเลขที่ ${business.halalCertificate || '-'}`,
    delivery.coverageTh ? `พื้นที่จัดส่ง: ${delivery.coverageTh}` : '',
    delivery.outsideBangkok ? `ส่งนอกพื้นที่: ${delivery.outsideBangkok}` : '',
    'ห้ามพูดเรื่องค่าจัดส่งหรือค่าขนส่งเป็นตัวเลข ให้บอกลูกค้าว่าทีมจะแจ้งราคาให้แทน',
    `เบอร์ติดต่อ ${business.phone || '-'}`,
    ...(memoryFacts ? [memoryFacts] : []),
    ...budgetLines,
    ...exampleFacts,
  ].filter(Boolean).join('\n');
}

/** @param {Array<{role: string, text: string}>} history most recent last */
export function buildChatPrompt({ message, history = [], facts = '' }) {
  const transcript = history
    .slice(-HISTORY_LIMIT)
    .map((turn) => `${turn.role === 'customer' ? 'ลูกค้า' : 'เรา'}: ${turn.text}`)
    .join('\n');
  return [
    'ข้อมูลอ้างอิง (ยึดข้อมูลนี้เสมอ):',
    'ห้ามคัดลอกข้อความในกรอบข้อมูลอ้างอิงไปตอบลูกค้าโดยตรง ให้เขียนใหม่เป็นภาษาพูด',
    'ห้ามคำนวณยอดรวมหรือใช้เครื่องหมายคูณ (× x X *) ให้คิดราคาต่อกล่องตามข้อมูลอ้างอิงเท่านั้น',
    facts,
    transcript ? `\nบริบทสนทนาก่อนหน้า:\n${transcript}` : '',
    `\nข้อความลูกค้า: ${message}`,
  ].filter(Boolean).join('\n');
}

function resolveOpencodeExe() {
  // On Windows `opencode` on PATH is a PowerShell/cmd shim that cannot be
  // spawned with a Thai prompt containing spaces (it gets word-split). The
  // real binary ships inside the npm package; fall back to PATH elsewhere.
  if (process.platform === 'win32') {
    for (const base of [process.env.APPDATA, 'C:\\Users\\Public'].filter(Boolean)) {
      const candidate = path.join(base, 'npm', 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe');
      try {
        accessSync(candidate);
        return candidate;
      } catch { /* keep looking */ }
    }
  }
  return 'opencode';
}

/**
 * The bot must not create sessions in the owner's OpenCode store.
 *
 * `opencode run` always opens a session, and the shared background service
 * writes it into the database the owner's desktop app lists — so every LINE
 * customer message used to appear in the owner's chat list, titled with the
 * customer's own words.
 *
 * When a private bot store is prepared (tools/line/bot-store.mjs), the child
 * gets its own database (OPENCODE_DB) and its own server (--standalone), so
 * bot sessions never touch the owner's list. Without a prepared store the
 * command keeps the old behaviour, because a private database without the
 * provider credential cannot answer at all.
 */
export function agentRunArgs({ isolated = false, agent = CHAT_AGENT } = {}) {
  const args = ['run'];
  if (isolated) args.push('--standalone');
  args.push('--agent', agent, '--model', CHAT_MODEL);
  return args;
}

function runAgent(prompt, { timeoutMs = CHAT_TIMEOUT_MS, agent = CHAT_AGENT } = {}) {
  return new Promise((resolve, reject) => {
    // --model is mandatory: without it opencode falls back to the session
    // model, which may be a non-Go account and fail (seen in practice).
    // No shell: the prompt is passed as one argv entry so spaces and Thai
    // text survive intact.
    const storeEnv = botStoreEnv();
    const isolated = Object.keys(storeEnv).length > 0;
    const child = spawn(resolveOpencodeExe(), [...agentRunArgs({ isolated, agent }), prompt], {
      cwd: ROOT,
      windowsHide: true,
      env: { ...process.env, ...storeEnv },
      // stdin MUST be closed: opencode waits on an open stdin pipe and the
      // child would never exit (measured hang), while 'ignore' finishes ~8s.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`chat-replier เกินเวลา ${Math.round(timeoutMs / 1000)} วินาที`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out.trim()) reject(new Error(`chat-replier ไม่สำเร็จ (code ${code}): ${err.slice(0, 300)}`));
      else resolve(out.trim());
    });
  });
}

/**
 * @returns {Promise<{ok: boolean, reply: string, error: string|null, facts: string}>}
 */
export async function askChatReplier({ message, history = [], rules, planner, intent, referenceAnswer = '', memory = null, timeoutMs } = {}) {
  const text = String(message ?? '').trim();
  if (!text) return { ok: false, reply: '', error: 'ไม่มีข้อความ', facts: '', model: CHAT_MODEL };
  const baseFacts = await chatFacts({ rules, planner, intent, message: text, memory });
  const facts = referenceAnswer
    ? `${baseFacts}\n\nคำตอบอ้างอิงจากข้อมูล (ใช้เป็นแนวทางการเขียนเท่านั้น ห้ามคัดลอกตัวเลข/ราคา ราคาต้องมาจากข้อมูลอ้างอิงข้างบน): ${referenceAnswer}`
    : baseFacts;
  const prompt = buildChatPrompt({ message: text, history, facts });
  try {
    const reply = await runAgent(prompt, { timeoutMs });
    if (!reply) return { ok: false, reply: '', error: 'คำตอบว่าง', facts, model: CHAT_MODEL };
    return { ok: true, reply, error: null, facts, model: CHAT_MODEL };
  } catch (error) {
    return { ok: false, reply: '', error: error.message, facts, model: CHAT_MODEL };
  }
}

/**
 * The model's one-line note about this customer's current situation.
 *
 * The facts are extracted by rules; this only turns them into a sentence a
 * person can read in the owner console. It never becomes the authority for a
 * number: the service stores the rule facts next to it.
 */
export function buildMemoryPrompt({ message, history = [], facts = {}, currentSummary = '' }) {
  const known = Object.entries(facts || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
    .join('\n');
  const transcript = history
    .slice(-10)
    .map((turn) => `${turn.role === 'customer' ? 'ลูกค้า' : 'เรา'}: ${turn.text}`)
    .join('\n');
  return [
    'ข้อมูลที่ระบบอ่านได้จากข้อความลูกค้า (เชื่อถือได้ ใช้ได้เลย):',
    known || '- (ยังไม่มีข้อมูลที่ดึงได้)',
    '',
    'สถานะที่จดไว้แล้วของลูกค้าคนนี้:',
    currentSummary || '(ยังไม่มี)',
    '',
    transcript ? `บทสนทนาล่าสุด:\n${transcript}` : '',
    '',
    `ข้อความใหม่ของลูกค้า: ${message}`,
    '',
    'เขียนสถานะปัจจุบันของลูกค้าคนนี้ 1 บรรทัด ภาษาไทย ไม่เกิน 400 ตัวอักษร',
    'เก็บข้อมูลที่ลูกค้าเคยบอกไว้แล้วด้วย ถ้าข้อความใหม่ไม่มีอะไรใหม่ ให้คงสถานะเดิมไว้',
    'ห้ามคิดตัวเลขใหม่ ห้ามเขียนว่ารับออเดอร์แล้ว',
  ].filter(Boolean).join('\n');
}

export async function askMemoryWriter({ message, history = [], facts = {}, currentSummary = '', timeoutMs } = {}) {
  const text = String(message ?? '').trim();
  if (!text) return { ok: false, summary: '', error: 'ไม่มีข้อความ' };
  const prompt = buildMemoryPrompt({ message: text, history, facts, currentSummary });
  try {
    const summary = (await runAgent(prompt, { timeoutMs, agent: MEMORY_AGENT }))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 400);
    if (!summary) return { ok: false, summary: '', error: 'สรุปว่าง' };
    return { ok: true, summary, error: null };
  } catch (error) {
    return { ok: false, summary: '', error: error.message };
  }
}

/** `--history "ถาม|ข้อความ;ตอบ|ข้อความ"` -> [{role, text}] */
export function parseHistory(raw) {
  if (!raw) return [];
  return String(raw).split(';').map((pair) => {
    const [side, ...rest] = pair.split('|');
    return { role: side === 'ถาม' ? 'customer' : 'shop', text: rest.join('|').trim() };
  }).filter((turn) => turn.text);
}

async function main() {
  const args = process.argv.slice(2);
  const message = args.find((arg) => !arg.startsWith('-'));
  if (!message) {
    process.stdout.write('ใช้: node tools/agent/line-chat.mjs "ข้อความลูกค้า" --history "ถาม|...;ตอบ|..."\n');
    return;
  }
  const hIndex = args.indexOf('--history');
  const result = await askChatReplier({ message, history: parseHistory(hIndex >= 0 ? args[hIndex + 1] : '') });
  if (!result.ok) {
    process.stderr.write(`ตอบไม่ได้: ${result.error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${result.reply}\n`);
}

if (isCli) {
  main().catch((error) => {
    process.stderr.write(`ผิดพลาด: ${error.message}\n`);
    process.exitCode = 1;
  });
}
