// Service Worker: Offline-Fähigkeit + automatische Updates.
// Strategie "Netzwerk zuerst": Ist das iPhone online, kommt immer die neueste Version vom Server;
// offline wird die zuletzt geladene Version aus dem Cache verwendet.
// Bei Änderungen an der App reicht es, die Dateien neu hochzuladen – VERSION erhöhen räumt alte Caches auf.

const VERSION = 'bz-1.3.0';
const ASSETS = [
  './', './index.html', './style.css', './manifest.webmanifest',
  './js/app.js', './js/auth.js', './js/graph.js', './js/parser.js', './js/holidays.js', './js/store.js', './js/chart.js', './js/util.js', './js/chartocr.js',
  './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Microsoft-Anfragen nie cachen
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok && !url.search) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
