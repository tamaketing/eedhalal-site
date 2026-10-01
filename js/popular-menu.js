/* EED HALAL — popular-menu renderer (production).
 *
 * Data comes from the site's central sources — nothing is duplicated here:
 *  - js/menu-data.js (EED_MENUS: id, name, image, desc, category) via <script>
 *  - data/planner-overrides.json -> deleted[] (menus hidden from customers)
 *
 * This page never shows prices: sale prices stay in the central data untouched
 * and are never rendered into the DOM, alt text, or structured data here.
 *
 * There is NO ordering flow on this site. It is a catalogue; every order is
 * placed over LINE. The planner's quoteOnly[] marks dishes whose cost the shop
 * has not confirmed, which decides whether the SHOP can quote a dish from its
 * own data - not whether a customer can buy it. So it is deliberately not
 * rendered here: labelling those dishes would invent a purchase path that does
 * not exist and would imply the other dishes are somehow different.
 * Copy buttons use the async clipboard API with a manual-selection fallback.
 */
(function () {
  'use strict';

  var LINE_URL = 'https://lin.ee/CfvqJTd'; // Single approved LINE channel.
  var GRID_ID = 'pm-grid';
  var LIST_ID = 'pm-list';
  var SEARCH_ID = 'pm-search';
  var FILTER_ID = 'pm-filter';
  var COUNT_ID = 'pm-count';
  var EMPTY_ID = 'pm-empty';

  var CATEGORIES = [
    { key: 'all', label: 'ทั้งหมด' },
    { key: 'ข้าวราดแกง', label: 'ข้าวราดแกง' },
    { key: 'ข้าวผัด', label: 'ข้าวผัด' },
    { key: 'เส้น', label: 'เส้น' },
    { key: 'อาหารอินเดีย', label: 'อาหารอินเดีย' },
    { key: 'พรีเมียม', label: 'พรีเมียม' }
  ];

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hasDishPhoto(menu) {
    var src = String(menu.image || '').replace(/^\.\.\//, '').replace(/^\//, '');
    return !!src && !/logo\.(png|jpg|jpeg|webp)$/i.test(src);
  }

  function imageCell(menu) {
    var firstChar = (menu.name || '').trim().charAt(0) || '•';
    // Safety net for genuinely broken image files only. Menus whose data
    // points at a brand logo (not a dish photo) render as compact rows
    // instead (see renderRow) — never a misleading image.
    var src = String(menu.image || '').replace(/^\.\.\//, '').replace(/^\//, '');
    if (!hasDishPhoto(menu)) {
      return '<div class="pm-photo-placeholder" aria-hidden="true"><span>' + escapeHtml(firstChar) + '</span></div>';
    }
    return '<img class="pm-photo" src="' + escapeHtml(src) + '" alt="' + escapeHtml(menu.name) + '" loading="lazy" data-fallback="' + escapeHtml(firstChar) + '">';
  }

  function copyButton() {
    return '<button class="pm-btn pm-copy-btn" type="button" data-copy-name>คัดลอกชื่อเมนู</button>';
  }

  function lineCta(label, source, extraClass) {
    return '<a class="pm-btn pm-btn-outline ' + (extraClass || '') + '" href="' + LINE_URL + '" target="_blank" rel="noopener noreferrer" data-track-event="lead_line_click" data-track-section="popular_menu" data-track-source="' + source + '">' + label + ' <span aria-hidden="true">↗</span></a>';
  }

function renderCard(menu) {
// NOTE: menu.price is deliberately never read here — no prices on this page.
  // The anchor id matches scripts/popular-menu-page.mjs so a shared deep link
  // (popular-menu.html#menu-17) lands on the dish before AND after this
  // renderer replaces the container.
    return '' +
      '<article class="pm-card" id="menu-' + escapeHtml(menu.id) + '" data-menu-id="' + escapeHtml(menu.id) + '">' +
        imageCell(menu) +
        '<div class="pm-card-body">' +
          '<p class="pm-card-cat">' + escapeHtml(menu.category) + '</p>' +
          '<h3 class="pm-card-name">' + escapeHtml(menu.name) + '</h3>' +
          (menu.desc ? '<p class="pm-card-desc">' + escapeHtml(menu.desc) + '</p>' : '') +
          lineCta('สอบถามเมนูนี้ทาง LINE', 'popular_menu_card', 'pm-card-cta') +
          copyButton() +
        '</div>' +
      '</article>';
  }

  function renderRow(menu) {
    return '' +
      '<div class="pm-row" id="menu-' + escapeHtml(menu.id) + '" data-menu-id="' + escapeHtml(menu.id) + '">' +
        '<div class="pm-row-text">' +
          '<p class="pm-row-cat">' + escapeHtml(menu.category) + '</p>' +
          '<p class="pm-row-name">' + escapeHtml(menu.name) + '</p>' +
        '</div>' +
        '<div class="pm-row-actions">' +
          lineCta('สอบถามทาง LINE', 'popular_menu_row', 'pm-row-cta') +
          copyButton() +
        '</div>' +
      '</div>';
  }

  function copyMenuName(button, nameEl) {
    var original = button.getAttribute('data-label') || button.textContent.trim();
    button.setAttribute('data-label', original);
    function flash(text, ms) {
      button.textContent = text;
      setTimeout(function () { button.textContent = original; }, ms || 2000);
    }
    function selectName() {
      // Fallback when the async clipboard is unavailable: select the dish
      // name in place so the customer can copy it manually.
      var range = document.createRange();
      range.selectNodeContents(nameEl);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    var text = nameEl.textContent || '';
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(
        function () { flash('คัดลอกแล้ว ✓'); },
        function () { selectName(); flash('เลือกชื่อไว้แล้ว กดคัดลอกเองได้เลย', 3500); }
      );
    } else {
      selectName();
      flash('เลือกชื่อไว้แล้ว กดคัดลอกเองได้เลย', 3500);
    }
  }

  function bindCopyButtons(root) {
    root.querySelectorAll('[data-copy-name]').forEach(function (button) {
      button.addEventListener('click', function () {
        var item = button.closest('.pm-card, .pm-row');
        var nameEl = item && item.querySelector('.pm-card-name, .pm-row-name');
        if (nameEl) copyMenuName(button, nameEl);
      });
    });
  }

  function bindImageFallbacks(root) {
    root.querySelectorAll('img.pm-photo').forEach(function (img) {
      img.addEventListener('error', function handle() {
        img.removeEventListener('error', handle);
        var holder = document.createElement('div');
        holder.className = 'pm-photo-placeholder';
        holder.setAttribute('aria-hidden', 'true');
        var label = document.createElement('span');
        label.textContent = img.getAttribute('data-fallback') || '•';
        holder.appendChild(label);
        img.replaceWith(holder);
      });
    });
  }

  function matchesFilter(item, query, category) {
    var name = item.querySelector('.pm-card-name, .pm-row-name').textContent || '';
    var cat = item.querySelector('.pm-card-cat, .pm-row-cat').textContent || '';
    var okQuery = !query || name.includes(query);
    var okCat = category === 'all' || cat === category;
    return okQuery && okCat;
  }

  function applyFilter() {
    var grid = document.getElementById(GRID_ID);
    var list = document.getElementById(LIST_ID);
    var query = document.getElementById(SEARCH_ID).value.trim();
    var category = document.getElementById(FILTER_ID).value;
    var count = document.getElementById(COUNT_ID);
    var empty = document.getElementById(EMPTY_ID);
    var shown = 0;
    var shownPhotos = 0;
    var shownPlain = 0;

    grid.querySelectorAll('.pm-card').forEach(function (card) {
      var show = matchesFilter(card, query, category);
      card.hidden = !show;
      if (show) { shown += 1; shownPhotos += 1; }
    });
    list.querySelectorAll('.pm-row').forEach(function (row) {
      var show = matchesFilter(row, query, category);
      row.hidden = !show;
      if (show) { shown += 1; shownPlain += 1; }
    });

    var total = grid.querySelectorAll('.pm-card').length + list.querySelectorAll('.pm-row').length;
    count.textContent = shown === total
      ? 'เมนูทั้งหมด ' + total + ' รายการ'
      : 'พบ ' + shown + ' จาก ' + total + ' เมนู';
    empty.hidden = shown !== 0;
    document.getElementById('pm-photo-heading').hidden = shownPhotos === 0;
    document.getElementById('pm-plain-heading').hidden = shownPlain === 0;
  }

  function buildFilter(counts) {
    var select = document.getElementById(FILTER_ID);
    select.innerHTML = '';
    CATEGORIES.forEach(function (cat) {
      var option = document.createElement('option');
      option.value = cat.key;
      var n = cat.key === 'all'
        ? Object.values(counts).reduce(function (a, b) { return a + b; }, 0)
        : (counts[cat.key] || 0);
      option.textContent = cat.label + ' (' + n + ')';
      select.appendChild(option);
    });
  }

  function render(menus) {
    var grid = document.getElementById(GRID_ID);
    var list = document.getElementById(LIST_ID);
    var counts = {};
    // Display order only: dishes with real photos first, then compact rows.
    // The central catalog order is never modified — groups keep it stable.
    var photoMenus = menus.filter(hasDishPhoto);
    var plainMenus = menus.filter(function (menu) { return !hasDishPhoto(menu); });
    grid.innerHTML = photoMenus.map(function (menu) {
      counts[menu.category] = (counts[menu.category] || 0) + 1;
      return renderCard(menu);
    }).join('');
    list.innerHTML = plainMenus.map(function (menu) {
      counts[menu.category] = (counts[menu.category] || 0) + 1;
      return renderRow(menu);
    }).join('');
    bindImageFallbacks(grid);
    bindCopyButtons(grid);
    bindCopyButtons(list);
    buildFilter(counts);
    document.getElementById(SEARCH_ID).addEventListener('input', applyFilter);
    document.getElementById(FILTER_ID).addEventListener('change', applyFilter);
    applyFilter();
  }

  // Visibility comes from the one published planner file: deleted[] means the
  // owner hid the dish from customers. Nothing else is read here - the cost gate
  // is an internal pricing matter and is not rendered.
  function loadHidden() {
    return fetch('data/planner-overrides.json', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : { deleted: [] }; })
      .then(function (data) { return new Set(data.deleted || []); })
      .catch(function () { return new Set(); });
  }

  function boot() {
    var menus = (typeof EED_MENUS !== 'undefined' && Array.isArray(EED_MENUS)) ? EED_MENUS : [];
    loadHidden().then(function (hidden) {
      var shown = menus.filter(function (menu) {
        return menu && menu.id != null &&
          !hidden.has(Number(menu.id)) && !hidden.has(String(menu.id));
      });
      render(shown);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
