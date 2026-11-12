'use strict';

process.env.NODE_ENV = 'test';
process.env.DB_PATH = process.env.DB_PATH || ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { vector } = require('@electric-sql/pglite-pgvector');
const { PDFDocument } = require('pdf-lib');

const {
  classifyPageSignals,
  reconstructLinesFromItems,
  detectLegacyNepaliMojibake,
  detectMathSignal,
  detectTableSignal
} = require('../lib/doc-page-classifier');
const {
  resolveVisionModel,
  buildVisionPrompt,
  parseVisionJsonResponse,
  loadPdfForSlicing,
  buildPdfSlice
} = require('../lib/doc-vision-ocr');
const docWorker = require('../lib/doc-ingestion-worker');
const {
  PARSER_VERSION,
  computeContentHash,
  resolveDriftMinOverlap,
  extractComparisonWords,
  applyDriftCheck,
  enqueueDocumentIngestionJob,
  claimNextIngestionJob,
  reconcileMissingIngestionJobs,
  hasPendingWork,
  drainKnowledgeJobs,
  processNextIngestionJob,
  runIngestionWorkerLoop
} = docWorker;
const { parseCliArgs, executeWorkerRun } = require('../scripts/doc-ingestion-worker');
const { assertSafeLocalEnv, runLocalPdfHarness, parseArgs: parseLocalHarnessArgs, calculateConfiguredCostUsd } = require('../scripts/doc-ingestion-local-test');
const { PREFLIGHT_VARS, evaluatePreflight, formatPreflightReport } = require('../scripts/doc-ingestion-preflight');
const noteSearch = require('../lib/note-search');

/**
 * Creates an isolated in-memory PGlite (+pgvector) database matching Neon Postgres schema.
 */
async function createD2TestDb() {
  const pg = new PGlite({ extensions: { vector } });

  await pg.exec(`
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS students (
      studentId TEXT PRIMARY KEY,
      name TEXT,
      role TEXT
    );

    CREATE TABLE IF NOT EXISTS files (
      id SERIAL PRIMARY KEY,
      storedName TEXT NOT NULL,
      originalName TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      sizeBytes INTEGER NOT NULL,
      semester TEXT NOT NULL DEFAULT '1',
      subject TEXT NOT NULL DEFAULT 'CSIT',
      title TEXT NOT NULL DEFAULT '',
      chapter TEXT NOT NULL DEFAULT '',
      uploadedBy TEXT NOT NULL DEFAULT '26020266',
      uploadedByName TEXT NOT NULL DEFAULT 'Teacher',
      storageUrl TEXT,
      uploadedAt TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS file_blobs (
      filename TEXT PRIMARY KEY,
      mimeType TEXT NOT NULL,
      fileData BYTEA NOT NULL,
      uploadedAt TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cohorts (
      id TEXT PRIMARY KEY,
      name TEXT
    );
  `);

  const baseKnowledgeSql = fs.readFileSync(
    path.join(__dirname, '../migrations/20261014_kyana_v3_knowledge.up.sql'),
    'utf8'
  );
  await pg.exec(baseKnowledgeSql);

  const noteVecSql = fs.readFileSync(
    path.join(__dirname, '../migrations/20261110_kyana_note_vector_chunks.up.sql'),
    'utf8'
  );
  await pg.exec(noteVecSql);

  const d2UpSql = fs.readFileSync(
    path.join(__dirname, '../migrations/20261112_doc_intelligence_d2.up.sql'),
    'utf8'
  );
  await pg.exec(d2UpSql);

  const db = {
    isPostgres: true,
    pool: null, // tests exercise both runner path and transaction path explicitly
    query: (sql, params = []) => pg.query(sql, params),
    exec: (sql) => pg.exec(sql),
    getFileBlob: async (filename) => {
      const r = await pg.query('SELECT mimeType, fileData FROM file_blobs WHERE filename = $1 LIMIT 1', [filename]);
      const row = r.rows[0];
      if (!row) return null;
      const data = row.fileData || row.filedata;
      return data ? { mimeType: row.mimeType || row.mimetype, fileData: Buffer.from(data) } : null;
    }
  };

  return { pg, db };
}

async function insertTestFile(db, {
  originalName = 'sample.pdf',
  storedName,
  title = 'Sample Note',
  subject = 'CSIT',
  semester = '3',
  chapter = 'Unit 1',
  buffer
}) {
  const actualStoredName = storedName || `note_${Date.now()}_${Math.random().toString(16).slice(2)}.pdf`;
  const res = await db.query(`
    INSERT INTO files (storedName, originalName, mimeType, sizeBytes, semester, subject, title, chapter)
    VALUES ($1, $2, 'application/pdf', $3, $4, $5, $6, $7)
    RETURNING id
  `, [actualStoredName, originalName, buffer.length, semester, subject, title, chapter]);
  const fileId = Number(res.rows[0].id);
  await db.query(
    'INSERT INTO file_blobs (filename, mimeType, fileData) VALUES ($1, $2, $3)',
    [actualStoredName, 'application/pdf', buffer]
  );
  return { fileId, storedName: actualStoredName, buffer };
}

/**
 * Pure-JS synthetic multi-page PDF generator with valid xref byte offsets.
 * Supports: typed text, Type0 UTF-16BE ToUnicode CMap font (Unicode Devanagari / math symbols),
 * named legacy fonts (Preeti, CambriaMath), embedded 1x1 Image XObjects, vector drawing ops,
 * multi-column tables, and Standard /Encrypt password dictionaries.
 */
function buildSyntheticPdf(pagesSpec = [], { encrypted = false } = {}) {
  const objects = [];
  const addObj = (body) => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  // Reserve Catalog (1) and Pages (2)
  addObj(''); // #1 Catalog
  addObj(''); // #2 Pages

  // #3 Helvetica base Type1 font
  const f1Id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  // #4 Preeti legacy Nepali font name
  const fPreetiId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Preeti >>');
  // #5 CambriaMath font name
  const fMathId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /CambriaMath >>');

  // #6 Type0 Identity-H ToUnicode font (direct UTF-16BE Identity-H mapping)
  const toUnicodeStream = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    '5 beginbfrange',
    '<0020> <00FF> <0020>',
    '<0370> <03FF> <0370>',
    '<0900> <097F> <0900>',
    '<2000> <20FF> <2000>',
    '<2200> <22FF> <2200>',
    'endbfrange',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end'
  ].join('\n');
  const toUnicodeId = addObj(
    `<< /Length ${Buffer.byteLength(toUnicodeStream, 'latin1')} >>\nstream\n${toUnicodeStream}\nendstream`
  );
  const cidFontId = addObj(
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /NotoSansDevanagari /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 /CIDToGIDMap /Identity >>'
  );
  const fUniId = addObj(
    `<< /Type /Font /Subtype /Type0 /BaseFont /NotoSansDevanagari /Encoding /Identity-H /DescendantFonts [${cidFontId} 0 R] /ToUnicode ${toUnicodeId} 0 R >>`
  );

  // Image XObject (1x1 grayscale pixel)
  const imgData = Buffer.from([128]);
  const imgObjId = addObj(
    `<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n${imgData.toString('latin1')}\nendstream`
  );

  const pageIds = [];
  for (const spec of pagesSpec) {
    const ops = [];

    if (spec.hasImage) {
      ops.push('q 200 0 0 150 72 500 cm /Im1 Do Q');
    }

    if (spec.vectorRects) {
      for (let i = 0; i < spec.vectorRects; i++) {
        ops.push(`72 ${600 - i * 25} 180 20 re S`);
      }
    }

    if (spec.vectorLines) {
      for (let i = 0; i < spec.vectorLines; i++) {
        ops.push(`72 ${650 - i * 15} m 450 ${650 - i * 15} l S`);
      }
    }

    if (Array.isArray(spec.tableRows)) {
      for (let r = 0; r < spec.tableRows.length; r++) {
        const y = 720 - r * 22;
        const cols = spec.tableRows[r];
        for (let c = 0; c < cols.length; c++) {
          const x = 60 + c * 140;
          const esc = String(cols[c]).replace(/([()\\])/g, '\\$1');
          ops.push(`BT /F1 11 Tf ${x} ${y} Td (${esc}) Tj ET`);
        }
      }
    }

    if (spec.unicodeText) {
      const lines = Array.isArray(spec.unicodeText) ? spec.unicodeText : [spec.unicodeText];
      lines.forEach((line, idx) => {
        const y = 700 - idx * 18;
        let hex = '';
        for (const ch of String(line)) {
          const code = ch.codePointAt(0);
          hex += code.toString(16).padStart(4, '0').toUpperCase();
        }
        ops.push(`BT /FUni 12 Tf 72 ${y} Td <${hex}> Tj ET`);
      });
    }

    if (spec.text) {
      const fontRef = spec.font === 'preeti' ? '/FPreeti' : spec.font === 'math' ? '/FMath' : '/F1';
      const lines = Array.isArray(spec.text) ? spec.text : String(spec.text).split('\n');
      lines.forEach((line, idx) => {
        const y = (spec.startY || 720) - idx * 18;
        const esc = String(line).replace(/([()\\])/g, '\\$1');
        ops.push(`BT ${fontRef} 12 Tf 72 ${y} Td (${esc}) Tj ET`);
      });
    }

    const streamStr = ops.join('\n');
    const contentId = addObj(
      `<< /Length ${Buffer.byteLength(streamStr, 'latin1')} >>\nstream\n${streamStr}\nendstream`
    );

    const xobjDict = spec.hasImage ? `/XObject << /Im1 ${imgObjId} 0 R >>` : '';
    const pageId = addObj(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${f1Id} 0 R /FPreeti ${fPreetiId} 0 R /FMath ${fMathId} 0 R /FUni ${fUniId} 0 R >> ${xobjDict} >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  }

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`;

  let encryptId = null;
  if (encrypted) {
    encryptId = addObj(
      '<< /Filter /Standard /V 2 /R 3 /Length 128 /P -4 /O <0000000000000000000000000000000000000000000000000000000000000000> /U <0000000000000000000000000000000000000000000000000000000000000000> >>'
    );
  }

  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [0];
  let byteOffset = chunks[0].length;

  for (let i = 0; i < objects.length; i++) {
    offsets.push(byteOffset);
    const entry = Buffer.from(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`, 'latin1');
    chunks.push(entry);
    byteOffset += entry.length;
  }

  const xrefOffset = byteOffset;
  const xrefLines = [`xref`, `0 ${objects.length + 1}`, `0000000000 65535 f `];
  for (let i = 1; i <= objects.length; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, '0')} 00000 n `);
  }
  const encryptRef = encryptId ? ` /Encrypt ${encryptId} 0 R /ID [<0123456789ABCDEF> <0123456789ABCDEF>]` : '';
  xrefLines.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encryptRef} >>`);
  xrefLines.push(`startxref\n${xrefOffset}\n%%EOF\n`);
  chunks.push(Buffer.from(xrefLines.join('\n'), 'latin1'));

  return Buffer.concat(chunks);
}

/**
 * Helper to create a mocked Gemini generateContent fetchImpl with configurable per-page responses & fault injection.
 */
function createMockGeminiFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    let body = null;
    if (typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch (_) { body = init.body; }
    } else if (init.body) {
      body = init.body;
    }
    calls.push({ url, body });

    if (String(url).includes('/upload/v1beta/files')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ file: { uri: 'https://generativelanguage.googleapis.com/v1beta/files/mock-file-123' } }),
        text: async () => ''
      };
    }

    const promptText = body?.contents?.[0]?.parts?.find(p => typeof p.text === 'string')?.text || '';
    const pageMatch = promptText.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
    const pageNo = pageMatch ? Number(pageMatch[1]) : 1;

    const outcome = await handler({ pageNo, url, body, promptText, callIndex: calls.length });
    if (outcome && outcome.throwErr) {
      throw outcome.throwErr;
    }
    if (outcome && outcome.status && outcome.status !== 200) {
      return {
        ok: false,
        status: outcome.status,
        headers: { get: () => outcome.retryAfter || null },
        text: async () => outcome.errorBody || `HTTP ${outcome.status}`
      };
    }

    const payloadJson = JSON.stringify(outcome?.json || {
      text: `OCR extracted content for page ${pageNo}`,
      latex_present: false,
      figure_description: null,
      ocr_confidence: 0.92,
      detected_type: 'scanned'
    });

    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: payloadJson }] } }]
      }),
      text: async () => payloadJson
    };
  };

  return { fetchImpl, calls };
}

