/* EED HALAL — Snack Box Data
 * Static snack menu data for snack-box.html
 * Override from planner via planner-overrides.json or localStorage
 */
var EED_SNACK_BASE_PRICE = 40; // บาท/กล่อง (fixed)
var EED_SNACK_MIN_ORDER = 50;  // กล่อง (fixed)

/* Categories */
var EED_SNACK_CATEGORIES = [
  { id: 'savory', label: 'คาว', emoji: '🥐' },
  { id: 'sweet', label: 'หวาน', emoji: '🍰' },
  { id: 'juice', label: 'น้ำผลไม้', emoji: '🧃' },
  { id: 'milk', label: 'นม', emoji: '🥛' }
];

/* Add-on drinks */
var EED_SNACK_ADDONS = [
  { id: 'water', name: 'น้ำเปล่า หรือน้ำผลไม้', price: 0, emoji: '💧', note: 'ไม่เสียค่าใช้จ่าย' },
  { id: 'milk', name: 'นม หรือ มิลก์เชก', price: 10, emoji: '🥛', note: '+10 บาท' },
  { id: 'coffee', name: 'ชาเขียว / กาแฟ', price: 13, emoji: '☕', note: '+13 บาท' }
];

/* Snack menu items */
var EED_SNACK_MENUS = [
  // ─── คาว ───
  { id: 'sb01', category: 'savory', name: 'พัฟไก่ซอส', price: 40, desc: '' },
  { id: 'sb02', category: 'savory', name: 'พัฟไก่-ครี', price: 40, desc: '' },
  { id: 'sb03', category: 'savory', name: 'แซนด์วิชไส้ไข่ลวก', price: 40, desc: '' },
  { id: 'sb04', category: 'savory', name: 'แซนด์วิชปูอัด', price: 40, desc: '' },
  { id: 'sb05', category: 'savory', name: 'ลูกเกดไส้ไส้กรอก', price: 40, desc: '' },
  { id: 'sb06', category: 'savory', name: 'บันนีล็อกคอ', price: 40, desc: '' },
  { id: 'sb07', category: 'savory', name: 'บันพัฟชุบซอสเยิ้ม', price: 40, desc: '' },
  { id: 'sb08', category: 'savory', name: 'บันนีล็อกไส้กรอก', price: 40, desc: '' },
  { id: 'sb09', category: 'savory', name: 'ครัวซองต์ไส้กรอก', price: 40, desc: '' },
  { id: 'sb10', category: 'savory', name: 'ครัวซองต์ยัดไส้ปูอัด', price: 40, desc: '' },
  { id: 'sb11', category: 'savory', name: 'ครัวซองต์หมูหยอง', price: 40, desc: '' },
  { id: 'sb12', category: 'savory', name: 'ครัวซองต์ไก่กรอบ', price: 40, desc: '' },
  { id: 'sb13', category: 'savory', name: 'ครัวซองต์ไก่ซอส', price: 40, desc: '' },
  { id: 'sb14', category: 'savory', name: 'แซนด์วิชไก่', price: 40, desc: '' },

  // ─── หวาน ───
  { id: 'sb15', category: 'sweet', name: 'เค้กส้มเนยน้ำผึ้ง', price: 40, desc: '' },
  { id: 'sb16', category: 'sweet', name: 'เค้กกล้วยน้ำผึ้งคุกกี้', price: 40, desc: '' },
  { id: 'sb17', category: 'sweet', name: 'นมพลิ้ว', price: 40, desc: '' },
  { id: 'sb18', category: 'sweet', name: 'ชีสพายแอปเปิ้ลซอสส้ม', price: 40, desc: '' },
  { id: 'sb19', category: 'sweet', name: 'บราวนี่ช็อกโกแลตคลาสสิก', price: 40, desc: '' },
  { id: 'sb20', category: 'sweet', name: 'บราวนี่อัลมอนด์', price: 40, desc: '' },
  { id: 'sb21', category: 'sweet', name: 'บันนีบลูสคุกกี้', price: 40, desc: '' },
  { id: 'sb22', category: 'sweet', name: 'ครอฟเฟิลคาราเมลน้ำผึ้ง', price: 40, desc: '' },
  { id: 'sb23', category: 'sweet', name: 'ช็อกโกแลตคาลาเมล', price: 40, desc: '' },
  { id: 'sb24', category: 'sweet', name: 'เค้กกล้วยน้ำผึ้ง', price: 40, desc: '' },
  { id: 'sb25', category: 'sweet', name: 'บลูเบอร์รี่ชีสพาย', price: 40, desc: '' },
  { id: 'sb26', category: 'sweet', name: 'เรดเวลเว็ตเค้ก', price: 40, desc: '' },
  { id: 'sb27', category: 'sweet', name: 'บลูเบอร์รี่ชีสเค้ก', price: 40, desc: '' },
  { id: 'sb28', category: 'sweet', name: 'สตรอว์เบอร์รี่ชีสเค้ก', price: 40, desc: '' },
  { id: 'sb29', category: 'sweet', name: 'เค้กโกปิเอะ', price: 40, desc: '' },

  // ─── น้ำผลไม้ ───
  { id: 'sb30', category: 'juice', name: 'น้ำส้ม', price: 40, desc: '' },
  { id: 'sb31', category: 'juice', name: 'น้ำแอปเปิ้ล', price: 40, desc: '' },
  { id: 'sb32', category: 'juice', name: 'น้ำองุ่น', price: 40, desc: '' },
  { id: 'sb33', category: 'juice', name: 'น้ำมะเขือเทศ', price: 40, desc: '' },

  // ─── นม ───
  { id: 'sb34', category: 'milk', name: 'นมสด', price: 40, desc: '' },
  { id: 'sb35', category: 'milk', name: 'นมช็อกโกแลต', price: 40, desc: '' },
  { id: 'sb36', category: 'milk', name: 'นมสตรอว์เบอร์รี่', price: 40, desc: '' }
];
