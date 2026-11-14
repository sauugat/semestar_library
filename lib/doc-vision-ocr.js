'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const { PDFDocument } = require('pdf-lib');

const DEFAULT_PAGE_TIMEOUT_MS = Number(process.env.DOC_PAGE_TIMEOUT_MS) || 25000;
const DEFAULT_INLINE_PDF_MAX_BYTES = Number(process.env.DOC_INLINE_PDF_MAX_BYTES) || (4 * 1024 * 1024);
const SLICE_IMAGE_RENDER_THRESHOLD_BYTES = 1.5 * 1024 * 1024; // 1.5 MB poppler JPEG threshold
const MAX_VISION_BATCH_PAGES = 3;

const DEFAULT_TIMEOUT_BASE_MS = 25000;
const DEFAULT_TIMEOUT_PER_MB_MS = 15000;
const DEFAULT_TIMEOUT_MAX_MS = 60000;

function calculateVisionTimeoutMs(sliceBytes = 0, env = process.env, isRetry = false) {
  const baseMs = Number(env?.DOC_VISION_TIMEOUT_BASE_MS) || DEFAULT_TIMEOUT_BASE_MS;
  const perMbMs = Number(env?.DOC_VISION_TIMEOUT_PER_MB_MS) || DEFAULT_TIMEOUT_PER_MB_MS;
  const maxMs = Number(env?.DOC_VISION_TIMEOUT_MAX_MS) || DEFAULT_TIMEOUT_MAX_MS;

  const sizeMb = Math.max(0, Number(sliceBytes) || 0) / (1024 * 1024);
  const nominalMs = Math.min(maxMs, Math.round(baseMs + sizeMb * perMbMs));
  if (isRetry) {
    return Math.round(nominalMs * 1.5);
  }
  return nominalMs;
}

function resolveVisionBatchPages(options = {}, env = process.env) {
  const raw = options.visionBatchPages ?? env.DOC_VISION_BATCH_PAGES ?? 1;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(MAX_VISION_BATCH_PAGES, parsed);
}

function classifyPdfLibError(err, fallbackCode = 'PDF_SLICE_FAILED') {
  const name = String(err?.name || '');
  const msg = String(err?.message || '');
  let code = fallbackCode;
  if (name === 'PasswordException' || /password|encrypted/i.test(msg)) {
    code = 'PASSWORD_PROTECTED';
  } else if (/corrupt|invalid|xref|trailer|startxref|header|unexpected end|failed to parse/i.test(msg)) {
    code = 'CORRUPT_FILE';
  }
  const wrapped = new Error(`${code}: ${msg || 'PDF processing error.'}`);
  wrapped.code = code;
  wrapped.terminal = true;
  wrapped.transient = false;
  return wrapped;
}

/**
 * Loads a PDF buffer once via pdf-lib for subsequent single/batch page slicing.
 */
async function loadPdfForSlicing(pdfBuffer, { pdfPassword } = {}) {
  try {
    return await PDFDocument.load(pdfBuffer, {
      ignoreEncryption: Boolean(pdfPassword)
    });
  } catch (err) {
    throw classifyPdfLibError(err, 'CORRUPT_FILE');
  }
}

/**
 * Builds a small single- or multi-page PDF buffer containing only the target
 * 1-based physical pages from an already-loaded pdf-lib PDFDocument.
 */
async function buildPdfSlice(srcPdfDoc, oneBasedPageNos) {
  if (!srcPdfDoc || typeof srcPdfDoc.copyPages !== 'function') {
    const err = new Error('PDF_SLICE_FAILED: srcPdfDoc (pdf-lib PDFDocument) is required.');
    err.code = 'PDF_SLICE_FAILED';
    err.terminal = true;
    err.transient = false;
    throw err;
  }
  const totalCount = typeof srcPdfDoc.getPageCount === 'function' ? srcPdfDoc.getPageCount() : 0;
  const indices = (oneBasedPageNos || []).map(p => Number(p) - 1);
  if (indices.length === 0 || indices.some(idx => !Number.isInteger(idx) || idx < 0 || (totalCount > 0 && idx >= totalCount))) {
    const err = new Error(`PDF_SLICE_FAILED: Requested page(s) [${(oneBasedPageNos || []).join(', ')}] out of bounds (1..${totalCount}).`);
    err.code = 'PDF_SLICE_FAILED';
    err.terminal = true;
    err.transient = false;
    throw err;
  }
  try {
    const sliceDoc = await PDFDocument.create();
    const copied = await sliceDoc.copyPages(srcPdfDoc, indices);
    for (const page of copied) {
      sliceDoc.addPage(page);
    }
    const bytes = await sliceDoc.save();
    return Buffer.from(bytes);
  } catch (err) {
    throw classifyPdfLibError(err, 'PDF_SLICE_FAILED');
  }
}

