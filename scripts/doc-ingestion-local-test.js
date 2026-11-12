#!/usr/bin/env node
'use strict';

/**
 * Local Real-File Harness (Phase D2-R / D2-S, Fix I + Upgrade)
 * Processes a local PDF file or directory of PDFs completely offline in in-memory PGlite,
 * never reads .env, refuses to run if production DB or Supabase env vars are set,
 * and uses real Gemini Vision ONLY when GEMINI_API_KEY and DOC_VISION_MODEL are explicitly passed in the shell.
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

/**
 * Computes USD cost strictly from env DOC_PRICE_INPUT_PER_M and DOC_PRICE_OUTPUT_PER_M.
 * Returns null if either rate is unset/invalid so prices are never invented.
 */
function calculateConfiguredCostUsd(inputTokens, outputTokens, env = process.env) {
  const rawIn = env?.DOC_PRICE_INPUT_PER_M;
  const rawOut = env?.DOC_PRICE_OUTPUT_PER_M;
  if (rawIn === undefined || rawIn === null || String(rawIn).trim() === '') return null;
  if (rawOut === undefined || rawOut === null || String(rawOut).trim() === '') return null;
  const priceIn = Number(rawIn);
  const priceOut = Number(rawOut);
  if (!Number.isFinite(priceIn) || priceIn < 0 || !Number.isFinite(priceOut) || priceOut < 0) return null;

  const cost = ((Number(inputTokens) || 0) * (priceIn / 1_000_000)) + ((Number(outputTokens) || 0) * (priceOut / 1_000_000));
  return Number(cost.toFixed(6));
}

function parsePageRange(rawRange) {
  const s = String(rawRange || '').trim();
  if (!s) return undefined;
  const rangeMatch = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (rangeMatch) {
    const start = Math.max(1, Number(rangeMatch[1]));
    const end = Math.max(start, Number(rangeMatch[2]));
    return { start, end };
  }
  const singleMatch = s.match(/^(\d+)$/);
  if (singleMatch) {
    const p = Math.max(1, Number(singleMatch[1]));
    return { start: p, end: p };
  }
  throw new Error(`Invalid --pages value "${s}". Expected format: N or START-END (e.g. --pages 1-10).`);
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
    targetPath: '',
    outDir: path.join(process.cwd(), 'tmp', 'd2-local-out'),
    visionBatchPages: undefined,
    maxVisionPages: undefined,
    pageRange: undefined,
    compareTextLayer: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--out-dir=')) {
      opts.outDir = a.slice('--out-dir='.length);
    } else if (a === '--out-dir' && argv[i + 1]) {
      opts.outDir = argv[++i];
    } else if (a.startsWith('--batch-pages=')) {
      opts.visionBatchPages = Number(a.split('=')[1]);
    } else if (a === '--batch-pages' && argv[i + 1]) {
      opts.visionBatchPages = Number(argv[++i]);
    } else if (a.startsWith('--max-vision-pages=')) {
      opts.maxVisionPages = Number(a.split('=')[1]);
    } else if (a === '--max-vision-pages' && argv[i + 1]) {
      opts.maxVisionPages = Number(argv[++i]);
    } else if (a.startsWith('--pages=')) {
      opts.pageRange = parsePageRange(a.slice('--pages='.length));
    } else if (a === '--pages' && argv[i + 1]) {
      opts.pageRange = parsePageRange(argv[++i]);
    } else if (a === '--compare-text-layer') {
      opts.compareTextLayer = true;
    } else if (!a.startsWith('-') && !opts.targetPath) {
      opts.targetPath = a;
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

function escapeMdCell(value) {
  return String(value ?? '').replace(/\r?\n/g, ' <br> ').replace(/\|/g, '\\|');
}

function resolveInputPdfFiles(targetPath) {
  const resolved = path.resolve(targetPath);
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(resolved)
      .filter(name => name.toLowerCase().endsWith('.pdf'))
      .sort()
      .map(name => path.join(resolved, name));
    if (entries.length === 0) {
      throw new Error(`No .pdf files found in directory: ${resolved}`);
    }
    return entries;
  }
  return [resolved];
}

