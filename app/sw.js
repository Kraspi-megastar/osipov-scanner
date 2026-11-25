// Офлайн-кэш: оболочка приложения — из кэша, данные рынка — сначала из сети.
const VER = "osipov-v5";
const SHELL = ["./", "index.html", "app.js", "scanner.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "vendor/lightweight-charts.standalone.production.js", "vendor/qrcode.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const isData = url.pathname.includes("/data/");
  const isShell = !isData;
  // данные и сама страница — сеть, при отсутствии сети — кэш
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && (isData || isShell)) { const copy = r.clone(); caches.open(VER).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then(m => m || caches.match("index.html"))));
});
