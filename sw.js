// EQ Solves — Field  ·  Service Worker  v3.4.9
const CACHE = 'eq-field-v3.4.9';

const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/styles/base.css',
  '/styles/mobile.css',
  '/styles/print.css',
  '/scripts/app-state.js',
  '/scripts/utils.js',
  '/scripts/supabase.js',
  '/scripts/roster.js',
  '/scripts/people.js',
  '/scripts/sites.js',
  '/scripts/managers.js',
  '/scripts/dashboard.js',
  '/scripts/batch.js',
  '/scripts/leave.js',
  '/scripts/tafe.js',
  '/scripts/timesheets.js',
  '/scripts/jobnumbers.js',
  '/scripts/import-export.js',
  '/scripts/calendar.js',
  '/scripts/audit.js',
  '/scripts/auth.js',
  '/scripts/trial-dashboard.js',
  '/scripts/apprentices.js',
  '/scripts/journal.js',
];

// Static assets that rarely change — cache-first is safe
const CACHE_FIRST_PATHS = ['/manifest.json', '/icons/'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).catch(() => {})
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Only cache GET requests for same origin
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;

  // Cache-first ONLY for truly static assets (icons, manifest)
  if (CACHE_FIRST_PATHS.some(p => path.startsWith(p))) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          const c = res.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, c));
          return res;
        });
      })
    );
    return;
  }

  // Network-first for everything else (HTML, JS, CSS)
  // Ensures updates are picked up immediately, with cache fallback for offline
  event.respondWith(
    fetch(event.request)
      .then(res => {
        const c = res.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, c));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
