// =============================================================================
// Semester Library — Instant Navigation & App Shell Service Worker
// - Cache-first for App Shell (shared CSS/JS, fonts, logo/icons)
// - Network-first with offline cache fallback for HTML pages & public syllabus/routine
// - Strictly NEVER caches auth, uploads, chat, or per-user API responses
// - Includes versioned update flow + emergency kill-switch flag (SW_DISABLED)
// =============================================================================

const SW_VERSION = 'v25';
const SW_DISABLED = false; // Emergency kill-switch flag: set to true to self-unregister and purge caches
const SHELL_CACHE = `semester-library-shell-${SW_VERSION}`;
const PAGE_CACHE = `semester-library-pages-${SW_VERSION}`;

const APP_SHELL_ASSETS = [
  '/',
  '/manifest.json',
  '/theme.js',
  '/js/swr.js',
  '/style.v4.css',
  '/chatbot.css',
  '/auth-modal.css',
  '/theme-overrides.css',
  '/markdown.js',
  '/syllabus-helper.js',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/logo.jpg'
];

// Paths that must NEVER be cached by the Service Worker
function isExcludedFromSwCache(url) {
  const p = url.pathname;
  if (
    p.startsWith('/api/auth') ||
    p.startsWith('/api/login') ||
    p.startsWith('/api/logout') ||
    p.startsWith('/api/me') ||
    p.startsWith('/api/profile') ||
    p.startsWith('/api/academic-context') ||
    p.startsWith('/api/chat') ||
    p.startsWith('/api/dm') ||
    p.startsWith('/api/notifications') ||
    p.startsWith('/api/files') ||
    p.startsWith('/api/library') ||
    p.startsWith('/api/posts') ||
    p.startsWith('/api/code-lab') ||
    p.startsWith('/api/admin') ||
    p.startsWith('/api/teacher') ||
    p.startsWith('/api/attendance') ||
    p.startsWith('/api/search') ||
    p.startsWith('/api/students') ||
    p.startsWith('/uploads/') ||
    p.startsWith('/auth') ||
    p.startsWith('/js/auth') ||
    p.startsWith('/academic-context') ||
    p.startsWith('/login') ||
    p.startsWith('/register') ||
    p.startsWith('/reset-password') ||
    p.startsWith('/logout') ||
    p.startsWith('/teacher-') ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('neon.tech')
  ) {
    return true;
  }
  return false;
}

function isAppShellAsset(url) {
  const p = url.pathname;
  if (APP_SHELL_ASSETS.includes(p)) return true;
  if (url.hostname === 'fonts.gstatic.com') return true;
  return /\.(css|woff2?|ttf|otf|webp|png|jpe?g|svg|ico)$/i.test(p) && !p.startsWith('/uploads/') && !p.startsWith('/api/');
}

function isPublicDataEndpoint(url) {
  const p = url.pathname;
  return p === '/syllabus-data.json' || p === '/api/routine';
}

self.addEventListener('install', (event) => {
  if (SW_DISABLED) {
    self.skipWaiting();
    return;
  }
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache warning:', err);
      }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  if (SW_DISABLED) {
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => self.registration.unregister())
    );
    return;
  }
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.map((key) => {
          if (key !== SHELL_CACHE && key !== PAGE_CACHE) {
            return caches.delete(key);
          }
        })
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'DISABLE_SW') {
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister());
  }
});

self.addEventListener('fetch', (event) => {
  if (SW_DISABLED) return;

  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 1. Never intercept auth, uploads, chat, or per-user API calls
  if (isExcludedFromSwCache(url)) {
    return;
  }

  // 2. Network-first for HTML documents & public non-user data (/syllabus-data.json, /api/routine)
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || isPublicDataEndpoint(url)) {
    // Do not cache chat.html shell if realtime session state is active
    if (url.pathname === '/chat.html' || url.pathname === '/chat') return;

    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.ok && (networkRes.type === 'basic' || networkRes.type === 'cors')) {
            const clone = networkRes.clone();
            event.waitUntil(
              caches.open(PAGE_CACHE).then((cache) => cache.put(req, clone)).catch(() => {})
            );
          }
          return networkRes;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          if (req.mode === 'navigate') {
            const dashFallback = await caches.match('/dashboard.html') || await caches.match('/');
            if (dashFallback) return dashFallback;
          }
          return Response.error();
        })
    );
    return;
  }

  // 3. Cache-first with background refresh for App Shell (shared CSS, JS, fonts, icons, images)
  if (isAppShellAsset(url) || url.pathname.endsWith('.js')) {
    event.respondWith(
      caches.match(req).then((cachedRes) => {
        const networkFetch = fetch(req)
          .then((networkRes) => {
            if (networkRes && networkRes.status === 200 && (networkRes.type === 'basic' || networkRes.type === 'cors')) {
              const clone = networkRes.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(req, clone)).catch(() => {});
            }
            return networkRes;
          })
          .catch(() => cachedRes || Response.error());

        return cachedRes || networkFetch;
      })
    );
  }
});