test('1. Migration UP and DOWN idempotently manage document_pages and ingestion_jobs + indexes on PGlite', async () => {
  const { pg } = await createD2TestDb();

  const tablesRes = await pg.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('document_pages', 'ingestion_jobs')
    ORDER BY table_name
  `);
  assert.deepEqual(tablesRes.rows.map(r => r.table_name), ['document_pages', 'ingestion_jobs']);

  const idxRes = await pg.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename IN ('document_pages', 'ingestion_jobs')
    ORDER BY indexname
  `);
  const indexNames = idxRes.rows.map(r => r.indexname);
  for (const expected of [
    'uq_dp_file_page',
    'idx_dp_file_status',
    'idx_dp_needs_vision',
    'uq_inj_active_file',
    'idx_inj_claim',
    'idx_inj_content_hash',
    'idx_inj_file_id'
  ]) {
    assert.ok(indexNames.includes(expected), `Missing index ${expected}; found: ${indexNames.join(', ')}`);
  }

  // Re-apply UP idempotently
  const upSql = fs.readFileSync(path.join(__dirname, '../migrations/20261112_doc_intelligence_d2.up.sql'), 'utf8');
  await pg.exec(upSql);

  // Apply DOWN cleanly
  const downSql = fs.readFileSync(path.join(__dirname, '../migrations/20261112_doc_intelligence_d2.down.sql'), 'utf8');
  await pg.exec(downSql);

  const afterDown = await pg.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('document_pages', 'ingestion_jobs')
  `);
  assert.equal(afterDown.rows.length, 0);

  // Re-apply UP
  await pg.exec(upSql);
  const afterReUp = await pg.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('document_pages', 'ingestion_jobs')
  `);
  assert.equal(afterReUp.rows.length, 2);
});

test('2. Vision OCR model must come strictly from env var and never be hardcoded', () => {
  assert.throws(
    () => resolveVisionModel({}, {}),
    (err) => err.code === 'VISION_MODEL_UNCONFIGURED' && err.transient === false
  );
  assert.equal(
    resolveVisionModel({}, { DOC_VISION_MODEL: 'gemini-custom-vision-test' }),
    'gemini-custom-vision-test'
  );

  const parsed = parseVisionJsonResponse('```json\n{"text":"$$E=mc^2$$","latex_present":true,"figure_description":"Energy diagram","ocr_confidence":0.95,"detected_type":"math"}\n```');
  assert.equal(parsed.text, '$$E=mc^2$$');
  assert.equal(parsed.latexPresent, true);
  assert.equal(parsed.figureDescription, 'Energy diagram');
  assert.equal(parsed.ocrConfidence, 0.95);
  assert.equal(parsed.detectedType, 'math');
});

test('3. Fixture 1 (Clean typed multi-page PDF): extracts via text_layer with 0 Vision calls, joins with \\f, enqueues knowledge_jobs', async () => {
  const { db } = await createD2TestDb();
  const pdf = buildSyntheticPdf([
    { text: 'Operating Systems Unit 1: Process scheduling, PCB structures, context switching, and CPU burst distributions in modern kernels.' },
    { text: 'Memory Management Unit 2: Paging hardware, TLB hit ratios, page fault handling, and working set replacement algorithms.' }
  ]);
  const { fileId } = await insertTestFile(db, { originalName: 'os_clean.pdf', buffer: pdf });
  const hash = computeContentHash(pdf);
  await enqueueDocumentIngestionJob(db, { fileId, contentHash: hash });

  const { fetchImpl, calls } = createMockGeminiFetch(async () => ({}));
  const outcome = await processNextIngestionJob(db, {
    fetchImpl,
    retryBackoffMs: 0,
    env: { DOC_VISION_MODEL: 'gemini-vision-test', GEMINI_API_KEY: 'test-key' }
  });

  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.totalPages, 2);
  assert.equal(outcome.visionPagesUsed, 0);
  assert.equal(calls.length, 0);

  const pagesRes = await db.query('SELECT * FROM document_pages WHERE file_id = $1 ORDER BY page_no ASC', [fileId]);
  assert.equal(pagesRes.rows.length, 2);
  assert.equal(pagesRes.rows[0].source, 'text_layer');
  assert.equal(pagesRes.rows[0].page_type, 'text');
  assert.equal(pagesRes.rows[0].status, 'completed');
  assert.equal(pagesRes.rows[0].page_image_path, null);
  assert.equal(pagesRes.rows[0].parser_version, PARSER_VERSION);

  const nsdRes = await db.query('SELECT * FROM note_search_documents WHERE id = $1', [fileId]);
  assert.equal(nsdRes.rows[0].extraction_status, 'indexed');
  const splitPages = nsdRes.rows[0].content.split('\f');
  assert.equal(splitPages.length, 2);
  assert.ok(splitPages[0].includes('Process scheduling'));
  assert.ok(splitPages[1].includes('Paging hardware'));

  const kjRes = await db.query("SELECT * FROM knowledge_jobs WHERE resource_id = $1", [`note:${fileId}`]);
  assert.equal(kjRes.rows.length, 1);
  assert.equal(kjRes.rows[0].status, 'pending');
  assert.equal(kjRes.rows[0].operation, 'index');
});

test('4. Fixture 2 & 3 (Scanned image-only PDF & Mixed typed + scanned + blank PDF): preserves all pages in order without dropping scanned pages', async () => {
  const { db } = await createD2TestDb();
  // Pure scanned 1-page PDF (embedded image, < 50 clean chars)
  const scannedPdf = buildSyntheticPdf([
    { hasImage: true, text: 'Page 1' }
  ]);
  const scannedFile = await insertTestFile(db, { originalName: 'scanned_only.pdf', buffer: scannedPdf });
  await enqueueDocumentIngestionJob(db, { fileId: scannedFile.fileId, contentHash: computeContentHash(scannedPdf) });

  // Mixed PDF: Page 1 typed, Page 2 scanned diagram image, Page 3 blank/footer-only, Page 4 typed
  const mixedPdf = buildSyntheticPdf([
    { text: 'Chapter 3: Relational Algebra operations include selection, projection, Cartesian product, and natural join over schemas.' },
    { hasImage: true, text: 'Page 2' },
    { text: '   ' },
    { text: 'Normal Forms: First Normal Form eliminates repeating groups while Boyce-Codd Normal Form removes nontrivial functional dependencies.' }
  ]);
  const mixedFile = await insertTestFile(db, { originalName: 'mixed_notes.pdf', buffer: mixedPdf });
  await enqueueDocumentIngestionJob(db, { fileId: mixedFile.fileId, contentHash: computeContentHash(mixedPdf) });

  const seenVisionUrls = [];
  const { fetchImpl, calls } = createMockGeminiFetch(async ({ pageNo, url }) => {
    seenVisionUrls.push(url);
    return {
      json: {
        text: `Handwritten scanned diagram notes on page ${pageNo}: B-Tree index node splitting.`,
        latex_present: false,
        figure_description: 'B-Tree split flowchart showing median key promotion',
        ocr_confidence: 0.88,
        detected_type: 'scanned'
      }
    };
  });

  const summary = await runIngestionWorkerLoop(db, {
    fetchImpl,
    retryBackoffMs: 0,
    env: { DOC_VISION_MODEL: 'gemini-vision-test', GEMINI_API_KEY: 'test-key' }
  });

  assert.equal(summary.processedJobs, 2);
  assert.equal(summary.results[0].status, 'completed');
  assert.equal(summary.results[1].status, 'completed');
  // 1 vision call for scanned_only + 1 vision call (only Page 2!) for mixed_notes = 2 total
  assert.equal(calls.length, 2);
  assert.ok(seenVisionUrls.every(u => u.includes('gemini-vision-test')));

  const mixedPages = (await db.query('SELECT * FROM document_pages WHERE file_id = $1 ORDER BY page_no ASC', [mixedFile.fileId])).rows;
  assert.equal(mixedPages.length, 4);
  assert.equal(mixedPages[0].source, 'text_layer');
  assert.equal(mixedPages[1].source, 'vision');
  assert.equal(mixedPages[1].ocr_confidence, 0.88);
  assert.equal(mixedPages[1].figure_description, 'B-Tree split flowchart showing median key promotion');
  assert.equal(mixedPages[1].page_image_path, null);
  assert.equal(mixedPages[2].source, 'skipped');
  assert.equal(mixedPages[2].status, 'skipped');
  assert.equal(mixedPages[3].source, 'text_layer');

  const nsd = (await db.query('SELECT * FROM note_search_documents WHERE id = $1', [mixedFile.fileId])).rows[0];
  assert.equal(nsd.extraction_status, 'indexed');
  const joinedParts = nsd.content.split('\f');
  assert.equal(joinedParts.length, 4);
  assert.ok(joinedParts[0].includes('Relational Algebra'));
  assert.ok(joinedParts[1].includes('B-Tree index node splitting'));
  assert.equal(joinedParts[2], '');
  assert.ok(joinedParts[3].includes('Boyce-Codd Normal Form'));
});

test('5. Fixture 4 (Nepali Devanagari UTF-8 & Preeti legacy mojibake): UTF-8 stays text_layer; Preeti routes to Vision OCR', async () => {
  const { db } = await createD2TestDb();
  const utf8NepaliText = [
    'नेपालको संविधान र कम्प्युटर सञ्जाल अध्ययन सामग्री',
    'नेपालको संविधान र कम्प्युटर सञ्जाल अध्ययन सामग्री'
  ];
  const preetiMojibakeText = 'k|yd v08sf] g]kfnL k|ljlw tyf sDKo"6/ cWoog ;fdflu| tyf cfhsf] ljifo jif{ @)*#';

  const pdf = buildSyntheticPdf([
    { unicodeText: utf8NepaliText },
    { font: 'preeti', text: preetiMojibakeText }
  ]);
  const { fileId } = await insertTestFile(db, { originalName: 'nepali_mixed.pdf', buffer: pdf });
  await enqueueDocumentIngestionJob(db, { fileId, contentHash: computeContentHash(pdf) });

  const { fetchImpl, calls } = createMockGeminiFetch(async () => ({
    json: {
      text: 'प्रथम खण्डको नेपाली प्रविधि तथा कम्प्युटर अध्ययन सामग्री र विषय वर्ष २०८३।',
      latex_present: false,
      figure_description: null,
      ocr_confidence: 0.91,
      detected_type: 'scanned'
    }
  }));

  const outcome = await processNextIngestionJob(db, {
    fetchImpl,
    retryBackoffMs: 0,
    env: { DOC_VISION_MODEL: 'gemini-vision-test', GEMINI_API_KEY: 'test-key' }
  });

  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.visionPagesUsed, 1);
  assert.equal(calls.length, 1);

  const pages = (await db.query('SELECT * FROM document_pages WHERE file_id = $1 ORDER BY page_no ASC', [fileId])).rows;
  assert.equal(pages[0].source, 'text_layer');
  assert.ok(pages[0].text.includes('नेपालको संविधान'));
  assert.equal(pages[1].source, 'vision');
  assert.ok(pages[1].text.includes('प्रथम खण्डको नेपाली प्रविधि'));

  // Unit assertion on Preeti detector too
  assert.equal(
    detectLegacyNepaliMojibake(preetiMojibakeText, { f1: { fontFamily: 'Preeti' } }).detected,
    true
  );
});

