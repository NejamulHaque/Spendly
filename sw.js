/* ============================================================
   NESTFY — sw.js (Service Worker)
   Strategy:
   - HTML:        Network-first  (always fresh)
   - JS / CSS:    Network-first  (always fresh, cache as fallback)
   - Images/Icons:Cache-first    (rarely change)
   - Fonts/CDN:   Cache-first    (stable third-party assets)
   - Firebase:    Never cached   (always live)
   ============================================================ */

// Auto-versioned by deploy timestamp — guarantees old caches are wiped
const VERSION = 'nestfy-v1773790903';
const STATIC_CACHE  = `${VERSION}-static`;
const DYNAMIC_CACHE = `${VERSION}-dynamic`;

// Only pre-cache icons and manifest — NOT JS/CSS (they use network-first)
const PRECACHE_ASSETS = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── Install ───────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing', VERSION);
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())   // activate immediately
      .catch(err => {
        console.warn('[SW] Pre-cache failed (non-fatal):', err);
        return self.skipWaiting();      // still activate even if icons missing
      })
  );
});

// ── Activate: wipe ALL old caches ────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating', VERSION);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== STATIC_CACHE && k !== DYNAMIC_CACHE)
          .map(k => { console.log('[SW] Deleting old cache:', k); return caches.delete(k); })
      ))
      .then(() => self.clients.claim())  // take control of all open tabs immediately
  );
});

// ── Fetch ─────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET
  if (request.method !== 'GET') return;

  // ── Never cache Firebase/Google API calls ────────────────────
  if (
    url.hostname.includes('firestore.googleapis.com')   ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com') ||
    url.hostname.includes('firebase.googleapis.com')    ||
    url.hostname.includes('googleapis.com')             ||
    url.hostname.includes('firebaseapp.com')            ||
    url.hostname.includes('anthropic.com')
  ) return;

  // ── HTML navigations: network-first, no stale cache ─────────
  if (request.mode === 'navigate' ||
      (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }

  // ── App JS / CSS: network-first so deploys are instant ──────
  if (url.origin === self.location.origin &&
      (url.pathname.endsWith('.js') || url.pathname.endsWith('.css'))) {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }

  // ── Google Fonts: cache-first (stable) ───────────────────────
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirst(request, DYNAMIC_CACHE));
    return;
  }

  // ── CDN assets (Chart.js, FontAwesome): cache-first ─────────
  if (url.hostname.includes('cdn.jsdelivr.net') ||
      url.hostname.includes('cdnjs.cloudflare.com') ||
      url.hostname.includes('gstatic.com')) {
    event.respondWith(cacheFirst(request, DYNAMIC_CACHE));
    return;
  }

  // ── Icons / images: cache-first ──────────────────────────────
  if (url.origin === self.location.origin &&
      (url.pathname.startsWith('/icons/') || url.pathname.match(/\.(png|jpg|svg|ico|webp)$/))) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // ── Everything else: network-first ───────────────────────────
  event.respondWith(networkFirst(request, DYNAMIC_CACHE));
});

// ── Network-first: try network, fall back to cache ───────────
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Ultimate fallback for navigation
    if (request.mode === 'navigate') {
      const fallback = await caches.match('/index.html');
      if (fallback) return fallback;
    }
    return new Response('Offline — please reconnect', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

// ── Cache-first: serve from cache, fetch if missing ──────────
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

// ── Message handler ───────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── Push notifications ────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title || 'Nestfy', {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    data: { url: data.url || '/' }
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});