function resolveVisionModel(options = {}, env = process.env) {
  const model = options.model || env.DOC_VISION_MODEL;
  if (!model || !String(model).trim()) {
    const err = new Error('VISION_MODEL_UNCONFIGURED: DOC_VISION_MODEL environment variable is required for vision OCR.');
    err.transient = false;
    err.code = 'VISION_MODEL_UNCONFIGURED';
    err.configSetting = 'DOC_VISION_MODEL';
    err.configError = true;
    throw err;
  }
  return String(model).trim();
}

function resolveApiKey(options = {}, env = process.env) {
  const apiKey = options.apiKey || env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    const err = new Error('VISION_API_KEY_MISSING: GEMINI_API_KEY (or GOOGLE_API_KEY) environment variable is required for vision OCR.');
    err.transient = false;
    err.code = 'VISION_API_KEY_MISSING';
    err.configSetting = 'GEMINI_API_KEY';
    err.configError = true;
    throw err;
  }
  return String(apiKey).trim();
}

function isTransientHttpStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/**
 * Parses Gemini duration strings like "20h27m33.206s", "73653s", "45s", or "500ms" into milliseconds.
 */
function parseDurationToMs(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const sec = Number(s);
    return Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : null;
  }
  const partRe = /(\d+(?:\.\d+)?)(ms|h|m|s)/gi;
  let totalMs = 0;
  let matched = false;
  let m;
  while ((m = partRe.exec(s)) !== null) {
    matched = true;
    const val = Number(m[1]);
    const unit = m[2].toLowerCase();
    if (!Number.isFinite(val)) continue;
    if (unit === 'h') totalMs += val * 3600 * 1000;
    else if (unit === 'm') totalMs += val * 60 * 1000;
    else if (unit === 's') totalMs += val * 1000;
    else if (unit === 'ms') totalMs += val;
  }
  return matched && totalMs > 0 ? Math.round(totalMs) : null;
}

/**
 * Inspects a Gemini 429 response body and Retry-After header to distinguish
 * daily/per-day quota exhaustion from short per-minute rate limits.
 */
function parseGemini429Details(rawBody = '', retryAfterHeader = null) {
  const textBody = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody || '');
  let parsed = null;
  try {
    parsed = typeof rawBody === 'object' && rawBody !== null ? rawBody : JSON.parse(textBody);
  } catch {
    parsed = null;
  }

  const errObj = parsed?.error || parsed || {};
  const statusStr = String(errObj.status || '');
  const messageStr = String(errObj.message || textBody || '');
  const details = Array.isArray(errObj.details) ? errObj.details : [];

  let retryDelayMs = null;
  let quotaMetricText = '';

  for (const d of details) {
    if (!d || typeof d !== 'object') continue;
    if (d.retryDelay) {
      const parsedDelay = parseDurationToMs(d.retryDelay);
      if (parsedDelay) retryDelayMs = parsedDelay;
    }
    if (Array.isArray(d.violations)) {
      for (const v of d.violations) {
        quotaMetricText += ` ${v?.quotaMetric || ''} ${v?.quotaId || ''} ${JSON.stringify(v?.quotaDimensions || {})}`;
      }
    }
  }

  if (!retryDelayMs) {
    const inlineMatch = messageStr.match(/retry\s+in\s+([0-9]+(?:\.[0-9]+)?(?:ms|h|m|s)(?:[0-9]+(?:\.[0-9]+)?(?:ms|h|m|s))*)/i);
    if (inlineMatch) {
      retryDelayMs = parseDurationToMs(inlineMatch[1]);
    }
  }

  if (!retryDelayMs && retryAfterHeader != null && String(retryAfterHeader).trim() !== '') {
    const headerStr = String(retryAfterHeader).trim();
    const numericSec = Number(headerStr);
    if (Number.isFinite(numericSec) && numericSec > 0) {
      retryDelayMs = Math.round(numericSec * 1000);
    } else {
      const dateMs = Date.parse(headerStr);
      if (Number.isFinite(dateMs) && dateMs > Date.now()) {
        retryDelayMs = dateMs - Date.now();
      }
    }
  }

  const combinedText = `${statusStr} ${messageStr} ${quotaMetricText}`;
  const hasResourceExhausted = /RESOURCE_EXHAUSTED/i.test(combinedText);
  const hasPerDayMetric = /(?:per\s+day|requests\s*per\s*day|RequestsPerDay|free_tier_requests|generate_content_free_tier_requests|daily\s+quota|daily\s+limit)/i.test(combinedText);
  const longDelay = Number.isFinite(retryDelayMs) && retryDelayMs > 60_000;
  const isDailyQuota = (hasResourceExhausted && hasPerDayMetric) || hasPerDayMetric || longDelay;

  return {
    isDailyQuota,
    retryAfterMs: retryDelayMs,
    statusStr: statusStr || null,
    summary: messageStr.slice(0, 400)
  };
}

