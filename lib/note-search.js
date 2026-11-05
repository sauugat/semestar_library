'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeDevanagariDigits } = require('./nepali-dates');

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 1_000_000;
const MAX_PDF_PAGES = 500;
const MAX_DOCX_EXPANDED_BYTES = 60 * 1024 * 1024;
const INDEX_TIMEOUT_MS = 20_000;
const indexPromises = new WeakMap();
const searchCaches = new WeakMap();
const ROMANS = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];

function normalizeSemester(value) {
  if (value === null || value === undefined || value === '') return null;
  const cleaned = normalizeDevanagariDigits(String(value)).toLowerCase().trim()
    .replace(/\b(semester|sem)\b|सेमेस्टर|सेम/g, '').trim().replace(/^(\d)(st|nd|rd|th)$/, '$1');
  if (/^[1-8]$/.test(cleaned)) return Number(cleaned);
  const index = ROMANS.slice(0, 8).indexOf(cleaned);
  if (index !== -1) return index + 1;
  const ordinal = ORDINALS.slice(0, 8).indexOf(cleaned);
  return ordinal === -1 ? null : ordinal + 1;
}

function semesterAliases(number) {
  const n = String(number);
  const roman = ROMANS[number - 1];
  const ordinal = ORDINALS[number - 1];
  const suffix = number === 1 ? 'st' : number === 2 ? 'nd' : number === 3 ? 'rd' : 'th';
  return [n, roman, ordinal, `${n}${suffix}`, `semester ${n}`, `semester ${roman}`, `semester ${ordinal}`,
    `sem ${n}`, `sem ${roman}`, `${n}${suffix} semester`, `${ordinal} semester`, `${roman} semester`, `${n} semester`];
}

/**
 * Parses a chapter filter value into a structured descriptor:
 * - number: integer chapter/unit number if present (e.g., "Chapter 2", "Unit IV", "अध्याय ३", "2" -> 2)
 * - text: normalized chapter title/keyword if non-numeric text is present
 */
