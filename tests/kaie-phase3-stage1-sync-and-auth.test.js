'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

const { ensureRagSchema } = require('../lib/rag-schema');
const {
  ingestAcademicDocument,
  synchronizeDocumentMetadata,
  cleanupDeletedDocument
} = require('../lib/document-ingestion');
const {
  syncCourseMap,
  getCourseMap
} = require('../lib/kaie-course-map');
const {
  getChapterReaderBundle,
  answerWithChapterContext
} = require('../lib/chapter-tutor-engine');
const {
  startOrResumeStudySession,
  buildCompiledTopicLessonBundle
} = require('../lib/study-partner-engine');
const { retrieveAcademicEvidence } = require('../lib/hybrid-rag-engine');
const { handleChat } = require('../ai-assistant');
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
      audience_scope TEXT,
      visibility TEXT,
      resource_category TEXT,
      unit_number INTEGER,
      sort_order INTEGER DEFAULT 0,
      deleted_at TEXT,
      hidden_at TEXT,
      moderation_status TEXT
    );
    CREATE TABLE IF NOT EXISTS file_blobs (
      filename TEXT PRIMARY KEY,
      fileData BLOB
    );
    CREATE TABLE IF NOT EXISTS note_search_documents (
      id INTEGER PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      extraction_status TEXT NOT NULL DEFAULT 'indexed',
      extraction_error TEXT,
      indexed_at TEXT NOT NULL DEFAULT '',
      content_truncated INTEGER NOT NULL DEFAULT 0
    );
  `);

  await ensureRagSchema(db);
  return db;
}

test('Phase 3 Stage 1 — Task 1: File Synchronization & Idempotency (Cases 1–6)', async (t) => {
  const db = await createTestDb();

  // Seed an initial note in Web Technology I, Unit 3
  const noteContentV1 = [
    '## Levels of Style Sheets',
    'Levels of Style Sheets: CSS provides three levels of style sheets: inline, internal (document-level), and external stylesheets.',
    'Formula: $Specificity = 100 \\times ID + 10 \\times Class + 1 \\times Element$',
    '```css',
    'h1 { color: navy; font-size: 24px; }',
    '```'
  ].join('\n');

  const ins = await db.run(
    `INSERT INTO files (storedName, originalName, title, semester, semester_no, subject, chapter, unit_number, resource_category, uploadedBy, sizeBytes, uploadedAt, cohort_id, audience_scope, visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'unit3-css-v1.txt',
    'unit3-css-v1.txt',
    'Original CSS Unit 3 Notes',
    'Semester 2',
    2,
    'Web Technology I',
    'Unit 3: Introducing Cascading Style Sheet',
    3,
    'notes',
    'T01',
    noteContentV1.length,
    new Date().toISOString(),
    null,
    'all_students',
    'everyone'
  );
  const fileId = Number(ins.lastInsertRowid);
  await db.run(`INSERT INTO file_blobs (filename, fileData) VALUES (?, ?)`, 'unit3-css-v1.txt', Buffer.from(noteContentV1));

  let fileRecord = await db.get(`SELECT * FROM files WHERE id = ?`, fileId);
  const initialIngest = await ingestAcademicDocument(db, fileRecord, { buffer: Buffer.from(noteContentV1) });
  assert.equal(initialIngest.status, 'ready');

  const initialChunkIds = (await db.all(`SELECT id FROM document_chunks WHERE file_id = ? ORDER BY chunk_index ASC`, String(fileId))).map((r) => r.id);
  assert.ok(initialChunkIds.length >= 2, 'Initial ingestion must create parent and child chunks');

  await t.test('Case 1: Editing file title updates academic metadata and citations without re-extracting or re-embedding', async () => {
    const prevFile = { ...fileRecord };
    await db.run(`UPDATE files SET title = ? WHERE id = ?`, 'Renamed CSS Master Lecture Notes', fileId);
    fileRecord = await db.get(`SELECT * FROM files WHERE id = ?`, fileId);

    const syncRes = await synchronizeDocumentMetadata(db, fileRecord, { previousFile: prevFile });
    assert.equal(syncRes.status, 'ready');
    assert.equal(syncRes.metadataOnly, true, 'Title change must take the metadata-only synchronization path');
    assert.equal(syncRes.reextracted, false);
    assert.equal(syncRes.reembedded, false);

    // Chunk IDs must remain identical (not re-embedded)
    const afterChunkIds = (await db.all(`SELECT id, metadata_json FROM document_chunks WHERE file_id = ? ORDER BY chunk_index ASC`, String(fileId)));
    assert.deepEqual(afterChunkIds.map((r) => r.id), initialChunkIds);
    assert.equal(JSON.parse(afterChunkIds[0].metadata_json).title, 'Renamed CSS Master Lecture Notes');

    // Topic metadata & course map citations must reflect new title
    const topicMeta = await db.get(`SELECT title FROM document_topic_metadata WHERE file_id = ?`, String(fileId));
    assert.equal(topicMeta.title, 'Renamed CSS Master Lecture Notes');

    const map = await getCourseMap(db, { subject: 'Web Technology I', semesterNo: 2, unitNumber: 3 });
    const levelsTopic = map.units[0].topics.find((tp) => /Levels of Style Sheets/i.test(tp.topicTitle));
    assert.ok(levelsTopic, 'Levels of Style Sheets topic must exist');
    assert.ok(
      levelsTopic.noteCitations.some((c) => c.fileTitle === 'Renamed CSS Master Lecture Notes'),
      'Course map citation must reflect updated file title'
    );

    const rag = await retrieveAcademicEvidence(db, { query: 'Levels of Style Sheets inline internal external', semester: 2 });
    assert.equal(rag.passages[0].title, 'Renamed CSS Master Lecture Notes');
  });

  await t.test('Case 2: Moving a file to another chapter/unit updates chapter mappings and removes old unit mappings', async () => {
    const prevFile = { ...fileRecord };
    await db.run(
      `UPDATE files SET chapter = ?, unit_number = ? WHERE id = ?`,
      'Unit 1: Basic Concept',
      1,
      fileId
    );
    fileRecord = await db.get(`SELECT * FROM files WHERE id = ?`, fileId);

    const syncRes = await synchronizeDocumentMetadata(db, fileRecord, { previousFile: prevFile });
    assert.equal(syncRes.metadataOnly, true);

    const chunks = await db.all(`SELECT chapter, unit FROM document_chunks WHERE file_id = ?`, String(fileId));
    assert.ok(chunks.every((c) => c.chapter === 'Unit 1: Basic Concept' && c.unit === 'Unit 1'));

    const extracted = await db.all(`SELECT unit_number, chapter FROM academic_extracted_items WHERE file_id = ?`, String(fileId));
    assert.ok(extracted.every((it) => Number(it.unit_number) === 1 && it.chapter === 'Unit 1: Basic Concept'));

    // Old Unit 3 mappings for this file must be removed
    const oldUnit3Mappings = await db.all(
      `SELECT * FROM topic_source_mappings WHERE CAST(file_id AS TEXT) = ? AND unit_number = 3`,
      String(fileId)
    );
    assert.equal(oldUnit3Mappings.length, 0, 'Old Unit 3 mappings must be cleared when file moves to Unit 1');
  });

  await t.test('Case 3: Moving a file to another subject updates subject mappings and removes old subject mappings', async () => {
    const prevFile = { ...fileRecord };
    await db.run(
      `UPDATE files SET subject = ?, semester = ?, semester_no = ?, chapter = ?, unit_number = ? WHERE id = ?`,
      'Data Structure and Algorithms',
      'Semester 3',
      3,
      'Unit 1: Introduction to Data Structure',
      1,
      fileId
    );
    fileRecord = await db.get(`SELECT * FROM files WHERE id = ?`, fileId);

    const syncRes = await synchronizeDocumentMetadata(db, fileRecord, { previousFile: prevFile });
    assert.equal(syncRes.metadataOnly, true);

    const topicMeta = await db.get(`SELECT subject, subject_code, semester_no FROM document_topic_metadata WHERE file_id = ?`, String(fileId));
    assert.equal(topicMeta.subject, 'Data Structure and Algorithms');
    assert.equal(topicMeta.subject_code, 'CIT214');
    assert.equal(Number(topicMeta.semester_no), 3);

    const oldSubjMappings = await db.all(
      `SELECT * FROM topic_source_mappings WHERE CAST(file_id AS TEXT) = ? AND subject = ?`,
      String(fileId),
      'Web Technology I'
    );
    assert.equal(oldSubjMappings.length, 0, 'Old subject mappings in Web Technology I must be removed');

    const newSubjMappings = await db.all(
      `SELECT * FROM topic_source_mappings WHERE CAST(file_id AS TEXT) = ? AND subject = ?`,
      String(fileId),
      'Data Structure and Algorithms'
    );
    assert.ok(newSubjMappings.length >= 1, 'New subject mappings in Data Structure and Algorithms must be created');
  });

  await t.test('Case 4: Replacing/editing file content updates chunks, embeddings, and extracted items without duplicates', async () => {
    const prevFile = { ...fileRecord };
    const newDsaContent = [
      '## Asymptotic Notation',
      'Big-O Notation: A mathematical notation that describes the upper bound of an algorithm time complexity in the worst case.',
      'Formula: $T(n) \\le c \\cdot g(n)$ for all $n \\ge n_0$.',
      '1. Define Big-O, Big-Omega, and Big-Theta notations with examples. [5]'
    ].join('\n');

    await db.run(
      `UPDATE file_blobs SET fileData = ? WHERE filename = ?`,
      Buffer.from(newDsaContent),
      fileRecord.storedName
    );

    const syncRes = await synchronizeDocumentMetadata(db, fileRecord, {
      previousFile: prevFile,
      buffer: Buffer.from(newDsaContent),
      contentChanged: true
    });
    assert.equal(syncRes.status, 'ready');
    assert.equal(syncRes.reextracted, true);
    assert.equal(syncRes.reembedded, true);

    const chunks = await db.all(`SELECT clean_content FROM document_chunks WHERE file_id = ?`, String(fileId));
    assert.ok(chunks.some((c) => /Big-O Notation/i.test(c.clean_content)), 'New content must be chunked');
    assert.ok(!chunks.some((c) => /Levels of Style Sheets/i.test(c.clean_content)), 'Obsolete CSS content chunks must be replaced');

    const items = await db.all(`SELECT title, content_text FROM academic_extracted_items WHERE file_id = ?`, String(fileId));
    assert.ok(items.some((it) => /Big-O/i.test(`${it.title} ${it.content_text}`)), 'Extracted items must reflect new content');
    assert.ok(!items.some((it) => /Specificity/i.test(`${it.title} ${it.content_text}`)), 'Obsolete extracted items must be removed');
  });

  await t.test('Case 5: Repeated edits do not create duplicate chunks, embeddings, or extracted items (Idempotency)', async () => {
    const beforeChunks = await db.get(`SELECT COUNT(*) AS cnt FROM document_chunks WHERE file_id = ?`, String(fileId));
    const beforeEmbeds = await db.get(`SELECT COUNT(*) AS cnt FROM document_embeddings WHERE file_id = ?`, String(fileId));
    const beforeItems = await db.get(`SELECT COUNT(*) AS cnt FROM academic_extracted_items WHERE file_id = ?`, String(fileId));

    // Repeat metadata sync 3 times and content re-ingest 2 times
    await synchronizeDocumentMetadata(db, fileRecord, { previousFile: fileRecord });
    await synchronizeDocumentMetadata(db, fileRecord, { previousFile: fileRecord });
    await ingestAcademicDocument(db, fileRecord);
    await ingestAcademicDocument(db, fileRecord, { force: true });

    const afterChunks = await db.get(`SELECT COUNT(*) AS cnt FROM document_chunks WHERE file_id = ?`, String(fileId));
    const afterEmbeds = await db.get(`SELECT COUNT(*) AS cnt FROM document_embeddings WHERE file_id = ?`, String(fileId));
    const afterItems = await db.get(`SELECT COUNT(*) AS cnt FROM academic_extracted_items WHERE file_id = ?`, String(fileId));

    assert.equal(Number(afterChunks.cnt), Number(beforeChunks.cnt), 'Chunk count must remain exact without duplicates');
    assert.equal(Number(afterEmbeds.cnt), Number(beforeEmbeds.cnt), 'Embedding count must remain exact without duplicates');
    assert.equal(Number(afterItems.cnt), Number(beforeItems.cnt), 'Extracted items count must remain exact without duplicates');
  });

  await t.test('Case 6: Deleting a file removes all chunks, embeddings, extracted items, and topic mappings', async () => {
    await db.run(`DELETE FROM files WHERE id = ?`, fileId);
    await cleanupDeletedDocument(db, fileId);

    const tablesToCheck = [
      ['document_pages', 'file_id'],
      ['document_chunks', 'file_id'],
      ['document_embeddings', 'file_id'],
      ['document_topic_metadata', 'file_id'],
      ['academic_extracted_items', 'file_id'],
      ['topic_source_mappings', 'file_id'],
      ['academic_knowledge_graph', 'file_id'],
      ['document_extraction_jobs', 'file_id'],
      ['document_index_versions', 'file_id'],
      ['note_search_documents', 'id']
    ];

    for (const [tbl, col] of tablesToCheck) {
      const row = await db.get(`SELECT COUNT(*) AS cnt FROM ${tbl} WHERE CAST(${col} AS TEXT) = ?`, String(fileId));
      assert.equal(Number(row.cnt), 0, `Table ${tbl} must have 0 records for deleted file ${fileId}`);
    }
  });
});

test('Phase 3 Stage 1 — Task 2: Chapter Tutor Authorization Hardening (Cases 7–11)', async (t) => {
  const db = await createTestDb();

  // Seed files across different cohorts, semesters, and subjects:
  // File 1: Semester 2, Cohort 101, Web Technology I Unit 3
  const f1Ins = await db.run(
    `INSERT INTO files (storedName, originalName, title, semester, semester_no, subject, chapter, unit_number, resource_category, uploadedBy, sizeBytes, uploadedAt, cohort_id, audience_scope, visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'c101-web.txt', 'c101-web.txt', 'Cohort 101 Web Tech Notes', 'Semester 2', 2, 'Web Technology I', 'Unit 3: Introducing Cascading Style Sheet', 3, 'notes', 'T01', 300, new Date().toISOString(), '101', 'cohort', 'cohort_only'
  );
  const fileCohort101Id = Number(f1Ins.lastInsertRowid);
  await ingestAcademicDocument(db, {
    id: fileCohort101Id, storedName: 'c101-web.txt', originalName: 'c101-web.txt', title: 'Cohort 101 Web Tech Notes',
    semester: 'Semester 2', semester_no: 2, subject: 'Web Technology I', chapter: 'Unit 3: Introducing Cascading Style Sheet',
    unit_number: 3, resource_category: 'notes', cohort_id: '101', audience_scope: 'cohort', visibility: 'cohort_only'
  }, { buffer: Buffer.from('## Style classes\nCohort 101 exclusive secret selector notes.') });

  // File 2: Semester 2, Cohort 202, Web Technology I Unit 3
  const f2Ins = await db.run(
    `INSERT INTO files (storedName, originalName, title, semester, semester_no, subject, chapter, unit_number, resource_category, uploadedBy, sizeBytes, uploadedAt, cohort_id, audience_scope, visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'c202-web.txt', 'c202-web.txt', 'Cohort 202 Web Tech Notes', 'Semester 2', 2, 'Web Technology I', 'Unit 3: Introducing Cascading Style Sheet', 3, 'notes', 'T01', 300, new Date().toISOString(), '202', 'cohort', 'cohort_only'
  );
  const fileCohort202Id = Number(f2Ins.lastInsertRowid);
  await ingestAcademicDocument(db, {
    id: fileCohort202Id, storedName: 'c202-web.txt', originalName: 'c202-web.txt', title: 'Cohort 202 Web Tech Notes',
    semester: 'Semester 2', semester_no: 2, subject: 'Web Technology I', chapter: 'Unit 3: Introducing Cascading Style Sheet',
    unit_number: 3, resource_category: 'notes', cohort_id: '202', audience_scope: 'cohort', visibility: 'cohort_only'
  }, { buffer: Buffer.from('## Style classes\nCohort 202 confidential stylesheet lecture.') });

  // File 3: Semester 3 restricted file (DSA Unit 1, cohort-scoped / teachers_only)
  const f3Ins = await db.run(
    `INSERT INTO files (storedName, originalName, title, semester, semester_no, subject, chapter, unit_number, resource_category, uploadedBy, sizeBytes, uploadedAt, cohort_id, audience_scope, visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'sem3-restricted.txt', 'sem3-restricted.txt', 'Semester 3 Restricted DSA Notes', 'Semester 3', 3, 'Data Structure and Algorithms', 'Unit 1: Introduction to Data Structure', 1, 'notes', 'T02', 300, new Date().toISOString(), '303', 'cohort', 'everyone'
  );
  const fileSem3RestrictedId = Number(f3Ins.lastInsertRowid);
  await ingestAcademicDocument(db, {
    id: fileSem3RestrictedId, storedName: 'sem3-restricted.txt', originalName: 'sem3-restricted.txt', title: 'Semester 3 Restricted DSA Notes',
    semester: 'Semester 3', semester_no: 3, subject: 'Data Structure and Algorithms', chapter: 'Unit 1: Introduction to Data Structure',
    unit_number: 1, resource_category: 'notes', cohort_id: '303', audience_scope: 'cohort', visibility: 'everyone'
  }, { buffer: Buffer.from('## Abstract Data Type\nSemester 3 restricted cohort 303 content.') });

  const studentCohort101Ctx = {
    authenticated: true,
    role: 'student',
    studentId: 'STU_101',
    currentSemester: 2,
    semester: 'Semester 2',
    cohortId: '101',
    cohort: { id: '101', currentSemester: 2, status: 'active' }
  };

  await t.test('Case 7: Authorized student can load their own cohort/semester chapter bundle', async () => {
    const bundle = await getChapterReaderBundle(db, {
      subject: 'Web Technology I',
      semesterNo: 2,
      unitNumber: 3,
      chapterTitle: 'Unit 3: Introducing Cascading Style Sheet',
      academicContext: studentCohort101Ctx
    });
    assert.equal(bundle.files.length, 1);
    assert.equal(bundle.files[0].id, fileCohort101Id);
    assert.equal(bundle.files[0].title, 'Cohort 101 Web Tech Notes');
  });

  await t.test("Case 8: Student cannot access another cohort's chapter files", async () => {
    const bundle = await getChapterReaderBundle(db, {
      subject: 'Web Technology I',
      semesterNo: 2,
      unitNumber: 3,
      chapterTitle: 'Unit 3: Introducing Cascading Style Sheet',
      fileIds: [fileCohort202Id],
      academicContext: studentCohort101Ctx
    });
    assert.equal(bundle.files.length, 0, 'Cohort 101 student must not receive Cohort 202 chapter file');
  });

  await t.test("Case 9: Student cannot access another semester's restricted files", async () => {
    const bundle = await getChapterReaderBundle(db, {
      subject: 'Data Structure and Algorithms',
      semesterNo: 3,
      unitNumber: 1,
      chapterTitle: 'Unit 1: Introduction to Data Structure',
      academicContext: studentCohort101Ctx
    });
    assert.equal(bundle.files.length, 0, 'Semester 2 student must not access Semester 3 restricted files');
  });

  await t.test('Case 10: Forged frontend fileIds cannot bypass subject, cohort, or semester authorization', async () => {
    const bundle = await getChapterReaderBundle(db, {
      subject: 'Web Technology I',
      semesterNo: 2,
      unitNumber: 3,
      chapterTitle: 'Unit 3: Introducing Cascading Style Sheet',
      fileIds: [fileCohort101Id, fileCohort202Id, fileSem3RestrictedId],
      academicContext: studentCohort101Ctx
    });
    assert.deepEqual(
      bundle.files.map((f) => f.id),
      [fileCohort101Id],
      'Forged fileIds from Cohort 202 and Semester 3 DSA must be stripped out'
    );
  });

  await t.test('Case 11: Academic context resolution failure (null or dbError or unauthenticated) fails closed', async () => {
    await assert.rejects(
      async () => {
        await getChapterReaderBundle(db, {
          subject: 'Web Technology I',
          semesterNo: 2,
          unitNumber: 3,
          fileIds: [fileCohort101Id],
          academicContext: null
        });
      },
      (err) => err.status === 503 && /Academic authorization context unavailable/i.test(err.message),
      'Passing academicContext: null must fail closed with status 503'
    );

    await assert.rejects(
      async () => {
        await getChapterReaderBundle(db, {
          subject: 'Web Technology I',
          semesterNo: 2,
          unitNumber: 3,
          fileIds: [fileCohort101Id],
          academicContext: { authenticated: false, role: 'anonymous', dbError: true }
        });
      },
      (err) => err.status === 503,
      'Passing academicContext with dbError: true must fail closed with status 503'
    );

    await assert.rejects(
      async () => {
        await answerWithChapterContext(db, {
          message: 'Explain style classes',
          chapterContext: {
            subject: 'Web Technology I',
            semesterNo: 2,
            unitNumber: 3,
            fileIds: [fileCohort101Id]
          },
          academicContext: { authenticated: false, role: 'anonymous' }
        });
      },
      (err) => err.status === 403,
      'Unauthenticated context in answerWithChapterContext must fail closed with status 403'
    );
  });
});

