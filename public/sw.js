// Service worker : met l'application en cache pour qu'elle s'ouvre sans réseau.
// Les données ne passent jamais par ici : elles restent dans IndexedDB sur l'appareil.
const SCOPE = self.registration.scope;
// un cache par version publiée (principale et bêta partagent le même site)
const CACHE = 'vpa-v4:' + SCOPE;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([SCOPE, SCOPE + 'manifest.webmanifest', SCOPE + 'icon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && (k.endsWith(':' + SCOPE) || !k.includes(':'))).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // la version bêta (sous-dossier beta/) a son propre service worker
  if (url.href.startsWith(SCOPE + 'beta/')) return;
  // Pages : réseau d'abord (pour recevoir les mises à jour), cache si hors ligne
  if (req.mode === 'navigate') {
    e.respondWith(
      // « no-cache » : on revalide toujours auprès du serveur, jamais d'ancienne page en cache HTTP
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          caches.open(CACHE).then((c) => c.put(SCOPE, res.clone()));
          return res;
        })
        .catch(() => caches.match(SCOPE)),
    );
    return;
  }
  // la page elle-même (index.html) n'est jamais servie depuis le cache quand le réseau répond
  if (url.href === SCOPE || url.href === SCOPE + 'index.html') {
    e.respondWith(fetch(req, { cache: 'no-cache' }).catch(() => caches.match(SCOPE)));
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
