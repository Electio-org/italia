/*
 * Italia Camera Explorer — runtime perf boot.
 *
 * Keeps navigation instant after the first visit:
 *   1. Registers the service worker (navigation + asset cache, offline fallback).
 *   2. Declares Speculation Rules so Chromium prerenders sibling pages on hover.
 *   3. Falls back to <link rel="prefetch"> on pointer-enter for every in-nav anchor.
 *   4. Warms sibling pages during idle time after first paint.
 *
 * All three layers are additive; any browser picks the best one it supports.
 * View Transitions are handled purely in CSS (@view-transition { navigation: auto }).
 */

(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  // --- 1. Service worker -------------------------------------------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('service-worker.js').catch(function () {
        /* best effort — dashboard still works without SW */
      });
    });
  }

  // --- 2. Speculation rules (Chromium) ----------------------------------
  try {
    if (HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules')) {
      var rules = document.createElement('script');
      rules.type = 'speculationrules';
      rules.textContent = JSON.stringify({
        prerender: [
          {
            source: 'document',
            where: {
              and: [
                { href_matches: '/*' },
                { not: { href_matches: '/*.csv*' } },
                { not: { href_matches: '/*.json*' } },
                { not: { href_matches: '/*.topojson*' } },
                { not: { href_matches: '/*.zip*' } },
                { not: { href_matches: '*#*' } },
              ],
            },
            eagerness: 'moderate',
          },
        ],
      });
      document.head.appendChild(rules);
    }
  } catch (_err) {
    /* Speculation rules API not available — fall through to prefetch. */
  }

  // --- 3. Hover/focus prefetch fallback ---------------------------------
  var prefetched = new Set();
  function prefetch(href) {
    if (!href || prefetched.has(href)) return;
    prefetched.add(href);
    var link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = href;
    link.as = 'document';
    document.head.appendChild(link);
  }

  var navLinks = document.querySelectorAll('nav a[href], .site-nav a[href]');
  for (var i = 0; i < navLinks.length; i++) {
    (function (link) {
      var href = link.getAttribute('href');
      if (!href || /^(https?:|mailto:|tel:|#)/.test(href)) return;
      var trigger = function () { prefetch(href); };
      link.addEventListener('pointerenter', trigger, { once: true, passive: true });
      link.addEventListener('focus', trigger, { once: true });
    })(navLinks[i]);
  }

  // --- 4. Idle warm-up of sibling pages ---------------------------------
  var siblings = ['index.html', 'data-download.html', 'usage-notes.html', 'update-log.html'];
  var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 1500); };
  idle(function () { siblings.forEach(prefetch); });
})();
