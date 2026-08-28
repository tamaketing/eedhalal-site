(function(){
  'use strict';
  var PIN = '2024';
  var LS_AUTH = 'eed_planner_auth';
  var LS_SELLING = 'eed_selling_v1';
  var LS_MINS = 'eed_mins_v1';
  var LS_SHIP_ZONES = 'eed_ship_zones_v1';
  var LS_SHIP_FREE = 'eed_ship_free_v1';
  var LS_TOPPINGS = 'eed_toppings_v1';
  var LS_MEATS = 'eed_meats_v1';
  var LS_IMAGES = 'eed_images_v1';
  var LS_NAMES = 'eed_names_v1';
  var LS_CATEGORIES = 'eed_categories_v1';
  var LS_DELETED = 'eed_deleted_v1';
  var LS_NEW_MENUS = 'eed_new_menus_v1';
  var MENU_CATEGORIES = ['ข้าวราดแกง','ข้าวผัด','เส้น','ข้าวหมก','แกง/ต้ม','พรีเมียม'];
  var DEFAULT_ZONES = [
    {id:'bangkok_inner', label:'กรุงเทพชั้นใน (สาทร สีลม พระราม3)', fee:120},
    {id:'sukhumvit', label:'สุขุมวิท', fee:150},
    {id:'ladprao', label:'ลาดพร้าว วังทองหลาง', fee:180},
    {id:'bangkok_outer', label:'กรุงเทพรอบนอก', fee:250},
    {id:'vicinity', label:'ปริมณฑล (นนทบุรี สมุทรปราการ ปทุม)', fee:350},
    {id:'other', label:'อื่นๆ / ต่างจังหวัด — สอบถาม', fee:0}
  ];

  var state = {
    category: 'all',
    search: ''
  };

  function $(id){ return document.getElementById(id); }
  function fmt(n){ return Number(n).toLocaleString('th-TH'); }

  // --- Auth ---
  function checkAuth(){
    try{
      var url = new URL(window.location.href);
      var key = url.searchParams.get('key');
      if(key === PIN){
        localStorage.setItem(LS_AUTH, PIN);
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
    if(!gate || !app) return;
    gate.style.display = show ? 'flex' : 'none';
    app.style.display = show ? 'none' : 'block';
  }
  function initGate(){
    var gate = $('plannerGate');
    var input = $('gatePin');
    var btn = $('gateBtn');
    var err = $('gateErr');
    if(!gate || !input || !btn) return;
    function tryAuth(){
      var v = (input.value||'').trim();
      if(v===PIN){
        localStorage.setItem(LS_AUTH, PIN);
        showGate(false);
        initPlanner();
      } else {
        if(err){
          err.textContent='รหัสไม่ถูกต้อง ลองอีกครั้ง';
          err.style.display='block';
        }
        input.select();
      }
    }
    btn.addEventListener('click', tryAuth);
    input.addEventListener('keydown', function(e){ if(e.key==='Enter') tryAuth(); });
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

  // --- Selling price + minPerMenu storage (sync with budget-calculator.html) ---
  function loadSelling(){
    try{
      var saved = JSON.parse(localStorage.getItem(LS_SELLING)||'null');
      if(saved && typeof saved === 'object'){
        for(var id in saved){
          if(!saved.hasOwnProperty(id)) continue;
          var sell = parseFloat(saved[id]);
          if(!isNaN(sell) && sell >= 0){
            for(var i=0;i<EED_MENUS.length;i++){
              if(String(EED_MENUS[i].id)===String(id)){
                EED_MENUS[i].price = sell;
                break;
              }
            }
          }
        }
      }
      var savedMins = JSON.parse(localStorage.getItem(LS_MINS)||'null');
      if(savedMins && typeof savedMins === 'object'){
        for(var mid in savedMins){
          if(!savedMins.hasOwnProperty(mid)) continue;
          var mv = parseInt(savedMins[mid],10);
          if(!isNaN(mv) && mv >= 1){
            for(var k=0;k<EED_MENUS.length;k++){
              if(String(EED_MENUS[k].id)===String(mid)){
                EED_MENUS[k].minPerMenu = mv;
                break;
              }
            }
          }
        }
      }
      // remember original values for reset
      for(var j=0;j<EED_MENUS.length;j++){
        if(EED_MENUS[j]._origPrice === undefined) EED_MENUS[j]._origPrice = EED_MENUS[j].price;
        if(EED_MENUS[j]._defaultPrice === undefined) EED_MENUS[j]._defaultPrice = EED_MENUS[j]._origPrice;
        if(EED_MENUS[j]._origMin === undefined) EED_MENUS[j]._origMin = EED_MENUS[j].minPerMenu;
      }
    }catch(e){}
  }

  function saveSelling(){
    try{
      var obj = {};
      EED_MENUS.forEach(function(m){ obj[m.id] = m.price; });
      localStorage.setItem(LS_SELLING, JSON.stringify(obj));
      localStorage.setItem('eed_selling_updated_at', String(Date.now()));
    }catch(e){}
  }
  function saveMins(){
    try{
      var obj = {};
      EED_MENUS.forEach(function(m){ obj[m.id] = m.minPerMenu; });
      localStorage.setItem(LS_MINS, JSON.stringify(obj));
      localStorage.setItem('eed_selling_updated_at', String(Date.now()));
    }catch(e){}
  }

  function loadImages(){
    try{
      var saved = JSON.parse(localStorage.getItem(LS_IMAGES)||'null');
      if(saved && typeof saved === 'object'){
        for(var id in saved){
          if(!saved.hasOwnProperty(id)) continue;
          var v = String(saved[id]||'').trim();
          if(v){
            for(var i=0;i<EED_MENUS.length;i++){
              if(String(EED_MENUS[i].id)===String(id)){
                EED_MENUS[i].image = v;
                break;
              }
            }
          }
        }
      }
    }catch(e){}
  }
  function saveImages(){
    try{
      var obj = {};
      EED_MENUS.forEach(function(m){ obj[m.id] = m.image; });
      localStorage.setItem(LS_IMAGES, JSON.stringify(obj));
      localStorage.setItem('eed_selling_updated_at', String(Date.now()));
    }catch(e){}
  }
  function saveOneImage(id, imgPath){
    for(var i=0;i<EED_MENUS.length;i++){
      if(String(EED_MENUS[i].id)===String(id)){
        EED_MENUS[i].image = imgPath;
        break;
      }
    }
    saveImages();
    flashSaved();
  }

  function loadNames(){
    try{
      var saved = JSON.parse(localStorage.getItem(LS_NAMES)||'null');
      if(saved && typeof saved === 'object'){
        for(var id in saved){
          if(!saved.hasOwnProperty(id)) continue;
          var v = String(saved[id]||'').trim();
          if(v){
            for(var i=0;i<EED_MENUS.length;i++){
              if(String(EED_MENUS[i].id)===String(id)){
                EED_MENUS[i].name = v;
                break;
              }
            }
          }
        }
      }
    }catch(e){}
  }
  function saveNames(){
    try{
      var obj = {};
      EED_MENUS.forEach(function(m){ obj[m.id] = m.name; });
      localStorage.setItem(LS_NAMES, JSON.stringify(obj));
      localStorage.setItem('eed_selling_updated_at', String(Date.now()));
    }catch(e){}
  }
  function saveOneName(id, nameVal){
    for(var i=0;i<EED_MENUS.length;i++){
      if(String(EED_MENUS[i].id)===String(id)){
        EED_MENUS[i].name = nameVal;
        break;
      }
    }
    saveNames();
    flashSaved();
  }

  function loadCategories(){
    try{
      var saved = JSON.parse(localStorage.getItem(LS_CATEGORIES)||'null');
      if(saved && typeof saved === 'object'){
        for(var id in saved){
          if(!saved.hasOwnProperty(id)) continue;
          var v = String(saved[id]||'').trim();
          if(v){
            for(var i=0;i<EED_MENUS.length;i++){
              if(String(EED_MENUS[i].id)===String(id)){
                EED_MENUS[i].category = v;
                break;
              }
            }
          }
        }
      }
    }catch(e){}
  }
  function saveCategories(){
    try{
      var obj = {};
      EED_MENUS.forEach(function(m){ obj[m.id] = m.category; });
      localStorage.setItem(LS_CATEGORIES, JSON.stringify(obj));
      localStorage.setItem('eed_selling_updated_at', String(Date.now()));
    }catch(e){}
  }
  function saveOneCategory(id, catVal){
    for(var i=0;i<EED_MENUS.length;i++){
      if(String(EED_MENUS[i].id)===String(id)){
        EED_MENUS[i].category = catVal;
        break;
      }
    }
    saveCategories();
    flashSaved();
  }

  // --- Deleted menus ---
  function getDeleted(){
    try{
      var saved = JSON.parse(localStorage.getItem(LS_DELETED)||'null');
      if(Array.isArray(saved)) return saved.filter(function(id){ return !isNaN(parseInt(id,10)); });
    }catch(e){}
    return [];
  }
  function saveDeleted(arr){
    try{
      localStorage.setItem(LS_DELETED, JSON.stringify(arr));
      localStorage.setItem('eed_selling_updated_at', String(Date.now()));
    }catch(e){}
  }
  function toggleDeleteMenu(id){
    var del = getDeleted();
    var idx = del.indexOf(id);
    if(idx===-1) del.push(id); else del.splice(idx,1);
    saveDeleted(del);
  }

  // --- New menus ---
  function getNewMenus(){
    try{
      var saved = JSON.parse(localStorage.getItem(LS_NEW_MENUS)||'null');
      if(Array.isArray(saved)) return saved.filter(function(m){ return m && m.name; });
    }catch(e){}
    return [];
  }
  function saveNewMenus(arr){
    try{
      localStorage.setItem(LS_NEW_MENUS, JSON.stringify(arr));
      localStorage.setItem('eed_selling_updated_at', String(Date.now()));
    }catch(e){}
  }
  function addNewMenu(data){
    var newMenus = getNewMenus();
    var maxId = 99;
    EED_MENUS.forEach(function(m){ if(m.id>maxId) maxId=m.id; });
    newMenus.forEach(function(m){ if(m.id>maxId) maxId=m.id; });
    var id = maxId + 1;
    var menu = {
      id: id,
      name: data.name || 'เมนูใหม่',
      price: parseInt(data.price,10) || 60,
      category: data.category || 'ข้าวราดแกง',
      image: data.image || 'img/logo.jpg',
      desc: data.desc || '',
      badge: 'ใหม่',
      minPerMenu: parseInt(data.minPerMenu,10) || 5
    };
    newMenus.push(menu);
    saveNewMenus(newMenus);
    return menu;
  }
  function removeNewMenu(id){
    var newMenus = getNewMenus();
    newMenus = newMenus.filter(function(m){ return m.id !== id; });
    saveNewMenus(newMenus);
  }

  function saveOne(id, price){
    for(var i=0;i<EED_MENUS.length;i++){
      if(String(EED_MENUS[i].id)===String(id)){
        EED_MENUS[i].price = price;
        break;
      }
    }
    saveSelling();
    updateStats();
    flashSaved();
  }
  function saveOneMin(id, minVal){
    for(var i=0;i<EED_MENUS.length;i++){
      if(String(EED_MENUS[i].id)===String(id)){
        EED_MENUS[i].minPerMenu = minVal;
        break;
      }
    }
    saveMins();
    flashSaved();
  }

  function flashSaved(){
    var el = $('saveStatus');
    if(!el) return;
    el.style.display='inline-flex';
    clearTimeout(flashSaved._t);
    flashSaved._t = setTimeout(function(){ el.style.display='none'; }, 2200);
  }

  // --- Ship zones ---
  function getShipZones(){
    try{
      var saved = JSON.parse(localStorage.getItem(LS_SHIP_ZONES)||'null');
      if(Array.isArray(saved) && saved.length){
        // validate
        return saved.filter(function(z){ return z && z.id && z.label !== undefined; }).map(function(z){
          return {id:String(z.id), label:String(z.label), fee:parseInt(z.fee,10)||0};
        });
      }
    }catch(e){}
    return JSON.parse(JSON.stringify(DEFAULT_ZONES));
  }
  function saveShipZones(zones){
    try{
      localStorage.setItem(LS_SHIP_ZONES, JSON.stringify(zones));
      localStorage.setItem('eed_selling_updated_at', String(Date.now()));
    }catch(e){}
  }
  function getFreeThreshold(){
    try{
      var v = localStorage.getItem(LS_SHIP_FREE);
      if(v!==null) return parseInt(v,10)||50;
    }catch(e){}
    // fallback to EED or 50
    if(typeof EED !== 'undefined' && EED.freeDeliveryFrom) return parseInt(EED.freeDeliveryFrom,10)||50;
    return 50;
  }
  function saveFreeThreshold(v){
    try{ localStorage.setItem(LS_SHIP_FREE, String(v)); localStorage.setItem('eed_selling_updated_at', String(Date.now())); }catch(e){}
  }
  function slugify(str){
    return (str||'').toLowerCase().replace(/[^a-z0-9ก-๙]+/g,'_').replace(/^_+|_+$/g,'') || ('zone_'+Date.now());
  }

  // --- One global topping list for every menu ---
  // --- Meats (เลือกเนื้อสัตว์ — เลือกได้ 1 อย่าง) ---
  var DEFAULT_MEATS = [
    {name:'ไก่', price:0},
    {name:'เนื้อ', price:0},
    {name:'ทะเล', price:0},
    {name:'หมู', price:0}
  ];
  function getMeats(){
    try{
      var saved = JSON.parse(localStorage.getItem(LS_MEATS)||'null');
      if(Array.isArray(saved)){
        return saved.filter(function(t){ return t && String(t.name||'').trim(); }).map(function(t){
          return {name:String(t.name).trim(), price:Math.max(0, parseInt(t.price,10)||0)};
        });
      }
    }catch(e){}
    return DEFAULT_MEATS.map(function(t){ return {name:t.name, price:t.price}; });
  }
  function saveMeats(meats){
    try{ localStorage.setItem(LS_MEATS, JSON.stringify(meats)); localStorage.setItem('eed_selling_updated_at', String(Date.now())); }catch(e){}
  }
  function renderMeats(){
    var list = $('meatsList');
    if(!list) return;
    var meats = getMeats();
    list.innerHTML = meats.length ? meats.map(function(t, idx){
      return '<div style="display:flex;gap:.45rem;align-items:center;flex-wrap:wrap;margin-top:.45rem">'
        + '<input type="text" data-mt-name="'+idx+'" value="'+escapeHtml(t.name)+'" style="flex:1;min-width:150px;height:38px;border:1px solid var(--border);border-radius:10px;padding:0 .7rem;font-size:.85rem;font-weight:700">'
        + '<input type="number" data-mt-price="'+idx+'" value="'+t.price+'" min="0" max="500" step="5" style="width:90px;height:38px;border:1px solid var(--border);border-radius:10px;padding:0 .55rem;text-align:center;font-size:.85rem;font-weight:900;color:var(--primary)">'
        + '<span style="font-size:.75rem;color:var(--text-muted)">บาท/กล่อง</span>'
        + '<button type="button" data-mt-delete="'+idx+'" class="btn btn-outline btn-sm" style="color:#DC2626;border-color:#FECACA">ลบ</button>'
        + '</div>';
    }).join('') : '<div style="margin-top:.55rem;font-size:.82rem;color:var(--text-muted)">ยังไม่มีเนื้อสัตว์ — เพิ่มรายการด้านล่าง</div>';

    list.querySelectorAll('[data-mt-name],[data-mt-price]').forEach(function(input){
      input.addEventListener('change', function(){
        var idx = parseInt(this.getAttribute('data-mt-name') || this.getAttribute('data-mt-price'),10);
        var current = getMeats();
        if(!current[idx]) return;
        if(this.hasAttribute('data-mt-name')) current[idx].name = this.value.trim() || current[idx].name;
        else current[idx].price = Math.max(0, Math.min(500, parseInt(this.value,10)||0));
        saveMeats(current);
        renderMeats();
        flashSaved();
      });
    });
    list.querySelectorAll('[data-mt-delete]').forEach(function(button){
      button.addEventListener('click', function(){
        var idx = parseInt(this.getAttribute('data-mt-delete'),10);
        var current = getMeats();
        if(isNaN(idx)) return;
        current.splice(idx,1);
        saveMeats(current);
        renderMeats();
        flashSaved();
      });
    });
  }

  // --- Toppings (เลือกท็อปปิ้ง — เลือกได้หลายอย่าง) ---
  function getGlobalToppings(){
    try{
      var saved = JSON.parse(localStorage.getItem(LS_TOPPINGS)||'null');
      if(Array.isArray(saved)){
        return saved.filter(function(t){ return t && String(t.name||'').trim(); }).map(function(t){
          return {name:String(t.name).trim(), price:Math.max(0, parseInt(t.price,10)||0)};
        });
      }
    }catch(e){}
    if(Array.isArray(EED_DEFAULT_TOPPINGS)) return EED_DEFAULT_TOPPINGS.map(function(t){ return {name:t.name, price:t.price}; });
    var firstMenu = EED_MENUS.find(function(menu){ return Array.isArray(menu.toppings) && menu.toppings.length; });
    return firstMenu ? firstMenu.toppings.map(function(t){ return {name:t.name, price:t.price}; }) : [];
  }
  function saveGlobalToppings(toppings){
    try{ localStorage.setItem(LS_TOPPINGS, JSON.stringify(toppings)); localStorage.setItem('eed_selling_updated_at', String(Date.now())); }catch(e){}
  }
  function escapeHtml(value){
    return String(value||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function renderGlobalToppings(){
    var list = $('globalToppingsList');
    if(!list) return;
    var toppings = getGlobalToppings();
    list.innerHTML = toppings.length ? toppings.map(function(t, idx){
      return '<div style="display:flex;gap:.45rem;align-items:center;flex-wrap:wrap;margin-top:.45rem">'
        + '<input type="text" data-gt-name="'+idx+'" value="'+escapeHtml(t.name)+'" style="flex:1;min-width:150px;height:38px;border:1px solid var(--border);border-radius:10px;padding:0 .7rem;font-size:.85rem;font-weight:700">'
        + '<input type="number" data-gt-price="'+idx+'" value="'+t.price+'" min="0" max="500" step="5" style="width:90px;height:38px;border:1px solid var(--border);border-radius:10px;padding:0 .55rem;text-align:center;font-size:.85rem;font-weight:900;color:var(--primary)">'
        + '<span style="font-size:.75rem;color:var(--text-muted)">บาท/กล่อง</span>'
        + '<button type="button" data-gt-delete="'+idx+'" class="btn btn-outline btn-sm" style="color:#DC2626;border-color:#FECACA">ลบ</button>'
        + '</div>';
    }).join('') : '<div style="margin-top:.55rem;font-size:.82rem;color:var(--text-muted)">ยังไม่มีท็อปปิ้ง — เพิ่มรายการด้านล่าง</div>';

    list.querySelectorAll('[data-gt-name],[data-gt-price]').forEach(function(input){
      input.addEventListener('change', function(){
        var idx = parseInt(this.getAttribute('data-gt-name') || this.getAttribute('data-gt-price'),10);
        var current = getGlobalToppings();
        if(!current[idx]) return;
        if(this.hasAttribute('data-gt-name')) current[idx].name = this.value.trim() || current[idx].name;
        else current[idx].price = Math.max(0, Math.min(500, parseInt(this.value,10)||0));
        saveGlobalToppings(current);
        renderGlobalToppings();
        flashSaved();
      });
    });
    list.querySelectorAll('[data-gt-delete]').forEach(function(button){
      button.addEventListener('click', function(){
        var idx = parseInt(this.getAttribute('data-gt-delete'),10);
        var current = getGlobalToppings();
        if(isNaN(idx)) return;
        current.splice(idx,1);
        saveGlobalToppings(current);
        renderGlobalToppings();
        flashSaved();
      });
    });
  }
  function renderShipZones(){
    var tbody = $('shipZoneBody');
    var freeInput = $('shipFreeThreshold');
    if(freeInput) freeInput.value = getFreeThreshold();
    if(!tbody) return;
    var zones = getShipZones();
    var html = '';
    zones.forEach(function(z, idx){
      html += '<tr data-idx="'+idx+'">'
        + '<td style="min-width:180px"><input type="text" class="ship-label" data-idx="'+idx+'" value="'+z.label.replace(/"/g,'&quot;')+'" placeholder="ชื่อเขต" style="width:100%;height:36px;border:1px solid var(--border);border-radius:10px;padding:0 .7rem;font-size:.85rem;font-weight:700"></td>'
        + '<td style="text-align:center"><div style="display:flex;align-items:center;justify-content:center;gap:.3rem"><input type="number" class="ship-fee" data-idx="'+idx+'" value="'+z.fee+'" min="0" max="5000" step="10" style="width:92px;height:36px;border:1px solid var(--border);border-radius:10px;text-align:center;font-weight:900;color:var(--primary);background:#FFFBEB"><span style="font-size:.72rem;color:var(--text-muted)">บาท</span></div><div style="font-size:.68rem;color:var(--text-muted)">id: '+z.id+'</div></td>'
        + '<td style="text-align:center"><button class="btn btn-outline btn-sm ship-del" data-idx="'+idx+'" type="button" style="padding:.3rem .6rem;font-size:.75rem;color:#DC2626;border-color:#FECACA">ลบ</button></td>'
        + '</tr>';
    });
    tbody.innerHTML = html;
    // bind
    tbody.querySelectorAll('.ship-label').forEach(function(inp){
      inp.addEventListener('change', function(){
        var i = parseInt(this.getAttribute('data-idx'),10);
        var zones2 = getShipZones();
        if(!zones2[i]) return;
        var newLabel = this.value.trim() || 'เขตใหม่';
        zones2[i].label = newLabel;
        // keep id stable unless user wants; regenerate if other exists?
        saveShipZones(zones2);
        renderShipZones();
        flashSaved();
      });
    });
    tbody.querySelectorAll('.ship-fee').forEach(function(inp){
      inp.addEventListener('input', function(){
        var i = parseInt(this.getAttribute('data-idx'),10);
        var v = parseInt(this.value,10);
        if(isNaN(v) || v<0) return;
        var zones2 = getShipZones();
        if(!zones2[i]) return;
        zones2[i].fee = v;
        saveShipZones(zones2);
        flashSaved();
      });
      inp.addEventListener('change', function(){
        var i = parseInt(this.getAttribute('data-idx'),10);
        var v = parseInt(this.value,10);
        if(isNaN(v) || v<0) v=0;
        v = Math.max(0, Math.min(5000, v));
        this.value = v;
        var zones2 = getShipZones();
        if(!zones2[i]) return;
        zones2[i].fee = v;
        saveShipZones(zones2);
        flashSaved();
      });
    });
    tbody.querySelectorAll('.ship-del').forEach(function(btn){
      btn.addEventListener('click', function(){
        var i = parseInt(this.getAttribute('data-idx'),10);
        var zones2 = getShipZones();
        if(zones2.length <= 1){ alert('ต้องเหลืออย่างน้อย 1 เขต'); return; }
        if(!confirm('ลบเขต "'+zones2[i].label+'" ?')) return;
        zones2.splice(i,1);
        saveShipZones(zones2);
        renderShipZones();
        flashSaved();
      });
    });
  }

  // --- Render ---
  function getFilteredMenus(){
    var del = getDeleted();
    var q = (state.search||'').toLowerCase().trim();
    return EED_MENUS.filter(function(m){
      if(del.indexOf(m.id)!==-1) return false;
      var catOk = state.category==='all' || m.category===state.category;
      var searchOk = !q || (m.name||'').toLowerCase().indexOf(q) !== -1;
      return catOk && searchOk;
    });
  }

  function renderTable(){
    var tbody = $('priceTableBody');
    if(!tbody) return;
    var filtered = getFilteredMenus();
    // group by category
    var cats = {};
    filtered.forEach(function(m){
      if(!cats[m.category]) cats[m.category]=[];
      cats[m.category].push(m);
    });
    var order = ['ข้าวราดแกง','ข้าวผัด','เส้น','ข้าวหมก','แกง/ต้ม','พรีเมียม'];
    var sortedCats = Object.keys(cats).sort(function(a,b){
      var ia = order.indexOf(a), ib = order.indexOf(b);
      if(ia===-1) ia=99; if(ib===-1) ib=99;
      return ia-ib;
    });

    if(filtered.length===0){
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--text-muted)">ไม่พบเมนูที่ค้นหา</td></tr>';
      return;
    }

    var html = '';
    sortedCats.forEach(function(cat){
      html += '<tr style="background:var(--bg);"><td colspan="9" style="font-weight:900;color:var(--primary);padding:.7rem .9rem;font-size:.85rem">'+cat+' <span style="font-weight:600;color:var(--text-muted)">· '+cats[cat].length+' เมนู</span></td></tr>';
      cats[cat].forEach(function(m){
        var badge = m.badge ? '<span style="display:inline-block;margin-left:.4rem;background:var(--accent);color:#fff;font-size:.62rem;font-weight:800;padding:.15rem .4rem;border-radius:999px;vertical-align:middle">'+m.badge+'</span>' : '';
        var tier = [];
        if(m.price <= 60) tier.push('60✓'); else tier.push('60✗');
        if(m.price <= 90) tier.push('90✓'); else tier.push('90✗');
        if(m.price <= 120) tier.push('120✓'); else tier.push('120✗');
        var tierText = tier.join(' · ');
        var tierColor = m.price <= 60 ? 'var(--primary)' : (m.price <= 90 ? '#7A5C00' : '#7C3A00');
        html += '<tr data-id="'+m.id+'">'
          + '<td style="min-width:200px"><div style="display:flex;align-items:center;gap:.6rem"><img src="'+m.image+'" alt="" style="width:38px;height:38px;border-radius:8px;object-fit:cover;flex-shrink:0" onerror="this.style.display=\'none\'"><div><div style="font-weight:800;font-size:.88rem;line-height:1.2">'+m.name+badge+'</div><div style="font-size:.72rem;color:var(--text-muted);line-height:1.3">'+(m.desc||'')+'</div></div></div></td>'
          + '<td style="text-align:center"><select class="cat-input" data-id="'+m.id+'" style="height:34px;border:1px solid var(--border);border-radius:10px;padding:0 .35rem;font-size:.78rem;font-weight:700;color:var(--text);background:var(--bg);cursor:pointer">'+MENU_CATEGORIES.map(function(c){ return '<option value="'+c+'"'+(c===m.category?' selected':'')+'>'+c+'</option>'; }).join('')+'</select></td>'
          + '<td style="text-align:center"><div style="display:flex;align-items:center;justify-content:center;gap:.35rem"><input type="number" class="price-input" data-id="'+m.id+'" value="'+m.price+'" min="10" max="500" step="5" style="width:86px;height:36px;border:1px solid var(--border);border-radius:10px;text-align:center;font-weight:900;color:var(--primary);background:#FFFBEB"><span style="font-size:.75rem;font-weight:700;color:var(--text-muted)">บาท</span></div><div style="font-size:.68rem;color:var(--text-muted);margin-top:.15rem">เดิม '+fmt(m._origPrice||m.price)+' บาท</div></td>'
          + '<td style="text-align:center"><div style="display:flex;align-items:center;justify-content:center;gap:.35rem"><input type="number" class="min-input" data-id="'+m.id+'" value="'+m.minPerMenu+'" min="1" max="50" step="1" style="width:72px;height:36px;border:1px solid var(--border);border-radius:10px;text-align:center;font-weight:900;color:var(--primary);background:#FFF7ED"><span style="font-size:.75rem;font-weight:700;color:var(--text-muted)">กล่อง</span></div></td>'
          + '<td style="text-align:center"><input type="text" class="img-input" data-id="'+m.id+'" value="'+m.image.replace(/"/g,'&quot;')+'" placeholder="img/menu.png" style="width:160px;height:34px;border:1px solid var(--border);border-radius:10px;padding:0 .55rem;font-size:.78rem;font-weight:600;color:var(--text);background:var(--bg)"></td>'
          + '<td style="text-align:center"><input type="text" class="name-input" data-id="'+m.id+'" value="'+m.name.replace(/"/g,'&quot;')+'" placeholder="ชื่อเมนู" style="width:170px;height:34px;border:1px solid var(--border);border-radius:10px;padding:0 .55rem;font-size:.78rem;font-weight:700;color:var(--text);background:var(--bg)"></td>'
          + '<td style="text-align:center;font-size:.72rem;font-weight:700;color:'+tierColor+'">'+tierText+'</td>'
          + '<td style="text-align:center"><button type="button" class="del-menu-btn" data-id="'+m.id+'" style="background:none;border:1px solid #FECACA;border-radius:8px;padding:.25rem .5rem;cursor:pointer;color:#DC2626;font-size:.75rem;font-weight:700" title="ซ่อนเมนูนี้">🗑️</button></td>'
          + '</tr>';
      });
    });
    tbody.innerHTML = html;
    bindInputs();
  }

  function bindInputs(){
    var tbody = $('priceTableBody');
    if(!tbody) return;
    tbody.querySelectorAll('.price-input').forEach(function(inp){
      inp.addEventListener('input', function(){
        var id = this.getAttribute('data-id');
        var v = parseFloat(this.value);
        if(isNaN(v) || v < 0) return;
        v = Math.round(v);
        if(v < 10) v = 10;
        if(v > 500) v = 500;
        saveOne(id, v);
        var tr = this.closest('tr');
        if(tr){
          var tierCell = tr.cells[6];
          if(tierCell){
            var tier = [];
            if(v <= 60) tier.push('60✓'); else tier.push('60✗');
            if(v <= 90) tier.push('90✓'); else tier.push('90✗');
            if(v <= 120) tier.push('120✓'); else tier.push('120✗');
            tierCell.textContent = tier.join(' · ');
            tierCell.style.color = v <= 60 ? 'var(--primary)' : (v <= 90 ? '#7A5C00' : '#7C3A00');
          }
        }
      });
      inp.addEventListener('change', function(){
        var id = this.getAttribute('data-id');
        var v = parseInt(this.value,10);
        if(isNaN(v)) return;
        v = Math.round(v);
        this.value = v;
        saveOne(id, v);
      });
    });
    tbody.querySelectorAll('.min-input').forEach(function(inp){
      inp.addEventListener('input', function(){
        var id = this.getAttribute('data-id');
        var v = parseInt(this.value,10);
        if(isNaN(v) || v < 1) return;
        v = Math.max(1, Math.min(50, v));
        saveOneMin(id, v);
      });
      inp.addEventListener('change', function(){
        var id = this.getAttribute('data-id');
        var v = parseInt(this.value,10);
        if(isNaN(v) || v < 1) return;
        v = Math.max(1, Math.min(50, v));
        this.value = v;
        saveOneMin(id, v);
      });
    });
    tbody.querySelectorAll('.img-input').forEach(function(inp){
      inp.addEventListener('change', function(){
        var id = this.getAttribute('data-id');
        var v = this.value.trim();
        if(!v) return;
        saveOneImage(id, v);
        // update thumbnail in same row
        var tr = this.closest('tr');
        if(tr){
          var img = tr.querySelector('td:first-child img');
          if(img){ img.src = v; img.style.display=''; }
        }
      });
    });
    tbody.querySelectorAll('.name-input').forEach(function(inp){
      inp.addEventListener('change', function(){
        var id = this.getAttribute('data-id');
        var v = this.value.trim();
        if(!v) return;
        saveOneName(id, v);
        // update name display in first column
        var tr = this.closest('tr');
        if(tr){
          var nameEl = tr.querySelector('td:first-child div > div > div:first-child');
          if(nameEl){
            var badge = tr.querySelector('.calc-badge');
            var badgeHtml = badge ? badge.outerHTML : '';
            nameEl.innerHTML = v + badgeHtml;
          }
        }
      });
    });
    tbody.querySelectorAll('.cat-input').forEach(function(sel){
      sel.addEventListener('change', function(){
        var id = this.getAttribute('data-id');
        var v = this.value;
        if(!v) return;
        saveOneCategory(id, v);
        renderTable();
        updateStats();
      });
    });
    tbody.querySelectorAll('.del-menu-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = parseInt(this.getAttribute('data-id'),10);
        var m = EED_MENUS.find(function(x){ return x.id===id; });
        var label = m ? m.name : 'id:'+id;
        if(!confirm('ซ่อนเมนู "'+label+'" ?\n(จะไม่แสดงบนหน้าลูกค้า แต่ไม่ลบจริง)')) return;
        toggleDeleteMenu(id);
        renderTable();
        updateStats();
        flashSaved();
      });
    });
  }

  function updateStats(){
    var countEl = $('statCount');
    var catEl = $('statCat');
    var rangeEl = $('statRange');
    var lastEl = $('statLast');
    if(countEl) countEl.textContent = EED_MENUS.length;
    if(catEl){
      var cats = {};
      EED_MENUS.forEach(function(m){ cats[m.category]=1; });
      catEl.textContent = Object.keys(cats).length + ' หมวด · ' + Object.keys(cats).join(' · ');
    }
    if(rangeEl){
      var prices = EED_MENUS.map(function(m){ return m.price; });
      var min = Math.min.apply(null, prices);
      var max = Math.max.apply(null, prices);
      rangeEl.textContent = fmt(min) + ' – ' + fmt(max) + ' บาท';
    }
    if(lastEl){
      try{
        var ts = localStorage.getItem('eed_selling_updated_at');
        if(ts){
          var d = new Date(parseInt(ts,10));
          lastEl.textContent = 'บันทึกเมื่อ ' + d.toLocaleString('th-TH');
        } else {
          var saved = localStorage.getItem(LS_SELLING);
          lastEl.textContent = saved ? 'บันทึกไว้แล้ว (local)' : 'ยังไม่เคยบันทึก — ใช้ราคาเริ่มต้น';
        }
      }catch(e){}
    }
  }

  function loadNewMenus(){
    var newMenus = getNewMenus();
    newMenus.forEach(function(nm){
      var exists = EED_MENUS.some(function(m){ return m.id === nm.id; });
      if(!exists){
        EED_MENUS.push({
          id: nm.id, name: nm.name, price: nm.price,
          category: nm.category, image: nm.image,
          desc: nm.desc || '', badge: nm.badge || 'ใหม่',
          minPerMenu: nm.minPerMenu || 5
        });
      }
    });
  }

  function initPlanner(){
    loadSelling();
    loadImages();
    loadNames();
    loadCategories();
    loadNewMenus();

    var catChips = document.querySelectorAll('[data-pcat]');
    var searchInput = $('priceSearch');

    renderTable();
    updateStats();
    renderMeats();
    renderGlobalToppings();
    renderShipZones();

    // --- Add meat ---
    var addMeatBtn = $('addMeat');
    if(addMeatBtn){
      addMeatBtn.addEventListener('click', function(){
        var nameInput = $('meatName');
        var priceInput = $('meatPrice');
        var name = nameInput ? nameInput.value.trim() : '';
        var price = priceInput ? parseInt(priceInput.value,10) : 0;
        if(!name){ if(nameInput) nameInput.focus(); return; }
        if(isNaN(price) || price<0) price=0;
        price = Math.min(500, price);
        var meats = getMeats();
        meats.push({name:name, price:price});
        saveMeats(meats);
        if(nameInput) nameInput.value='';
        if(priceInput) priceInput.value='';
        renderMeats();
        flashSaved();
      });
    }

    // --- Add new menu ---
    var addNewMenuBtn = $('addNewMenu');
    var newMenuForm = $('newMenuForm');
    var saveNewMenuBtn = $('saveNewMenu');
    var cancelNewMenuBtn = $('cancelNewMenu');
    if(addNewMenuBtn && newMenuForm){
      addNewMenuBtn.addEventListener('click', function(){
        newMenuForm.style.display = newMenuForm.style.display==='none' ? 'block' : 'none';
      });
    }
    if(cancelNewMenuBtn && newMenuForm){
      cancelNewMenuBtn.addEventListener('click', function(){
        newMenuForm.style.display='none';
      });
    }
    if(saveNewMenuBtn){
      saveNewMenuBtn.addEventListener('click', function(){
        var name = ($('newMenuName')||{}).value||'';
        name = name.trim();
        if(!name){ alert('กรุณากรอกชื่อเมนู'); ($('newMenuName')||{}).focus(); return; }
        var menu = addNewMenu({
          name: name,
          category: ($('newMenuCat')||{}).value || 'ข้าวราดแกง',
          price: ($('newMenuPrice')||{}).value || 60,
          minPerMenu: ($('newMenuMin')||{}).value || 5,
          image: ($('newMenuImg')||{}).value || 'img/logo.jpg',
          desc: ($('newMenuDesc')||{}).value || ''
        });
        // reset form
        if($('newMenuName')) $('newMenuName').value='';
        if($('newMenuDesc')) $('newMenuDesc').value='';
        if($('newMenuImg')) $('newMenuImg').value='img/logo.jpg';
        if($('newMenuPrice')) $('newMenuPrice').value='60';
        if($('newMenuMin')) $('newMenuMin').value='5';
        newMenuForm.style.display='none';
        renderTable();
        updateStats();
        flashSaved();
      });
    }
    // --- Show deleted menus ---
    var showDeletedBtn = $('showDeleted');
    var deletedListEl = $('deletedList');
    var deletedItemsEl = $('deletedItems');
    if(showDeletedBtn && deletedListEl){
      showDeletedBtn.addEventListener('click', function(){
        if(deletedListEl.style.display==='none' || !deletedListEl.style.display){
          var del = getDeleted();
          if(del.length===0){
            deletedItemsEl.innerHTML = '<div style="padding:.3rem 0">ไม่มีเมนูที่ซ่อนอยู่</div>';
          } else {
            deletedItemsEl.innerHTML = del.map(function(id){
              var m = EED_MENUS.find(function(x){ return x.id===id; });
              var label = m ? m.name+' ('+m.price+'บ.)' : 'id:'+id;
              return '<div style="display:flex;align-items:center;gap:.5rem;margin:.25rem 0;padding:.3rem .5rem;background:rgba(255,255,255,.5);border-radius:8px"><span style="flex:1">'+label+'</span><button type="button" class="restore-menu-btn" data-id="'+id+'" style="background:var(--primary);color:#fff;border:none;border-radius:6px;padding:.2rem .6rem;font-size:.75rem;font-weight:700;cursor:pointer">คืนค่า</button></div>';
            }).join('');
            deletedItemsEl.querySelectorAll('.restore-menu-btn').forEach(function(btn){
              btn.addEventListener('click', function(){
                var rid = parseInt(this.getAttribute('data-id'),10);
                toggleDeleteMenu(rid);
                renderTable();
                updateStats();
                flashSaved();
                showDeletedBtn.click();
              });
            });
          }
          deletedListEl.style.display='block';
        } else {
          deletedListEl.style.display='none';
        }
      });
    }

    var addGlobalToppingBtn = $('addGlobalTopping');
    if(addGlobalToppingBtn) addGlobalToppingBtn.addEventListener('click', function(){
      var nameInput = $('globalToppingName');
      var priceInput = $('globalToppingPrice');
      var name = nameInput ? nameInput.value.trim() : '';
      var price = priceInput ? parseInt(priceInput.value,10) : 0;
      if(!name){ if(nameInput) nameInput.focus(); return; }
      if(isNaN(price) || price<0) price=0;
      price = Math.min(500, price);
      var toppings = getGlobalToppings();
      toppings.push({name:name, price:price});
      saveGlobalToppings(toppings);
      if(nameInput) nameInput.value='';
      if(priceInput) priceInput.value='';
      renderGlobalToppings();
      flashSaved();
    });

    catChips.forEach(function(c){
      c.addEventListener('click', function(){
        state.category = this.getAttribute('data-pcat');
        catChips.forEach(function(x){ x.classList.remove('active'); });
        this.classList.add('active');
        renderTable();
      });
    });

    if(searchInput){
      searchInput.addEventListener('input', function(){
        state.search = this.value;
        renderTable();
      });
    }

    var resetBtn = $('resetPrices');
    if(resetBtn) resetBtn.addEventListener('click', function(){
      if(!confirm('รีเซ็ตทุกราคา ขั้นต่ำ รูป ชื่อ หมวด เมนูที่ซ่อน และเมนูใหม่กลับเป็นค่าเริ่มต้นใน js/menu-data.js ?')) return;
      localStorage.removeItem(LS_SELLING);
      localStorage.removeItem(LS_MINS);
      localStorage.removeItem(LS_IMAGES);
      localStorage.removeItem(LS_NAMES);
      localStorage.removeItem(LS_CATEGORIES);
      localStorage.removeItem(LS_DELETED);
      localStorage.removeItem(LS_NEW_MENUS);
      localStorage.removeItem(LS_MEATS);
      localStorage.removeItem('eed_selling_updated_at');
      EED_MENUS.forEach(function(m){
        if(m._origPrice !== undefined) m.price = m._origPrice;
        if(m._origMin !== undefined) m.minPerMenu = m._origMin;
        // images are loaded from menu-data.js originally, reload page to reset
      });
      location.reload();
    });

    var exportBtn = $('exportJson');
    if(exportBtn) exportBtn.addEventListener('click', function(){
      var obj = {};
      EED_MENUS.forEach(function(m){ obj[m.id]=m.price; });
      var json = JSON.stringify(obj, null, 2);
      navigator.clipboard.writeText(json).then(function(){
        var orig = exportBtn.textContent;
        exportBtn.textContent='คัดลอกแล้ว ✓';
        setTimeout(function(){ exportBtn.textContent=orig; },1500);
      }).catch(function(){
        prompt('คัดลอก JSON นี้ไปวางใน js/menu-data.js หรือเก็บไว้สำรอง', json);
      });
    });

    // --- Export for deploy (no backend) ---
    function downloadText(filename, text, mime){
      var blob = new Blob([text], {type: mime || 'text/plain'});
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
    }
    function buildOverrides(){
      var prices={}, mins={}, images={}, names={}, categories={};
      EED_MENUS.forEach(function(m){
        prices[m.id]=m.price;
        mins[m.id]=m.minPerMenu;
        images[m.id]=m.image;
        names[m.id]=m.name;
        categories[m.id]=m.category;
      });
      return {
        prices: prices,
        mins: mins,
        images: images,
        names: names,
        categories: categories,
        deleted: getDeleted(),
        newMenus: getNewMenus(),
        meats: getMeats(),
        toppings: getGlobalToppings(),
        shipZones: getShipZones(),
        shipFree: getFreeThreshold(),
        exportedAt: new Date().toISOString()
      };
    }
    var exportAllBtn = $('exportAll');
    if(exportAllBtn) exportAllBtn.addEventListener('click', function(){
      var data = buildOverrides();
      downloadText('planner-overrides.json', JSON.stringify(data, null, 2), 'application/json');
      // also generate menu-data.js
       var globalToppings = getGlobalToppings();
       var globalMeats = getMeats();
       var lines = ['/* EED HALAL — Menu database for budget calculator — auto-export '+new Date().toLocaleString('th-TH')+' */','var EED_DEFAULT_MEATS = '+JSON.stringify(globalMeats)+';','var EED_DEFAULT_TOPPINGS = '+JSON.stringify(globalToppings)+';','var EED_MENUS = ['];
      EED_MENUS.forEach(function(m, idx){
        var toppings = getGlobalToppings();
        var topStr = toppings.length ? ', toppings: '+JSON.stringify(toppings) : '';
        var line = '  { id: '+m.id+', name: '+JSON.stringify(m.name)+', price: '+m.price+', category: '+JSON.stringify(m.category)+', image: '+JSON.stringify(m.image)+', desc: '+JSON.stringify(m.desc||'')+', badge: '+JSON.stringify(m.badge||'')+', minPerMenu: '+m.minPerMenu+topStr+' }';
        if(idx < EED_MENUS.length-1) line += ',';
        lines.push(line);
      });
      lines.push('];');
      setTimeout(function(){ downloadText('menu-data.js', lines.join('\n'), 'application/javascript'); }, 350);
      // also copy overrides json to clipboard
      try{ navigator.clipboard.writeText(JSON.stringify(data, null, 2)); }catch(e){}
      var orig = exportAllBtn.textContent;
      exportAllBtn.textContent='ดาวน์โหลดแล้ว ✓';
      setTimeout(function(){ exportAllBtn.textContent=orig; },2000);
    });
    var copyOverridesBtn = $('copyOverrides');
    if(copyOverridesBtn) copyOverridesBtn.addEventListener('click', function(){
      var data = buildOverrides();
      navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(function(){
        var orig = copyOverridesBtn.textContent;
        copyOverridesBtn.textContent='คัดลอกแล้ว ✓';
        setTimeout(function(){ copyOverridesBtn.textContent=orig; },1500);
      });
    });

    var copyLink = $('copyPlannerLink');
    if(copyLink) copyLink.addEventListener('click', function(){
      var url = window.location.href.split('?')[0] + '?key='+PIN;
      navigator.clipboard.writeText(url).then(function(){
        copyLink.textContent='คัดลอกลิงก์แล้ว ✓';
        setTimeout(function(){ copyLink.textContent='คัดลอกลิงก์เจ้าของ'; },1500);
      });
    });

    // ship zones add / free threshold / reset
    var addShipBtn = $('addShipZone');
    if(addShipBtn) addShipBtn.addEventListener('click', function(){
      var zones = getShipZones();
      var label = prompt('ชื่อเขตใหม่ เช่น บางนา');
      if(label===null) return;
      label = (label||'').trim() || 'เขตใหม่';
      var feeStr = prompt('ค่าส่งเขต "'+label+'" (บาท, 0 = สอบถาม)', '150');
      if(feeStr===null) return;
      var fee = parseInt(feeStr,10);
      if(isNaN(fee) || fee<0) fee=0;
      var id = slugify(label);
      // ensure unique id
      var base=id, n=1;
      while(zones.some(function(z){ return z.id===id; })){ id = base+'_'+(n++); }
      zones.push({id:id, label:label, fee:fee});
      saveShipZones(zones);
      renderShipZones();
      flashSaved();
    });
    var freeInput = $('shipFreeThreshold');
    if(freeInput){
      freeInput.addEventListener('input', function(){
        var v = parseInt(this.value,10);
        if(isNaN(v) || v<1) return;
        v = Math.max(1, Math.min(500, v));
        saveFreeThreshold(v);
        flashSaved();
      });
      freeInput.addEventListener('change', function(){
        var v = parseInt(this.value,10);
        if(isNaN(v) || v<1) v=50;
        v = Math.max(1, Math.min(500, v));
        this.value = v;
        saveFreeThreshold(v);
        renderShipZones();
        flashSaved();
      });
    }
    var resetShipBtn = $('resetShipZones');
    if(resetShipBtn) resetShipBtn.addEventListener('click', function(){
      if(!confirm('รีเซ็ตเขตค่าส่งกลับเป็นค่าเริ่มต้น 6 เขต?')) return;
      localStorage.removeItem(LS_SHIP_ZONES);
      localStorage.removeItem(LS_SHIP_FREE);
      renderShipZones();
      flashSaved();
    });
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', initGate);
  } else {
    initGate();
  }
})();
