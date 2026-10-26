// EED HALAL — internal business API (Phase 4A).
// Thin HTTP layer over services/* and db/*. Handlers validate input,
// authenticate, call exactly one service, and present the result.
// No business logic, no SQL, no LINE calls, no sender, no kitchen push.
//
// Endpoints (all /api/v1 except healthz; mutations need JSON + auth):
//   GET  /healthz
//   POST /api/v1/customers/resolve { lineUserId, displayName? }
//   GET  /api/v1/customers        (all customers, bot pause state included)
//   POST /api/v1/customers/:id/bot-pause  { reason? } (owner stops the bot for
//          one customer only; actor is always OWNER)
//   POST /api/v1/customers/:id/bot-resume  (owner lets the bot reply again;
//          actor is always OWNER)
//   POST /api/v1/customers/:id/profile  { displayName, syncedAt? } (system
//          stores the LINE display name fetched by the gateway)
//   POST /api/v1/leads/evaluate    { customerId, message, context? }
//   GET  /api/v1/leads?status=     (the job funnel: counts per status)
//   POST /api/v1/leads/:id/status { status } (owner moves a lead forward)
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
//   GET  /api/v1/menus/mealbox?price=&maxPrice=&tier=&q=&limit=
//          (deterministic meal-box catalog from data/planner-overrides.json;
//          price authority. Authenticated only, never on the public gateway.)
//   POST /api/v1/quotations  { customerId, message, quoteText, sourceEventId?,
//                             quantity?, eventDate?, location?, budgetPerPerson? }
//          (A04 records a quotation: the deterministic rules create the lead,
//          the draft holds the price text the owner approves. 201, 200 on retry)
//   GET  /api/v1/quotations?status=&limit=
//   GET  /api/v1/quotations/:id
//   GET  /api/v1/broadcasts?status=&limit=        (weekly broadcast queue)
//   GET  /api/v1/broadcasts/:id
//   GET  /api/v1/broadcasts/quota                 (LINE quota + usage)
//   POST /api/v1/broadcasts/:id/approve   { finalText?, scheduledAt?, ownerId?, expectedUpdatedAt? }
//   POST /api/v1/broadcasts/:id/edit      { finalText, ownerId?, expectedUpdatedAt? }
//   POST /api/v1/broadcasts/:id/send-now  { ownerId?, expectedUpdatedAt? }
//   POST /api/v1/broadcasts/:id/postpone  { scheduledAt, ownerId?, expectedUpdatedAt? }
//   POST /api/v1/broadcasts/:id/discard   { ownerId?, expectedUpdatedAt? }
//          (Owner-approved weekly broadcast. Drafts are built ONLY by
//          tools/line/broadcast-runner.mjs via ensureWeeklyBroadcast; here
//          the owner reviews, schedules or resends. Delivered by the runner,
//          never by this server — see AGENTS.md "Sending Rules".)
//
// NOT IMPLEMENTED here: LINE sender, regenerate-with-AI, kitchen push,
// accounting. A quotation is a draft the owner approves — no PDF, no invoice,
// no payment state.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdapter } from '../db/index.mjs';
import { requireInternalAuth } from './auth.mjs';
import { presentCustomer, presentDraft, presentLead, presentInboundMessage, presentResponseExample, presentMemory, presentBroadcast } from './present.mjs';
import { receiveInboundMessage, attachCustomer, markProcessing, markFailed, completeInbound, retryInbound,
  getInboundMessage, requireInboundObject } from '../services/inboundMessages.mjs';
import { createResponseExampleFromDraft, getResponseExample, listResponseExamples,
  setResponseExampleReusable } from '../services/responseExamples.mjs';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../services/errors.mjs';
import { maybeCreateLead, setLeadStatus, leadFunnel, listLeadsByStatus } from '../services/leads.mjs';
import { decryptCustomerRow, encryptCustomerRow } from '../services/encryption.mjs';
import { closeJob, customerThread, saveOwnerMemory, upsertMemory } from '../services/customerMemory.mjs';
import { applyProfileName, pauseBot, resolveCustomer, resumeBot } from '../services/customers.mjs';
import { approveDraft, editDraft, persistDraftOnce, rejectDraft, sendDraft, autoReplyDraft } from '../services/drafts.mjs';
import { approveBroadcast, broadcastQuotaSummary, discardBroadcast, editPendingBroadcast, getBroadcast,
  listBroadcasts, postponeBroadcast, sendNowBroadcast } from '../services/broadcasts.mjs';
