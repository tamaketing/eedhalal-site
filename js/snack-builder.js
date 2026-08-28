/* EED HALAL — Snack Box Builder
 * Interactive tool for customers to build their own snack box.
 * Reads EED_SNACK_MENUS from snack-data.js and renders a picker UI.
 * Sends summary to LINE via pre-filled message.
 */
(function(){
  'use strict';

  var LINE_URL = 'https://lin.ee/CfvqJTd';

  function esc(s){
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function $(id){ return document.getElementById(id); }

  /* ─── State ─── */
  var state = {
    quantity: 50,
    savory: [],   // selected savory ids (optional, +40baht each)
    sweet: [],    // selected sweet ids (max 1)
    juice: [],    // selected juice ids (max 1)
    addon: 'water' // selected drink addon id
  };

  /* ─── Get items by category ─── */
  function getMenus(cat){
    if(typeof EED_SNACK_MENUS==='undefined') return [];
    return EED_SNACK_MENUS.filter(function(m){ return m.category===cat; });
  }

  function getAddons(){
    if(typeof EED_SNACK_ADDONS==='undefined') return [];
    return EED_SNACK_ADDONS;
  }

  function getAddonById(id){
    var addons = getAddons();
    for(var i=0;i<addons.length;i++){
      if(addons[i].id===id) return addons[i];
    }
    return addons[0];
  }

  function getItemById(id){
    if(typeof EED_SNACK_MENUS==='undefined') return null;
    for(var i=0;i<EED_SNACK_MENUS.length;i++){
      if(EED_SNACK_MENUS[i].id===id) return EED_SNACK_MENUS[i];
    }
    return null;
  }

  /* ─── Price calc ─── */
  function calcPricePerBox(){
    var addon = getAddonById(state.addon);
    var savoryCost = 0;
    for(var i=0;i<state.savory.length;i++){
      var m = getItemById(state.savory[i]);
      if(m) savoryCost += m.price;
    }
    return 40 + savoryCost + (addon ? addon.price : 0);
  }

  function calcTotal(){
    return calcPricePerBox() * state.quantity;
  }

  /* ─── Render checkboxes (generic) ─── */
  function renderCategory(catId, containerId, stateArr, maxCount, updateFn){
    var container = $(containerId);
    if(!container) return;
    var items = getMenus(catId);
    var html = '';
    for(var i=0;i<items.length;i++){
      var m = items[i];
      var checked = stateArr.indexOf(m.id)!==-1;
      html += '<label class="sb-check-item'+(checked?' active':'')+'" data-id="'+esc(m.id)+'">';
      html += '<input type="checkbox" value="'+esc(m.id)+'"'+(checked?' checked':'')+' class="sb-check-input">';
      html += '<span class="sb-check-box"></span>';
      html += '<span class="sb-check-name">'+esc(m.name)+'</span>';
      html += '</label>';
    }
    container.innerHTML = html;

    var inputs = container.querySelectorAll('.sb-check-input');
    for(var j=0;j<inputs.length;j++){
      inputs[j].addEventListener('change', function(){
        var id = this.value;
        /* determine which state key */
        var key;
        if(containerId==='sbSavoryList') key='savory';
        else if(containerId==='sbJuiceList') key='juice';
        else key='sweet';
        if(this.checked){
          if(state[key].indexOf(id)===-1) state[key].push(id);
        } else {
          state[key] = state[key].filter(function(x){ return x!==id; });
        }
        /* enforce max */
        if(maxCount>0 && state[key].length>maxCount){
          var removed = state[key].shift();
          var remCb = container.querySelector('input[value="'+removed+'"]');
          if(remCb){ remCb.checked=false; remCb.parentElement.classList.remove('active'); }
        }
        updateFn();
        updateSummary();
      });
    }
    updateFn();
  }

  /* ─── Render savory (optional, +40 baht) ─── */
  function renderSavory(){
    renderCategory('savory','sbSavoryList',state.savory,0,updateSavoryCount);
  }

  function updateSavoryCount(){
    var el = $('sbSavoryCount');
    if(el) el.textContent = state.savory.length;
    var items = document.querySelectorAll('#sbSavoryList .sb-check-item');
    for(var i=0;i<items.length;i++){
      var id = items[i].getAttribute('data-id');
      if(state.savory.indexOf(id)!==-1) items[i].classList.add('active');
      else items[i].classList.remove('active');
    }
  }

  /* ─── Render sweet checkboxes ─── */
  function renderSweet(){
    renderCategory('sweet','sbSweetList',state.sweet,1,updateSweetCount);
  }

  function updateSweetCount(){
    var el = $('sbSweetCount');
    if(el) el.textContent = state.sweet.length;
    var items = document.querySelectorAll('#sbSweetList .sb-check-item');
    for(var i=0;i<items.length;i++){
      var id = items[i].getAttribute('data-id');
      if(state.sweet.indexOf(id)!==-1) items[i].classList.add('active');
      else items[i].classList.remove('active');
    }
  }

  /* ─── Render juice checkboxes ─── */
  function renderJuice(){
    renderCategory('juice','sbJuiceList',state.juice,1,updateJuiceCount);
  }

  function updateJuiceCount(){
    var el = $('sbJuiceCount');
    if(el) el.textContent = state.juice.length;
    var items = document.querySelectorAll('#sbJuiceList .sb-check-item');
    for(var i=0;i<items.length;i++){
      var id = items[i].getAttribute('data-id');
      if(state.juice.indexOf(id)!==-1) items[i].classList.add('active');
      else items[i].classList.remove('active');
    }
  }

  /* ─── Render addon radios ─── */
  function renderAddons(){
    var container = $('sbAddonList');
    if(!container) return;
    var addons = getAddons();
    var html = '';
    for(var i=0;i<addons.length;i++){
      var a = addons[i];
      var checked = state.addon===a.id;
      html += '<label class="sb-radio-item'+(checked?' active':'')+'" data-id="'+esc(a.id)+'">';
      html += '<input type="radio" name="sbAddon" value="'+esc(a.id)+'"'+(checked?' checked':'')+' class="sb-radio-input">';
      html += '<span class="sb-radio-dot"></span>';
      html += '<span class="sb-radio-emoji">'+esc(a.emoji)+'</span>';
      html += '<span class="sb-radio-info">';
      html += '<span class="sb-radio-name">'+esc(a.name)+'</span>';
      html += '<span class="sb-radio-note">'+esc(a.note)+'</span>';
      html += '</span>';
      html += '</label>';
    }
    container.innerHTML = html;

    var inputs = container.querySelectorAll('.sb-radio-input');
    for(var j=0;j<inputs.length;j++){
      inputs[j].addEventListener('change', function(){
        state.addon = this.value;
        var items = container.querySelectorAll('.sb-radio-item');
        for(var k=0;k<items.length;k++){
          if(items[k].getAttribute('data-id')===state.addon) items[k].classList.add('active');
          else items[k].classList.remove('active');
        }
        updateSummary();
      });
    }
  }

  /* ─── Quantity stepper ─── */
  function initQuantity(){
    var num = $('sbQtyNumber');
    var range = $('sbQtyRange');
    var dec = $('sbQtyDec');
    var inc = $('sbQtyInc');
    if(!num) return;

    function setQty(v){
      v = parseInt(v,10)||50;
      if(v<50) v=50;
      if(v>1000) v=1000;
      state.quantity = v;
      num.value = v;
      if(range) range.value = v;
      updateSummary();
    }

    num.addEventListener('change', function(){ setQty(this.value); });
    if(range) range.addEventListener('input', function(){ setQty(this.value); });
    if(dec) dec.addEventListener('click', function(){ setQty(state.quantity-5); });
    if(inc) inc.addEventListener('click', function(){ setQty(state.quantity+5); });

    /* quick buttons */
    var quickBtns = document.querySelectorAll('[data-sb-qty]');
    for(var i=0;i<quickBtns.length;i++){
      quickBtns[i].addEventListener('click', function(){
        setQty(parseInt(this.getAttribute('data-sb-qty'),10));
      });
    }
  }

  /* ─── Update summary panel ─── */
  function updateSummary(){
    var pricePerBox = calcPricePerBox();
    var total = calcTotal();
    var addon = getAddonById(state.addon);

    var elBudget = $('sbSumBudget');
    if(elBudget) elBudget.textContent = pricePerBox;

    var elQty = $('sbSumQty');
    if(elQty) elQty.textContent = state.quantity;
    var elQty2 = $('sbSumQty2');
    if(elQty2) elQty2.textContent = state.quantity;

    var elAddon = $('sbSumAddon');
    if(elAddon) elAddon.textContent = addon ? addon.name : 'น้ำเปล่า';

    var elAddonPrice = $('sbSumAddonPrice');
    if(elAddonPrice) elAddonPrice.textContent = addon && addon.price>0 ? '+'+addon.price+'บ' : 'ฟรี';

    var elSweet = $('sbSumSweet');
    if(elSweet){
      var sm = state.sweet.length ? getItemById(state.sweet[0]) : null;
      elSweet.textContent = sm ? sm.name : '— ยังไม่เลือก —';
    }

    var elSavory = $('sbSumSavory');
    if(elSavory){
      var svNames = state.savory.map(function(id){ var m=getItemById(id); return m?m.name:''; }).filter(Boolean);
      elSavory.textContent = svNames.length ? svNames.join(', ') : '— ไม่เลือก (Basik 40บ) —';
    }

    var elJuice = $('sbSumJuice');
    if(elJuice){
      var jm = state.juice.length ? getItemById(state.juice[0]) : null;
      elJuice.textContent = jm ? jm.name : '— ยังไม่เลือก —';
    }

    var elFood = $('sbSumFood');
    if(elFood){
      var savoryCost = 0;
      for(var si=0;si<state.savory.length;si++){
        var sm2 = getItemById(state.savory[si]);
        if(sm2) savoryCost += sm2.price;
      }
      elFood.textContent = ((40 + savoryCost) * state.quantity).toLocaleString('th-TH')+' บาท';
    }

    var elShipLabel = $('sbSumShipLabel');
    var elShip = $('sbSumShip');
    if(state.quantity>=50){
      if(elShipLabel) elShipLabel.textContent = 'ค่าส่ง';
      if(elShip) elShip.textContent = 'ฟรี';
    } else {
      if(elShipLabel) elShipLabel.textContent = 'ค่าส่ง (ขั้นต่ำ 50 กล่อง ส่งฟรี)';
      if(elShip) elShip.textContent = 'สอบถาม';
    }

    var elTotal = $('sbSumTotal');
    if(elTotal) elTotal.textContent = total.toLocaleString('th-TH');

    var elAvg = $('sbSumAvg');
    if(elAvg) elAvg.textContent = pricePerBox;

    /* LINE button */
    updateLineLink();
  }

  /* ─── Build LINE message ─── */
  function buildMessage(){
    var lines = [];
    lines.push('📦 สั่ง Snack Box ฮาลาล');
    lines.push('');
    var savoryCost = 0;
    for(var si=0;si<state.savory.length;si++){
      var sm = getItemById(state.savory[si]);
      if(sm) savoryCost += sm.price;
    }
    var basePrice = 40 + savoryCost;
    lines.push('💰 งบต่อกล่อง: '+basePrice+' บาท');
    lines.push('📦 จำนวน: '+state.quantity+' กล่อง');
    lines.push('');

    if(state.savory.length){
      var savNames = state.savory.map(function(id){
        var m=getItemById(id);
        return m ? '• '+m.name+' (+'+m.price+'บ)' : '';
      }).filter(Boolean);
      lines.push('🥐 ของว่างคาว:');
      lines.push(savNames.join('\n'));
      lines.push('');
    }

    if(state.sweet.length){
      var sweetM = getItemById(state.sweet[0]);
      if(sweetM) lines.push('🍰 ของหวาน: • '+sweetM.name);
      lines.push('');
    }

    if(state.juice.length){
      var juiceM = getItemById(state.juice[0]);
      if(juiceM) lines.push('🧃 น้ำผลไม้: • '+juiceM.name);
      lines.push('');
    }

    var addon = getAddonById(state.addon);
    if(addon){
      lines.push('☕ เครื่องดื่ม: '+addon.name+(addon.price>0?' (+'+addon.price+'บ)':' (ฟรี)'));
      lines.push('');
    }

    lines.push('💵 ราคารวม: '+calcTotal().toLocaleString('th-TH')+' บาท');
    lines.push('('+basePrice+' x '+state.quantity+(addon&&addon.price>0?' + '+addon.price+'บ/กล่อง':'')+')');
    lines.push('');
    lines.push('📊 ข้อมูลนี้คำนวณจากระบบ — ราคาสุดท้ายทีมงานยืนยันครับ');

    return lines.join('\n');
  }

  function updateLineLink(){
    var btn = $('sbLineBtn');
    if(!btn) return;
    btn.href = LINE_URL;
    btn.onclick = function(e){
      var msg = buildMessage();
      if(navigator.clipboard){
        navigator.clipboard.writeText(msg).then(function(){
          showToast('สรุปถูกคัดลอกแล้ว! วางใน LINE ได้เลย ✓');
        });
      } else {
        var ta = document.createElement('textarea');
        ta.value = msg;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('สรุปถูกคัดลอกแล้ว! วางใน LINE ได้เลย ✓');
      }
    };
  }

  /* ─── Copy summary ─── */
  function copySummary(){
    var msg = buildMessage();
    if(navigator.clipboard){
      navigator.clipboard.writeText(msg).then(function(){
        showToast('คัดลอกแล้ว! วางใน LINE ได้เลย ✓');
      });
    } else {
      var ta = document.createElement('textarea');
      ta.value = msg;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('คัดลอกแล้ว! วางใน LINE ได้เลย ✓');
    }
  }

  function showToast(text){
    var el = $('sbCopyToast');
    if(!el) return;
    el.textContent = text;
    el.style.display = 'block';
    setTimeout(function(){ el.style.display='none'; }, 2500);
  }

  /* ─── Init ─── */
  function init(){
    if(typeof EED_SNACK_MENUS==='undefined') return;
    renderSweet();
    renderSavory();
    renderJuice();
    renderAddons();
    initQuantity();
    updateSummary();

    var copyBtn = $('sbCopySummary');
    if(copyBtn) copyBtn.addEventListener('click', copySummary);
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
