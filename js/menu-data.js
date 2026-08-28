/* EED HALAL — Menu database for budget calculator
 * SOURCE OF TRUTH: the public calculator reads this file only.
 * Change price/minPerMenu/toppings here, then commit and deploy.
 */
var EED_MENUS = [
  // 60 บาท — มาตรฐาน
  { id: 1, name: "ข้าวกะเพราไก่", price: 60, category: "ข้าวราดแกง", image: "img/menu-kaprao-gai.png", desc: "ผัดกะเพราไฟแรง ไก่สับนุ่ม หอมใบกะเพรา", badge: "", minPerMenu: 5 },
  { id: 2, name: "ข้าวผัดกะเพราเนื้อ", price: 60, category: "ข้าวผัด", image: "img/menu-kaprao-nuea.png", desc: "ข้าวผัดกะเพราเนื้อหอมกระทะ เนื้อนุ่ม", badge: "", minPerMenu: 5 },
  { id: 3, name: "ผัดไทยกุ้งสด", price: 60, category: "เส้น", image: "img/ผัดไทยกุ้งสด.png", desc: "เส้นนุ่มรสกลมกล่อม กุ้งสดตัวโต", badge: "", minPerMenu: 5 },
  { id: 4, name: "ผัดซีอิ๊วเนื้อ", price: 60, category: "เส้น", image: "img/ผัดซีอิ้ว.png", desc: "เส้นใหญ่ผัดซีอิ๊วหอมกระทะ เนื้อหมักนุ่ม", badge: "", minPerMenu: 5 },
  { id: 5, name: "ข้าวผัดทะเล", price: 60, category: "ข้าวผัด", image: "img/ข้าวผัดทะเล.png", desc: "ข้าวผัดทะเลรวม กุ้ง ปลาหมึก ปู", badge: "", minPerMenu: 5 },
  { id: 6, name: "ข้าวไก่กะเทียม", price: 60, category: "ข้าวราดแกง", image: "img/ไก่กะเทียมไข่เจียว.png", desc: "ไก่ทอดกระเทียมกรอบหอม + ข้าวสวย", badge: "", minPerMenu: 5 },
  { id: 8, name: "ข้าวผัดเนื้อเค็ม", price: 60, category: "ข้าวผัด", image: "img/ข้าวผัดเนื้อเค็ม.png", desc: "เนื้อเค็มหั่นเต๋าผัดข้าวหอมกระเทียมเจียว", badge: "", minPerMenu: 5 },
  { id: 9, name: "ข้าวไก่ผัดขิง", price: 60, category: "ข้าวราดแกง", image: "img/ไก่กะเทียม.jpg", desc: "ไก่ผัดขิงหอมๆ รสกลมกล่อม", badge: "", minPerMenu: 5 },
  { id: 10, name: "ข้าวไก่ผัดพริกแกง", price: 60, category: "ข้าวราดแกง", image: "img/menu-kaprao-gai.png", desc: "ไก่ผัดพริกแกงเข้มข้น", badge: "", minPerMenu: 5 },
  { id: 11, name: "ข้าวผัดปลาเค็ม", price: 60, category: "ข้าวผัด", image: "img/ปลาทอดกะเทียม.jpg", desc: "ข้าวผัดปลาเค็มหอมๆ", badge: "", minPerMenu: 5 },
  { id: 12, name: "มาม่าผัดกะเพราไก่", price: 60, category: "เส้น", image: "img/ผัดซีอิ้ว.png", desc: "มาม่าผัดกะเพราไก่รสจัดจ้าน", badge: "", minPerMenu: 5 },
  { id: 13, name: "สปาเกตตีผัดกะเพราไก่", price: 60, category: "เส้น", image: "img/ผัดซีอิ้ว.png", desc: "สปาเกตตีผัดกะเพราไก่สไตล์ไทย", badge: "", minPerMenu: 5 },
  { id: 14, name: "ไก่เทอริยากิ", price: 60, category: "ข้าวราดแกง", image: "img/ไก่เทอริยากิ.png", desc: "ไก่ซอสเทอริยากิหอมหวาน", badge: "", minPerMenu: 5 },
  { id: 15, name: "ข้าวคลุกกะปิ", price: 60, category: "ข้าวผัด", image: "img/ข้าวผัดทะเล.png", desc: "ข้าวคลุกกะปิเครื่องครบ", badge: "", minPerMenu: 5 },

  // 90 บาท — พรีเมียมเริ่มต้น
  { id: 16, name: "ข้าวหมกไก่", price: 90, category: "ข้าวหมก", image: "img/menu-khao-mok.png", desc: "ข้าวหมกหอมเครื่องเทศ เสิร์ฟพร้อมไก่นุ่ม", badge: "⭐ Best Seller", minPerMenu: 5 },
  { id: 17, name: "คั่วกลิ้งไก่สับ", price: 90, category: "ข้าวราดแกง", image: "img/คั่วกลิ้งไก.png", desc: "ไก่สับผัดเครื่องคั่วกลิ้งหอมเครื่องเทศใต้", badge: "", minPerMenu: 5 },
  { id: 18, name: "ข้าวผัดปู", price: 90, category: "ข้าวผัด", image: "img/ข้าวผัดปู.png", desc: "เนื้อปูชิ้นเต็มคำผัดข้าวหอมกระทะ", badge: "", minPerMenu: 5 },
  { id: 19, name: "ข้าวราดกระพราทะเล", price: 90, category: "ข้าวราดแกง", image: "img/กระเพราทะเลไข่ดาว.png", desc: "ผัดกระเพราทะเลรวม กุ้ง หมึก หอย + ไข่ดาว", badge: "", minPerMenu: 5 },
  { id: 20, name: "ข้าวหมกน่องไก่", price: 90, category: "ข้าวหมก", image: "img/khao-mok-box-opt.jpg", desc: "ข้าวหมกน่องไก่ชิ้นใหญ่", badge: "", minPerMenu: 10 },
  { id: 37, name: "ข้าวหมกเนื้อน่อง", price: 90, category: "ข้าวหมก", image: "img/ข้าวหมกเนื้อ+ซาโมซา.png", desc: "ข้าวหมกหอมเครื่องเทศ เสิร์ฟพร้อมเนื้อน่องนุ่ม", badge: "ใหม่", minPerMenu: 10 },
  { id: 21, name: "ข้าวเนื้อผัดพริกไทยดำ", price: 90, category: "ข้าวราดแกง", image: "img/menu-kaprao-nuea.png", desc: "เนื้อผัดพริกไทยดำหอมๆ", badge: "", minPerMenu: 5 },
  { id: 22, name: "ข้าวกุ้งผัดซอสกระเทียม", price: 90, category: "ข้าวราดแกง", image: "img/ข้าวผัดทะเล.png", desc: "กุ้งผัดซอสกระเทียมเข้มข้น", badge: "", minPerMenu: 5 },

  // 120 บาท — พรีเมียม
  { id: 24, name: "ไก่ทอดเครื่อง + ข้าวเหลือง", price: 120, category: "ข้าวหมก", image: "img/ไก่ทอดเครื่อง.png", desc: "ไก่ทอดเครื่องหอมสมุนไพร + ข้าวเหลือง", badge: "พรีเมียม", minPerMenu: 10 },
  { id: 29, name: "ข้าวผัดกะเพราเนื้อ", price: 75, category: "ข้าวราดแกง", image: "img/กะเพราเนื้อ_ผลไม้.jpg", desc: "เพิ่มผลไม้สดตามฤดูกาล", badge: "+ ผลไม้", minPerMenu: 5 },
  { id: 30, name: "ข้าวผัดทะเล", price: 75, category: "ข้าวผัด", image: "img/ข้าวผัดทะเล_ผลไม้.jpg", desc: "ข้าวผัดทะเลเสิร์ฟพร้อมผลไม้", badge: "+ ผลไม้", minPerMenu: 5 },

  // เพิ่มใหม่ — 6 เมนูลูกค้าร้องขอ
  { id: 31, name: "ผัดเขียวหวานแห้งไก่", price: 60, category: "ข้าวราดแกง", image: "img/ผัดเขียวหวาน.png", desc: "ผัดเขียวหวานแห้งไก่ หอมเครื่องแกง เข้มข้น จัดจ้าน", badge: "ใหม่", minPerMenu: 5 },
  { id: 32, name: "กระเพราไก่สับ", price: 60, category: "ข้าวราดแกง", image: "img/menu-kaprao-gai.png", desc: "กระเพราไก่สับผัดไฟแรง หอมใบกะเพรา", badge: "ใหม่", minPerMenu: 5 },
  { id: 33, name: "ผัดเปรี้ยวหวานไก่", price: 60, category: "ข้าวราดแกง", image: "img/ไก่กะเทียม.jpg", desc: "ไก่ผัดเปรี้ยวหวาน ใส่สับปะรด มะเขือเทศ หอมหวานกลมกล่อม", badge: "ใหม่", minPerMenu: 5 },
  { id: 34, name: "ผัดผักรวมไก่", price: 60, category: "ข้าวราดแกง", image: "img/ไก่กะเทียม.jpg", desc: "ผัดผักรวมไก่ ผักสดหลากชนิด ผัดน้ำมันหอย", badge: "ใหม่", minPerMenu: 5 },
  { id: 35, name: "ผัดพริกแกงไก่ถั่วฝักยาว", price: 60, category: "ข้าวราดแกง", image: "img/คั่วกลิ้งไก.png", desc: "ผัดพริกแกงไก่ใส่ถั่วฝักยาว เผ็ดหอมเครื่องแกงใต้", badge: "ใหม่", minPerMenu: 5 },
  { id: 36, name: "ข้าวราดแกงโทโพปลาเค็ม", price: 60, category: "ข้าวราดแกง", image: "img/buffet-menu-kaeng-kati.jpg", desc: "แกงโทโพกะทิเข้มข้น ใส่ปลาเค็มและหมูสามชั้น", badge: "ใหม่", minPerMenu: 5 },
  { id: 38, name: "ผัดเขียวหวานแห้งเนื้อ", price: 60, category: "ข้าวราดแกง", image: "img/ผัดเขียวหวาน.png", desc: "ผัดเขียวหวานแห้งเนื้อ หอมเครื่องแกง เข้มข้น จัดจ้าน", badge: "ใหม่", minPerMenu: 5 },
  { id: 39, name: "ข้าวราดกะเพราเนื้อสับคั่ว", price: 60, category: "ข้าวราดแกง", image: "img/menu-kaprao-nuea.png", desc: "เนื้อสับคั่วแห้งหอมกระทะ เผ็ดจัดจ้าน สไตล์กะเพราคั่ว", badge: "ใหม่", minPerMenu: 5 }
];

// Standard meat options shown on the public calculator.
var EED_DEFAULT_MEATS = [
  { name: "ไก่", price: 0 },
  { name: "เนื้อ", price: 0 },
  { name: "ทะเล", price: 0 },
  { name: "หมู", price: 0 }
];

// Standard add-ons shown on the public calculator.
// Keep these values here so toppings are identical for every visitor after deploy.
var EED_DEFAULT_TOPPINGS = [
  { name: "ไข่ดาว", price: 10 },
  { name: "ไข่เจียว", price: 10 },
  { name: "ไก่ทอด", price: 20 }
];
EED_MENUS.forEach(function (menu) {
  if (!Array.isArray(menu.toppings) || !menu.toppings.length) {
    menu.toppings = EED_DEFAULT_TOPPINGS.map(function (topping) {
      return { name: topping.name, price: topping.price };
    });
  }
});
