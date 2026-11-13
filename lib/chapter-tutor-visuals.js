'use strict';

/**
 * KAIE Chapter Tutor Visual Evidence Retriever (Phase 3 Stage 4 Step 2.2A.1)
 *
 * Responsibilities:
 * 1. Detect whether a student question genuinely benefits from visual evidence (supporting English & Romanized Nepali).
 * 2. Identify and score authorized standalone image materials using semantic topic overlap and explicit references.
 * 3. Enforce strict relevance: reject unrelated chapter images with no topic overlap.
 * 4. Safely resolve, validate (magic bytes & size limits), and deduplicate image buffers.
 * 5. Ensure visual evidence never exceeds provider boundaries (max 2 images, 5MB individual, 8MB combined).
 * 6. Handle missing, invalid, or oversized buffers gracefully without breaking Chapter Tutor responses.
 */

const path = require('path');
const { resolveDocumentBuffer } = require('./document-ingestion');

const MAX_IMAGE_COUNT = 2;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per image
const MAX_COMBINED_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB combined
const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const VISUAL_TRIGGER_REGEX = /\b(?:diagram|circuit|schematic|logic[\s-]gate|timing[\s-]diagram|block[\s-]diagram|flowchart|flow[\s-]chart|graph|plot|waveform|curve|bode[\s-]plot|architecture|pinout|pin[\s-]diagram|state[\s-]diagram|fsm|dfd|uml|erd|er[\s-]diagram|truth[\s-]table|k[\s-]?map|karnaugh|figure|fig|drawing|draw|sketch|photo|picture|image|chitra|tasbir|naksa|naksā)\b/i;

const EXPLICIT_PAGE_REGEX = /\b(?:page|panna|slide)\s*#?\s*(\d+)\b/i;
const EXPLICIT_FIGURE_REGEX = /\b(?:fig\.?|figure)\s*#?\s*(\d+[a-z]?)\b/i;

const NEPALI_VISUAL_REGEX = /\b(?:chitra|tasbir|naksa|naksā|photo)\s*(?:ma|bata|ko|dekhaunus|kasto|herera|bujhauna|bujhaunus)?\b/i;

const VISUAL_STOP_WORDS = new Set([
  'what', 'is', 'the', 'of', 'a', 'an', 'this', 'that', 'these', 'those',
  'from', 'with', 'show', 'tell', 'help', 'please', 'explain', 'describe',
  'teach', 'me', 'about', 'and', 'or', 'for', 'in', 'on', 'at', 'to', 'can',
  'you', 'give', 'how', 'does', 'work', 'are', 'have', 'has', 'had', 'here',
  'look', 'dekhaunus', 'huncha', 'gara', 'yo', 'ko', 'ma', 'bata', 'cha',
  'ho', 'herera', 'bujhaunus', 'bujhauna', 'kasto', 'page', 'pages', 'panna',
  'slide', 'slides', 'unit', 'units', 'chapter', 'chapters', 'note', 'notes'
]);

const VISUAL_FORMAT_TERMS = new Set([
  'diagram', 'circuit', 'schematic', 'flowchart', 'flow', 'chart', 'graph',
  'plot', 'waveform', 'curve', 'architecture', 'figure', 'fig', 'drawing',
  'draw', 'sketch', 'photo', 'picture', 'image', 'chitra', 'tasbir', 'naksa',
  'naksā', 'table', 'pinout'
]);

/**
 * Extracts substantive content terms, separated into format terms and topic terms.
 */
function stemTerm(w = '') {
  return String(w || '').toLowerCase().replace(/(?:ing|es|s)$/, '');
}

function extractTerms(text = '') {
  const words = String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .filter((w) => w.length >= 2 && !VISUAL_STOP_WORDS.has(w));

  const formatTerms = [];
  const topicTerms = [];

  for (const w of words) {
    if (VISUAL_FORMAT_TERMS.has(w)) {
      formatTerms.push(w);
    } else {
      // Pure numbers under 100 are locators (page/fig/unit indices), not substantive academic topic terms
      if (/^\d+$/.test(w) && Number.parseInt(w, 10) < 100) {
        continue;
      }
      topicTerms.push(w);
    }
  }

  return {
    allTerms: words,
    formatTerms: Array.from(new Set(formatTerms)),
    topicTerms: Array.from(new Set(topicTerms))
  };
}

