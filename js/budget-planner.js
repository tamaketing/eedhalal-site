(function(){
  'use strict';
  var LS_SELLING = 'eed_selling_v1';
  var LS_MINS = 'eed_mins_v1';
  var LS_SHIP_ZONES = 'eed_ship_zones_v1';
  var LS_SHIP_ZONES_OVERRIDE = 'eed_ship_zones_override_v1';
  var LS_SHIP_FREE = 'eed_ship_free_v1';
  var LS_SHIP_ZONE_FREE = 'eed_ship_zone_free_v1';
  var LS_TOPPINGS = 'eed_toppings_v1';
  var LS_MEATS = 'eed_meats_v1';
  var LS_IMAGES = 'eed_images_v1';
  var LS_NAMES = 'eed_names_v1';
  var LS_CATEGORIES = 'eed_categories_v1';
  var LS_DELETED = 'eed_deleted_v1';
  var LS_NEW_MENUS = 'eed_new_menus_v1';
  var LS_SNACK_PRICES = 'eed_snack_prices_v1';
  var LS_SNACK_NAMES = 'eed_snack_names_v1';
  var LS_SNACK_ADDONS = 'eed_snack_addons_v1';
  var LS_SNACK_CATEGORIES = 'eed_snack_cats_v1';
  var LS_NO_MEAT = 'eed_no_meat_v1';
  var MENU_CATEGORIES = ['ข้าวราดแกง','ข้าวผัด','เส้น','อาหารอินเดีย','พรีเมียม'];
  // Zone structure shared with budget-calculator (moto: ≤40 กล่อง, car: >40 กล่อง, districts)
  function defaultZones(){
    if(typeof EED !== 'undefined' && EED.shippingZones) return JSON.parse(JSON.stringify(EED.shippingZones));
    return {
      zone_1: { moto: 60,  car: 120, districts: ['ยานนาวา','บางคอแหลม','สาทร','คลองสาน','ธนบุรี'] },
      zone_2: { moto: 110, car: 180, districts: ['บางรัก','ปทุมวัน','วัฒนา','คลองเตย','พระโขนง','ดินแดง','พญาไท','ราชเทวี','ป้อมปราบศัตรูพ่าย','สัมพันธวงศ์'] },
      zone_3: { moto: 189, car: 230, districts: ['พระนคร','ดุสิต','ห้วยขวาง','วังทองหลาง','บางกะปิ','สวนหลวง','ประเวศ','บางนา','จตุจักร','บางซื่อ','บางกอกใหญ่','บางกอกน้อย','ราษฎร์บูรณะ','จอมทอง'] },
      zone_4: { moto: 240, car: 320, districts: ['ลาดพร้าว','บึงกุ่ม','สะพานสูง','คันนายาว','ดอนเมือง','หลักสี่','บางเขน','สายไหม','บางพลัด','ภาษีเจริญ','ตลิ่งชัน','ทุ่งครุ'] },
      zone_5: { moto: 500, car: 500, districts: ['มีนบุรี','หนองจอก','ลาดกระบัง','คลองสามวา','ทวีวัฒนา','บางแค','หนองแขม','บางบอน','บางขุนเทียน'] }
    };
  }

  var state = {
    category: 'all',
    search: ''
  };

  function $(id){ return document.getElementById(id); }
  function fmt(n){ return Number(n).toLocaleString('th-TH'); }

  function initGate(){
    var app = $('plannerApp');
    if(app) app.style.display = 'block';
    initPlanner();
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

  // --- Snack box management ---
  function loadSnackPrices(){
    if(typeof EED_SNACK_MENUS==='undefined') return;
    try{
      var saved = JSON.parse(localStorage.getItem(LS_SNACK_PRICES)||'null');
      if(saved && typeof saved==='object'){
        for(var id in saved){
          if(!saved.hasOwnProperty(id)) continue;
          var v = parseFloat(saved[id]);
          if(!isNaN(v)){
            for(var i=0;i<EED_SNACK_MENUS.length;i++){
              if(EED_SNACK_MENUS[i].id===id){ EED_SNACK_MENUS[i].price=v; break; }
            }
          }
        }
      }
    }catch(e){}
  }
  function saveSnackPrices(){
    if(typeof EED_SNACK_MENUS==='undefined') return;
    try{
      var obj={};
      EED_SNACK_MENUS.forEach(function(m){ obj[m.id]=m.price; });
      localStorage.setItem(LS_SNACK_PRICES, JSON.stringify(obj));
      localStorage.setItem('eed_selling_updated_at', String(Date.now()));
    }catch(e){}
  }
  function saveOneSnackPrice(id, price){
    if(typeof EED_SNACK_MENUS==='undefined') return;
    for(var i=0;i<EED_SNACK_MENUS.length;i++){
      if(EED_SNACK_MENUS[i].id===id){ EED_SNACK_MENUS[i].price=price; break; }
    }
    saveSnackPrices();
    flashSaved();
  }
  function loadSnackNames(){
    if(typeof EED_SNACK_MENUS==='undefined') return;
    try{
      var saved = JSON.parse(localStorage.getItem(LS_SNACK_NAMES)||'null');
      if(saved && typeof saved==='object'){
        for(var id in saved){
          if(!saved.hasOwnProperty(id)) continue;
          var v = String(saved[id]||'').trim();
          if(v){
            for(var i=0;i<EED_SNACK_MENUS.length;i++){
              if(EED_SNACK_MENUS[i].id===id){ EED_SNACK_MENUS[i].name=v; break; }
            }
          }
        }
      }
    }catch(e){}
  }
  function saveSnackNames(){
    if(typeof EED_SNACK_MENUS==='undefined') return;
    try{
      var obj={};
      EED_SNACK_MENUS.forEach(function(m){ obj[m.id]=m.name; });
      localStorage.setItem(LS_SNACK_NAMES, JSON.stringify(obj));
      localStorage.setItem('eed_selling_updated_at', String(Date.now()));
    }catch(e){}
  }
  function saveOneSnackName(id, nameVal){
    if(typeof EED_SNACK_MENUS==='undefined') return;
    for(var i=0;i<EED_SNACK_MENUS.length;i++){
      if(EED_SNACK_MENUS[i].id===id){ EED_SNACK_MENUS[i].name=nameVal; break; }
    }
    saveSnackNames();
    flashSaved();
  }
  function getSnackAddons(){
    try{
      var saved = JSON.parse(localStorage.getItem(LS_SNACK_ADDONS)||'null');
      if(Array.isArray(saved)) return saved;
    }catch(e){}
    return (typeof EED_SNACK_ADDONS!=='undefined') ? JSON.parse(JSON.stringify(EED_SNACK_ADDONS)) : [];
  }
  function saveSnackAddons(arr){
    try{
      localStorage.setItem(LS_SNACK_ADDONS, JSON.stringify(arr));
      localStorage.setItem('eed_selling_updated_at', String(Date.now()));
    }catch(e){}
  }
  function loadSnackCats(){
    if(typeof EED_SNACK_MENUS==='undefined') return;
    try{
      var saved = JSON.parse(localStorage.getItem(LS_SNACK_CATEGORIES)||'null');
      if(saved && typeof saved==='object'){
        for(var id in saved){
          if(!saved.hasOwnProperty(id)) continue;
          var v = String(saved[id]||'').trim();
          if(v){
            for(var i=0;i<EED_SNACK_MENUS.length;i++){
              if(EED_SNACK_MENUS[i].id===id){ EED_SNACK_MENUS[i].category=v; break; }
            }
          }
        }
      }
    }catch(e){}
  }
  function saveSnackCats(){
    if(typeof EED_SNACK_MENUS==='undefined') return;
    try{
      var obj={};
      EED_SNACK_MENUS.forEach(function(m){ obj[m.id]=m.category; });
      localStorage.setItem(LS_SNACK_CATEGORIES, JSON.stringify(obj));
      localStorage.setItem('eed_selling_updated_at', String(Date.now()));
    }catch(e){}
  }
  function saveOneSnackCat(id, catVal){
    if(typeof EED_SNACK_MENUS==='undefined') return;
    for(var i=0;i<EED_SNACK_MENUS.length;i++){
      if(EED_SNACK_MENUS[i].id===id){ EED_SNACK_MENUS[i].category=catVal; break; }
    }
    saveSnackCats();
    flashSaved();
  }
  function renderSnackTable(){
    var tbody = $('snackTableBody');
    if(!tbody || typeof EED_SNACK_MENUS==='undefined') return;
    var cats = (typeof EED_SNACK_CATEGORIES!=='undefined') ? EED_SNACK_CATEGORIES : [];
    var catOpts = cats.map(function(c){ return '<option value="'+c.id+'">'+escapeHtml(c.label)+'</option>'; }).join('');
    var html = '';
    for(var c=0;c<cats.length;c++){
      var cat = cats[c];
      var items = EED_SNACK_MENUS.filter(function(m){ return m.category===cat.id; });
      for(var j=0;j<items.length;j++){
        var m = items[j];
        html += '<tr>';
        html += '<td><select class="snack-cat-select" data-id="'+m.id+'" style="width:100px;height:34px;border:1px solid var(--border);border-radius:8px;padding:0 .4rem;font-size:.82rem;font-weight:700">'+catOpts.replace('value="'+m.category+'"','value="'+m.category+'" selected')+'</select></td>';
        html += '<td style="font-weight:800">'+escapeHtml(m.name)+'</td>';
        html += '<td><input type="number" class="snack-price-input" data-id="'+m.id+'" value="'+m.price+'" min="0" max="500" step="5" style="width:72px;height:34px;border:1px solid var(--border);border-radius:8px;text-align:center;font-weight:900;color:var(--primary)"></td>';
        html += '<td><input type="text" class="snack-name-input" data-id="'+m.id+'" value="'+escapeHtml(m.name)+'" style="width:180px;height:34px;border:1px solid var(--border);border-radius:8px;padding:0 .5rem;font-size:.82rem"></td>';
        html += '</tr>';
      }
    }
    tbody.innerHTML = html;
    // event listeners
    tbody.querySelectorAll('.snack-cat-select').forEach(function(sel){
      sel.addEventListener('change', function(){
        saveOneSnackCat(this.getAttribute('data-id'), this.value);
      });
    });
    tbody.querySelectorAll('.snack-price-input').forEach(function(inp){
      inp.addEventListener('change', function(){
        var v = parseFloat(this.value);
        if(isNaN(v) || v<0) v=0;
        v = Math.min(500, v);
        this.value = v;
        saveOneSnackPrice(this.getAttribute('data-id'), v);
      });
    });
    tbody.querySelectorAll('.snack-name-input').forEach(function(inp){
      inp.addEventListener('change', function(){
        var v = this.value.trim();
        if(!v) return;
        saveOneSnackName(this.getAttribute('data-id'), v);
      });
    });
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
  function getNoMeat(){
    try{
      var arr = JSON.parse(localStorage.getItem(LS_NO_MEAT)||'null');
      return Array.isArray(arr) ? arr : [];
    }catch(e){}
    return [];
  }
  function saveNoMeat(arr){
    try{
      var cleaned = (arr||[]).map(function(id){ return parseInt(id,10)||id; });
      localStorage.setItem(LS_NO_MEAT, JSON.stringify(cleaned));
      localStorage.setItem('eed_selling_updated_at', String(Date.now()));
    }catch(e){}
  }
  function toggleNoMeat(id){
    var arr = getNoMeat();
    var idx = arr.indexOf(id);
    if(idx===-1) arr.push(id);
    else arr.splice(idx,1);
    saveNoMeat(arr);
  }

  function flashSaved(){
    var el = $('saveStatus');
    if(!el) return;
    el.style.display='inline-flex';
    clearTimeout(flashSaved._t);
    flashSaved._t = setTimeout(function(){ el.style.display='none'; }, 2200);
  }

  // --- Ship zones (object format: {zoneId:{moto,car,districts}}) ---
  function getShipZones(){
    try{
      var saved = JSON.parse(localStorage.getItem(LS_SHIP_ZONES_OVERRIDE)||'null');
      if(saved && typeof saved==='object' && Object.keys(saved).length){
        return normalizeZoneObject(saved);
      }
    }catch(e){}
    return defaultZones();
  }
  function normalizeZoneObject(obj){
    var out = {};
    Object.keys(obj||{}).forEach(function(id){
      var z = obj[id]||{};
      out[id] = {
        moto: parseInt(z.moto,10)||0,
        car: parseInt(z.car,10)||0,
        districts: Array.isArray(z.districts) ? z.districts.slice() : (typeof z.districts==='string' ? z.districts.split(',').map(function(s){return s.trim();}).filter(Boolean) : [])
      };
    });
    return out;
  }
  function saveShipZones(zones){
    try{
      var obj = normalizeZoneObject(zones);
      localStorage.setItem(LS_SHIP_ZONES_OVERRIDE, JSON.stringify(obj));
      // keep old key in sync for backward compat (array)
      var arr = Object.keys(obj).map(function(id){
        return {id:id, label:id+' ('+(obj[id].districts||[]).join(' ')+')', fee:obj[id].moto};
      });
      localStorage.setItem(LS_SHIP_ZONES, JSON.stringify(arr));
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
  function getZoneFreeThresholds(){
    try{
      var saved = JSON.parse(localStorage.getItem(LS_SHIP_ZONE_FREE)||'null');
      if(saved && typeof saved === 'object') return saved;
    }catch(e){}
    // fallback to EED defaults
    if(typeof EED !== 'undefined' && EED.shippingZoneFreeThresholds) return JSON.parse(JSON.stringify(EED.shippingZoneFreeThresholds));
    return {zone_1:50, zone_2:75, zone_3:75, zone_4:100, zone_5:0};
  }
  function saveZoneFreeThresholds(thresholds){
    try{ localStorage.setItem(LS_SHIP_ZONE_FREE, JSON.stringify(thresholds)); localStorage.setItem('eed_selling_updated_at', String(Date.now())); }catch(e){}
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
    {name:'ปลา', price:0},
    {name:'ไม่เอาเนื้อ', price:0}
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
    var zoneThresholds = getZoneFreeThresholds();
    var ids = Object.keys(zones);
    var html = '';
    ids.forEach(function(id){
      var z = zones[id];
      var zoneFree = zoneThresholds[id] !== undefined ? zoneThresholds[id] : getFreeThreshold();
      var districtsTxt = (z.districts||[]).join(', ');
      html += '<tr data-id="'+id+'">'
        + '<td style="min-width:120px"><div style="font-size:.8rem;font-weight:900;color:var(--primary)">'+(id==='zone_1'?'โซน 1':id.replace('zone_','โซน '))+'</div><div style="font-size:.68rem;color:var(--text-muted)">id: '+id+'</div></td>'
        + '<td style="text-align:center"><input type="number" class="ship-moto" data-id="'+id+'" value="'+z.moto+'" min="0" max="5000" step="10" style="width:90px;height:36px;border:1px solid var(--border);border-radius:10px;text-align:center;font-weight:900;color:var(--primary);background:#FFFBEB"></td>'
        + '<td style="text-align:center"><input type="number" class="ship-car" data-id="'+id+'" value="'+z.car+'" min="0" max="5000" step="10" style="width:90px;height:36px;border:1px solid var(--border);border-radius:10px;text-align:center;font-weight:900;color:var(--primary);background:#FFF7ED"></td>'
        + '<td style="min-width:220px"><textarea class="ship-districts" data-id="'+id+'" rows="2" style="width:100%;border:1px solid var(--border);border-radius:10px;padding:.45rem .6rem;font-size:.8rem;line-height:1.5">'+districtsTxt.replace(/</g,'&lt;')+'</textarea></td>'
        + '<td style="text-align:center"><div style="display:flex;align-items:center;justify-content:center;gap:.3rem"><input type="number" class="ship-zone-free" data-id="'+id+'" value="'+zoneFree+'" min="0" max="500" step="5" style="width:80px;height:36px;border:1px solid var(--border);border-radius:10px;text-align:center;font-weight:900;color:var(--primary);background:#F0FDF4"><span style="font-size:.72rem;color:var(--text-muted)">กล่อง</span></div><div style="font-size:.68rem;color:var(--text-muted)">'+(zoneFree > 0 ? 'ฟรีที่ '+zoneFree+'+' : 'ไม่มีส่งฟรี')+'</div></td>'
        + '<td style="text-align:center"><button class="btn btn-outline btn-sm ship-del" data-id="'+id+'" type="button" style="padding:.3rem .6rem;font-size:.75rem;color:#DC2626;border-color:#FECACA">ลบ</button></td>'
        + '</tr>';
    });
    tbody.innerHTML = html;
    // bind
    tbody.querySelectorAll('.ship-moto').forEach(function(inp){
      inp.addEventListener('input', function(){
        var zones2 = getShipZones();
        var z = zones2[this.getAttribute('data-id')];
        if(!z) return;
        var v = parseInt(this.value,10);
        if(isNaN(v) || v<0) return;
        z.moto = v;
        saveShipZones(zones2);
        flashSaved();
      });
    });
    tbody.querySelectorAll('.ship-car').forEach(function(inp){
      inp.addEventListener('input', function(){
        var zones2 = getShipZones();
        var z = zones2[this.getAttribute('data-id')];
        if(!z) return;
        var v = parseInt(this.value,10);
        if(isNaN(v) || v<0) return;
        z.car = v;
        saveShipZones(zones2);
        flashSaved();
      });
    });
    tbody.querySelectorAll('.ship-districts').forEach(function(inp){
      inp.addEventListener('change', function(){
        var id = this.getAttribute('data-id');
        var zones2 = getShipZones();
        var z = zones2[id];
        if(!z) return;
        z.districts = this.value.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
        saveShipZones(zones2);
        renderShipZones();
        flashSaved();
      });
    });
    tbody.querySelectorAll('.ship-zone-free').forEach(function(inp){
      inp.addEventListener('input', function(){
        var zoneId = this.getAttribute('data-id');
        var v = parseInt(this.value,10);
        if(isNaN(v) || v<0) return;
        var thresholds = getZoneFreeThresholds();
        thresholds[zoneId] = v;
        saveZoneFreeThresholds(thresholds);
        flashSaved();
      });
      inp.addEventListener('change', function(){
        var zoneId = this.getAttribute('data-id');
        var v = parseInt(this.value,10);
        if(isNaN(v) || v<0) v=0;
        v = Math.max(0, Math.min(500, v));
        this.value = v;
        var thresholds = getZoneFreeThresholds();
        thresholds[zoneId] = v;
        saveZoneFreeThresholds(thresholds);
        renderShipZones();
        flashSaved();
      });
    });
    tbody.querySelectorAll('.ship-del').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = this.getAttribute('data-id');
        var zones2 = getShipZones();
        if(Object.keys(zones2).length <= 1){ alert('ต้องเหลืออย่างน้อย 1 เขต'); return; }
        if(!confirm('ลบโซน "'+id+'" ('+(zones2[id].districts||[]).join(', ')+') ?')) return;
        delete zones2[id];
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
    var noMeatIds = getNoMeat();
    var filtered = getFilteredMenus();
    // group by category
    var cats = {};
    filtered.forEach(function(m){
      if(!cats[m.category]) cats[m.category]=[];
      cats[m.category].push(m);
    });
    var order = ['ข้าวราดแกง','ข้าวผัด','เส้น','อาหารอินเดีย','พรีเมียม'];
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
          + '<td style="text-align:center"><input type="text" class="img-input" data-id="'+m.id+'" value="'+m.image.replace(/"/g,'&quot;')+'" placeholder="img/logo.jpg" style="width:160px;height:34px;border:1px solid var(--border);border-radius:10px;padding:0 .55rem;font-size:.78rem;font-weight:600;color:var(--text);background:var(--bg)"></td>'
          + '<td style="text-align:center"><input type="text" class="name-input" data-id="'+m.id+'" value="'+m.name.replace(/"/g,'&quot;')+'" placeholder="ชื่อเมนู" style="width:170px;height:34px;border:1px solid var(--border);border-radius:10px;padding:0 .55rem;font-size:.78rem;font-weight:700;color:var(--text);background:var(--bg)"></td>'
          + '<td style="text-align:center;font-size:.72rem;font-weight:700;color:'+tierColor+'">'+tierText+'</td>'
          + '<td style="text-align:center"><label title="เมนูนี้ไม่ต้องเลือกเนื้อ (เช่น ข้าวหมก/เซ็ตตายตัว)" style="display:inline-flex;align-items:center;gap:.3rem;cursor:pointer"><input type="checkbox" class="nomeat-input" data-id="'+m.id+'"'+(noMeatIds.indexOf(m.id)!==-1?' checked':'')+' style="width:18px;height:18px;cursor:pointer"><span style="font-size:.66rem;color:var(--text-muted)">ไม่เลือกเนื้อ</span></label></td>'
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
    tbody.querySelectorAll('.nomeat-input').forEach(function(inp){
      inp.addEventListener('change', function(){
        toggleNoMeat(parseInt(this.getAttribute('data-id'),10));
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
    var del = getDeleted();
    newMenus.forEach(function(nm){
      if(del.indexOf(nm.id)!==-1) return;
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
    loadSnackPrices();
    loadSnackNames();
    loadSnackCats();

    var catChips = document.querySelectorAll('[data-pcat]');
    var searchInput = $('priceSearch');

    renderTable();
    updateStats();
    renderMeats();
    renderGlobalToppings();
    renderShipZones();
    renderSnackTable();

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
      localStorage.removeItem(LS_SNACK_PRICES);
      localStorage.removeItem(LS_SNACK_NAMES);
      localStorage.removeItem(LS_SNACK_ADDONS);
      localStorage.removeItem(LS_SNACK_CATEGORIES);
      localStorage.removeItem(LS_SHIP_ZONE_FREE);
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
        noMeatMenus: getNoMeat(),
        shipZones: getShipZones(),
        shipCarMinQty: (typeof EED !== 'undefined' && EED.shippingCarMinQty) ? EED.shippingCarMinQty : 40,
        shipFree: getFreeThreshold(),
        shipZoneFreeThresholds: getZoneFreeThresholds(),
        snackPrices: (function(){ var o={}; if(typeof EED_SNACK_MENUS!=='undefined') EED_SNACK_MENUS.forEach(function(m){ o[m.id]=m.price; }); return o; })(),
        snackNames: (function(){ var o={}; if(typeof EED_SNACK_MENUS!=='undefined') EED_SNACK_MENUS.forEach(function(m){ o[m.id]=m.name; }); return o; })(),
        snackCats: (function(){ var o={}; if(typeof EED_SNACK_MENUS!=='undefined') EED_SNACK_MENUS.forEach(function(m){ o[m.id]=m.category; }); return o; })(),
        snackAddons: getSnackAddons(),
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
        var noMeatList = getNoMeat();
        var noMeatStr = noMeatList.indexOf(m.id)!==-1 ? ', noMeat: true' : '';
        var imgSafe = String(m.image||'').replace(/\\/g,'/');
        var line = '  { id: '+m.id+', name: '+JSON.stringify(m.name)+', price: '+m.price+', category: '+JSON.stringify(m.category)+', image: '+JSON.stringify(imgSafe)+', desc: '+JSON.stringify(m.desc||'')+', badge: '+JSON.stringify(m.badge||'')+', minPerMenu: '+m.minPerMenu+topStr+noMeatStr+' }';
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
      var url = window.location.href.split('?')[0];
      navigator.clipboard.writeText(url).then(function(){
        copyLink.textContent='คัดลอกลิงก์แล้ว ✓';
        setTimeout(function(){ copyLink.textContent='คัดลอกลิงก์เครื่องมือ'; },1500);
      });
    });

    // ship zones add / free threshold / reset / save
    var addShipBtn = $('addShipZone');
    if(addShipBtn) addShipBtn.addEventListener('click', function(){
      var zones = getShipZones();
      var label = prompt('ชื่อเขตพื้นที่ใหม่ เช่น บางนา (ใช้แทน id, คั่นด้วย , หลายเขต)');
      if(label===null) return;
      label = (label||'').trim() || 'เขตใหม่';
      var motoStr = prompt('ค่าส่งมอเตอร์ไซด์ "'+label+'" (บาท ≤40 กล่อง)', '200');
      if(motoStr===null) return;
      var moto = parseInt(motoStr,10);
      if(isNaN(moto) || moto<0) moto=0;
      var carStr = prompt('ค่าส่งรถยนต์ "'+label+'" (บาท >40 กล่อง)', String(moto+60));
      if(carStr===null) return;
      var car = parseInt(carStr,10);
      if(isNaN(car) || car<0) car=moto;
      var id = slugify(label) || 'zone_'+Date.now();
      var base=id, n=1;
      while(zones[id]){ id = base+'_'+(n++); }
      zones[id] = { moto:moto, car:car, districts: label.split(',').map(function(s){ return s.trim(); }).filter(Boolean) };
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
      if(!confirm('รีเซ็ตโซนค่าส่งกลับเป็นค่าเริ่มต้น 5 โซน (ตาม business-data.js) ?')) return;
      localStorage.removeItem(LS_SHIP_ZONES_OVERRIDE);
      localStorage.removeItem(LS_SHIP_ZONES);
      localStorage.removeItem(LS_SHIP_FREE);
      localStorage.removeItem(LS_SHIP_ZONE_FREE);
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
