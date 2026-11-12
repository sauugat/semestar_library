'use strict';

const MIN_CLEAN_CHARS = 50;

const DEFAULT_CLASSIFIER_THRESHOLDS = {
  minCleanChars: MIN_CLEAN_CHARS,
  imageDenseTextChars: 150,
  largeImageAreaRatio: 0.15,
  vectorOpsSparseThreshold: 60,
  vectorOpsDenseThreshold: 100,
  vectorDenseTextChars: 200,
  minVerticalMathShifts: 4,
  minStackedFractions: 2,
  minDevanagariHalantBreaks: 2,
  minDevanagariIsolatedMatras: 2,
  minDevanagariMisorderedMatras: 2
};

function readPositiveNumberEnv(env, name, fallback) {
  const raw = env && env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Resolves classifier routing thresholds from environment variables and optional call overrides.
 */
function resolveClassifierThresholds(env = process.env, overrides = {}) {
  const base = {
    minCleanChars: readPositiveNumberEnv(env, 'DOC_CLASSIFIER_MIN_CLEAN_CHARS', DEFAULT_CLASSIFIER_THRESHOLDS.minCleanChars),
    imageDenseTextChars: readPositiveNumberEnv(env, 'DOC_CLASSIFIER_IMAGE_DENSE_TEXT_CHARS', DEFAULT_CLASSIFIER_THRESHOLDS.imageDenseTextChars),
    largeImageAreaRatio: readPositiveNumberEnv(env, 'DOC_CLASSIFIER_LARGE_IMAGE_AREA_RATIO', DEFAULT_CLASSIFIER_THRESHOLDS.largeImageAreaRatio),
    vectorOpsSparseThreshold: readPositiveNumberEnv(env, 'DOC_CLASSIFIER_VECTOR_SPARSE_OPS', DEFAULT_CLASSIFIER_THRESHOLDS.vectorOpsSparseThreshold),
    vectorOpsDenseThreshold: readPositiveNumberEnv(env, 'DOC_CLASSIFIER_VECTOR_DENSE_OPS', DEFAULT_CLASSIFIER_THRESHOLDS.vectorOpsDenseThreshold),
    vectorDenseTextChars: readPositiveNumberEnv(env, 'DOC_CLASSIFIER_VECTOR_DENSE_TEXT_CHARS', DEFAULT_CLASSIFIER_THRESHOLDS.vectorDenseTextChars),
    minVerticalMathShifts: readPositiveNumberEnv(env, 'DOC_CLASSIFIER_MIN_VERTICAL_MATH_SHIFTS', DEFAULT_CLASSIFIER_THRESHOLDS.minVerticalMathShifts),
    minStackedFractions: readPositiveNumberEnv(env, 'DOC_CLASSIFIER_MIN_STACKED_FRACTIONS', DEFAULT_CLASSIFIER_THRESHOLDS.minStackedFractions),
    minDevanagariHalantBreaks: readPositiveNumberEnv(env, 'DOC_CLASSIFIER_MIN_DEVANAGARI_HALANT_BREAKS', DEFAULT_CLASSIFIER_THRESHOLDS.minDevanagariHalantBreaks),
    minDevanagariIsolatedMatras: readPositiveNumberEnv(env, 'DOC_CLASSIFIER_MIN_DEVANAGARI_ISOLATED_MATRAS', DEFAULT_CLASSIFIER_THRESHOLDS.minDevanagariIsolatedMatras),
    minDevanagariMisorderedMatras: readPositiveNumberEnv(env, 'DOC_CLASSIFIER_MIN_DEVANAGARI_MISORDERED_MATRAS', DEFAULT_CLASSIFIER_THRESHOLDS.minDevanagariMisorderedMatras)
  };
  return { ...base, ...(overrides && typeof overrides === 'object' ? overrides : {}) };
}

const LEGACY_NEPALI_FONT_RE = /(?:preeti|kantipur|himali|sagarmatha|fontasy|ganess|pcs\s*nepali|nepali|devnagari|akriti|ananda|kanchan|surya)/i;
const MATH_FONT_RE = /(?:cmmi|cmsy|cmex|cmr\d|msbm|msam|mt\s*extra|cambria\s*math|symbol|euclid|stix|latin\s*modern\s*math|asana)/i;
const MATH_SYMBOL_RE = /[∑∏∫∮∂∇√∞≈≠≤≥≡∈∉⊂⊆∪∩∀∃⇒⇔±×÷¬∧∨⊕⊗ℝℤℕℚα-ωΑ-Ω°′″⟨⟩⊥∥∅]/g;
const LATEX_MARKER_RE = /(?:\$\$[\s\S]+?\$\$|\\(?:frac|sum|int|lim|sqrt|alpha|beta|gamma|theta|lambda|sigma|infty|partial|nabla|cdot|times|leq|geq|neq)\b)/g;
const BROKEN_GLYPH_RE = /[\uFFFD\uE000-\uF8FF]/g;
const BLANK_BOILERPLATE_RE = /^(?:\[?\s*this\s+page\s+(?:is\s+)?intentionally\s+left\s+blank\.?\s*\]?|\[\s*intentionally\s+left\s+blank\.?\s*\]|intentionally\s+left\s+blank\.?|blank\s+page\.?|this\s+page\s+was\s+left\s+blank\.?|notes\s*page\.?)$/i;

/**
 * Strips Wingdings/Symbol private-use bullet glyphs (U+F000..U+F0FF) appearing in bullet positions
 * so Nepali/English bulleted lists do not trip broken math glyph detection.
 */
function stripPuaBulletGlyphs(text) {
  return String(text || '').replace(/^([ \t]*)(?:[\uF000-\uF0FF]+(?=[ \t]|$)[ \t]*)+/gm, '$1');
}

// Preeti / Kantipur ASCII artifacts when rendered as raw ASCII instead of Devanagari Unicode:
// e.g. digits/punctuation glued inside lowercase letter words: "k|yd", "jif{", "/fHo", "cfhsf]", "g]kfn"
const PREETI_TOKEN_RE = /(?:[a-zA-Z]+[|{}[\]<>\\/=+*^][a-zA-Z]+|^[|{}\[\]/\\][a-zA-Z]{2,}|[a-zA-Z]{2,}[|{}\[\]/\\]$)/;

/**
 * Reconstructs visual reading-order lines from PDF.js text items using (x, y) coordinates.
 * Preserves line breaks, indentation, and horizontal column spacing for code/tables.
 *
 * @param {Array<object>} items TextContent items from page.getTextContent()
 * @returns {{ rawText: string, lines: Array<{ y: number, text: string, items: Array<object> }> }}
 */
function reconstructLinesFromItems(items = []) {
  const positioned = [];
  for (const item of items) {
    if (!item || typeof item.str !== 'string') continue;
    const str = item.str.replace(/\0/g, '');
    if (!str && !item.hasEOL) continue;
    const tr = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
    const x = Number.isFinite(tr[4]) ? tr[4] : 0;
    const y = Number.isFinite(tr[5]) ? tr[5] : 0;
    const width = Number.isFinite(item.width) ? item.width : str.length * 4;
    const height = Number.isFinite(item.height) && item.height > 0 ? item.height : Math.abs(tr[0] || tr[3] || 10);
    positioned.push({ str, x, y, width, height, fontName: item.fontName || '', hasEOL: Boolean(item.hasEOL) });
  }

  if (positioned.length === 0) {
    return { rawText: '', lines: [] };
  }

  // Group into visual rows sorted top-to-bottom (higher PDF y first), then left-to-right (lower x first).
  positioned.sort((a, b) => {
    if (Math.abs(b.y - a.y) > 3) return b.y - a.y;
    return a.x - b.x;
  });

  const rows = [];
  for (const item of positioned) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(lastRow.y - item.y) <= 3) {
      lastRow.items.push(item);
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }

  const lines = rows.map(row => {
    row.items.sort((a, b) => a.x - b.x);
    let lineText = '';
    let prevEnd = null;
    for (const part of row.items) {
      const token = part.str;
      if (!token) continue;
      if (prevEnd !== null) {
        const gap = part.x - prevEnd;
        if (gap > 18) {
          lineText += '   ';
        } else if (gap > 1.5 && !lineText.endsWith(' ') && !token.startsWith(' ')) {
          lineText += ' ';
        }
      }
      lineText += token;
      prevEnd = part.x + Math.max(0, part.width);
    }
    return { y: row.y, text: lineText.trimEnd(), items: row.items };
  }).filter(line => line.text.trim().length > 0);

  return {
    rawText: lines.map(l => l.text).join('\n'),
    lines
  };
}

