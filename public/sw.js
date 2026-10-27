// Service worker : met l'application en cache pour qu'elle s'ouvre sans réseau.
// Les données ne passent jamais par ici : elles restent dans IndexedDB sur l'appareil.
const CACHE = 'vpa-v2';
const SCOPE = self.registration.scope;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([SCOPE, SCOPE + 'manifest.webmanifest', SCOPE + 'icon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Pages : réseau d'abord (pour recevoir les mises à jour), cache si hors ligne
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put(SCOPE, res.clone()));
          return res;
        })
        .catch(() => caches.match(SCOPE)),
    );
    return;
  }
  // Fichiers versionnés et polices : cache d'abord
  if (url.href.startsWith(SCOPE) || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok || res.type === 'opaque') {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
