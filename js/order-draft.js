(function(window){
  'use strict';

  var KEY = 'eed_order_draft_v2';
  var VERSION = 2;

  function read(){
    try{
      var value = JSON.parse(window.localStorage.getItem(KEY) || 'null');
      return value && value.schemaVersion === VERSION ? value : null;
    }catch(e){ return null; }
  }

  function readJSON(key){
    try{ return JSON.parse(window.localStorage.getItem(key) || 'null'); }catch(e){ return null; }
  }

  function reference(){
    var random = window.crypto && window.crypto.getRandomValues ? window.crypto.getRandomValues(new Uint32Array(1))[0].toString(36) : Math.random().toString(36).slice(2,8);
    return 'EED-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + random.slice(0,6).toUpperCase();
  }

  function number(value){
    value = Number(value);
    return isFinite(value) ? value : 0;
  }

  function save(input){
    var previous = read();
    var now = new Date().toISOString();
    var delivery = input.delivery || {};
    var shipping = input.shipping || {};
    var totals = input.totals || {};
    var items = Array.isArray(input.items) ? input.items : [];
    var draft = {
      schemaVersion: VERSION,
      reference: previous && previous.reference || reference(),
      status: 'draft',
      source: input.source || 'budget_calculator',
      createdAt: previous && previous.createdAt || now,
      updatedAt: now,
      delivery: {
        date: String(delivery.date || ''),
        time: String(delivery.time || ''),
        district: String(delivery.district || '')
      },
      shipping: {
        mode: String(shipping.mode || 'pending'),
        fee: number(shipping.fee),
        label: String(shipping.label || 'ค่าส่ง'),
        text: String(shipping.text || 'รอแอดมินยืนยัน'),
        requiresConfirmation: shipping.requiresConfirmation !== undefined ? !!shipping.requiresConfirmation : true
      },
      items: items.map(function(item){
        return {
          id: String(item.id || ''),
          name: String(item.name || ''),
          quantity: number(item.quantity),
          options: Array.isArray(item.options) ? item.options.map(String) : [],
          unitPrice: number(item.unitPrice),
          total: number(item.total)
        };
      }).filter(function(item){ return item.name && item.quantity > 0; }),
      totals: {
        requestedQuantity: number(totals.requestedQuantity),
        selectedQuantity: number(totals.selectedQuantity),
        food: number(totals.food),
        shipping: number(totals.shipping),
        grand: number(totals.grand)
      }
    };
    if(input.legacy && typeof input.legacy === 'object'){
      draft.legacy = {
        selected: input.legacy.selected || {},
        selectedToppings: input.legacy.selectedToppings || {},
        selectedMeats: input.legacy.selectedMeats || {}
      };
    }
    try{ window.localStorage.setItem(KEY, JSON.stringify(draft)); }catch(e){}
    return draft;
  }

  function migrateLegacy(){
    var legacy = readJSON('eed_budget_calc_v1');
    if(!legacy || typeof legacy !== 'object') return null;
    var shipping = readJSON('eed_budget_ship_v1') || {};
    var selected = legacy.selected && typeof legacy.selected === 'object' ? legacy.selected : {};
    var selectedQuantity = Object.keys(selected).reduce(function(total, id){ return total + number(selected[id]); }, 0);
    return save({
      source:'budget_calculator_legacy',
      delivery:{date:window.localStorage.getItem('eed_delivery_date_v1') || '',time:window.localStorage.getItem('eed_delivery_time_v1') || '',district:shipping.district || ''},
      shipping:{mode:shipping.mode || 'pending',fee:shipping.fee || 0,label:'ค่าจัดส่ง',text:'รอแอดมินยืนยัน',requiresConfirmation:true},
      totals:{requestedQuantity:legacy.quantity || 0,selectedQuantity:selectedQuantity,food:0,shipping:0,grand:0},
      legacy:{selected:selected,selectedToppings:legacy.selectedToppings || {},selectedMeats:legacy.selectedMeats || {}}
    });
  }

  window.EEDOrderDraft = { key: KEY, version: VERSION, get: function(){ return read() || migrateLegacy(); }, save: save };
})(window);
