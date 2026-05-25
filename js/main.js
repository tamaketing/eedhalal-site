(function() {
  'use strict';

  var QUOTE_LINE_URL = 'https://lin.ee/CfvqJTd';
  var LINE_OA_ID = '@EEDHALAL';
  var PHONE_DISPLAY = '098-871-5179';
  var PHONE_HREF = 'tel:+66988715179';
  var HOME_PATH = '/index.html';
  var CORPORATE_PATH = '/corporate.html';
  var MENU_PATH = '/popular-menu.html';
  var CONTACT_PATH = '/contact.html';
  var CATERING_PATH = '/catering.html';
  var ORDER_STEPS_PATH = '/order-steps.html';
  var DELIVERY_AREA_PATH = '/delivery-area.html';
  var HALAL_CERT_PATH = '/halal-cert.html';
  var REVIEWS_PATH = '/reviews.html';
  var FAQ_PATH = '/faq.html';
  var SATHORN_PATH = '/sathorn-silom.html';
  var SUKHUMVIT_PATH = '/sukhumvit.html';
  var RAMA3_PATH = '/rama3.html';
  var LADPRAO_PATH = '/ladprao.html';
  var BLOG_HALAL_VS_NORMAL_PATH = '/blog/halal-vs-normal.html';
  var BLOG_HOW_TO_CHOOSE_PATH = '/blog/how-to-choose.html';
  var BLOG_CICOT_PATH = '/blog/cicot-explained.html';
  var LOGO_PATH = '/img/logo.jpg';

  function getNavHTML() {
    return '\
<header class="site-header">\
  <div class="header-inner">\
    <a href="' + HOME_PATH + '" class="logo-link">\
      <img src="' + LOGO_PATH + '" alt="EED HALAL" class="logo-img">\
      <div class="logo-text">\
        <div class="logo-title">EED HALAL</div>\
        <span class="cicot-badge">CICOT \u2713</span>\
      </div>\
    </a>\
    <nav class="nav-desktop">\
      <a href="' + HOME_PATH + '" class="nav-link">\u0e2b\u0e19\u0e49\u0e32\u0e41\u0e23\u0e01</a>\
      <a href="' + CORPORATE_PATH + '" class="nav-link">\u0e2d\u0e2d\u0e40\u0e14\u0e2d\u0e23\u0e4c\u0e2d\u0e07\u0e04\u0e4c\u0e01\u0e23</a>\
      <a href="' + MENU_PATH + '" class="nav-link">\u0e40\u0e21\u0e19\u0e39</a>\
      <a href="' + CONTACT_PATH + '" class="nav-link">\u0e15\u0e34\u0e14\u0e15\u0e48\u0e2d</a>\
    </nav>\
    <div class="nav-actions">\
      <a href="' + QUOTE_LINE_URL + '" target="_blank" rel="noopener noreferrer" class="btn btn-gold">\
        \u0e17\u0e31\u0e01 LINE\
      </a>\
    </div>\
    <button class="mobile-toggle" id="mobileMenuBtn" aria-label="Toggle menu" aria-expanded="false">\
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\
        <line id="menuOpenIcon" x1="4" y1="6" x2="20" y2="6"></line>\
        <line id="menuOpenIcon2" x1="4" y1="12" x2="20" y2="12"></line>\
        <line id="menuOpenIcon3" x1="4" y1="18" x2="20" y2="18"></line>\
        <line id="menuCloseIcon" class="hidden" x1="6" y1="6" x2="18" y2="18"></line>\
        <line id="menuCloseIcon2" class="hidden" x1="6" y1="18" x2="18" y2="6"></line>\
      </svg>\
    </button>\
  </div>\
  <div class="mobile-menu" id="mobileMenu">\
    <div class="mobile-menu-inner">\
      <a href="' + HOME_PATH + '" class="mobile-link">\u0e2b\u0e19\u0e49\u0e32\u0e41\u0e23\u0e01</a>\
      <a href="' + CORPORATE_PATH + '" class="mobile-link">\u0e2d\u0e2d\u0e40\u0e14\u0e2d\u0e23\u0e4c\u0e2d\u0e07\u0e04\u0e4c\u0e01\u0e23</a>\
      <a href="' + MENU_PATH + '" class="mobile-link">\u0e40\u0e21\u0e19\u0e39</a>\
      <a href="' + CONTACT_PATH + '" class="mobile-link">\u0e15\u0e34\u0e14\u0e15\u0e48\u0e2d</a>\
      <div class="mobile-cta">\
        <a href="' + QUOTE_LINE_URL + '" target="_blank" rel="noopener noreferrer" class="btn btn-gold w-full" style="justify-content:center">\
          \u0e17\u0e31\u0e01 LINE\
        </a>\
      </div>\
    </div>\
  </div>\
</header>';
  }

  function getFooterHTML() {
    return '\
<footer class="site-footer">\
  <div class="footer-grid">\
    <div>\
      <a href="' + HOME_PATH + '" class="footer-brand-link">\
        <img src="' + LOGO_PATH + '" alt="EED HALAL" class="footer-logo-img">\
        <div class="logo-title" style="font-size:1.5rem">EED HALAL</div>\
      </a>\
      <a href="' + PHONE_HREF + '" class="footer-phone" style="margin-top:0.5rem">' + PHONE_DISPLAY + '</a>\
      <p class="footer-cert-text">\u0e2e\u0e32\u0e25\u0e32\u0e25\u0e40\u0e0b\u0e2d\u0e23\u0e4c\u0e15 CICOT | \u0e2d\u0e2d\u0e01\u0e43\u0e1a\u0e01\u0e33\u0e01\u0e31\u0e1a\u0e20\u0e32\u0e29\u0e35\u0e44\u0e14\u0e49</p>\
    </div>\
    <div>\
      <div class="footer-heading">\u0e2b\u0e19\u0e49\u0e32\u0e40\u0e27\u0e47\u0e1a</div>\
      <div class="footer-links">\
        <a href="' + HOME_PATH + '">\u0e2b\u0e19\u0e49\u0e32\u0e41\u0e23\u0e01</a>\
        <a href="' + CORPORATE_PATH + '">\u0e2d\u0e2d\u0e40\u0e14\u0e2d\u0e23\u0e4c\u0e2d\u0e07\u0e04\u0e4c\u0e01\u0e23</a>\
        <a href="' + MENU_PATH + '">\u0e40\u0e21\u0e19\u0e39\u0e22\u0e2d\u0e14\u0e19\u0e34\u0e22\u0e21</a>\
        <a href="' + CATERING_PATH + '">\u0e1a\u0e23\u0e34\u0e01\u0e32\u0e23\u0e08\u0e31\u0e14\u0e40\u0e25\u0e35\u0e49\u0e22\u0e07</a>\
        <a href="' + CONTACT_PATH + '">\u0e15\u0e34\u0e14\u0e15\u0e48\u0e2d</a>\
        <a href="' + ORDER_STEPS_PATH + '">\u0e02\u0e31\u0e49\u0e19\u0e15\u0e2d\u0e19\u0e2a\u0e31\u0e48\u0e07\u0e07\u0e32\u0e19</a>\
        <a href="' + DELIVERY_AREA_PATH + '">\u0e1e\u0e37\u0e49\u0e19\u0e17\u0e35\u0e48\u0e43\u0e2b\u0e49\u0e1a\u0e23\u0e34\u0e01\u0e32\u0e23</a>\
        <a href="' + HALAL_CERT_PATH + '">\u0e43\u0e1a\u0e23\u0e31\u0e1a\u0e23\u0e2d\u0e07\u0e2e\u0e32\u0e25\u0e32\u0e25</a>\
        <a href="' + REVIEWS_PATH + '">\u0e23\u0e35\u0e27\u0e34\u0e27</a>\
        <a href="' + FAQ_PATH + '">FAQ</a>\
        <a href="' + BLOG_HOW_TO_CHOOSE_PATH + '">\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e02\u0e49\u0e32\u0e27\u0e01\u0e25\u0e48\u0e2d\u0e07\u0e2d\u0e07\u0e04\u0e4c\u0e01\u0e23\u0e22\u0e31\u0e07\u0e44\u0e07</a>\
        <a href="' + BLOG_CICOT_PATH + '">CICOT \u0e04\u0e37\u0e2d\u0e2d\u0e30\u0e44\u0e23</a>\
        <a href="' + BLOG_HALAL_VS_NORMAL_PATH + '">\u0e2e\u0e32\u0e25\u0e32\u0e25 vs \u0e17\u0e31\u0e48\u0e27\u0e44\u0e1b</a>\
      </div>\
    </div>\
    <div>\
      <div class="footer-heading">\u0e1e\u0e37\u0e49\u0e19\u0e17\u0e35\u0e48\u0e43\u0e2b\u0e49\u0e1a\u0e23\u0e34\u0e01\u0e32\u0e23</div>\
      <div class="footer-links">\
        <a href="' + SATHORN_PATH + '">\u0e2a\u0e32\u0e17\u0e23 - \u0e2a\u0e35\u0e25\u0e21</a>\
        <a href="' + SUKHUMVIT_PATH + '">\u0e2a\u0e38\u0e02\u0e38\u0e21\u0e27\u0e34\u0e17</a>\
        <a href="' + RAMA3_PATH + '">\u0e1e\u0e23\u0e30\u0e23\u0e32\u0e21 3</a>\
        <a href="' + LADPRAO_PATH + '">\u0e25\u0e32\u0e14\u0e1e\u0e23\u0e49\u0e32\u0e27</a>\
      </div>\
    </div>\
    <div>\
      <div class="footer-contact-card">\
        <div class="footer-heading" style="margin-bottom:0.25rem">\u0e15\u0e34\u0e14\u0e15\u0e48\u0e2d\u0e14\u0e48\u0e27\u0e19</div>\
        <a href="' + PHONE_HREF + '" class="footer-phone">' + PHONE_DISPLAY + '</a>\
        <div class="footer-contact-links">\
          <a href="' + QUOTE_LINE_URL + '" target="_blank" rel="noopener noreferrer">\u0e17\u0e31\u0e01 LINE</a>\
        </div>\
      </div>\
\
    </div>\
  </div>\
  <div class="footer-bottom">\
    <p class="footer-copy">\u0e2e\u0e32\u0e25\u0e32\u0e25\u0e40\u0e0b\u0e2d\u0e23\u0e4c\u0e15 CICOT | \u0e2d\u0e2d\u0e01\u0e43\u0e1a\u0e01\u0e33\u0e01\u0e31\u0e1a\u0e20\u0e32\u0e29\u0e35\u0e44\u0e14\u0e49</p>\
  </div>\
</footer>';
  }

  function initMobileMenu() {
    var btn = document.getElementById('mobileMenuBtn');
    var menu = document.getElementById('mobileMenu');
    if (!btn || !menu) return;

    var menuOpenLines = document.querySelectorAll('#menuOpenIcon, #menuOpenIcon2, #menuOpenIcon3');
    var menuCloseLines = document.querySelectorAll('#menuCloseIcon, #menuCloseIcon2');

    btn.addEventListener('click', function() {
      var isOpen = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(isOpen));
      menuOpenLines.forEach(function(el) { el.classList.toggle('hidden', isOpen); });
      menuCloseLines.forEach(function(el) { el.classList.toggle('hidden', !isOpen); });
    });

    menu.querySelectorAll('.mobile-link').forEach(function(link) {
      link.addEventListener('click', function() {
        menu.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        menuOpenLines.forEach(function(el) { el.classList.remove('hidden'); });
        menuCloseLines.forEach(function(el) { el.classList.add('hidden'); });
      });
    });

    menu.querySelectorAll('[data-mdd-btn]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var content = this.nextElementSibling;
        var isOpen = content.classList.toggle('open');
        this.setAttribute('aria-expanded', String(isOpen));
      });
    });
  }

  function initDesktopDropdowns() {
    document.querySelectorAll('[data-dd-btn]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var menu = this.nextElementSibling;
        var isOpen = menu.classList.toggle('show');
        this.setAttribute('aria-expanded', String(isOpen));
        document.querySelectorAll('[data-dd-menu]').forEach(function(m) {
          if (m !== menu) m.classList.remove('show');
        });
        document.querySelectorAll('[data-dd-btn]').forEach(function(b) {
          if (b !== btn) b.setAttribute('aria-expanded', 'false');
        });
      });
    });

    document.addEventListener('click', function() {
      document.querySelectorAll('[data-dd-menu]').forEach(function(m) { m.classList.remove('show'); });
      document.querySelectorAll('[data-dd-btn]').forEach(function(b) { b.setAttribute('aria-expanded', 'false'); });
    });
  }

  function initFAQ() {
    document.querySelectorAll('.faq-question').forEach(function(q) {
      q.addEventListener('click', function() {
        this.parentElement.classList.toggle('open');
      });
    });
  }

  function initContactForm() {
    var form = document.querySelector('[data-line-contact-form]');
    if (!form) return;

    form.addEventListener('submit', function(e) {
      e.preventDefault();

      var name = (form.elements.name && form.elements.name.value || '').trim();
      var phone = (form.elements.phone && form.elements.phone.value || '').trim();
      var message = (form.elements.message && form.elements.message.value || '').trim();
      var lineMessage = [
        'สวัสดีครับ/ค่ะ สนใจสอบถามบริการ EED HALAL',
        '',
        'ชื่อ: ' + name,
        'เบอร์โทร: ' + phone,
        'รายละเอียด: ' + message
      ].join('\n');
      var lineUrl = 'https://line.me/R/oaMessage/' + encodeURIComponent(LINE_OA_ID) + '/?' + encodeURIComponent(lineMessage);

      window.location.href = lineUrl;
    });
  }

  function injectComponents() {
    var navEl = document.getElementById('nav');
    if (navEl) navEl.innerHTML = getNavHTML();

    var footerEl = document.getElementById('footer');
    if (footerEl) footerEl.innerHTML = getFooterHTML();

    initMobileMenu();
    initDesktopDropdowns();
    initFAQ();
    initContactForm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectComponents);
  } else {
    injectComponents();
  }
})();
