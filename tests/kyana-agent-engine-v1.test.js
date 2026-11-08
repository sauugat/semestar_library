'use strict';

/**
 * KYANA AGENT ENGINE V1 — COMPREHENSIVE 18-SCENARIO AUTOMATED EVALUATION SUITE
 * ============================================================================
 * Tests all 18 scenarios required by Project Specification Section 12:
 *  1. Find the DSA assignment deadline.
 *  2. Calculate days remaining until a deadline.
 *  3. Identify multiple assignments with similar names.
 *  4. Check whether an assignment was submitted.
 *  5. Find all unsubmitted assignments.
 *  6. Identify the next examination.
 *  7. Detect an outdated class resumption announcement.
 *  8. Resolve a follow-up question using conversation context.
 *  9. Find relevant notes for an academic topic.
 * 10. Explain a topic when university notes are unavailable.
 * 11. Compare attendance across subjects.
 * 12. Handle missing deadlines without hallucinating.
 * 13. Handle conflicting official notices.
 * 14. Reject unauthorized student record access.
 * 15. Handle Romanized Nepali queries.
 * 16. Handle multi-step questions requiring several tools.
 * 17. Recover from a failed tool call.
 * 18. Maintain consistent behaviour across web and mobile.
 *
 * Each scenario validates:
 * - Intent understanding
 * - Correct tool selection
 * - Correct resource retrieval
 * - Correct authorization
 * - Correct calculation
 * - Evidence quality
 * - Final answer quality
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@libsql/client');

const {
  handleChat,
  invalidateCache
} = require('../ai-assistant');
const { createChatHandler } = require('../lib/chat-http');
const { ensureTeacherSchema } = require('../lib/teacher-service');
const { ensureAttendanceSchema } = require('../lib/attendance-service');
const { ensureMarksSchema } = require('../lib/marks-service');

// Fixed reference clock for deterministic temporal assertions:
// 2026-04-17T10:00:00+05:45 (Nepal Standard Time = 2083-01-04 BS)
const REFERENCE_DATE = new Date('2026-04-17T04:15:00.000Z');

function loadMobileSseParser() {
  const tsPath = path.join(__dirname, '../mobile/services/kyana.ts');
  const rawTs = fs.readFileSync(tsPath, 'utf8');
  const startIdx = rawTs.indexOf('export function createKyanaSseParser');
  const endIdx = rawTs.indexOf('export async function fetchKyanaPreview');
  const fnCode = rawTs.slice(startIdx, endIdx)
    .replace(/^export\s+function\s+createKyanaSseParser\s*\(\s*callbacks:\s*SseStreamCallbacks\s*=\s*\{\}\s*\)/m, 'function createKyanaSseParser(callbacks = {})')
    .replace(/:\s*SendKyanaMessageResult\s*\|\s*null/g, '')
    .replace(/:\s*string\s*\|\s*null/g, '')
    .replace(/:\s*string\[\]/g, '')
    .replace(/:\s*any\b/g, '')
    .replace(/:\s*number\b/g, '')
    .replace(/:\s*boolean\b/g, '')
    .replace(/:\s*string\b/g, '')
    .replace(/\s+as\s+SendKyanaMessageResult\b/g, '');
  return new Function('console', `${fnCode}\nreturn createKyanaSseParser;`)(console);
}

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

async function createSeededAgentTestDb() {
  process.env.NODE_ENV = 'test';
  const db = createInMemoryDb();

  await db.exec(`
    CREATE TABLE cohorts (
      id TEXT PRIMARY KEY,
      slot_code TEXT,
      display_name TEXT,
      name TEXT NOT NULL,
      group_code TEXT,
      entry_year INTEGER,
      intake_year INTEGER,
      intake_identifier TEXT,
      current_semester INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      operational_status TEXT DEFAULT 'active',
      version INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      graduated_at TEXT
    );
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      username TEXT,
      name TEXT NOT NULL,
      email TEXT,
      password TEXT,
      role TEXT NOT NULL DEFAULT 'student',
      department TEXT DEFAULT 'BIT',
      semester TEXT,
      cohort_id TEXT,
      avatarUrl TEXT,
      account_status TEXT DEFAULT 'active',
      verification_status TEXT DEFAULT 'verified'
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
      uploadedAt TEXT,
      deleted_at TEXT,
      hidden_at TEXT
    );
    CREATE TABLE note_search_documents (
      id INTEGER PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      extraction_status TEXT NOT NULL DEFAULT 'ok',
      extraction_error TEXT,
      indexed_at TEXT NOT NULL,
      content_truncated INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE routine (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_name TEXT NOT NULL,
      subject_code TEXT,
      exam_date TEXT NOT NULL,
      calendar TEXT DEFAULT 'AD',
      weekday TEXT,
      exam_time TEXT,
      room TEXT,
      semester INTEGER NOT NULL,
      exam_type TEXT DEFAULT 'Final'
    );
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'status',
      category TEXT DEFAULT 'general',
      semester_no INTEGER,
      cohort_id TEXT,
      audience_scope TEXT DEFAULT 'all_students',
      target_all_semesters INTEGER DEFAULT 0,
      visibility TEXT DEFAULT 'everyone',
      moderation_status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE TABLE post_target_semesters (
      post_id INTEGER NOT NULL,
      semester INTEGER NOT NULL
    );
    CREATE TABLE assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      instructions TEXT,
      language TEXT DEFAULT 'c',
      subject TEXT,
      semester TEXT,
      semester_no INTEGER,
      cohort_id TEXT,
      audience_scope TEXT DEFAULT 'cohort',
      deadline TEXT,
      pdfUrl TEXT,
      pdfName TEXT,
      createdBy TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE assignment_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignmentId INTEGER NOT NULL,
      questionNumber INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      description TEXT,
      starterCode TEXT,
      language TEXT DEFAULT 'c',
      maxPoints INTEGER NOT NULL DEFAULT 10
    );
    CREATE TABLE submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignmentId INTEGER NOT NULL,
      questionId INTEGER NOT NULL,
      questionTitle TEXT,
      studentId TEXT NOT NULL,
      code TEXT,
      language TEXT DEFAULT 'c',
      submittedAt TEXT NOT NULL
    );
    CREATE TABLE submission_grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      questionId INTEGER NOT NULL,
      studentId TEXT NOT NULL,
      marksObtained REAL,
      remarks TEXT,
      checked INTEGER DEFAULT 0,
      released INTEGER DEFAULT 0
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actorUserId TEXT,
      actorRole TEXT,
      eventType TEXT,
      targetType TEXT,
      targetId TEXT,
      reason TEXT,
      metadata TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await ensureTeacherSchema(db);
  await ensureAttendanceSchema(db);
  await ensureMarksSchema(db);

  // Seed Cohort + Students + Teacher
  await db.run(
    `INSERT INTO cohorts (id, slot_code, display_name, name, current_semester, status, operational_status)
     VALUES ('coh_sem3', 'earth', 'Earth', 'BIT 2024 Batch (Sem 3)', 3, 'active', 'active')`
  );
  await db.run(
    `INSERT INTO students (studentId, username, name, email, password, role, department, semester, cohort_id, account_status)
     VALUES ('STU001', 'aarav', 'Aarav Sharma', 'aarav@gu.edu.np', 'hash', 'student', 'BIT', 'Semester 3', 'coh_sem3', 'active'),
            ('STU002', 'bikash', 'Bikash Thapa', 'bikash@gu.edu.np', 'hash', 'student', 'BIT', 'Semester 3', 'coh_sem3', 'active'),
            ('TCH001', 'ramesh', 'Prof. Ramesh Adhikari', 'ramesh@gu.edu.np', 'hash', 'teacher', 'BIT', 'Semester 3', NULL, 'active')`
  );
  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES ('tch_1', 'TCH001', 'Associate Professor', 'active')`
  );
  await db.run(
    `INSERT INTO subjects (id, code, name, semester, department, credit_hours, nature, active)
     VALUES ('subj_dsa', 'CIT211', 'Data Structure and Algorithms', 3, 'BIT', 3, 'Theory + Practical', 1),
            ('subj_dbms', 'CIT212', 'Database Management System', 3, 'BIT', 3, 'Theory + Practical', 1),
            ('subj_os', 'CIT214', 'Operating Systems', 3, 'BIT', 3, 'Theory + Practical', 1)`
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
     VALUES ('ts_1', 'tch_1', 'subj_dsa'),
            ('ts_2', 'tch_1', 'subj_dbms')`
  );

  // Seed Assignments:
  // 1) DSA Assignment (ID 101) due on 2026-04-24 (7 days from 2026-04-17) - NOT submitted by STU001
  await db.run(
    `INSERT INTO assignments (id, title, description, subject, semester, semester_no, cohort_id, audience_scope, deadline, createdBy, createdAt)
     VALUES (101, 'DSA Lab 1: Singly Linked List & Stack', 'Implement linked list and stack operations in C.', 'Data Structure and Algorithms', 'Semester 3', 3, 'coh_sem3', 'cohort', '2026-04-24', 'TCH001', '2026-04-10T08:00:00Z')`
  );
  await db.run(
    `INSERT INTO assignment_questions (id, assignmentId, questionNumber, title, description, language, maxPoints)
     VALUES (1001, 101, 1, 'Implement Singly Linked List in C', 'Write C functions for insertion, deletion, and display of a singly linked list.', 'c', 10)`
  );

  // 2) Two similar DBMS Assignments (ID 102 and ID 103) for Scenario 3:
  //    ID 102 IS submitted by STU001; ID 103 has NULL deadline (missing deadline) and is NOT submitted
  await db.run(
    `INSERT INTO assignments (id, title, description, subject, semester, semester_no, cohort_id, audience_scope, deadline, createdBy, createdAt)
     VALUES (102, 'DBMS SQL Lab Part 1: DDL & Normalization', 'Database schema design', 'Database Management System', 'Semester 3', 3, 'coh_sem3', 'cohort', '2026-04-20', 'TCH001', '2026-04-08T08:00:00Z')`
  );
  await db.run(
    `INSERT INTO assignment_questions (id, assignmentId, questionNumber, title, description, language, maxPoints)
     VALUES (1002, 102, 1, 'Create normalized schema in SQL', 'Design 3NF tables for university library.', 'sql', 10)`
  );
  await db.run(
    `INSERT INTO submissions (id, assignmentId, questionId, questionTitle, studentId, code, language, submittedAt)
     VALUES (5001, 102, 1002, 'Create normalized schema in SQL', 'STU001', 'CREATE TABLE books (...);', 'sql', '2026-04-15T11:30:00Z')`
  );

  await db.run(
    `INSERT INTO assignments (id, title, description, subject, semester, semester_no, cohort_id, audience_scope, deadline, createdBy, createdAt)
     VALUES (103, 'DBMS SQL Lab Part 2: Joins & Triggers', 'Advanced SQL triggers', 'Database Management System', 'Semester 3', 3, 'coh_sem3', 'cohort', NULL, 'TCH001', '2026-04-12T08:00:00Z')`
  );
  await db.run(
    `INSERT INTO assignment_questions (id, assignmentId, questionNumber, title, description, language, maxPoints)
     VALUES (1003, 103, 1, 'Write SQL triggers and inner joins', 'Implement audit trigger on borrowings table.', 'sql', 10)`
  );

  // 3) Operating Systems Assignment (ID 104) with empty deadline for Scenario 12 (missing deadline)
  await db.run(
    `INSERT INTO assignments (id, title, description, subject, semester, semester_no, cohort_id, audience_scope, deadline, createdBy, createdAt)
     VALUES (104, 'OS Process Scheduling Simulation', 'Round robin CPU scheduling', 'Operating Systems', 'Semester 3', 3, 'coh_sem3', 'cohort', '', 'TCH001', '2026-04-14T08:00:00Z')`
  );
  await db.run(
    `INSERT INTO assignment_questions (id, assignmentId, questionNumber, title, description, language, maxPoints)
     VALUES (1004, 104, 1, 'Simulate Round Robin CPU Scheduling', 'Compute waiting and turnaround times.', 'c', 10)`
  );

  // Seed Examination Routine for Semester 3:
  // - Past exam: Numerical Methods on 2026-04-10 (already passed)
  // - Next exam: Data Structure and Algorithms on 2026-04-22 (5 days from 2026-04-17)
  // - Subsequent exam: Database Management System on 2026-04-26 (9 days from 2026-04-17)
  await db.run(
    `INSERT INTO routine (id, subject_name, subject_code, exam_date, calendar, weekday, exam_time, room, semester, exam_type)
     VALUES (1, 'Numerical Methods', 'MTH215', '2026-04-10', 'AD', 'Friday', '11:00 AM', 'Room 201', 3, 'Final'),
            (2, 'Data Structure and Algorithms', 'CIT211', '2026-04-22', 'AD', 'Wednesday', '11:00 AM', 'Room 302', 3, 'Final'),
            (3, 'Database Management System', 'CIT212', '2026-04-26', 'AD', 'Sunday', '11:00 AM', 'Room 305', 3, 'Final')`
  );

  // Seed Uploaded Note for DSA (Scenario 9)
  await db.run(
    `INSERT INTO files (id, title, originalName, storedName, subject, semester, semester_no, chapter, cohort_id, audience_scope, uploadedBy, uploadDate)
     VALUES (301, 'DSA Unit 3: Linked Lists, Stacks and Pointer Operations', 'dsa-unit3.pdf', 'dsa-unit3.pdf', 'Data Structure and Algorithms', 'III', 3, 'Unit 3: Linked Lists', 'coh_sem3', 'all_students', 'TCH001', '2026-04-05')`
  );
  await db.run(
    `INSERT INTO note_search_documents (id, content, extraction_status, indexed_at)
     VALUES (301, ?, 'ok', '2026-04-05T10:00:00Z')`,
    `Unit 3: Linked Lists and Pointer Operations\nA singly linked list consists of nodes where each node contains a data field and a next pointer. Insertion at the head takes O(1) time complexity, whereas searching an element takes O(n) time.`
  );

  // Seed Attendance Sessions & Records for STU001 across subjects (Scenario 11):
  // - DSA (subj_dsa): 9/10 present (90%)
  // - DBMS (subj_dbms): 7/10 present (70%)
  // - OS (subj_os): 4/10 present (40% - lowest)
  for (let i = 1; i <= 10; i++) {
    const dayStr = String(i).padStart(2, '0');
    const dateStr = `2026-03-${dayStr}`;

    await db.run(
      `INSERT INTO attendance_sessions (id, subject_id, cohort_id, semester_no, teacher_id, recorded_by_user_id, session_date, status, submitted_at)
       VALUES (?, 'subj_dsa', 'coh_sem3', 3, 'tch_1', 'TCH001', ?, 'submitted', '2026-03-${dayStr}T10:00:00Z')`,
      `sess_dsa_${i}`,
      dateStr
    );
    await db.run(
      `INSERT INTO attendance_records (id, session_id, student_id, status, marked_by)
       VALUES (?, ?, 'STU001', ?, 'TCH001')`,
      `rec_dsa_${i}`,
      `sess_dsa_${i}`,
      i <= 9 ? 'present' : 'absent'
    );

    await db.run(
      `INSERT INTO attendance_sessions (id, subject_id, cohort_id, semester_no, teacher_id, recorded_by_user_id, session_date, status, submitted_at)
       VALUES (?, 'subj_dbms', 'coh_sem3', 3, 'tch_1', 'TCH001', ?, 'submitted', '2026-03-${dayStr}T11:00:00Z')`,
      `sess_dbms_${i}`,
      dateStr
    );
    await db.run(
      `INSERT INTO attendance_records (id, session_id, student_id, status, marked_by)
       VALUES (?, ?, 'STU001', ?, 'TCH001')`,
      `rec_dbms_${i}`,
      `sess_dbms_${i}`,
      i <= 7 ? 'present' : 'absent'
    );

    await db.run(
      `INSERT INTO attendance_sessions (id, subject_id, cohort_id, semester_no, teacher_id, recorded_by_user_id, session_date, status, submitted_at)
       VALUES (?, 'subj_os', 'coh_sem3', 3, 'tch_1', 'TCH001', ?, 'submitted', '2026-03-${dayStr}T12:00:00Z')`,
      `sess_os_${i}`,
      dateStr
    );
    await db.run(
      `INSERT INTO attendance_records (id, session_id, student_id, status, marked_by)
       VALUES (?, ?, 'STU001', ?, 'TCH001')`,
      `rec_os_${i}`,
      `sess_os_${i}`,
      i <= 4 ? 'present' : 'absent'
    );
  }

  invalidateCache(db);
  return db;
}

const STUDENT_CONTEXT = {
  authenticated: true,
  studentId: 'STU001',
  name: 'Aarav Sharma',
  role: 'student',
  semester: 'Semester 3',
  currentSemester: 3,
  cohortId: 'coh_sem3',
  cohort: {
    id: 'coh_sem3',
    displayName: 'Earth',
    currentSemester: 3,
    status: 'active'
  }
};

// ============================================================================
// SCENARIO 1: Find the DSA assignment deadline
// ============================================================================
test('Scenario 1: Find the DSA assignment deadline', async () => {
  const db = await createSeededAgentTestDb();
  try {
    const res = await handleChat(
      db,
      'What is the deadline for my DSA assignment?',
      STUDENT_CONTEXT,
      [],
      'sess-s1',
      { referenceDate: REFERENCE_DATE }
    );

    // 1. Intent understanding
    assert.ok(res.agentTrace, 'Expected Kyana Agent Engine V1 trace');
    assert.ok(res.agentTrace.understanding.intents.includes('assignment_deadline'));
    assert.equal(res.agentTrace.understanding.entities.subject, 'Data Structure and Algorithms');

    // 2. Correct tool selection
    const calledTools = res.agentTrace.toolCalls.map(t => t.tool);
    assert.ok(calledTools.includes('resolve_subject_topic'));
    assert.ok(calledTools.includes('search_assignments'));
    assert.ok(calledTools.includes('calculate_deadline_status'));

    // 3. Correct resource retrieval & authorization
    assert.equal(res.matchedAssignments.length, 1);
    assert.equal(res.matchedAssignments[0].id, 101);
    assert.equal(res.agentTrace.verification.authorized, true);

    // 4. Correct calculation & final answer quality
    assert.match(res.reply, /DSA Lab 1: Singly Linked List & Stack/);
    assert.match(res.reply, /2026-04-24/);
    assert.match(res.reply, /7 days remaining/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 2: Calculate days remaining until a deadline
// ============================================================================
test('Scenario 2: Calculate days remaining until a deadline', async () => {
  const db = await createSeededAgentTestDb();
  try {
    const res = await handleChat(
      db,
      'How many days are left for my DSA assignment?',
      STUDENT_CONTEXT,
      [],
      'sess-s2',
      { referenceDate: REFERENCE_DATE }
    );

    assert.ok(res.agentTrace.understanding.intents.includes('assignment_deadline'));
    const calledTools = res.agentTrace.toolCalls.map(t => t.tool);
    assert.ok(calledTools.includes('get_current_datetime'), 'Must retrieve authoritative server clock');
    assert.ok(calledTools.includes('calculate_deadline_status'), 'Must deterministically calculate days remaining');

    assert.equal(res.matchedAssignments[0].deadlineInfo.daysRemaining, 7);
    assert.match(res.reply, /7 days remaining/i);
    assert.match(res.reply, /2026-04-24/);
    assert.match(res.reply, /not submitted/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 3: Identify multiple assignments with similar names
// ============================================================================
test('Scenario 3: Identify multiple assignments with similar names and distinguish them', async () => {
  const db = await createSeededAgentTestDb();
  try {
    const res = await handleChat(
      db,
      'How many days left for my DBMS SQL Lab assignment?',
      STUDENT_CONTEXT,
      [],
      'sess-s3',
      { referenceDate: REFERENCE_DATE }
    );

    assert.equal(res.agentTrace.understanding.entities.subject, 'Database Management System');
    assert.equal(res.matchedAssignments.length, 2, 'Should retrieve both matching DBMS SQL Lab assignments');

    // Verify both similar assignments are distinguished in the reply along with a clarifying question
    assert.match(res.reply, /2 matching assignments/i);
    assert.match(res.reply, /DBMS SQL Lab Part 1: DDL & Normalization/);
    assert.match(res.reply, /DBMS SQL Lab Part 2: Joins & Triggers/);
    assert.match(res.reply, /3 days remaining/i);
    assert.match(res.reply, /No deadline specified/i);
    assert.match(res.reply, /Which of these assignments/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 4: Check whether an assignment was submitted
// ============================================================================
test('Scenario 4: Check whether an assignment was submitted', async () => {
  const db = await createSeededAgentTestDb();
  try {
    const res = await handleChat(
      db,
      'Have I submitted my DSA assignment?',
      STUDENT_CONTEXT,
      [],
      'sess-s4',
      { referenceDate: REFERENCE_DATE }
    );

    assert.ok(res.agentTrace.understanding.intents.includes('submission_status'));
    const calledTools = res.agentTrace.toolCalls.map(t => t.tool);
    assert.ok(calledTools.includes('check_submission_status'));
    assert.equal(res.matchedAssignments.length, 1);
    assert.equal(res.matchedAssignments[0].submitted, false);
    assert.match(res.reply, /not submitted/i);

    // Also verify an assignment that WAS submitted (ID 102 in DBMS)
    const historyWithDbmsPart1 = [
      {
        role: 'user',
        content: 'Tell me about DBMS SQL Lab Part 1'
      },
      {
        role: 'assistant',
        content: '**DBMS SQL Lab Part 1: DDL & Normalization** is due on 2026-04-20.',
        matchedAssignments: [{ id: 102, title: 'DBMS SQL Lab Part 1: DDL & Normalization', subject: 'Database Management System' }]
      }
    ];
    const resSubmitted = await handleChat(
      db,
      'Have I submitted it?',
      STUDENT_CONTEXT,
      historyWithDbmsPart1,
      'sess-s4b',
      { referenceDate: REFERENCE_DATE }
    );
    assert.equal(resSubmitted.matchedAssignments.length, 1);
    assert.equal(resSubmitted.matchedAssignments[0].id, 102);
    assert.equal(resSubmitted.matchedAssignments[0].fullySubmitted, true);
    assert.match(resSubmitted.reply, /You have \*\*submitted\*\* this assignment/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 5: Find all unsubmitted assignments
// ============================================================================
test('Scenario 5: Find all unsubmitted assignments', async () => {
  const db = await createSeededAgentTestDb();
  try {
    const res = await handleChat(
      db,
      'Show me all my unsubmitted assignments.',
      STUDENT_CONTEXT,
      [],
      'sess-s5',
      { referenceDate: REFERENCE_DATE }
    );

    assert.ok(res.agentTrace.understanding.intents.includes('unsubmitted_assignments'));
    const calledTools = res.agentTrace.toolCalls.map(t => t.tool);
    assert.ok(calledTools.includes('check_submission_status'));

    // STU001 submitted ID 102, while IDs 101, 103, and 104 are unsubmitted (3 total)
    assert.match(res.reply, /3 unsubmitted assignments/i);
    assert.match(res.reply, /DSA Lab 1: Singly Linked List & Stack/);
    assert.match(res.reply, /DBMS SQL Lab Part 2: Joins & Triggers/);
    assert.match(res.reply, /OS Process Scheduling Simulation/);
    assert.doesNotMatch(res.reply, /DBMS SQL Lab Part 1: DDL & Normalization/);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 6: Identify the next examination
// ============================================================================
test('Scenario 6: Identify the next examination', async () => {
  const db = await createSeededAgentTestDb();
  try {
    const res = await handleChat(
      db,
      'When is the next exam?',
      STUDENT_CONTEXT,
      [],
      'sess-s6',
      { referenceDate: REFERENCE_DATE }
    );

    assert.ok(res.agentTrace.understanding.intents.includes('next_examination'));
    const calledTools = res.agentTrace.toolCalls.map(t => t.tool);
    assert.ok(calledTools.includes('get_current_datetime'));
    assert.ok(calledTools.includes('get_routine'));

    // Numerical Methods (2026-04-10) is in the past; next exam is DSA on 2026-04-22 (5 days remaining)
    assert.match(res.reply, /Data Structure and Algorithms/);
    assert.match(res.reply, /2026-04-22/);
    assert.match(res.reply, /5 days/i);
    assert.match(res.reply, /Database Management System/);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 7: Detect an outdated class resumption announcement
// ============================================================================
test('Scenario 7: Detect an outdated class resumption announcement', async () => {
  const db = await createSeededAgentTestDb();
  try {
    // Insert only an outdated class resumption notice from March 2026 (effective date 2026-03-25 < 2026-04-17)
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, semester_no, cohort_id, audience_scope, target_all_semesters, visibility, moderation_status, created_at)
       VALUES (401, 'TCH001', 'Class Resumption Notice After Holi Break', 'All BIT Semester 3 regular classes will resume from 2026-03-25 at 7:00 AM.', 'notice', 'notice', 3, 'coh_sem3', 'all_students', 1, 'everyone', 'active', '2026-03-20T09:00:00Z')`
    );

    const res = await handleChat(
      db,
      'When do our regular classes resume?',
      STUDENT_CONTEXT,
      [],
      'sess-s7',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );

    assert.ok(res.agentTrace.understanding.intents.includes('class_resumption_notice'));
    const calledTools = res.agentTrace.toolCalls.map(t => t.tool);
    assert.ok(calledTools.includes('compare_sources'));
    assert.equal(res.agentTrace.verification.hasOutdatedOnlyNotices, true);

    assert.match(res.reply, /2026-03-25/);
    assert.match(res.reply, /outdated|already passed/i);
    assert.match(res.reply, /no current confirmed official notice/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 8: Resolve a follow-up question using conversation context
// ============================================================================
test('Scenario 8: Resolve contextual follow-up questions (both academic tutoring and assignment follow-ups)', async () => {
  const db = await createSeededAgentTestDb();
  try {
    // Part A: Academic tutoring follow-up: "Explain linked lists." -> "Give me an example in C."
    const followUpTutor = await handleChat(
      db,
      'Give me an example in C.',
      STUDENT_CONTEXT,
      [
        { role: 'user', content: 'Explain linked lists.' },
        { role: 'assistant', content: 'A linked list is a linear data structure of nodes connected via pointers.' }
      ],
      'sess-s8a',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );

    assert.match(followUpTutor.agentTrace.understanding.entities.topic || '', /linked list/i);
    assert.equal(followUpTutor.agentTrace.understanding.entities.programmingLanguage, 'C');
    assert.match(followUpTutor.reply, /Linked List/i);
    assert.match(followUpTutor.reply, /```c/);
    assert.match(followUpTutor.reply, /struct Node/);

    // Part B: Assignment follow-up: "What about my assignment?" after discussing DSA -> "Have I submitted it?"
    const turn1History = [
      { role: 'user', content: 'Tell me about Data Structure and Algorithms.' },
      { role: 'assistant', content: 'Data Structure and Algorithms (CIT211) is a Semester 3 subject.' }
    ];
    const turn2 = await handleChat(
      db,
      'What about my assignment?',
      STUDENT_CONTEXT,
      turn1History,
      'sess-s8b',
      { referenceDate: REFERENCE_DATE }
    );
    assert.equal(turn2.agentTrace.understanding.entities.subject, 'Data Structure and Algorithms');
    assert.match(turn2.reply, /DSA Lab 1: Singly Linked List & Stack/);

    const turn3 = await handleChat(
      db,
      'Have I submitted it?',
      STUDENT_CONTEXT,
      [
        ...turn1History,
        { role: 'user', content: 'What about my assignment?' },
        { role: 'assistant', content: turn2.reply, matchedAssignments: turn2.matchedAssignments }
      ],
      'sess-s8b',
      { referenceDate: REFERENCE_DATE }
    );
    assert.equal(turn3.matchedAssignments[0].id, 101);
    assert.match(turn3.reply, /not submitted/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 9: Find relevant notes for an academic topic
// ============================================================================
test('Scenario 9: Find relevant notes for an academic topic', async () => {
  const db = await createSeededAgentTestDb();
  try {
    const res = await handleChat(
      db,
      'Find relevant notes for linked lists in DSA',
      STUDENT_CONTEXT,
      [],
      'sess-s9',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );

    assert.ok(res.agentTrace.understanding.intents.includes('notes_lookup'));
    const calledTools = res.agentTrace.toolCalls.map(t => t.tool);
    assert.ok(calledTools.includes('search_notes'));

    assert.ok(res.matchedFiles.length >= 1, 'Expected uploaded DSA note to be retrieved');
    assert.equal(res.matchedFiles[0].id, 301);
    assert.match(res.reply, /DSA Unit 3: Linked Lists, Stacks and Pointer Operations/);
    assert.ok(res.resourceCards.some(c => c.type === 'note' && Number(c.id) === 301));
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 10: Explain a topic when university notes are unavailable
// ============================================================================
test('Scenario 10: Explain a topic when university notes are unavailable (academic knowledge fallback)', async () => {
  const db = await createSeededAgentTestDb();
  try {
    const res = await handleChat(
      db,
      'Explain deadlock prevention in Operating Systems when university notes are unavailable.',
      STUDENT_CONTEXT,
      [],
      'sess-s10',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );

    assert.ok(res.agentTrace.understanding.intents.includes('academic_tutoring'));
    const calledTools = res.agentTrace.toolCalls.map(t => t.tool);
    assert.ok(calledTools.includes('search_notes'), 'Must first check university notes');
    assert.ok(calledTools.includes('get_syllabus'), 'Must replan to check syllabus when notes are unavailable');
    assert.equal(res.matchedFiles.length, 0, 'No uploaded OS note exists in DB');

    assert.match(res.reply, /No uploaded university notes were found/i);
    assert.match(res.reply, /deadlock/i);
    assert.match(res.reply, /Operating Systems/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 11: Compare attendance across subjects
// ============================================================================
test('Scenario 11: Compare attendance across subjects', async () => {
  const db = await createSeededAgentTestDb();
  try {
    const res = await handleChat(
      db,
      'Compare my attendance across subjects.',
      STUDENT_CONTEXT,
      [],
      'sess-s11',
      { referenceDate: REFERENCE_DATE }
    );

    assert.ok(res.agentTrace.understanding.intents.includes('attendance_comparison'));
    const calledTools = res.agentTrace.toolCalls.map(t => t.tool);
    assert.ok(calledTools.includes('get_my_attendance'));

    // Verify exact attendance figures: DSA 90%, DBMS 70%, OS 40% (lowest)
    assert.match(res.reply, /Highest Attendance:\*\* \*\*Data Structure and Algorithms\*\*.*90%/i);
    assert.match(res.reply, /Lowest Recorded Attendance:\*\* \*\*Operating Systems\*\*.*40%/i);
    assert.match(res.reply, /Below 50% \(Low Attendance\):\*\* \*\*Operating Systems\*\* \(40%\)/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 12: Handle missing deadlines without hallucinating
// ============================================================================
test('Scenario 12: Handle missing deadlines without hallucinating', async () => {
  const db = await createSeededAgentTestDb();
  try {
    const res = await handleChat(
      db,
      'How many days left for my OS assignment?',
      STUDENT_CONTEXT,
      [],
      'sess-s12',
      { referenceDate: REFERENCE_DATE }
    );

    assert.equal(res.agentTrace.understanding.entities.subject, 'Operating Systems');
    assert.equal(res.matchedAssignments.length, 1);
    assert.equal(res.matchedAssignments[0].id, 104);
    assert.equal(res.matchedAssignments[0].deadlineInfo.hasDeadline, false);
    assert.equal(res.agentTrace.verification.missingDeadlinesCount, 1);

    assert.match(res.reply, /OS Process Scheduling Simulation/);
    assert.match(res.reply, /does \*\*not\*\* have a deadline specified/i);
    assert.doesNotMatch(res.reply, /\d+\s+days\s+remaining/i, 'Must never hallucinate days remaining when deadline is missing');
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 13: Handle conflicting official notices
// ============================================================================
test('Scenario 13: Handle conflicting official notices by prioritizing newer confirmed official notice', async () => {
  const db = await createSeededAgentTestDb();
  try {
    // Older notice (published 2026-04-12): classes resume on 2026-04-20
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, semester_no, cohort_id, audience_scope, target_all_semesters, visibility, moderation_status, created_at)
       VALUES (402, 'TCH001', 'Spring Break Class Resumption Notice', 'Regular BIT Semester 3 classes will resume on 2026-04-20.', 'notice', 'notice', 3, 'coh_sem3', 'all_students', 1, 'everyone', 'active', '2026-04-12T10:00:00Z')`
    );

    // Newer confirmed official Admin notice (published 2026-04-16): classes resume on 2026-04-25 instead
    await db.run(
      `INSERT INTO students (studentId, username, name, email, password, role, department, semester, cohort_id, account_status)
       VALUES ('ADMIN01', 'admin', 'Dean Office', 'dean@gu.edu.np', 'hash', 'admin', 'BIT', 'Semester 3', NULL, 'active')`
    );
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, semester_no, cohort_id, audience_scope, target_all_semesters, visibility, moderation_status, created_at)
       VALUES (403, 'ADMIN01', 'Updated Official Notice: Class Resumption Postponed', 'Due to ongoing university examinations, BIT Semester 3 classes will now resume on 2026-04-25 instead of the earlier schedule.', 'notice', 'notice', 3, 'coh_sem3', 'all_students', 1, 'everyone', 'active', '2026-04-16T14:00:00Z')`
    );

    const res = await handleChat(
      db,
      'When do our classes resume after break?',
      STUDENT_CONTEXT,
      [],
      'sess-s13',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );

    assert.equal(res.agentTrace.verification.hasConflictingNotices, true);
    assert.match(res.reply, /Updated Official Notice: Class Resumption Postponed/);
    assert.match(res.reply, /2026-04-25/);
    assert.match(res.reply, /supersedes the earlier announcement/i);
    assert.match(res.reply, /Spring Break Class Resumption Notice/);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 14: Reject unauthorized student record access
// ============================================================================
test('Scenario 14: Reject unauthorized student record access server-side', async () => {
  const db = await createSeededAgentTestDb();
  try {
    // 14a: Student STU001 tries to access STU002 (Bikash's) attendance or submissions
    const resOtherStudent = await handleChat(
      db,
      "Show me Bikash's attendance and assignment submissions.",
      STUDENT_CONTEXT,
      [],
      'sess-s14a',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );

    assert.equal(resOtherStudent.intent, 'cross_student');
    assert.equal(resOtherStudent.resourceCards.length, 0);
    assert.match(resOtherStudent.reply, /can't look up or confirm another student|only show your own personal academic records/i);

    // 14b: Teacher tries to query an individual student's private attendance in chat
    const teacherContext = {
      authenticated: true,
      studentId: 'TCH001',
      name: 'Prof. Ramesh Adhikari',
      role: 'teacher',
      assignedSemesters: [3],
      assignedSubjects: ['Data Structure and Algorithms']
    };
    const resTeacherIndividual = await handleChat(
      db,
      "What is Aarav's attendance percentage?",
      teacherContext,
      [],
      'sess-s14b',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );
    assert.equal(resTeacherIndividual.intent, 'cross_student');
    assert.match(resTeacherIndividual.reply, /can't look up or confirm individual students' marks or attendance in chat/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 15: Handle Romanized Nepali queries
// ============================================================================
test('Scenario 15: Handle Romanized Nepali queries naturally and accurately', async () => {
  const db = await createSeededAgentTestDb();
  try {
    // 15a: "DSA ko assignment kahile samma ho?"
    const resDeadline = await handleChat(
      db,
      'DSA ko assignment kahile samma ho?',
      STUDENT_CONTEXT,
      [],
      'sess-s15a',
      { referenceDate: REFERENCE_DATE }
    );
    assert.ok(resDeadline.agentTrace.understanding.intents.includes('assignment_deadline'));
    assert.equal(resDeadline.agentTrace.understanding.entities.subject, 'Data Structure and Algorithms');
    assert.match(resDeadline.reply, /2026-04-24/);
    assert.match(resDeadline.reply, /7 days remaining/i);

    // 15b: "Yo topic bujhaideu" (follow-up on linked list)
    const resTutor = await handleChat(
      db,
      'Yo topic bujhaideu',
      STUDENT_CONTEXT,
      [
        { role: 'user', content: 'DSA ko linked list chapter padirako xu' },
        { role: 'assistant', content: 'Linked list DSA Unit 3 ma parcha.' }
      ],
      'sess-s15b',
      { referenceDate: REFERENCE_DATE, useAgentEngine: true }
    );
    assert.ok(resTutor.agentTrace.understanding.intents.includes('academic_tutoring'));
    assert.match(resTutor.reply, /Linked List/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 16: Handle multi-step questions requiring several tools
// ============================================================================
test('Scenario 16: Handle multi-step questions requiring several tools in a single turn', async () => {
  const db = await createSeededAgentTestDb();
  try {
    const res = await handleChat(
      db,
      'How many days are left for my DSA assignment, have I submitted it, and when is my next exam?',
      STUDENT_CONTEXT,
      [],
      'sess-s16',
      { referenceDate: REFERENCE_DATE }
    );

    // Verify multiple intents detected and executed in one coordinated agent loop
    const intents = res.agentTrace.understanding.intents;
    assert.ok(intents.includes('assignment_deadline'));
    assert.ok(intents.includes('submission_status'));
    assert.ok(intents.includes('next_examination'));

    const calledTools = res.agentTrace.toolCalls.map(t => t.tool);
    assert.ok(calledTools.includes('resolve_subject_topic'));
    assert.ok(calledTools.includes('get_current_datetime'));
    assert.ok(calledTools.includes('check_submission_status'));
    assert.ok(calledTools.includes('calculate_deadline_status'));
    assert.ok(calledTools.includes('get_routine'));
    assert.ok(calledTools.includes('verify_evidence'));

    // Verify combined multi-step answer covers assignment countdown, submission status, and next exam
    assert.match(res.reply, /7 days remaining/i);
    assert.match(res.reply, /not submitted/i);
    assert.match(res.reply, /next examination is \*\*Data Structure and Algorithms\*\*/i);
    assert.match(res.reply, /2026-04-22/);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 17: Recover from a failed tool call
