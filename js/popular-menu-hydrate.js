/* EED HALAL — popular-menu hydrate (SEO-safe)
 * Keeps static HTML for crawlers (Google/AI) — only enhances for humans with JS.
 * Reads EED_MENUS + planner-overrides.json + localStorage and re-renders:
 *  - #popularMenuGrid  (16 cards)
 *  - #fullMenuBody     (full menu list, grouped by product level)
 * If data is available. If JS fails or file missing, static HTML remains.
 */
(function(){
  'use strict';
  var GRID_ID = 'popularMenuGrid';
  var FULL_ID = 'fullMenuBody';
  var LS_SELLING = 'eed_selling_v1';
  var LS_MINS = 'eed_mins_v1';
  var LS_IMAGES = 'eed_images_v1';
  var LS_NAMES = 'eed_names_v1';
  var LS_TIERS = 'eed_tiers_v1';
  var LS_DELETED = 'eed_deleted_v1';
  var LS_NEW_MENUS = 'eed_new_menus_v1';
  var LS_TOPPINGS = 'eed_toppings_v1';
  // Set from the published planner so the list follows the owner's edits; falls
  // back to EED_DEFAULT_TOPPINGS (js/menu-data.js) when the fetch fails.
  var PUBLISHED_TOPPINGS = null;

  // Popular menu IDs in order — edit here to control what shows on popular-menu.html.
  // The menu publish pipeline may override this via data/planner-overrides.json
  // `popular` (central draft `popular`); the file below stays as the fallback.
  var POPULAR_IDS = [16,1,2,3,4,17,5,24,6,18,31,8,14,19,38,37];
  var PUBLISHED_POPULAR = null;
  var PUBLISHED_SORT = null;

// Full-menu sections are grouped by product LEVEL (data/business-rules.json ->
// services.mealBox.tiers), which is the only grouping a menu has. Order here
// is the display order and matches the level chips and the tier table.
var FALLBACK_TH = [
    { key: 'classic',   emoji: '🍚', label: 'Classic — ข้าวกล่องคุมงบ' },
    { key: 'signature', emoji: '✨', label: 'Signature — สองอย่างในกล่องเดียว' },
    { key: 'executive', emoji: '👑', label: 'Executive — พรีเมียมพร้อมเสิร์ฟ' }
  ];
  var FALLBACK_EN = [
    { key: 'classic',   emoji: '🍚', label: 'Classic — budget-friendly rice boxes' },
    { key: 'signature', emoji: '✨', label: 'Signature — two dishes in one box' },
    { key: 'executive', emoji: '👑', label: 'Executive — premium, plated to serve' }
  ];
var DEFAULT_EMOJI = '🍽';

  // The level list is a closed set from business-rules.json, so the fallbacks
  // above ARE it. The one safety net kept here: a menu carrying a level the
  // rules do not declare still gets a section, so no dish can disappear from
  // the page.
  function mergeCats(declared, fallback) {
    var out = [];
    var seen = {};
    fallback.forEach(function (item) {
      seen[item.key] = true;
      out.push(item);
    });
    if (typeof EED_MENUS !== 'undefined' && Array.isArray(EED_MENUS)) {
      EED_MENUS.forEach(function (menu) {
        var key = menu && menu.tier ? String(menu.tier) : 'classic';
        if (!key || seen[key]) return;
        seen[key] = true;
        out.push({ key: key, emoji: DEFAULT_EMOJI, label: key });
      });
    }
    return out;
  }
  var CATS_TH = mergeCats(null, FALLBACK_TH);
  var CATS_EN = mergeCats(null, FALLBACK_EN);

  function escapeHtml(s){
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function isEnPath(){
    return window.location.pathname.indexOf('/en/')===0 || window.location.pathname.indexOf('/en')!==-1;
  }
  function fixImagePath(src){
    if(!src) return src;
    if(isEnPath() && src.indexOf('img/')===0) return '../' + src;
    return src;
  }

  function applyCatalog(data){
    if(!data || typeof data!=='object' || typeof EED_MENUS==='undefined') return;
    var fields={prices:'price',mins:'minPerMenu',images:'image',names:'name',tiers:'tier'};
    Object.keys(fields).forEach(function(key){
      var values=data[key];
      if(!values || typeof values!=='object') return;
      Object.keys(values).forEach(function(id){
        for(var i=0;i<EED_MENUS.length;i++){
          if(String(EED_MENUS[i].id)!==String(id)) continue;
          var value=values[id];
          if(key==='prices') value=parseFloat(value);
          if(key==='mins') value=parseInt(value,10);
          if(value!==undefined && value!==null && value!=='') EED_MENUS[i][fields[key]]=value;
          break;
        }
      });
    });
    if(Array.isArray(data.toppings)){
      PUBLISHED_TOPPINGS = data.toppings.map(function(t){ return {name:String(t && t.name || '').trim(),price:Number(t && t.price)}; }).filter(function(t){ return t.name; });
      EED_MENUS.forEach(function(menu){ menu.toppings=data.toppings.map(function(t){ return {name:String(t.name),price:parseInt(t.price,10)||0}; }); });
    }
    if(Array.isArray(data.deleted)) EED_MENUS=EED_MENUS.filter(function(menu){ return data.deleted.indexOf(menu.id)===-1 && data.deleted.indexOf(String(menu.id))===-1; });
    if(Array.isArray(data.popular) && data.popular.length) PUBLISHED_POPULAR = data.popular.map(String);
    if(data.sortOrder && typeof data.sortOrder==='object'){
      PUBLISHED_SORT = {};
      Object.keys(data.sortOrder).forEach(function(id){ PUBLISHED_SORT[String(id)] = data.sortOrder[id]; });
      EED_MENUS.forEach(function(menu){
        if(PUBLISHED_SORT[String(menu.id)]!==undefined) menu.sortOrder = PUBLISHED_SORT[String(menu.id)];
      });
    }
    if(Array.isArray(data.newMenus)) data.newMenus.forEach(function(menu){
      if(!menu || menu.id===undefined || !menu.name || EED_MENUS.some(function(item){ return String(item.id)===String(menu.id); })) return;
      EED_MENUS.push({id:menu.id,name:String(menu.name),price:parseFloat(menu.price)||0,tier:String(menu.tier||'classic'),image:String(menu.image||''),desc:String(menu.desc||''),badge:String(menu.badge||''),minPerMenu:parseInt(menu.minPerMenu,10)||5,toppings:Array.isArray(data.toppings)?data.toppings.map(function(t){ return {name:String(t.name),price:parseInt(t.price,10)||0}; }):[]});
    });
  }

  function applyOverrides(){
    try{ applyCatalog({prices:JSON.parse(localStorage.getItem(LS_SELLING)||'null'),mins:JSON.parse(localStorage.getItem(LS_MINS)||'null'),images:JSON.parse(localStorage.getItem(LS_IMAGES)||'null'),names:JSON.parse(localStorage.getItem(LS_NAMES)||'null'),tiers:JSON.parse(localStorage.getItem(LS_TIERS)||'null'),deleted:JSON.parse(localStorage.getItem(LS_DELETED)||'null'),newMenus:JSON.parse(localStorage.getItem(LS_NEW_MENUS)||'null'),toppings:JSON.parse(localStorage.getItem(LS_TOPPINGS)||'null')}); }catch(e){}
  }

  function loadServerOverrides(cb){
    if(location.protocol==='file:'){ if(cb) cb(); return; }
    var urls=['/data/planner-overrides.json','data/planner-overrides.json','./data/planner-overrides.json','../data/planner-overrides.json'];
    var i=0;
    function next(){
      if(i>=urls.length){ if(cb) cb(); return; }
      fetch(urls[i++]+'?t='+Date.now(),{cache:'no-store'}).then(function(r){
        if(!r.ok) throw new Error('not ok');
        return r.json();
      }).then(function(data){
        try{ applyCatalog(data); }catch(e){}
        if(cb) cb();
      }).catch(next);
    }
    next();
  }

  /* ─── Popular Grid ─── */
  function getPopularMenus(){
    if(typeof EED_MENUS==='undefined' || !Array.isArray(EED_MENUS) || !EED_MENUS.length) return [];
    var hasPopularFlag = EED_MENUS.some(function(m){ return m.popular === true; });
    if(hasPopularFlag){
      var flagged = EED_MENUS.filter(function(m){ return m.popular === true; });
      flagged.sort(function(a,b){
        if(a.popularRank!==undefined && b.popularRank!==undefined) return a.popularRank - b.popularRank;
        if(a.popularRank!==undefined) return -1;
        if(b.popularRank!==undefined) return 1;
        var aScore = (a.badge && a.badge.indexOf('Best')!==-1 ? 0 : a.badge==='ใหม่' ? 1 : 2);
        var bScore = (b.badge && b.badge.indexOf('Best')!==-1 ? 0 : b.badge==='ใหม่' ? 1 : 2);
        if(aScore!==bScore) return aScore-bScore;
        return a.price - b.price;
      });
      return flagged.slice(0,16);
    }
    var byId = {};
    EED_MENUS.forEach(function(m){ byId[String(m.id)] = m; });
    var order = (PUBLISHED_POPULAR && PUBLISHED_POPULAR.length) ? PUBLISHED_POPULAR : POPULAR_IDS.map(String);
    var list = [];
    order.forEach(function(id){
      if(byId[String(id)]) list.push(byId[String(id)]);
    });
    if(list.length < 12){
      var remaining = EED_MENUS.filter(function(m){ return list.indexOf(m)===-1; })
        .sort(function(a,b){
          var aScore = (a.badge && a.badge.indexOf('Best')!==-1 ? 0 : a.badge==='ใหม่' ? 1 : 2);
          var bScore = (b.badge && b.badge.indexOf('Best')!==-1 ? 0 : b.badge==='ใหม่' ? 1 : 2);
          if(aScore!==bScore) return aScore-bScore;
          return a.price - b.price;
        });
      list = list.concat(remaining.slice(0, 16 - list.length));
    }
    return list.slice(0, 16);
  }

  function renderGrid(){
    var grid = document.getElementById(GRID_ID);
    if(!grid) return;
    if(typeof EED_MENUS==='undefined') return;
    var menus = getPopularMenus();
    if(!menus.length) return;
    try{
      var photoMenus = menus.filter(function(m){ return m.image && !/logo\.(png|jpg|jpeg|webp)$/i.test(m.image); });
      var nameOnlyMenus = menus.filter(function(m){ return !m.image; });
      var html = photoMenus.map(function(m){
        var badge = m.badge ? '<span style="background:var(--accent);color:var(--white);font-size:0.65rem;font-weight:700;padding:0.2rem 0.55rem;border-radius:999px;vertical-align:middle">'+escapeHtml(m.badge)+'</span>' : '';
        return '<div style="background:var(--white);border-radius:var(--radius-xl);box-shadow:var(--shadow-sm);overflow:hidden;display:flex;flex-direction:column">'
          + '<div style="aspect-ratio:4/3;overflow:hidden">'
          + '<img src="'+escapeHtml(fixImagePath(m.image))+'" alt="'+escapeHtml(m.name)+' EED HALAL" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy" onerror="this.style.display=\'none\'">'
          + '</div>'
          + '<div style="padding:1.25rem 1.25rem 1.5rem;display:flex;flex-direction:column;gap:0.4rem;flex:1">'
          + '<h4 style="font-size:1.25rem;font-weight:900;color:var(--text);margin:0">'+escapeHtml(m.name)+' '+badge+'</h4>'
          + '<p style="font-size:0.8rem;line-height:1.7;opacity:0.7;color:var(--text);margin:0">'+escapeHtml(m.desc||'')+'</p>'
          + '</div>'
          + '</div>';
      }).join('');
      if (nameOnlyMenus.length) {
        html += nameOnlyMenus.map(function(m){
          return '<div class="pm-name-only"><span class="pm-name-only-text">'+escapeHtml(m.name)+'</span></div>';
        }).join('');
      }
      grid.innerHTML = html;
      grid.setAttribute('data-hydrated','true');
      try{ document.dispatchEvent(new CustomEvent('popularMenuHydrated', {detail:{count:menus.length}})); }catch(e){}
    }catch(e){
      console.warn('[popular-menu-hydrate] grid failed, keeping static:', e);
    }
  }

  /* ─── Full Menu ─── */
  function renderFullMenu(){
    var body = document.getElementById(FULL_ID);
    if(!body) return;
    if(typeof EED_MENUS==='undefined') return;
    var cats = isEnPath() ? CATS_EN : CATS_TH;
    try{
      var html = cats.map(function(cat){
        var items = EED_MENUS.filter(function(m){ return (m.tier || 'classic')===cat.key; });
        if(PUBLISHED_SORT){
          items = items.slice().sort(function(a,b){
            var oa = PUBLISHED_SORT[String(a.id)], ob = PUBLISHED_SORT[String(b.id)];
            if(oa===undefined) oa = 1e9; if(ob===undefined) ob = 1e9;
            return oa - ob;
          });
        }
        if(!items.length) return '';
        var dots = '<span class="menu-item-dots"></span>';
        var itemsWithImage = items.filter(function(m){ return m.image; });
        var itemsNameOnly = items.filter(function(m){ return !m.image; });
        var itemHtml = itemsWithImage.map(function(m){
          return '<div class="menu-item"><span class="menu-item-name">'+escapeHtml(cat.emoji)+' '+escapeHtml(m.name)+'</span>'+dots+'</div>';
        }).join('');
        var nameOnlyHtml = itemsNameOnly.map(function(m){
          return '<div class="menu-item pm-name-only"><span class="pm-name-only-text">'+escapeHtml(m.name)+'</span></div>';
        }).join('');
        return '<div style="margin-bottom:2.5rem">'
          + '<h4 style="font-size:1.15rem;font-weight:900;color:var(--primary);margin:0 0 1rem">'+escapeHtml(cat.emoji)+' '+escapeHtml(cat.label)+'</h4>'
          + '<div class="menu-item-list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:0.35rem 1.25rem">'
          + itemHtml + (itemHtml && nameOnlyHtml ? '' : '') + nameOnlyHtml
          + '</div></div>';
      }).join('');
      body.innerHTML = html;
      body.setAttribute('data-hydrated','true');
    }catch(e){
      console.warn('[popular-menu-hydrate] full menu failed, keeping static:', e);
    }
  }

  function renderToppingsHydrate(){
  var toppingsList = document.getElementById('pm-toppings-list');
  if(!toppingsList) return;
  var source = Array.isArray(PUBLISHED_TOPPINGS) && PUBLISHED_TOPPINGS.length
    ? PUBLISHED_TOPPINGS
    : (typeof EED_DEFAULT_TOPPINGS !== 'undefined' ? EED_DEFAULT_TOPPINGS : []);
  var en = isEnPath();
  toppingsList.innerHTML = source.map(function(t){
    var name = escapeHtml(String(t && t.name || '').trim());
    if(!name) return '';
    var price = Number(t && t.price);
    var has = isFinite(price) && price > 0;
    return '<li class="pm-topping"' + (has ? ' data-price="'+price+'"' : '') + '>'
      + '<span class="pm-topping-name">'+name+'</span>'
      + '<span class="pm-topping-price' + (has ? '' : ' pm-topping-price-none') + '">'
      + (has ? (en ? '+'+price+' THB' : '+'+price+' บาท') : (en ? 'Ask us' : 'สอบถามราคา'))
      + '</span></li>';
  }).join('');
}

function init(){
  if(typeof EED_MENUS==='undefined') return;
  applyOverrides();
  var rendered = false;
  function doRender(){
    if(rendered) return;
    rendered = true;
    renderGrid();
    renderFullMenu();
    renderToppingsHydrate();
  }
  doRender();
  loadServerOverrides(function(){
    doRender();
    renderGrid();
    renderFullMenu();
    renderToppingsHydrate();
  });
}

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