async function buildHttpErrorFromResponse(res, fallbackPrefix) {
  const retryAfterHeader = res?.headers?.get?.('retry-after') ?? null;
  let rawBody = '';
  try {
    if (typeof res?.text === 'function') {
      rawBody = await res.text();
    } else {
      await res?.body?.cancel?.().catch(() => {});
    }
  } catch {
    rawBody = '';
  }

  if (res.status === 429) {
    const info = parseGemini429Details(rawBody, retryAfterHeader);
    if (info.isDailyQuota) {
      const err = new Error(`QUOTA_EXHAUSTED: ${info.summary || 'Gemini daily quota exhausted (HTTP 429).'}`);
      err.status = 429;
      err.transient = false;
      err.quotaExhausted = true;
      err.retryAfterMs = info.retryAfterMs || 3600_000;
      err.code = 'QUOTA_EXHAUSTED';
      return err;
    }
    const err = new Error(`${fallbackPrefix} returned HTTP 429.${info.summary ? ` ${info.summary}` : ''}`);
    err.status = 429;
    err.transient = true;
    err.retryAfterMs = info.retryAfterMs;
    err.code = fallbackPrefix.includes('File API') ? 'GEMINI_FILE_HTTP_429' : 'VISION_HTTP_429';
    return err;
  }

  if (res.status === 401 || res.status === 403) {
    const err = new Error(`VISION_CONFIG_ERROR: Gemini API key rejected with HTTP ${res.status}. Check GEMINI_API_KEY.`);
    err.status = res.status;
    err.code = 'VISION_CONFIG_ERROR';
    err.configSetting = 'GEMINI_API_KEY';
    err.transient = false;
    err.configError = true;
    return err;
  }

  if (res.status === 404) {
    const err = new Error('VISION_CONFIG_ERROR: Vision model not found with HTTP 404. Check DOC_VISION_MODEL.');
    err.status = 404;
    err.code = 'VISION_CONFIG_ERROR';
    err.configSetting = 'DOC_VISION_MODEL';
    err.transient = false;
    err.configError = true;
    return err;
  }

  if (res.status === 400 && /model/i.test(rawBody)) {
    const err = new Error(`VISION_CONFIG_ERROR: Invalid model specified with HTTP 400. Check DOC_VISION_MODEL: ${rawBody.slice(0, 200)}`);
    err.status = 400;
    err.code = 'VISION_CONFIG_ERROR';
    err.configSetting = 'DOC_VISION_MODEL';
    err.transient = false;
    err.configError = true;
    return err;
  }

  const err = new Error(`${fallbackPrefix} failed with HTTP ${res.status}.`);
  err.status = res.status;
  err.transient = isTransientHttpStatus(res.status);
  const headerDelay = retryAfterHeader ? parseDurationToMs(retryAfterHeader) : null;
  err.retryAfterMs = headerDelay;
  err.code = `${fallbackPrefix.includes('File API') ? 'GEMINI_FILE_HTTP' : 'VISION_HTTP'}_${res.status}`;
  return err;
}

