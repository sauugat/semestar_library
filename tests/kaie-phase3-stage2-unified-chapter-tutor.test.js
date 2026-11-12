'use strict';

/**
 * Kyana Phase 3 — Stage 2 Regression Test Suite:
 * Unified Chapter Tutor (Hybrid RAG + PYQ Intelligence + Row-Level Cache Digest)
 *
 * Covers all 21 mandatory Stage 2 test scenarios:
 * - Active chapter retrieval (1–3)
 * - Cross-chapter same-subject prerequisite retrieval & subject/irrelevance isolation (4–7)
 * - PYQ integration, analytics, weak-match rejection, and no-PYQ graceful handling (8–12)
 * - Authorization & row-level cache invalidation across cohorts, semesters, forged fileIds, and multi-hop (13–17)
 * - Context deduplication, token budgeting, source vs. model distinction, and adaptive presentation preservation (18–21)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

const { ensureRagSchema } = require('../lib/rag-schema');
const { ingestAcademicDocument } = require('../lib/document-ingestion');
const { ingestPyqPaper } = require('../lib/pyq-intelligence');
const {
  getOrLoadIndexedCorpus,
  retrieveAcademicEvidence
} = require('../lib/hybrid-rag-engine');
const {
  getChapterReaderBundle,
  answerWithChapterContext
} = require('../lib/chapter-tutor-engine');
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
    },
    close() {
      try {
        client.close();
      } catch (_) {}
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

async function seedTestFile(db, meta, rawText) {
  const storedName = meta.storedName || `stored_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.txt`;
  const originalName = meta.originalName || `${meta.title}.txt`;
  const semesterStr = meta.semester || `Semester ${meta.semesterNo || 2}`;
  const semNo = meta.semesterNo || 2;
  const cohortId = meta.cohortId !== undefined && meta.cohortId !== null ? String(meta.cohortId) : null;
  const audienceScope = meta.audienceScope || (cohortId ? 'cohort' : 'all_students');
  const visibility = meta.visibility || 'everyone';

  const info = await db.run(
    `INSERT INTO files (
      originalName, storedName, title, subject, semester, semester_no,
      chapter, unit_number, resource_category, cohort_id, audience_scope,
      visibility, uploadedBy, sizeBytes, uploadedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    originalName,
    storedName,
    meta.title,
    meta.subject,
    semesterStr,
    semNo,
    meta.chapter,
    meta.unitNumber || 1,
    meta.resourceCategory || 'notes',
    cohortId,
    audienceScope,
    visibility,
    meta.uploadedBy || 'teacher1',
    Buffer.byteLength(rawText),
    new Date().toISOString()
  );
  const fileId = Number(info.lastInsertRowid);

  await ingestAcademicDocument(
    db,
    {
      id: fileId,
      title: meta.title,
      originalName,
      storedName,
      subject: meta.subject,
      subjectCode: meta.subjectCode || null,
      semester: semesterStr,
      semester_no: semNo,
      chapter: meta.chapter,
      unit_number: meta.unitNumber || 1,
      resource_category: meta.resourceCategory || 'notes',
      cohort_id: cohortId,
      audience_scope: audienceScope,
      visibility,
      uploadedBy: meta.uploadedBy || 'teacher1'
    },
    { buffer: Buffer.from(rawText) }
  );

  return fileId;
}

const studentSem2Cohort1 = {
  authenticated: true,
  role: 'student',
  studentId: 'stu_sem2_c1',
  username: 'stu_sem2_c1',
  currentSemester: 2,
  semester: 'Semester 2',
  semesterNo: 2,
  cohortId: '1',
  cohort: { id: '1', currentSemester: 2, status: 'active' }
};

test('Scenarios 1, 2 & 3: Active chapter retrieval answers from active chapter PDF, preserves page/file citations, and ranks active chapter above other chapters', async () => {
  const db = await createTestDb();
  try {
    await seedTestFile(
      db,
      {
        title: 'DSA Lecture 1 — Introduction & Overview',
        subject: 'Data Structures and Algorithms',
        subjectCode: 'CIT122',
        semesterNo: 2,
        chapter: 'Unit 1: Introduction to Data Structures',
        unitNumber: 1
      },
      `# Overview of Non-Linear Structures\nA Binary Search Tree (BST) is one example of a hierarchical tree structure studied later in Unit 4.`
    );

    const activeFileId = await seedTestFile(
      db,
      {
        title: 'DSA Lecture 4 — Binary Search Trees Deep Dive',
        subject: 'Data Structures and Algorithms',
        subjectCode: 'CIT122',
        semesterNo: 2,
        chapter: 'Unit 4: Trees and Binary Search Trees',
        unitNumber: 4
      },
      `# Binary Search Tree (BST) Properties and Insertion\nDefinition: A Binary Search Tree (BST) is a node-based binary tree where every node in the left subtree has a key strictly less than the parent key, and every node in the right subtree has a key strictly greater than the parent key.\n\nTime Complexity: Search and insertion in a balanced Binary Search Tree run in O(log n) average time.`
    );

    const res = await answerWithChapterContext(db, {
      message: 'Explain Binary Search Tree properties and insertion complexity',
      chapterContext: {
        subject: 'Data Structures and Algorithms',
        subjectCode: 'CIT122',
        semesterNo: 2,
        unitNumber: 4,
        chapterTitle: 'Unit 4: Trees and Binary Search Trees',
        fileIds: [activeFileId]
      },
      academicContext: studentSem2Cohort1
    });

    // Scenario 1: Answered from active chapter PDF
    assert.equal(res.foundInChapterFiles, true);
    assert.match(res.reply, /Binary Search Tree/i);
    assert.match(res.reply, /left subtree/i);

    // Scenario 2: Preserves exact file and page citation
    assert.ok(res.citations.length > 0);
    assert.equal(res.citations[0].fileId, activeFileId);
    assert.equal(res.citations[0].fileTitle, 'DSA Lecture 4 — Binary Search Trees Deep Dive');
    assert.equal(res.citations[0].pageStart, 1);
    assert.equal(res.citations[0].evidenceOrigin, 'active_chapter');
    assert.match(res.reply, /DSA Lecture 4 — Binary Search Trees Deep Dive, Page 1/);

    // Scenario 3: Active chapter evidence ranks first with highest priority
    const firstActive = res.evidenceContext.activeChapterEvidence[0];
    assert.ok(firstActive);
    assert.equal(firstActive.fileId, activeFileId);
    assert.equal(firstActive.evidenceOrigin, 'active_chapter');
    for (const sup of res.evidenceContext.sameSubjectSupplementaryEvidence) {
      assert.ok(firstActive.relevanceScore >= sup.relevanceScore, 'Active chapter must rank above other chapters');
    }
  } finally {
    db.close();
  }
});

test('Scenarios 4, 5, 6 & 7: Cross-chapter prerequisite retrieval pulls from earlier chapter of SAME subject, marks prerequisite source chapter, excludes unrelated chapters, and never pulls from another subject', async () => {
  const db = await createTestDb();
  try {
    // Chapter 2 (Prerequisite in same subject): Recursion & Call Stack
    const ch2FileId = await seedTestFile(
      db,
      {
        title: 'DSA Unit 2 — Recursion and Stack Frames',
        subject: 'Data Structures and Algorithms',
        subjectCode: 'CIT122',
        semesterNo: 2,
        chapter: 'Unit 2: Stacks, Queues and Recursion',
        unitNumber: 2
      },
      `# Recursion Fundamentals\nDefinition: Recursion is a problem-solving technique where a function calls itself with a smaller input until it reaches a terminating base case. Every recursive call pushes an activation frame onto the system call stack.`
    );

    // Chapter 6 (Unrelated chapter in same subject): Hashing and Collision Resolution
    const unrelatedSameSubjectFileId = await seedTestFile(
      db,
      {
        title: 'DSA Unit 6 — Hashing and Linear Probing',
        subject: 'Data Structures and Algorithms',
        subjectCode: 'CIT122',
        semesterNo: 2,
        chapter: 'Unit 6: Hashing',
        unitNumber: 6
      },
      `# Hash Tables and Collision Resolution\nLinear probing resolves hash collisions by searching sequentially for the next empty bucket in the hash table.`
    );

    // Another Subject entirely (Operating Systems) that also mentions recursion/processes
    const otherSubjectFileId = await seedTestFile(
      db,
      {
        title: 'Operating Systems — Process Forking and Recursion',
        subject: 'Operating Systems',
        subjectCode: 'CIT204',
        semesterNo: 2,
        chapter: 'Unit 1: Process Management',
        unitNumber: 1
      },
      `# Operating Systems Process Tree and Recursion\nIn Operating Systems, recursive fork calls create a hierarchy of child processes managed by the kernel scheduler.`
    );

    // Active Chapter (Unit 4): Binary Tree Traversal
    const activeCh4FileId = await seedTestFile(
      db,
      {
        title: 'DSA Unit 4 — Binary Tree Traversals',
        subject: 'Data Structures and Algorithms',
        subjectCode: 'CIT122',
        semesterNo: 2,
        chapter: 'Unit 4: Trees',
        unitNumber: 4
      },
      `# Inorder, Preorder and Postorder Tree Traversal\nInorder traversal visits the left subtree first, then the root node, and finally the right subtree.`
    );

    const res = await answerWithChapterContext(db, {
      message: 'How does recursion and the base case work when doing inorder binary tree traversal?',
      chapterContext: {
        subject: 'Data Structures and Algorithms',
        subjectCode: 'CIT122',
        semesterNo: 2,
        unitNumber: 4,
        chapterTitle: 'Unit 4: Trees',
        fileIds: [activeCh4FileId]
      },
      academicContext: studentSem2Cohort1
    });

    // Scenario 4: Retrieves prerequisite concept (recursion) from Unit 2 of the same subject
    assert.equal(res.foundInChapterFiles, true);
    assert.equal(res.foundInSameSubjectPrerequisites, true);
    const prereqIds = res.evidenceContext.sameSubjectSupplementaryEvidence.map((p) => p.fileId);
    assert.ok(prereqIds.includes(ch2FileId), 'Should retrieve recursion prerequisite from Unit 2 of same subject');

    // Scenario 5: Clearly marks prerequisite source chapter in both structured evidence and reply
    const prereqItem = res.evidenceContext.sameSubjectSupplementaryEvidence.find((p) => p.fileId === ch2FileId);
    assert.equal(prereqItem.evidenceOrigin, 'same_subject_prerequisite');
    assert.match(prereqItem.chapter, /Unit 2: Stacks, Queues and Recursion/i);
    assert.match(res.reply, /Prerequisite \/ Supporting Concept from Earlier Chapter/i);
    assert.match(res.reply, /DSA Unit 2 — Recursion and Stack Frames/i);

    // Scenario 6: Unrelated chapter of the same subject (Unit 6: Hashing) is NOT included
    assert.ok(!prereqIds.includes(unrelatedSameSubjectFileId), 'Unrelated chapter (Hashing) must not be included');

    // Scenario 7: Material from another subject (Operating Systems) is NEVER pulled into same-subject prerequisite retrieval
    assert.ok(!prereqIds.includes(otherSubjectFileId), 'Material from another subject must never be pulled');
  } finally {
    db.close();
  }
});

test('Scenarios 8, 9, 10, 11 & 12: PYQ intelligence returns actual PYQs with year/marks/text, computes accurate repetition analytics, rejects weak matches, and handles chapters with no PYQs honestly', async () => {
  const db = await createTestDb();
  try {
    const activeFileId = await seedTestFile(
      db,
      {
        title: 'Discrete Math Unit 1 — Propositional Logic & Equivalences',
        subject: 'Discrete Mathematics',
        subjectCode: 'CIT121',
        semesterNo: 2,
        chapter: 'Unit 1: Logic and Induction',
        unitNumber: 1
      },
      `# Tautology, Contradiction and Mathematical Induction\nDefinition: A tautology is a compound proposition that is always true regardless of the truth values of its atomic propositions.`
    );

    // Ingest 2 past papers (2079 BS and 2080 BS) where Mathematical Induction and Tautology appear repeatedly
    await ingestPyqPaper(db, {
      subject: 'Discrete Mathematics',
      subjectCode: 'CIT121',
      semesterNo: 2,
      examYear: '2079 BS',
      examType: 'Final Exam',
      unitNumber: 1,
      chapterTitle: 'Unit 1: Logic and Induction',
      rawText: `
        Group A
        1. Define tautology and contradiction with truth table examples. [5]
        2. State and prove mathematical induction for the sum of first n natural numbers. [10]
      `
    });

    await ingestPyqPaper(db, {
      subject: 'Discrete Mathematics',
      subjectCode: 'CIT121',
      semesterNo: 2,
      examYear: '2080 BS',
      examType: 'Final Exam',
      unitNumber: 1,
      chapterTitle: 'Unit 1: Logic and Induction',
      rawText: `
        Group A
        1. Define tautology and logical equivalence without using truth tables. [5]
        2. Prove by mathematical induction that 1 + 3 + 5 + ... + (2n-1) = n^2. [10]
      `
    });

    // Scenario 8 & 9: Chapter Tutor returns actual PYQs with exam year, marks, and question text
    const pyqRes = await answerWithChapterContext(db, {
      message: 'What questions are important for this chapter? Show previous-year questions.',
      chapterContext: {
        subject: 'Discrete Mathematics',
        subjectCode: 'CIT121',
        semesterNo: 2,
        unitNumber: 1,
        chapterTitle: 'Unit 1: Logic and Induction',
        fileIds: [activeFileId]
      },
      academicContext: studentSem2Cohort1
    });

    assert.equal(pyqRes.foundPyqQuestions, true);
    assert.ok(pyqRes.pyqIntelligence.questions.length >= 2);
    assert.match(pyqRes.reply, /2080 BS/);
    assert.match(pyqRes.reply, /2079 BS/);
    assert.match(pyqRes.reply, /Marks/);
    assert.match(pyqRes.reply, /tautology/i);

    // Scenario 10: Repeated PYQ topics are identified accurately from stored PYQs
    assert.equal(pyqRes.pyqIntelligence.analytics.timesAsked, 4);
    assert.equal(pyqRes.pyqIntelligence.analytics.distinctYearsCount, 2);
    assert.deepEqual(pyqRes.pyqIntelligence.analytics.examYears, ['2080 BS', '2079 BS']);
    assert.ok(
      pyqRes.pyqIntelligence.analytics.repeatedTopics.some((rt) => rt.isRepeated && rt.timesAsked >= 2),
      'Should identify repeated topics asked across 2079 BS and 2080 BS'
    );

    // Scenario 11: Weak PYQ topic matches are not presented as confirmed matches
    const weakMatchRes = await answerWithChapterContext(db, {
      message: 'Show previous-year questions from Dijkstra shortest path algorithm',
      chapterContext: {
        subject: 'Discrete Mathematics',
        subjectCode: 'CIT121',
        semesterNo: 2,
        unitNumber: 1,
        chapterTitle: 'Unit 1: Logic and Induction',
        fileIds: [activeFileId]
      },
      academicContext: studentSem2Cohort1
    });
    assert.equal(weakMatchRes.foundPyqQuestions, false, 'Unrelated/weak topic must not return Unit 1 logic PYQs as confirmed matches');

    // Scenario 12: When no PYQs exist for a chapter/subject, Kyana states this clearly instead of inventing past questions
    const noPyqRes = await answerWithChapterContext(db, {
      message: 'Show previous-year questions from this chapter',
      chapterContext: {
        subject: 'Web Technology I',
        subjectCode: 'CIT202',
        semesterNo: 2,
        unitNumber: 3,
        chapterTitle: 'Unit 3: CSS Flexbox and Grid',
        fileIds: []
      },
      academicContext: studentSem2Cohort1
    });
    assert.equal(noPyqRes.foundPyqQuestions, false);
    assert.match(noPyqRes.reply, /No verified past exam papers \(PYQs\) are currently indexed/i);
    assert.match(noPyqRes.reply, /AI-Generated Practice Questions/i);
  } finally {
    db.close();
  }
});

test('Scenarios 13, 14, 15, 16 & 17: Authorization enforcement (cohort, cross-semester, forged fileIds, multi-hop/rerank) and row-level cache digest invalidation', async () => {
  const db = await createTestDb();
  try {
    // File 1: Authorized for Cohort 1, Semester 2 (Unit 4 Active Chapter)
    const activeCohort1FileId = await seedTestFile(
      db,
      {
        title: 'B-Note: JS Functions (Cohort 1)',
        subject: 'Web Technology I',
        subjectCode: 'CIT202',
        semesterNo: 2,
        chapter: 'Unit 4: JavaScript Functions',
        unitNumber: 4,
        cohortId: '1',
        audienceScope: 'cohort',
        visibility: 'cohort_only'
      },
      `# JavaScript Functions and Closures\nA JavaScript function is a reusable block of code designed to perform a particular task.`
    );

    // File 2: Restricted to Cohort 2 ONLY (same subject, Prerequisite Unit 3)
    const restrictedCohort2FileId = await seedTestFile(
      db,
      {
        title: 'M-Note: Secret Cohort 2 JS Variables & Scope',
        subject: 'Web Technology I',
        subjectCode: 'CIT202',
        semesterNo: 2,
        chapter: 'Unit 3: JavaScript Variables and Scope',
        unitNumber: 3,
        cohortId: '2',
        audienceScope: 'cohort',
        visibility: 'cohort_only'
      },
      `# JavaScript Variables, Let, Const and Lexical Scope\nCohort 2 exclusive explanation of var, let, const and lexical variable scope in JavaScript.`
    );

    // File 3: Cross-semester file (Semester 5) that mentions JavaScript variables
    const crossSemesterFileId = await seedTestFile(
      db,
      {
        title: 'Z-Note: Advanced Semester 5 JS Engine Internals',
        subject: 'Web Technology I',
        subjectCode: 'CIT202',
        semesterNo: 5,
        chapter: 'Unit 3: JavaScript Variables and Scope',
        unitNumber: 3,
        cohortId: null,
        audienceScope: 'all_students',
        visibility: 'everyone'
      },
      `# Semester 5 V8 Variable Scope Internals\nInternal hidden classes and variable scope allocation in Semester 5.`
    );

    // Scenario 13 & 14: Cohort-restricted notes from Cohort 2 and cross-semester notes from Semester 5 are NEVER retrieved for Cohort 1 Sem 2 student
    const res = await answerWithChapterContext(db, {
      message: 'How do JavaScript variables and lexical scope work inside functions?',
      chapterContext: {
        subject: 'Web Technology I',
        subjectCode: 'CIT202',
        semesterNo: 2,
        unitNumber: 4,
        chapterTitle: 'Unit 4: JavaScript Functions',
        fileIds: [activeCohort1FileId]
      },
      academicContext: studentSem2Cohort1
    });

    const allCitedFileIds = res.citations.map((c) => Number(c.fileId));
    assert.ok(!allCitedFileIds.includes(restrictedCohort2FileId), 'Scenario 13: Cohort 2 restricted file must never be retrieved for Cohort 1 student');
    assert.ok(!allCitedFileIds.includes(crossSemesterFileId), 'Scenario 14: Semester 5 file must never be retrieved during Semester 2 prerequisite lookup');
    assert.doesNotMatch(res.reply, /Cohort 2 exclusive/i);
    assert.doesNotMatch(res.reply, /Semester 5 V8/i);

    // Scenario 15: Forged fileIds in chapterContext cannot inject unauthorized Cohort 2 or cross-semester documents
    const forgedBundle = await getChapterReaderBundle(db, {
      subject: 'Web Technology I',
      subjectCode: 'CIT202',
      semesterNo: 2,
      unitNumber: 4,
      chapterTitle: 'Unit 4: JavaScript Functions',
      fileIds: [activeCohort1FileId, restrictedCohort2FileId, crossSemesterFileId],
      academicContext: studentSem2Cohort1
    });
    assert.deepEqual(
      forgedBundle.files.map((f) => f.id),
      [activeCohort1FileId],
      'Scenario 15: Forged fileIds must be stripped before building chapter bundle'
    );

    // Scenario 16: Multi-hop Hybrid RAG query never leaks unauthorized chunks into reranked or multi-hop results
    const multiHopRag = await retrieveAcademicEvidence(db, {
      query: 'Compare JavaScript Functions and JavaScript Variables and Scope',
      user: studentSem2Cohort1,
      subject: 'Web Technology I',
      semester: 2
    });
    const ragFileIds = multiHopRag.passages.map((p) => Number(p.fileId));
    assert.ok(!ragFileIds.includes(restrictedCohort2FileId), 'Scenario 16: Unauthorized Cohort 2 chunk must never appear in multi-hop RAG');
    assert.ok(!ragFileIds.includes(crossSemesterFileId), 'Scenario 16: Unauthorized Semester 5 chunk must never appear in multi-hop RAG');

    // Scenario 17: Direct row edit to a NON-MAXIMAL row (`M-Note` when `Z-Note` is MAX(title)) immediately invalidates `getOrLoadIndexedCorpus`
    const corpusBefore = await getOrLoadIndexedCorpus(db, { subject: 'Web Technology I' });
    const corpusCached = await getOrLoadIndexedCorpus(db, { subject: 'Web Technology I' });
    assert.equal(corpusCached.cacheHit, true);

    // Edit the middle row (`restrictedCohort2FileId`, whose title 'M-Note...' is alphabetically below 'Z-Note...')
    // without calling invalidateRagCorpusCache(db)
    await db.run(
      `UPDATE files SET cohort_id = '1', title = 'M-Note: Updated Cohort 1 JS Variables & Scope' WHERE id = ?`,
      restrictedCohort2FileId
    );

    const corpusAfterEdit = await getOrLoadIndexedCorpus(db, { subject: 'Web Technology I' });
    assert.equal(corpusAfterEdit.cacheHit, false, 'Scenario 17: Editing a non-maximal file row must invalidate getOrLoadIndexedCorpus cache digest');
    assert.notEqual(corpusBefore.versionSig, corpusAfterEdit.versionSig);
  } finally {
    db.close();
  }
});

test('Scenarios 18, 19, 20 & 21: Duplicate chunk deduplication, token budget enforcement, source vs. model distinction, and Adaptive Presentation Engine preservation', async () => {
  const db = await createTestDb();
  try {
    const dupText = `Definition: Normalization in Database Management Systems is the systematic process of organizing relational tables to minimize data redundancy and eliminate insertion, update, and deletion anomalies.`;

    const file1Id = await seedTestFile(
      db,
      {
        title: 'DBMS Note 1 — Normalization Basics',
        subject: 'Database Management System',
        subjectCode: 'CIT203',
        semesterNo: 3,
        chapter: 'Unit 4: Normalization',
        unitNumber: 4
      },
      `# Database Normalization\n${dupText}`
    );

    const file2Id = await seedTestFile(
      db,
      {
        title: 'DBMS Note 2 — Duplicate Revision Handout',
        subject: 'Database Management System',
        subjectCode: 'CIT203',
        semesterNo: 3,
        chapter: 'Unit 4: Normalization',
        unitNumber: 4
      },
      `# Database Normalization Handout\n${dupText}`
    );

    const studentSem3 = {
      authenticated: true,
      role: 'student',
      studentId: 'stu_sem3',
      username: 'stu_sem3',
      currentSemester: 3,
      semester: 'Semester 3',
      semesterNo: 3,
      cohortId: '1',
      cohort: { id: '1', currentSemester: 3, status: 'active' }
    };

    // Scenario 18 & 19: Deduplicates identical/overlapping chunks and respects configured token/char budget
    const res = await answerWithChapterContext(db, {
      message: 'Explain Normalization in Database Management Systems',
      chapterContext: {
        subject: 'Database Management System',
        subjectCode: 'CIT203',
        semesterNo: 3,
        unitNumber: 4,
        chapterTitle: 'Unit 4: Normalization',
        fileIds: [file1Id, file2Id]
      },
      academicContext: studentSem3,
      maxContextTokens: 300,
      maxContextChars: 1200
    });

    assert.equal(res.evidenceContext.activeChapterEvidence.length, 1, 'Scenario 18: Duplicate chunks across chapter files must be deduplicated');
    assert.ok(res.evidenceContext.budgetStats.deduplicatedCount >= 1);
    assert.ok(
      res.evidenceContext.budgetStats.usedChars <= 1200,
      `Scenario 19: Context chars (${res.evidenceContext.budgetStats.usedChars}) must respect maxContextChars (1200)`
    );

    // Scenario 20: Source-grounded material and model-supplemented explanation remain clearly distinguishable when notes don't cover a topic
    const fallbackRes = await answerWithChapterContext(db, {
      message: 'Explain Thomas Write Rule in timestamp ordering concurrency control',
      chapterContext: {
        subject: 'Database Management System',
        subjectCode: 'CIT203',
        semesterNo: 3,
        unitNumber: 4,
        chapterTitle: 'Unit 4: Normalization',
        fileIds: [file1Id]
      },
      academicContext: studentSem3
    });
    assert.equal(fallbackRes.foundInChapterFiles, false);
    assert.equal(fallbackRes.evidenceContext.modelSupplementaryGuidance.needed, true);
    assert.equal(fallbackRes.evidenceContext.modelSupplementaryGuidance.evidenceOrigin, 'model_academic_fallback');
    assert.match(fallbackRes.reply, /not explicitly detailed in the uploaded PDF notes/i);

    // Scenario 21: Existing Adaptive Presentation Engine profiles (e.g. interactive_simulation for Logic Gates) still work seamlessly
    const simRes = await answerWithChapterContext(db, {
      message: 'Explain AND, OR, NOT logic gates with an interactive truth table simulator',
      chapterContext: {
        subject: 'Digital Logic',
        subjectCode: 'CIT112',
        semesterNo: 1,
        unitNumber: 2,
        chapterTitle: 'Unit 2: Logic Gates',
        fileIds: []
      }
    });
    assert.equal(simRes.presentationPlan.profile, 'interactive_simulation');
    assert.match(simRes.reply, /```logic_sim|"demoType":\s*"logic_gate_simulator"/i);
  } finally {
    db.close();
  }
});
