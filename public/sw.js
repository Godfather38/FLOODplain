// Keeps the app openable with weak or no signal. Always tries the network first, so people
// never get an old version while they have service. Feeds and map tiles are not stored here.
const CACHE = 'floodplain-app-v1';
const WAIT_MS = 5000;
const SKIP = /\/simulation\/data\/|\/simulation\/renderer-chunks\/|\/inundation\/data\//;
const storable = (url) => url.origin === self.location.origin && !SKIP.test(url.pathname);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));

// The page sends the files it just loaded, because they load before this worker takes control.
// Anything from an older release is dropped at the same time.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-files') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const urls = event.data.urls.filter((u) => storable(new URL(u)));
    await Promise.allSettled(urls.map((u) => cache.add(u)));
    const keep = new Set(urls);
    for (const request of await cache.keys()) if (!keep.has(request.url)) await cache.delete(request);
  })());
});

async function fromNetworkFirst(request) {
  const cache = await caches.open(CACHE);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WAIT_MS);
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (response.ok && storable(new URL(request.url))) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const saved = await cache.match(request) ?? (request.mode === 'navigate' ? await cache.match(new URL('./', self.location).href) ?? await cache.match(request, { ignoreSearch: true }) : null);
    if (saved) return saved;
    throw error;
  } finally { clearTimeout(timer); }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || SKIP.test(url.pathname)) return;
  event.respondWith(fromNetworkFirst(event.request));
});
