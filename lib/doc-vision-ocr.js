'use strict';

const { PDFDocument } = require('pdf-lib');

const DEFAULT_PAGE_TIMEOUT_MS = Number(process.env.DOC_PAGE_TIMEOUT_MS) || 25000;
const DEFAULT_INLINE_PDF_MAX_BYTES = Number(process.env.DOC_INLINE_PDF_MAX_BYTES) || (4 * 1024 * 1024);
const MAX_VISION_BATCH_PAGES = 3;

function resolveVisionBatchPages(options = {}, env = process.env) {
  const raw = options.visionBatchPages ?? env.DOC_VISION_BATCH_PAGES ?? 1;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(MAX_VISION_BATCH_PAGES, parsed);
}

/**
 * Builds a small single- or multi-page PDF buffer containing only the target
 * 1-based physical pages from an already-loaded pdf-lib PDFDocument.
 */
async function buildPdfSlice(srcPdfDoc, oneBasedPageNos) {
  if (!srcPdfDoc || typeof srcPdfDoc.copyPages !== 'function') {
    throw new Error('srcPdfDoc (pdf-lib PDFDocument) is required for buildPdfSlice.');
  }
  const indices = (oneBasedPageNos || []).map(p => p - 1);
  if (indices.length === 0) {
    throw new Error('At least one page number is required for buildPdfSlice.');
  }
  const sliceDoc = await PDFDocument.create();
  const copied = await sliceDoc.copyPages(srcPdfDoc, indices);
  for (const page of copied) {
    sliceDoc.addPage(page);
  }
  const bytes = await sliceDoc.save();
  return Buffer.from(bytes);
}

function resolveVisionModel(options = {}, env = process.env) {
  const model = options.model || env.DOC_VISION_MODEL || env.GEMINI_VISION_MODEL || env.GEMINI_MODEL;
  if (!model || !String(model).trim()) {
    const err = new Error('DOC_VISION_MODEL (or GEMINI_VISION_MODEL / GEMINI_MODEL) environment variable is required for vision OCR.');
    err.transient = false;
    err.code = 'VISION_MODEL_UNCONFIGURED';
    throw err;
  }
  return String(model).trim();
}

function resolveApiKey(options = {}, env = process.env) {
  const apiKey = options.apiKey || env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    const err = new Error('GEMINI_API_KEY (or GOOGLE_API_KEY) environment variable is required for vision OCR.');
    err.transient = false;
    err.code = 'VISION_API_KEY_MISSING';
    throw err;
  }
  return String(apiKey).trim();
}

function isTransientHttpStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
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
    '  "detected_type": "text" | "scanned" | "math" | "figure" | "table"',
    '}',
    'Rules:',
    '1. Extract ALL readable content from the attached page accurately in logical reading order.',
    '2. Preserve Nepali/Devanagari script cleanly in UTF-8 Unicode (never output Romanized placeholders or mojibake).',
    '3. Render mathematical formulas, equations, symbols, and derivations using LaTeX ($...$ inline or $$...$$ display) and set "latex_present": true.',
    '4. Render tabular data using GitHub-flavored Markdown tables (| Col | ... |).',
    '5. If the page has diagrams, flowcharts, circuits, graphs, or figures, summarize them concisely in "figure_description"; otherwise set null.',
    '6. Set "ocr_confidence" between 0.0 and 1.0 reflecting legibility (mark unreadable handwriting spans explicitly as [illegible]).',
    '7. Do NOT invent content or wrap JSON in prose.',
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
    '      "detected_type": "text" | "scanned" | "math" | "figure" | "table"',
    '    }',
    '  ]',
    '}',
    'Slice pages:',
    pageGuide,
    'Rules:',
    `1. Output MUST contain exactly ${sliceItems.length} elements in "pages" in exact slice order (index 0 = Slice Page 1, etc.).`,
    '2. Preserve Nepali/Devanagari script cleanly in UTF-8 Unicode (never output Romanized placeholders or mojibake).',
    '3. Render mathematical formulas/equations in LaTeX ($...$ inline or $$...$$ display) and set "latex_present": true.',
    '4. Render tabular data using GitHub-flavored Markdown tables (| Col | ... |).',
    '5. Summarize diagrams/charts/figures concisely in "figure_description", otherwise null.',
    '6. Set "ocr_confidence" between 0.0 and 1.0 (mark unreadable spans explicitly as [illegible]).'
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

  const allowedTypes = new Set(['text', 'scanned', 'math', 'figure', 'table']);
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
    const err = new Error(`Gemini File API upload failed with HTTP ${res.status}.`);
    err.transient = isTransientHttpStatus(res.status);
    err.status = res.status;
    err.code = `GEMINI_FILE_HTTP_${res.status}`;
    throw err;
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

async function invokeGenerateContent({
  mediaPart,
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

  let res;
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [mediaPart, { text: prompt }] }],
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
    const retryAfterSec = Number(res.headers?.get?.('retry-after'));
    await res.body?.cancel?.().catch(() => {});
    const err = new Error(`Vision API returned HTTP ${res.status}.`);
    err.status = res.status;
    err.transient = isTransientHttpStatus(res.status);
    err.retryAfterMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : null;
    err.code = `VISION_HTTP_${res.status}`;
    throw err;
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
 * Sends inline base64 unless the single slice itself exceeds inlineMaxBytes.
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

  let mediaPart;
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

  const prompt = buildSliceVisionPrompt({ sliceItems, totalSourcePages });
  const maxOutputTokens = sliceItems.length > 1 ? Math.min(8192, 4096 * sliceItems.length) : 4096;
  const { candidateText, usage } = await invokeGenerateContent({
    mediaPart,
    prompt,
    maxOutputTokens,
    fetchImpl,
    model,
    apiKey,
    timeoutMs,
    signal
  });
  const pages = parseVisionSliceJsonResponse(candidateText, sliceItems);
  return { pages, usage };
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

module.exports = {
  DEFAULT_PAGE_TIMEOUT_MS,
  DEFAULT_INLINE_PDF_MAX_BYTES,
  MAX_VISION_BATCH_PAGES,
  resolveVisionModel,
  resolveApiKey,
  resolveVisionBatchPages,
  buildPdfSlice,
  buildVisionPrompt,
  buildSliceVisionPrompt,
  parseVisionJsonResponse,
  parseVisionSliceJsonResponse,
  extractUsageMetadata,
  uploadPdfToGeminiFileApi,
  extractPageSliceWithVision,
  extractPageWithVision
};

