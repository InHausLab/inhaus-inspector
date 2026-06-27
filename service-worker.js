const CACHE_NAME = 'inhaus-v95';
const ASSETS = [
  'index.html',
  'styles.css',
  'db.js',
  'ui.js',
  'app.js',
  'config.js',
  'state.js',
  'storage.js',
  'inspection.js',
  'sync.js',
  'fields.js',
  'steps.js',
  'screens.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/logo.png'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  clients.claim();
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
