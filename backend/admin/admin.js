const { createApp, ref, reactive, computed, onMounted, onBeforeUnmount, watch, nextTick } = Vue;

const ADMIN_CONFIG = {
  username: 'admin',
  password: 'admin123'
};

const SESSION_KEY = 'admin_session';
const STATUS_LABELS = {
  New: 'ใหม่',
  Cooking: 'กำลังทำ',
  Ready: 'พร้อมส่ง',
  Completed: 'เสร็จสิ้น'
};
const STATUS_OPTIONS = ['New', 'Cooking', 'Ready', 'Completed'];

const authService = {
  login(username, password) {
    const ok = username === ADMIN_CONFIG.username && password === ADMIN_CONFIG.password;
    if (!ok) return { ok: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
    const session = { user: username, loginAt: new Date().toISOString() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return { ok: true, session };
  },
  logout() {
    localStorage.removeItem(SESSION_KEY);
  },
  getSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch {
      return null;
    }
  }
};

async function apiRequest(method, path, body) {
  const targets = [path, `http://127.0.0.1:80${path}`];
  let lastError = null;

  for (const target of targets) {
    try {
      const response = await fetch(target, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        const message = payload?.message || payload?.detail || `request_failed_${response.status}`;
        if (response.status === 502 || message === 'backend_unreachable') {
          lastError = new Error(message);
          continue;
        }
        throw new Error(message);
      }
      return payload;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('network_error');
}

const ordersApi = {
  async list() {
    const payload = await apiRequest('GET', '/api/orders');
    return Array.isArray(payload.orders) ? payload.orders : [];
  },
  async confirm(id) {
    const payload = await apiRequest('PATCH', `/api/orders/${encodeURIComponent(id)}/confirm`);
    return payload.order;
  },
  async rejectSlip(id) {
    const payload = await apiRequest('PATCH', `/api/orders/${encodeURIComponent(id)}/reject-slip`);
    return payload.order;
  },
  async slipReceived(id) {
    const payload = await apiRequest('PATCH', `/api/orders/${encodeURIComponent(id)}/slip-received`);
    return payload.order;
  },
  async setStatus(id, data) {
    const payload = await apiRequest('PATCH', `/api/orders/${encodeURIComponent(id)}/status`, data);
    return payload.order;
  }
};

const menuApi = {
  async list() {
    const payload = await apiRequest('GET', '/api/menu');
    return Array.isArray(payload.items) ? payload.items : [];
  },
  async create(data) {
    const payload = await apiRequest('POST', '/api/menu', data);
    return payload.item;
  },
  async update(id, data) {
    const payload = await apiRequest('PUT', `/api/menu/${encodeURIComponent(id)}`, data);
    return payload.item;
  },
  async remove(id) {
    await apiRequest('DELETE', `/api/menu/${encodeURIComponent(id)}`);
  }
};

const customersApi = {
  async list() {
    const payload = await apiRequest('GET', '/api/customers');
    return payload.customers || {};
  },
  async upsert(data) {
    const payload = await apiRequest('POST', '/api/customers/upsert', data);
    return payload.customer;
  },
  async remove(phoneKey) {
    await apiRequest('DELETE', `/api/customers/${encodeURIComponent(phoneKey)}`);
  }
};

const reportsApi = {
  async getMenuPerformance(days = 7) {
    const payload = await apiRequest('GET', `/api/reports/menu-performance?days=${days}`);
    return payload;
  }
};

const aiSuggestionsApi = {
  async getSuggestions() {
    const payload = await apiRequest('GET', '/api/ai/promotion-suggestions');
    return payload;
  }
};

const promotionApi = {
  async list() {
    const payload = await apiRequest('GET', '/api/promotions');
    return payload.promotions || [];
  },
  async create(data) {
    const payload = await apiRequest('POST', '/api/promotions', data);
    return payload.promotion;
  }
};

const state = reactive({
  orders: [],
  customers: [],
  menu: [],
  recommendations: [],
  isReportLoading: false,
  aiSuggestions: [],
  isAiLoading: false,
  aiError: '',
  aiAnalysisTimestamp: '',
  aiDataSnapshot: {}
});

const dashboardService = {
  getMetrics() {
    const pending = state.orders.filter((o) => o.status !== 'Completed').length;
    const completed = state.orders.filter((o) => o.status === 'Completed').length;
    const avgBill = state.menu.length ? Math.round(state.menu.reduce((sum, m) => sum + m.price, 0) / state.menu.length) : 0;
    return [
      { label: 'กำไรสุทธิ (จำลอง)', value: '฿12,450', trend: '+12%', positive: true, icon: 'trending-up' },
      { label: 'ออเดอร์รอดำเนินการ', value: String(pending), trend: 'สด', positive: false, icon: 'zap' },
      { label: 'ออเดอร์เสร็จสิ้น', value: String(completed), trend: '+3%', positive: true, icon: 'check-circle-2' },
      { label: 'ราคาเฉลี่ยเมนู', value: `฿${avgBill}`, trend: '-2%', positive: false, icon: 'shopping-bag' }
    ];
  },
  async generateRecommendations() {
    state.isReportLoading = true;
    try {
      const report = await reportsApi.getMenuPerformance(7);
      const recs = [];
      const rows = Array.isArray(report.rows) ? report.rows : [];

      for (const row of rows) {
        if (row.flags.includes('best_seller')) {
          // Suggest a bundle for best sellers
          const otherItems = state.menu.filter(m => m.id !== row.menuId && m.status !== 'ซ่อน');
          if (otherItems.length > 0) {
            const randomOther = otherItems[Math.floor(Math.random() * otherItems.length)];
            const bundlePrice = Math.round((row.price + randomOther.price) * 0.9);
            recs.push({
              type: 'bundle',
              menuId: row.menuId,
              name: `${row.name} + ${randomOther.name}`,
              image: row.image,
              actionLabel: 'Value Bundle',
              reason: 'เมนูขายดี! แนะนำให้ทำชุดคอมโบเพื่อเพิ่มยอดขายเฉลี่ย',
              price: row.price + randomOther.price,
              suggestedPrice: bundlePrice,
              targetMenuIds: [row.menuId, randomOther.id]
            });
          }
        } else if (row.flags.includes('unsold_7d')) {
          // Suggest clearance for unsold items
          const suggestedPrice = Math.round(row.price * 0.8);
          recs.push({
            type: 'clearance_percent',
            menuId: row.menuId,
            name: row.name,
            image: row.image,
            actionLabel: 'Clearance Sale',
            reason: 'เมนูเงียบเหงา! แนะนำการลดราคา 20% เพื่อกระตุ้นความสนใจ',
            price: row.price,
            suggestedPrice: suggestedPrice,
            discountPercent: 20,
            targetMenuIds: [row.menuId]
          });
        }
      }
      state.recommendations = recs.slice(0, 4); // Limit to 4 recommendations
    } catch (error) {
      console.error('Failed to generate recommendations:', error);
    } finally {
      state.isReportLoading = false;
    }
  }
};

const ordersService = {
  list() { return state.orders; },
  set(list) { state.orders = Array.isArray(list) ? list : []; },
  replace(order) {
    const index = state.orders.findIndex((row) => row.id === order?.id);
    if (index === -1) return;
    state.orders[index] = order;
  }
};

const customersService = {
  list() { return state.customers; },
  set(list) { state.customers = Array.isArray(list) ? list : []; }
};

const menuService = {
  list() { return state.menu; },
  set(list) { state.menu = Array.isArray(list) ? list : []; }
};

createApp({
  setup() {
    const activeTab = ref('dashboard');
    const currentTime = ref(new Date().toLocaleTimeString('th-TH'));
    const isAuthenticated = ref(Boolean(authService.getSession()));
    const loginForm = reactive({ username: '', password: '' });
    const loginError = ref('');
    const isOrdersLoading = ref(false);
    const isMenuLoading = ref(false);
    const isCustomersLoading = ref(false);
    const ordersError = ref('');
    const menuError = ref('');
    const customersError = ref('');
    const lastOrdersLoadedAt = ref('');
    const statusDraftById = reactive({});
    const noteDraftById = reactive({});
    const isUpdatingById = reactive({});
    const toast = reactive({ show: false, type: 'success', message: '' });
    const isMenuModalOpen = ref(false);
    const editingMenuId = ref('');
    const isCustomerModalOpen = ref(false);
    const newMenuForm = reactive({
      name: '',
      image: '',
      price: '',
      cost: '',
      description: '',
      status: 'ใช้งาน'
    });
    const newCustomerForm = reactive({
      name: '',
      phone: '',
      address: ''
    });
    let timer = null;
    let toastTimer = null;

    const menuItems = [
      { id: 'dashboard', icon: 'layout-dashboard', label: 'แดชบอร์ด' },
      { id: 'orders', icon: 'package', label: 'ออเดอร์' },
      { id: 'customers', icon: 'users', label: 'ลูกค้า' },
      { id: 'menu', icon: 'chef-hat', label: 'เมนู' },
      { id: 'stats', icon: 'bar-chart-3', label: 'สถิติ' }
    ];

    const tabTitle = computed(() => {
      const map = {
        dashboard: 'ระบบบัญชาการหลังบ้าน',
        orders: 'ระบบจัดการออเดอร์สด',
        customers: 'ฐานข้อมูลลูกค้า',
        menu: 'คลังเมนูและต้นทุน',
        stats: 'รายงานภาพรวม'
      };
      return map[activeTab.value] || 'ระบบบัญชาการหลังบ้าน';
    });

    const metrics = computed(() => dashboardService.getMetrics());
    const chartData = ref([40, 65, 45, 90, 85, 55, 75, 95, 100, 60]);
    const orders = computed(() => ordersService.list());
    const customers = computed(() => customersService.list());
    const menu = computed(() => menuService.list());
    const recommendations = computed(() => state.recommendations);
    const isReportLoading = computed(() => state.isReportLoading);

    function showToast(message, type = 'success') {
      toast.type = type;
      toast.message = message;
      toast.show = true;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.show = false;
      }, 2500);
    }

    function formatOrderTime(order) {
      const source = order?.statusUpdatedAt || order?.createdAt;
      if (!source) return '-';
      const date = new Date(source);
      if (Number.isNaN(date.getTime())) return '-';
      return date.toLocaleString('th-TH', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit'
      });
    }

    function formatOrderItems(order) {
      const items = Array.isArray(order?.items) ? order.items : [];
      if (!items.length) return '-';
      return items
        .map((item) => `${item.name || 'เมนู'} x${item.quantity || 1}`)
        .join(', ');
    }

    function formatOrderType(order) {
      return order?.customerSegment || '-';
    }

    function mapCustomersMapToList(customersMap) {
      return Object.values(customersMap || {}).map((customer) => ({
        ...customer,
        id: customer.phoneKey || customer.phone || `CUS-${Date.now()}`,
        phone: customer.phone || customer.phoneKey || '-',
        address: customer.address || '-',
        totalSpent: Number(customer.totalSpent || 0),
        lastOrder: customer.lastOrderAt
          ? new Date(customer.lastOrderAt).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
          : '-',
        rating: '5.0'
      }));
    }

    function extractMenuCost(descriptionRaw) {
      const description = String(descriptionRaw || '');
      const match = description.match(/^\[cost:([0-9]+(?:\.[0-9]+)?)\]/i);
      if (!match) return 0;
      const parsed = Number(match[1]);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function removeCostPrefix(descriptionRaw) {
      return String(descriptionRaw || '').replace(/^\[cost:[^\]]+\]\s*/i, '');
    }

    function buildMenuDescription(cost, descriptionRaw = '') {
      const safeCost = Number.isFinite(Number(cost)) ? Number(cost) : 0;
      return `[cost:${safeCost}] ${removeCostPrefix(descriptionRaw)}`.trim();
    }

    function statusToThai(status) {
      return STATUS_LABELS[status] || status || '-';
    }

    function renderIcons() {
      nextTick(() => {
        if (window.lucide) window.lucide.createIcons();
      });
    }

    async function loadOrders() {
      isOrdersLoading.value = true;
      ordersError.value = '';
      try {
        const rows = await ordersApi.list();
        ordersService.set(rows);
        for (const order of rows) {
          statusDraftById[order.id] = order.status || 'New';
          noteDraftById[order.id] = order.adminNote || '';
        }
        lastOrdersLoadedAt.value = new Date().toLocaleTimeString('th-TH');
      } catch (error) {
        ordersError.value = `โหลดออเดอร์ไม่สำเร็จ: ${error.message}`;
        showToast(ordersError.value, 'error');
      } finally {
        isOrdersLoading.value = false;
      }
    }

    async function loadMenu() {
      isMenuLoading.value = true;
      menuError.value = '';
      try {
        const rows = await menuApi.list();
        const mapped = rows.map((item) => ({
          ...item,
          cost: extractMenuCost(item.description),
          cleanDescription: removeCostPrefix(item.description),
          status: item.tag || 'ใช้งาน'
        }));
        menuService.set(mapped);
      } catch (error) {
        menuError.value = `โหลดเมนูไม่สำเร็จ: ${error.message}`;
        showToast(menuError.value, 'error');
      } finally {
        isMenuLoading.value = false;
      }
    }

    async function loadCustomers() {
      isCustomersLoading.value = true;
      customersError.value = '';
      try {
        const customersMap = await customersApi.list();
        customersService.set(mapCustomersMapToList(customersMap));
      } catch (error) {
        customersError.value = `โหลดลูกค้าไม่สำเร็จ: ${error.message}`;
        showToast(customersError.value, 'error');
      } finally {
        isCustomersLoading.value = false;
      }
    }

    async function loadAiSuggestions() {
      state.isAiLoading = true;
      state.aiError = '';
      try {
        const result = await aiSuggestionsApi.getSuggestions();
        state.aiSuggestions = result.suggestions || [];
        state.aiAnalysisTimestamp = result.analysisTimestamp || '';
        state.aiDataSnapshot = result.dataSnapshot || {};
      } catch (error) {
        state.aiError = `โหลดคำแนะนำ AI ไม่สำเร็จ: ${error.message}`;
      } finally {
        state.isAiLoading = false;
      }
    }

    async function loadPerformanceReport() {
      await dashboardService.generateRecommendations();
      renderIcons();
    }

    async function applyRecommendation(rec) {
      try {
        const data = {
          type: rec.type,
          label: rec.actionLabel,
          status: 'active'
        };

        if (rec.type === 'bundle') {
          data.bundleMenuIds = rec.targetMenuIds;
          data.bundlePrice = rec.suggestedPrice;
        } else {
          data.targetMenuIds = rec.targetMenuIds;
          data.discountPercent = rec.discountPercent;
        }

        await promotionApi.create(data);
        showToast(`ใช้โปรโมชั่น ${rec.name} แล้ว`, 'success');
        // Remove from recommendations after applying
        state.recommendations = state.recommendations.filter(r => r.menuId !== rec.menuId || (rec.type === 'bundle' && r.name !== rec.name));
      } catch (error) {
        showToast(`ใช้โปรโมชั่นไม่สำเร็จ: ${error.message}`, 'error');
      }
    }

    async function runOrderAction(orderId, runner, successMessage) {
      isUpdatingById[orderId] = true;
      try {
        const updated = await runner();
        if (updated?.id) {
          ordersService.replace(updated);
          statusDraftById[updated.id] = updated.status || 'New';
          noteDraftById[updated.id] = updated.adminNote || '';
        }
        showToast(successMessage, 'success');
      } catch (error) {
        showToast(`อัปเดตออเดอร์ไม่สำเร็จ: ${error.message}`, 'error');
      } finally {
        isUpdatingById[orderId] = false;
      }
    }

    async function confirmOrder(order) {
      await runOrderAction(order.id, () => ordersApi.confirm(order.id), `ยืนยันออเดอร์ ${order.id} แล้ว`);
    }

    async function rejectSlip(order) {
      await runOrderAction(order.id, () => ordersApi.rejectSlip(order.id), `ตีกลับสลิปออเดอร์ ${order.id} แล้ว`);
    }

    async function markSlipReceived(order) {
      await runOrderAction(order.id, () => ordersApi.slipReceived(order.id), `รับสลิปออเดอร์ ${order.id} แล้ว`);
    }

    async function updateOrderStatus(order) {
      const status = statusDraftById[order.id] || 'New';
      const adminNote = String(noteDraftById[order.id] || '');
      await runOrderAction(
        order.id,
        () => ordersApi.setStatus(order.id, { status, adminNote }),
        `อัปเดตสถานะออเดอร์ ${order.id} แล้ว`
      );
    }

    function calcMargin(item) {
      if (!item.price) return '0%';
      return `${Math.max(0, Math.round(((item.price - item.cost) / item.price) * 100))}%`;
    }

    function doLogin() {
      loginError.value = '';
      const result = authService.login(loginForm.username.trim(), loginForm.password);
      if (!result.ok) {
        loginError.value = result.message;
        return;
      }
      isAuthenticated.value = true;
      activeTab.value = 'dashboard';
      loadOrders();
      loadMenu();
      loadCustomers();
      renderIcons();
    }

    function doLogout() {
      authService.logout();
      isAuthenticated.value = false;
      loginForm.username = '';
      loginForm.password = '';
      loginError.value = '';
    }

    function resetNewMenuForm() {
      newMenuForm.name = '';
      newMenuForm.image = '';
      newMenuForm.price = '';
      newMenuForm.cost = '';
      newMenuForm.description = '';
      newMenuForm.status = 'ใช้งาน';
    }

    function openMenuModal() {
      resetNewMenuForm();
      editingMenuId.value = '';
      isMenuModalOpen.value = true;
    }

    function closeMenuModal() {
      isMenuModalOpen.value = false;
      editingMenuId.value = '';
    }

    function openEditMenuModal(item) {
      editingMenuId.value = String(item?.id || '');
      newMenuForm.name = String(item?.name || '');
      newMenuForm.image = String(item?.image || '');
      newMenuForm.price = String(item?.price ?? '');
      newMenuForm.cost = String(item?.cost ?? '');
      newMenuForm.description = String(item?.cleanDescription || '');
      newMenuForm.status = String(item?.status || item?.tag || 'ใช้งาน');
      isMenuModalOpen.value = true;
    }

    async function submitNewMenu() {
      const isEditing = Boolean(editingMenuId.value);
      const name = String(newMenuForm.name || '').trim();
      const image = String(newMenuForm.image || '').trim();
      const price = Number(newMenuForm.price);
      const cost = Number(newMenuForm.cost);

      if (!name) {
        showToast('กรุณากรอกชื่อเมนู', 'error');
        return;
      }
      if (!image) {
        showToast('เมนูต้องมีรูปภาพ', 'error');
        return;
      }
      if (!Number.isFinite(price) || price < 0) {
        showToast('กรุณากรอกราคาขายให้ถูกต้อง', 'error');
        return;
      }
      if (!Number.isFinite(cost) || cost < 0) {
        showToast('กรุณากรอกต้นทุนให้ถูกต้อง', 'error');
        return;
      }

      try {
        if (isEditing) {
          const current = state.menu.find((m) => m.id === editingMenuId.value) || {};
          await menuApi.update(editingMenuId.value, {
            id: editingMenuId.value,
            name,
            image,
            price,
            description: buildMenuDescription(cost, newMenuForm.description || ''),
            tag: String(newMenuForm.status || 'ใช้งาน')
          });
        } else {
          await menuApi.create({
            name,
            image,
            price,
            description: buildMenuDescription(cost, newMenuForm.description || ''),
            tag: String(newMenuForm.status || 'ใช้งาน')
          });
        }
        await loadMenu();
        closeMenuModal();
        showToast(`${isEditing ? 'แก้ไข' : 'เพิ่ม'}เมนู ${name} สำเร็จ`, 'success');
      } catch (error) {
        showToast(`${isEditing ? 'แก้ไข' : 'เพิ่ม'}เมนูไม่สำเร็จ: ${error.message}`, 'error');
      }
    }

    function onMenuImageFileChange(event) {
      const input = event?.target;
      const file = input?.files?.[0];
      if (!file) return;
      if (!String(file.type || '').startsWith('image/')) {
        showToast('กรุณาเลือกไฟล์รูปภาพเท่านั้น', 'error');
        input.value = '';
        return;
      }
      const rawReader = new FileReader();
      rawReader.onload = () => {
        const image = new Image();
        image.onload = () => {
          const maxSide = 1280;
          const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
          const width = Math.max(1, Math.round(image.width * scale));
          const height = Math.max(1, Math.round(image.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            showToast('เตรียมรูปภาพไม่สำเร็จ', 'error');
            return;
          }
          ctx.drawImage(image, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          if (dataUrl.length > 7_000_000) {
            showToast('รูปใหญ่เกินไป กรุณาเลือกรูปขนาดเล็กลง', 'error');
            return;
          }
          newMenuForm.image = dataUrl;
        };
        image.onerror = () => {
          showToast('อ่านไฟล์รูปภาพไม่สำเร็จ', 'error');
        };
        image.src = String(rawReader.result || '');
      };
      rawReader.onerror = () => {
        showToast('อ่านไฟล์รูปภาพไม่สำเร็จ', 'error');
      };
      rawReader.readAsDataURL(file);
    }

    async function deleteMenuItem(item) {
      if (!confirm(`ลบเมนู ${item.name} ?`)) return;
      try {
        await menuApi.remove(item.id);
        await loadMenu();
        showToast(`ลบเมนู ${item.name} สำเร็จ`, 'success');
      } catch (error) {
        showToast(`ลบเมนูไม่สำเร็จ: ${error.message}`, 'error');
      }
    }

    function resetNewCustomerForm() {
      newCustomerForm.name = '';
      newCustomerForm.phone = '';
      newCustomerForm.address = '';
    }

    function openCustomerModal() {
      resetNewCustomerForm();
      isCustomerModalOpen.value = true;
    }

    function closeCustomerModal() {
      isCustomerModalOpen.value = false;
    }

    async function submitNewCustomer() {
      const name = String(newCustomerForm.name || '').trim();
      const phoneRaw = String(newCustomerForm.phone || '').trim();
      const address = String(newCustomerForm.address || '').trim();
      const phone = phoneRaw.replace(/\D/g, '');
      if (!name) {
        showToast('กรุณากรอกชื่อลูกค้า', 'error');
        return;
      }
      if (!phone) {
        showToast('กรุณากรอกเบอร์โทร', 'error');
        return;
      }
      if (!address) {
        showToast('กรุณากรอกที่อยู่จัดส่ง', 'error');
        return;
      }
      const duplicated = state.customers.some((customer) => String(customer.phone || '').replace(/\D/g, '') === phone);
      if (duplicated) {
        showToast('มีลูกค้านี้แล้วจากเบอร์โทรเดียวกัน', 'error');
        return;
      }

      try {
        await customersApi.upsert({
          phone,
          name,
          address,
          segment: 'Regular',
          note: '',
          orderCount: 0,
          totalSpent: 0
        });
        await loadCustomers();
        closeCustomerModal();
        showToast(`เพิ่มลูกค้า ${name} สำเร็จ`, 'success');
      } catch (error) {
        showToast(`เพิ่มลูกค้าไม่สำเร็จ: ${error.message}`, 'error');
      }
    }

    async function deleteCustomer(customer) {
      if (!confirm(`ลบลูกค้า ${customer.name} ?`)) return;
      const phoneKey = String(customer.phoneKey || customer.phone || '').replace(/\D/g, '');
      if (!phoneKey) {
        showToast('ไม่พบเบอร์โทรลูกค้า', 'error');
        return;
      }
      try {
        await customersApi.remove(phoneKey);
        await loadCustomers();
        showToast(`ลบลูกค้า ${customer.name} สำเร็จ`, 'success');
      } catch (error) {
        showToast(`ลบลูกค้าไม่สำเร็จ: ${error.message}`, 'error');
      }
    }

    onMounted(() => {
      timer = setInterval(() => {
        currentTime.value = new Date().toLocaleTimeString('th-TH');
      }, 1000);
      if (isAuthenticated.value) loadOrders();
      if (isAuthenticated.value) loadMenu();
      if (isAuthenticated.value) {
        loadCustomers();
        loadPerformanceReport();
        loadAiSuggestions();
      }
      renderIcons();
    });

    onBeforeUnmount(() => {
      if (timer) clearInterval(timer);
      if (toastTimer) clearTimeout(toastTimer);
    });

    watch([activeTab, isAuthenticated], ([tab, auth]) => {
      if (auth && tab === 'orders') loadOrders();
      if (auth && tab === 'menu') loadMenu();
      if (auth && tab === 'customers') loadCustomers();
      if (auth && tab === 'dashboard') {
        loadAiSuggestions();
        loadPerformanceReport();
      }
      renderIcons();
    });

    return {
      activeTab,
      currentTime,
      isAuthenticated,
      loginForm,
      loginError,
      menuItems,
      tabTitle,
      metrics,
      chartData,
      orders,
      isOrdersLoading,
      ordersError,
      menuError,
      customersError,
      lastOrdersLoadedAt,
      statusDraftById,
      noteDraftById,
      isUpdatingById,
      STATUS_OPTIONS,
      toast,
      formatOrderTime,
      formatOrderItems,
      formatOrderType,
      statusToThai,
      loadOrders,
      loadMenu,
      loadCustomers,
      confirmOrder,
      rejectSlip,
      markSlipReceived,
      updateOrderStatus,
      customers,
      menu,
      calcMargin,
      doLogin,
      doLogout,
      isMenuModalOpen,
      editingMenuId,
      isCustomerModalOpen,
      newMenuForm,
      newCustomerForm,
      openMenuModal,
      openEditMenuModal,
      closeMenuModal,
      submitNewMenu,
      onMenuImageFileChange,
      deleteMenuItem,
      addCustomer: openCustomerModal,
      openCustomerModal,
      closeCustomerModal,
      submitNewCustomer,
      deleteCustomer,
      recommendations,
      isReportLoading,
      loadPerformanceReport,
      applyRecommendation,
      aiSuggestions: state.aiSuggestions,
      isAiLoading: state.isAiLoading,
      aiError: state.aiError,
      aiAnalysisTimestamp: state.aiAnalysisTimestamp,
      aiDataSnapshot: state.aiDataSnapshot,
      loadAiSuggestions
    };
  }
}).mount('#app');
