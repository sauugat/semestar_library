'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

const { ensureRagSchema } = require('../lib/rag-schema');
const {
  resolveCourseAndChapter,
  buildReconciledStudyPlan
} = require('../lib/study-partner-reconciler');
const { ingestPyqPaper } = require('../lib/pyq-intelligence');
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
    CREATE TABLE files (
      id INTEGER PRIMARY KEY,
      storedName TEXT,
      originalName TEXT,
      title TEXT,
      subject TEXT,
      chapter TEXT,
      semester TEXT,
      semester_no INTEGER,
      cohort_id INTEGER,
      audience_scope TEXT DEFAULT 'all_students',
      visibility TEXT DEFAULT 'everyone',
      previewName TEXT,
      uploadedBy TEXT,
      sizeBytes INTEGER DEFAULT 1024,
      uploadedAt TEXT
    );
  `);

  await ensureRagSchema(db);
  return db;
}

test('Study Partner Reconciler: Course & Chapter Resolution Scoped by Semester', async () => {
  // Semester 1 student asking for "Chapter 2 of C"
  const sem1C = resolveCourseAndChapter('C', 'Chapter 2', 1);
  assert.equal(sem1C.course.code, 'CIT111');
  assert.match(sem1C.course.title, /Computer Programming/i);

  // Semester 3 student asking for "Chapter 2 of DSA"
  const sem3DSA = resolveCourseAndChapter('DSA', 'Chapter 2', 3);
  assert.equal(sem3DSA.course.code, 'CIT214');
  assert.equal(sem3DSA.unitNumber, 2);
  assert.match(sem3DSA.chapterTitle, /Linked List/i);
  assert.ok(sem3DSA.syllabusSubtopics.length >= 2, 'Should have syllabus subtopics');
});

test('Study Partner Reconciler: Zero-Topic-Left-Behind Syllabus U Teacher Note Union', async () => {
  const db = await createTestDb();

  // 1. Insert a teacher note PDF in `files`
  await db.run(
    `INSERT INTO files (id, originalName, title, subject, chapter, semester, semester_no)
     VALUES (201, 'DSA_Unit2_LinkedLists.pdf', 'DSA Unit 2 Complete Lecture Notes', 'Data Structure and Algorithms', 'Chapter 2', 'Semester 3', 3)`
  );

  // 2. Insert extracted chunks for Chapter 2:
  // Chunk 1: Matches syllabus topic "Singly Linked List"
  // Chunk 2: Extra teacher topic not in syllabus string ("Memory Representation with malloc()")
  // Chunk 3: Extra teacher topic not in syllabus string ("Reversing a Singly Linked List")
  // Chunk 4: Matches syllabus topic "Two Way (Doubly) Linked List"
  const chunksData = [
    {
      id: 'chunk_1',
      fileId: 201,
      pageStart: 1,
      pageEnd: 3,
      heading: 'Singly Linked Lists: Representation, Insertion and Deletion',
      content: 'A singly linked list is a linear data structure of nodes.'
    },
    {
      id: 'chunk_2',
      fileId: 201,
      pageStart: 4,
      pageEnd: 5,
      heading: 'Dynamic Memory Allocation with malloc() for Nodes',
      content: 'Memory for a node is allocated at runtime using struct Node* newNode = (struct Node*)malloc(sizeof(struct Node)).'
    },
    {
      id: 'chunk_3',
      fileId: 201,
      pageStart: 6,
      pageEnd: 8,
      heading: 'Reversing a Singly Linked List Iteratively and Recursively',
      content: 'Reversing a linked list requires three pointers: prev, current, next.'
    },
    {
      id: 'chunk_4',
      fileId: 201,
      pageStart: 9,
      pageEnd: 12,
      heading: 'Two Way Lists (Doubly Linked Lists): Insertion and Deletion',
      content: 'Doubly linked lists have both prev and next pointers.'
    }
  ];

  for (const c of chunksData) {
    await db.run(
      `INSERT INTO document_chunks (
        id, file_id, doc_version, chunk_index, chunk_level,
        page_start, page_end, chapter, unit, section_heading,
        content, clean_content, content_hash, subject, subject_code, semester_no, created_at
      ) VALUES (?, ?, 1, 1, 'child', ?, ?, 'Chapter 2', 'Unit 2', ?, ?, ?, 'hash', 'Data Structure and Algorithms', 'CIT214', 3, ?)`,
      c.id, c.fileId, c.pageStart, c.pageEnd, c.heading, c.content, c.content, new Date().toISOString()
    );
  }

  // 3. Ingest a past year question (PYQ) for Singly Linked List
  await ingestPyqPaper(db, {
    subject: 'Data Structure and Algorithms',
    subjectCode: 'CIT214',
    semesterNo: 3,
    examYear: '2080 BS',
    examType: 'Final Exam',
    rawText: '1. Write an algorithm to insert a node at the beginning of a Singly Linked List. [5]'
  });

  // 4. Build Reconciled Study Plan
  const studyPlan = await buildReconciledStudyPlan(db, {
    subject: 'Data Structure and Algorithms',
    chapterQuery: 'Chapter 2',
    semesterNo: 3
  });

  assert.equal(studyPlan.subjectCode, 'CIT214');
  assert.equal(studyPlan.unitNumber, 2);
  assert.ok(studyPlan.totalSteps >= 4, `Should reconcile all topics (got ${studyPlan.totalSteps} steps)`);

  // Verify Zero-Topic-Left-Behind: Both syllabus topics and teacher extra topics must be in the plan
  const planTitles = studyPlan.plan.map((s) => s.topicTitle.toLowerCase());
  assert.ok(
    planTitles.some((t) => t.includes('singly linked list')),
    'Syllabus topic "Singly Linked List" must be present'
  );
  assert.ok(
    planTitles.some((t) => t.includes('dynamic memory allocation') || t.includes('malloc')),
    'Teacher extra topic "malloc()" must NOT be left behind!'
  );
  assert.ok(
    planTitles.some((t) => t.includes('reversing a singly linked list')),
    'Teacher extra topic "Reversing a Linked List" must NOT be left behind!'
  );

  // Verify sourceOrigin tags
  assert.ok(studyPlan.plan.some((s) => s.sourceOrigin === 'syllabus_and_note'));
  assert.ok(studyPlan.plan.some((s) => s.sourceOrigin === 'note_exclusive'));

  // Verify PYQ alert attached
  const singlyStep = studyPlan.plan.find((s) => s.topicTitle.toLowerCase().includes('singly linked list'));
  assert.ok(singlyStep, 'Singly linked list step must exist');
  assert.equal(singlyStep.hasPyqAlert, true, 'Should attach PYQ alert for Singly Linked List');
  assert.ok(singlyStep.pyqMatches.length >= 1, 'Should have matching PYQ');
  assert.equal(singlyStep.pyqMatches[0].examYear, '2080 BS');
});
