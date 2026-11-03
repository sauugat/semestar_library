'use strict';

const { normalizeDevanagariDigits, normalizeNepaliDatesAndDigits } = require('./nepali-dates');
const { detectLanguage } = require('./chat-personality');

const SAFE_UNVERIFIED_REPLY = {
  english: "I couldn't find that in the university records.",
  romanized_nepali: 'Yo kura university records ma bhetiyena.',
  mixed: 'Yo kura university records ma bhetiyena.',
  devanagari: 'यो विवरण विश्वविद्यालयको रेकर्डमा भेटिएन।'
};

function getSafeUnverifiedReply(languageOrMessage = 'english') {
  const lang = ['english', 'romanized_nepali', 'mixed', 'devanagari'].includes(languageOrMessage)
    ? languageOrMessage
    : detectLanguage(languageOrMessage);
  return SAFE_UNVERIFIED_REPLY[lang] || SAFE_UNVERIFIED_REPLY.english;
}

/**
 * Flattens retrieved records and tool results into a normalized text corpus for claim verification.
 */
function buildEvidenceCorpus(evidence = []) {
  if (!evidence) return '';
  const items = Array.isArray(evidence) ? evidence : [evidence];
  const parts = [];

  for (const item of items) {
    if (!item) continue;
    if (typeof item === 'string') {
      parts.push(item);
      continue;
    }
    if (typeof item === 'object') {
      for (const key of [
        'title', 'content', 'description', 'excerpt', 'extractedContent',
        'subject', 'chapter', 'semester', 'pageNumber', 'deadline',
        'date', 'examDate', 'exam_date', 'time', 'examTime', 'exam_time',
        'room', 'weekday', 'day', 'calendar', 'code', 'subject_code',
        'credit', 'objectives', 'contents', 'lab', 'webUrl', 'viewUrl',
        'downloadUrl', 'deepLink', 'authorName', 'createdAt', 'created_at'
      ]) {
        if (item[key] !== undefined && item[key] !== null) {
          parts.push(String(item[key]));
          if ((key === 'date' || key === 'deadline' || key === 'createdAt' || key === 'created_at') && item[key]) {
            const d = new Date(item[key]);
            if (!Number.isNaN(d.getTime())) {
              parts.push(d.toISOString().slice(0, 10));
              parts.push(d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }));
              parts.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
            }
          }
        }
      }
      // Handle nested tool results (e.g. { name, result: { files, courses, routine, notices, posts, assignments } })
      const inner = item.result || item;
      for (const listKey of ['files', 'courses', 'routine', 'notices', 'posts', 'assignments']) {
        if (Array.isArray(inner[listKey])) {
          parts.push(buildEvidenceCorpus(inner[listKey]));
        }
      }
      if (inner.file && typeof inner.file === 'object') {
        parts.push(buildEvidenceCorpus([inner.file]));
      }
    }
  }

  const rawCorpus = parts.join(' \n ');
  const normalizedCorpus = normalizeNepaliDatesAndDigits(rawCorpus);
  return `${rawCorpus.toLowerCase()} \n ${normalizedCorpus}`;
}

/**
 * Extracts verifiable factual claims from a text segment.
 *
 * In 'general' mode: extracts ONLY URLs, emails, and campus-specific dates.
 * In 'record' mode: extracts URLs, emails, dates, clock times, and numbers with academic/campus units.
 *
 * @param {string} text
 * @param {{ mode?: 'record' | 'general' }} [options]
 * @returns {Array<{ type: string, raw: string, normalized: string }>}
 */
