(function(){
  'use strict';

  var LS_KEY = 'eed_budget_calc_v1';
  var LS_SELLING = 'eed_selling_v1';
  var els = {};
  var state = {
    budgetPerBox: 60,
    quantity: 20,
    category: 'all',
    selected: {} // id -> qty
  };

  function $(id){ return document.getElementById(id); }

  function formatMoney(n){
    return Number(n).toLocaleString('th-TH');
  }

  // Keep the customer-facing calculator in sync with selling prices edited
  // in budget-planner.html. Fall back to menu-data.js when no overrides exist.
  function loadPlannerSellingPrices(){
    try{
      var saved = JSON.parse(localStorage.getItem(LS_SELLING)||'null');
      EED_MENUS.forEach(function(m){
        if(m._calculatorDefaultPrice === undefined) m._calculatorDefaultPrice = m.price;
        var value = saved && typeof saved === 'object' ? parseFloat(saved[m.id]) : NaN;
        m.price = isFinite(value) && value >= 0 ? value : m._calculatorDefaultPrice;
      });
    }catch(e){}
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

  function saveState(){
    try{ localStorage.setItem(LS_KEY, JSON.stringify({budgetPerBox:state.budgetPerBox, quantity:state.quantity})); }catch(e){}
  }
  function loadState(){
    try{
      var s = JSON.parse(localStorage.getItem(LS_KEY)||'null');
      if(s){
        if(s.budgetPerBox) state.budgetPerBox = parseInt(s.budgetPerBox,10);
        if(s.quantity) state.quantity = parseInt(s.quantity,10);
      }
    }catch(e){}
  }

  function updateSummary(){
    var total = state.budgetPerBox * state.quantity;
    var filtered = getFiltered();
    var freeDelivery = state.quantity >= 50;
    var minWarn = state.quantity < 10;

    els.summaryBudgetPerBox.textContent = formatMoney(state.budgetPerBox);
    els.summaryQty.textContent = formatMoney(state.quantity);
    els.summaryTotal.textContent = formatMoney(total);
    els.summaryCount.textContent = filtered.length;
    els.summaryFree.textContent = freeDelivery ? 'ส่งฟรีทั่วกรุงเทพฯ' : 'ค่าส่งคิดตามระยะทาง (ฟรีเมื่อ 50+ กล่อง)';
    els.summaryFree.style.color = freeDelivery ? 'var(--primary)' : 'var(--text-muted)';

    if(minWarn){
      els.warnMin.style.display='flex';
      els.warnMin.innerHTML = '<span style="font-size:1.1rem">⚠️</span><span>ออเดอร์องค์กรขั้นต่ำ 10 กล่อง (ไทย 5 กล่อง/เมนู) — ตอนนี้คุณเลือก ' + state.quantity + ' กล่อง</span>';
    } else {
      els.warnMin.style.display='none';
    }

    // budget level badge
    var levelText = '';
    var levelClass = '';
    if(state.budgetPerBox < 60){ levelText='งบต่ำกว่ามาตรฐาน'; levelClass='level-low'; }
    else if(state.budgetPerBox < 90){ levelText='งบมาตรฐาน — เมนูยอดนิยมครบ'; levelClass='level-ok'; }
    else if(state.budgetPerBox < 120){ levelText='งบพรีเมียม — ได้เมนูขายดีทั้งหมด'; levelClass='level-premium'; }
    else { levelText='งบพรีเมียมพลัส — ได้ทุกเมนูรวมเซ็ต'; levelClass='level-premium'; }
    els.budgetLevel.textContent = levelText;
    els.budgetLevel.className = 'calc-level ' + levelClass;

    // LINE urls — build once and sync all buttons
    var lineMsg = buildLineMessage(total, filtered);
    var lineUrl = 'https://line.me/R/oaMessage/%40EEDHALAL/?' + encodeURIComponent(lineMsg);
    if(els.btnLine) els.btnLine.href = lineUrl;
    if(els.btnLine2) els.btnLine2.href = lineUrl;
    if(els.btnLineSelected) els.btnLineSelected.href = lineUrl;
    // also update title for accessibility
    var hasSelected = Object.keys(state.selected).length > 0;
    if(els.btnLine) els.btnLine.title = hasSelected ? 'ส่งเมนูที่เลือกไป LINE' : 'ส่งสรุปไป LINE';
    if(els.btnLineSelected) els.btnLineSelected.title = lineMsg;

    els.totalBudgetInput.value = total;
  }

  function getSelectedTotals(){
    var ids = Object.keys(state.selected);
    var qty = 0, price = 0;
    ids.forEach(function(id){
      var m = EED_MENUS.find(function(x){ return String(x.id)===String(id); });
      if(!m) return;
      var q = state.selected[id]||0;
      qty += q;
      price += q * m.price;
    });
    return { ids: ids, qty: qty, price: price, avg: qty ? Math.round(price/qty) : 0 };
  }

  function buildLineMessage(total, filtered){
    var lines = [];
    lines.push('สวัสดีครับ สนใจสอบถามข้าวกล่อง EED HALAL');
    lines.push('');
    lines.push('งบต่อกล่อง: ' + state.budgetPerBox + ' บาท');
    lines.push('จำนวน: ' + state.quantity + ' กล่อง');
    lines.push('ยอดรวมประมาณ (ตามงบ): ' + formatMoney(total) + ' บาท' + (state.quantity>=50 ? ' (ส่งฟรี 50+ กล่อง)' : ''));
    if(state.category !== 'all') lines.push('หมวดที่สนใจ: ' + state.category);
    var sel = getSelectedTotals();
    if(sel.ids.length){
      lines.push('');
      lines.push('เมนูที่เลือก (' + sel.ids.length + ' เมนู รวม ' + sel.qty + ' กล่อง):');
      sel.ids.forEach(function(id){
        var m = EED_MENUS.find(function(x){return String(x.id)===String(id);});
        if(!m) return;
        var q = state.selected[id];
        var lineTotal = q * m.price;
        lines.push('- ' + m.name + ' ('+m.price+' บ./กล่อง) x'+ q + ' = ' + formatMoney(lineTotal) + ' บาท');
      });
      lines.push('ยอดรวมที่เลือก: ' + formatMoney(sel.price) + ' บาท (เฉลี่ย ' + formatMoney(sel.avg) + ' บาท/กล่อง)');
      if(sel.qty !== state.quantity){
        lines.push('หมายเหตุ: เลือก ' + sel.qty + ' กล่อง (ตั้งไว้ ' + state.quantity + ' กล่อง)');
      }
    } else {
      lines.push('');
      if(filtered.length){
        lines.push('เมนูในงบ '+state.budgetPerBox+' บาท ('+filtered.length+' เมนู) เช่น: ' + filtered.slice(0,3).map(function(m){return m.name + ' ' + m.price + 'บ.';}).join(', '));
      } else {
        lines.push('ยังไม่ได้เลือกเมนู — เมนูในงบนี้: 0 เมนู');
      }
    }
    lines.push('');
    lines.push('รบกวนขอใบเสนอราคาครับ');
    lines.push('อ้างอิง: budget-calculator @ eedhalal.com');
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
          if(state.selected[id]) delete state.selected[id];
          else state.selected[id]= Math.max(5, state.quantity ? Math.ceil(state.quantity/2) : 5); // default
          // if more than one selected, keep but warn min? simple
          renderResults();
          updateSummary();
        } else if(act==='inc'){
          state.selected[id] = (state.selected[id]||0)+1;
          renderResults(); updateSummary();
        } else if(act==='dec'){
          state.selected[id] = (state.selected[id]||0)-1;
          if(state.selected[id]<=0) delete state.selected[id];
          renderResults(); updateSummary();
        }
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
      totalSelectedQty += qty;
      totalSelectedPrice += qty * m.price;
      return '<div class="calc-selected-row">'
        + '<img src="'+m.image+'" alt="" style="width:44px;height:44px;border-radius:10px;object-fit:cover" onerror="this.onerror=null;this.src=\'img/logo.jpg\';this.style.objectFit=\'contain\';this.style.background=\'#f9fafb\'">'
        + '<div style="flex:1;min-width:0"><div style="font-weight:800;font-size:.92rem;line-height:1.2">'+m.name+'</div><div style="font-size:.78rem;color:var(--text-muted)">'+m.price+' บาท × '+qty+' = '+formatMoney(m.price*qty)+' บาท</div></div>'
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
        delete state.selected[this.getAttribute('data-remove')];
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
    loadPlannerSellingPrices();
    loadState();
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

    // init values
    els.budgetRange.value = state.budgetPerBox;
    els.budgetNumber.value = state.budgetPerBox;
    els.qtyNumber.value = state.quantity;
    els.qtyRange.value = state.quantity;
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

    // clear selection
    var clearBtn = $('clearSelection');
    if(clearBtn) clearBtn.addEventListener('click', function(){
      state.selected = {};
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
  }

  // If the planner is open in another tab, reflect a saved price change here.
  window.addEventListener('storage', function(e){
    if(e.key !== LS_SELLING || !els.resultsGrid) return;
    loadPlannerSellingPrices();
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

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', initControls);
  } else {
    initControls();
  }

  // expose for inline handlers
  window._eedCalcState = state;

})();
