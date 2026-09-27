import { calculateSet, confirmedCost, customerMessage, MINIMUM_PER_MENU, money, positiveNumber, quantity, recommendBox, SHIPPING_PENDING } from './logic.mjs';
import { evaluateOption, jobContext, PROFIT_LABEL, recommendSets } from './recommend.mjs';

const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const fmt = (value) => `${money(value)} บาท`;
const state = {
  catalog: [], costs: null, settings: null, sets: [], recResult: null,
};
let id = 0;
function createSet() {
  id += 1;
  return {
    id, title: `ชุดที่ ${id}`, menuId: '', customMain: '', count: '10',
    costChoice: '', manualMainCost: '', toppings: [], fruit: false,
    extras: [], dishItems: [], box: 'three', boxTouched: false, boxIncludedInCost: false,
    quoteOverride: '', internalNote: '',
  };
}
function dishById(dishId) {
  return (Array.isArray(state.costs.dishes) ? state.costs.dishes : []).find((dish) => String(dish.id) === String(dishId)) || null;
}
// Manual sets reference recorded dishes only — never protein base costs.
function dishOptions() {
  return (Array.isArray(state.costs.dishes) ? state.costs.dishes : [])
    .filter((dish) => dish.status === 'confirmed' && Number(dish.foodCost) > 0)
    .map((dish) => `<option value="dish:${escape(dish.id)}">${escape(dish.name)} · ${money(dish.foodCost)} บาท/ชุด${dish.includesBox ? ' (รวมกล่องแล้ว)' : ''}</option>`)
    .join('');
}
function dishRefHtml(set) {
  if (!String(set.costChoice || '').startsWith('dish:')) return '';
  const dish = dishById(String(set.costChoice).slice(5));
  if (!dish) return '<p class="micro">ไม่พบเมนู/ชุดที่เลือกในข้อมูลทุนปัจจุบัน — เลือกใหม่ หรือตรวจที่หน้าจัดการเมนู</p>';
  const items = (dish.items || []).join(', ');
  const boxLabel = state.costs.boxes[dish.box]?.label || dish.box || 'ยังไม่ระบุ';
  return `<div class="span-2"><p class="micro">ชุดที่เลือก: <strong>${escape(dish.name)}</strong>${items ? ` — ${escape(items)}` : ''} · กล่อง ${escape(boxLabel)} · ${dish.includesBox ? 'ทุนรวมกล่องแล้ว' : 'บวกค่ากล่องเพิ่มครั้งเดียว'}</p>
    <label class="check"><input data-field="boxIncludedInCost" type="checkbox" ${set.boxIncludedInCost ? 'checked' : ''}><span><strong>ทุนอาหารที่ใช้นี้รวมค่ากล่องแล้ว</strong><small>ติ๊ก = ไม่บวกค่ากล่องซ้ำ</small></span></label></div>`;
}
function toppingForm(set) {
  const toppings = Array.isArray(state.costs.toppings) ? state.costs.toppings : [];
  const rows = set.toppings.map((selection, index) => {
    const selected = toppings.find((item) => String(item.id) === String(selection.toppingId));
    const choices = toppings.filter((item) => item.enabled !== false || String(item.id) === String(selection.toppingId));
    const options = choices.map((item) => `<option value="${escape(item.id)}" ${String(item.id) === String(selection.toppingId) ? 'selected' : ''}>${escape(item.name)} (${escape(item.unit)})${item.enabled === false ? ' · ปิดใช้งาน' : ''}</option>`).join('');
    return `<div class="set-topping" data-set-topping="${index}">
      <label>ไข่หรือท็อปปิ้ง <span>${selected ? `${escape(selected.unit)} · ${costLabel(selected, selected.unit)}` : 'เลือกรายการที่เจ้าของบันทึกไว้'}</span><select data-topping-field="toppingId" data-topping-index="${index}"><option value="">เลือกรายการ</option>${options}</select></label>
      <label>จำนวน / กล่อง <span>ตามหน่วยนับ</span><input data-topping-field="quantity" data-topping-index="${index}" type="number" inputmode="decimal" min="0.001" max="1000" step="0.001" value="${escape(selection.quantity)}"></label>
      <label class="check"><input data-topping-field="includedInFoodCost" data-topping-index="${index}" type="checkbox" ${selection.includedInFoodCost ? 'checked' : ''}><span><strong>รวมในทุนอาหารที่กรอกแล้ว</strong><small>ติ๊กเพื่อไม่บวกต้นทุนรายการนี้ซ้ำ</small></span></label>
      <button type="button" class="text-button" data-action="remove-set-topping" data-index="${index}" aria-label="เอาท็อปปิ้งออก">เอาออก</button>
    </div>`;
  }).join('');
  return `<div class="set-toppings span-2"><div><strong>ไข่และท็อปปิ้ง</strong><p>เลือกได้หลายรายการและระบุจำนวนต่อกล่อง · ถ้าไม่รวมในทุนอาหารที่กรอก ระบบจะบวกต้นทุนตามจำนวน · รายการรอยืนยันจะยังคำนวณได้ไม่ครบ</p></div>
    ${rows || '<p class="micro">ยังไม่มีไข่หรือท็อปปิ้งในชุด</p>'}
    <button type="button" class="button pale" data-action="add-set-topping">+ เพิ่มไข่หรือท็อปปิ้ง</button>
    <p class="micro">เพิ่มหรือแก้รายการต้นทุนที่หน้า <a href="/budget-planner.html">จัดการเมนู</a> · บันทึกองค์ประกอบของชุดที่หน้านั้นเพื่อให้ระบบแนะนำชุดเดิมตามที่จัด</p>
  </div>`;
}
// Blank or unconfirmed prices are shown as waiting for the owner, never as 0.
function costLabel(entry, per = '') {
  const cost = confirmedCost(entry);
  return cost === null ? 'รอยืนยันราคาทุน' : `${money(cost)} บาท${per ? `/${per}` : ''}`;
}
function menuOptions() {
  const groups = new Map();
  state.catalog.forEach((item) => {
    if (!groups.has(item.category)) groups.set(item.category, []);
    groups.get(item.category).push(item);
  });
  return [...groups.entries()].map(([category, menus]) => `<optgroup label="${escape(category)}">${menus.map((item) => `<option value="${escape(item.id)}">${escape(item.name)}${item.hidden ? ' (ซ่อนจากเว็บ)' : ''}</option>`).join('')}</optgroup>`).join('');
}
function sideForm(side, setId) {
  return `<div class="side-entry" data-side-id="${side.id}" data-set-id="${setId}">
    <label>ประเภท
      <select data-side-field="kind">
        <option value="side" ${side.kind === 'side' ? 'selected' : ''}>กับข้าวเพิ่ม</option>
        <option value="soup" ${side.kind === 'soup' ? 'selected' : ''}>ต้ม / น้ำซุป</option>
        <option value="curry" ${side.kind === 'curry' ? 'selected' : ''}>แกง</option>
        <option value="dessert" ${side.kind === 'dessert' ? 'selected' : ''}>ขนม</option>
      </select>
    </label>
    <label>ชื่อรายการ<input data-side-field="name" placeholder="เช่น ผัดผักรวม" value="${escape(side.name)}"></label>
    <label>ต้นทุน / คน <span>เว้นว่าง = ยังไม่ทราบ</span><input type="number" inputmode="decimal" min="0.01" step="0.01" data-side-field="cost" value="${escape(side.cost)}" placeholder="รอเจ้าของระบุ"></label>
    <button type="button" class="text-button" data-action="remove-side" aria-label="ลบรายการเพิ่ม">ลบ</button>
  </div>`;
}
function renderSets() {
  $('#sets').innerHTML = state.sets.map((set, index) => {
    const recommendation = recommendBox(set);
    if (!set.boxTouched && recommendation.id) set.box = recommendation.id;
    return `<article class="set-card" data-set-id="${set.id}">
      <div class="set-titlebar"><div><span class="eyebrow">ชุดอาหาร ${String(index + 1).padStart(2, '0')}</span><h3>${escape(set.title || `ชุดที่ ${index + 1}`)}</h3></div>${state.sets.length > 1 ? '<button type="button" class="text-button" data-action="remove-set">ลบชุด</button>' : ''}</div>
      <div class="form-grid">
        <label>ชื่อชุด <input data-field="title" value="${escape(set.title)}" placeholder="เช่น ชุดประชุมกลางวัน"></label>
        <label>จำนวนกล่องชุดนี้ <span>ขั้นต่ำ ${MINIMUM_PER_MENU} กล่องต่อเมนู</span><input data-field="count" type="number" inputmode="numeric" min="10" step="1" value="${escape(set.count)}"></label>
        <label class="span-2">เมนูอาหารหลัก <span>เลือกจากรายการกลางหรือพิมพ์เอง · ไม่ดึงราคาขายมาใช้</span>
          <select data-field="menuId"><option value="">เลือกเมนู</option>${menuOptions()}<option value="custom">พิมพ์ชื่อเมนูเอง</option></select>
        </label>
        ${set.menuId === 'custom' ? `<label class="span-2">ชื่ออาหารหลักที่กำหนดเอง<input data-field="customMain" value="${escape(set.customMain)}" placeholder="เช่น ไก่ทอดสมุนไพร"></label>` : ''}
        <label class="span-2">ยืนยันต้นทุนอาหารหลัก <span>เลือกเมนู/ชุดที่บันทึกและยืนยันทุนแล้ว หรือกำหนดเอง — ชื่อเมนูไม่กำหนดต้นทุนอัตโนมัติ · ไม่ดึงราคาขายมาใช้ (รายการรอยืนยันดูที่หน้าจัดการเมนู)</span>
          <select data-field="costChoice"><option value="">ยังไม่ยืนยันต้นทุนอาหารหลัก</option><optgroup label="เมนูและชุดอาหารที่บันทึก (ทุนยืนยันแล้ว)">${dishOptions()}</optgroup><option value="manual">กำหนดต้นทุนอาหารหลักเอง</option></select>
        </label>
        ${dishRefHtml(set)}
        ${set.costChoice === 'manual' ? `<label class="span-2">ต้นทุนอาหารหลัก / คน <span>ยังไม่รวมกล่อง</span><input data-field="manualMainCost" type="number" inputmode="decimal" min="0.01" step="0.01" value="${escape(set.manualMainCost)}" placeholder="เจ้าของระบุ"></label>` : ''}
      </div>
      <div class="group"><div class="group-top"><div><h4>อาหารและส่วนเพิ่ม</h4><p>ข้าวรวมอยู่ในอาหารหลักแล้ว · ต้นทุนไข่และท็อปปิ้งคิดแยกตามรายการและจำนวน เว้นแต่ระบุว่ารวมในทุนอาหารแล้ว · รายการรอยืนยันจะไม่ถูกคิดเป็น 0</p></div></div>
        <div class="form-grid additions"><label class="check"><input data-field="fruit" type="checkbox" ${set.fruit ? 'checked' : ''}><span><strong>เพิ่มผลไม้ในกล่อง</strong><small>${costLabel(state.costs.fruit, 'คน')}</small></span></label></div>
        ${toppingForm(set)}
        <div class="sides">${set.extras.map((side) => sideForm(side, set.id)).join('')}</div>
        <button type="button" class="button pale" data-action="add-side">+ เพิ่มต้ม / แกง / กับข้าว / ขนม</button>
      </div>
      <div class="group box-group"><div><h4>เลือกกล่อง</h4><p data-recommendation></p></div>
        <div class="form-grid"><label class="span-2">ชนิดกล่อง <span>รวมช้อนส้อมแล้ว · ปรับเองได้</span><select data-field="box">${Object.entries(state.costs.boxes).map(([key, info]) => `<option value="${key}">${escape(info.label)} · ${costLabel(info, 'กล่อง')}</option>`).join('')}</select></label>
        <label class="check span-2" data-confirm-wrap><input type="checkbox" data-field="boxTouched" ${set.boxTouched ? 'checked' : ''}><span><strong>ฉันตรวจองค์ประกอบและยืนยันกล่องที่เลือกแล้ว</strong><small>ชุดนอกเงื่อนไขตัวอย่างต้องยืนยันเอง ไม่เดาความจุ</small></span></label></div>
      </div>
      <div class="group"><h4>ราคาที่เสนอและบันทึกภายใน</h4><div class="form-grid"><label>ราคาขายชุดนี้ / กล่อง <span>เว้นว่าง = ใช้ราคาขายด้านบน (ถ้าระบุ)</span><input data-field="quoteOverride" type="number" inputmode="decimal" min="0.01" step="0.01" value="${escape(set.quoteOverride)}" placeholder="ยังไม่กำหนด"></label>
      <label>บันทึกส่วนตัว <span>ไม่คัดลอกให้ลูกค้า</span><input data-field="internalNote" value="${escape(set.internalNote)}" placeholder="จดไว้เฉพาะเจ้าของ"></label></div></div>
      <div class="inline-result" data-inline-result></div>
    </article>`;
  }).join('');
  state.sets.forEach((set) => {
    const root = document.querySelector(`[data-set-id="${set.id}"].set-card`);
    for (const field of ['menuId', 'costChoice', 'box']) root.querySelector(`[data-field="${field}"]`).value = String(set[field]);
  });
  renderReports();
}
function currentQuote(set) {
  return set.quoteOverride !== '' ? set.quoteOverride : $('#quote').value;
}
function renderReports() {
  const budget = positiveNumber($('#budget').value);
  const totalCount = quantity($('#total-count').value);
  const results = state.sets.map((set) => calculateSet({ ...set, quote: currentQuote(set) }, state.costs, state.catalog));
  const qtySum = results.reduce((total, result) => total + (result.count || 0), 0);
  const quantitiesValid = results.every((result) => result.count !== null && result.count >= MINIMUM_PER_MENU);
  const countMatches = totalCount !== null && qtySum === totalCount;
  const costComplete = results.every((result) => result.complete);
  const knownTotal = results.reduce((total, result) => total + (result.knownTotal || 0), 0);
  const shipping = positiveNumber($('#shipping').value);
  const overridesPrice = state.sets.some((set) => set.quoteOverride !== '');
  const defaultQuote = positiveNumber($('#quote').value);
  const quoteSummary = $('#quote').value === ''
    ? (overridesPrice ? 'กำหนดแยกแต่ละชุด' : 'ยังไม่ระบุราคา')
    : defaultQuote === null ? 'กรุณาระบุราคาใหม่'
      : `${fmt(defaultQuote)} / กล่อง${overridesPrice ? ' · บางชุดกำหนดต่างกัน' : ''}`;
  $('#overview').innerHTML = `<div class="overview-grid">
    <div><span>งบอาหารลูกค้า / คน</span><strong>${budget === null ? 'ยังไม่ระบุ' : fmt(budget)}</strong></div>
    <div><span>ราคาขายอ้างอิง / กล่อง</span><strong>${quoteSummary}</strong></div>
    <div><span>ต้นทุนรวมที่ทราบ</span><strong>${fmt(knownTotal)}</strong><small>${costComplete ? 'ต้นทุนชุดครบตามรายการที่กรอก' : 'ยังมีต้นทุนหรือการยืนยันที่ขาด — ไม่ใช่ต้นทุนครบ'}</small></div>
    <div><span>ค่าจัดส่ง (แยกจากอาหาร)</span><strong>${shipping === null ? SHIPPING_PENDING : fmt(shipping)}</strong></div></div>
    <p class="${countMatches && quantitiesValid ? 'good-banner' : 'warning-banner'}">จำนวนกล่อง: รวมแต่ละชุด ${qtySum} กล่อง / จำนวนที่แจ้ง ${totalCount ?? 'ยังไม่ระบุ'} กล่อง ${countMatches && quantitiesValid ? '✓ จำนวนตรงกัน และแต่ละเมนูขั้นต่ำ 10 กล่อง' : '— กรุณาตรวจจำนวนแต่ละเมนูและยอดรวมก่อนคัดลอก'}</p>`;
  const job = currentJob();
  $('#results').innerHTML = results.map((result, index) => {
    const set = state.sets[index];
    const recommendation = result.recommendation;
    const boxPrice = confirmedCost(state.costs.boxes[set.box]);
    const missing = [...result.missing];
    if (!result.boxConfirmed) missing.push('ยังไม่ยืนยันชนิดกล่องสำหรับชุดนี้');
    const priceCompare = result.complete && budget !== null && result.quote !== null
      ? `<p class="compare">ราคาเสนอ ${fmt(result.quote)} / กล่อง ${result.quote > budget ? 'สูงกว่างบลูกค้า' : result.quote < budget ? 'ต่ำกว่างบลูกค้า' : 'เท่ากับงบลูกค้า'} ${fmt(Math.abs(result.quote - budget)) === '0 บาท' ? '' : fmt(Math.abs(result.quote - budget))}</p>` : '';
    const summary = `<span>อาหารคาว ${result.savoury} อย่าง (ไม่รวมข้าว/ไข่/ผลไม้/ขนม)</span><span>กล่องที่เลือก ${escape(state.costs.boxes[set.box]?.label || 'ยังไม่เลือก')} · ${boxPrice == null ? 'ยังไม่ระบุต้นทุน' : fmt(boxPrice)}</span>`;
    let jobLine = '';
    if (job.ok) {
      if (result.complete && result.count !== null) {
        const evaluation = evaluateOption({
          costPerPersonCents: Math.round(result.knownPerBox * 100),
          count: result.count,
          salesCents: job.context.saleCents * result.count,
          shipCents: job.context.shipCents,
          otherCents: job.context.otherCents,
          tier: job.context.tier,
        });
        const label = evaluation.group === 'target'
          ? `ถึงกำไรเป้าหมาย ${job.context.tier.targetProfit}%`
          : evaluation.group === 'minimum'
            ? `ผ่านกำไรขั้นต่ำ ${job.context.tier.minProfit}%`
            : `ต่ำกว่ากำไรขั้นต่ำ ${job.context.tier.minProfit}% — ไม่ใช่ชุดแนะนำ`;
        const countNote = result.count === job.context.count
          ? ''
          : ` · จำนวนกล่องของชุดนี้ ${result.count} ต่างจากจำนวนกล่องของงาน ${job.context.count}`;
        jobLine = `<p class="${evaluation.group === 'fail' ? 'warning-banner' : 'good-banner'}">${PROFIT_LABEL} ${evaluation.profitCents < 0 ? '-' : ''}${centsText(evaluation.profitCents)} · ${pctText(evaluation.pct)} · ${label}${countNote}</p>`;
      } else {
        jobLine = '<p class="warning-banner">กรอกข้อมูลให้ครบก่อน จึงจะตรวจเกณฑ์กำไรของชุดนี้ได้</p>';
      }
    }
    document.querySelector(`[data-set-id="${set.id}"].set-card [data-inline-result]`).innerHTML = summary;
    const recText = recommendation.id ? `แนะนำ ${escape(state.costs.boxes[recommendation.id].label)}: ${escape(recommendation.reason)}` : escape(recommendation.reason);
    document.querySelector(`[data-set-id="${set.id}"].set-card [data-recommendation]`).textContent = recText + (set.boxTouched ? ' · เจ้าของยืนยันกล่องแล้ว' : '');
    document.querySelector(`[data-set-id="${set.id}"].set-card [data-confirm-wrap]`).hidden = !recommendation.needsConfirmation;
    document.querySelector(`[data-set-id="${set.id}"].set-card [data-field="box"]`).value = set.box;
    return `<article class="result-card"><div class="result-heading"><h3>${escape(set.title.trim() || `ชุดที่ ${index + 1}`)}</h3>${set.fromRecommendation ? '<span class="pill">ส่งจากคำแนะนำ</span>' : ''}<span class="pill ${result.complete ? 'ok' : 'wait'}">${result.complete ? 'ต้นทุนที่กรอกครบ' : 'ต้องตรวจเพิ่ม'}</span></div>
      <p class="result-sub">อาหารหลัก: ${escape(result.mainName || 'ยังไม่เลือก')} · ${result.count ?? '–'} กล่อง · อาหารคาว ${result.savoury} อย่าง</p>
      <div class="numbers"><div><small>ต้นทุนที่ทราบ / กล่อง</small><b>${fmt(result.knownPerBox)}</b></div><div><small>ต้นทุนที่ทราบรวม</small><b>${result.knownTotal === null ? 'รอจำนวนกล่อง' : fmt(result.knownTotal)}</b></div><div><small>ส่วนต่างจากราคาขาย / กล่อง</small><b>${result.differencePerBox === null ? 'ยังไม่สรุป' : fmt(result.differencePerBox)}</b></div><div><small>ส่วนต่างรวมก่อนค่าใช้จ่ายอื่น</small><b>${result.differenceTotal === null ? 'ยังไม่สรุป' : fmt(result.differenceTotal)}</b></div></div>
      ${missing.length ? `<p class="missing">ยังไม่ครบ: ${missing.map(escape).join(' · ')} — แสดงเฉพาะต้นทุนที่ทราบ ไม่สรุปส่วนต่างหรือความคุ้มงบ</p>` : priceCompare}${jobLine}
    </article>`;
  }).join('');
  const invalidQuote = ($('#quote').value !== '' && positiveNumber($('#quote').value) === null) || state.sets.some((set) => set.quoteOverride !== '' && positiveNumber(set.quoteOverride) === null);
  const invalidShipping = $('#shipping').value !== '' && shipping === null;
  const canCopy = quantitiesValid && countMatches && results.every((item) => Boolean(item.mainName) && item.boxConfirmed && !item.missing.some((missing) => missing.startsWith('ชื่อ'))) && !invalidQuote && !invalidShipping;
  $('#copy-customer').disabled = !canCopy;
  $('#copy-status').textContent = canCopy ? '' : 'ตรวจชื่อเมนู จำนวนขั้นต่ำ ยอดรวม กล่อง และราคาที่กรอกก่อนคัดลอก';
  $('#customer-preview').textContent = canCopy ? customerMessage(state.sets.map((set) => ({ ...set, quote: currentQuote(set) })), results, $('#shipping').value, state.costs) : 'กรอกชื่อเมนูและจำนวนกล่องให้ครบก่อนดูข้อความสำหรับลูกค้า';
}

