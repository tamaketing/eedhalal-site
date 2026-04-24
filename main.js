/**
 * EED HALAL - Main JavaScript Bundle
 * Version: 20260306
 */

async function safeFetchText(path) {
    try {
        const res = await fetch(path);
        if (!res.ok) return '';
        return await res.text();
    } catch (error) {
        return '';
    }
}

async function safeFetchFirst(paths) {
    for (const path of paths) {
        const text = await safeFetchText(path);
        if (text) return text;
    }
    return '';
}

function ensureLucideLoaded() {
    return new Promise((resolve) => {
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            resolve();
            return;
        }

        const existing = document.querySelector('script[data-lucide-loader="true"]');
        if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => resolve(), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://unpkg.com/lucide@latest';
        script.defer = true;
        script.setAttribute('data-lucide-loader', 'true');
        script.onload = () => resolve();
        script.onerror = () => resolve();
        document.head.appendChild(script);
    });
}

async function initLucideIcons(container) {
    if (!container || !container.querySelector('[data-lucide]')) return;
    await ensureLucideLoaded();
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons({
            attrs: { 'stroke-width': 2 }
        });
    }
}

function getInlineNavigationFallback() {
    return `
<nav class="fixed w-full z-50 bg-white/80 backdrop-blur-lg border-b border-slate-100">
    <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <a href="index.html#home" class="flex items-center space-x-2">
            <div class="w-10 h-10 bg-emerald-600 rounded-lg flex items-center justify-center">
                <span class="text-white font-bold text-xl">E</span>
            </div>
            <div class="text-2xl font-bold tracking-tight text-emerald-800 uppercase">eedhalal</div>
        </a>
        <div class="hidden md:flex space-x-8 font-normal text-slate-600">
            <a href="index.html#home" class="hover:text-emerald-600 transition">หน้าแรก</a>
            <a href="popular-menu.html" class="hover:text-emerald-600 transition">เมนูยอดนิยม</a>
            <a href="order-steps.html" class="hover:text-emerald-600 transition">วิธีสั่งอาหาร</a>
            <a href="corporate.html" class="hover:text-emerald-600 transition">ลูกค้าองค์กร</a>
            <a href="contact.html" class="hover:text-emerald-600 transition">ติดต่อเรา</a>
        </div>
        <div class="flex items-center space-x-2">
            <button onclick="toggleCartDrawer()" class="relative p-2 text-slate-600 hover:text-emerald-600 transition-colors">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span id="nav-cart-badge" class="absolute top-0 right-0 bg-rose-500 text-white text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center border border-white hidden">0</span>
            </button>
            <button id="mobile-menu-btn" class="md:hidden text-slate-600 p-2 focus:outline-none">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path id="menu-icon" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7" />
                    <path id="close-icon" class="hidden" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    </div>
    <div id="mobile-menu" class="hidden md:hidden bg-white border-t border-slate-100 animate-slide-down">
        <div class="px-4 py-8 space-y-4">
            <a href="index.html#home" class="mobile-link block text-lg font-normal text-slate-700 hover:text-emerald-600 transition">หน้าแรก</a>
            <a href="popular-menu.html" class="mobile-link block text-lg font-normal text-slate-700 hover:text-emerald-600 transition">เมนูยอดนิยม</a>
            <a href="order-steps.html" class="mobile-link block text-lg font-normal text-slate-700 hover:text-emerald-600 transition">วิธีสั่งอาหาร</a>
            <a href="corporate.html" class="mobile-link block text-lg font-normal text-slate-700 hover:text-emerald-600 transition">ลูกค้าองค์กร</a>
            <a href="contact.html" class="mobile-link block text-lg font-normal text-slate-700 hover:text-emerald-600 transition">ติดต่อเรา</a>
        </div>
    </div>
</nav>
`;
}

