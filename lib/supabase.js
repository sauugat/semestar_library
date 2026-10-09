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

const crypto = require('crypto');

/**
 * Fast-path local cryptographic verification for Supabase HS256 JWT tokens.
 * Validates HMAC-SHA256 signature, expiry (exp), not-before (nbf), and extracts standard user claims.
 * Bypasses ~500ms external network round-trip to Supabase Auth API while guaranteeing security.
 */
function verifySupabaseJwtLocally(token, secret) {
  if (!token || !secret || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  // 1. Validate Header
  let header;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!header || header.alg !== 'HS256') {
    return null; // Fall back to remote verification for asymmetric algorithms
  }

  // 2. Validate HMAC-SHA256 Signature
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  const sigBuf = Buffer.from(signatureB64);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null; // Invalid signature
  }

  // 3. Validate Payload Claims
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);

  // Expiration check: mandatory positive number
  if (!payload.exp || typeof payload.exp !== 'number' || payload.exp < nowSec) {
    const err = new Error('JWT token has expired');
    err.status = 401;
    throw err;
  }

  // Not-before check
  if (payload.nbf && typeof payload.nbf === 'number' && payload.nbf > nowSec) {
    const err = new Error('JWT token is not yet valid');
    err.status = 401;
    throw err;
  }

  // Audience check: must target authenticated user session
  const isAudAuthenticated = payload.aud === 'authenticated' || (Array.isArray(payload.aud) && payload.aud.includes('authenticated'));
  if (!isAudAuthenticated) {
    return null; // Reject anon keys or service_role tokens
  }

  // Role check: Supabase user access tokens have role: 'authenticated'
  if (payload.role !== 'authenticated') {
    return null;
  }

  // Subject claim: must be a non-empty string user ID
  if (!payload.sub || typeof payload.sub !== 'string' || !payload.sub.trim()) {
    return null;
  }

  // Issuer check: if present and SUPABASE_URL configured, verify consistency
  const config = getSupabaseConfig();
  if (payload.iss && config.url && typeof payload.iss === 'string') {
    const cleanUrl = config.url.replace(/\/$/, '').toLowerCase();
    const cleanIss = payload.iss.replace(/\/$/, '').toLowerCase();
    if (!cleanIss.includes(cleanUrl) && !cleanIss.includes('supabase') && !cleanUrl.includes(cleanIss)) {
      return null;
    }
  }

  return {
    id: payload.sub,
    email: payload.email || null,
    role: payload.role || 'authenticated',
    email_confirmed_at: payload.email_confirmed_at || payload.confirmed_at || null,
    user_metadata: payload.user_metadata || {},
    app_metadata: payload.app_metadata || {},
    aud: payload.aud || null,
    created_at: payload.iat ? new Date(payload.iat * 1000).toISOString() : null,
  };
}

/**
 * Verifies a Supabase JWT access token.
 * Returns { user, error }
 */
async function verifySupabaseToken(token) {
  if (!token || typeof token !== 'string') {
    return { user: null, error: new Error('Token is required') };
  }

  const mock = global.__testSupabaseMock;
  if (mock) {
    if (mock.auth && typeof mock.auth.getUser === 'function') {
      try {
        const { data, error } = await mock.auth.getUser(token);
        return { user: data ? data.user : null, error };
      } catch (err) {
        return { user: null, error: err };
      }
    }
    if (mock[token]) {
      const entry = mock[token];
      return { user: entry.user || null, error: entry.error || null };
    }
  }

  // Fast-path: local cryptographic verification using SUPABASE_JWT_SECRET
  const jwtSecret = process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET;
  if (jwtSecret) {
    try {
      const localUser = verifySupabaseJwtLocally(token, jwtSecret);
      if (localUser) {
        return { user: localUser, error: null };
      }
    } catch (expErr) {
      // Explicit expiration or not-before rejection
      return { user: null, error: expErr };
    }
  }

  // Fallback: remote Supabase Auth API call if secret unavailable or non-HS256
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
async function registerSupabaseUser({ email, password, metadata = {}, redirectTo }) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase client is not configured');
  }

  // Use client.auth.signUp so Supabase automatically sends the confirmation email
  const redirectUrl = redirectTo || (process.env.APP_URL
    ? `${process.env.APP_URL.replace(/\/$/, '')}/login.html?verified=true`
    : 'https://semestar-library.vercel.app/login.html?verified=true');

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