/**
 * Validates image buffer integrity and inspects actual magic bytes.
 */
function detectImageMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4E &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0D &&
    buffer[5] === 0x0A &&
    buffer[6] === 0x1A &&
    buffer[7] === 0x0A
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xFF &&
    buffer[1] === 0xD8 &&
    buffer[2] === 0xFF
  ) {
    return 'image/jpeg';
  }

  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Detects whether a student question benefits from visual evidence.
 */
function detectVisualRelevance(query = '', presentationProfile = '') {
  const text = String(query || '').trim();
  if (!text) {
    return { isVisualRequest: false, explicitPage: null, explicitFigure: null, triggerTerm: null };
  }

  const pageMatch = text.match(EXPLICIT_PAGE_REGEX);
  const explicitPage = pageMatch ? Number.parseInt(pageMatch[1], 10) : null;

  const figMatch = text.match(EXPLICIT_FIGURE_REGEX);
  const explicitFigure = figMatch ? figMatch[1].toLowerCase() : null;

  const visualMatch = text.match(VISUAL_TRIGGER_REGEX) || text.match(NEPALI_VISUAL_REGEX);
  const isSimProfile = presentationProfile === 'interactive_simulation';

  const isVisualRequest = Boolean(visualMatch || explicitPage || explicitFigure || isSimProfile);
  const triggerTerm = visualMatch
    ? visualMatch[0].toLowerCase()
    : (explicitFigure ? `figure ${explicitFigure}` : (explicitPage ? `page ${explicitPage}` : null));

  return {
    isVisualRequest,
    explicitPage,
    explicitFigure,
    triggerTerm
  };
}

/**
 * Checks if a file record in the reader bundle is a standalone image material.
 */
function isImageMaterial(file = {}) {
  const readerType = String(file.readerType || '').toLowerCase();
  if (readerType === 'image') return true;

  const originalName = String(file.originalName || file.original_name || file.title || '').toLowerCase();
  const storedName = String(file.storedName || file.stored_name || '').toLowerCase();
  const ext = path.extname(originalName) || path.extname(storedName);
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return true;

  const mime = String(file.mimeType || file.mime_type || file.mimetype || '').toLowerCase();
  if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp') return true;

  return false;
}

/**
 * Checks if a file record in the reader bundle is a PDF document.
 */
function isPdfDocument(file = {}) {
  const readerType = String(file.readerType || '').toLowerCase();
  if (readerType === 'pdf') return true;

  const originalName = String(file.originalName || file.original_name || file.title || '').toLowerCase();
  const storedName = String(file.storedName || file.stored_name || '').toLowerCase();
  const ext = path.extname(originalName) || path.extname(storedName);
  if (ext === '.pdf') return true;

  const mime = String(file.mimeType || file.mime_type || file.mimetype || '').toLowerCase();
  if (mime === 'application/pdf') return true;

  return false;
}

/**
 * Scores the semantic relevance of an image material file to the student question.
 * Requires meaningful relevance: eliminates unconditional chapter note baselines.
 */
