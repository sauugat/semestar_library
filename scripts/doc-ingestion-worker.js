#!/usr/bin/env node
'use strict';

/**
 * Standalone Document Ingestion Worker (Phase D2)
 * Designed for GitHub Actions (workflow_dispatch + periodic cron backup),
 * cleanly isolated from Vercel's 10s serverless execution timeout.
 */

const {
  reconcileMissingIngestionJobs,
  hasPendingWork,
  drainKnowledgeJobs,
  processNextIngestionJob,
  runIngestionWorkerLoop
} = require('../lib/doc-ingestion-worker');

function parseCliArgs(argv = process.argv.slice(2)) {
  const args = {
    maxJobs: undefined,
    maxDurationMs: undefined,
    knowledgeBudgetMs: undefined,
    skipKnowledge: false,
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
    } else if (a.startsWith('--knowledge-budget-ms=')) {
      args.knowledgeBudgetMs = Number(a.split('=')[1]);
    } else if (a === '--knowledge-budget-ms' && argv[i + 1]) {
      args.knowledgeBudgetMs = Number(argv[++i]);
    } else if (a === '--skip-knowledge') {
      args.skipKnowledge = true;
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

async function executeWorkerRun(db, cli = {}, options = {}) {
  const logger = options.logger || console;
  const modelName = (options.env || process.env).DOC_VISION_MODEL || null;

  if (cli.reconcile) {
    const reconcileSummary = await reconcileMissingIngestionJobs(db, {
      limit: cli.limit,
      dryRun: cli.dryRun,
      includePartial: cli.includePartial
    });
    logger.log('[DocIngestionWorker] Reconcile summary:', JSON.stringify(reconcileSummary));
    return { mode: 'reconcile', model: modelName, reconcileSummary, ingestion: null, knowledge: null };
  }

  const pending = await hasPendingWork(db, { includeKnowledge: !cli.skipKnowledge });
  if (!pending.hasWork) {
    logger.log(`[DocIngestionWorker] No queued ingestion or knowledge jobs; exiting early (model: ${modelName || 'none'}).`);
    return { mode: 'early_exit', model: modelName, pending, ingestion: null, knowledge: null };
  }

  const workerId = options.workerId || (process.env.GITHUB_RUN_ID
    ? `gha-${process.env.GITHUB_RUN_ID}-${process.pid}`
    : `cli-${process.pid}`);

  logger.log(`[DocIngestionWorker] Starting worker ${workerId} (model: ${modelName || 'none'})...`);
  const ingestion = pending.ingestionPending
    ? await runIngestionWorkerLoop(db, {
      ...options,
      workerId,
      maxJobs: cli.maxJobs,
      maxDurationMs: cli.maxDurationMs
    })
    : { processedJobs: 0, model: modelName, results: [] };

  logger.log(`[DocIngestionWorker] Completed ingestion sweep (model: ${modelName || 'none'}):`, JSON.stringify({
    ...ingestion,
    model: modelName
  }));

  let knowledge = { skipped: Boolean(cli.skipKnowledge), processed: 0, succeeded: 0, failed: 0, batches: 0 };
  if (!cli.skipKnowledge) {
    knowledge = await drainKnowledgeJobs(db, {
      budgetMs: cli.knowledgeBudgetMs,
      env: options.env,
      enabled: options.knowledgeEnabled,
      processPendingJobsFn: options.processPendingJobsFn
    });
    logger.log('[DocIngestionWorker] Knowledge drain summary:', JSON.stringify(knowledge));
  }

  logger.log(`[DocIngestionWorker] Final run summary (model: ${modelName || 'none'}):`, JSON.stringify({
    mode: 'worked',
    model: modelName,
    pending,
    ingestion,
    knowledge
  }));

  return { mode: 'worked', model: modelName, pending, ingestion, knowledge };
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
    await executeWorkerRun(db, cli);
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
  executeWorkerRun,
  hasPendingWork,
  drainKnowledgeJobs,
  reconcileMissingIngestionJobs,
  processNextIngestionJob,
  runIngestionWorkerLoop
};
