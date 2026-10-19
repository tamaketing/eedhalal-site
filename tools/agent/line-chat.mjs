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

import { priceFloors } from '../../services/lineFaq.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

export const CHAT_AGENT = 'chat-replier';
export const CHAT_MODEL = process.env.EED_CHAT_MODEL || 'opencode-go/glm-5.3-flash';
export const CHAT_TIMEOUT_MS = 60_000;

/** Facts the chat agent may rely on — always the live files, never memory. */
export async function chatFacts({ rules, planner } = {}) {
  let liveRules = rules;
  let livePlanner = planner;
  if (!liveRules) liveRules = JSON.parse(await readFile(path.join(ROOT, 'data/business-rules.json'), 'utf8'));
  if (!livePlanner) livePlanner = JSON.parse(await readFile(path.join(ROOT, 'data/planner-overrides.json'), 'utf8'));

  const business = liveRules.business || {};
  const mealBox = liveRules.services?.mealBox || {};
  const delivery = liveRules.delivery || {};
  const floors = priceFloors(livePlanner).map((row) => `${row.tier} เริ่ม ${row.price} บาท`).join(' · ');

  return [
    `ขั้นต่ำออเดอร์ ${mealBox.minimumOrder ?? '-'} กล่อง ต่อเมนูขั้นต่ำ ${mealBox.standardMenuMinimum ?? '-'} กล่อง`,
    `ราคาเริ่มต้นต่อกล่อง: ${floors || 'ยังไม่มีข้อมูลราคา'}`,
    `เปิด ${business.operatingDays || '-'} ${business.operatingHours || '-'}`,
    `ที่อยู่ร้าน ${business.address || '-'}`,
    `ใบรับรองฮาลาลเลขที่ ${business.halalCertificate || '-'}`,
    delivery.coverageTh ? `จัดส่ง ${delivery.coverageTh}` : '',
    `เบอร์ติดต่อ ${business.phone || '-'}`,
  ].filter(Boolean).join('\n');
}

/** @param {Array<{role: string, text: string}>} history most recent last */
export function buildChatPrompt({ message, history = [], facts = '' }) {
  const transcript = history
    .slice(-8)
    .map((turn) => `${turn.role === 'customer' ? 'ลูกค้า' : 'เรา'}: ${turn.text}`)
    .join('\n');
  return [
    'ข้อมูลอ้างอิง (ยึดข้อมูลนี้เสมอ):',
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

function runAgent(prompt, { timeoutMs = CHAT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    // --model is mandatory: without it opencode falls back to the session
    // model, which may be a non-Go account and fail (seen in practice).
    // No shell: the prompt is passed as one argv entry so spaces and Thai
    // text survive intact.
    const child = spawn(resolveOpencodeExe(), ['run', '--agent', CHAT_AGENT, '--model', CHAT_MODEL, prompt], {
      cwd: ROOT,
      windowsHide: true,
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
export async function askChatReplier({ message, history = [], rules, planner, timeoutMs } = {}) {
  const text = String(message ?? '').trim();
  if (!text) return { ok: false, reply: '', error: 'ไม่มีข้อความ', facts: '', model: CHAT_MODEL };
  const facts = await chatFacts({ rules, planner });
  const prompt = buildChatPrompt({ message: text, history, facts });
  try {
    const reply = await runAgent(prompt, { timeoutMs });
    if (!reply) return { ok: false, reply: '', error: 'คำตอบว่าง', facts, model: CHAT_MODEL };
    return { ok: true, reply, error: null, facts, model: CHAT_MODEL };
  } catch (error) {
    return { ok: false, reply: '', error: error.message, facts, model: CHAT_MODEL };
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
