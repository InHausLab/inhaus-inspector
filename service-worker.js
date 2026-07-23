// InHaus Inspector Service Worker v205
// Safe iOS Safari implementation - June 28 2026
//
// Rules:
// - NO skipWaiting() - causes Safari IPC deadlock/freeze
// - YES clients.claim() in activate - safe without skipWaiting
// - Cache-first for app shell (offline is primary use case)
// - Never cache POST requests or Cloudflare Worker calls
// - updateViaCache:none set in registration (bypasses GitHub Pages sw.js caching)
// - no-cache fetch in install (bypasses GitHub Pages max-age=600)

const CACHE_NAME = 'inhaus-v205';

const APP_SHELL = [
  './',
  './index.html',
  './cache-reset.html',
  './app.js?v=205',
  './screens.js?v=205',
  './sync.js?v=205',
  './ui.js?v=205',
  './steps.js?v=205',
  './config.js?v=205',
  './storage.js?v=205',
  './fields.js?v=205',
  './inspection.js?v=205',
  './findings.js?v=205',
  './photo-routing.js?v=205',
  './comment-library.js?v=205',
  './feedback.js?v=205',
  './comment-library-admin.html',
  './comment-library-admin.js?v=205',
  './db.js?v=205',
  './state.js?v=205',
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

  if (
    url.pathname.endsWith('/cache-reset.html') ||
    url.pathname.endsWith('/index.html') ||
    request.mode === 'navigate' ||
    request.destination === 'document'
  ) {
    event.respondWith(
      fetch(new Request(request, { cache: 'no-store' }))
        .then(response => {
          if (!response || response.status !== 200 || response.type !== 'basic') return response;
          const toCache = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, toCache));
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

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

// ── Update message handler ────────────────────────────────
// Banner in index.html posts SKIP_WAITING when user clicks Reload.
// skipWaiting() here is safe because it is user-initiated (not automatic).
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Timer notifications should reopen/focus the inspection when tapped.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      const existing = windowClients.find(client => 'focus' in client);
      if (existing) return existing.focus();
      return clients.openWindow('./');
    })
  );
});
