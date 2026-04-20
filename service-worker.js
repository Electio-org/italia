/*
 * Italia Camera Explorer — runtime cache
 *
 * Strategy:
 *   - App shell (HTML/CSS/JS/vendor)  → stale-while-revalidate
 *   - Derived data products under /data/derived/** → cache-first, versioned
 *   - Everything else → network-first with tiny fallback
 *
 * The cache version is hard-coded here so a single swap bumps every bucket
 * and old caches are dropped on activate.
 */

const SW_VERSION = 'lce-v1-2026-04-20';
const SHELL_CACHE = `shell::${SW_VERSION}`;
const DATA_CACHE = `data::${SW_VERSION}`;

const SHELL_PATHS = [
  './',
  './index.html',
  './style.css',
  './tabler-theme.css',
  './icons.svg',
  './app.js',
  './site-pages.js',
  './modules/data.js',
  './modules/selectors.js',
  './modules/shared.js',
  './vendor/d3/d3-slim.min.js',
  './vendor/papaparse/papaparse.min.js',
  './vendor/topojson-client/topojson-client.min.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_PATHS).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(name => name !== SHELL_CACHE && name !== DATA_CACHE)
        .map(name => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

function isDerivedData(url) {
  return url.pathname.includes('/data/derived/');
}

function isShell(url) {
  const p = url.pathname;
  return p.endsWith('.html')
    || p.endsWith('.css')
    || p.endsWith('.js')
    || p.endsWith('.svg')
    || p.endsWith('.json') && !isDerivedData(url);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isDerivedData(url)) {
    event.respondWith(cacheFirst(DATA_CACHE, request));
    return;
  }
  if (isShell(url)) {
    event.respondWith(staleWhileRevalidate(SHELL_CACHE, request));
    return;
  }
});

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const networkPromise = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return hit || (await networkPromise) || new Response('', { status: 504 });
}
