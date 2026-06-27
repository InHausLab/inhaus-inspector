// Service worker self-destruct — unregisters and clears all caches on install
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => clients.matchAll({ includeUncontrolled: true }))
      .then(cls => cls.forEach(c => c.navigate(c.url)))
  );
});
