const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Ensure environment variables are loaded if .env exists
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const k = trimmed.substring(0, eqIdx).trim();
          const v = trimmed.substring(eqIdx + 1).trim();
          if (!process.env[k]) process.env[k] = v;
        }
      }
    });
  }
} catch (e) { }

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  return { url: url.trim(), key: key.trim() };
}

let cachedClient = null;

function getSupabaseClient() {
  if (cachedClient) return cachedClient;

  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    console.warn('[Supabase Warning]: Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
    return null;
  }

  cachedClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedClient;
}

function getSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url || !secretKey) {
    throw new Error('SUPABASE_SECRET_KEY is required for admin/service operations.');
  }

  return createClient(url.trim(), secretKey.trim(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Verifies a Supabase JWT access token.
 * Returns { user, error }
 */
async function verifySupabaseToken(token) {
  if (!token || typeof token !== 'string') {
    return { user: null, error: new Error('Token is required') };
  }

  const client = getSupabaseClient();
  if (!client) {
    return { user: null, error: new Error('Supabase client is not configured') };
  }

  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data || !data.user) {
      return { user: null, error: error || new Error('Invalid or expired token') };
    }
    return { user: data.user, error: null };
  } catch (err) {
    return { user: null, error: err };
  }
}

/**
 * Registers a new student user in Supabase Auth.
 * Automatically dispatches the Supabase email verification confirmation link.
 * Does NOT mark email as confirmed.
 */
async function registerSupabaseUser({ email, password, metadata = {} }) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase client is not configured');
  }

  // Use client.auth.signUp so Supabase automatically sends the confirmation email
  const redirectUrl = process.env.APP_URL
    ? `${process.env.APP_URL.replace(/\/$/, '')}/login.html?verified=true`
    : undefined;

  let { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: metadata,
      emailRedirectTo: redirectUrl,
    },
  });

  // If public signups are disabled in Supabase dashboard, fallback to admin createUser with email_confirm: false
  if (error && (error.message.includes('Signups not allowed') || error.status === 400)) {
    try {
      const admin = getSupabaseAdminClient();
      const adminRes = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: false,
        user_metadata: metadata,
      });
      if (!adminRes.error && adminRes.data && adminRes.data.user) {
        return { user: adminRes.data.user, error: null };
      }
    } catch {}
  }

  return { user: data ? data.user : null, session: data ? data.session : null, error };
}

/**
 * Authenticates user credentials with Supabase Auth.
 */
async function authenticateWithPassword({ email, password }) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase client is not configured');
  }

  return await client.auth.signInWithPassword({
    email,
    password,
  });
}

/**
 * Triggers a password recovery email via Supabase Auth.
 */
async function sendPasswordResetEmail({ email, redirectTo }) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase client is not configured');
  }

  return await client.auth.resetPasswordForEmail(email, {
    redirectTo,
  });
}

/**
 * Resends email confirmation link.
 */
async function resendVerificationEmail({ email }) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase client is not configured');
  }

  return await client.auth.resend({
    type: 'signup',
    email,
  });
}

module.exports = {
  getSupabaseConfig,
  getSupabaseClient,
  getSupabaseAdminClient,
  verifySupabaseToken,
  registerSupabaseUser,
  authenticateWithPassword,
  sendPasswordResetEmail,
  resendVerificationEmail,
};
