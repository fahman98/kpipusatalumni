// sw.js — Service Worker for the KPI Dashboard PWA.
//
// Strategy:
//   • Same-origin app shell (HTML/CSS/JS) → NETWORK-FIRST. New deploys appear
//     immediately while online; the cache is only a fallback for offline use.
//     This removes the old "stale Cache-First" problem that needed a manual
//     CACHE_NAME bump + hard refresh after every deploy.
//   • Cross-origin CDNs (Tailwind, FontAwesome, Chart.js) → STALE-WHILE-
//     REVALIDATE: instant from cache, refreshed in the background.
//   • Firestore / Auth traffic → bypass entirely (always network). The Firebase
//     SDK bundles themselves ARE cached — the app cannot boot without them.

const CACHE_VERSION = 'v9';
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
    './js/auth.js',
    './js/status.js',
    './js/charts.js',
    './js/admin.js',
    './js/takwim.js',
    './js/penjanaan.js',
    './js/gravity.js',
    './js/particles.js'
];

// Hosts that serve live data / auth traffic. Everything else — including the
// Firebase SDK bundles and Google Fonts — is safe to cache and is required for
// the app to boot offline.
const NEVER_CACHE_HOST =
    /^(firestore|identitytoolkit|securetoken|firebaseinstallations|firebaseremoteconfig|firebasestorage)\.googleapis\.com$|\.firebaseio\.com$/;

// Third-party code the app cannot boot without. Precached so that even the very
// first offline launch works; `allSettled` below means a failure here can never
// abort the install.
const PRECACHE_VENDOR = [
    'https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js',
    'https://www.gstatic.com/firebasejs/8.10.1/firebase-auth.js',
    'https://www.gstatic.com/firebasejs/8.10.1/firebase-firestore.js'
];

// ---- Install: pre-cache the shell, then activate immediately --------------
self.addEventListener('install', (event) => {
    self.skipWaiting(); // don't wait for old tabs to close
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            // allSettled so a single 404 can't abort the whole install.
            Promise.allSettled(
                PRECACHE_ASSETS.concat(PRECACHE_VENDOR).map((url) => cache.add(url))
            )
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

    // Auth + realtime data must never be cached — always straight to network.
    //
    // This matches on HOSTNAME, deliberately. The old test ran against the whole
    // URL for `gstatic` / `googleapis`, which also caught
    // www.gstatic.com/firebasejs/** (the Firebase SDK itself) and
    // fonts.googleapis.com / fonts.gstatic.com. Those were therefore never
    // cached, so offline the SDK failed to load, `firebase` was undefined,
    // config.js threw, and the whole app rendered a blank page — while the
    // offline banner still claimed it was showing cached data.
    if (NEVER_CACHE_HOST.test(url.hostname)) return;

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
                    // ignoreSearch: the shell is precached under clean paths
                    // ('./js/main.js') while the page requests them with a
                    // cache-busting query ('js/main.js?v=3.5'). Without this the
                    // offline lookup misses and the `|| index.html` fallback
                    // hands back HTML in response to a JS module request, which
                    // breaks the page harder than a plain network error.
                    caches.match(req, { ignoreSearch: true }).then((cached) =>
                        cached || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)
                    )
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
