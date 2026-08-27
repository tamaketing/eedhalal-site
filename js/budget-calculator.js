(function(){
  'use strict';

  var LS_KEY = 'eed_budget_calc_v1';
  var LS_SHIP = 'eed_budget_ship_v1';
  var LS_DATE = 'eed_delivery_date_v1';
  var LS_TIME = 'eed_delivery_time_v1';
  var els = {};
  var DEFAULT_SHIP_ZONES = [
    {id:'bangkok_inner', label:'กรุงเทพชั้นใน (สาทร สีลม พระราม3)', fee:120},
    {id:'sukhumvit', label:'สุขุมวิท', fee:150},
    {id:'ladprao', label:'ลาดพร้าว วังทองหลาง', fee:180},
    {id:'bangkok_outer', label:'กรุงเทพรอบนอก', fee:250},
    {id:'vicinity', label:'ปริมณฑล (นนทบุรี สมุทรปราการ ปทุม)', fee:350},
    {id:'other', label:'อื่นๆ / ต่างจังหวัด — สอบถาม', fee:0}
  ];
  function getShipZones(){
    return DEFAULT_SHIP_ZONES;
  }
  function getShipFees(){
    var zones = getShipZones();
    var map = {};
    zones.forEach(function(z){ map[z.id]=parseInt(z.fee,10)||0; });
    return map;
  }
  function getFreeThreshold(){
    if(typeof EED !== 'undefined' && EED.freeDeliveryFrom) return parseInt(EED.freeDeliveryFrom,10)||50;
    return 50;
  }
  var SHIP_FEES = getShipFees();
  var state = {
    budgetPerBox: 60,
    quantity: 20,
    category: 'all',
    selected: {}, // id -> qty
    selectedToppings: {}, // id -> [toppingIndex, ...]
    shippingMode: 'auto', // auto | free | manual | zone
    shippingFee: 0,        // used when manual
    shippingZone: 'bangkok_inner'
  };

  function $(id){ return document.getElementById(id); }

  function formatMoney(n){
    return Number(n).toLocaleString('th-TH');
  }

  function toISODate(d){
    var yyyy = d.getFullYear();
    var mm = ('0'+(d.getMonth()+1)).slice(-2);
    var dd = ('0'+d.getDate()).slice(-2);
    return yyyy+'-'+mm+'-'+dd;
  }
  function addDays(dateStr, days){
    var d = dateStr ? new Date(dateStr) : new Date();
    // if dateStr is YYYY-MM-DD, parse manually to avoid TZ
    if(dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)){
      var parts = dateStr.split('-');
      d = new Date(parseInt(parts[0],10), parseInt(parts[1],10)-1, parseInt(parts[2],10));
    }
    d.setDate(d.getDate()+days);
    return toISODate(d);
  }
  function formatDateTH(iso){
    if(!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    var p = iso.split('-');
    var y = parseInt(p[0],10), m = parseInt(p[1],10), d = parseInt(p[2],10);
    var date = new Date(y, m-1, d);
    var weekdays = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
    var months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    var wd = weekdays[date.getDay()];
    var be = y + 543;
    return 'วัน' + wd + 'ที่ ' + d + ' ' + months[m-1] + ' ' + be;
  }
  function formatDateShort(iso){
    if(!iso) return '';
    var p = iso.split('-');
    return p[2]+'/'+p[1]+'/'+p[0];
  }
  function formatTimeTH(t){
    if(!t || !/^\d{2}:\d{2}$/.test(t)) return '';
    return t + ' น.';
  }

  function getToppingsForMenu(menuId){
    if(Array.isArray(EED_DEFAULT_TOPPINGS)) return EED_DEFAULT_TOPPINGS;
    var firstMenu = EED_MENUS.find(function(menu){ return Array.isArray(menu.toppings) && menu.toppings.length; });
    return firstMenu ? firstMenu.toppings : [];
  }

  function getFiltered(){
    var b = state.budgetPerBox;
    var cats = state.category;
    return EED_MENUS.filter(function(m){
      var priceOk = m.price <= b;
      var catOk = cats === 'all' || m.category === cats;
      return priceOk && catOk;
    }).sort(function(a,b){ return b.price - a.price; });
  }

  function getOverBudget(){
    var b = state.budgetPerBox;
    return EED_MENUS.filter(function(m){ return m.price > b && m.price <= b + 40; })
      .sort(function(a,b){return a.price-b.price}).slice(0,3);
  }

  function getShippingFee(){
    var freeFrom = getFreeThreshold();
    var qtyFree = state.quantity >= freeFrom;
    if(state.shippingMode === 'free') return 0;
    if(state.shippingMode === 'auto'){
      return qtyFree ? 0 : 0;
    }
    if(state.shippingMode === 'manual'){
      return qtyFree ? 0 : (parseInt(state.shippingFee,10)||0);
    }
    if(state.shippingMode === 'zone'){
      if(qtyFree) return 0;
      var fees = getShipFees();
      var z = fees[state.shippingZone];
      if(z === undefined){
        // fallback to first zone fee if selected zone was deleted
        var zones = getShipZones();
        if(zones[0]) z = zones[0].fee;
        else z = 0;
      }
      return z;
    }
    return 0;
  }

  function getFoodTotal(){
    var sel = getSelectedTotals();
    if(sel.ids.length){
      return sel.price;
    }
    return state.budgetPerBox * state.quantity;
  }

  function getGrandTotal(){
    return getFoodTotal() + getShippingFee();
  }

  function saveState(){
    try{ localStorage.setItem(LS_KEY, JSON.stringify({budgetPerBox:state.budgetPerBox, quantity:state.quantity})); }catch(e){}
    try{ localStorage.setItem(LS_SHIP, JSON.stringify({mode:state.shippingMode, fee:state.shippingFee, zone:state.shippingZone})); }catch(e){}
    try{ if(state.deliveryDate) localStorage.setItem(LS_DATE, state.deliveryDate); else localStorage.removeItem(LS_DATE); }catch(e){}
    try{ if(state.deliveryTime) localStorage.setItem(LS_TIME, state.deliveryTime); else localStorage.removeItem(LS_TIME); }catch(e){}
  }
  function loadState(){
    try{
      var s = JSON.parse(localStorage.getItem(LS_KEY)||'null');
      if(s){
        if(s.budgetPerBox) state.budgetPerBox = parseInt(s.budgetPerBox,10);
        if(s.quantity) state.quantity = parseInt(s.quantity,10);
      }
      var sh = JSON.parse(localStorage.getItem(LS_SHIP)||'null');
      if(sh){
        if(sh.mode) state.shippingMode = sh.mode;
        if(typeof sh.fee !== 'undefined') state.shippingFee = parseInt(sh.fee,10)||0;
        if(sh.zone) state.shippingZone = sh.zone;
      }
      var d = localStorage.getItem(LS_DATE);
      if(d && /^\d{4}-\d{2}-\d{2}$/.test(d)) state.deliveryDate = d;
      var t = localStorage.getItem(LS_TIME);
      if(t && /^\d{2}:\d{2}$/.test(t)) state.deliveryTime = t;
    }catch(e){}
  }

  function updateSummary(){
    SHIP_FEES = getShipFees();
    var filtered = getFiltered();
    var freeFrom = getFreeThreshold();
    var freeDelivery = state.quantity >= freeFrom;
    var minWarn = state.quantity < 10;
    var foodTotal = getFoodTotal(); // from selected or budget * qty
    var baseTotal = state.budgetPerBox * state.quantity; // for totalBudget input
    var shipFee = getShippingFee();
    var grandTotal = foodTotal + shipFee;
    // for quantity label
    var displayQty = (function(){ var s=getSelectedTotals(); return s.ids.length ? s.qty : state.quantity; })();

    if(els.summaryBudgetPerBox) els.summaryBudgetPerBox.textContent = formatMoney(state.budgetPerBox);
    if(els.summaryQty) els.summaryQty.textContent = formatMoney(state.quantity);
    if(els.summaryCount) els.summaryCount.textContent = filtered.length;

    // free / shipping label in top stat
    if(els.summaryFree){
      if(freeDelivery){
        els.summaryFree.textContent = 'ส่งฟรีทั่วกรุงเทพฯ';
        els.summaryFree.style.color = 'var(--primary)';
      } else {
        if(state.shippingMode === 'auto'){
          els.summaryFree.textContent = 'ค่าส่งคิดตามระยะทาง (ฟรีเมื่อ ' + freeFrom + '+ กล่อง)';
        } else if(state.shippingMode === 'free'){
          els.summaryFree.textContent = 'ฟรี (โปรโมชั่น)';
        } else if(shipFee>0){
          els.summaryFree.textContent = 'ค่าส่ง ' + formatMoney(shipFee) + ' บาท';
        } else {
          els.summaryFree.textContent = 'ค่าส่งฟรี';
        }
        els.summaryFree.style.color = 'var(--text-muted)';
      }
    }

    if(minWarn){
      if(els.warnMin){ els.warnMin.style.display='flex'; els.warnMin.innerHTML = '<span style="font-size:1.1rem">⚠️</span><span>ออเดอร์องค์กรขั้นต่ำ 10 กล่อง (ไทย 5 กล่อง/เมนู) — ตอนนี้คุณเลือก ' + state.quantity + ' กล่อง</span>'; }
    } else {
      if(els.warnMin) els.warnMin.style.display='none';
    }

    // budget level badge
    var levelText = '';
    var levelClass = '';
    if(state.budgetPerBox < 60){ levelText='งบต่ำกว่ามาตรฐาน'; levelClass='level-low'; }
    else if(state.budgetPerBox < 90){ levelText='งบมาตรฐาน — เมนูยอดนิยมครบ'; levelClass='level-ok'; }
    else if(state.budgetPerBox < 120){ levelText='งบพรีเมียม — ได้เมนูขายดีทั้งหมด'; levelClass='level-premium'; }
    else { levelText='งบพรีเมียมพลัส — ได้ทุกเมนูรวมเซ็ต'; levelClass='level-premium'; }
    if(els.budgetLevel){ els.budgetLevel.textContent = levelText; els.budgetLevel.className = 'calc-level ' + levelClass; }

    // breakdown in green total box
    if(els.sumFood) els.sumFood.textContent = formatMoney(foodTotal) + ' บาท';
    if(els.sumQtyDup) els.sumQtyDup.textContent = formatMoney(displayQty);
    if(els.sumBudgetDup2) els.sumBudgetDup2.textContent = formatMoney(state.budgetPerBox);
    if(els.sumShip){
      if(freeDelivery && shipFee===0){
        els.sumShip.textContent = 'ฟรี';
      } else if(shipFee===0){
        // auto mode under threshold -> show 0 or รอเสนอราคา
        if(state.shippingMode === 'auto') els.sumShip.textContent = 'คิดตามระยะทาง';
        else els.sumShip.textContent = 'ฟรี';
      } else {
        els.sumShip.textContent = formatMoney(shipFee) + ' บาท';
      }
    }
    if(els.sumShipLabel){
      if(freeDelivery && shipFee===0) els.sumShipLabel.textContent = 'ค่าส่ง (ฟรี ' + freeFrom + '+ กล่อง)';
      else if(state.shippingMode === 'zone') els.sumShipLabel.textContent = 'ค่าส่ง (ตามเขต)';
      else if(state.shippingMode === 'manual') els.sumShipLabel.textContent = 'ค่าส่ง (ระบุเอง)';
      else els.sumShipLabel.textContent = 'ค่าส่ง';
    }
    if(els.sumShipSub){
      if(freeDelivery) els.sumShipSub.textContent = 'ส่งฟรี ' + freeFrom + '+ กล่อง';
      else if(shipFee>0) els.sumShipSub.textContent = 'ค่าส่ง ' + formatMoney(shipFee) + ' บาท · ฟรีเมื่อ ' + freeFrom + '+ กล่อง';
      else els.sumShipSub.textContent = 'ค่าส่งคิดตามระยะทาง · ฟรีเมื่อ ' + freeFrom + '+ กล่อง';
    }
    if(els.summaryTotal) els.summaryTotal.textContent = formatMoney(grandTotal);
    if(els.sumAvgDup){
      var avg = displayQty ? Math.round(grandTotal / displayQty) : 0;
      els.sumAvgDup.textContent = formatMoney(avg);
    }
    // shipping hint / note
    if(els.shippingHint){
      if(freeDelivery) els.shippingHint.textContent = 'ฟรีอัตโนมัติ (' + freeFrom + '+ กล่อง)';
      else if(state.shippingMode === 'auto') els.shippingHint.textContent = 'น้อยกว่า ' + freeFrom + ' กล่อง คิดตามระยะทาง';
      else if(state.shippingMode === 'manual') els.shippingHint.textContent = 'ระบุเอง' + (shipFee>0 ? ' ('+formatMoney(shipFee)+' บาท)' : '');
      else if(state.shippingMode === 'zone') els.shippingHint.textContent = shipFee>0 ? 'ตามเขต ' + formatMoney(shipFee) + ' บาท' : 'เลือกเขต';
      else if(state.shippingMode === 'free') els.shippingHint.textContent = 'โปรโมชั่นฟรี';
    }
    if(els.shippingCalcNote){
      if(freeDelivery && state.shippingMode!=='free'){
        var savedFees = getShipFees();
        els.shippingCalcNote.style.display='block';
        els.shippingCalcNote.textContent = '✓ ครบ ' + freeFrom + ' กล่องแล้ว ค่าส่งฟรีอัตโนมัติ (ประหยัด ' + (state.shippingMode==='manual' && state.shippingFee>0 ? formatMoney(state.shippingFee)+' บาท' : state.shippingMode==='zone' ? formatMoney(savedFees[state.shippingZone]||0)+' บาท' : 'ค่าส่ง') + ')';
      } else if(!freeDelivery && state.shippingMode==='zone' && shipFee>0){
        els.shippingCalcNote.style.display='block';
        var need = freeFrom - state.quantity;
        els.shippingCalcNote.textContent = 'ค่าส่งตามเขต ' + formatMoney(shipFee) + ' บาท · เพิ่มอีก ' + need + ' กล่องเพื่อส่งฟรี';
      } else if(!freeDelivery && state.shippingMode==='manual' && shipFee>0){
        els.shippingCalcNote.style.display='block';
        var need2 = freeFrom - state.quantity;
        els.shippingCalcNote.textContent = 'ค่าส่งระบุเอง ' + formatMoney(shipFee) + ' บาท · เพิ่มอีก ' + need2 + ' กล่องเพื่อส่งฟรี';
      } else if(!freeDelivery && state.shippingMode==='auto'){
        els.shippingCalcNote.style.display='block';
        var need3 = freeFrom - state.quantity;
        els.shippingCalcNote.textContent = 'โหมดอัตโนมัติ: ตอนนี้ค่าส่งคิดตามระยะทาง (ยังไม่บวกในยอด) · เพิ่มอีก ' + need3 + ' กล่องเพื่อส่งฟรี';
      } else {
        els.shippingCalcNote.style.display='none';
      }
    }
    // toggle manual / zone rows
    if(els.shippingManualRow) els.shippingManualRow.style.display = (state.shippingMode==='manual') ? 'flex' : 'none';
    if(els.shippingZoneRow) els.shippingZoneRow.style.display = (state.shippingMode==='zone') ? 'block' : 'none';
    // sync quick chips active
    if(els.shippingFeeInput) els.shippingFeeInput.value = state.shippingFee;
    syncShipQuick();

    // delivery date display
    if(els.deliveryDate) els.deliveryDate.value = state.deliveryDate || '';
    // set min to today+3 for date input (มากกว่า 3 วัน)
    var minISO = addDays(toISODate(new Date()), 3);
    if(els.deliveryDate){
      try{ els.deliveryDate.min = minISO; }catch(e){}
    }
    if(els.deliveryDateHint){
      if(state.deliveryDate){
        var th2 = formatDateTH(state.deliveryDate);
        els.deliveryDateHint.textContent = th2;
        els.deliveryDateHint.style.color = 'var(--primary)';
      } else {
        els.deliveryDateHint.textContent = 'เลือกวันที่ต้องการ (ล่วงหน้า ≥3 วัน)';
        els.deliveryDateHint.style.color = 'var(--text-muted)';
      }
    }
    if(els.deliveryDateNote){
      if(state.deliveryDate){
        var wd2 = formatDateTH(state.deliveryDate);
        var diff2 = (function(){ var today = toISODate(new Date()); var d1=new Date(today); var d2=new Date(state.deliveryDate); var ms = d2 - d1; return Math.round(ms/86400000); })();
        var txt2 = wd2 + ' ('+formatDateShort(state.deliveryDate)+')';
        if(diff2<0) txt2 += ' · ⚠️ วันที่ผ่านมาแล้ว';
        else if(diff2===0) txt2 += ' · วันนี้';
        else if(diff2===1) txt2 += ' · พรุ่งนี้';
        else txt2 += ' · อีก '+diff2+' วัน';
        var isTooSoon = diff2 < 3;
        if(isTooSoon){
          txt2 += ' — ⚠️ ต้องล่วงหน้าอย่างน้อย 3 วัน (เลือก ' + minISO + ' เป็นต้นไป)';
        } else if(diff2 < 5){
          txt2 += ' — พร้อมจัดส่ง';
        }
        els.deliveryDateNote.textContent = txt2;
        els.deliveryDateNote.style.display='block';
        els.deliveryDateNote.style.color = isTooSoon || diff2<0 ? '#7F1D1D' : 'var(--text-muted)';
        els.deliveryDateNote.style.background = isTooSoon || diff2<0 ? '#FEF2F2' : 'var(--bg)';
        els.deliveryDateNote.style.borderColor = isTooSoon || diff2<0 ? '#FECACA' : 'var(--border-light)';
      } else {
        els.deliveryDateNote.textContent = 'กรุณาเลือกวันที่ล่วงหน้าอย่างน้อย 3 วัน เพื่อให้ครัวจัดคิวได้ (เช่น วันนี้ ' + formatDateShort(toISODate(new Date())) + ' → เลือกได้ตั้งแต่ ' + formatDateShort(minISO) + ')';
        els.deliveryDateNote.style.display='block';
        els.deliveryDateNote.style.color = 'var(--text-muted)';
        els.deliveryDateNote.style.background = 'var(--bg)';
        els.deliveryDateNote.style.borderColor = 'var(--border-light)';
      }
    }
    if(els.sumDeliveryDate && els.sumDeliveryWeekday){
      if(state.deliveryDate){
        els.sumDeliveryDate.textContent = formatDateShort(state.deliveryDate);
        els.sumDeliveryWeekday.textContent = '('+formatDateTH(state.deliveryDate)+')';
        els.sumDeliveryDate.style.color = 'var(--primary)';
        if(els.sumDeliveryRow) els.sumDeliveryRow.style.borderColor='rgba(29,107,62,.18)';
        if(els.sumDeliveryRow) els.sumDeliveryRow.style.background='var(--primary-soft)';
      } else {
        els.sumDeliveryDate.textContent = '— ยังไม่เลือก';
        els.sumDeliveryWeekday.textContent = '(แตะเลือกวันที่ด้านซ้าย)';
        els.sumDeliveryDate.style.color = 'var(--text-muted)';
        if(els.sumDeliveryRow){ els.sumDeliveryRow.style.borderColor='var(--border-light)'; els.sumDeliveryRow.style.background='var(--bg)';}
      }
    }
    // delivery time display
    if(els.deliveryTime) els.deliveryTime.value = state.deliveryTime || '';
    if(els.deliveryTimeHint){
      if(state.deliveryTime){
        els.deliveryTimeHint.textContent = formatTimeTH(state.deliveryTime);
        els.deliveryTimeHint.style.color = 'var(--primary)';
      } else {
        els.deliveryTimeHint.textContent = 'เลือกเวลา';
        els.deliveryTimeHint.style.color = 'var(--text-muted)';
      }
    }
    if(els.deliveryTimeNote){
      if(state.deliveryTime){
        els.deliveryTimeNote.textContent = 'เวลา ' + formatTimeTH(state.deliveryTime) + ' — ทีมจะยืนยันคิวอีกครั้งตามคิวครัว';
        els.deliveryTimeNote.style.display='block';
        els.deliveryTimeNote.style.color='var(--text-muted)';
        els.deliveryTimeNote.style.background='var(--bg)';
        els.deliveryTimeNote.style.borderColor='var(--border-light)';
      } else if(state.deliveryDate){
        els.deliveryTimeNote.textContent = 'กรุณาเลือกเวลาส่ง (แนะนำ 08:00–12:00)';
        els.deliveryTimeNote.style.display='block';
      } else {
        els.deliveryTimeNote.style.display='none';
      }
    }
    if(els.sumDeliveryTime){
      if(state.deliveryTime){
        els.sumDeliveryTime.textContent = '⏰ ' + formatTimeTH(state.deliveryTime);
        els.sumDeliveryTime.style.display='';
        els.sumDeliveryTime.style.color='var(--primary)';
      } else if(state.deliveryDate){
        els.sumDeliveryTime.textContent = '⏰ — ยังไม่เลือกเวลา';
        els.sumDeliveryTime.style.display='';
        els.sumDeliveryTime.style.color='var(--text-muted)';
      } else {
        els.sumDeliveryTime.textContent = '';
        els.sumDeliveryTime.style.display='none';
      }
    }
    syncDateQuick();
    syncTimeQuick();

    // LINE urls — build once and sync all buttons (use grand total)
    var lineMsg = buildLineMessage(baseTotal, filtered);
    var lineUrl = 'https://line.me/R/oaMessage/%40EEDHALAL/?' + encodeURIComponent(lineMsg);
    if(els.btnLine) els.btnLine.href = lineUrl;
    if(els.btnLine2) els.btnLine2.href = lineUrl;
    if(els.btnLineSelected) els.btnLineSelected.href = lineUrl;
    var hasSelected = Object.keys(state.selected).length > 0;
    if(els.btnLine) els.btnLine.title = hasSelected ? 'ส่งเมนูที่เลือกไป LINE' : 'ส่งสรุปไป LINE';
    if(els.btnLineSelected) els.btnLineSelected.title = lineMsg;

    if(els.totalBudgetInput) els.totalBudgetInput.value = baseTotal;
  }

  function refreshShipZoneSelect(){
    var sel = document.getElementById('shippingZone');
    if(!sel) return;
    var zones = getShipZones();
    var current = state.shippingZone || (zones[0] ? zones[0].id : '');
    // if current not in zones, fallback to first
    if(!zones.some(function(z){ return z.id===current; }) && zones[0]) current = zones[0].id;
    state.shippingZone = current;
    sel.innerHTML = zones.map(function(z){
      var txt = z.label + ' — ' + (z.fee>0 ? z.fee + ' บาท' : 'สอบถาม');
      return '<option value="'+z.id+'">'+txt+'</option>';
    }).join('');
    sel.value = current;
  }

  function getToppingPriceForMenu(menuId){
    var tops = getToppingsForMenu(menuId);
    var sel = state.selectedToppings[menuId] || [];
    var sum = 0;
    sel.forEach(function(idx){ if(tops[idx]) sum += tops[idx].price; });
    return sum;
  }
  function getSelectedTotals(){
    var ids = Object.keys(state.selected);
    var qty = 0, price = 0;
    ids.forEach(function(id){
      var m = EED_MENUS.find(function(x){ return String(x.id)===String(id); });
      if(!m) return;
      var q = state.selected[id]||0;
      var topPrice = getToppingPriceForMenu(id);
      qty += q;
      price += q * (m.price + topPrice);
    });
    return { ids: ids, qty: qty, price: price, avg: qty ? Math.round(price/qty) : 0 };
  }

  function buildLineMessage(total, filtered){
    var lines = [];
    var freeFrom = getFreeThreshold();
    var freeDelivery = state.quantity >= freeFrom;
    var foodTotal = getFoodTotal();
    var shipFee = getShippingFee();
    var grand = foodTotal + shipFee;
    var sel = getSelectedTotals();
    var halalNo = (typeof EED !== 'undefined' && EED.halalCertificate) ? EED.halalCertificate : 'HL-2024-0892';
    lines.push('สรุปออเดอร์ — ข้าวกล่องฮาลาล EED HALAL');
    lines.push('');
    lines.push('มีความประสงค์ขอใบเสนอราคาข้าวกล่องฮาลาล โดยมีรายละเอียดดังนี้');
    lines.push('');
    lines.push('■ รายละเอียดออเดอร์');
    if(state.deliveryDate){
      var dtLine = '• วันที่จัดส่ง: ' + formatDateTH(state.deliveryDate) + ' (' + formatDateShort(state.deliveryDate) + ')';
      if(state.deliveryTime) dtLine += ' เวลา ' + formatTimeTH(state.deliveryTime);
      else dtLine += ' เวลา — ยังไม่ระบุ';
      lines.push(dtLine);
    } else {
      var dtLine2 = '• วันที่จัดส่ง: — ยังไม่ระบุ (โปรดแจ้งวันที่ที่สะดวก)';
      if(state.deliveryTime) dtLine2 = '• วันที่จัดส่ง: — ยังไม่ระบุ เวลา ' + formatTimeTH(state.deliveryTime) + ' (โปรดแจ้งวันที่)';
      lines.push(dtLine2);
      if(!state.deliveryTime) lines.push('• เวลาจัดส่ง: — ยังไม่ระบุ');
    }
    lines.push('• งบประมาณต่อกล่อง: ' + formatMoney(state.budgetPerBox) + ' บาท');
    lines.push('• จำนวน: ' + formatMoney(state.quantity) + ' กล่อง');
    if(state.category !== 'all') lines.push('• หมวดที่สนใจ: ' + state.category);
    // เมนู
    if(sel.ids.length){
      lines.push('');
      lines.push('■ รายการอาหารที่เลือก (' + sel.ids.length + ' เมนู รวม ' + formatMoney(sel.qty) + ' กล่อง)');
      sel.ids.forEach(function(id, idx){
        var m = EED_MENUS.find(function(x){return String(x.id)===String(id);});
        if(!m) return;
        var q = state.selected[id];
        var topPrice = getToppingPriceForMenu(id);
        var unitPrice = m.price + topPrice;
        var lineTotal = q * unitPrice;
        var topNames = (state.selectedToppings[id]||[]).map(function(ti){ var t=getToppingsForMenu(id)[ti]; return t? t.name : null; }).filter(Boolean);
        var topSuffix = topNames.length ? ' + ' + topNames.join(', ') + (topPrice>0 ? ' (+'+formatMoney(topPrice)+'บ.)' : '') : '';
        lines.push('  ' + (idx+1) + '. ' + m.name + topSuffix + ' — ' + formatMoney(unitPrice) + ' บาท/กล่อง × ' + formatMoney(q) + ' กล่อง = ' + formatMoney(lineTotal) + ' บาท');
      });
      lines.push('  รวมค่าอาหาร: ' + formatMoney(sel.price) + ' บาท (เฉลี่ย ' + formatMoney(sel.avg) + ' บาท/กล่อง)');
      if(sel.qty !== state.quantity){
        lines.push('  หมายเหตุ: จำนวนที่เลือก ' + formatMoney(sel.qty) + ' กล่อง แตกต่างจากจำนวนที่ระบุ ' + formatMoney(state.quantity) + ' กล่อง — โปรดยืนยันจำนวนสุทธิ');
      }
    } else {
      lines.push('• ค่าอาหารประมาณการ: ' + formatMoney(foodTotal) + ' บาท (' + formatMoney(state.quantity) + ' กล่อง × ' + formatMoney(state.budgetPerBox) + ' บาท)');
      if(filtered.length){
        lines.push('• ตัวอย่างเมนูในงบ ' + formatMoney(state.budgetPerBox) + ' บาท (' + filtered.length + ' เมนู) เช่น ' + filtered.slice(0,3).map(function(m){return m.name + ' ' + formatMoney(m.price) + ' บาท';}).join(', '));
      } else {
        lines.push('• หมายเหตุ: ไม่พบเมนูในงบและหมวดที่เลือก — โปรดปรับงบหรือหมวด');
      }
    }
    // shipping
    lines.push('');
    lines.push('■ สรุปยอด');
    if(sel.ids.length){
      lines.push('• ค่าอาหาร: ' + formatMoney(foodTotal) + ' บาท');
    } else {
      lines.push('• ค่าอาหาร (ประมาณการ): ' + formatMoney(foodTotal) + ' บาท');
    }
    if(freeDelivery){
      lines.push('• ค่าจัดส่ง: ฟรี (ครบ ' + formatMoney(freeFrom) + ' กล่อง ส่งฟรีทั่วกรุงเทพฯ)');
    } else {
      if(state.shippingMode === 'auto'){
        lines.push('• ค่าจัดส่ง: คิดตามระยะทาง (ฟรีเมื่อครบ ' + formatMoney(freeFrom) + ' กล่อง)');
      } else if(state.shippingMode === 'free'){
        lines.push('• ค่าจัดส่ง: ฟรี (โปรโมชั่น)');
      } else if(state.shippingMode === 'manual'){
        lines.push('• ค่าจัดส่ง: ' + (shipFee>0 ? formatMoney(shipFee)+' บาท (ระบุเอง)' : 'ฟรี'));
      } else if(state.shippingMode === 'zone'){
        var zoneName = (function(){ var el=document.getElementById('shippingZone'); if(el && el.options[el.selectedIndex]) return el.options[el.selectedIndex].text; return state.shippingZone; })();
        lines.push('• ค่าจัดส่ง: ' + (shipFee>0 ? formatMoney(shipFee)+' บาท ('+zoneName+')' : 'สอบถามตามเขตพื้นที่'));
      }
    }
    lines.push('• ยอดสุทธิ: ' + formatMoney(grand) + ' บาท' + (shipFee>0 ? ' (ค่าอาหาร ' + formatMoney(foodTotal) + ' บาท + ค่าจัดส่ง ' + formatMoney(shipFee) + ' บาท)' : freeDelivery ? ' (รวมจัดส่งฟรี)' : ''));
    if(!freeDelivery && state.shippingMode==='auto'){
      lines.push('  หมายเหตุ: ยอดสุทธิดังกล่าวยังไม่รวมค่าจัดส่งจริง จะแจ้งยอดที่ชัดเจนในใบเสนอราคา');
    }
    lines.push('');
    lines.push('จึงเรียนมาเพื่อโปรดจัดทำใบเสนอราคาและยืนยันคิวจัดส่ง');
    lines.push('ขอขอบพระคุณครับ/ค่ะ');
    lines.push('');
    lines.push('—');
    lines.push('ส่งจากระบบคำนวณงบ eedhalal.com/budget-calculator');
    lines.push('ฮาลาลรับรอง CICOT ' + halalNo + ' | ราคาสุทธิ ไม่มี VAT | ขั้นต่ำ ' + (typeof EED!=='undefined'?EED.minOrder:'10') + ' กล่อง');
    return lines.join('\n');
  }

  function fallbackCopy(text){
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly','');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try{ document.execCommand('copy'); }catch(e){}
    document.body.removeChild(ta);
  }

  function copyText(text){
    if(navigator.clipboard && navigator.clipboard.writeText){
      return navigator.clipboard.writeText(text).catch(function(){ fallbackCopy(text); });
    } else {
      fallbackCopy(text);
      return Promise.resolve();
    }
  }

  function showCopyFeedback(btn, okText, origText){
    if(!btn) return;
    var orig = origText || btn.textContent;
    btn.textContent = okText || 'คัดลอกแล้ว ✓';
    btn.disabled = true;
    setTimeout(function(){ btn.textContent = orig; btn.disabled = false; }, 1800);
  }

  function renderResults(){
    var filtered = getFiltered();
    var over = getOverBudget();
    var html = '';

    if(state.budgetPerBox < 60){
      html += '<div class="calc-empty">'
        + '<div style="font-size:2.2rem">💡</div>'
        + '<h3 style="margin-top:.6rem;font-size:1.15rem;font-weight:900;color:var(--primary)">งบ '+state.budgetPerBox+' บาท ยังต่ำกว่ามาตรฐาน</h3>'
        + '<p style="margin-top:.5rem;font-size:.92rem;line-height:1.7;color:var(--text-muted)">เมนูเริ่มต้นที่ <b>60 บาท/กล่อง</b> ครับ เพิ่มอีก '+(60-state.budgetPerBox)+' บาท ก็ได้เมนูยอดนิยมแล้ว เช่น ข้าวกะเพราไก่, ผัดไทยกุ้งสด</p>'
        + '<div style="margin-top:1rem;display:flex;gap:.6rem;justify-content:center;flex-wrap:wrap">'
        + '<button class="btn btn-primary btn-sm" onclick="document.getElementById(\'budgetRange\').value=60;document.getElementById(\'budgetRange\').dispatchEvent(new Event(\'input\'))">ปรับเป็น 60 บาท</button>'
        + '<a href="popular-menu.html" class="btn btn-outline btn-sm">ดูเมนูทั้งหมด</a>'
        + '</div></div>';
      els.resultsGrid.innerHTML = html;
      els.overSection.style.display='none';
      els.countLabel.textContent = '0 เมนูในงบ '+state.budgetPerBox+' บาท';
      return;
    }

    if(filtered.length===0){
      html = '<div class="calc-empty"><p style="color:var(--text-muted)">ไม่พบเมนูในหมวดนี้ที่อยู่ในงบ ลองเปลี่ยนหมวดเป็น "ทั้งหมด"</p></div>';
      els.resultsGrid.innerHTML = html;
    } else {
      html = filtered.map(function(m){
        var isSelected = !!state.selected[m.id];
        var qty = state.selected[m.id]||0;
        var tops = Array.isArray(m.toppings) ? m.toppings : [];
        var selTops = state.selectedToppings[m.id] || [];
        var toppingsHtml = '';
        if(tops.length){
          toppingsHtml = '<div style="margin-top:.55rem"><div style="font-size:.72rem;font-weight:800;color:var(--primary);margin-bottom:.3rem">เลือกท็อปปิ้งเพิ่ม (คิดต่อกล่อง)</div><div style="display:flex;flex-wrap:wrap;gap:.35rem">'
            + tops.map(function(t, ti){
                var active = selTops.indexOf(ti) !== -1;
                return '<button type="button" data-top="'+m.id+':'+ti+'" style="border:1px solid '+(active?'var(--primary)':'var(--border)')+';background:'+(active?'var(--primary)':'var(--white)')+';color:'+(active?'#fff':'var(--text-muted)')+';border-radius:999px;padding:.2rem .55rem;font-size:.72rem;font-weight:700;cursor:pointer">+ '+t.name+' '+ (t.price>0? '+'+t.price+'บ.' : '') + (active?' ✓':'')+'</button>';
              }).join('') + '</div></div>';
        }
        return '<article class="calc-card '+(isSelected?'selected':'')+'" data-id="'+m.id+'">'
          + '<div class="calc-card-img-wrap">'
          + '<img src="'+m.image+'" alt="'+m.name+'" loading="lazy" onerror="this.onerror=null;this.src=\'img/logo.jpg\';this.style.objectFit=\'contain\';this.style.padding=\'1rem\';this.style.background=\'#f9fafb\'">'
          + (m.badge ? '<span class="calc-badge">'+m.badge+'</span>' : '')
          + '<span class="calc-price-badge">'+m.price+' บาท</span>'
          + '</div>'
          + '<div class="calc-card-body">'
          + '<div class="calc-card-cat">'+m.category+' · ขั้นต่ำ '+m.minPerMenu+' กล่อง/เมนู</div>'
          + '<h3 class="calc-card-title">'+m.name+'</h3>'
          + '<p class="calc-card-desc">'+m.desc+'</p>'
          + toppingsHtml
          + '<div class="calc-card-actions">'
          + (isSelected
              ? '<div class="calc-qty-row"><button class="calc-qty-btn" data-act="dec" data-id="'+m.id+'">−</button><span class="calc-qty-num">'+qty+' กล่อง</span><button class="calc-qty-btn" data-act="inc" data-id="'+m.id+'">+</button></div><button class="calc-select-btn selected" data-act="toggle" data-id="'+m.id+'">✓ เลือกแล้ว</button>'
              : '<button class="calc-select-btn" data-act="toggle" data-id="'+m.id+'">+ เลือกเมนูนี้</button>')
          + '</div>'
          + '</div>'
        + '</article>';
      }).join('');
      els.resultsGrid.innerHTML = html;
    }

    // over budget section
    if(over.length>0 && state.budgetPerBox < 120){
      var overHtml = over.map(function(m){
        return '<div class="calc-over-item"><span class="calc-over-name">'+m.name+'</span><span class="calc-over-dots"></span><span class="calc-over-price">+'+(m.price - state.budgetPerBox)+' บาท → '+m.price+' บ.</span></div>';
      }).join('');
      els.overList.innerHTML = overHtml;
      els.overSection.style.display='block';
      els.overTitle.textContent = 'เพิ่มอีกนิด ได้เมนูพรีเมียม';
    } else {
      els.overSection.style.display='none';
    }

    els.countLabel.textContent = filtered.length + ' เมนูในงบ ' + state.budgetPerBox + ' บาท' + (state.category!=='all' ? ' · หมวด'+state.category : '');

    // selected summary
    renderSelected();

    // bind card buttons
    els.resultsGrid.querySelectorAll('[data-act]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var id = this.getAttribute('data-id');
        var act = this.getAttribute('data-act');
        if(act==='toggle'){
          if(state.selected[id]){ delete state.selected[id]; delete state.selectedToppings[id]; }
          else state.selected[id]= Math.max( (function(){ var mm=EED_MENUS.find(function(x){return String(x.id)===String(id);}); return mm? mm.minPerMenu:5; })(), state.quantity ? Math.ceil(state.quantity/2) : 5);
          renderResults();
          updateSummary();
        } else if(act==='inc'){
          state.selected[id] = (state.selected[id]||0)+1;
          renderResults(); updateSummary();
        } else if(act==='dec'){
          state.selected[id] = (state.selected[id]||0)-1;
          if(state.selected[id]<=0){ delete state.selected[id]; delete state.selectedToppings[id]; }
          renderResults(); updateSummary();
        }
      });
    });
    // bind topping toggles
    els.resultsGrid.querySelectorAll('[data-top]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var parts = (this.getAttribute('data-top')||'').split(':');
        var mid = parts[0]; var ti = parseInt(parts[1],10);
        if(isNaN(ti)) return;
        // auto select menu if not selected
        if(!state.selected[mid]){
          var mm = EED_MENUS.find(function(x){return String(x.id)===String(mid);});
          state.selected[mid]= Math.max(mm?mm.minPerMenu:5, state.quantity ? Math.ceil(state.quantity/2) : 5);
        }
        if(!state.selectedToppings[mid]) state.selectedToppings[mid]=[];
        var idx = state.selectedToppings[mid].indexOf(ti);
        if(idx!==-1) state.selectedToppings[mid].splice(idx,1);
        else state.selectedToppings[mid].push(ti);
        if(state.selectedToppings[mid].length===0) delete state.selectedToppings[mid];
        renderResults();
        updateSummary();
      });
    });
  }

  function renderSelected(){
    var ids = Object.keys(state.selected);
    if(ids.length===0){
      els.selectedSection.style.display='none';
      return;
    }
    els.selectedSection.style.display='block';
    var totalSelectedQty = 0;
    var totalSelectedPrice = 0;
    var html = ids.map(function(id){
      var m = EED_MENUS.find(function(x){ return String(x.id)===String(id); });
      var qty = state.selected[id];
      var topPrice = getToppingPriceForMenu(id);
      var unitPrice = m.price + topPrice;
      totalSelectedQty += qty;
      totalSelectedPrice += qty * unitPrice;
      var topNames = (state.selectedToppings[id]||[]).map(function(ti){ var t=getToppingsForMenu(id)[ti]; return t? t.name+' (+'+t.price+'บ.)' : null; }).filter(Boolean).join(', ');
      var topLine = topNames ? '<div style="font-size:.72rem;color:var(--primary);font-weight:700">+ '+topNames+'</div>' : '';
      return '<div class="calc-selected-row">'
        + '<img src="'+m.image+'" alt="" style="width:44px;height:44px;border-radius:10px;object-fit:cover" onerror="this.onerror=null;this.src=\'img/logo.jpg\';this.style.objectFit=\'contain\';this.style.background=\'#f9fafb\'">'
        + '<div style="flex:1;min-width:0"><div style="font-weight:800;font-size:.92rem;line-height:1.2">'+m.name+'</div>'+topLine+'<div style="font-size:.78rem;color:var(--text-muted)">'+unitPrice+' บาท × '+qty+' = '+formatMoney(unitPrice*qty)+' บาท'+(topPrice>0?' <span style="color:var(--text-muted)">(ฐาน '+m.price+'+ท็อปปิ้ง '+topPrice+')</span>':'')+'</div></div>'
        + '<button class="calc-remove-btn" data-remove="'+id+'" aria-label="ลบ">×</button>'
        + '</div>';
    }).join('');
    els.selectedList.innerHTML = html;
    els.selectedQty.textContent = totalSelectedQty;
    els.selectedTotal.textContent = formatMoney(totalSelectedPrice);
    els.selectedAvg.textContent = totalSelectedQty ? formatMoney(Math.round(totalSelectedPrice/totalSelectedQty)) : '0';

    // warn if total qty != state's quantity
    if(totalSelectedQty !== state.quantity){
      els.selectedWarn.textContent = 'ตอนนี้เลือก '+totalSelectedQty+' กล่อง (คุณตั้งไว้ '+state.quantity+' กล่อง) — ปรับจำนวนแต่ละเมนูให้รวมเท่าที่ต้องการได้ครับ';
      els.selectedWarn.style.display='block';
    } else {
      els.selectedWarn.style.display='none';
    }

    els.selectedList.querySelectorAll('[data-remove]').forEach(function(b){
      b.addEventListener('click', function(){
        var rid = this.getAttribute('data-remove');
        delete state.selected[rid];
        delete state.selectedToppings[rid];
        renderResults(); updateSummary();
      });
    });

    // update LINE buttons again (selected totals need same message)
    var total = state.budgetPerBox * state.quantity;
    var filtered = getFiltered();
    var lineMsg = buildLineMessage(total, filtered);
    var lineUrl = 'https://line.me/R/oaMessage/%40EEDHALAL/?' + encodeURIComponent(lineMsg);
    if(els.btnLine) els.btnLine.href = lineUrl;
    if(els.btnLine2) els.btnLine2.href = lineUrl;
    if(els.btnLineSelected) els.btnLineSelected.href = lineUrl;
    if(els.btnLineSelected) els.btnLineSelected.title = lineMsg;
  }

  function initControls(){
    loadState();
    // Prices, minimum order quantities and toppings come from js/menu-data.js.
    // They are intentionally static so every visitor sees the same catalog.
    els.budgetRange = $('budgetRange');
    els.budgetNumber = $('budgetNumber');
    els.qtyNumber = $('qtyNumber');
    els.qtyRange = $('qtyRange');
    els.totalBudgetInput = $('totalBudget');
    els.categoryChips = document.querySelectorAll('[data-cat]');
    els.resultsGrid = $('calcResults');
    els.countLabel = $('calcCount');
    els.overSection = $('calcOver');
    els.overList = $('calcOverList');
    els.overTitle = $('calcOverTitle');
    els.summaryBudgetPerBox = $('sumBudget');
    els.summaryQty = $('sumQty');
    els.summaryTotal = $('sumTotal');
    els.summaryCount = $('sumCount');
    els.summaryFree = $('sumFree');
    els.warnMin = $('calcWarnMin');
    els.budgetLevel = $('budgetLevel');
    els.btnLine = $('calcLineBtn');
    els.btnLine2 = $('calcLineBtn2');
    els.btnLineSelected = $('lineSelected');
    els.btnCopySelected = $('copySelected');
    els.copyToast = $('copyToast');
    els.selectedSection = $('calcSelected');
    els.selectedList = $('calcSelectedList');
    els.selectedQty = $('selectedQty');
    els.selectedTotal = $('selectedTotal');
    els.selectedAvg = $('selectedAvg');
    els.selectedWarn = $('selectedWarn');
    // shipping
    els.shippingMode = $('shippingMode');
    els.shippingFeeInput = $('shippingFee');
    els.shippingZone = $('shippingZone');
    els.shippingManualRow = $('shippingManualRow');
    els.shippingZoneRow = $('shippingZoneRow');
    els.shippingHint = $('shippingHint');
    els.shippingCalcNote = $('shippingCalcNote');
    els.shipDec = $('shipDec');
    els.shipInc = $('shipInc');
    els.sumFood = $('sumFood');
    els.sumShip = $('sumShip');
    els.sumShipLabel = $('sumShipLabel');
    els.sumShipSub = $('sumShipSub');
    els.sumQtyDup = $('sumQtyDup');
    els.sumBudgetDup2 = $('sumBudgetDup2');
    els.sumAvgDup = $('sumAvgDup');
    // delivery date + time
    els.deliveryDate = $('deliveryDate');
    els.deliveryDateHint = $('deliveryDateHint');
    els.deliveryDateNote = $('deliveryDateNote');
    els.deliveryTime = $('deliveryTime');
    els.deliveryTimeHint = $('deliveryTimeHint');
    els.deliveryTimeNote = $('deliveryTimeNote');
    els.sumDeliveryRow = $('sumDeliveryRow');
    els.sumDeliveryDate = $('sumDeliveryDate');
    els.sumDeliveryWeekday = $('sumDeliveryWeekday');
    els.sumDeliveryTime = $('sumDeliveryTime');

    // init values
    refreshShipZoneSelect();
    // ensure state.shippingZone is valid after refresh
    if(els.shippingZone) els.shippingZone.value = state.shippingZone;
    els.budgetRange.value = state.budgetPerBox;
    els.budgetNumber.value = state.budgetPerBox;
    els.qtyNumber.value = state.quantity;
    els.qtyRange.value = state.quantity;
    if(els.shippingMode) els.shippingMode.value = state.shippingMode;
    if(els.shippingFeeInput) els.shippingFeeInput.value = state.shippingFee;
    // set active chip
    document.querySelectorAll('[data-cat]').forEach(function(c){
      if(c.getAttribute('data-cat')===state.category) c.classList.add('active');
      else c.classList.remove('active');
    });
    // quick buttons active
    syncQuickButtons();

    // events
    els.budgetRange.addEventListener('input', function(){
      state.budgetPerBox = parseInt(this.value,10);
      els.budgetNumber.value = state.budgetPerBox;
      syncQuickButtons(); updateSummary(); renderResults(); saveState();
    });
    els.budgetNumber.addEventListener('input', function(){
      var v = parseInt(this.value,10);
      if(isNaN(v)) return;
      v = Math.max(40, Math.min(200, v));
      state.budgetPerBox = v;
      els.budgetRange.value = v;
      syncQuickButtons(); updateSummary(); renderResults(); saveState();
    });
    els.qtyRange.addEventListener('input', function(){
      state.quantity = parseInt(this.value,10);
      els.qtyNumber.value = state.quantity;
      syncQtyQuick(); updateSummary(); renderResults(); saveState();
    });
    els.qtyNumber.addEventListener('input', function(){
      var v = parseInt(this.value,10);
      if(isNaN(v) || v<1) return;
      v = Math.max(1, Math.min(500, v));
      state.quantity = v;
      els.qtyRange.value = v;
      syncQtyQuick(); updateSummary(); renderResults(); saveState();
    });
    els.totalBudgetInput.addEventListener('input', function(){
      var total = parseInt(this.value,10);
      if(isNaN(total) || total<0) return;
      var perBox = Math.ceil(total / Math.max(1, state.quantity));
      perBox = Math.max(40, Math.min(200, perBox));
      state.budgetPerBox = perBox;
      els.budgetRange.value = perBox;
      els.budgetNumber.value = perBox;
      syncQuickButtons(); updateSummary(); renderResults(); saveState();
    });

    // quick budget buttons
    document.querySelectorAll('[data-budget]').forEach(function(b){
      b.addEventListener('click', function(){
        var v = parseInt(this.getAttribute('data-budget'),10);
        state.budgetPerBox = v;
        els.budgetRange.value = v;
        els.budgetNumber.value = v;
        syncQuickButtons(); updateSummary(); renderResults(); saveState();
        // tracking
        if(window.emitTrackingEvent) try{ emitTrackingEvent('budget_calculator_change', {budget_per_box: v, source:'quick_button'});}catch(e){}
      });
    });
    document.querySelectorAll('[data-qty]').forEach(function(b){
      b.addEventListener('click', function(){
        var v = parseInt(this.getAttribute('data-qty'),10);
        state.quantity = v;
        els.qtyNumber.value = v;
        els.qtyRange.value = v;
        syncQtyQuick(); updateSummary(); renderResults(); saveState();
      });
    });
    // category chips
    els.categoryChips.forEach(function(chip){
      chip.addEventListener('click', function(){
        state.category = this.getAttribute('data-cat');
        document.querySelectorAll('[data-cat]').forEach(function(c){ c.classList.remove('active'); });
        this.classList.add('active');
        renderResults();
      });
    });

    // stepper buttons
    $('qtyDec').addEventListener('click', function(){
      state.quantity = Math.max(1, state.quantity-1);
      els.qtyNumber.value = state.quantity;
      els.qtyRange.value = state.quantity;
      syncQtyQuick(); updateSummary(); renderResults(); saveState();
    });
    $('qtyInc').addEventListener('click', function(){
      state.quantity = Math.min(500, state.quantity+1);
      els.qtyNumber.value = state.quantity;
      els.qtyRange.value = state.quantity;
      syncQtyQuick(); updateSummary(); renderResults(); saveState();
    });
    $('budgetDec').addEventListener('click', function(){
      state.budgetPerBox = Math.max(40, state.budgetPerBox-5);
      els.budgetRange.value = state.budgetPerBox;
      els.budgetNumber.value = state.budgetPerBox;
      syncQuickButtons(); updateSummary(); renderResults(); saveState();
    });
    $('budgetInc').addEventListener('click', function(){
      state.budgetPerBox = Math.min(200, state.budgetPerBox+5);
      els.budgetRange.value = state.budgetPerBox;
      els.budgetNumber.value = state.budgetPerBox;
      syncQuickButtons(); updateSummary(); renderResults(); saveState();
    });

    // shipping
    if(els.shippingMode) els.shippingMode.addEventListener('change', function(){
      state.shippingMode = this.value;
      updateSummary(); saveState();
      if(window.emitTrackingEvent) try{ emitTrackingEvent('budget_shipping_mode', {mode: state.shippingMode});}catch(e){}
    });
    if(els.shippingFeeInput) els.shippingFeeInput.addEventListener('input', function(){
      var v = parseInt(this.value,10);
      if(isNaN(v) || v<0) v=0;
      v = Math.max(0, Math.min(2000, v));
      state.shippingFee = v;
      state.shippingMode = 'manual';
      if(els.shippingMode) els.shippingMode.value = 'manual';
      updateSummary(); saveState();
    });
    if(els.shippingZone) els.shippingZone.addEventListener('change', function(){
      state.shippingZone = this.value;
      state.shippingMode = 'zone';
      if(els.shippingMode) els.shippingMode.value = 'zone';
      updateSummary(); saveState();
    });
    if(els.shipDec) els.shipDec.addEventListener('click', function(){
      state.shippingFee = Math.max(0, (parseInt(state.shippingFee,10)||0) - 20);
      if(els.shippingFeeInput) els.shippingFeeInput.value = state.shippingFee;
      state.shippingMode = 'manual';
      if(els.shippingMode) els.shippingMode.value = 'manual';
      updateSummary(); saveState();
    });
    if(els.shipInc) els.shipInc.addEventListener('click', function(){
      state.shippingFee = Math.min(2000, (parseInt(state.shippingFee,10)||0) + 20);
      if(els.shippingFeeInput) els.shippingFeeInput.value = state.shippingFee;
      state.shippingMode = 'manual';
      if(els.shippingMode) els.shippingMode.value = 'manual';
      updateSummary(); saveState();
    });
    document.querySelectorAll('[data-ship]').forEach(function(b){
      b.addEventListener('click', function(){
        var v = parseInt(this.getAttribute('data-ship'),10);
        state.shippingFee = v;
        state.shippingMode = 'manual';
        if(els.shippingMode) els.shippingMode.value = 'manual';
        if(els.shippingFeeInput) els.shippingFeeInput.value = v;
        updateSummary(); saveState();
      });
    });

    // delivery date — บังคับล่วงหน้า ≥3 วัน
    if(els.deliveryDate) els.deliveryDate.addEventListener('change', function(){
      var v = this.value;
      if(v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) v='';
      var minISO = addDays(toISODate(new Date()), 3);
      if(v && v < minISO){
        // ถ้าเลือกน้อยกว่า 3 วัน ให้เด้งไป min และแจ้ง
        v = minISO;
        this.value = v;
        if(els.deliveryDateNote){
          els.deliveryDateNote.textContent = '⚠️ ครัวต้องเตรียมล่วงหน้าอย่างน้อย 3 วัน — ปรับเป็น ' + formatDateTH(v) + ' (' + formatDateShort(v) + ') ให้อัตโนมัติ';
          els.deliveryDateNote.style.display='block';
          els.deliveryDateNote.style.color='#7F1D1D';
          els.deliveryDateNote.style.background='#FEF2F2';
          els.deliveryDateNote.style.borderColor='#FECACA';
        }
      }
      state.deliveryDate = v;
      updateSummary(); saveState();
      if(window.emitTrackingEvent) try{ emitTrackingEvent('budget_delivery_date', {date: v});}catch(e){}
    });
    document.querySelectorAll('[data-date]').forEach(function(b){
      b.addEventListener('click', function(){
        var type = this.getAttribute('data-date');
        var iso = '';
        var today = toISODate(new Date());
        if(type==='today') iso = today;
        else if(type==='tomorrow') iso = addDays(today,1);
        else if(type==='+2') iso = addDays(today,2);
        else if(type==='+3') iso = addDays(today,3);
        else if(type==='+4') iso = addDays(today,4);
        else if(type==='+7') iso = addDays(today,7);
        else if(type==='+14') iso = addDays(today,14);
        else if(type==='nextweek') iso = addDays(today,7);
        state.deliveryDate = iso;
        if(els.deliveryDate) els.deliveryDate.value = iso;
        updateSummary(); saveState();
      });
    });
    // delivery time
    if(els.deliveryTime) els.deliveryTime.addEventListener('change', function(){
      var v = this.value;
      if(v && !/^\d{2}:\d{2}$/.test(v)) v='';
      state.deliveryTime = v;
      updateSummary(); saveState();
      if(window.emitTrackingEvent) try{ emitTrackingEvent('budget_delivery_time', {time: v});}catch(e){}
    });
    document.querySelectorAll('[data-time]').forEach(function(b){
      b.addEventListener('click', function(){
        var t = this.getAttribute('data-time');
        state.deliveryTime = t;
        if(els.deliveryTime) els.deliveryTime.value = t;
        updateSummary(); saveState();
      });
    });

    // clear selection
    var clearBtn = $('clearSelection');
    if(clearBtn) clearBtn.addEventListener('click', function(){
      state.selected = {};
      state.selectedToppings = {};
      renderResults(); updateSummary();
    });

    // share / copy — สรุปหลัก (คัดลอกแล้วส่ง LINE ได้)
    var copyBtn = $('copySummary');
    if(copyBtn) copyBtn.addEventListener('click', function(){
      var total = state.budgetPerBox * state.quantity;
      var msg = buildLineMessage(total, getFiltered());
      copyText(msg).then(function(){
        showCopyFeedback(copyBtn, 'คัดลอกแล้ว ✓', 'คัดลอกสรุป');
        if(els.copyToast && Object.keys(state.selected).length){
          els.copyToast.style.display='block';
          els.copyToast.textContent = 'คัดลอกเมนูที่เลือกแล้ว! นำไปวางใน LINE ได้เลย ✓';
          setTimeout(function(){ if(els.copyToast) els.copyToast.style.display='none'; }, 2200);
        }
        if(window.emitTrackingEvent) try{ emitTrackingEvent('budget_copy', {has_selected: Object.keys(state.selected).length>0});}catch(e){}
      });
    });

    // คัดลอกเฉพาะเมนูที่เลือก (ในกล่อง เมนูที่เลือก)
    if(els.btnCopySelected) els.btnCopySelected.addEventListener('click', function(){
      var total = state.budgetPerBox * state.quantity;
      var msg = buildLineMessage(total, getFiltered());
      if(!Object.keys(state.selected).length){
        // ถ้ายังไม่ได้เลือก ให้คัดลอกสรุปงบทั่วไปแทน
        copyText(msg).then(function(){
          showCopyFeedback(els.btnCopySelected, 'คัดลอกแล้ว ✓', 'คัดลอกเมนูที่เลือก');
        });
        return;
      }
      copyText(msg).then(function(){
        showCopyFeedback(els.btnCopySelected, 'คัดลอกแล้ว ✓', 'คัดลอกเมนูที่เลือก');
        if(els.copyToast){
          els.copyToast.style.display='block';
          els.copyToast.textContent = 'คัดลอกเมนูที่เลือกแล้ว! นำไปวางใน LINE ได้เลย ✓';
          setTimeout(function(){ if(els.copyToast) els.copyToast.style.display='none'; }, 2200);
        }
        if(window.emitTrackingEvent) try{ emitTrackingEvent('budget_copy_selected', {count: Object.keys(state.selected).length});}catch(e){}
      });
    });

    // กดส่ง LINE ที่กล่องเมนูที่เลือก — tracking
    if(els.btnLineSelected) els.btnLineSelected.addEventListener('click', function(){
      if(window.emitTrackingEvent) try{ emitTrackingEvent('budget_line_selected', {count: Object.keys(state.selected).length});}catch(e){}
    });
    if(els.btnLine) els.btnLine.addEventListener('click', function(){
      if(window.emitTrackingEvent) try{ emitTrackingEvent('budget_line_main', {budget_per_box: state.budgetPerBox, quantity: state.quantity, has_selected: Object.keys(state.selected).length>0});}catch(e){}
    });

    // initial render
    updateSummary();
    renderResults();
  } // end initControls

  // Customer selections may sync between tabs, but the catalog itself is static.
  window.addEventListener('storage', function(e){
    if((e.key !== LS_SHIP && e.key !== LS_DATE && e.key !== LS_TIME) || !els.resultsGrid) return;
    if(e.key === LS_SHIP || e.key === LS_DATE || e.key === LS_TIME){ loadState(); }
    SHIP_FEES = getShipFees();
    updateSummary();
    renderResults();
  });

  function syncQuickButtons(){
    document.querySelectorAll('[data-budget]').forEach(function(b){
      var v = parseInt(b.getAttribute('data-budget'),10);
      if(v===state.budgetPerBox) b.classList.add('active');
      else b.classList.remove('active');
    });
  }
  function syncQtyQuick(){
    document.querySelectorAll('[data-qty]').forEach(function(b){
      var v = parseInt(b.getAttribute('data-qty'),10);
      if(v===state.quantity) b.classList.add('active');
      else b.classList.remove('active');
    });
  }
  function syncShipQuick(){
    document.querySelectorAll('[data-ship]').forEach(function(b){
      var v = parseInt(b.getAttribute('data-ship'),10);
      if(state.shippingMode==='manual' && v===parseInt(state.shippingFee,10)) b.classList.add('active');
      else b.classList.remove('active');
    });
  }
  function syncDateQuick(){
    var today = toISODate(new Date());
    document.querySelectorAll('[data-date]').forEach(function(b){
      var type = b.getAttribute('data-date');
      var iso = '';
      if(type==='today') iso = today;
      else if(type==='tomorrow') iso = addDays(today,1);
      else if(type==='+2') iso = addDays(today,2);
      else if(type==='+3') iso = addDays(today,3);
      else if(type==='+4') iso = addDays(today,4);
      else if(type==='+7') iso = addDays(today,7);
      else if(type==='+14') iso = addDays(today,14);
      else if(type==='nextweek') iso = addDays(today,7);
      if(iso && iso===state.deliveryDate) b.classList.add('active');
      else b.classList.remove('active');
    });
  }
  function syncTimeQuick(){
    document.querySelectorAll('[data-time]').forEach(function(b){
      var t = b.getAttribute('data-time');
      if(t===state.deliveryTime) b.classList.add('active');
      else b.classList.remove('active');
    });
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', initControls);
  } else {
    initControls();
  }

  // expose for inline handlers
  window._eedCalcState = state;

})();