async function processSingleLocalPdf(db, filePath, {
  outDir,
  env,
  effectiveEnv,
  hasRealGemini,
  visionBatchPages,
  maxVisionPages,
  pageRange,
  compareTextLayer,
  fetchImpl
}) {
  const { enqueueDocumentIngestionJob, processNextIngestionJob } = require('../lib/doc-ingestion-worker');
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const contentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  const fileRes = await db.query(
    `INSERT INTO files (storedName, originalName, title, sizeBytes) VALUES ($1, $2, $3, $4) RETURNING id`,
    [fileName, fileName, fileName, fileBuffer.length]
  );
  const fileId = Number(fileRes.rows[0].id);
  await enqueueDocumentIngestionJob(db, { fileId, contentHash });

  const perPageTimingMs = new Map();
  const startedAt = Date.now();
  const jobOutcome = await processNextIngestionJob(db, {
    workerId: 'local-harness',
    env: effectiveEnv,
    visionBatchPages,
    maxVisionPages,
    pageRange,
    fetchImpl,
    readFileBytesFn: async () => fileBuffer,
    onAfterPage: async ({ pageNo, durationMs }) => {
      perPageTimingMs.set(Number(pageNo), Number(durationMs) || 0);
    }
  });
  const totalTimeMs = Date.now() - startedAt;

  const pagesRes = await db.query(
    `SELECT page_no, source, status, page_type, ocr_confidence, error, raw_text, text
     FROM document_pages
     WHERE file_id = $1
     ORDER BY page_no ASC`,
    [fileId]
  );
  const jobRow = (await db.query(`SELECT * FROM ingestion_jobs WHERE file_id = $1 ORDER BY id DESC LIMIT 1`, [fileId])).rows[0];

  const pagesByRoute = { text_layer: 0, vision: 0, skipped: 0, skipped_quota: 0, failed: 0 };
  let driftFlaggedPages = 0;
  let failedPages = 0;
  for (const p of pagesRes.rows) {
    if (String(p.error || '').includes('PAGE_DRIFT_SUSPECTED')) driftFlaggedPages++;
    if (p.status === 'skipped_quota') pagesByRoute.skipped_quota++;
    else if (p.status === 'failed') {
      pagesByRoute.failed++;
      failedPages++;
    } else if (p.source === 'vision') pagesByRoute.vision++;
    else if (p.source === 'text_layer') pagesByRoute.text_layer++;
    else pagesByRoute.skipped++;
  }

  const visionCalls = Number(jobRow.vision_calls) || 0;
  const visionInputTokens = Number(jobRow.vision_input_tokens) || 0;
  const visionOutputTokens = Number(jobRow.vision_output_tokens) || 0;
  const estimatedUsd = calculateConfiguredCostUsd(visionInputTokens, visionOutputTokens, env);

  const lines = [
    `# Local Ingestion Output: ${fileName}`,
    '',
    `- mode: ${hasRealGemini ? `real-gemini (${effectiveEnv.DOC_VISION_MODEL})` : 'offline-mock-vision'}`,
    `- status: ${jobOutcome?.status || jobRow.status}`,
    `- total_pages: ${jobRow.total_pages}`,
    `- page_range: ${pageRange ? `${pageRange.start}-${pageRange.end}` : 'all'}`,
    `- total_time_ms: ${totalTimeMs}`,
    ''
  ];

  if (compareTextLayer) {
    lines.push('| page | source | page_type | confidence | time_ms | raw_text_layer | vision_or_final_text |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const p of pagesRes.rows) {
      const conf = p.ocr_confidence == null ? '-' : Number(p.ocr_confidence).toFixed(2);
      const tMs = perPageTimingMs.get(Number(p.page_no)) ?? 0;
      const rawCell = p.source === 'vision' ? escapeMdCell(p.raw_text || '') : '(text_layer used directly)';
      lines.push(`| ${p.page_no} | ${p.source} (${p.status}) | ${p.page_type} | ${conf} | ${tMs} | ${rawCell} | ${escapeMdCell(p.text)} |`);
    }
  } else {
    lines.push('| page | source | page_type | confidence | time_ms | text |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const p of pagesRes.rows) {
      const conf = p.ocr_confidence == null ? '-' : Number(p.ocr_confidence).toFixed(2);
      const tMs = perPageTimingMs.get(Number(p.page_no)) ?? 0;
      lines.push(`| ${p.page_no} | ${p.source} (${p.status}) | ${p.page_type} | ${conf} | ${tMs} | ${escapeMdCell(p.text)} |`);
    }
  }

  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| text_layer pages | ${pagesByRoute.text_layer} |`);
  lines.push(`| vision pages | ${pagesByRoute.vision} |`);
  lines.push(`| skipped pages | ${pagesByRoute.skipped} |`);
  lines.push(`| skipped_quota pages | ${pagesByRoute.skipped_quota} |`);
  lines.push(`| failed pages | ${failedPages} |`);
  lines.push(`| drift-flagged pages | ${driftFlaggedPages} |`);
  lines.push(`| vision calls | ${visionCalls} |`);
  lines.push(`| vision input tokens | ${visionInputTokens} |`);
  lines.push(`| vision output tokens | ${visionOutputTokens} |`);
  lines.push(`| estimated USD cost | ${estimatedUsd === null ? 'tokens only (DOC_PRICE_INPUT_PER_M / DOC_PRICE_OUTPUT_PER_M unset)' : `$${estimatedUsd}`} |`);
  lines.push(`| total time (ms) | ${totalTimeMs} |`);

  fs.mkdirSync(outDir, { recursive: true });
  const mdName = `${path.basename(fileName, path.extname(fileName))}.md`;
  const outputPath = path.join(outDir, mdName);
  fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf8');

  return {
    file: filePath,
    outputPath,
    mode: hasRealGemini ? 'real-gemini' : 'offline-mock-vision',
    status: jobOutcome?.status || jobRow.status,
    totalPages: Number(jobRow.total_pages),
    pagesByRoute,
    driftFlaggedPages,
    failedPages,
    visionCalls,
    visionInputTokens,
    visionOutputTokens,
    estimatedUsd,
    totalTimeMs
  };
}

async function runLocalPdfHarness({
  filePath,
  targetPath,
  outDir = path.join(process.cwd(), 'tmp', 'd2-local-out'),
  env = process.env,
  visionBatchPages,
  maxVisionPages,
  pageRange,
  compareTextLayer = false,
  fetchImpl: customFetchImpl
} = {}) {
  assertSafeLocalEnv(env);
  const inputTarget = targetPath || filePath;
  if (!inputTarget) {
    throw new Error('Usage: node scripts/doc-ingestion-local-test.js <file.pdf|dir> [--pages 1-10] [--max-vision-pages N] [--compare-text-layer]');
  }

  const pdfPaths = resolveInputPdfFiles(inputTarget);
  const hasRealGemini = Boolean(String(env.GEMINI_API_KEY || '').trim() && String(env.DOC_VISION_MODEL || '').trim());
  const effectiveEnv = hasRealGemini
    ? env
    : { ...env, GEMINI_API_KEY: 'offline-mock-key', DOC_VISION_MODEL: 'offline-mock-model' };
  const fetchImpl = customFetchImpl || (hasRealGemini ? globalThis.fetch : createOfflineMockVisionFetch());

  const db = await createLocalHarnessDb();
  const fileResults = [];
  const overallStart = Date.now();
  try {
    for (const p of pdfPaths) {
      const res = await processSingleLocalPdf(db, p, {
        outDir,
        env,
        effectiveEnv,
        hasRealGemini,
        visionBatchPages,
        maxVisionPages,
        pageRange,
        compareTextLayer,
        fetchImpl
      });
      fileResults.push(res);
    }
  } finally {
    await db.close().catch(() => {});
  }

  if (fileResults.length === 1 && !fs.statSync(path.resolve(inputTarget)).isDirectory()) {
    return fileResults[0];
  }

  const aggregate = {
    target: path.resolve(inputTarget),
    fileCount: fileResults.length,
    mode: hasRealGemini ? 'real-gemini' : 'offline-mock-vision',
    totalPages: fileResults.reduce((s, r) => s + r.totalPages, 0),
    pagesByRoute: {
      text_layer: fileResults.reduce((s, r) => s + r.pagesByRoute.text_layer, 0),
      vision: fileResults.reduce((s, r) => s + r.pagesByRoute.vision, 0),
      skipped: fileResults.reduce((s, r) => s + r.pagesByRoute.skipped, 0),
      skipped_quota: fileResults.reduce((s, r) => s + r.pagesByRoute.skipped_quota, 0),
      failed: fileResults.reduce((s, r) => s + r.pagesByRoute.failed, 0)
    },
    driftFlaggedPages: fileResults.reduce((s, r) => s + r.driftFlaggedPages, 0),
    failedPages: fileResults.reduce((s, r) => s + r.failedPages, 0),
    visionCalls: fileResults.reduce((s, r) => s + r.visionCalls, 0),
    visionInputTokens: fileResults.reduce((s, r) => s + r.visionInputTokens, 0),
    visionOutputTokens: fileResults.reduce((s, r) => s + r.visionOutputTokens, 0),
    estimatedUsd: calculateConfiguredCostUsd(
      fileResults.reduce((s, r) => s + r.visionInputTokens, 0),
      fileResults.reduce((s, r) => s + r.visionOutputTokens, 0),
      env
    ),
    totalTimeMs: Date.now() - overallStart,
    files: fileResults
  };
  return aggregate;
}

if (require.main === module) {
  const cli = parseArgs();
  runLocalPdfHarness(cli)
    .then(summary => {
      if (summary.outputPath) {
        console.log('[LocalHarness] Output written:', summary.outputPath);
      } else {
        console.log('[LocalHarness] Processed folder files:', summary.fileCount);
      }
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
  calculateConfiguredCostUsd,
  parsePageRange,
  resolveInputPdfFiles,
  parseArgs,
  runLocalPdfHarness
};