test('6. Fixture 5 (Large 120-page PDF + lease expiry resume + 60-vision-page quota resume)', async () => {
  const { db } = await createD2TestDb();

  // Part A: 120-page typed PDF with mid-run simulated worker crash after page 60 + stale lease takeover
  const pages120 = Array.from({ length: 120 }, (_, i) => ({
    text: `Lecture Page ${i + 1}: Distributed consensus protocols, Raft leader election, replicated state machines, and linearizability proofs.`
  }));
  const largePdf = buildSyntheticPdf(pages120);
  const largeFile = await insertTestFile(db, { originalName: 'large_120p.pdf', buffer: largePdf });
  await enqueueDocumentIngestionJob(db, { fileId: largeFile.fileId, contentHash: computeContentHash(largePdf) });

  const crashOutcome = await processNextIngestionJob(db, {
    workerId: 'worker-crashed',
    heartbeatEveryPages: 10,
    retryBackoffMs: 0,
    onAfterPage: async ({ pageNo }) => {
      if (pageNo === 60) {
        throw Object.assign(new Error('SIMULATED_SIGKILL'), { code: 'SIGKILL' });
      }
    }
  });
  assert.equal(crashOutcome.status, 'failed_retryable');
  assert.match(crashOutcome.error, /SIMULATED_SIGKILL/);

  // Confirm 60 checkpointed pages exist before recovery; simulate stale extracting_text lease
  const beforeRecover = await db.query('SELECT COUNT(*)::int AS cnt FROM document_pages WHERE file_id = $1', [largeFile.fileId]);
  assert.equal(beforeRecover.rows[0].cnt, 60);

  await db.query(`
    UPDATE ingestion_jobs
    SET status = 'extracting_text',
        heartbeat_at = CURRENT_TIMESTAMP - INTERVAL '10 minutes',
        locked_at = CURRENT_TIMESTAMP - INTERVAL '10 minutes'
    WHERE file_id = $1
  `, [largeFile.fileId]);

  const visitedAfterResume = [];
  const recoverOutcome = await processNextIngestionJob(db, {
    workerId: 'worker-recovered',
    leaseMinutes: 3,
    retryBackoffMs: 0,
    onAfterPage: async ({ pageNo }) => {
      visitedAfterResume.push(pageNo);
    }
  });

  assert.equal(recoverOutcome.status, 'completed');
  assert.equal(recoverOutcome.totalPages, 120);
  // Pages 1..60 were skipped from checkpoint; only 61..120 executed
  assert.equal(visitedAfterResume.length, 60);
  assert.equal(visitedAfterResume[0], 61);
  assert.equal(visitedAfterResume[59], 120);

  // Part B: 65 scanned pages -> hits DOC_MAX_VISION_PAGES=60 cap, produces partial_success, then resumes 61..65
  const pages65 = Array.from({ length: 65 }, (_, i) => ({
    hasImage: true,
    text: `Slide ${i + 1}`
  }));
  const quotaPdf = buildSyntheticPdf(pages65);
  const quotaFile = await insertTestFile(db, { originalName: 'scanned_65p.pdf', buffer: quotaPdf });
  await enqueueDocumentIngestionJob(db, { fileId: quotaFile.fileId, contentHash: computeContentHash(quotaPdf) });

  const visionCalledPages = [];
  const { fetchImpl } = createMockGeminiFetch(async ({ pageNo }) => {
    visionCalledPages.push(pageNo);
    return {
      json: {
        text: `Recovered vision content for scanned slide ${pageNo}`,
        latex_present: false,
        figure_description: null,
        ocr_confidence: 0.9,
        detected_type: 'scanned'
      }
    };
  });

  const capOutcome = await processNextIngestionJob(db, {
    fetchImpl,
    retryBackoffMs: 0,
    maxVisionPages: 60,
    env: { DOC_VISION_MODEL: 'gemini-vision-test', GEMINI_API_KEY: 'test-key' }
  });

  assert.equal(capOutcome.status, 'partial_success');
  assert.equal(capOutcome.visionPagesUsed, 60);
  assert.equal(capOutcome.skippedQuotaPages, 5);
  assert.equal(visionCalledPages.length, 60);

  const skippedRows = await db.query(
    "SELECT page_no, status FROM document_pages WHERE file_id = $1 AND status = 'skipped_quota' ORDER BY page_no",
    [quotaFile.fileId]
  );
  assert.deepEqual(skippedRows.rows.map(r => Number(r.page_no)), [61, 62, 63, 64, 65]);

  // Raise cap to 70 and re-queue to resume skipped_quota pages without re-calling Vision on pages 1..60
  await enqueueDocumentIngestionJob(db, { fileId: quotaFile.fileId, contentHash: computeContentHash(quotaPdf) });
  const resumeQuotaOutcome = await processNextIngestionJob(db, {
    fetchImpl,
    retryBackoffMs: 0,
    maxVisionPages: 70,
    env: { DOC_VISION_MODEL: 'gemini-vision-test', GEMINI_API_KEY: 'test-key' }
  });

  assert.equal(resumeQuotaOutcome.status, 'completed');
  assert.equal(resumeQuotaOutcome.visionPagesUsed, 65);
  assert.equal(resumeQuotaOutcome.skippedQuotaPages, 0);
  assert.deepEqual(visionCalledPages.slice(60), [61, 62, 63, 64, 65]);
});

test('7. Fixture 6 (Password-protected PDF, corrupt PDF, transient 429/503 retries & partial_success page isolation)', async () => {
  const { db } = await createD2TestDb();

  // 7a: Password-protected PDF
  const encryptedPdf = buildSyntheticPdf([{ text: 'Secret' }], { encrypted: true });
  const encFile = await insertTestFile(db, { originalName: 'locked.pdf', buffer: encryptedPdf });
  await enqueueDocumentIngestionJob(db, { fileId: encFile.fileId, contentHash: computeContentHash(encryptedPdf) });

  const encOutcome = await processNextIngestionJob(db, { retryBackoffMs: 0 });
  assert.equal(encOutcome.status, 'failed_terminal');
  const encJob = (await db.query('SELECT status, error FROM ingestion_jobs WHERE file_id = $1', [encFile.fileId])).rows[0];
  assert.equal(encJob.status, 'failed_terminal');
  assert.match(encJob.error, /PASSWORD_PROTECTED/);

  // 7b: Corrupt non-PDF bytes
  const corruptPdf = Buffer.from('NOT_A_REAL_PDF_CORRUPTED_BYTES_000111222', 'utf8');
  const corFile = await insertTestFile(db, { originalName: 'corrupt.pdf', buffer: corruptPdf });
  await enqueueDocumentIngestionJob(db, { fileId: corFile.fileId, contentHash: computeContentHash(corruptPdf) });

  const corOutcome = await processNextIngestionJob(db, { retryBackoffMs: 0 });
  assert.equal(corOutcome.status, 'failed_terminal');
  const corJob = (await db.query('SELECT status, error FROM ingestion_jobs WHERE file_id = $1', [corFile.fileId])).rows[0];
  assert.equal(corJob.status, 'failed_terminal');
  assert.match(corJob.error, /CORRUPT_FILE/);

  // 7c: Per-page retry (max 3) & failure isolation:
  // Page 1: typed text -> ok
  // Page 2: scanned -> fails 429/503 permanently (3 attempts) -> page failed, rest continue!
  // Page 3: scanned -> fails 429, 503, then succeeds on 3rd attempt (attempts=3)
  const isolationPdf = buildSyntheticPdf([
    { text: 'Introduction to Microprocessor Architecture: Registers, buses, ALU flags, and instruction pipelining cycles.' },
    { hasImage: true, text: 'Page 2' },
    { hasImage: true, text: 'Page 3' }
  ]);
  const isoFile = await insertTestFile(db, { originalName: 'partial_isolation.pdf', buffer: isolationPdf });
  await enqueueDocumentIngestionJob(db, { fileId: isoFile.fileId, contentHash: computeContentHash(isolationPdf) });

  const pageAttempts = { 2: 0, 3: 0 };
  const { fetchImpl } = createMockGeminiFetch(async ({ pageNo }) => {
    pageAttempts[pageNo] = (pageAttempts[pageNo] || 0) + 1;
    if (pageNo === 2) {
      return { status: 503, errorBody: 'Upstream Vision overloaded' };
    }
    if (pageNo === 3 && pageAttempts[pageNo] === 1) {
      return { status: 429, errorBody: 'Rate limited' };
    }
    if (pageNo === 3 && pageAttempts[pageNo] === 2) {
      return { status: 503, errorBody: 'Temporary backend error' };
    }
    return {
      json: {
        text: 'Timing diagram recovered cleanly on 3rd attempt.',
        latex_present: false,
        figure_description: 'Clock edge waveform diagram',
        ocr_confidence: 0.87,
        detected_type: 'figure'
      }
    };
  });

  const isoOutcome = await processNextIngestionJob(db, {
    fetchImpl,
    retryBackoffMs: 0,
    maxPageAttempts: 3,
    env: { DOC_VISION_MODEL: 'gemini-vision-test', GEMINI_API_KEY: 'test-key' }
  });

  assert.equal(isoOutcome.status, 'partial_success');
  assert.equal(isoOutcome.failedPages, 1);
  assert.equal(isoOutcome.visionPagesUsed, 1);
  assert.equal(pageAttempts[2], 3);
  assert.equal(pageAttempts[3], 3);

  const isoPages = (await db.query('SELECT * FROM document_pages WHERE file_id = $1 ORDER BY page_no', [isoFile.fileId])).rows;
  assert.equal(isoPages[0].status, 'completed');
  assert.equal(isoPages[1].status, 'failed');
  assert.equal(Number(isoPages[1].attempts), 3);
  assert.equal(isoPages[2].status, 'completed');
  assert.equal(Number(isoPages[2].attempts), 3);
  assert.ok(isoPages[2].text.includes('Timing diagram recovered cleanly'));
});

test('8. Fixture 7 (Duplicate upload content_hash dedup): second upload transitions to dedup_reused with 0 Vision/parse calls', async () => {
  const { db } = await createD2TestDb();
  const sharedPdf = buildSyntheticPdf([
    { hasImage: true, text: 'Slide 1' },
    { text: 'Digital Signal Processing: Discrete Fourier Transform, butterfly radix-2 FFT structure, and FIR window filters.' }
  ]);
  const sharedHash = computeContentHash(sharedPdf);

  const f1 = await insertTestFile(db, { originalName: 'dsp_copy1.pdf', buffer: sharedPdf });
  await enqueueDocumentIngestionJob(db, { fileId: f1.fileId, contentHash: sharedHash });

  const { fetchImpl, calls } = createMockGeminiFetch(async () => ({
    json: {
      text: '$$X[k] = \\sum_{n=0}^{N-1} x[n] e^{-j 2\\pi k n / N}$$',
      latex_present: true,
      figure_description: null,
      ocr_confidence: 0.96,
      detected_type: 'math'
    }
  }));

  const res1 = await processNextIngestionJob(db, {
    fetchImpl,
    retryBackoffMs: 0,
    env: { DOC_VISION_MODEL: 'gemini-vision-test', GEMINI_API_KEY: 'test-key' }
  });
  assert.equal(res1.status, 'completed');
  assert.equal(calls.length, 1);

  // Upload byte-identical file under a new file row
  const f2 = await insertTestFile(db, { originalName: 'dsp_copy2.pdf', buffer: Buffer.from(sharedPdf) });
  await enqueueDocumentIngestionJob(db, { fileId: f2.fileId, contentHash: sharedHash });

  const res2 = await processNextIngestionJob(db, {
    fetchImpl,
    retryBackoffMs: 0,
    env: { DOC_VISION_MODEL: 'gemini-vision-test', GEMINI_API_KEY: 'test-key' }
  });

  assert.equal(res2.status, 'dedup_reused');
  assert.equal(res2.reusedFromFileId, f1.fileId);
  assert.equal(calls.length, 1, 'Expected zero additional Vision calls for duplicate content_hash');

  const f2Pages = (await db.query('SELECT * FROM document_pages WHERE file_id = $1 ORDER BY page_no', [f2.fileId])).rows;
  assert.equal(f2Pages.length, 2);
  assert.equal(f2Pages[0].latex_present, true);
  assert.equal(f2Pages[0].page_image_path, null);
  assert.ok(f2Pages[0].text.includes('\\sum_{n=0}^{N-1}'));

  const nsd2 = (await db.query('SELECT * FROM note_search_documents WHERE id = $1', [f2.fileId])).rows[0];
  assert.equal(nsd2.extraction_status, 'indexed');
  const kj2 = (await db.query('SELECT * FROM knowledge_jobs WHERE resource_id = $1', [`note:${f2.fileId}`])).rows;
  assert.equal(kj2.length, 1);
});

