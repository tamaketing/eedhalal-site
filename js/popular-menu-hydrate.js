/* EED HALAL — popular-menu hydrate (SEO-safe)
 * Keeps static HTML for crawlers (Google/AI) — only enhances for humans with JS.
 * Reads EED_MENUS + planner-overrides.json + localStorage and re-renders:
 *  - #popularMenuGrid  (16 cards)
 *  - #fullMenuBody     (full categorized menu list)
 * If data is available. If JS fails or file missing, static HTML remains.
 */
(function(){
  'use strict';
  var GRID_ID = 'popularMenuGrid';
  var FULL_ID = 'fullMenuBody';
  var LS_SELLING = 'eed_selling_v1';
  var LS_MINS = 'eed_mins_v1';
  var LS_TOPPINGS = 'eed_toppings_v1';

  // Popular menu IDs in order — edit here to control what shows on popular-menu.html
  var POPULAR_IDS = [16,1,2,3,4,17,5,24,6,18,31,8,14,19,38,37];

  // Category config for full menu — order = display order
  var CATS_TH = [
    { key: 'ข้าวผัด',  emoji: '🍳', label: 'เมนูข้าวผัด' },
    { key: 'ข้าวราดแกง', emoji: '🍛', label: 'เมนูข้าวราดแกง' },
    { key: 'เส้น',     emoji: '🍝', label: 'เมนูเส้น' },
    { key: 'อาหารอินเดีย',  emoji: '🍛', label: 'เมนูอาหารอินเดีย' }
  ];
  var CATS_EN = [
    { key: 'ข้าวผัด',  emoji: '🍳', label: 'Fried Rice Dishes' },
    { key: 'ข้าวราดแกง', emoji: '🍛', label: 'Rice with Curry & Toppings' },
    { key: 'เส้น',     emoji: '🍝', label: 'Noodle Dishes' },
    { key: 'อาหารอินเดีย',  emoji: '🍛', label: 'Indian Dishes' }
  ];

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

  function applyOverrides(){
    try{
      var prices = JSON.parse(localStorage.getItem(LS_SELLING)||'null');
      var mins = JSON.parse(localStorage.getItem(LS_MINS)||'null');
      var tops = JSON.parse(localStorage.getItem(LS_TOPPINGS)||'null');
      if(prices && typeof prices==='object'){
        Object.keys(prices).forEach(function(id){
          var v = parseFloat(prices[id]);
          if(!isNaN(v)) for(var i=0;i<EED_MENUS.length;i++) if(String(EED_MENUS[i].id)===String(id)) EED_MENUS[i].price=v;
        });
      }
      if(mins && typeof mins==='object'){
        Object.keys(mins).forEach(function(id){
          var v = parseInt(mins[id],10);
          if(!isNaN(v)) for(var i=0;i<EED_MENUS.length;i++) if(String(EED_MENUS[i].id)===String(id)) EED_MENUS[i].minPerMenu=v;
        });
      }
      if(Array.isArray(tops)){
        EED_MENUS.forEach(function(m){
          m.toppings = tops.map(function(t){ return {name:String(t.name), price:parseInt(t.price,10)||0}; });
        });
      }
    }catch(e){}
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
        try{
          if(data.prices) Object.keys(data.prices).forEach(function(id){
            var v=parseFloat(data.prices[id]);
            if(!isNaN(v)) for(var k=0;k<EED_MENUS.length;k++) if(String(EED_MENUS[k].id)===String(id)) EED_MENUS[k].price=v;
          });
          if(data.mins) Object.keys(data.mins).forEach(function(id){
            var v=parseInt(data.mins[id],10);
            if(!isNaN(v)) for(var k=0;k<EED_MENUS.length;k++) if(String(EED_MENUS[k].id)===String(id)) EED_MENUS[k].minPerMenu=v;
          });
          if(Array.isArray(data.toppings)){
            EED_MENUS.forEach(function(m){
              m.toppings = data.toppings.map(function(t){ return {name:String(t.name), price:parseInt(t.price,10)||0}; });
            });
          }
        }catch(e){}
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
    var list = [];
    POPULAR_IDS.forEach(function(id){
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
      var html = menus.map(function(m){
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
        var items = EED_MENUS.filter(function(m){ return m.category===cat.key; });
        if(!items.length) return '';
        var dots = '<span class="menu-item-dots"></span>';
        var itemHtml = items.map(function(m){
          return '<div class="menu-item"><span class="menu-item-name">'+escapeHtml(cat.emoji)+' '+escapeHtml(m.name)+'</span>'+dots+'</div>';
        }).join('');
        return '<div style="margin-bottom:2.5rem">'
          + '<h4 style="font-size:1.15rem;font-weight:900;color:var(--primary);margin:0 0 1rem">'+escapeHtml(cat.emoji)+' '+escapeHtml(cat.label)+'</h4>'
          + '<div class="menu-item-list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:0.35rem 1.25rem">'
          + itemHtml
          + '</div></div>';
      }).join('');
      body.innerHTML = html;
      body.setAttribute('data-hydrated','true');
    }catch(e){
      console.warn('[popular-menu-hydrate] full menu failed, keeping static:', e);
    }
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
    }
    doRender();
    loadServerOverrides(function(){
      doRender();
      renderGrid();
      renderFullMenu();
    });
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
