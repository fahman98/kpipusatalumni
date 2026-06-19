// sw.js — Service Worker for the KPI Dashboard PWA.
//
// Strategy:
//   • Same-origin app shell (HTML/CSS/JS) → NETWORK-FIRST. New deploys appear
//     immediately while online; the cache is only a fallback for offline use.
//     This removes the old "stale Cache-First" problem that needed a manual
//     CACHE_NAME bump + hard refresh after every deploy.
//   • Cross-origin CDNs (Tailwind, FontAwesome, Chart.js) → STALE-WHILE-
//     REVALIDATE: instant from cache, refreshed in the background.
//   • Firebase / Firestore / Google APIs → bypass entirely (always network).

const CACHE_VERSION = 'v5';
const CACHE_NAME = `kpi-dashboard-${CACHE_VERSION}`;

// Same-origin app shell — kept complete & in sync with the real file list.
const PRECACHE_ASSETS = [
    './',
    './index.html',
    './style.css',
    './config.js',
    './data-seed.js',
    './manifest.json',
    './js/main.js',
    './js/api.js',
    './js/ui.js',
    './js/status.js',
    './js/charts.js',
    './js/admin.js',
    './js/takwim.js',
    './js/penjanaan.js',
    './js/gravity.js',
    './js/particles.js'
];

// ---- Install: pre-cache the shell, then activate immediately --------------
self.addEventListener('install', (event) => {
    self.skipWaiting(); // don't wait for old tabs to close
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            // allSettled so a single 404 can't abort the whole install.
            Promise.allSettled(PRECACHE_ASSETS.map((url) => cache.add(url)))
        )
    );
});

// ---- Activate: drop old caches, take control of open pages ----------------
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
            ))
            .then(() => self.clients.claim())
    );
});

// Allow the page to trigger an immediate activation if ever needed.
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING')) {
        self.skipWaiting();
    }
});

// ---- Fetch routing --------------------------------------------------------
self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    let url;
    try { url = new URL(req.url); } catch (e) { return; }

    // Auth + realtime data must never be cached.
    if (/firestore|googleapis|gstatic|firebaseio|identitytoolkit/.test(url.href)) return;

    const sameOrigin = url.origin === self.location.origin;

    if (sameOrigin) {
        // NETWORK-FIRST: always try the network; fall back to cache offline.
        event.respondWith(
            fetch(req)
                .then((res) => {
                    if (res && res.ok && res.type === 'basic') {
                        const copy = res.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                    }
                    return res;
                })
                .catch(() =>
                    caches.match(req).then((cached) => cached || caches.match('./index.html'))
                )
        );
        return;
    }

    // Cross-origin CDN assets: STALE-WHILE-REVALIDATE.
    event.respondWith(
        caches.match(req).then((cached) => {
            const network = fetch(req)
                .then((res) => {
                    if (res && (res.ok || res.type === 'opaque')) {
                        const copy = res.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                    }
                    return res;
                })
                .catch(() => cached);
            return cached || network;
        })
    );
});
