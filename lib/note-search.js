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
const STOP_WORDS = new Set('a an the please find search show give get me my us for of on about in and notes note pdf files file documents document lecture lectures semester sem'.split(' '));

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
    await db.exec(`
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
  if (!process.env.SUPABASE_URL) return null;
  let base;
  try { base = new URL(process.env.SUPABASE_URL); } catch { return null; }
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
          text += content.items.map(item => item.str || '').join(' ') + '\n';
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
  } else if (extension === '.docx') {
    checkDocxSize(buffer);
    const mammoth = require('mammoth');
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (['.txt', '.md', '.csv'].includes(extension)) {
    text = buffer.toString('utf8');
  } else {
    throw extractionError('unsupported', 'Text extraction supports PDF, DOCX, TXT, Markdown, and CSV files.');
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
    if (!['.pdf', '.docx', '.txt', '.md', '.csv'].includes(extension)) {
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
  const indexes = tokens.map(token => text.toLowerCase().indexOf(token)).filter(index => index >= 0);
  const start = Math.max(0, (indexes.length ? Math.min(...indexes) : 0) - 70);
  return `${start ? '…' : ''}${text.slice(start, start + 300)}${start + 300 < text.length ? '…' : ''}`;
}

/**
 * Returns at most 3 file rows plus matchType, score, and a short content excerpt.
 * subject is a canonical subject or an array of exact aliases. Filters are always hard.
 * Metadata matches precede full-content matches; topic inference belongs to the tool layer.
 */
async function searchNotes(db, { query = '', semester, subject } = {}) {
  const filters = getFilters({ semester, subject });
  if (!filters) return [];
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
  const key = JSON.stringify([tokens, semester, filters.subjects]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.rows.map(row => ({ ...row }));
  const fields = ['f.title', 'f.originalName', 'f.subject', 'f.chapter'];
  const metadataWhere = [...filters.where];
  const metadataParams = [...filters.params];
  for (const token of tokens) {
    metadataWhere.push(`(${fields.map(field => `LOWER(COALESCE(${field}, '')) LIKE ?`).join(' OR ')})`);
    metadataParams.push(...fields.map(() => `%${token}%`));
  }
  const phrase = tokens.join(' ');
  const metadata = await db.all(`SELECT f.* FROM files f WHERE ${metadataWhere.join(' AND ')}
    ORDER BY CASE WHEN LOWER(COALESCE(f.title, '')) = ? THEN 0
      WHEN LOWER(COALESCE(f.subject, '')) = ? THEN 1 ELSE 2 END,
      f.uploadedAt DESC, f.id DESC LIMIT 100`, ...metadataParams, phrase, phrase);
  const results = metadata.filter(file => {
    // LIKE narrows SQL candidates; whole tokens prevent C -> every word containing c.
    const words = new Set([file.title, file.originalName, file.subject, file.chapter].join(' ').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
    return tokens.every(token => words.has(token));
  }).map(file => ({ ...file, matchType: 'metadata', score: metadataRank(file, tokens) }))
    .sort((a, b) => b.score - a.score).slice(0, 3);
  if (results.length < 3 && tokens.length) {
    const where = [...filters.where];
    const params = [];
    let sql;
    if (db.isPostgres) {
      where.unshift("d.search_vector @@ plainto_tsquery('english', ?)");
      params.push(tokens.join(' '), ...filters.params);
      sql = `SELECT f.*, d.content, ts_rank_cd(d.search_vector, plainto_tsquery('english', ?)) AS relevance
        FROM files f JOIN note_search_documents d ON d.id = f.id WHERE ${where.join(' AND ')}
        ORDER BY relevance DESC, f.id DESC LIMIT 6`;
      params.unshift(tokens.join(' '));
    } else {
      where.unshift('note_search_fts MATCH ?');
      params.push(tokens.map(token => `"${token}"`).join(' AND '), ...filters.params);
      sql = `SELECT f.*, d.content, bm25(note_search_fts) AS relevance FROM note_search_fts
        JOIN note_search_documents d ON d.id = note_search_fts.rowid JOIN files f ON f.id = d.id
        WHERE ${where.join(' AND ')} ORDER BY relevance, f.id DESC LIMIT 6`;
    }
    const contentMatches = await db.all(sql, ...params);
    for (const match of contentMatches) {
      if (results.some(result => Number(result.id) === Number(match.id))) continue;
      const { content, relevance, ...file } = match;
      results.push({ ...file, matchType: 'content', score: Math.abs(Number(relevance)), excerpt: excerptFor(content, tokens) });
      if (results.length >= 3) break;
    }
  }
  if (cache.size >= 150) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), rows: results });
  return results.map(row => ({ ...row }));
}

module.exports = { ensureIndex, indexNote, searchNotes, removeNoteIndex, invalidateSearchCache, normalizeSemester,
  MAX_FILE_BYTES, MAX_TEXT_CHARS };