function recInputs() {
  return {
    saleBudget: $('#rec-sale').value,
    boxCount: $('#rec-count').value,
    shipping: $('#rec-shipping').value,
    otherExpenses: $('#rec-other').value,
    costs: state.costs,
    settings: state.settings,
    catalogCount: state.catalog.length,
  };
}
function currentJob() {
  return jobContext(recInputs());
}
function centsText(cents) {
  return `${money(Math.abs(cents) / 100)} บาท`;
}
function pctText(value) {
  return `${(Math.round(value * 10) / 10).toFixed(1)}%`;
}
function reasonList(items) {
  return `<ul class="reason-list">${items.map((item) => `<li>${escape(item)}</li>`).join('')}</ul>`;
}
function skippedHtml(skipped) {
  if (!skipped) return '';
  const items = (skipped.dishes || []).map((item) => `<li>${escape(item.label)} — ${escape(item.reason)}</li>`);
  const unrecorded = Math.max(0, (skipped.catalogCount || 0) - (skipped.linkedCount || 0));
  items.push(`<li>เมนูในคลัง ${skipped.catalogCount} รายการที่เจ้าของยังไม่บันทึกเป็นเมนู/ชุดพร้อมทุนยืนยัน (${unrecorded} รายการยังไม่บันทึก) ไม่นำมาจัดชุดอัตโนมัติ — ใช้เฉพาะเมนู/ชุดที่บันทึก เปิดใช้ และยืนยันทุนครบ ${skipped.dishesUsed} รายการ</li>`);
  return `<div class="skipped-box"><h4>รายการที่ถูกข้าม ไม่นำมาเสนอ</h4><ul>${items.join('')}</ul></div>`;
}
function recCardHtml(option, groupKey, index) {
  const { context } = state.recResult;
  const evaluation = option.evaluation;
  const reached = groupKey === 'target' ? 'ถึงกำไรเป้าหมาย' : 'ผ่านกำไรขั้นต่ำ';
  const breakdown = option.breakdown.map((line) => `<li class="${line.bold ? 'bold' : ''}${line.profit ? ' profit' : ''}"><span>${escape(line.label)}</span><b>${line.cents < 0 ? '-' : ''}${centsText(line.cents)}</b></li>`).join('');
  const items = option.dish.items.length ? option.dish.items.join(' · ') : 'เจ้าของยังไม่ระบุรายการอาหารย่อย';
  const toppings = (option.dish.toppings || []).map((item) => `${item.name} ${item.quantity} ${item.unit}`).join(' · ');
  return `<article class="result-card rec-card">
    <div class="result-heading"><h3>${escape(option.dish.name)}</h3><span class="pill ok">${escape(reached)} · ${pctText(evaluation.pct)}</span></div>
    <p class="result-sub">${escape(items)}${toppings ? ` · ไข่และท็อปปิ้ง: ${escape(toppings)}` : ''} · ${escape(option.box.label)}${option.box.included ? ' (รวมในทุนอาหารแล้ว)' : ''}</p>
    <div class="numbers">
      <div><small>ราคาขาย/กล่อง (รวมค่าส่งแล้ว)</small><b>${centsText(context.saleCents)}</b></div>
      <div><small>ยอดขายรวมงาน ${context.count} กล่อง</small><b>${centsText(context.salesCents)}</b></div>
      <div><small>ต้นทุนอาหาร+กล่อง/คน</small><b>${centsText(option.costPerPersonCents)}</b></div>
      <div><small>ต้นทุนรวมงาน</small><b>${centsText(evaluation.totalCostCents)}</b></div>
      <div><small>ค่าส่งรวมงาน</small><b>${centsText(context.shipCents)}</b></div>
      <div><small>${PROFIT_LABEL}</small><b>${centsText(evaluation.profitCents)} · ${pctText(evaluation.pct)}</b></div>
      ${context.otherCents ? `<div><small>ค่าใช้จ่ายอื่นของงาน</small><b>${centsText(context.otherCents)}</b></div>` : ''}
    </div>
    <details class="breakdown"><summary>ดูต้นทุนแยกรายการ</summary><ul class="cost-lines">${breakdown}</ul></details>
    <div class="rec-card-actions"><button type="button" class="button outline" data-action="send-rec" data-group="${groupKey}" data-index="${index}">ส่งเข้าแบบฟอร์มแก้ไข</button></div>
  </article>`;
}
function renderRecResults() {
  const result = state.recResult;
  const usedBox = $('#rec-used');
  const out = $('#rec-out');
  if (!result) {
    usedBox.innerHTML = '';
    out.innerHTML = '';
    return;
  }
  if (!result.ok) {
    usedBox.innerHTML = '';
    out.innerHTML = `<div class="warning-banner"><strong>ยังแนะนำชุดไม่ได้</strong>${reasonList(result.errors)}<p class="micro">ระบบไม่ลดเกณฑ์กำไรเอง และไม่แทนค่าที่ยังไม่ทราบด้วย 0</p></div>`;
    return;
  }
  usedBox.innerHTML = `<div class="used-values"><strong>ค่าที่ใช้คำนวณ</strong><ul>${result.usedValues.map((line) => `<li>${escape(line)}</li>`).join('')}</ul></div>`;
  const groupMeta = [
    { key: 'target', title: 'ถึงกำไรเป้าหมาย', note: `อัตรากำไรอย่างน้อย ${result.context.tier.targetProfit}% ของยอดขาย กำไรมากกว่าเป้าหมายยังถือว่าผ่าน` },
    { key: 'minimum', title: 'ผ่านกำไรขั้นต่ำ', note: `อัตรากำไรอย่างน้อย ${result.context.tier.minProfit}% ของยอดขาย และต่ำกว่า ${result.context.tier.targetProfit}%` },
  ];
  let html = '';
  for (const group of groupMeta) {
    const options = result.groups[group.key];
    if (!options.length) continue;
    html += `<div class="rec-group-title"><h3>${group.title} (${options.length} ชุด)</h3><p>${escape(group.note)}</p></div><div class="results rec-results">${options.map((option, index) => recCardHtml(option, group.key, index)).join('')}</div>`;
  }
  if (result.reasons.length) html += `<div class="warning-banner"><strong>ยังไม่มีชุดที่ผ่านเกณฑ์</strong>${reasonList(result.reasons)}</div>`;
  html += skippedHtml(result.skipped);
  html += `<p class="micro">แต่ละชุดคือเมนู/ชุดอาหารที่เจ้าของบันทึกไว้ตรงตามรายการที่จัด ระบบไม่เพิ่มอาหารหรือเปลี่ยนกล่องเอง · แต่ละชุดเป็นหนึ่งทางเลือกสำหรับจำนวนกล่องทั้งงาน (${result.context.count} กล่อง) ไม่แบ่งจำนวนหลายเมนูเอง และค่าส่งรวมงานถูกคิดครั้งเดียวต่อทางเลือก · กด “ส่งเข้าแบบฟอร์มแก้ไข” เพื่อปรับแต่งแล้วให้ระบบตรวจเกณฑ์ใหม่</p>`;
  out.innerHTML = html;
}
function optionToSet(option, context) {
  const dish = option.dish;
  const linked = dish.menuId !== null && dish.menuId !== undefined && dish.menuId !== '';
  return {
    id: ++id,
    title: dish.name,
    menuId: linked ? String(dish.menuId) : 'custom',
    customMain: linked ? '' : dish.name,
    count: String(context.count),
    costChoice: `dish:${dish.id}`,
    manualMainCost: '',
    toppings: dish.toppings.map((item) => ({ toppingId: item.id, quantity: item.quantity, includedInFoodCost: item.includedInFoodCost })),
    fruit: false,
    extras: [],
    dishItems: [...dish.items],
    box: option.box.key,
    boxTouched: true,
    boxIncludedInCost: option.box.included,
    quoteOverride: (context.saleCents / 100).toFixed(2),
    priceIncludesDelivery: true,
    fromRecommendation: true,
    internalNote: '',
  };
}
function sendOptionToForm(option, context) {
  const nextSet = optionToSet(option, context);
  const only = state.sets.length === 1 ? state.sets[0] : null;
  const pristine = Boolean(only && !only.menuId && !only.customMain && !only.costChoice && !only.extras.length && !only.quoteOverride && only.count === '10');
  state.sets = pristine ? [nextSet] : [...state.sets, nextSet];
  $('#total-count').value = String(context.count);
  renderSets();
  $('#rec-status').textContent = `ส่ง “${option.dish.name}” เข้าแบบฟอร์มแล้ว — ปรับแก้ด้านล่าง แล้วระบบจะตรวจเกณฑ์กำไรใหม่ให้`;
  document.querySelector('.sets').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function runRecommendation() {
  if (!state.costs || !state.settings) {
    $('#rec-out').innerHTML = '<p class="warning-banner">ข้อมูลต้นทุนภายในยังโหลดไม่สำเร็จ</p>';
    return;
  }
  state.recResult = recommendSets(recInputs());
  $('#rec-status').textContent = state.recResult.ok ? 'อัปเดตผลแนะนำแล้ว' : '';
  renderRecResults();
}

// Cost data can change while this page stays open (owner edits prices elsewhere).
// Re-read it on return to the tab and drop stale recommendation results so old
// profit numbers are never presented as current.
let dataSnapshot = '';
let refreshInFlight = false;
// Menus AND costs are re-read from the central/local stores (latest after
// "บันทึก" on the menu page) and stale recommendations are dropped so old
// profit numbers are never presented as current.
function centralToCatalog(central) {
  if (!central || !Array.isArray(central.menus)) return null;
  return central.menus.map((item) => ({
    id: item.id, name: item.name, category: item.category, hidden: item.hidden === true,
  }));
}
async function refreshCosts() {
  if (!state.costs || refreshInFlight) return;
  refreshInFlight = true;
  try {
    const [costResponse, settingsResponse, centralResponse] = await Promise.all([
      fetch('/owner-costs', { cache: 'no-store' }), fetch('/owner-settings', { cache: 'no-store' }),
      fetch('/menu-central', { cache: 'no-store' }),
    ]);
    if (!costResponse.ok || !settingsResponse.ok) return;
    const costs = await costResponse.json();
    const settings = await settingsResponse.json();
    const catalog = centralResponse.ok ? centralToCatalog(await centralResponse.json()) : null;
    const next = JSON.stringify([costs, settings, catalog ?? state.catalog]);
    if (next === dataSnapshot) return;
    const previous = state.costs.version ?? 'ก่อนหน้า';
    state.costs = costs;
    state.settings = settings;
    if (catalog) state.catalog = catalog;
    dataSnapshot = next;
    renderSets();
    invalidateRecommendations(previous, costs.version ?? 'ใหม่');
  } catch {
    // Server may be briefly unavailable; keep showing the last known data.
  } finally {
    refreshInFlight = false;
  }
}
function invalidateRecommendations(from, to) {
  const hadResults = Boolean(state.recResult);
  state.recResult = null;
  renderRecResults();
  $('#rec-status').textContent = 'ราคาทุนภายในเปลี่ยนแล้ว — กด “แนะนำชุดเมนู” เพื่อคำนวณใหม่';
  if (hadResults) {
    $('#rec-out').innerHTML = `<div class="warning-banner"><strong>ราคาทุนภายในเปลี่ยนแปลง</strong><p>ผลแนะนำชุดก่อนหน้าคำนวณจากต้นทุนรุ่น ${escape(String(from))} แต่ตอนนี้เป็นรุ่น ${escape(String(to))} จึงยกเลิกผลเดิมไว้เพื่อไม่ให้แสดงกำไรที่ล้าสมัย — กด “แนะนำชุดเมนู” เพื่อคำนวณใหม่</p></div>`;
  }
}
window.addEventListener('focus', refreshCosts);
window.addEventListener('pageshow', refreshCosts);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCosts(); });

