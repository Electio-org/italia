/*
 * Electio Italia — runtime cache
 *
 * Strategy:
 *   - App shell (HTML/CSS/JS/vendor)  → stale-while-revalidate
 *   - Derived data products under /data/derived/** → cache-first, versioned
 *   - Everything else → network-first, no-cache
 *
 * The cache version is hard-coded here so a single swap bumps every bucket
 * and old caches are dropped on activate.
 *
 * Install is intentionally tolerant: missing shell files should not break
 * registration. We warm the cache entry by entry instead of a single
 * `cache.addAll()` that would reject the whole install on any 404.
 */

const SW_VERSION = 'electio-v13-2026-04-26-party-shard-loading';
const SHELL_CACHE = `shell::${SW_VERSION}`;
const DATA_CACHE = `data::${SW_VERSION}`;
const NAV_FALLBACK = './index.html';

const SHELL_PATHS = [
  './',
  './index.html',
  './municipality-detail.html',
  './municipality-detail.js',
  './data-download.html',
  './usage-notes.html',
  './update-log.html',
  './programmatic-access.html',
  './products.html',
  './style.css',
  './tabler-theme.css',
  './icons.svg',
  './app.js',
  './site-pages.js',
  './perf-boot.js',
  './tabler-enhance.js',
  './modules/app-shell.js',
  './modules/data.js',
  './modules/guidance.js',
  './modules/quality.js',
  './modules/selectors.js',
  './modules/shared.js',
  './vendor/d3/d3-slim.min.js',
  './vendor/papaparse/papaparse.min.js',
  './vendor/topojson-client/topojson-client.min.js',
];

async function warmShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(SHELL_PATHS.map(async (path) => {
    try {
      const request = new Request(path, { cache: 'reload' });
      const response = await fetch(request);
      if (response && response.ok) {
        await cache.put(path, response.clone());
      }
    } catch (_err) {
      // A single missing shell entry must not break the install.
    }
  }));
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(warmShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name !== SHELL_CACHE && name !== DATA_CACHE)
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

function isManifest(url) {
  return url.pathname.endsWith('/data/derived/manifest.json');
}

function isDerivedData(url) {
  // manifest.json is the app's data index — it must stay in sync with the
  // shell code, so it takes the stale-while-revalidate shell path instead
  // of the cache-first data path.
  if (isManifest(url)) return false;
  return url.pathname.includes('/data/derived/');
}

function isShell(url) {
  const p = url.pathname;
  if (p.endsWith('.html')) return true;
  if (p.endsWith('.css')) return true;
  if (p.endsWith('.js')) return true;
  if (p.endsWith('.svg')) return true;
  if (p.endsWith('.json') && !isDerivedData(url)) return true;
  return false;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch (_err) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Navigation requests: stale-while-revalidate, with same-origin HTML fallback
  // so a second visit is served instantly from cache and survives offline.
  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
    return;
  }

  if (isDerivedData(url)) {
    event.respondWith(cacheFirst(DATA_CACHE, request));
    return;
  }
  if (isShell(url)) {
    event.respondWith(staleWhileRevalidate(SHELL_CACHE, request));
    return;
  }
});

async function navigationHandler(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (hit) {
    // Refresh in background; serve cache now for instant paint.
    networkPromise.catch(() => {});
    return hit;
  }
  const network = await networkPromise;
  if (network) return network;
  const fallback = await cache.match(NAV_FALLBACK);
  return fallback || new Response('', { status: 504 });
}

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return hit || (await networkPromise) || new Response('', { status: 504 });
}