function getInlineFooterFallback() {
    return `
<footer class="bg-white pt-20 pb-10 border-t border-slate-100">
    <div class="max-w-7xl mx-auto px-4 grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
        <div class="space-y-6">
            <div class="flex items-center space-x-3">
                <div class="logo-box !w-10 !h-10 !rounded-lg bg-emerald-600 flex items-center justify-center">
                    <i data-lucide="utensils-cross" class="text-white w-5 h-5"></i>
                </div>
                <span class="text-2xl font-black tracking-tighter text-emerald-900 uppercase">EED HALAL</span>
            </div>
            <p class="text-slate-500 text-sm leading-relaxed">
                ข้าวกล่องฮาลาลพรีเมียม ย่านสาทร กรุงเทพ วัตถุดิบคุณภาพ ปรุงสดใหม่ทุกวัน รับรองฮาลาล 100%
            </p>
            <div class="inline-flex items-center space-x-2 bg-emerald-50 px-4 py-2 rounded-xl border border-emerald-100">
                <div class="w-8 h-8 bg-emerald-600 rounded-full flex items-center justify-center">
                    <span class="text-white font-bold text-[10px]">حلال</span>
                </div>
                <div class="flex flex-col">
                    <span class="text-[10px] text-emerald-900 font-bold tracking-widest leading-none uppercase">ฮาลาลแท้</span>
                    <span class="text-[8px] text-emerald-600 font-medium">ได้รับการรับรอง</span>
                </div>
            </div>
        </div>

        <div>
            <h4 class="text-emerald-900 font-bold mb-6 text-sm uppercase tracking-widest">บริการของเรา</h4>
            <ul class="space-y-4 text-sm text-slate-500">
                <li><a href="delivery.html" class="hover:text-emerald-600 transition">ข้าวกล่องเดลิเวอรี่</a></li>
                <li><a href="catering.html" class="hover:text-emerald-600 transition">จัดเลี้ยงสัมมนา</a></li>
                <li><a href="hospital-orders.html" class="hover:text-emerald-600 transition">ออเดอร์โรงพยาบาล</a></li>
                <li><a href="buffet-menu.html" class="hover:text-emerald-600 transition">เมนูบุฟเฟต์</a></li>
            </ul>
        </div>

        <div>
            <h4 class="text-emerald-900 font-bold mb-6 text-sm uppercase tracking-widest">ช่วยเหลือ</h4>
            <ul class="space-y-4 text-sm text-slate-500">
                <li><a href="delivery-area.html" class="hover:text-emerald-600 transition">พื้นที่จัดส่ง</a></li>
                <li><a href="delivery-terms.html" class="hover:text-emerald-600 transition">เงื่อนไขการจัดส่ง</a></li>
                <li><a href="#" class="hover:text-emerald-600 transition">ใบกำกับภาษี</a></li>
                <li><a href="faq.html" class="hover:text-emerald-600 transition">คำถามที่พบบ่อย</a></li>
            </ul>
        </div>

        <div>
            <h4 class="text-emerald-900 font-bold mb-6 text-sm uppercase tracking-widest">ติดตามเรา</h4>
            <div class="flex space-x-4 mb-8">
                <a href="https://www.facebook.com/profile.php?id=61573552705869&locale=th_TH" class="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 hover:bg-emerald-600 hover:text-white transition-all shadow-sm border border-slate-100">
                    <i data-lucide="facebook" class="w-5 h-5"></i>
                </a>
                <a href="#" class="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 hover:bg-emerald-600 hover:text-white transition-all shadow-sm border border-slate-100">
                    <i data-lucide="instagram" class="w-5 h-5"></i>
                </a>
                <a href="https://lin.ee/CfvqJTd" class="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 hover:bg-emerald-600 hover:text-white transition-all shadow-sm border border-slate-100">
                    <i data-lucide="message-circle" class="w-5 h-5"></i>
                </a>
            </div>
            <div class="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">สายด่วน</p>
                <p class="text-lg font-bold text-emerald-800">098-871-5179</p>
            </div>
        </div>
    </div>

    <div class="max-w-7xl mx-auto px-4 pt-8 border-t border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4">
        <p class="text-[11px] text-slate-400 font-medium tracking-wide uppercase">
            &copy; 2024 อีดฮาลาล สาทร กรุงเทพ — สงวนลิขสิทธิ์
        </p>
        <div class="flex space-x-6 text-[10px] font-bold text-emerald-600/60 uppercase tracking-widest">
            <span>จัดส่งปลอดภัย</span>
            <span>ปรุงสดใหม่ทุกวัน</span>
            <span>ฮาลาล 100%</span>
        </div>
    </div>
</footer>
`;
}

function getInlineMenuFallback() {
    return [
        {
            name: 'ข้าวหมกไก่คลาสสิก',
            description: 'ข้าวหมกหอมเครื่องเทศ เนื้อไก่นุ่ม พร้อมน้ำจิ้มสูตรลับ',
            price: 85,
            image: 'https://images.unsplash.com/photo-1633945274405-b6c8069047b0?q=80&w=800&auto=format&fit=crop',
            tag: 'ขายดี'
        },
        {
            name: 'กะเพราเนื้อวัวไข่ดาว',
            description: 'ผัดกะเพราใบโหระพาเนื้อวัวบด พร้อมข้าวสวยและไข่ดาว',
            price: 95,
            image: 'https://images.unsplash.com/photo-1562967914-608f82629710?q=80&w=800&auto=format&fit=crop',
            tag: 'เผ็ด'
        },
        {
            name: 'ชุดไก่ทอดหาดใหญ่',
            description: 'ไก่ทอดกรอบหอมแดง พร้อมข้าวสวยร้อน',
            price: 89,
            image: 'https://images.unsplash.com/photo-1569058242253-92a9c71f9867?q=80&w=800&auto=format&fit=crop',
            tag: 'แนะนำ'
        }
    ];
}

const MENU_STORAGE_KEY = 'eedhalal.menu.v1';
const DEFAULT_MENU_IMAGE = '/img/chef-profile.jpg';
const LINE_OA_DIRECT_LINK = 'https://line.me/R/ti/p/@eedhalal';
const CONTACT_PHONE_DISPLAY = '098-871-5179';

