/* EED HALAL — snack-box hydrate (SEO-safe)
 * Keeps static HTML for crawlers — only enhances for humans with JS.
 * Reads EED_SNACK_MENUS + planner overrides and re-renders:
 *  - #snackFullMenu   (full bakery menu by tier/category)
 *  - #snackAddOns     (drinks add-on section)
 *  - #snackBasePrice  (base price display)
 *  - #snackMinOrder   (min order display)
 */
(function(){
  'use strict';
  var LS_SNACK_PRICES = 'eed_snack_prices_v1';
  var LS_SNACK_NAMES  = 'eed_snack_names_v1';
  var LS_SNACK_ADDONS = 'eed_snack_addons_v1';
  var LS_SNACK_CATS   = 'eed_snack_cats_v1';

  function escapeHtml(s){
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function isEnPath(){
    return window.location.pathname.indexOf('/en/')===0 || window.location.pathname.indexOf('/en')!==-1;
  }

  /* ─── Apply localStorage overrides ─── */
  function applyOverrides(){
    if(typeof EED_SNACK_MENUS==='undefined') return;
    try{
      var prices = JSON.parse(localStorage.getItem(LS_SNACK_PRICES)||'null');
      var names = JSON.parse(localStorage.getItem(LS_SNACK_NAMES)||'null');
      var cats = JSON.parse(localStorage.getItem(LS_SNACK_CATS)||'null');
      if(prices && typeof prices==='object'){
        Object.keys(prices).forEach(function(id){
          var v = parseFloat(prices[id]);
          if(!isNaN(v)){
            for(var i=0;i<EED_SNACK_MENUS.length;i++){
              if(EED_SNACK_MENUS[i].id===id){ EED_SNACK_MENUS[i].price=v; break; }
            }
          }
        });
      }
      if(names && typeof names==='object'){
        Object.keys(names).forEach(function(id){
          var n = String(names[id]).trim();
          if(n){
            for(var i=0;i<EED_SNACK_MENUS.length;i++){
              if(EED_SNACK_MENUS[i].id===id){ EED_SNACK_MENUS[i].name=n; break; }
            }
          }
        });
      }
      if(cats && typeof cats==='object'){
        Object.keys(cats).forEach(function(id){
          var v = String(cats[id]||'').trim();
          if(v){
            for(var i=0;i<EED_SNACK_MENUS.length;i++){
              if(EED_SNACK_MENUS[i].id===id){ EED_SNACK_MENUS[i].category=v; break; }
            }
          }
        });
      }
    }catch(e){}
  }

  /* ─── Load server overrides from planner-overrides.json ─── */
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
          if(data.snackPrices && typeof data.snackPrices==='object'){
            Object.keys(data.snackPrices).forEach(function(id){
              var v=parseFloat(data.snackPrices[id]);
              if(!isNaN(v)){
                for(var k=0;k<EED_SNACK_MENUS.length;k++){
                  if(EED_SNACK_MENUS[k].id===id){ EED_SNACK_MENUS[k].price=v; break; }
                }
              }
            });
          }
          if(data.snackNames && typeof data.snackNames==='object'){
            Object.keys(data.snackNames).forEach(function(id){
              var n=String(data.snackNames[id]).trim();
              if(n){
                for(var k=0;k<EED_SNACK_MENUS.length;k++){
                  if(EED_SNACK_MENUS[k].id===id){ EED_SNACK_MENUS[k].name=n; break; }
                }
              }
            });
          }
          if(data.snackCats && typeof data.snackCats==='object'){
            Object.keys(data.snackCats).forEach(function(id){
              var v=String(data.snackCats[id]||'').trim();
              if(v){
                for(var k=0;k<EED_SNACK_MENUS.length;k++){
                  if(EED_SNACK_MENUS[k].id===id){ EED_SNACK_MENUS[k].category=v; break; }
                }
              }
            });
          }
          if(data.snackAddons && Array.isArray(data.snackAddons)){
            for(var a=0;a<data.snackAddons.length;a++){
              var override=data.snackAddons[a];
              for(var b=0;b<EED_SNACK_ADDONS.length;b++){
                if(EED_SNACK_ADDONS[b].id===override.id){
                  if(override.price!==undefined) EED_SNACK_ADDONS[b].price=parseInt(override.price,10)||0;
                  if(override.name) EED_SNACK_ADDONS[b].name=override.name;
                  break;
                }
              }
            }
          }
        }catch(e){}
        if(cb) cb();
      }).catch(next);
    }
    next();
  }

  /* ─── Render full snack menu by tier/category ─── */
  function renderFullMenu(){
    var container = document.getElementById('snackFullMenu');
    if(!container) return;
    if(typeof EED_SNACK_MENUS==='undefined') return;
    var cats = (typeof EED_SNACK_CATEGORIES!=='undefined') ? EED_SNACK_CATEGORIES : [];
    try{
      var html = '';
      for(var c=0;c<cats.length;c++){
        var cat = cats[c];
        var items = EED_SNACK_MENUS.filter(function(m){ return m.category===cat.id; });
        if(!items.length) continue;
        html += '<div style="margin-bottom:2.5rem">';
        html += '<h4 style="font-size:1.15rem;font-weight:900;color:var(--primary);margin:0 0 1rem">'+escapeHtml(cat.emoji)+' '+escapeHtml(cat.label)+'</h4>';
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.35rem 1rem">';
        for(var j=0;j<items.length;j++){
          var m = items[j];
          html += '<div class="menu-item"><span class="menu-item-name">'+escapeHtml(m.name)+'</span><span class="menu-item-dots"></span></div>';
        }
        html += '</div></div>';
      }
      container.innerHTML = html;
      container.setAttribute('data-hydrated','true');
    }catch(e){
      console.warn('[snack-hydrate] full menu failed, keeping static:', e);
    }
  }

  /* ─── Render add-on drinks ─── */
  function renderAddOns(){
    var container = document.getElementById('snackAddOns');
    if(!container) return;
    if(typeof EED_SNACK_ADDONS==='undefined') return;
    try{
      var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.75rem">';
      for(var i=0;i<EED_SNACK_ADDONS.length;i++){
        var a = EED_SNACK_ADDONS[i];
        var priceLabel = a.price===0 ? '<span style="color:#22C55E;font-weight:800">ฟรี</span>' : '<span style="color:var(--primary);font-weight:800">+'+a.price+' บาท</span>';
        html += '<div style="background:var(--white);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm);padding:1rem 1rem;text-align:center">';
        html += '<div style="font-size:1.5rem;line-height:1;margin-bottom:.4rem">'+escapeHtml(a.emoji)+'</div>';
        html += '<div style="font-size:.92rem;font-weight:800;color:var(--text);margin-bottom:.2rem">'+escapeHtml(a.name)+'</div>';
        html += '<div style="font-size:.85rem">'+priceLabel+'</div>';
        html += '</div>';
      }
      html += '</div>';
      container.innerHTML = html;
      container.setAttribute('data-hydrated','true');
    }catch(e){
      console.warn('[snack-hydrate] add-ons failed, keeping static:', e);
    }
  }

  /* ─── Update base price / min order displays ─── */
  function updatePriceDisplay(){
    var el = document.getElementById('snackBasePrice');
    if(el) el.textContent = EED_SNACK_BASE_PRICE;
    var el2 = document.getElementById('snackMinOrder');
    if(el2) el2.textContent = EED_SNACK_MIN_ORDER;
  }

  /* ─── Init ─── */
  function init(){
    if(typeof EED_SNACK_MENUS==='undefined') return;
    applyOverrides();
    var rendered = false;
    function doRender(){
      if(rendered) return;
      rendered = true;
      updatePriceDisplay();
      renderFullMenu();
      renderAddOns();
    }
    doRender();
    loadServerOverrides(function(){
      doRender();
    });
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