test('9. D1 Section 11 Fixtures (Math-heavy, Diagrams/Figures, Tables, Handwritten Maths): accurate page_type, LaTeX, Markdown tables & figure_description', async () => {
  const { db } = await createD2TestDb();

  // Page 1: Math-heavy page with math symbols / CambriaMath font
  // Page 2: Diagrams / Figures page (embedded image + vector boxes + short caption)
  // Page 3: Tables page (aligned multi-column grid with vector separator lines)
  // Page 4: Handwritten maths page (<50 chars + image XObject)
  const stemPdf = buildSyntheticPdf([
    {
      font: 'math',
      text: [
        'Theorem 1: Let f be continuous on [a, b] and differentiable on (a, b).',
        'Evaluation of definite integral: int f(x) dx = F(b) - F(a) where F prime = f.',
        'Partial derivative gradient nabla f = (df/dx, df/dy) and Laplacian operator.',
        'Convergence condition holds for all epsilon > 0 with Cauchy sequence limit.'
      ],
      unicodeText: '∫₀¹ x² dx = ⅓, ∂f/∂x ≈ ∑ αᵢ√βᵢ ≤ ∞ ≠ 0'
    },
    {
      hasImage: true,
      vectorRects: 5,
      text: 'Figure 2.1: Three-stage CPU fetch, decode, and execute hardware datapath with pipeline hazard MUX.'
    },
    {
      vectorLines: 4,
      tableRows: [
        ['Protocol', 'Layer', 'DefaultPort', 'Transport'],
        ['HTTP', 'Application', '80', 'TCP'],
        ['HTTPS', 'Application', '443', 'TLS/TCP'],
        ['DNS', 'Application', '53', 'UDP/TCP']
      ]
    },
    {
      hasImage: true,
      text: 'HW Prob 4'
    }
  ]);

  const { fileId } = await insertTestFile(db, { originalName: 'stem_fixtures.pdf', buffer: stemPdf });
  await enqueueDocumentIngestionJob(db, { fileId, contentHash: computeContentHash(stemPdf) });

  const { fetchImpl, calls } = createMockGeminiFetch(async ({ pageNo }) => {
    if (pageNo === 1) {
      return {
        json: {
          text: 'Theorem 1: Continuous differentiable integral gradient nabla Laplacian convergence Cauchy sequence limit $$\\int_0^1 x^2\\,dx = \\frac{1}{3},\\quad \\frac{\\partial f}{\\partial x} \\approx \\sum \\alpha_i \\sqrt{\\beta_i}$$',
          latex_present: true,
          figure_description: null,
          ocr_confidence: 0.96,
          detected_type: 'math'
        }
      };
    }
    if (pageNo === 2) {
      return {
        json: {
          text: 'Figure 2.1: Three-stage CPU fetch, decode, and execute pipeline datapath with forwarding MUX.',
          latex_present: false,
          figure_description: 'Block diagram connecting IF, ID, and EX stages through pipeline registers and a hazard detection multiplexer.',
          ocr_confidence: 0.93,
          detected_type: 'figure'
        }
      };
    }
    if (pageNo === 3) {
      return {
        json: {
          text: '| Protocol | Layer | DefaultPort | Transport |\n| --- | --- | --- | --- |\n| HTTP | Application | 80 | TCP |\n| HTTPS | Application | 443 | TLS/TCP |\n| DNS | Application | 53 | UDP/TCP |',
          latex_present: false,
          figure_description: null,
          ocr_confidence: 0.97,
          detected_type: 'table'
        }
      };
    }
    return {
      json: {
        text: 'Handwritten Solution Prob 4:\n$$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$$',
        latex_present: true,
        figure_description: 'Handwritten unit-circle squeeze theorem sketch',
        ocr_confidence: 0.84,
        detected_type: 'math'
      }
    };
  });

  const outcome = await processNextIngestionJob(db, {
    fetchImpl,
    retryBackoffMs: 0,
    env: { DOC_VISION_MODEL: 'gemini-vision-test', GEMINI_API_KEY: 'test-key' }
  });

  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.visionPagesUsed, 4);
  assert.equal(calls.length, 4);

  const pages = (await db.query('SELECT * FROM document_pages WHERE file_id = $1 ORDER BY page_no', [fileId])).rows;
  assert.equal(pages[0].page_type, 'math');
  assert.equal(pages[0].latex_present, true);
  assert.ok(pages[0].text.includes('\\int_0^1'));

  assert.equal(pages[1].page_type, 'figure');
  assert.match(pages[1].figure_description, /Block diagram connecting IF, ID, and EX/);

  assert.equal(pages[2].page_type, 'table');
  assert.ok(pages[2].text.includes('| Protocol | Layer | DefaultPort | Transport |'));

  assert.equal(pages[3].page_type, 'math');
  assert.equal(pages[3].latex_present, true);
  assert.equal(pages[3].page_image_path, null);

  const nsd = (await db.query('SELECT * FROM note_search_documents WHERE id = $1', [fileId])).rows[0];
  assert.ok(nsd.content.includes('[Figure: Block diagram connecting IF, ID, and EX stages through pipeline registers and a hazard detection multiplexer.]'));

  // Direct unit tests for classifier rules
  const tableCls = classifyPageSignals({
    rawText: [
      'ColumnAlpha   ColumnBeta    ColumnGamma',
      'ValueOneRow   ValueTwoRow   ValueThreeRow',
      'ValueFourRw   ValueFiveRw   ValueSixRow',
      'ValueSevnRw   ValueEightRw  ValueNineRow'
    ].join('\n'),
    lines: [
      { text: 'ColumnAlpha   ColumnBeta    ColumnGamma', items: [{ str: 'ColumnAlpha', x: 50, width: 60 }, { str: 'ColumnBeta', x: 180, width: 55 }, { str: 'ColumnGamma', x: 310, width: 65 }] },
      { text: 'ValueOneRow   ValueTwoRow   ValueThreeRow', items: [{ str: 'ValueOneRow', x: 50, width: 60 }, { str: 'ValueTwoRow', x: 180, width: 55 }, { str: 'ValueThreeRow', x: 310, width: 65 }] },
      { text: 'ValueFourRw   ValueFiveRw   ValueSixRow', items: [{ str: 'ValueFourRw', x: 50, width: 60 }, { str: 'ValueFiveRw', x: 180, width: 55 }, { str: 'ValueSixRow', x: 310, width: 65 }] },
      { text: 'ValueSevnRw   ValueEightRw  ValueNineRow', items: [{ str: 'ValueSevnRw', x: 50, width: 60 }, { str: 'ValueEightRw', x: 180, width: 55 }, { str: 'ValueNineRow', x: 310, width: 65 }] }
    ],
    styles: { f1: { fontFamily: 'Helvetica' } },
    imageOps: 0,
    vectorOps: 8,
    ruleLineOps: 4
  });
  assert.equal(tableCls.pageType, 'table');
  assert.equal(tableCls.route, 'vision');
  assert.equal(detectTableSignal(
    [
      { text: 'Col1   Col2   Col3', items: [{ str: 'Col1', x: 50, width: 20 }, { str: 'Col2', x: 160, width: 20 }, { str: 'Col3', x: 270, width: 20 }] },
      { text: 'Val1   Val2   Val3', items: [{ str: 'Val1', x: 50, width: 20 }, { str: 'Val2', x: 160, width: 20 }, { str: 'Val3', x: 270, width: 20 }] },
      { text: 'Val4   Val5   Val6', items: [{ str: 'Val4', x: 50, width: 20 }, { str: 'Val5', x: 160, width: 20 }, { str: 'Val6', x: 270, width: 20 }] },
      { text: 'Val7   Val8   Val9', items: [{ str: 'Val7', x: 50, width: 20 }, { str: 'Val8', x: 160, width: 20 }, { str: 'Val9', x: 270, width: 20 }] }
    ],
    2
  ).isTable, true);

  assert.equal(detectMathSignal('Broken glyph \uFFFD and ∑∫∂∇', { f1: { fontFamily: 'CambriaMath' } }).brokenOrDense, true);
});

test('10. Concurrent worker safety: claimNextIngestionJob enforces lease & non-blocking upload enqueue returns fast without extraction', async () => {
  const { db } = await createD2TestDb();
  const pdf = buildSyntheticPdf([{ text: 'Concurrent upload test page with clean extractable academic content over fifty chars.' }]);
  const { fileId } = await insertTestFile(db, { originalName: 'fast_enqueue.pdf', buffer: pdf });

  const enqueued = await enqueueDocumentIngestionJob(db, {
    fileId,
    contentHash: computeContentHash(pdf)
  });
  assert.equal(enqueued.status, 'queued');
  assert.ok(enqueued.jobId > 0);

  // Immediately after upload/enqueue, neither document_pages nor note_search_documents are populated yet
  const pagesBeforeWorker = await db.query('SELECT COUNT(*)::int AS cnt FROM document_pages WHERE file_id = $1', [fileId]);
  const nsdBeforeWorker = await db.query('SELECT COUNT(*)::int AS cnt FROM note_search_documents WHERE id = $1', [fileId]);
  assert.equal(pagesBeforeWorker.rows[0].cnt, 0);
  assert.equal(nsdBeforeWorker.rows[0].cnt, 0);

  // First claim succeeds; second immediate claim gets null because job is leased in extracting_text
  const claimed1 = await claimNextIngestionJob(db, { workerId: 'w-1', leaseMinutes: 3 });
  assert.ok(claimed1 && Number(claimed1.file_id) === fileId);
  assert.equal(claimed1.status, 'extracting_text');
  assert.equal(claimed1.worker_id, 'w-1');

  const claimed2 = await claimNextIngestionJob(db, { workerId: 'w-2', leaseMinutes: 3 });
  assert.equal(claimed2, null);

  // After worker completes, note_search_documents is populated
  await db.query("UPDATE ingestion_jobs SET status = 'queued', heartbeat_at = NULL, locked_at = NULL WHERE id = $1", [claimed1.id]);
  const finalOutcome = await processNextIngestionJob(db, { workerId: 'w-2', retryBackoffMs: 0 });
  assert.equal(finalOutcome.status, 'completed');

  const nsdAfter = await db.query('SELECT extraction_status FROM note_search_documents WHERE id = $1', [fileId]);
  assert.equal(nsdAfter.rows[0].extraction_status, 'indexed');
});

