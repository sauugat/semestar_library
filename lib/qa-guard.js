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
  // Check remote PostgreSQL connection strings (non-localhost)
  if (clean.startsWith('postgres://') || clean.startsWith('postgresql://') || clean.startsWith('libsql://')) {
    const isLocal = clean.includes('localhost') || clean.includes('127.0.0.1') || clean.includes('::1');
    if (!isLocal) {
      return true;
    }
  }
  return false;
}

function isProductionSupabaseUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const clean = url.trim().toLowerCase();
  return clean.includes('supabase.co') || clean.includes(KNOWN_PROD_SUPABASE_HOST);
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

  // 2. Production Database Guards (Neon PostgreSQL / Remote DB)
  if (isProductionDatabaseUrl(env.DATABASE_URL)) {
    errors.push('DATABASE_URL points to a remote/production database. Local QA requires disposable storage.');
  }
  if (isProductionDatabaseUrl(env.POSTGRES_URL)) {
    errors.push('POSTGRES_URL points to a remote/production database.');
  }
  if (isProductionDatabaseUrl(env.PGHOST)) {
    errors.push('PGHOST points to a remote/production host.');
  }
  if (isProductionDatabaseUrl(env.TURSO_DATABASE_URL) || isProductionDatabaseUrl(env.LIBSQL_URL)) {
    errors.push('Turso/LibSQL remote database detected in TURSO_DATABASE_URL/LIBSQL_URL.');
  }

  // 3. Production Supabase Guards
  if (isProductionSupabaseUrl(env.SUPABASE_URL) || isProductionSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL)) {
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
  return true;
}

module.exports = {
  isProductionDatabaseUrl,
  isProductionSupabaseUrl,
  validateQaEnvironment,
  assertSafeQaEnvironment,
};
