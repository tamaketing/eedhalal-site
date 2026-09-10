(function(){
  'use strict';

  var LS_KEY = 'eed_budget_calc_v1';
  var LS_SHIP = 'eed_budget_ship_v1';
  var LS_DATE = 'eed_delivery_date_v1';
  var LS_TIME = 'eed_delivery_time_v1';
  var LS_SELLING = 'eed_selling_v1';
  var LS_MINS = 'eed_mins_v1';
  var LS_TOPPINGS = 'eed_toppings_v1';
  var LS_IMAGES = 'eed_images_v1';
  var LS_NAMES = 'eed_names_v1';
  var LS_CATEGORIES = 'eed_categories_v1';
  var LS_DELETED = 'eed_deleted_v1';
  var LS_NEW_MENUS = 'eed_new_menus_v1';
  var LS_MEATS = 'eed_meats_v1';
  var LS_NO_MEAT = 'eed_no_meat_v1';
  var els = {};

  /* ── Zone lookup ── */
  function getShippingZones(){
    // Delivery policy is generated from data/business-rules.json.
    if(typeof EED !== 'undefined' && EED.shippingZones) return EED.shippingZones;
    return {};
  }
  function getCarMinQty(){
    if(typeof EED !== 'undefined' && EED.shippingCarMinQty) return parseInt(EED.shippingCarMinQty,10)||40;
    return 40;
  }
  function lookupDistrict(district){
    var zones = getShippingZones();
    var d = (district||'').trim().toLowerCase();
    if(!d) return null;
    for(var zid in zones){
      if(!zones.hasOwnProperty(zid)) continue;
      var arr = zones[zid].districts || [];
      for(var i=0;i<arr.length;i++){
        if(String(arr[i]).trim().toLowerCase() === d) return { zoneId: zid, moto: zones[zid].moto||0, car: zones[zid].car||0 };
      }
    }
    return null;
  }
  function getDistrictFeeForQty(zoneId, qty){
    var zones = getShippingZones();
    var z = zones[zoneId];
    if(!z) return 0;
    var carMin = getCarMinQty();
    return (qty > carMin) ? (z.car||0) : (z.moto||0);
  }
  function getDistrictSuggestions(partial){
    var zones = getShippingZones();
    var results = [];
    var p = (partial||'').trim().toLowerCase();
    if(!p) return results;
    for(var zid in zones){
      if(!zones.hasOwnProperty(zid)) continue;
      var arr = zones[zid].districts || [];
      for(var i=0;i<arr.length;i++){
        if(arr[i].toLowerCase().indexOf(p) !== -1) results.push(arr[i]);
      }
    }
    return results;
  }

  function getShipFees(){
    var zones = getShippingZones();
    var map = {};
    var qty = state.quantity || 0;
    var carMin = getCarMinQty();
    for(var zid in zones){
      if(zones.hasOwnProperty(zid)) map[zid] = (qty > carMin) ? (zones[zid].car||0) : (zones[zid].moto||0);
    }
    return map;
  }
  function getFreeThreshold(zone){
    var fallback = 50;
    if(typeof EED !== 'undefined' && EED.freeDeliveryFrom) fallback = parseInt(EED.freeDeliveryFrom,10)||fallback;
    if(typeof EED !== 'undefined' && EED.shippingZoneFreeThresholds && zone){
      var t = EED.shippingZoneFreeThresholds[zone];
      if(t !== undefined) return parseInt(t,10)||0;
    }
    return fallback;
  }
  // Load overrides from server (for no-backend deploy) + local planner
  function applyOverrides(data){
    if(!data || typeof data!=='object') return;
    try{
      if(data.prices) Object.keys(data.prices).forEach(function(id){ var v=parseFloat(data.prices[id]); if(!isNaN(v)) for(var i=0;i<EED_MENUS.length;i++) if(String(EED_MENUS[i].id)===String(id)) EED_MENUS[i].price=v; });
      if(data.mins) Object.keys(data.mins).forEach(function(id){ var v=parseInt(data.mins[id],10); if(!isNaN(v)) for(var i=0;i<EED_MENUS.length;i++) if(String(EED_MENUS[i].id)===String(id)) EED_MENUS[i].minPerMenu=v; });
      if(data.images) Object.keys(data.images).forEach(function(id){ var v=String(data.images[id]||'').trim(); if(v) for(var i=0;i<EED_MENUS.length;i++) if(String(EED_MENUS[i].id)===String(id)) EED_MENUS[i].image=v; });
      if(data.names) Object.keys(data.names).forEach(function(id){ var v=String(data.names[id]||'').trim(); if(v) for(var i=0;i<EED_MENUS.length;i++) if(String(EED_MENUS[i].id)===String(id)) EED_MENUS[i].name=v; });
      if(data.categories) Object.keys(data.categories).forEach(function(id){ var v=String(data.categories[id]||'').trim(); if(v) for(var i=0;i<EED_MENUS.length;i++) if(String(EED_MENUS[i].id)===String(id)) EED_MENUS[i].category=v; });
      if(Array.isArray(data.newMenus)){
        data.newMenus.forEach(function(nm){
          if(!nm || !nm.name) return;
          var exists = EED_MENUS.some(function(m){ return m.id === nm.id; });
          if(!exists){
            EED_MENUS.push({
              id: nm.id, name: nm.name, price: parseInt(nm.price,10)||60,
              category: nm.category||'ข้าวราดแกง', image: nm.image||'img/logo.jpg',
              desc: nm.desc||'', badge: nm.badge||'ใหม่',
              minPerMenu: parseInt(nm.minPerMenu,10)||5
            });
          }
        });
      }
      if(Array.isArray(data.deleted)){
        EED_MENUS = EED_MENUS.filter(function(m){ return data.deleted.indexOf(m.id)===-1; });
      }
      if(Array.isArray(data.toppings)){
        // global toppings
        EED_MENUS.forEach(function(m){ m.toppings = data.toppings.map(function(t){return {name:String(t.name), price:parseInt(t.price,10)||0};}); });
        if(typeof EED_DEFAULT_TOPPINGS!=='undefined') EED_DEFAULT_TOPPINGS = data.toppings.slice();
      } else if(data.toppings && typeof data.toppings==='object'){
        EED_MENUS.forEach(function(m){
          var arr = data.toppings[String(m.id)];
          if(Array.isArray(arr)) m.toppings = arr.map(function(t){return {name:String(t.name), price:parseInt(t.price,10)||0};});
        });
      }
      if(Array.isArray(data.meats)){
        if(typeof EED_DEFAULT_MEATS!=='undefined') EED_DEFAULT_MEATS = data.meats.slice();
        else window.EED_DEFAULT_MEATS = data.meats.slice();
      }
      if(Array.isArray(data.noMeatMenus)) localStorage.setItem(LS_NO_MEAT, JSON.stringify(data.noMeatMenus));
    }catch(e){}
  }
  function loadLocalOverrides(){
    try{
      var p = JSON.parse(localStorage.getItem(LS_SELLING)||'null');
      var mns = JSON.parse(localStorage.getItem(LS_MINS)||'null');
      var tops = JSON.parse(localStorage.getItem(LS_TOPPINGS)||'null');
      var imgs = JSON.parse(localStorage.getItem(LS_IMAGES)||'null');
      var nms = JSON.parse(localStorage.getItem(LS_NAMES)||'null');
      var cats = JSON.parse(localStorage.getItem(LS_CATEGORIES)||'null');
      var del = JSON.parse(localStorage.getItem(LS_DELETED)||'null');
      var newM = JSON.parse(localStorage.getItem(LS_NEW_MENUS)||'null');
      var meats = JSON.parse(localStorage.getItem(LS_MEATS)||'null');
      var noMeat = JSON.parse(localStorage.getItem(LS_NO_MEAT)||'null');
      var data={};
      if(p) data.prices=p;
      if(mns) data.mins=mns;
      if(imgs) data.images=imgs;
      if(nms) data.names=nms;
      if(cats) data.categories=cats;
      if(del) data.deleted=del;
      if(newM) data.newMenus=newM;
      if(meats) data.meats=meats;
      if(noMeat) data.noMeatMenus=noMeat;
      if(tops) data.toppings=tops;
      if(Object.keys(data).length) applyOverrides(data);
    }catch(e){}
  }
  function loadServerOverrides(cb){
    if(location.protocol==='file:'){ if(cb) cb(); return; }
    var urls=['data/planner-overrides.json','./data/planner-overrides.json','planner-overrides.json'];
    var i=0;
    function next(){
      if(i>=urls.length){ if(cb) cb(); return; }
      fetch(urls[i++]+'?t='+Date.now(),{cache:'no-store'}).then(function(r){ if(!r.ok) throw new Error(); return r.json(); }).then(function(data){ applyOverrides(data); if(cb) cb(); }).catch(next);
    }
    next();
  }
  var state = {
    budgetPerBox: 60,
    quantity: 20,
    category: 'all',
    selected: {}, // id -> qty
    selectedToppings: {}, // id -> [toppingIndex, ...]
    selectedMeats: {}, // id -> meatIndex
    shippingMode: 'zone', // zone | auto | free | manual — zone is the clearest default for customers
    shippingFee: 0,        // used when manual
    shippingZone: 'zone_1',
    district: ''           // customer typed district
  };
  var SHIP_FEES = getShipFees();

  function $(id){ return document.getElementById(id); }

  function escapeHtml(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }

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

  var DEFAULT_MEATS = [
    {name:'ไก่', price:0},
    {name:'เนื้อ', price:0},
    {name:'ทะเล', price:0},
    {name:'ปลา', price:0},
    {name:'ไม่เอาเนื้อ', price:0}
  ];
  function getNoMeat(){
    try{
      var arr = JSON.parse(localStorage.getItem(LS_NO_MEAT)||'null');
      if(Array.isArray(arr)) return arr;
    }catch(e){}
    return [];
  }
  function isNoMeatMenu(menuId){
    var list = getNoMeat();
    if(list.some(function(id){ return String(id)===String(menuId); })) return true;
    var m = (typeof EED_MENUS !== 'undefined' && EED_MENUS) ? EED_MENUS.find(function(x){ return String(x.id)===String(menuId); }) : null;
    return !!(m && m.noMeat);
  }
  function getMeatsForMenu(menuId){
    if(isNoMeatMenu(menuId)) return [];
    var base = EED_DEFAULT_MEATS || DEFAULT_MEATS;
    // Ensure "ไม่เอาเนื้อ" option exists for normal menus
    var hasNoMeat = base.some(function(t){ return t.name === 'ไม่เอาเนื้อ' || t.name === 'ไม่เลือกเนื้อ'; });
    if(!hasNoMeat){
      var copy = base.slice();
      copy.push({name:'ไม่เอาเนื้อ', price:0});
      return copy;
    }
    return base;
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
    var zone = state.shippingZone || 'zone_1';
    var freeFrom = getFreeThreshold(zone);
    var qtyFree = freeFrom > 0 && state.quantity >= freeFrom;
    if(state.shippingMode === 'free') return 0;
    if(state.shippingMode === 'auto'){
      return qtyFree ? 0 : 0;
    }
    if(state.shippingMode === 'manual'){
      return qtyFree ? 0 : (parseInt(state.shippingFee,10)||0);
    }
    if(state.shippingMode === 'zone'){
      if(qtyFree) return 0;
      if(!state.district || !String(state.district).trim()) return 0;
      return getDistrictFeeForQty(state.shippingZone, state.quantity);
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
    try{ localStorage.setItem(LS_KEY, JSON.stringify({
      budgetPerBox:state.budgetPerBox,
      quantity:state.quantity,
      category:state.category,
      selected:state.selected,
      selectedToppings:state.selectedToppings,
      selectedMeats:state.selectedMeats
    })); }catch(e){}
    try{ localStorage.setItem(LS_SHIP, JSON.stringify({mode:state.shippingMode, fee:state.shippingFee, zone:state.shippingZone, district:state.district||''})); }catch(e){}
    try{ if(state.deliveryDate) localStorage.setItem(LS_DATE, state.deliveryDate); else localStorage.removeItem(LS_DATE); }catch(e){}
    try{ if(state.deliveryTime) localStorage.setItem(LS_TIME, state.deliveryTime); else localStorage.removeItem(LS_TIME); }catch(e){}
  }
  function loadState(){
    try{
      var s = JSON.parse(localStorage.getItem(LS_KEY)||'null');
      if(s){
       if(s.budgetPerBox) state.budgetPerBox = Math.max(60, Math.min(300, parseInt(s.budgetPerBox,10)));
       if(s.quantity) state.quantity = parseInt(s.quantity,10);
        if(s.category) state.category = s.category;
        if(s.selected && typeof s.selected === 'object') state.selected = s.selected;
        if(s.selectedToppings && typeof s.selectedToppings === 'object') state.selectedToppings = s.selectedToppings;
        if(s.selectedMeats && typeof s.selectedMeats === 'object') state.selectedMeats = s.selectedMeats;
      }
      var sh = JSON.parse(localStorage.getItem(LS_SHIP)||'null');
      if(sh){
        if(sh.mode) state.shippingMode = sh.mode;
        if(typeof sh.fee !== 'undefined') state.shippingFee = parseInt(sh.fee,10)||0;
        if(sh.zone) state.shippingZone = sh.zone;
        if(sh.district) state.district = sh.district;
      }
      var d = localStorage.getItem(LS_DATE);
      if(d && /^\d{4}-\d{2}-\d{2}$/.test(d)){
        var todayISO2 = toISODate(new Date());
        if(d >= todayISO2) state.deliveryDate = d;
        else { try{ localStorage.removeItem(LS_DATE); }catch(e){} }
      }
      var t = localStorage.getItem(LS_TIME);
      if(t && /^\d{2}:\d{2}$/.test(t)) state.deliveryTime = t;
    }catch(e){}
  }

  function updateSummary(){
    SHIP_FEES = getShipFees();
    var filtered = getFiltered();
    var zone = state.shippingZone || 'zone_1';
    var freeFrom = getFreeThreshold(zone);
    var freeDelivery = freeFrom > 0 && state.quantity >= freeFrom;
    var minWarn = state.quantity < 10;
    var foodTotal = getFoodTotal(); // from selected or budget * qty
    var baseTotal = state.budgetPerBox * state.quantity; // for totalBudget input
    var shipFee = getShippingFee();
    var grandTotal = foodTotal + shipFee;
    // for quantity label
    var displayQty = (function(){ var s=getSelectedTotals(); return s.ids.length ? s.qty : state.quantity; })();

    if(els.floatingTotal) els.floatingTotal.textContent = formatMoney(grandTotal) + ' บาท';
    if(els.floatingMeta) els.floatingMeta.textContent = formatMoney(displayQty) + ' กล่อง';
    if(els.floatingShipping){
      var rawDistrict = state.district ? String(state.district).trim() : '';
      var noDistrict = !rawDistrict;
      var invalidDistrict = rawDistrict && !lookupDistrict(rawDistrict);
      var floatingShipText = freeDelivery ? 'ส่งฟรี · ' + freeFrom + '+ กล่อง' : state.shippingMode === 'zone' && invalidDistrict ? 'เขตไม่พบ — เลือกจากรายการ' : state.shippingMode === 'zone' && noDistrict ? 'พิมพ์เขตเพื่อคำนวณค่าส่ง' : state.shippingMode === 'zone' && shipFee > 0 ? (state.district ? state.district + ' · ' : '') + 'ค่าส่ง ' + formatMoney(shipFee) + ' บาท' : state.shippingMode === 'auto' ? 'รอประเมินค่าส่ง' : state.shippingMode === 'free' ? 'ส่งฟรีโปรโมชั่น' : 'ค่าส่ง ' + formatMoney(shipFee) + ' บาท';
      els.floatingShipping.textContent = floatingShipText;
    }
    if(els.floatingShippingBadge){
      els.floatingShippingBadge.textContent = freeDelivery ? '✓ ส่งฟรี' : state.shippingMode === 'zone' ? 'ค่าส่งตามเขต' : state.shippingMode === 'auto' ? 'รอประเมินค่าส่ง' : 'ค่าส่งกำหนดเอง';
    }

    if(els.summaryBudgetPerBox) els.summaryBudgetPerBox.textContent = formatMoney(state.budgetPerBox);
    if(els.summaryQty) els.summaryQty.textContent = formatMoney(state.quantity);
    if(els.summaryCount) els.summaryCount.textContent = filtered.length;

    // free / shipping label in top stat
    if(els.summaryFree){
      if(freeDelivery){
        els.summaryFree.textContent = 'ส่งฟรีตามเขตที่เลือก';
        els.summaryFree.style.color = 'var(--primary)';
      } else {
        var rawDistrict2 = state.district ? String(state.district).trim() : '';
        var noDistrict2 = !rawDistrict2;
        var invalidDistrict2 = rawDistrict2 && !lookupDistrict(rawDistrict2);
        if(state.shippingMode === 'auto'){
          els.summaryFree.textContent = freeFrom > 0 ? 'ค่าส่งคิดตามระยะทาง (ฟรีเมื่อ ' + freeFrom + '+ กล่อง)' : 'ค่าส่งคิดตามระยะทาง';
        } else if(state.shippingMode === 'free'){
          els.summaryFree.textContent = 'ฟรี (โปรโมชั่น)';
        } else if(state.shippingMode === 'zone' && invalidDistrict2){
          els.summaryFree.textContent = 'เขตไม่พบ — เลือกจากรายการ';
        } else if(state.shippingMode === 'zone' && noDistrict2){
          els.summaryFree.textContent = 'พิมพ์เขตเพื่อคำนวณค่าส่ง';
        } else if(shipFee>0){
          els.summaryFree.textContent = 'ค่าส่ง ' + formatMoney(shipFee) + ' บาท';
        } else {
          els.summaryFree.textContent = freeFrom > 0 ? 'พิมพ์เขตเพื่อคำนวณค่าส่ง' : 'ค่าส่งคิดตามเขต';
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
    else if(state.budgetPerBox < 180){ levelText='งบมาตรฐาน — ได้เมนูขายดีหลากหลาย'; levelClass='level-premium'; }
    else { levelText='งบพรีเมียม — เลือกเซ็ตพิเศษได้'; levelClass='level-premium'; }
    if(els.budgetLevel){ els.budgetLevel.textContent = levelText; els.budgetLevel.className = 'calc-level ' + levelClass; }

    // breakdown in green total box
    if(els.sumFood) els.sumFood.textContent = formatMoney(foodTotal) + ' บาท';
    if(els.sumQtyDup) els.sumQtyDup.textContent = formatMoney(displayQty);
    if(els.sumBudgetDup2) els.sumBudgetDup2.textContent = formatMoney(state.budgetPerBox);
    if(els.sumShip){
      var rawDistrict3 = state.district ? String(state.district).trim() : '';
      var noDistrict3 = !rawDistrict3;
      var invalidDistrict3 = rawDistrict3 && !lookupDistrict(rawDistrict3);
      if(freeDelivery && shipFee===0){
        els.sumShip.textContent = 'ฟรี';
      } else if(state.shippingMode === 'zone' && (noDistrict3 || invalidDistrict3)){
        els.sumShip.textContent = '—';
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
      else if(state.shippingMode === 'zone'){
        if(state.district) els.sumShipLabel.textContent = 'ค่าส่ง (' + state.district + ')';
        else els.sumShipLabel.textContent = 'ค่าส่ง (พิมพ์เขต)';
      }
      else if(state.shippingMode === 'manual') els.sumShipLabel.textContent = 'ค่าส่ง (ระบุเอง)';
      else els.sumShipLabel.textContent = 'ค่าส่ง';
    }
    if(els.sumShipSub){
      var rawDistrict4 = state.district ? String(state.district).trim() : '';
      var noDistrict4 = !rawDistrict4;
      var invalidDistrict4 = rawDistrict4 && !lookupDistrict(rawDistrict4);
      if(freeDelivery) els.sumShipSub.textContent = 'ส่งฟรี ' + freeFrom + '+ กล่อง';
      else if(state.shippingMode === 'zone' && invalidDistrict4) els.sumShipSub.textContent = 'เขตไม่พบ — เลือกจากรายการที่แนะนำ';
      else if(state.shippingMode === 'zone' && noDistrict4) els.sumShipSub.textContent = 'พิมพ์เขตเพื่อคำนวณค่าส่ง';
      else if(freeFrom > 0 && shipFee>0) els.sumShipSub.textContent = (state.district ? state.district + ' · ' : '') + 'ค่าส่ง ' + formatMoney(shipFee) + ' บาท · ฟรีเมื่อ ' + freeFrom + '+ กล่อง';
      else if(freeFrom === 0) els.sumShipSub.textContent = (state.district ? state.district + ' · ' : '') + 'เขตที่เลือกไม่มีส่งฟรี · ค่าส่ง ' + formatMoney(shipFee) + ' บาท';
      else els.sumShipSub.textContent = 'ค่าส่งคิดตามระยะทาง';
    }
    if(els.summaryTotal) els.summaryTotal.textContent = formatMoney(grandTotal);
    if(els.sumAvgDup){
      var avg = displayQty ? Math.round(grandTotal / displayQty) : 0;
      els.sumAvgDup.textContent = formatMoney(avg);
    }
    // shipping hint / note
    if(els.shippingHint){
      if(freeDelivery) els.shippingHint.textContent = 'ฟรีอัตโนมัติ (' + freeFrom + '+ กล่อง)';
      else if(state.shippingMode === 'auto') els.shippingHint.textContent = freeFrom > 0 ? 'น้อยกว่า ' + freeFrom + ' กล่อง คิดตามระยะทาง' : 'ค่าส่งคิดตามเขต';
      else if(state.shippingMode === 'manual') els.shippingHint.textContent = 'ระบุเอง' + (shipFee>0 ? ' ('+formatMoney(shipFee)+' บาท)' : '');
      else if(state.shippingMode === 'zone'){
        var rawDistrictH = state.district ? String(state.district).trim() : '';
        var invalidH = rawDistrictH && !lookupDistrict(rawDistrictH);
        if(invalidH) els.shippingHint.textContent = 'เขตไม่พบ — กรุณาเลือกจากรายการที่แนะนำ';
        else if(state.district) els.shippingHint.textContent = state.district + ' · ' + formatMoney(shipFee) + ' บาท';
        else els.shippingHint.textContent = shipFee>0 ? 'ตามเขต ' + formatMoney(shipFee) + ' บาท' : 'พิมพ์เขตที่จัดส่ง';
      }
      else if(state.shippingMode === 'free') els.shippingHint.textContent = 'โปรโมชั่นฟรี';
    }
    if(els.shippingCalcNote){
      if(freeDelivery && state.shippingMode!=='free'){
        var savedFees = getShipFees();
        els.shippingCalcNote.style.display='block';
        els.shippingCalcNote.textContent = '✓ ครบ ' + freeFrom + ' กล่องแล้ว ค่าส่งฟรีอัตโนมัติ (ประหยัด ' + (state.shippingMode==='manual' && state.shippingFee>0 ? formatMoney(state.shippingFee)+' บาท' : state.shippingMode==='zone' ? formatMoney(savedFees[state.shippingZone]||0)+' บาท' : 'ค่าส่ง') + ')';
      } else if(!freeDelivery && freeFrom > 0 && state.shippingMode==='zone' && shipFee>0){
        els.shippingCalcNote.style.display='block';
        var need = freeFrom - state.quantity;
        els.shippingCalcNote.textContent = 'ค่าส่งตามเขต ' + formatMoney(shipFee) + ' บาท · เพิ่มอีก ' + need + ' กล่องเพื่อส่งฟรี';
      } else if(!freeDelivery && freeFrom > 0 && state.shippingMode==='manual' && shipFee>0){
        els.shippingCalcNote.style.display='block';
        var need2 = freeFrom - state.quantity;
        els.shippingCalcNote.textContent = 'ค่าส่งระบุเอง ' + formatMoney(shipFee) + ' บาท · เพิ่มอีก ' + need2 + ' กล่องเพื่อส่งฟรี';
      } else if(!freeDelivery && freeFrom > 0 && state.shippingMode==='auto'){
        els.shippingCalcNote.style.display='block';
        var need3 = freeFrom - state.quantity;
        els.shippingCalcNote.textContent = 'ตอนนี้ค่าส่งยังไม่รวมในยอด · เพิ่มอีก ' + need3 + ' กล่องจะส่งฟรี';
      } else if(!freeDelivery && freeFrom === 0 && state.shippingMode==='zone'){
        els.shippingCalcNote.style.display='block';
        els.shippingCalcNote.textContent = 'เขตที่เลือกไม่มีส่งฟรี คิดค่าส่งตามเขต ' + formatMoney(shipFee) + ' บาท';
      } else {
        els.shippingCalcNote.style.display='none';
      }
    }
    // toggle manual / zone rows
    if(els.shippingManualRow) els.shippingManualRow.style.display = (state.shippingMode==='manual') ? 'flex' : 'none';
    if(els.shippingZoneRow) els.shippingZoneRow.style.display = 'block';
    // sync quick chips active
    if(els.shippingFeeInput) els.shippingFeeInput.value = state.shippingFee;
    syncShipQuick();
    syncShippingZoneCards();
    // update district fee when quantity changes
    refreshDistrictFee();

    // delivery date display
    if(els.deliveryDate) els.deliveryDate.value = state.deliveryDate || '';
    // ไม่บังคับระยะเวลาสั่งล่วงหน้า แต่ไม่ให้เลือกวันที่ผ่านมาแล้ว
    var minISO = toISODate(new Date());
    if(els.deliveryDate){
      try{ els.deliveryDate.min = minISO; }catch(e){}
    }
    if(els.deliveryDateHint){
      if(state.deliveryDate){
        var th2 = formatDateTH(state.deliveryDate);
        els.deliveryDateHint.textContent = th2;
        els.deliveryDateHint.style.color = 'var(--primary)';
      } else {
        els.deliveryDateHint.textContent = 'เลือกวันที่ต้องการ';
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
        var isPast = diff2 < 0;
        if(!isPast) txt2 += ' — ทีมงานจะยืนยันคิวอีกครั้ง';
        els.deliveryDateNote.textContent = txt2;
        els.deliveryDateNote.style.display='block';
        els.deliveryDateNote.style.color = isPast ? '#7F1D1D' : 'var(--text-muted)';
        els.deliveryDateNote.style.background = isPast ? '#FEF2F2' : 'var(--bg)';
        els.deliveryDateNote.style.borderColor = isPast ? '#FECACA' : 'var(--border-light)';
      } else {
        els.deliveryDateNote.textContent = 'เลือกวันที่สะดวกได้เลย ทีมงานจะตรวจสอบคิวครัวและยืนยันอีกครั้ง';
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
        els.sumDeliveryWeekday.textContent = '(เลือกวันที่ได้ด้านซ้าย)';
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
    var qtyTooLowMain = state.quantity < 10;
    var rawDistrictMain = state.district ? String(state.district).trim() : '';
    var noDistrictMain = !rawDistrictMain;
    var invalidDistrictMain = rawDistrictMain && !lookupDistrict(rawDistrictMain);
    var hasDistrictIssueMain = state.shippingMode === 'zone' && (noDistrictMain || invalidDistrictMain);
    var mainBlockReason = '';
    if(qtyTooLowMain) mainBlockReason = 'จำนวนต้องอย่างน้อย 10 กล่อง';
    else if(invalidDistrictMain) mainBlockReason = 'เขตไม่พบ — กรุณาเลือกจากรายการที่แนะนำ';
    else if(noDistrictMain) mainBlockReason = 'กรุณาพิมพ์เขตที่จัดส่งก่อน';
    if(mainBlockReason){
      if(els.btnLine){ els.btnLine.href = '#'; els.btnLine.title = 'ส่ง LINE ไม่ได้ — ' + mainBlockReason; els.btnLine.style.opacity = '0.45'; els.btnLine.style.pointerEvents = 'none'; }
      if(els.btnLine2){ els.btnLine2.href = '#'; els.btnLine2.title = 'ส่ง LINE ไม่ได้ — ' + mainBlockReason; els.btnLine2.style.opacity = '0.45'; els.btnLine2.style.pointerEvents = 'none'; }
      if(els.floatingLineBtn){ els.floatingLineBtn.href = '#'; els.floatingLineBtn.title = 'ส่ง LINE ไม่ได้ — ' + mainBlockReason; els.floatingLineBtn.style.opacity = '0.45'; els.floatingLineBtn.style.pointerEvents = 'none'; }
    } else {
      if(els.btnLine) { els.btnLine.href = lineUrl; els.btnLine.style.opacity=''; els.btnLine.style.pointerEvents=''; }
      if(els.btnLine2) { els.btnLine2.href = lineUrl; els.btnLine2.style.opacity=''; els.btnLine2.style.pointerEvents=''; }
      if(els.floatingLineBtn) { els.floatingLineBtn.href = lineUrl; els.floatingLineBtn.style.opacity=''; els.floatingLineBtn.style.pointerEvents=''; }
    }
    if(els.btnLineSelected && !document.querySelector('#calcSelected .calc-selected-row')) {
      // already handled in renderSelected when has selected, but keep main logic
    }
    if(els.btnLine) {
      var hasSelected = Object.keys(state.selected).length > 0;
      if(!mainBlockReason) els.btnLine.title = hasSelected ? 'ส่งเมนูที่เลือกไป LINE' : 'ส่งสรุปไป LINE';
    }
    if(els.btnLineSelected && !mainBlockReason) els.btnLineSelected.title = lineMsg;

    // main copy button disable
    if(els.copySummary){
      if(mainBlockReason){
        els.copySummary.disabled = true;
        els.copySummary.title = 'คัดลอกไม่ได้ — ' + mainBlockReason;
        els.copySummary.style.opacity = '0.45';
      } else {
        els.copySummary.disabled = false;
        els.copySummary.title = 'คัดลอกสรุป';
        els.copySummary.style.opacity = '';
      }
    }

    if(els.totalBudgetInput) els.totalBudgetInput.value = baseTotal;
  }

  function refreshShipZoneSelect(){
    // no-op: zone selection is now driven by district text input
  }

  function syncShippingZoneCards(){
    // no-op: zone cards removed in favor of district input
  }

  function refreshDistrictFee(){
    var districtFeeEl = document.getElementById('districtFee');
    var districtResult = document.getElementById('districtResult');
    if(!districtFeeEl || !districtResult) return;
    if(state.shippingMode !== 'zone' || !state.shippingZone || !state.district) return;
    var zones = getShippingZones();
    var z = zones[state.shippingZone];
    if(!z) return;
    var qty = state.quantity || 0;
    var carMin = getCarMinQty();
    var fee = (qty > carMin) ? (z.car||0) : (z.moto||0);
    var freeFrom = getFreeThreshold(state.shippingZone);
    var freeText = freeFrom > 0 ? ' · ฟรีเมื่อ ' + freeFrom + '+ กล่อง' : '';
    districtFeeEl.textContent = 'ค่าส่ง ' + formatMoney(fee) + ' บาท' + freeText;
  }

  function getToppingPriceForMenu(menuId){
    var tops = getToppingsForMenu(menuId);
    var sel = state.selectedToppings[menuId] || [];
    var sum = 0;
    sel.forEach(function(idx){ if(tops[idx]) sum += tops[idx].price; });
    // add meat price — default to ไก่ (index 0) if not selected
    var meats = getMeatsForMenu(menuId);
    var selMeat = state.selectedMeats[menuId];
    if(selMeat === undefined) selMeat = 0; // default to ไก่
    if(meats[selMeat]) sum += meats[selMeat].price || 0;
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

  function saveOrderDraft(){
    if(!window.EEDOrderDraft) return null;
    var selected = getSelectedTotals();
    var shipFee = getShippingFee();
    var foodTotal = getFoodTotal();
    var zone = state.shippingZone || 'zone_1';
    var freeFrom = getFreeThreshold(zone);
    var freeDelivery = freeFrom > 0 && state.quantity >= freeFrom;
    var items = selected.ids.map(function(id){
      var menu = EED_MENUS.find(function(item){ return String(item.id) === String(id); });
      if(!menu) return null;
      var toppingPrice = getToppingPriceForMenu(id);
      var meatIndex = state.selectedMeats[id];
      var meat = getMeatsForMenu(id)[meatIndex === undefined ? 0 : meatIndex];
      var options = [];
      if(meat && meat.name !== 'ไม่เอาเนื้อ' && meat.name !== 'ไม่เลือกเนื้อ') options.push(meat.name);
      (state.selectedToppings[id] || []).forEach(function(index){ var topping = getToppingsForMenu(id)[index]; if(topping) options.push(topping.name); });
      var quantity = Number(state.selected[id]) || 0;
      var unitPrice = Number(menu.price) + toppingPrice;
      return {id:id,name:menu.name,quantity:quantity,options:options,unitPrice:unitPrice,total:unitPrice * quantity};
    }).filter(Boolean);
    var shippingText = freeDelivery ? 'ฟรี (' + freeFrom + '+ กล่อง)' : state.shippingMode === 'auto' ? 'รอทีมงานประเมินตามระยะทาง' : state.shippingMode === 'manual' ? (shipFee ? formatMoney(shipFee) + ' บาท' : 'ฟรี') : shipFee ? formatMoney(shipFee) + ' บาท' : 'รอทีมงานยืนยัน';
    return window.EEDOrderDraft.save({
      source:'budget_calculator',
      delivery:{date:state.deliveryDate,time:state.deliveryTime,district:state.district},
      shipping:{mode:state.shippingMode,fee:shipFee,label:'ค่าจัดส่ง',text:shippingText,requiresConfirmation:state.shippingMode === 'auto' || (!freeDelivery && state.shippingMode === 'zone' && !shipFee)},
      items:items,
      totals:{requestedQuantity:state.quantity,selectedQuantity:selected.qty,food:foodTotal,shipping:shipFee,grand:foodTotal + shipFee},
      legacy:{selected:state.selected,selectedToppings:state.selectedToppings,selectedMeats:state.selectedMeats}
    });
  }

  function buildLineMessage(total, filtered){
    var lines = [];
    var zone = state.shippingZone || 'zone_1';
    var freeFrom = getFreeThreshold(zone);
    var freeDelivery = freeFrom > 0 && state.quantity >= freeFrom;
    var foodTotal = getFoodTotal();
    var shipFee = getShippingFee();
    var grand = foodTotal + shipFee;
    var sel = getSelectedTotals();
    var orderDraft = saveOrderDraft();
    var halalNo = (typeof EED !== 'undefined' && EED.halalCertificate) ? EED.halalCertificate : 'HL-2024-0892';
    lines.push('สรุปออเดอร์ — ข้าวกล่องฮาลาล EED HALAL');
    lines.push('');
    lines.push('สนใจสั่งข้าวกล่องฮาลาล รายละเอียดดังนี้ครับ/ค่ะ');
    lines.push('');
    lines.push('■ รายละเอียดออเดอร์');
    if(orderDraft) lines.push('• เลขอ้างอิง: ' + orderDraft.reference);
    if(state.deliveryDate){
      var dtLine = '• วันที่จัดส่ง: ' + formatDateTH(state.deliveryDate) + ' (' + formatDateShort(state.deliveryDate) + ')';
      if(state.deliveryTime) dtLine += ' เวลา ' + formatTimeTH(state.deliveryTime);
      else dtLine += ' เวลา — ยังไม่ระบุ';
      lines.push(dtLine);
    } else {
      var dtLine2 = '• วันที่จัดส่ง: ยังไม่ระบุ (รบกวนแจ้งวันที่สะดวกด้วยนะครับ)';
      if(state.deliveryTime) dtLine2 = '• วันที่จัดส่ง: ยังไม่ระบุ เวลา ' + formatTimeTH(state.deliveryTime) + ' (รบกวนแจ้งวันที่ด้วยครับ)';
      lines.push(dtLine2);
      if(!state.deliveryTime) lines.push('• เวลาจัดส่ง: ยังไม่ได้เลือก');
    }
    lines.push('• งบประมาณต่อกล่อง: ' + formatMoney(state.budgetPerBox) + ' บาท');
    lines.push('• จำนวน: ' + formatMoney(state.quantity) + ' กล่อง');
    if(state.shippingMode === 'zone'){
      if(state.district) lines.push('• พื้นที่จัดส่ง: ' + state.district + ' (ค่าส่ง ' + formatMoney(shipFee) + ' บาท)');
      else lines.push('• พื้นที่จัดส่ง: ยังไม่ระบุเขต');
    }
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
        var meatIdx = state.selectedMeats[id];
        var meats = getMeatsForMenu(id);
        if(meatIdx === undefined) meatIdx = 0; // default to ไก่
        var meatName = (meats[meatIdx]) ? meats[meatIdx].name : '';
        if(meatName === 'ไม่เอาเนื้อ' || meatName === 'ไม่เลือกเนื้อ') meatName = '';
        var topSuffix = '';
        if(meatName || topNames.length){
          var parts = [];
          if(meatName) parts.push(meatName);
          parts = parts.concat(topNames);
          topSuffix = ' (' + parts.join(', ') + ')';
        }
        var topSuffix2 = topNames.length ? ' + ' + topNames.join(', ') + (topPrice>0 ? ' (+'+formatMoney(topPrice)+'บ.)' : '') : '';
        if(meatName) topSuffix2 = (meatName ? ' ['+meatName+']' : '') + topSuffix2;
        lines.push('  ' + (idx+1) + '. ' + m.name + topSuffix2 + ' — ' + formatMoney(unitPrice) + ' บาท/กล่อง × ' + formatMoney(q) + ' กล่อง = ' + formatMoney(lineTotal) + ' บาท');
      });
      lines.push('  รวมค่าอาหาร: ' + formatMoney(sel.price) + ' บาท (เฉลี่ย ' + formatMoney(sel.avg) + ' บาท/กล่อง)');
      if(sel.qty !== state.quantity){
        lines.push('  หมายเหตุ: จำนวนที่เลือก ' + formatMoney(sel.qty) + ' กล่อง ไม่ตรงกับจำนวนที่ตั้งไว้ ' + formatMoney(state.quantity) + ' กล่อง — รบกวนยืนยันจำนวนด้วยครับ');
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
      lines.push('• ค่าจัดส่ง: ฟรี (ครบ ' + formatMoney(freeFrom) + ' กล่องตามเขตที่เลือก)');
    } else {
      if(state.shippingMode === 'auto'){
        lines.push('• ค่าจัดส่ง: คิดตามระยะทาง (ฟรีเมื่อครบ ' + formatMoney(freeFrom) + ' กล่อง)');
      } else if(state.shippingMode === 'free'){
        lines.push('• ค่าจัดส่ง: ฟรี (โปรโมชั่น)');
      } else if(state.shippingMode === 'manual'){
        lines.push('• ค่าจัดส่ง: ' + (shipFee>0 ? formatMoney(shipFee)+' บาท (ระบุเอง)' : 'ฟรี'));
      } else if(state.shippingMode === 'zone'){
        var zoneName = state.district || 'ตามเขต';
        lines.push('• ค่าจัดส่ง: ' + (shipFee>0 ? formatMoney(shipFee)+' บาท ('+zoneName+')' : 'สอบถามตามเขตพื้นที่'));
      }
    }
    lines.push('• ยอดสุทธิ: ' + formatMoney(grand) + ' บาท' + (shipFee>0 ? ' (ค่าอาหาร ' + formatMoney(foodTotal) + ' บาท + ค่าจัดส่ง ' + formatMoney(shipFee) + ' บาท)' : freeDelivery ? ' (รวมจัดส่งฟรี)' : ''));
    if(!freeDelivery && state.shippingMode==='auto'){
      lines.push('  หมายเหตุ: ยอดนี้ยังไม่รวมค่าส่งจริง จะแจ้งยอดชัดเจนอีกทีในใบเสนอราคาครับ');
    }
    lines.push('');
    lines.push('รบกวนจัดทำใบเสนอราคาและยืนยันคิวส่งด้วยนะครับ/ค่ะ');
    lines.push('ขอบคุณครับ/ค่ะ');
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
        var meats = getMeatsForMenu(m.id);
        var tops = getToppingsForMenu(m.id);
        var selMeat = state.selectedMeats[m.id];
        var selTops = state.selectedToppings[m.id] || [];
        var optsHtml = '';
        // Meat selection (radio — pick one)
        if(meats.length){
          if(selMeat === undefined) selMeat = 0; // default to ไก่
          optsHtml += '<div style="margin-top:.55rem"><div style="font-size:.72rem;font-weight:800;color:var(--primary);margin-bottom:.3rem">เลือกเนื้อสัตว์ (1 อย่าง)</div><div style="display:flex;flex-wrap:wrap;gap:.35rem">'
            + meats.map(function(t, ti){
                var active = selMeat === ti;
                return '<button type="button" data-meat="'+m.id+':'+ti+'" style="border:1px solid '+(active?'var(--primary)':'var(--border)')+';background:'+(active?'var(--primary)':'var(--white)')+';color:'+(active?'#fff':'var(--text-muted)')+';border-radius:999px;padding:.2rem .55rem;font-size:.72rem;font-weight:700;cursor:pointer">'+t.name+' '+ (t.price>0? '+'+t.price+'บ.' : '') + (active?' ✓':'')+'</button>';
              }).join('') + '</div></div>';
        }
        // Toppings (checkbox — pick many)
        if(tops.length){
          optsHtml += '<div style="margin-top:.55rem"><div style="font-size:.72rem;font-weight:800;color:var(--primary);margin-bottom:.3rem">เลือกท็อปปิ้งเพิ่ม (คิดต่อกล่อง)</div><div style="display:flex;flex-wrap:wrap;gap:.35rem">'
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
          + optsHtml
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
          if(state.selected[id]){ delete state.selected[id]; delete state.selectedToppings[id]; delete state.selectedMeats[id]; }
          else state.selected[id]= Math.max( (function(){ var mm=EED_MENUS.find(function(x){return String(x.id)===String(id);}); return mm? mm.minPerMenu:5; })(), state.quantity ? Math.ceil(state.quantity/2) : 5);
          renderResults();
          updateSummary();
        } else if(act==='inc'){
          state.selected[id] = (state.selected[id]||0)+1;
          renderResults(); updateSummary();
        } else if(act==='dec'){
          state.selected[id] = (state.selected[id]||0)-1;
          if(state.selected[id]<=0){ delete state.selected[id]; delete state.selectedToppings[id]; delete state.selectedMeats[id]; }
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
    els.resultsGrid.querySelectorAll('[data-meat]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var parts = (this.getAttribute('data-meat')||'').split(':');
        var mid = parts[0]; var ti = parseInt(parts[1],10);
        if(isNaN(ti)) return;
        if(!state.selected[mid]){
          var mm = EED_MENUS.find(function(x){return String(x.id)===String(mid);});
          state.selected[mid]= Math.max(mm?mm.minPerMenu:5, state.quantity ? Math.ceil(state.quantity/2) : 5);
        }
        // if same meat clicked, keep it selected (can't deselect — default is ไก่)
        if(state.selectedMeats[mid] === ti) return;
        state.selectedMeats[mid] = ti;
        renderResults();
        updateSummary();
      });
    });
  }

  function renderSelected(){
    // Keep the current menu choices available to the kitchen summary page.
    saveState();
    var ids = Object.keys(state.selected);
    // cleanup stale ids (menu deleted from data)
    var stale = ids.filter(function(id){ return !EED_MENUS.some(function(x){ return String(x.id)===String(id); }); });
    stale.forEach(function(id){ delete state.selected[id]; delete state.selectedToppings[id]; delete state.selectedMeats[id]; });
    if(stale.length) saveState();
    ids = ids.filter(function(id){ return EED_MENUS.some(function(x){ return String(x.id)===String(id); }); });
    if(ids.length===0){
      els.selectedSection.style.display='none';
      return;
    }
    els.selectedSection.style.display='block';
    var totalSelectedQty = 0;
    var totalSelectedPrice = 0;
    var hasBelowMin = false;
    var html = ids.map(function(id){
      var m = EED_MENUS.find(function(x){ return String(x.id)===String(id); });
      if(!m) return '';
      var qty = state.selected[id];
      var topPrice = getToppingPriceForMenu(id);
      var unitPrice = m.price + topPrice;
      totalSelectedQty += qty;
      totalSelectedPrice += qty * unitPrice;
      var topNames = (state.selectedToppings[id]||[]).map(function(ti){ var t=getToppingsForMenu(id)[ti]; return t? t.name+' (+'+t.price+'บ.)' : null; }).filter(Boolean).join(', ');
      var meatIdx = state.selectedMeats[id];
      var meatsList = getMeatsForMenu(id);
      if(meatIdx === undefined) meatIdx = 0; // default to ไก่
      var meatName = (meatsList[meatIdx]) ? meatsList[meatIdx].name : '';
      if(meatName === 'ไม่เอาเนื้อ' || meatName === 'ไม่เลือกเนื้อ') meatName = '';
      var topLine = '';
      if(meatName || topNames){
        var lineParts = [];
        if(meatName) lineParts.push('<span style="font-weight:800">'+meatName+'</span>');
        if(topNames) lineParts.push('+ '+topNames);
        topLine = '<div style="font-size:.72rem;color:var(--primary);font-weight:700">'+lineParts.join(' · ')+'</div>';
      }
      var belowMin = m.minPerMenu && qty < m.minPerMenu;
      if(belowMin) hasBelowMin = true;
      var belowMinLine = belowMin ? '<div style="font-size:.78rem;color:#DC2626;font-weight:800;margin-top:2px">⚠ ต่ำกว่าขั้นต่ำ (สั่งอย่างน้อย '+m.minPerMenu+' กล่อง)</div>' : '';
      return '<div class="calc-selected-row">'
        + '<img src="'+m.image+'" alt="" style="width:44px;height:44px;border-radius:10px;object-fit:cover" onerror="this.onerror=null;this.src=\'img/logo.jpg\';this.style.objectFit=\'contain\';this.style.background=\'#f9fafb\'">'
        + '<div style="flex:1;min-width:0"><div style="font-weight:800;font-size:.92rem;line-height:1.2">'+m.name+'</div>'+topLine+'<div style="font-size:.78rem;color:var(--text-muted)">'+unitPrice+' บาท × '+qty+' = '+formatMoney(unitPrice*qty)+' บาท'+(topPrice>0?' <span style="color:var(--text-muted)">(ฐาน '+m.price+'+ท็อปปิ้ง '+topPrice+')</span>':'')+'</div>'+belowMinLine+'</div>'
        + '<div class="calc-sel-stepper"><button type="button" data-sel-minus="'+id+'">−</button><span class="calc-sel-qty">'+qty+'</span><button type="button" data-sel-plus="'+id+'">+</button></div>'
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

    // warn if any menu below minimum
    if(hasBelowMin){
      els.selectedMinWarn.innerHTML = '⚠️ มีเมนูที่จำนวนต่ำกว่าขั้นต่ำ — ปรับจำนวนหรือลบเมนูนั้นออกก่อนคัดลอก/ส่ง LINE';
      els.selectedMinWarn.style.display='block';
    } else {
      els.selectedMinWarn.style.display='none';
    }

    els.selectedList.querySelectorAll('[data-remove]').forEach(function(b){
      b.addEventListener('click', function(){
        var rid = this.getAttribute('data-remove');
        delete state.selected[rid];
        delete state.selectedToppings[rid];
        delete state.selectedMeats[rid];
        renderResults(); updateSummary();
      });
    });
    els.selectedList.querySelectorAll('[data-sel-minus]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var sid = this.getAttribute('data-sel-minus');
        if(!state.selected[sid]) return;
        var q = state.selected[sid] - 1;
        if(q < 1){ delete state.selected[sid]; delete state.selectedToppings[sid]; delete state.selectedMeats[sid]; }
        else state.selected[sid] = q;
        renderResults(); updateSummary();
      });
    });
    els.selectedList.querySelectorAll('[data-sel-plus]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var sid = this.getAttribute('data-sel-plus');
        if(!state.selected[sid]) return;
        state.selected[sid] = state.selected[sid] + 1;
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

    // disable copy / LINE if any menu below minimum OR total qty != ordered qty OR qty<10 OR no district/invalid
    var qtyTooLow = state.quantity < 10;
    var rawDistrictSel = state.district ? String(state.district).trim() : '';
    var noDistrictSel = !rawDistrictSel;
    var invalidDistrictSel = rawDistrictSel && !lookupDistrict(rawDistrictSel);
    var hasDistrictIssueSel = state.shippingMode === 'zone' && (noDistrictSel || invalidDistrictSel);
    var blockReason = '';
    if(hasBelowMin) blockReason = 'มีเมนูที่จำนวนยังไม่ถึงขั้นต่ำ';
    else if(qtyTooLow) blockReason = 'จำนวนต้องอย่างน้อย 10 กล่อง';
    else if(invalidDistrictSel) blockReason = 'เขตไม่พบ — กรุณาเลือกจากรายการที่แนะนำ';
    else if(noDistrictSel) blockReason = 'กรุณาพิมพ์เขตที่จัดส่งก่อน';
    else if(totalSelectedQty !== state.quantity) blockReason = 'ยังไม่ครบจำนวนกล่องที่สั่ง';
    if(els.btnCopySelected){
      if(blockReason){
        els.btnCopySelected.disabled = true;
        els.btnCopySelected.title = 'คัดลอกไม่ได้ — ' + blockReason;
      } else {
        els.btnCopySelected.disabled = false;
        els.btnCopySelected.title = 'คัดลอกเมนูที่เลือก';
      }
    }
    if(els.btnLineSelected){
      if(blockReason){
        els.btnLineSelected.href = '#';
        els.btnLineSelected.title = 'ส่ง LINE ไม่ได้ — ' + blockReason;
        els.btnLineSelected.style.opacity = '0.45';
        els.btnLineSelected.style.pointerEvents = 'none';
      } else {
        els.btnLineSelected.href = lineUrl;
        els.btnLineSelected.title = lineMsg;
        els.btnLineSelected.style.opacity = '';
        els.btnLineSelected.style.pointerEvents = '';
      }
    }
  }

  function initControls(){
    loadLocalOverrides();
    loadState();
    // Prices, minimum order quantities and toppings come from js/menu-data.js + overrides.
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
    els.selectedMinWarn = $('selectedMinWarn');
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
    els.floatingSummary = $('calcFloatingSummary');
    els.floatingTotal = $('floatingTotal');
    els.floatingMeta = $('floatingMeta');
    els.floatingShipping = $('floatingShipping');
    els.floatingShippingBadge = $('floatingShippingBadge');
    els.floatingLineBtn = $('floatingLineBtn');
    els.copySummary = $('copySummary');
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
      state.budgetPerBox = Math.max(60, Math.min(300, parseInt(this.value,10)));
      this.value = state.budgetPerBox;
      els.budgetNumber.value = state.budgetPerBox;
      syncQuickButtons(); updateSummary(); renderResults(); saveState();
    });
    els.budgetNumber.addEventListener('input', function(){
      var v = parseInt(this.value,10);
      if(isNaN(v)) return;
      v = Math.max(60, Math.min(300, v));
      state.budgetPerBox = v;
      this.value = v;
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
      perBox = Math.max(60, Math.min(300, perBox));
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
      state.budgetPerBox = Math.max(60, state.budgetPerBox-5);
      els.budgetRange.value = state.budgetPerBox;
      els.budgetNumber.value = state.budgetPerBox;
      syncQuickButtons(); updateSummary(); renderResults(); saveState();
    });
    $('budgetInc').addEventListener('click', function(){
      state.budgetPerBox = Math.min(300, state.budgetPerBox+5);
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

    // district text input
    var districtInput = document.getElementById('districtInput');
    var districtSuggestions = document.getElementById('districtSuggestions');
    var districtResult = document.getElementById('districtResult');
    var districtNotFound = document.getElementById('districtNotFound');
    var districtNameEl = document.getElementById('districtName');
    var districtFeeEl = document.getElementById('districtFee');
    if(districtInput){
      districtInput.addEventListener('input', function(){
        var val = this.value.trim();
        state.district = val;
        if(val.length < 1){
          districtSuggestions.style.display = 'none';
          districtResult.style.display = 'none';
          districtNotFound.style.display = 'none';
          state.shippingZone = '';
          state.shippingFee = 0;
          state.shippingMode = 'zone';
          if(els.shippingZone) els.shippingZone.value = '';
          updateSummary(); saveState();
          return;
        }
        var matches = getDistrictSuggestions(val);
        if(matches.length === 0){
          districtSuggestions.style.display = 'none';
          // check exact match
          var exact = lookupDistrict(val);
          if(exact){
            applyDistrictMatch(val, exact);
          } else {
            districtResult.style.display = 'none';
            districtNotFound.style.display = 'block';
            state.shippingZone = '';
            state.shippingFee = 0;
            state.shippingMode = 'zone';
            if(els.shippingZone) els.shippingZone.value = '';
            updateSummary(); saveState();
          }
          return;
        }
        districtNotFound.style.display = 'none';
        districtSuggestions.innerHTML = matches.map(function(d){
          return '<div class="district-suggest-item" data-district="'+escapeHtml(d)+'" style="padding:.6rem .9rem;cursor:pointer;font-size:.88rem;font-weight:700;border-bottom:1px solid var(--border-light);transition:background .1s">'+escapeHtml(d)+'</div>';
        }).join('');
        districtSuggestions.style.display = 'block';
        districtSuggestions.querySelectorAll('.district-suggest-item').forEach(function(item){
          item.addEventListener('mouseenter', function(){ this.style.background='var(--primary-soft)'; });
          item.addEventListener('mouseleave', function(){ this.style.background=''; });
          item.addEventListener('click', function(){
            var d = this.getAttribute('data-district');
            districtInput.value = d;
            state.district = d;
            districtSuggestions.style.display = 'none';
            var result = lookupDistrict(d);
            if(result) applyDistrictMatch(d, result);
          });
        });
        // auto-select if only one match and it's exact
        if(matches.length === 1 && matches[0].toLowerCase() === val.toLowerCase()){
          var result = lookupDistrict(matches[0]);
          if(result) applyDistrictMatch(matches[0], result);
          districtSuggestions.style.display = 'none';
        }
      });
      districtInput.addEventListener('focus', function(){
        if(this.value.trim().length >= 1){
          var matches = getDistrictSuggestions(this.value.trim());
          if(matches.length > 0){
            districtSuggestions.innerHTML = matches.map(function(d){
              return '<div class="district-suggest-item" data-district="'+escapeHtml(d)+'" style="padding:.6rem .9rem;cursor:pointer;font-size:.88rem;font-weight:700;border-bottom:1px solid var(--border-light);transition:background .1s">'+escapeHtml(d)+'</div>';
            }).join('');
            districtSuggestions.style.display = 'block';
            districtSuggestions.querySelectorAll('.district-suggest-item').forEach(function(item){
              item.addEventListener('mouseenter', function(){ this.style.background='var(--primary-soft)'; });
              item.addEventListener('mouseleave', function(){ this.style.background=''; });
              item.addEventListener('click', function(){
                var d = this.getAttribute('data-district');
                districtInput.value = d;
                state.district = d;
                districtSuggestions.style.display = 'none';
                var result = lookupDistrict(d);
                if(result) applyDistrictMatch(d, result);
              });
            });
          }
        }
      });
      districtInput.addEventListener('blur', function(){
        setTimeout(function(){ districtSuggestions.style.display = 'none'; }, 200);
      });
      // restore saved district
      if(state.district){
        districtInput.value = state.district;
        var saved = lookupDistrict(state.district);
        if(saved) applyDistrictMatch(state.district, saved);
      }
    }
    function applyDistrictMatch(district, result){
      state.shippingZone = result.zoneId;
      state.shippingMode = 'zone';
      if(els.shippingZone) els.shippingZone.value = result.zoneId;
      if(els.shippingMode) els.shippingMode.value = 'zone';
      districtResult.style.display = 'block';
      districtNotFound.style.display = 'none';
      districtNameEl.textContent = district;
      var freeFrom = getFreeThreshold(result.zoneId);
      var freeText = freeFrom > 0 ? ' · ฟรีเมื่อ ' + freeFrom + '+ กล่อง' : '';
      var qty = state.quantity || 0;
      var carMin = getCarMinQty();
      var fee = (qty > carMin) ? result.car : result.moto;
      districtFeeEl.textContent = 'ค่าส่ง ' + formatMoney(fee) + ' บาท' + freeText;
      updateSummary(); saveState();
    }

    // delivery date — ไม่บังคับระยะเวลาสั่งล่วงหน้า
    if(els.deliveryDate) els.deliveryDate.addEventListener('change', function(){
      var v = this.value;
      if(v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) v='';
      var minISO = toISODate(new Date());
      if(v && v < minISO){
        // ไม่อนุญาตให้เลือกวันที่ผ่านมาแล้ว
        v = minISO;
        this.value = v;
        if(els.deliveryDateNote){
          els.deliveryDateNote.textContent = 'วันที่ผ่านมาแล้ว — ปรับเป็นวันนี้ให้อัตโนมัติ';
          els.deliveryDateNote.style.display='block';
          els.deliveryDateNote.style.color='#7F1D1D';
          els.deliveryDateNote.style.background='#FEF2F2';
          els.deliveryDateNote.style.borderColor='#FECACA';
        }
      }
      state.deliveryDate = v;
      updateSummary(); saveState();
      if(window.emitTrackingEvent) try{ emitTrackingEvent('budget_delivery_date', {status: v ? 'selected' : 'cleared'});}catch(e){}
    });
    document.querySelectorAll('[data-date]').forEach(function(b){
      b.addEventListener('click', function(){
        var type = this.getAttribute('data-date');
        var iso = '';
        var today = toISODate(new Date());
       if(type==='today') iso = today;
       else if(type==='tomorrow' || type==='+1') iso = addDays(today,1);
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
      if(window.emitTrackingEvent) try{ emitTrackingEvent('budget_delivery_time', {status: v ? 'selected' : 'cleared'});}catch(e){}
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
      state.selectedMeats = {};
      renderResults(); updateSummary();
    });

    // share / copy — สรุปหลัก (คัดลอกแล้วส่ง LINE ได้)
    var copyBtn = $('copySummary');
    if(copyBtn) copyBtn.addEventListener('click', function(){
      if(state.quantity < 10){
        if(els.copyToast){ els.copyToast.style.display='block'; els.copyToast.style.color='#DC2626'; els.copyToast.style.borderColor='rgba(220,38,38,.2)'; els.copyToast.textContent='คัดลอกไม่ได้ — จำนวนต้องอย่างน้อย 10 กล่อง'; setTimeout(function(){ if(els.copyToast){ els.copyToast.style.display='none'; els.copyToast.style.color=''; els.copyToast.style.borderColor=''; } }, 3000); }
        return;
      }
      var rawDistrictCopy = state.district ? String(state.district).trim() : '';
      var invalidDistrictCopy = rawDistrictCopy && !lookupDistrict(rawDistrictCopy);
      if(state.shippingMode === 'zone' && invalidDistrictCopy){
        if(els.copyToast){ els.copyToast.style.display='block'; els.copyToast.style.color='#DC2626'; els.copyToast.style.borderColor='rgba(220,38,38,.2)'; els.copyToast.textContent='คัดลอกไม่ได้ — เขตไม่พบ — กรุณาเลือกจากรายการที่แนะนำ'; setTimeout(function(){ if(els.copyToast){ els.copyToast.style.display='none'; els.copyToast.style.color=''; els.copyToast.style.borderColor=''; } }, 3000); }
        return;
      }
      if(state.shippingMode === 'zone' && !rawDistrictCopy){
        if(els.copyToast){ els.copyToast.style.display='block'; els.copyToast.style.color='#DC2626'; els.copyToast.style.borderColor='rgba(220,38,38,.2)'; els.copyToast.textContent='คัดลอกไม่ได้ — กรุณาพิมพ์เขตที่จัดส่งก่อน'; setTimeout(function(){ if(els.copyToast){ els.copyToast.style.display='none'; els.copyToast.style.color=''; els.copyToast.style.borderColor=''; } }, 3000); }
        return;
      }
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
      if(state.quantity < 10){
        if(els.copyToast){ els.copyToast.style.display='block'; els.copyToast.style.color='#DC2626'; els.copyToast.style.borderColor='rgba(220,38,38,.2)'; els.copyToast.textContent='คัดลอกไม่ได้ — จำนวนต้องอย่างน้อย 10 กล่อง'; setTimeout(function(){ if(els.copyToast){ els.copyToast.style.display='none'; els.copyToast.style.color=''; els.copyToast.style.borderColor=''; } }, 3000); }
        return;
      }
      var rawDistrictSelCopy = state.district ? String(state.district).trim() : '';
      var invalidDistrictSelCopy = rawDistrictSelCopy && !lookupDistrict(rawDistrictSelCopy);
      if(state.shippingMode === 'zone' && invalidDistrictSelCopy){
        if(els.copyToast){ els.copyToast.style.display='block'; els.copyToast.style.color='#DC2626'; els.copyToast.style.borderColor='rgba(220,38,38,.2)'; els.copyToast.textContent='คัดลอกไม่ได้ — เขตไม่พบ — กรุณาเลือกจากรายการที่แนะนำ'; setTimeout(function(){ if(els.copyToast){ els.copyToast.style.display='none'; els.copyToast.style.color=''; els.copyToast.style.borderColor=''; } }, 3000); }
        return;
      }
      if(state.shippingMode === 'zone' && !rawDistrictSelCopy){
        if(els.copyToast){ els.copyToast.style.display='block'; els.copyToast.style.color='#DC2626'; els.copyToast.style.borderColor='rgba(220,38,38,.2)'; els.copyToast.textContent='คัดลอกไม่ได้ — กรุณาพิมพ์เขตที่จัดส่งก่อน'; setTimeout(function(){ if(els.copyToast){ els.copyToast.style.display='none'; els.copyToast.style.color=''; els.copyToast.style.borderColor=''; } }, 3000); }
        return;
      }
      // block if any selected menu is below its minimum
      var ids = Object.keys(state.selected);
      for(var i=0;i<ids.length;i++){
        var mm = EED_MENUS.find(function(x){return String(x.id)===String(ids[i]);});
        if(mm && mm.minPerMenu && state.selected[ids[i]] < mm.minPerMenu){
          if(els.copyToast){
            els.copyToast.style.display='block';
            els.copyToast.style.color = '#DC2626';
            els.copyToast.style.borderColor = 'rgba(220,38,38,.2)';
            els.copyToast.textContent = 'คัดลอกไม่ได้ — มีเมนูที่จำนวนยังไม่ถึงขั้นต่ำ';
            setTimeout(function(){ if(els.copyToast){ els.copyToast.style.display='none'; els.copyToast.style.color=''; els.copyToast.style.borderColor=''; } }, 3000);
          }
          return;
        }
      }
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
      var orderDraft = saveOrderDraft();
      if(window.emitTrackingEvent) try{ emitTrackingEvent('order_draft_created', {source:'calculator',items:orderDraft ? orderDraft.items.length : 0,status:'draft'}); emitTrackingEvent('order_admin_handoff', {source:'calculator',items:orderDraft ? orderDraft.items.length : 0,status:'line_opened'});}catch(e){}
    });
    if(els.btnLine) els.btnLine.addEventListener('click', function(){
      var orderDraft = saveOrderDraft();
      if(window.emitTrackingEvent) try{ emitTrackingEvent('order_draft_created', {source:'calculator',items:orderDraft ? orderDraft.items.length : 0,status:'draft'}); emitTrackingEvent('order_admin_handoff', {source:'calculator',items:orderDraft ? orderDraft.items.length : 0,status:'line_opened'});}catch(e){}
    });

    // initial render (local)
    updateSummary();
    renderResults();
    if(els.floatingSummary){
      var syncFloatingSummary = function(){
        els.floatingSummary.classList.toggle('is-visible', window.scrollY > 260);
      };
      window.addEventListener('scroll', syncFloatingSummary, {passive:true});
      syncFloatingSummary();
    }
    // try server overrides (planner-overrides.json) for deployed site
    loadServerOverrides(function(){
      refreshShipZoneSelect();
      if(els.shippingZone) els.shippingZone.value = state.shippingZone;
      updateSummary();
      renderResults();
    });
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
