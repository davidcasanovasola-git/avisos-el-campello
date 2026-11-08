// Service worker: la app funciona sin conexión (hacer fotos, ubicar y guardar como pendiente).
// Sube VERSION cada vez que cambies ficheros de la app.
const VERSION = "avisos-v4";
const SHELL = [
  "/", "/index.html", "/styles.css", "/app.js", "/manifest.webmanifest",
  "/js/cripto.js", "/js/db.js", "/js/imagen.js", "/js/textos.js", "/js/calles.js", "/js/pdf.js",
  "/vendor/leaflet/leaflet.js", "/vendor/leaflet/leaflet.css",
  "/vendor/leaflet/images/marker-icon.png", "/vendor/leaflet/images/marker-icon-2x.png", "/vendor/leaflet/images/marker-shadow.png",
  "/vendor/exifr.lite.umd.js", "/vendor/jspdf.umd.min.js",
  "/icons/icon.svg", "/icons/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // Red primero (para recibir actualizaciones); si no hay red, la copia guardada.
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) {
          const copia = r.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copia));
        }
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html"))),
  );
});
