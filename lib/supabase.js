const { createClient } = require('@supabase/supabase-js');

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
    console.warn('[Supabase Warning]: Missing Supabase URL or Publishable/Anon Key.');
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
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for admin provisioning.');
  }

  return createClient(url.trim(), serviceRoleKey.trim(), {
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

module.exports = {
  getSupabaseConfig,
  getSupabaseClient,
  getSupabaseAdminClient,
  verifySupabaseToken,
};
