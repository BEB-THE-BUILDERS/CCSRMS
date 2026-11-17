/* =========================================================
   CCS Room Management System — Service Worker
   Caches the app shell for offline / fast loads.
   ========================================================= */

const CACHE_NAME = 'ccsrms-v4';

// App shell: files to cache immediately on install
const SHELL_ASSETS = [
  './',
  './index.html',
  './home.html',
  './landing.html',
  './student.html',
  './student.js',
  './main.js',
  './logo.png',
  './logo-gc-ccs.png',
  './styles.css',
  './manifest.json'
];

// ── Install: pre-cache the app shell ──────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    // One missing file must not abort the whole install (addAll fails if any single file 404s)
    caches.open(CACHE_NAME).then(cache => Promise.allSettled(SHELL_ASSETS.map(a => cache.add(a))))
  );
  self.skipWaiting();
});

// ── Activate: clean up old caches ─────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: Network-first for API/Supabase,
//           Cache-first for everything else ─────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go to network for Supabase (real-time data)
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('cloudflare.com') ||
      url.hostname.includes('jsdelivr.net')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache-first for app shell assets
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Only cache successful same-origin responses
        if (
          response.ok &&
          event.request.method === 'GET' &&
          url.origin === self.location.origin
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // Offline fallback for navigation requests
      if (event.request.mode === 'navigate') {
        return caches.match('./index.html');
      }
    })
  );
});