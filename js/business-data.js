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
  halalCertificate: '926/2568',
  operatingHoursTh: 'จันทร์-เสาร์',
  operatingHoursEn: 'Monday–Saturday',

  /* ── ราคา ── */
  startingPrice: '65',          /* บาท/กล่อง เมนูมาตรฐานเริ่มต้น */
  premiumPriceFrom: '180',      /* บาท/กล่อง เมนูพรีเมียมเริ่มต้น */
  premiumPriceTo: '250',        /* บาท/กล่อง เมนูพรีเมียมสูงสุด */

  /* ── ขั้นต่ำและเงื่อนไข ── */
  minOrder: '10',               /* ขั้นต่ำออเดอร์องค์กร (กล่อง) */
  snackMinOrder: '30',          /* ขั้นต่ำ Snack Box (กล่อง) */
  thaiMinPerMenu: '10',          /* ขั้นต่ำต่อเมนูอาหารไทย (กล่อง) */
  indianMinPerMenu: '10',       /* ขั้นต่ำต่อเมนูอาหารอินเดีย (กล่อง) */
  onTimeRate: '98',             /* % ส่งตรงเวลา */
  menuCount: '30',              /* มีมากกว่า 30 เมนู */

  /* ── ค่าจัดส่ง (นโยบายถามแอดมิน — ไม่มีเรท/โซน/ยอดส่งฟรี) ── */
  /*    ข้อความมาจาก data/business-rules.json → delivery.messageTh/messageEn */
  /*    ห้ามใส่ตัวเลขค่าส่ง 0 บาท หรือคำว่าส่งฟรีแทนค่าที่ยังไม่ทราบ */
  shippingPolicyTh: 'กรุณาสอบถามค่าจัดส่งกับแอดมิน โดยแจ้งสถานที่จัดส่งและจำนวนที่ต้องการ',
  shippingPolicyEn: 'Please contact our team for a delivery quote with your delivery location and order quantity.',
  shippingPendingTh: 'รอแอดมินยืนยัน',

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