function setFor(element) {
  return state.sets.find((set) => String(set.id) === element.closest('[data-set-id]')?.dataset.setId);
}
$('#sets').addEventListener('input', (event) => {
  if (event.target.tagName === 'SELECT' || event.target.type === 'checkbox') return;
  if (event.target.dataset.toppingField === 'quantity') {
    const set = setFor(event.target);
    const selection = set?.toppings?.[Number(event.target.dataset.toppingIndex)];
    if (selection) selection.quantity = event.target.value === '' ? '' : Number(event.target.value);
    renderReports();
    return;
  }
  const sideField = event.target.dataset.sideField;
  const set = setFor(event.target);
  if (!set) return;
  if (sideField) {
    const side = set.extras.find((item) => String(item.id) === event.target.closest('[data-side-id]')?.dataset.sideId);
    if (side) side[sideField] = event.target.value;
  } else if (event.target.dataset.field) set[event.target.dataset.field] = event.target.value;
  renderReports();
});
$('#sets').addEventListener('change', (event) => {
  const set = setFor(event.target);
  if (!set) return;
  if (event.target.dataset.toppingField) {
    const selection = set.toppings?.[Number(event.target.dataset.toppingIndex)];
    if (!selection) return;
    const field = event.target.dataset.toppingField;
    selection[field] = field === 'includedInFoodCost' ? event.target.checked : event.target.value;
    renderSets();
    return;
  }
  if (event.target.dataset.sideField) {
    const side = set.extras.find((item) => String(item.id) === event.target.closest('[data-side-id]')?.dataset.sideId);
    if (side) side[event.target.dataset.sideField] = event.target.value;
  } else if (event.target.dataset.field) {
    const field = event.target.dataset.field;
    set[field] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    if (field === 'box') set.boxTouched = true;
    if (field === 'menuId') set.customMain = '';
    if (field === 'costChoice' && String(set[field]).startsWith('dish:')) {
      // Adopt the recorded dish as-is: menu link, items, box, and whether
      // its cost already includes the box (never double-counted).
      const dish = dishById(String(set[field]).slice(5));
      if (dish) {
        set.menuId = dish.menuId !== null && dish.menuId !== undefined && dish.menuId !== '' ? String(dish.menuId) : 'custom';
        set.customMain = set.menuId === 'custom' ? dish.name : '';
        set.dishItems = Array.isArray(dish.items) ? [...dish.items] : [];
        set.toppings = Array.isArray(dish.toppings) ? dish.toppings.map((item) => ({ toppingId: item.toppingId, quantity: item.quantity, includedInFoodCost: item.includedInFoodCost })) : [];
        if (dish.box) set.box = dish.box;
        set.boxIncludedInCost = Boolean(dish.includesBox);
        set.boxTouched = true;
      }
    }
    if (field === 'costChoice' && !String(set[field]).startsWith('dish:')) {
      set.dishItems = [];
      set.toppings = [];
    }
  }
  renderSets();
});
$('#sets').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const set = setFor(button);
  if (!set) return;
  if (button.dataset.action === 'remove-set' && state.sets.length > 1) state.sets = state.sets.filter((item) => item !== set);
  if (button.dataset.action === 'add-side') set.extras.push({ id: ++id, kind: 'side', name: '', cost: '' });
  if (button.dataset.action === 'remove-side') set.extras = set.extras.filter((item) => String(item.id) !== button.closest('[data-side-id]').dataset.sideId);
  if (button.dataset.action === 'add-set-topping') set.toppings.push({ toppingId: '', quantity: 1, includedInFoodCost: false });
  if (button.dataset.action === 'remove-set-topping') set.toppings.splice(Number(button.dataset.index), 1);
  renderSets();
});
['budget', 'total-count', 'quote', 'shipping'].forEach((field) => $(`#${field}`).addEventListener('input', () => {
  if (state.costs) renderReports();
}));
$('#rec-run').addEventListener('click', runRecommendation);
$('#rec-out').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="send-rec"]');
  if (!button || !state.recResult || !state.recResult.ok) return;
  const option = state.recResult.groups[button.dataset.group]?.[Number(button.dataset.index)];
  if (option) sendOptionToForm(option, state.recResult.context);
});
['rec-sale', 'rec-count', 'rec-shipping', 'rec-other'].forEach((field) => $(`#${field}`).addEventListener('input', () => {
  if (state.recResult) $('#rec-status').textContent = 'ข้อมูลงานเปลี่ยนแล้ว — กด “แนะนำชุดเมนู” เพื่ออัปเดตผล';
  if (state.costs) renderReports();
}));
$('#add-set').addEventListener('click', () => { state.sets.push(createSet()); renderSets(); });
$('#copy-customer').addEventListener('click', async () => {
  if ($('#copy-customer').disabled) return;
  const preview = $('#customer-preview');
  try {
    await navigator.clipboard.writeText(preview.textContent);
    $('#copy-status').textContent = 'คัดลอกแล้ว ✓';
  } catch {
    const range = document.createRange();
    range.selectNodeContents(preview);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    $('#copy-status').textContent = 'เลือกข้อความไว้แล้ว กดคัดลอกเองได้เลย';
  }
});

try {
  const [costResponse, catalogResponse, settingsResponse, centralResponse] = await Promise.all([
    fetch('/owner-costs'), fetch('/menu-catalog'), fetch('/owner-settings'),
    fetch('/menu-central'),
  ]);
  if (!costResponse.ok || !catalogResponse.ok || !settingsResponse.ok) throw new Error('Local data missing');
  state.costs = await costResponse.json();
  // Prefer the central draft (latest after "บันทึก"); fall back to catalog.
  const centralCatalog = centralResponse.ok ? centralToCatalog(await centralResponse.json()) : null;
  state.catalog = centralCatalog || await catalogResponse.json();
  state.settings = await settingsResponse.json();
  state.sets = [createSet()];
  dataSnapshot = JSON.stringify([state.costs, state.settings, state.catalog]);
  renderSets();
} catch {
  $('#load-error').hidden = false;
  $('#add-set').disabled = true;
  $('#copy-customer').disabled = true;
}