function createMenuItemId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }
    return `menu-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeMenuItem(item, index = 0) {
    const parsedPrice = Number(item?.price);
    const normalized = {
        id: typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : createMenuItemId(),
        name: typeof item?.name === 'string' ? item.name.trim() : '',
        description: typeof item?.description === 'string' ? item.description.trim().replace(/^\[cost:[^\]]+\]\s*/i, '') : '',
        price: Number.isFinite(parsedPrice) ? parsedPrice : 0,
        image: typeof item?.image === 'string' ? item.image.trim() : '',
        tag: typeof item?.tag === 'string' ? item.tag.trim() : ''
    };

    if (!normalized.name) normalized.name = `เมนู ${index + 1}`;
    if (!normalized.description) normalized.description = 'ไม่มีรายละเอียด';
    if (!normalized.image) normalized.image = DEFAULT_MENU_IMAGE;

    return normalized;
}

function normalizeMenuList(menu) {
    if (!Array.isArray(menu)) return [];
    return menu.map((item, index) => normalizeMenuItem(item, index));
}

function readMenuFromStorage() {
    try {
        const raw = window.localStorage.getItem(MENU_STORAGE_KEY);
        if (raw === null) return null;
        return normalizeMenuList(JSON.parse(raw));
    } catch (error) {
        return null;
    }
}

function writeMenuToStorage(menu) {
    try {
        const normalized = normalizeMenuList(menu);
        window.localStorage.setItem(MENU_STORAGE_KEY, JSON.stringify(normalized));
        return normalized;
    } catch (error) {
        return normalizeMenuList(menu);
    }
}

async function fetchMenuFile() {
    try {
        const raw = await safeFetchFirst(['menu.json', '../menu.json']);
        if (!raw) return [];
        return normalizeMenuList(JSON.parse(raw));
    } catch (error) {
        return [];
    }
}

async function getMenuData() {
    const menuFromFile = await fetchMenuFile();
    if (menuFromFile.length > 0) {
        return writeMenuToStorage(menuFromFile);
    }

    const cached = readMenuFromStorage();
    if (cached && cached.length > 0) {
        return cached;
    }

    const fallback = normalizeMenuList(getInlineMenuFallback());
    if (fallback.length > 0) {
        return writeMenuToStorage(fallback);
    }
    return [];
}

function saveMenuData(menu) {
    return writeMenuToStorage(menu);
}

function resetMenuData() {
    try {
        window.localStorage.removeItem(MENU_STORAGE_KEY);
    } catch (error) {
        // no-op when storage is unavailable
    }
}

window.EedhalalMenuStore = {
    key: MENU_STORAGE_KEY,
    getMenuData,
    saveMenuData,
    resetMenuData,
    createMenuItemId
};

// --- CART SYSTEM ---
const CART_STORAGE_KEY = 'eedhalal.cart.v2';
const LEGACY_CART_STORAGE_KEY = 'eedhalal.cart.v1';
const MIN_ORDER_AMOUNT = 300;
const FREE_DELIVERY_KM = 3;
let cartSubmitting = false;

function normalizePhoneKey(phoneRaw) {
    const digitsOnly = String(phoneRaw || '').replace(/\D/g, '');
    if (!digitsOnly) return '';
    if (digitsOnly.startsWith('66') && digitsOnly.length === 11) {
        return `0${digitsOnly.slice(2)}`;
    }
    return digitsOnly;
}

function createCartItemId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return `cart-${window.crypto.randomUUID()}`;
    }
    return `cart-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeCartItem(item, index = 0) {
    const unitPrice = Number.isFinite(Number(item?.unitPrice))
        ? Number(item.unitPrice)
        : (Number.isFinite(Number(item?.price)) ? Number(item.price) : 0);
    const quantity = Number.isFinite(Number(item?.quantity)) ? Math.max(1, Number(item.quantity)) : 1;
    return {
        cartItemId: String(item?.cartItemId || createCartItemId() || `cart-${index + 1}`),
        id: String(item?.id || ''),
        name: String(item?.name || 'Menu'),
        image: String(item?.image || DEFAULT_MENU_IMAGE),
        unitPrice,
        price: unitPrice,
        quantity
    };
}

function normalizeLegacyCartItem(item, index = 0) {
    const addons = Array.isArray(item?.addons) ? item.addons : [];
    const addonTotal = addons.reduce((sum, addon) => sum + (Number.isFinite(Number(addon?.price)) ? Number(addon.price) : 0), 0);
    const basePrice = Number.isFinite(Number(item?.basePrice))
        ? Number(item.basePrice)
        : (Number.isFinite(Number(item?.price)) ? Number(item.price) : 0);
    const unitPrice = Number.isFinite(Number(item?.unitPrice))
        ? Number(item.unitPrice)
        : Math.max(0, basePrice + addonTotal);
    const quantity = Number.isFinite(Number(item?.quantity)) ? Math.max(1, Number(item.quantity)) : 1;
    return {
        cartItemId: String(item?.cartItemId || createCartItemId() || `cart-${index + 1}`),
        id: String(item?.id || ''),
        name: String(item?.name || 'Menu'),
        image: String(item?.image || DEFAULT_MENU_IMAGE),
        unitPrice,
        price: unitPrice,
        quantity
    };
}

function getCartData() {
    try {
        const raw = window.localStorage.getItem(CART_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed.map((item, index) => normalizeCartItem(item, index));
        }

        const legacyRaw = window.localStorage.getItem(LEGACY_CART_STORAGE_KEY);
        const legacyParsed = legacyRaw ? JSON.parse(legacyRaw) : [];
        if (!Array.isArray(legacyParsed) || legacyParsed.length === 0) return [];
        const migrated = legacyParsed.map((item, index) => normalizeLegacyCartItem(item, index));
        window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(migrated));
        window.localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
        return migrated;
    } catch (e) {
        return [];
    }
}

function saveCartData(cart) {
    const normalized = Array.isArray(cart)
        ? cart.map((item, index) => normalizeCartItem(item, index))
        : [];
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(normalized));
    updateCartUI();
}

function addCartItem(item) {
    const cart = getCartData();
    const existing = cart.find((cartItem) => cartItem.id === item.id);
    if (existing) {
        existing.quantity += 1;
    } else {
        cart.push({
            cartItemId: createCartItemId(),
            id: item.id,
            name: item.name,
            image: item.image || DEFAULT_MENU_IMAGE,
            unitPrice: Number(item.price || 0),
            price: Number(item.price || 0),
            quantity: 1
        });
    }
    saveCartData(cart);
}

function updateQuantity(cartItemId, delta) {
    const nextCart = getCartData()
        .map((item) => (
            item.cartItemId === cartItemId
                ? { ...item, quantity: Number(item.quantity || 0) + delta }
                : item
        ))
        .filter((item) => item.quantity > 0);
    saveCartData(nextCart);
}

function clearCart() {
    saveCartData([]);
}