// ============================================================================
test('Scenario 17: Recover gracefully from a failed tool call via replanning', async () => {
  const db = await createSeededAgentTestDb();
  try {
    // Inject a failure on `search_assignments` — the agent loop must catch the error,
    // record it in the trace, replan to `get_assignment_details`, and still answer accurately!
    const res = await handleChat(
      db,
      'How many days are left for my DSA assignment?',
      STUDENT_CONTEXT,
      [],
      'sess-s17',
      {
        referenceDate: REFERENCE_DATE,
        failTools: ['search_assignments']
      }
    );

    const failedStep = res.agentTrace.toolCalls.find(t => t.tool === 'search_assignments');
    assert.ok(failedStep, 'search_assignments should have been attempted');
    assert.equal(failedStep.status, 'error');

    const replanStep = res.agentTrace.steps.find(s => s.phase === 'REPLAN');
    assert.ok(replanStep, 'Agent must replan after search_assignments failed');

    const recoveryStep = res.agentTrace.toolCalls.find(t => t.tool === 'get_assignment_details');
    assert.ok(recoveryStep, 'Agent must execute fallback tool get_assignment_details');
    assert.equal(recoveryStep.status, 'ok');

    assert.match(res.reply, /DSA Lab 1: Singly Linked List & Stack/);
    assert.match(res.reply, /7 days remaining/i);
  } finally {
    db.close();
  }
});

