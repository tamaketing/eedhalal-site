// EED HALAL — internal business API (Phase 4A).
// Thin HTTP layer over services/* and db/*. Handlers validate input,
// authenticate, call exactly one service, and present the result.
// No business logic, no SQL, no LINE calls, no sender, no kitchen push.
//
// Endpoints (all /api/v1 except healthz; mutations need JSON + auth):
//   GET  /healthz
//   POST /api/v1/customers/resolve { lineUserId, displayName? }
//   POST /api/v1/leads/evaluate    { customerId, message, context? }
//   POST /api/v1/drafts            { customerId, leadId?, channel?, incomingMessage,
//                                    draftResponse, source?, aiModel?, ruleRevision?,
//                                    sourceEventId?, metadata? } -> 201 (200 + deduped on retry)
//   GET  /api/v1/drafts?status=&limit=&order= (order asc|desc, default asc;
//          list items embed sanitized customer context)
//   GET  /api/v1/drafts/:id        (UUID id or human draftId; embeds customer
//          plus linked lead summary for Owner Console review)
//   POST /api/v1/drafts/:id/approve { ownerId?, expectedUpdatedAt?, expectedStatus? }
//   POST /api/v1/drafts/:id/edit    { finalText, ownerId?, ...concurrency }
//   POST /api/v1/drafts/:id/reject  { ownerId?, ...concurrency }
//   POST /api/v1/drafts/:id/send    { ownerId?, expectedUpdatedAt?, expectedStatus? }
//          (owner-only LINE Push; text/recipient always re-derived server-side;
//          needs LINE_CHANNEL_ACCESS_TOKEN in server env)
//   POST /api/v1/response-examples/from-draft/:draftId { ownerId?, styleTags? }
//          (explicit owner opt-in only; 201 new, 200 + deduped on re-opt-in)
//   GET  /api/v1/response-examples?reusable=&intent=&serviceType=&limit=
//   GET  /api/v1/response-examples/:id
//   PATCH /api/v1/response-examples/:id { reusable?, styleTags?, intent?, serviceType?, ownerId? }
//
// NOT IMPLEMENTED here: LINE sender, regenerate-with-AI, kitchen push,
// quotation/order/job/payment/accounting.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdapter } from '../db/index.mjs';
import { requireInternalAuth } from './auth.mjs';
import { presentCustomer, presentDraft, presentLead, presentInboundMessage, presentResponseExample } from './present.mjs';
import { receiveInboundMessage, attachCustomer, markProcessing, markFailed, completeInbound, retryInbound,
  getInboundMessage, requireInboundObject } from '../services/inboundMessages.mjs';
import { createResponseExampleFromDraft, getResponseExample, listResponseExamples,
  setResponseExampleReusable } from '../services/responseExamples.mjs';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../services/errors.mjs';
import { maybeCreateLead } from '../services/leads.mjs';
import { resolveCustomer } from '../services/customers.mjs';
import { approveDraft, editDraft, persistDraftOnce, rejectDraft, sendDraft } from '../services/drafts.mjs';

const MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Owner Console static assets (Phase 4B-3B). Exact-path allowlist only —
// no directory traversal is possible because the request path is never used
// to build a filesystem path. These files contain no secrets and no data;
// every business-data API stays behind Bearer auth on loopback only.
const OWNER_ASSETS = {
  '/owner/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/owner/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/owner/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
};
const OWNER_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

// Current business-rules revision for example staleness flags. Read once at
// startup from the repo source of truth; null when unavailable (staleRules
// then reports null = unknown). Presentation metadata only — retrieval and
// business logic never consult it.
let currentBusinessRulesRevision = null;
try {
  const rulesRaw = await readFile(new URL('../data/business-rules.json', import.meta.url), 'utf8');
  const parsed = JSON.parse(rulesRaw);
  if (typeof parsed.revision === 'string' && parsed.revision) currentBusinessRulesRevision = parsed.revision;
} catch {
  currentBusinessRulesRevision = null;
}

function withStaleness(example) {
  if (!example) return example;
  return {
    ...example,
    staleRules: currentBusinessRulesRevision == null ? null : example.businessRulesRevision !== currentBusinessRulesRevision,
  };
}

