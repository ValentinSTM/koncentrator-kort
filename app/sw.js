/* Koncentrator-kort service worker: the app opens and works without internet.
   - app files: stored at install (precache), served from the cache, refreshed with each new version
   - map tiles you have looked at: kept (max ~3000) so known areas show offline; no bulk download (OSM tile policy)
   - data, changes and photos live in IndexedDB (app), and server calls (sync) are never cached here */
const VERSION = 'dev';
const APP_CACHE = 'kk-app-' + VERSION;
const TILE_CACHE = 'kk-tiles-v1';
const MAX_TILES = 3000;
const APP_FILES = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/i18n.js', './js/data.js', './js/app.js',
  './vendor/leaflet.js', './vendor/leaflet.css', './vendor/qrcode.js',
  './data/placement-dictionary.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('kk-app-') && k !== APP_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

async function trimTiles() {
  const c = await caches.open(TILE_CACHE); const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith((async () => {
      const c = await caches.open(TILE_CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) { c.put(req, res.clone()); if (Math.random() < 0.02) trimTiles(); }
        return res;
      } catch { return new Response('', { status: 504 }); }
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;   // e.g. sync server: always network

  e.respondWith((async () => {
    const c = await caches.open(APP_CACHE);
    if (req.mode === 'navigate') {   // app shell from cache first: opens instantly even with a weak signal
      const shell = (await c.match('./index.html')) || (await c.match('./'));
      if (shell) return shell;
      try { return await fetch(req); } catch { return Response.error(); }
    }
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res; }
    catch { return Response.error(); }
  })());
});
