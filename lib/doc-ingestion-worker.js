'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { asKnowledgeDb } = require('./knowledge-db');
const { isKnowledgeIndexingEnabled } = require('./knowledge-schema');
const { processPendingJobs } = require('./knowledge-worker');
const noteSearch = require('./note-search');
const { enqueueJob } = require('./knowledge-sync');
const {
  extractPdfPageSignals,
  classifyPageSignals,
  countCleanAlnumChars,
  resolveClassifierThresholds
} = require('./doc-page-classifier');
const {
  extractPageSliceWithVision,
  extractImageWithVision,
  renderPdfSliceToJpeg,
  resolveVisionBatchPages,
  loadPdfForSlicing,
  buildPdfSlice,
  calculateVisionTimeoutMs,
  DEFAULT_PAGE_TIMEOUT_MS,
  DEFAULT_INLINE_PDF_MAX_BYTES
} = require('./doc-vision-ocr');

const PARSER_VERSION = 'd2-v1';
const DEFAULT_MAX_VISION_PAGES = Number(process.env.DOC_MAX_VISION_PAGES) || 60;
const DEFAULT_MAX_WORKER_FILE_BYTES = Number(process.env.DOC_MAX_FILE_BYTES) || (100 * 1024 * 1024);
const MAX_PAGE_ATTEMPTS = 3;
const LEASE_STALE_MINUTES = 3;

const SUPPORTED_TEXT_EXTS = new Set(['.pdf', '.docx', '.pptx', '.txt', '.md', '.csv']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.avif']);

function computeContentHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function resolveDailyVisionRequestCap(options = {}, env = process.env) {
  const raw = options.dailyVisionCap ?? env?.DOC_VISION_DAILY_REQUEST_CAP;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const num = Number(raw);
  return Number.isFinite(num) && num >= 0 ? Math.floor(num) : null;
}

async function getDailyVisionCallsUsed(kdb) {
  try {
    const res = await kdb.query(`
      SELECT COALESCE(SUM(vision_calls), 0) AS total_calls
      FROM ingestion_jobs
      WHERE updated_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
    `);
    return Number(res.rows?.[0]?.total_calls) || 0;
  } catch (err) {
    if (isMissingRelationError(err)) return 0;
    throw err;
  }
}

function isPgDatabase(db) {
  return Boolean(db && (db.isPostgres || (typeof db.query === 'function' && !db.all)));
}

function isMissingRelationError(err) {
  const msg = String(err?.message || '');
  return err?.code === '42P01' || /relation\s+"?(?:ingestion_jobs|doc_pages|document_pages|knowledge_jobs|knowledge_chunks|knowledge_resources)"?\s+does not exist/i.test(msg);
}

/**
 * Returns specific diagnostic error messages for doc_pages.error based on failure mode.
 */
function formatFailedPageDiagnostic(err, { timeoutMs = 25000 } = {}) {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');

  if (code === 'VISION_TIMEOUT' || /timeout|aborted/i.test(msg)) {
    return `VISION_TIMEOUT: Page vision call exceeded ${timeoutMs}ms timeout`;
  }
  if (code === 'PDF_SLICE_FAILED' || /slice/i.test(msg)) {
    return `PDF_SLICE_FAILED: ${msg || 'Failed to extract or render PDF slice'}`;
  }
  if (code === 'VISION_INVALID_JSON' || code === 'JSON_PARSE_ERROR' || /json|parse/i.test(msg)) {
    return `JSON_PARSE_ERROR: Failed to parse vision OCR JSON response (${msg || 'malformed JSON'})`;
  }
  if (code === 'VISION_SAFETY_BLOCKED' || /safety|recitation|prohibited/i.test(msg)) {
    return `SAFETY_BLOCK: Content blocked by safety filters (${msg || 'blocked by policy'})`;
  }
  return `${code || 'VISION_ERROR'}: ${msg}`.slice(0, 400);
}

/**
 * Resets failed pages to pending and failed/partial jobs to queued for retry.
 */
async function resetFailedJobsAndPages(kdb) {
  const pageRes = await kdb.query(`
    UPDATE doc_pages
    SET status = 'pending',
        attempts = 0,
        error = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE status = 'failed'
    RETURNING id
  `);

  const jobRes = await kdb.query(`
    UPDATE ingestion_jobs
    SET status = 'queued',
        attempts = 0,
        error = NULL,
        next_retry_at = CURRENT_TIMESTAMP,
        completed_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE status IN ('failed_retryable', 'failed_terminal', 'partial_success')
    RETURNING id
  `);

  return {
    resetPages: pageRes.rowCount || 0,
    resetJobs: jobRes.rowCount || 0
  };
}

/**
 * Enqueues (or updates) a queued ingestion job rapidly on upload without extracting inline.
 */
async function enqueueDocumentIngestionJob(db, { fileId, contentHash = '', fileVersion = 1 } = {}) {
  const id = Number(fileId);
  if (!Number.isSafeInteger(id) || id < 1) {
    return { status: 'invalid_file_id' };
  }
  if (!isPgDatabase(db)) {
    return { status: 'queued_deferred_non_pg', fileId: id, contentHash };
  }

  const kdb = asKnowledgeDb(db);
  try {
    const res = await kdb.query(`
      INSERT INTO ingestion_jobs (
        file_id, content_hash, file_version, status, next_retry_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, 'queued', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (file_id) WHERE status IN ('queued', 'extracting_text', 'ocr_running', 'failed_retryable')
      DO UPDATE SET
        content_hash = CASE WHEN EXCLUDED.content_hash <> '' THEN EXCLUDED.content_hash ELSE ingestion_jobs.content_hash END,
        file_version = EXCLUDED.file_version,
        status = 'queued',
        next_retry_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, status
    `, [id, String(contentHash || ''), Number(fileVersion) || 1]);

    const row = res.rows?.[0];
    return {
      status: row?.status || 'queued',
      jobId: row?.id ? Number(row.id) : null,
      fileId: id,
      contentHash: contentHash || null
    };
  } catch (err) {
    if (isMissingRelationError(err)) {
      return { status: 'queued_schema_pending', fileId: id, contentHash: contentHash || null };
    }
    throw err;
  }
}

async function claimNextIngestionJob(kdb, { workerId = `worker-${process.pid}`, leaseMinutes = LEASE_STALE_MINUTES, excludeJobIds = [], mode = 'all' } = {}) {
  const pool = kdb.pool || kdb.pgPool;
  const client = (pool && typeof pool.connect === 'function') ? await pool.connect() : null;
  const runner = client || kdb;

  const validExcludeIds = Array.isArray(excludeJobIds) ? excludeJobIds.map(Number).filter(Number.isSafeInteger) : [];
  const excludeSql = validExcludeIds.length > 0 ? `AND id NOT IN (${validExcludeIds.join(',')})` : '';

  let whereSql;
  let orderBySql;
  let statusUpdateSql;

  if (mode === 'text_only') {
    whereSql = `
      (
        status = 'queued'
        OR (
          status = 'extracting_text'
          AND (heartbeat_at IS NULL OR heartbeat_at < CURRENT_TIMESTAMP - ($2 || ' minutes')::interval)
        )
      )
      AND attempts < max_attempts
      ${excludeSql}
    `;
    orderBySql = `ORDER BY created_at ASC, id ASC`;
    statusUpdateSql = `status = 'extracting_text'`;
  } else if (mode === 'vision_only') {
    whereSql = `
      (
        (status = 'ocr_running' AND (heartbeat_at IS NULL OR heartbeat_at < CURRENT_TIMESTAMP - ($2 || ' minutes')::interval))
        OR (status = 'failed_retryable' AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP))
      )
      AND attempts < max_attempts
      AND EXISTS (
        SELECT 1 FROM doc_pages p
        WHERE p.file_id = ingestion_jobs.file_id
          AND p.status IN ('pending', 'skipped_quota')
      )
      ${excludeSql}
    `;
    orderBySql = `
      ORDER BY (
        SELECT MIN(CASE p.page_type
          WHEN 'scanned' THEN 1
          WHEN 'math' THEN 2
          WHEN 'nepali_repair' THEN 3
          WHEN 'table' THEN 4
          WHEN 'figure' THEN 5
          ELSE 6
        END)
        FROM doc_pages p
        WHERE p.file_id = ingestion_jobs.file_id
          AND p.status IN ('pending', 'skipped_quota')
      ) ASC NULLS LAST, created_at ASC, id ASC
    `;
    statusUpdateSql = `status = 'ocr_running'`;
  } else {
    whereSql = `
      (
        status = 'queued'
        OR (status = 'failed_retryable' AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP))
        OR (
          status IN ('extracting_text', 'ocr_running')
          AND (heartbeat_at IS NULL OR heartbeat_at < CURRENT_TIMESTAMP - ($2 || ' minutes')::interval)
        )
      )
      AND attempts < max_attempts
      ${excludeSql}
    `;
    orderBySql = `ORDER BY created_at ASC, id ASC`;
    statusUpdateSql = `status = CASE WHEN status IN ('queued', 'failed_retryable') THEN 'extracting_text' ELSE status END`;
  }

  try {
    if (client) await client.query('BEGIN');
    const res = await runner.query(`
      UPDATE ingestion_jobs
      SET ${statusUpdateSql},
          worker_id = $1,
          locked_at = CURRENT_TIMESTAMP,
          heartbeat_at = CURRENT_TIMESTAMP,
          attempts = attempts + 1,
          started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = (
        SELECT id FROM ingestion_jobs
        WHERE ${whereSql}
        ${orderBySql}
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *
    `, [workerId, String(leaseMinutes)]);

    if (client) await client.query('COMMIT');
    return res.rows?.[0] || null;
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (client) client.release();
  }
}

async function updateJobProgress(kdb, jobId, fields = {}) {
  const sets = ['heartbeat_at = CURRENT_TIMESTAMP', 'updated_at = CURRENT_TIMESTAMP'];
  const params = [];

  for (const [col, val] of Object.entries(fields)) {
    if (val === undefined) continue;
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  }
  params.push(jobId);

  await kdb.query(`UPDATE ingestion_jobs SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
}

async function failJob(kdb, job, errorMessage, { terminal = false } = {}) {
  const attempts = Number(job.attempts) || 1;
  const maxAttempts = Number(job.max_attempts) || 5;
  const isTerminal = terminal || attempts >= maxAttempts;
  const cleanMsg = String(errorMessage || 'Ingestion failed').slice(0, 1000);

  if (isTerminal) {
    await kdb.query(`
      UPDATE ingestion_jobs
      SET status = 'failed_terminal',
          error = $1,
          locked_at = NULL,
          completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [cleanMsg, job.id]);
    return 'failed_terminal';
  }

  const backoffSec = Math.min(900, Math.pow(2, attempts) * 30);
  await kdb.query(`
    UPDATE ingestion_jobs
    SET status = 'failed_retryable',
        error = $1,
        locked_at = NULL,
        next_retry_at = CURRENT_TIMESTAMP + ($2 || ' seconds')::interval,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $3
  `, [cleanMsg, String(backoffSec), job.id]);
  return 'failed_retryable';
}