test('Phase 3 Stage 1 — Task 3: Study Partner Retrieval Authorization Hardening (Cases 12–14)', async (t) => {
  const db = await createTestDb();

  // Upload Cohort 101 note, Cohort 202 note, and a deleted note in Web Technology I (Sem 2),
  // plus a Semester 3 DSA note
  const f101 = await db.run(
    `INSERT INTO files (storedName, originalName, title, semester, semester_no, subject, chapter, unit_number, resource_category, uploadedBy, sizeBytes, uploadedAt, cohort_id, audience_scope, visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'sp-c101.txt', 'sp-c101.txt', 'SP Cohort 101 CSS Note.pdf', 'Semester 2', 2, 'Web Technology I', 'Unit 3: Introducing Cascading Style Sheet', 3, 'notes', 'T01', 400, new Date().toISOString(), '101', 'cohort', 'everyone'
  );
  const f101Id = Number(f101.lastInsertRowid);
  await ingestAcademicDocument(db, {
    id: f101Id, storedName: 'sp-c101.txt', originalName: 'sp-c101.txt', title: 'SP Cohort 101 CSS Note.pdf',
    semester: 'Semester 2', semester_no: 2, subject: 'Web Technology I', chapter: 'Unit 3: Introducing Cascading Style Sheet',
    unit_number: 3, resource_category: 'notes', cohort_id: '101', audience_scope: 'cohort', visibility: 'everyone'
  }, { buffer: Buffer.from('## Style classes\nCohort101Selector: A class selector written for Cohort 101 students.') });

  const f202 = await db.run(
    `INSERT INTO files (storedName, originalName, title, semester, semester_no, subject, chapter, unit_number, resource_category, uploadedBy, sizeBytes, uploadedAt, cohort_id, audience_scope, visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'sp-c202.txt', 'sp-c202.txt', 'SP Cohort 202 Secret Note.pdf', 'Semester 2', 2, 'Web Technology I', 'Unit 3: Introducing Cascading Style Sheet', 3, 'notes', 'T02', 400, new Date().toISOString(), '202', 'cohort', 'everyone'
  );
  const f202Id = Number(f202.lastInsertRowid);
  await ingestAcademicDocument(db, {
    id: f202Id, storedName: 'sp-c202.txt', originalName: 'sp-c202.txt', title: 'SP Cohort 202 Secret Note.pdf',
    semester: 'Semester 2', semester_no: 2, subject: 'Web Technology I', chapter: 'Unit 3: Introducing Cascading Style Sheet',
    unit_number: 3, resource_category: 'notes', cohort_id: '202', audience_scope: 'cohort', visibility: 'everyone'
  }, { buffer: Buffer.from('## Style classes\nCohort202SecretDefinition: Exclusive definition only for Cohort 202.') });

  const fDeleted = await db.run(
    `INSERT INTO files (storedName, originalName, title, semester, semester_no, subject, chapter, unit_number, resource_category, uploadedBy, sizeBytes, uploadedAt, cohort_id, audience_scope, visibility, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'sp-deleted.txt', 'sp-deleted.txt', 'Soft Deleted CSS Note.pdf', 'Semester 2', 2, 'Web Technology I', 'Unit 3: Introducing Cascading Style Sheet', 3, 'notes', 'T01', 400, new Date().toISOString(), null, 'all_students', 'everyone', new Date().toISOString()
  );
  const fDeletedId = Number(fDeleted.lastInsertRowid);
  await ingestAcademicDocument(db, {
    id: fDeletedId, storedName: 'sp-deleted.txt', originalName: 'sp-deleted.txt', title: 'Soft Deleted CSS Note.pdf',
    semester: 'Semester 2', semester_no: 2, subject: 'Web Technology I', chapter: 'Unit 3: Introducing Cascading Style Sheet',
    unit_number: 3, resource_category: 'notes', cohort_id: null, audience_scope: 'all_students', visibility: 'everyone', deleted_at: new Date().toISOString()
  }, { buffer: Buffer.from('## Style classes\nDeletedNoteDefinition: Should never be retrieved because deleted_at is set.') });

  await t.test('Case 12 & 14: Study Partner only retrieves authorized notes for student cohort and excludes soft-deleted/hidden notes', async () => {
    const student101Ctx = {
      authenticated: true,
      role: 'student',
      studentId: 'STU_101',
      currentSemester: 2,
      semester: 'Semester 2',
      cohortId: '101',
      cohort: { id: '101', currentSemester: 2, status: 'active' }
    };

    const sessRes = await startOrResumeStudySession(db, {
      studentId: 'STU_101',
      conversationId: 'conv_sp_auth_101',
      subject: 'Web Technology I',
      semesterNo: 2,
      unitNumber: 3,
      academicContext: student101Ctx
    });
    const styleClassesStep = sessRes.topics.find((tp) => /^Style classes$/i.test(tp.topicTitle));
    assert.ok(styleClassesStep);

    const bundle = await buildCompiledTopicLessonBundle(db, {
      session: sessRes.session,
      step: styleClassesStep,
      academicContext: student101Ctx
    });

    const defTitles = bundle.definitions.map((d) => `${d.fileTitle} ${d.content}`);
    assert.ok(defTitles.some((s) => /SP Cohort 101 CSS Note\.pdf/i.test(s)), 'Must include Cohort 101 definition');
    assert.ok(!defTitles.some((s) => /Cohort 202 Secret/i.test(s)), 'Must NOT leak Cohort 202 definition');
    assert.ok(!defTitles.some((s) => /Soft Deleted CSS Note/i.test(s)), 'Must NOT leak soft-deleted note definition');

    // Also test full ai-assistant handleChat study_partner path for resourceCards isolation
    const chatRes = await handleChat({
      db,
      studentInfo: { studentId: 'STU_101', role: 'student', semester: 'Semester 2' },
      academicContext: student101Ctx,
      sessionId: 'conv_sp_chat_101',
      message: 'Teach me Unit 3 of Web Technology I step by step'
    });
    assert.equal(chatRes.intent, 'study_partner');
    const cardIds = (chatRes.resourceCards || []).map((c) => Number(c.id));
    assert.ok(cardIds.includes(f101Id), 'Resource cards must include authorized Cohort 101 note');
    assert.ok(!cardIds.includes(f202Id), 'Resource cards must NOT include Cohort 202 note');
    assert.ok(!cardIds.includes(fDeletedId), 'Resource cards must NOT include soft-deleted note');
  });

  await t.test('Case 13: Teacher Study Partner retrieval respects assigned subjects and semesters', async () => {
    // Teacher assigned ONLY to Semester 3 Data Structure and Algorithms (NOT Semester 2 Web Technology I)
    const unassignedTeacherCtx = {
      authenticated: true,
      role: 'teacher',
      studentId: 'TEACH_DSA_ONLY',
      assignedSemesters: [3],
      assignedSubjects: [{ code: 'CIT214', name: 'Data Structure and Algorithms' }]
    };

    const mapForUnassignedTeacher = await getCourseMap(db, {
      subject: 'Web Technology I',
      semesterNo: 2,
      unitNumber: 3,
      academicContext: unassignedTeacherCtx
    });
    const styleTopic = mapForUnassignedTeacher.units[0].topics.find((tp) => /^Style classes$/i.test(tp.topicTitle));
    const noteMappings = styleTopic.mappings.filter((m) => m.sourceType !== 'model_questions');
    assert.equal(noteMappings.length, 0, 'Teacher not assigned to Web Technology I (Sem 2) must not retrieve its note mappings');

    const chatRes = await handleChat({
      db,
      studentInfo: { studentId: 'TEACH_DSA_ONLY', role: 'teacher' },
      academicContext: unassignedTeacherCtx,
      sessionId: 'conv_sp_teacher_dsa',
      message: 'Teach me Unit 3 of Web Technology I step by step'
    });
    assert.equal(chatRes.intent, 'study_partner');
    assert.equal((chatRes.resourceCards || []).length, 0, 'Unassigned teacher must receive 0 resourceCards for Web Technology I');
  });
});
