// LINE webhook receiver — loopback-first, fail closed, sends nothing.
//
// Phase 1: receives LINE events, verifies the channel signature, and hands
// normalized message events to a callback. There is deliberately NO reply and
// NO push path in this file: Phase 1 only classifies (see line-sim), sending
// is a later, separately approved step.
//
//   node server/line-webhook.mjs [port]     default LINE_WEBHOOK_PORT or 5678
//
// LINE must reach this over public HTTPS in production; on this machine it
// listens on 127.0.0.1 only, so a reverse proxy or tunnel is required later.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

export const MAX_BODY_BYTES = 256 * 1024;

/** True only when the signature matches — rejects forged events. */
export function verifyLineSignature(rawBody, signature, channelSecret) {
  if (!rawBody || !signature || !channelSecret) return false;
  const expected = createHmac('sha256', channelSecret).update(rawBody).digest();
  let received;
  try {
    received = Buffer.from(String(signature).trim(), 'base64');
  } catch {
    return false;
  }
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Keep only what the triage needs; drop everything else (stickers, joins...). */
export function normalizeLineEvents(body) {
  const events = Array.isArray(body?.events) ? body.events : [];
  return events
    .filter((event) => event && event.type === 'message' && event.message?.type === 'text')
    .map((event) => ({
      userId: event.source?.userId || '',
      replyToken: event.replyToken || '',
      webhookEventId: event.webhookEventId || '',
      text: String(event.message.text || ''),
      timestamp: Number(event.timestamp) || Date.now(),
    }))
    .filter((event) => event.userId && (event.replyToken || event.webhookEventId));
}

function readBody(request, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body_too_large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

export function createLineWebhook({ channelSecret, onEvent = async () => {} } = {}) {
  if (!channelSecret) throw new Error('ต้องตั้ง LINE_CHANNEL_SECRET ก่อน (ห้ามรันโดยไม่มีลายเซ็น)');
  return createServer(async (request, response) => {
    const send = (status, payload) => {
      const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      response.end(body);
    };

    try {
      if (request.method === 'GET' && new URL(request.url, 'http://127.0.0.1').pathname === '/healthz') {
        send(200, { ok: true });
        return;
      }
      if (request.method !== 'POST') {
        send(405, { ok: false, error: 'POST only' });
        return;
      }

      const raw = await readBody(request);
      const signature = request.headers['x-line-signature'];
      if (!verifyLineSignature(raw, signature, channelSecret)) {
        send(403, { ok: false, error: 'bad_signature' });
        return;
      }

      let body;
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        send(400, { ok: false, error: 'bad_json' });
        return;
      }

      const messages = normalizeLineEvents(body);
      // Always 200 once accepted: a throw must not cause LINE retry storms.
      send(200, { ok: true, received: messages.length });
      for (const message of messages) {
        try {
          await onEvent(message);
        } catch {
          // Logged by the caller, never rethrown into the LINE retry loop.
        }
      }
    } catch {
      send(500, { ok: false, error: 'unavailable' });
    }
  });
}

async function main() {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) {
    process.stderr.write('ต้องตั้ง LINE_CHANNEL_SECRET ก่อน\n');
    process.exitCode = 1;
    return;
  }
  const port = Number(process.env.LINE_WEBHOOK_PORT || process.argv[2] || 5678);
  const server = createLineWebhook({
    channelSecret: secret,
    onEvent: async (message) => {
      process.stdout.write(`[line] ${message.userId}: ${message.text}\n`);
    },
  });
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`LINE webhook ฟังที่ http://127.0.0.1:${port}/ (รับอย่างเดียว ไม่ส่ง)\n`);
  });
}

if (isCli) {
  main();
}