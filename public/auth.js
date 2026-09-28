// ============================================================
// Semester Library — Supabase Auth Client & authFetch Helper
// ============================================================

(function (window) {
  let supabaseClient = null;
  let initPromise = null;

  async function getSupabase() {
    if (supabaseClient) return supabaseClient;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      // 1. Check if window.supabase CDN library is loaded
      if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function') {
        // Dynamically load Supabase JS CDN if not already in document
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
          script.onload = resolve;
          script.onerror = () => reject(new Error('Failed to load Supabase SDK from CDN'));
          document.head.appendChild(script);
        });
      }

      // 2. Fetch public configuration from /api/auth/config
      let url = window.SUPABASE_URL || '';
      let key = window.SUPABASE_ANON_KEY || '';

      if (!url || !key) {
        try {
          const res = await fetch('/api/auth/config');
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

  async function signIn(email, password) {
    const client = await getSupabase();
    return await client.auth.signInWithPassword({
      email: email.trim(),
      password: password,
    });
  }

  async function signOut() {
    try {
      const client = await getSupabase();
      await client.auth.signOut();
    } catch (e) {
      console.warn('[Auth SignOut Error]:', e);
    }
    // Also notify backend if needed
    try {
      await fetch('/api/logout', { method: 'POST' });
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

    let response = await fetch(url, opts);

    // If 401 Unauthorized, attempt one token refresh before redirecting
    if (response.status === 401 && token) {
      try {
        const client = await getSupabase();
        const { data, error } = await client.auth.refreshSession();
        if (!error && data && data.session) {
          opts.headers['Authorization'] = `Bearer ${data.session.access_token}`;
          response = await fetch(url, opts);
        } else {
          // Token is dead
          console.warn('[Auth] Session expired, redirecting to login');
          const currentPath = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.href = `/login.html?redirect=${currentPath}`;
        }
      } catch {
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
    // Hide content before auth check
    document.documentElement.classList.add('auth-checking');
    
    // Inject protective anti-flash style if not present
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
      // Authenticated — reveal body
      document.documentElement.classList.remove('auth-checking');
    } catch (e) {
      console.error('[Auth Guard] Error verifying session:', e);
      const currentPath = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login.html?redirect=${currentPath}`);
    }
  }

  // Expose global methods
  window.SemesterAuth = {
    getSupabase,
    getSession,
    getAccessToken,
    signIn,
    signOut,
    authFetch,
    protectPage,
  };

  // Expose authFetch globally as well
  window.authFetch = authFetch;
})(window);