async function upsertDocumentPage(kdb, page) {
  await kdb.query(`
    INSERT INTO doc_pages (
      file_id, page_no, text, raw_text, source, ocr_confidence, char_count,
      status, page_type, latex_present, figure_description, page_image_path,
      attempts, error, parser_version, tier, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL, $12, $13, $14, $15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (file_id, page_no)
    DO UPDATE SET
      text = EXCLUDED.text,
      raw_text = EXCLUDED.raw_text,
      source = EXCLUDED.source,
      ocr_confidence = EXCLUDED.ocr_confidence,
      char_count = EXCLUDED.char_count,
      status = EXCLUDED.status,
      page_type = EXCLUDED.page_type,
      latex_present = EXCLUDED.latex_present,
      figure_description = EXCLUDED.figure_description,
      page_image_path = NULL,
      attempts = EXCLUDED.attempts,
      error = EXCLUDED.error,
      parser_version = EXCLUDED.parser_version,
      tier = EXCLUDED.tier,
      updated_at = CURRENT_TIMESTAMP
  `, [
    page.fileId,
    page.pageNo,
    page.text || '',
    page.rawText || '',
    page.source || 'text_layer',
    page.ocrConfidence ?? null,
    Number(page.charCount) || 0,
    page.status || 'completed',
    page.pageType || 'text',
    Boolean(page.latexPresent),
    page.figureDescription || null,
    Number(page.attempts) || 0,
    page.error || null,
    page.parserVersion || PARSER_VERSION,
    Number(page.tier) === 2 ? 2 : 1
  ]);
}

function formatPageForRollup(page) {
  const body = String(page.text || '').trim();
  const fig = page.figure_description ? String(page.figure_description).trim() : '';
  if (body && fig && !body.includes(fig)) {
    return `${body}\n[Figure: ${fig}]`;
  }
  return body || (fig ? `[Figure: ${fig}]` : '');
}

/**
 * Rolls completed/partial doc_pages up to note_search_documents (joined with \f)
 * and optionally enqueues note:{fileId} into knowledge_jobs if table and flags exist.
 */
