'use strict';
// EED HALAL Owner Console (local only, same-origin).
// The API secret lives in the `secret` variable below — page memory only.
// It is never written to localStorage, sessionStorage, cookies, the URL,
// HTML attributes, or logs. Locking or refreshing clears it.
//
// All dynamic customer/AI text renders via textContent/value only — never
// innerHTML, insertAdjacentHTML, eval, or new Function.

let secret = null;
let currentDraft = null;
let pending = false;
let stale = false;

const $ = (id) => document.getElementById(id);

function fmtTime(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  } catch {
    return String(value);
  }
}

function setButtonsDisabled(disabled) {
  for (const id of ['btn-save', 'btn-send', 'btn-reject', 'btn-send-confirm', 'nav-refresh']) {
    const el = $(id);
    if (el) el.disabled = disabled;
  }
}

async function api(path, method, body) {
  const response = await fetch(path, {
    method: method || 'GET',
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) {
    lock('Session expired or secret rejected. Unlock again.');
    const error = new Error('unauthorized');
    error.locked = true;
    throw error;
  }
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  if (!response.ok) {
    const error = new Error((json && json.error) || `request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return json;
}

function showView(name) {
  for (const view of ['unlock', 'queue', 'review', 'examples']) {
    $(`view-${view}`).hidden = view !== name;
  }
  const loggedIn = name !== 'unlock';
  for (const id of ['nav-queue', 'nav-sent', 'nav-examples', 'nav-refresh', 'nav-lock']) {
    $(id).hidden = !loggedIn;
  }
}

function lock(message) {
  secret = null;
  currentDraft = null;
  pending = false;
  $('secret-input').value = '';
  $('unlock-error').textContent = message || '';
  $('queue-list').textContent = '';
  $('queue-status').textContent = '';
  showView('unlock');
}

function customerName(customer) {
  if (!customer) return '(unknown customer)';
  return customer.displayName || customer.companyName || customer.lineUserId || '(unknown customer)';
}

function addRow(list, term, value) {
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = value == null || value === '' ? '—' : String(value);
  list.appendChild(dd);
  list.insertBefore(dt, dd);
}

let currentTab = 'WAITING_FOR_HUMAN';

async function loadQueue(status) {
  const want = status || currentTab;
  currentTab = want;
  const isSent = want === 'SENT';
  $('queue-title').childNodes[0].textContent = isSent ? 'Sent ' : 'Waiting for human ';
  const statusEl = $('queue-status');
  const list = $('queue-list');
  statusEl.textContent = 'Loading…';
  list.textContent = '';
  let data;
  try {
    data = await api(`/api/v1/drafts?status=${want}&limit=100&order=desc`);
  } catch (error) {
    if (error.locked) return;
    statusEl.textContent = 'Could not load the queue. Check the server and retry.';
    return;
  }
  const drafts = data.drafts || [];
  $('queue-count').textContent = `(${data.total || drafts.length})`;
  if (!drafts.length) {
    statusEl.textContent = isSent ? 'No sent drafts' : 'No drafts waiting';
    return;
  }
  statusEl.textContent = '';
  for (const draft of drafts) {
    const card = document.createElement('div');
    card.className = 'card';
    const title = document.createElement('strong');
    title.textContent = draft.draftId || draft.id;
    card.appendChild(title);
    const who = document.createElement('div');
    who.textContent = customerName(draft.customer);
    card.appendChild(who);
    const preview = document.createElement('div');
    preview.className = 'prewrap';
    preview.textContent = (draft.incomingMessage || '').slice(0, 160);
    card.appendChild(preview);
    const meta = document.createElement('div');
    meta.textContent = `${fmtTime(draft.createdAt)} · ${draft.status || ''}`;
    card.appendChild(meta);
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'Open';
    open.addEventListener('click', () => openDraft(draft.id));
    card.appendChild(open);
    list.appendChild(card);
  }
}

function setMutationButtons(draft) {
  const terminal = draft.status === 'SENT' || draft.status === 'REJECTED';
  const failed = draft.status === 'FAILED';
  const approved = draft.status === 'APPROVED';
  $('btn-save').disabled = pending || terminal || failed || approved;
  $('btn-send').disabled = pending || terminal;
  $('btn-reject').disabled = pending || terminal;
  $('review-final').disabled = pending || terminal || failed || approved;
}

function renderReview(draft, customer, lead) {
  currentDraft = { draft, customer, lead };
  stale = false;
  $('review-draft-id').textContent = draft.draftId || draft.id;
  $('review-incoming').textContent = draft.incomingMessage || '';
  $('review-ai').textContent = draft.draftResponse || '';
  const final = $('review-final');
  final.value = draft.ownerFinalResponse || draft.draftResponse || '';
  const attention = $('review-attention');
  attention.hidden = true;
  attention.textContent = '';
  const attempt = draft.metadata && draft.metadata.sendAttempt;
  if (draft.status === 'APPROVED' && attempt) {
    attention.hidden = false;
    attention.textContent = 'Previous send result is uncertain / awaiting retry. ' +
      'Retry Same Send reuses the same frozen message, recipient, and server-side retry key. ' +
      'The content cannot be edited while approval is pending.';
    $('btn-send').textContent = 'Retry Same Send';
  } else {
    $('btn-send').textContent = 'Send to LINE';
  }
  const clist = $('review-customer');
  clist.textContent = '';
  addRow(clist, 'Name', customerName(customer));
  if (customer && customer.companyName) addRow(clist, 'Company', customer.companyName);
  const mlist = $('review-meta');
  mlist.textContent = '';
  addRow(mlist, 'Status', draft.status);
  addRow(mlist, 'Created', fmtTime(draft.createdAt));
  addRow(mlist, 'Updated', fmtTime(draft.updatedAt));
  addRow(mlist, 'Source', draft.source);
  addRow(mlist, 'Model', draft.aiModel);
  addRow(mlist, 'Rule revision', draft.ruleRevision);
  if (draft.status === 'SENT') addRow(mlist, 'Sent at', fmtTime(draft.sentAt));
  const wrap = $('review-lead-wrap');
  const llist = $('review-lead');
  llist.textContent = '';
  if (lead) {
    wrap.hidden = false;
    addRow(llist, 'Service', lead.serviceType);
    addRow(llist, 'Quantity', lead.quantity);
    addRow(llist, 'Location', lead.location);
    addRow(llist, 'Budget', lead.budgetPerPerson);
    addRow(llist, 'Status', lead.status);
  } else {
    wrap.hidden = true;
  }
  $('send-confirm').hidden = true;
  setMutationButtons(draft);
  renderLearnSection(draft);
}

function renderLearnSection(draft) {
  const wrap = $('review-learn');
  const btn = $('btn-learn');
  const statusEl = $('learn-status');
  const detail = $('learn-detail');
  detail.textContent = '';
  if (draft.status === 'SENT') {
    wrap.hidden = false;
    btn.disabled = pending;
    btn.textContent = 'ใช้คำตอบนี้เป็นตัวอย่างในอนาคต';
    if (!statusEl.dataset.touched) statusEl.textContent = '';
  } else {
    wrap.hidden = true;
    btn.disabled = true;
  }
}

function learnDetailRow(term, value) {
  const dl = $('learn-detail');
  let list = dl.querySelector('dl');
  if (!list) {
    list = document.createElement('dl');
    dl.appendChild(list);
  }
  addRow(list, term, value);
}

async function learnExample() {
  if (!currentDraft || pending) return;
  const draft = currentDraft.draft;
  if (draft.status !== 'SENT') return;
  if (!window.confirm('ใช้คำตอบนี้เป็นตัวอย่างสำหรับการตอบครั้งต่อไปหรือไม่?\n\nระบบจะนำรูปแบบการตอบไปใช้เป็นตัวอย่าง แต่จะไม่ใช้คำตอบนี้แทนข้อมูลราคา/กฎธุรกิจปัจจุบัน')) return;
  pending = true;
  $('btn-learn').disabled = true;
  const statusEl = $('learn-status');
  statusEl.dataset.touched = '1';
  statusEl.textContent = 'Saving…';
  $('learn-detail').textContent = '';
  try {
    const data = await api(`/api/v1/response-examples/from-draft/${encodeURIComponent(draft.id)}`, 'POST', {});
    const example = data.example || {};
    if (data.deduped) {
      statusEl.textContent = 'คำตอบนี้เป็นตัวอย่างอยู่แล้ว';
    } else {
      statusEl.textContent = 'บันทึกเป็นตัวอย่างแล้ว';
    }
    learnDetailRow('Intent', example.intent);
    learnDetailRow('Service', example.serviceType);
    learnDetailRow('Reusable', String(example.reusable));
    learnDetailRow('Rules revision', example.businessRulesRevision);
    if (example.staleRules) {
      learnDetailRow('Warning', 'ตัวอย่างนี้สร้างจากกฎธุรกิจเวอร์ชันเก่า');
    }
  } catch (error) {
    if (error.locked) return;
    if (error.message && /example_requires_review/i.test(error.message)) {
      statusEl.textContent = 'คำตอบนี้มีข้อมูลเฉพาะลูกค้า/ราคา/เงื่อนไขที่ไม่ควรนำไปใช้เป็นตัวอย่างอัตโนมัติ';
      $('btn-learn').disabled = false;
    } else if (error.status === 409) {
      statusEl.textContent = 'This draft changed. Reload before continuing.';
      stale = true;
      setButtonsDisabled(true);
    } else {
      statusEl.textContent = `Could not save example: ${error.message}`;
      $('btn-learn').disabled = false;
    }
  } finally {
    pending = false;
  }
}

async function openDraft(id) {
  $('review-status').textContent = 'Loading…';
  showView('review');
  let data;
  try {
    data = await api(`/api/v1/drafts/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error.locked) return;
    $('review-status').textContent = 'Could not open the draft.';
    return;
  }
  $('review-status').textContent = '';
  renderReview(data.draft, data.draft.customer || null, data.draft.lead || null);
}

function concurrencyOf(draft) {
  return { expectedUpdatedAt: draft.updatedAt, expectedStatus: draft.status };
}

function staleGuard(error) {
  if (error && error.status === 409) {
    $('review-status').textContent = 'This draft changed. Reload before continuing.';
    stale = true;
    setButtonsDisabled(true);
    return true;
  }
  return false;
}

async function saveEdit() {
  if (!currentDraft || pending) return;
  pending = true;
  setMutationButtons(currentDraft.draft);
  $('review-status').textContent = 'Saving…';
  try {
    const data = await api(`/api/v1/drafts/${encodeURIComponent(currentDraft.draft.id)}/edit`, 'POST', {
      ...concurrencyOf(currentDraft.draft),
      finalText: $('review-final').value,
    });
    renderReview(data.draft, data.draft.customer || currentDraft.customer, data.draft.lead ?? currentDraft.lead);
    $('review-status').textContent = 'Edit saved. Status is now EDITED.';
  } catch (error) {
    if (error.locked) return;
    if (!staleGuard(error)) $('review-status').textContent = `Save failed: ${error.message}`;
  } finally {
    pending = false;
    if (currentDraft && !stale) setMutationButtons(currentDraft.draft);
  }
}

async function rejectDraft() {
  if (!currentDraft || pending) return;
  if (!window.confirm('Reject this draft? No message will be sent.')) return;
  pending = true;
  setMutationButtons(currentDraft.draft);
  $('review-status').textContent = 'Rejecting…';
  try {
    const data = await api(`/api/v1/drafts/${encodeURIComponent(currentDraft.draft.id)}/reject`, 'POST', concurrencyOf(currentDraft.draft));
    renderReview(data.draft, data.draft.customer || currentDraft.customer, data.draft.lead ?? currentDraft.lead);
    $('review-status').textContent = 'Rejected. No message was sent.';
  } catch (error) {
    if (error.locked) return;
    if (!staleGuard(error)) $('review-status').textContent = `Reject failed: ${error.message}`;
  } finally {
    pending = false;
    if (currentDraft && !stale) setMutationButtons(currentDraft.draft);
  }
}

function openSendConfirm() {
  if (!currentDraft || pending) return;
  $('send-confirm-name').textContent = customerName(currentDraft.customer);
  $('send-confirm-preview').textContent = $('review-final').value;
  $('send-confirm').hidden = false;
}

async function confirmSend() {
  if (!currentDraft || pending) return;
  $('send-confirm').hidden = true;
  pending = true;
  setMutationButtons(currentDraft.draft);
  $('review-status').textContent = 'Sending…';
  try {
    // Only identity + concurrency travel to the server. The message text,
    // recipient, and retry key are always re-derived server-side.
    const data = await api(`/api/v1/drafts/${encodeURIComponent(currentDraft.draft.id)}/send`, 'POST', concurrencyOf(currentDraft.draft));
    renderReview(data.draft, data.draft.customer || currentDraft.customer, data.draft.lead ?? currentDraft.lead);
    const outcome = data.send && data.send.outcome;
    if (data.draft.status === 'SENT') {
      $('review-status').textContent = 'Sent to LINE.';
    } else if (outcome === 'RETRYABLE_FAILURE') {
      $('review-status').textContent = 'Delivery result is uncertain. Do not create a new message. Use Retry Same Send only after reviewing the status.';
    } else if (data.draft.status === 'FAILED') {
      $('review-status').textContent = `Send failed (${(data.send && data.send.code) || 'not accepted'}). The customer was not notified.`;
    } else {
      $('review-status').textContent = `Send finished with status ${data.draft.status}.`;
    }
  } catch (error) {
    if (error.locked) return;
    if (error.status === 503 || (error.message && /not configured/i.test(error.message))) {
      $('review-status').textContent = 'LINE sending is not configured on this server yet.';
    } else if (!staleGuard(error)) {
      $('review-status').textContent = `Send failed: ${error.message}`;
    }
  } finally {
    pending = false;
    if (currentDraft && !stale) setMutationButtons(currentDraft.draft);
  }
}

async function unlock(event) {
  event.preventDefault();
  const input = $('secret-input');
  secret = input.value;
  input.value = '';
  $('unlock-error').textContent = '';
  try {
    await api('/api/v1/drafts?status=WAITING_FOR_HUMAN&limit=1&order=desc');
  } catch (error) {
    if (error.locked) return;
    $('unlock-error').textContent = 'Cannot reach the server. Check that it is running and retry.';
    secret = null;
    return;
  }
  showView('queue');
  await loadQueue('WAITING_FOR_HUMAN');
}

async function loadExamples() {
  const statusEl = $('examples-status');
  const list = $('examples-list');
  statusEl.textContent = 'Loading…';
  list.textContent = '';
  let data;
  try {
    data = await api('/api/v1/response-examples?limit=100');
  } catch (error) {
    if (error.locked) return;
    statusEl.textContent = 'Could not load examples. Check the server and retry.';
    return;
  }
  const examples = data.examples || [];
  if (!examples.length) {
    statusEl.textContent = 'No learning examples yet. Open a SENT draft to save one.';
    return;
  }
  statusEl.textContent = '';
  for (const example of examples) {
    const card = document.createElement('div');
    card.className = 'card';
    const title = document.createElement('strong');
    title.textContent = `${example.intent || 'general'}${example.serviceType ? ` · ${example.serviceType}` : ''}`;
    card.appendChild(title);
    const state = document.createElement('div');
    state.textContent = example.reusable ? 'Reusable' : 'Disabled';
    card.appendChild(state);
    const incoming = document.createElement('div');
    incoming.className = 'prewrap';
    incoming.textContent = example.incomingExample || '';
    card.appendChild(incoming);
    const approved = document.createElement('div');
    approved.className = 'prewrap';
    approved.textContent = example.approvedResponse || '';
    card.appendChild(approved);
    const meta = document.createElement('div');
    let metaText = `Rules: ${example.businessRulesRevision || 'unknown'} · ${fmtTime(example.createdAt)}`;
    if (example.staleRules) metaText += ' · ตัวอย่างนี้สร้างจากกฎธุรกิจเวอร์ชันเก่า';
    meta.textContent = metaText;
    card.appendChild(meta);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = example.reusable ? 'Disable example' : 'Enable example';
    toggle.addEventListener('click', () => toggleExample(example, toggle));
    card.appendChild(toggle);
    list.appendChild(card);
  }
}

async function toggleExample(example, button) {
  if (pending) return;
  const toReusable = !example.reusable;
  if (!window.confirm(toReusable ? 'Enable this example for future responses?' : 'Disable this example? It will no longer be used.')) return;
  pending = true;
  button.disabled = true;
  try {
    await api(`/api/v1/response-examples/${encodeURIComponent(example.id)}`, 'PATCH', { reusable: toReusable });
    await loadExamples();
  } catch (error) {
    if (error.locked) return;
    $('examples-status').textContent = `Update failed: ${error.message}`;
    button.disabled = false;
  } finally {
    pending = false;
  }
}

document.getElementById('unlock-form').addEventListener('submit', unlock);
document.getElementById('nav-queue').addEventListener('click', () => { showView('queue'); loadQueue('WAITING_FOR_HUMAN'); });
document.getElementById('nav-sent').addEventListener('click', () => { showView('queue'); loadQueue('SENT'); });
document.getElementById('nav-examples').addEventListener('click', () => { showView('examples'); loadExamples(); });
document.getElementById('nav-refresh').addEventListener('click', () => {
  if (!$('view-examples').hidden) loadExamples();
  else if ($('view-review').hidden) loadQueue();
  else if (currentDraft) openDraft(currentDraft.draft.id);
});
document.getElementById('nav-lock').addEventListener('click', () => lock(''));
document.getElementById('back-queue').addEventListener('click', () => { showView('queue'); loadQueue(); });
document.getElementById('btn-save').addEventListener('click', saveEdit);
document.getElementById('btn-reject').addEventListener('click', rejectDraft);
document.getElementById('btn-send').addEventListener('click', openSendConfirm);
document.getElementById('btn-send-confirm').addEventListener('click', confirmSend);
document.getElementById('btn-send-cancel').addEventListener('click', () => { $('send-confirm').hidden = true; });
document.getElementById('btn-learn').addEventListener('click', learnExample);
showView('unlock');
