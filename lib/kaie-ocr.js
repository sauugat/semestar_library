'use strict';

/**
 * KAIE Phase 1: Vision OCR & Diagram/Equation Extraction
 *
 * Uses Gemini 2.5 Flash (when GEMINI_API_KEY / GOOGLE_API_KEY is configured) or an
 * injectable visionProvider (for tests) to extract text, LaTeX equations, and
 * labeled diagrams from standalone images or scanned PDF pages.
 */

const DEFAULT_MODEL = process.env.KAIE_OCR_MODEL || 'gemini-2.5-flash';

let customVisionProvider = null;

function setVisionProvider(fn) {
  customVisionProvider = typeof fn === 'function' ? fn : null;
}

function getVisionApiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
}

function normalizeMimeType(extOrMime) {
  const value = String(extOrMime || '').toLowerCase().trim();
  if (value.startsWith('image/') || value === 'application/pdf') return value;
  if (value === '.png' || value === 'png') return 'image/png';
  if (value === '.jpg' || value === '.jpeg' || value === 'jpg' || value === 'jpeg') return 'image/jpeg';
  if (value === '.webp' || value === 'webp') return 'image/webp';
  if (value === '.pdf' || value === 'pdf') return 'application/pdf';
  return 'image/png';
}

function sanitizeArray(items, mapper) {
  if (!Array.isArray(items)) return [];
  return items
    .map(mapper)
    .filter(Boolean);
}

function normalizeOcrPayload(raw, fallbackConfidence = 0.85) {
  if (!raw || typeof raw !== 'object') return null;
  const text = String(raw.text || '').trim();
  const equations = sanitizeArray(raw.equations, (eq) => {
    if (!eq) return null;
    if (typeof eq === 'string') {
      const cleaned = eq.trim();
      return cleaned ? { latex: cleaned, description: '' } : null;
    }
    const latex = String(eq.latex || eq.formula || '').trim();
    const description = String(eq.description || eq.meaning || '').trim();
    if (!latex && !description) return null;
    return { latex, description };
  });

  const diagrams = sanitizeArray(raw.diagrams, (diag) => {
    if (!diag) return null;
    if (typeof diag === 'string') {
      const cleaned = diag.trim();
      return cleaned ? { title: 'Diagram', description: cleaned, labels: [] } : null;
    }
    const title = String(diag.title || diag.name || 'Diagram').trim();
    const description = String(diag.description || diag.summary || '').trim();
    const labels = Array.isArray(diag.labels)
      ? diag.labels.map((l) => String(l || '').trim()).filter(Boolean)
      : [];
    if (!description && labels.length === 0) return null;
    return { title, description, labels };
  });

  const confidenceNum = Number(raw.confidence);
  const confidence = Number.isFinite(confidenceNum)
    ? Math.max(0, Math.min(1, confidenceNum))
    : fallbackConfidence;

  if (!text && equations.length === 0 && diagrams.length === 0) {
    return null;
  }

  return {
    text,
    equations,
    diagrams,
    confidence
  };
}

function extractJsonObject(rawText) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced && fenced[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch (_) {}
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch (_) {}
    }
    return null;
  }
}

async function callGeminiVision(buffer, mimeType, context = {}) {
  const apiKey = getVisionApiKey();
  if (!apiKey || !buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return null;
  }

  const prompt = [
    'You are an academic OCR and technical diagram extraction engine for university study materials.',
    context.title ? `Document title: ${context.title}` : '',
    context.subject ? `Subject: ${context.subject}` : '',
    context.pageNumber ? `Page number: ${context.pageNumber}` : '',
    'Extract ALL readable text verbatim, convert mathematical/physics/CS equations into LaTeX, and describe any diagrams, flowcharts, circuit schematics, or tables with their labels.',
    'Respond strictly with a single JSON object matching this schema:',
    '{',
    '  "text": "full extracted readable text in reading order",',
    '  "equations": [{ "latex": "...", "description": "..." }],',
    '  "diagrams": [{ "title": "...", "description": "...", "labels": ["..."] }],',
    '  "confidence": 0.92',
    '}'
  ].filter(Boolean).join('\n');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(DEFAULT_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: normalizeMimeType(mimeType),
              data: buffer.toString('base64')
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json'
    }
  };

  const controller = new AbortController();
  const timeoutMs = Number(context.timeoutMs) > 0 ? Number(context.timeoutMs) : 25000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    const parts = payload?.candidates?.[0]?.content?.parts || [];
    const textOut = parts.map((p) => p?.text || '').join('\n').trim();
    const parsed = extractJsonObject(textOut);
    return normalizeOcrPayload(parsed, 0.88);
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function extractWithVision(buffer, options = {}) {
  const mimeType = normalizeMimeType(options.mimeType || options.ext || 'image/png');
  const provider = typeof options.visionProvider === 'function'
    ? options.visionProvider
    : customVisionProvider;

  if (provider) {
    try {
      const result = await provider(buffer, { ...options, mimeType });
      if (typeof result === 'string') {
        const cleaned = result.trim();
        return cleaned ? { text: cleaned, equations: [], diagrams: [], confidence: 0.8 } : null;
      }
      return normalizeOcrPayload(result, 0.85);
    } catch (_) {
      return null;
    }
  }

  return callGeminiVision(buffer, mimeType, options);
}

function formatOcrPageContent(ocrResult) {
  if (!ocrResult || typeof ocrResult !== 'object') return '';
  const sections = [];
  if (ocrResult.text) {
    sections.push(ocrResult.text.trim());
  }
  if (Array.isArray(ocrResult.equations) && ocrResult.equations.length > 0) {
    const eqLines = ocrResult.equations.map((eq) => {
      const latex = eq.latex ? `$${eq.latex}$` : '';
      const desc = eq.description ? ` (${eq.description})` : '';
      return `- ${latex}${desc}`.trim();
    });
    sections.push(`Equations:\n${eqLines.join('\n')}`);
  }
  if (Array.isArray(ocrResult.diagrams) && ocrResult.diagrams.length > 0) {
    const diagLines = ocrResult.diagrams.map((diag) => {
      const labels = Array.isArray(diag.labels) && diag.labels.length > 0
        ? ` [Labels: ${diag.labels.join(', ')}]`
        : '';
      return `- ${diag.title || 'Diagram'}: ${diag.description || ''}${labels}`.trim();
    });
    sections.push(`Diagrams:\n${diagLines.join('\n')}`);
  }
  return sections.filter(Boolean).join('\n\n').trim();
}

/**
 * Fallback OCR hook compatible with lib/document-ingestion.js `extractPdfDocument`.
 * Receives `{ buffer, pageNumber, rawText, file }` and returns `{ text, equations, diagrams, confidence }` or null.
 */
async function runOcrFallback(context = {}, options = {}) {
  const buffer = context.buffer || options.buffer;
  if (!buffer) return null;
  const result = await extractWithVision(buffer, {
    ...options,
    mimeType: options.mimeType || context.mimeType || 'application/pdf',
    pageNumber: context.pageNumber,
    title: context.file?.title || context.file?.originalName,
    subject: context.file?.subject
  });
  if (!result) return null;
  return {
    ...result,
    formattedText: formatOcrPageContent(result)
  };
}

module.exports = {
  setVisionProvider,
  extractWithVision,
  runOcrFallback,
  formatOcrPageContent,
  normalizeOcrPayload
};