async function rollupToNoteSearchAndKnowledge(kdb, fileId, {
  hasUsableContent = null,
  fallbackStatus = null,
  fallbackError = null
} = {}) {
  const pagesRes = await kdb.query(`
    SELECT page_no, text, figure_description, status
    FROM doc_pages
    WHERE file_id = $1
    ORDER BY page_no ASC
  `, [fileId]);
  const pages = pagesRes.rows || [];

  const pageTexts = pages.map(formatPageForRollup);
  let joined = pageTexts.join('\f');
  const trimmedAny = pageTexts.some(t => t.trim().length > 0);

  let truncated = false;
  if (joined.length > noteSearch.MAX_TEXT_CHARS) {
    joined = joined.slice(0, noteSearch.MAX_TEXT_CHARS);
    truncated = true;
  }

  const status = fallbackStatus || (trimmedAny || hasUsableContent ? 'indexed' : 'empty');
  const error = fallbackError || (status === 'empty' ? 'No readable text extracted from document.' : null);

  await kdb.query(`
    INSERT INTO note_search_documents (
      id, content, extraction_status, extraction_error, indexed_at, content_truncated
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id)
    DO UPDATE SET
      content = EXCLUDED.content,
      extraction_status = EXCLUDED.extraction_status,
      extraction_error = EXCLUDED.extraction_error,
      indexed_at = EXCLUDED.indexed_at,
      content_truncated = EXCLUDED.content_truncated
  `, [fileId, joined, status, error, new Date().toISOString(), truncated ? 1 : 0]);

  noteSearch.invalidateSearchCache(kdb);

  // Enqueue into knowledge_jobs silently whenever the table exists
  try {
    const tblCheck = await kdb.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'knowledge_jobs' LIMIT 1`);
    if (tblCheck.rows?.length > 0) {
      await enqueueJob(kdb, `note:${fileId}`, 'note', 'index');
    }
  } catch (err) {
    if (!isMissingRelationError(err)) {
      throw err;
    }
  }

  return { status, chars: joined.length, pages: pages.length, truncated };
}

/**
 * Checks whether an already-completed job with the same content_hash can be cloned.
 */
async function tryReuseDedupPages(kdb, job, contentHash, parserVersion = PARSER_VERSION) {
  if (!contentHash) return null;

  const donorRes = await kdb.query(`
    SELECT j.id AS donor_job_id, j.file_id AS donor_file_id, j.total_pages, j.ocr_pages_count
    FROM ingestion_jobs j
    WHERE j.content_hash = $1
      AND j.file_id <> $2
      AND j.status IN ('completed', 'dedup_reused')
      AND EXISTS (SELECT 1 FROM doc_pages dp WHERE dp.file_id = j.file_id)
      AND NOT EXISTS (
        SELECT 1 FROM doc_pages dp
        WHERE dp.file_id = j.file_id
          AND (
            dp.status IN ('pending', 'processing', 'failed', 'skipped_quota')
            OR dp.parser_version <> $3
          )
      )
    ORDER BY j.completed_at DESC NULLS LAST, j.id DESC
    LIMIT 1
  `, [contentHash, job.file_id, parserVersion]);

  const donor = donorRes.rows?.[0];
  if (!donor) return null;

  await kdb.query(`
    INSERT INTO doc_pages (
      file_id, page_no, text, raw_text, source, ocr_confidence, char_count,
      status, page_type, latex_present, figure_description, page_image_path,
      attempts, error, parser_version, tier, created_at, updated_at
    )
    SELECT
      $1, page_no, text, raw_text, source, ocr_confidence, char_count,
      status, page_type, latex_present, figure_description, NULL,
      0, NULL, parser_version, COALESCE(tier, 1), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM doc_pages
    WHERE file_id = $2
    ORDER BY page_no ASC
    ON CONFLICT (file_id, page_no)
    DO UPDATE SET
      text = EXCLUDED.text,
      raw_text = EXCLUDED.raw_text,
      source = EXCLUDED.source,
      ocr_confidence = EXCLUDED.ocr_confidence,
      char_count = EXCLUDED.char_count,
      status = EXCLUDED.status,
      page_type = EXCLUDED.page_type,
      latex_present = EXCLUDED.latex_present,
      figure_description = EXCLUDED.figure_description,
      page_image_path = NULL,
      error = NULL,
      parser_version = EXCLUDED.parser_version,
      tier = EXCLUDED.tier,
      updated_at = CURRENT_TIMESTAMP
  `, [job.file_id, donor.donor_file_id]);

  await rollupToNoteSearchAndKnowledge(kdb, job.file_id);

  await kdb.query(`
    UPDATE ingestion_jobs
    SET status = 'dedup_reused',
        content_hash = $1,
        total_pages = $2,
        processed_pages = $2,
        ocr_pages_count = $3,
        last_completed_page = $2,
        error = NULL,
        locked_at = NULL,
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $4
  `, [contentHash, Number(donor.total_pages) || 0, Number(donor.ocr_pages_count) || 0, job.id]);

  return {
    jobId: job.id,
    fileId: job.file_id,
    status: 'dedup_reused',
    reusedFromFileId: donor.donor_file_id,
    totalPages: Number(donor.total_pages) || 0
  };
}

function classifyPdfOpenError(err) {
  const name = String(err?.name || '');
  const msg = String(err?.message || '');
  if (name === 'PasswordException' || /password|encrypted/i.test(msg)) {
    return { code: 'PASSWORD_PROTECTED', terminal: true, message: `PASSWORD_PROTECTED: ${msg || 'PDF requires a password.'}` };
  }
  if (name === 'InvalidPDFException' || name === 'FormatError' || /invalid pdf|corrupt|xref|trailer|startxref|header|unexpected end/i.test(msg)) {
    return { code: 'CORRUPT_FILE', terminal: true, message: `CORRUPT_FILE: ${msg || 'PDF structure is invalid or corrupted.'}` };
  }
  return { code: 'CORRUPT_FILE', terminal: true, message: `CORRUPT_FILE: ${msg || 'Failed to parse PDF.'}` };
}

async function readFileBytesWithBlobFallback(kdb, file, options = {}) {
  const maxBytes = options.maxFileBytes || DEFAULT_MAX_WORKER_FILE_BYTES;
  if (typeof options.readFileBytesFn === 'function') {
    return options.readFileBytesFn(kdb, file, maxBytes);
  }
  // Provide getFileBlob shim if caller passes a DB handle without db.getFileBlob attached
  const dbWithBlob = typeof kdb.getFileBlob === 'function'
    ? kdb
    : {
      ...kdb,
      getFileBlob: async (filename) => {
        try {
          const r = await kdb.query('SELECT mimeType, fileData FROM file_blobs WHERE filename = $1 LIMIT 1', [path.basename(filename)]);
          const row = r.rows?.[0];
          if (!row) return null;
          const data = row.filedata || row.fileData;
          return data ? { mimeType: row.mimetype || row.mimeType, fileData: Buffer.from(data) } : null;
        } catch (_) {
          return null;
        }
      }
    };
  return noteSearch.readFileBytes(dbWithBlob, file, undefined, maxBytes);
}

const DRIFT_MIN_LAYER_WORDS = 8;
const DEFAULT_DRIFT_MIN_OVERLAP = 0.20;
const DRIFT_CONFIDENCE_CAP = 0.35;

function resolveDriftMinOverlap(options = {}, env = process.env) {
  const raw = options.driftMinOverlap ?? env?.DOC_DRIFT_MIN_OVERLAP;
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_DRIFT_MIN_OVERLAP;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return DEFAULT_DRIFT_MIN_OVERLAP;
  return parsed;
}

/**
 * Extracts normalized alphabetic words only (ignores LaTeX commands, symbols, and numbers).
 */
function extractComparisonWords(text) {
  const stripped = String(text || '')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[0-9]+/g, ' ')
    .toLowerCase();
  const matches = stripped.match(/[a-z\u0900-\u097f]{3,}/g) || [];
  return new Set(matches);
}

/**
 * Checks whether vision OCR output diverges sharply from an existing 50+ char text layer
 * (e.g. page alignment drift or hallucination on math/table/figure pages).
 * Skips when < 8 alphabetic words exist or when text layer has legacy mojibake / broken math glyphs.
 */
function applyDriftCheck(classification, visionResult, { minOverlap = resolveDriftMinOverlap() } = {}) {
  const baseConfidence = Number.isFinite(Number(visionResult?.ocrConfidence))
    ? Number(visionResult.ocrConfidence)
    : 0.8;
  const reasons = Array.isArray(classification?.reasons) ? classification.reasons : [];
  const hasGarbledLayer =
    reasons.includes('legacy_nepali_font') ||
    reasons.includes('preeti_ascii_artifacts') ||
    reasons.includes('broken_math_glyphs');

  if (!classification || classification.charCount < 50 || hasGarbledLayer) {
    return { ocrConfidence: baseConfidence, driftError: null, overlapRatio: null };
  }

  const layerWords = extractComparisonWords(classification.cleanText || classification.rawText);
  if (layerWords.size < DRIFT_MIN_LAYER_WORDS) {
    return { ocrConfidence: baseConfidence, driftError: null, overlapRatio: null };
  }

  const combinedVision = [visionResult?.text, visionResult?.figureDescription].filter(Boolean).join(' ');
  const visionWords = extractComparisonWords(combinedVision);
  let matched = 0;
  for (const w of layerWords) {
    if (visionWords.has(w)) matched++;
  }

  const overlapRatio = matched / layerWords.size;
  if (overlapRatio < minOverlap) {
    const lowered = Math.max(0.05, Math.min(DRIFT_CONFIDENCE_CAP, Number((baseConfidence * 0.4).toFixed(3))));
    return {
      ocrConfidence: lowered,
      overlapRatio,
      driftError: `PAGE_DRIFT_SUSPECTED: overlap ${(overlapRatio * 100).toFixed(1)}% (${matched}/${layerWords.size} tokens, min ${(minOverlap * 100).toFixed(0)}%)`
    };
  }

  return { ocrConfidence: baseConfidence, driftError: null, overlapRatio };
}

async function runSliceVisionWithRetry({
  getSrcPdfDoc,
  buildSliceFn = buildPdfSlice,
  sliceItems,
  totalPages,
  fetchImpl,
  env,
  model,
  apiKey,
  timeoutMs,
  inlineMaxBytes,
  maxAttempts,
  sleepImpl,
  backoffBaseMs,
  renderSliceToJpegFn
}) {
  // Slice build errors (PASSWORD_PROTECTED / CORRUPT_FILE / PDF_SLICE_FAILED) fail fast with 0 Vision retries
  let slicePdfBuffer;
  try {
    const srcPdfDoc = await getSrcPdfDoc();
    slicePdfBuffer = await buildSliceFn(srcPdfDoc, sliceItems.map(item => item.pageNo));
  } catch (sliceErr) {
    sliceErr.attempts = 0;
    sliceErr.callsMade = 0;
    throw sliceErr;
  }

  let attempt = 0;
  let lastErr = null;
  let callsMade = 0;
  let isTimeoutRetry = false;

  while (attempt < maxAttempts) {
    attempt++;
    callsMade++;
    const currentTimeoutMs = timeoutMs !== undefined
      ? (isTimeoutRetry ? Math.round(timeoutMs * 1.5) : timeoutMs)
      : calculateVisionTimeoutMs(slicePdfBuffer.length, env, isTimeoutRetry);

    try {
      const { pages, usage } = await extractPageSliceWithVision({
        slicePdfBuffer,
        sliceItems: sliceItems.map(item => ({
          pageNo: item.pageNo,
          pageTypeHint: item.cls.pageType,
          rawTextHint: item.cls.rawText
        })),
        totalSourcePages: totalPages,
        fetchImpl,
        env,
        model,
        apiKey,
        timeoutMs: currentTimeoutMs,
        inlineMaxBytes,
        renderSliceToJpegFn
      });
      return { pages, usage, attempts: attempt, callsMade };
    } catch (err) {
      lastErr = err;
      if (err.configError || err.code === 'VISION_CONFIG_ERROR' || err.code === 'VISION_MODEL_UNCONFIGURED') {
        err.attempts = 0;
        err.callsMade = callsMade;
        throw err;
      }
      const isTimeout = err.code === 'VISION_TIMEOUT' || /timeout/i.test(err.message || '');
      if (isTimeout) {
        if (!isTimeoutRetry && attempt < maxAttempts) {
          isTimeoutRetry = true;
          const waitMs = backoffBaseMs;
          if (waitMs > 0) await sleepImpl(waitMs);
          continue;
        } else {
          err.transient = true;
          err.attempts = attempt;
          err.callsMade = callsMade;
          break;
        }
      }
      const shouldRetry =
        err.transient !== false &&
        err.terminal !== true &&
        err.quotaExhausted !== true &&
        attempt < maxAttempts;
      if (!shouldRetry) break;
      const waitMs = err.retryAfterMs || (backoffBaseMs * Math.pow(2, attempt - 1));
      if (waitMs > 0) await sleepImpl(waitMs);
    }
  }

  lastErr = lastErr || new Error('Vision OCR failed');
  lastErr.attempts = attempt;
  lastErr.callsMade = callsMade;
  throw lastErr;
}

/**
 * Processes one claimed PDF file page-by-page with checkpoint resume, quota cap, and failure isolation.
 */
async function processPdfJob(kdb, job, file, pdfBuffer, options = {}) {
  const env = options.env || process.env;
  const parserVersion = options.parserVersion || PARSER_VERSION;
  const maxVisionPages = options.maxVisionPages ?? (Number(env.DOC_MAX_VISION_PAGES) || DEFAULT_MAX_VISION_PAGES);
  const visionBatchPages = resolveVisionBatchPages(options, env);
  const driftMinOverlap = resolveDriftMinOverlap(options, env);
  const maxPageAttempts = options.maxPageAttempts ?? MAX_PAGE_ATTEMPTS;
  const timeoutMs = options.pageTimeoutMs ?? (Number(env.DOC_PAGE_TIMEOUT_MS) || DEFAULT_PAGE_TIMEOUT_MS);
  const backoffBaseMs = options.retryBackoffMs ?? 250;
  const sleepImpl = options.sleepImpl || (ms => new Promise(r => setTimeout(r, ms)));
  const inlineMaxBytes = options.inlinePdfMaxBytes ?? (Number(env.DOC_INLINE_PDF_MAX_BYTES) || DEFAULT_INLINE_PDF_MAX_BYTES);
  const heartbeatEvery = options.heartbeatEveryPages || 5;
  const buildSliceFn = options.buildSliceFn || buildPdfSlice;

  // Verify %PDF- header before handing off to pdfjs
  if (!pdfBuffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
    const err = new Error('CORRUPT_FILE: Missing %PDF- header signature.');
    err.terminal = true;
    err.code = 'CORRUPT_FILE';
    throw err;
  }

  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = getDocument({
    data: new Uint8Array(pdfBuffer),
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
    ...(options.pdfPassword ? { password: options.pdfPassword } : {})
  });

  let pdfDoc;
  try {
    pdfDoc = await loadingTask.promise;
  } catch (err) {
    const classified = classifyPdfOpenError(err);
    const wrapped = new Error(classified.message);
    wrapped.terminal = classified.terminal;
    wrapped.code = classified.code;
    throw wrapped;
  }

  const totalPages = Number(pdfDoc.numPages) || 0;
  await updateJobProgress(kdb, job.id, { total_pages: totalPages });

  // Load source PDF ONCE per job lazily via pdf-lib and reuse for every slice
  let srcPdfDoc = null;
  let srcPdfLoadErr = null;
  const getSrcPdfDoc = async () => {
    if (srcPdfLoadErr) throw srcPdfLoadErr;
    if (!srcPdfDoc) {
      try {
        srcPdfDoc = await loadPdfForSlicing(pdfBuffer, { pdfPassword: options.pdfPassword });
      } catch (err) {
        srcPdfLoadErr = err;
        throw err;
      }
    }
    return srcPdfDoc;
  };

  let visionUsed = 0;
  let inOcrPhase = false;
  let processedCount = 0;
  let failedCount = 0;
  let skippedQuotaCount = 0;
  let usableCount = 0;
  let lastCompletedPage = Number(job.last_completed_page) || 0;
  let visionCalls = Number(job.vision_calls) || 0;
  let visionInputTokens = Number(job.vision_input_tokens) || 0;
  let visionOutputTokens = Number(job.vision_output_tokens) || 0;
  let lastErrorCode = null;
  let pendingVisionBatch = [];

  try {
    const existingRes = await kdb.query(`
      SELECT page_no, status, source, parser_version, ocr_confidence, latex_present, figure_description
      FROM doc_pages
      WHERE file_id = $1
    `, [file.id]);
    const existingMap = new Map((existingRes.rows || []).map(r => [Number(r.page_no), r]));

    for (const r of existingRes.rows || []) {
      if (r.status === 'completed' && r.source === 'vision') {
        visionUsed++;
      }
    }

    const dailyVisionCap = resolveDailyVisionRequestCap(options, env);
    const dbDailyCallsAtStart = dailyVisionCap !== null ? await getDailyVisionCallsUsed(kdb) : 0;
    let runCallsAdded = 0;
    const quotaState = options.quotaState || { quotaExhausted: false, retryAfterMs: null, reason: null };
    let quotaHitThisJob = Boolean(quotaState.quotaExhausted);
    let quotaRetryAfterMs = quotaState.retryAfterMs || null;

    const wouldExceedDailyCap = () =>
      dailyVisionCap !== null && (dbDailyCallsAtStart + runCallsAdded) >= dailyVisionCap;

    if (wouldExceedDailyCap() && !quotaState.quotaExhausted) {
      quotaState.quotaExhausted = true;
      quotaState.retryAfterMs = quotaState.retryAfterMs || 3600_000;
      quotaState.reason = `DOC_VISION_DAILY_REQUEST_CAP (${dailyVisionCap}) reached`;
      quotaHitThisJob = true;
      quotaRetryAfterMs = quotaState.retryAfterMs;
      lastErrorCode = 'QUOTA_EXHAUSTED';
    }

    let consecutiveTimeouts = 0;

    const markItemsSkippedQuota = async (items, reasonText) => {
      quotaHitThisJob = true;
      lastErrorCode = lastErrorCode || 'QUOTA_EXHAUSTED';
      for (const item of items) {
        skippedQuotaCount++;
        processedCount++;
        await upsertDocumentPage(kdb, {
          fileId: file.id,
          pageNo: item.pageNo,
          text: item.cls.rawText,
          rawText: item.cls.rawText,
          source: 'skipped',
          ocrConfidence: null,
          charCount: countCleanAlnumChars(item.cls.rawText),
          status: 'skipped_quota',
          pageType: item.cls.pageType,
          latexPresent: item.cls.latexPresent,
          figureDescription: null,
          attempts: 0,
          tier: item.cls.tier || 1,
          error: reasonText,
          parserVersion
        });
      }
    };

    const processVisionSubBatch = async (subBatch) => {
      if (quotaState.quotaExhausted || wouldExceedDailyCap()) {
        if (!quotaState.quotaExhausted) {
          quotaState.quotaExhausted = true;
          quotaState.retryAfterMs = quotaState.retryAfterMs || 3600_000;
          quotaState.reason = `DOC_VISION_DAILY_REQUEST_CAP (${dailyVisionCap}) reached`;
        }
        quotaRetryAfterMs = Math.max(quotaRetryAfterMs || 0, quotaState.retryAfterMs || 3600_000);
        await markItemsSkippedQuota(
          subBatch,
          `QUOTA_EXHAUSTED: ${String(quotaState.reason || 'Gemini daily quota exhausted').slice(0, 360)}`
        );
        return;
      }

      try {
        if (consecutiveTimeouts > 0) {
          const backoff = Math.min(10000, 1000 * Math.pow(2, consecutiveTimeouts - 1));
          if (backoff > 0) await sleepImpl(backoff);
        }

        const { pages, usage, attempts, callsMade } = await runSliceVisionWithRetry({
          getSrcPdfDoc,
          buildSliceFn,
          sliceItems: subBatch,
          totalPages,
          fetchImpl: options.fetchImpl || globalThis.fetch,
          env,
          model: options.model,
          apiKey: options.apiKey,
          timeoutMs: options.pageTimeoutMs,
          inlineMaxBytes,
          maxAttempts: maxPageAttempts,
          sleepImpl,
          backoffBaseMs,
          renderSliceToJpegFn: options.renderSliceToJpegFn
        });

        consecutiveTimeouts = 0;
        visionCalls += callsMade;
        runCallsAdded += callsMade;
        visionInputTokens += usage.inputTokens;
        visionOutputTokens += usage.outputTokens;

        for (let idx = 0; idx < subBatch.length; idx++) {
          const item = subBatch[idx];
          const resPage = pages[idx];
          const drift = applyDriftCheck(item.cls, resPage, { minOverlap: driftMinOverlap });
          const finalText = resPage.text || item.cls.cleanText;

          visionUsed++;
          processedCount++;
          usableCount++;
          if (item.pageNo > lastCompletedPage) lastCompletedPage = item.pageNo;

          await upsertDocumentPage(kdb, {
            fileId: file.id,
            pageNo: item.pageNo,
            text: finalText,
            rawText: item.cls.rawText,
            source: 'vision',
            ocrConfidence: drift.ocrConfidence,
            charCount: countCleanAlnumChars(finalText),
            status: 'completed',
            pageType: resPage.detectedType || item.cls.pageType,
            latexPresent: Boolean(resPage.latexPresent || item.cls.latexPresent),
            figureDescription: resPage.figureDescription || null,
            attempts,
            tier: item.cls.tier || 1,
            error: drift.driftError,
            parserVersion
          });
        }
      } catch (visionErr) {
        if (visionErr.configError || visionErr.code === 'VISION_CONFIG_ERROR' || visionErr.code === 'VISION_MODEL_UNCONFIGURED') {
          throw visionErr;
        }

        if (visionErr.code === 'VISION_TIMEOUT' || /timeout/i.test(visionErr.message || '')) {
          consecutiveTimeouts++;
          lastErrorCode = 'VISION_TIMEOUT';
        }

        // Isolate a single bad/unsliceable page inside a multi-page slice so neighbor pages still succeed
        const canSplitSlice =
          subBatch.length > 1 &&
          visionErr.code === 'PDF_SLICE_FAILED' &&
          !srcPdfLoadErr;
        if (canSplitSlice) {
          for (const singleItem of subBatch) {
            await processVisionSubBatch([singleItem]);
          }
          return;
        }

        const callsAdded = Number(visionErr.callsMade) || 0;
        visionCalls += callsAdded;
        runCallsAdded += callsAdded;

        if (visionErr.code === 'QUOTA_EXHAUSTED' || visionErr.quotaExhausted) {
          const delay = Number(visionErr.retryAfterMs) || 3600_000;
          quotaState.quotaExhausted = true;
          quotaState.retryAfterMs = Math.max(quotaState.retryAfterMs || 0, delay);
          quotaState.reason = visionErr.message;
          quotaHitThisJob = true;
          quotaRetryAfterMs = Math.max(quotaRetryAfterMs || 0, delay);
          lastErrorCode = 'QUOTA_EXHAUSTED';
          await markItemsSkippedQuota(
            subBatch,
            `QUOTA_EXHAUSTED: ${String(visionErr.message || 'Gemini daily quota exhausted').slice(0, 360)}`
          );
          return;
        }

        lastErrorCode = lastErrorCode || visionErr.code || 'VISION_ERROR';
        const formattedErr = formatFailedPageDiagnostic(visionErr, { timeoutMs: calculateVisionTimeoutMs(options.pageTimeoutMs) });
        for (const item of subBatch) {
          failedCount++;
          processedCount++;
          await upsertDocumentPage(kdb, {
            fileId: file.id,
            pageNo: item.pageNo,
            text: item.cls.rawText,
            rawText: item.cls.rawText,
            source: 'vision',
            ocrConfidence: null,
            charCount: countCleanAlnumChars(item.cls.rawText),
            status: 'failed',
            pageType: item.cls.pageType,
            latexPresent: item.cls.latexPresent,
            figureDescription: null,
            attempts: visionErr.attempts ?? maxPageAttempts,
            tier: item.cls.tier || 1,
            error: formattedErr,
            parserVersion
          });
        }
      }
    };

    const isEnrichEnabled = String(env.DOC_VISION_ENRICH || '').trim().toLowerCase() === 'true';
    const tier1Queue = [];
    const tier2Queue = [];

    const startPage = Math.max(1, Number(options.pageRange?.start) || 1);
    const endPage = Math.min(totalPages, Number(options.pageRange?.end) || totalPages);
    const classifierThresholds = resolveClassifierThresholds(env, options.classifierThresholds);

    for (let pageNo = startPage; pageNo <= endPage; pageNo++) {
      const pageStartedAt = Date.now();
      const existing = existingMap.get(pageNo);
      if (existing && (existing.status === 'completed' || existing.status === 'skipped') && existing.parser_version === parserVersion) {
        processedCount++;
        if (existing.status === 'completed') usableCount++;
        if (pageNo > lastCompletedPage) lastCompletedPage = pageNo;
        continue;
      }

      let signals;
      try {
        const page = await pdfDoc.getPage(pageNo);
        signals = await extractPdfPageSignals(page, OPS);
        page.cleanup?.();
      } catch (pageErr) {
        failedCount++;
        processedCount++;
        await upsertDocumentPage(kdb, {
          fileId: file.id,
          pageNo,
          text: '',
          rawText: '',
          source: 'text_layer',
          charCount: 0,
          status: 'failed',
          pageType: 'text',
          latexPresent: false,
          attempts: 1,
          tier: 1,
          error: `PAGE_EXTRACT_ERROR: ${String(pageErr.message || pageErr).slice(0, 400)}`,
          parserVersion
        });
        continue;
      }

      const cls = classifyPageSignals({ ...signals, thresholds: classifierThresholds });

      if (cls.route === 'skip') {
        processedCount++;
        if (pageNo > lastCompletedPage) lastCompletedPage = pageNo;
        await upsertDocumentPage(kdb, {
          fileId: file.id,
          pageNo,
          text: '',
          rawText: cls.rawText,
          source: 'skipped',
          ocrConfidence: null,
          charCount: 0,
          status: 'skipped',
          pageType: cls.pageType,
          latexPresent: false,
          attempts: 0,
          tier: 1,
          error: null,
          parserVersion
        });
      } else if (cls.route === 'text_layer') {
        processedCount++;
        usableCount++;
        if (pageNo > lastCompletedPage) lastCompletedPage = pageNo;
        await upsertDocumentPage(kdb, {
          fileId: file.id,
          pageNo,
          text: cls.cleanText,
          rawText: cls.rawText,
          source: 'text_layer',
          ocrConfidence: null,
          charCount: cls.charCount,
          status: 'completed',
          pageType: cls.pageType,
          latexPresent: cls.latexPresent,
          attempts: 0,
          tier: 1,
          error: null,
          parserVersion
        });
      } else {
        // cls.route === 'vision'
        if (cls.tier === 2 && !isEnrichEnabled) {
          processedCount++;
          usableCount++;
          if (pageNo > lastCompletedPage) lastCompletedPage = pageNo;
          await upsertDocumentPage(kdb, {
            fileId: file.id,
            pageNo,
            text: cls.cleanText || cls.rawText,
            rawText: cls.rawText,
            source: 'text_layer',
            ocrConfidence: null,
            charCount: cls.charCount,
            status: 'completed',
            pageType: cls.pageType,
            latexPresent: cls.latexPresent,
            figureDescription: null,
            attempts: 0,
            tier: 2,
            error: null,
            parserVersion
          });
        } else if (options.textLayerOnly) {
          // Pass 1: record as pending vision without calling Gemini Vision
          await upsertDocumentPage(kdb, {
            fileId: file.id,
            pageNo,
            text: cls.cleanText || cls.rawText,
            rawText: cls.rawText,
            source: 'vision',
            ocrConfidence: null,
            charCount: countCleanAlnumChars(cls.rawText),
            status: 'pending',
            pageType: cls.pageType,
            latexPresent: cls.latexPresent,
            figureDescription: null,
            attempts: 0,
            tier: cls.tier || 1,
            error: null,
            parserVersion
          });
          if (cls.tier === 2) {
            tier2Queue.push({ pageNo, cls, pageStartedAt });
          } else {
            tier1Queue.push({ pageNo, cls, pageStartedAt });
          }
        } else if (cls.tier === 2) {
          tier2Queue.push({ pageNo, cls, pageStartedAt });
        } else {
          tier1Queue.push({ pageNo, cls, pageStartedAt });
        }
      }

      if (typeof options.onAfterPage === 'function' && cls.route !== 'vision') {
        await options.onAfterPage({ pageNo, totalPages, route: cls.route, durationMs: Date.now() - pageStartedAt });
      }
    }

    if (options.textLayerOnly) {
      await rollupToNoteSearchAndKnowledge(kdb, file.id, {
        hasUsableContent: usableCount > 0
      });
      const pendingVisionCount = tier1Queue.length + (isEnrichEnabled ? tier2Queue.length : 0);
      const finalStatus = pendingVisionCount > 0 ? 'ocr_running' : 'completed';
      await kdb.query(`
        UPDATE ingestion_jobs
        SET status = $1,
            total_pages = $2,
            processed_pages = $3,
            ocr_pages_count = 0,
            last_completed_page = $4,
            locked_at = NULL,
            heartbeat_at = NULL,
            completed_at = CASE WHEN $1 = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $5
      `, [finalStatus, totalPages, processedCount, lastCompletedPage, job.id]);

      return {
        jobId: job.id,
        fileId: file.id,
        status: finalStatus,
        hasVisionPages: pendingVisionCount > 0,
        totalPages,
        processedPages: processedCount,
        visionPagesUsed: 0,
        visionCalls: 0,
        failedPages: failedCount,
        skippedQuotaPages: 0
      };
    }

    const drainQueue = async (queue, isTier2 = false) => {
      let batch = [];
      for (const item of queue) {
        if (batch.length > 0 && item.pageNo !== batch[batch.length - 1].pageNo + 1) {
          if (!inOcrPhase) {
            inOcrPhase = true;
            await updateJobProgress(kdb, job.id, { status: 'ocr_running' });
          }
          await processVisionSubBatch(batch);
          batch = [];
        }

        if (isTier2 && (quotaState.quotaExhausted || wouldExceedDailyCap() || (visionUsed + batch.length) >= maxVisionPages)) {
          if (batch.length > 0) {
            if (!inOcrPhase) {
              inOcrPhase = true;
              await updateJobProgress(kdb, job.id, { status: 'ocr_running' });
            }
            await processVisionSubBatch(batch);
            batch = [];
          }
          processedCount++;
          usableCount++;
          if (item.pageNo > lastCompletedPage) lastCompletedPage = item.pageNo;
          await upsertDocumentPage(kdb, {
            fileId: file.id,
            pageNo: item.pageNo,
            text: item.cls.cleanText || item.cls.rawText,
            rawText: item.cls.rawText,
            source: 'text_layer',
            ocrConfidence: null,
            charCount: item.cls.charCount,
            status: 'completed',
            pageType: item.cls.pageType,
            latexPresent: item.cls.latexPresent,
            figureDescription: null,
            attempts: 0,
            tier: 2,
            error: null,
            parserVersion
          });
          continue;
        }

        if (quotaState.quotaExhausted || wouldExceedDailyCap()) {
          if (batch.length > 0) {
            if (!inOcrPhase) {
              inOcrPhase = true;
              await updateJobProgress(kdb, job.id, { status: 'ocr_running' });
            }
            await processVisionSubBatch(batch);
            batch = [];
          }
          if (!quotaState.quotaExhausted) {
            quotaState.quotaExhausted = true;
            quotaState.retryAfterMs = quotaState.retryAfterMs || 3600_000;
            quotaState.reason = `DOC_VISION_DAILY_REQUEST_CAP (${dailyVisionCap}) reached`;
          }
          quotaRetryAfterMs = Math.max(quotaRetryAfterMs || 0, quotaState.retryAfterMs || 3600_000);
          await markItemsSkippedQuota(
            [item],
            `QUOTA_EXHAUSTED: ${String(quotaState.reason || 'Gemini daily quota exhausted').slice(0, 360)}`
          );
        } else if (visionUsed + batch.length >= maxVisionPages) {
          if (batch.length > 0) {
            if (!inOcrPhase) {
              inOcrPhase = true;
              await updateJobProgress(kdb, job.id, { status: 'ocr_running' });
            }
            await processVisionSubBatch(batch);
            batch = [];
          }
          skippedQuotaCount++;
          processedCount++;
          await upsertDocumentPage(kdb, {
            fileId: file.id,
            pageNo: item.pageNo,
            text: item.cls.rawText,
            rawText: item.cls.rawText,
            source: 'skipped',
            ocrConfidence: null,
            charCount: countCleanAlnumChars(item.cls.rawText),
            status: 'skipped_quota',
            pageType: item.cls.pageType,
            latexPresent: item.cls.latexPresent,
            figureDescription: null,
            attempts: 0,
            tier: item.cls.tier || 1,
            error: `VISION_QUOTA_EXCEEDED: page ${item.pageNo} exceeded cap of ${maxVisionPages}`,
            parserVersion
          });
        } else {
          batch.push(item);
          const hitsQuotaEdge = visionUsed + batch.length >= maxVisionPages;
          if (batch.length >= visionBatchPages || hitsQuotaEdge) {
            if (!inOcrPhase) {
              inOcrPhase = true;
              await updateJobProgress(kdb, job.id, { status: 'ocr_running' });
            }
            await processVisionSubBatch(batch);
            batch = [];
          }
        }
      }
      if (batch.length > 0) {
        if (!inOcrPhase) {
          inOcrPhase = true;
          await updateJobProgress(kdb, job.id, { status: 'ocr_running' });
        }
        await processVisionSubBatch(batch);
      }
    };

    const pageTypePriority = (type) => {
      switch (type) {
        case 'scanned': return 1;
        case 'math': return 2;
        case 'nepali_repair': return 3;
        case 'table': return 4;
        case 'figure': return 5;
        default: return 6;
      }
    };
    tier1Queue.sort((a, b) => (
      pageTypePriority(a.cls.pageType) - pageTypePriority(b.cls.pageType) ||
      a.pageNo - b.pageNo
    ));
    tier2Queue.sort((a, b) => (
      pageTypePriority(a.cls.pageType) - pageTypePriority(b.cls.pageType) ||
      a.pageNo - b.pageNo
    ));

    // Drain Tier 1 queue first
    await drainQueue(tier1Queue, false);

    // Drain Tier 2 queue second (only runs vision if quota remains)
    if (tier2Queue.length > 0) {
      await drainQueue(tier2Queue, true);
    }

    await rollupToNoteSearchAndKnowledge(kdb, file.id, {
      hasUsableContent: usableCount > 0,
      fallbackError: failedCount > 0 || skippedQuotaCount > 0
        ? `${failedCount} failed page(s); ${skippedQuotaCount} quota-skipped page(s)`
        : null
    });

    let finalStatus = 'completed';
    let summaryError = null;
    if (quotaHitThisJob && skippedQuotaCount > 0) {
      finalStatus = 'failed_retryable';
      const delaySec = Math.max(60, Math.ceil((quotaRetryAfterMs || 3600_000) / 1000));
      summaryError = `QUOTA_EXHAUSTED: ${skippedQuotaCount} page(s) skipped_quota; retry in ${delaySec}s`;

      await kdb.query(`
        UPDATE ingestion_jobs
        SET status = 'failed_retryable',
            total_pages = $1,
            processed_pages = $2,
            ocr_pages_count = $3,
            last_completed_page = $4,
            vision_calls = $5,
            vision_input_tokens = $6,
            vision_output_tokens = $7,
            error = $8,
            attempts = GREATEST(0, attempts - 1),
            next_retry_at = CURRENT_TIMESTAMP + ($9 || ' seconds')::interval,
            locked_at = NULL,
            completed_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $10
      `, [
        totalPages,
        processedCount,
        visionUsed,
        lastCompletedPage,
        visionCalls,
        visionInputTokens,
        visionOutputTokens,
        summaryError,
        String(delaySec),
        job.id
      ]);

      return {
        jobId: job.id,
        fileId: file.id,
        status: finalStatus,
        quotaExhausted: true,
        retryAfterMs: quotaRetryAfterMs,
        totalPages,
        processedPages: processedCount,
        visionPagesUsed: visionUsed,
        visionCalls,
        visionInputTokens,
        visionOutputTokens,
        failedPages: failedCount,
        skippedQuotaPages: skippedQuotaCount
      };
    }

    if (failedCount > 0 || skippedQuotaCount > 0) {
      if (usableCount > 0) {
        finalStatus = 'partial_success';
      } else if (lastErrorCode === 'VISION_TIMEOUT') {
        finalStatus = 'failed_retryable';
      } else {
        finalStatus = 'failed_terminal';
      }
      const codeSuffix = lastErrorCode ? ` (${lastErrorCode})` : '';
      summaryError = `${failedCount} page(s) failed${codeSuffix}; ${skippedQuotaCount} page(s) skipped_quota`;
    }

    await kdb.query(`
      UPDATE ingestion_jobs
      SET status = $1,
          total_pages = $2,
          processed_pages = $3,
          ocr_pages_count = $4,
          last_completed_page = $5,
          vision_calls = $6,
          vision_input_tokens = $7,
          vision_output_tokens = $8,
          error = $9,
          locked_at = NULL,
          completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
    `, [
      finalStatus,
      totalPages,
      processedCount,
      visionUsed,
      lastCompletedPage,
      visionCalls,
      visionInputTokens,
      visionOutputTokens,
      summaryError,
      job.id
    ]);

    return {
      jobId: job.id,
      fileId: file.id,
      status: finalStatus,
      totalPages,
      processedPages: processedCount,
      visionPagesUsed: visionUsed,
      visionCalls,
      visionInputTokens,
      visionOutputTokens,
      failedPages: failedCount,
      skippedQuotaPages: skippedQuotaCount
    };
  } catch (err) {
    if (err.configError || err.code === 'VISION_CONFIG_ERROR' || err.code === 'VISION_MODEL_UNCONFIGURED') {
      const setting = err.configSetting || (/API_KEY/i.test(err.message) ? 'GEMINI_API_KEY' : 'DOC_VISION_MODEL');
      const errorMsg = `VISION_CONFIG_ERROR: Misconfigured ${setting}. ${err.message}`;
      console.error(`[DocWorker] CONFIG ERROR: ${errorMsg}. Halting run.`);
      await kdb.query(`
        UPDATE ingestion_jobs
        SET status = 'failed_retryable',
            error = $1,
            locked_at = NULL,
            attempts = GREATEST(0, attempts - 1),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [errorMsg, job.id]);
      await kdb.query(`
        UPDATE doc_pages
        SET status = 'pending', attempts = GREATEST(0, attempts - 1)
        WHERE file_id = $1 AND (status = 'failed' OR status = 'ocr_running')
      `, [file.id]);
      return {
        jobId: job.id,
        fileId: file.id,
        status: 'failed_retryable',
        configError: true,
        setting,
        error: errorMsg,
        totalPages,
        processedPages: processedCount,
        visionPagesUsed: visionUsed,
        failedPages: failedCount,
        skippedQuotaPages: skippedQuotaCount
      };
    }
    throw err;
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

