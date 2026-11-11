'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

const { ensureRagSchema } = require('../lib/rag-schema');
const {
  parsePyqDocumentToQuestions,
  linkPyqQuestionToCurriculum,
  ingestPyqPaper,
  searchPyqQuestions,
  getTopicPyqAnalytics,
  extractMarksFromText,
  categorizeQuestion
} = require('../lib/pyq-intelligence');
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

  await ensureRagSchema(db);
  return db;
}

test('PYQ Intelligence: Question Parsing, Marks Extraction & Categorization', async () => {
  const samplePaper = `
    GANDAKI UNIVERSITY
    Faculty of Science and Technology
    Bachelor of Information Technology (BIT)
    Course: Data Structure and Algorithms (CIT214)
    Year: 2080 BS    Semester: III    Time: 3 hrs    Full Marks: 100

    Group A - Short Questions (Attempt any FIVE) [5 x 5 = 25]
    1. Define an Abstract Data Type (ADT). How does a Linked List function as an ADT? [5]
    2 (a) Differentiate between Singly Linked List and Doubly Linked List with memory diagrams. (5 Marks)
    2 (b) Write a C function to insert a node at the beginning of a Singly Linked List. [5]
    3. Calculate the time and space complexity of binary search on a sorted array of size n. [2+3=5]

    Group B - Long Questions (Attempt any THREE) [3 x 10 = 30]
    4. What is a Circular Linked List? Write complete algorithms for:
       (a) Insertion at end
       (b) Deletion from beginning [10]
    5. Compare BFS and DFS graph traversal techniques. Dry run both on a graph of 5 nodes. [10]
  `;

  const parsed = parsePyqDocumentToQuestions(samplePaper, {
    subject: 'Data Structure and Algorithms',
    subjectCode: 'CIT214',
    semesterNo: 3,
    examYear: '2080 BS',
    examType: 'Final Exam'
  });

  assert.ok(parsed.length >= 5, `Should extract at least 5 questions (got ${parsed.length})`);

  // Q1 Check
  const q1 = parsed.find((q) => q.questionNumber === '1');
  assert.ok(q1, 'Q1 must be parsed');
  assert.equal(q1.marks, 5);
  assert.equal(q1.sectionLabel, 'Group A - Short Questions (Attempt any FIVE) [5 x 5 = 25]');
  assert.match(q1.cleanQuestionText, /Define an Abstract Data Type/i);

  // Q2(a) Check - Comparison
  const q2a = parsed.find((q) => q.questionNumber.includes('2(a)') || q.questionNumber.includes('2 (a)'));
  assert.ok(q2a, 'Q2(a) must be parsed');
  assert.equal(q2a.marks, 5);
  assert.equal(q2a.questionCategory, 'comparison', 'Should categorize differentiation as comparison');

  // Q2(b) Check - Code
  const q2b = parsed.find((q) => q.questionNumber.includes('2(b)') || q.questionNumber.includes('2 (b)'));
  assert.ok(q2b, 'Q2(b) must be parsed');
  assert.equal(q2b.marks, 5);
  assert.equal(q2b.questionCategory, 'code', 'Should categorize writing C function as code');

  // Q3 Check - Numerical / Complexity
  const q3 = parsed.find((q) => q.questionNumber === '3');
  assert.ok(q3, 'Q3 must be parsed');
  assert.equal(q3.marks, 5, 'Should calculate 2+3=5 marks correctly');
  assert.equal(q3.questionCategory, 'numerical');

  // Q4 Check - 10 Marks
  const q4 = parsed.find((q) => q.questionNumber === '4');
  assert.ok(q4, 'Q4 must be parsed');
  assert.equal(q4.marks, 10);
});