function extractClaims(text, { mode = 'record' } = {}) {
  const rawText = String(text || '');
  if (!rawText.trim()) return [];

  // Strip fenced code blocks before extracting claims
  const withoutCode = rawText.replace(/```[\s\S]*?```/g, ' ');
  const claims = [];

  // 1. URLs (http/https/www and markdown link targets)
  for (const m of withoutCode.matchAll(/https?:\/\/[^\s<>)\]"']+|www\.[^\s<>)\]"']+/gi)) {
    const cleaned = m[0].replace(/[.,;:!?]+$/, '');
    claims.push({ type: 'url', raw: cleaned, normalized: cleaned.toLowerCase() });
  }

  // 2. Emails
  for (const m of withoutCode.matchAll(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g)) {
    claims.push({ type: 'email', raw: m[0], normalized: m[0].toLowerCase() });
  }

  // 3. Dates (normalized via lib/nepali-dates.js for Devanagari digits and BS/AD months)
  const normDatesText = normalizeNepaliDatesAndDigits(withoutCode);

  // 3a. YYYY-MM-DD (after normalization from YYYY/MM/DD or Devanagari)
  for (const m of normDatesText.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)) {
    claims.push({ type: 'date', raw: m[1], normalized: m[1] });
  }

  // 3b. Named BS or AD month + day (normalized to "<month> <day>")
  const monthNames = 'baisakh|jestha|asar|shrawan|bhadra|asoj|kartik|mangsir|poush|magh|falgun|chaitra|january|february|march|april|may|june|july|august|september|october|november|december';
  const monthRegex = new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})\\b`, 'gi');
  for (const m of normDatesText.matchAll(monthRegex)) {
    const norm = `${m[1].toLowerCase()} ${Number(m[2])}`;
    claims.push({ type: 'date', raw: m[0], normalized: norm });
  }

  if (mode === 'general') {
    return claims;
  }

  // 4. Record-mode only: Clock times and Numbers with campus/academic units
  const asciiDigitsText = normalizeDevanagariDigits(withoutCode);

  // 4a. Clock times (e.g. 8:00 AM, 10:30 PM, 11 बजे)
  for (const m of asciiDigitsText.matchAll(/\b((?:1[0-2]|0?[1-9]):[0-5]\d\s*(?:am|pm)|(?:1[0-2]|0?[1-9])\s*(?:am|pm|baje|बजे))\b/gi)) {
    const norm = m[1].toLowerCase().replace(/\s+/g, ' ').trim();
    claims.push({ type: 'time', raw: m[0], normalized: norm });
  }

  // 4b. Room / Hall / Block / Lab identifiers (e.g., Room 302, Hall A, Lab 4, कोठा ३०२)
  for (const m of asciiDigitsText.matchAll(/\b(?:room|hall|lab|block|कोठा|हल)\s*(?:no\.?|number|#)?\s*([0-9]{1,4}[a-z]?|[a-z])\b/gi)) {
    const token = m[1].toLowerCase();
    // Skip common English words if single letter 'a' unless capitalized 'Hall A' / 'Room A' in original
    if (token === 'a' && !/\b(?:Room|Hall|Lab|Block)\s+A\b/.test(asciiDigitsText)) continue;
    claims.push({ type: 'unit_number', raw: m[0], normalized: token });
  }

  // 4c. Numbers with academic/campus units (credits, marks, hours/hrs, %, pages, chapters, Rs/NPR)
  for (const m of asciiDigitsText.matchAll(/\b(\d+(?:\.\d+)?)\s*(credits?|credit\s+hours?|marks?|hrs?|hours?|%|percent|pages?|chapters?|अंक|क्रेडिट|पेज|अध्याय)\b/gi)) {
    claims.push({ type: 'unit_number', raw: m[0], normalized: m[1] });
  }
  for (const m of asciiDigitsText.matchAll(/\b(?:page|chapter|rs\.?|npr|पेज|अध्याय|रु\.?)\s*(?:no\.?|number|#)?\s*(\d+(?:\.\d+)?)\b/gi)) {
    claims.push({ type: 'unit_number', raw: m[0], normalized: m[1] });
  }

  return claims;
}

/**
 * Checks whether a single extracted claim is supported by the normalized evidence corpus.
 */
function isClaimSupported(claim, evidenceCorpus) {
  if (!evidenceCorpus || !evidenceCorpus.trim()) return false;

  if (claim.type === 'url') {
    const normUrl = claim.normalized.replace(/\/+$/, '');
    return evidenceCorpus.includes(normUrl);
  }
  if (claim.type === 'email') {
    return evidenceCorpus.includes(claim.normalized);
  }
  if (claim.type === 'date') {
    if (evidenceCorpus.includes(claim.normalized)) return true;
    // Also check if YYYY-MM-DD matches month + day in evidence (for AD months)
    const isoMatch = claim.normalized.match(/^20\d{2}-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const adMonths = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
      const mName = adMonths[Number(isoMatch[1]) - 1];
      const dayNum = Number(isoMatch[2]);
      if (mName && evidenceCorpus.includes(`${mName} ${dayNum}`)) return true;
    }
    return false;
  }
  if (claim.type === 'time') {
    const compact = claim.normalized.replace(/\s+/g, '');
    const corpusCompact = evidenceCorpus.replace(/\s+/g, '');
    if (corpusCompact.includes(compact)) return true;
    // Match numeric hour:minute or hour if present
    const hm = claim.normalized.match(/\b(\d{1,2}(?::\d{2})?)/);
    if (hm && evidenceCorpus.includes(hm[1])) return true;
    return false;
  }
  if (claim.type === 'unit_number') {
    const escaped = claim.normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(evidenceCorpus);
  }
  return evidenceCorpus.includes(claim.normalized);
}

/**
 * Strips raw URLs from general explanations while preserving code blocks.
 */
function stripUrlsOutsideCodeBlocks(text) {
  const parts = String(text || '').split(/(```[\s\S]*?```)/g);
  return parts.map(part => {
    if (part.startsWith('```')) return part;
    return part
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, '$1')
      .replace(/https?:\/\/[^\s<>)\]"']+|www\.[^\s<>)\]"']+/gi, '[link omitted]');
  }).join('');
}

