'use strict';

/**
 * Chapter Tutor Multimodal Integration Test Suite (Phase 3 Stage 4 Step 2.2A)
 *
 * Verifies that:
 * 1. Ordinary text-only questions retain the existing string message contract.
 * 2. Relevant authorized standalone image materials are retrieved.
 * 3. Image buffers reach generateReplyFn through the structured contract.
 * 4. Irrelevant images are not attached.
 * 5. Duplicate assets are removed.
 * 6. More than two matching images never exceed the provider limit (max 2).
 * 7. Oversized and invalid images are excluded safely.
 * 8. Unauthorized cross-semester images are never loaded or attached.
 * 9. PDF diagram descriptions remain available as textual evidence.
 * 10. Missing image buffers do not break the response.
 * 11. Multimodal provider failure triggers at most one explicit text-only retry when appropriate.
 * 12. Cancellation and authorization failures never trigger a retry.
 * 13. Existing citations and adaptive presentation remain intact.
 * 14. Visual question does not attach an unrelated image with no topic overlap (precision regression).
 * 15. Relevant image with explicit page and figure reference is accurately retrieved.
 * 16. Specific XOR gate query matches and attaches XOR Gate Logic image material.
 * 17. Romanized Nepali visual query with bujhauna retrieves relevant image material.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  answerWithChapterContext,
  getChapterReaderBundle,
  retrieveChapterVisualAssets,
  hasDiagramDescriptions
} = require('../lib/chapter-tutor-engine');
const {
  detectImageMimeType,
  detectVisualRelevance,
  isImageMaterial,
  scoreImageMaterial,
  MAX_IMAGE_COUNT,
  MAX_IMAGE_BYTES,
  MAX_COMBINED_IMAGE_BYTES
} = require('../lib/chapter-tutor-visuals');

// Synthetic valid image buffers
const VALID_PNG_BUFFER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  Buffer.alloc(64, 0xAA)
]);

const VALID_JPEG_BUFFER = Buffer.concat([
  Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
  Buffer.alloc(64, 0xBB)
]);

const VALID_WEBP_BUFFER = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.alloc(4, 0),
  Buffer.from('WEBP', 'ascii'),
  Buffer.alloc(32, 0xCC)
]);

const CORRUPTED_IMAGE_BUFFER = Buffer.from('<html><body>Not an image</body></html>');

/**
 * Creates an in-memory mock database for Chapter Tutor testing.
 */
function createMockDb({ files = [], pages = [], items = [], chunks = [] } = {}) {
  return {
    isPostgres: false,
    async all(sql, ...params) {
      const normSql = sql.toLowerCase();
      if (normSql.includes('from files')) {
        if (params.length > 0 && typeof params[0] === 'number') {
          const ids = new Set(params.map(Number));
          return files.filter((f) => ids.has(Number(f.id)));
        }
        return files;
      }
      if (normSql.includes('from document_pages')) {
        const fileId = params[0];
        return pages.filter((p) => String(p.file_id) === String(fileId));
      }
      if (normSql.includes('from academic_extracted_items')) {
        const fileId = params[0];
        return items.filter((it) => String(it.file_id) === String(fileId));
      }
      if (normSql.includes('from document_chunks')) {
        const fileId = params[0];
        return chunks.filter((c) => String(c.file_id) === String(fileId));
      }
      return [];
    },
    async get() {
      return null;
    }
  };
}

test('Test 1: Ordinary text-only question retains the string message contract with zero image payload', async () => {
  const files = [
    {
      id: 101,
      title: 'Logic Circuits Notes',
      storedName: 'logic_notes.pdf',
      originalName: 'logic_notes.pdf',
      subject: 'Digital Logic',
      chapter: 'Unit 1: Introduction to Logic Gates',
      semester: '1',
      unit_number: 1,
      readerType: 'pdf'
    }
  ];

  const db = createMockDb({ files });
  let receivedMessage = null;

  const res = await answerWithChapterContext(db, {
    message: 'What is the definition of a proposition?',
    chapterContext: {
      subject: 'Digital Logic',
      chapterTitle: 'Unit 1: Introduction to Logic Gates',
      unitNumber: 1,
      semesterNo: 1,
      fileIds: [101]
    },
    academicContext: {
      authenticated: true,
      role: 'student',
      cohort: { id: 1, currentSemester: 1 }
    },
    generateReplyFn: async ({ message }) => {
      receivedMessage = message;
      return { reply: 'A proposition is a declarative statement that is either true or false.' };
    }
  });

  assert.equal(typeof receivedMessage, 'string', 'Message must remain a pure string for text-only questions');
  assert.equal(receivedMessage, 'What is the definition of a proposition?');
  assert.equal(res.chapterTutor.visualEvidenceUsed, false);
  assert.deepEqual(res.chapterTutor.visualAssets, []);
  assert.equal(res.chapterTutor.visualProcessingFailed, false);
});

