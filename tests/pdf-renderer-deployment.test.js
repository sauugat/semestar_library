'use strict';

/**
 * Phase 2.4 — PDF Renderer Deployment Readiness Test Suite
 *
 * Verifies that:
 * 1. Single page rendering produces valid PNG magic bytes (0x89, 0x50, 0x4E, 0x47).
 * 2. Multi-page rendering extracts distinct pages and handles out-of-bounds page requests safely.
 * 3. Corrupt or non-PDF file safely returns null without throwing unhandled exceptions.
 * 4. Invalid input parameters (null path, missing file, 0 or negative page number) return null.
 * 5. Tier 2 universal canvas renderer renders valid PNG buffers independently of native binaries.
 * 6. Concurrent requests for the same PDF page are deduplicated via inFlightRenders.
 * 7. Cache invalidation correctly triggers when file contents or checksum change.
 * 8. Vercel serverless environment uses os.tmpdir() instead of local uploads directory.
 * 9. End-to-end Chapter Tutor graceful text-only fallback when PDF rendering returns null.
 * 10. ensureRagSchema fast-path avoids sequential DDL roundtrips on initialized database.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  renderPdfPageToBuffer,
  isValidPngBuffer,
  getCacheDir,
  getInFlightRendersCount,
  renderWithCanvas
} = require('../lib/pdf-page-renderer');

const {
  answerWithChapterContext
} = require('../lib/chapter-tutor-engine');

const {
  ensureRagSchema,
  resetRagSchemaCache
} = require('../lib/rag-schema');

// Helper to create a minimal valid single-page PDF
function createMinimalPdfBuffer(text = 'Semester Library Page 1') {
  const content = `BT /F1 24 Tf 100 700 Td (${text}) Tj ET`;
  const streamLen = Buffer.byteLength(content);
  return Buffer.from([
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    `4 0 obj << /Length ${streamLen} >> stream\n${content}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    'xref',
    '0 6',
    '0000000000 65535 f ',
    'trailer << /Size 6 /Root 1 0 R >>',
    'startxref',
    '0',
    '%%EOF'
  ].join('\n'));
}

// Helper to create a minimal multi-page PDF
function createMultiPagePdfBuffer(numPages = 3) {
  const kids = [];
  const pageObjs = [];
  for (let i = 1; i <= numPages; i++) {
    const pageObjId = 2 + i;
    kids.push(`${pageObjId} 0 R`);
    const content = `BT /F1 24 Tf 100 700 Td (Semester Library Multi-Page Document Page ${i}) Tj ET`;
    const streamLen = Buffer.byteLength(content);
    pageObjs.push(`
${pageObjId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${10 + i} 0 R /Resources << /Font << /F1 100 0 R >> >> >> endobj
${10 + i} 0 obj << /Length ${streamLen} >> stream
${content}
endstream endobj`);
  }
  return Buffer.from([
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    `2 0 obj << /Type /Pages /Kids [${kids.join(' ')}] /Count ${numPages} >> endobj`,
    ...pageObjs,
    '100 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    'xref',
    '0 1',
    '0000000000 65535 f ',
    'trailer << /Root 1 0 R >>',
    'startxref',
    '0',
    '%%EOF'
  ].join('\n'));
}

test('Test 1: Single page rendering returns valid buffer with PNG magic bytes (0x89, 0x50, 0x4E, 0x47)', async () => {
  const tmpFile = path.join(os.tmpdir(), `test_page1_${Date.now()}.pdf`);
  fs.writeFileSync(tmpFile, createMinimalPdfBuffer('Digital Logic Circuit Diagrams'));
  try {
    const buf = await renderPdfPageToBuffer({ pdfPath: tmpFile, pageNumber: 1 });
    assert.ok(buf, 'Should return a buffer');
    assert.ok(Buffer.isBuffer(buf), 'Must be a Buffer');
    assert.ok(buf.length > 500, 'Must have meaningful image size');
    assert.equal(isValidPngBuffer(buf), true, 'Must pass PNG magic bytes check');
    assert.equal(buf[0], 0x89);
    assert.equal(buf[1], 0x50);
    assert.equal(buf[2], 0x4E);
    assert.equal(buf[3], 0x47);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
});

test('Test 2: Multi-page rendering extracts distinct pages and handles out-of-bounds page requests safely', async () => {
  const tmpFile = path.join(os.tmpdir(), `test_multipage_${Date.now()}.pdf`);
  fs.writeFileSync(tmpFile, createMultiPagePdfBuffer(3));
  try {
    const p1 = await renderPdfPageToBuffer({ pdfPath: tmpFile, pageNumber: 1 });
    const p2 = await renderPdfPageToBuffer({ pdfPath: tmpFile, pageNumber: 2 });
    const p3 = await renderPdfPageToBuffer({ pdfPath: tmpFile, pageNumber: 3 });
    const p4 = await renderPdfPageToBuffer({ pdfPath: tmpFile, pageNumber: 4 }); // out of range
    const p100 = await renderPdfPageToBuffer({ pdfPath: tmpFile, pageNumber: 100 }); // out of range

    assert.ok(isValidPngBuffer(p1), 'Page 1 must be valid PNG');
    assert.ok(isValidPngBuffer(p2), 'Page 2 must be valid PNG');
    assert.ok(isValidPngBuffer(p3), 'Page 3 must be valid PNG');
    assert.equal(p4, null, 'Page 4 is out of bounds and must return null');
    assert.equal(p100, null, 'Page 100 is out of bounds and must return null');

    // Distinct pages should not be identical in binary content
    assert.notEqual(p1.toString('base64'), p2.toString('base64'), 'Page 1 and Page 2 should have distinct visual pixels');
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
});

test('Test 3: Corrupt or non-PDF file safely returns null without throwing unhandled exceptions', async () => {
  const tmpFile = path.join(os.tmpdir(), `test_corrupt_${Date.now()}.pdf`);
  fs.writeFileSync(tmpFile, 'This is corrupted binary text %PDF-1.4 but broken stream content XYZ 12345');
  try {
    const res = await renderPdfPageToBuffer({ pdfPath: tmpFile, pageNumber: 1 });
    assert.equal(res, null, 'Corrupt PDF must return null safely');
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
});

test('Test 4: Invalid input parameters return null safely', async () => {
  assert.equal(await renderPdfPageToBuffer({ pdfPath: null }), null);
  assert.equal(await renderPdfPageToBuffer({ pdfPath: '' }), null);
  assert.equal(await renderPdfPageToBuffer({ pdfPath: '/non/existent/file.pdf' }), null);

  const tmpFile = path.join(os.tmpdir(), `test_params_${Date.now()}.pdf`);
  fs.writeFileSync(tmpFile, createMinimalPdfBuffer());
  try {
    assert.equal(await renderPdfPageToBuffer({ pdfPath: tmpFile, pageNumber: 0 }), null);
    assert.equal(await renderPdfPageToBuffer({ pdfPath: tmpFile, pageNumber: -1 }), null);
    assert.equal(await renderPdfPageToBuffer({ pdfPath: tmpFile, pageNumber: 'not_a_number' }), null);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
});

test('Test 5: Tier 2 universal canvas renderer renders valid PNG buffers independently of native binaries', async () => {
  const tmpFile = path.join(os.tmpdir(), `test_canvas_${Date.now()}.pdf`);
  fs.writeFileSync(tmpFile, createMinimalPdfBuffer('Universal Canvas Test Page'));
  try {
    const canvasBuf = await renderWithCanvas(tmpFile, 1, 1.5);
    assert.ok(canvasBuf, 'Universal canvas renderer should succeed');
    assert.ok(isValidPngBuffer(canvasBuf), 'Must be a valid PNG buffer');
    assert.equal(canvasBuf[0], 0x89);
    assert.equal(canvasBuf[1], 0x50);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
});

test('Test 6: Concurrent requests for the same PDF page are deduplicated via inFlightRenders', async () => {
  const tmpFile = path.join(os.tmpdir(), `test_concurrent_${Date.now()}.pdf`);
  fs.writeFileSync(tmpFile, createMinimalPdfBuffer('Concurrency Deduplication Test'));
  try {
    const promises = [
      renderPdfPageToBuffer({ pdfPath: tmpFile, pageNumber: 1 }),
      renderPdfPageToBuffer({ pdfPath: tmpFile, pageNumber: 1 }),
      renderPdfPageToBuffer({ pdfPath: tmpFile, pageNumber: 1 }),
      renderPdfPageToBuffer({ pdfPath: tmpFile, pageNumber: 1 })
    ];
    const results = await Promise.all(promises);

    assert.equal(results.length, 4);
    assert.ok(results.every(r => isValidPngBuffer(r)), 'All results must be valid PNGs');
    // All 4 concurrent callers receive identical buffer content
    assert.ok(results.every(r => r.equals(results[0])), 'All concurrent callers must receive identical buffer');
    // In-flight renders map must be completely clean after completion
    assert.equal(getInFlightRendersCount(), 0, 'In-flight map must be empty');
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
});

test('Test 7: Cache invalidation correctly triggers when file contents change', async () => {
  const tmpFile = path.join(os.tmpdir(), `test_inval_${Date.now()}.pdf`);
  fs.writeFileSync(tmpFile, createMinimalPdfBuffer('Initial Version Content'));
  try {
    const buf1 = await renderPdfPageToBuffer({ pdfPath: tmpFile, pageNumber: 1 });
    assert.ok(isValidPngBuffer(buf1));

    // Update file with distinct text content and ensure modified time changes
    await new Promise(r => setTimeout(r, 60));
    fs.writeFileSync(tmpFile, createMinimalPdfBuffer('Second Version With Much More Extensive Text Content'));
    const futureTime = new Date(Date.now() + 5000);
    fs.utimesSync(tmpFile, futureTime, futureTime);

    const buf2 = await renderPdfPageToBuffer({ pdfPath: tmpFile, pageNumber: 1 });
    assert.ok(isValidPngBuffer(buf2));

    // Must have re-rendered because mtime/size changed
    assert.notEqual(buf1.length, buf2.length, 'Cached buffer must be invalidated when file mtime or content changes');
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
});

test('Test 8: Vercel serverless environment uses os.tmpdir() instead of local uploads directory', () => {
  const previousVercel = process.env.VERCEL;
  try {
    process.env.VERCEL = '1';
    const cacheDir = getCacheDir();
    assert.ok(cacheDir.includes(os.tmpdir()) || cacheDir.startsWith('/tmp'), 'Must resolve to tmpdir on Vercel');
  } finally {
    if (previousVercel !== undefined) {
      process.env.VERCEL = previousVercel;
    } else {
      delete process.env.VERCEL;
    }
  }
});

test('Test 9: End-to-end Chapter Tutor graceful text-only fallback when PDF rendering returns null', async () => {
  let capturedMessage = null;
  let capturedSystemPrompt = null;
  const mockGenerateReply = async ({ message, systemPrompt }) => {
    capturedMessage = message;
    capturedSystemPrompt = systemPrompt;
    return {
      reply: 'According to the chapter notes, the DFA has states q0 and q1 with transition on 0 moving to accepting state q1.'
    };
  };

  const files = [
    {
      id: 801,
      title: 'Theory of Computation Notes',
      storedName: 'non_existent_file.pdf',
      originalName: 'notes.pdf',
      subject: 'Theory of Computation',
      chapter: 'Unit 1: Finite Automata',
      semester: '3',
      unit_number: 1,
      readerType: 'pdf',
      extractedItems: [
        {
          id: 'aei_dfa_1',
          itemType: 'diagram',
          title: 'DFA State Transition Diagram',
          topic: 'DFA',
          pageStart: 4,
          pageEnd: 4,
          contentText: 'DFA State Transition Diagram: States {q0, q1} with alphabet {0, 1}. Transition from q0 on 1 loops, on 0 goes to q1 (accepting).'
        }
      ]
    }
  ];

  const mockDb = {
    isPostgres: false,
    async all(sql) {
      const s = sql.toLowerCase();
      if (s.includes('from files')) {
        return files;
      }
      if (s.includes('from document_pages')) {
        return [{
          id: 'page_801_4',
          file_id: '801',
          page_number: 4,
          raw_text: 'DFA State Transition Diagram. States {q0, q1}.',
          cleaned_text: 'DFA State Transition Diagram. States {q0, q1}.',
          diagrams_json: JSON.stringify([{
            title: 'DFA State Transition Diagram',
            description: 'DFA State Transition Diagram: States {q0, q1} with alphabet {0, 1}',
            labels: ['q0', 'q1', '0', '1']
          }]),
          equations_json: '[]'
        }];
      }
      if (s.includes('from academic_extracted_items')) {
        return [{
          id: 'aei_dfa_1',
          file_id: '801',
          item_type: 'diagram',
          title: 'DFA State Transition Diagram',
          topic: 'DFA',
          concept_key: 'dfa_transition_diagram',
          page_start: 4,
          page_end: 4,
          content_text: 'DFA State Transition Diagram: States {q0, q1} with alphabet {0, 1}. Transition from q0 on 1 loops, on 0 goes to q1 (accepting).'
        }];
      }
      if (s.includes('from document_chunks')) {
        return [{
          id: 'chunk_801_1',
          file_id: '801',
          chunk_index: 1,
          page_start: 4,
          page_end: 4,
          subject: 'Theory of Computation',
          chapter: 'Unit 1: Finite Automata',
          clean_content: 'A deterministic finite automaton consists of a finite set of states and transitions.'
        }];
      }
      return [];
    },
    async get() { return null; }
  };

  const reply = await answerWithChapterContext(mockDb, {
    message: 'How is the DFA state transition diagram structured on page 4?',
    chapterContext: {
      subject: 'Theory of Computation',
      chapterTitle: 'Unit 1: Finite Automata',
      unitNumber: 1,
      semesterNo: 3,
      fileIds: [801]
    },
    academicContext: {
      authenticated: true,
      role: 'student',
      cohort: { id: 3, currentSemester: 3 }
    },
    generateReplyFn: mockGenerateReply
  });

  assert.ok(reply, 'Should produce a reply');
  assert.equal(typeof capturedMessage, 'string', 'Message must be string contract since image rendering degraded to null');
  assert.equal(reply.chapterTutor.visualEvidenceUsed, false, 'Should not attach visual evidence when buffer is null');
  assert.equal(reply.chapterTutor.diagramDescriptionsUsed, true, 'Should use diagram descriptions as textual fallback');
  assert.ok(capturedSystemPrompt.includes('EXTRACTED DIAGRAM DESCRIPTIONS (FROM PDF)'), 'Prompt must retain diagram descriptions');
});

test('Test 10: ensureRagSchema fast-path avoids sequential DDL roundtrips on initialized database', async () => {
  let queryCount = 0;
  const mockInitializedDb = {
    isPostgres: false,
    async get(sql) {
      queryCount++;
      if (sql.includes('pragma_table_info') && sql.includes('subparts_json')) {
        return { ready: 1 };
      }
      return null;
    },
    async all(sql) {
      queryCount++;
      if (sql.includes('pragma_table_info') && sql.includes('subparts_json')) {
        return [{ ready: 1 }];
      }
      return [];
    },
    async run() {
      queryCount++;
      return { changes: 0 };
    }
  };

  resetRagSchemaCache(mockInitializedDb);
  const result = await ensureRagSchema(mockInitializedDb);
  assert.equal(result.ok, true);
  // Fast path should execute exactly 1 probe query, NOT 80 DDL statements!
  assert.equal(queryCount, 1, 'Should execute only 1 probe query instead of 80 DDL statements');
});
