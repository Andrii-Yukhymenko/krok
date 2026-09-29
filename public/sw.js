const APP_ROOT = new URL('./', self.location.href);
const CACHE_PREFIX = 'krok-' + APP_ROOT.pathname + '-';
const VERSION = CACHE_PREFIX + 'v1';
const PRECACHE = ['.', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) =>
        cache.addAll(PRECACHE.map((file) => new URL(file, APP_ROOT).href)),
      ),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // External tiles and route requests follow provider HTTP caching, never bulk cached.
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(APP_ROOT.pathname)
  )
    return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (
            response.ok &&
            response.type === 'basic' &&
            [APP_ROOT.pathname, APP_ROOT.pathname + 'index.html'].includes(
              new URL(response.url).pathname,
            )
          ) {
            const copy = response.clone();
            event.waitUntil(
              caches
                .open(VERSION)
                .then((cache) => cache.put(APP_ROOT.href, copy)),
            );
          }
          return response;
        })
        .catch(
          async () =>
            (await caches.match(APP_ROOT.href)) ||
            new Response(
              'Відкрийте Крок з інтернетом перед використанням офлайн.',
              { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
            ),
        ),
    );
    return;
  }
  if (/\.(js|css|png|svg|woff2)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok && response.type === 'basic') {
              const copy = response.clone();
              event.waitUntil(
                caches.open(VERSION).then((cache) => cache.put(request, copy)),
              );
            }
            return response;
          }),
      ),
    );
  }
});
