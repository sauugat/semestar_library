import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isLocalAddress, isQaMode } from './api';

let cachedClient: SupabaseClient | null = null;
let currentUrl = '';

/**
 * Returns a configured Supabase client for mobile auth operations.
 * Fetches public configuration from server /api/auth/config.
 */
export async function getMobileSupabaseClient(serverUrl: string): Promise<SupabaseClient> {
  const cleanServerUrl = serverUrl.replace(/\/+$/, '');
  if (isQaMode(cleanServerUrl) || isLocalAddress(cleanServerUrl)) {
    throw new Error('Supabase authentication is unavailable in QA mode. Synthetic accounts (qa_admin, qa_student, qa_cr, qa_teacher) must be used.');
  }

  if (cachedClient && currentUrl === cleanServerUrl) {
    return cachedClient;
  }

  const res = await fetch(`${cleanServerUrl}/api/auth/config`);
  if (!res.ok) {
    throw new Error('Could not connect to authentication service.');
  }
  const config = await res.json();
  if (!config.url || !config.key) {
    throw new Error('Authentication configuration is unavailable.');
  }

  if (config.url.includes('supabase.co') && (isQaMode(cleanServerUrl) || isLocalAddress(cleanServerUrl))) {
    throw new Error('Connecting to production Supabase is forbidden in QA mode.');
  }

  cachedClient = createClient(config.url, config.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  currentUrl = cleanServerUrl;
  return cachedClient;
}

export function setMobileSupabaseClientForTesting(client: SupabaseClient | null) {
  cachedClient = client;
}