test('Test 2: Relevant authorized standalone image materials are retrieved for visual question', async () => {
  const files = [
    {
      id: 201,
      title: 'Full Adder Circuit Diagram',
      storedName: 'full_adder_circuit.png',
      originalName: 'full_adder_circuit.png',
      subject: 'Digital Logic',
      chapter: 'Unit 2: Combinational Logic',
      semester: '1',
      unit_number: 2,
      readerType: 'image'
    }
  ];

  const db = createMockDb({ files });
  let receivedPayload = null;

  const res = await answerWithChapterContext(db, {
    message: 'Explain how the full adder circuit diagram works with its logic gates',
    chapterContext: {
      subject: 'Digital Logic',
      chapterTitle: 'Unit 2: Combinational Logic',
      unitNumber: 2,
      semesterNo: 1,
      fileIds: [201]
    },
    academicContext: {
      authenticated: true,
      role: 'student',
      cohort: { id: 1, currentSemester: 1 }
    },
    resolveBufferFn: async (file) => {
      if (file.id === 201) return VALID_PNG_BUFFER;
      return null;
    },
    generateReplyFn: async ({ message }) => {
      receivedPayload = message;
      return { reply: 'The full adder circuit consists of two XOR gates, two AND gates, and an OR gate.' };
    }
  });

  assert.ok(receivedPayload && typeof receivedPayload === 'object', 'Multimodal request must pass structured message');
  assert.equal(receivedPayload.text, 'Explain how the full adder circuit diagram works with its logic gates');
  assert.equal(receivedPayload.images.length, 1);
  assert.equal(receivedPayload.images[0].mimeType, 'image/png');
  assert.deepEqual(receivedPayload.images[0].data, VALID_PNG_BUFFER);
  assert.equal(receivedPayload.images[0].metadata.fileId, 201);

  assert.equal(res.chapterTutor.visualEvidenceUsed, true);
  assert.equal(res.chapterTutor.visualAssets.length, 1);
  assert.equal(res.chapterTutor.visualAssets[0].fileId, 201);
  assert.equal(res.chapterTutor.visualAssets[0].mimeType, 'image/png');
  // Confirm raw buffer is never exposed in client metadata
  assert.equal(res.chapterTutor.visualAssets[0].buffer, undefined);
});

test('Test 3: Romanized Nepali visual query retrieves relevant image material', async () => {
  const files = [
    {
      id: 202,
      title: 'Half Subtractor Logic Diagram',
      storedName: 'subtractor_diagram.jpg',
      originalName: 'subtractor_diagram.jpg',
      subject: 'Digital Logic',
      chapter: 'Unit 2: Combinational Logic',
      semester: '1',
      unit_number: 2,
      readerType: 'image'
    }
  ];

  const db = createMockDb({ files });
  let receivedPayload = null;

  const res = await answerWithChapterContext(db, {
    message: 'yo half subtractor ko circuit diagram chitra herera bujhaunus na',
    chapterContext: {
      subject: 'Digital Logic',
      chapterTitle: 'Unit 2: Combinational Logic',
      unitNumber: 2,
      semesterNo: 1,
      fileIds: [202]
    },
    academicContext: {
      authenticated: true,
      role: 'student',
      cohort: { id: 1, currentSemester: 1 }
    },
    resolveBufferFn: async () => VALID_JPEG_BUFFER,
    generateReplyFn: async ({ message }) => {
      receivedPayload = message;
      return { reply: 'Half subtractor circuit ma difference ra borrow out compute huncha.' };
    }
  });

  assert.ok(receivedPayload && typeof receivedPayload === 'object');
  assert.equal(receivedPayload.images.length, 1);
  assert.equal(receivedPayload.images[0].mimeType, 'image/jpeg');
  assert.equal(res.chapterTutor.visualEvidenceUsed, true);
});

test('Test 4: Irrelevant images in the chapter are not attached to unrelated questions', async () => {
  const files = [
    {
      id: 301,
      title: 'Database ER Diagram',
      storedName: 'db_erd.png',
      originalName: 'db_erd.png',
      subject: 'Database Systems',
      chapter: 'Unit 3: Relational Model',
      semester: '2',
      unit_number: 3,
      readerType: 'image'
    }
  ];

  const db = createMockDb({ files });
  let receivedMessage = null;

  // Question asks about normalization theory (no ER diagram relevance)
  const res = await answerWithChapterContext(db, {
    message: 'What are the main conditions for Boyce-Codd Normal Form BCNF?',
    chapterContext: {
      subject: 'Database Systems',
      chapterTitle: 'Unit 3: Relational Model',
      unitNumber: 3,
      semesterNo: 2,
      fileIds: [301]
    },
    academicContext: {
      authenticated: true,
      role: 'student',
      cohort: { id: 2, currentSemester: 2 }
    },
    resolveBufferFn: async () => VALID_PNG_BUFFER,
    generateReplyFn: async ({ message }) => {
      receivedMessage = message;
      return { reply: 'A relation is in BCNF if for every functional dependency X -> Y, X is a superkey.' };
    }
  });

  assert.equal(typeof receivedMessage, 'string', 'Unrelated image must not be attached to non-visual theory question');
  assert.equal(res.chapterTutor.visualEvidenceUsed, false);
  assert.deepEqual(res.chapterTutor.visualAssets, []);
});