function scoreImageMaterial(file = {}, query = '', reasoning = {}, visualMeta = {}) {
  if (!visualMeta.isVisualRequest) return 0;

  const title = String(file.title || '').toLowerCase();
  const origName = String(file.originalName || file.original_name || '').toLowerCase();
  const storedName = String(file.storedName || file.stored_name || '').toLowerCase();
  const fileCombined = `${title} ${origName} ${storedName}`;

  const resolvedTopic = String(reasoning.resolvedTopicQuery || '').toLowerCase();
  const chTitle = String(reasoning.chapterTitle || file.chapter || '').toLowerCase();
  const qText = String(query || '').toLowerCase();

  const qParsed = extractTerms(qText);
  const topicParsed = extractTerms(resolvedTopic);
  const chParsed = extractTerms(chTitle);

  const targetTopicTerms = Array.from(new Set([...qParsed.topicTerms, ...topicParsed.topicTerms]));
  const targetFormatTerms = Array.from(new Set([...qParsed.formatTerms, ...topicParsed.formatTerms]));

  let score = 0;

  // 1. Explicit figure reference matching (e.g. "Figure 3", "Fig 2")
  if (visualMeta.explicitFigure) {
    const figNum = visualMeta.explicitFigure;
    const figPatterns = [
      `fig ${figNum}`, `fig. ${figNum}`, `figure ${figNum}`,
      `fig_${figNum}`, `figure_${figNum}`, `fig-${figNum}`,
      `fig${figNum}`, `figure${figNum}`
    ];
    if (figPatterns.some((fp) => fileCombined.includes(fp))) {
      score += 0.65;
    }
  }

  // 2. Explicit page reference matching (e.g. "page 12")
  if (visualMeta.explicitPage !== null) {
    const pageNo = Number(file.pageNumber ?? file.page_number ?? file.pageStart ?? file.page_start ?? (file.pages && file.pages[0]?.pageNumber) ?? 1);
    if (pageNo === visualMeta.explicitPage) {
      score += 0.40;
    }
  }

  // 3. Multi-word phrase or compound term match (e.g. "state diagram", "shift register", "full adder", "half subtractor", "osi diagram", "osi model", "xor gate")
  const words = qParsed.allTerms;
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    if (fileCombined.includes(bigram)) {
      score = Math.max(score, 0.55);
      break;
    }
  }

  // 4. Direct resolved topic match in title / filename
  if (resolvedTopic && resolvedTopic.length >= 3 && fileCombined.includes(resolvedTopic)) {
    score = Math.max(score, 0.60);
  }

  // 5. Discriminator and topic terms lexical match against title & filename
  const chStemmed = new Set([...chParsed.allTerms, ...chParsed.topicTerms].map(stemTerm));
  const discriminatorTerms = targetTopicTerms.filter((term) => !chStemmed.has(stemTerm(term)));

  if (targetTopicTerms.length > 0) {
    const matchingTopicHits = targetTopicTerms.filter((term) => fileCombined.includes(term));
    const matchingDiscriminatorHits = discriminatorTerms.filter((term) => fileCombined.includes(term));

    // If query has explicit discriminators (e.g. "xor" vs other gates in "logic gates" chapter),
    // a file with zero discriminator hits cannot pass as a match
    if (discriminatorTerms.length > 0 && matchingDiscriminatorHits.length === 0) {
      // No discriminator match
    } else if (matchingTopicHits.length >= 2) {
      score = Math.max(score, Math.min(0.70, 0.45 + matchingTopicHits.length * 0.12));
    } else if (matchingTopicHits.length === 1) {
      const term = matchingTopicHits[0];
      if (matchingDiscriminatorHits.length === 1) {
        score = Math.max(score, 0.50);
      } else if (discriminatorTerms.length === 0) {
        score = Math.max(score, term.length >= 3 ? 0.45 : 0.35);
      }
    }
  }

  // 6. Extracted items and OCR metadata match
  const extracted = Array.isArray(file.extractedItems) ? file.extractedItems : [];
  for (const it of extracted) {
    const itTitle = String(it.title || it.topic || '').toLowerCase();
    const itText = String(it.contentText || '').toLowerCase();
    const itCombined = `${itTitle} ${itText}`;

    if (resolvedTopic && resolvedTopic.length >= 3 && itCombined.includes(resolvedTopic)) {
      score = Math.max(score, 0.70);
    }
    if (targetTopicTerms.length > 0) {
      const matchingItTerms = targetTopicTerms.filter((term) => itCombined.includes(term));
      if (matchingItTerms.length >= 2) {
        score = Math.max(score, 0.65);
      } else if (matchingItTerms.length === 1 && score < 0.50) {
        score = Math.max(score, 0.50);
      }
    }
  }

  // 7. Format terms support bonus (only if there is already an explicit ref, chapter match, or topic hit)
  if (score > 0 && targetFormatTerms.length > 0) {
    const formatHits = targetFormatTerms.filter((term) => fileCombined.includes(term));
    if (formatHits.length > 0) {
      score += 0.10;
    }
  }

  // 8. General chapter visual request alignment:
  // ONLY if student asked a general visual question about the chapter (no specific subtopic named, and no explicit figure/page reference)
  // E.g., "Explain the diagram for this chapter" or "show the circuit in Unit 2"
  const isGeneralChapterVisualQuery =
    !visualMeta.explicitFigure &&
    visualMeta.explicitPage === null &&
    (qText.includes('this chapter') || qText.includes('this unit') || qText.includes('chapter diagram') || qText.includes('unit diagram') || targetTopicTerms.length === 0) &&
    targetTopicTerms.length === 0;

  if (isGeneralChapterVisualQuery && score < 0.45) {
    const chHits = chParsed.topicTerms.filter((term) => fileCombined.includes(term));
    if (chHits.length >= 1) {
      score = Math.max(score, 0.55);
    } else if (fileCombined.includes('circuit') && chTitle.includes('circuit')) {
      score = Math.max(score, 0.50);
    }
  }

  return Math.min(1.0, Number(score.toFixed(3)));
}

