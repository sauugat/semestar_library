'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { vector } = require('@electric-sql/pglite-pgvector');

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
  parseVisionJsonResponse
} = require('../lib/doc-vision-ocr');
const {
  PARSER_VERSION,
  computeContentHash,
  enqueueDocumentIngestionJob,
  claimNextIngestionJob,
  processNextIngestionJob,
  runIngestionWorkerLoop
} = require('../lib/doc-ingestion-worker');
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
    const body = init.body ? JSON.parse(init.body) : null;
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
          text: 'Theorem 1: Continuous derivative identity $$\\int_0^1 x^2\\,dx = \\frac{1}{3},\\quad \\frac{\\partial f}{\\partial x} \\approx \\sum \\alpha_i \\sqrt{\\beta_i}$$',
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