import { clampLimit, findMealboxMenus, MEALBOX_SERVICE_TYPE, MEALBOX_SOURCE } from '../services/menus.mjs';
import { isQuotationDraft, loadBusinessRules, QUOTATION_DRAFT_SOURCE, QUOTATION_METADATA_KEY, quotationView } from '../services/quotations.mjs';

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
            'content-security-policy': OWNER_CSP.replace("connect-src 'self'", "connect-src 'self' https://eedhalal.com")
    .replace("img-src 'self' data:", "img-src 'self' data: https://eedhalal.com"),
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

      // GET /api/v1/menus/mealbox — deterministic meal-box catalog.
      // Runtime price authority is data/planner-overrides.json (never
      // menu-data.js, prompt, or website prices; the service fails closed).
      // Authenticated Internal API only; the public LINE gateway does not
      // expose this path. EED_PLANNER_PATH may point at a fixture file in
      // tests; production uses the repo planner file.
      if (request.method === 'GET' && pathname === '/api/v1/menus/mealbox') {
        const parsePriceFilter = (raw, field) => {
          if (raw === null || raw.trim() === '') return null;
          if (!/^\d+(\.\d+)?$/.test(raw.trim())) throw new ValidationError(`invalid ${field}`);
          const value = Number(raw.trim());
          if (!Number.isFinite(value) || value <= 0) throw new ValidationError(`invalid ${field}`);
          return value;
        };
        const price = parsePriceFilter(url.searchParams.get('price'), 'price');
        const maxPrice = parsePriceFilter(url.searchParams.get('maxPrice'), 'maxPrice');
        const rawTier = url.searchParams.get('tier');
        const tier = rawTier === null || rawTier.trim() === '' ? null : rawTier.trim();
        const rawQuery = url.searchParams.get('q');
        const normalizedQuery = rawQuery === null ? '' : rawQuery.replace(/\s+/g, ' ').trim();
        const q = normalizedQuery === '' ? null : normalizedQuery;
        const limit = clampLimit(url.searchParams.get('limit'));
        const plannerPath = typeof env.EED_PLANNER_PATH === 'string' && env.EED_PLANNER_PATH.trim()
          ? env.EED_PLANNER_PATH.trim()
          : undefined;
        const menus = await findMealboxMenus({
          exactPrice: price,
          maxPrice,
          tier,
          query: q,
          limit,
          plannerPath,
        });
        send(response, 200, {
          serviceType: MEALBOX_SERVICE_TYPE,
          source: MEALBOX_SOURCE,
          filters: { price, maxPrice, tier, q, limit },
          menus,
        });
        return;
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

      // GET /api/v1/customers — every customer, so the Owner Console can list
      // who currently has the auto-reply bot paused (botPausedAt set).
      if (request.method === 'GET' && pathname === '/api/v1/customers') {
        const rows = await store.customers.list();
        send(response, 200, { customers: rows.map((row) => presentCustomer(decryptCustomerRow(row))), total: rows.length });
        return;
      }

      // POST /api/v1/customers/:id/bot-pause | bot-resume — the owner presses
      // the button, so the audit actor is always OWNER (never SYSTEM/AI).
      const botControlMatch = pathname.match(/^\/api\/v1\/customers\/([^/]+)\/(bot-pause|bot-resume)$/);
      if (botControlMatch && request.method === 'POST') {
        const customerId = decodeURIComponent(botControlMatch[1]);
        const body = await readJsonBody(request);
        const actor = { type: 'OWNER', id: body.ownerId ? String(body.ownerId) : '' };
        const customer = botControlMatch[2] === 'bot-pause'
          ? await pauseBot(store, { customerId, reason: body.reason ? String(body.reason) : '' }, actor)
          : await resumeBot(store, { customerId }, actor);
        send(response, 200, { customer: presentCustomer(customer) });
        return;
      }

      // POST /api/v1/customers/:id/profile — store the LINE display name that
      // the gateway (or the backfill script) fetched. Called by the system, not
      // by the owner, so the actor is SYSTEM.
      const profileMatch = pathname.match(/^\/api\/v1\/customers\/([^/]+)\/profile$/);
      if (profileMatch && request.method === 'POST') {
        const customerId = decodeURIComponent(profileMatch[1]);
        const body = await readJsonBody(request);
        const customer = await applyProfileName(store, {
          customerId,
          displayName: needString(body.displayName, 'displayName'),
          syncedAt: body.syncedAt ? String(body.syncedAt) : null,
        }, { type: 'SYSTEM', id: 'line-profile' });
        send(response, 200, { customer: presentCustomer(customer) });
        return;
      }

      // GET /api/v1/customers/:id — one customer with everything the owner
      // needs: profile, memory (what the bot remembers) and open leads.
      const customerDetailMatch = pathname.match(/^\/api\/v1\/customers\/([^/]+)$/);
      if (customerDetailMatch && request.method === 'GET') {
        const customerId = decodeURIComponent(customerDetailMatch[1]);
        const customer = await store.customers.findById(customerId);
        if (!customer) throw new NotFoundError('customer not found');
        const memory = await store.customerMemories.findByCustomerId(customerId);
        const leads = await store.leads.listByCustomer(customerId);
        send(response, 200, {
          customer: presentCustomer(decryptCustomerRow(customer)),
          memory: presentMemory(memory),
          leads: leads.map((lead) => presentLead(lead)),
        });
        return;
      }

      // GET /api/v1/customers/:id/thread — the whole conversation of one
      // customer, oldest first: every message the customer sent and every
      // answer the shop gave, including the ones that never became a draft.
      const threadMatch = pathname.match(/^\/api\/v1\/customers\/([^/]+)\/thread$/);
      if (threadMatch && request.method === 'GET') {
        const customerId = decodeURIComponent(threadMatch[1]);
        const customer = await store.customers.findById(customerId);
        if (!customer) throw new NotFoundError('customer not found');
        const memory = await store.customerMemories.findByCustomerId(customerId);
        const thread = await customerThread(store, customerId);
        const leads = await store.leads.listByCustomer(customerId);
        send(response, 200, {
          customer: presentCustomer(decryptCustomerRow(customer)),
          memory: presentMemory(memory),
          leads: leads.map((lead) => presentLead(lead)),
          messages: thread.messages,
          drafts: thread.drafts.map((draft) => presentDraft(draft)),
        });
        return;
      }

      // GET|PATCH /api/v1/customers/:id/memory — what the bot remembers about
      // this customer. The owner may correct it; the bot never overwrites a
      // summary the owner wrote.
      const memoryMatch = pathname.match(/^\/api\/v1\/customers\/([^/]+)\/memory$/);
      if (memoryMatch && (request.method === 'GET' || request.method === 'PATCH')) {
        const customerId = decodeURIComponent(memoryMatch[1]);
        const customer = await store.customers.findById(customerId);
        if (!customer) throw new NotFoundError('customer not found');
        if (request.method === 'GET') {
          const memory = await store.customerMemories.findByCustomerId(customerId);
          send(response, 200, { memory: presentMemory(memory) });
          return;
        }
        const body = await readJsonBody(request);
        const actor = { type: 'OWNER', id: body.ownerId ? String(body.ownerId) : '' };
        const memory = await saveOwnerMemory(store, {
          customerId,
          summary: body.summary !== undefined ? String(body.summary) : undefined,
          facts: body.facts && typeof body.facts === 'object' ? body.facts : undefined,
          actor,
        });
        send(response, 200, { memory: presentMemory(memory) });
        return;
      }

      // POST /api/v1/customers/:id/memory/close — the running job is done:
      // the situation moves into the history and the next message starts fresh.
      const closeMatch = pathname.match(/^\/api\/v1\/customers\/([^/]+)\/memory\/close$/);
      if (closeMatch && request.method === 'POST') {
        const customerId = decodeURIComponent(closeMatch[1]);
        const body = await readJsonBody(request);
        const actor = { type: 'OWNER', id: body.ownerId ? String(body.ownerId) : '' };
        const memory = await closeJob(store, { customerId, actor, note: body.note ? String(body.note) : '' });
        send(response, 200, { memory: presentMemory(memory) });
        return;
      }

      // PATCH /api/v1/customers/:id — the owner confirms the customer details
      // (company, phone, tax id, address). These are the facts the bot may
      // never overwrite with a guess.
      const customerPatchMatch = pathname.match(/^\/api\/v1\/customers\/([^/]+)$/);
      if (customerPatchMatch && request.method === 'PATCH') {
        const customerId = decodeURIComponent(customerPatchMatch[1]);
        const body = await readJsonBody(request);
        const patch = {};
        const map = {
          displayName: 'displayName', phone: 'phone', email: 'email', companyName: 'companyName',
          taxId: 'taxId', address: 'address', notes: 'notes',
        };
        for (const [key, field] of Object.entries(map)) {
          if (body[key] !== undefined) patch[field] = body[key] === null ? null : String(body[key]);
        }
        const customer = await store.customers.update(customerId, encryptCustomerRow(patch));
        if (!customer) throw new NotFoundError('customer not found');
        send(response, 200, { customer: presentCustomer(decryptCustomerRow(customer)) });
        return;
      }

      // POST /api/v1/customers/:id/memory/observe — the bot records what
      // the customer's message said. The message is the authority for the
      // facts; the summary may be written by the model.
      const observeMatch = pathname.match(/^\/api\/v1\/customers\/([^/]+)\/memory\/observe$/);
      if (observeMatch && request.method === 'POST') {
        const customerId = decodeURIComponent(observeMatch[1]);
        const customer = await store.customers.findById(customerId);
        if (!customer) throw new NotFoundError('customer not found');
        const body = await readJsonBody(request);
        const result = await upsertMemory(store, {
          customerId,
          customer,
          message: body.message ? String(body.message) : '',
          summary: body.summary ? String(body.summary) : '',
          source: body.source ? String(body.source) : 'rule',
          ruleRevision: body.ruleRevision ? String(body.ruleRevision) : '',
          actor: { type: 'SYSTEM', id: 'line-gateway' },
        });
        send(response, 200, { memory: presentMemory(result.memory), changed: result.changed });
        return;
      }

      // POST /api/v1/leads/:id/status — the owner moves a lead forward.
      // The rules never move a lead on their own: only the owner decides
      // that a job is qualified, won or lost.
      const leadStatusMatch = pathname.match(/^\/api\/v1\/leads\/([^/]+)\/status$/);
      if (leadStatusMatch && request.method === 'POST') {
        const leadId = decodeURIComponent(leadStatusMatch[1]);
        const body = await readJsonBody(request);
        const to = needString(body.status, 'status');
        const lead = await setLeadStatus(store, leadId, to, { type: 'OWNER', id: body.ownerId ? String(body.ownerId) : '' });
        send(response, 200, { lead: presentLead(lead) });
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
      // Optional customerId= filters to one customer's conversation history,
      // used by the LINE reply worker to give the AI conversation context.
      if (request.method === 'GET' && pathname === '/api/v1/drafts') {
        const status = url.searchParams.get('status') || 'WAITING_FOR_HUMAN';
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT);
        const order = url.searchParams.get('order') || 'asc';
        if (order !== 'asc' && order !== 'desc') throw new ValidationError('order must be asc or desc');
        const customerId = url.searchParams.get('customerId');
        if (customerId !== null) {
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId.trim())) {
            throw new ValidationError('invalid customerId');
          }
        }
        const rows = customerId !== null
          ? await store.drafts.listByCustomer(customerId.trim())
          : await store.drafts.listByStatus(status);
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

      const draftMatch = pathname.match(/^\/api\/v1\/drafts\/([^/]+)(\/(approve|edit|reject|send|auto-reply))?$/);
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
              // A reply the owner rewrote is the answer we want next time. Store
              // it as an example automatically so the bot can reuse the wording.
              // Never let this fail the send that already succeeded.
              let learned = null;
              try {
                const saved = await createResponseExampleFromDraft(store, record.id, { ownerId: options.ownerId });
                learned = { saved: true, id: saved.example?.id ?? null, deduped: Boolean(saved.deduped) };
              } catch (error) {
                learned = { saved: false, reason: error?.code === 'example_requires_review' ? 'needs_review' : (error?.message || 'skipped') };
              }
              send(response, 200, { draft: presentDraft(result.draft), send: result.send, learned });
            } catch (error) {
              if (error && error.message === 'line send not configured') {
                send(response, 503, { error: 'send_not_configured' });
                return;
              }
              throw error;
            }
            return;
          }
          if (action === 'auto-reply') {
            // Gateway-only auto-reply: the replyToken arrives in the body and
            // is used in-memory once, never persisted. Fails closed when the
            // LINE token is unset. The shop does not auto-send today, so the
            // gateway never calls this route — see AGENTS.md.
            try {
              const result = await autoReplyDraft(store, record.id, {
                replyToken: typeof body.replyToken === 'string' ? body.replyToken : '',
                expectedStatus: body.expectedStatus,
              }, { token: env.LINE_CHANNEL_ACCESS_TOKEN });
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

      // GET /api/v1/leads — the job funnel: how many jobs sit in each status.
      // The owner moves a lead; this route only reads.
      if (request.method === 'GET' && pathname === '/api/v1/leads') {
        const status = url.searchParams.get('status');
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT);
        const counts = await leadFunnel(store);
        if (status) {
          const rows = await listLeadsByStatus(store, status, { limit });
          send(response, 200, { leads: rows.map((lead) => presentLead(lead)), counts, status, total: counts[status] ?? 0 });
          return;
        }
        send(response, 200, { leads: [], counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0) });
        return;
      }

      // Quotation queue (A04). A quotation is the pair the shop already keeps:
      // a lead with the structured job data + the draft holding the price text
      // the owner approves. No new table, no automatic send, no price maths
      // here — the menu catalogue owns prices.
      if (request.method === 'POST' && pathname === '/api/v1/quotations') {
        const body = await readJsonBody(request);
        const customerId = needString(body.customerId, 'customerId');
        const customer = await store.customers.findById(customerId);
        if (!customer) throw new NotFoundError(`customer not found: ${customerId}`);
        const message = needString(body.message, 'message');
        const quoteText = needString(body.quoteText, 'quoteText');
        const sourceEventId = typeof body.sourceEventId === 'string' ? body.sourceEventId : null;
        // The lead comes from the deterministic rules, never from the model.
        const { lead } = await maybeCreateLead(store, {
          customerId,
          message,
          sourceEventId,
          actor: { type: 'AI', id: 'quotation' },
        });
        // The lead holds the rule-extracted job data; explicit fields from the
        // caller only fill what the rules could not read.
        const structured = {
          quantity: body.quantity == null ? (lead?.quantity ?? null) : Number(body.quantity),
          eventDate: body.eventDate || lead?.eventDate || null,
          location: body.location || lead?.location || null,
          budgetPerPerson: body.budgetPerPerson == null ? (lead?.budgetPerPerson ?? null) : Number(body.budgetPerPerson),
          serviceType: body.serviceType || lead?.serviceType || null,
        };
        const draft = await persistDraftOnce(store, {
          customerId,
          leadId: lead?.id || null,
          channel: 'line',
          incomingMessage: message,
          draftResponse: quoteText,
          source: QUOTATION_DRAFT_SOURCE,
          aiModel: 'opencode-agent',
          metadata: { [QUOTATION_METADATA_KEY]: structured, writtenBy: 'opencode-agent' },
          ...(sourceEventId ? { sourceEventId } : {}),
        }, { type: 'AI', id: 'A04' });
        const rules = await loadBusinessRules();
        send(response, draft.deduped ? 200 : 201, {
          quotation: quotationView({ draft, lead, customer, rules }),
          draft: presentDraft(draft),
          lead: lead ? presentLead(lead) : null,
          deduped: !!draft.deduped,
        });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/v1/quotations') {
        const status = url.searchParams.get('status') || 'WAITING_FOR_HUMAN';
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT);
        const rows = await store.drafts.listByStatus(status);
        const rules = await loadBusinessRules();
        const quotations = [];
        for (const row of rows) {
          if (!isQuotationDraft(row)) continue;
          const lead = row.leadId ? await store.leads.findById(row.leadId) : null;
          const customer = row.customerId ? await store.customers.findById(row.customerId) : null;
          quotations.push(quotationView({ draft: row, lead, customer, rules }));
          if (quotations.length >= limit) break;
        }
        send(response, 200, { quotations, total: quotations.length, limit, status });
        return;
      }

      const quotationMatch = pathname.match(/^\/api\/v1\/quotations\/([^/]+)$/);
      if (quotationMatch && request.method === 'GET') {
        const record = await findDraft(decodeURIComponent(quotationMatch[1]));
        if (!record || !isQuotationDraft(record)) throw new NotFoundError('quotation not found');
        const lead = record.leadId ? await store.leads.findById(record.leadId) : null;
        const customer = record.customerId ? await store.customers.findById(record.customerId) : null;
        const rules = await loadBusinessRules();
        send(response, 200, { quotation: quotationView({ draft: record, lead, customer, rules }) });
        return;
      }

      // Broadcast (กระจายข้อมูลรายสัปดาห์) — ร่างระบบสร้างจากข้อมูลจริง เจ้าของ
      // กดอนุมัติก่อนเสมอ แล้วตัวรันนอกชั้นเซิร์ฟเวอร์ (tools/line/
      // broadcast-runner.mjs) ค่อยส่งตามเวลา ไม่มีหน้าสร้างร่างผ่าน HTTP:
      // คิวรายสัปดาห์เป็นของตัวรัน หน้านี้เป็นหน้าตัดสินใจของเจ้าของเท่านั้น
      if (request.method === 'GET' && pathname === '/api/v1/broadcasts/quota') {
        const summary = await broadcastQuotaSummary({ token: env.LINE_CHANNEL_ACCESS_TOKEN });
        send(response, summary.ok ? 200 : 503, summary.ok ? { quota: summary } : { error: 'quota_unavailable', code: summary.code });
        return;
      }
      if (request.method === 'GET' && pathname === '/api/v1/broadcasts') {
        const status = url.searchParams.get('status');
        if (status && !['PENDING_REVIEW', 'SCHEDULED', 'SENT', 'FAILED', 'MISSED', 'CANCELLED'].includes(status)) {
          throw new ValidationError('invalid status');
        }
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT);
        const rows = await listBroadcasts(store, { status: status || undefined, limit });
        send(response, 200, { broadcasts: rows.map((row) => presentBroadcast(row)), total: rows.length, limit });
        return;
      }
      if (request.method === 'GET' && pathname.startsWith('/api/v1/broadcasts/')) {
        const id = decodeURIComponent(pathname.slice('/api/v1/broadcasts/'.length));
        send(response, 200, { broadcast: presentBroadcast(await getBroadcast(store, id)) });
        return;
      }
      const broadcastMatch = pathname.match(/^\/api\/v1\/broadcasts\/([^/]+)\/(approve|edit|send-now|postpone|discard)$/);
      if (broadcastMatch && request.method === 'POST') {
        const recordId = decodeURIComponent(broadcastMatch[1]);
        const action = broadcastMatch[2];
        const body = await readJsonBody(request);
        const options = {
          ownerId: body.ownerId ? String(body.ownerId) : '',
          expectedUpdatedAt: body.expectedUpdatedAt,
        };
        let broadcast;
        if (action === 'approve') {
          broadcast = await approveBroadcast(store, recordId, { ...options, finalText: body.finalText, scheduledAt: body.scheduledAt });
        } else if (action === 'edit') {
          broadcast = await editPendingBroadcast(store, recordId, { ...options, finalText: needString(body.finalText, 'finalText') });
        } else if (action === 'send-now') {
          broadcast = await sendNowBroadcast(store, recordId, options);
        } else if (action === 'postpone') {
          broadcast = await postponeBroadcast(store, recordId, { ...options, scheduledAt: needString(body.scheduledAt, 'scheduledAt') });
        } else {
          broadcast = await discardBroadcast(store, recordId, options);
        }
        send(response, 200, { broadcast: presentBroadcast(broadcast) });
        return;
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
