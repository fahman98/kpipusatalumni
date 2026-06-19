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

const CACHE_VERSION = 'v6';
const CACHE_NAME = `kpi-dashboard-${CACHE_VERSION}`;

// Same-origin app shell — kept complete & in sync with the real file list.
const PRECACHE_ASSETS = [
    './',
    './index.html',
    './style.css',
    './config.js',
    './data-seed.js',
    './js/main.js',
    './js/api.js',
    './js/ui.js',
    './js/charts.js',
    './js/admin.js',
];

const CDN_HOSTS = [
    'cdn.tailwindcss.com',
    'cdnjs.cloudflare.com',
    'cdn.jsdelivr.net',
    'cdn-icons-png.flaticon.com',
    'unpkg.com',
];

// Install: precache same-origin app shell only
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(PRECACHE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate: delete all old caches, claim clients immediately
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// Fetch routing
self.addEventListener('fetch', (event) => {
    const { request } = event;
    let url;
    try { url = new URL(request.url); } catch (_) { return; }

    // Bypass Firebase / Google APIs — always go straight to network
    if (
        url.hostname.includes('firebaseapp.com') ||
        url.hostname.includes('firebaseio.com') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('google.com') ||
        url.hostname.includes('firestore')
    ) {
        return;
    }

    // CDN assets: stale-while-revalidate
    if (CDN_HOSTS.some(h => url.hostname.includes(h))) {
        event.respondWith(
            caches.open(CACHE_NAME).then(cache =>
                cache.match(request).then(cached => {
                    const networkFetch = fetch(request).then(response => {
                        if (response && response.status === 200) {
                            cache.put(request, response.clone());
                        }
                        return response;
                    }).catch(() => null);
                    return cached || networkFetch;
                })
            )
        );
        return;
    }

    // Same-origin app shell: network-first, fall back to cache when offline
    if (url.origin === self.location.origin) {
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (response && response.status === 200) {
                        caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
                    }
                    return response;
                })
                .catch(() => caches.match(request))
        );
    }
});
