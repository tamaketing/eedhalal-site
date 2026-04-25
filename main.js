/**
 * EED HALAL - Main JavaScript Bundle
 * Public UX focuses on quotation requests and delivery-app ordering.
 */

const DEFAULT_MENU_IMAGE = '/img/chef-profile.jpg';
const QUOTE_LINE_URL = 'https://lin.ee/CfvqJTd';
const PHONE_DISPLAY = '098-871-5179';
const PHONE_HREF = 'tel:+66988715179';

// Replace the href values below with store-specific app URLs when available.
const DELIVERY_APPS = [
    {
        name: 'LINE MAN',
        href: 'https://wongn.ai/228xgb',
        description: 'สั่งรายกล่องผ่าน LINE MAN'
    },
    {
        name: 'Grab',
        href: 'https://r.grab.com/o/fYFVF3iu',
        description: 'สั่งรายกล่องผ่าน Grab'
    },
    {
        name: 'Delivery App 3',
        href: '',
        description: 'เพิ่มลิงก์ร้านภายหลัง'
    },
    {
        name: 'Delivery App 4',
        href: '',
        description: 'เพิ่มลิงก์ร้านภายหลัง'
    }
];

async function safeFetchText(path) {
    try {
        const res = await fetch(path);
        if (!res.ok) return '';
        return await res.text();
    } catch (_error) {
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
        window.lucide.createIcons({ attrs: { 'stroke-width': 2 } });
    }
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getInlineNavigationFallback() {
    return `
<nav class="fixed inset-x-0 top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
    <div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
        <a href="index.html#home" class="flex items-center gap-3">
            <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-600 shadow-lg shadow-emerald-200">
                <span class="text-lg font-black text-white">E</span>
            </div>
            <div>
                <div class="text-xl font-black uppercase tracking-tight text-emerald-900">EED HALAL</div>
                <div class="text-[10px] font-bold uppercase tracking-[0.32em] text-slate-400">Corporate Catering</div>
            </div>
        </a>
        <div class="hidden items-center gap-8 text-sm font-semibold text-slate-600 md:flex">
            <a href="index.html#home" class="transition hover:text-emerald-600">หน้าแรก</a>
            <a href="popular-menu.html" class="transition hover:text-emerald-600">เมนูตัวอย่าง</a>
            <a href="corporate.html" class="transition hover:text-emerald-600">บริการองค์กร</a>
            <a href="order-steps.html" class="transition hover:text-emerald-600">ขั้นตอนสั่งงาน</a>
            <a href="faq.html" class="transition hover:text-emerald-600">คำถามที่พบบ่อย</a>
            <a href="contact.html" class="transition hover:text-emerald-600">ติดต่อเรา</a>
        </div>
        <div class="flex items-center gap-3">
            <a href="${QUOTE_LINE_URL}" target="_blank" rel="noopener noreferrer"
                class="hidden rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-emerald-200 transition hover:bg-emerald-700 md:inline-flex">
                ขอใบเสนอราคา
            </a>
            <button id="mobile-menu-btn" class="rounded-xl p-2 text-slate-700 md:hidden" aria-label="Toggle menu">
                <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path id="menu-icon" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M4 6h16M4 12h16m-7 6h7" />
                    <path id="close-icon" class="hidden" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    </div>
    <div id="mobile-menu" class="hidden border-t border-slate-200 bg-white md:hidden">
        <div class="space-y-3 px-4 py-6 text-base font-semibold text-slate-700">
            <a href="index.html#home" class="mobile-link block transition hover:text-emerald-600">หน้าแรก</a>
            <a href="popular-menu.html" class="mobile-link block transition hover:text-emerald-600">เมนูตัวอย่าง</a>
            <a href="corporate.html" class="mobile-link block transition hover:text-emerald-600">บริการองค์กร</a>
            <a href="order-steps.html" class="mobile-link block transition hover:text-emerald-600">ขั้นตอนสั่งงาน</a>
            <a href="faq.html" class="mobile-link block transition hover:text-emerald-600">คำถามที่พบบ่อย</a>
            <a href="contact.html" class="mobile-link block transition hover:text-emerald-600">ติดต่อเรา</a>
            <div class="grid grid-cols-1 gap-3 pt-4">
                <a href="${QUOTE_LINE_URL}" target="_blank" rel="noopener noreferrer"
                    class="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-4 py-3 font-black text-white">
                    ขอใบเสนอราคา
                </a>
                <a href="popular-menu.html#app-order"
                    class="inline-flex items-center justify-center rounded-2xl border border-slate-200 px-4 py-3 font-black text-slate-800">
                    สั่งรายกล่องผ่านแอป
                </a>
            </div>
        </div>
    </div>
</nav>
`;
}

function getInlineFooterFallback() {
    return `
<footer class="bg-slate-950 pt-24 pb-12 text-slate-300">
    <div class="mx-auto grid max-w-7xl grid-cols-1 gap-12 px-4 md:grid-cols-4">
        <div class="space-y-7">
            <div class="flex items-center gap-3">
                <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 shadow-lg shadow-emerald-950/40">
                    <i data-lucide="utensils-cross" class="h-6 w-6 text-white"></i>
                </div>
                <div>
                    <div class="text-2xl font-black uppercase tracking-tight text-white">EED HALAL</div>
                    <div class="text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-400">20+ Box Orders</div>
                </div>
            </div>
            <p class="max-w-sm text-sm leading-7 text-slate-400">
                ครัวฮาลาลสำหรับองค์กร งานประชุม งานสัมมนา และอีเวนต์ในกรุงเทพฯ
                เน้นความน่าเชื่อถือ การจัดส่งตรงเวลา และการดูแลออเดอร์จำนวนมากอย่างเป็นระบบ
            </p>
        </div>
        <div>
            <h4 class="mb-6 text-sm font-black uppercase tracking-[0.28em] text-white">บริการหลัก</h4>
            <ul class="space-y-3 text-sm text-slate-400">
                <li><a href="corporate.html" class="transition hover:text-emerald-400">ข้าวกล่องประชุมและสัมมนา</a></li>
                <li><a href="catering.html" class="transition hover:text-emerald-400">บริการจัดเลี้ยงฮาลาล</a></li>
                <li><a href="hospital-orders.html" class="transition hover:text-emerald-400">ออเดอร์โรงพยาบาลและหน่วยงาน</a></li>
                <li><a href="popular-menu.html" class="transition hover:text-emerald-400">เมนูตัวอย่าง</a></li>
            </ul>
        </div>
        <div>
            <h4 class="mb-6 text-sm font-black uppercase tracking-[0.28em] text-white">ช่องทางสั่ง</h4>
            <ul class="space-y-3 text-sm text-slate-400">
                <li><a href="${QUOTE_LINE_URL}" target="_blank" rel="noopener noreferrer" class="transition hover:text-emerald-400">ขอใบเสนอราคา</a></li>
                <li><a href="popular-menu.html#app-order" class="transition hover:text-emerald-400">สั่งรายกล่องผ่านแอป</a></li>
                <li><a href="order-steps.html" class="transition hover:text-emerald-400">ดูขั้นตอนสั่งงาน</a></li>
                <li><a href="contact.html" class="transition hover:text-emerald-400">ติดต่อเรา</a></li>
            </ul>
        </div>
        <div>
            <div class="rounded-[28px] border border-slate-800 bg-slate-900 p-6">
                <div class="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">โทรศัพท์</div>
                <a href="${PHONE_HREF}" class="mt-2 block text-2xl font-black text-emerald-400">${PHONE_DISPLAY}</a>
                <div class="mt-4 text-sm leading-6 text-slate-400">
                    รับงานองค์กร 20+ กล่อง และลูกค้ารายกล่องสามารถสั่งผ่านแอปเดลิเวอรี่ได้
                </div>
            </div>
        </div>
    </div>
</footer>
`;
}

function getAvailableDeliveryApps() {
    return DELIVERY_APPS.filter((app) => typeof app.href === 'string' && app.href.trim());
}

function renderDeliveryAppsMarkup(options = {}) {
    const title = options.title || 'สั่งรายกล่องผ่านแอป';
    const copy = options.copy || 'สำหรับออเดอร์รายกล่อง สามารถกดเข้าแอปที่สะดวกได้ทันที';
    const compact = options.compact === true;
    const apps = getAvailableDeliveryApps();

    if (!apps.length) {
        return `
            <div class="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
                ยังไม่ได้ตั้งค่าลิงก์แอปเดลิเวอรี่ในหน้านี้
            </div>
        `;
    }

    return `
        <div class="${compact ? 'rounded-3xl border border-slate-200 bg-white p-6' : 'rounded-[36px] border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50'}">
            <div class="mb-6">
                <div class="text-xs font-black uppercase tracking-[0.28em] text-emerald-600">Delivery Apps</div>
                <h3 class="mt-2 text-2xl font-black text-slate-900">${escapeHtml(title)}</h3>
                <p class="mt-2 text-sm leading-6 text-slate-500">${escapeHtml(copy)}</p>
            </div>
            <div class="grid gap-3 ${compact ? 'sm:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-4'}">
                ${apps.map((app) => `
                    <a href="${escapeHtml(app.href)}" target="_blank" rel="noopener noreferrer"
                        class="group rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50">
                        <div class="text-sm font-black uppercase tracking-[0.18em] text-slate-900">${escapeHtml(app.name)}</div>
                        <div class="mt-1 text-xs leading-5 text-slate-500">${escapeHtml(app.description)}</div>
                        <div class="mt-3 inline-flex items-center text-xs font-black uppercase tracking-[0.18em] text-emerald-600">
                            เปิดแอป
                        </div>
                    </a>
                `).join('')}
            </div>
        </div>
    `;
}

function hydrateLinks() {
    document.querySelectorAll('[data-quote-link]').forEach((link) => {
        link.setAttribute('href', QUOTE_LINE_URL);
        if (!link.hasAttribute('target')) link.setAttribute('target', '_blank');
        if (!link.hasAttribute('rel')) link.setAttribute('rel', 'noopener noreferrer');
    });

    document.querySelectorAll('[data-phone-link]').forEach((link) => {
        link.setAttribute('href', PHONE_HREF);
        link.textContent = PHONE_DISPLAY;
    });
}

async function hydrateDeliveryAppsBlocks() {
    const containers = document.querySelectorAll('[data-delivery-apps]');
    if (!containers.length) return;

    containers.forEach((container) => {
        const compact = container.dataset.deliveryApps === 'compact';
        container.innerHTML = renderDeliveryAppsMarkup({
            title: container.dataset.title,
            copy: container.dataset.copy,
            compact
        });
    });

    await initLucideIcons(document.body);
}

function normalizeMenuItem(item, index = 0) {
    const normalized = {
        id: typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : `menu-${index + 1}`,
        name: typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : `เมนู ${index + 1}`,
        description: typeof item?.description === 'string' ? item.description.trim().replace(/^\[cost:[^\]]+\]\s*/i, '') : 'ไม่มีรายละเอียด',
        image: typeof item?.image === 'string' && item.image.trim() ? item.image.trim() : DEFAULT_MENU_IMAGE,
        tag: typeof item?.tag === 'string' ? item.tag.trim() : ''
    };

    return normalized;
}

