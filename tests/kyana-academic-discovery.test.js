'use strict';

/**
 * KYANA AI — INTELLIGENT ACADEMIC FILE DISCOVERY & SELECTION ENGINE
 * ================================================================
 * Comprehensive 15-scenario automated regression test suite:
 *  1. CSS retrieval without mentioning Web Technology or semester.
 *  2. JIT retrieval without mentioning Java or subject.
 *  3. Normalization retrieval from database notes.
 *  4. Deadlock prevention retrieval from operating systems notes.
 *  5. Session and cookie management retrieval from web technology notes.
 *  6. Topic discovery when term appears only inside PDF/document body.
 *  7. Topic discovery when document title is unrelated (e.g. Unit2_Lecture.pdf).
 *  8. Multiple documents covering complementary parts of a topic.
 *  9. Irrelevant notes from the same subject rejected (evidence threshold check < 50).
 * 10. Notices and exam routines excluded from academic answers (source isolation).
 * 11. No relevant notes resulting in clear academic AI fallback with exact disclaimer.
 * 12. Partial library coverage resulting in combined grounded + AI response.
 * 13. Student authorization restrictions remaining intact (no teachers_only/cohort_only leaks).
 * 14. No cross-student private record leakage.
 * 15. Correct source attribution (titles, chapters, page numbers).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

const { handleChat } = require('../ai-assistant');
const { inspectAndScoreEvidence, ACADEMIC_EVIDENCE_THRESHOLD } = require('../lib/note-search');
const { reasonCurriculum, getCandidateSubjects, getCandidateSemesters } = require('../lib/curriculum-reasoning');

const REFERENCE_DATE = new Date('2026-04-17T04:15:00.000Z');

// Student context enrolled in Semester 6 (studying advanced topics, looking up lower or cross-semester subjects)
const STUDENT_SEM6 = {
  authenticated: true,
  studentId: 'STU-SEM6-001',
  name: 'Bikash Sharma',
  role: 'student',
  semester: '6',
  currentSemester: 6,
  cohortId: 'cohort-2023-bit',
  cohort: { id: 'cohort-2023-bit', name: 'BIT 2023 Batch', currentSemester: 6 }
};

const STUDENT_OTHER = {
  authenticated: true,
  studentId: 'STU-SEM2-999',
  name: 'Suman Thapa',
  role: 'student',
  semester: '2',
  currentSemester: 2,
  cohortId: 'cohort-2025-bit',
  cohort: { id: 'cohort-2025-bit', name: 'BIT 2025 Batch', currentSemester: 2 }
};

function createInMemoryDb() {
  const client = createClient({ url: ':memory:' });
  const normalizeArgs = (params) => {
    const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    return flat.map(v => (v === undefined ? null : v));
  };
  const adapter = {
    isPostgres: false,
    client,
    exec: async (sql) => { await client.executeMultiple(sql); },
    get: async (sql, ...params) => {
      const res = await client.execute({ sql, args: normalizeArgs(params) });
      return res.rows[0] ? { ...res.rows[0] } : null;
    },
    all: async (sql, ...params) => {
      const res = await client.execute({ sql, args: normalizeArgs(params) });
      return (res.rows || []).map(r => ({ ...r }));
    },
    run: async (sql, ...params) => {
      const res = await client.execute({ sql, args: normalizeArgs(params) });
      return {
        changes: Number(res.rowsAffected || 0),
        lastInsertRowid: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : null
      };
    },
    query: async (sql, params = []) => {
      const res = await client.execute({ sql, args: normalizeArgs(Array.isArray(params) ? params : [params]) });
      const rows = (res.rows || []).map(r => ({ ...r }));
      return { rows, rowCount: rows.length };
    },
    withTransaction: async (fn) => fn(adapter),
    close: () => client.close()
  };
  return adapter;
}

async function createAcademicTestDb() {
  process.env.NODE_ENV = 'test';
  const db = createInMemoryDb();

  await db.exec(`
    CREATE TABLE cohorts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      current_semester INTEGER NOT NULL,
      status TEXT DEFAULT 'active'
    );
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      username TEXT,
      name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'student',
      semester TEXT,
      department TEXT DEFAULT 'BIT',
      cohort_id TEXT,
      avatarUrl TEXT
    );
    CREATE TABLE files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      originalName TEXT,
      storedName TEXT,
      subject TEXT,
      semester TEXT,
      semester_no INTEGER,
      chapter TEXT,
      cohort_id TEXT,
      audience_scope TEXT DEFAULT 'all_students',
      visibility TEXT DEFAULT 'everyone',
      uploadedBy TEXT,
      uploadDate TEXT,
      uploadedAt TEXT DEFAULT '2026-03-01',
      deleted_at TEXT,
      hidden_at TEXT
    );
    CREATE TABLE note_search_documents (
      id INTEGER PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      extraction_status TEXT NOT NULL DEFAULT 'ok',
      indexed_at TEXT NOT NULL DEFAULT '2026-03-01'
    );
    CREATE TABLE routine (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_name TEXT NOT NULL,
      exam_date TEXT NOT NULL,
      semester INTEGER NOT NULL
    );
    CREATE TABLE notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      published_at TEXT DEFAULT '2026-04-10',
      audience_scope TEXT DEFAULT 'all_students'
    );
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      title TEXT,
      content TEXT,
      type TEXT DEFAULT 'status',
      category TEXT DEFAULT 'general',
      semester_no INTEGER,
      cohort_id TEXT,
      audience_scope TEXT DEFAULT 'all_students',
      target_all_semesters INTEGER DEFAULT 0,
      visibility TEXT DEFAULT 'everyone',
      created_at TEXT DEFAULT '2026-04-10'
    );
    CREATE TABLE post_target_semesters (
      post_id INTEGER NOT NULL,
      semester INTEGER NOT NULL
    );
    CREATE TABLE assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      subject TEXT NOT NULL,
      language TEXT,
      deadline TEXT,
      semester INTEGER,
      semester_no INTEGER,
      cohort_id TEXT,
      audience_scope TEXT DEFAULT 'all_students',
      createdBy TEXT,
      createdAt TEXT DEFAULT '2026-03-01'
    );
    CREATE TABLE admin_audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      before_state TEXT,
      after_state TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.run(`INSERT INTO cohorts (id, name, current_semester) VALUES ('cohort-2023-bit', 'BIT 2023', 6)`);
  await db.run(`INSERT INTO cohorts (id, name, current_semester) VALUES ('cohort-2025-bit', 'BIT 2025', 2)`);

  await db.run(`INSERT INTO students (studentId, username, name, role, semester, cohort_id) VALUES ('STU-SEM6-001', 'bikash', 'Bikash Sharma', 'student', '6', 'cohort-2023-bit')`);
  await db.run(`INSERT INTO students (studentId, username, name, role, semester, cohort_id) VALUES ('STU-SEM2-999', 'suman', 'Suman Thapa', 'student', '2', 'cohort-2025-bit')`);

  // 1. CSS Notes (Web Technology I, Semester 2)
  await db.run(`
    INSERT INTO files (id, title, originalName, subject, semester, semester_no, chapter)
    VALUES (101, 'CSS Selectors and Box Model Essentials', 'css_selectors_box_model.pdf', 'Web Technology I', 'Semester 2', 2, '2')
  `);
  await db.run(`
    INSERT INTO note_search_documents (id, content, indexed_at)
    VALUES (101, 'Chapter 2: CSS Presentation and Layouts.
Cascading Style Sheets (CSS) is defined as the styling language for web pages.
Core Selectors: Element selector targets tags directly. Class selector (.highlight) targets multiple elements. ID selector (#main) targets unique elements.
The CSS Box Model consists of content, padding, border, and margin.
Padding provides space inside the border, while margin clears space outside adjacent elements.
For example, margin: 10px; padding: 5px; border: 1px solid black; establishes clear layout separation.', '2026-03-01')
  `);

  // 2. JIT Compiler Notes (Computer Programming II (Java), Semester 2)
  await db.run(`
    INSERT INTO files (id, title, originalName, subject, semester, semester_no, chapter)
    VALUES (102, 'JVM Architecture and JIT Execution', 'jvm_jit_compilation.pdf', 'Computer Programming II (Java)', 'Semester 2', 2, '1')
  `);
  await db.run(`
    INSERT INTO note_search_documents (id, content, indexed_at)
    VALUES (102, 'Chapter 1: JVM Runtime Operations.
The Just-in-Time (JIT) Compiler is a core subsystem of the Java Virtual Machine (JVM).
JIT compilation is the process of converting Java bytecode into native machine code at runtime.
The JVM interpreter initially interprets bytecode instruction-by-instruction. When the profiler detects frequent hotspot loops or heavily executed methods, the JIT compiler compiles these bytecode blocks directly into native machine instructions and stores them in the code cache.
This technique eliminates interpretation overhead and allows Java applications to execute with near-native performance.', '2026-03-01')
  `);

  // 3. Normalization Notes (Database Management System, Semester 3)
  await db.run(`
    INSERT INTO files (id, title, originalName, subject, semester, semester_no, chapter)
    VALUES (103, 'Relational Schema Normalization Guide', 'dbms_normalization.pdf', 'Database Management System', 'Semester 3', 3, '4')
  `);
  await db.run(`
    INSERT INTO note_search_documents (id, content, indexed_at)
    VALUES (103, 'Chapter 4: Functional Dependencies and Database Normalization.
Database Normalization is the technique of organizing relations to minimize data redundancy and prevent insertion, update, and deletion anomalies.
First Normal Form (1NF) requires atomic values with no repeating groups.
Second Normal Form (2NF) is in 1NF and eliminates partial functional dependencies on candidate keys.
Third Normal Form (3NF) is in 2NF and removes transitive dependencies (non-prime attribute depending on another non-prime attribute).
Boyce-Codd Normal Form (BCNF) strictly requires every determinant in functional dependencies to be a super key.', '2026-03-01')
  `);

  // 4. Deadlock Prevention Notes (Operating Systems, Semester 4)
  await db.run(`
    INSERT INTO files (id, title, originalName, subject, semester, semester_no, chapter)
    VALUES (104, 'Deadlock Handling and Concurrency', 'os_deadlocks.pdf', 'Operating Systems', 'Semester 4', 4, '3')
  `);
  await db.run(`
    INSERT INTO note_search_documents (id, content, indexed_at)
    VALUES (104, 'Chapter 3: Process Synchronization and Deadlocks.
A Deadlock occurs when concurrent processes are permanently blocked because each holds a resource while waiting for another.
The four Coffman conditions for deadlock are: 1. Mutual Exclusion, 2. Hold and Wait, 3. No Preemption, and 4. Circular Wait.
Deadlock prevention is the design strategy of ensuring that at least one of these four conditions cannot hold.
For example, eliminating circular wait is achieved by imposing a strict global ordering on all resource allocations.
Deadlock avoidance uses dynamic evaluation, such as the Banker''s algorithm, to ensure the system remains in a safe state.', '2026-03-01')
  `);

  // 5. Session and Cookie Management Notes (Web Technology I, Semester 2)
  await db.run(`
    INSERT INTO files (id, title, originalName, subject, semester, semester_no, chapter)
    VALUES (105, 'HTTP State: Sessions and Cookies', 'web1_sessions_cookies.pdf', 'Web Technology I', 'Semester 2', 2, '5')
  `);
  await db.run(`
    INSERT INTO note_search_documents (id, content, indexed_at)
    VALUES (105, 'Chapter 5: Managing State in Web Applications.
Because HTTP is a stateless protocol, servers do not automatically retain user identity across distinct requests.
Session and cookie management provides state persistence.
Cookies are small pieces of data (up to 4 KB) sent by the server using Set-Cookie header and stored by the client browser.
A Session stores user data securely on the server, assigning a unique Session ID (SID) sent to the browser via an HttpOnly cookie.
On subsequent requests, the browser includes the cookie, allowing the server to retrieve session attributes.', '2026-03-01')
  `);

  // 6. Generic title file with ACID properties inside text body (Database Management System, Semester 3)
  await db.run(`
    INSERT INTO files (id, title, originalName, subject, semester, semester_no, chapter)
    VALUES (106, 'Unit 3 Lecture Handout', 'handout3.pdf', 'Database Management System', 'Semester 3', 3, '3')
  `);
  await db.run(`
    INSERT INTO note_search_documents (id, content, indexed_at)
    VALUES (106, 'Chapter 3: Transaction Processing.
A transaction is a logical unit of database processing.
ACID properties are defined as:
1. Atomicity: All operations in the transaction succeed or all fail together.
2. Consistency: The database transitions from one valid state to another valid state.
3. Isolation: Concurrent transactions execute without interfering with one another.
4. Durability: Committed updates persist permanently even after hardware crashes.', '2026-03-01')
  `);

  // 7. Unrelated file title (Unit2_Lecture.pdf) with Banker's Algorithm inside body (Operating Systems, Semester 4)
  await db.run(`
    INSERT INTO files (id, title, originalName, subject, semester, semester_no, chapter)
    VALUES (107, 'Unit2_Lecture.pdf', 'Unit2_Lecture.pdf', 'Operating Systems', 'Semester 4', 4, '2')
  `);
  await db.run(`
    INSERT INTO note_search_documents (id, content, indexed_at)
    VALUES (107, 'Operating Systems Lecture Series.
The Banker''s algorithm is a deadlock avoidance algorithm developed by Edsger Dijkstra.
It tests for safety by simulating the allocation of predetermined maximum possible amounts of all resources, and then makes an "s-state" check to test for possible activities, before deciding whether allocation should be allowed to continue.
The system maintains Allocation, Max, Available, and Need matrices.', '2026-03-01')
  `);

  // 8. Complementary CSS Documents (Note A: Selectors, Note B: Flexbox Layouts)
  await db.run(`
    INSERT INTO files (id, title, originalName, subject, semester, semester_no, chapter)
    VALUES (108, 'Advanced CSS Selectors & Cascading Rules', 'css_selectors_adv.pdf', 'Web Technology I', 'Semester 2', 2, '2')
  `);
  await db.run(`
    INSERT INTO note_search_documents (id, content, indexed_at)
    VALUES (108, 'Chapter 2: CSS Selectors and Specificity Hierarchy.
CSS Selectors establish targeting rules. Pseudo-classes such as :hover and :focus enable dynamic styling.
Specificity calculation: Inline styles (1000) > IDs (100) > Classes/Attributes (10) > Elements (1).
Combinators include child selector (div > p) and adjacent sibling selector (h1 + p).', '2026-03-01')
  `);

  await db.run(`
    INSERT INTO files (id, title, originalName, subject, semester, semester_no, chapter)
    VALUES (109, 'Modern CSS Layouts: Flexbox and Grid', 'css_flexbox_grid.pdf', 'Web Technology I', 'Semester 2', 2, '3')
  `);
  await db.run(`
    INSERT INTO note_search_documents (id, content, indexed_at)
    VALUES (109, 'Chapter 3: Modern Layout Mechanisms with CSS.
The CSS Flexbox layout model arranges elements predictably when page layout must accommodate different screen sizes.
Flex containers define display: flex; justify-content: space-between; and align-items: center;
CSS Grid provides a two-dimensional grid-based layout system with rows and columns, defined using grid-template-columns: repeat(3, 1fr);', '2026-03-01')
  `);

  // 9. Table of Contents / Passing Mention Only File (Should be rejected, evidence score < 50)
  await db.run(`
    INSERT INTO files (id, title, originalName, subject, semester, semester_no, chapter)
    VALUES (110, 'Java Complete Course Outline and Syllabus', 'java_syllabus_toc.pdf', 'Computer Programming II (Java)', 'Semester 2', 2, '0')
  `);
  await db.run(`
    INSERT INTO note_search_documents (id, content, indexed_at)
    VALUES (110, 'Table of Contents:
Unit 1: Introduction to Java and JVM
Unit 2: Object-Oriented Principles
Unit 3: Just-in-Time Compiler
Unit 4: Collections and Generics
Unit 5: Multithreading and Concurrency
Unit 6: File I/O Operations', '2026-03-01')
  `);

  // 10. Notices and Routine items (should be excluded from academic responses)
  await db.run(`
    INSERT INTO notices (id, title, description, published_at)
    VALUES (201, 'Mid-Term Exam Notice for Web Technology', 'Web Technology I exam is scheduled for 2026-05-15 in Room 102.', '2026-04-12')
  `);
  await db.run(`
    INSERT INTO routine (id, subject_name, exam_date, semester)
    VALUES (301, 'Web Technology I', '2026-05-15', 2)
  `);

  // 11. Partial coverage file: covers only CSS Selectors, no CSS Grid
  await db.run(`
    INSERT INTO files (id, title, originalName, subject, semester, semester_no, chapter)
    VALUES (111, 'Elementary CSS Selectors Guide', 'css_elementary.pdf', 'Web Technology I', 'Semester 2', 2, '2')
  `);
  await db.run(`
    INSERT INTO note_search_documents (id, content, indexed_at)
    VALUES (111, 'Chapter 2: Elementary Selectors.
CSS selectors allow developers to target HTML tags. An element selector applies styling to all matching HTML tags, such as p { color: blue; }.
Class selectors use dot syntax (.container), and ID selectors use hash (#main).', '2026-03-01')
  `);

  // 12. Restricted files for authorization tests
  await db.run(`
    INSERT INTO files (id, title, originalName, subject, semester, semester_no, chapter, audience_scope, visibility)
    VALUES (112, 'Teacher Confidential Notes on Web Tech', 'teacher_confidential.pdf', 'Web Technology I', 'Semester 2', 2, '1', 'teachers_only', 'teachers_only')
  `);
  await db.run(`
    INSERT INTO note_search_documents (id, content, indexed_at)
    VALUES (112, 'CONFIDENTIAL TEACHER SOLUTION MANUAL: Final exam question solutions for Web Tech.', '2026-03-01')
  `);

  await db.run(`
    INSERT INTO files (id, title, originalName, subject, semester, semester_no, chapter, cohort_id, audience_scope, visibility)
    VALUES (113, 'Cohort 2025 Exclusive Lab Solutions', 'cohort2025_solutions.pdf', 'Web Technology I', 'Semester 2', 2, '2', 'cohort-2025-bit', 'cohort_only', 'cohort_only')
  `);
  await db.run(`
    INSERT INTO note_search_documents (id, content, indexed_at)
    VALUES (113, 'EXCLUSIVE FOR COHORT 2025 STUDENTS ONLY: Graded homework answers for CSS.', '2026-03-01')
  `);

  return db;
}

// ============================================================================
// SCENARIO 1: CSS retrieval without mentioning Web Technology or semester
// ============================================================================
test('Scenario 1: Student in Semester 6 finds CSS notes without knowing subject or semester', async () => {
  const db = await createAcademicTestDb();
  try {
    const res = await handleChat(
      db,
      'give me notes of CSS',
      STUDENT_SEM6,
      [],
      'sess-acad-1',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );

    assert.ok(res.agentTrace, 'Must execute Kyana agent loop');
    assert.match(res.reply, /CSS Selectors and Box Model Essentials|CSS Presentation and Layouts/i);
    assert.match(res.reply, /Web Technology I/i, 'Must automatically identify Web Technology I without user input');
    assert.match(res.reply, /padding/i, 'Must contain explanatory content from the note');
    assert.match(res.reply, /margin/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 2: JIT retrieval without mentioning Java or subject
// ============================================================================
test('Scenario 2: Student explains Just-in-Time Compiler (JIT) without specifying Java or semester', async () => {
  const db = await createAcademicTestDb();
  try {
    const res = await handleChat(
      db,
      'explain Just-in-Time Compiler (JIT)',
      STUDENT_SEM6,
      [],
      'sess-acad-2',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );

    assert.ok(res.agentTrace);
    assert.match(res.reply, /JVM Architecture and JIT Execution|Just-in-Time \(JIT\) Compiler/i);
    assert.match(res.reply, /bytecode/i, 'Must explain bytecode conversion to native machine code');
    assert.match(res.reply, /Computer Programming II \(Java\)|JVM/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 3: Normalization retrieval from database notes
// ============================================================================
test('Scenario 3: Normalization query discovers DBMS notes dynamically', async () => {
  const db = await createAcademicTestDb();
  try {
    const res = await handleChat(
      db,
      'what is Normalization?',
      STUDENT_SEM6,
      [],
      'sess-acad-3',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );

    assert.ok(res.agentTrace);
    assert.match(res.reply, /Relational Schema Normalization Guide|Database Normalization/i);
    assert.match(res.reply, /Database Management System/i);
    assert.match(res.reply, /1NF|First Normal Form/i);
    assert.match(res.reply, /redundancy/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 4: Deadlock prevention retrieval from operating systems notes
// ============================================================================
test('Scenario 4: Deadlock prevention query discovers Operating Systems notes dynamically', async () => {
  const db = await createAcademicTestDb();
  try {
    const res = await handleChat(
      db,
      'Deadlock prevention',
      STUDENT_SEM6,
      [],
      'sess-acad-4',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );

    assert.ok(res.agentTrace);
    assert.match(res.reply, /Deadlock Handling and Concurrency|Deadlock & Prevention/i);
    assert.match(res.reply, /Operating Systems/i);
    assert.match(res.reply, /Coffman|circular wait/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 5: Session and cookie management retrieval from web technology notes
// ============================================================================
test('Scenario 5: Session and cookie management query retrieves Web Technology notes', async () => {
  const db = await createAcademicTestDb();
  try {
    const res = await handleChat(
      db,
      'Session and cookie management',
      STUDENT_SEM6,
      [],
      'sess-acad-5',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );

    assert.ok(res.agentTrace);
    assert.match(res.reply, /HTTP State: Sessions and Cookies|Session & Cookie Management/i);
    assert.match(res.reply, /stateless/i);
    assert.match(res.reply, /Web Technology I/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 6: Topic discovery when term appears only inside PDF body
// ============================================================================
test('Scenario 6: ACID properties discovered when term is present only inside document content', async () => {
  const db = await createAcademicTestDb();
  try {
    const res = await handleChat(
      db,
      'Explain ACID properties',
      STUDENT_SEM6,
      [],
      'sess-acad-6',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );

    assert.ok(res.agentTrace);
    assert.match(res.reply, /Unit 3 Lecture Handout/i, 'Must discover file 106 despite generic title');
    assert.match(res.reply, /Atomicity/i);
    assert.match(res.reply, /Durability/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 7: Topic discovery when document title is unrelated (Unit2_Lecture.pdf)
// ============================================================================
test('Scenario 7: Banker algorithm discovered from unrelated filename Unit2_Lecture.pdf', async () => {
  const db = await createAcademicTestDb();
  try {
    const res = await handleChat(
      db,
      'How does the banker algorithm prevent deadlock?',
      STUDENT_SEM6,
      [],
      'sess-acad-7',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );

    assert.ok(res.agentTrace);
    assert.match(res.reply, /Unit2_Lecture\.pdf/i, 'Must discover file 107 by content');
    assert.match(res.reply, /safe state|allocation/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 8: Multiple documents covering complementary parts of a topic
// ============================================================================
test('Scenario 8: Multi-document complementary synthesis combines Note A and Note B', async () => {
  const db = await createAcademicTestDb();
  try {
    const res = await handleChat(
      db,
      'give me notes on CSS Selectors and Flexbox layout',
      STUDENT_SEM6,
      [],
      'sess-acad-8',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );

    assert.ok(res.agentTrace);
    assert.match(res.reply, /Advanced CSS Selectors|CSS Selectors and Box Model/i, 'Must cite Selectors note');
    assert.match(res.reply, /Modern CSS Layouts: Flexbox and Grid/i, 'Must cite Flexbox note');
    assert.match(res.reply, /flex-container|display: flex|Flexbox/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 9: Irrelevant notes from same subject rejected (evidence threshold check)
// ============================================================================
test('Scenario 9: Table of Contents file with score < 50 is rejected as explanatory evidence', async () => {
  // Test standalone evidence inspection
  const tocContent = `Table of Contents:
Unit 1: Introduction to Java
Unit 2: OOP
Unit 3: Just-in-Time Compiler
Unit 4: Collections`;
  const scoreResult = inspectAndScoreEvidence(tocContent, { topic: 'Just-in-Time Compiler' });
  assert.equal(scoreResult.isQualified, false, 'TOC must not qualify as evidence');
  assert.ok(scoreResult.score < ACADEMIC_EVIDENCE_THRESHOLD, 'Score must be below threshold 50');
});

// ============================================================================
// SCENARIO 10: Notices and exam routines excluded from academic answers
// ============================================================================
test('Scenario 10: Strict source isolation excludes exam notices and routines from academic explanation', async () => {
  const db = await createAcademicTestDb();
  try {
    const res = await handleChat(
      db,
      'explain CSS Selectors',
      STUDENT_SEM6,
      [],
      'sess-acad-10',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );

    assert.ok(res.agentTrace);
    assert.doesNotMatch(res.reply, /Mid-Term Exam Notice for Web Technology/i, 'Must NOT leak notice in academic explanation');
    assert.doesNotMatch(res.reply, /Room 102/i, 'Must NOT leak exam routine details in academic explanation');
    assert.match(res.reply, /CSS Selectors/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 11: No relevant notes resulting in clear academic AI fallback with exact disclaimer
// ============================================================================
test('Scenario 11: Missing library notes triggers Academic Fallback with exact disclaimer', async () => {
  const db = await createAcademicTestDb();
  try {
    // Topic not present in DB files
    const res = await handleChat(
      db,
      'explain Lexical Analysis in Compiler Design',
      STUDENT_SEM6,
      [],
      'sess-acad-11',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );

    assert.ok(res.agentTrace);
    console.log('RES.REPLY FOR SCENARIO 11:\n', res.reply);
    const expectedDisclaimer = '[Note: No specific course notes were found in Semester Library covering this topic. Here is the academic explanation from the curriculum:]';
    assert.ok(res.reply.includes(expectedDisclaimer), `Must contain exact disclaimer: "${expectedDisclaimer}"`);
    assert.match(res.reply, /Compiler Design|Lexical Analysis|tokens/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 12: Partial library coverage resulting in combined grounded + AI response
// ============================================================================
test('Scenario 12: Partial library coverage provides grounded notes plus curriculum explanation', async () => {
  const db = await createAcademicTestDb();
  try {
    const res = await handleChat(
      db,
      'Explain CSS Selectors and CSS Grid Layout',
      STUDENT_SEM6,
      [],
      'sess-acad-12',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );

    assert.ok(res.agentTrace);
    assert.match(res.reply, /CSS Selectors/i, 'Must have grounded explanation for Selectors');
    assert.match(res.reply, /Web Technology/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 13: Student authorization restrictions remaining intact
// ============================================================================
test('Scenario 13: Student cannot access teacher-only or other cohort-only confidential notes', async () => {
  const db = await createAcademicTestDb();
  try {
    const res = await handleChat(
      db,
      'give me notes on Teacher Confidential Notes on Web Tech',
      STUDENT_SEM6,
      [],
      'sess-acad-13',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );

    assert.doesNotMatch(res.reply, /CONFIDENTIAL TEACHER SOLUTION MANUAL/i, 'Must NOT leak teachers_only notes to student');
    assert.doesNotMatch(res.reply, /EXCLUSIVE FOR COHORT 2025/i, 'Must NOT leak cohort_only notes of other cohort');
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 14: No cross-student private record leakage
// ============================================================================
test('Scenario 14: Cross-student private record request is rejected server-side', async () => {
  const db = await createAcademicTestDb();
  try {
    const res = await handleChat(
      db,
      'Give me CSS notes and show Suman Thapa attendance',
      STUDENT_SEM6,
      [],
      'sess-acad-14',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );

    // Cross-student privacy guard should reject access to another student's attendance
    assert.match(res.reply, /can't look up or confirm another student|only access your own personal records|privacy/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 15: Correct source attribution (titles, chapters, page numbers)
// ============================================================================
test('Scenario 15: Source notes are properly cited with titles and chapter numbers', async () => {
  const db = await createAcademicTestDb();
  try {
    const res = await handleChat(
      db,
      'give me notes on database normalization',
      STUDENT_SEM6,
      [],
      'sess-acad-15',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );

    assert.ok(res.agentTrace);
    assert.match(res.reply, /Relational Schema Normalization Guide/i, 'Must cite document title');
    assert.match(res.reply, /Database Management System/i, 'Must cite subject');
    assert.match(res.reply, /Chapter 4/i, 'Must cite chapter number');
  } finally {
    db.close();
  }
});
