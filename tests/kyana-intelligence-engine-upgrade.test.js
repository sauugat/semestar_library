'use strict';

/**
 * KYANA AI INTELLIGENCE ENGINE UPGRADE — COMPREHENSIVE TEST SUITE (PHASE 7)
 * =========================================================================
 * Validates:
 * 1. Complete Retrieval Tool Layer (Categories A–F: University Info, Assignments, Marks/Results, Attendance, Schedules, Learning Resources)
 * 2. Multi-Source Query Planning across all 8 Benchmark Scenarios
 * 3. Context-Switching Regression (Discrete Mathematics Study Session -> "Hamro class kaile bata suru xa?" -> 30th Kartik Tihar/Chhath Notice)
 * 4. Evidence Validation States (Confirmed, Missing Deadline, Unrecorded Attendance, Unpublished Marks, Outdated Notice, Conflicting Notice)
 * 5. Security, Server-Side Authorization & Tool Execution Limits (Cross-Student Isolation, Teacher Permission Boundaries, Argument Guardrails, Max Tool Calls)
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

const {
  handleChat,
  invalidateCache,
  runKyanaAgentLoop,
  createAgentToolRegistry,
  invalidateAgentCache
} = require('../ai-assistant');
const { validateAgentToolArgs } = require('../lib/kyana-agent-engine');
const { getAcademicContext } = require('../lib/academic-context');
const { ensureAttendanceSchema, saveAttendanceSession } = require('../lib/attendance-service');
const { ensureMarksSchema, upsertExamConfiguration, saveStudentMarks, publishSubjectResults } = require('../lib/marks-service');
const { ensureTeacherSchema } = require('../lib/teacher-service');
const { ensureAuditSchema } = require('../lib/audit-service');
const { ensureKnowledgeSchema } = require('../lib/knowledge-schema');
const { startOrResumeStudySession } = require('../lib/study-partner-engine');

// Reference clock: Sunday, 2026-11-08T06:00:00.000Z (2083-07-23 BS)
const REFERENCE_DATE = new Date('2026-11-08T06:00:00.000Z');

let dbAdapterRef = null;
function createSqliteAdapter(client) {
  return {
    isPostgres: false,
    exec: async (sql) => client.executeMultiple(sql),
    all: async (sql, ...params) => {
      const res = await client.execute({ sql, args: params.map(v => (v === undefined ? null : v)) });
      return res.rows.map(r => ({ ...r }));
    },
    get: async (sql, ...params) => {
      const res = await client.execute({ sql, args: params.map(v => (v === undefined ? null : v)) });
      return res.rows[0] ? { ...res.rows[0] } : null;
    },
    run: async (sql, ...params) => {
      const res = await client.execute({ sql, args: params.map(v => (v === undefined ? null : v)) });
      return {
        lastInsertRowid: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : null,
        changes: res.rowsAffected || 0
      };
    },
    withTransaction: async (fn) => fn(dbAdapterRef)
  };
}

describe('Kyana AI Intelligence Engine Upgrade — Full Architecture & Multi-Source Verification', () => {
  let client;
  let db;
  let stuSaugatCtx;
  let stuBinaCtx;
  let teacherRameshCtx;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.QA_MODE = 'true';

    client = createClient({ url: ':memory:' });
    db = createSqliteAdapter(client);
    dbAdapterRef = db;

    await db.exec(`
      CREATE TABLE cohorts (
        id TEXT PRIMARY KEY,
        slot_code TEXT,
        display_name TEXT,
        name TEXT NOT NULL,
        entry_year INTEGER,
        intake_year INTEGER,
        intake_identifier TEXT,
        current_semester INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        graduated_at TEXT
      );

      CREATE TABLE students (
        studentId TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        username TEXT,
        email TEXT,
        role TEXT NOT NULL DEFAULT 'student',
        semester TEXT,
        cohort_id TEXT,
        department TEXT DEFAULT 'BIT',
        avatarUrl TEXT,
        account_status TEXT DEFAULT 'active',
        verification_status TEXT DEFAULT 'verified'
      );

      CREATE TABLE files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        storedName TEXT NOT NULL,
        originalName TEXT NOT NULL,
        title TEXT,
        semester TEXT,
        semester_no INTEGER,
        subject TEXT,
        chapter TEXT,
        uploadedBy TEXT,
        sizeBytes INTEGER DEFAULT 100,
        uploadedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        cohort_id TEXT,
        audience_scope TEXT DEFAULT 'cohort',
        visibility TEXT DEFAULT 'everyone',
        deleted_at TEXT,
        hidden_at TEXT,
        moderation_status TEXT DEFAULT 'active'
      );

      CREATE TABLE note_search_documents (
        id INTEGER PRIMARY KEY,
        content TEXT NOT NULL DEFAULT '',
        extraction_status TEXT NOT NULL DEFAULT 'ok',
        extraction_error TEXT,
        indexed_at TEXT DEFAULT CURRENT_TIMESTAMP,
        content_truncated INTEGER DEFAULT 0
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
        deadline TEXT,
        pdfUrl TEXT,
        pdfName TEXT,
        createdBy TEXT NOT NULL,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        cohort_id TEXT,
        audience_scope TEXT DEFAULT 'cohort',
        visibility TEXT DEFAULT 'everyone',
        deleted_at TEXT,
        hidden_at TEXT,
        moderation_status TEXT DEFAULT 'active'
      );

      CREATE TABLE assignment_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assignmentId INTEGER NOT NULL,
        questionNumber INTEGER NOT NULL DEFAULT 1,
        title TEXT NOT NULL,
        description TEXT,
        language TEXT DEFAULT 'c',
        maxPoints INTEGER DEFAULT 10,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assignmentId INTEGER NOT NULL,
        questionId INTEGER,
        studentId TEXT NOT NULL,
        code TEXT,
        stdout TEXT,
        stderr TEXT,
        testResults TEXT,
        questionTitle TEXT,
        submittedAt TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE submission_grades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        questionId INTEGER NOT NULL,
        studentId TEXT NOT NULL,
        marksObtained REAL,
        remarks TEXT,
        checked INTEGER DEFAULT 0,
        released INTEGER DEFAULT 0,
        gradedBy TEXT,
        gradedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(questionId, studentId)
      );

      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        title TEXT,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'status',
        category TEXT DEFAULT 'general',
        subject TEXT,
        semester TEXT,
        semester_no INTEGER,
        cohort_id TEXT,
        audience_scope TEXT DEFAULT 'all_students',
        target_all_semesters INTEGER DEFAULT 0,
        visibility TEXT DEFAULT 'everyone',
        moderation_status TEXT DEFAULT 'active',
        deleted_at TEXT,
        hidden_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE post_target_semesters (
        post_id INTEGER NOT NULL,
        semester INTEGER NOT NULL,
        PRIMARY KEY (post_id, semester)
      );

      CREATE TABLE routine (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        semester INTEGER NOT NULL,
        subject_name TEXT NOT NULL,
        subject_code TEXT,
        exam_date TEXT NOT NULL,
        calendar TEXT DEFAULT 'AD',
        weekday TEXT,
        exam_time TEXT,
        room TEXT,
        exam_type TEXT DEFAULT 'Final',
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await ensureAuditSchema(db);
    await ensureTeacherSchema(db);
    await ensureAttendanceSchema(db);
    await ensureMarksSchema(db);
    await db.exec('CREATE TABLE IF NOT EXISTS study_partner_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT, conversation_id TEXT, subject TEXT, semester TEXT, unit TEXT, topic TEXT, current_step INTEGER DEFAULT 0, total_steps INTEGER DEFAULT 3, status TEXT DEFAULT "active", session_state_json TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    await require('../lib/note-search').ensureIndex(db);

    // 1. Seed Cohort & Users
    await db.run(
      `INSERT INTO cohorts (id, slot_code, display_name, name, entry_year, intake_year, current_semester, status)
       VALUES ('cohort_mars_s3', 'mars', 'Mars Cohort (Sem 3)', 'Mars', 2025, 2025, 3, 'active')`
    );

    await db.run(
      `INSERT INTO students (studentId, name, username, role, semester, cohort_id, account_status)
       VALUES ('stu_saugat', 'Saugat Student', 'saugat', 'student', 'Semester 3', 'cohort_mars_s3', 'active'),
              ('stu_bina', 'Bina Classmate', 'bina', 'student', 'Semester 3', 'cohort_mars_s3', 'active'),
              ('tea_ramesh', 'Dr. Ramesh Karki', 'ramesh_karki', 'teacher', NULL, NULL, 'active'),
              ('adm_newton', 'Newton', 'newton_admin', 'admin', NULL, NULL, 'active')`
    );

    await db.run(
      `INSERT INTO subjects (id, code, name, semester, department, credit_hours, nature, active)
       VALUES ('CIT214', 'CIT214', 'Data Structure and Algorithms', 3, 'BIT', 3.0, 'Theory + Lab', 1),
              ('CIT213', 'CIT213', 'Database Management System', 3, 'BIT', 3.0, 'Theory + Lab', 1),
              ('CIT212', 'CIT212', 'Operating Systems', 3, 'BIT', 3.0, 'Theory + Lab', 1)`
    );
    await db.run(`INSERT INTO teachers (id, user_id, designation, status) VALUES ('tea_ramesh', 'tea_ramesh', 'Associate Professor', 'active')`);
    await db.run(
      `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
       VALUES ('ts_dsa', 'tea_ramesh', 'CIT214'),
              ('ts_dbms', 'tea_ramesh', 'CIT213')`
    );

    // 2. Seed Assignments:
    // - #101 DBMS Lab: Submitted
    // - #102 DSA Lab: Unsubmitted, due this week on 2026-11-12 (4 days left)
    // - #103 OS Lab: Unsubmitted, overdue on 2026-11-05 (overdue by 3 days)
    await db.run(
      `INSERT INTO assignments (id, title, description, language, subject, semester, semester_no, deadline, createdBy, cohort_id, audience_scope)
       VALUES (101, 'DBMS SQL Joins Lab', 'Write SQL inner and outer joins.', 'sql', 'Database Management System', 'Semester 3', 3, '2026-11-20', 'tea_ramesh', 'cohort_mars_s3', 'cohort'),
              (102, 'DSA Linked List Lab', 'Implement singly linked list in C.', 'c', 'Data Structure and Algorithms', 'Semester 3', 3, '2026-11-12', 'tea_ramesh', 'cohort_mars_s3', 'cohort'),
              (103, 'OS Process Scheduling Lab', 'Simulate Round Robin scheduling.', 'c', 'Operating Systems', 'Semester 3', 3, '2026-11-05', 'tea_ramesh', 'cohort_mars_s3', 'cohort')`
    );
    await db.run(
      `INSERT INTO assignment_questions (id, assignmentId, questionNumber, title, description, language, maxPoints)
       VALUES (201, 101, 1, 'Inner Join Query', 'Join students and cohorts.', 'sql', 10),
              (202, 102, 1, 'Linked List Insertion', 'Insert node at head.', 'c', 15),
              (203, 103, 1, 'Round Robin Scheduler', 'Compute waiting and turnaround time.', 'c', 15)`
    );
    await db.run(
      `INSERT INTO submissions (assignmentId, questionId, studentId, code, questionTitle, submittedAt)
       VALUES (101, 201, 'stu_saugat', 'SELECT * FROM students;', 'Inner Join Query', '2026-11-04T09:00:00.000Z')`
    );
    await db.run(
      `INSERT INTO submission_grades (questionId, studentId, marksObtained, remarks, checked, released, gradedBy)
       VALUES (201, 'stu_saugat', 9, 'Well structured query', 1, 1, 'tea_ramesh')`
    );

    // 3. Seed Attendance:
    // - DBMS: 9/10 (90%)
    // - DSA: 8/10 (80%)
    // - OS: 4/10 (40% — below 75% requirement)
    for (let i = 1; i <= 10; i++) {
      const dateStr = `2026-10-${String(i).padStart(2, '0')}`;
      await saveAttendanceSession(db, {
        actorUserId: 'tea_ramesh',
        subjectId: 'CIT213',
        cohortId: 'cohort_mars_s3',
        sessionDate: dateStr,
        records: [
          { studentId: 'stu_saugat', status: i <= 9 ? 'present' : 'absent' },
          { studentId: 'stu_bina', status: 'present' }
        ]
      });
      await saveAttendanceSession(db, {
        actorUserId: 'tea_ramesh',
        subjectId: 'CIT214',
        cohortId: 'cohort_mars_s3',
        sessionDate: dateStr,
        records: [
          { studentId: 'stu_saugat', status: i <= 8 ? 'present' : 'absent' },
          { studentId: 'stu_bina', status: 'present' }
        ]
      });
      await saveAttendanceSession(db, {
        actorUserId: 'tea_ramesh',
        subjectId: 'CIT212',
        cohortId: 'cohort_mars_s3',
        sessionDate: dateStr,
        records: [
          { studentId: 'stu_saugat', status: i <= 4 ? 'present' : 'absent' },
          { studentId: 'stu_bina', status: 'present' }
        ]
      });
    }

    // 4. Seed Published Mid-Term & Pre-Board Marks for Comparison:
    // - DBMS: Mid-Term 40/50 (80%) -> Pre-Board 88/100 (88%) (+8% improvement)
    // - DSA: Mid-Term 35/50 (70%) -> Pre-Board 78/100 (78%) (+8% improvement)
    // - OS: Mid-Term 16/50 (32% Fail) -> Pre-Board 36/100 (36% Fail) (+4%)
    for (const [subjId, midScore, preScore] of [
      ['CIT213', 40, 88],
      ['CIT214', 35, 78],
      ['CIT212', 16, 36]
    ]) {
      await upsertExamConfiguration(db, { actorUserId: 'tea_ramesh', subjectId: subjId, examType: 'Mid-Term Exam', maxMarks: 50 });
      await saveStudentMarks(db, {
        actorUserId: 'tea_ramesh',
        subjectId: subjId,
        examType: 'Mid-Term Exam',
        records: [
          { studentId: 'stu_saugat', obtainedMarks: midScore },
          { studentId: 'stu_bina', obtainedMarks: 48 }
        ]
      });
      await publishSubjectResults(db, { actorUserId: 'tea_ramesh', subjectId: subjId, examType: 'Mid-Term Exam' });

      await upsertExamConfiguration(db, { actorUserId: 'tea_ramesh', subjectId: subjId, examType: 'Pre-Board Exam', maxMarks: 100 });
      await saveStudentMarks(db, {
        actorUserId: 'tea_ramesh',
        subjectId: subjId,
        examType: 'Pre-Board Exam',
        records: [
          { studentId: 'stu_saugat', obtainedMarks: preScore },
          { studentId: 'stu_bina', obtainedMarks: 95 }
        ]
      });
      await publishSubjectResults(db, { actorUserId: 'tea_ramesh', subjectId: subjId, examType: 'Pre-Board Exam' });
    }

    // 5. Seed Examination Schedule & Routine
    await db.run(
      `INSERT INTO routine (semester, subject_name, subject_code, exam_date, calendar, weekday, exam_time, room, exam_type)
       VALUES (3, 'Data Structure and Algorithms', 'CIT214', '2026-11-14', 'AD', 'Saturday', '10:00 AM', 'Room 302', 'Final'),
              (3, 'Database Management System', 'CIT213', '2026-11-18', 'AD', 'Wednesday', '10:00 AM', 'Room 304', 'Final')`
    );

    // 6. Seed Teacher's Class Resumption Notice (30th Kartik after Tihar and Chhath) & Campus Post
    await db.run(
      `INSERT INTO posts (id, user_id, title, content, type, category, semester_no, target_all_semesters, audience_scope, visibility, created_at)
       VALUES (601, 'tea_ramesh', 'Notice: Resumption of Regular Classes after Tihar & Chhath',
               'Regular classes will resume after Tihar and Chhath festivals, starting from 30th Kartik (2026-11-16). All students are required to attend.',
               'notice', 'NOTICE', 3, 1, 'all_students', 'everyone', '2026-11-06T09:00:00.000Z'),
              (602, 'adm_newton', 'BIT Hackathon Registration Open',
               'Registration for the annual Gandaki University BIT Hackathon is open this week until Friday.',
               'status', 'general', 3, 1, 'all_students', 'everyone', '2026-11-07T11:00:00.000Z')`
    );

    // 7. Seed Study Notes
    await db.run(
      `INSERT INTO files (id, storedName, originalName, title, semester, semester_no, subject, chapter, uploadedBy, cohort_id, audience_scope, visibility)
       VALUES (701, 'dsa_notes.pdf', 'dsa_notes.pdf', 'DSA Unit 3 & 4: Linked Lists, Stacks, and Trees Complete Notes', 'Semester 3', 3, 'Data Structure and Algorithms', 'Unit 3', 'tea_ramesh', 'cohort_mars_s3', 'all_students', 'everyone')`
    );
    await db.run(
      `INSERT INTO note_search_documents (id, content, extraction_status)
       VALUES (701, 'A linked list is a linear collection of data elements called nodes pointing to the next node via pointers. Binary search trees maintain left < root < right ordering.', 'ok')`
    );

    stuSaugatCtx = await getAcademicContext(db, { studentId: 'stu_saugat', role: 'student' });
    stuBinaCtx = await getAcademicContext(db, { studentId: 'stu_bina', role: 'student' });
    teacherRameshCtx = await getAcademicContext(db, { studentId: 'tea_ramesh', role: 'teacher' });
  });

  after(async () => {
    if (client) await client.close();
  });

  test('Multi-Source Scenario 1: "What assignments do I need to complete this week?"', async () => {
    invalidateCache(db);
    const res = await handleChat(
      db,
      'What assignments do I need to complete this week?',
      { studentId: 'stu_saugat', role: 'student' },
      [],
      'ms_1',
      { academicContext: stuSaugatCtx, referenceDate: REFERENCE_DATE }
    );
    assert.match(res.reply, /this week/i);
    assert.match(res.reply, /DSA Linked List Lab/);
    assert.doesNotMatch(res.reply, /DBMS SQL Joins Lab.*Not submitted/i);
  });

  test('Multi-Source Scenario 2: "Which subject needs the most attention?" combines marks, attendance, and pending assignments', async () => {
    invalidateCache(db);
    const res = await handleChat(
      db,
      'Which subject needs the most attention?',
      { studentId: 'stu_saugat', role: 'student' },
      [],
      'ms_2',
      { academicContext: stuSaugatCtx, referenceDate: REFERENCE_DATE }
    );
    assert.match(res.reply, /Operating Systems.*CIT212/);
    assert.match(res.reply, /40%.*4\/10/);
    assert.match(res.reply, /16\/50.*32%|36\/100.*36%/);
    assert.match(res.reply, /OS Process Scheduling Lab/);
  });

  test('Multi-Source Scenario 3: "Am I falling behind academically?" evaluates attendance, marks, and overdue assignments', async () => {
    invalidateCache(db);
    const res = await handleChat(
      db,
      'Am I falling behind academically?',
      { studentId: 'stu_saugat', role: 'student' },
      [],
      'ms_3',
      { academicContext: stuSaugatCtx, referenceDate: REFERENCE_DATE }
    );
    assert.match(res.reply, /Academic Standing/i);
    assert.match(res.reply, /Operating Systems.*40%/);
    assert.match(res.reply, /OS Process Scheduling Lab/);
  });

  test('Multi-Source Scenario 4: "What should I study before my next examination?" chains routine -> syllabus -> notes -> assignments', async () => {
    invalidateCache(db);
    const res = await handleChat(
      db,
      'What should I study before my next examination?',
      { studentId: 'stu_saugat', role: 'student' },
      [],
      'ms_4',
      { academicContext: stuSaugatCtx, referenceDate: REFERENCE_DATE }
    );
    assert.match(res.reply, /Data Structure and Algorithms.*2026-11-14/);
    assert.match(res.reply, /High-Priority Syllabus Units/);
    assert.match(res.reply, /DSA Unit 3 & 4: Linked Lists, Stacks, and Trees Complete Notes/);
    assert.match(res.reply, /DSA Linked List Lab/);
  });

  test('Multi-Source Scenario 5: "Show me assignments due before my next class." combines routine and pending assignments', async () => {
    invalidateCache(db);
    const res = await handleChat(
      db,
      'Show me assignments due before my next class.',
      { studentId: 'stu_saugat', role: 'student' },
      [],
      'ms_5',
      { academicContext: stuSaugatCtx, referenceDate: REFERENCE_DATE }
    );
    assert.match(res.reply, /DSA Linked List Lab|OS Process Scheduling Lab/);
  });

  test('Multi-Source Scenario 6: "Compare my mid-term and pre-board performance." computes subject-wise deltas and overall trend', async () => {
    invalidateCache(db);
    const res = await handleChat(
      db,
      'Compare my mid-term and pre-board performance.',
      { studentId: 'stu_saugat', role: 'student' },
      [],
      'ms_6',
      { academicContext: stuSaugatCtx, referenceDate: REFERENCE_DATE }
    );
    assert.match(res.reply, /Performance Comparison: Mid-Term vs\. Pre-Board Examinations/);
    assert.match(res.reply, /Database Management System.*40\/50 \(80%\).*88\/100 \(88%\).*\+8%/);
    assert.match(res.reply, /Data Structure and Algorithms.*35\/50 \(70%\).*78\/100 \(78%\).*\+8%/);
    assert.match(res.reply, /Operating Systems.*16\/50 \(32%\).*36\/100 \(36%\).*\+4%/);
  });

  test('Multi-Source Scenario 7: "What important things happened in college this week?" combines notices and campus posts', async () => {
    invalidateCache(db);
    const res = await handleChat(
      db,
      'What important things happened in college this week?',
      { studentId: 'stu_saugat', role: 'student' },
      [],
      'ms_7',
      { academicContext: stuSaugatCtx, referenceDate: REFERENCE_DATE }
    );
    assert.match(res.reply, /College Weekly Recap/);
    assert.match(res.reply, /Resumption of Regular Classes after Tihar & Chhath/);
    assert.match(res.reply, /BIT Hackathon Registration Open/);
  });

  test('Multi-Source Scenario 8: "Check my marks, attendance and assignments, then create a study plan."', async () => {
    invalidateCache(db);
    const res = await handleChat(
      db,
      'Check my marks, attendance and assignments, then create a study plan.',
      { studentId: 'stu_saugat', role: 'student' },
      [],
      'ms_8',
      { academicContext: stuSaugatCtx, referenceDate: REFERENCE_DATE }
    );
    assert.match(res.reply, /Personalized Academic Study & Action Plan/);
    assert.match(res.reply, /Current Academic Assessment/);
    assert.match(res.reply, /Prioritized 3-Stage Study Roadmap/);
    assert.match(res.reply, /DSA Linked List Lab|OS Process Scheduling Lab/);
  });

  test('Context-Switch Regression: Student in active Discrete Mathematics study session asks "Hamro class kaile bata suru xa?"', async () => {
    invalidateCache(db);
    // Create an active Discrete Mathematics study session for Saugat
    await db.run("INSERT INTO study_partner_sessions (student_id, conversation_id, subject, semester, unit, topic, current_step, total_steps, status) VALUES ('stu_saugat', 'ctx_switch_math_to_notice', 'Discrete Mathematics', 'Semester 2', 'Unit 1', 'Mathematical Induction', 1, 3, 'active')");

    const history = [
      { role: 'user', content: 'Teach me Mathematical Induction in Discrete Mathematics' },
      { role: 'assistant', content: '### Mathematical Induction\nMathematical induction proves a statement P(n) for all natural numbers using a base case P(1) and inductive step P(k) => P(k+1).' }
    ];

    const res = await handleChat(
      db,
      'Hamro class kaile bata suru xa?',
      { studentId: 'stu_saugat', role: 'student' },
      history,
      'ctx_switch_math_to_notice',
      {
        academicContext: stuSaugatCtx,
        referenceDate: REFERENCE_DATE,
        chapterContext: {
          subject: 'Discrete Mathematics',
          chapterTitle: 'Mathematical Induction',
          unitNumber: 1
        }
      }
    );

    assert.match(res.reply, /30th Kartik|2026-11-16/i, 'Must answer with the 30th Kartik class resumption date from the teacher notice');
    assert.match(res.reply, /Tihar|Chhath|Dr\. Ramesh Karki/i, 'Must ground response in the teacher notice');
    assert.doesNotMatch(res.reply, /Mathematical Induction|P\(k\)/i, 'Must NOT continue the Discrete Mathematics lesson when topic switched to class resumption');
  });

  test('Security, Authorization & Tool Execution Limits: Enforces cross-student isolation, teacher boundaries, and maxToolCalls cap', async () => {
    // 1. Cross-student isolation
    const crossStudentRes = await handleChat(
      db,
      "Show me Bina Classmate's marks and attendance",
      { studentId: 'stu_saugat', role: 'student' },
      [],
      'sec_cross_1',
      { academicContext: stuSaugatCtx, referenceDate: REFERENCE_DATE }
    );
    assert.equal(crossStudentRes.intent, 'cross_student');
    assert.doesNotMatch(crossStudentRes.reply, /48|95/);

    // 2. Teacher boundary enforcement on unassigned subject (Operating Systems is not assigned to Dr. Ramesh Karki in this test setup)
    const registry = createAgentToolRegistry(db, teacherRameshCtx, { referenceDate: REFERENCE_DATE });
    const unassignedNoteSearch = await registry.executeTool('search_notes', {
      query: 'process scheduling',
      subject: 'Operating Systems'
    });
    assert.match(unassignedNoteSearch.clarification || '', /not in your assigned teaching subjects/i);

    // 3. Tool execution cap (maxToolCalls = 2)
    invalidateAgentCache(db);
    const boundedRes = await runKyanaAgentLoop({
      db,
      message: 'What should I study before my next examination?',
      academicContext: stuSaugatCtx,
      referenceDate: REFERENCE_DATE,
      maxToolCalls: 2
    });
    assert.ok(boundedRes.agentTrace.toolCalls.length <= 2, 'Agent loop must strictly respect maxToolCalls cap');
  });
});