async function processImageJob(kdb, job, file, imageBuffer, options = {}) {
  await updateJobProgress(kdb, job.id, {
    status: 'ocr_running',
    total_pages: 1
  });

  const originalName = file.originalName || file.originalname || file.storedName || '';
  const ext = path.extname(originalName).toLowerCase();
  const mimeType = file.mimeType || file.mimetype || (ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg'));

  const res = await extractImageWithVision({
    imageBuffer,
    mimeType,
    fileName: originalName,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    env: options.env || process.env,
    model: options.model,
    apiKey: options.apiKey,
    timeoutMs: options.pageTimeoutMs
  });

  const text = String(res.text || '').trim();
  const charCount = countCleanAlnumChars(text);

  await upsertDocumentPage(kdb, {
    fileId: file.id,
    pageNo: 1,
    text,
    rawText: text,
    source: 'vision',
    charCount,
    status: 'completed',
    pageType: res.detectedType || 'figure',
    latexPresent: Boolean(res.latexPresent),
    figureDescription: res.figureDescription,
    ocrConfidence: res.ocrConfidence,
    attempts: 1,
    error: null,
    parserVersion: options.parserVersion || PARSER_VERSION
  });

  await rollupToNoteSearchAndKnowledge(kdb, file.id);

  const inputTokens = Number(res.usage?.inputTokens) || 0;
  const outputTokens = Number(res.usage?.outputTokens) || 0;

  await kdb.query(`
    UPDATE ingestion_jobs
    SET status = 'completed',
        total_pages = 1,
        processed_pages = 1,
        ocr_pages_count = 1,
        last_completed_page = 1,
        vision_calls = vision_calls + 1,
        vision_input_tokens = vision_input_tokens + $1,
        vision_output_tokens = vision_output_tokens + $2,
        error = NULL,
        locked_at = NULL,
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $3
  `, [inputTokens, outputTokens, job.id]);

  return {
    jobId: job.id,
    fileId: file.id,
    status: 'completed',
    totalPages: 1,
    processedPages: 1,
    visionPagesUsed: 1,
    failedPages: 0,
    skippedQuotaPages: 0
  };
}

async function processNonPdfJob(kdb, job, file, fileBuffer) {
  const { text } = await noteSearch.extractText(fileBuffer, file.originalName || file.storedName);
  const pages = String(text || '').split('\f');
  const totalPages = Math.max(1, pages.length);

  await updateJobProgress(kdb, job.id, { total_pages: totalPages });

  for (let i = 0; i < pages.length; i++) {
    const pageText = pages[i].trim();
    const charCount = countCleanAlnumChars(pageText);
    await upsertDocumentPage(kdb, {
      fileId: file.id,
      pageNo: i + 1,
      text: pageText,
      rawText: pageText,
      source: pageText ? 'text_layer' : 'skipped',
      charCount,
      status: pageText ? 'completed' : 'skipped',
      pageType: 'text',
      latexPresent: false,
      attempts: 0,
      error: null,
      parserVersion: PARSER_VERSION
    });
  }

  await rollupToNoteSearchAndKnowledge(kdb, file.id);
  await kdb.query(`
    UPDATE ingestion_jobs
    SET status = 'completed',
        total_pages = $1,
        processed_pages = $1,
        ocr_pages_count = 0,
        last_completed_page = $1,
        error = NULL,
        locked_at = NULL,
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
  `, [totalPages, job.id]);

  return {
    jobId: job.id,
    fileId: file.id,
    status: 'completed',
    totalPages,
    processedPages: totalPages,
    visionPagesUsed: 0,
    failedPages: 0,
    skippedQuotaPages: 0
  };
}

/**
 * Claims and processes the next available queued/retryable/stale ingestion job.
 */
async function processNextIngestionJob(db, options = {}) {
  const kdb = asKnowledgeDb(db);
  const job = await claimNextIngestionJob(kdb, {
    ...options,
    mode: options.claimMode || options.mode || 'all'
  });
  if (!job) return null;

  try {
    const fileRes = await kdb.query('SELECT * FROM files WHERE id = $1 LIMIT 1', [job.file_id]);
    const file = fileRes.rows?.[0];
    if (!file) {
      await failJob(kdb, job, 'FILE_NOT_FOUND: Owning row does not exist in files.', { terminal: true });
      return { jobId: job.id, fileId: job.file_id, status: 'failed_terminal', error: 'FILE_NOT_FOUND' };
    }

    const originalName = file.originalName || file.originalname || file.storedName || file.storedname || '';
    const ext = path.extname(String(originalName)).toLowerCase();
    const mimeType = String(file.mimeType || file.mimetype || '').toLowerCase();
    const isImage = IMAGE_EXTS.has(ext) || mimeType.startsWith('image/');

    if (isImage) {
      const readImagesEnabled = String(options.readImages ?? (options.env || process.env).DOC_READ_IMAGES ?? 'false').trim().toLowerCase() === 'true';
      const hasSubject = Boolean(file.subject && String(file.subject).trim());

      if (!readImagesEnabled || !hasSubject) {
        const skipReason = !readImagesEnabled
          ? 'Image reading is disabled by default (DOC_READ_IMAGES=false)'
          : 'Image reading skipped: file has no academic subject set';

        await upsertDocumentPage(kdb, {
          fileId: file.id,
          pageNo: 1,
          text: '',
          rawText: '',
          source: 'skipped',
          charCount: 0,
          status: 'skipped',
          pageType: 'figure',
          latexPresent: false,
          figureDescription: skipReason,
          attempts: 0,
          error: null,
          parserVersion: options.parserVersion || PARSER_VERSION
        });

        // Ensure metadata stays searchable
        const cleanName = String(originalName || file.storedName || '')
          .replace(/\.[^/.]+$/, '')
          .replace(/[-_]+/g, ' ')
          .trim();
        const placeholderContent = [file.title, cleanName, file.subject, file.chapter]
          .map(v => String(v || '').trim())
          .filter(Boolean)
          .join(' — ');

        await kdb.query(`
          INSERT INTO note_search_documents (
            id, content, extraction_status, extraction_error, indexed_at, content_truncated
          )
          VALUES ($1, $2, 'skipped', NULL, CURRENT_TIMESTAMP, 0)
          ON CONFLICT (id)
          DO UPDATE SET
            content = CASE WHEN note_search_documents.content <> '' THEN note_search_documents.content ELSE EXCLUDED.content END,
            extraction_status = 'skipped',
            extraction_error = NULL,
            indexed_at = CURRENT_TIMESTAMP
        `, [file.id, placeholderContent]);

        noteSearch.invalidateSearchCache(kdb);

        await kdb.query(`
          UPDATE ingestion_jobs
          SET status = 'skipped',
              total_pages = 1,
              processed_pages = 1,
              ocr_pages_count = 0,
              last_completed_page = 1,
              error = NULL,
              locked_at = NULL,
              completed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `, [job.id]);

        return {
          jobId: job.id,
          fileId: file.id,
          status: 'skipped',
          reason: skipReason,
          totalPages: 1,
          processedPages: 1,
          visionPagesUsed: 0,
          failedPages: 0,
          skippedQuotaPages: 0
        };
      }
    }

    if (!isImage && !SUPPORTED_TEXT_EXTS.has(ext)) {
      await rollupToNoteSearchAndKnowledge(kdb, file.id, {
        fallbackStatus: 'unsupported',
        fallbackError: `Unsupported file extension "${ext || 'unknown'}"`
      });
      await failJob(kdb, job, `UNSUPPORTED_FORMAT: Extension "${ext}" is not supported.`, { terminal: true });
      return { jobId: job.id, fileId: file.id, status: 'failed_terminal', error: 'UNSUPPORTED_FORMAT' };
    }

    let fileBytes;
    try {
      fileBytes = await readFileBytesWithBlobFallback(kdb, {
        ...file,
        storedName: file.storedName || file.storedname,
        originalName,
        mimeType: file.mimeType || file.mimetype,
        storageUrl: file.storageUrl ?? file.storageurl,
        sizeBytes: file.sizeBytes ?? file.sizebytes ?? 0
      }, options);
    } catch (readErr) {
      const isTooLarge = readErr?.extractionStatus === 'too_large';
      const status = await failJob(
        kdb,
        job,
        `${isTooLarge ? 'TOO_LARGE' : 'STORAGE_READ_ERROR'}: ${readErr.message}`,
        { terminal: isTooLarge }
      );
      if (isTooLarge) {
        await rollupToNoteSearchAndKnowledge(kdb, file.id, {
          fallbackStatus: 'too_large',
          fallbackError: readErr.message
        }).catch(() => {});
      }
      return { jobId: job.id, fileId: file.id, status, error: readErr.message };
    }

    const contentHash = computeContentHash(fileBytes);
    await kdb.query('UPDATE ingestion_jobs SET content_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [contentHash, job.id]);

    const reused = await tryReuseDedupPages(kdb, job, contentHash, options.parserVersion || PARSER_VERSION);
    if (reused) {
      return reused;
    }

    if (isImage) {
      if (options.textLayerOnly) {
        await upsertDocumentPage(kdb, {
          fileId: file.id,
          pageNo: 1,
          text: '',
          rawText: '',
          source: 'vision',
          ocrConfidence: null,
          charCount: 0,
          status: 'pending',
          pageType: 'figure',
          latexPresent: false,
          figureDescription: null,
          attempts: 0,
          tier: 1,
          error: null,
          parserVersion: options.parserVersion || PARSER_VERSION
        });
        const cleanName = String(originalName || file.storedName || '').replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ').trim();
        const placeholderContent = [file.title, cleanName, file.subject, file.chapter].map(v => String(v || '').trim()).filter(Boolean).join(' — ');
        await kdb.query(`
          INSERT INTO note_search_documents (id, content, extraction_status, extraction_error, indexed_at, content_truncated)
          VALUES ($1, $2, 'indexed', NULL, CURRENT_TIMESTAMP, 0)
          ON CONFLICT (id) DO UPDATE SET indexed_at = CURRENT_TIMESTAMP
        `, [file.id, placeholderContent]);
        await kdb.query(`
          UPDATE ingestion_jobs
          SET status = 'ocr_running',
              total_pages = 1,
              processed_pages = 0,
              locked_at = NULL,
              heartbeat_at = NULL,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `, [job.id]);
        return {
          jobId: job.id,
          fileId: file.id,
          status: 'ocr_running',
          hasVisionPages: true,
          totalPages: 1,
          processedPages: 0
        };
      }
      return await processImageJob(kdb, job, { ...file, originalName }, fileBytes, options);
    }

    if (ext === '.pdf') {
      return await processPdfJob(kdb, job, { ...file, originalName }, fileBytes, options);
    }

    return await processNonPdfJob(kdb, job, { ...file, originalName }, fileBytes);
  } catch (err) {
    const terminal = Boolean(err?.terminal);
    const status = await failJob(kdb, job, err?.message || 'Unexpected ingestion worker error', { terminal });
    if (terminal) {
      await rollupToNoteSearchAndKnowledge(kdb, job.file_id, {
        fallbackStatus: 'error',
        fallbackError: err.message
      }).catch(() => {});
    }
    return { jobId: job.id, fileId: job.file_id, status, error: err.message };
  }
}

/**
 * Pass 1: Processes text-layer pages of queued jobs without making Gemini Vision calls.
 * Immediately writes note_search_documents rollup for each job.
 */
async function runTextLayerPass(db, options = {}) {
  const kdb = asKnowledgeDb(db);
  const maxJobs = options.maxJobs ?? (Number(process.env.DOC_WORKER_MAX_JOBS) || 20);
  const maxDurationMs = options.maxDurationMs ?? (Number(process.env.DOC_RUN_BUDGET_MS || process.env.DOC_WORKER_BUDGET_MS) || 45 * 60 * 1000);
  const startedAt = options.startedAt || Date.now();
  const results = [];
  const processedJobIds = new Set();

  for (let i = 0; i < maxJobs; i++) {
    if (Date.now() - startedAt >= maxDurationMs) break;
    const outcome = await processNextIngestionJob(kdb, {
      ...options,
      claimMode: 'text_only',
      textLayerOnly: true,
      excludeJobIds: Array.from(processedJobIds)
    });
    if (!outcome) break;
    processedJobIds.add(outcome.jobId);
    results.push(outcome);
    if (outcome.configError) {
      console.error(`[DocWorker] Pass 1 halted due to configuration error: ${outcome.error}`);
      break;
    }
  }

  return results;
}

/**
 * Pass 2: Processes vision pages across jobs in priority order:
 * scanned -> math -> nepali_repair -> table -> figure.
 * Quota stops pause vision calls but allow remaining vision jobs to be marked skipped_quota with next_retry_at.
 */
async function processVisionPassAcrossJobs(db, options = {}) {
  const kdb = asKnowledgeDb(db);
  const maxJobs = options.maxJobs ?? (Number(process.env.DOC_WORKER_MAX_JOBS) || 20);
  const maxDurationMs = options.maxDurationMs ?? (Number(process.env.DOC_RUN_BUDGET_MS || process.env.DOC_WORKER_BUDGET_MS) || 45 * 60 * 1000);
  const startedAt = options.startedAt || Date.now();
  const quotaState = options.quotaState || { quotaExhausted: false, retryAfterMs: null, reason: null };
  const results = [];
  const processedJobIds = new Set();

  for (let i = 0; i < maxJobs; i++) {
    if (Date.now() - startedAt >= maxDurationMs) break;
    const outcome = await processNextIngestionJob(kdb, {
      ...options,
      claimMode: 'vision_only',
      textLayerOnly: false,
      quotaState,
      excludeJobIds: Array.from(processedJobIds)
    });
    if (!outcome) break;
    processedJobIds.add(outcome.jobId);
    results.push(outcome);
    if (outcome.configError) {
      console.error(`[DocWorker] Pass 2 halted due to configuration error: ${outcome.error}`);
      break;
    }
  }

  return results;
}

/**
 * Runs two-pass ingestion:
 * 1. Text-layer pass across all queued jobs + immediate rollup
 * 2. Vision OCR pass across jobs in priority order
 */
async function runTwoPassIngestionLoop(db, options = {}) {
  const kdb = asKnowledgeDb(db);
  const maxJobs = options.maxJobs ?? (Number(process.env.DOC_WORKER_MAX_JOBS) || 20);
  const maxDurationMs = options.maxDurationMs ?? (Number(process.env.DOC_RUN_BUDGET_MS || process.env.DOC_WORKER_BUDGET_MS) || 45 * 60 * 1000);
  const startedAt = Date.now();
  const quotaState = options.quotaState || { quotaExhausted: false, retryAfterMs: null, reason: null };

  if (options.retryFailed) {
    const resetStats = await resetFailedJobsAndPages(kdb);
    console.log(`[DocWorker] Reset ${resetStats.resetPages} failed pages and ${resetStats.resetJobs} failed jobs.`);
  }

  const pass1Results = await runTextLayerPass(kdb, {
    ...options,
    maxJobs,
    maxDurationMs,
    startedAt,
    quotaState
  });

  const pass2Results = await processVisionPassAcrossJobs(kdb, {
    ...options,
    maxJobs,
    maxDurationMs,
    startedAt,
    quotaState
  });

  const remainingRes = await kdb.query(`
    SELECT COUNT(*)::int AS count
    FROM ingestion_jobs
    WHERE status IN ('queued', 'extracting_text')
  `).catch(() => ({ rows: [{ count: 0 }] }));
  const queuedRemaining = Number(remainingRes.rows?.[0]?.count || 0);

  const allResults = [...pass1Results, ...pass2Results];

  return {
    pass1Results,
    pass2Results,
    processedJobs: allResults.length,
    queuedRemaining,
    quotaExhausted: Boolean(quotaState.quotaExhausted),
    model: (options.env || process.env).DOC_VISION_MODEL || null,
    results: allResults
  };
}

/**
 * Compiles a structured final log summary of database state and worker metrics.
 */
async function getFinalRunSummary(db, { model = null, quotaState = null } = {}) {
  const kdb = asKnowledgeDb(db);
  const jobsRes = await kdb.query(`
    SELECT status, COUNT(*)::int AS count
    FROM ingestion_jobs
    GROUP BY status
    ORDER BY status ASC
  `).catch(() => ({ rows: [] }));
  const jobsByStatus = Object.fromEntries((jobsRes.rows || []).map(r => [r.status, Number(r.count)]));

  const pagesRes = await kdb.query(`
    SELECT source, COUNT(*)::int AS count
    FROM doc_pages
    GROUP BY source
    ORDER BY source ASC
  `).catch(() => ({ rows: [] }));
  const pagesByRoute = Object.fromEntries((pagesRes.rows || []).map(r => [r.source, Number(r.count)]));

  const metricsRes = await kdb.query(`
    SELECT
      COALESCE(SUM(vision_calls), 0)::int AS total_calls,
      COALESCE(SUM(vision_input_tokens), 0)::int AS total_input_tokens,
      COALESCE(SUM(vision_output_tokens), 0)::int AS total_output_tokens
    FROM ingestion_jobs
  `).catch(() => ({ rows: [{ total_calls: 0, total_input_tokens: 0, total_output_tokens: 0 }] }));
  const metrics = metricsRes.rows?.[0] || { total_calls: 0, total_input_tokens: 0, total_output_tokens: 0 };

  const queuedRes = await kdb.query(`
    SELECT COUNT(*)::int AS count
    FROM ingestion_jobs
    WHERE status IN ('queued', 'extracting_text')
  `).catch(() => ({ rows: [{ count: 0 }] }));
  const queuedRemaining = Number(queuedRes.rows?.[0]?.count || 0);

  return {
    jobsByStatus,
    pagesByRoute,
    visionCalls: Number(metrics.total_calls || 0),
    tokens: {
      input: Number(metrics.total_input_tokens || 0),
      output: Number(metrics.total_output_tokens || 0),
      total: Number(metrics.total_input_tokens || 0) + Number(metrics.total_output_tokens || 0)
    },
    model: model || process.env.DOC_VISION_MODEL || null,
    quotaState: quotaState || { quotaExhausted: false, retryAfterMs: null, reason: null },
    jobsRemaining: queuedRemaining
  };
}

/**
 * Drains queued/retryable ingestion jobs up to maxJobs or maxDurationMs.
 * Supports both single-pass sequential processing and two-pass processing.
 */
async function runIngestionWorkerLoop(db, options = {}) {
  if (options.twoPass || process.env.DOC_WORKER_TWO_PASS === 'true') {
    return await runTwoPassIngestionLoop(db, options);
  }

  const maxJobs = options.maxJobs ?? (Number(process.env.DOC_WORKER_MAX_JOBS) || 20);
  const maxDurationMs = options.maxDurationMs ?? (Number(process.env.DOC_RUN_BUDGET_MS || process.env.DOC_WORKER_BUDGET_MS) || 45 * 60 * 1000);
  const startedAt = Date.now();
  const results = [];
  const quotaState = options.quotaState || { quotaExhausted: false, retryAfterMs: null, reason: null };

  if (options.retryFailed) {
    await resetFailedJobsAndPages(db);
  }

  for (let i = 0; i < maxJobs; i++) {
    if (quotaState.quotaExhausted) break;
    if (Date.now() - startedAt >= maxDurationMs) break;
    const outcome = await processNextIngestionJob(db, { ...options, quotaState });
    if (!outcome) break;
    results.push(outcome);
    if (outcome.configError) {
      console.error(`[DocWorker] Run halted due to configuration error: ${outcome.error}`);
      break;
    }
    if (quotaState.quotaExhausted) break;
  }

  const kdb = asKnowledgeDb(db);
  const remainingRes = await kdb.query(`
    SELECT COUNT(*)::int AS count
    FROM ingestion_jobs
    WHERE status IN ('queued', 'extracting_text')
  `).catch(() => ({ rows: [{ count: 0 }] }));
  const queuedRemaining = Number(remainingRes.rows?.[0]?.count || 0);

  return {
    processedJobs: results.length,
    queuedRemaining,
    quotaExhausted: quotaState.quotaExhausted,
    model: (options.env || process.env).DOC_VISION_MODEL || null,
    results
  };
}

/**
 * Finds note files with no completed/active ingestion job and enqueues them up to `limit`.
 * When `dryRun` is true, returns the count and sample file IDs without inserting any jobs.
 */
async function reconcileMissingIngestionJobs(db, {
  limit = 500,
  dryRun = false,
  includePartial = false,
  includeFailedTerminal = false
} = {}) {
  if (!isPgDatabase(db)) {
    return { dryRun: Boolean(dryRun), totalMissing: 0, wouldEnqueue: 0, enqueued: 0, skipped: 0, fileIds: [] };
  }

  const kdb = asKnowledgeDb(db);
  const safeLimit = Math.max(1, Math.min(Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 500, 10000));

  const excludedStatuses = [
    'completed',
    'dedup_reused',
    'queued',
    'extracting_text',
    'ocr_running',
    'failed_retryable',
    'skipped'
  ];
  if (!includePartial) excludedStatuses.push('partial_success');
  if (!includeFailedTerminal) excludedStatuses.push('failed_terminal');

  const placeholders = excludedStatuses.map((_, idx) => `$${idx + 1}`).join(', ');
  const filterSql = `
    FROM files f
    WHERE NOT EXISTS (
      SELECT 1 FROM ingestion_jobs j
      WHERE j.file_id = f.id
        AND j.status IN (${placeholders})
    )
  `;

  const countRes = await kdb.query(`SELECT COUNT(*)::int AS total_missing ${filterSql}`, excludedStatuses);
  const totalMissing = Number(countRes.rows?.[0]?.total_missing || 0);

  const limitParamIdx = excludedStatuses.length + 1;
  const targetRes = await kdb.query(
    `SELECT f.id ${filterSql} ORDER BY f.id ASC LIMIT $${limitParamIdx}`,
    [...excludedStatuses, safeLimit]
  );
  const fileIds = (targetRes.rows || []).map(r => Number(r.id)).filter(id => Number.isSafeInteger(id) && id > 0);

  if (dryRun) {
    return {
      dryRun: true,
      totalMissing,
      wouldEnqueue: fileIds.length,
      enqueued: 0,
      skipped: 0,
      fileIds
    };
  }

  let enqueued = 0;
  let skipped = 0;
  for (const fileId of fileIds) {
    const out = await enqueueDocumentIngestionJob(kdb, { fileId, contentHash: '' });
    if (out && out.status === 'queued') {
      enqueued++;
    } else {
      skipped++;
    }
  }

  return {
    dryRun: false,
    totalMissing,
    wouldEnqueue: fileIds.length,
    enqueued,
    skipped,
    fileIds
  };
}

/**
 * Checks whether there are runnable ingestion or knowledge jobs so scheduled runs can exit early.
 */
async function hasPendingWork(db, {
  includeKnowledge = true,
  leaseMinutes = LEASE_STALE_MINUTES
} = {}) {
  if (!isPgDatabase(db)) {
    return { hasWork: false, ingestionPending: false, knowledgePending: false };
  }

  const kdb = asKnowledgeDb(db);
  let ingestionPending = false;
  let knowledgePending = false;

  try {
    const ingRes = await kdb.query(`
      SELECT 1
      FROM ingestion_jobs
      WHERE (
        status = 'queued'
        OR (status = 'failed_retryable' AND next_retry_at <= CURRENT_TIMESTAMP)
        OR (
          status IN ('extracting_text', 'ocr_running')
          AND (heartbeat_at IS NULL OR heartbeat_at < CURRENT_TIMESTAMP - ($1 || ' minutes')::interval)
        )
      )
        AND attempts < max_attempts
      LIMIT 1
    `, [String(leaseMinutes)]);
    ingestionPending = Boolean(ingRes.rows && ingRes.rows.length > 0);
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
  }

  if (includeKnowledge && isKnowledgeIndexingEnabled()) {
    try {
      const kRes = await kdb.query(`
        SELECT 1
        FROM knowledge_jobs
        WHERE status IN ('pending', 'failed')
          AND scheduled_at <= CURRENT_TIMESTAMP
          AND attempts < max_attempts
        LIMIT 1
      `);
      knowledgePending = Boolean(kRes.rows && kRes.rows.length > 0);
    } catch (err) {
      if (!isMissingRelationError(err)) throw err;
    }
  }

  return {
    hasWork: ingestionPending || knowledgePending,
    ingestionPending,
    knowledgePending
  };
}

/**
 * Drains pending knowledge_jobs in-process against the DB within a wall-clock budget.
 */
async function drainKnowledgeJobs(db, options = {}) {
  const env = options.env || process.env;
  const enabled = options.enabled ?? isKnowledgeIndexingEnabled();
  if (!enabled) {
    return {
      skipped: true,
      reason: 'KYANA_KNOWLEDGE_V3 or KYANA_KNOWLEDGE_V3_USERS is not enabled',
      processed: 0,
      succeeded: 0,
      failed: 0,
      batches: 0,
      elapsedMs: 0,
      timedOut: false
    };
  }

  const budgetMs = options.budgetMs ?? (Number(env.DOC_KNOWLEDGE_BUDGET_MS || env.KNOWLEDGE_WORKER_BUDGET_MS) || 8 * 60 * 1000);
  const batchSize = options.batchSize ?? (Number(env.DOC_KNOWLEDGE_BATCH_SIZE) || 20);
  const workerFn = options.processPendingJobsFn || processPendingJobs;
  const workerDb = db && db.pool
    ? db
    : Object.assign(Object.create(db || {}), { pool: db?.pgPool || null });

  const startedAt = Date.now();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let batches = 0;

  while (Date.now() - startedAt < budgetMs) {
    const res = await workerFn(workerDb, { batchSize });
    batches++;
    const p = Number(res?.processed) || 0;
    const s = Number(res?.succeeded) || 0;
    const f = Number(res?.failed) || 0;
    processed += p;
    succeeded += s;
    failed += f;

    if (p === 0 || (s === 0 && f > 0)) {
      break;
    }
  }

  const elapsedMs = Date.now() - startedAt;
  return {
    skipped: false,
    reason: null,
    processed,
    succeeded,
    failed,
    batches,
    elapsedMs,
    timedOut: elapsedMs >= budgetMs
  };
}

module.exports = {
  PARSER_VERSION,
  DEFAULT_MAX_VISION_PAGES,
  DEFAULT_MAX_WORKER_FILE_BYTES,
  MAX_PAGE_ATTEMPTS,
  computeContentHash,
  resolveDailyVisionRequestCap,
  getDailyVisionCallsUsed,
  resolveDriftMinOverlap,
  extractComparisonWords,
  applyDriftCheck,
  enqueueDocumentIngestionJob,
  claimNextIngestionJob,
  rollupToNoteSearchAndKnowledge,
  reconcileMissingIngestionJobs,
  hasPendingWork,
  drainKnowledgeJobs,
  processNextIngestionJob,
  runIngestionWorkerLoop,
  runTwoPassIngestionLoop,
  runTextLayerPass,
  processVisionPassAcrossJobs,
  formatFailedPageDiagnostic,
  resetFailedJobsAndPages,
  getFinalRunSummary
};
