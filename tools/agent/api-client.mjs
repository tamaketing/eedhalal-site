// EED HALAL — shared Internal API client for agent tools.
//
// One place that knows how to talk to the internal business API: the loopback
// server that owns drafts, leads, customers and memories. The secret is read
// from the environment only and is never printed, logged or accepted as an
// argument.
//
// READ AND WRITE, BUT NOT "SEND": this client can create drafts, evaluate
// leads and record customer memory. It deliberately exposes nothing that
// approves, edits, rejects or sends a message to LINE — those stay with the
// owner in the Owner Console.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

export const API_HOST = process.env.INTERNAL_API_HOST || '127.0.0.1';
export const API_PORT = Number(process.env.INTERNAL_API_PORT || 8788);
export const API_BASE = `http://${API_HOST}:${API_PORT}`;

export function apiSecret(env = process.env) {
  const secret = env.EED_INTERNAL_API_SECRET;
  if (!secret) {
    throw new Error(
      'ยังไม่ได้ตั้ง EED_INTERNAL_API_SECRET — เปิด Internal API ก่อน (npm run api:start) แล้วตั้งค่า secret',
    );
  }
  return secret;
}

export async function apiRequest(method, route, body = undefined, { timeoutMs = 10000 } = {}) {
  const response = await fetch(`${API_BASE}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiSecret()}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 401) {
    throw new Error('Internal API ไม่ยอมรับ secret ที่ตั้งไว้ ตรวจ EED_INTERNAL_API_SECRET อีกครั้ง');
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Internal API ${method} ${route} -> ${response.status} ${text.slice(0, 200)}`);
  }
  return response.json();
}

export async function apiGet(route, options = {}) {
  return apiRequest('GET', route, undefined, options);
}

export async function apiPost(route, body, options = {}) {
  return apiRequest('POST', route, body, options);
}

/** Read one CLI flag: --name value */
export function flag(args, name, fallback = '') {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) return '';
  return value;
}

/** True when the CLI was asked for --help. */
export function wantsHelp(args) {
  return args.includes('--help') || args.includes('-h');
}

export { ROOT, isCli };
