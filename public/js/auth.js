// ============================================================
// Semester Library — Unified Supabase Auth Client & Session Manager
// Single Source of Truth for Web & API Authentication
// ============================================================

(function (window) {
  const rawFetch = window.fetch ? window.fetch.bind(window) : null;
  let supabaseClient = null;
  let initPromise = null;
  let cachedAccessToken = null;
  let cachedUser = null;
  let userPromise = null;

  async function initSupabaseClient() {
    if (supabaseClient) return supabaseClient;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        // 1. Check if window.supabase CDN library is loaded
        if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function') {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load Supabase SDK from CDN'));
            document.head.appendChild(script);
          });
        }

        // 2. Fetch public configuration from /api/auth/config
        let url = window.NEXT_PUBLIC_SUPABASE_URL || window.SUPABASE_URL || '';
        let key = window.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || window.SUPABASE_PUBLISHABLE_KEY || window.SUPABASE_ANON_KEY || '';

        if (!url || !key) {
          try {
            const res = await rawFetch('/api/auth/config');
            if (res.ok) {
              const cfg = await res.json();
              url = cfg.url || '';
              key = cfg.key || '';
            }
          } catch (e) {
            console.warn('[Auth] Failed to fetch /api/auth/config:', e.message);
          }
        }

        if (!url || !key) {
          throw new Error('Supabase URL or Publishable key not configured.');
        }

        supabaseClient = window.supabase.createClient(url, key, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storage: window.localStorage,
          },
        });

        if (!supabaseClient || !supabaseClient.auth) {
          supabaseClient = null;
          throw new Error('Failed to initialize Supabase Auth client.');
        }

        return supabaseClient;
      } catch (err) {
        initPromise = null;
        throw err;
      }
    })();

    return initPromise;
  }

  // Proxy for .auth so both `await SemesterAuth.getSupabase()` and un-awaited `SemesterAuth.getSupabase().auth.signUp(...)` work safely
  const supabaseAuthProxy = new Proxy(
    {},
    {
      get(_target, prop) {
        if (supabaseClient && supabaseClient.auth && typeof supabaseClient.auth[prop] === 'function') {
          return supabaseClient.auth[prop].bind(supabaseClient.auth);
        }
        return async function (...args) {
          const client = await initSupabaseClient();
          if (!client || !client.auth || typeof client.auth[prop] !== 'function') {
            throw new Error(`Authentication method "${String(prop)}" is unavailable.`);
          }
          return client.auth[prop](...args);
        };
      },
    }
  );

  function getSupabase() {
    const promise = supabaseClient ? Promise.resolve(supabaseClient) : initSupabaseClient();
    if (!promise.auth) {
      try {
        Object.defineProperty(promise, 'auth', {
          value: supabaseClient && supabaseClient.auth ? supabaseClient.auth : supabaseAuthProxy,
          configurable: true,
          enumerable: true,
        });
      } catch {
        promise.auth = supabaseClient && supabaseClient.auth ? supabaseClient.auth : supabaseAuthProxy;
      }
    }
    return promise;
  }

  async function getSession() {
    try {
      const client = await getSupabase();
      const { data, error } = await client.auth.getSession();
      if (error || !data || !data.session) return null;
      if (data.session.access_token) {
        cachedAccessToken = data.session.access_token;
      }
      return data.session;
    } catch {
      return null;
    }
  }

  async function getAccessToken() {
    const session = await getSession();
    const token = session ? session.access_token : null;
    if (token) cachedAccessToken = token;
    return token;
  }

  function clearLocalAuth() {
    cachedAccessToken = null;
    cachedUser = null;
    window.IS_AUTHENTICATED = false;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('sl_user_cache');
      }
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem('sl_user_cache_v1');
        window.localStorage.removeItem('sl_user_cache_v2');
        for (let i = window.localStorage.length - 1; i >= 0; i--) {
          const key = window.localStorage.key(i);
          if (key && (key.startsWith('sb-') || key.startsWith('sl_swr:') || key.startsWith('sl_user_cache_') || key.includes('auth-token') || key.includes('academic_context'))) {
            window.localStorage.removeItem(key);
          }
        }
      }
    } catch {}
  }

  function isTransientError(err) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    if (!err) return false;
    const msg = String(err.message || err.error_description || err || '').toLowerCase();
    const name = String(err.name || '').toLowerCase();
    if (name === 'aborterror' || name === 'timeouterror') return true;
    if (
      msg.includes('networkerror') ||
      msg.includes('failed to fetch') ||
      msg.includes('network request failed') ||
      msg.includes('cdn') ||
      msg.includes('load supabase sdk') ||
      msg.includes('offline') ||
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('etimedout')
    ) {
      return true;
    }
    return false;
  }

  /**
   * Safe synchronous session reader from localStorage.
   * Only inspects keys matching /^sb-.+-auth-token$/, safely parsing each JSON entry.
   */
  function readStoredSession() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return null;
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && /^sb-.+-auth-token$/.test(key)) {
          try {
            const raw = window.localStorage.getItem(key);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed && (parsed.access_token || parsed.refresh_token)) {
                const isExpired = parsed.expires_at && (Number(parsed.expires_at) * 1000 < Date.now());
                const hasRefreshToken = Boolean(parsed.refresh_token);
                if (isExpired && !hasRefreshToken) {
                  continue;
                }
                return parsed;
              }
            }
          } catch {}
        }
      }
    } catch {}
    return null;
  }

  function isUuid(str) {
    return typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());
  }

  function isValidCachedUser(u) {
    if (!u || typeof u !== 'object') return false;
    if (!u.name || typeof u.name !== 'string') return false;
    const isTeacher = u.role === 'teacher' || u.role === 'faculty';
    if (isTeacher) {
      return Boolean(u.studentId || u.username || u.email);
    }
    if (!u.studentId || isUuid(u.studentId)) return false;
    return true;
  }

  function getAccessTokenSync() {
    if (cachedAccessToken) return cachedAccessToken;
    const session = readStoredSession();
    if (session && session.access_token) {
      cachedAccessToken = session.access_token;
      if (session.user && !cachedUser) {
        const meta = session.user.user_metadata || {};
        const role = meta.role || 'student';
        const isTeacher = role === 'teacher' || role === 'faculty';
        const candidateId = meta.student_id || meta.studentId || meta.username || (isTeacher ? session.user.id : null);
        const validStudentId = isTeacher ? candidateId : ((candidateId && !isUuid(candidateId)) ? candidateId : null);
        if (validStudentId) {
          const name = meta.full_name || meta.name || meta.username || session.user.email?.split('@')[0] || (isTeacher ? 'Faculty' : 'Student');
          cachedUser = {
            studentId: validStudentId,
            username: meta.username || null,
            name: name,
            email: session.user.email,
            role: role,
            department: meta.department || 'BIT',
            semester: isTeacher ? null : (meta.semester || null),
            cohortId: isTeacher ? null : (meta.cohortId || meta.cohort_id || null),
            avatarUrl: meta.avatar_url || meta.avatarUrl || null
          };
          try { window.sessionStorage.setItem('sl_user_cache', JSON.stringify(cachedUser)); } catch {}
        }
      }
      return cachedAccessToken;
    }
    return null;
  }

  function getUserSync() {
    if (cachedUser) {
      if (isValidCachedUser(cachedUser)) return cachedUser;
      cachedUser = null;
    }
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const storedUser = window.sessionStorage.getItem('sl_user_cache');
        if (storedUser) {
          const parsed = JSON.parse(storedUser);
          if (isValidCachedUser(parsed)) {
            cachedUser = parsed;
            return cachedUser;
          } else {
            window.sessionStorage.removeItem('sl_user_cache');
          }
        }
      }
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem('sl_user_cache_v1');
        const persistedUser = window.localStorage.getItem('sl_user_cache_v2');
        if (persistedUser && readStoredSession()) {
          const parsed = JSON.parse(persistedUser);
          if (isValidCachedUser(parsed)) {
            cachedUser = parsed;
            try { window.sessionStorage.setItem('sl_user_cache', persistedUser); } catch {}
            return cachedUser;
          } else {
            window.localStorage.removeItem('sl_user_cache_v2');
          }
        }
      }
    } catch {}

    const session = readStoredSession();
    if (session && session.user) {
      const meta = session.user.user_metadata || {};
      const role = meta.role || 'student';
      const isTeacher = role === 'teacher' || role === 'faculty';
      const candidateId = meta.student_id || meta.studentId || meta.username || (isTeacher ? session.user.id : null);
      const validStudentId = isTeacher ? candidateId : ((candidateId && !isUuid(candidateId)) ? candidateId : null);
      if (!validStudentId) {
        return null;
      }
      const name = meta.full_name || meta.name || meta.username || session.user.email?.split('@')[0] || (isTeacher ? 'Faculty' : 'Student');
      cachedUser = {
        studentId: validStudentId,
        username: meta.username || null,
        name: name,
        email: session.user.email,
        role: role,
        department: meta.department || 'BIT',
        semester: isTeacher ? null : (meta.semester || null),
        cohortId: isTeacher ? null : (meta.cohortId || meta.cohort_id || null),
        avatarUrl: meta.avatar_url || meta.avatarUrl || null
      };
      if (session.access_token && !cachedAccessToken) {
        cachedAccessToken = session.access_token;
      }
      try {
        const serialized = JSON.stringify(cachedUser);
        window.sessionStorage.setItem('sl_user_cache', serialized);
        window.localStorage.setItem('sl_user_cache_v2', serialized);
      } catch {}
      return cachedUser;
    }
    if (typeof window !== 'undefined' && window.currentUserData && isValidCachedUser(window.currentUserData)) {
      cachedUser = window.currentUserData;
      return cachedUser;
    }
    return null;
  }

  /**
   * Helper that returns Authorization headers for API calls
   */
  function getAuthHeaders(headers = {}) {
    const out = { ...headers };
    const token = cachedAccessToken || getAccessTokenSync();
    if (token) {
      out['Authorization'] = `Bearer ${token}`;
    }
    if (!out['Accept'] && !out['accept']) {
      out['Accept'] = 'application/json';
    }
    return out;
  }

  /**
   * Resolves currently authenticated user from session & /api/me
   */
  async function getUser(forceRefresh = false) {
    if (!forceRefresh && cachedUser && cachedUser._validated) return cachedUser;
    const syncUser = getUserSync();
    if (!forceRefresh && syncUser && syncUser._validated) {
      return syncUser;
    }
    if (!forceRefresh && userPromise) return userPromise;

    userPromise = revalidateUser();

    try {
      const res = await userPromise;
      return res || syncUser;
    } finally {
      userPromise = null;
    }
  }

  async function revalidateUser() {
    let token = getAccessTokenSync();
    let session = null;
    if (!token) {
      session = await getSession();
      token = session ? session.access_token : null;
    }

    try {
      const res = await rawFetch('/api/me', {
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'same-origin'
      });
      if (res.ok) {
        const data = await res.json();
        if (isValidCachedUser(data)) {
          data._validated = true;
          cachedUser = data;
          window.IS_AUTHENTICATED = true;
          try {
            const serialized = JSON.stringify(data);
            window.sessionStorage.setItem('sl_user_cache', serialized);
            window.localStorage.setItem('sl_user_cache_v2', serialized);
          } catch {}
          return data;
        }
      }
    } catch (err) {
      console.warn('[Auth] /api/me fetch error:', err.message);
    }

    if (!session) {
      session = await getSession();
    }
    if (!session || !session.access_token) {
      const syncUser = getUserSync();
      if (syncUser) return syncUser;
      cachedUser = null;
      try { window.sessionStorage.removeItem('sl_user_cache'); } catch {}
      return null;
    }

    // Fallback to metadata from session
    if (session.user) {
      const meta = session.user.user_metadata || {};
      const role = meta.role || 'student';
      const isTeacher = role === 'teacher' || role === 'faculty';
      const candidateId = meta.student_id || meta.studentId || meta.username || (isTeacher ? session.user.id : null);
      const validStudentId = isTeacher ? candidateId : ((candidateId && !isUuid(candidateId)) ? candidateId : null);
      if (!validStudentId) {
        return null;
      }
      cachedUser = {
        studentId: validStudentId,
        username: meta.username || null,
        name: meta.full_name || meta.name || meta.username || session.user.email?.split('@')[0] || (isTeacher ? 'Faculty' : 'Student'),
        email: session.user.email,
        role: role,
        department: meta.department || 'BIT',
        semester: isTeacher ? null : (meta.semester || null),
        cohortId: isTeacher ? null : (meta.cohortId || meta.cohort_id || null),
        avatarUrl: meta.avatar_url || meta.avatarUrl || null
      };
      try { window.sessionStorage.setItem('sl_user_cache', JSON.stringify(cachedUser)); } catch {}
      return cachedUser;
    }

    return null;
  }

  function attachAuthTokenToUrl(url) {
    if (!url || typeof url !== 'string') return url;
    const token = cachedAccessToken || getAccessTokenSync();
    if (!token) return url;
    if (url.includes('token=')) return url;
    const [pathAndQuery, hash] = url.split('#');
    const separator = pathAndQuery.includes('?') ? '&' : '?';
    return `${pathAndQuery}${separator}token=${encodeURIComponent(token)}${hash ? '#' + hash : ''}`;
  }

  function getResponseErrorMessage(res, data, defaultMsg) {
    if (data && data.message) return data.message;
    if (res) {
      if (res.status === 404 || res.status === 501) {
        return 'Backend API service is not running or not reachable on this port (' + res.status + '). Please open http://localhost:3000 to use authentication features.';
      }
      if (res.status >= 500) {
        return 'Server error (' + res.status + '). Please try again later.';
      }
    }
    return defaultMsg;
  }

  async function signIn(identifier, password) {
    try {
      const res = await rawFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: (identifier || '').trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.onboardingRequired) {
        return { data: { onboardingRequired: true, onboardingToken: data.onboardingToken, state: data.state }, error: null };
      }
      if (res.ok && data.session) {
        const client = await getSupabase();
        const { error: sessionError } = await client.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        if (sessionError) {
          return { data: null, error: { message: sessionError.message } };
        }
        cachedAccessToken = data.session.access_token;
        cachedUser = data.user || null;
        window.IS_AUTHENTICATED = true;
        try {
          if (cachedUser) window.sessionStorage.setItem('sl_user_cache', JSON.stringify(cachedUser));
        } catch {}
        await Promise.race([syncSession().catch(() => null), new Promise(r => setTimeout(r, 1500))]);
        return { data: { user: data.user, session: data.session }, error: null };
      }
      return {
        data: null,
        error: {
          code: data.code || 'AUTH_ERROR',
          message: getResponseErrorMessage(res, data, 'Invalid username/email or password.'),
        },
      };
    } catch (err) {
      return { data: null, error: { message: err.message || 'Network error signing in' } };
    }
  }

  async function signUp(payload, supabaseToken = null) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (supabaseToken) {
        headers['Authorization'] = `Bearer ${supabaseToken}`;
      }
      const res = await rawFetch('/api/auth/register', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        if (data.user) {
          cachedUser = data.user;
          window.IS_AUTHENTICATED = true;
          try {
            window.sessionStorage.setItem('sl_user_cache', JSON.stringify(data.user));
          } catch {}
        }
        await Promise.race([syncSession().catch(() => null), new Promise(r => setTimeout(r, 1500))]);
        return { data, error: null };
      }
      return { data: null, error: { message: getResponseErrorMessage(res, data, 'Registration failed. Please check your information.') } };
    } catch (err) {
      return { data: null, error: { message: err.message || 'Network error registering' } };
    }
  }

  async function checkAvailability(payload) {
    try {
      const res = await rawFetch('/api/auth/check-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.available) {
        return { data, error: null };
      }
      return { data: null, error: { message: getResponseErrorMessage(res, data, 'Email or username is already taken.') } };
    } catch (err) {
      return { data: null, error: { message: err.message || 'Network error checking availability' } };
    }
  }

  async function forgotPassword(identifier) {
    try {
      const res = await rawFetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: (identifier || '').trim() }),
      });
      const data = await res.json().catch(() => ({}));
      return { data, error: null };
    } catch (err) {
      return { data: null, error: { message: err.message || 'Failed to submit recovery request' } };
    }
  }

  async function resendVerification(identifier) {
    try {
      const res = await rawFetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: (identifier || '').trim() }),
      });
      const data = await res.json().catch(() => ({}));
      return { data, error: null };
    } catch (err) {
      return { data: null, error: { message: err.message || 'Failed to resend confirmation email' } };
    }
  }

  async function updatePassword(newPassword) {
    try {
      const client = await getSupabase();
      return await client.auth.updateUser({ password: newPassword });
    } catch (err) {
      return { data: null, error: err };
    }
  }

  async function onAuthStateChange(callback) {
    try {
      const client = await getSupabase();
      return client.auth.onAuthStateChange((event, session) => {
        if (session && session.access_token) {
          cachedAccessToken = session.access_token;
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
            syncSession().catch(() => {});
          }
        }
        if (event === 'SIGNED_OUT') {
          cachedAccessToken = null;
          cachedUser = null;
        }
        if (typeof callback === 'function') {
          callback(event, session);
        }
      });
    } catch (err) {
      console.warn('[Auth] onAuthStateChange setup error:', err);
      return { data: { subscription: { unsubscribe: () => {} } } };
    }
  }

  async function exchangeCode(code) {
    try {
      const client = await getSupabase();
      return await client.auth.exchangeCodeForSession(code);
    } catch (err) {
      return { data: null, error: err };
    }
  }

  async function syncPasswordReset() {
    try {
      const res = await authFetch('/api/auth/sync-password-reset', { method: 'POST' });
      return await res.json().catch(() => ({}));
    } catch (err) {
      return { error: err.message };
    }
  }

  async function syncVerification() {
    try {
      const res = await authFetch('/api/auth/sync-verification', { method: 'POST' });
      return await res.json().catch(() => ({}));
    } catch (err) {
      return { error: err.message };
    }
  }

  async function syncSession() {
    try {
      let token = await getAccessToken();
      if (!token) token = getAccessTokenSync();
      if (!token) return null;
      cachedAccessToken = token;
      const res = await rawFetch('/api/auth/sync-session', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      if (res.ok) {
        return await res.json().catch(() => ({}));
      }
    } catch (err) {
      console.warn('[Auth] syncSession warning:', err);
    }
    return null;
  }

  async function logout() {
    try {
      try {
        const client = await getSupabase();
        await Promise.race([
          client.auth.signOut(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('SignOut timeout')), 1500))
        ]);
      } catch (e) {
        console.warn('[Auth SignOut Error]:', e.message || e);
      }
      try {
        if (typeof AbortController !== 'undefined') {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 1500);
          await rawFetch('/api/logout', { method: 'POST', signal: controller.signal }).finally(() => clearTimeout(timeoutId));
        } else {
          await rawFetch('/api/logout', { method: 'POST' });
        }
      } catch {}
    } finally {
      clearLocalAuth();
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.clear();
        }
        if (typeof window !== 'undefined' && window.SWR && typeof window.SWR.clearAll === 'function') {
          window.SWR.clearAll();
        }
        if (window.AcademicContext && typeof window.AcademicContext.invalidate === 'function') {
          window.AcademicContext.invalidate();
        }
      } catch {}
      window.location.replace('/');
    }
  }

  // Alias signOut to logout for backwards compatibility
  const signOut = logout;

  /**
   * Universal Authenticated Fetch Helper
   * Automatically attaches Authorization: Bearer <supabase_access_token>
   * Handles expired tokens and redirects unauthenticated users to /login.html
   */
  async function authFetch(url, options = {}) {
    const opts = { ...options };
    opts.headers = { ...(opts.headers || {}) };

    let token = cachedAccessToken || getAccessTokenSync();
    if (!token) {
      token = await getAccessToken();
    }

    if (!token) {
      try {
        const client = await getSupabase();
        const { data } = await client.auth.refreshSession();
        if (data && data.session) {
          token = data.session.access_token;
          cachedAccessToken = token;
        }
      } catch {}
    }

    if (token) {
      opts.headers['Authorization'] = `Bearer ${token}`;
    }

    if (!opts.headers['Accept'] && !opts.headers['accept']) {
      opts.headers['Accept'] = 'application/json';
    }

    let response = await rawFetch(url, opts);

    // If 401 Unauthorized, attempt one token refresh before redirecting
    if (response.status === 401 && token) {
      if (await getAccessToken() !== token) return response;
      try {
        const client = await getSupabase();
        const { data, error } = await client.auth.refreshSession();
        if (!error && data && data.session) {
          cachedAccessToken = data.session.access_token;
          opts.headers['Authorization'] = `Bearer ${data.session.access_token}`;
          response = await rawFetch(url, opts);
        } else {
          if (isTransientError(error)) {
            console.warn('[Auth] Transient failure during token refresh; keeping stored session');
            return response;
          }
          console.warn('[Auth] Session definitely expired, redirecting to login');
          clearLocalAuth();
          initHeader(null);
          const currentPath = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.href = `/login.html?redirect=${currentPath}`;
        }
      } catch (err) {
        if (isTransientError(err)) {
          console.warn('[Auth] Transient error during token refresh; keeping stored session');
          return response;
        }
        clearLocalAuth();
        const currentPath = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login.html?redirect=${currentPath}`;
      }
    }

    return response;
  }

  /**
   * Client-side page guard for static HTML shells
   * Prevents flash of authenticated content and hydrates header.
   */
  async function requireAuth() {
    window.IS_PROTECTED_PAGE = true;
    document.documentElement.classList.add('auth-checking');

    if (!document.getElementById('auth-guard-style')) {
      const style = document.createElement('style');
      style.id = 'auth-guard-style';
      style.textContent = `
        html.auth-checking body {
          visibility: hidden !important;
          opacity: 0 !important;
        }
      `;
      document.head.appendChild(style);
    }

    const syncUser = getUserSync();
    const stored = readStoredSession();
    if (syncUser) {
      window.IS_AUTHENTICATED = true;
      document.documentElement.classList.remove('auth-checking');
      initHeader(syncUser);
    }

    try {
      let session = null;
      let sessionError = null;
      try {
        const client = await getSupabase();
        const res = await client.auth.getSession();
        session = res.data?.session || null;
        sessionError = res.error || null;
      } catch (err) {
        sessionError = err;
      }

      if (session && session.access_token) {
        cachedAccessToken = session.access_token;
        syncSession().catch(() => {});
        window.IS_AUTHENTICATED = true;
        document.documentElement.classList.remove('auth-checking');
        const user = await getUser();
        initHeader(user || syncUser);
        return { session, user: user || syncUser };
      }

      // If getSession() failed due to a transient network issue and we have a stored session / syncUser:
      if ((syncUser || stored) && isTransientError(sessionError)) {
        console.warn('[Auth Guard] Supabase unreachable / network offline; operating in cached offline mode');
        window.IS_AUTHENTICATED = true;
        document.documentElement.classList.remove('auth-checking');
        if (syncUser) initHeader(syncUser);
        return { session: stored, user: syncUser };
      }

      // Fallback: check /api/me
      let meUser = null;
      let meError = null;
      try {
        const res = await rawFetch('/api/me', {
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          credentials: 'same-origin'
        });
        if (res.ok) {
          const data = await res.json();
          if (isValidCachedUser(data)) {
            meUser = data;
          }
        } else if (res.status >= 500) {
          meError = new Error(`Server returned ${res.status}`);
        }
      } catch (err) {
        meError = err;
      }

      if (meUser) {
        window.IS_AUTHENTICATED = true;
        document.documentElement.classList.remove('auth-checking');
        initHeader(meUser);
        return { session: null, user: meUser };
      }

      // If backend was unreachable due to transient network error, keep stored session & stay on page
      if ((syncUser || stored) && isTransientError(meError)) {
        console.warn('[Auth Guard] Backend server unreachable; preserving stored session in offline mode');
        window.IS_AUTHENTICATED = true;
        document.documentElement.classList.remove('auth-checking');
        if (syncUser) initHeader(syncUser);
        return { session: stored, user: syncUser };
      }

      // Definite auth failure: no stored session, or explicit auth rejection (401/403)
      clearLocalAuth();
      const currentPath = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login.html?redirect=${currentPath}`);
      return null;
    } catch (e) {
      console.error('[Auth Guard] Error verifying session:', e);
      if ((syncUser || stored) && isTransientError(e)) {
        window.IS_AUTHENTICATED = true;
        document.documentElement.classList.remove('auth-checking');
        if (syncUser) initHeader(syncUser);
        return { session: stored, user: syncUser };
      }
      clearLocalAuth();
      const currentPath = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login.html?redirect=${currentPath}`);
      return null;
    }
  }

  // Backwards compatibility alias
  const protectPage = requireAuth;

  /**
   * Universal Header Hydration
   * Populates user avatar, name, profile chip, and wires up logout buttons.
   */
  async function initHeader(userData) {
    try {
      let user = userData !== undefined ? userData : (getUserSync() || await getUser());
      if (!user && userData === null) {
        const fallbackUser = getUserSync();
        if (fallbackUser) user = fallbackUser;
      }
      if (!user && userData === undefined && readStoredSession()) {
        user = await getUser(true);
      }
      if (!user) {
        window.IS_AUTHENTICATED = false;
        // On public pages, ensure profile chips offer a clean Sign In action
        const profileChips = document.querySelectorAll('.dash-profile-chip');
        profileChips.forEach(chip => {
          chip.outerHTML = `<a href="/login.html" class="apple-nav-btn dash-signin-chip" style="text-decoration:none; display:inline-flex; align-items:center; height:32px; padding:0 14px; font-size:12px; font-weight:600; border-radius:980px;">Sign In</a>`;
        });
        const homeSignInBtns = document.querySelectorAll('.home-signin');
        homeSignInBtns.forEach(btn => {
          if (btn.getAttribute('href') === '/dashboard.html') {
            btn.href = '/login.html';
            btn.textContent = 'Sign In';
          }
        });
        return;
      }

      window.IS_AUTHENTICATED = true;
      const name = user.name || user.username || 'User';
      const firstName = name.split(' ')[0] || name;
      const initial = name.charAt(0).toUpperCase();

      // Restore if chip had been turned into a sign-in button (before querying headerProfileName/headerAvatar)
      const signinChips = document.querySelectorAll('.dash-signin-chip, .dash-header-actions a[href*="login.html"], .dash-header-actions .nav-cta-btn.apple-nav-btn');
      signinChips.forEach(btn => {
        const avatarHtml = user.avatarUrl
          ? `<img src="${user.avatarUrl}" alt="${name}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`
          : initial;
        btn.outerHTML = `<a href="/profile.html" class="dash-profile-chip" title="View Profile"><div class="dash-profile-avatar" id="headerAvatar">${avatarHtml}</div><span class="dash-profile-label" id="headerProfileName">${firstName}</span></a>`;
      });

      // Top right header profile elements
      const headerName = document.getElementById('headerProfileName');
      if (headerName) {
        headerName.textContent = firstName;
      }

      const headerAvatar = document.getElementById('headerAvatar');
      if (headerAvatar) {
        if (user.avatarUrl) {
          headerAvatar.innerHTML = `<img src="${user.avatarUrl}" alt="${name}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
        } else {
          headerAvatar.textContent = initial;
        }
      }

      const headerAvatarChar = document.getElementById('headerAvatarChar');
      if (headerAvatarChar) {
        headerAvatarChar.textContent = initial;
      }

      const headerProfileAvatar = document.getElementById('headerProfileAvatar');
      if (headerProfileAvatar && user.avatarUrl) {
        const img = document.createElement('img');
        img.src = user.avatarUrl;
        img.alt = name;
        img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;';
        headerProfileAvatar.replaceChildren(img);
      }

      // Ensure profile chip is displayed as authenticated
      const profileChips = document.querySelectorAll('.dash-profile-chip');
      profileChips.forEach(chip => {
        chip.style.display = 'inline-flex';
      });

      // Sidebar profile hydration (Kyana AI / chatbot.html)
      const sidebarName = document.getElementById('sidebarUserName');
      if (sidebarName) {
        sidebarName.textContent = firstName || name;
      }
      const sidebarAvatar = document.getElementById('sidebarAvatar');
      if (sidebarAvatar) {
        if (user.avatarUrl) {
          sidebarAvatar.innerHTML = `<img src="${user.avatarUrl}" alt="${name}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
        } else {
          sidebarAvatar.textContent = initial;
        }
      }

      // Update Homepage & Nav headers: .home-signin, gallery.html sign in
      const homeSignInBtns = document.querySelectorAll('.home-signin');
      homeSignInBtns.forEach(btn => {
        const text = btn.textContent.trim().toLowerCase();
        const href = btn.getAttribute('href') || '';
        if (text === 'sign in' || href.includes('login.html')) {
          btn.href = '/dashboard.html';
          btn.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,0.2);margin-right:6px;font-size:10px;font-weight:700;">${initial}</span><span>Dashboard</span>`;
          btn.setAttribute('title', `Go to Dashboard (${name})`);
        }
      });

      const navSignIns = document.querySelectorAll('header .nav-cta-btn.apple-nav-btn, .ag-nav-container a[href*="login.html"]');
      navSignIns.forEach(btn => {
        if (!btn.classList.contains('dash-signin-chip') && !btn.closest('.dash-header-actions')) {
          btn.href = '/dashboard.html';
          btn.textContent = 'Dashboard';
          btn.setAttribute('title', `Go to Dashboard (${name})`);
        }
      });

      // Dashboard greeting & ID line if present
      const greetingLine = document.getElementById('greetingLine');
      if (greetingLine) {
        const hour = new Date().getHours();
        const greeting = hour < 12 ? 'Good morning' : (hour < 17 ? 'Good afternoon' : 'Good evening');
        greetingLine.textContent = `${greeting}, ${name}`;
      }

      const idLine = document.getElementById('idLine');
      if (idLine) {
        if (user.role === 'teacher' || user.role === 'faculty') {
          idLine.textContent = `Faculty: @${user.username || user.studentId}`;
        } else if (user.studentId && !isUuid(user.studentId)) {
          idLine.textContent = `Student ID: ${user.studentId}`;
        }
      }

      const avatarEl = document.getElementById('avatarInitial');
      if (avatarEl) {
        avatarEl.classList.remove('skeleton-box', 'skeleton-avatar');
        avatarEl.style.color = '';
        if (user.avatarUrl) {
          avatarEl.innerHTML = `<img src="${user.avatarUrl}" alt="${name}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
        } else {
          avatarEl.textContent = initial;
        }
      }

      const heroSkeleton = document.getElementById('heroSkeletonText');
      const heroReal = document.getElementById('heroRealText');
      if (heroSkeleton) heroSkeleton.style.display = 'none';
      if (heroReal) heroReal.style.display = 'block';

      // Role-based navigation items in .dash-header-nav (Teacher: Marks Entry, Student: Results)
      const userRole = String(user.role || 'student').trim().toLowerCase();
      const isTeacherRole = userRole === 'teacher' || userRole === 'faculty';
      const isStudentRole = userRole === 'student' || userRole === 'cr' || userRole === 'class_rep';
      const currentPath = (window.location && window.location.pathname) ? window.location.pathname.toLowerCase() : '';

      document.querySelectorAll('.dash-header-nav').forEach(nav => {
        let marksItem = nav.querySelector('[data-role-nav="teacher"], a[href*="marks-entry.html"]');
        let resultsItem = nav.querySelector('[data-role-nav="student"], a[href*="results.html"]');
        const attItem = nav.querySelector('a[href*="attendance.html"]');
        const useRootPrefix = attItem && (attItem.getAttribute('href') || '').startsWith('/');

        if (!marksItem) {
          marksItem = document.createElement('a');
          marksItem.href = useRootPrefix ? '/marks-entry.html' : 'marks-entry.html';
          marksItem.className = 'header-nav-item';
          marksItem.setAttribute('data-role-nav', 'teacher');
          marksItem.textContent = 'Marks Entry';
          if (attItem && attItem.nextSibling) {
            nav.insertBefore(marksItem, attItem.nextSibling);
          } else {
            nav.appendChild(marksItem);
          }
        }

        if (!resultsItem) {
          resultsItem = document.createElement('a');
          resultsItem.href = useRootPrefix ? '/results.html' : 'results.html';
          resultsItem.className = 'header-nav-item';
          resultsItem.setAttribute('data-role-nav', 'student');
          resultsItem.textContent = 'Results';
          const refNode = marksItem.nextSibling || (attItem ? attItem.nextSibling : null);
          if (refNode) {
            nav.insertBefore(resultsItem, refNode);
          } else {
            nav.appendChild(resultsItem);
          }
        }

        marksItem.style.display = isTeacherRole ? '' : 'none';
        resultsItem.style.display = isStudentRole ? '' : 'none';

        if (currentPath.includes('marks-entry')) {
          marksItem.classList.add('active');
        }
        if (currentPath.includes('/results')) {
          resultsItem.classList.add('active');
        }
      });

      // Bind logout buttons
      const logoutElements = document.querySelectorAll('#logoutBtn, #accountLogoutBtn, .dash-logout, [data-action="logout"]');
      logoutElements.forEach(btn => {
        if (!btn.dataset.authLogoutBound) {
          btn.dataset.authLogoutBound = 'true';
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
          });
        }
      });

      // Fetch avatar URL from /api/profile if not already populated
      if (!user.avatarUrl) {
        rawFetch('/api/profile', { headers: getAuthHeaders() })
          .then(r => r.ok ? r.json() : null)
          .then(p => {
            if (p && p.avatarUrl) {
              user.avatarUrl = p.avatarUrl;
              try { window.sessionStorage.setItem('sl_user_cache', JSON.stringify(user)); } catch {}
              const curHeaderAvatar = document.getElementById('headerAvatar');
              if (curHeaderAvatar) {
                curHeaderAvatar.innerHTML = `<img src="${p.avatarUrl}" alt="${name}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
              }
              const curHeaderProfileAvatar = document.getElementById('headerProfileAvatar');
              if (curHeaderProfileAvatar) {
                const img = document.createElement('img');
                img.src = p.avatarUrl;
                img.alt = name;
                img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;';
                curHeaderProfileAvatar.replaceChildren(img);
              }
              if (sidebarAvatar) {
                sidebarAvatar.innerHTML = `<img src="${p.avatarUrl}" alt="${name}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
              }
              if (avatarEl) {
                avatarEl.innerHTML = `<img src="${p.avatarUrl}" alt="${name}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
              }
            }
          })
          .catch(() => {});
      }
    } catch (e) {
      console.warn('[Auth] Header hydration warning:', e.message);
    }
  }

  // Intercept standard fetch calls to /api/ (except auth endpoints) so existing script fetch() calls send Bearer token
  if (rawFetch) {
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      const isApi = url.startsWith('/api/') || url.includes('/api/');
      const isPublicAuth = url.includes('/api/auth/login') || url.includes('/api/auth/register') || url.includes('/api/auth/check-availability') || url.includes('/api/auth/config') || url.includes('/api/teacher/onboarding/') || url === '/api/login';

      if (isApi && !isPublicAuth) {
        const hasAuthHeader = init && init.headers && (
          (init.headers.get && init.headers.get('Authorization')) ||
          init.headers['Authorization'] ||
          init.headers['authorization']
        );
        if (!hasAuthHeader) {
          return authFetch(input, init);
        }
      }

      return rawFetch(input, init);
    };
  }

  // Seamlessly enrich in-browser document links (<a href="/api/files/...">) with auth token
  if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
      const link = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!link || !link.href) return;
      try {
        const url = new URL(link.href, window.location.origin);
        if (url.origin === window.location.origin && url.pathname.startsWith('/api/files/') && (url.pathname.endsWith('/view') || url.pathname.includes('/download'))) {
          const token = cachedAccessToken || getAccessTokenSync();
          if (token && !url.searchParams.has('token')) {
            url.searchParams.set('token', token);
            link.href = url.toString();
          }
        }
      } catch {}
    }, true);

    // Synchronously hydrate <header> as soon as it is parsed into the DOM (zero header flash)
    try {
      const earlyUser = getUserSync();
      if (earlyUser && typeof MutationObserver !== 'undefined' && document.documentElement) {
        window.IS_AUTHENTICATED = true;
        const headerObserver = new MutationObserver(() => {
          const hName = document.getElementById('headerProfileName');
          const hAvatar = document.getElementById('headerAvatar');
          if (hName || hAvatar) {
            initHeader(earlyUser);
            headerObserver.disconnect();
          }
        });
        headerObserver.observe(document.documentElement, { childList: true, subtree: true });
        document.addEventListener('DOMContentLoaded', () => headerObserver.disconnect(), { once: true });
      }
      // Auto-load shared SWR & instant navigation helper if not yet included
      if (!window.SWR && document.head && !document.querySelector('script[src*="swr.js"]')) {
        const swrScript = document.createElement('script');
        swrScript.src = '/js/swr.js';
        swrScript.defer = true;
        document.head.appendChild(swrScript);
      }
    } catch {}

    // Auto-hydrate header on DOM ready for any authenticated page
    const onReady = async () => {
      try {
        if (window.location.pathname.includes('teacher-onboarding')) {
          return;
        }
        const syncUser = getUserSync();
        if (syncUser) {
          window.IS_AUTHENTICATED = true;
          initHeader(syncUser);
        }
        const user = await getUser();
        if (user) {
          window.IS_AUTHENTICATED = true;
          initHeader(user);
        } else {
          window.IS_AUTHENTICATED = false;
          initHeader(null);
        }
      } catch (e) {
        console.warn('[Auth] onReady hydration warning:', e.message);
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady);
    } else {
      onReady();
    }
  }

  // Expose global methods
  window.SemesterAuth = {
    auth: supabaseAuthProxy,
    getSupabase,
    getSession,
    getUser,
    getUserSync,
    getAccessToken,
    getAccessTokenSync,
    getAuthHeaders,
    attachAuthTokenToUrl,
    syncSession,
    signIn,
    signUp,
    checkAvailability,
    logout,
    signOut,
    requireAuth,
    protectPage,
    initHeader,
    forgotPassword,
    resendVerification,
    updatePassword,
    onAuthStateChange,
    exchangeCode,
    syncPasswordReset,
    syncVerification,
    authFetch,
  };

  window.authFetch = authFetch;
})(window);
