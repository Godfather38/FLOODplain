// Keeps the app openable with weak or no signal. Always tries the network first, so people
// never get an old version while they have service. Feeds and map tiles are not stored here.
const CACHE = 'floodplain-app-v2';
const WAIT_MS = 5000;
const SKIP = /\/simulation\/data\/|\/simulation\/renderer-chunks\/|\/inundation\/data\//;
const storable = (url) => url.origin === self.location.origin && !SKIP.test(url.pathname);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));

// Files the map loads later than startup (so they are never in the page's list) that are kept
// through the cleanup when already saved: the neighborhood road station list. Its address does not
// change between releases, and the network-first fetch below replaces it whenever there is signal.
const KEEP_LAZY = /\/data\/local-roads\/[^/]+-stations\.json$/;

// The page sends the files it just loaded, because they load before this worker takes control.
// Anything from an older release is dropped at the same time.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-files') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const urls = event.data.urls.filter((u) => storable(new URL(u)));
    await Promise.allSettled(urls.map((u) => cache.add(u)));
    const keep = new Set(urls);
    for (const request of await cache.keys()) {
      if (!keep.has(request.url) && !KEEP_LAZY.test(new URL(request.url).pathname)) await cache.delete(request);
    }
  })());
});

// A slow answer is never cut off: a slow host would otherwise break a page's code for good. After
// WAIT_MS a saved copy is used if there is one; with none, the network answer is awaited.
async function fromNetworkFirst(request) {
  const cache = await caches.open(CACHE);
  // The app's home page stands in only for the app's own top-level page, never for another page
  // (such as the 3D view in its frame), which would then load the wrong document.
  const home = new URL('./', self.location).href, url = new URL(request.url);
  const isAppPage = request.mode === 'navigate' && request.destination === 'document' && (url.href.split(/[?#]/)[0] === home || url.pathname.endsWith('/index.html') && new URL('index.html', home).pathname === url.pathname);
  const savedCopy = async () => (await cache.match(request)) ?? (request.mode === 'navigate' ? (await cache.match(request, { ignoreSearch: true })) ?? (isAppPage ? await cache.match(home) : null) : null);
  const network = (async () => {
    const response = await fetch(request);
    if (response.ok && storable(new URL(request.url))) cache.put(request, response.clone());
    return response;
  })();
  let timer;
  const slow = new Promise((resolve) => { timer = setTimeout(resolve, WAIT_MS); }).then(savedCopy).then((saved) => saved ?? network);
  try {
    return await Promise.race([network, slow]);
  } catch (error) {
    const saved = await savedCopy();
    if (saved) return saved;
    throw error;
  } finally { clearTimeout(timer); }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || SKIP.test(url.pathname)) return;
  event.respondWith(fromNetworkFirst(event.request));
});
