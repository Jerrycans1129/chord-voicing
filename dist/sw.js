// Bump this version whenever app assets change. Updates activate after all
// existing app windows close, so an active training session is not interrupted.
const CACHE_PREFIX = `voicing-${self.registration.scope}-`;
const CACHE_NAME = `${CACHE_PREFIX}v4`;
const ASSETS = ['./', './index.html', './style.css', './app.js', './theory.js',
  './pwa.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const assetURLs = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
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
