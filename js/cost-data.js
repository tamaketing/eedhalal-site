/* EED HALAL — Cost data (OWNER ONLY) ห้ามโหลดในหน้าลูกค้า */
var EED_MARGIN_DEFAULT = 20; // %
var EED_COSTS = {
  // ทุน = 80% ของราคาขาย → กำไร 20% ของงบเหลือ (ขาย)
  1: 48,  2: 48,  3: 48,  4: 48,  5: 48,
  6: 48,  8: 48,  9: 48, 10: 48,
  11: 48, 12: 48, 13: 48, 14: 48, 15: 48,
  16: 72, 17: 72, 18: 72, 19: 72, 20: 72,
  21: 72, 22: 72, 23: 68,
  24: 96, 25: 96, 26: 96, 27: 120, 28: 120,
  29: 60, 30: 60,
  31: 48, 32: 48, 33: 48, 34: 48, 35: 48, 36: 48, 38: 48
};
var EED_SELLING = {}; // owner overrides: id -> selling price
// Patch EED_MENUS with cost & selling if loaded
(function(){
  if(typeof EED_MENUS === 'undefined') return;
  for(var i=0;i<EED_MENUS.length;i++){
    var m = EED_MENUS[i];
    if(EED_COSTS[m.id] !== undefined){
      m.cost = EED_COSTS[m.id];
    } else {
      m.cost = Math.round(m.price * 0.8);
    }
    if(EED_SELLING[m.id] !== undefined){
      m.price = EED_SELLING[m.id];
    }
    // keep original price for reset
    if(m._origPrice === undefined) m._origPrice = m.price;
  }
})();

function calcSellingPrice(cost, marginPct){
  if(typeof marginPct !== 'number') marginPct = EED_MARGIN_DEFAULT;
  // กำไร % ของราคาขาย → ขาย = ทุน / (1 - margin%)
  var raw = cost / (1 - marginPct/100);
  return Math.ceil(raw / 5) * 5;
}
function calcProfitPerBox(cost, selling){
  return selling - cost;
}
