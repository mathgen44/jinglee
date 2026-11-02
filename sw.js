// Service worker : met l'application en cache pour un fonctionnement hors-ligne.
// Les sons ne passent pas par ici : ils sont stockés dans IndexedDB.

const CACHE = 'jinglee-v1.4.0';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js',
  'js/audio.js',
  'js/show.js',
  'js/model.js',
  'js/db.js',
  'js/dom.js',
  'js/editor.js',
  'js/archive.js',
  'js/zip.js',
  'js/device.js',
  'js/install.js',
  'js/timeline.js',
  'js/progress.js',
  'js/media.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  // cache: 'reload' : on va chercher les fichiers sur le réseau, sans repasser par le cache HTTP du navigateur
  // (sinon une nouvelle version peut se mettre en cache avec les anciens fichiers).
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
