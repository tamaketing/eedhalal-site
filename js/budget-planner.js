(function(){
  'use strict';
  var PIN = '2024';
  var LS_AUTH = 'eed_planner_auth';
  var LS_COSTS = 'eed_costs_v1';
  var LS_SELLING = 'eed_selling_v1';
  var LS_MARGIN = 'eed_margin_v1';
  var state = {
    margin: 20,
    tolerance: 2,
    qty: 30,
    totalBudget: 3000,
    deliveryFee: 200,
    category: 'all'
  };
  var suggestionTimer = null;

  // Delay expensive searches while the user is still editing a control.
  function queueSuggestions(delay){
    if(suggestionTimer) clearTimeout(suggestionTimer);
    suggestionTimer = setTimeout(function(){
      suggestionTimer = null;
      updateSuggestions();
    }, delay === undefined ? 120 : delay);
  }
  function getUsable(){
    var u = state.totalBudget - state.deliveryFee;
    return u < 0 ? 0 : u;
  }
  function getPerBoxUsable(){
    return getUsable() / Math.max(1, state.qty);
  }
  function getProfit(){
    return Math.round(state.totalBudget * state.margin / 100);
  }
  function getCostBudget(){
    var c = state.totalBudget - getProfit() - state.deliveryFee;
    return c < 0 ? 0 : c;
  }
  function getPerCostPerBox(){
    return getCostBudget() / Math.max(1, state.qty);
  }
  function calcAutoDelivery(qty){
    return qty >= 50 ? 0 : 200;
  }
  function updateDeliveryBadge(){
    var badge = $('plannerDeliveryBadge');
    var fee = state.deliveryFee;
    if(!badge) return;
    if(fee===0){
      badge.textContent = state.qty >=50 ? 'ฟรี (50+ กล่อง)' : 'ฟรี';
      badge.style.background='var(--primary-soft)';
      badge.style.color='var(--primary)';
    } else {
      badge.textContent = state.qty >=50 ? 'ปกติฟรี แต่ตั้ง '+fmt(fee)+' บาท' : 'ไม่ฟรี';
      badge.style.background='#FEF2F2';
      badge.style.color='#7F1D1D';
    }
  }
  function updateUsableDisplay(){
    var usable = getUsable(); // ยอดขายรวม
    var costBudget = getCostBudget();
    var perBox = getPerBoxUsable();
    var perCost = getPerCostPerBox();
    var profit = getProfit();
    var usableEl = $('plannerUsable');
    var perBoxUsableEl = $('plannerUsablePerBox');
    var perBoxEl = $('plannerPerBox');
    var usableInline = $('plannerUsableInline');
    var qtyInline = $('plannerQtyInline');
    var profitShow = $('plannerProfitShow');
    var deliveryShow = $('plannerDeliveryShow');
    var formula = $('plannerFormula');
    if(usableEl) usableEl.textContent = fmt(costBudget);
    if(perBoxUsableEl) perBoxUsableEl.textContent = fmt(Math.floor(perCost));
    if(perBoxEl) perBoxEl.textContent = fmt(Math.floor(perCost));
    if(usableInline) usableInline.textContent = fmt(costBudget);
    if(qtyInline) qtyInline.textContent = state.qty;
    if(profitShow) profitShow.textContent = fmt(profit);
    if(deliveryShow) deliveryShow.textContent = fmt(state.deliveryFee);
    if(formula) formula.textContent = fmt(state.totalBudget) + ' - ' + fmt(profit) + ' - ' + fmt(state.deliveryFee) + ' = ' + fmt(costBudget);
  }

  function $(id){ return document.getElementById(id); }
  function fmt(n){ return Number(n).toLocaleString('th-TH'); }
  function calcSelling(cost, margin){
    if(typeof margin !== 'number') margin = state.margin;
    // กำไร % ของราคาขาย → ขาย = ทุน / (1 - margin%)
    if(margin >= 99) margin = 99;
    var raw = cost / (1 - margin/100);
    return Math.ceil(raw/5)*5;
  }
  function selling(cost){
    return calcSelling(cost, state.margin);
  }
  function getSelling(m){
    // actual selling price is m.price (owner editable)
    return m.price;
  }

  // --- Auth ---
  function checkAuth(){
    try{
      var url = new URL(window.location.href);
      var key = url.searchParams.get('key');
      if(key === PIN){
        localStorage.setItem(LS_AUTH, PIN);
        // clean url
        url.searchParams.delete('key');
        window.history.replaceState({}, '', url.pathname + (url.search ? '?' + url.searchParams.toString() : '') + url.hash);
        return true;
      }
      return localStorage.getItem(LS_AUTH) === PIN;
    }catch(e){ return false; }
  }
  function showGate(show){
    var gate = $('plannerGate');
    var app = $('plannerApp');
    if(show){
      gate.style.display='flex';
      app.style.display='none';
    } else {
      gate.style.display='none';
      app.style.display='block';
    }
  }
  function initGate(){
    var gate = $('plannerGate');
    var input = $('gatePin');
    var btn = $('gateBtn');
    var err = $('gateErr');
    function tryAuth(){
      var v = (input.value||'').trim();
      if(v===PIN){
        localStorage.setItem(LS_AUTH, PIN);
        showGate(false);
        initPlanner();
      } else {
        err.textContent='รหัสไม่ถูกต้อง ลองอีกครั้ง';
        err.style.display='block';
        input.select();
      }
    }
    btn.addEventListener('click', tryAuth);
    input.addEventListener('keydown', function(e){ if(e.key==='Enter') tryAuth(); });
    // also allow ?key=2024 auto
    if(checkAuth()){
      showGate(false);
      initPlanner();
    } else {
      showGate(true);
      input.focus();
    }
    var logout = $('plannerLogout');
    if(logout) logout.addEventListener('click', function(){
      localStorage.removeItem(LS_AUTH);
      location.reload();
    });
  }

  // --- Load/Save costs & selling ---
  function loadCosts(){
    try{
      var saved = JSON.parse(localStorage.getItem(LS_COSTS)||'null');
      if(saved){
        for(var id in saved){
          if(saved.hasOwnProperty(id)){
            var cost = parseFloat(saved[id]);
            if(!isNaN(cost)){
              EED_COSTS[id]=cost;
              for(var i=0;i<EED_MENUS.length;i++) if(String(EED_MENUS[i].id)===String(id)) EED_MENUS[i].cost=cost;
            }
          }
        }
      }
      var savedSell = JSON.parse(localStorage.getItem(LS_SELLING)||'null');
      if(savedSell){
        for(var sid in savedSell){
          if(savedSell.hasOwnProperty(sid)){
            var sell = parseFloat(savedSell[sid]);
            if(!isNaN(sell)){
              EED_SELLING[sid]=sell;
              for(var j=0;j<EED_MENUS.length;j++) if(String(EED_MENUS[j].id)===String(sid)) EED_MENUS[j].price=sell;
            }
          }
        }
      }
      var m = localStorage.getItem(LS_MARGIN);
      if(m!==null) state.margin = parseFloat(m);
      var tol = localStorage.getItem('eed_tolerance_v1');
      if(tol!==null) state.tolerance = parseFloat(tol);
      var del = localStorage.getItem('eed_delivery_v1');
      if(del!==null) state.deliveryFee = parseFloat(del);
      else state.deliveryFee = calcAutoDelivery(state.qty);
    }catch(e){}
  }
  function saveCosts(){
    try{
      localStorage.setItem(LS_COSTS, JSON.stringify(EED_COSTS));
      localStorage.setItem(LS_SELLING, JSON.stringify(EED_SELLING));
      localStorage.setItem(LS_MARGIN, String(state.margin));
      localStorage.setItem('eed_tolerance_v1', String(state.tolerance));
      localStorage.setItem('eed_delivery_v1', String(state.deliveryFee));
    }catch(e){}
  }
  function saveSelling(id, price, deferSave){
    EED_SELLING[id]=price;
    for(var i=0;i<EED_MENUS.length;i++) if(String(EED_MENUS[i].id)===String(id)) EED_MENUS[i].price=price;
    if(!deferSave) saveCosts();
  }

  // --- Planner ---
  function initPlanner(){
    loadCosts();
    var marginRange = $('plannerMargin');
    var marginNum = $('plannerMarginNum');
    var qtyInput = $('plannerQty');
    var qtyRange = $('plannerQtyRange');
    var totalInput = $('plannerTotal');
    var deliveryInput = $('plannerDelivery');
    var tolRange = $('plannerTolerance');
    var tolVal = $('plannerToleranceVal');
    var catChips = document.querySelectorAll('[data-pcat]');

    marginRange.value = state.margin;
    marginNum.value = state.margin;
    try{
      var last = JSON.parse(localStorage.getItem('eed_planner_last')||'null');
      if(last){
        if(last.qty) state.qty = last.qty;
        if(last.totalBudget) state.totalBudget = last.totalBudget;
        if(last.deliveryFee !== undefined) state.deliveryFee = last.deliveryFee;
      }
    }catch(e){}
    // auto delivery if not set
    if(state.qty >= 50 && state.deliveryFee !== 0){
      // keep manual if user set, otherwise auto
    }
    qtyInput.value = state.qty;
    qtyRange.value = state.qty;
    totalInput.value = state.totalBudget;
    if(deliveryInput) deliveryInput.value = state.deliveryFee;
    if(tolRange) tolRange.value = state.tolerance;
    if(tolVal) tolVal.textContent = state.tolerance;
    var tol2 = $('plannerTol2');
    if(tol2) tol2.textContent = state.tolerance;
    var tolLive = $('plannerToleranceVal');
    // also update badge
    updateDeliveryBadge();

    renderCostTable();
    bindCostTable();
    bindPlannerControls();
    updateAll(true);

    // category chips
    catChips.forEach(function(c){
      c.addEventListener('click', function(){
        state.category = this.getAttribute('data-pcat');
        catChips.forEach(function(x){ x.classList.remove('active'); });
        this.classList.add('active');
        queueSuggestions();
      });
    });
  }

  function renderCostTable(){
    var tbody = $('costTableBody');
    if(!tbody) return;
    var html = '';
    var cats = {};
    EED_MENUS.forEach(function(m){
      if(!cats[m.category]) cats[m.category]=[];
      cats[m.category].push(m);
    });
    var order = ['ข้าวราดแกง','ข้าวผัด','เส้น','ข้าวหมก','แกง/ต้ม'];
    var sortedCats = Object.keys(cats).sort(function(a,b){
      var ia = order.indexOf(a), ib = order.indexOf(b);
      if(ia===-1) ia=99; if(ib===-1) ib=99;
      return ia-ib;
    });
    sortedCats.forEach(function(cat){
      html += '<tr style="background:var(--bg);"><td colspan="5" style="font-weight:900;color:var(--primary);padding:.7rem .75rem;font-size:.85rem">'+cat+'</td></tr>';
      cats[cat].forEach(function(m){
        var s = getSelling(m);
        var profit = s - m.cost;
        var profitPct = s>0 ? ((profit / s)*100).toFixed(1) : '0.0';
        var profitColor = 'var(--primary)';
        var warn = '';
        html += '<tr data-id="'+m.id+'">'
          + '<td style="min-width:150px"><div style="font-weight:800;font-size:.88rem;line-height:1.2">'+m.name+'</div><div style="font-size:.72rem;color:var(--text-muted)">'+m.category+' · ขั้นต่ำ '+m.minPerMenu+'</div></td>'
          + '<td><input type="number" class="cost-input" data-id="'+m.id+'" value="'+m.cost+'" min="10" max="500" step="1" style="width:78px;height:36px;border:1px solid var(--border);border-radius:8px;text-align:center;font-weight:800;color:var(--primary)"></td>'
          + '<td><input type="number" class="sell-input" data-id="'+m.id+'" value="'+s+'" min="10" max="500" step="5" style="width:78px;height:36px;border:1px solid var(--border);border-radius:8px;text-align:center;font-weight:900;color:#92400E;background:#FFFBEB"><div style="font-size:.68rem;color:var(--text-muted);text-align:center;margin-top:.15rem">กำไร '+profitPct+'%</div></td>'
          + '<td style="text-align:center"><span data-profit="'+m.id+'" style="font-weight:800;color:'+profitColor+'">'+fmt(profit)+'</span><span style="font-size:.72rem;color:var(--text-muted)"> ('+profitPct+'%)</span>'+warn+'</td>'
          + '<td style="text-align:center"><span data-status="'+m.id+'" style="font-size:.75rem;font-weight:800;padding:.2rem .5rem;border-radius:999px"></span></td>'
          + '</tr>';
      });
    });
    tbody.innerHTML = html;
  }

  function bindCostTable(){
    var tbody = $('costTableBody');
    if(!tbody) return;
    tbody.querySelectorAll('.cost-input').forEach(function(inp){
      inp.addEventListener('input', function(){
        var id = this.getAttribute('data-id');
        var v = parseFloat(this.value);
        if(isNaN(v) || v<0) return;
        EED_COSTS[id]=v;
        for(var i=0;i<EED_MENUS.length;i++) if(String(EED_MENUS[i].id)===String(id)) EED_MENUS[i].cost=v;
        saveCosts();
        // ราคาขายไม่ปรับตามต้นทุน — แค่คำนวณกำไรใหม่
        updateCostRow(id);
        queueSuggestions();
        updateSummaryStats();
      });
    });
    tbody.querySelectorAll('.sell-input').forEach(function(inp){
      inp.addEventListener('input', function(){
        var id = this.getAttribute('data-id');
        var v = parseFloat(this.value);
        if(isNaN(v) || v<0) return;
        // round to 5
        v = Math.round(v);
        saveSelling(id, v);
        updateCostRow(id);
        queueSuggestions();
        updateSummaryStats();
      });
    });
    tbody.querySelectorAll('[data-apply-margin]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = this.getAttribute('data-apply-margin');
        var m = EED_MENUS.find(function(x){ return String(x.id)===String(id); });
        if(!m) return;
        var newSell = calcSelling(m.cost, state.margin);
        var sellInp = tbody.querySelector('.sell-input[data-id="'+id+'"]');
        if(sellInp) sellInp.value = newSell;
        saveSelling(id, newSell);
        updateCostRow(id);
        queueSuggestions();
        updateSummaryStats();
      });
    });
  }

  function updateCostRow(id, skipStatus){
    var m = EED_MENUS.find(function(x){ return String(x.id)===String(id); });
    if(!m) return;
    var s = getSelling(m);
    var profit = s - m.cost;
    var pct = s>0 ? ((profit/s)*100).toFixed(1) : '0.0';
      var profitEl = document.querySelector('[data-profit="'+id+'"]');
    if(profitEl){
      profitEl.textContent = fmt(profit);
      var pctEl = profitEl.nextElementSibling;
      if(pctEl) pctEl.textContent = ' ('+pct+'%)';
      profitEl.style.color='var(--primary)';
    }
    // update hint under selling input
    var tr = document.querySelector('tr[data-id="'+id+'"]');
    if(tr){
      var hint = tr.querySelector('.sell-input + div');
      if(hint){
        var pct = s>0 ? ((s - m.cost)/s*100).toFixed(1) : '0.0';
        hint.textContent = 'กำไร '+pct+'%';
      }
    }
    // update apply button text
    var btn = document.querySelector('[data-apply-margin="'+id+'"]');
    if(btn) btn.textContent='ใช้ '+state.margin+'%';
    if(!skipStatus) updateStatuses();
  }

  function updateStatuses(){
    var perBox = getPerBoxUsable();
    EED_MENUS.forEach(function(m){
      var s = getSelling(m);
      var el = document.querySelector('[data-status="'+m.id+'"]');
      if(!el) return;
      var baseStatus = s <= perBox ? 'อยู่ในงบ ✓' : 'เกิน '+fmt(Math.round(s - perBox))+'฿';
      if(s <= perBox){
        el.style.background='var(--primary-soft)';
        el.style.color='var(--primary)';
        el.style.border='1px solid rgba(29,107,62,.15)';
      } else {
        el.style.background='#FEF2F2';
        el.style.color='#7F1D1D';
        el.style.border='1px solid #FECACA';
      }
      el.textContent=baseStatus;
    });
  }

  function bindPlannerControls(){
    var marginRange = $('plannerMargin');
    var marginNum = $('plannerMarginNum');
    var marginLock = $('plannerLock');
    var qtyInput = $('plannerQty');
    var qtyRange = $('plannerQtyRange');
    var totalInput = $('plannerTotal');
    var perBoxEl = $('plannerPerBox');

    function onMarginChange(v, applyToAll){
      v = parseFloat(v);
      if(isNaN(v)) return;
      v = Math.max(5, Math.min(50, v));
      state.margin = v;
      marginRange.value = v;
      marginNum.value = v;
      // ราคาขายไม่ปรับตามต้นทุน — แค่คำนวณกำไรใหม่ (applyToAll ไม่ใช้แล้ว แต่เก็บไว้เผื่อ)
      if(applyToAll){
        EED_MENUS.forEach(function(m){
          var newSell = calcSelling(m.cost, v);
          var sellInp = document.querySelector('.sell-input[data-id="'+m.id+'"]');
          if(sellInp) sellInp.value = newSell;
          saveSelling(m.id, newSell, true);
          updateCostRow(m.id, true);
        });
      } else {
        EED_MENUS.forEach(function(m){ updateCostRow(m.id, true); });
      }
      saveCosts();
      updateAll();
    }

    marginRange.addEventListener('input', function(){ onMarginChange(this.value, false); });
    marginNum.addEventListener('input', function(){ onMarginChange(this.value, false); });
    if(marginLock){
      marginLock.addEventListener('click', function(){
        onMarginChange(20, false);
      });
    }
    var applyAllBtn = $('applyAllMargin');
    if(applyAllBtn){
      applyAllBtn.addEventListener('click', function(){
        if(!confirm('ตั้งราคาขายทุกเมนูใหม่ตามสูตร ทุน × '+state.margin+'% (ปัดขึ้นลง 5 บาท)?\nราคาขายที่แก้มือไว้จะถูกเขียนทับ')) return;
        onMarginChange(state.margin, true);
      });
    }

    function onQtyChange(v){
      v = parseInt(v,10);
      if(isNaN(v) || v<1) return;
      v = Math.max(1, Math.min(500, v));
      state.qty = v;
      qtyInput.value = v;
      qtyRange.value = v;
      // auto delivery: 50+ ฟรี
      var deliveryInput = $('plannerDelivery');
      if(v >= 50){
        if(state.deliveryFee !== 0){
          state.deliveryFee = 0;
          if(deliveryInput) deliveryInput.value = 0;
        }
      } else {
        if(state.deliveryFee === 0){
          state.deliveryFee = 200;
          if(deliveryInput) deliveryInput.value = 200;
        }
      }
      saveLast();
      saveCosts();
      updateAll();
    }
    function onTotalChange(v){
      v = parseInt(v,10);
      if(isNaN(v) || v<0) return;
      state.totalBudget = v;
      totalInput.value = v;
      saveLast();
      updateAll();
    }

    qtyInput.addEventListener('input', function(){ onQtyChange(this.value); });
    qtyRange.addEventListener('input', function(){ onQtyChange(this.value); });
    totalInput.addEventListener('input', function(){ onTotalChange(this.value); });

    var deliveryInput = $('plannerDelivery');
    var tolRange = $('plannerTolerance');
    function onDeliveryChange(v){
      v = parseInt(v,10);
      if(isNaN(v) || v<0) v=0;
      state.deliveryFee = v;
      if(deliveryInput) deliveryInput.value = v;
      saveCosts();
      saveLast();
      updateAll();
    }
    function onToleranceChange(v){
      v = parseFloat(v);
      if(isNaN(v)) v=0;
      v = Math.max(0, Math.min(5, v));
      state.tolerance = v;
      var tv = $('plannerToleranceVal');
      var tv2 = $('plannerTol2');
      if(tv) tv.textContent = v;
      if(tv2) tv2.textContent = v;
      if(tolRange) tolRange.value = v;
      saveCosts();
      updateAll();
    }
    if(deliveryInput){
      deliveryInput.addEventListener('input', function(){ onDeliveryChange(this.value); });
      document.querySelectorAll('[data-delivery]').forEach(function(b){
        b.addEventListener('click', function(){ onDeliveryChange(this.getAttribute('data-delivery')); });
      });
    }
    if(tolRange){
      tolRange.addEventListener('input', function(){ onToleranceChange(this.value); });
    }

    // quick buttons
    document.querySelectorAll('[data-pqty]').forEach(function(b){
      b.addEventListener('click', function(){
        onQtyChange(this.getAttribute('data-pqty'));
      });
    });
    document.querySelectorAll('[data-ptotal]').forEach(function(b){
      b.addEventListener('click', function(){
        onTotalChange(this.getAttribute('data-ptotal'));
      });
    });

    // reset costs & selling
    var resetBtn = $('resetCosts');
    if(resetBtn) resetBtn.addEventListener('click', function(){
      if(!confirm('รีเซ็ตต้นทุนและราคาขายทั้งหมดกลับเป็นค่าเริ่มต้น?')) return;
      localStorage.removeItem(LS_COSTS);
      localStorage.removeItem(LS_SELLING);
      EED_MENUS.forEach(function(m){
        var orig = m._origPrice || m.price;
        m.price = orig;
        var c = Math.round(orig/1.2);
        m.cost = c;
        EED_COSTS[m.id]=c;
        EED_SELLING[m.id]=orig;
      });
      saveCosts();
      renderCostTable();
      bindCostTable();
      updateAll();
    });

    // save/calc
    var calcBtn = $('plannerCalcBtn');
    if(calcBtn) calcBtn.addEventListener('click', function(){ updateAll(true); });

    // copy planner link
    var copyPlanner = $('copyPlannerLink');
    if(copyPlanner) copyPlanner.addEventListener('click', function(){
      var url = window.location.href.split('?')[0] + '?key='+PIN;
      navigator.clipboard.writeText(url).then(function(){
        copyPlanner.textContent='คัดลอกลิงก์แล้ว ✓';
        setTimeout(function(){ copyPlanner.textContent='คัดลอกลิงก์เจ้าของ'; },1500);
      });
    });
  }

  function saveLast(){
    try{ localStorage.setItem('eed_planner_last', JSON.stringify({qty: state.qty, totalBudget: state.totalBudget, deliveryFee: state.deliveryFee})); }catch(e){}
  }

  function updateAll(immediate){
    var usable = getUsable();
    var perBox = getPerBoxUsable();
    updateUsableDisplay();
    updateDeliveryBadge();
    // Update statuses
    updateStatuses();
    // Update suggestions after the user has stopped editing the controls.
    if(immediate) updateSuggestions();
    else queueSuggestions();
    // Update summary stats for cheapest scenario
    updateSummaryStats();
  }

  function updateSummaryStats(){
    var perBox = getPerBoxUsable();
    var need = state.margin - state.tolerance;
    var sellingMenus = EED_MENUS.map(function(m){
      var s = getSelling(m);
      return {m:m, s:s, profitPct: m.cost>0 ? ((s - m.cost)/m.cost*100) : 0};
    }).filter(function(x){ return x.s <= perBox && (state.category==='all' || x.m.category===state.category) && x.profitPct >= need - 0.001; })
      .sort(function(a,b){ return a.s-b.s; });

    var cheapest = sellingMenus[0];
    var cheapestCost = cheapest ? cheapest.m.cost : 0;
    var cheapestSell = cheapest ? cheapest.s : 0;
    var totalCost = cheapestCost * state.qty;
    var totalSell = cheapestSell * state.qty;
    var totalProfit = totalSell - totalCost;

    var totalCostEl = $('plannerTotalCost');
    var totalSellEl = $('plannerTotalSell');
    var totalProfitEl = $('plannerTotalProfit');
    var avgSellEl = $('plannerAvgSell');
    var marginEl = $('plannerMarginLive');

    if(totalCostEl) totalCostEl.textContent = fmt(totalCost);
    if(totalSellEl) totalSellEl.textContent = fmt(totalSell);
    if(totalProfitEl) totalProfitEl.textContent = fmt(totalProfit);
    if(avgSellEl) avgSellEl.textContent = cheapestSell ? fmt(cheapestSell) : '-';
    if(marginEl) marginEl.textContent = state.margin + '%';

    // also update free delivery hint
    var freeEl = $('plannerFree');
    if(freeEl){
      if(state.qty >= 50){
        freeEl.textContent='ส่งฟรีทั่วกรุงเทพฯ';
        freeEl.style.color='var(--primary)';
      } else {
        freeEl.textContent='ค่าส่งตามระยะทาง (ฟรี 50+ กล่อง)';
        freeEl.style.color='var(--text-muted)';
      }
    }
  }

  function getFilteredSelling(){
    var perBox = getPerBoxUsable();
    return EED_MENUS.map(function(m){
      var s = getSelling(m);
      return {m:m, s:s, profit: s-m.cost, profitPct: s>0 ? ((s-m.cost)/s*100) : 0};
    }).filter(function(x){
      var catOk = state.category==='all' || x.m.category===state.category;
      return x.s <= perBox && catOk;
    }).sort(function(a,b){ return a.s-b.s; });
  }
  function getFilteredSellingAll(){
    var perBox = getPerBoxUsable();
    return EED_MENUS.map(function(m){
      var s = getSelling(m);
      return {m:m, s:s, profit: s-m.cost, profitPct: s>0 ? ((s-m.cost)/s*100) : 0};
    }).filter(function(x){
      var catOk = state.category==='all' || x.m.category===state.category;
      return x.s <= perBox && catOk;
    }).sort(function(a,b){ return a.s-b.s; });
  }

  function generateSuggestions(){
    var profit = getProfit();
    var costBudget = getCostBudget();
    var qty = state.qty;
    var usable = getUsable();
    var salesTolerance = usable * 0.10;
    var allMenus = EED_MENUS;
    if(state.category !== 'all'){
      allMenus = allMenus.filter(function(x){ return x.category === state.category; });
    }
    var mapped = allMenus.map(function(m){
      var s = getSelling(m);
      var text = (m.name || '') + ' ' + (m.desc || '');
      var protein = /ไก่|chicken/i.test(text) ? 'chicken' : (/เนื้อ|beef/i.test(text) ? 'beef' : 'other');
      return {m:m, s:s, c:m.cost, protein:protein, profit: s - m.cost, profitPct: s>0 ? ((s - m.cost)/s*100) : 0};
    });

    var results = [];
    var lowestCostResult = null;

    // The customer's food budget is the primary target. Other criteria only
    // break ties between sets whose total sales are equally close.
    function compareResults(a,b){
      return (a.sellDiff - b.sellDiff) || (a.score - b.score);
    }

    // We only render four suggestions. Keep a bounded score-sorted working
    // set while searching so a large quantity cannot grow the result array
    // without limit. The cheapest valid result is tracked separately because
    // it may not be among the best-scoring results.
    function addResult(r){
      if(!r) return;
      if(!lowestCostResult || r.totalCost < lowestCostResult.totalCost) lowestCostResult = r;
      results.push(r);
      if(results.length >= 800){
        results.sort(compareResults);
        results = results.slice(0, 300);
      }
    }

    function evalCombo(items, qtys, numMenus){
      var totalSell=0, totalCost=0, mix=[];
      var sumQ=0;
      for(var i=0;i<items.length;i++){
        var q = qtys[i];
        if(!q) continue;
        if(q < items[i].m.minPerMenu) return null;
        sumQ += q;
        totalSell += items[i].s * q;
        totalCost += items[i].c * q;
        mix.push({m:items[i].m, s:items[i].s, c:items[i].c, qty:q});
      }
      if(sumQ !== qty) return null;

      var profitTotal = totalSell - totalCost;
      var profitPct = totalSell > 0 ? (profitTotal / totalSell * 100) : 0;

      if(profitTotal < 0) return null;
      if(totalCost > costBudget * 1.5) return null;
      if(Math.abs(totalSell - usable) > salesTolerance) return null;

      var costDiff = Math.abs(totalCost - costBudget);
      var sellDiff = Math.abs(totalSell - usable);
      var profitBathDiff = Math.abs(profitTotal - profit);
      var profitPctVal = profitPct;
      var profitScore = profitBathDiff * 0.35 + costDiff * 0.25 + sellDiff * 0.25;
      if(profitPctVal >= state.margin){
        profitScore -= (profitPctVal - state.margin) * 2;
      } else {
        profitScore += (state.margin - profitPctVal) * 8;
      }
      if(numMenus >= 3) profitScore -= 50;
      else if(numMenus === 2) profitScore -= 20;

      var avgSell = Math.round(totalSell / qty);
      var avgCost = Math.round(totalCost / qty);

      return {
        mix: mix,
        totalSell: totalSell,
        totalCost: totalCost,
        profit: profitTotal,
        profitPct: profitPct,
        avg: avgSell,
        avgCost: avgCost,
        score: profitScore,
        costDiff: costDiff,
        sellDiff: sellDiff,
        profitDiff: profitBathDiff,
        numMenus: numMenus
      };
    }

    // Preferred recommendation: a small variety set where every menu takes
    // roughly 20–30% of the order, with both chicken and beef represented.
    // Four or five menus are the practical range that can add up to 100%.
    function buildBalancedQtys(items){
      var k=items.length;
      var minShare=Math.ceil(qty*0.20);
      var maxShare=Math.floor(qty*0.30);
      var qs=[];
      var sum=0;
      for(var bi=0; bi<k; bi++){
        var qMin=Math.max(items[bi].m.minPerMenu, minShare);
        if(qMin>maxShare) return null;
        qs.push(qMin);
        sum+=qMin;
      }
      if(sum>qty || maxShare*k<qty) return null;

      var guard=0;
      while(sum<qty && guard++<qty*k){
        var best=-1, bestDistance=Infinity;
        for(var bj=0; bj<k; bj++){
          if(qs[bj]>=maxShare) continue;
          var distance=Math.abs((qs[bj]+1)-(qty/k));
          if(distance<bestDistance){ bestDistance=distance; best=bj; }
        }
        if(best<0) return null;
        qs[best]++;
        sum++;
      }
      return sum===qty ? qs : null;
    }

    function searchBalancedSets(priceLimit){
      var pool=mapped.filter(function(x){ return x.s<=getPerBoxUsable()*1.5; });
      var found=0;
      function visit(items, start, targetSize){
        if(items.length===targetSize){
          var hasChicken=false, hasBeef=false, minPrice=Infinity, maxPrice=0;
          for(var vi=0; vi<items.length; vi++){
            hasChicken = hasChicken || items[vi].protein==='chicken';
            hasBeef = hasBeef || items[vi].protein==='beef';
            minPrice=Math.min(minPrice,items[vi].s);
            maxPrice=Math.max(maxPrice,items[vi].s);
          }
          if(!hasChicken || !hasBeef || maxPrice-minPrice>priceLimit) return;
          var qs=buildBalancedQtys(items);
          if(!qs) return;
          var r=evalCombo(items,qs,targetSize);
          if(!r) return;
          r.title=items.map(function(x){ return x.m.name; }).join(' + ');
          r.desc=items.map(function(x,xi){ return x.m.name+' '+qs[xi]; }).join(' + ');
          r.type='mixed';
          r.priceSpread=maxPrice-minPrice;
          r.score += r.priceSpread*8;
          r.score -= 25;
          addResult(r);
          found++;
          return;
        }
        for(var pi=start; pi<pool.length; pi++){
          items.push(pool[pi]);
          visit(items,pi+1,targetSize);
          items.pop();
        }
      }
      // Prefer four menus; use five only when four cannot satisfy the order.
      visit([],0,4);
      if(!found) visit([],0,5);
      return found;
    }

    var hasBalancedSets=searchBalancedSets(15);
    if(!hasBalancedSets) hasBalancedSets=searchBalancedSets(30);

    // Keep the previous single/2/3-menu search as a fallback for budgets or
    // quantities where the preferred chicken+beef variety set is impossible.
    if(!hasBalancedSets) for(var si=0; si<mapped.length; si++){
      var it = mapped[si];
      var r1 = evalCombo([it], [qty], 1);
      if(r1){
        r1.title = it.m.name;
        r1.desc = it.m.name + ' × ' + qty + ' กล่อง';
        r1.type = 'single';
          addResult(r1);
      }
    }

    if(!hasBalancedSets) for(var i2=0; i2<mapped.length; i2++){
      for(var j2=i2+1; j2<mapped.length; j2++){
        var a2=mapped[i2], b2=mapped[j2];
        for(var qA=Math.max(a2.m.minPerMenu, Math.ceil(qty*0.25)); qA<=Math.min(qty - b2.m.minPerMenu, Math.floor(qty*0.75)); qA++){
          var qB = qty - qA;
          if(qB < b2.m.minPerMenu) continue;
          var r2 = evalCombo([a2,b2],[qA,qB], 2);
          if(r2){
            r2.title = a2.m.name + ' + ' + b2.m.name;
            r2.desc = a2.m.name + ' ' + qA + ' + ' + b2.m.name + ' ' + qB;
            r2.type = 'mixed';
              addResult(r2);
          }
        }
      }
    }

    function addNear(values, value){
      if(!isFinite(value)) return;
      var center = Math.round(value);
      for(var d=-2; d<=2; d++) values[center+d] = 1;
    }

    function addTripleResult(ca, cb, cc, qA3, qB3){
      var qC3 = qty - qA3 - qB3;
      if(qC3 < cc.m.minPerMenu) return;
      var r3 = evalCombo([ca,cb,cc],[qA3,qB3,qC3], 3);
      if(r3){
        r3.title = ca.m.name + ' + ' + cb.m.name + ' + ' + cc.m.name;
        r3.desc = ca.m.name + ' ' + qA3 + ' + ' + cb.m.name + ' ' + qB3 + ' + ' + cc.m.name + ' ' + qC3;
        r3.type = 'mixed';
        addResult(r3);
      }
    }

    if(!hasBalancedSets) for(var ci=0; ci<mapped.length; ci++){
      for(var cj=ci+1; cj<mapped.length; cj++){
        for(var ck=cj+1; ck<mapped.length; ck++){
          var ca=mapped[ci], cb=mapped[cj], cc=mapped[ck];
          var minA=ca.m.minPerMenu, minB=cb.m.minPerMenu, minC=cc.m.minPerMenu;
          var maxA=qty-minB-minC;
          if(maxA < minA) continue;

          if(qty <= 120){
            // Small orders are searched exhaustively, preserving the exact
            // result set for the normal use case.
            for(var qA3=minA; qA3<=maxA; qA3++){
              for(var qB3=minB; qB3<=qty-qA3-minC; qB3++){
                addTripleResult(ca, cb, cc, qA3, qB3);
              }
            }
          } else {
            // For large orders, search the mathematically relevant points:
            // boundaries, balanced splits, and quantities near the cost,
            // selling-total, and profit targets. This retains 3-menu mixes
            // while avoiding millions of nearly identical combinations.
            var qAValues={};
            var qAStep=Math.max(1, Math.ceil(qty/60));
            for(var qASeed=minA; qASeed<=maxA; qASeed+=qAStep) qAValues[qASeed]=1;
            qAValues[maxA]=1;
            for(var qAKey in qAValues){
              if(!qAValues.hasOwnProperty(qAKey)) continue;
              var qA4=parseInt(qAKey,10);
              var qBMin=minB, qBMax=qty-qA4-minC;
              if(qBMax < qBMin) continue;
              var qBValues={};
              addNear(qBValues, qBMin);
              addNear(qBValues, qBMax);
              addNear(qBValues, (qBMin+qBMax)/2);

              var baseCost=cc.c*qty+(ca.c-cc.c)*qA4;
              var baseSell=cc.s*qty+(ca.s-cc.s)*qA4;
              var costSlope=cb.c-cc.c;
              var sellSlope=cb.s-cc.s;
              var profitSlope=sellSlope-costSlope;
              addNear(qBValues, costSlope ? (costBudget*1.5-baseCost)/costSlope : NaN);
              addNear(qBValues, sellSlope ? (usable*1.5-baseSell)/sellSlope : NaN);
              addNear(qBValues, profitSlope ? (profit-(baseSell-baseCost))/profitSlope : NaN);

              for(var qBKey in qBValues){
                if(!qBValues.hasOwnProperty(qBKey)) continue;
                var qB4=parseInt(qBKey,10);
                if(qB4<qBMin || qB4>qBMax) continue;
                addTripleResult(ca, cb, cc, qA4, qB4);
              }
            }
          }
        }
      }
    }

    results.sort(compareResults);

    var seen={}, uniq=[];
    results.forEach(function(r){
      var key = r.mix.map(function(x){ return x.m.id + ':' + x.qty; }).sort().join(',');
      if(!seen[key]){ seen[key]=1; uniq.push(r); }
    });

    if(uniq.length === 0) return [];

    var bestProfit = uniq[0];
    var bestCost = null;
    var sortedCost = uniq.slice().sort(function(a,b){ return a.totalCost - b.totalCost; });
    bestCost = lowestCostResult || sortedCost[0];
    var bestBalanced = uniq[0];
    var bestVariety = null;
    var threeMenu = uniq.filter(function(r){ return r.numMenus >= 3; });
    if(threeMenu.length > 0) bestVariety = threeMenu[0];

    var labeled = [];
    var addedKeys = {};

    function addLabel(r, label, reason){
      if(!r || addedKeys[r.mix.map(function(x){ return x.m.id+':'+x.qty; }).sort().join(',')]) return;
      var key = r.mix.map(function(x){ return x.m.id+':'+x.qty; }).sort().join(',');
      addedKeys[key] = 1;
      var clone = JSON.parse(JSON.stringify(r));
      clone.label = label;
      clone.reason = reason;
      labeled.push(clone);
    }

    addLabel(bestBalanced, 'สมดุลที่สุด', 'ใกล้งบ กำไรดี ยอดขายตรงเป้า');

    if(bestProfit !== bestBalanced){
      addLabel(bestProfit, 'กำไรสูงสุด', 'กำไรรวมมากที่สุดในทุกชุด');
    }

    if(bestCost && bestCost !== bestBalanced && bestCost !== bestProfit){
      addLabel(bestCost, 'ทุนต่ำสุด', 'ต้นทุนอาหารต่ำที่สุด ปลอดภัยสุด');
    }

    if(bestVariety && bestVariety !== bestBalanced && bestVariety !== bestProfit && bestVariety !== bestCost){
      addLabel(bestVariety, 'หลากหลาย', 'ครบทั้ง 3 เมนู ลูกค้าชอบ');
    }

    while(labeled.length < 4 && uniq.length > labeled.length){
      var next = uniq[labeled.length];
      if(next && !addedKeys[next.mix.map(function(x){ return x.m.id+':'+x.qty; }).sort().join(',')]){
        var key2 = next.mix.map(function(x){ return x.m.id+':'+x.qty; }).sort().join(',');
        addedKeys[key2] = 1;
        var clone2 = JSON.parse(JSON.stringify(next));
        clone2.label = 'ทางเลือก #' + (labeled.length + 1);
        clone2.reason = 'ตัวเลือกเสริม';
        labeled.push(clone2);
      } else {
        break;
      }
    }

    labeled.forEach(function(r){
      var isExact = r.costDiff <= 5 && r.sellDiff <= 5;
      r.isExact = isExact;
    });

    return labeled.slice(0, 4);
  }

  function updateSuggestions(){
    var usable = getUsable();
    var perBox = getPerBoxUsable();
    var filtered = getFilteredSelling();
    var allWithin = getFilteredSellingAll();
    // Do not run the expensive 3-menu search when no individual menu can
    // even fit the current per-box budget; the empty-state UI does not use it.
    var sugg = filtered.length ? generateSuggestions() : [];
    var wrap = $('plannerSuggestions');
    var countEl = $('plannerFilteredCount');
    var emptyEl = $('plannerEmpty');

    if(countEl){
      var countText = filtered.length + ' เมนูในงบอาหาร ' + fmt(Math.floor(perBox)) + ' บาท (จากงบรวม '+fmt(state.totalBudget)+' - ค่าส่ง '+fmt(state.deliveryFee)+' = '+fmt(usable)+')';
      countText += (state.category!=='all' ? ' · '+state.category : '');
      countEl.textContent = countText;
    }
    if(filtered.length===0){
      if(wrap) wrap.innerHTML='';
      if(emptyEl){
        emptyEl.style.display='block';
        if(allWithin.length>0){
          emptyEl.innerHTML = '<div style="text-align:center;padding:1.5rem;background:#FEF2F2;border:1px solid #FECACA;border-radius:16px">'
            + '<div style="font-size:2rem">⚠️</div>'
            + '<div style="font-weight:900;color:#7F1D1D;margin-top:.5rem">มี '+allWithin.length+' เมนูอยู่ในงบอาหาร '+fmt(Math.floor(perBox))+' บาท แต่กำไรต่ำกว่า '+(state.margin - state.tolerance)+'%</div>'
            + '<div style="font-size:.85rem;color:var(--text-muted);margin-top:.35rem">ราคาขายที่ตั้งไว้ต่ำเกินไป — เพิ่มราคาขายในตาราง หรือลดกำไร% หรือเพิ่มงบลูกค้า (งบเหลือสำหรับอาหาร '+fmt(usable)+' บาท)</div>'
            + '<div style="margin-top:.75rem;display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap">'
            + '<button class="btn btn-primary btn-sm" onclick="document.getElementById(\'plannerTotal\').value=Number(document.getElementById(\'plannerTotal\').value)+500;document.getElementById(\'plannerTotal\').dispatchEvent(new Event(\'input\'))">เพิ่มงบรวม +500</button>'
            + '<button class="btn btn-outline btn-sm" onclick="document.getElementById(\'plannerMargin\').value=15;document.getElementById(\'plannerMargin\').dispatchEvent(new Event(\'input\'))">ลดกำไรเป็น 15%</button>'
            + '</div></div>';
        } else {
          emptyEl.innerHTML = '<div style="text-align:center;padding:1.5rem;background:var(--white);border:1px dashed var(--border);border-radius:16px">'
            + '<div style="font-size:2rem">⚠️</div>'
            + '<div style="font-weight:900;color:var(--primary);margin-top:.5rem">ไม่มีเมนูที่กำไร '+(state.margin - state.tolerance)+'% และอยู่ในงบอาหาร '+fmt(Math.floor(perBox))+' บาท/กล่อง</div>'
            + '<div style="font-size:.85rem;color:var(--text-muted);margin-top:.35rem">งบเหลือสำหรับอาหาร '+fmt(usable)+' บาท (หลังหักค่าส่ง '+fmt(state.deliveryFee)+' บาท) — ลองเพิ่มงบรวม หรือลดกำไร%</div>'
            + '<div style="margin-top:.75rem;display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap">'
            + '<button class="btn btn-primary btn-sm" onclick="document.getElementById(\'plannerTotal\').value=Number(document.getElementById(\'plannerTotal\').value)+500;document.getElementById(\'plannerTotal\').dispatchEvent(new Event(\'input\'))">เพิ่มงบรวม +500</button>'
            + '<button class="btn btn-outline btn-sm" onclick="document.getElementById(\'plannerMargin\').value=15;document.getElementById(\'plannerMargin\').dispatchEvent(new Event(\'input\'))">ลดกำไรเป็น 15%</button>'
            + '</div></div>';
        }
      }
      return;
    } else {
      if(emptyEl) emptyEl.style.display='none';
    }

    if(!wrap) return;
    _suggCache = sugg;
    if(sugg.length===0){
      var relaxedResults = tryRelaxedSearch();
      if(relaxedResults && relaxedResults.length > 0){
        _suggCache = relaxedResults;
        wrap.innerHTML = relaxedResults.map(function(s, idx){
          return renderSuggestionCard(s, idx, true);
        }).join('');
      } else {
        wrap.innerHTML = '<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:12px;padding:1rem;text-align:center;font-size:.88rem;color:#92400E">ไม่พบชุดเมนูที่เหมาะสม — ลองเพิ่มงบ ลดกำไร% หรือเปลี่ยนจำนวนกล่อง</div>';
      }
      return;
    }

    var html = sugg.map(function(s, idx){
      return renderSuggestionCard(s, idx, false);
    }).join('');
    wrap.innerHTML = html;
  }

  function tryRelaxedSearch(){
    var profit = getProfit();
    var costBudget = getCostBudget();
    var qty = state.qty;
    var usable = getUsable();
    var allMenus = EED_MENUS;
    if(state.category !== 'all'){
      allMenus = allMenus.filter(function(x){ return x.category === state.category; });
    }
    var mapped = allMenus.map(function(m){
      var s = getSelling(m);
      return {m:m, s:s, c:m.cost, profit: s - m.cost};
    }).filter(function(x){ return x.s <= getPerBoxUsable() * 1.3; });

    var results = [];
    for(var si=0; si<mapped.length; si++){
      var it = mapped[si];
      if(qty >= it.m.minPerMenu){
        var totalSell = it.s * qty;
        var totalCost = it.c * qty;
        var p = totalSell - totalCost;
        if(p >= 0 && Math.abs(totalSell - usable) <= usable * 0.10){
          results.push({
            mix:[{m:it.m,s:it.s,c:it.c,qty:qty}],
            totalSell:totalSell, totalCost:totalCost, profit:p,
            profitPct: totalSell>0?(p/totalSell*100):0,
            avg:Math.round(totalSell/qty), avgCost:Math.round(totalCost/qty),
            costDiff:Math.abs(totalCost-costBudget), sellDiff:Math.abs(totalSell-usable),
            profitDiff:Math.abs(p-profit), numMenus:1, label:'ทีเดียว',
            reason:'เมนูเดียว จัดง่ายสุด', isExact:false, type:'single',
            title:it.m.name, desc:it.m.name+' × '+qty+' กล่อง'
          });
        }
      }
    }
    for(var i2=0;i2<mapped.length;i2++){
      for(var j2=i2+1;j2<mapped.length;j2++){
        var a2=mapped[i2],b2=mapped[j2];
        var minA=a2.m.minPerMenu, minB=b2.m.minPerMenu;
        if(qty >= minA+minB){
          var qA = Math.max(minA, Math.floor(qty*0.5));
          var qB = qty - qA;
          if(qB >= minB){
            var ts=a2.s*qA+b2.s*qB, tc=a2.c*qA+b2.c*qB, pp=ts-tc;
            if(pp>=0 && Math.abs(ts - usable) <= usable * 0.10){
              results.push({
                mix:[{m:a2.m,s:a2.s,c:a2.c,qty:qA},{m:b2.m,s:b2.s,c:b2.c,qty:qB}],
                totalSell:ts,totalCost:tc,profit:pp,
                profitPct:ts>0?(pp/ts*100):0,
                avg:Math.round(ts/qty),avgCost:Math.round(tc/qty),
                costDiff:Math.abs(tc-costBudget),sellDiff:Math.abs(ts-usable),
                profitDiff:Math.abs(pp-profit),numMenus:2,label:'ทางเลือก',
                reason:'คละ 2 เมนู จัดได้',isExact:false,type:'mixed',
                title:a2.m.name+' + '+b2.m.name,
                desc:a2.m.name+' '+qA+' + '+b2.m.name+' '+qB
              });
            }
          }
        }
      }
    }
    return results.slice(0,2);
  }

  function renderSuggestionCard(s, idx, isRelaxed){
    var costBudget = getCostBudget();
    var usable = getUsable();
    var isExact = s.isExact;
    var isClose = s.costDiff <= 100 && s.sellDiff <= 100;

    var labelColors = {
      'สมดุลที่สุด': {bg:'var(--primary)', color:'#fff'},
      'กำไรสูงสุด': {bg:'#FEF3C7', color:'#92400E'},
      'ทุนต่ำสุด': {bg:'#ECFDF5', color:'#065F46'},
      'หลากหลาย': {bg:'#EDE9FE', color:'#5B21B6'},
      'ทีเดียว': {bg:'var(--primary)', color:'#fff'},
      'ทางเลือก': {bg:'var(--bg)', color:'var(--text-muted)'}
    };
    var lc = labelColors[s.label] || {bg:'var(--bg)', color:'var(--text-muted)'};

    var badge = '<span style="background:'+lc.bg+';color:'+lc.color+';font-size:.62rem;font-weight:900;padding:.2rem .5rem;border-radius:999px;letter-spacing:.06em">'+s.label+'</span>';
    if(idx===0 && !isRelaxed){
      badge = '<span style="background:var(--primary);color:#fff;font-size:.62rem;font-weight:900;padding:.2rem .5rem;border-radius:999px;letter-spacing:.06em">แนะนำ · '+(isExact?'พอดีงบ':'ใกล้เคียง')+'</span> ' + badge;
    }

    var diffNote = '';
    if(!isExact && !isRelaxed){
      var parts = [];
      if(s.costDiff > 10) parts.push('ทุน '+(s.totalCost > costBudget ? 'เกิน ' : 'ห่าง ')+fmt(Math.abs(s.costDiff))+'฿');
      if(s.sellDiff > 10) parts.push('ยอดขาย '+(s.totalSell > usable ? 'เกิน ' : 'ห่าง ')+fmt(Math.abs(s.sellDiff))+'฿');
      if(s.profitDiff > 10) parts.push('กำไรห่าง '+fmt(Math.abs(s.profitDiff))+'฿');
      if(parts.length>0) diffNote = '<div style="font-size:.72rem;color:#B45309;background:#FEF3C7;padding:.3rem .6rem;border-radius:6px;margin-top:.4rem">⚠ '+parts.join(' · ')+'</div>';
    }

    var reasonText = s.reason ? '<div style="font-size:.75rem;color:var(--primary);font-weight:700;margin-top:.35rem">💡 '+s.reason+'</div>' : '';

    var mixHtml = s.mix.map(function(x, mi){
      var uid = 'sugg_'+idx+'_m'+mi;
      return '<div style="display:flex;align-items:center;gap:.6rem;padding:.5rem 0;border-bottom:1px solid var(--border-light)">'
        + '<img src="'+x.m.image+'" style="width:42px;height:42px;border-radius:8px;object-fit:cover" onerror="this.style.display=\'none\'">'
        + '<div style="flex:1;min-width:0"><div style="font-weight:800;font-size:.88rem;line-height:1.2">'+x.m.name+'</div><div style="font-size:.75rem;color:var(--text-muted)">'+x.s+'฿ × <span id="'+uid+'">'+x.qty+'</span> กล่อง = <span id="'+uid+'_total">'+fmt(x.s*x.qty)+'</span>฿</div></div>'
        + '<div style="display:flex;align-items:center;gap:.3rem">'
        + '<button onclick="adjustSuggQty('+idx+','+mi+',-1)" style="width:26px;height:26px;border-radius:50%;border:1px solid var(--border);background:var(--white);font-weight:900;font-size:.85rem;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text-muted)">−</button>'
        + '<button onclick="adjustSuggQty('+idx+','+mi+',1)" style="width:26px;height:26px;border-radius:50%;border:1px solid var(--border);background:var(--white);font-weight:900;font-size:.85rem;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text-muted)">+</button>'
        + '</div>'
        + '<div style="font-size:.72rem;font-weight:700;color:var(--text-muted);text-align:right;min-width:70px">ทุน '+x.c+'<br>กำไร '+fmt(x.s-x.c)+'/กล่อง</div>'
        + '</div>';
    }).join('');

    var remain = usable - s.totalSell;
    var remainText = remain>0 ? 'เหลืองบ '+fmt(remain)+'฿' : (remain===0 ? 'พอดีงบ' : 'เกิน '+fmt(-remain)+'฿');
    if(state.deliveryFee>0) remainText += ' · ค่าส่ง '+fmt(state.deliveryFee)+'฿';

    var lineMsg = buildCustomerMessage(s);
    var encoded = encodeURIComponent(JSON.stringify(s.mix.map(function(x){ return {id:x.m.id, qty:x.qty}; })));
    var customerLink = 'budget-calculator.html?budget='+Math.floor(getPerBoxUsable())+'&qty='+state.qty+'&mix='+encoded+'#calculator';

    return '<article style="background:var(--white);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow-xs);overflow:hidden" data-sugg-idx="'+idx+'">'
      + '<div style="padding:1.1rem 1.2rem 0">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap"><h3 style="font-size:1rem;font-weight:900;color:var(--primary);margin:0">'+s.title+'</h3><div style="display:flex;gap:.35rem;flex-wrap:wrap">'+badge+'</div></div>'
      + '<p style="font-size:.82rem;color:var(--text-muted);margin:.25rem 0 0">'+s.desc+'</p>'
      + reasonText
      + diffNote
      + (isRelaxed ? '<div style="font-size:.72rem;color:#92400E;background:#FEF3C7;padding:.3rem .6rem;border-radius:6px;margin-top:.4rem">⚠ ไม่พอดีงบ — ลองเพิ่มงบ หรือลดกำไร%</div>' : '')
      + '</div>'
      + '<div style="padding:.85rem 1.2rem">'+mixHtml+'</div>'
      + '<div style="background:var(--bg);border-top:1px solid var(--border-light);padding:1rem 1.2rem">'
      + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;text-align:center">'
      + '<div><div style="font-size:.62rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted)">ยอดขายรวม</div><div style="font-size:1.15rem;font-weight:900;color:var(--primary)">'+fmt(s.totalSell)+'฿</div><div style="font-size:.72rem;color:var(--text-muted)">เฉลี่ย '+fmt(s.avg)+'฿/กล่อง</div></div>'
      + '<div><div style="font-size:.62rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted)">ต้นทุนรวม</div><div style="font-size:1.15rem;font-weight:900;color:var(--text)">'+fmt(s.totalCost)+'฿</div><div style="font-size:.72rem;color:var(--text-muted)">ทุน '+fmt(s.avgCost)+'฿/กล่อง</div></div>'
      + '<div><div style="font-size:.62rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted)">กำไรรวม</div><div style="font-size:1.15rem;font-weight:900;color:var(--accent)">'+fmt(s.profit)+'฿</div><div style="font-size:.72rem;color:var(--text-muted)">'+s.profitPct.toFixed(1)+'% · '+remainText+'</div></div>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-top:.85rem">'
      + '<button class="btn btn-primary btn-sm" onclick="copySuggMsg('+idx+')">คัดลอกข้อความส่งลูกค้า</button>'
      + '<a href="https://line.me/R/oaMessage/%40EEDHALAL/?'+encodeURIComponent(lineMsg)+'" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm" style="justify-content:center">ส่ง LINE ให้ลูกค้า</a>'
      + '</div>'
      + '<div style="font-size:.72rem;color:var(--text-muted);margin-top:.5rem;text-align:center">ลูกค้าจะเห็นแค่ราคาขาย ไม่เห็นต้นทุน/กำไร</div>'
      + '</div>'
      + '</article>';
  }

  var _suggCache = [];
  window.adjustSuggQty = function(sIdx, mIdx, delta){
    if(!_suggCache[sIdx]) return;
    var s = _suggCache[sIdx];
    var item = s.mix[mIdx];
    if(!item) return;
    var newQty = item.qty + delta;
    if(newQty < item.m.minPerMenu) return;
    if(newQty > state.qty) return;
    var otherQty = 0;
    for(var i=0;i<s.mix.length;i++){
      if(i !== mIdx) otherQty += s.mix[i].qty;
    }
    if(otherQty + newQty > state.qty) return;
    item.qty = newQty;
    if(s.mix.length === 1) item.qty = state.qty;
    s.totalSell = 0; s.totalCost = 0;
    for(var j=0;j<s.mix.length;j++){
      s.totalSell += s.mix[j].s * s.mix[j].qty;
      s.totalCost += s.mix[j].c * s.mix[j].qty;
    }
    s.profit = s.totalSell - s.totalCost;
    s.profitPct = s.totalSell > 0 ? (s.profit / s.totalSell * 100) : 0;
    s.avg = Math.round(s.totalSell / state.qty);
    s.avgCost = Math.round(s.totalCost / state.qty);
    s.costDiff = Math.abs(s.totalCost - getCostBudget());
    s.sellDiff = Math.abs(s.totalSell - getUsable());
    s.profitDiff = Math.abs(s.profit - getProfit());
    s.desc = s.mix.map(function(x){ return x.m.name + ' ' + x.qty; }).join(' + ');
    s.title = s.mix.map(function(x){ return x.m.name; }).join(' + ');
    updateSuggestions();
  };

  window.copySuggMsg = function(idx){
    var s = _suggCache[idx];
    if(!s) return;
    var msg = buildCustomerMessage(s);
    navigator.clipboard.writeText(msg).then(function(){
      var btns = document.querySelectorAll('[data-sugg-idx="'+idx+'"] .btn-primary');
      btns.forEach(function(b){ b.textContent='คัดลอกแล้ว ✓'; });
      setTimeout(function(){ btns.forEach(function(b){ b.textContent='คัดลอกข้อความส่งลูกค้า'; }); },1500);
    });
  };

  function buildCustomerMessage(s){
    var usable = getUsable();
    var perBox = Math.round(s.totalSell / state.qty);
    var perBoxUsable = Math.floor(usable / state.qty);
    var lines = [];
    if(state.deliveryFee>0){
      lines.push('สวัสดีครับ ขอเสนอเมนูตามงบ '+fmt(state.totalBudget)+' บาท ('+state.qty+' กล่อง)');
      lines.push('หักค่าส่ง '+fmt(state.deliveryFee)+' บาท → เหลืองบอาหาร '+fmt(usable)+' บาท เฉลี่ย '+perBoxUsable+' บาท/กล่อง');
    } else {
      lines.push('สวัสดีครับ ขอเสนอเมนูตามงบ '+fmt(state.totalBudget)+' บาท ('+state.qty+' กล่อง เฉลี่ย '+perBox+' บาท/กล่อง) ส่งฟรี');
    }
    lines.push('');
    // ใช้ desc แทน title เพื่อความกระชับสำหรับลูกค้า
    var cleanTitle = s.desc || s.mix.map(function(x){ return x.m.name; }).join(' + ');
    lines.push(cleanTitle);
    s.mix.forEach(function(x){
      lines.push('- '+x.m.name+' ('+x.s+' บาท/กล่อง) x'+x.qty+' กล่อง');
    });
    lines.push('');
    lines.push('ยอดอาหาร '+fmt(s.totalSell)+' บาท เฉลี่ย '+fmt(s.avg)+' บาท/กล่อง');
    if(state.deliveryFee>0) lines.push('ค่าส่ง '+fmt(state.deliveryFee)+' บาท');
    lines.push('รวมสุทธิ '+fmt(s.totalSell + state.deliveryFee)+' บาท (อยู่ในงบ '+fmt(state.totalBudget)+' บาท)');
    lines.push('เฉลี่ยรวมส่ง '+fmt(Math.round((s.totalSell + state.deliveryFee)/state.qty))+' บาท/กล่อง');
    if(state.deliveryFee===0) lines.push('ส่งฟรีทั่วกรุงเทพฯ (50+ กล่อง)');
    lines.push('ขั้นต่ำ 10 กล่อง (ไทย 5 กล่อง/เมนู) • ฮาลาล CICOT');
    lines.push('');
    lines.push('สนใจชุดนี้ แจ้งยืนยันได้เลยครับ');
    return lines.join('\n');
  }

  // init gate on DOM ready
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', initGate);
  } else {
    initGate();
  }

})();
