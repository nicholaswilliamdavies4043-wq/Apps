/*
 * Service worker: keeps the app itself on the device so it opens without a connection.
 * Data is NOT handled here — the app keeps its own device copy and queue (js/api.js).
 * Bump VERSION when files change so devices pick up the new version.
 */
const VERSION = 'mhp-1.2.0-buckets1';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/core.js', 'js/api.js', 'js/ui.js', 'js/view-sites.js', 'js/view-dashboard.js', 'js/view-fleet.js', 'js/view-chat.js',
  'js/view-admin.js', 'js/widgets.js', 'js/app.js',
  'vendor/chart.umd.min.js', 'vendor/qrcode.js', 'vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js',
  'img/favicon.svg', 'img/hero.jpg', 'img/quarry.svg', 'img/icon-192.png', 'img/icon-512.png', 'img/icon-180.png',
  'apps/underground-plan-calculator.html'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(ASSETS.map((a) => c.add(a).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.includes('/api/')) return; // data goes straight to the server
  if (req.mode === 'navigate') {
    // page: try the network first (fresh version), fall back to the device copy
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put('index.html', copy)); return r; })
      .catch(() => caches.match('index.html')));
    return;
  }
  // files: device copy first, refresh it in the background
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => {
    const net = fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
