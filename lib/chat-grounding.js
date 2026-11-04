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
 * Extracts referenced record IDs from `<referenced_records>...</referenced_records>`,
 * `[REFERENCED_RECORDS: ...]`, and inline `[REF: ...]` / `[RESOURCE: ...]` / `[CARD: ...]` markers,
 * and returns the cleaned user-facing text with all reference metadata removed.
 *
 * @param {string} text
 * @returns {{ cleanText: string, referencedIds: string[] }}
 */
function extractReferencedRecords(text) {
  if (typeof text !== 'string') return { cleanText: '', referencedIds: [] };
  const ids = [];
  let cleanText = text;

  const pushTokens = (rawBlock) => {
    const lines = String(rawBlock || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const tokens = line
        .split(/[,\s]+/)
        .map(t => t.trim().replace(/^['"\[\]<>\(\)]+|['"\[\]<>\(\)]+$/g, ''))
        .filter(Boolean);
      ids.push(...tokens);
    }
  };

  // 1. XML-style <referenced_records>...</referenced_records> (and unclosed trailing <referenced_records>...)
  for (const m of cleanText.matchAll(/<referenced_records>([\s\S]*?)<\/referenced_records>/gi)) {
    pushTokens(m[1]);
  }
  cleanText = cleanText.replace(/<referenced_records>[\s\S]*?<\/referenced_records>/gi, '');

  const unclosedXml = cleanText.match(/<referenced_records>([\s\S]*)$/i);
  if (unclosedXml) {
    pushTokens(unclosedXml[1]);
    cleanText = cleanText.slice(0, unclosedXml.index);
  }

  // 2. Bracketed [REFERENCED_RECORDS: ...] (and unclosed trailing [REFERENCED_RECORDS: ...)
  for (const m of cleanText.matchAll(/\[REFERENCED_RECORDS\s*:\s*([\s\S]*?)\]/gi)) {
    pushTokens(m[1]);
  }
  cleanText = cleanText.replace(/\[REFERENCED_RECORDS\s*:[\s\S]*?\]/gi, '');

  const unclosedBracket = cleanText.match(/\[REFERENCED_RECORDS\s*:\s*([\s\S]*)$/i);
  if (unclosedBracket) {
    pushTokens(unclosedBracket[1]);
    cleanText = cleanText.slice(0, unclosedBracket.index);
  }

  // 3. Inline [REF: ...] / [RESOURCE: ...] / [CARD: ...]
  for (const m of cleanText.matchAll(/\[(?:REF|RESOURCE|CARD)\s*:\s*([^\]]+)\]/gi)) {
    pushTokens(m[1]);
  }
  cleanText = cleanText.replace(/\[(?:REF|RESOURCE|CARD)\s*:\s*[^\]]+\]/gi, '');

  return {
    cleanText: cleanText.trim(),
    referencedIds: [...new Set(ids)]
  };
}

const TRAILER_TAG_PREFIXES = [
  '<referenced_records>',
  '</referenced_records>',
  '[referenced_records:',
  '[ref:',
  '[resource:',
  '[card:'
];

/**
 * Checks whether the tail of `buffer` starts with a partial prefix of a reference tag
 * (e.g. `<`, `<ref`, `[REFERENCED_`, `[REF`), and returns the index where the potential
 * prefix begins, or -1 if no partial reference tag is at the tail.
 */
function findTrailingPartialTagIndex(buffer) {
  const maxPrefixLen = 24;
  const searchStart = Math.max(0, buffer.length - maxPrefixLen);
  for (let i = searchStart; i < buffer.length; i++) {
    const ch = buffer[i];
    if (ch !== '<' && ch !== '[') continue;
    const tail = buffer.slice(i).toLowerCase();
    for (const prefix of TRAILER_TAG_PREFIXES) {
      if (prefix.startsWith(tail)) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Creates a progressive streaming filter that strips `<referenced_records>...</referenced_records>`,
 * `[REFERENCED_RECORDS: ...]`, and `[REF: ...]` markers on the fly while streaming safe text
 * deltas immediately via `onSafeDelta`.
 */
function createReferenceTrailerStreamFilter({ onSafeDelta = () => {} } = {}) {
  let rawAccumulated = '';
  let pending = '';
  let streamedText = '';
  let inTrailerBlock = false;

  function emitSafe(text) {
    if (!text) return;
    streamedText += text;
    onSafeDelta(text);
  }

  function processPending(isFlush = false) {
    if (!pending) return;

    // Strip any complete inline [REF: ...], [RESOURCE: ...], [CARD: ...]
    pending = pending.replace(/\[(?:REF|RESOURCE|CARD)\s*:\s*[^\]]+\]/gi, '');

    if (inTrailerBlock) {
      pending = '';
      return;
    }

    // Check if a trailer block (<referenced_records or [REFERENCED_RECORDS:) has started (complete or unclosed) in `pending`
    const trailerStartMatch = pending.match(/<referenced_records\b|\[referenced_records\s*:/i);
    if (trailerStartMatch) {
      const beforeTrailer = pending.slice(0, trailerStartMatch.index).replace(/\s+$/, '');
      if (beforeTrailer) {
        emitSafe(beforeTrailer);
      }
      inTrailerBlock = true;
      pending = '';
      return;
    }

    // Check if an unclosed inline [REF: ...], [RESOURCE: ...], or [CARD: ...] has started
    const inlineStartMatch = pending.match(/\[(?:ref|resource|card)\s*:/i);
    if (inlineStartMatch) {
      const beforeInline = pending.slice(0, inlineStartMatch.index);
      if (beforeInline) {
        emitSafe(beforeInline);
      }
      if (isFlush) {
        // Unclosed inline marker at end of stream: discard the unclosed marker
        pending = '';
      } else {
        // Hold from `[REF:` until closing `]` arrives
        pending = pending.slice(inlineStartMatch.index);
      }
      return;
    }

    if (isFlush) {
      if (pending.trim()) {
        emitSafe(pending);
      }
      pending = '';
      return;
    }

    // Check if the tail of `pending` could be a partial prefix of `<referenced_records` or `[REFERENCED_RECORDS:`
    const partialIdx = findTrailingPartialTagIndex(pending);
    if (partialIdx === 0) {
      // Whole pending string is a short partial tag prefix; hold until next token
      return;
    }
    if (partialIdx > 0) {
      const safePart = pending.slice(0, partialIdx);
      emitSafe(safePart);
      pending = pending.slice(partialIdx);
      return;
    }

    // Hold back trailing whitespace right before a potential newline trailer block only if it's purely trailing newlines
    const trailingNewlinesMatch = pending.match(/(\r?\n\s*)$/);
    if (trailingNewlinesMatch && pending.length > trailingNewlinesMatch[1].length) {
      const safeBody = pending.slice(0, pending.length - trailingNewlinesMatch[1].length);
      emitSafe(safeBody);
      pending = trailingNewlinesMatch[1];
      return;
    }
    if (!trailingNewlinesMatch) {
      emitSafe(pending);
      pending = '';
    }
  }

  function feed(chunk) {
    if (!chunk || typeof chunk !== 'string') return;
    rawAccumulated += chunk;
    if (inTrailerBlock) return;
    pending += chunk;
    processPending(false);
  }

  function flush({ emitRemaining = true } = {}) {
    if (!inTrailerBlock && pending) {
      if (emitRemaining) {
        processPending(true);
      } else {
        pending = '';
      }
    }
    const { cleanText, referencedIds } = extractReferencedRecords(rawAccumulated);
    return {
      rawText: rawAccumulated,
      cleanText,
      referencedIds,
      streamedText
    };
  }

  return {
    feed,
    push: feed,
    flush,
    getStreamedText: () => streamedText,
    getRawText: () => rawAccumulated
  };
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
      // Handle nested tool results (e.g. { name, result: { files, courses, routine, notices, posts, assignments, subjects, results, ... } })
      const inner = item.result || item;
      for (const listKey of ['files', 'courses', 'routine', 'notices', 'posts', 'assignments', 'subjects', 'results', 'semesters', 'chapters', 'teachers', 'assignedTeachers', 'questions', 'releasedGrades', 'submissions', 'exams', 'recentHistory', 'pageNumbers', 'passages']) {
        if (Array.isArray(inner[listKey])) {
          parts.push(buildEvidenceCorpus(inner[listKey]));
        }
      }
      for (const objKey of ['file', 'overall', 'matchedSubject', 'studentSubmission', 'summary', 'attendance', 'marks', 'assignmentSummary']) {
        if (inner[objKey] && typeof inner[objKey] === 'object') {
          parts.push(buildEvidenceCorpus([inner[objKey]]));
        }
      }
      if (typeof inner.summaryText === 'string') {
        parts.push(inner.summaryText);
      }
      try {
        parts.push(JSON.stringify(inner));
      } catch (_) {}
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

  // 4. Record-mode only: Clock times and Numbers with campus/campus units
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
  extractReferencedRecords,
  createReferenceTrailerStreamFilter,
  getSafeUnverifiedReply,
  SAFE_UNVERIFIED_REPLY
};
