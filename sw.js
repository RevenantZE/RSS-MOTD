const CACHE_NAME = "rss-ze-guide-v3";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./lang.js",
  "./script.js",
  "./faq.json",
  "./commands.json",
  "./terms.json",
  "./manifest.webmanifest",
  "./icon.svg",
  "./vendor/es-hangul.mjs",
  "./vendor/pico.conditional.min.css"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
        return response;
      }).catch(() => null);
      return cached || network.then(response => response || (
        event.request.mode === "navigate" ? caches.match("./index.html") : Response.error()
      ));
    })
  );
});
