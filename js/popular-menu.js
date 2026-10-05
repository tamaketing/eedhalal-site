/* EED HALAL — popular-menu renderer (production).
 *
 * Data comes from the site's central sources — nothing is duplicated here:
 *  - js/menu-data.js (EED_MENUS: id, name, price, image, desc, tier) via <script>
 *  - data/planner-overrides.json -> deleted[] (menus hidden from customers)
 *
 * Each card shows the per-box price from the published catalogue. A dish the
 * shop cannot quote from its own data (quoteOnly[]) carries no figure, so the
 * price on screen is always one EED can stand behind.
 *
 * There is NO ordering flow on this site. It is a catalogue; every order is
 * placed over LINE. Showing the price answers "how much?", not "order now" —
 * the CTA still routes to LINE. The planner's quoteOnly[] marks dishes whose
 * price the shop has switched off, and those are listed without a figure.
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
  // Tier names live in data/business-rules.json; the tier ids are the contract
  // shared with the generated tier table and the homepage cards. The tier is
  // the ONLY grouping a menu has: there is no category axis anywhere, so the
  // filter below replaces the old dish-type filter rather than sitting beside
  // it. Order here is the order the tier table and the level chips use.
  var TIER_LABELS = { classic: 'Classic', signature: 'Signature', executive: 'Executive' };
  var TIER_ORDER = ['classic', 'signature', 'executive'];
  var activeTier = null;

  function tierLabel(tier) {
    return TIER_LABELS[tier] || 'Classic';
  }

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

// Per-box price, matching scripts/popular-menu-page.mjs so the page does not
  // reflow when this renderer replaces the static markup. A dish with no
  // quotable price renders no figure rather than a zero.
  function priceCell(menu, extraClass) {
    var price = Number(menu.price);
    if (!isFinite(price) || price <= 0) return '';
    return '<p class="' + extraClass + '">' + price + ' บาท<span class="pm-price-unit">/ กล่อง</span></p>';
  }

  function renderCard(menu) {
  // The anchor id matches scripts/popular-menu-page.mjs so a shared deep link
  // (popular-menu.html#menu-17) lands on the dish before AND after this
  // renderer replaces the container.
    return '' +
      '<article class="pm-card" id="menu-' + escapeHtml(menu.id) + '" data-menu-id="' + escapeHtml(menu.id) + '" data-tier="' + escapeHtml(menu.tier || 'classic') + '">' +
        imageCell(menu) +
        '<div class="pm-card-body">' +
          '<p class="pm-card-tier">' + escapeHtml(tierLabel(menu.tier)) + '</p>' +
          '<h3 class="pm-card-name">' + escapeHtml(menu.name) + '</h3>' +
          (menu.desc ? '<p class="pm-card-desc">' + escapeHtml(menu.desc) + '</p>' : '') +
          priceCell(menu, 'pm-card-price') +
          lineCta('สั่งเมนูนี้', 'popular_menu_card', 'pm-card-cta') +
          copyButton() +
        '</div>' +
      '</article>';
  }

  function renderRow(menu) {
    return '' +
      '<div class="pm-row" id="menu-' + escapeHtml(menu.id) + '" data-menu-id="' + escapeHtml(menu.id) + '" data-tier="' + escapeHtml(menu.tier || 'classic') + '">' +
        '<div class="pm-row-text">' +
          '<p class="pm-row-tier">' + escapeHtml(tierLabel(menu.tier)) + '</p>' +
          '<p class="pm-row-name">' + escapeHtml(menu.name) + '</p>' +
          priceCell(menu, 'pm-row-price') +
        '</div>' +
        '<div class="pm-row-actions">' +
          lineCta('สั่งเมนูนี้', 'popular_menu_row', 'pm-row-cta') +
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

  function matchesFilter(item, query, tier) {
    var name = item.querySelector('.pm-card-name, .pm-row-name').textContent || '';
    var okQuery = !query || name.includes(query);
    var okTier = !tier || (item.getAttribute('data-tier') || 'classic') === tier;
    return okQuery && okTier;
  }

  function applyFilter() {
    var grid = document.getElementById(GRID_ID);
    var list = document.getElementById(LIST_ID);
    var query = document.getElementById(SEARCH_ID).value.trim();
    var select = document.getElementById(FILTER_ID);
    // One source of truth for the active level: the dropdown writes activeTier,
    // a #tier-<id> deep link clears the dropdown. They can never disagree.
    if (select && select.value !== (activeTier || 'all')) select.value = activeTier || 'all';
    var count = document.getElementById(COUNT_ID);
    var empty = document.getElementById(EMPTY_ID);
    var shown = 0;
    var shownPhotos = 0;
    var shownPlain = 0;

    grid.querySelectorAll('.pm-card').forEach(function (card) {
      var show = matchesFilter(card, query, activeTier);
      card.hidden = !show;
      if (show) { shown += 1; shownPhotos += 1; }
    });
    list.querySelectorAll('.pm-row').forEach(function (row) {
      var show = matchesFilter(row, query, activeTier);
      row.hidden = !show;
      if (show) { shown += 1; shownPlain += 1; }
    });

    var total = grid.querySelectorAll('.pm-card').length + list.querySelectorAll('.pm-row').length;
    count.textContent = shown === total
      ? 'ตอนนี้มี ' + total + ' เมนูให้เลือก'
      : 'เห็น ' + shown + ' จาก ' + total + ' เมนู';
    if (activeTier) count.textContent += ' · ระดับ ' + tierLabel(activeTier);
    empty.hidden = shown !== 0;
    document.getElementById('pm-photo-heading').hidden = shownPhotos === 0;
    document.getElementById('pm-plain-heading').hidden = shownPlain === 0;
  }

  // The dropdown offers "ทั้งหมด" plus only the levels this catalogue actually
  // serves, so a customer never picks a level that returns nothing.
  function buildFilter(counts) {
    var select = document.getElementById(FILTER_ID);
    select.innerHTML = '';
    var total = Object.keys(counts).reduce(function (a, id) { return a + counts[id]; }, 0);
    var options = [{ key: 'all', label: 'ทั้งหมด (' + total + ')' }];
    TIER_ORDER.forEach(function (id) {
      if (!counts[id]) return;
      options.push({ key: id, label: tierLabel(id) + ' (' + counts[id] + ')' });
    });
    options.forEach(function (option) {
      var element = document.createElement('option');
      element.value = option.key;
      element.textContent = option.label;
      select.appendChild(element);
    });
    select.value = activeTier || 'all';
  }

  function render(menus) {
    var grid = document.getElementById(GRID_ID);
    var list = document.getElementById(LIST_ID);
    var counts = {};
    // Display order only: dishes with real photos first, then compact rows.
    // The central catalog order is never modified — groups keep it stable.
    var photoMenus = menus.filter(hasDishPhoto);
    var plainMenus = menus.filter(function (menu) { return !hasDishPhoto(menu); });
    function count(menu) {
      var id = menu.tier || 'classic';
      counts[id] = (counts[id] || 0) + 1;
    }
    grid.innerHTML = photoMenus.map(function (menu) {
      count(menu);
      return renderCard(menu);
    }).join('');
    list.innerHTML = plainMenus.map(function (menu) {
      count(menu);
      return renderRow(menu);
    }).join('');
    bindImageFallbacks(grid);
    bindCopyButtons(grid);
    bindCopyButtons(list);
    buildFilter(counts);
    document.getElementById(SEARCH_ID).addEventListener('input', applyFilter);
    // The dropdown IS the level filter now, so choosing an option sets the same
    // activeTier a #tier-<id> deep link would.
    document.getElementById(FILTER_ID).addEventListener('change', function () {
      var value = document.getElementById(FILTER_ID).value;
      activeTier = value && value !== 'all' ? value : null;
      applyFilter();
    });
    applyFilter();
  }

  // Visibility comes from the one published planner file: deleted[] means the
  // owner hid the dish from customers. Nothing else is read here - the price
  // switch is an internal pricing matter and is not rendered.
  function loadHidden() {
    return fetch('data/planner-overrides.json', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : { deleted: [] }; })
      .then(function (data) { return new Set(data.deleted || []); })
      .catch(function () { return new Set(); });
  }

  function boot() {
    var menus = (typeof EED_MENUS !== 'undefined' && Array.isArray(EED_MENUS)) ? EED_MENUS : [];
    activeTier = tierFromHash();
    loadHidden().then(function (hidden) {
      var shown = menus.filter(function (menu) {
        return menu && menu.id != null &&
          !hidden.has(Number(menu.id)) && !hidden.has(String(menu.id));
      });
      render(shown);
      bindTierLinks();
    });
  }

  // The tier table and the homepage cards link to #tier-<id>: the tier is
  // applied as a filter and the browser scrolls to the list. Clicking the same
  // tier link again clears it, so the customer is never trapped in a filter.
  function tierFromHash() {
    var match = /#tier-(classic|signature|executive)$/.exec(window.location.hash || '');
    return match ? match[1] : null;
  }

  function bindTierLinks() {
    document.addEventListener('click', function (event) {
      var link = event.target.closest && event.target.closest('a[href*="#tier-"]');
      if (!link) return;
      var tier = /#tier-(classic|signature|executive)$/.exec(link.getAttribute('href') || '');
      if (!tier) return;
      event.preventDefault();
      var same = activeTier === tier[1];
      activeTier = same ? null : tier[1];
      applyFilter();
      var grid = document.getElementById(GRID_ID);
      if (grid && grid.scrollIntoView) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
