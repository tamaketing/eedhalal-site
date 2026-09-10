import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const required = ['LINE_CHANNEL_SECRET', 'N8N_INTERNAL_WEBHOOK_URL', 'EED_WEBHOOK_FORWARD_SECRET'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}

const host = process.env.LINE_GATEWAY_HOST || '127.0.0.1';
const port = Number(process.env.LINE_GATEWAY_PORT || 8787);
const maxPayloadBytes = 1024 * 1024;

function signatureFor(payload) {
  return createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(payload).digest('base64');
}

function signaturesMatch(received, expected) {
  if (!received) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

function respond(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/healthz') {
    respond(response, 200, { status: 'ok' });
    return;
  }
  if (request.method !== 'POST' || request.url !== '/line-webhook') {
    respond(response, 404, { error: 'not_found' });
    return;
  }

  const chunks = [];
  let size = 0;
  request.on('data', (chunk) => {
    size += chunk.length;
    if (size > maxPayloadBytes) request.destroy();
    else chunks.push(chunk);
  });
  request.on('error', () => respond(response, 400, { error: 'invalid_request' }));
  request.on('end', async () => {
    const payload = Buffer.concat(chunks);
    if (size > maxPayloadBytes) return respond(response, 413, { error: 'payload_too_large' });
    if (!signaturesMatch(request.headers['x-line-signature'], signatureFor(payload))) {
      return respond(response, 401, { error: 'invalid_signature' });
    }
    try {
      const upstream = await fetch(process.env.N8N_INTERNAL_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'content-type': request.headers['content-type'] || 'application/json',
          'x-eed-webhook-secret': process.env.EED_WEBHOOK_FORWARD_SECRET,
        },
        body: payload,
        signal: AbortSignal.timeout(10000),
      });
      respond(response, upstream.ok ? 200 : 503, { status: upstream.ok ? 'accepted' : 'upstream_unavailable' });
    } catch {
      respond(response, 503, { error: 'upstream_unavailable' });
    }
  });
});

server.listen(port, host, () => console.log(`LINE webhook gateway listening on http://${host}:${port}`));