function buildVisionPrompt({ pageNo, totalPages, pageTypeHint, rawTextHint = '' }) {
  const hintBlock = rawTextHint && rawTextHint.trim().length > 0
    ? `\nReference partial text layer extracted from this page (may contain broken glyphs or mojibake — verify visually):\n"""\n${rawTextHint.slice(0, 1500)}\n"""\n`
    : '';

  return [
    `You are a strict academic document digitizer reading ONLY the attached single-page PDF slice (originally Page ${pageNo} of ${totalPages}, hint: ${pageTypeHint || 'mixed'}).`,
    'Return ONLY valid JSON matching this exact schema:',
    '{',
    '  "text": string,',
    '  "latex_present": boolean,',
    '  "figure_description": string | null,',
    '  "ocr_confidence": number,',
    '  "detected_type": "text" | "scanned" | "math" | "figure" | "table" | "nepali_repair"',
    '}',
    'Rules:',
    '1. Transcribe ONLY what is printed on page accurately in logical reading order.',
    '2. Do NOT add translations, glosses, explanations, or missing words.',
    '3. Copy proper names exactly as printed.',
    '4. Mark unreadable parts as [illegible].',
    '5. Ignore faint background watermarks and logos unless they carry content.',
    '6. Write formulas as LaTeX ($...$ inline or $$...$$ display) and set "latex_present": true.',
    '7. Write tables as Markdown tables (| Col | ... |).',
    '8. If the page has diagrams, flowcharts, circuits, graphs, or figures, summarize them concisely in "figure_description"; otherwise set null.',
    '9. Set "ocr_confidence" between 0.0 and 1.0 reflecting legibility.',
    '10. Do NOT invent content or wrap JSON in prose.',
    hintBlock
  ].join('\n');
}

function buildSliceVisionPrompt({ sliceItems, totalSourcePages }) {
  if (!Array.isArray(sliceItems) || sliceItems.length === 0) {
    throw new Error('sliceItems must be a non-empty array.');
  }
  if (sliceItems.length === 1) {
    const item = sliceItems[0];
    return buildVisionPrompt({
      pageNo: item.pageNo,
      totalPages: totalSourcePages,
      pageTypeHint: item.pageTypeHint,
      rawTextHint: item.rawTextHint
    });
  }

  const pageGuide = sliceItems.map((item, idx) => {
    const hint = item.rawTextHint && item.rawTextHint.trim().length > 0
      ? ` | partial text hint: ${JSON.stringify(item.rawTextHint.slice(0, 600))}`
      : '';
    return `- Slice Page ${idx + 1} (original Page ${item.pageNo} of ${totalSourcePages}, hint: ${item.pageTypeHint || 'mixed'})${hint}`;
  }).join('\n');

  return [
    `You are a strict academic document digitizer reading an attached ${sliceItems.length}-page PDF slice.`,
    `Return ONLY valid JSON matching this exact schema with EXACTLY ${sliceItems.length} items in "pages", strictly ordered from Slice Page 1 to Slice Page ${sliceItems.length}:`,
    '{',
    '  "pages": [',
    '    {',
    '      "text": string,',
    '      "latex_present": boolean,',
    '      "figure_description": string | null,',
    '      "ocr_confidence": number,',
    '      "detected_type": "text" | "scanned" | "math" | "figure" | "table" | "nepali_repair"',
    '    }',
    '  ]',
    '}',
    'Slice pages:',
    pageGuide,
    'Rules:',
    `1. Output MUST contain exactly ${sliceItems.length} elements in "pages" in exact slice order (index 0 = Slice Page 1, etc.).`,
    '2. Transcribe ONLY what is printed on page accurately in logical reading order.',
    '3. Do NOT add translations, glosses, explanations, or missing words.',
    '4. Copy proper names exactly as printed.',
    '5. Mark unreadable parts as [illegible].',
    '6. Ignore faint background watermarks and logos unless they carry content.',
    '7. Write formulas as LaTeX ($...$ inline or $$...$$ display) and set "latex_present": true.',
    '8. Write tables as Markdown tables (| Col | ... |).',
    '9. If the page has diagrams, flowcharts, circuits, graphs, or figures, summarize them concisely in "figure_description"; otherwise set null.',
    '10. Set "ocr_confidence" between 0.0 and 1.0 reflecting legibility.',
    '11. Do NOT invent content or wrap JSON in prose.'
  ].join('\n');
}