test('Test 5: Duplicate assets are removed even when multiple extracted items reference the same file', async () => {
  const files = [
    {
      id: 401,
      title: '8086 Microprocessor Architecture Diagram',
      storedName: '8086_arch.png',
      originalName: '8086_arch.png',
      subject: 'Microprocessors',
      chapter: 'Unit 1: 8086 Architecture',
      semester: '3',
      unit_number: 1,
      readerType: 'image',
      extractedItems: [
        { id: 'it_1', itemType: 'diagram', title: '8086 BIU Bus Interface Unit', topic: '8086' },
        { id: 'it_2', itemType: 'diagram', title: '8086 EU Execution Unit', topic: '8086' },
        { id: 'it_3', itemType: 'diagram', title: '8086 Registers', topic: '8086' }
      ]
    }
  ];

  const db = createMockDb({ files });
  let receivedPayload = null;

  const res = await answerWithChapterContext(db, {
    message: 'Explain the 8086 microprocessor architecture diagram with BIU and EU',
    chapterContext: {
      subject: 'Microprocessors',
      chapterTitle: 'Unit 1: 8086 Architecture',
      unitNumber: 1,
      semesterNo: 3,
      fileIds: [401]
    },
    academicContext: {
      authenticated: true,
      role: 'student',
      cohort: { id: 3, currentSemester: 3 }
    },
    resolveBufferFn: async () => VALID_PNG_BUFFER,
    generateReplyFn: async ({ message }) => {
      receivedPayload = message;
      return { reply: 'The 8086 consists of two functional units: BIU and EU.' };
    }
  });

  assert.ok(receivedPayload && typeof receivedPayload === 'object');
  assert.equal(receivedPayload.images.length, 1, 'Duplicate image buffer must be attached at most once');
  assert.equal(res.chapterTutor.visualAssets.length, 1);
});

test('Test 6: More than two matching images never exceed the provider limit (max 2 images)', async () => {
  const files = [
    {
      id: 501,
      title: 'Shift Register Circuit 1',
      storedName: 'reg1.png',
      originalName: 'reg1.png',
      subject: 'Digital Logic',
      chapter: 'Unit 4: Registers and Counters',
      semester: '1',
      unit_number: 4,
      readerType: 'image'
    },
    {
      id: 502,
      title: 'Shift Register Circuit 2',
      storedName: 'reg2.png',
      originalName: 'reg2.png',
      subject: 'Digital Logic',
      chapter: 'Unit 4: Registers and Counters',
      semester: '1',
      unit_number: 4,
      readerType: 'image'
    },
    {
      id: 503,
      title: 'Shift Register Circuit 3',
      storedName: 'reg3.png',
      originalName: 'reg3.png',
      subject: 'Digital Logic',
      chapter: 'Unit 4: Registers and Counters',
      semester: '1',
      unit_number: 4,
      readerType: 'image'
    }
  ];

  const db = createMockDb({ files });
  let receivedPayload = null;

  const res = await answerWithChapterContext(db, {
    message: 'Show and compare the shift register circuit diagrams in this chapter',
    chapterContext: {
      subject: 'Digital Logic',
      chapterTitle: 'Unit 4: Registers and Counters',
      unitNumber: 4,
      semesterNo: 1,
      fileIds: [501, 502, 503]
    },
    academicContext: {
      authenticated: true,
      role: 'student',
      cohort: { id: 1, currentSemester: 1 }
    },
    resolveBufferFn: async () => VALID_PNG_BUFFER,
    generateReplyFn: async ({ message }) => {
      receivedPayload = message;
      return { reply: 'Here are the shift register configurations.' };
    }
  });

  assert.ok(receivedPayload && typeof receivedPayload === 'object');
  assert.equal(receivedPayload.images.length, 2, 'Never exceed MAX_IMAGE_COUNT = 2');
  assert.equal(res.chapterTutor.visualAssets.length, 2);
});

test('Test 7: Oversized and invalid images are safely excluded', async () => {
  const files = [
    {
      id: 601,
      title: 'Huge Diagram',
      storedName: 'huge.png',
      originalName: 'huge.png',
      subject: 'Computer Networks',
      chapter: 'Unit 1: OSI Model',
      semester: '4',
      unit_number: 1,
      readerType: 'image'
    },
    {
      id: 602,
      title: 'Corrupted Diagram',
      storedName: 'corrupt.png',
      originalName: 'corrupt.png',
      subject: 'Computer Networks',
      chapter: 'Unit 1: OSI Model',
      semester: '4',
      unit_number: 1,
      readerType: 'image'
    },
    {
      id: 603,
      title: 'Valid OSI Diagram',
      storedName: 'valid_osi.png',
      originalName: 'valid_osi.png',
      subject: 'Computer Networks',
      chapter: 'Unit 1: OSI Model',
      semester: '4',
      unit_number: 1,
      readerType: 'image'
    }
  ];

  const db = createMockDb({ files });
  let receivedPayload = null;

  const res = await answerWithChapterContext(db, {
    message: 'Explain the OSI model architecture diagram',
    chapterContext: {
      subject: 'Computer Networks',
      chapterTitle: 'Unit 1: OSI Model',
      unitNumber: 1,
      semesterNo: 4,
      fileIds: [601, 602, 603]
    },
    academicContext: {
      authenticated: true,
      role: 'student',
      cohort: { id: 4, currentSemester: 4 }
    },
    resolveBufferFn: async (file) => {
      if (file.id === 601) {
        // > 5MB oversized image
        return Buffer.alloc(MAX_IMAGE_BYTES + 1024, 0xAA);
      }
      if (file.id === 602) {
        // Corrupted magic bytes
        return CORRUPTED_IMAGE_BUFFER;
      }
      if (file.id === 603) {
        return VALID_PNG_BUFFER;
      }
      return null;
    },
    generateReplyFn: async ({ message }) => {
      receivedPayload = message;
      return { reply: 'The OSI model has 7 layers.' };
    }
  });

  assert.ok(receivedPayload && typeof receivedPayload === 'object');
  // Only file 603 is valid (601 is oversized, 602 is corrupt)
  assert.equal(receivedPayload.images.length, 1);
  assert.equal(receivedPayload.images[0].metadata.fileId, 603);
  assert.equal(res.chapterTutor.visualAssets.length, 1);
  assert.equal(res.chapterTutor.visualAssets[0].fileId, 603);
});