async function getMenuData() {
    try {
        const response = await fetch('menu.json', { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return Array.isArray(data) ? data.map((item, index) => normalizeMenuItem(item, index)) : [];
    } catch (_error) {
        return [];
    }
}

function renderMenu(menu) {
    return menu.map((item) => `
        <article class="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
            <div class="grid gap-0 sm:grid-cols-[180px_minmax(0,1fr)]">
                <div class="h-52 sm:h-full">
                    <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}"
                        class="h-full w-full object-cover" loading="lazy" width="400" height="300">
                </div>
                <div class="flex flex-col p-6">
                    <div class="flex items-start justify-between gap-3">
                        <div>
                            <h3 class="text-2xl font-black tracking-tight text-slate-900">${escapeHtml(item.name)}</h3>
                            ${item.tag ? `<div class="mt-2 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-emerald-700">${escapeHtml(item.tag)}</div>` : ''}
                        </div>
                        <div class="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                            ราคาเช็กกับทีมงาน
                        </div>
                    </div>
                    <p class="mt-4 text-sm leading-7 text-slate-500">${escapeHtml(item.description)}</p>
                    <div class="mt-6 flex flex-wrap gap-3">
                        <a href="popular-menu.html#app-order"
                            class="inline-flex items-center rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-800 transition hover:border-emerald-300 hover:text-emerald-700">
                            สั่งรายกล่องผ่านแอป
                        </a>
                        <a href="${QUOTE_LINE_URL}" target="_blank" rel="noopener noreferrer"
                            class="inline-flex items-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-emerald-700">
                            ขอราคา 20+ กล่อง
                        </a>
                    </div>
                </div>
            </div>
        </article>
    `).join('');
}

async function loadMenu() {
    const menuGrid = document.getElementById('menu-grid');
    if (!menuGrid) return;

    const menu = await getMenuData();
    if (!menu.length) {
        menuGrid.innerHTML = `
            <div class="rounded-[30px] border border-slate-200 bg-white p-10 text-center">
                <h3 class="text-2xl font-black text-slate-900">ยังไม่มีรายการเมนู</h3>
                <p class="mt-3 text-slate-500">กรุณาตรวจสอบไฟล์เมนูหรือสอบถามทีมงานทาง LINE</p>
            </div>
        `;
        return;
    }

    menuGrid.innerHTML = renderMenu(menu);
}

function initMobileMenu() {
    const button = document.getElementById('mobile-menu-btn');
    const menu = document.getElementById('mobile-menu');
    const menuIcon = document.getElementById('menu-icon');
    const closeIcon = document.getElementById('close-icon');

    if (!button || !menu) return;

    button.addEventListener('click', () => {
        const isHidden = menu.classList.toggle('hidden');
        if (menuIcon && closeIcon) {
            menuIcon.classList.toggle('hidden', !isHidden);
            closeIcon.classList.toggle('hidden', isHidden);
        }
    });

    document.querySelectorAll('.mobile-link').forEach((link) => {
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
        if (!navMarkup) navMarkup = getInlineNavigationFallback();
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

        let footerMarkup = await safeFetchFirst(['footer.html', '../footer.html']);
        if (!footerMarkup) footerMarkup = getInlineFooterFallback();
        footerPlaceholder.innerHTML = footerMarkup;
    }

    hydrateLinks();
    await hydrateDeliveryAppsBlocks();
    if (document.getElementById('menu-grid')) await loadMenu();
    await initLucideIcons(document.body);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadComponents);
} else {
    loadComponents();
}