/**
 * Computes alphanumeric Unicode character count (excluding whitespace/punctuation noise).
 */
function countCleanAlnumChars(text) {
  if (!text) return 0;
  const matches = String(text).match(/[\p{L}\p{N}]/gu);
  return matches ? matches.length : 0;
}

/**
 * Strips trivial "Page N" headers/footers before checking minimum meaningful text.
 */
function stripBoilerplateText(text) {
  return String(text || '')
    .split('\n')
    .filter(line => {
      const t = line.trim();
      if (!t) return false;
      if (/^(?:page|pg\.?)\s*\d+(?:\s*(?:of|\/)\s*\d+)?$/i.test(t)) return false;
      if (/^\d{1,4}$/.test(t)) return false;
      if (BLANK_BOILERPLATE_RE.test(t)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

/**
 * Detects broken Devanagari Unicode cluster extraction from PDFs:
 * - halant + whitespace splitting a consonant cluster (e.g. "व् यिस् था", "अर् थ")
 * - isolated dependent vowel signs (matras) or halant separated from consonants
 * - misordered short-i matra (ि, U+093F) placed before anusvara/word-start ("िंसवधान")
 */
function detectDevanagariCorruption(text, thresholds = DEFAULT_CLASSIFIER_THRESHOLDS) {
  const str = String(text || '');
  const devanagariChars = str.match(/[\u0900-\u097F]/g);
  if (!devanagariChars || devanagariChars.length < 6) {
    return {
      detected: false,
      halantBreaks: 0,
      isolatedMatras: 0,
      misorderedShortI: 0,
      totalAnomalies: 0,
      reason: null
    };
  }

  // Consonants/marks split by halant + whitespace + following Devanagari consonant/vowel
  const halantBreakMatches = str.match(/[\u0915-\u0939\u0958-\u095F]\u094D[ \t]+[\u0905-\u0939\u0958-\u095F]/g) || [];
  // Dependent vowel signs or virama standing at the start of a token or after whitespace
  const isolatedMatraMatches = str.match(/(?:^|\s)[\u093A-\u094E\u0962\u0963\u0901-\u0903]+/g) || [];
  // Misordered short-i (U+093F) at word start, before anusvara/candrabindu+consonant, or after independent/dependent vowels
  const misorderedShortIStart = str.match(/(?:^|\s)\u093F/g) || [];
  const misorderedShortIBeforeMark = str.match(/\u093F[\u0901-\u0903][\u0915-\u0939\u0958-\u095F]/g) || [];
  const misorderedShortIAfterVowel = str.match(/[\u0904-\u0914\u093E-\u094C]\u093F/g) || [];

  const halantBreaks = halantBreakMatches.length;
  const isolatedMatras = isolatedMatraMatches.length;
  const misorderedShortI = misorderedShortIStart.length + misorderedShortIBeforeMark.length + misorderedShortIAfterVowel.length;
  const totalAnomalies = halantBreaks + isolatedMatras + misorderedShortI;

  const detected =
    halantBreaks >= (thresholds.minDevanagariHalantBreaks ?? DEFAULT_CLASSIFIER_THRESHOLDS.minDevanagariHalantBreaks) ||
    isolatedMatras >= (thresholds.minDevanagariIsolatedMatras ?? DEFAULT_CLASSIFIER_THRESHOLDS.minDevanagariIsolatedMatras) ||
    misorderedShortI >= (thresholds.minDevanagariMisorderedMatras ?? DEFAULT_CLASSIFIER_THRESHOLDS.minDevanagariMisorderedMatras) ||
    totalAnomalies >= 3;

  return {
    detected,
    halantBreaks,
    isolatedMatras,
    misorderedShortI,
    totalAnomalies,
    reason: detected ? 'nepali_repair' : null
  };
}

/**
 * Detects legacy non-Unicode Nepali encoding (Preeti/Kantipur/Himali TTF fonts mapped to ASCII glyphs).
 */
function detectLegacyNepaliMojibake(text, styles = {}) {
  const fontNames = Object.values(styles || {})
    .flatMap(s => [s?.fontFamily, s?.name])
    .map(v => String(v || '').trim())
    .filter(Boolean);

  if (fontNames.some(name => LEGACY_NEPALI_FONT_RE.test(name))) {
    // Only flag if text actually lacks Devanagari Unicode characters.
    const devanagariMatches = String(text || '').match(/[\u0900-\u097F]/g);
    if (!devanagariMatches || devanagariMatches.length < 5) {
      return { detected: true, reason: 'legacy_nepali_font' };
    }
  }

  const tokens = String(text || '').split(/\s+/).filter(Boolean);
  if (tokens.length >= 6) {
    let artifactCount = 0;
    for (const tok of tokens) {
      if (PREETI_TOKEN_RE.test(tok) && !/^https?:\/\//i.test(tok) && !/^[a-z]:[\\/]/i.test(tok)) {
        artifactCount++;
      }
    }
    if (artifactCount >= 3 && artifactCount / tokens.length >= 0.15) {
      return { detected: true, reason: 'preeti_ascii_artifacts' };
    }
  }

  return { detected: false, reason: null };
}

/**
 * Detects pages containing significant math formulas or broken PDF math glyphs.
 */
function detectMathSignal(text, styles = {}, items = [], thresholds = DEFAULT_CLASSIFIER_THRESHOLDS) {
  const str = stripPuaBulletGlyphs(text);
  const symbolMatches = str.match(MATH_SYMBOL_RE) || [];
  const latexMatches = str.match(LATEX_MARKER_RE) || [];
  const brokenGlyphs = str.match(BROKEN_GLYPH_RE) || [];

  const fontNames = Object.values(styles || {})
    .flatMap(s => [s?.fontFamily, s?.name])
    .map(v => String(v || '').trim())
    .filter(Boolean);
  const hasMathFont = fontNames.some(name => MATH_FONT_RE.test(name));

  // Detect isolated sub/superscript 1-3 char tokens shifted vertically from sibling items,
  // plus stacked numerator/denominator pairs centered vertically over small offsets.
  let verticalMathShifts = 0;
  let stackedFractions = 0;
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const curr = items[i];
    if (!prev || !curr || !Array.isArray(prev.transform) || !Array.isArray(curr.transform)) continue;
    const dy = Math.abs(curr.transform[5] - prev.transform[5]);
    const dx = curr.transform[4] - (prev.transform[4] + (prev.width || 0));
    const currTrim = String(curr.str || '').trim();
    const prevTrim = String(prev.str || '').trim();
    if (currTrim.length > 0 && currTrim.length <= 3 && dy > 2.5 && dy < 12 && Math.abs(dx) < 18) {
      verticalMathShifts++;
    }
    const xOverlap = Math.abs(curr.transform[4] - prev.transform[4]) < 24;
    if (
      prevTrim.length > 0 && prevTrim.length <= 12 &&
      currTrim.length > 0 && currTrim.length <= 12 &&
      dy >= 6 && dy <= 28 && xOverlap &&
      (/[0-9a-zA-Z]/.test(prevTrim) && /[0-9a-zA-Z]/.test(currTrim)) &&
      !/^\d+$/.test(prevTrim + currTrim)
    ) {
      // Only treat stacked tokens as fractions if accompanied by adjacent formula signs or vertical shifts
      if (symbolMatches.length > 0 || verticalMathShifts > 0) {
        stackedFractions++;
      }
    }
  }

  const minShifts = thresholds.minVerticalMathShifts ?? DEFAULT_CLASSIFIER_THRESHOLDS.minVerticalMathShifts;
  const minFractions = thresholds.minStackedFractions ?? DEFAULT_CLASSIFIER_THRESHOLDS.minStackedFractions;

  const latexPresent =
    symbolMatches.length >= 3 ||
    latexMatches.length >= 1 ||
    hasMathFont ||
    brokenGlyphs.length >= 1 ||
    verticalMathShifts >= minShifts ||
    stackedFractions >= minFractions;

  // Clean inline Unicode math symbols (e.g. "x ∈ A ∪ B") stay on text_layer;
  // route to Vision only when glyphs/layout cannot be faithfully preserved in plain text.
  const brokenOrDense =
    brokenGlyphs.length >= 1 ||
    latexMatches.length >= 1 ||
    verticalMathShifts >= minShifts ||
    stackedFractions >= minFractions ||
    (hasMathFont && (brokenGlyphs.length > 0 || symbolMatches.length > 0 || verticalMathShifts > 0));

  return {
    latexPresent,
    brokenOrDense,
    symbolCount: symbolMatches.length,
    brokenGlyphCount: brokenGlyphs.length,
    verticalMathShifts,
    stackedFractions,
    hasMathFont
  };
}

/**
 * Detects multi-column tables from reconstructed lines or vector grid lines.
 */
function detectTableSignal(lines = [], ruleLineOps = 0) {
  let multiColRows = 0;
  let alignedColStarts = [];

  for (const line of lines) {
    const segs = [];
    let currentCluster = [];
    for (const item of line.items || []) {
      const t = String(item.str || '').trim();
      if (!t) continue;
      if (currentCluster.length === 0) {
        currentCluster.push(item);
      } else {
        const last = currentCluster[currentCluster.length - 1];
        const gap = item.x - (last.x + (last.width || 0));
        if (gap >= 16) {
          segs.push(currentCluster[0].x);
          currentCluster = [item];
        } else {
          currentCluster.push(item);
        }
      }
    }
    if (currentCluster.length > 0) {
      segs.push(currentCluster[0].x);
    }

    // Fallback check on text spacing ("col1   col2   col3") when synthetic tests provide plain text lines.
    const textCols = line.text.trim().split(/\s{3,}|\t|\s*\|\s*/).filter(Boolean);
    const colCount = Math.max(segs.length, textCols.length);
    if (colCount >= 3) {
      multiColRows++;
      alignedColStarts.push(segs.length >= 3 ? segs : []);
    }
  }

  // Also check explicit markdown/ASCII pipe tables (>= 3 lines with >= 2 pipes).
  const pipeRows = lines.filter(l => (l.text.match(/\|/g) || []).length >= 2).length;

  return {
    isTable: multiColRows >= 4 || pipeRows >= 3 || (ruleLineOps >= 8 && multiColRows >= 2),
    multiColRows,
    pipeRows
  };
}

/**
 * Extracts PDF.js page text, styles, and image/vector operator counts in pure Node.js.
 *
 * @param {object} page PDFPageProxy from pdfjs-dist
 * @param {object} ops pdfjs OPS enum
 * @returns {Promise<object>}
 */
async function extractPdfPageSignals(page, ops) {
  const [content, opList] = await Promise.all([
    page.getTextContent(),
    typeof page.getOperatorList === 'function' ? page.getOperatorList() : Promise.resolve({ fnArray: [] })
  ]);

  const items = Array.isArray(content?.items) ? content.items : [];
  const rawStyles = content?.styles || {};
  const styles = {};
  for (const [key, val] of Object.entries(rawStyles)) {
    styles[key] = { ...(val || {}) };
  }
  const fontIds = new Set(Object.keys(styles));
  for (const item of items) {
    if (item?.fontName) fontIds.add(item.fontName);
  }
  for (const fontId of fontIds) {
    try {
      const canGet = page?.commonObjs && (typeof page.commonObjs.has !== 'function' || page.commonObjs.has(fontId));
      const fontObj = canGet ? page.commonObjs.get(fontId) : null;
      if (fontObj?.name) {
        styles[fontId] = {
          ...(styles[fontId] || {}),
          name: fontObj.name
        };
      }
    } catch {
      // ignore unloaded/inline font ids
    }
  }

  const { rawText, lines } = reconstructLinesFromItems(items);

  const imageOpSet = new Set([
    ops.paintImageXObject,
    ops.paintInlineImageXObject,
    ops.paintImageMaskXObject,
    ops.paintImageMaskXObjectGroup,
    ops.paintInlineImageXObjectGroup,
    ops.paintImageXObjectRepeat,
    ops.paintImageMaskXObjectRepeat,
    ops.beginInlineImage
  ].filter(v => v !== undefined));

  const vectorOpSet = new Set([
    ops.constructPath,
    ops.stroke,
    ops.closeStroke,
    ops.fill,
    ops.eoFill,
    ops.fillStroke,
    ops.eoFillStroke,
    ops.closeFillStroke,
    ops.closeEOFillStroke
  ].filter(v => v !== undefined));

  let imageOps = 0;
  let vectorOps = 0;
  let ruleLineOps = 0;
  let maxImageAreaRatio = 0;

  const view = Array.isArray(page?.view) && page.view.length >= 4 ? page.view : [0, 0, 612, 792];
  const pageArea = Math.max(1, Math.abs((Number(view[2]) - Number(view[0])) * (Number(view[3]) - Number(view[1]))));

  let ctm = [1, 0, 0, 1, 0, 0];
  const ctmStack = [];
  const fnArray = Array.isArray(opList?.fnArray) ? opList.fnArray : [];
  const argsArray = Array.isArray(opList?.argsArray) ? opList.argsArray : [];
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    if (ops.save !== undefined && fn === ops.save) {
      ctmStack.push([...ctm]);
      continue;
    }
    if (ops.restore !== undefined && fn === ops.restore) {
      if (ctmStack.length > 0) ctm = ctmStack.pop();
      continue;
    }
    if (ops.transform !== undefined && fn === ops.transform && Array.isArray(argsArray[i]) && argsArray[i].length >= 6) {
      const m = argsArray[i];
      ctm = [
        ctm[0] * m[0] + ctm[2] * m[1],
        ctm[1] * m[0] + ctm[3] * m[1],
        ctm[0] * m[2] + ctm[2] * m[3],
        ctm[1] * m[2] + ctm[3] * m[3],
        ctm[0] * m[4] + ctm[2] * m[5] + ctm[4],
        ctm[1] * m[4] + ctm[3] * m[5] + ctm[5]
      ];
      continue;
    }
    if (imageOpSet.has(fn)) {
      imageOps++;
      const imgArea = Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
      const ratio = imgArea / pageArea;
      if (Number.isFinite(ratio) && ratio > maxImageAreaRatio) {
        maxImageAreaRatio = ratio;
      }
    }
    if (vectorOpSet.has(fn)) {
      vectorOps++;
      if (fn === ops.stroke || fn === ops.closeStroke || fn === ops.constructPath) {
        ruleLineOps++;
      }
    }
  }

  return { rawText, lines, styles, items, imageOps, maxImageAreaRatio, vectorOps, ruleLineOps };
}

/**
 * Classifies one page and returns the Phase D2 routing decision (`text_layer`, `vision`, or `skip`).
 */
function classifyPageSignals({
  rawText = '',
  lines = null,
  styles = {},
  items = [],
  imageOps = 0,
  maxImageAreaRatio = null,
  vectorOps = 0,
  ruleLineOps = 0,
  thresholds: thresholdOverrides = null
} = {}) {
  const thresholds = resolveClassifierThresholds(process.env, thresholdOverrides);
  const normalizedRaw = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const meaningfulText = stripBoilerplateText(normalizedRaw);
  const charCount = countCleanAlnumChars(meaningfulText);

  const effectiveLines = Array.isArray(lines)
    ? lines
    : normalizedRaw
      .split('\n')
      .filter(l => l.trim().length > 0)
      .map((text, idx) => ({ y: 1000 - idx * 14, text, items: [] }));

  const legacyNepali = detectLegacyNepaliMojibake(normalizedRaw, styles);
  const brokenNepali = detectDevanagariCorruption(normalizedRaw, thresholds);
  const math = detectMathSignal(normalizedRaw, styles, items, thresholds);
  const table = detectTableSignal(effectiveLines, ruleLineOps);

  const hasLargeImage =
    maxImageAreaRatio != null
      ? Number(maxImageAreaRatio) >= thresholds.largeImageAreaRatio
      : imageOps >= 2;
  const hasSignificantImage = imageOps >= 1 && (charCount < thresholds.imageDenseTextChars || hasLargeImage);
  const hasDenseVectors =
    vectorOps >= thresholds.vectorOpsDenseThreshold ||
    (vectorOps >= thresholds.vectorOpsSparseThreshold && charCount < thresholds.vectorDenseTextChars);
  const isFigureDominant = hasSignificantImage || hasDenseVectors;

  const reasons = [];

  // 1. Blank or boilerplate-only separator page -> skip without Vision spend
  if (charCount === 0 && imageOps === 0 && vectorOps < thresholds.vectorOpsSparseThreshold) {
    return {
      rawText: normalizedRaw,
      cleanText: '',
      charCount: 0,
      pageType: 'text',
      latexPresent: false,
      route: 'skip',
      reasons: ['blank_page']
    };
  }

  // 2. Scanned or handwritten low-text page (< minCleanChars)
  if (charCount < thresholds.minCleanChars) {
    reasons.push('low_clean_chars');
    if (imageOps > 0) reasons.push('image_xobject');
    if (math.brokenOrDense) {
      reasons.push('math_symbols_low_text');
      return {
        rawText: normalizedRaw,
        cleanText: normalizedRaw,
        charCount,
        pageType: 'scanned',
        latexPresent: true,
        route: 'vision',
        reasons
      };
    }
    return {
      rawText: normalizedRaw,
      cleanText: normalizedRaw,
      charCount,
      pageType: 'scanned',
      latexPresent: math.latexPresent,
      route: 'vision',
      reasons
    };
  }

  // 3. Legacy Nepali mojibake font (e.g. Preeti/Kantipur) or broken UTF-8 Devanagari clusters -> Vision repair
  if (legacyNepali.detected) {
    reasons.push(legacyNepali.reason);
    return {
      rawText: normalizedRaw,
      cleanText: normalizedRaw,
      charCount,
      pageType: 'scanned',
      latexPresent: math.latexPresent,
      route: 'vision',
      reasons
    };
  }
  if (brokenNepali.detected) {
    reasons.push('nepali_repair');
    return {
      rawText: normalizedRaw,
      cleanText: normalizedRaw,
      charCount,
      pageType: 'nepali_repair',
      latexPresent: math.latexPresent,
      route: 'vision',
      reasons
    };
  }

  // 4. Math-heavy or broken-glyph formulas -> Vision extracts clean LaTeX
  if (math.brokenOrDense) {
    if (math.brokenGlyphCount > 0) reasons.push('broken_math_glyphs');
    if (math.hasMathFont) reasons.push('math_font');
    if (math.verticalMathShifts >= thresholds.minVerticalMathShifts) reasons.push('vertical_math_shifts');
    if (math.stackedFractions >= thresholds.minStackedFractions) reasons.push('stacked_fractions');
    if (reasons.length === 0) reasons.push('math_notation');
    return {
      rawText: normalizedRaw,
      cleanText: normalizedRaw,
      charCount,
      pageType: 'math',
      latexPresent: true,
      route: 'vision',
      reasons
    };
  }

  // 5. Structured tables -> Vision emits clean GitHub-flavored Markdown table
  if (table.isTable) {
    reasons.push('table_layout');
    return {
      rawText: normalizedRaw,
      cleanText: normalizedRaw,
      charCount,
      pageType: 'table',
      latexPresent: math.latexPresent,
      route: 'vision',
      reasons
    };
  }

  // 6. Diagrams / figures / slides with significant embedded graphics -> Vision adds figure_description + OCR text
  if (isFigureDominant) {
    reasons.push(hasSignificantImage ? 'embedded_image' : 'vector_diagram');
    return {
      rawText: normalizedRaw,
      cleanText: normalizedRaw,
      charCount,
      pageType: 'figure',
      latexPresent: math.latexPresent,
      route: 'vision',
      reasons
    };
  }

  // 7. Clean typed text page -> keep text_layer directly with zero Vision cost
  return {
    rawText: normalizedRaw,
    cleanText: normalizedRaw,
    charCount,
    pageType: 'text',
    latexPresent: math.latexPresent,
    route: 'text_layer',
    reasons: ['clean_text_layer']
  };
}

module.exports = {
  MIN_CLEAN_CHARS,
  DEFAULT_CLASSIFIER_THRESHOLDS,
  resolveClassifierThresholds,
  stripBoilerplateText,
  stripPuaBulletGlyphs,
  reconstructLinesFromItems,
  countCleanAlnumChars,
  detectLegacyNepaliMojibake,
  detectDevanagariCorruption,
  detectMathSignal,
  detectTableSignal,
  extractPdfPageSignals,
  classifyPageSignals
};