// ============================================================================
// SCENARIO 18: Maintain consistent behaviour across web and mobile
// ============================================================================
test('Scenario 18: Maintain consistent behaviour across Web (JSON/SSE) and React Native Mobile SSE', async () => {
  const db = await createSeededAgentTestDb();
  try {
    // Create the production HTTP handler from lib/chat-http.js using our handleChat
    const chatHandler = createChatHandler(db, {
      handleChat: (d, msg, stu, hist, sid, opts) =>
        handleChat(d, msg, stu, hist, sid, { ...opts, academicContext: STUDENT_CONTEXT, referenceDate: REFERENCE_DATE })
    });

    // 18a: Web JSON request (`Accept: application/json`)
    let webJsonStatus = 200;
    let webJsonPayload = null;
    const webReq = {
      body: {
        message: 'How many days are left for my DSA assignment?',
        history: []
      },
      headers: { accept: 'application/json' },
      user: STUDENT_CONTEXT,
      session: { studentId: 'STU001', studentName: 'Aarav Sharma', role: 'student', semester: 'Semester 3', chatMode: 'roast', save: cb => cb?.() },
      on: () => {},
      off: () => {}
    };
    const webRes = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      status(code) { webJsonStatus = code; return this; },
      set() { return this; },
      json(data) { webJsonPayload = data; this.writableEnded = true; return this; },
      setHeader() {},
      flushHeaders() {},
      write() {},
      end() { this.writableEnded = true; },
      on: () => {},
      off: () => {}
    };

    await chatHandler(webReq, webRes);
    assert.equal(webJsonStatus, 200);
    assert.ok(webJsonPayload);
    assert.match(webJsonPayload.reply, /DSA Lab 1: Singly Linked List & Stack/);
    assert.match(webJsonPayload.reply, /7 days remaining/i);
    assert.ok(Array.isArray(webJsonPayload.resourceCards));
    assert.equal(webJsonPayload.resourceCards.length, 1);
    assert.equal(webJsonPayload.resourceCards[0].type, 'assignment');
    assert.equal(webJsonPayload.resourceCards[0].id, 101);

    // 18b: Mobile / Web SSE streaming request (`stream: true`, `Accept: text/event-stream`)
    const sseChunks = [];
    const sseReq = {
      body: {
        message: 'How many days are left for my DSA assignment?',
        history: [],
        stream: true
      },
      headers: { accept: 'text/event-stream' },
      user: STUDENT_CONTEXT,
      session: { studentId: 'STU001', studentName: 'Aarav Sharma', role: 'student', semester: 'Semester 3', chatMode: 'roast', save: cb => cb?.() },
      on: () => {},
      off: () => {}
    };
    const sseRes = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      status() { return this; },
      set() { return this; },
      setHeader() {},
      flushHeaders() { this.headersSent = true; },
      write(chunk) { sseChunks.push(String(chunk)); },
      end() { this.writableEnded = true; },
      on: () => {},
      off: () => {}
    };

    await chatHandler(sseReq, sseRes);

    // Parse SSE stream using the actual React Native Mobile `createKyanaSseParser` from `mobile/services/kyana.ts`
    const createKyanaSseParser = loadMobileSseParser();
    const mobileDeltas = [];
    let mobileResultPayload = null;
    let mobileDone = false;

    const mobileParser = createKyanaSseParser({
      onDelta: (chunk) => mobileDeltas.push(chunk),
      onResult: (payload) => { mobileResultPayload = payload; },
      onDone: () => { mobileDone = true; }
    });

    const rawSse = sseChunks.join('');
    mobileParser.feed(rawSse, true);

    assert.ok(mobileResultPayload, 'Mobile SSE parser must receive final result payload');
    assert.equal(mobileResultPayload.reply, webJsonPayload.reply, 'Web JSON and Mobile SSE replies must be identical');
    assert.equal(mobileDeltas.join(''), webJsonPayload.reply, 'Streamed delta text must match final verified reply');
    assert.deepEqual(mobileResultPayload.resourceCards, webJsonPayload.resourceCards, 'Resource cards must match across Web and Mobile');
    assert.equal(mobileResultPayload.resourceCards[0].mobileRoute, '/assignments/101', 'Mobile deep link route must be populated');
  } finally {
    db.close();
  }
});