function send(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(payload);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on('error', () => reject(new ValidationError('invalid_request')));
    request.on('close', () => {
      if (failed) reject(new ValidationError('payload_too_large'));
    });
    request.on('end', () => {
      if (failed) return;
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new ValidationError('invalid_json'));
      }
    });
  });
}

function statusFor(error) {
  if (error instanceof ValidationError) return 400;
  if (error instanceof UnauthorizedError) return 401;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ConflictError) return 409;
  return 500;
}

function safeMessage(error, status) {
  if (status !== 500) return error.message;
  return 'internal_error';
}

function needString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} is required`);
  return value;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

export function createInternalApi({ repos, env = process.env } = {}) {
  if (!repos) throw new Error('repos are required.');
  const store = repos;
  const adapterKind = (env.DB_ADAPTER || 'memory').toLowerCase();

  async function findDraft(id) {
    return (await store.drafts.findById(id)) || (await store.drafts.findByDraftId(id));
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://internal');
      const { pathname } = url;

      if (request.method === 'GET' && pathname === '/healthz') {
        send(response, 200, { status: 'ok' });
        return;
      }

      // Liveness vs readiness: healthz = process alive; readiness = database
      // reachable. Only the adapter name is exposed — never hosts, users,
      // passwords, URLs, or secrets.
      if (request.method === 'GET' && pathname === '/readiness') {
        try {
          await withTimeout(store.ping(), 5000);
          send(response, 200, { ready: true, adapter: adapterKind });
        } catch {
          send(response, 503, { ready: false, adapter: adapterKind });
        }
        return;
      }

      if (!pathname.startsWith('/api/v1/')) {
        // Owner Console assets: static files only, no auth (no data/secrets).
        if (request.method === 'GET' && Object.hasOwn(OWNER_ASSETS, pathname)) {
          const asset = OWNER_ASSETS[pathname];
          const body = await readFile(new URL(`../owner-console/${asset.file}`, import.meta.url), 'utf8');
          response.writeHead(200, {
            'content-type': asset.type,
            'content-security-policy': OWNER_CSP,
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'no-referrer',
            'cache-control': 'no-store',
          });
          response.end(body);
          return;
        }
        send(response, 404, { error: 'not_found' });
        return;
      }

      requireInternalAuth(request.headers, env);

      if (request.method === 'POST' || request.method === 'PATCH' || request.method === 'PUT') {
        const contentType = String(request.headers['content-type'] || '');
        if (!contentType.includes('application/json')) {
          send(response, 415, { error: 'json_required' });
          return;
        }
      }

      // B2.5 foundation: no worker dispatch, list/search, AI calls or sends.
      if (request.method === 'POST' && pathname === '/api/v1/inbound-messages') {
        const result = await receiveInboundMessage(store, await readJsonBody(request));
        send(response, result.deduped ? 200 : 201, { inbound: presentInboundMessage(result.inbound), deduped: result.deduped });
        return;
      }
      const inboundMatch = pathname.match(/^\/api\/v1\/inbound-messages\/([^/]+)(?:\/(processing|fail|complete|retry))?$/);
      if (inboundMatch) {
        const [, id, action] = inboundMatch;
        if (request.method === 'GET' && !action) {
          send(response, 200, { inbound: presentInboundMessage(await getInboundMessage(store, id)) });
          return;
        }
        if ((request.method === 'PATCH' && !action) || (request.method === 'POST' && action)) {
          const body = await readJsonBody(request);
          requireInboundObject(body);
          const handler = action ? { processing: markProcessing, fail: markFailed, complete: completeInbound, retry: retryInbound }[action] : attachCustomer;
          send(response, 200, { inbound: presentInboundMessage(await handler(store, id, body)) });
          return;
        }
      }

      // B2.5/4B-4 Step 1: owner-managed reusable response examples.
      // Opt-in only (POST from-draft on a SENT draft); retrieval stays
      // service-internal for future prompt use — no retrieval HTTP route yet.
      if (request.method === 'POST' && pathname.startsWith('/api/v1/response-examples/from-draft/')) {
        const draftId = decodeURIComponent(pathname.slice('/api/v1/response-examples/from-draft/'.length));
        const body = await readJsonBody(request);
        requireInboundObject(body);
        const result = await createResponseExampleFromDraft(store, draftId, {
          ownerId: body.ownerId ? String(body.ownerId) : '',
          styleTags: body.styleTags,
        });
        send(response, result.deduped ? 200 : 201, { example: withStaleness(presentResponseExample(result.example)), deduped: !!result.deduped });
        return;
      }
      const exampleMatch = pathname.match(/^\/api\/v1\/response-examples(?:\/([^/]+))?$/);
      if (exampleMatch) {
        const id = exampleMatch[1] ? decodeURIComponent(exampleMatch[1]) : null;
        if (request.method === 'GET' && !id) {
          const query = {
            limit: url.searchParams.get('limit') ?? undefined,
            reusable: url.searchParams.get('reusable'),
            intent: url.searchParams.get('intent') ?? undefined,
            serviceType: url.searchParams.get('serviceType') ?? undefined,
          };
          if (query.reusable === null) delete query.reusable;
          else if (query.reusable === 'true') query.reusable = true;
          else if (query.reusable === 'false') query.reusable = false;
          else throw new ValidationError('invalid reusable');
          const rows = await listResponseExamples(store, query);
          send(response, 200, { examples: rows.map((row) => withStaleness(presentResponseExample(row))), total: rows.length, limit: Math.min(Math.max(Number(query.limit) || 20, 1), 100) });
          return;
        }
        if (request.method === 'GET' && id) {
          send(response, 200, { example: withStaleness(presentResponseExample(await getResponseExample(store, id))) });
          return;
        }
        if (request.method === 'PATCH' && id) {
          const body = await readJsonBody(request);
          requireInboundObject(body);
          const options = { ownerId: body.ownerId ? String(body.ownerId) : '' };
          for (const key of ['reusable', 'styleTags', 'intent', 'serviceType']) {
            if (body[key] !== undefined) options[key] = body[key];
          }
          send(response, 200, { example: withStaleness(presentResponseExample(await setResponseExampleReusable(store, id, options))) });
          return;
        }
      }

      // POST /api/v1/customers/resolve
      if (request.method === 'POST' && pathname === '/api/v1/customers/resolve') {
        const body = await readJsonBody(request);
        const customer = await resolveCustomer(store, {
          lineUserId: body.lineUserId ? String(body.lineUserId) : null,
          displayName: body.displayName ? String(body.displayName) : '',
        }, { type: 'SYSTEM', id: 'internal-api' });
        send(response, 200, { customer: presentCustomer(customer) });
        return;
      }

      // POST /api/v1/leads/evaluate
      if (request.method === 'POST' && pathname === '/api/v1/leads/evaluate') {
        const body = await readJsonBody(request);
        const customerId = needString(body.customerId, 'customerId');
        const message = needString(body.message, 'message');
        const customer = await store.customers.findById(customerId);
        if (!customer) throw new NotFoundError(`customer not found: ${customerId}`);
        const { lead, signals, deduped } = await maybeCreateLead(store, {
          customerId, message,
          sourceEventId: typeof body.sourceEventId === 'string' ? body.sourceEventId : null,
          actor: { type: 'SYSTEM', id: 'internal-api' },
        });
        send(response, 200, { shouldCreate: !!lead, signals, lead: presentLead(lead), deduped: !!deduped });
        return;
      }

      // POST /api/v1/drafts (status is ALWAYS forced server-side)
      if (request.method === 'POST' && pathname === '/api/v1/drafts') {
        const body = await readJsonBody(request);
        const customerId = needString(body.customerId, 'customerId');
        const customer = await store.customers.findById(customerId);
        if (!customer) throw new NotFoundError(`customer not found: ${customerId}`);
        if (body.leadId) {
          const lead = await store.leads.findById(String(body.leadId));
          if (!lead) throw new NotFoundError(`lead not found: ${body.leadId}`);
        }
        const draft = await persistDraftOnce(store, {
          customerId,
          leadId: body.leadId ? String(body.leadId) : null,
          channel: body.channel ? String(body.channel) : 'line',
          incomingMessage: needString(body.incomingMessage, 'incomingMessage'),
          draftResponse: needString(body.draftResponse, 'draftResponse'),
          source: body.source ? String(body.source) : 'conversation-ai',
          aiModel: body.aiModel ? String(body.aiModel) : '',
          ruleRevision: body.ruleRevision ? String(body.ruleRevision) : '',
          sourceEventId: typeof body.sourceEventId === 'string' ? body.sourceEventId : null,
          metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
        }, { type: 'AI', id: '' });
        send(response, draft.deduped ? 200 : 201, { draft: presentDraft(draft), deduped: !!draft.deduped });
        return;
      }

      // GET /api/v1/drafts?status=&limit=&order= (order defaults to asc for
      // backward compatibility; the Owner Console requests order=desc).
      if (request.method === 'GET' && pathname === '/api/v1/drafts') {
        const status = url.searchParams.get('status') || 'WAITING_FOR_HUMAN';
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT);
        const order = url.searchParams.get('order') || 'asc';
        if (order !== 'asc' && order !== 'desc') throw new ValidationError('order must be asc or desc');
        const rows = await store.drafts.listByStatus(status);
        const ordered = order === 'desc' ? [...rows].reverse() : rows;
        const page = ordered.slice(0, limit);
        const drafts = [];
        for (const row of page) {
          const presented = presentDraft(row);
          presented.customer = presentCustomer(row.customerId ? await store.customers.findById(row.customerId) : null);
          drafts.push(presented);
        }
        send(response, 200, { drafts, total: rows.length, limit, order });
        return;
      }

      const draftMatch = pathname.match(/^\/api\/v1\/drafts\/([^/]+)(\/(approve|edit|reject|send))?$/);
      if (draftMatch) {
        const record = await findDraft(decodeURIComponent(draftMatch[1]));
        if (!record) throw new NotFoundError('draft not found');
        const action = draftMatch[3];

        if (request.method === 'GET' && !action) {
          const draft = presentDraft(record);
          draft.customer = presentCustomer(record.customerId ? await store.customers.findById(record.customerId) : null);
          draft.lead = record.leadId ? presentLead(await store.leads.findById(record.leadId)) : null;
          send(response, 200, { draft });
          return;
        }

        if (request.method === 'POST' && action) {
          const body = await readJsonBody(request);
          const options = {
            ownerId: body.ownerId ? String(body.ownerId) : '',
            expectedUpdatedAt: body.expectedUpdatedAt,
            expectedStatus: body.expectedStatus,
          };
          if (action === 'send') {
            // Owner-only send: the message text and recipient are ALWAYS
            // re-derived server-side from the frozen draft + linked customer.
            // Body fields beyond owner/concurrency expectations are ignored.
            try {
              const result = await sendDraft(store, record.id, options, { token: env.LINE_CHANNEL_ACCESS_TOKEN });
              send(response, 200, { draft: presentDraft(result.draft), send: result.send });
            } catch (error) {
              if (error && error.message === 'line send not configured') {
                send(response, 503, { error: 'send_not_configured' });
                return;
              }
              throw error;
            }
            return;
          }
          let next;
          if (action === 'approve') next = await approveDraft(store, record.id, options);
          else if (action === 'reject') next = await rejectDraft(store, record.id, options);
          else next = await editDraft(store, record.id, { ...options, finalText: body.finalText });
          send(response, 200, { draft: presentDraft(next) });
          return;
        }
      }

      send(response, 404, { error: 'not_found' });
    } catch (error) {
      const status = statusFor(error);
      if (status === 500) console.error(`internal api error: ${error.name}`);
      send(response, status, { error: safeMessage(error, status) });
    }
  });

  return { server };
}

async function main() {
  const env = process.env;
  const host = env.INTERNAL_API_HOST || '127.0.0.1';
  const port = Number(env.INTERNAL_API_PORT || 8788);
  if (!env.EED_INTERNAL_API_SECRET) throw new Error('EED_INTERNAL_API_SECRET is required.');
  const repos = createAdapter(env);
  // Fail closed: never accept traffic when postgres is configured but down.
  // (No silent fallback to memory/file/static staging.)
  try {
    await withTimeout(repos.ping(), 10000);
  } catch (error) {
    await repos.close?.().catch(() => {});
    throw new Error(`database not ready for adapter ${(env.DB_ADAPTER || 'memory').toLowerCase()}: ${error.message}`);
  }
  const { server } = createInternalApi({ repos, env });
  await new Promise((resolve) => server.listen(port, host, resolve));
  console.log(`Internal business API listening on http://${host}:${port} (loopback only)`);
  const shutdown = (signal) => {
    server.close(async () => {
      await repos.close?.().catch(() => {});
      process.exit(0);
    });
    // Force out if connections linger.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
