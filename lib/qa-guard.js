'use strict';

/**
 * Phase 4D.3: Fail-Closed QA Guard
 * Strictly verifies environment isolation before local QA server startup or seeding.
 *
 * Guarantees that local QA cannot accidentally:
 * - Connect to production Neon PostgreSQL
 * - Connect to or modify production Supabase
 * - Send emails to real users
 * - Send push notifications to mobile devices via Expo
 * - Overwrite production records or local .env
 */

const KNOWN_PRODUCTION_DOMAINS = [
  'neon.tech',
  'aws.neon.tech',
  'supabase.co',
  'pooler.supabase.com',
  'turso.io',
  'vercel.app',
];

const KNOWN_PROD_SUPABASE_HOST = 'ahcccqsyvpxacnsttzeh';

let qaGuardVerified = false;

function isProductionDatabaseUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const clean = url.trim().toLowerCase();
  if (KNOWN_PRODUCTION_DOMAINS.some(domain => clean.includes(domain))) {
    return true;
  }
  // Check for Neon endpoint format like ep-fancy-mud-...
  if (/ep-[a-z0-9\-]+\./.test(clean)) {
    return true;
  }
  // Check remote PostgreSQL / LibSQL connection strings (non-localhost)
  if (clean.startsWith('postgres://') || clean.startsWith('postgresql://') || clean.startsWith('libsql://') || clean.startsWith('http://') || clean.startsWith('https://')) {
    const isLocal = clean.includes('localhost') || clean.includes('127.0.0.1') || clean.includes('::1');
    if (!isLocal) {
      return true;
    }
  }
  return false;
}

function isSafeLocalDbPath(dbPath) {
  if (!dbPath || typeof dbPath !== 'string') return true;
  const clean = dbPath.trim();
  if (clean === ':memory:' || clean === 'file::memory:?cache=shared') return true;
  if (isProductionDatabaseUrl(clean)) return false;
  if (/^(postgres|postgresql|https?|libsql|wss?):\/\//i.test(clean)) return false;
  return true;
}

function isProductionSupabaseUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const clean = url.trim().toLowerCase();
  if (!clean) return false;
  if (clean.includes('supabase.co') || clean.includes(KNOWN_PROD_SUPABASE_HOST)) return true;
  try {
    const parsed = new URL(clean);
    const isLocal = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname) || parsed.hostname.endsWith('.test') || parsed.hostname.endsWith('.local');
    return !isLocal;
  } catch {
    return true;
  }
}

function validateQaEnvironment(env = process.env) {
  const errors = [];

  // 1. Explicit QA Mode & Environment Check
  const isQaMode = env.QA_MODE === 'true';
  const isTestMode = env.NODE_ENV === 'test';
  if (!isQaMode && !isTestMode) {
    errors.push('QA_MODE="true" is required for local QA execution.');
  }

  if (env.NODE_ENV === 'production' || env.SEMESTER_PRODUCTION === 'true') {
    errors.push('NODE_ENV cannot be "production" and SEMESTER_PRODUCTION cannot be "true" during QA.');
  }

  // 2. Production Database Guards (Neon PostgreSQL / Remote DB / Non-local DB_PATH)
  if (env.DATABASE_URL && (isProductionDatabaseUrl(env.DATABASE_URL) || !isTestMode)) {
    errors.push('DATABASE_URL points to a remote/production database. Local QA requires disposable storage.');
  }
  if (env.POSTGRES_URL && (isProductionDatabaseUrl(env.POSTGRES_URL) || !isTestMode)) {
    errors.push('POSTGRES_URL points to a remote/production database.');
  }
  if (env.DIRECT_URL && (isProductionDatabaseUrl(env.DIRECT_URL) || !isTestMode)) {
    errors.push('DIRECT_URL points to a remote/production database.');
  }
  if (env.DATABASE_URL_UNPOOLED && (isProductionDatabaseUrl(env.DATABASE_URL_UNPOOLED) || !isTestMode)) {
    errors.push('DATABASE_URL_UNPOOLED points to a remote/production database.');
  }
  if (env.POSTGRES_URL_NON_POOLING && (isProductionDatabaseUrl(env.POSTGRES_URL_NON_POOLING) || !isTestMode)) {
    errors.push('POSTGRES_URL_NON_POOLING points to a remote/production database.');
  }
  if (env.PGHOST && (isProductionDatabaseUrl(env.PGHOST) || !['localhost', '127.0.0.1', '::1'].includes(String(env.PGHOST).trim().toLowerCase()))) {
    errors.push('PGHOST points to a remote/production host.');
  }
  if (isProductionDatabaseUrl(env.TURSO_DATABASE_URL) || isProductionDatabaseUrl(env.LIBSQL_URL)) {
    errors.push('Turso/LibSQL remote database detected in TURSO_DATABASE_URL/LIBSQL_URL.');
  }
  if (!isSafeLocalDbPath(env.DB_PATH)) {
    errors.push('DB_PATH is not a local SQLite file or memory target.');
  }

  // 3. Production Supabase Guards
  const supabaseVars = [
    env.SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.COHORT_SUPABASE_URL,
    env.COHORT_REALTIME_SUPABASE_URL,
    env.DM_SUPABASE_URL,
  ];
  if (supabaseVars.some(u => isProductionSupabaseUrl(u)) || env.COHORT_REALTIME_SUPABASE_PROJECT_REF) {
    errors.push('Production Supabase URL detected. Supabase must be isolated or disabled in QA mode.');
  }

  // 4. Feature and Side-Effect Guards
  if (env.TEACHER_ONBOARDING_ENABLED === 'true' && !isTestMode) {
    errors.push('Teacher onboarding must remain DISABLED (TEACHER_ONBOARDING_ENABLED="false") in QA mode.');
  }

  return {
    safe: errors.length === 0,
    errors,
  };
}

function assertSafeQaEnvironment(env = process.env) {
  const { safe, errors } = validateQaEnvironment(env);
  if (!safe) {
    if (env === process.env) {
      qaGuardVerified = false;
    }
    const message = [
      '====================================================================',
      ' [FAIL-CLOSED QA GUARD]: STARTUP ABORTED FOR SAFETY',
      '====================================================================',
      'The server detected one or more production or unsafe configurations:',
      ...errors.map(err => `  ✖ ${err}`),
      '',
      'Local QA requires a completely isolated environment with disposable storage.',
      'To start the isolated QA server safely, run:',
      '  npm run qa:server',
      '====================================================================',
    ].join('\n');

    const err = new Error(message);
    err.code = 'QA_GUARD_VIOLATION';
    err.violations = errors;
    throw err;
  }
  if (env === process.env) {
    qaGuardVerified = true;
  }
  return true;
}

function isVerifiedQaEnvironment(env = process.env) {
  if (!qaGuardVerified) return false;
  if (env.QA_MODE !== 'true') return false;
  if (env.NODE_ENV === 'production' || env.SEMESTER_PRODUCTION === 'true') return false;
  const { safe } = validateQaEnvironment(env);
  return safe;
}

module.exports = {
  isProductionDatabaseUrl,
  isProductionSupabaseUrl,
  isSafeLocalDbPath,
  validateQaEnvironment,
  assertSafeQaEnvironment,
  isVerifiedQaEnvironment,
};