function parseChapterFilter(chapterInput) {
  if (chapterInput === null || chapterInput === undefined) return null;
  const raw = normalizeDevanagariDigits(String(chapterInput)).trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/^(?:chapter|chap|ch|unit|module|part|अध्याय|युनिट|एकाइ)\s*(?:no\.?|number|#|:|-)?\s*/i, '')
    .trim();

  if (/^\d{1,2}$/.test(cleaned)) {
    return { raw, number: Number(cleaned), text: null };
  }

  const romanIdx = ROMANS.indexOf(cleaned.toLowerCase());
  if (romanIdx !== -1) {
    return { raw, number: romanIdx + 1, text: null };
  }

  const ordIdx = ORDINALS.indexOf(cleaned.toLowerCase());
  if (ordIdx !== -1) {
    return { raw, number: ordIdx + 1, text: null };
  }

  const numPrefix = cleaned.match(/^(\d{1,2})\b(?:\s*[:.-]?\s*(.*))?$/);
  if (numPrefix) {
    return {
      raw,
      number: Number(numPrefix[1]),
      text: numPrefix[2] ? numPrefix[2].trim().toLowerCase() : null
    };
  }

  return { raw, number: null, text: cleaned.toLowerCase() };
}

/**
 * Checks whether a file's `chapter` column matches a parsed chapter filter.
 */
function matchesChapter(fileChapter, parsedChapter) {
  if (!parsedChapter) return true;
  const rawFileChap = normalizeDevanagariDigits(String(fileChapter || '')).trim();
  if (!rawFileChap) return false;

  const parsedFileChap = parseChapterFilter(rawFileChap);
  const lowerFileChap = rawFileChap.toLowerCase();

  if (parsedChapter.number !== null) {
    if (parsedFileChap && parsedFileChap.number === parsedChapter.number) {
      if (parsedChapter.text) {
        return lowerFileChap.includes(parsedChapter.text);
      }
      return true;
    }
    const n = parsedChapter.number;
    const roman = ROMANS[n - 1];
    const numPattern = new RegExp(`(?:^|\\b)(?:chapter|chap|ch|unit|module|part)?\\s*0*${n}(?:\\b|:|$)`, 'i');
    if (numPattern.test(rawFileChap)) return true;
    if (roman && new RegExp(`\\b(?:chapter|chap|ch|unit|module|part)\\s+${roman}\\b`, 'i').test(rawFileChap)) {
      return true;
    }
    return false;
  }

  if (parsedChapter.text) {
    return lowerFileChap.includes(parsedChapter.text);
  }

  return false;
}

/** Creates a persistent content index using the application's configured database. */
async function ensureIndex(db) {
  if (!db) return;
  if (indexPromises.has(db)) return indexPromises.get(db);
  const promise = (async () => {
    const ddl = `
      CREATE TABLE IF NOT EXISTS note_search_documents (
        id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
        content TEXT NOT NULL DEFAULT '',
        extraction_status TEXT NOT NULL,
        extraction_error TEXT,
        indexed_at TEXT NOT NULL,
        content_truncated INTEGER NOT NULL DEFAULT 0
        ${db.isPostgres ? ", search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED" : ''}
      );
      ${db.isPostgres ? `
        CREATE INDEX IF NOT EXISTS note_search_content_gin ON note_search_documents USING GIN (search_vector);
      ` : `
        CREATE VIRTUAL TABLE IF NOT EXISTS note_search_fts USING fts5(
          content, content='note_search_documents', content_rowid='id', tokenize='porter unicode61'
        );
        CREATE TRIGGER IF NOT EXISTS note_search_insert AFTER INSERT ON note_search_documents BEGIN
          INSERT INTO note_search_fts(rowid, content) VALUES (new.id, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS note_search_delete AFTER DELETE ON note_search_documents BEGIN
          INSERT INTO note_search_fts(note_search_fts, rowid, content) VALUES ('delete', old.id, old.content);
        END;
        CREATE TRIGGER IF NOT EXISTS note_search_update AFTER UPDATE ON note_search_documents BEGIN
          INSERT INTO note_search_fts(note_search_fts, rowid, content) VALUES ('delete', old.id, old.content);
          INSERT INTO note_search_fts(rowid, content) VALUES (new.id, new.content);
        END;
      `}
    `;
    if (typeof db.exec === 'function') {
      await db.exec(ddl);
    } else if (typeof db.query === 'function') {
      await db.query(ddl);
    } else if (db.client && typeof db.client.executeMultiple === 'function') {
      await db.client.executeMultiple(ddl);
    } else if (typeof db.run === 'function') {
      await db.run(`
        CREATE TABLE IF NOT EXISTS note_search_documents (
          id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
          content TEXT NOT NULL DEFAULT '',
          extraction_status TEXT NOT NULL,
          extraction_error TEXT,
          indexed_at TEXT NOT NULL,
          content_truncated INTEGER NOT NULL DEFAULT 0
        )
      `);
      try {
        await db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS note_search_fts USING fts5(content, content='note_search_documents', content_rowid='id', tokenize='porter unicode61')`);
      } catch (_) {}
    }
  })().catch(error => {
    indexPromises.delete(db);
    throw error;
  });
  indexPromises.set(db, promise);
  return promise;
}

function invalidateSearchCache(db) {
  searchCaches.delete(db);
}

function extractionError(status, message) {
  return Object.assign(new Error(message), { extractionStatus: status });
}

function approvedStorageUrl(storedName) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!supabaseUrl) return null;
  let base;
  try { base = new URL(supabaseUrl); } catch { return null; }
  if (base.protocol !== 'https:' || base.username || base.password) return null;
  const prefix = '/storage/v1/object/public/library_files/';
  if (/^https?:\/\//i.test(storedName)) {
    const url = new URL(storedName);
    if (url.origin !== base.origin || !url.pathname.startsWith(prefix) || url.username || url.password) {
      throw extractionError('error', 'The file storage URL is not approved.');
    }
    return url;
  }
  return new URL(prefix + storedName.split('/').map(encodeURIComponent).join('/'), base.origin);
}

async function downloadBuffer(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(INDEX_TIMEOUT_MS), redirect: 'error' });
  if (!response.ok) throw extractionError('error', `File storage returned HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length')) > MAX_FILE_BYTES) {
    await response.body?.cancel();
    throw extractionError('too_large', 'File exceeds the 20 MB extraction limit.');
  }
  if (!response.body) throw extractionError('error', 'File storage returned an empty response.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MAX_FILE_BYTES) throw extractionError('too_large', 'File exceeds the 20 MB extraction limit.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readFileBytes(db, file, suppliedBuffer) {
  if (Number(file.sizeBytes) > MAX_FILE_BYTES) throw extractionError('too_large', 'File exceeds the 20 MB extraction limit.');
  if (suppliedBuffer !== undefined) {
    const buffer = Buffer.isBuffer(suppliedBuffer) ? suppliedBuffer : Buffer.from(suppliedBuffer);
    if (buffer.length > MAX_FILE_BYTES) throw extractionError('too_large', 'File exceeds the 20 MB extraction limit.');
    return buffer;
  }
  const storedName = String(file.storedName || '');
  if (!storedName || storedName.length > 1024) throw extractionError('error', 'No valid stored filename is available.');
  if (/^https?:\/\//i.test(storedName)) {
    const url = approvedStorageUrl(storedName);
    if (!url) throw extractionError('error', 'The file storage URL is not approved.');
    return downloadBuffer(url);
  }
  if (path.isAbsolute(storedName) || storedName.includes('\\') || storedName.includes('\0') || storedName.split('/').some(part => part === '..' || part === '.')) {
    throw extractionError('error', 'The stored filename is invalid.');
  }
  const uploadRoot = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, '..', 'uploads');
  try {
    const localPath = path.join(uploadRoot, storedName);
    const actualPath = await fs.realpath(localPath);
    const actualRoot = await fs.realpath(uploadRoot);
    if (!actualPath.startsWith(actualRoot + path.sep)) throw extractionError('error', 'The stored file path is invalid.');
    const stat = await fs.stat(actualPath);
    if (stat.size > MAX_FILE_BYTES) throw extractionError('too_large', 'File exceeds the 20 MB extraction limit.');
    const buffer = await fs.readFile(actualPath);
    if (buffer.length > MAX_FILE_BYTES) throw extractionError('too_large', 'File exceeds the 20 MB extraction limit.');
    return buffer;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (typeof db?.getFileBlob === 'function') {
    const blob = await db.getFileBlob(storedName);
    const rawBlob = blob?.fileData || blob?.buffer || blob?.data || null;
    if (rawBlob) {
      if (rawBlob.byteLength > MAX_FILE_BYTES) throw extractionError('too_large', 'File exceeds the 20 MB extraction limit.');
      return Buffer.from(rawBlob);
    }
  }
  const url = approvedStorageUrl(storedName);
  if (url) return downloadBuffer(url);
  throw extractionError('error', 'The original file is unavailable in local or persistent storage.');
}

// Inspect central-directory sizes before Mammoth inflates a DOCX archive.
function checkDocxSize(buffer) {
  const min = Math.max(0, buffer.length - 65557);
  let end = -1;
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw extractionError('error', 'The DOCX archive is invalid.');
  let cursor = buffer.readUInt32LE(end + 16);
  const entries = buffer.readUInt16LE(end + 10);
  if (entries === 65535 || cursor === 0xffffffff) throw extractionError('too_large', 'ZIP64 documents are not supported for text extraction.');
  let expanded = 0;
  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw extractionError('error', 'The DOCX archive is invalid.');
    }
    expanded += buffer.readUInt32LE(cursor + 24);
    if (expanded > MAX_DOCX_EXPANDED_BYTES) throw extractionError('too_large', 'The expanded DOCX exceeds the text extraction limit.');
    cursor += 46 + buffer.readUInt16LE(cursor + 28) + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
  }
}

async function extractText(buffer, originalName) {
  const extension = path.extname(String(originalName || '')).toLowerCase();
  let text = '';
  let truncated = false;
  if (extension === '.pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, verbosity: 0 });
    let timer;
    try {
      const extraction = (async () => {
        const pdf = await loadingTask.promise;
        truncated = pdf.numPages > MAX_PDF_PAGES;
        for (let i = 1; i <= Math.min(pdf.numPages, MAX_PDF_PAGES); i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map(item => item.str || '').join(' ') + (i < pdf.numPages ? '\f' : '');
          page.cleanup();
          if (text.length > MAX_TEXT_CHARS) { truncated = true; break; }
        }
      })();
      await Promise.race([extraction, new Promise((_, reject) => {
        timer = setTimeout(() => reject(extractionError('error', 'PDF text extraction timed out.')), INDEX_TIMEOUT_MS);
      })]);
    } finally {
      clearTimeout(timer);
      await loadingTask.destroy();
    }
  } else if (extension === '.pptx') {
    checkDocxSize(buffer);
    const os = require('node:os');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kyana-slides-'));
    try {
      const location = path.join(dir, 'slides.pptx');
      await fs.writeFile(location, buffer, { mode: 0o600 });
      const Parser = require('node-pptx-parser').default;
      const slides = await new Parser(location).extractText();
      text = slides.slice(0, MAX_PDF_PAGES).map(s => s.text.join('\n')).join('\f');
      truncated = slides.length > MAX_PDF_PAGES;
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  } else if (extension === '.docx') {
    checkDocxSize(buffer);
    const mammoth = require('mammoth');
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (['.txt', '.md', '.csv'].includes(extension)) {
    text = buffer.toString('utf8');
  } else {
    throw extractionError('unsupported', 'Text extraction supports PDF, DOCX, PPTX, TXT, Markdown, and CSV files.');
  }
  truncated = truncated || text.length > MAX_TEXT_CHARS;
  text = text.slice(0, MAX_TEXT_CHARS).replace(/\0/g, '').replace(/[\t\r ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { text, truncated };
}

/** Index upload bytes immediately, or resolve an existing note from its persistent storage. */
async function indexNote(db, file, { buffer } = {}) {
  await ensureIndex(db);
  if (!Number.isSafeInteger(Number(file?.id)) || Number(file.id) < 1) throw new Error('A valid file id is required.');
  let content = '';
  let status = 'indexed';
  let error = null;
  let truncated = false;
  try {
    const extension = path.extname(String(file.originalName || file.storedName || '')).toLowerCase();
    if (!['.pdf', '.docx', '.pptx', '.txt', '.md', '.csv'].includes(extension)) {
      throw extractionError('unsupported', 'This file format does not support text extraction.');
    }
    const bytes = await readFileBytes(db, file, buffer);
    const extracted = await extractText(bytes, file.originalName || file.storedName);
    content = extracted.text;
    truncated = extracted.truncated;
    if (!content) {
      status = 'empty';
      error = extension === '.pdf' ? 'No readable text found; scanned PDFs require OCR.' : 'No readable text found.';
    }
  } catch (failure) {
    status = failure.extractionStatus || 'error';
    error = failure.extractionStatus ? failure.message : 'The file could not be read or its text could not be extracted.';
  }
  await db.run(`
    INSERT INTO note_search_documents (id, content, extraction_status, extraction_error, indexed_at, content_truncated)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET content = excluded.content, extraction_status = excluded.extraction_status,
      extraction_error = excluded.extraction_error, indexed_at = excluded.indexed_at, content_truncated = excluded.content_truncated
  `, Number(file.id), content, status, error, new Date().toISOString(), truncated ? 1 : 0);
  invalidateSearchCache(db);
  if (db.isPostgres && require('./knowledge-schema').isKnowledgeIndexingEnabled()) {
    await require('./knowledge-sync').enqueueJob(db, `note:${file.id}`, 'note', 'index');
  }
  return { status, chars: content.length, truncated, ...(error ? { error } : {}) };
}

async function removeNoteIndex(db, id) {
  await ensureIndex(db);
  await db.run('DELETE FROM note_search_documents WHERE id = ?', Number(id));
  invalidateSearchCache(db);
  try {
    if (require('./knowledge-schema').isKnowledgeIndexingEnabled()) {
      await require('./knowledge-sync').onNoteDeleted(db, Number(id));
    }
  } catch (_) {}
}

function getFilters({ semester, subject }) {
  const where = [];
  const params = [];
  if (semester !== undefined && semester !== null && semester !== '') {
    const number = normalizeSemester(semester);
    if (!number) return null; // An invalid explicit filter must never broaden results.
    const aliases = semesterAliases(number);
    where.push(`(f.semester_no = ? OR LOWER(TRIM(COALESCE(f.semester, ''))) IN (${aliases.map(() => '?').join(',')}))`);
    params.push(number, ...aliases);
  }
  const subjects = (Array.isArray(subject) ? subject : [subject])
    .filter(value => typeof value === 'string' && value.trim()).map(value => value.trim().toLowerCase());
  if (subject !== undefined && subject !== null && !subjects.length) return null;
  if (subjects.length) {
    where.push(`LOWER(TRIM(f.subject)) IN (${subjects.map(() => '?').join(',')})`);
    params.push(...subjects);
  }
  return { where, params, subjects };
}

/**
 * Unifies query tokenization with `lib/knowledge-relevance.js` (`academicSearchTerms`).
 */
function queryTokens(query, { stripTerms = [] } = {}) {
  const { academicSearchTerms } = require('./knowledge-relevance');
  return academicSearchTerms(query, { stripTerms }).slice(0, 12);
}

function metadataRank(file, tokens) {
  const phrase = tokens.join(' ');
  const title = String(file.title || '').toLowerCase();
  const subject = String(file.subject || '').toLowerCase();
  const chapter = String(file.chapter || '').toLowerCase();
  const originalName = String(file.originalName || '').toLowerCase().replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  if (!phrase) return 1;
  if (title === phrase) return 1000;
  if (subject === phrase) return 950;
  if (originalName === phrase) return 900;
  return (title.includes(phrase) ? 75 : 0) + (originalName.includes(phrase) ? 60 : 0) +
    (subject.includes(phrase) ? 45 : 0) + (chapter.includes(phrase) ? 35 : 0) +
    tokens.reduce((score, token) => score + (title.includes(token) ? 6 : 0) + (chapter.includes(token) ? 4 : 0), 0);
}

/**
 * Detects whether a passage looks like a Table of Contents (TOC), index, or navigation outline
 * rather than explanatory academic content.
 */
function isTocOrIndexPassage(text) {
  if (!text) return false;
  const s = String(text);
  // 1. Explicit Table of Contents header
  const hasTocHeader = /\b(table\s+of\s+contents?|contents?\s+page|list\s+of\s+(?:topics|chapters|figures|tables)|course\s+outline\s+index)\b/i.test(s);
  // 2. Dotted leader lines connecting topics to page numbers (e.g., "1.2 Deadlock ......... 14" or "Normalization . . . . 8")
  const dottedLeaders = (s.match(/(?:\.{3,}|…{2,}|(?:\.\s){3,})\s*\d{1,4}\b/g) || []).length;
  // 3. Multiple lines ending with standalone page numbers (e.g., "Chapter 3: Deadlock — Page 15" or "3.1 Deadlock Prevention 16")
  const pageNumberLines = (s.match(/(?:^|\n)\s*(?:(?:chapter|unit|section|\d+(?:\.\d+)*)\b[^\n]{3,65}?(?:page\s*\d{1,4}|\.{2,}\s*\d{1,4}|\s+\d{1,3}))\s*(?=\n|$)/gi) || []).length;

  if (dottedLeaders >= 2) return true;
  if (hasTocHeader && (dottedLeaders >= 1 || pageNumberLines >= 2)) return true;
  if (hasTocHeader && !/\b(is\s+defined\s+as|refers\s+to|means\s+that|occurs\s+when|because|therefore|for\s+example|such\s+as)\b/i.test(s)) {
    return true;
  }
  if (pageNumberLines >= 4 && dottedLeaders >= 1) return true;
  return false;
}

/**
 * Splits raw document content into page segments while preserving original page numbers.
 * Never fabricates page numbers for single-page unpaginated documents.
 */
function splitDocumentPages(rawContent) {
  const raw = String(rawContent || '');
  if (!raw.trim()) return [];

  if (raw.includes('\f')) {
    const parts = raw.split('\f');
    const hasMulti = parts.length > 1;
    return parts
      .map((pageText, idx) => ({
        pageNumber: hasMulti ? idx + 1 : null,
        text: pageText.replace(/[\t\r ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
      }))
      .filter(p => p.text.length > 0);
  }

  return [{
    pageNumber: null,
    text: raw.replace(/[\t\r ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  }];
}

/**
 * Builds candidate windows (~750–900 chars) across all pages of a document.
 */
function buildCandidateWindows(pages, windowSize = 850, stepSize = 480) {
  const candidates = [];
  for (const page of pages) {
    const text = page.text;
    if (text.length <= windowSize + 120) {
      candidates.push({
        pageNumber: page.pageNumber,
        startOffset: 0,
        endOffset: text.length,
        text
      });
      continue;
    }

    let offset = 0;
    while (offset < text.length) {
      let end = Math.min(text.length, offset + windowSize);
      if (end < text.length) {
        // Snap end to a clean sentence or paragraph boundary if possible
        const lookahead = text.slice(offset, Math.min(text.length, offset + windowSize + 100));
        const lastNewline = lookahead.lastIndexOf('\n');
        const lastPeriod = lookahead.lastIndexOf('. ');
        if (lastNewline > windowSize * 0.65) {
          end = offset + lastNewline;
        } else if (lastPeriod > windowSize * 0.65) {
          end = offset + lastPeriod + 1;
        }
      }

      const sliceText = text.slice(offset, end).trim();
      if (sliceText.length >= 40) {
        candidates.push({
          pageNumber: page.pageNumber,
          startOffset: offset,
          endOffset: end,
          text: sliceText
        });
      }

      if (end >= text.length) break;
      // Advance offset to next sentence/paragraph start near offset + stepSize
      let nextStart = offset + stepSize;
      const boundarySearch = text.slice(Math.max(offset + 100, nextStart - 80), Math.min(text.length, nextStart + 80));
      const nlIdx = boundarySearch.indexOf('\n');
      const dotIdx = boundarySearch.indexOf('. ');
      if (nlIdx !== -1) {
        nextStart = Math.max(offset + 100, nextStart - 80) + nlIdx + 1;
      } else if (dotIdx !== -1) {
        nextStart = Math.max(offset + 100, nextStart - 80) + dotIdx + 2;
      }
      offset = Math.max(offset + 120, nextStart);
    }
  }
  return candidates;
}

/**
 * Scores a candidate passage against query tokens.
 * Rewards distinct query-term coverage, exact phrase proximity, term density, and explanatory prose,
 * while heavily deprioritizing Table of Contents / index passages.
 */
function scorePassageCandidate(candidate, lowerTokens) {
  const text = candidate.text;
  const lower = text.toLowerCase();
  const wordTokens = lower.match(/[\p{L}\p{M}\p{N}]+/gu) || [];
  const wordSet = new Set(wordTokens);

  let matchedDistinct = 0;
  let totalOccurrences = 0;
  const firstPositions = [];

  for (const token of lowerTokens) {
    let count = 0;
    if (token.length <= 2) {
      for (const w of wordTokens) {
        if (w === token) count++;
      }
      if (count > 0) {
        matchedDistinct++;
        totalOccurrences += Math.min(count, 6);
        const pos = lower.indexOf(token);
        if (pos >= 0) firstPositions.push(pos);
      }
    } else {
      let idx = lower.indexOf(token);
      while (idx !== -1) {
        count++;
        if (count === 1) firstPositions.push(idx);
        idx = lower.indexOf(token, idx + token.length);
      }
      if (count > 0 || wordSet.has(token)) {
        matchedDistinct++;
        totalOccurrences += Math.min(Math.max(count, 1), 6);
      }
    }
  }

  if (matchedDistinct === 0) return 0;

  // 1. Distinct token coverage (highest priority)
  const coverageScore = (matchedDistinct / lowerTokens.length) * 100;

  // 2. Term frequency & density score
  const densityScore = Math.min(totalOccurrences, 12) * 8 + (totalOccurrences / Math.max(wordTokens.length, 25)) * 120;

  // 3. Phrase & proximity bonus
  let proximityBonus = 0;
  if (lowerTokens.length >= 2) {
    const phrase = lowerTokens.join(' ');
    if (lower.includes(phrase)) {
      proximityBonus += 45;
    } else if (firstPositions.length >= 2) {
      const span = Math.max(...firstPositions) - Math.min(...firstPositions);
      if (span <= 120) proximityBonus += 25;
      else if (span <= 250) proximityBonus += 12;
    }
  }

  // 4. Explanatory prose bonus (definitions, explanations, examples, complete sentences)
  let explanatoryBonus = 0;
  if (/\b(is\s+defined\s+as|refers\s+to|is\s+a\s+[a-z]+|means\s+that|occurs\s+when|allows?\s+[a-z]+|consists\s+of|for\s+example|such\s+as|types\s+of|conditions\s+for|steps|advantages|disadvantages|algorithm|working)\b/i.test(text)) {
    explanatoryBonus += 28;
  }
  const sentenceCount = (text.match(/[.!?](\s|$)/g) || []).length;
  if (sentenceCount >= 2) {
    explanatoryBonus += Math.min(sentenceCount * 4, 20);
  }

  let rawScore = coverageScore + densityScore + proximityBonus + explanatoryBonus;

  // 5. Deprioritize Table of Contents / navigation outlines
  const isToc = isTocOrIndexPassage(text);
  if (isToc) {
    rawScore *= 0.15;
  }

  return rawScore;
}

/**
 * Computes Jaccard similarity of word sets between two passages to prevent near-duplicate selection.
 */
function passageSimilarity(textA, textB) {
  const wordsA = new Set((String(textA || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []));
  const wordsB = new Set((String(textB || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  return intersection / (wordsA.size + wordsB.size - intersection);
}

/**
 * Scores multiple passages across the entire document, deprioritizes TOC/navigation blocks,
 * deduplicates overlapping/near-identical windows, and returns the top 2–3 relevant passages
 * with original page numbers preserved.
 *
 * @param {string} content Raw document text (with `\f` page breaks if multi-page)
 * @param {string[]} [tokens=[]] Search tokens
 * @param {object} [options]
 * @param {number} [options.maxChars=2400] Max total characters across returned passages
 * @param {number} [options.maxPassages=3] Max number of distinct passages to return
 * @returns {{ text: string, passages: Array<{ pageNumber: number|null, text: string, score: number }>, pageNumbers: number[] }}
 */
function extractRelevantPassages(content, tokens = [], { maxChars = 2400, maxPassages = 3 } = {}) {
  if (!content || typeof content !== 'string' || !content.trim()) {
    return { text: '', passages: [], pageNumbers: [] };
  }

  const pages = splitDocumentPages(content);
  if (pages.length === 0) {
    return { text: '', passages: [], pageNumbers: [] };
  }

  const cleanTokens = (Array.isArray(tokens) ? tokens : queryTokens(String(tokens || '')))
    .map(t => String(t || '').toLowerCase().trim())
    .filter(Boolean);

  // If document is short and fits within maxChars on a single page, return it directly
  const totalDocLength = pages.reduce((acc, p) => acc + p.text.length, 0);
  if (totalDocLength <= maxChars && pages.length === 1) {
    const singlePage = pages[0];
    return {
      text: singlePage.text,
      passages: [{ pageNumber: singlePage.pageNumber, text: singlePage.text, score: 100 }],
      pageNumbers: singlePage.pageNumber ? [singlePage.pageNumber] : []
    };
  }

  const perPassageWindow = Math.min(950, Math.max(550, Math.floor(maxChars / Math.min(maxPassages, 2))));
  const candidates = buildCandidateWindows(pages, perPassageWindow, Math.floor(perPassageWindow * 0.55));

  // If no tokens provided (e.g., browsing a chapter's note), prefer first non-TOC explanatory windows
  if (cleanTokens.length === 0) {
    const nonToc = candidates.filter(c => !isTocOrIndexPassage(c.text));
    const pool = nonToc.length > 0 ? nonToc : candidates;
    const chosen = pool.slice(0, Math.min(2, maxPassages));
    const formatted = formatSelectedPassages(chosen, maxChars);
    return formatted;
  }

  // Score all candidates
  const scored = candidates
    .map((c, idx) => ({
      ...c,
      idx,
      score: scorePassageCandidate(c, cleanTokens)
    }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score || a.idx - b.idx);

  if (scored.length === 0) {
    const nonToc = candidates.filter(c => !isTocOrIndexPassage(c.text));
    const fallbackPool = nonToc.length > 0 ? nonToc : candidates;
    return formatSelectedPassages(fallbackPool.slice(0, 1), maxChars);
  }

  // Greedily pick top 2–3 non-overlapping, non-duplicate passages
  const selected = [];
  let accumulatedChars = 0;

  for (const cand of scored) {
    if (selected.length >= maxPassages) break;

    // Check overlap on same page or high Jaccard similarity with already selected passages
    const isDuplicateOrOverlapping = selected.some(sel => {
      if (sel.pageNumber !== null && sel.pageNumber === cand.pageNumber) {
        const overlapStart = Math.max(sel.startOffset, cand.startOffset);
        const overlapEnd = Math.min(sel.endOffset, cand.endOffset);
        if (overlapEnd > overlapStart) return true;
      }
      return passageSimilarity(sel.text, cand.text) >= 0.70;
    });

    if (isDuplicateOrOverlapping) continue;

    // Stop adding secondary passages if score is < 25% of top passage score (avoid noise)
    if (selected.length > 0 && cand.score < selected[0].score * 0.25) continue;

    if (selected.length > 0 && accumulatedChars + cand.text.length > maxChars + 200) {
      continue;
    }

    selected.push(cand);
    accumulatedChars += cand.text.length;
  }

  return formatSelectedPassages(selected, maxChars);
}

function formatSelectedPassages(selected, maxChars) {
  if (!selected || selected.length === 0) {
    return { text: '', passages: [], pageNumbers: [] };
  }

  const pageNumbers = [...new Set(selected.map(p => p.pageNumber).filter(n => Number.isInteger(n) && n > 0))];
  const formattedParts = [];
  const finalPassages = [];
  let remainingChars = maxChars;

  for (const p of selected) {
    if (remainingChars <= 80) break;
    const prefix = p.pageNumber ? `[Page ${p.pageNumber}] ` : '';
    const availableForBody = Math.max(80, remainingChars - prefix.length);
    const bodyText = p.text.length > availableForBody
      ? `${p.text.slice(0, availableForBody).trim()}…`
      : p.text;
    formattedParts.push(`${prefix}${bodyText}`);
    finalPassages.push({
      pageNumber: p.pageNumber || null,
      text: bodyText,
      score: Number((p.score || 0).toFixed(2))
    });
    remainingChars -= (prefix.length + bodyText.length + 4);
  }

  return {
    text: formattedParts.join('\n\n'),
    passages: finalPassages,
    pageNumbers
  };
}

/**
 * Backward-compatible string wrapper around `extractRelevantPassages`.
 */
function extractRelevantPassage(content, tokens = [], maxChars = 2000) {
  const result = extractRelevantPassages(content, tokens, { maxChars, maxPassages: 3 });
  return result.text;
}

function excerptFor(content, tokens) {
  const best = extractRelevantPassages(content, tokens, { maxChars: 320, maxPassages: 1 });
  if (best.text) {
    return best.text.length > 320 ? `${best.text.slice(0, 320)}…` : best.text;
  }
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

/**
 * Returns at most 3 file rows plus matchType, score, excerpt, extractedContent, passages, and pageNumbers.
 * Supports optional `chapter` filter and bilingual query tokens.
 */
async function searchNotes(db, { query = '', semester, subject, chapter = null, excludeIds = [], limit = 3, searchAllSemesters = false, academicContext } = {}) {
  if (!db) return [];
  const filters = getFilters({ semester: searchAllSemesters ? undefined : semester, subject });
  if (!filters) return [];
  const parsedChapter = parseChapterFilter(chapter);
  const excludeSet = new Set(
    (Array.isArray(excludeIds) ? excludeIds : [])
      .map(id => Number(String(id).replace(/^note:/i, '')))
      .filter(n => Number.isFinite(n) && n > 0)
  );
  const maxReturn = Math.max(1, Math.min(Number(limit) || 3, 20));
  const normalizedRequestedSem = searchAllSemesters ? null : normalizeSemester(semester);

  if (academicContext) {
    const access = require('./kyana-access').resourceFilter(academicContext, 'note', 'f', {
      requestedSemester: normalizedRequestedSem,
      searchAllSemesters: Boolean(searchAllSemesters)
    });
    filters.where.push(`(${access.sql})`);
    filters.params.push(...access.params);
  }
  let cleanedQuery = String(query || '');
  if (normalizedRequestedSem) {
    const aliases = semesterAliases(normalizedRequestedSem).filter(alias => /semester|sem /.test(alias));
    for (const alias of aliases.sort((a, b) => b.length - a.length)) {
      cleanedQuery = cleanedQuery.replace(new RegExp(`\\b${alias}\\b`, 'gi'), ' ');
    }
  }
  let tokens = queryTokens(cleanedQuery, { stripTerms: filters.subjects });
  if (!tokens.length && !filters.subjects.length && !parsedChapter) return [];
  await ensureIndex(db);
  let cache = searchCaches.get(db);
  if (!cache) { cache = new Map(); searchCaches.set(db, cache); }
  const ctxKey = academicContext ? require('./chat-security').contextKey(academicContext) : 'unscoped';
  const key = JSON.stringify([tokens, normalizedRequestedSem, Boolean(searchAllSemesters), filters.subjects, parsedChapter?.raw || null, [...excludeSet].sort((a, b) => a - b), maxReturn, ctxKey]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.rows.map(row => ({ ...row }));

  const fields = ['f.title', 'f.originalName', 'f.subject', 'f.chapter'];
  const metadataWhere = [...filters.where];
  const metadataParams = [...filters.params];

  if (tokens.length > 0) {
    if (tokens.length <= 2) {
      for (const token of tokens) {
        metadataWhere.push(`(${fields.map(field => `LOWER(COALESCE(${field}, '')) LIKE ?`).join(' OR ')})`);
        metadataParams.push(...fields.map(() => `%${token}%`));
      }
    } else {
      // For 3+ tokens, match any file that contains at least one token in SQL and rank by token coverage in JS
      const orClauses = tokens.map(() => `(${fields.map(field => `LOWER(COALESCE(${field}, '')) LIKE ?`).join(' OR ')})`);
      metadataWhere.push(`(${orClauses.join(' OR ')})`);
      for (const token of tokens) {
        metadataParams.push(...fields.map(() => `%${token}%`));
      }
    }
  }

  const phrase = tokens.join(' ');
  const whereClause = metadataWhere.length > 0 ? `WHERE ${metadataWhere.join(' AND ')}` : '';
  const metadata = await db.all(
    `SELECT f.*, d.content AS document_content, d.extraction_status
     FROM files f
     LEFT JOIN note_search_documents d ON d.id = f.id
     ${whereClause}
     ORDER BY CASE WHEN LOWER(COALESCE(f.title, '')) = ? THEN 0
       WHEN LOWER(COALESCE(f.subject, '')) = ? THEN 1 ELSE 2 END,
       f.uploadedAt DESC, f.id DESC LIMIT 100`,
    ...metadataParams, phrase, phrase
  );

  const { canReadResource } = require('./kyana-access');
  const topics = require('./chat-topics');
  const formatFolder = (fileObj) => {
    if (typeof topics.formatNoteFolderPath === 'function') {
      return topics.formatNoteFolderPath(fileObj, cleanedQuery);
    }
    const rawChap = String(fileObj.chapter || '').trim();
    const chapStr = rawChap ? (/^(?:chapter|chap|unit|module|folder)\b/i.test(rawChap) ? rawChap : `Chapter ${rawChap}`) : '';
    return [fileObj.subject || 'General', chapStr].filter(Boolean).join(' / ');
  };
  const inferredConcept = typeof topics.resolveSyllabusConcept === 'function'
    ? topics.resolveSyllabusConcept(cleanedQuery)
    : null;
  const allowCrossSem = Boolean(searchAllSemesters || normalizedRequestedSem);
  const minMetaTokens = tokens.length <= 2 ? tokens.length : Math.ceil(tokens.length * 0.6);
  const results = metadata
    .filter(file => {
      if (excludeSet.has(Number(file.id))) return false;
      if (academicContext && !canReadResource(academicContext, file, 'note', { allowCrossSemester: allowCrossSem })) return false;
      if (parsedChapter && !matchesChapter(file.chapter, parsedChapter)) return false;
      if (tokens.length === 0) return true;
      const words = new Set([file.title, file.originalName, file.subject, file.chapter].join(' ').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
      const matchedCount = tokens.filter(token => words.has(token)).length;
      return matchedCount >= minMetaTokens;
    })
    .map(file => {
      const { document_content, extraction_status, ...rest } = file;
      const docText = document_content || '';
      const extracted = docText ? extractRelevantPassages(docText, tokens, { maxChars: 2400, maxPassages: 3 }) : { text: '', passages: [], pageNumbers: [] };
      const subjectBoost = (inferredConcept && String(file.subject || '').toLowerCase() === String(inferredConcept.canonicalSubject || '').toLowerCase()) ? 35 : 0;
      return {
        ...rest,
        folderPath: formatFolder(file),
        syllabusUnit: inferredConcept?.unit || null,
        matchType: 'metadata',
        score: metadataRank(file, tokens) + subjectBoost,
        excerpt: docText ? excerptFor(docText, tokens) : '',
        extractedContent: extracted.text,
        passages: extracted.passages,
        pageNumbers: extracted.pageNumbers
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxReturn);

  // Full-text content search (with automatic relaxed OR fallback + direct content scan fallback for unindexed FTS rows)
  if (results.length < maxReturn && tokens.length > 0) {
    const ftsLimit = Math.max(15, (maxReturn + excludeSet.size) * 3);
    const runContentQuery = async (useOrMode = false) => {
      const where = [...filters.where];
      const params = [];
      let sql;
      const safeTokens = tokens.map(t => t.replace(/['":*()\\]/g, '')).filter(Boolean);
      if (safeTokens.length === 0) return [];

      if (db.isPostgres) {
        if (!useOrMode) {
          where.unshift("d.search_vector @@ plainto_tsquery('english', ?)");
          params.push(safeTokens.join(' '), ...filters.params);
          sql = `SELECT f.*, d.content, ts_rank_cd(d.search_vector, plainto_tsquery('english', ?)) AS relevance
            FROM files f JOIN note_search_documents d ON d.id = f.id WHERE ${where.join(' AND ')}
            ORDER BY relevance DESC, f.id DESC LIMIT ${ftsLimit}`;
          params.unshift(safeTokens.join(' '));
        } else {
          const tsOr = safeTokens.join(' | ');
          where.unshift("d.search_vector @@ to_tsquery('english', ?)");
          params.push(tsOr, ...filters.params);
          sql = `SELECT f.*, d.content, ts_rank_cd(d.search_vector, to_tsquery('english', ?)) AS relevance
            FROM files f JOIN note_search_documents d ON d.id = f.id WHERE ${where.join(' AND ')}
            ORDER BY relevance DESC, f.id DESC LIMIT ${ftsLimit}`;
          params.unshift(tsOr);
        }
      } else {
        const ftsExpr = safeTokens.map(token => `"${token}"`).join(useOrMode ? ' OR ' : ' AND ');
        where.unshift('note_search_fts MATCH ?');
        params.push(ftsExpr, ...filters.params);
        sql = `SELECT f.*, d.content, bm25(note_search_fts) AS relevance FROM note_search_fts
          JOIN note_search_documents d ON d.id = note_search_fts.rowid JOIN files f ON f.id = d.id
          WHERE ${where.join(' AND ')} ORDER BY relevance, f.id DESC LIMIT ${ftsLimit}`;
      }
      try {
        return (await db.all(sql, ...params)) || [];
      } catch (_) {
        return [];
      }
    };

    const runDirectLikeContentFallback = async () => {
      const safeTokens = tokens.map(t => t.replace(/['":*()\\]/g, '').toLowerCase()).filter(Boolean);
      if (safeTokens.length === 0) return [];
      const where = [...filters.where];
      const likeClauses = safeTokens.map(() => `(LOWER(COALESCE(d.content, '')) LIKE ? OR LOWER(COALESCE(f.title, '')) LIKE ? OR LOWER(COALESCE(f.subject, '')) LIKE ? OR LOWER(COALESCE(f.chapter, '')) LIKE ?)`);
      where.unshift(`(${likeClauses.join(' OR ')})`);
      const likeParams = safeTokens.flatMap(t => [`%${t}%`, `%${t}%`, `%${t}%`, `%${t}%`]);
      const sql = `SELECT f.*, d.content, 1 AS relevance
        FROM files f JOIN note_search_documents d ON d.id = f.id
        WHERE ${where.join(' AND ')}
        ORDER BY f.id DESC LIMIT ${ftsLimit}`;
      try {
        return (await db.all(sql, ...likeParams, ...filters.params)) || [];
      } catch (_) {
        return [];
      }
    };

    const isEligibleMatch = m =>
      !excludeSet.has(Number(m.id)) &&
      (!academicContext || canReadResource(academicContext, m, 'note', { allowCrossSemester: allowCrossSem })) &&
      (!parsedChapter || matchesChapter(m.chapter, parsedChapter));

    let contentMatches = await runContentQuery(false);
    if (contentMatches.filter(isEligibleMatch).length === 0 && tokens.length > 1) {
      contentMatches = await runContentQuery(true);
    }
    if (contentMatches.filter(isEligibleMatch).length === 0) {
      const fallbackRows = await runDirectLikeContentFallback();
      // Filter fallback rows to those whose content + metadata actually match the query tokens
      contentMatches = fallbackRows.filter(m => {
        const hay = `${m.title || ''} ${m.subject || ''} ${m.chapter || ''} ${m.content || ''}`.toLowerCase();
        return tokens.some(t => hay.includes(t));
      });
    }

    const candidateContentRows = [];
    for (const match of contentMatches) {
      if (!isEligibleMatch(match)) continue;
      if (results.some(result => Number(result.id) === Number(match.id))) continue;
      const { content, relevance, ...file } = match;
      const extracted = extractRelevantPassages(content, tokens, { maxChars: 2400, maxPassages: 3 });
      const subjectBoost = (inferredConcept && String(file.subject || '').toLowerCase() === String(inferredConcept.canonicalSubject || '').toLowerCase()) ? 35 : 0;
      const passageScore = extracted.passages[0]?.score || 1;
      candidateContentRows.push({
        ...file,
        folderPath: formatFolder(file),
        syllabusUnit: inferredConcept?.unit || null,
        matchType: 'content',
        score: (Math.abs(Number(relevance)) > 1 ? Math.abs(Number(relevance)) : passageScore) + subjectBoost,
        excerpt: excerptFor(content, tokens),
        extractedContent: extracted.text,
        passages: extracted.passages,
        pageNumbers: extracted.pageNumbers
      });
    }
    candidateContentRows.sort((a, b) => b.score - a.score);
    for (const row of candidateContentRows) {
      if (results.length >= maxReturn) break;
      results.push(row);
    }
  }

  if (cache.size >= 150) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), rows: results });
  return results.map(row => ({ ...row }));
}

/** Read inside a specific note file and extract the top 2–3 relevant passages with page numbers and metadata. */
async function readNoteFileContent(db, fileId, { query = '', maxChars = 3500, academicContext = null, allowCrossSemester = false } = {}) {
  await ensureIndex(db);
  const id = Number(fileId);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const where = ['f.id = ?'];
  const params = [id];
  if (academicContext) {
    const access = require('./kyana-access').resourceFilter(academicContext, 'note', 'f', {
      allowCrossSemester: Boolean(allowCrossSemester)
    });
    where.push(`(${access.sql})`);
    params.push(...access.params);
  }
  const row = await db.get(`
    SELECT f.*, d.content, d.extraction_status, d.indexed_at
    FROM files f
    LEFT JOIN note_search_documents d ON d.id = f.id
    WHERE ${where.join(' AND ')}
  `, ...params);
  if (!row) return null;
  if (academicContext && !require('./kyana-access').canReadResource(academicContext, row, 'note', { allowCrossSemester: Boolean(allowCrossSemester) })) {
    return null;
  }
  const tokens = queryTokens(query);
  const extracted = extractRelevantPassages(row.content, tokens, { maxChars, maxPassages: 3 });
  const topics = require('./chat-topics');
  const folderPath = typeof topics.formatNoteFolderPath === 'function'
    ? topics.formatNoteFolderPath(row, query)
    : [row.subject || 'General', row.chapter ? `Chapter ${row.chapter}` : ''].filter(Boolean).join(' / ');
  return {
    id: row.id,
    title: row.title || row.originalName,
    originalName: row.originalName,
    subject: row.subject,
    chapter: row.chapter,
    folderPath,
    semester: row.semester,
    extractionStatus: row.extraction_status || 'not_indexed',
    extractedContent: extracted.text,
    passages: extracted.passages,
    pageNumbers: extracted.pageNumbers,
    hasContent: Boolean(row.content && row.content.trim().length > 0)
  };
}

module.exports = {
  ensureIndex,
  indexNote,
  extractText,
  readFileBytes,
  searchNotes,
  readNoteFileContent,
  extractRelevantPassage,
  extractRelevantPassages,
  isTocOrIndexPassage,
  parseChapterFilter,
  matchesChapter,
  removeNoteIndex,
  invalidateSearchCache,
  normalizeSemester,
  semesterAliases,
  MAX_FILE_BYTES,
  MAX_TEXT_CHARS
};
