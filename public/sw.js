// Service Worker: Offline-Hülle für die App. Die API wird nie zwischengespeichert,
// damit Ergebnisse immer vom Server kommen. Bei jeder Änderung der Hülle die Version erhöhen.
const CACHE = 'tm-shell-v2';
const NAVIGATION_TIMEOUT_MS = 4000;

const isHtml = (res) => (res.headers.get('content-type') || '').includes('text/html');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => fetch('/').then((res) => (res.ok && isHtml(res) ? cache.put('/', res) : null)))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api.php')) return;

  // Seitenaufrufe: zuerst Netzwerk (max. 4 s), danach die gespeicherte App-Hülle. Nur gute HTML-Antworten werden gespeichert.
  if (request.mode === 'navigate') {
    const network = fetch(request).then((res) => {
      if (res.ok && isHtml(res)) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put('/', copy));
      }
      return res;
    });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAVIGATION_TIMEOUT_MS));
    event.respondWith(
      Promise.race([network, timeout]).catch(async () => (await caches.match('/')) || network),
    );
    return;
  }

  // Schriften, Skripte, Icons und Fotos: aus dem Speicher, im Hintergrund erneuern.
  // Fehlerseiten und HTML-Antworten unter Datei-Adressen werden nie gespeichert.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok && !isHtml(res)) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