async function syncCartWithMenu() {
    const currentCart = getCartData();
    if (!currentCart.length) {
        updateCartUI();
        return;
    }

    const menu = await getMenuData();
    const menuById = new Map(menu.map((item) => [item.id, item]));
    const nextCart = currentCart
        .filter((cartItem) => menuById.has(cartItem.id))
        .map((cartItem) => {
            const latest = menuById.get(cartItem.id);
            const quantity = Number.isFinite(Number(cartItem.quantity)) ? Math.max(1, Number(cartItem.quantity)) : 1;
            const unitPrice = Number(latest.price || 0);
            return {
                cartItemId: cartItem.cartItemId || createCartItemId(),
                id: latest.id,
                name: latest.name,
                image: latest.image || DEFAULT_MENU_IMAGE,
                unitPrice,
                price: unitPrice,
                quantity
            };
        });

    const changed = JSON.stringify(currentCart) !== JSON.stringify(nextCart);
    if (changed) {
        saveCartData(nextCart);
        return;
    }

    updateCartUI();
}

function calculateTotal() {
    return getCartData().reduce((sum, item) => sum + (Number(item.unitPrice || 0) * Number(item.quantity || 0)), 0);
}

function setCartError(message) {
    const errorEl = document.getElementById('cart-error');
    if (!errorEl) return;
    if (!message) {
        errorEl.classList.add('hidden');
        errorEl.textContent = '';
        return;
    }
    errorEl.classList.remove('hidden');
    errorEl.textContent = message;
}

function setCartSubmitState(isSubmitting) {
    cartSubmitting = isSubmitting;
    const submitBtn = document.getElementById('cart-submit-btn');
    if (!submitBtn) return;
    submitBtn.disabled = isSubmitting;
    submitBtn.classList.toggle('opacity-70', isSubmitting);
    submitBtn.textContent = isSubmitting ? 'กำลังเปิด LINE...' : 'ส่งรายการทาง LINE';
}

function buildStaticOrderReference() {
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(2, 14);
    return `WEB-${stamp}`;
}

function buildStaticOrderMessage({ referenceId, customer, cart, total }) {
    const lines = [
        'สวัสดีครับ/ค่ะ ต้องการสั่งอาหารจากเว็บไซต์ EED HALAL',
        `รหัสอ้างอิง: ${referenceId}`,
        '',
        'ข้อมูลผู้สั่ง',
        `ชื่อ: ${customer.name}`,
        `เบอร์โทร: ${customer.phone}`,
        `ที่อยู่จัดส่ง: ${customer.address}`
    ];

    if (customer.note) {
        lines.push(`หมายเหตุ: ${customer.note}`);
    }

    lines.push('', 'รายการอาหาร');
    cart.forEach((item, index) => {
        const quantity = Number(item.quantity || 0);
        const unitPrice = Number(item.unitPrice || 0);
        const lineTotal = quantity * unitPrice;
        lines.push(`${index + 1}. ${item.name} x${quantity} = ${lineTotal} บาท`);
    });

    lines.push('', `ยอดรวม: ${total} บาท`, '', `หากข้อมูลไม่ครบ ติดต่อกลับที่ ${CONTACT_PHONE_DISPLAY}`);
    return lines.join('\n');
}

function getLineOrderShareUrl(message) {
    return `https://line.me/R/msg/text/?${encodeURIComponent(message)}`;
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return true;
    }

    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', 'true');
    helper.className = 'fixed -left-[9999px] top-0';
    document.body.appendChild(helper);
    helper.select();
    const copied = document.execCommand('copy');
    helper.remove();
    return copied;
}