test('11. Per-page Vision timeout (AbortController) & pgPool transaction claim path isolate timeouts', async () => {
  const { pg, db } = await createD2TestDb();
  let beginCount = 0;
  let commitCount = 0;
  let released = 0;
  db.pgPool = {
    connect: async () => ({
      query: async (sql, params) => {
        if (sql === 'BEGIN') beginCount++;
        if (sql === 'COMMIT') commitCount++;
        return pg.query(sql, params);
      },
      release: () => { released++; }
    })
  };

  const pdf = buildSyntheticPdf([
    { hasImage: true, text: 'Page 1 hangs' },
    { hasImage: true, text: 'Page 2 fast' }
  ]);
  const { fileId } = await insertTestFile(db, { originalName: 'timeout_isolation.pdf', buffer: pdf });
  await enqueueDocumentIngestionJob(db, { fileId, contentHash: computeContentHash(pdf) });

  const attemptsPerPage = { 1: 0, 2: 0 };
  const fetchImpl = async (_url, init = {}) => {
    const body = JSON.parse(init.body || '{}');
    const promptText = body?.contents?.[0]?.parts?.find(p => typeof p.text === 'string')?.text || '';
    const pageNo = Number((promptText.match(/Page\s+(\d+)\s+of/i) || [])[1] || 1);
    attemptsPerPage[pageNo]++;

    if (pageNo === 1) {
      // Simulate hanging request aborted by AbortController timeout
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted due to timeout');
          err.name = 'AbortError';
          reject(err);
        }, { once: true });
      });
    }

    const payload = JSON.stringify({
      text: 'Page 2 extracted quickly after page 1 timed out.',
      latex_present: false,
      figure_description: null,
      ocr_confidence: 0.9,
      detected_type: 'scanned'
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: payload }] } }] }),
      text: async () => payload
    };
  };

  const outcome = await processNextIngestionJob(db, {
    fetchImpl,
    pageTimeoutMs: 40,
    maxPageAttempts: 2,
    retryBackoffMs: 0,
    env: { DOC_VISION_MODEL: 'gemini-vision-test', GEMINI_API_KEY: 'test-key' }
  });

  assert.equal(beginCount, 1);
  assert.equal(commitCount, 1);
  assert.equal(released, 1);
  assert.equal(outcome.status, 'partial_success');
  assert.equal(outcome.failedPages, 1);
  assert.equal(outcome.visionPagesUsed, 1);
  assert.equal(attemptsPerPage[1], 2);
  assert.equal(attemptsPerPage[2], 1);

  const pages = (await db.query('SELECT page_no, status, error FROM document_pages WHERE file_id = $1 ORDER BY page_no', [fileId])).rows;
  assert.equal(pages[0].status, 'failed');
  assert.match(pages[0].error, /VISION_TIMEOUT|aborted/i);
  assert.equal(pages[1].status, 'completed');
});