test('Test 8: Unauthorized cross-semester images are never loaded or attached', async () => {
  const files = [
    {
      id: 701,
      title: 'Semester 5 Advanced Network Topology Diagram',
      storedName: 'sem5_topo.png',
      originalName: 'sem5_topo.png',
      subject: 'Advanced Networking',
      chapter: 'Unit 1: BGP Routing',
      semester: '5',
      unit_number: 1,
      readerType: 'image'
    }
  ];

  const db = createMockDb({ files });
  let receivedMessage = null;

  // Student is in Semester 2, attempting to access Semester 5 diagram file
  const res = await answerWithChapterContext(db, {
    message: 'Show me the BGP routing network topology diagram',
    chapterContext: {
      subject: 'Advanced Networking',
      chapterTitle: 'Unit 1: BGP Routing',
      unitNumber: 1,
      semesterNo: 5,
      fileIds: [701]
    },
    academicContext: {
      authenticated: true,
      role: 'student',
      cohort: { id: 2, currentSemester: 2 } // Semester 2 student!
    },
    resolveBufferFn: async () => {
      throw new Error('RESOLVE_CALLED_FOR_UNAUTHORIZED_FILE');
    },
    generateReplyFn: async ({ message }) => {
      receivedMessage = message;
      return { reply: 'BGP is an exterior gateway protocol.' };
    }
  });

  // Cross-semester file is blocked by canReadResource in getChapterReaderBundle
  assert.equal(typeof receivedMessage, 'string', 'Cross-semester image must never be resolved or attached');
  assert.equal(res.chapterTutor.visualEvidenceUsed, false);
  assert.deepEqual(res.chapterTutor.visualAssets, []);
});