function showStaticOrderRedirectOverlay(referenceId, shareUrl, message) {
    const existing = document.getElementById('order-success-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'order-success-overlay';
    overlay.className = 'fixed inset-0 z-[80] flex items-center justify-center p-4';
    overlay.innerHTML = `
        <div class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onclick="dismissOrderSuccess()"></div>
        <div class="relative bg-white rounded-3xl shadow-2xl max-w-sm w-full p-8 text-center animate-[fadeInUp_0.4s_ease-out]">
            <div class="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg class="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3"/><path stroke-linecap="round" stroke-linejoin="round" d="M3.05 11a9 9 0 111.99 5.66"/></svg>
            </div>
            <h3 class="text-xl font-black text-slate-900 mb-2">เปิด LINE พร้อมข้อความสั่งซื้อแล้ว</h3>
            <p class="text-slate-500 text-sm mb-2">หาก LINE ไม่เปิดอัตโนมัติ ใช้ปุ่มด้านล่างเพื่อเปิดใหม่หรือคัดลอกข้อความสั่งซื้อ</p>
            <p class="text-slate-400 text-xs mb-6">รหัสอ้างอิง: <span class="font-bold text-slate-700">${referenceId}</span></p>
            <div class="space-y-3 mb-4">
                <a href="${shareUrl}" target="_blank" rel="noopener noreferrer"
                   class="inline-flex items-center justify-center w-full bg-[#06C755] text-white py-3.5 rounded-2xl font-bold text-sm hover:bg-[#05b04c] transition-colors shadow-lg shadow-green-100 gap-2">
                    <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>
                    เปิด LINE พร้อมข้อความสั่งซื้อ
                </a>
                <button onclick="copyLatestOrderMessage(event)" type="button"
                    class="inline-flex items-center justify-center w-full bg-white border border-slate-200 text-slate-700 py-3.5 rounded-2xl font-bold text-sm hover:bg-slate-50 transition-colors gap-2">
                    คัดลอกข้อความสั่งซื้อ
                </button>
            </div>
            <p class="text-[11px] text-slate-400 mb-4">ข้อความสั่งซื้อจะถูกเก็บไว้ในหน้านี้ชั่วคราว หากเปิด LINE ไม่สำเร็จให้กดคัดลอกแล้วส่งหาเราเอง</p>
            <details class="mb-4 rounded-2xl bg-slate-50 p-4 text-left">
                <summary class="cursor-pointer text-sm font-bold text-slate-700">ดูข้อความสั่งซื้อ</summary>
                <pre class="mt-3 whitespace-pre-wrap break-words text-xs text-slate-500">${message}</pre>
            </details>
            <button onclick="dismissOrderSuccess()" class="w-full py-3 rounded-2xl text-slate-500 font-semibold text-sm hover:bg-slate-50 transition-colors">
                ปิด
            </button>
        </div>
    `;

    if (!document.getElementById('order-success-style')) {
        const style = document.createElement('style');
        style.id = 'order-success-style';
        style.textContent = `
            @keyframes fadeInUp {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(overlay);
}

window.copyLatestOrderMessage = async function (event) {
    event?.preventDefault();
    const message = window.__eedhalalLastOrderMessage || '';
    if (!message) return;
    try {
        await copyTextToClipboard(message);
        const button = event?.currentTarget;
        if (button) {
            const original = button.textContent;
            button.textContent = 'คัดลอกแล้ว';
            setTimeout(() => {
                button.textContent = original;
            }, 1600);
        }
    } catch (_error) {
        // Ignore clipboard failures and leave the message visible in the overlay.
    }
};

function submitStaticCartOrder(customer, cart, total) {
    const referenceId = buildStaticOrderReference();
    const message = buildStaticOrderMessage({ referenceId, customer, cart, total });
    const shareUrl = getLineOrderShareUrl(message);
    window.__eedhalalLastOrderMessage = message;
    window.toggleCartDrawer(false);
    window.open(shareUrl, '_blank', 'noopener');
    showStaticOrderRedirectOverlay(referenceId, shareUrl, message);
}

async function submitCartOrder(event) {
    event.preventDefault();
    if (cartSubmitting) return;

    const cart = getCartData();
    if (!cart.length) {
        setCartError('ตะกร้าว่าง กรุณาเพิ่มรายการอาหารก่อนสั่ง');
        return;
    }

    const total = calculateTotal();
    if (total < MIN_ORDER_AMOUNT) {
        setCartError(`ยอดขั้นต่ำในการสั่งคือ ${MIN_ORDER_AMOUNT} บาท (ยอดปัจจุบัน ${total} บาท)`);
        return;
    }

    const name = document.getElementById('cart-customer-name')?.value.trim() || '';
    const phone = document.getElementById('cart-customer-phone')?.value.trim() || '';
    const address = document.getElementById('cart-customer-address')?.value.trim() || '';
    const note = document.getElementById('cart-customer-note')?.value.trim() || '';
    const phoneKey = normalizePhoneKey(phone);

    if (!name || !phoneKey || !address) {
        setCartError('กรุณากรอกชื่อ เบอร์โทร และที่อยู่จัดส่ง');
        return;
    }
    if (phoneKey.length < 9) {
        setCartError('เบอร์โทรศัพท์ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
        return;
    }

    const customer = {
        name,
        phone: phoneKey,
        address,
        note
    };

    setCartSubmitState(true);
    setCartError('');

    try {
        submitStaticCartOrder(customer, cart, total);
    } catch (error) {
        setCartError(String(error?.message || 'ไม่สามารถเปิด LINE ได้ กรุณาลองใหม่อีกครั้ง'));
    } finally {
        setCartSubmitState(false);
    }
}

function updateCartUI() {
    const cart = getCartData();
    const count = cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const badge = document.getElementById('cart-badge');
    const navBadge = document.getElementById('nav-cart-badge');
    const floatingBtn = document.getElementById('floating-cart-btn');
    const submitBtn = document.getElementById('cart-submit-btn');

    if (badge) {
        badge.textContent = count;
        badge.classList.toggle('hidden', count === 0);
    }

    if (navBadge) {
        navBadge.textContent = count;
        navBadge.classList.toggle('hidden', count === 0);
    }

    if (floatingBtn) {
        floatingBtn.classList.toggle('translate-y-24', count === 0);
        floatingBtn.classList.toggle('opacity-0', count === 0);
    }

    if (submitBtn) {
        submitBtn.disabled = cartSubmitting || count === 0;
        if (!cartSubmitting) {
            submitBtn.textContent = 'ส่งรายการทาง LINE';
        }
    }

    renderCartDrawer();
}

function renderCartDrawer() {
    const drawer = document.getElementById('cart-drawer');
    if (!drawer) return;

    const cart = getCartData();
    const itemsList = document.getElementById('cart-items-list');
    const totalPriceEl = document.getElementById('cart-total-price');

    if (itemsList) {
        if (cart.length === 0) {
            itemsList.innerHTML = `
                <div class="py-10 text-center space-y-3">
                    <div class="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
                        <i data-lucide="shopping-basket" class="w-7 h-7"></i>
                    </div>
                    <p class="text-slate-500 font-medium">ยังไม่มีรายการในตะกร้า</p>
                </div>
            `;
        } else {
            itemsList.innerHTML = cart.map((item) => `
                <div class="flex items-center gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                    <img src="${item.image}" class="w-14 h-14 object-cover rounded-xl shadow-sm" alt="${item.name}">
                    <div class="flex-1 min-w-0">
                        <h4 class="font-bold text-slate-800 text-sm line-clamp-1">${item.name}</h4>
                        <p class="text-emerald-600 font-bold text-xs">${item.unitPrice} บาท</p>
                    </div>
                    <div class="flex items-center bg-white rounded-lg border border-slate-200 overflow-hidden">
                        <button onclick="updateQuantity('${item.cartItemId}', -1)" class="px-2 py-1 hover:bg-slate-50 text-slate-400">-</button>
                        <span class="px-2 py-1 font-black text-xs min-w-[24px] text-center">${item.quantity}</span>
                        <button onclick="updateQuantity('${item.cartItemId}', 1)" class="px-2 py-1 hover:bg-slate-50 text-slate-400">+</button>
                    </div>
                </div>
            `).join('');
        }
        initLucideIcons(itemsList);
    }

    if (totalPriceEl) {
        const total = calculateTotal();
        totalPriceEl.textContent = `${total} บาท`;
        const remaining = MIN_ORDER_AMOUNT - total;
        const minHint = document.getElementById('cart-min-hint');
        if (minHint) {
            if (total > 0 && remaining > 0) {
                minHint.textContent = `สั่งเพิ่มอีก ${remaining} บาท เพื่อครบขั้นต่ำ`;
                minHint.classList.remove('hidden');
                minHint.classList.add('text-amber-600');
                minHint.classList.remove('text-emerald-600');
            } else if (total >= MIN_ORDER_AMOUNT) {
                minHint.textContent = `✓ ครบยอดขั้นต่ำแล้ว — ส่งฟรีในรัศมี ${FREE_DELIVERY_KM} กม.`;
                minHint.classList.remove('hidden');
                minHint.classList.remove('text-amber-600');
                minHint.classList.add('text-emerald-600');
            } else {
                minHint.classList.add('hidden');
            }
        }
    }
}

function isDrawerOpen(id) {
    const drawer = document.getElementById(id);
    if (!drawer) return false;
    return drawer.classList.contains('translate-x-0');
}

function setDrawerState(id, open) {
    const drawer = document.getElementById(id);
    if (!drawer) return;
    if (open) {
        drawer.classList.remove('translate-x-full');
        drawer.classList.add('translate-x-0');
    } else {
        drawer.classList.add('translate-x-full');
        drawer.classList.remove('translate-x-0');
    }
}

function updateOverlayState() {
    const overlay = document.getElementById('cart-overlay');
    if (!overlay) return;
    const anyOpen = isDrawerOpen('cart-drawer');
    overlay.classList.toggle('opacity-0', !anyOpen);
    overlay.classList.toggle('pointer-events-none', !anyOpen);
}

function closeAllDrawers() {
    setDrawerState('cart-drawer', false);
    updateOverlayState();
}

function initCartUI() {
    if (document.getElementById('floating-cart-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'floating-cart-btn';
    btn.className = 'fixed bottom-8 right-8 z-[60] transition-all duration-500 translate-y-24 opacity-0';
    btn.innerHTML = `
        <button onclick="toggleCartDrawer()" class="bg-emerald-600 text-white w-16 h-16 rounded-3xl shadow-2xl flex items-center justify-center relative hover:scale-110 active:scale-95 transition-transform group">
            <i data-lucide="shopping-cart" class="w-8 h-8"></i>
            <span id="cart-badge" class="absolute -top-2 -right-2 bg-rose-500 text-white text-[10px] font-black w-6 h-6 rounded-full flex items-center justify-center border-2 border-white hidden animate-bounce">0</span>
            <div class="absolute right-20 bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                ดูตะกร้าสินค้า
            </div>
        </button>
    `;

    const drawer = document.createElement('div');
    drawer.id = 'cart-drawer';
    drawer.className = 'fixed inset-y-0 right-0 w-full md:w-[430px] bg-white z-[70] shadow-[-10px_0_50px_rgba(0,0,0,0.1)] transition-transform duration-500 translate-x-full flex flex-col';
    drawer.innerHTML = `
        <div class="p-6 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10">
            <div>
                <h2 class="text-xl font-black text-slate-900">ตะกร้าสินค้า</h2>
                <p class="text-xs text-slate-500">กรอกข้อมูลแล้วส่งรายการทาง LINE</p>
            </div>
            <button onclick="toggleCartDrawer(false)" class="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                <i data-lucide="x" class="w-6 h-6"></i>
            </button>
        </div>
        <div class="px-6 py-3 bg-emerald-50 border-b border-emerald-100 text-xs text-emerald-700 font-semibold flex items-center gap-2">
            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <span>สั่งขั้นต่ำ ${MIN_ORDER_AMOUNT} บาท • ส่งฟรีในรัศมี ${FREE_DELIVERY_KM} กม. จากร้าน</span>
        </div>
        <form id="cart-form" class="flex-1 flex flex-col">
            <div id="cart-items-list" class="max-h-[40vh] overflow-y-auto p-6 space-y-3 border-b border-slate-100"></div>
            <div class="p-6 space-y-3 overflow-y-auto">
                <input id="cart-customer-phone" type="tel" placeholder="เบอร์โทรศัพท์" class="w-full border border-slate-200 rounded-xl px-4 py-3 text-slate-800 focus:outline-none focus:border-emerald-500">
                <input id="cart-customer-name" type="text" placeholder="ชื่อผู้สั่ง" class="w-full border border-slate-200 rounded-xl px-4 py-3 text-slate-800 focus:outline-none focus:border-emerald-500">
                <textarea id="cart-customer-address" rows="3" placeholder="ที่อยู่จัดส่ง" class="w-full border border-slate-200 rounded-xl px-4 py-3 text-slate-800 focus:outline-none focus:border-emerald-500"></textarea>
                <textarea id="cart-customer-note" rows="2" placeholder="หมายเหตุ (ไม่บังคับ)" class="w-full border border-slate-200 rounded-xl px-4 py-3 text-slate-800 focus:outline-none focus:border-emerald-500"></textarea>
                <p id="cart-error" class="hidden text-sm text-rose-600 font-semibold"></p>
            </div>
            <div class="p-6 bg-slate-50 border-t border-slate-100 space-y-3">
                <div class="flex justify-between items-center">
                    <span class="text-slate-500 font-bold uppercase tracking-widest text-xs">ยอดรวม</span>
                    <span id="cart-total-price" class="text-3xl font-black text-emerald-600">0 บาท</span>
                </div>
                <p id="cart-min-hint" class="hidden text-xs font-semibold text-center"></p>
                <button id="cart-submit-btn" type="submit" class="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black text-base shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all disabled:opacity-60">
                    ส่งรายการทาง LINE
                </button>
            </div>
        </form>
    `;

    const overlay = document.createElement('div');
    overlay.id = 'cart-overlay';
    overlay.className = 'fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[65] opacity-0 pointer-events-none transition-opacity duration-500';
    overlay.onclick = closeAllDrawers;

    document.body.appendChild(overlay);
    document.body.appendChild(btn);
    document.body.appendChild(drawer);

    const cartForm = document.getElementById('cart-form');
    if (cartForm) {
        cartForm.addEventListener('submit', submitCartOrder);
    }

    initLucideIcons(document.body);
    updateCartUI();
}

window.dismissOrderSuccess = function () {
    const overlay = document.getElementById('order-success-overlay');
    if (overlay) overlay.remove();
};

window.toggleCartDrawer = function (open) {
    const shouldOpen = typeof open === 'boolean' ? open : !isDrawerOpen('cart-drawer');
    setDrawerState('cart-drawer', shouldOpen);
    updateOverlayState();
};

window.toggleCheckoutDrawer = function () {
    window.toggleCartDrawer(true);
};

window.openCheckoutDrawer = function () {
    window.toggleCartDrawer(true);
};

window.backToCartFromCheckout = function () {
    window.toggleCartDrawer(true);
};

window.checkoutToLine = function () {
    window.toggleCartDrawer(true);
};

window.updateQuantity = updateQuantity;

window.addToCart = function (id, event) {
    const btn = event?.currentTarget;
    getMenuData().then((menu) => {
        const item = menu.find((menuItem) => menuItem.id === id);
        if (item) {
            addCartItem(item);
            if (btn) {
                const originalText = btn.innerHTML;
                btn.innerHTML = '<i data-lucide="check" class="w-4 h-4 mr-2"></i> เพิ่มแล้ว!';
                btn.classList.add('bg-emerald-700');
                initLucideIcons(btn);
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.classList.remove('bg-emerald-700');
                    initLucideIcons(btn);
                }, 2000);
            }
        }
    });
};

window.addBundleToCart = function (firstId, secondId, bundlePrice, event) {
    const btn = event?.currentTarget;
    getMenuData().then((menu) => {
        const first = menu.find((m) => m.id === firstId);
        const second = menu.find((m) => m.id === secondId);
        if (!first || !second) return;

        const totalOriginal = Number(first.price || 0) + Number(second.price || 0);
        // Distribute bundle price proportionally
        const firstBundlePrice = totalOriginal > 0 ? Math.round(bundlePrice * (first.price / totalOriginal)) : Math.round(bundlePrice / 2);
        const secondBundlePrice = bundlePrice - firstBundlePrice;

        const cart = getCartData();
        // Add first item with discounted price
        const existingFirst = cart.find((c) => c.id === first.id);
        if (existingFirst) {
            existingFirst.quantity += 1;
        } else {
            cart.push({
                cartItemId: createCartItemId(),
                id: first.id,
                name: first.name,
                image: first.image || '',
                unitPrice: firstBundlePrice,
                price: firstBundlePrice,
                quantity: 1
            });
        }
        // Add second item with discounted price
        const existingSecond = cart.find((c) => c.id === second.id);
        if (existingSecond) {
            existingSecond.quantity += 1;
        } else {
            cart.push({
                cartItemId: createCartItemId(),
                id: second.id,
                name: second.name,
                image: second.image || '',
                unitPrice: secondBundlePrice,
                price: secondBundlePrice,
                quantity: 1
            });
        }
        saveCartData(cart);

        if (btn) {
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i data-lucide="check" class="w-4 h-4 mr-1"></i> เพิ่มแล้ว!';
            btn.classList.add('bg-emerald-700');
            initLucideIcons(btn);
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.classList.remove('bg-emerald-700');
                initLucideIcons(btn);
            }, 2000);
        }
    });
};

function buildStaticBundleDeals(menu, maxBundles = 4) {
    const bundles = [];
    for (let index = 0; index < menu.length - 1 && bundles.length < maxBundles; index += 2) {
        const first = menu[index];
        const second = menu[index + 1];
        if (!first || !second) continue;

        const originalTotal = Number(first.price || 0) + Number(second.price || 0);
        const rawBundlePrice = Math.round(originalTotal * 0.92);
        const saving = Math.max(0, originalTotal - rawBundlePrice);
        if (saving < 5) continue;

        bundles.push({
            label: `${first.name} + ${second.name}`,
            first,
            second,
            bundlePrice: rawBundlePrice,
            originalTotal,
            saving
        });
    }
    return bundles;
}

async function renderBundleDeals(menu) {
    const bundleGrid = document.getElementById('bundle-grid');
    if (!bundleGrid) return;
    const bundles = buildStaticBundleDeals(menu);

    if (!bundles.length) {
        bundleGrid.innerHTML = `
            <div class="col-span-full rounded-3xl border border-amber-200 bg-white p-8 text-center text-slate-500">
                ยังไม่มีชุดสุดคุ้มในขณะนี้
            </div>
        `;
        return;
    }

    bundleGrid.innerHTML = bundles.map(({ label, first, second, bundlePrice, originalTotal, saving }) => `
        <article class="rounded-3xl border border-amber-200 bg-white overflow-hidden shadow-sm hover:shadow-xl transition-shadow">
            <div class="flex h-36">
                <img src="${first.image}" alt="${first.name}" class="w-1/2 object-cover">
                <img src="${second.image}" alt="${second.name}" class="w-1/2 object-cover">
            </div>
            <div class="p-6">
                <div class="flex items-center gap-2 mb-2">
                    <span class="bg-amber-100 text-amber-700 text-[10px] px-2.5 py-0.5 rounded-full font-black uppercase tracking-widest">ชุดสุดคุ้ม</span>
                    <span class="bg-emerald-100 text-emerald-700 text-[10px] px-2.5 py-0.5 rounded-full font-black">ประหยัด ${saving} บาท</span>
                </div>
                <p class="text-lg font-black text-slate-900 line-clamp-1">${first.name} + ${second.name}</p>
                <div class="mt-4 flex items-end justify-between">
                    <div>
                        <p class="text-sm text-slate-400 line-through">${originalTotal} บาท</p>
                        <p class="text-2xl font-black text-amber-700">${bundlePrice} บาท</p>
                    </div>
                    <button onclick="addBundleToCart('${first.id}', '${second.id}', ${bundlePrice}, event)" class="bg-amber-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-amber-700 shadow-lg shadow-amber-100 transition-all flex items-center">
                        <i data-lucide="plus" class="w-4 h-4 mr-1"></i> สั่งชุดนี้
                    </button>
                </div>
            </div>
        </article>
    `).join('');
    initLucideIcons(bundleGrid);
}

function renderMenu(menu) {
    const cleanDesc = (d) => String(d || '').replace(/^\[cost:[^\]]+\]\s*/i, '');

    return menu.map((item) => `
        <div class="food-card bg-slate-50 rounded-3xl overflow-hidden border border-slate-100 group">
            <div class="h-64 overflow-hidden relative">
                <img src="${item.image}" alt="${item.name}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700">
                ${item.tag ? `<div class="absolute top-4 left-4 bg-emerald-600 text-white text-[10px] px-3 py-1 rounded-full font-black uppercase tracking-widest shadow-lg">${item.tag}</div>` : ''}
            </div>
            <div class="p-8">
                <div class="mb-2">
                    <h3 class="text-xl font-bold text-slate-800 line-clamp-1">${item.name}</h3>
                </div>
                <p class="text-slate-500 text-sm mb-6 line-clamp-2 h-10">${cleanDesc(item.description)}</p>
                <div class="flex justify-between items-center pt-4 border-t border-slate-200">
                    <span class="text-left">
                        <span class="text-2xl font-black text-emerald-700">${item.price} บาท</span>
                    </span>
                    ${`<button onclick="addToCart('${item.id}', event)" class="bg-emerald-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-emerald-700 shadow-lg shadow-emerald-100 transition-all flex items-center">
                            <i data-lucide="plus" class="w-4 h-4 mr-2"></i> เพิ่มลงตะกร้า
                         </button>`
        }
                </div>
            </div>
        </div>
    `).join('');
}

async function loadMenu() {
    const menuGrid = document.getElementById('menu-grid');
    if (!menuGrid) return;

    try {
        const menu = await getMenuData();

        if (!menu.length) {
            menuGrid.innerHTML = `
                <div class="col-span-full bg-slate-100 border border-slate-200 rounded-3xl p-10 text-center">
                    <h3 class="text-2xl font-bold text-slate-800 mb-2">ยังไม่มีรายการอาหาร</h3>
                    <p class="text-slate-500">กรุณาอัปเดตไฟล์เมนู หรือส่งข้อความหาทีมงานผ่าน LINE</p>
                </div>
            `;
            return;
        }

        menuGrid.innerHTML = renderMenu(menu);
        await renderBundleDeals(menu);
    } catch (error) {
        console.error('Error rendering menu:', error);
    }
}

function initMobileMenu() {
    const btn = document.getElementById('mobile-menu-btn');
    const menu = document.getElementById('mobile-menu');
    const menuIcon = document.getElementById('menu-icon');
    const closeIcon = document.getElementById('close-icon');

    if (!btn || !menu) return;

    btn.addEventListener('click', () => {
        const isHidden = menu.classList.toggle('hidden');
        if (menuIcon && closeIcon) {
            menuIcon.classList.toggle('hidden', !isHidden);
            closeIcon.classList.toggle('hidden', isHidden);
        }
    });

    const mobileLinks = document.querySelectorAll('.mobile-link');
    mobileLinks.forEach((link) => {
        link.addEventListener('click', () => {
            menu.classList.add('hidden');
            if (menuIcon && closeIcon) {
                menuIcon.classList.remove('hidden');
                closeIcon.classList.add('hidden');
            }
        });
    });
}

async function loadComponents() {
    const navPlaceholder = document.getElementById('navigation-placeholder');
    if (navPlaceholder) {
        let navMarkup = await safeFetchFirst(['navigation.html', '../navigation.html']);
        if (!navMarkup) {
            navMarkup = getInlineNavigationFallback();
            console.warn('Navigation file fetch failed. Using inline fallback navigation.');
        }

        navPlaceholder.innerHTML = navMarkup;
        initMobileMenu();
    }

    const skipFooter = document.body?.dataset?.noFooter === 'true';
    if (!skipFooter) {
        let footerPlaceholder = document.getElementById('footer-placeholder');
        if (!footerPlaceholder) {
            footerPlaceholder = document.createElement('div');
            footerPlaceholder.id = 'footer-placeholder';
            document.body.appendChild(footerPlaceholder);
        }

        let footer = await safeFetchFirst(['footer.html', '../footer.html']);
        if (!footer) {
            footer = getInlineFooterFallback();
            console.warn('Footer file fetch failed. Using inline fallback footer.');
        }

        footerPlaceholder.innerHTML = footer;
        await initLucideIcons(footerPlaceholder);
    }

    if (document.getElementById('menu-grid')) {
        await loadMenu();
        initCartUI();
        await syncCartWithMenu();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadComponents);
} else {
    loadComponents();
}

window.addEventListener('focus', async () => {
    if (document.getElementById('menu-grid')) {
        await loadMenu();
    }
});

window.setInterval(async () => {
    if (document.getElementById('menu-grid')) {
        await loadMenu();
    }
}, 30000);

window.addEventListener('storage', async (event) => {
    if (event.key === MENU_STORAGE_KEY) {
        if (!document.getElementById('menu-grid')) return;
        await loadMenu();
        await syncCartWithMenu();
        return;
    }

    if (event.key === CART_STORAGE_KEY) {
        updateCartUI();
    }
});