/**
 * Scores the visual relevance of a specific page within a chapter PDF document.
 */
function scorePdfPageVisual(file = {}, page = {}, query = '', reasoning = {}, visualMeta = {}) {
  if (!visualMeta.isVisualRequest) return 0;

  const pageNo = Number(page.pageNumber || page.page_no || 1);
  const pageText = String(page.text || '').toLowerCase();
  const figDesc = String(page.figureDescription || page.figure_description || '').toLowerCase();
  const pageCombined = `${pageText} ${figDesc}`;

  const resolvedTopic = String(reasoning.resolvedTopicQuery || '').toLowerCase();
  const chTitle = String(reasoning.chapterTitle || file.chapter || '').toLowerCase();
  const qText = String(query || '').toLowerCase();

  const qParsed = extractTerms(qText);
  const topicParsed = extractTerms(resolvedTopic);
  const chParsed = extractTerms(chTitle);

  const targetTopicTerms = Array.from(new Set([...qParsed.topicTerms, ...topicParsed.topicTerms]));
  const targetFormatTerms = Array.from(new Set([...qParsed.formatTerms, ...topicParsed.formatTerms]));

  let score = 0;

  // 1. Explicit page reference matching (e.g. "page 12")
  if (visualMeta.explicitPage !== null) {
    if (pageNo === visualMeta.explicitPage) {
      score += 0.40;
    } else {
      // When student asks for an explicit page, other pages of the same PDF do not match
      return 0;
    }
  }

  // 2. Explicit figure reference matching (e.g. "Figure 3", "Fig 2")
  if (visualMeta.explicitFigure) {
    const figNum = visualMeta.explicitFigure;
    const figPatterns = [
      `fig ${figNum}`, `fig. ${figNum}`, `figure ${figNum}`,
      `fig_${figNum}`, `figure_${figNum}`, `fig-${figNum}`,
      `fig${figNum}`, `figure${figNum}`
    ];
    if (figPatterns.some((fp) => pageCombined.includes(fp))) {
      score += 0.65;
    }
  }

  // 3. Multi-word phrase or compound term match (e.g. "state diagram", "circuit diagram", "bode plot")
  const words = qParsed.allTerms;
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    if (pageCombined.includes(bigram)) {
      score = Math.max(score, 0.55);
      break;
    }
  }

  // 4. Topic terms and subtopic discriminator matching
  const chStemmed = new Set([...chParsed.allTerms, ...chParsed.topicTerms].map(stemTerm));
  const discriminatorTerms = targetTopicTerms.filter((term) => !chStemmed.has(stemTerm(term)));

  if (targetTopicTerms.length > 0) {
    const matchingTopicHits = targetTopicTerms.filter((term) => pageCombined.includes(term));
    const matchingDiscriminatorHits = discriminatorTerms.filter((term) => pageCombined.includes(term));

    if (discriminatorTerms.length > 0 && matchingDiscriminatorHits.length === 0) {
      // No discriminator match
    } else if (matchingTopicHits.length >= 2) {
      score = Math.max(score, Math.min(0.70, 0.45 + matchingTopicHits.length * 0.12));
    } else if (matchingTopicHits.length === 1) {
      const term = matchingTopicHits[0];
      if (matchingDiscriminatorHits.length === 1) {
        score = Math.max(score, 0.50);
      } else if (discriminatorTerms.length === 0) {
        score = Math.max(score, term.length >= 3 ? 0.45 : 0.35);
      }
    }
  }

  // Check extracted items that belong to this page
  const fileExtracted = Array.isArray(file.extractedItems) ? file.extractedItems : [];
  for (const it of fileExtracted) {
    const itPageStart = Number(it.pageStart || 1);
    const itPageEnd = Number(it.pageEnd || itPageStart);
    if (pageNo >= itPageStart && pageNo <= itPageEnd) {
      const itCombined = `${String(it.title || '')} ${String(it.contentText || '')}`.toLowerCase();
      if (visualMeta.explicitFigure) {
        const figNum = visualMeta.explicitFigure;
        if (itCombined.includes(`fig ${figNum}`) || itCombined.includes(`figure ${figNum}`)) {
          score = Math.max(score, 0.65);
        }
      }
      if (discriminatorTerms.length > 0) {
        const itDiscHits = discriminatorTerms.filter((term) => itCombined.includes(term));
        if (itDiscHits.length >= 1) {
          score = Math.max(score, 0.55);
        }
      }
      if (it.itemType === 'diagram' || it.itemType === 'figure') {
        score = Math.max(score, 0.50);
      }
    }
  }

  // 5. Visual content presence bonus
  const isVisualPage = page.pageType === 'diagram' ||
    page.pageType === 'figure' ||
    page.pageType === 'math' ||
    page.pageType === 'table' ||
    Boolean(page.latexPresent) ||
    Boolean(figDesc);

  if (score > 0 && isVisualPage) {
    score += 0.10;
  }

  // 6. Format terms support bonus
  if (score > 0 && targetFormatTerms.length > 0) {
    const formatHits = targetFormatTerms.filter((term) => pageCombined.includes(term));
    if (formatHits.length > 0) {
      score += 0.05;
    }
  }

  return Math.min(1.0, Number(score.toFixed(3)));
}