test('Test 9: PDF diagram descriptions remain available as textual evidence when raster images are absent', async () => {
  const files = [
    {
      id: 801,
      title: 'Theory of Computation Notes',
      storedName: 'toc_unit1.pdf',
      originalName: 'toc_unit1.pdf',
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

  const db = createMockDb({
    files,
    items: [
      {
        id: 'aei_dfa_1',
        file_id: '801',
        item_type: 'diagram',
        title: 'DFA State Transition Diagram',
        topic: 'DFA',
        concept_key: 'dfa_transition_diagram',
        page_start: 4,
        page_end: 4,
        content_text: 'DFA State Transition Diagram: States {q0, q1} with alphabet {0, 1}. Transition from q0 on 1 loops, on 0 goes to q1 (accepting).'
      }
    ]
  });

  let receivedSystemPrompt = '';
  let receivedMessage = null;

  const res = await answerWithChapterContext(db, {
    message: 'How is the DFA state transition diagram structured?',
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
    generateReplyFn: async ({ message, systemPrompt }) => {
      receivedMessage = message;
      receivedSystemPrompt = systemPrompt;
      return { reply: 'The DFA has states q0 and q1 with transition on 0 moving to accepting state q1.' };
    }
  });

  // No image buffer attached
  assert.equal(typeof receivedMessage, 'string');
  assert.equal(res.chapterTutor.visualEvidenceUsed, false);
  assert.equal(res.chapterTutor.diagramDescriptionsUsed, true);

  // System prompt contains extracted diagram description
  assert.ok(receivedSystemPrompt.includes('EXTRACTED DIAGRAM DESCRIPTIONS (FROM PDF)'));
  assert.ok(receivedSystemPrompt.includes('DFA State Transition Diagram'));
});

test('Test 10: Missing image buffers do not break the response and degrade gracefully', async () => {
  const files = [
    {
      id: 901,
      title: 'Missing Image Note',
      storedName: 'missing_diagram.png',
      originalName: 'missing_diagram.png',
      subject: 'Physics',
      chapter: 'Unit 1: Optics',
      semester: '1',
      unit_number: 1,
      readerType: 'image'
    }
  ];

  const db = createMockDb({ files });
  let receivedMessage = null;

  const res = await answerWithChapterContext(db, {
    message: 'Explain this ray optics diagram',
    chapterContext: {
      subject: 'Physics',
      chapterTitle: 'Unit 1: Optics',
      unitNumber: 1,
      semesterNo: 1,
      fileIds: [901]
    },
    academicContext: {
      authenticated: true,
      role: 'student',
      cohort: { id: 1, currentSemester: 1 }
    },
    resolveBufferFn: async () => {
      // Simulate file missing on disk / S3
      return null;
    },
    generateReplyFn: async ({ message }) => {
      receivedMessage = message;
      return { reply: 'Ray optics describes light propagation in terms of rays.' };
    }
  });

  assert.equal(typeof receivedMessage, 'string', 'Should degrade to string message when buffer resolution returns null');
  assert.equal(res.chapterTutor.visualEvidenceUsed, false);
  assert.ok(res.reply.length > 0);
});

test('Test 11: Multimodal provider failure triggers at most one explicit text-only retry', async () => {
  const files = [
    {
      id: 1001,
      title: 'Circuit Schematic',
      storedName: 'circuit.png',
      originalName: 'circuit.png',
      subject: 'Digital Logic',
      chapter: 'Unit 2: Circuits',
      semester: '1',
      unit_number: 2,
      readerType: 'image'
    }
  ];

  const db = createMockDb({ files });
  let callCount = 0;
  const calls = [];

  const res = await answerWithChapterContext(db, {
    message: 'Explain the circuit diagram',
    chapterContext: {
      subject: 'Digital Logic',
      chapterTitle: 'Unit 2: Circuits',
      unitNumber: 2,
      semesterNo: 1,
      fileIds: [1001]
    },
    academicContext: {
      authenticated: true,
      role: 'student',
      cohort: { id: 1, currentSemester: 1 }
    },
    resolveBufferFn: async () => VALID_PNG_BUFFER,
    generateReplyFn: async (options) => {
      callCount += 1;
      calls.push(options);
      if (callCount === 1) {
        // First attempt with multimodal payload fails with VISION_PROVIDER_UNAVAILABLE
        const err = new Error('Vision provider is currently unavailable');
        err.code = 'VISION_PROVIDER_UNAVAILABLE';
        throw err;
      }
      return { reply: 'Text-only fallback explanation: this circuit connects the input to ground.' };
    }
  });

  assert.equal(callCount, 2, 'Multimodal failure must trigger exactly one text-only retry');
  assert.equal(typeof calls[0].message, 'object', 'First call must be multimodal');
  assert.equal(typeof calls[1].message, 'string', 'Retry call must be plain string');
  assert.equal(calls[1].message, 'Explain the circuit diagram');
  assert.ok(calls[1].systemPrompt.includes('NOTICE: Multimodal visual inspection was unavailable'));

  assert.equal(res.chapterTutor.visualEvidenceUsed, false);
  assert.equal(res.chapterTutor.visualProcessingFailed, true);
  assert.equal(res.chapterTutor.visualFallbackTextOnly, true);
  assert.ok(res.reply.includes('Text-only fallback explanation'));
});

test('Test 12: Cancellation and authorization failures never trigger a retry', async () => {
  const files = [
    {
      id: 1101,
      title: 'Circuit Schematic',
      storedName: 'circuit.png',
      originalName: 'circuit.png',
      subject: 'Digital Logic',
      chapter: 'Unit 2: Circuits',
      semester: '1',
      unit_number: 2,
      readerType: 'image'
    }
  ];

  const db = createMockDb({ files });

  // 12a: AbortController cancellation
  let abortCallCount = 0;
  const abortController = new AbortController();
  abortController.abort();

  await assert.rejects(
    async () => {
      await answerWithChapterContext(db, {
        message: 'Explain the circuit diagram',
        chapterContext: {
          subject: 'Digital Logic',
          chapterTitle: 'Unit 2: Circuits',
          unitNumber: 2,
          semesterNo: 1,
          fileIds: [1101]
        },
        academicContext: {
          authenticated: true,
          role: 'student',
          cohort: { id: 1, currentSemester: 1 }
        },
        signal: abortController.signal,
        resolveBufferFn: async () => VALID_PNG_BUFFER,
        generateReplyFn: async () => {
          abortCallCount += 1;
          const abortErr = new Error('This operation was aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
      });
    },
    (err) => err.name === 'AbortError'
  );
  assert.equal(abortCallCount, 1, 'Cancellation must never trigger a retry');

  // 12b: Authorization failure
  let authCallCount = 0;
  await assert.rejects(
    async () => {
      await answerWithChapterContext(db, {
        message: 'Explain the circuit diagram',
        chapterContext: {
          subject: 'Digital Logic',
          chapterTitle: 'Unit 2: Circuits',
          unitNumber: 2,
          semesterNo: 1,
          fileIds: [1101]
        },
        academicContext: {
          authenticated: true,
          role: 'student',
          cohort: { id: 1, currentSemester: 1 }
        },
        resolveBufferFn: async () => VALID_PNG_BUFFER,
        generateReplyFn: async () => {
          authCallCount += 1;
          const authErr = new Error('Unauthorized request');
          authErr.code = 'UNAUTHORIZED';
          authErr.status = 403;
          throw authErr;
        }
      });
    },
    (err) => err.code === 'UNAUTHORIZED'
  );
  assert.equal(authCallCount, 1, 'Authorization failure must never trigger a retry');
});

test('Test 13: Citations and adaptive presentation remain intact with visual evidence', async () => {
  const files = [
    {
      id: 1201,
      title: 'State Diagram Note',
      storedName: 'state_diag.png',
      originalName: 'state_diag.png',
      subject: 'Automata Theory',
      chapter: 'Unit 1: FSM',
      semester: '3',
      unit_number: 1,
      readerType: 'image'
    }
  ];

  const db = createMockDb({ files });

  const res = await answerWithChapterContext(db, {
    message: 'Explain the FSM state diagram with transitions',
    chapterContext: {
      subject: 'Automata Theory',
      chapterTitle: 'Unit 1: FSM',
      unitNumber: 1,
      semesterNo: 3,
      fileIds: [1201]
    },
    academicContext: {
      authenticated: true,
      role: 'student',
      cohort: { id: 3, currentSemester: 3 }
    },
    resolveBufferFn: async () => VALID_PNG_BUFFER,
    generateReplyFn: async () => ({
      reply: 'Here is the step-by-step state transition analysis: from S0 on 1 we transition to S1.'
    })
  });

  assert.equal(res.chapterTutor.visualEvidenceUsed, true);
  assert.ok(Array.isArray(res.citations), 'Citations array must be preserved');
  assert.ok(
    res.citations.some((c) => String(c.fileId) === '1201' && c.evidenceOrigin === 'visual_evidence'),
    'Visual evidence must have an accurate citation entry'
  );
  assert.ok(Array.isArray(res.resourceCards), 'Resource cards must be preserved');
  assert.equal(res.resourceCards[0].id, 1201);
});

test('Test 14: Visual question does not attach an unrelated image with no topic overlap (precision regression)', async () => {
  const files = [
    {
      id: 1401,
      title: 'RS Flip Flop Circuit',
      storedName: 'rs_flip_flop.png',
      originalName: 'rs_flip_flop.png',
      subject: 'Digital Logic',
      chapter: 'Unit 3: Sequential Logic',
      semester: '1',
      unit_number: 3,
      readerType: 'image',
      resourceCategory: 'notes'
    }
  ];

  const db = createMockDb({ files });
  let receivedMessage = null;

  // The student asks a visual question about full subtractor, but the chapter only contains an RS flip flop image note
  const res = await answerWithChapterContext(db, {
    message: 'Explain the circuit diagram of a full subtractor',
    chapterContext: {
      subject: 'Digital Logic',
      chapterTitle: 'Unit 3: Sequential Logic',
      unitNumber: 3,
      semesterNo: 1,
      fileIds: [1401]
    },
    academicContext: {
      authenticated: true,
      role: 'student',
      cohort: { id: 1, currentSemester: 1 }
    },
    resolveBufferFn: async () => VALID_PNG_BUFFER,
    generateReplyFn: async ({ message }) => {
      receivedMessage = message;
      return { reply: 'A full subtractor combinational circuit subtracts two bits and a borrow-in.' };
    }
  });

  // Verify that receivedMessage is a plain string (not structured multimodal message)
  assert.equal(typeof receivedMessage, 'string', 'Unrelated image must NOT be attached despite visual phrasing');
  assert.equal(res.chapterTutor.visualEvidenceUsed, false, 'visualEvidenceUsed must be false');
  assert.deepEqual(res.chapterTutor.visualAssets, [], 'visualAssets must be empty');
});

test('Test 15: Relevant image with explicit page and figure reference is accurately retrieved', async () => {
  const files = [
    {
      id: 1501,
      title: 'Figure 1 - Basic Logic Gates',
      storedName: 'fig1_logic_gates.png',
      originalName: 'fig1_logic_gates.png',
      subject: 'Digital Logic',
      chapter: 'Unit 2: Combinational Logic',
      semester: '1',
      unit_number: 2,
      pageNumber: 1,
      readerType: 'image'
    },
    {
      id: 1502,
      title: 'Figure 3 - BCD Adder Architecture',
      storedName: 'fig3_bcd_adder.png',
      originalName: 'fig3_bcd_adder.png',
      subject: 'Digital Logic',
      chapter: 'Unit 2: Combinational Logic',
      semester: '1',
      unit_number: 2,
      pageNumber: 12,
      readerType: 'image'
    }
  ];

  const db = createMockDb({ files });
  let receivedPayload = null;

  const res = await answerWithChapterContext(db, {
    message: 'Explain Figure 3 from page 12',
    chapterContext: {
      subject: 'Digital Logic',
      chapterTitle: 'Unit 2: Combinational Logic',
      unitNumber: 2,
      semesterNo: 1,
      fileIds: [1501, 1502]
    },
    academicContext: {
      authenticated: true,
      role: 'student',
      cohort: { id: 1, currentSemester: 1 }
    },
    resolveBufferFn: async () => VALID_PNG_BUFFER,
    generateReplyFn: async ({ message }) => {
      receivedPayload = message;
      return { reply: 'Figure 3 shows the 4-bit binary adder with detection and correction logic adding 0110.' };
    }
  });

  assert.ok(receivedPayload && typeof receivedPayload === 'object', 'Multimodal structured payload expected');
  assert.equal(receivedPayload.images.length, 1, 'Only Figure 3 from page 12 must be attached');
  assert.equal(receivedPayload.images[0].metadata.fileId, 1502, 'File 1502 (Figure 3) must be the selected image');
  assert.equal(receivedPayload.images[0].metadata.pageNumber, 12);
  assert.equal(res.chapterTutor.visualEvidenceUsed, true);
});

test('Test 16: Specific XOR gate query matches and attaches XOR Gate Logic image material', async () => {
  const files = [
    {
      id: 1601,
      title: 'XOR Gate Logic',
      storedName: 'xor_gate_logic.png',
      originalName: 'xor_gate_logic.png',
      subject: 'Digital Logic',
      chapter: 'Unit 1: Logic Gates',
      semester: '1',
      unit_number: 1,
      readerType: 'image'
    },
    {
      id: 1602,
      title: 'AND Gate Schematic',
      storedName: 'and_gate.png',
      originalName: 'and_gate.png',
      subject: 'Digital Logic',
      chapter: 'Unit 1: Logic Gates',
      semester: '1',
      unit_number: 1,
      readerType: 'image'
    }
  ];

  const db = createMockDb({ files });
  let receivedPayload = null;

  const res = await answerWithChapterContext(db, {
    message: 'Explain this XOR gate circuit diagram',
    chapterContext: {
      subject: 'Digital Logic',
      chapterTitle: 'Unit 1: Logic Gates',
      unitNumber: 1,
      semesterNo: 1,
      fileIds: [1601, 1602]
    },
    academicContext: {
      authenticated: true,
      role: 'student',
      cohort: { id: 1, currentSemester: 1 }
    },
    resolveBufferFn: async () => VALID_PNG_BUFFER,
    generateReplyFn: async ({ message }) => {
      receivedPayload = message;
      return { reply: 'The XOR gate outputs HIGH if and only if one of the inputs is HIGH.' };
    }
  });

  assert.ok(receivedPayload && typeof receivedPayload === 'object');
  assert.equal(receivedPayload.images.length, 1);
  assert.equal(receivedPayload.images[0].metadata.fileId, 1601, 'XOR Gate Logic file must be matched');
  assert.equal(res.chapterTutor.visualEvidenceUsed, true);
});

test('Test 17: Romanized Nepali visual query with bujhauna retrieves relevant image material', async () => {
  const files = [
    {
      id: 1701,
      title: 'Half Subtractor Logic Diagram',
      storedName: 'half_subtractor.jpg',
      originalName: 'half_subtractor.jpg',
      subject: 'Digital Logic',
      chapter: 'Unit 2: Combinational Logic',
      semester: '1',
      unit_number: 2,
      readerType: 'image'
    }
  ];

  const db = createMockDb({ files });
  let receivedPayload = null;

  const res = await answerWithChapterContext(db, {
    message: 'yo half subtractor ko circuit chitra herera bujhauna',
    chapterContext: {
      subject: 'Digital Logic',
      chapterTitle: 'Unit 2: Combinational Logic',
      unitNumber: 2,
      semesterNo: 1,
      fileIds: [1701]
    },
    academicContext: {
      authenticated: true,
      role: 'student',
      cohort: { id: 1, currentSemester: 1 }
    },
    resolveBufferFn: async () => VALID_JPEG_BUFFER,
    generateReplyFn: async ({ message }) => {
      receivedPayload = message;
      return { reply: 'Half subtractor circuit ma Difference = A XOR B ra Borrow = A_bar AND B huncha.' };
    }
  });

  assert.ok(receivedPayload && typeof receivedPayload === 'object');
  assert.equal(receivedPayload.images.length, 1);
  assert.equal(receivedPayload.images[0].metadata.fileId, 1701);
  assert.equal(res.chapterTutor.visualEvidenceUsed, true);
});

test('Test 18: PDF note page visual retrieval with circuit diagram attaches page image and provenance', async () => {
  const files = [
    {
      id: 1801,
      title: 'Microprocessors Architecture Notes',
      storedName: 'microprocessors_unit3.pdf',
      originalName: 'microprocessors_unit3.pdf',
      subject: 'Microprocessors',
      chapter: 'Unit 3: 8085 Architecture',
      semester: '2',
      unit_number: 3,
      readerType: 'pdf'
    }
  ];

  const pages = [
    {
      file_id: '1801',
      page_number: 1,
      cleaned_text: 'Introduction to 8085 microprocessor pins and internal buses.',
      page_type: 'text'
    },
    {
      file_id: '1801',
      page_number: 14,
      cleaned_text: '8085 ALU architecture with accumulator, temporary register, and flag flip-flops.',
      page_type: 'diagram',
      figure_description: '8085 ALU architecture circuit diagram and bus layout',
      figure_title: '8085 ALU Circuit Diagram'
    }
  ];

  const db = createMockDb({ files, pages });
  let receivedPayload = null;

  const res = await answerWithChapterContext(db, {
    message: 'Explain the 8085 ALU circuit diagram on page 14',
    chapterContext: {
      subject: 'Microprocessors',
      chapterTitle: 'Unit 3: 8085 Architecture',
      unitNumber: 3,
      semesterNo: 2,
      fileIds: [1801]
    },
    academicContext: {
      authenticated: true,
      role: 'student',
      cohort: { id: 2, currentSemester: 2 }
    },
    resolvePageBufferFn: async (file, pageNo) => (pageNo === 14 ? VALID_PNG_BUFFER : null),
    generateReplyFn: async ({ message }) => {
      receivedPayload = message;
      return { reply: 'The 8085 ALU performs arithmetic and logical operations controlled by the timing and control unit.' };
    }
  });

  assert.ok(receivedPayload && typeof receivedPayload === 'object', 'Should receive multimodal object message');
  assert.equal(receivedPayload.images.length, 1, 'Should attach exactly 1 page image');
  assert.equal(receivedPayload.images[0].metadata.fileId, 1801);
  assert.equal(receivedPayload.images[0].metadata.pageNumber, 14);
  assert.equal(res.chapterTutor.visualEvidenceUsed, true);
  assert.equal(res.chapterTutor.visualAssets[0].pageNumber, 14);
  assert.equal(res.chapterTutor.visualAssets[0].kind, 'pdf_page');

  // Verify citation provenance
  const visualCitation = res.citations.find((c) => c.evidenceOrigin === 'visual_evidence');
  assert.ok(visualCitation, 'Should include visual_evidence citation');
  assert.equal(visualCitation.fileId, 1801);
  assert.equal(visualCitation.pageStart, 14);
});

test('Test 19: PDF note page visual retrieval for mathematical equations and derivations', async () => {
  const files = [
    {
      id: 1901,
      title: 'Linear Algebra Lecture Notes',
      storedName: 'linear_algebra.pdf',
      originalName: 'linear_algebra.pdf',
      subject: 'Linear Algebra',
      chapter: 'Unit 4: Eigenvalues and Eigenvectors',
      semester: '1',
      unit_number: 4,
      readerType: 'pdf'
    }
  ];

  const pages = [
    {
      file_id: '1901',
      page_number: 3,
      cleaned_text: 'Review of matrix determinants and invertibility properties.',
      page_type: 'text'
    },
    {
      file_id: '1901',
      page_number: 8,
      cleaned_text: 'Characteristic equation derivation: det(A - lambda I) = 0. Solving for eigenvalues lambda.',
      page_type: 'math',
      latex_present: 1,
      figure_description: 'Step-by-step derivation of the characteristic polynomial and roots',
      figure_title: 'Characteristic Equation Derivation'
    }
  ];

  const db = createMockDb({ files, pages });
  let receivedPayload = null;

  const res = await answerWithChapterContext(db, {
    message: 'Show me the eigenvalue characteristic equation derivation from page 8',
    chapterContext: {
      subject: 'Linear Algebra',
      chapterTitle: 'Unit 4: Eigenvalues and Eigenvectors',
      unitNumber: 4,
      semesterNo: 1,
      fileIds: [1901]
    },
    academicContext: {
      authenticated: true,
      role: 'student',
      cohort: { id: 1, currentSemester: 1 }
    },
    resolvePageBufferFn: async (file, pageNo) => (pageNo === 8 ? VALID_PNG_BUFFER : null),
    generateReplyFn: async ({ message }) => {
      receivedPayload = message;
      return { reply: 'To find the eigenvalues, solve det(A - lambda*I) = 0 for the scalar values lambda.' };
    }
  });

  assert.ok(receivedPayload && typeof receivedPayload === 'object');
  assert.equal(receivedPayload.images.length, 1);
  assert.equal(receivedPayload.images[0].metadata.fileId, 1901);
  assert.equal(receivedPayload.images[0].metadata.pageNumber, 8);
  assert.equal(res.chapterTutor.visualEvidenceUsed, true);
  assert.equal(res.chapterTutor.visualAssets[0].pageNumber, 8);
});

test('Test 20: Explicit page query targeting a PDF note selects requested page and rejects other pages', async () => {
  const files = [
    {
      id: 2001,
      title: 'Software Engineering Processes',
      storedName: 'software_engineering.pdf',
      originalName: 'software_engineering.pdf',
      subject: 'Software Engineering',
      chapter: 'Unit 2: Agile Methodology',
      semester: '3',
      unit_number: 2,
      readerType: 'pdf'
    }
  ];

  const pages = [
    {
      file_id: '2001',
      page_number: 2,
      cleaned_text: 'Waterfall development lifecycle phases and gate checks flowchart.',
      page_type: 'diagram',
      figure_description: 'Waterfall sequential model flowchart with requirement, design, coding, testing'
    },
    {
      file_id: '2001',
      page_number: 7,
      cleaned_text: 'Agile scrum sprint cycle diagram with daily standups, sprint review, and retrospective.',
      page_type: 'diagram',
      figure_description: 'Agile scrum sprint cycle diagram with product backlog, sprint backlog, and burndown'
    }
  ];

  const db = createMockDb({ files, pages });
  let receivedPayload = null;

  const res = await answerWithChapterContext(db, {
    message: 'Explain the sprint cycle flowchart on page 7',
    chapterContext: {
      subject: 'Software Engineering',
      chapterTitle: 'Unit 2: Agile Methodology',
      unitNumber: 2,
      semesterNo: 3,
      fileIds: [2001]
    },
    academicContext: {
      authenticated: true,
      role: 'student',
      cohort: { id: 3, currentSemester: 3 }
    },
    resolvePageBufferFn: async (file, pageNo) => (pageNo === 7 ? VALID_PNG_BUFFER : VALID_JPEG_BUFFER),
    generateReplyFn: async ({ message }) => {
      receivedPayload = message;
      return { reply: 'The sprint cycle on page 7 illustrates iterative increments over a 2-4 week window.' };
    }
  });

  assert.ok(receivedPayload && typeof receivedPayload === 'object');
  assert.equal(receivedPayload.images.length, 1);
  assert.equal(receivedPayload.images[0].metadata.pageNumber, 7, 'Must select page 7 and reject page 2');
  assert.equal(res.chapterTutor.visualEvidenceUsed, true);
  assert.equal(res.chapterTutor.visualAssets[0].pageNumber, 7);
});

test('Test 21: Graceful degradation when PDF page buffer resolution fails', async () => {
  const files = [
    {
      id: 2101,
      title: 'Digital Electronics Lab',
      storedName: 'digital_electronics.pdf',
      originalName: 'digital_electronics.pdf',
      subject: 'Digital Electronics',
      chapter: 'Unit 2: Combinational Logic',
      semester: '2',
      unit_number: 2,
      readerType: 'pdf'
    }
  ];

  const pages = [
    {
      file_id: '2101',
      page_number: 5,
      cleaned_text: 'Full adder circuit diagram using XOR, AND, and OR gates.',
      page_type: 'diagram',
      figure_description: 'Full adder circuit schematic diagram with Sum and Carry outputs',
      figure_title: 'Full Adder Schematic'
    }
  ];

  const db = createMockDb({ files, pages });
  let receivedPayload = null;

  const res = await answerWithChapterContext(db, {
    message: 'Explain the full adder circuit diagram on page 5',
    chapterContext: {
      subject: 'Digital Electronics',
      chapterTitle: 'Unit 2: Combinational Logic',
      unitNumber: 2,
      semesterNo: 2,
      fileIds: [2101]
    },
    academicContext: {
      authenticated: true,
      role: 'student',
      cohort: { id: 2, currentSemester: 2 }
    },
    resolvePageBufferFn: async () => null, // Buffer resolution fails or returns null
    generateReplyFn: async ({ message }) => {
      receivedPayload = message;
      return { reply: 'A full adder sums three one-bit binary numbers: A, B, and Carry-in.' };
    }
  });

  // Because image buffer resolution failed, system gracefully degrades to text-only prompt
  assert.equal(typeof receivedPayload, 'string', 'Message must degrade to a plain string');
  assert.equal(res.chapterTutor.visualEvidenceUsed, false);
  assert.equal(res.chapterTutor.diagramDescriptionsUsed, true);
  assert.ok(res.reply.includes('full adder'));
});

