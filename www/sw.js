/* Self-destroying service worker.
   The old standalone app registered a caching SW that could keep serving stale
   files. This version unregisters itself and clears all caches so every browser
   loads the current Hub. It never caches anything. */
self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    try {
      var keys = await caches.keys();
      await Promise.all(keys.map(function (k) { return caches.delete(k); }));
    } catch (e) { /* ignore */ }
    try { await self.registration.unregister(); } catch (e) { /* ignore */ }
    try {
      var clients = await self.clients.matchAll();
      clients.forEach(function (c) { try { c.navigate(c.url); } catch (e) {} });
    } catch (e) { /* ignore */ }
  })());
});