function stripJsonFence(rawContent) {
  let cleaned = String(rawContent || '').trim();
  if (!cleaned) {
    const err = new Error('Vision model returned empty output.');
    err.transient = true;
    err.code = 'VISION_EMPTY_RESPONSE';
    throw err;
  }
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  return cleaned;
}

function parseJsonObjectStrict(rawContent) {
  const cleaned = stripJsonFence(rawContent);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (parseErr) {
    const err = new Error(`Vision model returned malformed JSON: ${parseErr.message}`);
    err.transient = true;
    err.code = 'VISION_INVALID_JSON';
    throw err;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const err = new Error('Vision JSON payload must be an object.');
    err.transient = true;
    err.code = 'VISION_INVALID_SCHEMA';
    throw err;
  }
  return parsed;
}

function normalizeVisionPageItem(parsed, fallbackPageType = 'scanned') {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const err = new Error('Vision page entry must be an object.');
    err.transient = true;
    err.code = 'VISION_INVALID_SCHEMA';
    throw err;
  }

  const allowedTypes = new Set(['text', 'scanned', 'math', 'figure', 'table', 'nepali_repair']);
  const detectedType = allowedTypes.has(parsed.detected_type) ? parsed.detected_type : fallbackPageType;
  const confRaw = Number(parsed.ocr_confidence);
  const ocrConfidence = Number.isFinite(confRaw) ? Math.max(0, Math.min(1, confRaw)) : 0.8;
  const text = typeof parsed.text === 'string' ? parsed.text.replace(/\0/g, '').trim() : '';
  const figureDescription = typeof parsed.figure_description === 'string' && parsed.figure_description.trim()
    ? parsed.figure_description.replace(/\0/g, '').trim()
    : null;
  const latexPresent = Boolean(
    parsed.latex_present ||
    detectedType === 'math' ||
    /\$\$[\s\S]+?\$\$|\$[^\s$][^$\n]*?\$/.test(text)
  );

  return {
    text,
    latexPresent,
    figureDescription,
    ocrConfidence,
    detectedType
  };
}

function parseVisionJsonResponse(rawContent, fallbackPageType = 'scanned') {
  const parsed = parseJsonObjectStrict(rawContent);
  return normalizeVisionPageItem(parsed, fallbackPageType);
}

function parseVisionSliceJsonResponse(rawContent, sliceItems) {
  const parsed = parseJsonObjectStrict(rawContent);
  if (sliceItems.length === 1 && !Array.isArray(parsed.pages)) {
    return [{
      ...normalizeVisionPageItem(parsed, sliceItems[0].pageTypeHint || 'scanned'),
      pageNo: sliceItems[0].pageNo
    }];
  }
  if (!Array.isArray(parsed.pages) || parsed.pages.length !== sliceItems.length) {
    const got = Array.isArray(parsed.pages) ? parsed.pages.length : 'none';
    const err = new Error(`Vision slice returned ${got} page(s), expected ${sliceItems.length}.`);
    err.transient = true;
    err.code = 'VISION_BATCH_COUNT_MISMATCH';
    throw err;
  }
  return sliceItems.map((item, idx) => ({
    ...normalizeVisionPageItem(parsed.pages[idx], item.pageTypeHint || 'scanned'),
    pageNo: item.pageNo
  }));
}

function extractUsageMetadata(data) {
  const meta = data?.usageMetadata || {};
  const inputTokens = Math.max(0, Number(meta.promptTokenCount) || 0);
  const candidatesTokens = Number(meta.candidatesTokenCount);
  const totalTokens = Number(meta.totalTokenCount);
  const outputTokens = Number.isFinite(candidatesTokens) && candidatesTokens >= 0
    ? candidatesTokens
    : (Number.isFinite(totalTokens) && totalTokens > inputTokens ? totalTokens - inputTokens : 0);
  return {
    inputTokens: Math.max(0, Math.trunc(inputTokens)),
    outputTokens: Math.max(0, Math.trunc(outputTokens))
  };
}

