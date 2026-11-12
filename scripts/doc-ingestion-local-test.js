#!/usr/bin/env node
'use strict';

/**
 * Local Real-File Harness (Phase D2-R, Fix I)
 * Processes a local PDF completely offline in in-memory PGlite, never reads .env,
 * refuses to run if production DB or Supabase env vars are set, and uses real Gemini
 * Vision ONLY when GEMINI_API_KEY and DOC_VISION_MODEL are explicitly passed in the shell.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FORBIDDEN_EXACT_ENV_KEYS = [
  'DATABASE_URL',
  'DIRECT_URL',
  'POSTGRES_URL',
  'PGHOST'
];

function findForbiddenEnvVars(env = process.env) {
  const found = [];
  for (const key of Object.keys(env || {})) {
    const val = String(env[key] || '').trim();
    if (!val) continue;
    if (FORBIDDEN_EXACT_ENV_KEYS.includes(key) || key.startsWith('SUPABASE_') || key.startsWith('NEXT_PUBLIC_SUPABASE_')) {
      found.push(key);
    }
  }
  return found.sort();
}

function assertSafeLocalEnv(env = process.env) {
  const forbidden = findForbiddenEnvVars(env);
  if (forbidden.length > 0) {
    const err = new Error(`REFUSED: Production/Supabase environment variables must not be set in local test harness: ${forbidden.join(', ')}`);
    err.code = 'UNSAFE_ENV_SET';
    throw err;
  }
}

function estimateRoughUsd(inputTokens, outputTokens) {
  // Approximate Flash-tier token estimate for budgeting only
  const inCost = (Number(inputTokens) || 0) * (0.10 / 1_000_000);
  const outCost = (Number(outputTokens) || 0) * (0.40 / 1_000_000);
  return Number((inCost + outCost).toFixed(6));
}

function createOfflineMockVisionFetch() {
  return async (_url, init) => {
    const reqBody = JSON.parse(init?.body || '{}');
    const prompt = reqBody?.contents?.[0]?.parts?.[1]?.text || '';
    const batchMatch = prompt.match(/EXACTLY\s+(\d+)\s+items\s+in\s+"pages"/i);
    const mockPage = {
      text: '[MOCK_VISION] Offline vision placeholder (set GEMINI_API_KEY and DOC_VISION_MODEL to test real OCR).',
      latex_present: false,
      figure_description: null,
      ocr_confidence: 0.9,
      detected_type: 'scanned'
    };
    const payload = batchMatch
      ? { pages: Array.from({ length: Number(batchMatch[1]) }, () => ({ ...mockPage })) }
      : mockPage;

    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        usageMetadata: { promptTokenCount: 250, candidatesTokenCount: 40 },
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify(payload) }]
          }
        }]
      })
    };
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const opts = {
    filePath: '',
    outDir: path.join(process.cwd(), 'tmp', 'd2-local-out'),
    visionBatchPages: undefined,
    maxVisionPages: undefined
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--out-dir=')) {
      opts.outDir = a.slice('--out-dir='.length);
    } else if (a === '--out-dir' && argv[i + 1]) {
      opts.outDir = argv[++i];
    } else if (a.startsWith('--batch-pages=')) {
      opts.visionBatchPages = Number(a.split('=')[1]);
    } else if (a.startsWith('--max-vision-pages=')) {
      opts.maxVisionPages = Number(a.split('=')[1]);
    } else if (!a.startsWith('-') && !opts.filePath) {
      opts.filePath = a;
    }
  }
  return opts;
}

async function createLocalHarnessDb() {
  const { PGlite } = require('@electric-sql/pglite');
  const { vector } = require('@electric-sql/pglite-pgvector');
  const pg = new PGlite({ extensions: { vector } });
  await pg.exec(`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE students (studentId TEXT PRIMARY KEY, name TEXT, role TEXT);
    CREATE TABLE cohorts (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE files (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      storedName TEXT NOT NULL,
      originalName TEXT NOT NULL,
      mimeType TEXT NOT NULL DEFAULT 'application/pdf',
      title TEXT,
      semester TEXT,
      subject TEXT,
      chapter TEXT,
      uploadedBy TEXT,
      sizeBytes BIGINT DEFAULT 0,
      uploadedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      previewName TEXT,
      cohort_id TEXT,
      semester_no INTEGER,
      audience_scope TEXT DEFAULT 'all'
    );
  `);

  const kv3Sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '20261014_kyana_v3_knowledge.up.sql'),
    'utf8'
  );
  await pg.exec(kv3Sql);

  const d2Sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '20261112_doc_intelligence_d2.up.sql'),
    'utf8'
  );
  await pg.exec(d2Sql);

  return {
    isPostgres: true,
    pgPool: {
      connect: async () => ({
        query: (sql, params) => pg.query(sql, params),
        release: () => {}
      })
    },
    query: (sql, params) => pg.query(sql, params),
    close: () => pg.close()
  };
}

async function runLocalPdfHarness({
  filePath,
  outDir = path.join(process.cwd(), 'tmp', 'd2-local-out'),
  env = process.env,
  visionBatchPages,
  maxVisionPages
} = {}) {
  assertSafeLocalEnv(env);
  if (!filePath) {
    throw new Error('Usage: node scripts/doc-ingestion-local-test.js <file.pdf>');
  }

  const resolvedPath = path.resolve(filePath);
  const fileBuffer = fs.readFileSync(resolvedPath);
  const fileName = path.basename(resolvedPath);
  const contentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  const hasRealGemini = Boolean(String(env.GEMINI_API_KEY || '').trim() && String(env.DOC_VISION_MODEL || '').trim());
  const effectiveEnv = hasRealGemini
    ? env
    : { ...env, GEMINI_API_KEY: 'offline-mock-key', DOC_VISION_MODEL: 'offline-mock-model' };

  const { enqueueDocumentIngestionJob, processNextIngestionJob } = require('../lib/doc-ingestion-worker');

  const db = await createLocalHarnessDb();
  try {
    const fileRes = await db.query(
      `INSERT INTO files (storedName, originalName, title, sizeBytes) VALUES ($1, $2, $3, $4) RETURNING id`,
      [fileName, fileName, fileName, fileBuffer.length]
    );
    const fileId = Number(fileRes.rows[0].id);
    await enqueueDocumentIngestionJob(db, { fileId, contentHash });

    const jobOutcome = await processNextIngestionJob(db, {
      workerId: 'local-harness',
      env: effectiveEnv,
      visionBatchPages,
      maxVisionPages,
      fetchImpl: hasRealGemini ? globalThis.fetch : createOfflineMockVisionFetch(),
      readFileBytesFn: async () => fileBuffer
    });

    const pagesRes = await db.query(
      `SELECT page_no, source, status, page_type, ocr_confidence, error, text
       FROM document_pages
       WHERE file_id = $1
       ORDER BY page_no ASC`,
      [fileId]
    );
    const jobRow = (await db.query(`SELECT * FROM ingestion_jobs WHERE file_id = $1 ORDER BY id DESC LIMIT 1`, [fileId])).rows[0];

    const pagesByRoute = { text_layer: 0, vision: 0, skipped: 0, skipped_quota: 0, failed: 0 };
    for (const p of pagesRes.rows) {
      if (p.status === 'skipped_quota') pagesByRoute.skipped_quota++;
      else if (p.status === 'failed') pagesByRoute.failed++;
      else if (p.source === 'vision') pagesByRoute.vision++;
      else if (p.source === 'text_layer') pagesByRoute.text_layer++;
      else pagesByRoute.skipped++;
    }

    const lines = [
      `# Local Ingestion Output: ${fileName}`,
      '',
      `- mode: ${hasRealGemini ? `real-gemini (${effectiveEnv.DOC_VISION_MODEL})` : 'offline-mock-vision'}`,
      `- status: ${jobRow.status}`,
      `- total_pages: ${jobRow.total_pages}`,
      `- vision_calls: ${jobRow.vision_calls}`,
      `- vision_input_tokens: ${jobRow.vision_input_tokens}`,
      `- vision_output_tokens: ${jobRow.vision_output_tokens}`,
      '',
      '| page | source | page_type | confidence | text |',
      '| --- | --- | --- | --- | --- |'
    ];
    for (const p of pagesRes.rows) {
      const conf = p.ocr_confidence == null ? '-' : Number(p.ocr_confidence).toFixed(2);
      const compactText = String(p.text || '').replace(/\r?\n/g, ' <br> ').replace(/\|/g, '\\|');
      lines.push(`| ${p.page_no} | ${p.source} (${p.status}) | ${p.page_type} | ${conf} | ${compactText} |`);
    }

    fs.mkdirSync(outDir, { recursive: true });
    const mdName = `${path.basename(fileName, path.extname(fileName))}.md`;
    const outputPath = path.join(outDir, mdName);
    fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf8');

    const roughUsd = estimateRoughUsd(jobRow.vision_input_tokens, jobRow.vision_output_tokens);
    const summary = {
      file: resolvedPath,
      outputPath,
      mode: hasRealGemini ? 'real-gemini' : 'offline-mock-vision',
      status: jobOutcome?.status || jobRow.status,
      totalPages: Number(jobRow.total_pages),
      pagesByRoute,
      visionCalls: Number(jobRow.vision_calls) || 0,
      visionInputTokens: Number(jobRow.vision_input_tokens) || 0,
      visionOutputTokens: Number(jobRow.vision_output_tokens) || 0,
      roughEstimatedUsd: roughUsd
    };
    return summary;
  } finally {
    await db.close().catch(() => {});
  }
}

if (require.main === module) {
  const cli = parseArgs();
  runLocalPdfHarness(cli)
    .then(summary => {
      console.log('[LocalHarness] Output written:', summary.outputPath);
      console.log('[LocalHarness] Summary:', JSON.stringify(summary, null, 2));
    })
    .catch(err => {
      console.error('[LocalHarness] Error:', err.message);
      process.exit(1);
    });
}

module.exports = {
  FORBIDDEN_EXACT_ENV_KEYS,
  findForbiddenEnvVars,
  assertSafeLocalEnv,
  estimateRoughUsd,
  parseArgs,
  runLocalPdfHarness
};