test('12. Fix A & Fix C: Upload never fails when enqueue throws/errors, keeps file row, and seeds searchable metadata fallback', async () => {
  // Part A: enqueueDocumentIngestionJob returns queued_schema_pending cleanly when ingestion_jobs is missing
  const { db: pgDb } = await createD2TestDb();
  await pgDb.exec('DROP TABLE ingestion_jobs;');
  const pdf = buildSyntheticPdf([{ text: 'Quantum Cryptography: BB84 key distribution protocol and photon polarization states.' }]);
  const { fileId: pgFileId } = await insertTestFile(pgDb, {
    originalName: 'quantum_bb84_notes.pdf',
    title: 'Quantum BB84 Notes',
    subject: 'Cryptography',
    chapter: 'Unit 4',
    buffer: pdf
  });

  const schemaPending = await enqueueDocumentIngestionJob(pgDb, {
    fileId: pgFileId,
    contentHash: computeContentHash(pdf)
  });
  assert.equal(schemaPending.status, 'queued_schema_pending');

  // Seed metadata row on Postgres PGlite before worker runs & verify seedMetadataIndex does not clobber indexed rows
  const seedRes = await noteSearch.seedMetadataIndex(pgDb, {
    id: pgFileId,
    originalName: 'quantum_bb84_notes.pdf',
    title: 'Quantum BB84 Notes',
    subject: 'Cryptography',
    chapter: 'Unit 4'
  });
  assert.equal(seedRes.status, 'pending_metadata_seeded');
  const nsdPgRow = (await pgDb.query('SELECT extraction_status, content FROM note_search_documents WHERE id = $1', [pgFileId])).rows[0];
  assert.equal(nsdPgRow.extraction_status, 'pending');
  assert.ok(nsdPgRow.content.includes('Quantum BB84 Notes'));

  // Subsequent conflict never overwrites an indexed row
  await pgDb.query("UPDATE note_search_documents SET extraction_status = 'indexed', content = 'FULL_EXTRACTED_TEXT' WHERE id = $1", [pgFileId]);
  await noteSearch.seedMetadataIndex(pgDb, { id: pgFileId, originalName: 'x.pdf', title: 'Overwritten?' });
  const preservedRow = (await pgDb.query('SELECT extraction_status, content FROM note_search_documents WHERE id = $1', [pgFileId])).rows[0];
  assert.equal(preservedRow.extraction_status, 'indexed');
  assert.equal(preservedRow.content, 'FULL_EXTRACTED_TEXT');

  // Part B: Full HTTP POST /api/files/upload with simulated enqueue failure -> upload still 200, keeps file row, logs error, searchable by filename/title
  const app = require('../server');
  const runtimeDb = require('../db');
  await runtimeDb.initSchema();

  const srv = http.createServer(app);
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${srv.address().port}`;

  const origEnqueue = docWorker.enqueueDocumentIngestionJob;
  const origConsoleError = console.error;
  const loggedErrors = [];
  let createdStoredName = null;

  try {
    const ts = Date.now();
    const adminId = `ADMIN_D2V_${ts}`;
    const adminToken = `tok_${adminId}`;
    await runtimeDb.run(
      'INSERT OR IGNORE INTO students (studentId, name, role, semester, passwordHash) VALUES (?, ?, ?, ?, ?)',
      adminId, 'D2V Admin', 'admin', 'Semester 3', 'hash'
    );
    await runtimeDb.run(
      'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
      adminToken, adminId, new Date().toISOString(), new Date(Date.now() + 86400000).toISOString()
    );

    docWorker.enqueueDocumentIngestionJob = async () => {
      throw new Error('SIMULATED_ENQUEUE_OUTAGE');
    };
    console.error = (...args) => {
      loggedErrors.push(args.map(a => String(a)).join(' '));
    };

    const formData = new FormData();
    formData.append('files', new Blob([pdf], { type: 'application/pdf' }), 'Dijkstra_Shortest_Path_Guide.pdf');
    formData.append('title', 'Graph Shortest Path Revision');
    formData.append('semester', 'Semester 3');
    formData.append('subject', 'Algorithms');
    formData.append('chapter', 'Unit 5');

    const res = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: formData
    });

    assert.equal(res.status, 200, 'Upload must succeed even when enqueue throws');
    const json = await res.json();
    assert.equal(json.count, 1);
    const uploadedId = json.files[0].id;
    createdStoredName = json.files[0].storedName;
    assert.ok(uploadedId > 0);
    assert.equal(json.files[0].indexing.status, 'enqueue_failed');
    assert.ok(loggedErrors.some(msg => msg.includes('Note ingestion enqueue failed') && msg.includes('SIMULATED_ENQUEUE_OUTAGE')));

    const savedFile = await runtimeDb.get('SELECT * FROM files WHERE id = ?', uploadedId);
    assert.ok(savedFile, 'File row must remain persisted when enqueue fails');
    assert.equal(savedFile.title, 'Graph Shortest Path Revision');

    // Fix C: Immediately searchable by filename/title before any worker runs
    const searchByFilename = await noteSearch.searchNotes(runtimeDb, { query: 'Dijkstra Shortest Path Guide', semester: '3' });
    assert.ok(searchByFilename.some(r => Number(r.id) === Number(uploadedId)), 'Newly uploaded file must be searchable by filename immediately');

    const searchByTitle = await noteSearch.searchNotes(runtimeDb, { query: 'Graph Shortest Path Revision', semester: '3' });
    assert.ok(searchByTitle.some(r => Number(r.id) === Number(uploadedId)), 'Newly uploaded file must be searchable by title immediately');

    const pendingDoc = await runtimeDb.get('SELECT extraction_status, content FROM note_search_documents WHERE id = ?', uploadedId);
    assert.equal(pendingDoc.extraction_status, 'pending');
    assert.ok(pendingDoc.content.includes('Dijkstra Shortest Path Guide'));
  } finally {
    docWorker.enqueueDocumentIngestionJob = origEnqueue;
    console.error = origConsoleError;
    if (createdStoredName) {
      try { fs.unlinkSync(path.join(__dirname, '../uploads', createdStoredName)); } catch (_) {}
    }
    await new Promise(resolve => srv.close(resolve));
  }
});

test('13. Fix B: reconcileMissingIngestionJobs backfills only missing files with limit and dry-run count-only mode + CLI flags', async () => {
  const { db } = await createD2TestDb();
  const samplePdf = buildSyntheticPdf([{ text: 'Sample note page content exceeding minimum character threshold cleanly.' }]);

  const fCompleted = await insertTestFile(db, { originalName: 'f1_done.pdf', buffer: samplePdf });
  await enqueueDocumentIngestionJob(db, { fileId: fCompleted.fileId, contentHash: 'h1' });
  await db.query("UPDATE ingestion_jobs SET status = 'completed' WHERE file_id = $1", [fCompleted.fileId]);

  const fDedup = await insertTestFile(db, { originalName: 'f2_dedup.pdf', buffer: samplePdf });
  await enqueueDocumentIngestionJob(db, { fileId: fDedup.fileId, contentHash: 'h1' });
  await db.query("UPDATE ingestion_jobs SET status = 'dedup_reused' WHERE file_id = $1", [fDedup.fileId]);

  const fTerminal = await insertTestFile(db, { originalName: 'f3_terminal.pdf', buffer: samplePdf });
  await enqueueDocumentIngestionJob(db, { fileId: fTerminal.fileId, contentHash: 'h3' });
  await db.query("UPDATE ingestion_jobs SET status = 'failed_terminal' WHERE file_id = $1", [fTerminal.fileId]);

  const fMissing1 = await insertTestFile(db, { originalName: 'f4_missing1.pdf', buffer: samplePdf });
  const fMissing2 = await insertTestFile(db, { originalName: 'f5_missing2.pdf', buffer: samplePdf });
  const fMissing3 = await insertTestFile(db, { originalName: 'f6_missing3.pdf', buffer: samplePdf });

  // Dry run with limit=2 counts all 3 missing but inserts zero rows
  const dry = await reconcileMissingIngestionJobs(db, { limit: 2, dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.totalMissing, 3);
  assert.equal(dry.wouldEnqueue, 2);
  assert.equal(dry.enqueued, 0);
  assert.deepEqual(dry.fileIds, [fMissing1.fileId, fMissing2.fileId]);

  const afterDryCount = await db.query('SELECT COUNT(*)::int AS cnt FROM ingestion_jobs');
  assert.equal(afterDryCount.rows[0].cnt, 3);

  // Backfill first 2
  const run1 = await reconcileMissingIngestionJobs(db, { limit: 2, dryRun: false });
  assert.equal(run1.dryRun, false);
  assert.equal(run1.totalMissing, 3);
  assert.equal(run1.enqueued, 2);
  assert.deepEqual(run1.fileIds, [fMissing1.fileId, fMissing2.fileId]);

  // Backfill remaining 1
  const run2 = await reconcileMissingIngestionJobs(db, { limit: 10, dryRun: false });
  assert.equal(run2.totalMissing, 1);
  assert.equal(run2.enqueued, 1);
  assert.deepEqual(run2.fileIds, [fMissing3.fileId]);

  // Idempotent when nothing missing
  const run3 = await reconcileMissingIngestionJobs(db, { limit: 10, dryRun: false });
  assert.equal(run3.totalMissing, 0);
  assert.equal(run3.enqueued, 0);

  // Verify CLI flag parsing
  assert.deepEqual(
    parseCliArgs(['--reconcile', '--limit', '25', '--dry-run']),
    {
      maxJobs: undefined,
      maxDurationMs: undefined,
      knowledgeBudgetMs: undefined,
      skipKnowledge: false,
      reconcile: true,
      dryRun: true,
      limit: 25,
      includePartial: false
    }
  );
  assert.deepEqual(
    parseCliArgs(['--backfill', '--limit=100']),
    {
      maxJobs: undefined,
      maxDurationMs: undefined,
      knowledgeBudgetMs: undefined,
      skipKnowledge: false,
      reconcile: true,
      dryRun: false,
      limit: 100,
      includePartial: false
    }
  );
});

test('14. Fix D: pdf-lib sends only 1-page (or <=3 consecutive page batch) slices inline and maps physical page numbers by position', async () => {
  const { db } = await createD2TestDb();

  // [1: scanned, 2: scanned, 3: clear text layer (>=50 clean chars), 4: scanned, 5: scanned]
  const fivePagePdf = buildSyntheticPdf([
    { hasImage: true, text: 'p1' },
    { hasImage: true, text: 'p2' },
    { text: 'Normal computer networks lecture slide covering congestion control and sliding window protocols.' },
    { hasImage: true, text: 'p4' },
    { hasImage: true, text: 'p5' }
  ]);

  // Part A: Default DOC_VISION_BATCH_PAGES=1 -> 4 separate 1-page inline slices, never whole 5-page PDF
  const { fileId: f1 } = await insertTestFile(db, { originalName: 'slice_single.pdf', buffer: fivePagePdf });
  await enqueueDocumentIngestionJob(db, { fileId: f1, contentHash: computeContentHash(fivePagePdf) });

  const singleCallPageCounts = [];
  const { fetchImpl: singleFetch, calls: singleCalls } = createMockGeminiFetch(async ({ pageNo, body }) => {
    const inlineB64 = body?.contents?.[0]?.parts?.[0]?.inlineData?.data;
    assert.ok(inlineB64, 'Expected inline base64 PDF slice');
    const sliceDoc = await PDFDocument.load(Buffer.from(inlineB64, 'base64'));
    singleCallPageCounts.push(sliceDoc.getPageCount());
    return {
      json: {
        text: `Single-slice OCR output for physical page ${pageNo}`,
        latex_present: false,
        figure_description: null,
        ocr_confidence: 0.91,
        detected_type: 'scanned'
      }
    };
  });

  const out1 = await processNextIngestionJob(db, {
    fetchImpl: singleFetch,
    retryBackoffMs: 0,
    env: { DOC_VISION_MODEL: 'gemini-vision-test', GEMINI_API_KEY: 'test-key' }
  });
  assert.equal(out1.status, 'completed');
  assert.deepEqual(singleCallPageCounts, [1, 1, 1, 1], 'Each default vision call must carry exactly a 1-page slice');
  assert.equal(singleCalls.some(c => c.url.includes('/upload/v1beta/files')), false, 'File API must not be called for small slices');

  const p1Rows = (await db.query('SELECT page_no, source, text FROM document_pages WHERE file_id = $1 ORDER BY page_no', [f1])).rows;
  assert.equal(p1Rows[0].text, 'Single-slice OCR output for physical page 1');
  assert.equal(p1Rows[1].text, 'Single-slice OCR output for physical page 2');
  assert.equal(p1Rows[2].source, 'text_layer');
  assert.equal(p1Rows[3].text, 'Single-slice OCR output for physical page 4');
  assert.equal(p1Rows[4].text, 'Single-slice OCR output for physical page 5');

  // Part B: DOC_VISION_BATCH_PAGES=3 -> consecutive vision runs grouped [1,2] and [4,5] (split cleanly around text_layer page 3)
  const fivePagePdfB = buildSyntheticPdf([
    { hasImage: true, text: 'p1b' },
    { hasImage: true, text: 'p2b' },
    { text: 'Normal computer networks lecture slide covering BGP routing, policy filters, and autonomous systems.' },
    { hasImage: true, text: 'p4b' },
    { hasImage: true, text: 'p5b' }
  ]);
  const { fileId: f2 } = await insertTestFile(db, { originalName: 'slice_batch_gap.pdf', buffer: fivePagePdfB });
  await enqueueDocumentIngestionJob(db, { fileId: f2, contentHash: computeContentHash(fivePagePdfB) });

  const batchSliceCounts = [];
  const batchFetch = async (url, init = {}) => {
    const body = JSON.parse(init.body || '{}');
    const inlineB64 = body?.contents?.[0]?.parts?.[0]?.inlineData?.data;
    assert.ok(inlineB64, 'Batched slice should be sent inline');
    const sliceDoc = await PDFDocument.load(Buffer.from(inlineB64, 'base64'));
    const count = sliceDoc.getPageCount();
    batchSliceCounts.push(count);
    const callIdx = batchSliceCounts.length;
    const pagesPayload = callIdx === 1
      ? [
        { text: 'Batch1 SlicePos0', latex_present: false, figure_description: null, ocr_confidence: 0.9, detected_type: 'scanned' },
        { text: 'Batch1 SlicePos1', latex_present: false, figure_description: null, ocr_confidence: 0.9, detected_type: 'scanned' }
      ]
      : [
        { text: 'Batch2 SlicePos0', latex_present: false, figure_description: null, ocr_confidence: 0.9, detected_type: 'scanned' },
        { text: 'Batch2 SlicePos1', latex_present: false, figure_description: null, ocr_confidence: 0.9, detected_type: 'scanned' }
      ];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 80 },
        candidates: [{ content: { parts: [{ text: JSON.stringify({ pages: pagesPayload }) }] } }]
      })
    };
  };

  const out2 = await processNextIngestionJob(db, {
    fetchImpl: batchFetch,
    retryBackoffMs: 0,
    env: { DOC_VISION_MODEL: 'gemini-vision-test', GEMINI_API_KEY: 'test-key', DOC_VISION_BATCH_PAGES: '3' }
  });
  assert.equal(out2.status, 'completed');
  assert.deepEqual(batchSliceCounts, [2, 2]);
  const p2Rows = (await db.query('SELECT page_no, text FROM document_pages WHERE file_id = $1 ORDER BY page_no', [f2])).rows;
  assert.equal(p2Rows[0].text, 'Batch1 SlicePos0');
  assert.equal(p2Rows[1].text, 'Batch1 SlicePos1');
  assert.equal(p2Rows[3].text, 'Batch2 SlicePos0');
  assert.equal(p2Rows[4].text, 'Batch2 SlicePos1');

  // Part C: 4 consecutive vision pages with DOC_VISION_BATCH_PAGES=3 -> [3, 1] slices
  const fourScannedPdf = buildSyntheticPdf([
    { hasImage: true, text: 'a' },
    { hasImage: true, text: 'b' },
    { hasImage: true, text: 'c' },
    { hasImage: true, text: 'd' }
  ]);
  const { fileId: f3 } = await insertTestFile(db, { originalName: 'four_consecutive.pdf', buffer: fourScannedPdf });
  await enqueueDocumentIngestionJob(db, { fileId: f3, contentHash: 'hash_four_consecutive' });
  const fourCounts = [];
  const fourFetch = async (_url, init = {}) => {
    const body = JSON.parse(init.body || '{}');
    const sliceDoc = await PDFDocument.load(Buffer.from(body.contents[0].parts[0].inlineData.data, 'base64'));
    const count = sliceDoc.getPageCount();
    fourCounts.push(count);
    const payload = count === 1
      ? { text: 'Consecutive page 4', latex_present: false, figure_description: null, ocr_confidence: 0.9, detected_type: 'scanned' }
      : {
        pages: Array.from({ length: count }, (_, idx) => ({
          text: `Consecutive page ${idx + 1}`,
          latex_present: false,
          figure_description: null,
          ocr_confidence: 0.9,
          detected_type: 'scanned'
        }))
      };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 60 },
        candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }]
      })
    };
  };
  await processNextIngestionJob(db, {
    fetchImpl: fourFetch,
    retryBackoffMs: 0,
    env: { DOC_VISION_MODEL: 'gemini-vision-test', GEMINI_API_KEY: 'test-key', DOC_VISION_BATCH_PAGES: '3' }
  });
  assert.deepEqual(fourCounts, [3, 1]);

  // Part D: File API fallback triggers ONLY when single slice exceeds inlinePdfMaxBytes
  const tinyLimitPdf = buildSyntheticPdf([{ hasImage: true, text: 'x' }]);
  const { fileId: f4 } = await insertTestFile(db, { originalName: 'oversize_slice.pdf', buffer: tinyLimitPdf });
  await enqueueDocumentIngestionJob(db, { fileId: f4, contentHash: 'hash_oversize_slice' });
  const { fetchImpl: fallbackFetch, calls: fallbackCalls } = createMockGeminiFetch(async () => ({
    json: { text: 'Uploaded oversized slice', latex_present: false, figure_description: null, ocr_confidence: 0.9, detected_type: 'scanned' }
  }));
  const out4 = await processNextIngestionJob(db, {
    fetchImpl: fallbackFetch,
    inlinePdfMaxBytes: 10,
    retryBackoffMs: 0,
    env: { DOC_VISION_MODEL: 'gemini-vision-test', GEMINI_API_KEY: 'test-key' }
  });
  assert.equal(out4.status, 'completed');
  assert.equal(fallbackCalls.some(c => c.url.includes('/upload/v1beta/files')), true);
});

test('15. Fix E: Drift check lowers confidence and flags PAGE_DRIFT_SUSPECTED when 50+ char vision page has very low word overlap', async () => {
  const { db } = await createD2TestDb();

  const driftPdf = buildSyntheticPdf([
    {
      font: 'math',
      text: [
        'Theorem 2: Thermodynamics entropy increases in every isolated reversible thermodynamic cycle.',
        'Maxwell relations connect pressure, volume, temperature, and internal energy differentials.'
      ],
      unicodeText: '∫₀¹ ∂U/∂S ≈ ∑ αᵢ√βᵢ ≤ ∞ ≠ 0'
    },
    {
      font: 'math',
      text: [
        'Theorem 3: Eigenvalues of a real symmetric Hermitian matrix are strictly orthogonal real numbers.',
        'Spectral decomposition diagonalizes quadratic forms in linear algebra.'
      ],
      unicodeText: '∫₀¹ Av ≈ λv, ∂f/∂x ≈ ∑ αᵢ√βᵢ ≤ ∞ ≠ 0'
    }
  ]);

  const { fileId } = await insertTestFile(db, { originalName: 'drift_test.pdf', buffer: driftPdf });
  await enqueueDocumentIngestionJob(db, { fileId, contentHash: computeContentHash(driftPdf) });

  const { fetchImpl } = createMockGeminiFetch(async ({ pageNo }) => {
    if (pageNo === 1) {
      // Completely unrelated hallucinated / drifted output
      return {
        json: {
          text: 'Chocolate banana pancake recipe with flour sugar eggs butter cooked slowly in skillet.',
          latex_present: false,
          figure_description: null,
          ocr_confidence: 0.95,
          detected_type: 'math'
        }
      };
    }
    return {
      json: {
        text: 'Theorem 3: Eigenvalues of a real symmetric Hermitian matrix are strictly orthogonal real numbers. Spectral decomposition diagonalizes quadratic forms.',
        latex_present: true,
        figure_description: null,
        ocr_confidence: 0.94,
        detected_type: 'math'
      }
    };
  });

  const out = await processNextIngestionJob(db, {
    fetchImpl,
    retryBackoffMs: 0,
    env: { DOC_VISION_MODEL: 'gemini-vision-test', GEMINI_API_KEY: 'test-key' }
  });
  assert.equal(out.status, 'completed');

  const pages = (await db.query('SELECT page_no, source, ocr_confidence, error FROM document_pages WHERE file_id = $1 ORDER BY page_no', [fileId])).rows;
  assert.equal(pages[0].source, 'vision');
  assert.ok(pages[0].ocr_confidence !== null);
  assert.ok(Number(pages[0].ocr_confidence) <= 0.35, `Expected lowered confidence <= 0.35, got ${pages[0].ocr_confidence}`);
  assert.match(String(pages[0].error || ''), /PAGE_DRIFT_SUSPECTED/);

  assert.equal(pages[1].source, 'vision');
  assert.equal(Number(pages[1].ocr_confidence), 0.94);
  assert.equal(pages[1].error, null);
});

test('16. Fix F: Self-contained worker drains knowledge_jobs in-process within budget and respects env gating', async () => {
  const { db } = await createD2TestDb();

  // Case 1: Disabled knowledge flags skip gracefully
  const skipped = await drainKnowledgeJobs(db, { enabled: false });
  assert.equal(skipped.skipped, true);
  assert.match(skipped.reason, /KYANA_KNOWLEDGE_V3/);

  // Case 2: Enabled drains batches until empty or wall-clock budget hit
  let remaining = 3;
  let batchCalls = 0;
  const drained = await drainKnowledgeJobs(db, {
    enabled: true,
    budgetMs: 5000,
    batchSize: 2,
    processPendingJobsFn: async (_workerDb, { batchSize }) => {
      batchCalls++;
      const take = Math.min(remaining, batchSize);
      remaining -= take;
      return { processed: take, succeeded: take, failed: 0 };
    }
  });
  assert.equal(drained.skipped, false);
  assert.equal(drained.processed, 3);
  assert.equal(drained.succeeded, 3);
  assert.equal(batchCalls, 3); // 2, 1, then 0

  // Case 3: Wall-clock budget exhaustion halts cleanly
  const timedOut = await drainKnowledgeJobs(db, {
    enabled: true,
    budgetMs: 15,
    batchSize: 1,
    processPendingJobsFn: async () => {
      await new Promise(r => setTimeout(r, 20));
      return { processed: 1, succeeded: 1, failed: 0 };
    }
  });
  assert.equal(timedOut.timedOut, true);
  assert.equal(timedOut.processed, 1);
});

test('17. Fix G: Cost tracking columns record vision_calls, vision_input_tokens, vision_output_tokens across retries and checkpoint resume', async () => {
  const { pg, db } = await createD2TestDb();

  // Verify columns exist after UP migration
  const colRes = await pg.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ingestion_jobs'
      AND column_name IN ('vision_calls', 'vision_input_tokens', 'vision_output_tokens')
    ORDER BY column_name
  `);
  assert.deepEqual(colRes.rows.map(r => r.column_name), ['vision_calls', 'vision_input_tokens', 'vision_output_tokens']);

  const scanned2 = buildSyntheticPdf([
    { hasImage: true, text: 'p1' },
    { hasImage: true, text: 'p2' }
  ]);
  const { fileId } = await insertTestFile(db, { originalName: 'usage_tracking.pdf', buffer: scanned2 });
  await enqueueDocumentIngestionJob(db, { fileId, contentHash: computeContentHash(scanned2) });

  let reqCount = 0;
  const usageFetch = async () => {
    reqCount++;
    if (reqCount === 1) {
      // Simulate transient 503 on first call before retry succeeds
      return { ok: false, status: 503, headers: { get: () => null }, text: async () => 'busy' };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 250 },
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                text: `Usage tracked OCR call #${reqCount}`,
                latex_present: false,
                figure_description: null,
                ocr_confidence: 0.9,
                detected_type: 'scanned'
              })
            }]
          }
        }]
      })
    };
  };

  // Run with quota=1 -> Page 1 retries once (2 vision calls, 1000 in, 250 out), Page 2 skipped_quota
  await processNextIngestionJob(db, {
    fetchImpl: usageFetch,
    maxVisionPages: 1,
    retryBackoffMs: 0,
    env: { DOC_VISION_MODEL: 'gemini-vision-test', GEMINI_API_KEY: 'test-key' }
  });
  let jobRow = (await db.query('SELECT * FROM ingestion_jobs WHERE file_id = $1 ORDER BY id DESC LIMIT 1', [fileId])).rows[0];
  assert.equal(jobRow.status, 'partial_success');
  assert.equal(Number(jobRow.vision_calls), 2);
  assert.equal(Number(jobRow.vision_input_tokens), 1000);
  assert.equal(Number(jobRow.vision_output_tokens), 250);

  // Resume with higher quota -> processes Page 2 (1 more call, +1000 in, +250 out)
  await enqueueDocumentIngestionJob(db, { fileId, contentHash: computeContentHash(scanned2) });
  await db.query("UPDATE ingestion_jobs SET vision_calls = $1, vision_input_tokens = $2, vision_output_tokens = $3 WHERE file_id = $4", [2, 1000, 250, fileId]);
  await processNextIngestionJob(db, {
    fetchImpl: usageFetch,
    maxVisionPages: 5,
    retryBackoffMs: 0,
    env: { DOC_VISION_MODEL: 'gemini-vision-test', GEMINI_API_KEY: 'test-key' }
  });
  jobRow = (await db.query('SELECT * FROM ingestion_jobs WHERE file_id = $1 ORDER BY id DESC LIMIT 1', [fileId])).rows[0];
  assert.equal(jobRow.status, 'completed');
  assert.equal(Number(jobRow.vision_calls), 3);
  assert.equal(Number(jobRow.vision_input_tokens), 2000);
  assert.equal(Number(jobRow.vision_output_tokens), 500);
});

