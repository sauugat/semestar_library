'use strict';

const DEFAULT_PAGE_TIMEOUT_MS = Number(process.env.DOC_PAGE_TIMEOUT_MS) || 25000;
const DEFAULT_INLINE_PDF_MAX_BYTES = Number(process.env.DOC_INLINE_PDF_MAX_BYTES) || (4 * 1024 * 1024);

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
    `You are a strict academic document digitizer reading ONLY Page ${pageNo} of ${totalPages} (hint: ${pageTypeHint || 'mixed'}).`,
    'Return ONLY valid JSON matching this exact schema:',
    '{',
    '  "text": string,',
    '  "latex_present": boolean,',
    '  "figure_description": string | null,',
    '  "ocr_confidence": number,',
    '  "detected_type": "text" | "scanned" | "math" | "figure" | "table"',
    '}',
    'Rules:',
    '1. Extract ALL readable content from Page ' + pageNo + ' accurately in logical reading order.',
    '2. Preserve Nepali/Devanagari script cleanly in UTF-8 Unicode (never output Romanized placeholders or mojibake).',
    '3. Render mathematical formulas, equations, symbols, and derivations using LaTeX ($...$ inline or $$...$$ display) and set "latex_present": true.',
    '4. Render tabular data using GitHub-flavored Markdown tables (| Col | ... |).',
    '5. If the page has diagrams, flowcharts, circuits, graphs, or figures, summarize them concisely in "figure_description"; otherwise set null.',
    '6. Set "ocr_confidence" between 0.0 and 1.0 reflecting legibility (mark unreadable handwriting spans explicitly as [illegible]).',
    '7. Do NOT invent content from other pages or wrap JSON in prose.',
    hintBlock
  ].join('\n');
}

function parseVisionJsonResponse(rawContent, fallbackPageType = 'scanned') {
  let cleaned = String(rawContent || '').trim();
  if (!cleaned) {
    const err = new Error('Vision model returned empty output.');
    err.transient = true;
    err.code = 'VISION_EMPTY_RESPONSE';
    throw err;
  }

  // Strip optional markdown code fences
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

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

/**
 * Extracts text, LaTeX, Markdown tables, and figure description for a single PDF page via Gemini Vision.
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
  signal
} = {}) {
  const model = resolveVisionModel({ model: modelOverride }, env);
  const apiKey = resolveApiKey({ apiKey: apiKeyOverride }, env);

  if (!fileUri && (!pdfBuffer || pdfBuffer.length === 0)) {
    const err = new Error('Either pdfBuffer or fileUri is required for vision extraction.');
    err.transient = false;
    err.code = 'VISION_NO_MEDIA';
    throw err;
  }

  const mediaPart = fileUri
    ? { fileData: { mimeType: 'application/pdf', fileUri } }
    : { inlineData: { mimeType: 'application/pdf', data: Buffer.from(pdfBuffer).toString('base64') } };

  const prompt = buildVisionPrompt({ pageNo, totalPages, pageTypeHint, rawTextHint });
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
        contents: [
          {
            role: 'user',
            parts: [mediaPart, { text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
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

  return parseVisionJsonResponse(candidateText, pageTypeHint);
}

module.exports = {
  DEFAULT_PAGE_TIMEOUT_MS,
  DEFAULT_INLINE_PDF_MAX_BYTES,
  resolveVisionModel,
  resolveApiKey,
  buildVisionPrompt,
  parseVisionJsonResponse,
  uploadPdfToGeminiFileApi,
  extractPageWithVision
};

