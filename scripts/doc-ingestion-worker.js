#!/usr/bin/env node
'use strict';

/**
 * Standalone Document Ingestion Worker (Phase D2)
 * Designed for GitHub Actions (workflow_dispatch + periodic cron backup),
 * cleanly isolated from Vercel's 10s serverless execution timeout.
 */

const {
  reconcileMissingIngestionJobs,
  processNextIngestionJob,
  runIngestionWorkerLoop
} = require('../lib/doc-ingestion-worker');

function parseCliArgs(argv = process.argv.slice(2)) {
  const args = {
    maxJobs: undefined,
    maxDurationMs: undefined,
    reconcile: false,
    dryRun: false,
    limit: undefined,
    includePartial: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--max-jobs=')) {
      args.maxJobs = Number(a.split('=')[1]);
    } else if (a === '--max-jobs' && argv[i + 1]) {
      args.maxJobs = Number(argv[++i]);
    } else if (a.startsWith('--max-ms=')) {
      args.maxDurationMs = Number(a.split('=')[1]);
    } else if (a === '--max-ms' && argv[i + 1]) {
      args.maxDurationMs = Number(argv[++i]);
    } else if (a === '--reconcile' || a === '--backfill') {
      args.reconcile = true;
    } else if (a === '--dry-run') {
      args.dryRun = true;
    } else if (a.startsWith('--limit=')) {
      args.limit = Number(a.split('=')[1]);
    } else if (a === '--limit' && argv[i + 1]) {
      args.limit = Number(argv[++i]);
    } else if (a === '--include-partial') {
      args.includePartial = true;
    }
  }
  return args;
}

async function main() {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL && !process.env.PGHOST) {
    console.error('[DocIngestionWorker] Missing DATABASE_URL / POSTGRES_URL. Refusing to run without PostgreSQL target.');
    process.exit(1);
  }

  const db = require('../db');
  if (!db.isPostgres) {
    console.error('[DocIngestionWorker] Document page pipeline requires PostgreSQL (Neon).');
    process.exit(1);
  }

  const cli = parseCliArgs();

  try {
    if (cli.reconcile) {
      const reconcileSummary = await reconcileMissingIngestionJobs(db, {
        limit: cli.limit,
        dryRun: cli.dryRun,
        includePartial: cli.includePartial
      });
      console.log('[DocIngestionWorker] Reconcile summary:', JSON.stringify(reconcileSummary));
      return;
    }

    const workerId = process.env.GITHUB_RUN_ID
      ? `gha-${process.env.GITHUB_RUN_ID}-${process.pid}`
      : `cli-${process.pid}`;

    console.log(`[DocIngestionWorker] Starting worker ${workerId}...`);
    const summary = await runIngestionWorkerLoop(db, {
      workerId,
      maxJobs: cli.maxJobs,
      maxDurationMs: cli.maxDurationMs
    });

    console.log('[DocIngestionWorker] Completed sweep:', JSON.stringify(summary));
  } finally {
    if (typeof db.close === 'function') {
      await db.close().catch(() => {});
    } else if (db.pgPool && typeof db.pgPool.end === 'function') {
      await db.pgPool.end().catch(() => {});
    }
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('[DocIngestionWorker] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = {
  parseCliArgs,
  reconcileMissingIngestionJobs,
  processNextIngestionJob,
  runIngestionWorkerLoop
};