/**
 * Uploads a PDF buffer once per job via Gemini Files API when too large for inline base64.
 */
async function uploadPdfToGeminiFileApi(pdfBuffer, {
  displayName = 'document.pdf',
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_PAGE_TIMEOUT_MS
} = {}) {
  const url = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/pdf',
      'X-Goog-Upload-Protocol': 'raw',
      'X-Goog-Upload-File-Name': displayName
    },
    body: pdfBuffer,
    signal: AbortSignal.timeout(Math.max(timeoutMs, 30000))
  });

  if (!res.ok) {
    throw await buildHttpErrorFromResponse(res, 'Gemini File API upload');
  }

  const json = await res.json();
  const fileUri = json?.file?.uri || json?.uri;
  if (!fileUri) {
    const err = new Error('Gemini File API response did not include file.uri.');
    err.transient = true;
    err.code = 'GEMINI_FILE_URI_MISSING';
    throw err;
  }
  return fileUri;
}

/**
 * Renders a PDF slice buffer to one or more JPEG images using poppler pdftoppm (~130 dpi).
 * Returns array of JPEG Buffers, or null if rendering fails or poppler is unavailable.
 */
async function renderPdfSliceToJpeg(slicePdfBuffer, {
  dpi = 130,
  timeoutMs = 15000,
  execFileFn = execFileAsync
} = {}) {
  if (!slicePdfBuffer || slicePdfBuffer.length === 0) return null;
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kyana-slice-ppm-'));
  const inputPdfPath = path.join(tmpDir, 'slice.pdf');
  const outputPrefix = path.join(tmpDir, 'page');
  try {
    await fs.promises.writeFile(inputPdfPath, slicePdfBuffer);
    await execFileFn('pdftoppm', ['-jpeg', '-r', String(dpi), inputPdfPath, outputPrefix], {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024
    });
    const entries = await fs.promises.readdir(tmpDir);
    const jpgFiles = entries
      .filter(f => f.startsWith('page') && (f.endsWith('.jpg') || f.endsWith('.jpeg')))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (jpgFiles.length === 0) {
      return null;
    }
    const buffers = [];
    for (const jf of jpgFiles) {
      buffers.push(await fs.promises.readFile(path.join(tmpDir, jf)));
    }
    return buffers;
  } catch (err) {
    return null;
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function invokeGenerateContent({
  mediaPart,
  mediaParts,
  prompt,
  maxOutputTokens = 4096,
  fetchImpl = globalThis.fetch,
  model,
  apiKey,
  timeoutMs = DEFAULT_PAGE_TIMEOUT_MS,
  signal
}) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const parts = Array.isArray(mediaParts) && mediaParts.length > 0
    ? [...mediaParts, { text: prompt }]
    : [mediaPart, { text: prompt }];

  let res;
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens,
          responseMimeType: 'application/json'
        }
      }),
      signal: combinedSignal
    });
  } catch (networkErr) {
    const isAbort = networkErr?.name === 'TimeoutError' || networkErr?.name === 'AbortError' || /timeout|aborted/i.test(networkErr?.message || '');
    const err = new Error(isAbort ? `Vision request timed out after ${timeoutMs}ms` : `Vision network error: ${networkErr.message}`);
    err.transient = true;
    err.code = isAbort ? 'VISION_TIMEOUT' : 'VISION_NETWORK_ERROR';
    throw err;
  }

  if (!res.ok) {
    throw await buildHttpErrorFromResponse(res, 'Vision API');
  }

  const data = await res.json();
  const blockReason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
  const candidateText = data?.candidates?.[0]?.content?.parts
    ?.map(p => (typeof p?.text === 'string' ? p.text : ''))
    .join('\n')
    .trim();

  if (!candidateText) {
    const isSafety = /SAFETY|RECITATION|PROHIBITED/i.test(String(blockReason || ''));
    const err = new Error(`Vision API returned no text (finishReason=${blockReason || 'unknown'}).`);
    err.transient = !isSafety;
    err.code = isSafety ? 'VISION_SAFETY_BLOCKED' : 'VISION_EMPTY_CANDIDATE';
    throw err;
  }

  return { candidateText, usage: extractUsageMetadata(data) };
}