test('PYQ Intelligence: Curriculum Linking & DB Ingestion', async () => {
  const db = await createTestDb();

  // Seed a teacher note chunk for DSA Linked List in `document_chunks`
  await db.run(
    `INSERT INTO document_chunks (
      id, file_id, doc_version, chunk_index, chunk_level,
      page_start, page_end, chapter, unit, section_heading,
      content, clean_content, content_hash, subject, subject_code, semester_no, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'chunk_dsa_101',
    'file_dsa_notes_1',
    1,
    1,
    'child',
    3,
    5,
    'Chapter 2',
    'Unit 2',
    'Singly Linked List Insertion and Deletion Operations',
    'Singly linked list insertion at beginning requires allocating a new node with malloc and adjusting head pointer.',
    'Singly linked list insertion at beginning requires allocating a new node with malloc and adjusting head pointer.',
    'hash101',
    'Data Structure and Algorithms',
    'CIT214',
    3,
    new Date().toISOString()
  );

  const samplePaperText = `
    GANDAKI UNIVERSITY
    Bachelor of Information Technology
    2080 BS Final Exam
    Course: Data Structure and Algorithms (CIT214)

    1. Define Singly Linked List. Write an algorithm to insert a node at beginning of a linked list. [5]
    2. Explain Doubly Linked List representation and compare with Singly Linked List. [5]
  `;

  const ingestionRes = await ingestPyqPaper(db, {
    subject: 'Data Structure and Algorithms',
    subjectCode: 'CIT214',
    semesterNo: 3,
    examYear: '2080 BS',
    examType: 'Final Exam',
    rawText: samplePaperText
  });

  assert.equal(ingestionRes.questionsCount, 2);

  // Verify in `pyq_papers`
  const paperRow = await db.get(`SELECT * FROM pyq_papers WHERE id = ?`, ingestionRes.paperId);
  assert.ok(paperRow);
  assert.equal(paperRow.subjectCode || paperRow.subject_code, 'CIT214');
  assert.equal(paperRow.semesterNo || paperRow.semester_no, 3);
  assert.equal(paperRow.questionsCount || paperRow.questions_count, 2);

  // Verify in `pyq_questions`
  const questionsInDb = await db.all(`SELECT * FROM pyq_questions WHERE paper_id = ?`, ingestionRes.paperId);
  assert.equal(questionsInDb.length, 2);

  // Verify teacher note chunk linking
  const q1Row = questionsInDb[0];
  assert.ok(q1Row);
  const links = await db.all(`SELECT * FROM pyq_topic_links WHERE question_id = ?`, q1Row.id);
  assert.ok(links.length >= 1, 'Question must have topic link');
  assert.equal(links[0].noteChunkId || links[0].note_chunk_id, 'chunk_dsa_101', 'Should link to the teacher note chunk');
  assert.equal(links[0].notePageNumber || links[0].note_page_number, 3, 'Should link to note page 3');
});

test('PYQ Intelligence: Search & Analytics', async () => {
  const db = await createTestDb();

  // Ingest 2 papers from different years for DSA
  const paper2079 = `
    2079 BS Final Exam
    Data Structure and Algorithms
    1. Explain Singly Linked List operations. [5]
    2. What is Binary Search Tree? [10]
  `;
  const paper2080 = `
    2080 BS Final Exam
    Data Structure and Algorithms
    1. Write an algorithm for Singly Linked List insertion. [5]
    2. Explain Stack using Array. [5]
  `;

  await ingestPyqPaper(db, {
    subject: 'Data Structure and Algorithms',
    subjectCode: 'CIT214',
    semesterNo: 3,
    examYear: '2079 BS',
    examType: 'Final Exam',
    rawText: paper2079
  });

  await ingestPyqPaper(db, {
    subject: 'Data Structure and Algorithms',
    subjectCode: 'CIT214',
    semesterNo: 3,
    examYear: '2080 BS',
    examType: 'Final Exam',
    rawText: paper2080
  });

  // Search by topic: Singly Linked List
  const searchResults = await searchPyqQuestions(db, {
    subject: 'Data Structure and Algorithms',
    semesterNo: 3,
    query: 'Singly Linked List'
  });

  assert.ok(searchResults.length >= 2, `Should find at least 2 questions on Singly Linked List (got ${searchResults.length})`);
  assert.ok(searchResults.some((q) => (q.exam_year || q.examYear) === '2080 BS'));
  assert.ok(searchResults.some((q) => (q.exam_year || q.examYear) === '2079 BS'));

  // Test Analytics
  const analytics = await getTopicPyqAnalytics(db, {
    subject: 'Data Structure and Algorithms',
    semesterNo: 3,
    normalizedTopic: 'singly linked list'
  });

  assert.ok(analytics.timesAsked >= 2, 'Should detect topic asked 2 or more times');
  assert.ok(analytics.examYears.includes('2080 BS'));
  assert.ok(analytics.examYears.includes('2079 BS'));
  assert.equal(analytics.distinctYearsCount, 2);
});