test('18. Fix H: Worker exits early with no queued jobs & GITHUB_DISPATCH_TOKEN missing performs 0 calls', async () => {
  const { db } = await createD2TestDb();

  // Empty DB -> early exit before invoking worker loop
  const early = await executeWorkerRun(db, { skipKnowledge: true });
  assert.equal(early.mode, 'early_exit');

  // Direct unit check on triggerDocIngestionWorkflowDispatch
  const app = require('../server');
  let fetchCalls = 0;
  const mockFetch = async () => {
    fetchCalls++;
    return { ok: false, status: 500 };
  };

  assert.equal(app.triggerDocIngestionWorkflowDispatch({ fetchImpl: mockFetch, env: {} }), false);
  assert.equal(fetchCalls, 0, 'Missing GITHUB_DISPATCH_TOKEN must not call fetch');

  // With token & repo configured, triggers fire-and-forget without throwing even on 500 response
  const fired = app.triggerDocIngestionWorkflowDispatch({
    fetchImpl: mockFetch,
    env: { GITHUB_DISPATCH_TOKEN: 'ghp_test', GITHUB_DISPATCH_REPO: 'owner/repo' }
  });
  assert.equal(fired, true);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(fetchCalls, 1);

  // Full POST /api/files/upload without GITHUB_DISPATCH_TOKEN -> 0 calls to api.github.com and upload succeeds
  const runtimeDb = require('../db');
  await runtimeDb.initSchema();
  const srv = http.createServer(app);
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${srv.address().port}`;
  const origToken = process.env.GITHUB_DISPATCH_TOKEN;
  const origFetch = globalThis.fetch;
  const githubCalls = [];
  let storedName = null;

  try {
    delete process.env.GITHUB_DISPATCH_TOKEN;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('api.github.com')) githubCalls.push(String(url));
      return origFetch(url, init);
    };

    const ts = Date.now();
    const adminId = `ADMIN_D2R_${ts}`;
    const adminToken = `tok_${adminId}`;
    await runtimeDb.run(
      'INSERT OR IGNORE INTO students (studentId, name, role, semester, passwordHash) VALUES (?, ?, ?, ?, ?)',
      adminId, 'D2R Admin', 'admin', 'Semester 3', 'hash'
    );
    await runtimeDb.run(
      'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
      adminToken, adminId, new Date().toISOString(), new Date(Date.now() + 86400000).toISOString()
    );

    const pdf = buildSyntheticPdf([{ text: 'Dispatch token safety check document page content.' }]);
    const formData = new FormData();
    formData.append('files', new Blob([pdf], { type: 'application/pdf' }), 'Dispatch_No_Token.pdf');
    formData.append('semester', 'Semester 3');

    const res = await origFetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: formData
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    storedName = json.files?.[0]?.storedName;
    assert.equal(githubCalls.length, 0, 'Upload without GITHUB_DISPATCH_TOKEN must perform zero GitHub API calls');
  } finally {
    globalThis.fetch = origFetch;
    if (origToken !== undefined) process.env.GITHUB_DISPATCH_TOKEN = origToken;
    else delete process.env.GITHUB_DISPATCH_TOKEN;
    if (storedName) {
      try { fs.unlinkSync(path.join(__dirname, '../uploads', storedName)); } catch (_) {}
    }
    await new Promise(resolve => srv.close(resolve));
  }
});

test('19. Fix I: Local harness refuses DATABASE_URL / SUPABASE_* and runs offline mock against local PDF', async () => {
  assert.throws(
    () => assertSafeLocalEnv({ DATABASE_URL: 'postgres://user:pass@neon.tech/db' }),
    /REFUSED/
  );
  assert.throws(
    () => assertSafeLocalEnv({ SUPABASE_SERVICE_ROLE_KEY: 'eyJ...' }),
    /REFUSED/
  );
  assert.throws(
    () => assertSafeLocalEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' }),
    /REFUSED/
  );
  assert.doesNotThrow(() => assertSafeLocalEnv({ GEMINI_API_KEY: 'k', DOC_VISION_MODEL: 'm' }));

  const tmpDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp-d2r-harness-'));
  const pdfPath = path.join(tmpDir, 'sample_note.pdf');
  const outDir = path.join(tmpDir, 'out');
  try {
    const pdf = buildSyntheticPdf([
      { text: 'Normal typed introduction paragraph with sufficient clean characters for text layer extraction.' },
      { hasImage: true, text: 'scan' }
    ]);
    fs.writeFileSync(pdfPath, pdf);

    const summary = await runLocalPdfHarness({ filePath: pdfPath, outDir, env: {} });
    assert.equal(summary.mode, 'offline-mock-vision');
    assert.equal(summary.status, 'completed');
    assert.equal(summary.totalPages, 2);
    assert.equal(summary.pagesByRoute.text_layer, 1);
    assert.equal(summary.pagesByRoute.vision, 1);
    assert.equal(summary.visionCalls, 1);
    assert.ok(fs.existsSync(summary.outputPath));
    const md = fs.readFileSync(summary.outputPath, 'utf8');
    assert.match(md, /\| page \| source \| page_type \| confidence \| time_ms \| text \|/);
    assert.match(md, /\[MOCK_VISION\]/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('20. D2-S PDF slicing robustness: encrypted/corrupt classify as terminal (0 retries) and single bad page does not fail job', async () => {
  const { db } = await createD2TestDb();

  // Direct pdf-lib load robustness checks (terminal, zero retry)
  const encBytes = buildSyntheticPdf([{ hasImage: true, text: 'Secret' }], { encrypted: true });
  await assert.rejects(
    () => loadPdfForSlicing(encBytes),
    err => err.code === 'PASSWORD_PROTECTED' && err.terminal === true && err.transient === false
  );

  const corruptBytes = Buffer.from('NOT_A_PDF_CORRUPTED_DATA', 'utf8');
  await assert.rejects(
    () => loadPdfForSlicing(corruptBytes),
    err => err.code === 'CORRUPT_FILE' && err.terminal === true && err.transient === false
  );

  // Worker job: 3 consecutive vision pages where page 2 fails PDF_SLICE_FAILED; pages 1 & 3 must succeed
  const threePagePdf = buildSyntheticPdf([
    { hasImage: true, text: 'ok1' },
    { hasImage: true, text: 'bad2' },
    { hasImage: true, text: 'ok3' }
  ]);
  const { fileId } = await insertTestFile(db, { originalName: 'bad_single_page.pdf', buffer: threePagePdf });
  await enqueueDocumentIngestionJob(db, { fileId, contentHash: computeContentHash(threePagePdf) });

  let visionCalls = 0;
  const mockFetch = async () => {
    visionCalls++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 25 },
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                text: `Recovered good page call ${visionCalls}`,
                latex_present: false,
                figure_description: null,
                ocr_confidence: 0.91,
                detected_type: 'scanned'
              })
            }]
          }
        }]
      })
    };
  };

  const out = await processNextIngestionJob(db, {
    fetchImpl: mockFetch,
    retryBackoffMs: 0,
    env: { DOC_VISION_MODEL: 'gemini-vision-test', GEMINI_API_KEY: 'test-key', DOC_VISION_BATCH_PAGES: '3' },
    buildSliceFn: async (srcDoc, pageNos) => {
      if (pageNos.includes(2)) {
        const err = new Error('PDF_SLICE_FAILED: corrupted page object 2');
        err.code = 'PDF_SLICE_FAILED';
        err.terminal = true;
        err.transient = false;
        throw err;
      }
      return buildPdfSlice(srcDoc, pageNos);
    }
  });

  assert.equal(out.status, 'partial_success');
  assert.equal(out.visionPagesUsed, 2);
  assert.equal(out.failedPages, 1);
  assert.equal(visionCalls, 2, 'Page 2 failure must incur 0 Vision retry attempts');

  const rows = (await db.query('SELECT page_no, status, attempts, error FROM document_pages WHERE file_id = $1 ORDER BY page_no', [fileId])).rows;
  assert.equal(rows[0].status, 'completed');
  assert.equal(rows[1].status, 'failed');
  assert.equal(rows[1].attempts, 0);
  assert.match(rows[1].error, /PDF_SLICE_FAILED/);
  assert.equal(rows[2].status, 'completed');
});

test('21. D2-S 150-page PDF slicing performance: single load, flat per-page slice time & bounded peak memory', async () => {
  const { db } = await createD2TestDb();
  const specs = Array.from({ length: 150 }, (_, idx) => ({
    hasImage: true,
    text: `S${idx + 1}`
  }));
  const large150Pdf = buildSyntheticPdf(specs);
  const { fileId } = await insertTestFile(db, { originalName: 'large_150_pages.pdf', buffer: large150Pdf });
  await enqueueDocumentIngestionJob(db, { fileId, contentHash: computeContentHash(large150Pdf) });

  const sliceDurationsMs = [];
  let peakRssMb = 0;
  let peakHeapMb = 0;

  const t0 = performance.now();
  const out = await processNextIngestionJob(db, {
    maxVisionPages: 150,
    retryBackoffMs: 0,
    env: { DOC_VISION_MODEL: 'gemini-vision-test', GEMINI_API_KEY: 'test-key', DOC_VISION_BATCH_PAGES: '1' },
    buildSliceFn: async (srcDoc, pageNos) => {
      const sStart = performance.now();
      const buf = await buildPdfSlice(srcDoc, pageNos);
      sliceDurationsMs.push(performance.now() - sStart);
      const mem = process.memoryUsage();
      peakRssMb = Math.max(peakRssMb, mem.rss / (1024 * 1024));
      peakHeapMb = Math.max(peakHeapMb, mem.heapUsed / (1024 * 1024));
      return buf;
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10 },
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                text: 'Scanned content',
                latex_present: false,
                figure_description: null,
                ocr_confidence: 0.9,
                detected_type: 'scanned'
              })
            }]
          }
        }]
      })
    })
  });
  const totalElapsedMs = performance.now() - t0;

  assert.equal(out.status, 'completed');
  assert.equal(out.totalPages, 150);
  assert.equal(out.visionPagesUsed, 150);
  assert.equal(sliceDurationsMs.length, 150);

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const totalSlicingMs = sliceDurationsMs.reduce((a, b) => a + b, 0);
  const earlyAvgMs = avg(sliceDurationsMs.slice(0, 30));
  const midAvgMs = avg(sliceDurationsMs.slice(60, 90));
  const lateAvgMs = avg(sliceDurationsMs.slice(120, 150));

  console.log(
    `[D2-S 150-Page Benchmark] totalElapsedMs=${totalElapsedMs.toFixed(1)} totalSlicingMs=${totalSlicingMs.toFixed(1)} ` +
    `earlyAvgMs=${earlyAvgMs.toFixed(3)} midAvgMs=${midAvgMs.toFixed(3)} lateAvgMs=${lateAvgMs.toFixed(3)} ` +
    `peakRssMb=${peakRssMb.toFixed(1)} peakHeapMb=${peakHeapMb.toFixed(1)}`
  );

  // Per-page slice time must remain flat (~O(1), not quadratic growth as pages approach 150)
  assert.ok(lateAvgMs < Math.max(5.0, earlyAvgMs * 3.0), `Per-page slice time grew unexpectedly: early=${earlyAvgMs}, late=${lateAvgMs}`);
});

test('22. D2-S Drift check calibration: env threshold, alphabetic-only tokens, >=8 words, garbled math vs unrelated text', () => {
  assert.equal(resolveDriftMinOverlap({}, {}), 0.2);
  assert.equal(resolveDriftMinOverlap({}, { DOC_DRIFT_MIN_OVERLAP: '0.35' }), 0.35);

  // Alphabetic words only: ignore LaTeX commands, symbols, and numbers
  const words = extractComparisonWords('Theorem 123: \\frac{x}{y} + \\int_0^9 \\sum \\alpha_i 456 calculus integral derivative');
  assert.deepEqual([...words].sort(), ['calculus', 'derivative', 'integral', 'theorem']);

  // Fewer than 8 alphabetic words -> skip check (not flagged even if vision rewrites)
  const shortMathCls = {
    charCount: 85,
    pageType: 'math',
    rawText: 'Eq 123: f(x) = a1 + b2 + c3 + 999 / 888 integral derivative series limit',
    cleanText: 'Eq 123: f(x) = a1 + b2 + c3 + 999 / 888 integral derivative series limit',
    reasons: ['math_notation']
  };
  assert.equal(extractComparisonWords(shortMathCls.cleanText).size, 4);
  const shortDrift = applyDriftCheck(shortMathCls, { text: '$$f(x) = a_1 + b_2$$', ocrConfidence: 0.92 });
  assert.equal(shortDrift.driftError, null);
  assert.equal(shortDrift.ocrConfidence, 0.92);

  // Normal math page with garbled text layer (broken math glyphs) + correct vision -> NOT flagged
  const garbledMathCls = {
    charCount: 120,
    pageType: 'math',
    rawText: 'Th\uFFFDeor\uFFFDm on Fourier transform integrals and complex residue contour evaluations across domains.',
    cleanText: 'Th\uFFFDeor\uFFFDm on Fourier transform integrals and complex residue contour evaluations across domains.',
    reasons: ['broken_math_glyphs']
  };
  const garbledDrift = applyDriftCheck(garbledMathCls, {
    text: 'Theorem on Fourier transform integrals: $$F(\\omega) = \\int_{-\\infty}^{\\infty} f(t)e^{-i\\omega t}\\,dt$$',
    ocrConfidence: 0.93
  });
  assert.equal(garbledDrift.driftError, null);
  assert.equal(garbledDrift.ocrConfidence, 0.93);

  // Clean >=8 alphabetic-word page with unrelated vision text -> MUST be flagged, obeying DOC_DRIFT_MIN_OVERLAP
  const cleanCls = {
    charCount: 140,
    pageType: 'math',
    rawText: 'Thermodynamics entropy increases monotonically during every irreversible adiabatic compression process across piston cylinders.',
    cleanText: 'Thermodynamics entropy increases monotonically during every irreversible adiabatic compression process across piston cylinders.',
    reasons: ['high_math_symbol_density']
  };
  assert.ok(extractComparisonWords(cleanCls.cleanText).size >= 8);
  const badDrift = applyDriftCheck(
    cleanCls,
    { text: 'Ingredients: sugar, cocoa butter, vanilla extract, baking powder, and warm milk.', ocrConfidence: 0.95 },
    { minOverlap: resolveDriftMinOverlap({}, { DOC_DRIFT_MIN_OVERLAP: '0.3' }) }
  );
  assert.match(String(badDrift.driftError || ''), /PAGE_DRIFT_SUSPECTED.*min 30%/);
  assert.ok(badDrift.ocrConfidence <= 0.35);
});

test('23. D2-S Local harness upgrade: folder mode, --pages, --max-vision-pages, --compare-text-layer, timing & configured USD cost', async () => {
  const parsed = parseLocalHarnessArgs(['./sample-dir', '--pages', '1-10', '--max-vision-pages', '4', '--compare-text-layer']);
  assert.equal(parsed.targetPath, './sample-dir');
  assert.deepEqual(parsed.pageRange, { start: 1, end: 10 });
  assert.equal(parsed.maxVisionPages, 4);
  assert.equal(parsed.compareTextLayer, true);

  assert.equal(calculateConfiguredCostUsd(1_000_000, 500_000, {}), null);
  assert.equal(calculateConfiguredCostUsd(1_000_000, 500_000, { DOC_PRICE_INPUT_PER_M: '0.1', DOC_PRICE_OUTPUT_PER_M: '0.4' }), 0.3);

  const tmpDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp-d2s-folder-'));
  const inDir = path.join(tmpDir, 'pdfs');
  const outDir = path.join(tmpDir, 'out');
  fs.mkdirSync(inDir, { recursive: true });

  try {
    const pdfA = buildSyntheticPdf([
      { hasImage: true, text: 'scan A1' },
      { text: 'Clear lecture text page A2 with enough alphanumeric content for direct extraction.' },
      { hasImage: true, text: 'scan A3' }
    ]);
    const pdfB = buildSyntheticPdf([
      { text: 'Clear lecture text page B1 with enough alphanumeric content for direct extraction.' },
      { hasImage: true, text: 'scan B2' }
    ]);
    fs.writeFileSync(path.join(inDir, '01_alpha.pdf'), pdfA);
    fs.writeFileSync(path.join(inDir, '02_beta.pdf'), pdfB);

    // Without DOC_PRICE_* -> prints tokens only, honors --pages 1-2 & --compare-text-layer
    const noPriceRes = await runLocalPdfHarness({
      targetPath: inDir,
      outDir,
      env: {},
      pageRange: { start: 1, end: 2 },
      maxVisionPages: 2,
      compareTextLayer: true
    });
    assert.equal(noPriceRes.fileCount, 2);
    assert.equal(noPriceRes.estimatedUsd, null);
    assert.ok(noPriceRes.totalTimeMs >= 0);

    const alphaMd = fs.readFileSync(noPriceRes.files[0].outputPath, 'utf8');
    assert.match(alphaMd, /\| page \| source \| page_type \| confidence \| time_ms \| raw_text_layer \| vision_or_final_text \|/);
    assert.match(alphaMd, /scan A1/);
    assert.match(alphaMd, /\| drift-flagged pages \|/);
    assert.match(alphaMd, /\| failed pages \|/);
    assert.match(alphaMd, /tokens only \(DOC_PRICE_INPUT_PER_M \/ DOC_PRICE_OUTPUT_PER_M unset\)/);

    // With DOC_PRICE_* -> computes exact USD cost
    const pricedRes = await runLocalPdfHarness({
      targetPath: path.join(inDir, '01_alpha.pdf'),
      outDir,
      env: { DOC_PRICE_INPUT_PER_M: '0.1', DOC_PRICE_OUTPUT_PER_M: '0.4' },
      pageRange: { start: 1, end: 2 },
      maxVisionPages: 1
    });
    assert.ok(typeof pricedRes.estimatedUsd === 'number' && pricedRes.estimatedUsd > 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('24. D2-S Preflight script checks all 9 required env vars without leaking secret values', () => {
  const secretSentinel = 'SECRET_VALUE_MUST_NOT_LEAK_987654';
  const env = {
    DATABASE_URL: `postgres://user:${secretSentinel}@host/db`,
    GEMINI_API_KEY: secretSentinel,
    DOC_VISION_MODEL: 'gemini-2.5-flash',
    KYANA_KNOWLEDGE_V3: 'true',
    KYANA_KNOWLEDGE_V3_USERS: ''
  };
  const results = evaluatePreflight(env);
  assert.equal(results.length, PREFLIGHT_VARS.length);
  const byName = new Map(results.map(r => [r.name, r]));
  assert.equal(byName.get('DATABASE_URL').set, 'yes');
  assert.equal(byName.get('GEMINI_API_KEY').set, 'yes');
  assert.equal(byName.get('DOC_VISION_MODEL').set, 'yes');
  assert.equal(byName.get('KYANA_KNOWLEDGE_V3').set, 'yes');
  assert.equal(byName.get('KYANA_KNOWLEDGE_V3_USERS').set, 'no');
  assert.equal(byName.get('SUPABASE_URL').set, 'no');
  assert.equal(byName.get('INTERNAL_CRON_SECRET').set, 'no');
  assert.equal(byName.get('GITHUB_DISPATCH_TOKEN').set, 'no');
  assert.equal(byName.get('GITHUB_DISPATCH_REPO').set, 'no');

  const report = formatPreflightReport(results);
  assert.equal(report.includes(secretSentinel), false, 'Preflight report must NEVER print secret values');
  for (const spec of PREFLIGHT_VARS) {
    assert.ok(report.includes(spec.name), `Missing var in report: ${spec.name}`);
  }
});
