const VERSION = 'krok-v1';
const PRECACHE = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(PRECACHE)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('krok-') && key !== VERSION).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // External tiles and route requests follow provider HTTP caching, never bulk cached.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok && response.type === 'basic' && new URL(response.url).pathname === '/') {
        const copy = response.clone(); event.waitUntil(caches.open(VERSION).then(cache => cache.put('/', copy)));
      }
      return response;
    }).catch(async () => (await caches.match('/')) || new Response('Відкрийте Крок з інтернетом перед використанням офлайн.', {headers:{'Content-Type':'text/plain; charset=utf-8'}})));
    return;
  }
  if (/\.(js|css|png|svg|woff2)$/.test(url.pathname)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok && response.type === 'basic') { const copy=response.clone(); event.waitUntil(caches.open(VERSION).then(cache => cache.put(request,copy))); }
      return response;
    })));
  }
});
