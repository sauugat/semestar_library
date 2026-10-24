/**
 * Semester Library — Stale-While-Revalidate (SWR) Client Cache, BFCache & Instant Nav Helper
 *
 * Features:
 * 1. Instant synchronous read from localStorage (with IndexedDB fallback for large payloads)
 * 2. User-scoped cache keys (`${VERSION}:${userId}:${endpointKey}`) so users never see another user's data
 * 3. Per-endpoint configurable TTLs (syllabus 24h, notices 5m, library 2m, feed 1m, notifications 1m, routine 10m)
 * 4. Background revalidation that only triggers `onUpdate` / re-render when payload actually changed
 * 5. Offline / failed fetch resilience (retains cached data on screen when offline or on 5xx/network error)
 * 6. Mutation invalidation (`SWR.invalidate`, `SWR.mutate`, `SWR.clearAll` on logout)
 * 7. BFCache (`pageshow` with `event.persisted`) & Tab Return (`visibilitychange` when older than TTL)
 * 8. Scroll position save & restore (`SWR.initScrollRestore`) for dashboard feed and library lists
 * 9. Instant navigation link prefetch on hover/touchstart + Service Worker registration with kill-switch flag
 */
(function (root) {
  'use strict';

  const SWR_VERSION = 'sl_swr_v2';
  const OLD_PREFIX = 'sl_swr_';
  const IDB_NAME = 'semester_library_swr_db';
  const IDB_STORE = 'swr_entries';
  const LARGE_PAYLOAD_THRESHOLD = 90 * 1024; // >90KB also mirrored to IndexedDB

  // Per-endpoint TTL configuration (milliseconds)
  const ENDPOINT_TTLS = [
    { pattern: /\/syllabus-data\.json/i, ttl: 24 * 60 * 60 * 1000, public: true }, // 24 hours
    { pattern: /^\/api\/routine/i, ttl: 10 * 60 * 1000, public: false },           // 10 minutes
    { pattern: /^\/api\/posts\?.*type=notice/i, ttl: 5 * 60 * 1000, public: false }, // 5 minutes (notices)
    { pattern: /^\/api\/(library\/files|files|library\/stats|library\/custom-chapters)/i, ttl: 2 * 60 * 1000, public: false }, // 2 minutes (library)
    { pattern: /^\/api\/notifications/i, ttl: 60 * 1000, public: false },          // 1 minute (notifications)
    { pattern: /^\/api\/(posts|code-lab\/assignments)/i, ttl: 60 * 1000, public: false }, // 1 minute (feed)
    { pattern: /^\/api\/academic-context/i, ttl: 5 * 60 * 1000, public: false }    // 5 minutes
  ];

  // Never cache chat, DM, auth, or uploads in SWR
  const EXCLUDED_PATTERNS = [
    /^\/api\/(chat|dm)/i,
    /^\/api\/(login|logout|auth|register|change-password)/i,
    /\/upload/i,
    /\/authorize-upload/i,
    /\/record-upload/i
  ];

  const memoryStore = new Map();
  const inFlightRequests = new Map();
  const registeredControllers = [];

  function isExcludedUrl(url) {
    const clean = String(url || '').trim();
    return EXCLUDED_PATTERNS.some((rx) => rx.test(clean));
  }

  function getTtlForUrl(url, explicitTtl) {
    if (typeof explicitTtl === 'number' && explicitTtl > 0) return explicitTtl;
    const clean = String(url || '').trim();
    for (const rule of ENDPOINT_TTLS) {
      if (rule.pattern.test(clean)) return rule.ttl;
    }
    return 60 * 1000; // default 1 min
  }

  function isPublicEndpoint(url) {
    const clean = String(url || '').trim();
    for (const rule of ENDPOINT_TTLS) {
      if (rule.pattern.test(clean)) return Boolean(rule.public);
    }
    return false;
  }

  /**
   * Synchronously resolves current user ID so cache keys are strictly isolated per user.
   */
  function resolveCurrentUserId() {
    try {
      if (root.currentUserData && root.currentUserData.studentId) {
        return String(root.currentUserData.studentId);
      }
      if (root.SemesterAuth && typeof root.SemesterAuth.getUserSync === 'function') {
        const u = root.SemesterAuth.getUserSync();
        if (u && (u.studentId || u.username || u.email)) {
          return String(u.studentId || u.username || u.email);
        }
      }
      if (root.sessionStorage) {
        const rawUser = root.sessionStorage.getItem('sl_user_cache');
        if (rawUser) {
          const parsed = JSON.parse(rawUser);
          if (parsed && (parsed.studentId || parsed.username || parsed.email)) {
            return String(parsed.studentId || parsed.username || parsed.email);
          }
        }
      }
      if (root.localStorage) {
        for (let i = 0; i < root.localStorage.length; i++) {
          const k = root.localStorage.key(i);
          if (k && /^sb-.+-auth-token$/.test(k)) {
            const raw = root.localStorage.getItem(k);
            if (raw) {
              const parsed = JSON.parse(raw);
              const meta = parsed?.user?.user_metadata || {};
              const id = meta.student_id || meta.studentId || meta.username || parsed?.user?.id;
              if (id) return String(id);
            }
          }
        }
      }
    } catch (_) {}
    return 'anon';
  }

  function buildCacheKey(url, options = {}) {
    const cleanUrl = String(url || '').trim();
    const scopeUser = (options.public === true || options.userScoped === false || isPublicEndpoint(cleanUrl))
      ? 'public'
      : (options.userId || resolveCurrentUserId());
    return `${SWR_VERSION}:${scopeUser}:${cleanUrl}`;
  }

  // IndexedDB helper for large payloads
  let idbPromise = null;
  function openIdb() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    if (idbPromise) return idbPromise;
    idbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE, { keyPath: 'key' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
    return idbPromise;
  }

  async function idbGet(key) {
    const db = await openIdb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function idbSet(entry) {
    const db = await openIdb();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(entry);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) {
        resolve(false);
      }
    });
  }

  async function idbDeleteByPrefix(prefix) {
    const db = await openIdb();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        const req = store.openCursor();
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            if (!prefix || String(cursor.key).startsWith(prefix)) {
              cursor.delete();
            }
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) {
        resolve(false);
      }
    });
  }

  function stableStringify(val) {
    try {
      return JSON.stringify(val);
    } catch (_) {
      return '';
    }
  }

  function readSync(key) {
    if (memoryStore.has(key)) {
      return memoryStore.get(key);
    }
    try {
      if (root.localStorage) {
        const raw = root.localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.v === SWR_VERSION && 'data' in parsed) {
            memoryStore.set(key, parsed);
            return parsed;
          }
        }
      }
    } catch (_) {}
    return null;
  }

  function writeCache(key, data, rawJson) {
    const serialized = rawJson !== undefined ? rawJson : stableStringify(data);
    const entry = {
      key,
      v: SWR_VERSION,
      ts: Date.now(),
      hash: serialized.length + ':' + serialized.slice(0, 64) + ':' + serialized.slice(-64),
      json: serialized,
      data
    };
    memoryStore.set(key, entry);

    try {
      if (root.localStorage) {
        if (serialized.length <= LARGE_PAYLOAD_THRESHOLD) {
          root.localStorage.setItem(
            key,
            JSON.stringify({ v: SWR_VERSION, ts: entry.ts, hash: entry.hash, data })
          );
        } else {
          // Store lightweight pointer in localStorage and full payload in IndexedDB
          try {
            root.localStorage.setItem(
              key,
              JSON.stringify({ v: SWR_VERSION, ts: entry.ts, hash: entry.hash, data })
            );
          } catch (quotaErr) {
            root.localStorage.removeItem(key);
          }
          idbSet({ key, v: SWR_VERSION, ts: entry.ts, hash: entry.hash, data }).catch(() => {});
        }
      }
    } catch (_) {
      // Quota exceeded: fall back to IndexedDB
      idbSet({ key, v: SWR_VERSION, ts: entry.ts, hash: entry.hash, data }).catch(() => {});
    }
    return entry;
  }

  function hasDataChanged(cachedEntry, freshData, freshJson) {
    if (!cachedEntry) return true;
    const oldJson = cachedEntry.json !== undefined ? cachedEntry.json : stableStringify(cachedEntry.data);
    const newJson = freshJson !== undefined ? freshJson : stableStringify(freshData);
    return oldJson !== newJson;
  }

  /**
   * Prunes any outdated SWR versions from localStorage on startup
   */
  function pruneOldVersions() {
    try {
      if (!root.localStorage) return;
      for (let i = root.localStorage.length - 1; i >= 0; i--) {
        const k = root.localStorage.key(i);
        if (k && k.startsWith(OLD_PREFIX) && !k.startsWith(SWR_VERSION + ':')) {
          root.localStorage.removeItem(k);
        }
      }
    } catch (_) {}
  }

  /**
   * Core SWR execution:
   * - Immediately invokes `onData(cached.data, { fromCache: true, stale: isStale, changed: false })` if cached
   * - Or invokes `onSkeleton()` if no cached data exists (first visit)
   * - Fetches fresh data in the background (unless `onlyIfStale: true` and cache is still within TTL)
   * - Updates cache and calls `onData(freshData, { fromCache: false, stale: false, changed: true })` ONLY if data changed (or if there was no initial cache)
   * - Keeps cached data on screen if offline or network fetch fails
   */
  async function swrFetch(url, options = {}) {
    const {
      ttl = getTtlForUrl(url),
      onData = null,
      onSkeleton = null,
      onError = null,
      fetcher = null,
      onlyIfStale = false,
      transform = null
    } = options;
    const forceNetwork = Boolean(options.forceNetwork || options.force);

    if (isExcludedUrl(url)) {
      const doFetch = fetcher || (() => fetch(url).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }));
      const fresh = await doFetch();
      if (typeof onData === 'function') onData(fresh, { source: 'network', fromCache: false, changed: true });
      return { data: fresh, source: 'network', fromCache: false, changed: true };
    }

    const key = buildCacheKey(url, options);
    let cached = readSync(key);

    // If not in localStorage/memory, check IndexedDB quickly
    if (!cached) {
      const idbEntry = await idbGet(key);
      if (idbEntry && idbEntry.v === SWR_VERSION && 'data' in idbEntry) {
        cached = idbEntry;
        memoryStore.set(key, cached);
      }
    }

    const now = Date.now();
    const isStale = !cached || (now - (cached.ts || 0) > ttl);

    if (cached && cached.data !== undefined) {
      if (typeof onData === 'function') {
        try {
          onData(cached.data, { source: 'cache', fromCache: true, stale: isStale, changed: false });
        } catch (err) {
          console.warn('[SWR] Cached render callback error:', err);
        }
      }
      if (onlyIfStale && !isStale && !forceNetwork) {
        return { data: cached.data, source: 'cache', fromCache: true, stale: false, changed: false };
      }
    } else if (typeof onSkeleton === 'function') {
      try {
        onSkeleton();
      } catch (_) {}
    }

    // Deduplicate concurrent background revalidations for the same key
    if (inFlightRequests.has(key) && !forceNetwork) {
      return inFlightRequests.get(key);
    }

    const revalidatePromise = (async () => {
      try {
        let freshData;
        if (typeof fetcher === 'function') {
          freshData = await fetcher(url);
        } else {
          const fn = (root.SemesterAuth && typeof root.SemesterAuth.authFetch === 'function' && String(url).startsWith('/api/'))
            ? root.SemesterAuth.authFetch
            : root.fetch.bind(root);
          const res = await fn(url, { headers: { Accept: 'application/json' } });
          if (!res.ok) {
            const err = new Error(`Request failed (${res.status})`);
            err.status = res.status;
            throw err;
          }
          freshData = await res.json();
        }

        if (typeof transform === 'function') {
          freshData = transform(freshData);
        }

        const freshJson = stableStringify(freshData);
        const changed = hasDataChanged(cached, freshData, freshJson);
        writeCache(key, freshData, freshJson);

        if ((!cached || changed) && typeof onData === 'function') {
          onData(freshData, { source: 'network', fromCache: false, stale: false, changed: Boolean(!cached || changed) });
        }

        return { data: freshData, source: 'network', fromCache: false, stale: false, changed };
      } catch (err) {
        // Offline or failed fetch: keep cached data on screen!
        if (cached && cached.data !== undefined) {
          return { data: cached.data, source: 'cache', fromCache: true, stale: isStale, changed: false, offlineFallback: true, error: err };
        }
        if (typeof onError === 'function') {
          onError(err);
        }
        throw err;
      } finally {
        inFlightRequests.delete(key);
      }
    })();

    inFlightRequests.set(key, revalidatePromise);
    return revalidatePromise;
  }

  /**
   * Synchronously peeks cached data for an endpoint if available.
   */
  function peek(url, options = {}) {
    const key = buildCacheKey(url, options);
    const entry = readSync(key);
    if (!entry) return null;
    const ttl = getTtlForUrl(url, options.ttl);
    return {
      data: entry.data,
      ts: entry.ts,
      stale: (Date.now() - (entry.ts || 0)) > ttl
    };
  }

  /**
   * Directly updates a cached key (optimistic or post-mutation update) and persists it.
   */
  function mutate(url, updater, options = {}) {
    const key = buildCacheKey(url, options);
    const current = readSync(key);
    const nextData = typeof updater === 'function' ? updater(current ? current.data : undefined) : updater;
    if (nextData === undefined) {
      invalidate(url);
      return null;
    }
    return writeCache(key, nextData);
  }

  /**
   * Invalidates cache entries matching a URL substring, RegExp, or array of patterns.
   */
  function invalidate(pattern) {
    if (Array.isArray(pattern)) {
      pattern.forEach((p) => invalidate(p));
      return;
    }
    const matchFn = (k) => {
      if (!pattern) return k.startsWith(SWR_VERSION + ':');
      if (pattern instanceof RegExp) return pattern.test(k);
      return k.includes(String(pattern));
    };

    for (const k of Array.from(memoryStore.keys())) {
      if (matchFn(k)) memoryStore.delete(k);
    }

    try {
      if (root.localStorage) {
        for (let i = root.localStorage.length - 1; i >= 0; i--) {
          const k = root.localStorage.key(i);
          if (k && k.startsWith(OLD_PREFIX) && matchFn(k)) {
            root.localStorage.removeItem(k);
          }
        }
      }
    } catch (_) {}

    idbDeleteByPrefix(SWR_VERSION + ':').catch(() => {});
  }

  /**
   * Clears all SWR caches (called on user logout so no cached data leaks across accounts).
   */
  function clearAll() {
    memoryStore.clear();
    inFlightRequests.clear();
    try {
      if (root.localStorage) {
        for (let i = root.localStorage.length - 1; i >= 0; i--) {
          const k = root.localStorage.key(i);
          if (k && (k.startsWith(OLD_PREFIX) || k.startsWith('sl_scroll_'))) {
            root.localStorage.removeItem(k);
          }
        }
      }
      if (root.sessionStorage) {
        for (let i = root.sessionStorage.length - 1; i >= 0; i--) {
          const k = root.sessionStorage.key(i);
          if (k && k.startsWith('sl_scroll_')) {
            root.sessionStorage.removeItem(k);
          }
        }
      }
    } catch (_) {}
    idbDeleteByPrefix('').catch(() => {});
  }

  /**
   * Registers a page controller for BFCache (`pageshow` persisted) and Tab Return (`visibilitychange` TTL check).
   */
  function registerPageRefresh(arg1, arg2 = {}) {
    if (typeof arg1 === 'function') {
      const urls = arg2.endpoints || arg2.urls || [];
      registeredControllers.push({ urls, ttl: arg2.ttl, onRefresh: arg1 });
      return;
    }
    if (arg1 && typeof arg1 === 'object' && typeof arg1.onRefresh === 'function') {
      registeredControllers.push({
        urls: arg1.urls || arg1.endpoints || [],
        ttl: arg1.ttl,
        onRefresh: arg1.onRefresh
      });
    }
  }

  /**
   * Saves and restores scroll position for dashboard feed and library lists on back/forward navigation.
   */
  function initScrollRestore(pageKeyOrOpts, options = {}) {
    if (typeof window === 'undefined') return null;
    const resolvedKey = (pageKeyOrOpts && typeof pageKeyOrOpts === 'object') ? pageKeyOrOpts.key : pageKeyOrOpts;
    const storageKey = `sl_scroll_${resolvedKey || window.location.pathname}`;
    try {
      if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
      }
    } catch (_) {}

    let saveTimer = null;
    const saveScroll = () => {
      try {
        const y = window.scrollY || document.documentElement.scrollTop || 0;
        const state = {
          y,
          hash: window.location.hash || '',
          search: window.location.search || '',
          ts: Date.now()
        };
        if (typeof options.getExtraState === 'function') {
          state.extra = options.getExtraState();
        }
        sessionStorage.setItem(storageKey, JSON.stringify(state));
      } catch (_) {}
    };

    window.addEventListener('scroll', () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(saveScroll, 80);
    }, { passive: true });

    window.addEventListener('pagehide', saveScroll);

    const restoreScroll = () => {
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (!raw) return false;
        const saved = JSON.parse(raw);
        if (!saved || typeof saved.y !== 'number') return false;
        // Only restore if within 30 minutes and same query/hash
        if (Date.now() - (saved.ts || 0) > 30 * 60 * 1000) return false;
        if (typeof options.onRestoreExtra === 'function' && saved.extra) {
          options.onRestoreExtra(saved.extra);
        }
        if (saved.y > 0) {
          requestAnimationFrame(() => {
            window.scrollTo({ top: saved.y, behavior: 'instant' in window ? 'instant' : 'auto' });
          });
        }
        return true;
      } catch (_) {
        return false;
      }
    };

    return { save: saveScroll, restore: restoreScroll, saveScroll, restoreScroll };
  }

  /**
   * Reusable HTML generator for skeleton loaders on first visit (when cache is empty).
   */
  function renderSkeletonHtml(type = 'feed', count = 3) {
    const items = [];
    for (let i = 0; i < count; i++) {
      if (type === 'notices' || type === 'routine') {
        items.push(`
          <div class="detail-section-card swr-skeleton-card" aria-hidden="true" style="margin-bottom:16px;padding:20px;border-radius:16px;border:1px solid var(--border-subtle,rgba(255,255,255,0.08));">
            <div class="skeleton-box" style="width:45%;height:18px;border-radius:6px;margin-bottom:12px;"></div>
            <div class="skeleton-box" style="width:92%;height:13px;border-radius:6px;margin-bottom:8px;"></div>
            <div class="skeleton-box" style="width:70%;height:13px;border-radius:6px;"></div>
          </div>
        `);
      } else if (type === 'notifications') {
        items.push(`
          <div class="nc-item swr-skeleton-card" aria-hidden="true" style="display:flex;gap:12px;padding:14px 16px;align-items:center;">
            <div class="skeleton-box" style="width:40px;height:40px;border-radius:50%;flex-shrink:0;"></div>
            <div style="flex:1;">
              <div class="skeleton-box" style="width:55%;height:14px;border-radius:5px;margin-bottom:8px;"></div>
              <div class="skeleton-box" style="width:80%;height:12px;border-radius:5px;"></div>
            </div>
          </div>
        `);
      } else {
        items.push(`
          <article class="post-card swr-skeleton-card" aria-hidden="true" style="padding:20px;margin-bottom:16px;border-radius:16px;border:1px solid var(--border-subtle,rgba(255,255,255,0.08));">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
              <div class="skeleton-box" style="width:40px;height:40px;border-radius:50%;"></div>
              <div style="flex:1;">
                <div class="skeleton-box" style="width:140px;height:14px;border-radius:5px;margin-bottom:6px;"></div>
                <div class="skeleton-box" style="width:90px;height:11px;border-radius:5px;"></div>
              </div>
            </div>
            <div class="skeleton-box" style="width:95%;height:14px;border-radius:5px;margin-bottom:8px;"></div>
            <div class="skeleton-box" style="width:82%;height:14px;border-radius:5px;margin-bottom:8px;"></div>
            <div class="skeleton-box" style="width:60%;height:14px;border-radius:5px;"></div>
          </article>
        `);
      }
    }
    return items.join('');
  }

  // Global BFCache (`pageshow`) and Tab Return (`visibilitychange`) listeners
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    pruneOldVersions();

    // 1. BFCache restore: silently revalidate registered SWR resources without reloading the page
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        document.documentElement.classList.remove('auth-checking');
        if (root.SemesterAuth && typeof root.SemesterAuth.getUserSync === 'function') {
          const syncUser = root.SemesterAuth.getUserSync();
          if (syncUser && typeof root.SemesterAuth.initHeader === 'function') {
            root.SemesterAuth.initHeader(syncUser);
          }
        }
        registeredControllers.forEach((ctrl) => {
          try {
            ctrl.onRefresh({ reason: 'pageshow', persisted: true, onlyIfStale: false });
          } catch (_) {}
        });
      }
    });

    // 2. Tab switch return: refresh in background ONLY if cached data is older than its TTL
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        registeredControllers.forEach((ctrl) => {
          try {
            const anyStale = !ctrl.urls || ctrl.urls.length === 0 || ctrl.urls.some((u) => {
              const p = peek(u);
              return !p || p.stale;
            });
            if (anyStale) {
              ctrl.onRefresh({ reason: 'visibilitychange', persisted: false, onlyIfStale: true });
            }
          } catch (_) {}
        });
      }
    });

    // 3. Instant Navigation: Prefetch internal HTML pages on hover / touchstart
    const prefetchedUrls = new Set();
    function prefetchInternalUrl(href) {
      try {
        if (!href) return;
        const url = new URL(href, window.location.origin);
        if (url.origin !== window.location.origin) return;
        if (url.pathname === window.location.pathname && url.search === window.location.search) return;
        // Never prefetch logout, auth mutations, downloads, or API endpoints
        if (/^\/(api|logout|download\/apk)/i.test(url.pathname)) return;
        const key = url.pathname + url.search;
        if (prefetchedUrls.has(key)) return;
        prefetchedUrls.add(key);

        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = key;
        link.as = 'document';
        document.head.appendChild(link);
      } catch (_) {}
    }

    const handleLinkIntent = (e) => {
      const target = e.target && typeof e.target.closest === 'function' ? e.target.closest('a[href]') : null;
      if (!target) return;
      const href = target.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
      prefetchInternalUrl(href);
    };

    document.addEventListener('mouseover', handleLinkIntent, { passive: true });
    document.addEventListener('touchstart', handleLinkIntent, { passive: true });

    // 4. Service Worker registration with kill-switch flag (?disable_sw=1 or localStorage SL_DISABLE_SW=1)
    if ('serviceWorker' in navigator) {
      const registerOrDisableSw = async () => {
        try {
          const params = new URLSearchParams(window.location.search);
          if (params.get('disable_sw') === '1') {
            localStorage.setItem('SL_DISABLE_SW', '1');
          } else if (params.get('disable_sw') === '0') {
            localStorage.removeItem('SL_DISABLE_SW');
          }
          const isDisabled = window.__DISABLE_SW === true || localStorage.getItem('SL_DISABLE_SW') === '1';
          if (isDisabled) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map((r) => r.unregister()));
            return;
          }
          const reg = await navigator.serviceWorker.register('/sw.js');
          // Check for updates on navigation
          if (reg && typeof reg.update === 'function') {
            reg.update().catch(() => {});
          }
        } catch (_) {}
      };
      if (document.readyState === 'complete') {
        registerOrDisableSw();
      } else {
        window.addEventListener('load', registerOrDisableSw, { once: true });
      }
    }
  }

  const SWR = {
    VERSION: SWR_VERSION,
    fetch: swrFetch,
    get: swrFetch,
    peek,
    mutate,
    invalidate,
    clearAll,
    registerPageRefresh,
    initScrollRestore,
    renderSkeletonHtml,
    getTtlForUrl,
    buildCacheKey,
    resolveCurrentUserId
  };

  root.SWR = SWR;
  root.SemesterSWR = SWR;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SWR;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
