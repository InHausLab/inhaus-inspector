// InHaus Inspector Service Worker v141
// Safe iOS Safari implementation - June 28 2026
//
// Rules:
// - NO skipWaiting() - causes Safari IPC deadlock/freeze
// - YES clients.claim() in activate - safe without skipWaiting
// - Cache-first for app shell (offline is primary use case)
// - Never cache POST requests or Cloudflare Worker calls
// - updateViaCache:none set in registration (bypasses GitHub Pages sw.js caching)
// - no-cache fetch in install (bypasses GitHub Pages max-age=600)

const CACHE_NAME = 'inhaus-v141';

const APP_SHELL = [
  './',
  './index.html',
  './app.js?v=141',
  './screens.js?v=141',
  './sync.js?v=141',
  './ui.js?v=141',
  './steps.js?v=141',
  './config.js?v=141',
  './storage.js?v=141',
  './fields.js?v=141',
  './inspection.js?v=141',
  './db.js?v=141',
  './state.js?v=141',
  './styles.css',
  './manifest.json',
];

// Install: cache app shell with no-cache fetch
// (bypasses GitHub Pages max-age=600 which can serve stale HTML/JS)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(
        APP_SHELL.map(url => new Request(url, { cache: 'no-cache' }))
      )
    )
    // NO self.skipWaiting() here - that's the iOS Safari freeze bug
  );
});

// Activate: delete old caches, claim clients
// clients.claim() is safe without skipWaiting
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      )
      .then(() => clients.claim())
  );
});

// Fetch: cache-first for GET requests to app shell
// Never cache POST requests or Cloudflare Worker calls
self.addEventListener('fetch', event => {
  const { request } = event;

  // Never cache POST/PUT/DELETE
  if (request.method !== 'GET') return;

  // Never cache Cloudflare Worker API calls
  if (request.url.includes('workers.dev')) return;

  // Never cache Google services
  if (request.url.includes('google')) return;

  const url = new URL(request.url);
  const bypassStandaloneRoute =
    url.pathname === '/reports' ||
    url.pathname.startsWith('/reports/') ||
    url.pathname === '/workbench' ||
    url.pathname.startsWith('/workbench/') ||
    url.pathname === '/readiness' ||
    url.pathname.startsWith('/readiness/');
  if (url.origin === self.location.origin && bypassStandaloneRoute) return;

  // Cache-first for everything else (app shell)
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        // Only cache valid responses
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const toCache = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, toCache));
        return response;
      });
    })
  );
});
