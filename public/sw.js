// Semester Library Minimal Safe Service Worker for PWA Installation
const CACHE_NAME = 'semester-library-static-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/style.v4.css'
];

// Install Event - Pre-cache safe core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - Clean up stale caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Safe handling: NEVER cache APIs, Auth, Chat, or Mutations
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. Never handle non-GET requests via cache
  if (req.method !== 'GET') {
    return;
  }

  // 2. Never cache dynamic API routes, auth endpoints, chat, uploads, or Supabase calls
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth') ||
    url.pathname.startsWith('/logout') ||
    url.pathname.startsWith('/login') ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('neon.tech')
  ) {
    return; // Pass directly to network
  }

  // 3. For safe static assets (CSS, JS, images, icons, fonts): Stale-While-Revalidate / Network-First
  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      const fetchPromise = fetch(req).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // If offline and no network, return cached response if available
        return cachedResponse;
      });

      return cachedResponse || fetchPromise;
    })
  );
});
