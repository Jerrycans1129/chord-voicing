// The build stamps this cache with the deployed asset fingerprint.
const CACHE_PREFIX = `voicing-${self.registration.scope}-`;
const CACHE_NAME = `${CACHE_PREFIX}v23-b090f9d-80f5f6173fef`;
const ASSETS = ['./', './index.html', './style.css', './app.js', './learning.js', './build.js', './theory.js', './scheduler.js', './scoring.js', './judgment.js', './performance.js',
  './pwa.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const assetURLs = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const requests = ASSETS.map(path => new Request(new URL(path, self.registration.scope), {cache: 'reload'}));
    await cache.addAll(requests);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
    .map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  url.search = '';
  if (event.request.method !== 'GET' || !assetURLs.has(url.href)) return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache =>
    (await cache.match(url.href)) || fetch(event.request)));
});
