// ============================================================
// Semester Library — Supabase Auth Client & authFetch Helper
// ============================================================

(function (window) {
  const rawFetch = window.fetch ? window.fetch.bind(window) : null;
  let supabaseClient = null;
  let initPromise = null;

  async function getSupabase() {
    if (supabaseClient) return supabaseClient;
    if (initPromise) return initPromise;

    initPromise = (async () => {
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

      return supabaseClient;
    })();

    return initPromise;
  }

  async function getSession() {
    try {
      const client = await getSupabase();
      const { data, error } = await client.auth.getSession();
      if (error || !data || !data.session) return null;
      return data.session;
    } catch {
      return null;
    }
  }

  let cachedAccessToken = null;

  async function getAccessToken() {
    const session = await getSession();
    const token = session ? session.access_token : null;
    if (token) cachedAccessToken = token;
    return token;
  }

  function getAccessTokenSync() {
    if (cachedAccessToken) return cachedAccessToken;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key && (key.startsWith('sb-') || key.includes('auth-token') || key.includes('supabase.auth.token'))) {
            const raw = window.localStorage.getItem(key);
            if (raw) {
              const val = JSON.parse(raw);
              if (val && val.access_token) {
                cachedAccessToken = val.access_token;
                return cachedAccessToken;
              }
            }
          }
        }
      }
    } catch {}
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
        await client.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        cachedAccessToken = data.session.access_token;
        syncSession().catch(() => {});
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

  async function signOut() {
    try {
      const client = await getSupabase();
      await client.auth.signOut();
    } catch (e) {
      console.warn('[Auth SignOut Error]:', e);
    }
    try {
      await rawFetch('/api/logout', { method: 'POST' });
    } catch {}
    try {
      sessionStorage.removeItem('sl_academic_context_cache_v1');
      if (window.AcademicContext && typeof window.AcademicContext.invalidate === 'function') {
        window.AcademicContext.invalidate();
      }
    } catch {}
    window.location.href = '/login.html';
  }

  /**
   * Universal Authenticated Fetch Helper
   * Automatically attaches Authorization: Bearer <supabase_access_token>
   * Handles expired tokens and redirects unauthenticated users to /login.html
   */
  async function authFetch(url, options = {}) {
    const opts = { ...options };
    opts.headers = { ...(opts.headers || {}) };

    let token = await getAccessToken();

    if (!token) {
      // Try refreshing session
      try {
        const client = await getSupabase();
        const { data } = await client.auth.refreshSession();
        if (data && data.session) {
          token = data.session.access_token;
        }
      } catch {}
    }

    if (token) {
      opts.headers['Authorization'] = `Bearer ${token}`;
    }

    // Always request JSON unless explicit
    if (!opts.headers['Accept'] && !opts.headers['accept']) {
      opts.headers['Accept'] = 'application/json';
    }

    let response = await rawFetch(url, opts);

    // If 401 Unauthorized, attempt one token refresh before redirecting
    if (response.status === 401 && token) {
      // An old account's response must not refresh or redirect a newer session.
      if (await getAccessToken() !== token) return response;
      try {
        const client = await getSupabase();
        const { data, error } = await client.auth.refreshSession();
        if (!error && data && data.session) {
          if (await getAccessToken() !== data.session.access_token) return response;
          opts.headers['Authorization'] = `Bearer ${data.session.access_token}`;
          response = await rawFetch(url, opts);
        } else {
          const latestToken = await getAccessToken();
          if (latestToken && latestToken !== token) return response;
          console.warn('[Auth] Session expired, redirecting to login');
          const currentPath = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.href = `/login.html?redirect=${currentPath}`;
        }
      } catch {
        const latestToken = await getAccessToken();
        if (latestToken && latestToken !== token) return response;
        const currentPath = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login.html?redirect=${currentPath}`;
      }
    }

    return response;
  }

  /**
   * Client-side page guard for static HTML shells
   * Prevents flash of authenticated content.
   */
  async function protectPage() {
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

    try {
      const session = await getSession();
      if (!session) {
        const currentPath = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.replace(`/login.html?redirect=${currentPath}`);
        return;
      }
      if (session.access_token) {
        cachedAccessToken = session.access_token;
        syncSession().catch(() => {});
      }
      document.documentElement.classList.remove('auth-checking');
    } catch (e) {
      console.error('[Auth Guard] Error verifying session:', e);
      const currentPath = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login.html?redirect=${currentPath}`);
    }
  }

  // Intercept standard fetch calls to /api/ (except auth endpoints) so existing script fetch() calls send Bearer token
  if (rawFetch) {
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      const isApi = url.startsWith('/api/') || url.includes('/api/');
      const isPublicAuth = url.includes('/api/auth/') || url.includes('/api/login');

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
  }

  // Expose global methods
  window.SemesterAuth = {
    getSupabase,
    getSession,
    getAccessToken,
    getAccessTokenSync,
    attachAuthTokenToUrl,
    syncSession,
    signIn,
    signUp,
    checkAvailability,
    signOut,
    forgotPassword,
    resendVerification,
    updatePassword,
    onAuthStateChange,
    exchangeCode,
    syncPasswordReset,
    syncVerification,
    authFetch,
    protectPage,
  };

  window.authFetch = authFetch;
})(window);
