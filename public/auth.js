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

  async function getAccessToken() {
    const session = await getSession();
    return session ? session.access_token : null;
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
      if (res.ok && data.session) {
        const client = await getSupabase();
        await client.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
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

  async function signUp(payload) {
    try {
      const res = await rawFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      return client.auth.onAuthStateChange(callback);
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

  // Expose global methods
  window.SemesterAuth = {
    getSupabase,
    getSession,
    getAccessToken,
    signIn,
    signUp,
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
