(function() {
  'use strict';

  var QUOTE_LINE_URL = 'https://lin.ee/CfvqJTd';
  var LINE_OA_ID = '@EEDHALAL';
  var PHONE_DISPLAY = '098-871-5179';
  var PHONE_HREF = 'tel:+66988715179';
  var EN_PREFIX = window.location.pathname.indexOf('/en/') === 0 ? '/en' : '';
  var isEN = EN_PREFIX === '/en';

  var HOME_PATH = EN_PREFIX + '/index.html';
  var CORPORATE_PATH = EN_PREFIX + '/corporate.html';
  var MENU_PATH = EN_PREFIX + '/popular-menu.html';
  var CONTACT_PATH = EN_PREFIX + '/contact.html';
  var CATERING_PATH = EN_PREFIX + '/catering.html';
  var ORDER_STEPS_PATH = EN_PREFIX + '/order-steps.html';
  var DELIVERY_AREA_PATH = EN_PREFIX + '/delivery-area.html';
  var HALAL_CERT_PATH = EN_PREFIX + '/halal-cert.html';
  var REVIEWS_PATH = EN_PREFIX + '/reviews.html';
  var FAQ_PATH = EN_PREFIX + '/faq.html';
  var SATHORN_PATH = EN_PREFIX + '/sathorn.html';
  var SILOM_PATH = EN_PREFIX + '/silom.html';

  var SUKHUMVIT_PATH = EN_PREFIX + '/sukhumvit.html';
  var RAMA3_PATH = EN_PREFIX + '/rama3.html';
  var LADPRAO_PATH = EN_PREFIX + '/ladprao.html';
  var BLOG_HALAL_VS_NORMAL_PATH = (isEN ? '/en' : '') + '/blog/halal-vs-normal.html';
  var BLOG_HOW_TO_CHOOSE_PATH = (isEN ? '/en' : '') + '/blog/how-to-choose.html';
  var BLOG_CICOT_PATH = (isEN ? '/en' : '') + '/blog/cicot-explained.html';
  var LOGO_PATH = '/img/logo.jpg';
  var TRACKING_DEFAULTS = {
    metaPixelId: '',
    ga4MeasurementId: '',
    googleAdsConversionId: '',
    googleAdsConversionLabel: '',
    debug: false
  };
  var LANDING_PAGE_MAP = {
    '/index.html': {
      lp_slug: 'home_general',
      lp_audience: 'General / Broad Prospecting',
      lp_intent: 'Brand awareness and entry point'
    },
    '/corporate.html': {
      lp_slug: 'corporate_hr_procurement',
      lp_audience: 'HR / Procurement / Office Admin / Event Coordinator',
      lp_intent: 'Corporate meal box quotations and office orders'
    },
    '/catering.html': {
      lp_slug: 'catering_events',
      lp_audience: 'Event Organizer / Banquet / Venue / Family',
      lp_intent: 'Halal catering, buffet, and yok mor events'
    },
    '/popular-menu.html': {
      lp_slug: 'menu_price_shoppers',
      lp_audience: 'Menu Browsers / Price Comparers / Warm Leads',
      lp_intent: 'Popular menu discovery and price comparison'
    },
    '/contact.html': {
      lp_slug: 'contact_direct',
      lp_audience: 'High-intent direct contact',
      lp_intent: 'Direct inquiry via LINE or phone'
    },
    '/delivery-area.html': {
      lp_slug: 'geo_delivery_area',
      lp_audience: 'Geo / Delivery coverage searchers',
      lp_intent: 'Check service area before ordering'
    },
    '/halal-cert.html': {
      lp_slug: 'trust_halal_cert',
      lp_audience: 'Trust / compliance focused buyers',
      lp_intent: 'Proof of Halal certification and compliance'
    },
    '/reviews.html': {
      lp_slug: 'social_proof_reviews',
      lp_audience: 'Social proof / consideration stage',
      lp_intent: 'Validate the brand with customer reviews'
    },
    '/faq.html': {
      lp_slug: 'faq_objection_handling',
      lp_audience: 'Objection handling / comparison stage',
      lp_intent: 'Answer procurement and ordering questions'
    },
    '/sathorn.html': {
      lp_slug: 'geo_sathorn',
      lp_audience: 'Sathorn / Thung Wat Don / Chong Nonsi',
      lp_intent: 'Local delivery for the Sathorn business district'
    },
    '/silom.html': {
      lp_slug: 'geo_silom',
      lp_audience: 'Silom / Bang Rak / Surawong / Si Phraya',
      lp_intent: 'Local delivery for the Silom financial district'
    },
    '/sukhumvit.html': {
      lp_slug: 'geo_sukhumvit',
      lp_audience: 'Sukhumvit / Asok / Thonglor / Ekkamai / Phra Khanong',
      lp_intent: 'Local delivery for Sukhumvit business areas'
    },
    '/rama3.html': {
      lp_slug: 'geo_rama3',
      lp_audience: 'Rama 3 / Nang Linchi / Charoen Rat / Chong Nonsi',
      lp_intent: 'Local delivery for the Rama 3 corridor'
    },
    '/ladprao.html': {
      lp_slug: 'geo_ladprao',
      lp_audience: 'Ladprao / Huai Khwang / Chatuchak / Ratchada',
      lp_intent: 'Local delivery for northern Bangkok business zones'
    }
  };
  var TRACKING_CONFIG = getTrackingConfig();
  var TRACKING_STATE = {
    initialized: false,
    clickListenerAttached: false
  };

  function getTrackingConfig() {
    var source = window.EEDHALAL_TRACKING || {};
    var config = {};
    var key;

    for (key in TRACKING_DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(TRACKING_DEFAULTS, key)) {
        config[key] = TRACKING_DEFAULTS[key];
      }
    }

    for (key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        config[key] = source[key];
      }
    }

    return config;
  }

  function hasValue(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function loadScriptOnce(src, id) {
    if (id && document.getElementById(id)) return;

    var script = document.createElement('script');
    script.async = true;
    script.src = src;
    if (id) script.id = id;

    (document.head || document.documentElement).appendChild(script);
  }

  function getPageCategory() {
    var path = window.location.pathname;

    if (path === '/' || path === '/index.html') return 'home';
    if (path === '/contact.html') return 'contact';
    if (path === '/corporate.html') return 'corporate';
    if (path === '/catering.html') return 'catering';
    if (path === '/popular-menu.html') return 'menu';
    if (path === '/order-steps.html') return 'order_steps';
    if (path === '/delivery-area.html') return 'delivery_area';
    if (path === '/halal-cert.html') return 'halal_cert';
    if (path === '/reviews.html') return 'reviews';
    if (path === '/faq.html') return 'faq';
    if (path === '/sathorn.html' || path === '/silom.html' || path === '/sukhumvit.html' || path === '/rama3.html' || path === '/ladprao.html') return 'location';
    if (path.indexOf('/blog/') === 0) return 'blog';
    return 'page';
  }

  function getLandingPageConfig() {
    var path = window.location.pathname;

    return LANDING_PAGE_MAP[path] || {
      lp_slug: 'generic',
      lp_audience: 'Unclassified',
      lp_intent: 'Unspecified'
    };
  }

  function getCampaignParams() {
    var query = window.location.search || '';
    var params = {};
    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'adset', 'audience'];
    var i;
    var name;
    var match;

    for (i = 0; i < keys.length; i += 1) {
      name = keys[i];
      match = new RegExp('[?&]' + name + '=([^&#]*)', 'i').exec(query);
      if (match && match[1]) {
        params[name] = decodeURIComponent(match[1].replace(/\+/g, ' '));
      }
    }

    return params;
  }

  function getTextContent(el) {
    if (!el) return '';
    return (el.textContent || el.innerText || '').replace(/\s+/g, ' ').trim();
  }

  function getTrackingContext(el) {
    var section = el && el.closest ? el.closest('section') : null;
    var header = el && el.closest ? el.closest('header') : null;
    var footer = el && el.closest ? el.closest('footer') : null;

    if (el && el.getAttribute) {
      if (el.getAttribute('data-track-section')) return el.getAttribute('data-track-section');
      if (el.getAttribute('data-track-source')) return el.getAttribute('data-track-source');
    }

    if (header) return 'header';
    if (footer) return 'footer';
    if (section && section.id) return section.id;

    return 'body';
  }

  function buildTrackingParams(extra) {
    var landingPage = getLandingPageConfig();
    var campaignParams = getCampaignParams();
    var params = {
      page_title: document.title,
      page_location: window.location.href,
      page_path: window.location.pathname,
      page_category: getPageCategory(),
      site_name: 'EED HALAL',
      lp_slug: landingPage.lp_slug,
      lp_audience: landingPage.lp_audience,
      lp_intent: landingPage.lp_intent
    };
    var key;

    if (extra) {
      for (key in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, key)) {
          params[key] = extra[key];
        }
      }
    }

    for (key in campaignParams) {
      if (Object.prototype.hasOwnProperty.call(campaignParams, key)) {
        params[key] = campaignParams[key];
      }
    }

    return params;
  }

  function pushDataLayer(eventName, params) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: eventName,
      params: params
    });
  }

  function getMetaEventName(eventName) {
    if (eventName === 'page_view') return 'PageView';
    if (eventName === 'lead_phone_click') return 'Contact';
    if (eventName === 'lead_line_click' || eventName === 'lead_form_submit' || eventName === 'lead_quote_click') return 'Lead';
    return null;
  }

  function isLeadEvent(eventName) {
    return eventName === 'lead_phone_click' || eventName === 'lead_line_click' || eventName === 'lead_form_submit' || eventName === 'lead_quote_click';
  }

  function emitTrackingEvent(eventName, extra) {
    var params = buildTrackingParams(extra);
    var metaEventName = getMetaEventName(eventName);
    var googleAdsSendTo = hasValue(TRACKING_CONFIG.googleAdsConversionId) && hasValue(TRACKING_CONFIG.googleAdsConversionLabel) ? TRACKING_CONFIG.googleAdsConversionId + '/' + TRACKING_CONFIG.googleAdsConversionLabel : '';

    pushDataLayer(eventName, params);

    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, params);
      if (isLeadEvent(eventName) && hasValue(googleAdsSendTo)) {
        window.gtag('event', 'conversion', {
          send_to: googleAdsSendTo,
          value: 1,
          currency: 'THB',
          event_category: 'lead',
          event_label: eventName,
          page_location: params.page_location,
          page_path: params.page_path
        });
      }
    }

    if (typeof window.fbq === 'function') {
      if (metaEventName) {
        if (metaEventName === 'PageView') {
          window.fbq('track', metaEventName);
        } else {
          window.fbq('track', metaEventName, params);
        }
      } else {
        window.fbq('trackCustom', eventName, params);
      }
    }
  }

  function initMetaPixel() {
    if (!hasValue(TRACKING_CONFIG.metaPixelId) || window.fbq) return;

    /* Meta Pixel bootstrap */
    (function(f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function() {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = '2.0';
      n.queue = [];
      t = b.createElement(e);
      t.async = true;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

    window.fbq('init', TRACKING_CONFIG.metaPixelId);
  }

  function initGoogleTag() {
    var googleId = TRACKING_CONFIG.ga4MeasurementId || TRACKING_CONFIG.googleAdsConversionId;

    if (!hasValue(googleId)) return;

    if (typeof window.gtag !== 'function') {
      window.dataLayer = window.dataLayer || [];
      window.gtag = function() {
        window.dataLayer.push(arguments);
      };
    }

    if (!document.getElementById('eedhalal-gtag-js')) {
      loadScriptOnce('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(googleId), 'eedhalal-gtag-js');
    }

    window.gtag('js', new Date());

    if (hasValue(TRACKING_CONFIG.ga4MeasurementId)) {
      window.gtag('config', TRACKING_CONFIG.ga4MeasurementId, {
        send_page_view: false
      });
    }

    if (hasValue(TRACKING_CONFIG.googleAdsConversionId)) {
      window.gtag('config', TRACKING_CONFIG.googleAdsConversionId);
    }
  }

  function initTracking() {
    try {
      if (TRACKING_STATE.initialized) return;
      TRACKING_STATE.initialized = true;

      initMetaPixel();
      initGoogleTag();

      if (!TRACKING_STATE.clickListenerAttached) {
        document.addEventListener('click', function(event) {
          try {
            var target = event.target && event.target.closest ? event.target.closest('a[href]') : null;
            var href;
            var label;
            var explicitEvent;
            var eventName;
            var context;
            var shouldDelayNavigation;

            if (!target) return;

            explicitEvent = target.getAttribute('data-track-event');
            href = target.getAttribute('href') || '';
            label = getTextContent(target);
            context = getTrackingContext(target);
            shouldDelayNavigation = target.target !== '_blank' && (explicitEvent || href.indexOf('tel:') === 0 || href.indexOf('lin.ee') !== -1 || href.indexOf('line.me') !== -1);

            if (explicitEvent) {
              if (shouldDelayNavigation) event.preventDefault();
              emitTrackingEvent(explicitEvent, {
                link_url: target.href,
                link_text: label,
                link_context: context,
                link_type: href.indexOf('tel:') === 0 ? 'phone' : 'line',
                cta_section: context,
                cta_text: label,
                cta_destination: target.href
              });
              if (shouldDelayNavigation) {
                window.setTimeout(function() {
                  window.location.href = target.href;
                }, 150);
              }
              return;
            }

            if (href.indexOf('tel:') === 0) {
              eventName = 'lead_phone_click';
            } else if (href.indexOf('lin.ee') !== -1 || href.indexOf('line.me') !== -1) {
              eventName = /ราคา|ใบเสนอราคา|quotation|quote|สั่งเลย|เริ่มสั่งเลย|สอบถามราคา|ขอใบเสนอราคา/i.test(label) ? 'lead_quote_click' : 'lead_line_click';
            } else {
              return;
            }

            if (shouldDelayNavigation) event.preventDefault();

            emitTrackingEvent(eventName, {
              link_url: target.href,
              link_text: label,
              link_context: context,
              link_type: href.indexOf('tel:') === 0 ? 'phone' : 'line',
              cta_section: context,
              cta_text: label,
              cta_destination: target.href
            });

            if (shouldDelayNavigation) {
              window.setTimeout(function() {
                window.location.href = target.href;
              }, 150);
            }
          } catch(e) {}
        }, true);

        TRACKING_STATE.clickListenerAttached = true;
      }

      emitTrackingEvent('page_view', {
        event_source: 'site',
        page_category: getPageCategory()
      });
    } catch(e) {}
  }

  function getLeadMessageUrl(name, phone, message) {
    var lineMessage = [
      'สวัสดีครับ/ค่ะ สนใจสอบถามบริการ EED HALAL',
      '',
      'ชื่อ: ' + name,
      'เบอร์โทร: ' + phone,
      'รายละเอียด: ' + message
    ].join('\n');

    return 'https://line.me/R/oaMessage/' + encodeURIComponent(LINE_OA_ID) + '/?' + encodeURIComponent(lineMessage);
  }

  function getNavHTML() {
    if (isEN) {
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
      <a href="' + HOME_PATH + '" class="nav-link">Home</a>\
      <a href="' + CORPORATE_PATH + '" class="nav-link">Corporate</a>\
      <a href="' + MENU_PATH + '" class="nav-link">Menu</a>\
      <a href="' + CONTACT_PATH + '" class="nav-link">Contact</a>\
    </nav>\
    <div class="nav-actions">\
      <a href="' + QUOTE_LINE_URL + '" target="_blank" rel="noopener noreferrer" class="btn btn-gold" data-track-event="lead_line_click" data-track-section="header" data-track-source="desktop_nav">\
        Message LINE\
      </a>\
    </div>\
    <button class="mobile-toggle" id="mobileMenuBtn" aria-label="Toggle menu" aria-expanded="false">\
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\
        <line id="menuOpenIcon" x1="4" y1="7" x2="20" y2="7"></line>\
        <line id="menuOpenIcon2" x1="4" y1="12" x2="20" y2="12"></line>\
        <line id="menuOpenIcon3" x1="4" y1="17" x2="20" y2="17"></line>\
        <line id="menuCloseIcon" class="hidden" x1="6" y1="6" x2="18" y2="18"></line>\
        <line id="menuCloseIcon2" class="hidden" x1="6" y1="18" x2="18" y2="6"></line>\
      </svg>\
    </button>\
  </div>\
  <div class="mobile-menu" id="mobileMenu">\
    <div class="mobile-menu-inner">\
      <a href="' + HOME_PATH + '" class="mobile-link">Home</a>\
      <a href="' + CORPORATE_PATH + '" class="mobile-link">Corporate</a>\
      <a href="' + MENU_PATH + '" class="mobile-link">Menu</a>\
      <a href="' + CONTACT_PATH + '" class="mobile-link">Contact</a>\
      <div class="mobile-cta">\
        <a href="' + QUOTE_LINE_URL + '" target="_blank" rel="noopener noreferrer" class="btn btn-gold w-full" style="justify-content:center" data-track-event="lead_line_click" data-track-section="header" data-track-source="mobile_nav">\
          Message LINE\
        </a>\
      </div>\
    </div>\
  </div>\
</header>';
    }
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
      <a href="' + QUOTE_LINE_URL + '" target="_blank" rel="noopener noreferrer" class="btn btn-gold" data-track-event="lead_line_click" data-track-section="header" data-track-source="desktop_nav">\
        \u0e17\u0e31\u0e01 LINE\
      </a>\
    </div>\
    <button class="mobile-toggle" id="mobileMenuBtn" aria-label="Toggle menu" aria-expanded="false">\
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\
        <line id="menuOpenIcon" x1="4" y1="7" x2="20" y2="7"></line>\
        <line id="menuOpenIcon2" x1="4" y1="12" x2="20" y2="12"></line>\
        <line id="menuOpenIcon3" x1="4" y1="17" x2="20" y2="17"></line>\
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
        <a href="' + QUOTE_LINE_URL + '" target="_blank" rel="noopener noreferrer" class="btn btn-gold w-full" style="justify-content:center" data-track-event="lead_line_click" data-track-section="header" data-track-source="mobile_nav">\
          \u0e17\u0e31\u0e01 LINE\
        </a>\
      </div>\
    </div>\
  </div>\
</header>';
  }

  function getFooterHTML() {
    if (isEN) {
      return '\
<footer class="site-footer">\
  <div class="footer-grid">\
    <div>\
      <a href="' + HOME_PATH + '" class="footer-brand-link">\
        <img src="' + LOGO_PATH + '" alt="EED HALAL" class="footer-logo-img">\
        <div>\
          <div class="logo-title" style="font-size:1.3rem">EED HALAL</div>\
          <span style="font-size:0.6rem;font-weight:700;color:var(--accent);letter-spacing:0.15em;text-transform:uppercase">HALAL CERTIFIED</span>\
        </div>\
      </a>\
      <a href="' + PHONE_HREF + '" class="footer-phone" style="margin-top:0.75rem" data-track-event="lead_phone_click" data-track-section="footer" data-track-source="site_footer">' + PHONE_DISPLAY + '</a>\
      <p class="footer-cert-text">CICOT Halal Certified | Tax Invoice Available</p>\
    </div>\
    <div>\
      <div class="footer-heading">Pages</div>\
      <div class="footer-links">\
        <a href="' + HOME_PATH + '">Home</a>\
        <a href="' + CORPORATE_PATH + '">Corporate</a>\
        <a href="' + MENU_PATH + '">Popular Menu</a>\
        <a href="' + CATERING_PATH + '">Catering</a>\
        <a href="' + CONTACT_PATH + '">Contact</a>\
        <a href="' + ORDER_STEPS_PATH + '">How to Order</a>\
        <a href="' + DELIVERY_AREA_PATH + '">Delivery Areas</a>\
        <a href="' + HALAL_CERT_PATH + '">Halal Certificate</a>\
        <a href="' + REVIEWS_PATH + '">Reviews</a>\
        <a href="' + FAQ_PATH + '">FAQ</a>\
        <a href="' + BLOG_HOW_TO_CHOOSE_PATH + '">Choosing Halal Vendor</a>\
        <a href="' + BLOG_CICOT_PATH + '">What is CICOT</a>\
        <a href="' + BLOG_HALAL_VS_NORMAL_PATH + '">Halal vs Regular</a>\
      </div>\
    </div>\
    <div>\
      <div class="footer-heading">Delivery Areas</div>\
      <div class="footer-links">\
        <a href="' + SATHORN_PATH + '">Sathon</a>\
        <a href="' + SILOM_PATH + '">Silom</a>\
        <a href="' + SATHORN_PATH + '">Sathon - Silom</a>\
        <a href="' + SUKHUMVIT_PATH + '">Sukhumvit</a>\
        <a href="' + RAMA3_PATH + '">Rama 3</a>\
        <a href="' + LADPRAO_PATH + '">Lat Phrao</a>\
      </div>\
    </div>\
    <div>\
      <div class="footer-contact-card">\
        <div class="footer-heading" style="margin-bottom:0.25rem">Contact</div>\
        <a href="' + PHONE_HREF + '" class="footer-phone" data-track-event="lead_phone_click" data-track-section="footer" data-track-source="site_footer">' + PHONE_DISPLAY + '</a>\
        <div class="footer-contact-links">\
          <a href="' + QUOTE_LINE_URL + '" target="_blank" rel="noopener noreferrer" data-track-event="lead_line_click" data-track-section="footer" data-track-source="site_footer">Message LINE</a>\
        </div>\
      </div>\
\
    </div>\
  </div>\
  <div class="footer-bottom">\
    <p class="footer-copy">&copy; 2024 EED HALAL. CICOT Halal Certified</p>\
    <div class="footer-tags">\
      <span>HL-2024-0892</span>\
      <span>Best Seller</span>\
      <span>Grilled</span>\
    </div>\
  </div>\
</footer>';
    }
    return '\
<footer class="site-footer">\
  <div class="footer-grid">\
    <div>\
      <a href="' + HOME_PATH + '" class="footer-brand-link">\
        <img src="' + LOGO_PATH + '" alt="EED HALAL" class="footer-logo-img">\
        <div>\
          <div class="logo-title" style="font-size:1.3rem">EED HALAL</div>\
          <span style="font-size:0.6rem;font-weight:700;color:var(--accent);letter-spacing:0.15em;text-transform:uppercase">HALAL CERTIFIED</span>\
        </div>\
      </a>\
      <a href="' + PHONE_HREF + '" class="footer-phone" style="margin-top:0.75rem" data-track-event="lead_phone_click" data-track-section="footer" data-track-source="site_footer">' + PHONE_DISPLAY + '</a>\
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
        <a href="' + SATHORN_PATH + '">\u0e2a\u0e32\u0e17\u0e23</a>\
        <a href="' + SILOM_PATH + '">\u0e2a\u0e35\u0e25\u0e21</a>\
        <a href="' + SATHORN_PATH + '">\u0e2a\u0e32\u0e17\u0e23 - \u0e2a\u0e35\u0e25\u0e21</a>\
        <a href="' + SUKHUMVIT_PATH + '">\u0e2a\u0e38\u0e02\u0e38\u0e21\u0e27\u0e34\u0e17</a>\
        <a href="' + RAMA3_PATH + '">\u0e1e\u0e23\u0e30\u0e23\u0e32\u0e21 3</a>\
        <a href="' + LADPRAO_PATH + '">\u0e25\u0e32\u0e14\u0e1e\u0e23\u0e49\u0e32\u0e27</a>\
      </div>\
    </div>\
    <div>\
      <div class="footer-contact-card">\
        <div class="footer-heading" style="margin-bottom:0.25rem">\u0e15\u0e34\u0e14\u0e15\u0e48\u0e2d\u0e14\u0e48\u0e27\u0e19</div>\
        <a href="' + PHONE_HREF + '" class="footer-phone" data-track-event="lead_phone_click" data-track-section="footer" data-track-source="site_footer">' + PHONE_DISPLAY + '</a>\
        <div class="footer-contact-links">\
          <a href="' + QUOTE_LINE_URL + '" target="_blank" rel="noopener noreferrer" data-track-event="lead_line_click" data-track-section="footer" data-track-source="site_footer">\u0e17\u0e31\u0e01 LINE</a>\
        </div>\
      </div>\
\
    </div>\
  </div>\
  <div class="footer-bottom">\
    <p class="footer-copy">&copy; 2024 EED HALAL. \u0e2e\u0e32\u0e25\u0e32\u0e25\u0e40\u0e0b\u0e2d\u0e23\u0e4c\u0e15 CICOT</p>\
    <div class="footer-tags">\
      <span>HL-2024-0892</span>\
      <span>\u0e22\u0e2d\u0e14\u0e19\u0e34\u0e22\u0e21\u0e4c</span>\
      <span>Grilled</span>\
    </div>\
  </div>\
</footer>';
  }

  function initHeaderScroll() {
    var header = document.querySelector('.site-header');
    if (!header) return;

    function onScroll() {
      if (window.scrollY > 10) {
        header.classList.add('scrolled');
      } else {
        header.classList.remove('scrolled');
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
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
      var lineUrl = getLeadMessageUrl(name, phone, message);

      emitTrackingEvent('lead_form_submit', {
        form_name: 'line_contact_form',
        form_context: 'contact_page',
        form_destination: 'line',
        cta_section: 'contact_form'
      });

      window.setTimeout(function() {
        window.location.href = lineUrl;
      }, 150);
    });
  }

  function getSeasonalUrgencyConfig() {
    var now = new Date();
    var month = now.getMonth() + 1;

    if (month >= 7 && month <= 9) {
      return {
        cssClass: 'banner-q3',
        icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        text: '\u0e24\u0e14\u0e39\u0e2a\u0e31\u0e21\u0e21\u0e19\u0e32 Q3 \u2014 \u0e08\u0e2d\u0e07\u0e02\u0e49\u0e32\u0e27\u0e01\u0e25\u0e48\u0e2d\u0e07\u0e2a\u0e31\u0e21\u0e21\u0e19\u0e32\u0e25\u0e48\u0e27\u0e07\u0e2b\u0e19\u0e49\u0e32 \u0e23\u0e31\u0e1a\u0e2a\u0e48\u0e27\u0e19\u0e25\u0e14\u0e1e\u0e34\u0e40\u0e28\u0e29\u0e2a\u0e33\u0e2b\u0e23\u0e31\u0e1a\u0e2d\u0e07\u0e04\u0e4c\u0e01\u0e23\u0e17\u0e35\u0e48\u0e2a\u0e31\u0e48\u0e07\u0e01\u0e48\u0e2d\u0e19\u0e2a\u0e34\u0e49\u0e19\u0e40\u0e14\u0e37\u0e2d\u0e19\u0e01\u0e31\u0e19\u0e22\u0e32\u0e22\u0e19',
        linkText: '\u0e17\u0e31\u0e01 LINE \u0e02\u0e2d\u0e42\u0e1b\u0e23\u0e42\u0e21\u0e0a\u0e31\u0e48\u0e19',
        linkHref: QUOTE_LINE_URL
      };
    }

    if (month >= 10 && month <= 12) {
      return {
        cssClass: 'banner-year-end',
        icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
        text: '\u0e2a\u0e34\u0e49\u0e19\u0e1b\u0e35\u0e07\u0e1a\u0e1b\u0e23\u0e30\u0e21\u0e32\u0e13 \u2014 \u0e43\u0e0a\u0e49\u0e2a\u0e34\u0e17\u0e18\u0e34\u0e4c\u0e07\u0e1a\u0e04\u0e07\u0e40\u0e2b\u0e25\u0e37\u0e2d \u0e2a\u0e31\u0e48\u0e07\u0e02\u0e49\u0e32\u0e27\u0e01\u0e25\u0e48\u0e2d\u0e07\u0e2e\u0e32\u0e25\u0e32\u0e25\u0e2d\u0e07\u0e04\u0e4c\u0e01\u0e23\u0e14\u0e48\u0e27\u0e19 \u0e1c\u0e48\u0e2d\u0e19\u0e43\u0e1a\u0e01\u0e32\u0e01\u0e31\u0e1a\u0e20\u0e32\u0e29\u0e35\u0e44\u0e14\u0e49\u0e17\u0e31\u0e19\u0e17\u0e35',
        linkText: '\u0e17\u0e31\u0e01 LINE \u0e40\u0e25\u0e22',
        linkHref: QUOTE_LINE_URL
      };
    }

    return {
      cssClass: 'banner-default',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
      text: '\u0e2a\u0e31\u0e48\u0e07\u0e02\u0e49\u0e32\u0e27\u0e01\u0e25\u0e48\u0e2d\u0e07\u0e2e\u0e32\u0e25\u0e32\u0e25\u0e2d\u0e07\u0e04\u0e4c\u0e01\u0e23 \u0e23\u0e32\u0e04\u0e32\u0e40\u0e23\u0e34\u0e48\u0e21 70 \u0e1a\u0e32\u0e17 \u0e2d\u0e2d\u0e01\u0e43\u0e1a\u0e01\u0e33\u0e01\u0e31\u0e1a\u0e20\u0e32\u0e29\u0e35\u0e44\u0e14\u0e49',
      linkText: '\u0e17\u0e31\u0e01 LINE \u0e02\u0e2d\u0e43\u0e1a\u0e40\u0e2a\u0e19\u0e2d\u0e23\u0e32\u0e04\u0e32',
      linkHref: QUOTE_LINE_URL
    };
  }

  function injectUrgencyBanner() {
    try {
      var storageKey = 'eedhalal_urgency_hide';
      var hiddenUntil = localStorage.getItem(storageKey);
      if (hiddenUntil && parseInt(hiddenUntil, 10) > Date.now()) return;

      var config = getSeasonalUrgencyConfig();
      var banner = document.createElement('div');
      banner.className = 'urgency-banner ' + config.cssClass;
      banner.innerHTML = '\
        <span class="urgency-icon">' + config.icon + '</span>\
        <span class="urgency-text">' + config.text + '</span>\
        <a href="' + config.linkHref + '" target="_blank" rel="noopener noreferrer" class="urgency-link" data-track-event="lead_line_click" data-track-section="urgency_banner" data-track-source="seasonal_banner">' + config.linkText + '</a>\
        <button class="urgency-close" aria-label="\u0e1b\u0e34\u0e14">\
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>\
        </button>';

      var mainEl = document.querySelector('main');
      if (mainEl) {
        mainEl.setAttribute('data-urgency', 'active');
        mainEl.insertBefore(banner, mainEl.firstChild);
      }

      banner.querySelector('.urgency-close').addEventListener('click', function() {
        banner.classList.add('banner-hidden');
        if (mainEl) mainEl.removeAttribute('data-urgency');
        try { localStorage.setItem(storageKey, String(Date.now() + 86400000)); } catch(e) {}
      });
    } catch(e) {}
  }

  function injectJsonLdSchema() {
    if (document.getElementById('eedhalal-jsonld')) return;
    if (document.querySelector('script[type="application/ld+json"]')) return;

    var schema = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": ["FoodEstablishment", "LocalBusiness"],
          "@id": "https://eedhalal.com/#org",
          "name": "EED HALAL",
          "url": "https://eedhalal.com/",
          "telephone": "+66988715179",
          "priceRange": "\u0e3f\u0e3f",
          "servesCuisine": ["Halal", "Thai"],
          "image": "https://eedhalal.com/img/khao-mok-box-opt.jpg",
          "address": {
            "@type": "PostalAddress",
            "streetAddress": "478/3 \u0e16\u0e19\u0e19\u0e2a\u0e32\u0e17\u0e23 1 \u0e0b\u0e2d\u0e22 7 \u0e41\u0e02\u0e27\u0e07\u0e17\u0e38\u0e48\u0e07\u0e27\u0e31\u0e14 \u0e40\u0e02\u0e15\u0e2a\u0e32\u0e17\u0e23",
            "addressLocality": "\u0e01\u0e23\u0e38\u0e07\u0e40\u0e17\u0e1e\u0e21\u0e2b\u0e32\u0e19\u0e04\u0e23",
            "postalCode": "10120",
            "addressCountry": "TH"
          },
          "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": "4.8",
            "bestRating": "5",
            "worstRating": "1",
            "ratingCount": "286"
          }
        },
        {
          "@type": "FAQPage",
          "@id": "https://eedhalal.com/#faq",
          "mainEntity": [
            {
              "@type": "Question",
              "name": "EED HALAL \u0e23\u0e31\u0e1a\u0e23\u0e2d\u0e07\u0e2e\u0e32\u0e25\u0e32\u0e25\u0e2b\u0e23\u0e37\u0e2d\u0e44\u0e21\u0e48?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "EED HALAL \u0e44\u0e14\u0e49\u0e23\u0e31\u0e1a\u0e01\u0e32\u0e23\u0e23\u0e31\u0e1a\u0e23\u0e2d\u0e07\u0e2e\u0e32\u0e25\u0e32\u0e25\u0e2d\u0e22\u0e48\u0e32\u0e07\u0e40\u0e1b\u0e47\u0e19\u0e17\u0e32\u0e07\u0e01\u0e32\u0e23\u0e08\u0e32\u0e01\u0e04\u0e13\u0e30\u0e01\u0e23\u0e23\u0e21\u0e01\u0e32\u0e23\u0e01\u0e25\u0e32\u0e07\u0e2d\u0e34\u0e2a\u0e25\u0e32\u0e21\u0e41\u0e2b\u0e48\u0e07\u0e1b\u0e23\u0e30\u0e40\u0e17\u0e28\u0e44\u0e17\u0e22 (CICOT) \u0e40\u0e25\u0e02\u0e17\u0e35\u0e48 HL-2024-0892 \u0e04\u0e23\u0e2d\u0e1a\u0e04\u0e25\u0e38\u0e21\u0e15\u0e31\u0e49\u0e07\u0e41\u0e15\u0e48\u0e01\u0e32\u0e23\u0e04\u0e31\u0e14\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e27\u0e31\u0e15\u0e16\u0e38\u0e14\u0e34\u0e1a\u0e15\u0e49\u0e2d\u0e07\u0e44\u0e1b\u0e08\u0e19\u0e16\u0e36\u0e07\u0e01\u0e32\u0e23\u0e08\u0e31\u0e14\u0e2a\u0e48\u0e07"
              }
            },
            {
              "@type": "Question",
              "name": "\u0e2a\u0e31\u0e48\u0e07\u0e02\u0e49\u0e32\u0e27\u0e01\u0e25\u0e48\u0e2d\u0e07\u0e2e\u0e32\u0e25\u0e32\u0e25\u0e02\u0e31\u0e49\u0e19\u0e15\u0e48\u0e33\u0e01\u0e35\u0e48\u0e01\u0e25\u0e48\u0e2d\u0e07?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "\u0e2d\u0e2d\u0e40\u0e14\u0e2d\u0e23\u0e4c\u0e2d\u0e07\u0e04\u0e4c\u0e01\u0e23\u0e02\u0e31\u0e49\u0e19\u0e15\u0e48\u0e33 20 \u0e01\u0e25\u0e48\u0e2d\u0e07\u0e02\u0e36\u0e49\u0e19\u0e44\u0e1b \u0e23\u0e32\u0e04\u0e32\u0e40\u0e23\u0e34\u0e48\u0e21\u0e15\u0e49\u0e19\u0e17\u0e35\u0e48 70 \u0e1a\u0e32\u0e17/\u0e01\u0e25\u0e48\u0e2d\u0e07 \u0e2a\u0e31\u0e48\u0e07 50 \u0e01\u0e25\u0e48\u0e2d\u0e07\u0e02\u0e36\u0e49\u0e19\u0e44\u0e1b\u0e08\u0e31\u0e14\u0e2a\u0e48\u0e07\u0e1f\u0e23\u0e35\u0e17\u0e31\u0e48\u0e27\u0e01\u0e23\u0e38\u0e07\u0e40\u0e17\u0e1e\u0e2e\u0e2f"
              }
            },
            {
              "@type": "Question",
              "name": "EED HALAL \u0e08\u0e31\u0e14\u0e2a\u0e48\u0e07\u0e16\u0e36\u0e07\u0e1e\u0e37\u0e49\u0e19\u0e17\u0e35\u0e48\u0e44\u0e2b\u0e19\u0e1a\u0e49\u0e32\u0e07?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "EED HALAL \u0e43\u0e2b\u0e49\u0e1a\u0e23\u0e34\u0e01\u0e32\u0e23\u0e08\u0e31\u0e14\u0e2a\u0e48\u0e07\u0e17\u0e31\u0e48\u0e27\u0e01\u0e23\u0e38\u0e07\u0e40\u0e17\u0e1e\u0e2f \u0e41\u0e25\u0e30\u0e1b\u0e23\u0e34\u0e21\u0e13\u0e11\u0e25 \u0e04\u0e23\u0e2d\u0e1a\u0e04\u0e25\u0e38\u0e21\u0e22\u0e48\u0e32\u0e19\u0e18\u0e38\u0e23\u0e01\u0e34\u0e08\u0e2b\u0e25\u0e31\u0e01 \u0e44\u0e14\u0e49\u0e41\u0e01\u0e48 \u0e2a\u0e32\u0e17\u0e23-\u0e2a\u0e35\u0e25\u0e21 \u0e2a\u0e38\u0e02\u0e38\u0e21\u0e27\u0e34\u0e17 \u0e1e\u0e23\u0e30\u0e23\u0e32\u0e21 3 \u0e25\u0e32\u0e14\u0e1e\u0e23\u0e49\u0e32\u0e27 \u0e41\u0e25\u0e30\u0e2d\u0e35\u0e01\u0e21\u0e32\u0e01\u0e21\u0e32\u0e22"
              }
            },
            {
              "@type": "Question",
              "name": "EED HALAL \u0e2d\u0e2d\u0e01\u0e43\u0e1a\u0e01\u0e33\u0e01\u0e31\u0e1a\u0e20\u0e32\u0e29\u0e35\u0e44\u0e14\u0e49\u0e2b\u0e23\u0e37\u0e2d\u0e44\u0e21\u0e48?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "EED HALAL \u0e08\u0e14\u0e17\u0e30\u0e40\u0e1a\u0e35\u0e22\u0e19\u0e1a\u0e23\u0e34\u0e29\u0e31\u0e17\u0e16\u0e39\u0e01\u0e15\u0e49\u0e2d\u0e07 \u0e2a\u0e32\u0e21\u0e32\u0e23\u0e16\u0e2d\u0e2d\u0e01\u0e43\u0e1a\u0e40\u0e2a\u0e19\u0e2d\u0e23\u0e32\u0e04\u0e32 \u0e43\u0e1a\u0e41\u0e08\u0e49\u0e07\u0e2b\u0e19\u0e35\u0e49 \u0e41\u0e25\u0e30\u0e43\u0e1a\u0e40\u0e2a\u0e23\u0e47\u0e08\u0e23\u0e31\u0e1a\u0e40\u0e07\u0e34\u0e19\u0e44\u0e14\u0e49 \u0e23\u0e32\u0e04\u0e32\u0e17\u0e35\u0e48\u0e40\u0e2a\u0e19\u0e2d\u0e44\u0e21\u0e48\u0e23\u0e27\u0e21 VAT 7%"
              }
            }
          ]
        }
      ]
    };

    var script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'eedhalal-jsonld';
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);
  }

  function initBudgetCalculator() {
    var boxesInput = document.getElementById('calcBoxes');
    var boxesRange = document.getElementById('calcBoxesRange');
    var budgetInput = document.getElementById('calcBudget');
    var budgetRange = document.getElementById('calcBudgetRange');
    var totalEl = document.getElementById('calcTotal');

    if (!boxesInput || !boxesRange || !budgetInput || !budgetRange || !totalEl) return;

    function updateTotal() {
      var boxes = parseInt(boxesInput.value, 10) || 0;
      var budget = parseInt(budgetInput.value, 10) || 0;
      var total = boxes * budget;
      totalEl.textContent = '\u0e3f' + total.toLocaleString();
    }

    function syncInputToRange(input, range) {
      range.value = input.value;
    }

    function syncRangeToInput(range, input) {
      input.value = range.value;
    }

    boxesInput.addEventListener('input', function() {
      syncInputToRange(boxesInput, boxesRange);
      updateTotal();
    });

    boxesRange.addEventListener('input', function() {
      syncRangeToInput(boxesRange, boxesInput);
      updateTotal();
    });

    budgetInput.addEventListener('input', function() {
      syncInputToRange(budgetInput, budgetRange);
      updateTotal();
      document.querySelectorAll('.calc-chip').forEach(function(chip) {
        chip.classList.toggle('active', parseInt(chip.getAttribute('data-budget'), 10) === parseInt(budgetInput.value, 10));
      });
    });

    budgetRange.addEventListener('input', function() {
      syncRangeToInput(budgetRange, budgetInput);
      updateTotal();
    });

    document.querySelectorAll('.calc-chip').forEach(function(chip) {
      chip.addEventListener('click', function() {
        var val = parseInt(this.getAttribute('data-budget'), 10);
        budgetInput.value = val;
        budgetRange.value = val;
        updateTotal();
        document.querySelectorAll('.calc-chip').forEach(function(c) { c.classList.remove('active'); });
        this.classList.add('active');
      });
    });

    document.querySelectorAll('.calc-chip').forEach(function(chip) {
      if (parseInt(chip.getAttribute('data-budget'), 10) === parseInt(budgetInput.value, 10)) {
        chip.classList.add('active');
      }
    });

    updateTotal();
  }

  /* ====== ราคาลับสำหรับลูกค้า Volume (ใช้ในการเจรจาจริง ไม่โชว์บนเว็บ) ======
   * ราคาที่แสดงบนเว็บเป็นราคาอ้างอิงเริ่มต้นเท่านั้น
   * ราคาจริงและส่วนลดที่ใช้เสนอองค์กร ปิดผ่านใบเสนอราคาส่วนตัวทาง LINE
   *
   * ส่วนลดจริงที่ใช้เจรจา (ห้ามโชว์):
   *   25  กล่อง → ลด 10%
   *   50  กล่อง → ลด 15%
   *   100 กล่อง → ลด 20%
   *   (กรณีปริมาณมากกว่านี้ หรือซ้ำ รายเดือน ทัก LINE เพื่อขอราคาเฉพาะ)
   * ===================================================================== */

  function injectComponents() {
    var navEl = document.getElementById('nav');
    if (navEl) navEl.innerHTML = getNavHTML();

    var footerEl = document.getElementById('footer');
    if (footerEl) footerEl.innerHTML = getFooterHTML();

    initMobileMenu();
    initDesktopDropdowns();
    initHeaderScroll();
    injectJsonLdSchema();
    initTracking();
    injectUrgencyBanner();
    initFAQ();
    initContactForm();
    initBudgetCalculator();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectComponents);
  } else {
    injectComponents();
  }
})();
