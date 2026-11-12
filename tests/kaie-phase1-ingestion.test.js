'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

const { ensureRagSchema } = require('../lib/rag-schema');
const kaieOcr = require('../lib/kaie-ocr');
const {
  ingestAcademicDocument,
  enqueueDocumentIngestion,
  processDocumentIngestionJobs,
  cleanupDeletedDocument
} = require('../lib/document-ingestion');
const { formatRow, formatRows } = require('../db');

async function createTestDb() {
  const client = createClient({ url: ':memory:' });
  const db = {
    client,
    dialect: 'sqlite',
    isPostgres: false,
    async run(sql, ...args) {
      const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      return client.execute({ sql, args: params });
    },
    async get(sql, ...args) {
      const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      const res = await client.execute({ sql, args: params });
      return formatRow(res.rows[0] || null);
    },
    async all(sql, ...args) {
      const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      const res = await client.execute({ sql, args: params });
      return formatRows(res.rows || []);
    },
    async exec(sql) {
      return client.executeMultiple(sql);
    }
  };

  await db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storedName TEXT,
      originalName TEXT,
      title TEXT,
      semester TEXT,
      subject TEXT,
      chapter TEXT,
      uploadedBy TEXT,
      sizeBytes INTEGER,
      uploadedAt TEXT,
      previewName TEXT,
      cohort_id TEXT,
      semester_no INTEGER,
      audience_scope TEXT
    );
    CREATE TABLE IF NOT EXISTS file_blobs (
      filename TEXT PRIMARY KEY,
      fileData BLOB
    );
    CREATE TABLE IF NOT EXISTS note_search_documents (
      id TEXT PRIMARY KEY,
      title TEXT,
      subject TEXT,
      chapter TEXT,
      content TEXT,
      updatedAt TEXT
    );
  `);

  await ensureRagSchema(db);
  return db;
}

test('KAIE Phase 1: ensureRagSchema adds Phase 1 columns and indexes', async () => {
  const db = await createTestDb();

  const fileCols = await db.all('PRAGMA table_info(files)');
  const fileColNames = new Set(fileCols.map((c) => c.name));
  assert.ok(fileColNames.has('resource_category'), 'files.resource_category must exist');
  assert.ok(fileColNames.has('unit_number'), 'files.unit_number must exist');

  const jobCols = await db.all('PRAGMA table_info(document_extraction_jobs)');
  const jobColNames = new Set(jobCols.map((c) => c.name));
  assert.ok(jobColNames.has('kaie_stage'), 'document_extraction_jobs.kaie_stage must exist');

  const pageCols = await db.all('PRAGMA table_info(document_pages)');
  const pageColNames = new Set(pageCols.map((c) => c.name));
  assert.ok(pageColNames.has('diagrams_json'), 'document_pages.diagrams_json must exist');
  assert.ok(pageColNames.has('equations_json'), 'document_pages.equations_json must exist');
});

test('KAIE Phase 1: Standalone image ingestion extracts text, equations, and diagrams via Vision OCR', async (t) => {
  const db = await createTestDb();

  kaieOcr.setVisionProvider(async (buffer, opts) => {
    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(opts.mimeType, 'image/png');
    return {
      text: 'CSS Box Model defines margin, border, padding, and content area.',
      equations: [{ latex: 'W = w + 2p + 2b + 2m', description: 'Total box width formula' }],
      diagrams: [{ title: 'CSS Box Model', description: 'Concentric boxes for content, padding, border, margin', labels: ['content', 'padding', 'border', 'margin'] }],
      confidence: 0.95
    };
  });
  t.after(() => kaieOcr.setVisionProvider(null));

  const file = {
    id: 101,
    storedName: 'box-model.png',
    originalName: 'box-model.png',
    title: 'CSS Box Model Diagram',
    semester: 'Semester 2',
    semester_no: 2,
    subject: 'Web Technology I',
    chapter: 'Unit 3: CSS',
    resource_category: 'notes',
    unit_number: 3
  };

  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const res = await ingestAcademicDocument(db, file, { buffer: pngBytes });

  assert.equal(res.status, 'ready');
  assert.equal(res.lifecycleStatus, 'INDEXED');
  assert.equal(res.ocrApplied, true);

  const page = await db.get('SELECT * FROM document_pages WHERE file_id = ?', '101');
  assert.ok(page, 'document_pages row must be created');
  assert.equal(page.ocr_applied, 1);
  assert.match(page.cleaned_text, /CSS Box Model/);

  const equations = JSON.parse(page.equations_json || '[]');
  const diagrams = JSON.parse(page.diagrams_json || '[]');
  assert.equal(equations.length, 1);
  assert.equal(equations[0].latex, 'W = w + 2p + 2b + 2m');
  assert.equal(diagrams.length, 1);
  assert.equal(diagrams[0].title, 'CSS Box Model');

  const chunks = await db.all('SELECT * FROM document_chunks WHERE file_id = ?', '101');
  assert.ok(chunks.length >= 1, 'Chunks must be generated for image OCR content');

  const job = await db.get('SELECT * FROM document_extraction_jobs WHERE file_id = ?', '101');
  assert.equal(job.status, 'INDEXED');
  assert.equal(job.kaie_stage, 'INDEXED');
});

test('KAIE Phase 1: Checksum deduplication and doc_version increment on update', async () => {
  const db = await createTestDb();

  const file = {
    id: 202,
    storedName: 'unit3-notes.txt',
    originalName: 'unit3-notes.txt',
    title: 'Unit 3 CSS Notes',
    semester: 'Semester 2',
    semester_no: 2,
    subject: 'Web Technology I',
    chapter: 'Unit 3',
    resource_category: 'notes',
    unit_number: 3
  };

  const buf1 = Buffer.from('CSS selectors target HTML elements. Class selectors use a dot prefix.');
  const first = await ingestAcademicDocument(db, file, { buffer: buf1 });
  assert.equal(first.status, 'ready');
  assert.equal(first.lifecycleStatus, 'INDEXED');
  assert.equal(first.docVersion, 1);

  const second = await ingestAcademicDocument(db, file, { buffer: buf1 });
  assert.equal(second.idempotent, true, 'Identical checksum should reuse indexed version');
  assert.equal(second.docVersion, 1);

  const buf2 = Buffer.from('CSS selectors target HTML elements. ID selectors use a hash prefix and higher specificity.');
  const third = await ingestAcademicDocument(db, file, { buffer: buf2 });
  assert.equal(third.status, 'ready');
  assert.equal(third.lifecycleStatus, 'INDEXED');
  assert.equal(third.docVersion, 2, 'Modified content must increment doc_version');
});

test('KAIE Phase 1: model_questions resource auto-routes to PYQ tables without duplication', async () => {
  const db = await createTestDb();

  const file = {
    id: 303,
    storedName: 'web-tech-model-q.txt',
    originalName: 'web-tech-model-q.txt',
    title: 'Web Technology I Model Questions 2081',
    semester: 'Semester 2',
    semester_no: 2,
    subject: 'Web Technology I',
    chapter: 'Model Questions',
    resource_category: 'model_questions',
    unit_number: 3
  };

  const paperText = `
    GANDAKI UNIVERSITY
    Web Technology I (CIT123)
    2081 BS Model Questions

    1. Explain the three levels of CSS style sheets with examples. [5]
    2. Differentiate between class selector and ID selector in CSS. [5]
  `;

  const res1 = await ingestAcademicDocument(db, file, { buffer: Buffer.from(paperText) });
  assert.equal(res1.status, 'ready');
  assert.equal(res1.lifecycleStatus, 'INDEXED');

  const papers1 = await db.all('SELECT * FROM pyq_papers WHERE file_id = ?', '303');
  assert.equal(papers1.length, 1);
  const questions1 = await db.all('SELECT * FROM pyq_questions WHERE file_id = ?', '303');
  assert.equal(questions1.length, 2);

  // Re-ingest updated model question paper -> old PYQ rows for file_id 303 should be replaced
  const updatedPaperText = `${paperText}\n    3. Describe the CSS Box Model with a neat diagram. [10]\n`;
  const res2 = await ingestAcademicDocument(db, file, { buffer: Buffer.from(updatedPaperText) });
  assert.equal(res2.status, 'ready');
  assert.equal(res2.lifecycleStatus, 'INDEXED');

  const papers2 = await db.all('SELECT * FROM pyq_papers WHERE file_id = ?', '303');
  assert.equal(papers2.length, 1, 'Should replace rather than duplicate pyq_papers');
  const questions2 = await db.all('SELECT * FROM pyq_questions WHERE file_id = ?', '303');
  assert.equal(questions2.length, 3, 'Updated paper should have 3 questions');
});

test('KAIE Phase 1: Async queue enqueue -> processDocumentIngestionJobs -> cleanupDeletedDocument', async () => {
  const db = await createTestDb();

  const insertRes = await db.run(
    `INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt, semester_no, resource_category, unit_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'queued-note.txt',
    'queued-note.txt',
    'Queued CSS Note',
    'Semester 2',
    'Web Technology I',
    'Unit 3',
    'T001',
    120,
    new Date().toISOString(),
    2,
    'model_questions',
    3
  );
  const fileId = Number(insertRes.lastInsertRowid);

  await db.run(
    `INSERT INTO file_blobs (filename, fileData) VALUES (?, ?)`,
    'queued-note.txt',
    Buffer.from('1. Explain CSS specificity rules and cascade order. [5]\n')
  );

  const fileRecord = {
    id: fileId,
    storedName: 'queued-note.txt',
    originalName: 'queued-note.txt',
    title: 'Queued CSS Note',
    semester: 'Semester 2',
    semester_no: 2,
    subject: 'Web Technology I',
    chapter: 'Unit 3',
    resource_category: 'model_questions',
    unit_number: 3
  };

  const enqueued = await enqueueDocumentIngestion(db, fileRecord, { triggerAsync: false });
  assert.equal(enqueued.status, 'QUEUED');

  const workerRes = await processDocumentIngestionJobs(db, { limit: 5 });
  assert.equal(workerRes.processed, 1);
  assert.equal(workerRes.results[0].lifecycleStatus, 'INDEXED');

  const jobAfter = await db.get('SELECT * FROM document_extraction_jobs WHERE file_id = ?', String(fileId));
  assert.equal(jobAfter.status, 'INDEXED');
  assert.equal(jobAfter.kaie_stage, 'INDEXED');

  await cleanupDeletedDocument(db, fileId);

  const remainingPages = await db.all('SELECT * FROM document_pages WHERE file_id = ?', String(fileId));
  const remainingChunks = await db.all('SELECT * FROM document_chunks WHERE file_id = ?', String(fileId));
  const remainingJobs = await db.all('SELECT * FROM document_extraction_jobs WHERE file_id = ?', String(fileId));
  const remainingPapers = await db.all('SELECT * FROM pyq_papers WHERE file_id = ?', String(fileId));
  const remainingQuestions = await db.all('SELECT * FROM pyq_questions WHERE file_id = ?', String(fileId));

  assert.equal(remainingPages.length, 0);
  assert.equal(remainingChunks.length, 0);
  assert.equal(remainingJobs.length, 0);
  assert.equal(remainingPapers.length, 0);
  assert.equal(remainingQuestions.length, 0);
});