/**
 * Checks if the bundle contains any PDF diagram descriptions in academic_extracted_items or document_pages.
 */
function hasDiagramDescriptions(bundle = {}) {
  const files = Array.isArray(bundle.files) ? bundle.files : [];
  for (const f of files) {
    const items = Array.isArray(f.extractedItems) ? f.extractedItems : [];
    if (items.some((it) => it.itemType === 'diagram')) {
      return true;
    }
    const pages = Array.isArray(f.pages) ? f.pages : [];
    if (pages.some((p) => p.figureDescription || p.pageType === 'diagram' || p.pageType === 'figure')) {
      return true;
    }
  }
  return false;
}

/**
 * Retrieves, validates, deduplicates, and limits visual evidence assets from authorized bundle files.
 */
async function retrieveChapterVisualAssets(db, bundle = {}, reasoning = {}, options = {}) {
  const files = Array.isArray(bundle.files) ? bundle.files : [];
  if (files.length === 0) return [];

  const visualMeta = detectVisualRelevance(reasoning.originalQuestion, reasoning.presentationProfile);
  if (!visualMeta.isVisualRequest) {
    return [];
  }

  const maxImages = Math.min(options.maxImages || MAX_IMAGE_COUNT, MAX_IMAGE_COUNT);
  const maxCombinedBytes = options.maxCombinedBytes || MAX_COMBINED_IMAGE_BYTES;
  const resolveBufferFn = typeof options.resolveBufferFn === 'function'
    ? options.resolveBufferFn
    : (f) => resolveDocumentBuffer(db, f, options);

  // 1. Identify and score candidate visual materials from bundle.files
  const candidates = [];
  for (const file of files) {
    if (isImageMaterial(file)) {
      const score = scoreImageMaterial(file, reasoning.originalQuestion, reasoning, visualMeta);
      if (score >= 0.45) {
        candidates.push({
          kind: 'image_material',
          file,
          score,
          pageNumber: Number(file.pageNumber ?? file.page_number ?? file.pageStart ?? file.page_start ?? 1),
          title: file.title || file.originalName || 'Diagram',
          description: `Visual material from ${bundle.subject || 'course'} (${bundle.chapterTitle || 'chapter'})`
        });
      }
    } else if (isPdfDocument(file) && Array.isArray(file.pages) && file.pages.length > 0) {
      for (const page of file.pages) {
        const score = scorePdfPageVisual(file, page, reasoning.originalQuestion, reasoning, visualMeta);
        if (score >= 0.45) {
          const pNum = Number(page.pageNumber || 1);
          candidates.push({
            kind: 'pdf_page',
            file,
            score,
            pageNumber: pNum,
            title: page.figureTitle || `Page ${pNum} Visual (${file.title || 'PDF Note'})`,
            description: page.figureDescription || `Visual evidence on page ${pNum} of ${file.title || 'PDF Note'}`
          });
        }
      }
    }
  }

  if (candidates.length === 0) return [];

  // Sort candidates by score descending
  candidates.sort((a, b) => b.score - a.score);

  const topScore = candidates[0].score;
  const isMultiCompare = /\b(?:compare|comparison|both|difference|differences|versus|vs|all)\b/i.test(reasoning.originalQuestion || '');
  const filteredCandidates = candidates.filter((c, idx) => {
    if (idx === 0) return true;
    if (isMultiCompare) return c.score >= 0.45;
    return c.score >= 0.50 && (topScore - c.score) <= 0.15;
  });

  const selectedAssets = [];
  const seenKeys = new Set();
  let totalBytes = 0;

  for (const candidate of filteredCandidates) {
    if (selectedAssets.length >= maxImages) break;
    const { file, score, kind, pageNumber } = candidate;
    const dedupeKey = `${file.id}_p${pageNumber}`;
    if (seenKeys.has(dedupeKey)) continue;

    let buffer = null;
    if (kind === 'pdf_page') {
      if (typeof options.resolvePageBufferFn === 'function') {
        try {
          buffer = await options.resolvePageBufferFn(file, pageNumber);
        } catch (_) {
          buffer = null;
        }
      } else if (typeof resolveBufferFn === 'function') {
        try {
          buffer = await resolveBufferFn(file, { pageNumber });
        } catch (_) {
          buffer = null;
        }
      }
    } else {
      try {
        buffer = await resolveBufferFn(file);
      } catch (_) {
        buffer = null;
      }
    }

    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
      continue;
    }

    // Check individual image size limit
    if (buffer.length > MAX_IMAGE_BYTES) {
      continue;
    }

    // Check magic bytes
    const detectedMime = detectImageMimeType(buffer);
    if (!detectedMime || !ALLOWED_IMAGE_MIMES.has(detectedMime)) {
      continue;
    }

    // Check combined payload limit
    if (totalBytes + buffer.length > maxCombinedBytes) {
      continue;
    }

    seenKeys.add(dedupeKey);
    totalBytes += buffer.length;

    selectedAssets.push({
      fileId: file.id,
      fileTitle: file.title || file.originalName || `Document ${file.id}`,
      pageNumber,
      buffer,
      mimeType: detectedMime,
      title: candidate.title,
      description: candidate.description,
      score,
      kind
    });
  }

  return selectedAssets;
}

module.exports = {
  MAX_IMAGE_COUNT,
  MAX_IMAGE_BYTES,
  MAX_COMBINED_IMAGE_BYTES,
  ALLOWED_IMAGE_MIMES,
  detectImageMimeType,
  detectVisualRelevance,
  extractTerms,
  isImageMaterial,
  isPdfDocument,
  scoreImageMaterial,
  scorePdfPageVisual,
  hasDiagramDescriptions,
  retrieveChapterVisualAssets
};
