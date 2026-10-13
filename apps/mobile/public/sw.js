/*
 * Service worker de FAKTU (PWA).
 *
 * Objetivo: que la app abra aunque no haya Internet, para poder registrar
 * ventas que se sincronizan después. Solo guarda en caché la aplicación
 * (HTML, JS, íconos); NUNCA respuestas de la API ni comprobantes.
 */
// Subir este número al cambiar iconos, manifest u otros archivos sin hash en el nombre; si no, la app instalada sigue mostrando los viejos.
const CACHE = "faktu-app-v2";
const PRECACHE = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png", "/favicon.png"];
const NEVER_CACHE = [/^\/v1\//, /^\/r(\/|$|\?)/, /^\/g(\/|$|\?)/, /^\/exports\//, /^\/health(\/|$)/];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((pattern) => pattern.test(url.pathname))) return;

  // Navegación: primero la red (siempre la versión más nueva); sin red, la app guardada.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  // Archivos de la app con nombre versionado: caché primero.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    }))
  );
});
