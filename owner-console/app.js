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
// Bot pause state of the customer shown in the review screen, plus a short
// Thai message kept for the next render of the paused list (so a resume
// success message is not wiped out by the reload).
let currentBotCustomer = null;
let pausedNotice = '';
// Thai copy for the bot switch (same salesperson voice as the rest of the page).
const BOT_PAUSE_PROMPT = 'หยุดตอบอัตโนมัติให้ลูกค้าคนนี้ชั่วคราว เพราะอะไรครับ?\nเช่น กำลังคุยกับลูกค้าเองอยู่ / ลูกค้าขอคุยกับพนักงาน';
const BOT_PAUSED_NOTE = 'หยุดตอบอัตโนมัติให้แล้ว ลูกค้าคนนี้จะไม่ได้รับคำตอบอัตโนมัติจนกว่าจะเปิดตอบอัตโนมัติ';
const BOT_RESUMED_NOTE = 'เปิดตอบอัตโนมัติให้แล้ว บอทตอบลูกค้าคนนี้ตามปกติ';

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
    lock('การใช้งานหมดอายุหรือกุญแจไม่ถูกต้องครับ กรุณาใส่กุญแจใหม่อีกครั้ง');
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

function isMediaIncoming(text) {
  return /^\[ลูกค้าส่ง/.test(String(text || '').trim());
}

function isMediaRequest(text) {
  return /(ขอรูป|ขอไฟล์|ขอนำรูป|ขอนำไฟล์|ขอรูปภาพ|ขอภาพ)/.test(String(text || ''));
}
function showView(name) {
  for (const view of ['unlock', 'queue', 'review', 'examples', 'paused', 'customers', 'customer']) {
    const view = $(`view-${view}`);
    if (view) view.hidden = view.id !== `view-${name}`;
  }
  document.body.dataset.view = name;
  const loggedIn = name !== 'unlock';
  for (const id of ['nav-queue', 'nav-sent', 'nav-examples', 'nav-paused', 'nav-customers', 'nav-refresh', 'nav-lock']) {
    $(id).hidden = !loggedIn;
  }
  // Highlight the sidebar entry for the open view (review keeps the queue lit).
  const navFor = { queue: currentTab === 'SENT' ? 'nav-sent' : 'nav-queue', review: 'nav-queue', examples: 'nav-examples', paused: 'nav-paused', customers: 'nav-customers', customer: 'nav-customers' };
  const active = loggedIn ? navFor[name] : null;
  for (const id of ['nav-queue', 'nav-sent', 'nav-examples', 'nav-paused', 'nav-customers']) {
    $(id).classList.toggle('is-active', id === active);
  }
}

/** Status pill tone — colour is decoration, the text carries the meaning. */
function statusTone(status) {
  switch (status) {
    case 'WAITING_FOR_HUMAN': return 'pill--wait';
    case 'EDITED': return 'pill--edit';
    case 'APPROVED': return 'pill--ok';
    case 'SENT': return 'pill--ok';
    case 'FAILED': return 'pill--bad';
    default: return 'pill--off';
  }
}

/** The owner reads Thai; the raw code stays available as a tooltip. */
const STATUS_LABELS = {
  WAITING_FOR_HUMAN: 'รอเจ้าของอนุมัติ',
  EDITED: 'แก้ไขแล้ว',
  APPROVED: 'อนุมัติแล้ว',
  SENT: 'ส่งแล้ว',
  REJECTED: 'ไม่ส่ง',
  FAILED: 'ส่งไม่สำเร็จ',
};

const INTENT_LABELS = {
  menu_request: 'ขอดูเมนู',
  delivery: 'การจัดส่ง',
  payment: 'การชำระเงิน',
  minimum_order: 'จำนวนขั้นต่ำ',
  availability: 'ยืนยัน/ยกเลิก',
  follow_up: 'ติดต่อกลับ',
  complaint: 'ร้องเรียน',
  greeting: 'ทักทาย',
  quotation: 'ขอใบเสนอราคา',
  general: 'ทั่วไป',
};

const SERVICE_LABELS = {
  mealbox: 'ข้าวกล่อง',
  snack: 'ของว่าง',
  buffet: 'บุฟเฟต์',
  cocktail: 'ค็อกเทล',
  table: 'โต๊ะจีน',
  setmenu: 'อาหารชุด',
  live: 'ปรุงสด',
};

function pill(status) {
  const el = document.createElement('span');
  el.className = `pill ${statusTone(status)}`;
  el.textContent = STATUS_LABELS[status] || status || '—';
  el.title = status || '';
  return el;
}

/** Thai label with the raw code kept in brackets for the detail list. */
function statusText(status) {
  const label = STATUS_LABELS[status];
  return label && status ? `${label} (${status})` : (status || '—');
}

function serviceText(serviceType) {
  const label = SERVICE_LABELS[serviceType];
  return label && serviceType ? `${label} (${serviceType})` : (serviceType || '—');
}

function avatarFor(name) {
  const el = document.createElement('span');
  el.className = 'avatar';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = String(name || '?').trim().slice(0, 1) || '?';
  return el;
}

function metaLine(text) {
  const el = document.createElement('span');
  el.className = 'meta';
  el.textContent = text;
  return el;
}

function lock(message) {
  secret = null;
  currentDraft = null;
  currentBotCustomer = null;
  pending = false;
  pausedNotice = '';
  $('secret-input').value = '';
  $('unlock-error').textContent = message || '';
  $('queue-list').textContent = '';
  $('queue-status').textContent = '';
  $('paused-list').textContent = '';
  $('paused-status').textContent = '';
  $('paused-count').textContent = '';
  if ($('review-bot-action-status')) $('review-bot-action-status').textContent = '';
  showView('unlock');
}

function customerName(customer) {
  if (!customer) return 'ลูกค้าไม่ระบุชื่อ';
  const named = String(customer.displayName || customer.companyName || '').trim();
  if (named) return named;
  // Never show the full `U...` LINE identifier: the last four characters are
  // enough to tell two unnamed customers apart, and they are easy to read.
  const tail = String(customer.lineUserId || '').replace(/[^A-Za-z0-9]/g, '').slice(-4);
  return tail ? `ลูกค้า LINE ••${tail}` : 'ลูกค้าไม่ระบุชื่อ';
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
  for (const [id, on] of [['nav-queue', !isSent], ['nav-sent', isSent]]) {
    $(id).classList.toggle('is-active', on);
  }
  $('queue-title').childNodes[0].textContent = isSent ? 'ส่งแล้ว ' : 'คิวรอตอบ ';
  const statusEl = $('queue-status');
  const list = $('queue-list');
  statusEl.textContent = 'กำลังโหลด…';
  list.textContent = '';
  let data;
  try {
    data = await api(`/api/v1/drafts?status=${want}&limit=100&order=desc`);
  } catch (error) {
    if (error.locked) return;
    statusEl.textContent = 'ดูคิวไม่สำเร็จ ตรวจว่าเซิร์ฟเวอร์ทำงานอยู่แล้วลองใหม่อีกครั้ง';
    return;
  }
  const drafts = data.drafts || [];
  $('queue-count').textContent = `(${data.total || drafts.length})`;
  if (!drafts.length) {
    // Pinned English by test/owner-console.test.mjs (SENT-tab empty states).
    statusEl.textContent = isSent ? 'No sent drafts' : 'No drafts waiting';
    return;
  }
  statusEl.textContent = '';
  for (const draft of drafts) {
    const card = document.createElement('article');
    card.className = 'qcard';

    const top = document.createElement('div');
    top.className = 'qcard-top';
    const who = document.createElement('div');
    who.className = 'qcard-who';
    const title = document.createElement('strong');
    title.textContent = customerName(draft.customer);
    who.appendChild(title);
    who.appendChild(metaLine(`${fmtTime(draft.createdAt)} · ${draft.draftId || draft.id}`));
    top.appendChild(avatarFor(customerName(draft.customer)));
    top.appendChild(who);
    top.appendChild(pill(draft.status));
    card.appendChild(top);

    const preview = document.createElement('div');
    preview.className = 'prewrap';
    preview.textContent = (draft.incomingMessage || '').slice(0, 160);
    card.appendChild(preview);

    if (draft.customer && draft.customer.botPausedAt) {
      const bot = document.createElement('span');
      bot.className = 'note-warn';
      bot.textContent = 'ลูกค้าคนนี้อยู่ในรายชื่อที่หยุดตอบอัตโนมัติอยู่ครับ — รอเจ้าของตอบเอง (เปิดตอบอัตโนมัติได้ในหน้ารายละเอียด)';
      card.appendChild(bot);
    }

    const foot = document.createElement('div');
    foot.className = 'qcard-foot';
    const idLine = document.createElement('span');
    idLine.className = 'qcard-id';
    idLine.textContent = draft.draftId || draft.id;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn btn-sm btn-primary';
    open.textContent = 'เปิดดู';
    open.addEventListener('click', () => openDraft(draft.id));
    foot.appendChild(idLine);
    if (draft.customer && draft.customer.id) {
      const history = document.createElement('button');
      history.type = 'button';
      history.className = 'btn btn-sm btn-ghost';
      history.textContent = 'ประวัติลูกค้า';
      history.addEventListener('click', () => openCustomer(draft.customer.id));
      foot.appendChild(history);
    }
    foot.appendChild(open);
    card.appendChild(foot);

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
  const mediaNote = $('review-media-note');
  if (mediaNote) {
    const text = draft.incomingMessage || '';
    const received = isMediaIncoming(text);
    const requested = isMediaRequest(text);
    if (received || requested) {
      mediaNote.hidden = false;
      mediaNote.textContent = received
        ? 'ลูกค้าส่งรูปหรือไฟล์มาครับ — ดูได้ใน LINE Official Account Manager ระบบส่งได้เฉพาะข้อความ'
        : 'ลูกค้าขอรูปหรือไฟล์แนบ — การส่งรูป/ไฟล์ต้องทำจาก LINE Official Account Manager ครับ';
    } else {
      mediaNote.hidden = true;
      mediaNote.textContent = '';
    }
  }
  $('review-ai').textContent = draft.draftResponse || '';
  const final = $('review-final');
  final.value = draft.ownerFinalResponse || draft.draftResponse || '';
  const attention = $('review-attention');
  attention.hidden = true;
  attention.textContent = '';
  const attempt = draft.metadata && draft.metadata.sendAttempt;
  if (draft.status === 'APPROVED' && attempt) {
    attention.hidden = false;
    attention.textContent = 'ผลการส่งครั้งก่อนยังไม่ชัดว่าถึงลูกค้าหรือไม่ รอส่งซ้ำอยู่ครับ ' +
      'ปุ่มส่งอีกครั้งจะใช้ข้อความเดิม ผู้รับเดิม และกุญแจกันส่งซ้ำชุดเดิม ' +
      'ระหว่างรอผลอนุมัติ ยังแก้เนื้อความไม่ได้';
    $('btn-send').textContent = 'ส่งอีกครั้ง';
  } else {
    $('btn-send').textContent = 'ส่งให้ลูกค้าทาง LINE';
  }
  const clist = $('review-customer');
  clist.textContent = '';
  addRow(clist, 'ชื่อลูกค้า', customerName(customer));
  if (customer && customer.companyName) addRow(clist, 'บริษัท', customer.companyName);
  renderBotState(customer);
  const mlist = $('review-meta');
  mlist.textContent = '';
  addRow(mlist, 'สถานะ', statusText(draft.status));
  addRow(mlist, 'สร้างเมื่อ', fmtTime(draft.createdAt));
  addRow(mlist, 'อัปเดตเมื่อ', fmtTime(draft.updatedAt));
  addRow(mlist, 'แหล่งที่มา', draft.source);
  addRow(mlist, 'โมเดล AI', draft.aiModel);
  addRow(mlist, 'เวอร์ชันกฎธุรกิจ', draft.ruleRevision);
  if (draft.status === 'SENT') addRow(mlist, 'ส่งเมื่อ', fmtTime(draft.sentAt));
  const wrap = $('review-lead-wrap');
  const llist = $('review-lead');
  llist.textContent = '';
  if (lead) {
    wrap.hidden = false;
    addRow(llist, 'บริการ', serviceText(lead.serviceType));
    addRow(llist, 'จำนวน', lead.quantity);
    addRow(llist, 'สถานที่', lead.location);
    addRow(llist, 'งบต่อหน่วย', lead.budgetPerPerson);
    addRow(llist, 'สถานะ', lead.status);
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
  statusEl.textContent = 'กำลังบันทึก…';
  $('learn-detail').textContent = '';
  try {
    const data = await api(`/api/v1/response-examples/from-draft/${encodeURIComponent(draft.id)}`, 'POST', {});
    const example = data.example || {};
    if (data.deduped) {
      statusEl.textContent = 'คำตอบนี้เป็นตัวอย่างอยู่แล้ว';
    } else {
      statusEl.textContent = 'บันทึกเป็นตัวอย่างแล้ว';
    }
    learnDetailRow('ประเภทคำถาม', INTENT_LABELS[example.intent] || example.intent || '—');
    learnDetailRow('บริการ', serviceText(example.serviceType));
    learnDetailRow('ใช้ซ้ำได้', example.reusable ? 'ใช่' : 'ไม่ใช่');
    learnDetailRow('เวอร์ชันกฎธุรกิจ', example.businessRulesRevision);
    if (example.staleRules) {
      learnDetailRow('คำเตือน', 'ตัวอย่างนี้สร้างจากกฎธุรกิจเวอร์ชันเก่า');
    }
  } catch (error) {
    if (error.locked) return;
    if (error.message && /example_requires_review/i.test(error.message)) {
      statusEl.textContent = 'คำตอบนี้มีข้อมูลเฉพาะลูกค้า/ราคา/เงื่อนไขที่ไม่ควรนำไปใช้เป็นตัวอย่างอัตโนมัติ';
      $('btn-learn').disabled = false;
    } else if (error.status === 409) {
      statusEl.textContent = 'ข้อความนี้เปลี่ยนไปแล้ว กรุณาโหลดใหม่ก่อนทำต่อ';
      stale = true;
      setButtonsDisabled(true);
    } else {
      statusEl.textContent = `บันทึกตัวอย่างไม่สำเร็จ: ${error.message}`;
      $('btn-learn').disabled = false;
    }
  } finally {
    pending = false;
  }
}

async function openDraft(id) {
  $('review-status').textContent = 'กำลังโหลด…';
  showView('review');
  let data;
  try {
    data = await api(`/api/v1/drafts/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error.locked) return;
    $('review-status').textContent = 'เปิดข้อความนี้ไม่สำเร็จ';
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
    $('review-status').textContent = 'ข้อความนี้เปลี่ยนไปแล้ว กรุณาโหลดใหม่ก่อนทำต่อ';
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
  $('review-status').textContent = 'กำลังบันทึก…';
  try {
    const data = await api(`/api/v1/drafts/${encodeURIComponent(currentDraft.draft.id)}/edit`, 'POST', {
      ...concurrencyOf(currentDraft.draft),
      finalText: $('review-final').value,
    });
    renderReview(data.draft, data.draft.customer || currentDraft.customer, data.draft.lead ?? currentDraft.lead);
    $('review-status').textContent = 'บันทึกที่แก้แล้ว สถานะเปลี่ยนเป็น แก้ไขแล้ว';
  } catch (error) {
    if (error.locked) return;
    if (!staleGuard(error)) $('review-status').textContent = `บันทึกไม่สำเร็จ: ${error.message}`;
  } finally {
    pending = false;
    if (currentDraft && !stale) setMutationButtons(currentDraft.draft);
  }
}

async function rejectDraft() {
  if (!currentDraft || pending) return;
  if (!window.confirm('ไม่ส่งข้อความนี้ใช่ไหมครับ? ระบบจะไม่ส่งอะไรออกไปหาลูกค้า')) return;
  pending = true;
  setMutationButtons(currentDraft.draft);
  $('review-status').textContent = 'กำลังปฏิเสธ…';
  try {
    const data = await api(`/api/v1/drafts/${encodeURIComponent(currentDraft.draft.id)}/reject`, 'POST', concurrencyOf(currentDraft.draft));
    renderReview(data.draft, data.draft.customer || currentDraft.customer, data.draft.lead ?? currentDraft.lead);
    $('review-status').textContent = 'ปฏิเสธแล้ว ไม่ได้ส่งข้อความออกไป';
  } catch (error) {
    if (error.locked) return;
    if (!staleGuard(error)) $('review-status').textContent = `ปฏิเสธไม่สำเร็จ: ${error.message}`;
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
  $('review-status').textContent = 'กำลังส่ง…';
  try {
    // Only identity + concurrency travel to the server. The message text,
    // recipient, and retry key are always re-derived server-side.
    const data = await api(`/api/v1/drafts/${encodeURIComponent(currentDraft.draft.id)}/send`, 'POST', concurrencyOf(currentDraft.draft));
    renderReview(data.draft, data.draft.customer || currentDraft.customer, data.draft.lead ?? currentDraft.lead);
    const outcome = data.send && data.send.outcome;
    if (data.draft.status === 'SENT') {
      $('review-status').textContent = 'ส่งให้ลูกค้าทาง LINE แล้ว';
      if (data.learned && data.learned.saved) {
        $('review-status').textContent += data.learned.deduped
          ? ' · คำตอบนี้อยู่ในตัวอย่างของบอทอยู่แล้ว'
          : ' · บันทึกเป็นตัวอย่างให้บอทใช้ตอบคำถามคล้ายๆ แล้ว';
      }
    } else if (outcome === 'RETRYABLE_FAILURE') {
      $('review-status').textContent = 'ยังไม่ชัวว่าส่งถึงหรือไม่ อย่าสร้างข้อความใหม่ ดูสถานะแล้วค่อยกดส่งอีกครั้ง';
    } else if (data.draft.status === 'FAILED') {
      $('review-status').textContent = `ส่งไม่สำเร็จ (${(data.send && data.send.code) || 'not accepted'}) ลูกค้ายังไม่ได้รับข้อความ`;
    } else {
      $('review-status').textContent = `ส่งเสร็จแล้วในสถานะ ${data.draft.status}`;
    }
  } catch (error) {
    if (error.locked) return;
    if (error.status === 503 || (error.message && /not configured/i.test(error.message))) {
      $('review-status').textContent = 'ยังไม่ได้ตั้งค่าการส่ง LINE บนเซิร์ฟเวอร์นี้';
    } else if (!staleGuard(error)) {
      $('review-status').textContent = `ส่งไม่สำเร็จ: ${error.message}`;
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
    $('unlock-error').textContent = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจว่าระบบเปิดอยู่แล้วลองใหม่อีกครั้ง';
    secret = null;
    return;
  }
  showView('queue');
  await loadQueue('WAITING_FOR_HUMAN');
}

async function loadExamples() {
  const statusEl = $('examples-status');
  const list = $('examples-list');
  statusEl.textContent = 'กำลังโหลด…';
  list.textContent = '';
  let data;
  try {
    data = await api('/api/v1/response-examples?limit=100');
  } catch (error) {
    if (error.locked) return;
    statusEl.textContent = 'ดูตัวอย่างคำตอบไม่สำเร็จ ตรวจว่าเซิร์ฟเวอร์ทำงานอยู่แล้วลองใหม่อีกครั้ง';
    return;
  }
  const examples = data.examples || [];
  if (!examples.length) {
    statusEl.textContent = 'ยังไม่มีตัวอย่างคำตอบ เปิดข้อความที่ส่งแล้วแล้วกดบันทึกเป็นตัวอย่างได้เลย';
    return;
  }
  statusEl.textContent = '';
  for (const example of examples) {
    const card = document.createElement('article');
    card.className = 'ecard';

    const top = document.createElement('div');
    top.className = 'ecard-top';
    const state = document.createElement('span');
    state.className = example.reusable ? 'pill pill--ok' : 'pill pill--off';
    state.textContent = example.reusable ? 'ใช้ซ้ำได้' : 'ปิดใช้ไว้';
    state.title = example.reusable ? 'Reusable' : 'Disabled';
    top.appendChild(state);
    top.appendChild(metaLine(`${fmtTime(example.createdAt)}`));
    card.appendChild(top);

    const title = document.createElement('strong');
    title.className = 'pcard-title';
    const serviceLabel = example.serviceType ? (SERVICE_LABELS[example.serviceType] || example.serviceType) : '';
    title.textContent = `${INTENT_LABELS[example.intent] || example.intent || 'ทั่วไป'}${serviceLabel ? ` · ${serviceLabel}` : ''}`;
    card.appendChild(title);

    const asked = document.createElement('div');
    asked.className = 'pair';
    const askedLabel = document.createElement('span');
    askedLabel.className = 'pair-label';
    askedLabel.textContent = 'คำถามที่ลูกค้าถาม';
    const incoming = document.createElement('div');
    incoming.className = 'prewrap';
    incoming.textContent = example.incomingExample || '';
    asked.appendChild(askedLabel);
    asked.appendChild(incoming);
    card.appendChild(asked);

    const approved = document.createElement('div');
    approved.className = 'pair';
    const approvedLabel = document.createElement('span');
    approvedLabel.className = 'pair-label';
    approvedLabel.textContent = 'คำตอบที่เจ้าของอนุมัติ';
    const answer = document.createElement('div');
    answer.className = 'prewrap';
    answer.textContent = example.approvedResponse || '';
    approved.appendChild(approvedLabel);
    approved.appendChild(answer);
    card.appendChild(approved);

    const foot = document.createElement('div');
    foot.className = 'ecard-foot';
    const meta = document.createElement('span');
    meta.className = 'meta';
    let metaText = `เวอร์ชันกฎ: ${example.businessRulesRevision || 'ไม่ทราบ'}`;
    if (example.staleRules) metaText += ' · ตัวอย่างนี้สร้างจากกฎธุรกิจเวอร์ชันเก่า';
    meta.textContent = metaText;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn btn-sm';
    // Pinned English by test/owner-console.test.mjs (toggle-actions assertion).
    toggle.textContent = example.reusable ? 'Disable example' : 'Enable example';
    toggle.addEventListener('click', () => toggleExample(example, toggle));
    foot.appendChild(meta);
    foot.appendChild(toggle);
    card.appendChild(foot);

    list.appendChild(card);
  }
}

async function toggleExample(example, button) {
  if (pending) return;
  const toReusable = !example.reusable;
  if (!window.confirm(toReusable ? 'เปิดใช้ตัวอย่างนี้สำหรับการตอบครั้งต่อไปหรือไม่?' : 'ปิดใช้ตัวอย่างนี้? ระบบจะไม่นำไปใช้ตอบลูกค้าแล้ว')) return;
  pending = true;
  button.disabled = true;
  try {
    await api(`/api/v1/response-examples/${encodeURIComponent(example.id)}`, 'PATCH', { reusable: toReusable });
    await loadExamples();
  } catch (error) {
    if (error.locked) return;
    $('examples-status').textContent = `อัปเดตไม่สำเร็จ: ${error.message}`;
    button.disabled = false;
  } finally {
    pending = false;
  }
}

// --- Bot pause switch (owner screen) -------------------------------------
// The review screen has no markup for the switch, so it is built here with
// createElement/textContent only (same rule as the rest of this file) and
// inserted right after the customer list.
function ensureBotBlock() {
  let block = $('review-bot');
  if (block) return block;
  block = document.createElement('div');
  block.id = 'review-bot';
  const status = document.createElement('p');
  status.id = 'review-bot-status';
  block.appendChild(status);
  const reason = document.createElement('p');
  reason.id = 'review-bot-reason';
  block.appendChild(reason);
  const button = document.createElement('button');
  button.id = 'btn-bot-toggle';
  button.type = 'button';
  button.addEventListener('click', toggleBotFromReview);
  block.appendChild(button);
  const action = document.createElement('p');
  action.id = 'review-bot-action-status';
  action.setAttribute('role', 'status');
  block.appendChild(action);
  $('review-customer').after(block);
  return block;
}

function renderBotState(customer) {
  ensureBotBlock();
  const status = $('review-bot-status');
  const reasonEl = $('review-bot-reason');
  const button = $('btn-bot-toggle');
  const action = $('review-bot-action-status');
  action.textContent = '';
  currentBotCustomer = customer && customer.id ? { id: customer.id, paused: !!customer.botPausedAt } : null;
  if (!currentBotCustomer) {
    status.textContent = 'ไม่พบข้อมูลลูกค้าคนนี้ เลยยังสั่งหยุดหรือเปิดตอบอัตโนมัติไม่ได้ครับ';
    reasonEl.textContent = '';
    button.hidden = true;
    button.disabled = true;
    return;
  }
  button.hidden = false;
  button.disabled = pending;
  button.textContent = currentBotCustomer.paused ? 'เปิดตอบอัตโนมัติ' : 'หยุดตอบอัตโนมัติ';
  if (currentBotCustomer.paused) {
    status.textContent = `บอทหยุดตอบอัตโนมัติอยู่ ตั้งแต่ ${fmtTime(customer.botPausedAt)} ครับ — รอเจ้าของตอบเอง`;
    reasonEl.textContent = `เหตุผลที่แจ้งไว้: ${customer.botPauseReason || 'ไม่ได้ระบุ'}`;
  } else {
    status.textContent = 'ตอนนี้บอทตอบลูกค้าคนนี้อยู่ ถ้าคุณจะคุยเองก่อน กด “หยุดตอบอัตโนมัติ” ได้เลยครับ';
    reasonEl.textContent = '';
  }
}

async function setBotState(customerId, pause, reason, button, statusEl) {
  if (pending) return false;
  pending = true;
  if (button) button.disabled = true;
  if (statusEl) statusEl.textContent = pause ? 'กำลังหยุดตอบอัตโนมัติ…' : 'กำลังเปิดตอบอัตโนมัติ…';
  try {
    if (pause) {
      await api(`/api/v1/customers/${encodeURIComponent(customerId)}/bot-pause`, 'POST', { reason: reason || '' });
    } else {
      await api(`/api/v1/customers/${encodeURIComponent(customerId)}/bot-resume`, 'POST', {});
    }
    if (statusEl) statusEl.textContent = pause ? BOT_PAUSED_NOTE : BOT_RESUMED_NOTE;
    return true;
  } catch (error) {
    if (error.locked) return false;
    if (statusEl) statusEl.textContent = `${pause ? 'หยุดตอบอัตโนมัติ' : 'เปิดตอบอัตโนมัติ'}ไม่สำเร็จ: ${error.message}`;
    return false;
  } finally {
    pending = false;
    if (button) button.disabled = false;
  }
}

async function toggleBotFromReview() {
  const target = currentBotCustomer;
  if (!target || pending) return;
  const pause = !target.paused;
  let reason = '';
  if (pause) {
    const answer = window.prompt(BOT_PAUSE_PROMPT, '');
    if (answer === null) return;
    reason = answer.trim();
  } else if (!window.confirm('เปิดตอบอัตโนมัติให้ลูกค้าคนนี้กลับมาตอบอัตโนมัติเหมือนเดิมใช่ไหมครับ?')) {
    return;
  }
  const ok = await setBotState(target.id, pause, reason, $('btn-bot-toggle'), $('review-bot-action-status'));
  if (!ok) return;
  const note = pause ? BOT_PAUSED_NOTE : BOT_RESUMED_NOTE;
  // Read the customer back from the server so the switch state is real, then
  // repeat the result message because the refresh clears it.
  if (currentDraft && !stale) {
    await openDraft(currentDraft.draft.id);
    $('review-bot-action-status').textContent = note;
  }
}

// Customers the owner has stopped the bot for (botPausedAt set).
async function loadPaused() {
  const statusEl = $('paused-status');
  const list = $('paused-list');
  statusEl.textContent = 'กำลังโหลด…';
  list.textContent = '';
  let data;
  try {
    data = await api('/api/v1/customers');
  } catch (error) {
    if (error.locked) return;
    statusEl.textContent = 'โหลดรายชื่อไม่สำเร็จ ลองเช็คว่าเซิร์ฟเวอร์ทำงานอยู่ แล้วกด Refresh อีกครั้งครับ';
    return;
  }
  const paused = (data.customers || []).filter((row) => row && row.botPausedAt);
  $('paused-count').textContent = `(${paused.length})`;
  if (!paused.length) {
    statusEl.textContent = pausedNotice || 'ตอนนี้ไม่มีลูกค้าคนไหนหยุดตอบอัตโนมัติไว้ บอทตอบทุกคนตามปกติครับ';
    pausedNotice = '';
    return;
  }
  statusEl.textContent = pausedNotice;
  pausedNotice = '';
  for (const customer of paused) {
    const card = document.createElement('article');
    card.className = 'pcard';

    const top = document.createElement('div');
    top.className = 'qcard-top';
    const who = document.createElement('div');
    who.className = 'qcard-who';
    const title = document.createElement('strong');
    title.className = 'pcard-title';
    title.textContent = customerName(customer);
    who.appendChild(title);
    who.appendChild(metaLine(`หยุดตั้งแต่ ${fmtTime(customer.botPausedAt)}`));
    top.appendChild(avatarFor(customerName(customer)));
    top.appendChild(who);
    const state = document.createElement('span');
    state.className = 'pill pill--wait';
    state.textContent = 'หยุดตอบอัตโนมัติอยู่';
    top.appendChild(state);
    card.appendChild(top);

    const when = document.createElement('div');
    when.className = 'note-warn';
    when.textContent = 'บอทหยุดตอบอัตโนมัติอยู่ — รอเจ้าของตอบเอง';
    card.appendChild(when);

    const reason = document.createElement('div');
    reason.className = 'meta';
    reason.textContent = `เหตุผลที่แจ้งไว้: ${customer.botPauseReason || 'ไม่ได้ระบุ'}`;
    card.appendChild(reason);

    const foot = document.createElement('div');
    foot.className = 'qcard-foot';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm btn-primary';
    button.textContent = 'เปิดตอบอัตโนมัติ';
    const rowStatus = document.createElement('p');
    rowStatus.className = 'status-line';
    rowStatus.setAttribute('role', 'status');
    button.addEventListener('click', async () => {
      if (pending) return;
      if (!window.confirm(`เปิดตอบอัตโนมัติให้ ${customerName(customer)} กลับมาตอบอัตโนมัติเหมือนเดิมใช่ไหมครับ?`)) return;
      const ok = await setBotState(customer.id, false, '', button, rowStatus);
      if (!ok) return;
      pausedNotice = `${customerName(customer)} เปิดตอบอัตโนมัติแล้ว บอทจะตอบลูกค้าคนนี้ตามปกติ`;
      await loadPaused();
    });
    card.appendChild(foot);
    foot.appendChild(button);
    card.appendChild(rowStatus);
    list.appendChild(card);
  }
}

// --- ลูกค้า: รายชื่อ + ประวัติรายคน + ความจำที่บอทจำไว้ ---
const FACT_LABELS = {
  quantity: 'จำนวน', serviceType: 'ประเภทบริการ', menus: 'เมนู', eventDate: 'วันที่',
  eventDateISO: 'วันที่ (ปี ค.ศ.)', eventTime: 'เวลา', location: 'ที่อยู่จัดส่ง',
  budgetPerPerson: 'งบต่อกล่อง (บาท)', phone: 'เบอร์โทร', taxId: 'เลขประจำตัวผู้เสียภาษี',
  needsInvoice: 'ต้องการใบกำกับภาษี', dietaryNotes: 'ข้อกำหนดอาหาร', contactName: 'ผู้ติดต่อ',
  openQuestions: 'ยังต้องถามลูกค้า',
};

function factValue(value) {
  if (value === true) return 'ต้องการ';
  if (value === false) return 'ไม่ต้องการ';
  if (value && typeof value === 'object') {
    if (value.value !== undefined) return `${value.value} ${value.unit || ''}`.trim();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return value.join(' / ');
  return String(value);
}

function renderFacts(container, facts) {
  if (!container) return;
  container.textContent = '';
  const entries = Object.entries(facts || {}).filter(([key]) => key !== 'eventDateISO' || facts.eventDateISO);
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'ยังไม่มีข้อมูลที่บันทึกไว้';
    container.appendChild(empty);
    return;
  }
  const list = document.createElement('dl');
  list.className = 'kv';
  for (const [key, value] of entries) {
    const dt = document.createElement('dt');
    dt.textContent = FACT_LABELS[key] || key;
    const dd = document.createElement('dd');
    dd.textContent = factValue(value);
    list.appendChild(dt);
    list.appendChild(dd);
  }
  container.appendChild(list);
}

const LEAD_STATUS_LABELS = {
  NEW: 'งานใหม่', QUALIFYING: 'กำลังคุย', QUALIFIED: 'พร้อมเสนอราคา',
  QUOTATION_PENDING: 'รอใบเสนอราคา', WON: 'ได้งานแล้ว', LOST: 'เสียงาน',
};
const LEAD_NEXT = {
  NEW: ['QUALIFYING', 'LOST'],
  QUALIFYING: ['QUALIFIED', 'LOST'],
  QUALIFIED: ['QUOTATION_PENDING', 'LOST'],
  QUOTATION_PENDING: ['WON', 'LOST'],
  WON: [],
  LOST: [],
};

function renderLeads(container, leads) {
  if (!container) return;
  container.textContent = '';
  if (!leads.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'ยังไม่มีงานที่ตามอยู่ — งานจะโผล่เมื่อลูกค้าบอกจำนวน วันที่ หรืองบที่ต้องการ';
    container.appendChild(empty);
    return;
  }
  for (const lead of leads) {
    const card = document.createElement('div');
    card.className = 'lead-row';
    const head = document.createElement('div');
    head.className = 'lead-head';
    const state = document.createElement('span');
    state.className = 'pill pill--wait';
    state.textContent = LEAD_STATUS_LABELS[lead.status] || lead.status;
    head.appendChild(state);
    const when = document.createElement('span');
    when.className = 'meta';
    const bits = [lead.serviceType, lead.quantity ? `${lead.quantity} หน่วย` : '', lead.eventDate, lead.location,
      lead.budgetPerPerson ? `งบ ${lead.budgetPerPerson}` : ''].filter(Boolean);
    when.textContent = bits.join(' · ');
    head.appendChild(when);
    card.appendChild(head);
    const actions = document.createElement('div');
    actions.className = 'row';
    for (const next of (LEAD_NEXT[lead.status] || [])) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-sm';
      button.textContent = LEAD_STATUS_LABELS[next] || next;
      button.addEventListener('click', () => moveLead(lead.id, next));
      actions.appendChild(button);
    }
    card.appendChild(actions);
    container.appendChild(card);
  }
}

async function moveLead(leadId, status) {
  if (!currentCustomer) return;
  const statusEl = $('customer-status');
  statusEl.textContent = 'กำลังบันทึกสถานะงาน…';
  try {
    await api(`/api/v1/leads/${encodeURIComponent(leadId)}/status`, 'POST', { status });
    statusEl.textContent = `บันทึกสถานะเป็น "${LEAD_STATUS_LABELS[status] || status}" แล้วครับ`;
    await openCustomer(currentCustomer.customer.id);
  } catch (error) {
    if (error.locked) return;
    statusEl.textContent = `เปลี่ยนสถานะไม่สำเร็จ: ${error.message}`;
  }
}

function renderThread(container, messages) {
  if (!container) return;
  container.textContent = '';
  if (!messages || !messages.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'ยังไม่มีข้อความ';
    container.appendChild(empty);
    return;
  }
  for (const message of messages) {
    const row = document.createElement('div');
    row.className = message.role === 'customer' ? 'thread-row thread-row--in' : 'thread-row thread-row--out';
    const who = document.createElement('span');
    who.className = 'thread-who';
    who.textContent = message.role === 'customer' ? 'ลูกค้า' : 'ร้าน';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = message.text || '';
    const time = document.createElement('span');
    time.className = 'thread-time';
    time.textContent = fmtTime(message.at);
    row.appendChild(who);
    row.appendChild(bubble);
    row.appendChild(time);
    container.appendChild(row);
  }
}

let currentCustomer = null;

async function loadCustomers() {
  const statusEl = $('customers-status');
  const list = $('customers-list');
  statusEl.textContent = 'กำลังโหลด…';
  list.textContent = '';
  let data;
  try {
    data = await api('/api/v1/customers');
  } catch (error) {
    if (error.locked) return;
    statusEl.textContent = 'โหลดรายชื่อลูกค้าไม่สำเร็จ ลองเช็คว่าเซิร์ฟเวอร์ทำงานอยู่ แล้วกดโหลดใหม่อีกครั้งครับ';
    return;
  }
  const customers = data.customers || [];
  $('customers-count').textContent = `(${customers.length})`;
  const query = ($('customers-search').value || '').trim().toLowerCase();
  const rows = query
    ? customers.filter((row) => [row.displayName, row.lineUserId, row.phone, row.companyName, row.email]
      .some((value) => String(value || '').toLowerCase().includes(query)))
    : customers;
  if (!rows.length) {
    statusEl.textContent = query ? 'ไม่พบลูกค้าที่ค้นหา' : 'ยังไม่มีลูกค้าในระบบ';
    return;
  }
  statusEl.textContent = '';
  for (const customer of rows) {
    const card = document.createElement('article');
    card.className = 'qcard';
    const top = document.createElement('div');
    top.className = 'qcard-top';
    const who = document.createElement('div');
    who.className = 'qcard-who';
    const title = document.createElement('strong');
    title.textContent = customerName(customer);
    who.appendChild(title);
    who.appendChild(metaLine([customer.companyName, customer.phone, customer.lineUserId].filter(Boolean).join(' · ')));
    top.appendChild(avatarFor(customerName(customer)));
    top.appendChild(who);
    card.appendChild(top);
    const foot = document.createElement('div');
    foot.className = 'qcard-foot';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn btn-sm btn-primary';
    open.textContent = 'ดูประวัติ';
    open.addEventListener('click', () => openCustomer(customer.id));
    foot.appendChild(open);
    card.appendChild(foot);
    list.appendChild(card);
  }
}

async function openCustomer(customerId) {
  showView('customer');
  const statusEl = $('customer-status');
  statusEl.textContent = 'กำลังโหลด…';
  let data;
  try {
    data = await api(`/api/v1/customers/${encodeURIComponent(customerId)}/thread`);
  } catch (error) {
    if (error.locked) return;
    statusEl.textContent = 'เปิดประวัติลูกค้าไม่สำเร็จ ลองใหม่อีกครั้งครับ';
    return;
  }
  currentCustomer = data;
  const customer = data.customer || {};
  $('customer-title').textContent = customerName(customer) || 'ลูกค้า';
  $('customer-chip').textContent = customer.lineUserId || '';
  $('customer-summary').value = (data.memory && data.memory.summary) || '';
  renderFacts($('customer-facts'), (data.memory && data.memory.facts) || {});
  renderThread($('customer-thread'), data.messages || []);
  renderLeads($('customer-leads'), data.leads || []);
  const history = ((data.memory && data.memory.history) || []).map((item) => ({
    ปิดเมื่อ: fmtTime(item.closedAt), สรุป: item.summary,
  }));
  renderFacts($('customer-history'), history.length ? Object.assign({}, ...history.map((row, index) => ({ [`งานที่ ${index + 1}`]: Object.values(row).filter(Boolean).join(' · ') }))) : {});
  for (const [field, value] of [
    ['cp-displayName', customer.displayName], ['cp-phone', customer.phone],
    ['cp-companyName', customer.companyName], ['cp-email', customer.email],
    ['cp-taxId', customer.taxId], ['cp-address', customer.address], ['cp-notes', customer.notes],
  ]) {
    const input = $(field);
    if (input) input.value = value == null ? '' : String(value);
  }
  statusEl.textContent = '';
}

async function saveCustomerSummary() {
  if (!currentCustomer) return;
  const statusEl = $('customer-status');
  statusEl.textContent = 'กำลังบันทึก…';
  try {
    await api(`/api/v1/customers/${encodeURIComponent(currentCustomer.customer.id)}/memory`, 'PATCH', {
      summary: $('customer-summary').value,
    });
    statusEl.textContent = 'บันทึกสรุปแล้วครับ — บอทจะใช้สรุปนี้แทนการเดาเอง';
    await openCustomer(currentCustomer.customer.id);
  } catch (error) {
    if (error.locked) return;
    statusEl.textContent = `บันทึกไม่สำเร็จ: ${error.message}`;
  }
}

async function closeCustomerJob() {
  if (!currentCustomer) return;
  const statusEl = $('customer-status');
  statusEl.textContent = 'กำลังปิดงาน…';
  try {
    await api(`/api/v1/customers/${encodeURIComponent(currentCustomer.customer.id)}/memory/close`, 'POST', {});
    statusEl.textContent = 'ปิดงานนี้แล้วครับ — ข้อความใหม่ของลูกค้าจะเริ่มสถานะใหม่';
    await openCustomer(currentCustomer.customer.id);
  } catch (error) {
    if (error.locked) return;
    statusEl.textContent = `ปิดงานไม่สำเร็จ: ${error.message}`;
  }
}

async function saveCustomerProfile(event) {
  event.preventDefault();
  if (!currentCustomer) return;
  const statusEl = $('customer-status');
  statusEl.textContent = 'กำลังบันทึก…';
  try {
    await api(`/api/v1/customers/${encodeURIComponent(currentCustomer.customer.id)}`, 'PATCH', {
      displayName: $('cp-displayName').value,
      phone: $('cp-phone').value,
      companyName: $('cp-companyName').value,
      email: $('cp-email').value,
      taxId: $('cp-taxId').value,
      address: $('cp-address').value,
      notes: $('cp-notes').value,
    });
    statusEl.textContent = 'บันทึกข้อมูลลูกค้าแล้วครับ';
    await openCustomer(currentCustomer.customer.id);
  } catch (error) {
    if (error.locked) return;
    statusEl.textContent = `บันทึกไม่สำเร็จ: ${error.message}`;
  }
}

document.getElementById('unlock-form').addEventListener('submit', unlock);
document.getElementById('nav-queue').addEventListener('click', () => { showView('queue'); loadQueue('WAITING_FOR_HUMAN'); });
document.getElementById('nav-sent').addEventListener('click', () => { showView('queue'); loadQueue('SENT'); });
document.getElementById('nav-examples').addEventListener('click', () => { showView('examples'); loadExamples(); });
document.getElementById('nav-paused').addEventListener('click', () => { showView('paused'); loadPaused(); });
document.getElementById('nav-customers').addEventListener('click', () => { showView('customers'); loadCustomers(); });
document.getElementById('back-customers').addEventListener('click', () => { showView('customers'); loadCustomers(); });
document.getElementById('customers-search').addEventListener('input', () => { loadCustomers(); });
document.getElementById('btn-save-summary').addEventListener('click', saveCustomerSummary);
document.getElementById('btn-close-job').addEventListener('click', closeCustomerJob);
document.getElementById('customer-profile-form').addEventListener('submit', saveCustomerProfile);
document.getElementById('nav-refresh').addEventListener('click', () => {
  if (!$('view-examples').hidden) loadExamples();
  else if (!$('view-paused').hidden) loadPaused();
  else if (!$('view-customer').hidden) { if (currentCustomer) openCustomer(currentCustomer.customer.id); }
  else if (!$('view-customers').hidden) loadCustomers();
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
