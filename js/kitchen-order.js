(function(){
  'use strict';

  var LS_KEY = 'eed_budget_calc_v1';
  var LS_SHIP = 'eed_budget_ship_v1';
  var LS_DATE = 'eed_delivery_date_v1';
  var LS_TIME = 'eed_delivery_time_v1';
  var menus = (typeof EED_MENUS !== 'undefined' && Array.isArray(EED_MENUS)) ? EED_MENUS : [];
  var draft = {};
  var shipping = {};
  var standardizedDraft = null;

  function $(id){ return document.getElementById(id); }
  function readJSON(key, fallback){
    try{ var value = JSON.parse(localStorage.getItem(key)||'null'); return value || fallback; }catch(e){ return fallback; }
  }
  function readValue(key){
    try{ return localStorage.getItem(key) || ''; }catch(e){ return ''; }
  }
  function money(value){ return Number(value||0).toLocaleString('th-TH'); }
  function esc(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }
  function dateShort(iso){
    if(!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 'ยังไม่ระบุ';
    var p = iso.split('-');
    return p[2]+'/'+p[1]+'/'+p[0];
  }
  function dateThai(iso){
    if(!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 'ยังไม่ระบุ';
    var p = iso.split('-');
    var date = new Date(parseInt(p[0],10), parseInt(p[1],10)-1, parseInt(p[2],10));
    var weekdays = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
    var months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return 'วัน'+weekdays[date.getDay()]+'ที่ '+parseInt(p[2],10)+' '+months[parseInt(p[1],10)-1]+' '+(parseInt(p[0],10)+543)+' ('+dateShort(iso)+')';
  }
  function timeThai(time){ return /^\d{2}:\d{2}$/.test(time||'') ? time+' น.' : 'ยังไม่ระบุ'; }
  function menuById(id){
    return menus.find(function(menu){ return String(menu.id) === String(id); });
  }
  function toppings(menu){ return Array.isArray(menu.toppings) ? menu.toppings : (typeof EED_DEFAULT_TOPPINGS !== 'undefined' ? EED_DEFAULT_TOPPINGS : []); }
  function meats(){ return typeof EED_DEFAULT_MEATS !== 'undefined' ? EED_DEFAULT_MEATS : [{name:'ไก่สับ',price:0}]; }
  function optionsFor(id){
    var menu = menuById(id);
    if(!menu) return { names:[], extra:0 };
    var names = [];
    var extra = 0;
    var selectedToppings = draft.selectedToppings && draft.selectedToppings[id] || [];
    if(!Array.isArray(selectedToppings)) selectedToppings = [];
    selectedToppings.forEach(function(index){
      var topping = toppings(menu)[parseInt(index,10)];
      if(topping){ names.push(topping.name); extra += Number(topping.price)||0; }
    });
    var meatIndex = draft.selectedMeats && draft.selectedMeats[id];
    if(meatIndex === undefined) meatIndex = 0;
    var meat = meats()[parseInt(meatIndex,10)];
    if(meat) { names.unshift(meat.name); extra += Number(meat.price)||0; }
    return {names:names, extra:extra};
  }
  function applyOverrides(data){
    if(!data || typeof data !== 'object') return;
    try{
      if(data.prices) Object.keys(data.prices).forEach(function(id){ var price=parseFloat(data.prices[id]); var menu=menuById(id); if(menu&&!isNaN(price)) menu.price=price; });
      if(data.mins) Object.keys(data.mins).forEach(function(id){ var min=parseInt(data.mins[id],10); var menu=menuById(id); if(menu&&!isNaN(min)) menu.minPerMenu=min; });
      if(data.names) Object.keys(data.names).forEach(function(id){ var menu=menuById(id); if(menu&&data.names[id]) menu.name=String(data.names[id]); });
      if(data.toppings && Array.isArray(data.toppings)){
        window.EED_DEFAULT_TOPPINGS = data.toppings.slice();
        menus.forEach(function(menu){ menu.toppings = data.toppings.map(function(t){ return {name:String(t.name),price:parseInt(t.price,10)||0}; }); });
      }
      if(data.meats && Array.isArray(data.meats)) window.EED_DEFAULT_MEATS = data.meats.slice();
      if(Array.isArray(data.deleted)){
        var remaining = menus.filter(function(menu){ return data.deleted.indexOf(menu.id)===-1 && data.deleted.indexOf(String(menu.id))===-1; });
        menus.splice(0, menus.length);
        remaining.forEach(function(menu){ menus.push(menu); });
      }
      if(Array.isArray(data.newMenus)) data.newMenus.forEach(function(item){ if(item && item.name && !menuById(item.id)) menus.push({id:item.id,name:item.name,price:parseInt(item.price,10)||60,minPerMenu:parseInt(item.minPerMenu,10)||5,toppings:window.EED_DEFAULT_TOPPINGS||[]}); });
    }catch(e){}
  }
  function loadState(){
    standardizedDraft = window.EEDOrderDraft && window.EEDOrderDraft.get ? window.EEDOrderDraft.get() : null;
    if(standardizedDraft){
      draft = {
        selected: standardizedDraft.legacy && standardizedDraft.legacy.selected || {},
        selectedToppings: standardizedDraft.legacy && standardizedDraft.legacy.selectedToppings || {},
        selectedMeats: standardizedDraft.legacy && standardizedDraft.legacy.selectedMeats || {},
        quantity: parseInt(standardizedDraft.totals && standardizedDraft.totals.requestedQuantity,10) || 0,
        budgetPerBox: 0,
        deliveryDate: standardizedDraft.delivery && standardizedDraft.delivery.date || '',
        deliveryTime: standardizedDraft.delivery && standardizedDraft.delivery.time || ''
      };
      shipping = standardizedDraft.shipping || {};
      shipping.district = standardizedDraft.delivery && standardizedDraft.delivery.district || '';
      return;
    }
    draft = readJSON(LS_KEY, {});
    shipping = readJSON(LS_SHIP, {});
    draft.selected = draft.selected && typeof draft.selected === 'object' ? draft.selected : {};
    draft.selectedToppings = draft.selectedToppings && typeof draft.selectedToppings === 'object' ? draft.selectedToppings : {};
    draft.selectedMeats = draft.selectedMeats && typeof draft.selectedMeats === 'object' ? draft.selectedMeats : {};
    draft.quantity = parseInt(draft.quantity,10) || 0;
    draft.budgetPerBox = parseInt(draft.budgetPerBox,10) || 0;
    draft.deliveryDate = readValue(LS_DATE);
    draft.deliveryTime = readValue(LS_TIME);
  }
  function loadLocalOverrides(){
    var data = {};
    var keys = {
      prices:'eed_selling_v1', mins:'eed_mins_v1', names:'eed_names_v1',
      toppings:'eed_toppings_v1', meats:'eed_meats_v1', deleted:'eed_deleted_v1',
      newMenus:'eed_new_menus_v1'
    };
    Object.keys(keys).forEach(function(type){
      var value = readJSON(keys[type], null);
      if(value) data[type] = value;
    });
    applyOverrides(data);
  }
  function getItems(){
    if(standardizedDraft && Array.isArray(standardizedDraft.items) && standardizedDraft.items.length){
      return standardizedDraft.items.map(function(item){
        var qty = parseInt(item.quantity,10) || 0;
        if(!item.name || qty < 1) return null;
        return {
          id:item.id,
          menu:{name:item.name},
          qty:qty,
          options:{names:Array.isArray(item.options) ? item.options : [],extra:0},
          unit:Number(item.unitPrice)||0,
          total:Number(item.total)||0
        };
      }).filter(Boolean);
    }
    return Object.keys(draft.selected).map(function(id){
      var menu = menuById(id);
      var qty = parseInt(draft.selected[id],10) || 0;
      if(!menu || qty < 1) return null;
      var options = optionsFor(id);
      var unit = (Number(menu.price)||0) + options.extra;
      return {id:id,menu:menu,qty:qty,options:options,unit:unit,total:unit*qty};
    }).filter(Boolean);
  }
  function freeFrom(zone){
    if(typeof EED !== 'undefined' && EED.shippingZoneFreeThresholds && EED.shippingZoneFreeThresholds[zone] !== undefined) return parseInt(EED.shippingZoneFreeThresholds[zone],10)||0;
    return typeof EED !== 'undefined' ? parseInt(EED.freeDeliveryFrom,10)||50 : 50;
  }
  function shippingInfo(qty){
    if(standardizedDraft){
      return {
        label:shipping.label || 'ค่าจัดส่ง',
        text:shipping.text || 'รอทีมงานยืนยัน',
        fee:Number(shipping.fee)||0,
        unknown:!!shipping.requiresConfirmation
      };
    }
    var mode = shipping.mode || 'zone';
    var zone = shipping.zone || 'zone_1';
    var threshold = freeFrom(zone);
    var free = threshold > 0 && qty >= threshold;
    if(mode === 'free' || free) return {label:'ค่าจัดส่ง',text:mode === 'free' ? 'ฟรี (โปรโมชั่น)' : 'ฟรี ('+threshold+'+ กล่อง)',fee:0};
    if(mode === 'auto') return {label:'ค่าจัดส่ง',text:'รอทีมงานประเมินตามระยะทาง',fee:0,unknown:true};
    if(mode === 'manual'){
      var manual = parseInt(shipping.fee,10)||0;
      return {label:'ค่าจัดส่ง (ระบุเอง)',text:manual ? money(manual)+' บาท' : 'ฟรี',fee:manual};
    }
    var z = typeof EED !== 'undefined' && EED.shippingZones ? EED.shippingZones[zone] : null;
    if(!z) return {label:'ค่าจัดส่ง',text:'สอบถามตามเขตพื้นที่',fee:0,unknown:true};
    var carMin = typeof EED !== 'undefined' ? parseInt(EED.shippingCarMinQty,10)||40 : 40;
    var fee = qty > carMin ? (z.car||0) : (z.moto||0);
    return {label:'ค่าจัดส่ง'+(shipping.district ? ' ('+shipping.district+')' : ''),text:fee ? money(fee)+' บาท' : 'สอบถามตามเขตพื้นที่',fee:fee,unknown:!fee};
  }
  function buildMessage(items, ship, food, qty){
    var lines = ['สรุปออเดอร์สำหรับครัว — EED HALAL','',
      '📅 วันส่ง: '+dateThai(draft.deliveryDate),
      '⏰ เวลาส่ง: '+timeThai(draft.deliveryTime),
      '📍 พื้นที่จัดส่ง: '+(shipping.district || 'ยังไม่ระบุ'),
      '📦 รวมทั้งหมด: '+money(qty)+' กล่อง'];
    lines.push('','รายการที่ต้องเตรียม:');
    items.forEach(function(item,index){
      var optionText = item.options.names.length ? ' ['+item.options.names.join(', ')+']' : '';
      lines.push((index+1)+'. '+item.menu.name+optionText+' — '+money(item.qty)+' กล่อง');
    });
    if(qty !== draft.quantity) lines.push('หมายเหตุ: รายการรวม '+money(qty)+' กล่อง แต่ตั้งออเดอร์ไว้ '+money(draft.quantity)+' กล่อง — กรุณาตรวจสอบ');
    lines.push('','รบกวนคุณอี้ดตรวจรายการแล้วเตรียมของด้วยครับ');
    return lines.join('\n');
  }
  function fallbackCopy(value){
    var area = document.createElement('textarea'); area.value=value; area.setAttribute('readonly',''); area.style.position='fixed'; area.style.opacity='0';
    document.body.appendChild(area); area.select(); try{ document.execCommand('copy'); }catch(e){} document.body.removeChild(area);
  }
  function copyText(value){
    if(navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(value).catch(function(){ fallbackCopy(value); });
    fallbackCopy(value); return Promise.resolve();
  }
  function setStatus(text){
    var el=$('copyKitchenStatus'); if(!el) return; el.textContent=text; el.style.display='block'; window.clearTimeout(setStatus.timer); setStatus.timer=window.setTimeout(function(){el.style.display='none';},2600);
  }
  function render(){
    var items=getItems();
    var empty=$('kitchenEmpty'), content=$('kitchenContent'), button=$('copyKitchenOrder');
    if(!items.length){ empty.style.display='block'; content.style.display='none'; button.disabled=true; return; }
    empty.style.display='none'; content.style.display='block'; button.disabled=false;
    var qty=items.reduce(function(sum,item){return sum+item.qty;},0);
    var food=items.reduce(function(sum,item){return sum+item.total;},0);
    var ship=shippingInfo(qty);
    $('kitchenDate').textContent=dateThai(draft.deliveryDate);
    $('kitchenTime').textContent=timeThai(draft.deliveryTime);
    $('kitchenDistrict').textContent=shipping.district || 'ยังไม่ระบุ';
    $('kitchenMenuCount').textContent=items.length+' เมนู';
    $('kitchenTotalQty').textContent=money(qty)+' กล่อง';
    $('kitchenItems').innerHTML=items.map(function(item,index){
      var options=item.options.names.length ? '<div class="kitchen-item-options">'+esc(item.options.names.join(' · '))+'</div>' : '';
      return '<div class="kitchen-item"><span class="kitchen-item-number">'+(index+1)+'</span><div><div class="kitchen-item-name">'+esc(item.menu.name)+'</div>'+options+'</div><div class="kitchen-item-price"><span class="kitchen-item-qty">'+money(item.qty)+' กล่อง</span>'+money(item.unit)+' บ./กล่อง</div></div>';
    }).join('');
    $('kitchenFoodTotal').textContent=money(food)+' บาท';
    $('kitchenShippingLabel').textContent=ship.label;
    $('kitchenShipping').textContent=ship.text;
    $('kitchenGrandTotal').textContent=money(food+ship.fee)+' บาท';
    var note=$('kitchenNote');
    var notes=[];
    if(standardizedDraft) notes.push('เลขอ้างอิง '+standardizedDraft.reference+' · รอแอดมินยืนยันก่อนส่งเข้าครัว');
    if(!draft.deliveryDate) notes.push('ยังไม่ได้ระบุวันส่ง');
    if(!draft.deliveryTime) notes.push('ยังไม่ได้ระบุเวลาส่ง');
    if(qty !== draft.quantity) notes.push('จำนวนรายการรวมไม่ตรงกับจำนวนออเดอร์ที่ตั้งไว้');
    if(ship.unknown) notes.push('ค่าส่งยังต้องให้ทีมงานยืนยัน');
    note.textContent=notes.length ? '⚠️ '+notes.join(' · ') : '✓ รายการพร้อมส่งให้ครัวตรวจสอบ';
    note.style.display='block';
    button.onclick=function(){ copyText(buildMessage(items,ship,food,qty)).then(function(){ setStatus('คัดลอกแล้ว — นำไปวางใน LINE กลุ่มครัวได้เลย ✓'); if(window.emitTrackingEvent) try{emitTrackingEvent('kitchen_order_copy',{menus:items.length,quantity:qty});}catch(e){} }); };
  }
  function loadServerOverrides(){
    if(location.protocol==='file:'){ render(); return; }
    fetch('data/planner-overrides.json?t='+Date.now(),{cache:'no-store'}).then(function(response){ if(!response.ok) throw new Error(); return response.json(); }).then(function(data){ applyOverrides(data); render(); }).catch(function(){ render(); });
  }
  loadState();
  loadLocalOverrides();
  loadServerOverrides();
})();