/**
 * Verifies that factual claims in `reply` exist in `evidence`.
 *
 * Rules:
 * - In 'general' mode: verifies only URLs, emails, and campus-specific dates; strips raw URLs.
 * - In 'record' mode: verifies URLs, emails, dates, times, and numbers with units against `evidence`.
 * - Never drops sentences inside fenced code blocks, markdown lists, or markdown tables.
 * - If > 40% of the reply would be dropped (or if unsupported claims exist inside non-droppable blocks in record mode),
 *   returns the safe fallback ("I couldn't find that in the university records." / Nepali equivalent).
 *
 * @param {string} reply
 * @param {Array|object|string} evidence
 * @param {{ mode?: 'record' | 'general', language?: string }} [options]
 * @returns {{ reply: string, verified: boolean, fallbackUsed: boolean, droppedClaims: Array, droppedRatio: number }}
 */
function verifyGrounding(reply, evidence = [], options = {}) {
  const mode = options.mode === 'general' ? 'general' : 'record';
  const language = options.language || detectLanguage(reply);
  const rawReply = String(reply || '').trim();

  if (!rawReply) {
    return {
      reply: getSafeUnverifiedReply(language),
      verified: false,
      fallbackUsed: true,
      droppedClaims: [],
      droppedRatio: 1
    };
  }

  const evidenceCorpus = buildEvidenceCorpus(evidence);

  // Split into fenced code blocks vs non-code blocks so code blocks are never altered or sentence-dropped
  const blocks = rawReply.split(/(```[\s\S]*?```)/g);
  const keptSegments = [];
  const droppedClaims = [];
  let totalEvaluatedChars = 0;
  let droppedChars = 0;
  let protectedBlockHasUnsupported = false;

  for (const block of blocks) {
    if (!block) continue;
    if (block.startsWith('```')) {
      keptSegments.push(block);
      totalEvaluatedChars += block.length;
      continue;
    }

    // Split non-code block by lines to identify list items and table rows (which must never have sentences dropped inside them)
    const lines = block.split('\n');
    const keptLines = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        keptLines.push(line);
        continue;
      }

      const isListOrTable = /^(?:[-*+]|\d+[.)])\s+/.test(trimmed) || /^\|.*\|$/.test(trimmed) || /^#{1,6}\s+/.test(trimmed);

      if (isListOrTable) {
        totalEvaluatedChars += trimmed.length;
        const lineClaims = extractClaims(trimmed, { mode });
        const unsupported = lineClaims.filter(c => !isClaimSupported(c, evidenceCorpus));
        if (unsupported.length > 0) {
          droppedClaims.push(...unsupported);
          if (mode === 'record') {
            // Never drop individual sentences inside lists or tables; count toward unsupported ratio
            droppedChars += trimmed.length;
            protectedBlockHasUnsupported = true;
          }
        }
        keptLines.push(mode === 'general' ? stripUrlsOutsideCodeBlocks(line) : line);
        continue;
      }

      // Prose paragraph: split into sentences only at sentence-ending punctuation followed by whitespace
      // so dots inside URLs (https://a.b.com/x.pdf.), emails, or decimals are never split.
      const sentences = line.split(/(?<=[.!?।])\s+/).filter(Boolean);
      const keptSentences = [];

      for (const sentence of sentences) {
        const sTrim = sentence.trim();
        if (!sTrim) continue;
        totalEvaluatedChars += sTrim.length;

        const sClaims = extractClaims(sTrim, { mode });
        const unsupported = sClaims.filter(c => !isClaimSupported(c, evidenceCorpus));

        if (unsupported.length > 0) {
          droppedClaims.push(...unsupported);
          droppedChars += sTrim.length;
        } else {
          keptSentences.push(mode === 'general' ? stripUrlsOutsideCodeBlocks(sTrim) : sTrim);
        }
      }

      if (keptSentences.length > 0) {
        keptLines.push(keptSentences.join(' '));
      }
    }

    const joinedLines = keptLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (joinedLines) {
      keptSegments.push(joinedLines);
    }
  }

  const droppedRatio = totalEvaluatedChars > 0 ? droppedChars / totalEvaluatedChars : 0;
  const cleanedReply = keptSegments.join('\n\n').trim();

  // If more than ~40% of the reply would be dropped, or a protected list/table in record mode had unsupported claims,
  // or nothing remains after dropping unsupported sentences, return the safe fallback.
  if (
    droppedClaims.length > 0 &&
    (droppedRatio > 0.40 || protectedBlockHasUnsupported || !cleanedReply)
  ) {
    return {
      reply: getSafeUnverifiedReply(language),
      verified: false,
      fallbackUsed: true,
      droppedClaims,
      droppedRatio
    };
  }

  return {
    reply: cleanedReply,
    verified: droppedClaims.length === 0,
    fallbackUsed: false,
    droppedClaims,
    droppedRatio
  };
}

module.exports = {
  verifyGrounding,
  extractClaims,
  buildEvidenceCorpus,
  stripUrlsOutsideCodeBlocks,
  getSafeUnverifiedReply,
  SAFE_UNVERIFIED_REPLY
};