/**
 * Calls Gemini Vision once for a pre-sliced PDF buffer containing 1..3 consecutive pages.
 * If the slice exceeds 1.5 MB, attempts to render to JPEG (~130 dpi via pdftoppm) and sends
 * the image instead of the PDF slice, falling back cleanly to the PDF slice if rendering fails.
 */
async function extractPageSliceWithVision({
  slicePdfBuffer,
  sliceItems,
  totalSourcePages = 1,
  fetchImpl = globalThis.fetch,
  env = process.env,
  model: modelOverride,
  apiKey: apiKeyOverride,
  timeoutMs = DEFAULT_PAGE_TIMEOUT_MS,
  inlineMaxBytes = Number(env?.DOC_INLINE_PDF_MAX_BYTES) || DEFAULT_INLINE_PDF_MAX_BYTES,
  renderSliceToJpegFn,
  signal
} = {}) {
  const model = resolveVisionModel({ model: modelOverride }, env);
  const apiKey = resolveApiKey({ apiKey: apiKeyOverride }, env);

  if (!slicePdfBuffer || slicePdfBuffer.length === 0) {
    const err = new Error('slicePdfBuffer is required for vision slice extraction.');
    err.transient = false;
    err.code = 'VISION_NO_MEDIA';
    throw err;
  }

  // Requirement 9: For vision pages whose slice is over 1.5 MB, render to JPEG (~130 dpi)
  // and send the image instead of the PDF slice; fall back to the slice if rendering fails.
  const thresholdBytes = Number(env?.DOC_SLICE_RENDER_THRESHOLD_BYTES) || SLICE_IMAGE_RENDER_THRESHOLD_BYTES;
  let renderedJpegs = null;
  if (slicePdfBuffer.length > thresholdBytes) {
    try {
      const renderFn = renderSliceToJpegFn || renderPdfSliceToJpeg;
      renderedJpegs = await renderFn(slicePdfBuffer, { dpi: 130, timeoutMs: Math.min(timeoutMs, 20000) });
    } catch {
      renderedJpegs = null;
    }
  }

  let mediaParts = null;
  let mediaPart = null;

  if (Array.isArray(renderedJpegs) && renderedJpegs.length > 0) {
    mediaParts = renderedJpegs.map(buf => ({
      inlineData: {
        mimeType: 'image/jpeg',
        data: Buffer.from(buf).toString('base64')
      }
    }));
  } else {
    // Standard PDF slice or fallback if rendering failed
    if (slicePdfBuffer.length > inlineMaxBytes) {
      const fileUri = await uploadPdfToGeminiFileApi(slicePdfBuffer, {
        displayName: `slice-p${sliceItems[0].pageNo}-p${sliceItems[sliceItems.length - 1].pageNo}.pdf`,
        apiKey,
        fetchImpl,
        timeoutMs
      });
      mediaPart = { fileData: { mimeType: 'application/pdf', fileUri } };
    } else {
      mediaPart = { inlineData: { mimeType: 'application/pdf', data: Buffer.from(slicePdfBuffer).toString('base64') } };
    }
  }

  const prompt = buildSliceVisionPrompt({ sliceItems, totalSourcePages });
  const maxOutputTokens = sliceItems.length > 1 ? Math.min(8192, 4096 * sliceItems.length) : 4096;
  const { candidateText, usage } = await invokeGenerateContent({
    mediaPart,
    mediaParts,
    prompt,
    maxOutputTokens,
    fetchImpl,
    model,
    apiKey,
    timeoutMs,
    signal
  });
  const pages = parseVisionSliceJsonResponse(candidateText, sliceItems);
  return { pages, usage, renderedAsImage: Boolean(mediaParts) };
}

/**
 * Extracts text, LaTeX, Markdown tables, and figure description for a single pre-sliced or single PDF page via Gemini Vision.
 */
