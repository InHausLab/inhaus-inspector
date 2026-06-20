const CACHE_NAME = 'inhaus-v91';
const ASSETS = [
  'index.html',
  'styles.css',
  'db.js',
  'ui.js',
  'app.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/logo.png'
];

self.addEventListener('install', e => {
  // Do NOT call skipWaiting() — wait for all tabs to close before activating.
  // This prevents mid-inspection reloads when a new version is pushed.
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  // Do NOT call clients.claim() — existing sessions keep the old SW until they reload.
});

self.addEventListener('fetch', e => {
  // Network-first: always try network, fall back to cache for offline
  e.respondWith(
    fetch(e.request).then(response => {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      return response;
    }).catch(() => caches.match(e.request))
  );
});
