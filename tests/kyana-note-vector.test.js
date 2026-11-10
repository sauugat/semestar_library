'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { vector } = require('@electric-sql/pglite-pgvector');

const { buildNoteKnowledge, isHeadingLine, extractHeadingText } = require('../lib/knowledge-builder');
const { persistKnowledgeResource } = require('../lib/knowledge-sync');
const { searchNotes, invalidateSearchCache } = require('../lib/note-search');

/**
 * Transforms standard parameterized SQL with ? placeholders to PostgreSQL $1, $2, ...
 */
function toPostgresSql(sql) {
  let idx = 1;
  let inString = false;
  let out = '';
  const transformed = sql.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
  for (let i = 0; i < transformed.length; i++) {
    const ch = transformed[i];
    if (ch === "'") {
      if (inString && transformed[i + 1] === "'") {
        out += "''";
        i++;
        continue;
      }
      inString = !inString;
      out += ch;
    } else if (ch === '?' && !inString) {
      out += `$${idx++}`;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Creates an in-memory PGlite database with pgvector, full knowledge schema,
 * and test tables.
 */
async function createVectorTestDb() {
  const pg = new PGlite({ extensions: { vector } });

  const db = {
    isPostgres: true,
    all: async (sql, ...params) => {
      const norm = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      const res = await pg.query(toPostgresSql(sql), norm);
      return res.rows;
    },
    get: async (sql, ...params) => {
      const norm = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      const res = await pg.query(toPostgresSql(sql), norm);
      return res.rows[0] || null;
    },
    run: async (sql, ...params) => {
      const norm = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      const res = await pg.query(toPostgresSql(sql), norm);
      return { changes: res.rowCount || 0 };
    },
    query: async (sql, params = []) => {
      return await pg.query(sql, params);
    },
    exec: async (sql) => {
      return await pg.exec(sql);
    }
  };

  // Base domain tables
  await pg.exec(`
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS files (
      id SERIAL PRIMARY KEY,
      title TEXT,
      originalName TEXT,
      storedName TEXT,
      subject TEXT,
      chapter TEXT,
      semester TEXT,
      semester_no INTEGER,
      cohort_id TEXT,
      audience_scope TEXT DEFAULT 'cohort',
      author_role TEXT DEFAULT 'teacher',
      uploadedBy TEXT,
      uploadedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      visibility TEXT DEFAULT 'everyone'
    );

    CREATE TABLE IF NOT EXISTS students (
      studentId TEXT PRIMARY KEY,
      name TEXT,
      role TEXT DEFAULT 'student',
      cohortId TEXT,
      semester INTEGER
    );

    CREATE TABLE IF NOT EXISTS cohorts (
      id TEXT PRIMARY KEY,
      name TEXT
    );

    INSERT INTO cohorts (id, name) VALUES
      ('cohort_2026', '2026 Cohort'),
      ('cohort_os', 'OS Cohort'),
      ('cohort_cs', 'CS Cohort'),
      ('cohort_a', 'Cohort A'),
      ('cohort_b', 'Cohort B'),
      ('cohort_mp', 'MP Cohort')
    ON CONFLICT (id) DO NOTHING;
  `);

  // Apply base knowledge schema
  const baseMigration = fs.readFileSync(path.join(__dirname, '../migrations/20261014_kyana_v3_knowledge.up.sql'), 'utf8');
  await pg.exec(baseMigration);

  // Apply note vector chunks UP migration
  const upMigration = fs.readFileSync(path.join(__dirname, '../migrations/20261110_kyana_note_vector_chunks.up.sql'), 'utf8');
  await pg.exec(upMigration);

  return { pg, db };
}

/**
 * Generates an orthogonal or aligned unit vector in 768 dimensions.
 */
function createSemanticVector(concept, dim = 768) {
  const v = new Array(dim).fill(0);
  if (concept === 'jit_compiler') {
    // Concept coordinates for JIT / Just-in-time compilation
    v[0] = 0.9;
    v[1] = 0.4;
    v[2] = 0.1;
  } else if (concept === 'smtp_email') {
    // Concept coordinates for SMTP / Email protocols
    v[10] = 0.85;
    v[11] = 0.5;
  } else if (concept === 'web_forms') {
    // Unrelated concept coordinates
    v[50] = 0.95;
    v[51] = 0.2;
  } else {
    // Fallback pseudo-random normalized vector
    for (let i = 0; i < dim; i++) {
      v[i] = Math.sin(i + 1);
    }
  }
  const norm = Math.hypot(...v);
  return v.map(x => Number((x / norm).toFixed(6)));
}

test('1. Migration: UP and DOWN migration idempotently alters knowledge_chunks with note vector columns on PGlite', async () => {
  const { pg } = await createVectorTestDb();

  // Verify UP migration columns exist
  const resUp = await pg.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'knowledge_chunks';");
  const upCols = resUp.rows.map(r => r.column_name);
  assert.ok(upCols.includes('end_page_number'), 'Must have end_page_number column');
  assert.ok(upCols.includes('section_heading'), 'Must have section_heading column');
  assert.ok(upCols.includes('content_hash'), 'Must have content_hash column');
  assert.ok(upCols.includes('file_id'), 'Must have file_id column');
  assert.ok(upCols.includes('file_version'), 'Must have file_version column');
  assert.ok(upCols.includes('cohort_id'), 'Must have cohort_id column');
  assert.ok(upCols.includes('semester_no'), 'Must have semester_no column');
  assert.ok(upCols.includes('audience_scope'), 'Must have audience_scope column');

  // Verify DOWN migration
  const downSql = fs.readFileSync(path.join(__dirname, '../migrations/20261110_kyana_note_vector_chunks.down.sql'), 'utf8');
  await pg.exec(downSql);

  const resDown = await pg.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'knowledge_chunks';");
  const downCols = resDown.rows.map(r => r.column_name);
  assert.ok(!downCols.includes('end_page_number'), 'end_page_number must be dropped in down migration');
  assert.ok(!downCols.includes('section_heading'), 'section_heading must be dropped in down migration');
  assert.ok(!downCols.includes('content_hash'), 'content_hash must be dropped in down migration');
  assert.ok(downCols.includes('id'), 'base table columns must remain intact');
  assert.ok(downCols.includes('resource_id'), 'base table columns must remain intact');
  assert.ok(downCols.includes('embedding'), 'vector embedding column must remain intact');

  // Re-apply UP migration for subsequent tests
  const upSql = fs.readFileSync(path.join(__dirname, '../migrations/20261110_kyana_note_vector_chunks.up.sql'), 'utf8');
  await pg.exec(upSql);
});

test('2. Chunking: page- and heading-aware chunking never splits a heading from its first paragraph and attaches metadata', () => {
  const file = {
    id: 42,
    title: 'Compiler Design Complete Notes',
    originalName: 'compiler_notes.pdf',
    subject: 'Compiler Design',
    chapter: 'Unit 3: Code Generation',
    semester: '5',
    semester_no: 5,
    cohort_id: 'cohort_2026',
    audience_scope: 'cohort',
    uploadedBy: 'teacher_smith',
    author_role: 'teacher',
    version: 1,
    extracted_content: [
      'Chapter 1: Intermediate Code Generation\n\nIntermediate code generation is the fourth phase of a compiler. It represents source code in machine-independent form.',
      '1.2.5 Just-In-Time Compilation\n\nJust-in-time compilation translates intermediate bytecode into native machine instructions at execution time.\n● Improves performance over pure interpretation.\n● Balances compile overhead and execution speed.\n\n1.2.6 Ahead-Of-Time Compilation\n\nAhead-of-time compilation compiles all code before program execution.\n● Predictable startup times.\n● Optimized for target hardware platforms.'
    ].join('\f')
  };

  const { resource, chunks } = buildNoteKnowledge(file);

  assert.strictEqual(resource.id, 'note:42');
  assert.strictEqual(resource.semester_no, 5);
  assert.strictEqual(resource.cohort_id, 'cohort_2026');

  // Page 1 should have chunk with pageNumber 1
  const page1Chunks = chunks.filter(c => c.pageNumber === 1);
  assert.strictEqual(page1Chunks.length, 1);
  assert.ok(page1Chunks[0].content.includes('Chapter 1: Intermediate Code Generation'));
  assert.strictEqual(page1Chunks[0].sectionHeading, 'Chapter 1: Intermediate Code Generation');

  // Page 2 should have chunks with pageNumber 2
  const page2Chunks = chunks.filter(c => c.pageNumber === 2);
  assert.ok(page2Chunks.length >= 2, 'Page 2 with two major sections should produce distinct chunks');

  const jitChunk = page2Chunks.find(c => c.sectionHeading && c.sectionHeading.includes('Just-In-Time Compilation'));
  assert.ok(jitChunk, 'Should detect Just-In-Time Compilation heading');
  assert.strictEqual(jitChunk.pageNumber, 2);
  assert.strictEqual(jitChunk.endPageNumber, 2);
  assert.strictEqual(jitChunk.fileId, 42);
  assert.strictEqual(jitChunk.semesterNo, 5);
  assert.strictEqual(jitChunk.cohortId, 'cohort_2026');
  assert.strictEqual(jitChunk.audienceScope, 'cohort');
  assert.ok(jitChunk.contentHash, 'Must have computed contentHash');

  // Verify heading is kept with its first paragraph
  assert.ok(
    jitChunk.content.includes('1.2.5 Just-In-Time Compilation') &&
    jitChunk.content.includes('Just-in-time compilation translates intermediate bytecode into native machine instructions'),
    'Heading must never be separated from its first paragraph'
  );
});

test('3. Content hash skipping: persistKnowledgeResource reuses existing embeddings when content hash matches', async () => {
  const { db } = await createVectorTestDb();

  const file = {
    id: 101,
    title: 'Operating Systems Virtual Memory',
    subject: 'Operating Systems',
    semester: '4',
    semester_no: 4,
    cohort_id: 'cohort_os',
    extracted_content: 'Page 1: Virtual memory separates user logical memory from physical memory.\fPage 2: Page replacement algorithms include FIFO, LRU, and Optimal.'
  };

  const built = buildNoteKnowledge(file);

  let embeddingCalls = 0;
  let embeddedTextsCount = 0;

  const mockEmbedder = async (texts) => {
    embeddingCalls++;
    embeddedTextsCount += texts.length;
    return texts.map(t => createSemanticVector('general'));
  };

  // Run 1: First indexing -> all chunks must be embedded
  await persistKnowledgeResource(db, built, { customEmbedder: mockEmbedder });
  assert.strictEqual(embeddingCalls, 1, 'First run must invoke embedding provider once');
  assert.strictEqual(embeddedTextsCount, 2, 'First run must embed both chunks');

  // Verify chunks saved with embeddings and content hashes
  const savedChunks1 = await db.all('SELECT id, chunk_index, content_hash, embedding FROM knowledge_chunks WHERE resource_id = ? ORDER BY chunk_index ASC', 'note:101');
  assert.strictEqual(savedChunks1.length, 2);
  assert.ok(savedChunks1[0].content_hash, 'Chunk 0 must have content_hash');
  assert.ok(savedChunks1[0].embedding, 'Chunk 0 must have embedding');

  // Run 2: Re-indexing identical content -> must skip unchanged chunks!
  embeddingCalls = 0;
  embeddedTextsCount = 0;

  const built2 = buildNoteKnowledge(file);
  await persistKnowledgeResource(db, built2, { customEmbedder: mockEmbedder });

  assert.strictEqual(embeddingCalls, 0, 'Re-indexing identical chunks must NOT call embedding provider (content hash skipping)');
  assert.strictEqual(embeddedTextsCount, 0, 'Zero chunks should be re-embedded');

  // Verify database still has valid embeddings
  const savedChunks2 = await db.all('SELECT id, chunk_index, content_hash, embedding FROM knowledge_chunks WHERE resource_id = ? ORDER BY chunk_index ASC', 'note:101');
  assert.strictEqual(savedChunks2.length, 2);
  assert.strictEqual(savedChunks2[0].embedding, savedChunks1[0].embedding, 'Existing vector was preserved');
});

test('4. Paraphrase Retrieval: "JIT compiler" query retrieves note describing "just-in-time compilation" on Page 2 with real vectors', async () => {
  const { db } = await createVectorTestDb();

  // Insert two notes into files and note_search_documents
  // Note 200: Compiler Design containing "just-in-time compilation" on Page 2 (no occurrence of literal "JIT" or "compiler" in that section)
  await db.query(`
    INSERT INTO files (id, title, originalName, storedName, subject, chapter, semester, semester_no, cohort_id, author_role)
    VALUES (200, 'Advanced Language Runtimes', 'runtimes.pdf', 'runtimes.pdf', 'Compiler Design', 'Unit 3', '5', 5, 'cohort_cs', 'teacher'),
           (201, 'Web Development Forms Reference', 'forms.pdf', 'forms.pdf', 'Web Technology', 'Unit 2', '5', 5, 'cohort_cs', 'teacher')
  `);

  const file200Text = [
    'Page 1: Virtual machine architecture and stack-based execution engines.',
    'Page 2: The execution subsystem uses just-in-time compilation. This converts bytecode into native assembly instructions at runtime to eliminate interpretive overhead.'
  ].join('\f');

  const file201Text = 'Page 1: HTML form submission using POST and GET methods.';

  await db.query(`
    INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
    VALUES (200, $1, 'indexed', CURRENT_TIMESTAMP),
           (201, $2, 'indexed', CURRENT_TIMESTAMP)
  `, [file200Text, file201Text]);

  // Index note 200 with semantic vectors
  const built200 = buildNoteKnowledge({
    id: 200,
    title: 'Advanced Language Runtimes',
    subject: 'Compiler Design',
    chapter: 'Unit 3',
    semester: '5',
    semester_no: 5,
    cohort_id: 'cohort_cs',
    extracted_content: file200Text
  });

  const vectorChunkPage1 = createSemanticVector('general');
  const vectorChunkPage2 = createSemanticVector('jit_compiler'); // Highly aligned with JIT compiler concept

  await persistKnowledgeResource(db, built200, {
    vectors: [vectorChunkPage1, vectorChunkPage2]
  });

  // Index note 201 with unrelated vectors
  const built201 = buildNoteKnowledge({
    id: 201,
    title: 'Web Development Forms Reference',
    subject: 'Web Technology',
    chapter: 'Unit 2',
    semester: '5',
    semester_no: 5,
    cohort_id: 'cohort_cs',
    extracted_content: file201Text
  });
  await persistKnowledgeResource(db, built201, {
    vectors: [createSemanticVector('web_forms')]
  });

  // Mock embedding provider for query "JIT compiler"
  const prevFlag = process.env.KYANA_NOTE_VECTOR_SEARCH;
  process.env.KYANA_NOTE_VECTOR_SEARCH = 'true';
  invalidateSearchCache(db);

  // Hook query embedder: query vector is aligned with 'jit_compiler'
  const embeddingsModule = require('../lib/knowledge-embeddings');
  const originalEmbedText = embeddingsModule.embedText;
  embeddingsModule.embedText = async (text, opts) => {
    if (String(text).toLowerCase().includes('jit')) {
      return createSemanticVector('jit_compiler');
    }
    return createSemanticVector('general');
  };

  try {
    const results = await searchNotes(db, {
      query: 'JIT compiler',
      semester: 5
    });

    assert.ok(results.length >= 1, 'Semantic vector search must return at least 1 result for "JIT compiler"');
    const topResult = results[0];

    assert.strictEqual(Number(topResult.id), 200, 'Top result must be File 200 (Advanced Language Runtimes)');
    assert.ok(['vector', 'hybrid'].includes(topResult.matchType), 'Match type must be vector or hybrid');
    assert.ok(topResult.extractedContent.includes('[Page 2]'), 'Extracted passage must cite Page 2 where just-in-time compilation is explained');
    assert.ok(topResult.extractedContent.includes('just-in-time compilation'), 'Passage text must contain just-in-time compilation');
  } finally {
    embeddingsModule.embedText = originalEmbedText;
    process.env.KYANA_NOTE_VECTOR_SEARCH = prevFlag;
  }
});

test('5. Access Isolation: Semester and Cohort access rules strictly isolate vector search results', async () => {
  const { db } = await createVectorTestDb();

  // Insert Semester 3 note for cohort_a
  await db.query(`
    INSERT INTO files (id, title, originalName, storedName, subject, chapter, semester, semester_no, cohort_id, audience_scope, author_role)
    VALUES (300, 'Relational Algebra and Query Optimization', 'ra.pdf', 'ra.pdf', 'DBMS', 'Unit 2', '3', 3, 'cohort_a', 'cohort', 'teacher')
  `);

  const docText = 'Page 1: Relational algebra expressions are translated into relational execution trees for query evaluation.';
  await db.query(`
    INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
    VALUES (300, $1, 'indexed', CURRENT_TIMESTAMP)
  `, [docText]);

  const built = buildNoteKnowledge({
    id: 300,
    title: 'Relational Algebra and Query Optimization',
    subject: 'DBMS',
    chapter: 'Unit 2',
    semester: '3',
    semester_no: 3,
    cohort_id: 'cohort_a',
    audience_scope: 'cohort',
    extracted_content: docText
  });

  await persistKnowledgeResource(db, built, {
    vectors: [createSemanticVector('jit_compiler')]
  });

  const prevFlag = process.env.KYANA_NOTE_VECTOR_SEARCH;
  process.env.KYANA_NOTE_VECTOR_SEARCH = 'true';
  invalidateSearchCache(db);

  const embeddingsModule = require('../lib/knowledge-embeddings');
  const originalEmbedText = embeddingsModule.embedText;
  embeddingsModule.embedText = async () => createSemanticVector('jit_compiler');

  try {
    // Context A: Semester 1 student
    const studentSem1Context = {
      authenticated: true,
      studentId: 'stud_sem1',
      role: 'student',
      semester: 1,
      currentSemester: 1,
      cohort: { id: 'cohort_a', currentSemester: 1 }
    };

    const sem1Results = await searchNotes(db, {
      query: 'query evaluation trees',
      academicContext: studentSem1Context
    });

    assert.strictEqual(sem1Results.length, 0, 'Semester 1 student must NOT retrieve Semester 3 note via vector search');

    // Context B: Semester 3 student
    const studentSem3Context = {
      authenticated: true,
      studentId: 'stud_sem3',
      role: 'student',
      semester: 3,
      currentSemester: 3,
      cohort: { id: 'cohort_a', currentSemester: 3 }
    };

    const sem3Results = await searchNotes(db, {
      query: 'query evaluation trees',
      academicContext: studentSem3Context
    });

    assert.strictEqual(sem3Results.length, 1, 'Semester 3 student must retrieve Semester 3 note');
    assert.strictEqual(Number(sem3Results[0].id), 300);
  } finally {
    embeddingsModule.embedText = originalEmbedText;
    process.env.KYANA_NOTE_VECTOR_SEARCH = prevFlag;
  }
});

test('6. Flag Preservation: When KYANA_NOTE_VECTOR_SEARCH is off, keyword-only search runs and vector is ignored', async () => {
  const { db } = await createVectorTestDb();

  await db.query(`
    INSERT INTO files (id, title, originalName, storedName, subject, chapter, semester, semester_no, cohort_id, author_role)
    VALUES (400, 'Microprocessor Architecture', 'mp.pdf', 'mp.pdf', 'Microprocessors', 'Unit 1', '4', 4, 'cohort_mp', 'teacher')
  `);

  const docText = 'Page 1: The 8086 microprocessor contains an execution unit (EU) and a bus interface unit (BIU).\fPage 2: Memory segmentation allows addressing 1 megabyte using 20-bit addresses.';
  await db.query(`
    INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
    VALUES (400, $1, 'indexed', CURRENT_TIMESTAMP)
  `, [docText]);

  const built = buildNoteKnowledge({
    id: 400,
    title: 'Microprocessor Architecture',
    subject: 'Microprocessors',
    chapter: 'Unit 1',
    semester: '4',
    semester_no: 4,
    cohort_id: 'cohort_mp',
    extracted_content: docText
  });

  await persistKnowledgeResource(db, built, {
    vectors: [createSemanticVector('jit_compiler'), createSemanticVector('general')]
  });

  // Flag is explicitly false / off
  const prevFlag = process.env.KYANA_NOTE_VECTOR_SEARCH;
  delete process.env.KYANA_NOTE_VECTOR_SEARCH;
  invalidateSearchCache(db);

  try {
    // Paraphrase query with zero keyword overlap must return 0 results when flag is off
    const paraphraseResults = await searchNotes(db, {
      query: 'JIT compiler',
      semester: 4
    });
    assert.strictEqual(paraphraseResults.length, 0, 'When flag is off, semantic paraphrase with 0 keyword matches must return 0 results');

    // Exact keyword query continues to function perfectly
    const keywordResults = await searchNotes(db, {
      query: '8086 microprocessor',
      semester: 4
    });
    assert.strictEqual(keywordResults.length, 1, 'Keyword search must still return matching note');
    assert.strictEqual(Number(keywordResults[0].id), 400);
    assert.ok(keywordResults[0].extractedContent.includes('[Page 1]'), 'Keyword result extracts Page 1');
  } finally {
    process.env.KYANA_NOTE_VECTOR_SEARCH = prevFlag;
  }
});

test('7. Cohort Gap Prevention: Vector query from Cohort B in Semester 3 must NOT return Cohort A private note in Semester 3', async () => {
  const { db } = await createVectorTestDb();

  // Two cohorts in the same semester (Semester 3): cohort_a and cohort_b
  // Note 501 is private to cohort_a (audience_scope = 'cohort', cohort_id = 'cohort_a')
  await db.query(`
    INSERT INTO files (id, title, originalName, storedName, subject, chapter, semester, semester_no, cohort_id, audience_scope, author_role)
    VALUES (501, 'Cohort A Confidential DBMS Exam Review', 'cohort_a_exam.pdf', 'cohort_a_exam.pdf', 'Database Systems', 'Unit 4', '3', 3, 'cohort_a', 'cohort', 'teacher')
  `);

  const docText = 'Page 1: Exam Review: B+ Tree indexing mechanisms and multi-level index fanout calculation.';
  await db.query(`
    INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
    VALUES (501, $1, 'indexed', CURRENT_TIMESTAMP)
  `, [docText]);

  const built = buildNoteKnowledge({
    id: 501,
    title: 'Cohort A Confidential DBMS Exam Review',
    subject: 'Database Systems',
    chapter: 'Unit 4',
    semester: '3',
    semester_no: 3,
    cohort_id: 'cohort_a',
    audience_scope: 'cohort',
    extracted_content: docText
  });

  await persistKnowledgeResource(db, built, {
    vectors: [createSemanticVector('jit_compiler')]
  });

  const prevFlag = process.env.KYANA_NOTE_VECTOR_SEARCH;
  process.env.KYANA_NOTE_VECTOR_SEARCH = 'true';
  invalidateSearchCache(db);

  const embeddingsModule = require('../lib/knowledge-embeddings');
  const originalEmbedText = embeddingsModule.embedText;
  embeddingsModule.embedText = async () => createSemanticVector('jit_compiler');

  try {
    // 1. Student in Cohort B (same semester: 3) performs vector query
    const studentCohortBContext = {
      authenticated: true,
      studentId: 'student_cohort_b',
      role: 'student',
      semester: 3,
      currentSemester: 3,
      cohort: { id: 'cohort_b', currentSemester: 3 }
    };

    const cohortBResults = await searchNotes(db, {
      query: 'multi-level index fanout',
      academicContext: studentCohortBContext
    });

    assert.strictEqual(
      cohortBResults.length,
      0,
      'Cohort B student in Semester 3 must NOT retrieve Cohort A private note in Semester 3 (cohort gap prevented)'
    );

    // 2. Student in Cohort A (same semester: 3) performs vector query
    const studentCohortAContext = {
      authenticated: true,
      studentId: 'student_cohort_a',
      role: 'student',
      semester: 3,
      currentSemester: 3,
      cohort: { id: 'cohort_a', currentSemester: 3 }
    };

    const cohortAResults = await searchNotes(db, {
      query: 'multi-level index fanout',
      academicContext: studentCohortAContext
    });

    assert.strictEqual(cohortAResults.length, 1, 'Cohort A student must retrieve Cohort A note');
    assert.strictEqual(Number(cohortAResults[0].id), 501);
  } finally {
    embeddingsModule.embedText = originalEmbedText;
    process.env.KYANA_NOTE_VECTOR_SEARCH = prevFlag;
  }
});

test('8. Failure Handling: Query embedding timeout & provider error fall back to keyword-only results without throwing', async () => {
  const { db } = await createVectorTestDb();

  await db.query(`
    INSERT INTO files (id, title, originalName, storedName, subject, chapter, semester, semester_no, cohort_id, author_role)
    VALUES (601, 'Computer Architecture Pipelining', 'pipe.pdf', 'pipe.pdf', 'Computer Architecture', 'Unit 2', '4', 4, 'cohort_os', 'teacher')
  `);

  const docText = 'Page 1: Instruction pipelining hazards include structural hazards, data hazards, and control hazards.';
  await db.query(`
    INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
    VALUES (601, $1, 'indexed', CURRENT_TIMESTAMP)
  `, [docText]);

  const prevFlag = process.env.KYANA_NOTE_VECTOR_SEARCH;
  const prevTimeout = process.env.KYANA_VECTOR_TIMEOUT_MS;
  process.env.KYANA_NOTE_VECTOR_SEARCH = 'true';

  const embeddingsModule = require('../lib/knowledge-embeddings');
  const originalEmbedText = embeddingsModule.embedText;

  try {
    // Subtest A: Provider throws error -> falls back to keyword FTS, no exception thrown
    embeddingsModule.embedText = async () => {
      throw new Error('Gemini API 503 Service Unavailable: overloaded');
    };
    invalidateSearchCache(db);

    let errorThrown = false;
    let resultsOnError = [];
    try {
      resultsOnError = await searchNotes(db, { query: 'instruction pipelining hazards', semester: 4 });
    } catch {
      errorThrown = true;
    }

    assert.strictEqual(errorThrown, false, 'searchNotes must never throw an exception when embedding provider fails');
    assert.strictEqual(resultsOnError.length, 1, 'Should fall back to keyword FTS matches');
    assert.strictEqual(Number(resultsOnError[0].id), 601);

    // Subtest B: Query embedding times out -> falls back to keyword FTS, no exception thrown
    process.env.KYANA_VECTOR_TIMEOUT_MS = '20'; // 20ms timeout
    embeddingsModule.embedText = async () => {
      await new Promise(resolve => setTimeout(resolve, 80)); // 80ms delay > 20ms timeout
      return createSemanticVector('general');
    };
    invalidateSearchCache(db);

    let timeoutErrorThrown = false;
    let resultsOnTimeout = [];
    try {
      resultsOnTimeout = await searchNotes(db, { query: 'instruction pipelining hazards', semester: 4 });
    } catch {
      timeoutErrorThrown = true;
    }

    assert.strictEqual(timeoutErrorThrown, false, 'searchNotes must never throw an exception when embedding times out');
    assert.strictEqual(resultsOnTimeout.length, 1, 'Should fall back to keyword FTS matches on timeout');
    assert.strictEqual(Number(resultsOnTimeout[0].id), 601);
  } finally {
    embeddingsModule.embedText = originalEmbedText;
    process.env.KYANA_NOTE_VECTOR_SEARCH = prevFlag;
    if (prevTimeout !== undefined) {
      process.env.KYANA_VECTOR_TIMEOUT_MS = prevTimeout;
    } else {
      delete process.env.KYANA_VECTOR_TIMEOUT_MS;
    }
  }
});

test('9. Calibrated Cutoff: Negative / unrelated query with distance > 0.42 returns 0 results', async () => {
  const { db } = await createVectorTestDb();

  await db.query(`
    INSERT INTO files (id, title, originalName, storedName, subject, chapter, semester, semester_no, cohort_id, author_role)
    VALUES (701, 'Operating Systems Kernel Architecture', 'os.pdf', 'os.pdf', 'Operating Systems', 'Unit 1', '4', 4, 'cohort_os', 'teacher')
  `);

  const docText = 'Page 1: Operating system microkernel architecture versus monolithic kernel design.';
  await db.query(`
    INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
    VALUES (701, $1, 'indexed', CURRENT_TIMESTAMP)
  `, [docText]);

  const built = buildNoteKnowledge({
    id: 701,
    title: 'Operating Systems Kernel Architecture',
    subject: 'Operating Systems',
    chapter: 'Unit 1',
    semester: '4',
    semester_no: 4,
    cohort_id: 'cohort_os',
    extracted_content: docText
  });

  // Vector for OS note
  await persistKnowledgeResource(db, built, {
    vectors: [createSemanticVector('general')]
  });

  const prevFlag = process.env.KYANA_NOTE_VECTOR_SEARCH;
  process.env.KYANA_NOTE_VECTOR_SEARCH = 'true';
  invalidateSearchCache(db);

  const embeddingsModule = require('../lib/knowledge-embeddings');
  const originalEmbedText = embeddingsModule.embedText;

  // Mock unrelated query vector with cosine distance ~ 0.50 (> 0.42 cutoff)
  embeddingsModule.embedText = async () => {
    // Generate an orthogonal vector with distance ~ 0.50
    const v = createSemanticVector('general');
    const rotated = v.map((x, i) => (i % 2 === 0 ? x * 0.7 : -x * 0.7));
    const norm = Math.hypot(...rotated);
    return rotated.map(x => Number((x / norm).toFixed(6)));
  };

  try {
    const results = await searchNotes(db, {
      query: 'explain quantum entanglement',
      semester: 4
    });

    assert.strictEqual(results.length, 0, 'Unrelated query with vector distance > calibrated cutoff must return 0 results');
  } finally {
    embeddingsModule.embedText = originalEmbedText;
    process.env.KYANA_NOTE_VECTOR_SEARCH = prevFlag;
  }
});

test('10. Deploy Order Safety: When vector migration has NOT been applied and flag is OFF, search and index run with zero errors', async () => {
  // Create PGlite DB with ONLY base knowledge schema (vector chunks UP migration is NOT applied)
  const pg = new PGlite({ extensions: { vector } });
  const db = {
    isPostgres: true,
    all: async (sql, ...params) => {
      const norm = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      return (await pg.query(toPostgresSql(sql), norm)).rows;
    },
    get: async (sql, ...params) => {
      const norm = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      return (await pg.query(toPostgresSql(sql), norm)).rows[0] || null;
    },
    run: async (sql, ...params) => {
      const norm = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      return { changes: (await pg.query(toPostgresSql(sql), norm)).rowCount || 0 };
    },
    query: async (sql, params = []) => await pg.query(sql, params),
    exec: async (sql) => await pg.exec(sql)
  };

  await pg.exec(`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE IF NOT EXISTS files (
      id SERIAL PRIMARY KEY,
      title TEXT,
      originalName TEXT,
      storedName TEXT,
      subject TEXT,
      chapter TEXT,
      semester TEXT,
      semester_no INTEGER,
      cohort_id TEXT,
      audience_scope TEXT DEFAULT 'cohort',
      author_role TEXT DEFAULT 'teacher',
      uploadedBy TEXT,
      uploadedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      visibility TEXT DEFAULT 'everyone'
    );
    CREATE TABLE IF NOT EXISTS students (
      studentId TEXT PRIMARY KEY,
      name TEXT
    );
    CREATE TABLE IF NOT EXISTS cohorts (id TEXT PRIMARY KEY, name TEXT);
    INSERT INTO cohorts (id, name) VALUES ('cohort_legacy', 'Legacy Cohort') ON CONFLICT DO NOTHING;
  `);

  // Apply ONLY base knowledge schema - do NOT apply 20261110_kyana_note_vector_chunks.up.sql
  const baseMigration = fs.readFileSync(path.join(__dirname, '../migrations/20261014_kyana_v3_knowledge.up.sql'), 'utf8');
  await pg.exec(baseMigration);

  // Verify that new columns do NOT exist
  const cols = (await pg.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'knowledge_chunks';")).rows.map(r => r.column_name);
  assert.ok(!cols.includes('end_page_number'), 'Migration has not been applied');
  assert.ok(!cols.includes('content_hash'), 'Migration has not been applied');

  // Verify search runs cleanly with flag OFF
  const prevFlag = process.env.KYANA_NOTE_VECTOR_SEARCH;
  delete process.env.KYANA_NOTE_VECTOR_SEARCH;
  invalidateSearchCache(db);

  try {
    await db.query(`
      INSERT INTO files (id, title, originalName, storedName, subject, chapter, semester, semester_no, cohort_id, author_role)
      VALUES (801, 'Discrete Mathematics Graph Theory', 'dm.pdf', 'dm.pdf', 'Discrete Mathematics', 'Unit 3', '2', 2, 'cohort_legacy', 'teacher')
    `);
    await db.query(`
      INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
      VALUES (801, 'Eulerian paths and Hamiltonian cycles in graph theory.', 'indexed', CURRENT_TIMESTAMP)
    `);

    const results = await searchNotes(db, { query: 'Hamiltonian cycles graph theory', semester: 2 });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(Number(results[0].id), 801);
    assert.ok(results[0].extractedContent.includes('Hamiltonian cycles'));
  } finally {
    process.env.KYANA_NOTE_VECTOR_SEARCH = prevFlag;
  }
});