async function extractPageWithVision({
  pdfBuffer,
  fileUri = null,
  pageNo,
  totalPages = 1,
  pageTypeHint = 'scanned',
  rawTextHint = '',
  fetchImpl = globalThis.fetch,
  env = process.env,
  model: modelOverride,
  apiKey: apiKeyOverride,
  timeoutMs = DEFAULT_PAGE_TIMEOUT_MS,
  inlineMaxBytes = Number(env?.DOC_INLINE_PDF_MAX_BYTES) || DEFAULT_INLINE_PDF_MAX_BYTES,
  renderSliceToJpegFn,
  signal
} = {}) {
  if (!fileUri) {
    const { pages, usage } = await extractPageSliceWithVision({
      slicePdfBuffer: pdfBuffer,
      sliceItems: [{ pageNo, pageTypeHint, rawTextHint }],
      totalSourcePages: totalPages,
      fetchImpl,
      env,
      model: modelOverride,
      apiKey: apiKeyOverride,
      timeoutMs,
      inlineMaxBytes,
      renderSliceToJpegFn,
      signal
    });
    return { ...pages[0], usage };
  }

  const model = resolveVisionModel({ model: modelOverride }, env);
  const apiKey = resolveApiKey({ apiKey: apiKeyOverride }, env);
  const prompt = buildVisionPrompt({ pageNo, totalPages, pageTypeHint, rawTextHint });
  const { candidateText, usage } = await invokeGenerateContent({
    mediaPart: { fileData: { mimeType: 'application/pdf', fileUri } },
    prompt,
    maxOutputTokens: 4096,
    fetchImpl,
    model,
    apiKey,
    timeoutMs,
    signal
  });
  return { ...parseVisionJsonResponse(candidateText, pageTypeHint), usage };
}

/**
 * Extracts text, LaTeX, Markdown tables, and figure description from a standalone image file (JPEG, PNG, WebP)
 * for Task 2 (image reading, opt-in via DOC_READ_IMAGES=true).
 */
async function extractImageWithVision({
  imageBuffer,
  mimeType = 'image/jpeg',
  fileName = '',
  fetchImpl = globalThis.fetch,
  env = process.env,
  model: modelOverride,
  apiKey: apiKeyOverride,
  timeoutMs = DEFAULT_PAGE_TIMEOUT_MS,
  signal
} = {}) {
  const model = resolveVisionModel({ model: modelOverride }, env);
  const apiKey = resolveApiKey({ apiKey: apiKeyOverride }, env);

  if (!imageBuffer || imageBuffer.length === 0) {
    const err = new Error('imageBuffer is required for image vision extraction.');
    err.transient = false;
    err.code = 'VISION_NO_MEDIA';
    throw err;
  }

  const mediaPart = {
    inlineData: {
      mimeType: mimeType || 'image/jpeg',
      data: Buffer.from(imageBuffer).toString('base64')
    }
  };

  const prompt = buildVisionPrompt({
    pageNo: 1,
    totalPages: 1,
    pageTypeHint: 'figure',
    rawTextHint: fileName
  });

  const { candidateText, usage } = await invokeGenerateContent({
    mediaPart,
    prompt,
    maxOutputTokens: 4096,
    fetchImpl,
    model,
    apiKey,
    timeoutMs,
    signal
  });

  const page = parseVisionJsonResponse(candidateText, 'figure');
  return { ...page, pageNo: 1, usage };
}

module.exports = {
  DEFAULT_PAGE_TIMEOUT_MS,
  DEFAULT_INLINE_PDF_MAX_BYTES,
  SLICE_IMAGE_RENDER_THRESHOLD_BYTES,
  MAX_VISION_BATCH_PAGES,
  resolveVisionModel,
  resolveApiKey,
  resolveVisionBatchPages,
  classifyPdfLibError,
  loadPdfForSlicing,
  buildPdfSlice,
  buildVisionPrompt,
  buildSliceVisionPrompt,
  parseVisionJsonResponse,
  parseVisionSliceJsonResponse,
  extractUsageMetadata,
  parseDurationToMs,
  parseGemini429Details,
  uploadPdfToGeminiFileApi,
  renderPdfSliceToJpeg,
  extractPageSliceWithVision,
  extractPageWithVision,
  extractImageWithVision,
  calculateVisionTimeoutMs,
  DEFAULT_TIMEOUT_BASE_MS,
  DEFAULT_TIMEOUT_PER_MB_MS,
  DEFAULT_TIMEOUT_MAX_MS
};

