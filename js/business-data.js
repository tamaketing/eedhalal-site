/* =====================================================================
   EED HALAL — Generated compatibility data
   ---------------------------------------------------------------------
   ห้ามแก้กฎธุรกิจที่ไฟล์นี้: แก้ data/business-rules.json แล้วรัน
   node scripts/check-system.mjs --write เพื่อสร้างไฟล์นี้ใหม่
   ใช้คู่กับ attribute data-eed="key" ใน HTML เช่น:
     <span data-eed="startingPrice">60</span> บาท/กล่อง
   ค่าที่เขียนใน HTML คือค่า fallback (ตอน JavaScript ไม่ทำงาน)
   ===================================================================== */
var EED = {
  /* ── ข้อมูลธุรกิจ ── */
  businessName: 'EED HALAL',
  phoneDisplay: '098-871-5179',
  phoneHref: 'tel:+66988715179',
  lineId: '@EEDHALAL',
  lineUrl: 'https://lin.ee/CfvqJTd',
  halalCertificate: 'HL-2024-0892',
  operatingHoursTh: 'จันทร์-เสาร์',
  operatingHoursEn: 'Monday–Saturday',

  /* ── ราคา ── */
  startingPrice: '60',          /* บาท/กล่อง เมนูมาตรฐานเริ่มต้น */
  premiumPriceFrom: '180',      /* บาท/กล่อง เมนูพรีเมียมเริ่มต้น */
  premiumPriceTo: '250',        /* บาท/กล่อง เมนูพรีเมียมสูงสุด */

  /* ── ขั้นต่ำและเงื่อนไข ── */
  minOrder: '20',               /* ขั้นต่ำออเดอร์องค์กร (กล่อง) */
  snackMinOrder: '30',          /* ขั้นต่ำ Snack Box (กล่อง) */
  thaiMinPerMenu: '5',          /* ขั้นต่ำต่อเมนูอาหารไทย (กล่อง) */
  indianMinPerMenu: '10',       /* ขั้นต่ำต่อเมนูอาหารอินเดีย (กล่อง) */
  freeDeliveryFrom: '50',       /* ส่งฟรีตั้งแต่กี่กล่องขึ้นไป (fallback ถ้าไม่มี per-zone) */
/* ── ส่งฟรีตามเขต (Tiered Free Delivery — ตรงกับ FACTS.md ข้อ 3) ── */
  /*    แต่ละเขตกำหนดจำนวนกล่องขั้นต่ำที่จะส่งฟรีต่างกัน */
  /*    ถ้าเขตไหนไม่มีใน map จะใช้ freeDeliveryFrom เป็นค่า fallback */
  /*    ปริมณฑลไม่มีส่งฟรี (zone_5 = 0 คือต้องสอบถามก่อน ห้ามอ้างว่าฟรี) */
  /*    key zone_1..5 ห้ามเปลี่ยนชื่อ (calculator/planner/kitchen + localStorage ผูกอยู่) */
  shippingZoneFreeThresholds: {
    zone_1: 50,
    zone_2: 75,
    zone_3: 75,
    zone_4: 100,
    zone_5: 0
  },
  onTimeRate: '98',             /* % ส่งตรงเวลา */
  menuCount: '30',              /* มีมากกว่า 30 เมนู */

  /* ── ค่าส่ง (ใช้ใน budget-calculator) ── */
  /*    ตัวเลข moto/car สร้างจาก data/business-rules.json */
  /*    แก้ data/business-rules.json ก่อน แล้วสร้างข้อมูลและซิงก์ FACTS.md */
  /*    ซิงก์หน้าเว็บและฐานความรู้ AI จากข้อมูลหลักทุกครั้ง */
  shippingAutoNote: 'ส่งฟรีตามเขต 50–100+ กล่อง น้อยกว่านั้นคิดตามเขต',
  shippingCarMinQty: 40,  /* จำนวนกล่องที่เปลี่ยนจากรถมอเตอร์ไซค์เป็นรถยนต์ */
  shippingZones: {
    zone_1: {"label":"กรุงเทพชั้นใน","moto":60,"car":120,"freeFrom":50,"districts":["ยานนาวา","บางคอแหลม","สาทร","คลองสาน","ธนบุรี"]},
    zone_2: {"label":"สุขุมวิท-ปทุมวัน","moto":110,"car":180,"freeFrom":75,"districts":["บางรัก","ปทุมวัน","วัฒนา","คลองเตย","พระโขนง","ดินแดง","พญาไท","ราชเทวี","ป้อมปราบศัตรูพ่าย","สัมพันธวงศ์"]},
    zone_3: {"label":"ลาดพร้าว-ห้วยขวาง","moto":189,"car":230,"freeFrom":75,"districts":["พระนคร","ดุสิต","ห้วยขวาง","วังทองหลาง","บางกะปิ","สวนหลวง","ประเวศ","บางนา","จตุจักร","บางซื่อ","บางกอกใหญ่","บางกอกน้อย","ราษฎร์บูรณะ","จอมทอง"]},
    zone_4: {"label":"กรุงเทพรอบนอก","moto":240,"car":320,"freeFrom":100,"districts":["ลาดพร้าว","บึงกุ่ม","สะพานสูง","คันนายาว","ดอนเมือง","หลักสี่","บางเขน","สายไหม","บางพลัด","ภาษีเจริญ","ตลิ่งชัน","ทุ่งครุ"]},
    zone_5: {"label":"ปริมณฑล/ไกล (สอบถามก่อน)","moto":500,"car":500,"freeFrom":0,"districts":["มีนบุรี","หนองจอก","ลาดกระบัง","คลองสามวา","ทวีวัฒนา","บางแค","หนองแขม","บางบอน","บางขุนเทียน"]}
  },

  /* ── ข้อความมาตรฐาน (ใช้คำเดียวกับแบบนี้ทุกหน้า) ── */
  quoteTimeTh: 'ภายใน 15 นาทีหลังทัก LINE',
  quoteTimeEn: 'within 15 minutes after messaging us on LINE',
  deliveryAreaTh: 'ทั่วกรุงเทพฯ',
  deliveryAreaEn: 'Bangkok',
  confirmDeadlineTh: '15:00 น. ของวันทำการก่อนส่ง',
  leadSmallTh: 'อย่างน้อย 1 วัน',      /* 10–50 กล่อง */
  leadMediumTh: 'อย่างน้อย 1 วัน',     /* 51–100 กล่อง */
  leadLargeTh: 'อย่างน้อย 1 วัน',        /* 101+ กล่อง */
  vatTh: 'ราคาสุทธิ ไม่มีภาษีมูลค่าเพิ่ม (ยังไม่ได้จดทะเบียน VAT จึงไม่สามารถออกใบกำกับภาษีได้ ออกได้เพียงใบเสร็จรับเงินทั่วไป)',
  vatEn: 'Net price, no VAT charged (we are not VAT-registered and cannot issue tax invoices; only regular receipts available)',
  docTh: 'ออกใบเสนอราคา (Quotation) และใบเสร็จรับเงินแบบธรรมดา',
  docEn: 'We issue Quotations and regular Receipts (not VAT tax invoices)',

  /* ── อัปเดตค่าลง HTML ทุกจุดที่ใช้ data-eed ── */
  apply: function () {
    var els = document.querySelectorAll('[data-eed]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var key = el.getAttribute('data-eed');
      if (key && EED.hasOwnProperty(key) && EED[key] !== undefined && EED[key] !== null && EED[key] !== '') {
        el.textContent = EED[key];
      }
    }
    var metas = document.querySelectorAll('meta[data-eed]');
    for (var j = 0; j < metas.length; j++) {
      var m = metas[j];
      var k = m.getAttribute('data-eed');
      if (k && EED.hasOwnProperty(k)) {
        m.setAttribute('content', EED[k]);
      }
    }
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { EED.apply(); });
} else {
  EED.apply();
}
