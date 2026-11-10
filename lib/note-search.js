'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 1_000_000;
const MAX_PDF_PAGES = 500;
const MAX_DOCX_EXPANDED_BYTES = 60 * 1024 * 1024;
const INDEX_TIMEOUT_MS = 20_000;
const indexPromises = new WeakMap();
const searchCaches = new WeakMap();
const ROMANS = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'];
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
const STOP_WORDS = new Set((
  'a an the please find search show give get me my us for of on about in and to with by what is are tell explain definition define difference notes note pdf files file documents document lecture lectures study material materials slides upload uploads uploaded uploading semester sem ' +
  'ko ka ki ke lai le ma ra ani pani ta ho xa cha chaa xan chha chhan xaina chaina yrr malai mero hamro timro tapaiko yo tyo tyesko tesko kati k kasari kun kata chaiyo chahiyo khojdeu khojideu khoja khoj deu deuna dekhauna pathaideu pathau dinus dinu dinuhos gara garnu barema bare barey lagi haru bhan na bujhaune bujham vayo bhayo aako aeko aauxa auncha aayo'
).split(' '));

function normalizeSemester(value) {
  if (value === null || value === undefined || value === '') return null;
  const cleaned = String(value).toLowerCase().trim()
    .replace(/\b(semester|sem)\b/g, '').trim().replace(/^(\d)(st|nd|rd|th)$/, '$1');
  if (/^[1-8]$/.test(cleaned)) return Number(cleaned);
  const index = ROMANS.indexOf(cleaned);
  if (index !== -1) return index + 1;
  const ordinal = ORDINALS.indexOf(cleaned);
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

/** Creates a persistent content index using the application's configured database. */
async function ensureIndex(db) {
  if (indexPromises.has(db)) return indexPromises.get(db);
  const promise = (async () => {
    const runExec = typeof db.exec === 'function' ? (s) => db.exec(s) : (s) => db.query(s);
    await runExec(`
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
    `);
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
  if (typeof db.getFileBlob === 'function') {
    const blob = await db.getFileBlob(storedName);
    if (blob?.fileData) {
      if (blob.fileData.byteLength > MAX_FILE_BYTES) throw extractionError('too_large', 'File exceeds the 20 MB extraction limit.');
      return Buffer.from(blob.fileData);
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
}

function getFilters({ semester, subject }) {
  const where = [];
  const params = [];
  if (semester !== undefined && semester !== null && semester !== '') {
    const number = normalizeSemester(semester);
    if (!number) return null; // An invalid explicit filter must never broaden results.
    const aliases = semesterAliases(number);
    where.push(`LOWER(TRIM(f.semester)) IN (${aliases.map(() => '?').join(',')})`);
    params.push(...aliases);
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

function queryTokens(query) {
  return [...new Set(String(query || '').slice(0, 300).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])]
    .filter(token => !STOP_WORDS.has(token)).slice(0, 12);
}

function escapeRegExp(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function metadataRank(file, tokens) {
  const phrase = tokens.join(' ');
  const title = String(file.title || '').toLowerCase();
  const subject = String(file.subject || '').toLowerCase();
  const originalName = String(file.originalName || '').toLowerCase().replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  if (!phrase) return 1;
  if (title === phrase) return 1000;
  if (subject === phrase) return 950;
  if (originalName === phrase) return 900;
  return (title.includes(phrase) ? 75 : 0) + (originalName.includes(phrase) ? 60 : 0) +
    (subject.includes(phrase) ? 45 : 0) + tokens.reduce((score, token) => score + (title.includes(token) ? 4 : 0), 0);
}

function excerptFor(content, tokens) {
  const text = String(content || '').replace(/\s+/g, ' ');
  const indexes = [];
  for (const token of tokens) {
    const rx = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(token)}(?![\\p{L}\\p{N}])`, 'gui');
    const m = rx.exec(text);
    if (m) indexes.push(m.index);
  }
  const start = Math.max(0, (indexes.length ? Math.min(...indexes) : 0) - 70);
  return `${start ? '…' : ''}${text.slice(start, start + 300)}${start + 300 < text.length ? '…' : ''}`;
}

function extractRelevantPassage(content, tokens = [], maxChars = 2000) {
  if (!content || typeof content !== 'string') return '';
  const trimmed = content.trim();
  if (!trimmed) return '';

  const rawPages = trimmed.split('\f');
  const hasPages = rawPages.length > 1;

  // Normalize tokens
  const cleanTokens = (tokens || []).map(t => String(t).toLowerCase().trim()).filter(Boolean);

  if (!cleanTokens.length) {
    if (hasPages) {
      return `[Page 1]: ${rawPages[0].replace(/[\t\r ]+/g, ' ').slice(0, maxChars).trim()}`;
    }
    return trimmed.replace(/[\t\r ]+/g, ' ').slice(0, maxChars);
  }

  // Score each page / section across all pages using Unicode word boundary matching
  const scoredPages = [];
  for (let i = 0; i < rawPages.length; i++) {
    const pageNo = i + 1;
    const pageText = rawPages[i].replace(/[\t\r ]+/g, ' ').trim();
    if (!pageText) continue;

    let uniqueMatches = 0;
    let totalFreq = 0;
    let earliestMatchPos = -1;

    for (const token of cleanTokens) {
      const rx = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(token)}(?![\\p{L}\\p{N}])`, 'gui');
      let count = 0;
      let m;
      while ((m = rx.exec(pageText)) !== null) {
        count++;
        if (earliestMatchPos === -1 || m.index < earliestMatchPos) {
          earliestMatchPos = m.index;
        }
      }
      if (count > 0) {
        uniqueMatches++;
        totalFreq += count;
      }
    }

    if (uniqueMatches > 0) {
      let phraseBonus = 0;
      if (cleanTokens.length > 1) {
        const fullPhrase = cleanTokens.map(escapeRegExp).join('[\\s_-]+');
        const phraseRegex = new RegExp(`(?<![\\p{L}\\p{N}])${fullPhrase}(?![\\p{L}\\p{N}])`, 'ui');
        if (phraseRegex.test(pageText)) {
          phraseBonus = 25;
        }
      }
      const score = (uniqueMatches * 15) + phraseBonus + Math.min(totalFreq, 10);
      scoredPages.push({ pageNo, pageText, score, earliestMatchPos });
    }
  }

  // If no page matched tokens, return first page
  if (scoredPages.length === 0) {
    const firstText = rawPages[0].replace(/[\t\r ]+/g, ' ').trim();
    return hasPages ? `[Page 1]: ${firstText.slice(0, maxChars)}` : firstText.slice(0, maxChars);
  }

  // Sort by match score descending, pick up to 3 best passages
  scoredPages.sort((a, b) => b.score - a.score || a.pageNo - b.pageNo);
  const bestPages = scoredPages.slice(0, 3);

  // Re-sort selected pages in natural page order
  bestPages.sort((a, b) => a.pageNo - b.pageNo);

  const budgetPerPage = Math.floor(maxChars / bestPages.length);
  const passages = bestPages.map(p => {
    let passageContent;
    if (p.pageText.length <= budgetPerPage) {
      passageContent = p.pageText;
    } else {
      const start = Math.max(0, p.earliestMatchPos - 120);
      const end = Math.min(p.pageText.length, start + budgetPerPage);
      passageContent = (start > 0 ? '…' : '') + p.pageText.slice(start, end).trim() + (end < p.pageText.length ? '…' : '');
    }
    return hasPages ? `[Page ${p.pageNo}]: ${passageContent}` : passageContent;
  });

  return passages.join('\n\n');
}

function countMatchedDistinctTokens(file, docText, queryTokensList) {
  if (!queryTokensList || !queryTokensList.length) return 0;
  const metaText = `${file.title || ''} ${file.subject || ''} ${file.originalName || ''} ${file.chapter || ''}`;
  const fullDocText = docText || '';
  let count = 0;
  for (const token of queryTokensList) {
    const rx = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(token)}(?![\\p{L}\\p{N}])`, 'ui');
    if (rx.test(metaText) || (fullDocText && rx.test(fullDocText))) {
      count++;
    }
  }
  return count;
}

/**
 * Returns at most 3 file rows plus matchType, score, excerpt, and extractedContent.
 * subject is a canonical subject or an array of exact aliases. Filters are always hard.
 * Metadata and content matches are both executed and merged using Reciprocal Rank Fusion (RRF).
 */
async function searchNotes(db, { query = '', semester, subject, academicContext, minTermCoverage = 0.50, minScore = null } = {}) {
  const filters = getFilters({ semester, subject });
  if (!filters) return [];
  if (academicContext) {
    const access = require('./kyana-access').resourceFilter(academicContext, 'note', 'f');
    filters.where.push(`(${access.sql})`);
    filters.params.push(...access.params);
  }
  let cleanedQuery = String(query || '');
  if (normalizeSemester(semester)) {
    const aliases = semesterAliases(normalizeSemester(semester)).filter(alias => /semester|sem /.test(alias));
    for (const alias of aliases.sort((a, b) => b.length - a.length)) {
      cleanedQuery = cleanedQuery.replace(new RegExp(`\\b${alias}\\b`, 'gi'), ' ');
    }
  }
  let tokens = queryTokens(cleanedQuery);
  for (const alias of filters.subjects.map(queryTokens).sort((a, b) => b.length - a.length)) {
    if (!alias.length) continue;
    for (let i = 0; i <= tokens.length - alias.length; i++) {
      if (alias.every((token, index) => tokens[i + index] === token)) {
        tokens.splice(i, alias.length);
        break;
      }
    }
  }
  if (!tokens.length && !filters.subjects.length) return [];
  await ensureIndex(db);
  let cache = searchCaches.get(db);
  if (!cache) { cache = new Map(); searchCaches.set(db, cache); }
  const key = JSON.stringify([tokens, semester, filters.subjects, academicContext && require('./chat-security').contextKey(academicContext)]);
  const hit = cache.get(key);
  if (!academicContext && hit && Date.now() - hit.at < 30_000) return hit.rows.map(row => ({ ...row }));

  // 1. Metadata Search
  const fields = ['f.title', 'f.originalName', 'f.subject', 'f.chapter'];
  const metadataWhere = [...filters.where];
  const metadataParams = [...filters.params];
  for (const token of tokens) {
    metadataWhere.push(`(${fields.map(field => `LOWER(COALESCE(${field}, '')) LIKE ?`).join(' OR ')})`);
    metadataParams.push(...fields.map(() => `%${token}%`));
  }
  const phrase = tokens.join(' ');
  const metadata = await db.all(`SELECT f.*, d.content AS document_content, d.extraction_status FROM files f LEFT JOIN note_search_documents d ON d.id = f.id WHERE ${metadataWhere.join(' AND ')}
    ORDER BY CASE WHEN LOWER(COALESCE(f.title, '')) = ? THEN 0
      WHEN LOWER(COALESCE(f.subject, '')) = ? THEN 1 ELSE 2 END,
      f.uploadedAt DESC, f.id DESC LIMIT 100`, ...metadataParams, phrase, phrase);

  const metadataMatches = metadata.filter(file => {
    // LIKE narrows SQL candidates; whole tokens prevent C -> every word containing c.
    const words = new Set([file.title, file.originalName, file.subject, file.chapter].join(' ').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
    return tokens.every(token => words.has(token));
  }).sort((a, b) => metadataRank(b, tokens) - metadataRank(a, tokens));

  // 2. Full-Text Content Search (ALWAYS executed, never skipped when metadata matches exist)
  let contentMatches = [];
  if (tokens.length) {
    const where = [...filters.where];
    const params = [];
    let sql;
    if (db.isPostgres) {
      const cleanTokens = tokens.map(t => t.replace(/[^a-zA-Z0-9]/g, '')).filter(Boolean);
      if (cleanTokens.length > 0) {
        const orTsQuery = cleanTokens.map(t => `${t}:*`).join(' | ');
        where.unshift("d.search_vector @@ to_tsquery('english', ?)");
        params.push(orTsQuery, ...filters.params);
        sql = `SELECT f.*, d.content, ts_rank_cd(d.search_vector, to_tsquery('english', ?)) AS relevance
          FROM files f JOIN note_search_documents d ON d.id = f.id WHERE ${where.join(' AND ')}
          ORDER BY relevance DESC, f.id DESC LIMIT 20`;
        params.unshift(orTsQuery);
        contentMatches = await db.all(sql, ...params);
      }
    } else {
      const cleanTokens = tokens.map(t => t.replace(/"/g, '""')).filter(Boolean);
      if (cleanTokens.length > 0) {
        where.unshift('note_search_fts MATCH ?');
        params.push(cleanTokens.map(token => `"${token}"`).join(' AND '), ...filters.params);
        sql = `SELECT f.*, d.content, bm25(note_search_fts) AS relevance FROM note_search_fts
          JOIN note_search_documents d ON d.id = note_search_fts.rowid JOIN files f ON f.id = d.id
          WHERE ${where.join(' AND ')} ORDER BY relevance, f.id DESC LIMIT 20`;
        contentMatches = await db.all(sql, ...params);
      }
    }
  }

  // 3. Reciprocal Rank Fusion (RRF)
  const candidateMap = new Map();
  const RRF_K = 60;
  const META_WEIGHT = 1.05;

  metadataMatches.forEach((file, index) => {
    const id = Number(file.id);
    const rank = index + 1;
    const rrfScore = META_WEIGHT * (1 / (RRF_K + rank));
    candidateMap.set(id, {
      file,
      content: file.document_content || '',
      metaRank: rank,
      contentRank: null,
      rrfScore,
      matchedMeta: true,
      matchedContent: false
    });
  });

  contentMatches.forEach((match, index) => {
    const id = Number(match.id);
    const rank = index + 1;
    const rrfScore = 1 / (RRF_K + rank);
    if (candidateMap.has(id)) {
      const existing = candidateMap.get(id);
      existing.contentRank = rank;
      existing.rrfScore += rrfScore;
      existing.matchedContent = true;
      if (!existing.content && match.content) existing.content = match.content;
    } else {
      candidateMap.set(id, {
        file: match,
        content: match.content || '',
        metaRank: null,
        contentRank: rank,
        rrfScore,
        matchedMeta: false,
        matchedContent: true
      });
    }
  });

  // Apply relevance threshold:
  // A candidate must match at least ~50% of distinct query terms, or exceed a minimum configurable score.
  const relevantCandidates = [];
  for (const candidate of candidateMap.values()) {
    const matchedCount = countMatchedDistinctTokens(candidate.file, candidate.content, tokens);
    const coverage = tokens.length > 0 ? (matchedCount / tokens.length) : 1;
    candidate.matchedTokensCount = matchedCount;
    candidate.termCoverage = coverage;

    const passesCoverage = tokens.length === 0 ? true : (coverage >= minTermCoverage);
    const passesScore = typeof minScore === 'number' && candidate.rrfScore >= minScore;
    if (passesCoverage || passesScore) {
      relevantCandidates.push(candidate);
    }
  }

  const rankedCandidates = relevantCandidates
    .sort((a, b) => b.rrfScore - a.rrfScore || Number(b.file.id) - Number(a.file.id))
    .slice(0, 3);

  const results = rankedCandidates.map(candidate => {
    const { file, content: docText, rrfScore, matchedMeta } = candidate;
    const { document_content, relevance, content, ...rest } = file;
    const matchType = matchedMeta ? 'metadata' : 'content';
    return {
      ...rest,
      matchType,
      score: rrfScore,
      excerpt: docText ? excerptFor(docText, tokens) : '',
      extractedContent: docText ? extractRelevantPassage(docText, tokens) : ''
    };
  });

  if (cache.size >= 150) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), rows: results });
  return results.map(row => ({ ...row }));
}

/** Read inside a specific note file and extract content on a topic. */
async function readNoteFileContent(db, fileId, { query = '', maxChars = 3500, academicContext = null } = {}) {
  await ensureIndex(db);
  const id = Number(fileId);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const where = ['f.id = ?'];
  const params = [id];
  if (academicContext) {
    const access = require('./kyana-access').resourceFilter(academicContext, 'note', 'f');
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
  const tokens = queryTokens(query);
  const passage = extractRelevantPassage(row.content, tokens, maxChars);
  return {
    id: row.id,
    title: row.title || row.originalName,
    originalName: row.originalName,
    subject: row.subject,
    chapter: row.chapter,
    semester: row.semester,
    extractionStatus: row.extraction_status || 'not_indexed',
    extractedContent: passage,
    hasContent: Boolean(row.content && row.content.trim().length > 0)
  };
}

module.exports = {
  ensureIndex,
  indexNote,
  searchNotes,
  readNoteFileContent,
  extractRelevantPassage,
  removeNoteIndex,
  invalidateSearchCache,
  normalizeSemester,
  semesterAliases,
  MAX_FILE_BYTES,
  MAX_TEXT_CHARS
};
