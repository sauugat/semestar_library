'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

const { handleChat } = require('../ai-assistant');
const { createTools, routeQuery } = require('../lib/chat-tools');
const { getAcademicContext } = require('../lib/academic-context');
const { ensureAttendanceSchema, saveAttendanceSession, updateEligibilityThresholdConfig } = require('../lib/attendance-service');
const { ensureMarksSchema, upsertExamConfiguration, saveStudentMarks, publishSubjectResults } = require('../lib/marks-service');
const { ensureTeacherSchema } = require('../lib/teacher-service');
const { ensureAuditSchema } = require('../lib/audit-service');
const { buildGUKnowledge } = require('../lib/knowledge-builder');

let dbAdapterRef = null;
function createSqliteAdapter(client) {
  return {
    isPostgres: false,
    exec: async (sql) => client.executeMultiple(sql),
    all: async (sql, ...params) => {
      const res = await client.execute({ sql, args: params });
      return res.rows.map(r => ({ ...r }));
    },
    get: async (sql, ...params) => {
      const res = await client.execute({ sql, args: params });
      return res.rows[0] ? { ...res.rows[0] } : null;
    },
    run: async (sql, ...params) => {
      const res = await client.execute({ sql, args: params });
      return {
        lastInsertRowid: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : null,
        changes: res.rowsAffected || 0
      };
    },
    withTransaction: async (fn) => fn(dbAdapterRef)
  };
}

describe('Kyana AI — Phase 2A: Core Personal and Academic Data Intelligence', () => {
  let client;
  let db;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.KYANA_KNOWLEDGE_V3 = 'false';

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

      CREATE TABLE library_custom_chapters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        semester TEXT,
        chapter TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE library_chapter_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        subject_code TEXT,
        original_chapter TEXT NOT NULL,
        new_chapter TEXT,
        is_deleted INTEGER DEFAULT 0,
        updated_by TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
        audience_scope TEXT DEFAULT 'cohort',
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

      CREATE TABLE knowledge_resources (
        id TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL,
        canonical_id INTEGER,
        canonical_code TEXT,
        title TEXT NOT NULL,
        source_authority_tier INTEGER NOT NULL DEFAULT 4,
        author_id TEXT,
        author_role TEXT,
        cohort_id TEXT,
        semester_no INTEGER,
        audience_scope TEXT DEFAULT 'cohort',
        target_all_semesters INTEGER DEFAULT 0,
        visibility TEXT DEFAULT 'everyone',
        web_url TEXT,
        mobile_route TEXT,
        mobile_params TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT,
        hidden_at TEXT,
        content_hash TEXT
      );

      CREATE TABLE knowledge_chunks (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL,
        embedding_model TEXT,
        page_number INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await ensureAuditSchema(db);
    await ensureTeacherSchema(db);
    await ensureAttendanceSchema(db);
    await ensureMarksSchema(db);
    await require('../lib/note-search').ensureIndex(db);

    // 1. Seed Cohort (Semester 3 Mars)
    await db.run(
      `INSERT INTO cohorts (id, slot_code, display_name, name, entry_year, intake_year, current_semester, status)
       VALUES ('cohort_mars_s3', 'mars', 'Mars Cohort (Sem 3)', 'Mars', 2025, 2025, 3, 'active')`
    );

    // 2. Seed Users (2 students in Sem 3, 1 teacher for DBMS & DSA, 1 admin)
    await db.run(
      `INSERT INTO students (studentId, name, username, role, semester, cohort_id, account_status)
       VALUES ('stu_saugat', 'Saugat Student', 'saugat', 'student', 'Semester 3', 'cohort_mars_s3', 'active')`
    );
    await db.run(
      `INSERT INTO students (studentId, name, username, role, semester, cohort_id, account_status)
       VALUES ('stu_bina', 'Bina Classmate', 'bina', 'student', 'Semester 3', 'cohort_mars_s3', 'active')`
    );
    await db.run(
      `INSERT INTO students (studentId, name, username, role, semester, cohort_id, account_status)
       VALUES ('tea_dbms', 'Dr. Ramesh Karki', 'ramesh_karki', 'teacher', NULL, NULL, 'active')`
    );
    await db.run(
      `INSERT INTO students (studentId, name, username, role, semester, cohort_id, account_status)
       VALUES ('adm_main', 'Main Admin', 'admin_main', 'admin', NULL, NULL, 'active')`
    );

    // 3. Seed Subjects & Teacher Assignments (Semester 3)
    await db.run(
      `INSERT INTO subjects (id, code, name, semester, department, credit_hours, nature, active)
       VALUES ('CIT214', 'CIT214', 'Database Management System', 3, 'BIT', 3.0, 'Theory + Lab', 1)`
    );
    await db.run(
      `INSERT INTO subjects (id, code, name, semester, department, credit_hours, nature, active)
       VALUES ('CIT211', 'CIT211', 'Data Structure and Algorithms', 3, 'BIT', 3.0, 'Theory + Lab', 1)`
    );
    await db.run(
      `INSERT INTO subjects (id, code, name, semester, department, credit_hours, nature, active)
       VALUES ('CIT212', 'CIT212', 'Operating Systems', 3, 'BIT', 3.0, 'Theory + Lab', 1)`
    );

    await db.run(
      `INSERT INTO teachers (id, user_id, designation, status)
       VALUES ('tea_dbms', 'tea_dbms', 'Associate Professor', 'active')`
    );
    await db.run(
      `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
       VALUES ('ts_1', 'tea_dbms', 'CIT214'), ('ts_2', 'tea_dbms', 'CIT211')`
    );

    // 4. Configure Attendance Eligibility Threshold (75%) and Record 4 DBMS Sessions + 2 DSA Sessions
    await updateEligibilityThresholdConfig(db, {
      adminUserId: 'adm_main',
      threshold: 75,
      reason: 'Set 75% exam eligibility requirement'
    });

    // Saugat is present in 3 of 4 DBMS classes (75%, missed 1 class) and 2 of 2 DSA classes (100%, missed 0)
    // Bina is present in 1 of 4 DBMS classes (25%, missed 3)
    const dbmsDates = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
    for (let i = 0; i < dbmsDates.length; i++) {
      await saveAttendanceSession(db, {
        actorUserId: 'tea_dbms',
        subjectId: 'CIT214',
        cohortId: 'cohort_mars_s3',
        sessionDate: dbmsDates[i],
        records: [
          { studentId: 'stu_saugat', status: i < 3 ? 'present' : 'absent' },
          { studentId: 'stu_bina', status: i === 0 ? 'present' : 'absent' }
        ]
      });
    }
    const dsaDates = ['2026-10-05', '2026-10-06'];
    for (const d of dsaDates) {
      await saveAttendanceSession(db, {
        actorUserId: 'tea_dbms',
        subjectId: 'CIT211',
        cohortId: 'cohort_mars_s3',
        sessionDate: d,
        records: [
          { studentId: 'stu_saugat', status: 'present' },
          { studentId: 'stu_bina', status: 'present' }
        ]
      });
    }

    // 5. Seed Marks & Results:
    // - DBMS Mid-Term Exam (max 50): PUBLISHED (Saugat: 42/50 = 84%, Bina: 48/50 = 96%)
    // - DBMS Pre-Board Exam (max 100): DRAFT / UNPUBLISHED (Saugat: 79/100 in draft — must NEVER be exposed to student!)
    await upsertExamConfiguration(db, {
      actorUserId: 'tea_dbms',
      subjectId: 'CIT214',
      examType: 'Mid-Term Exam',
      maxMarks: 50
    });
    await saveStudentMarks(db, {
      actorUserId: 'tea_dbms',
      subjectId: 'CIT214',
      examType: 'Mid-Term Exam',
      records: [
        { studentId: 'stu_saugat', obtainedMarks: 42 },
        { studentId: 'stu_bina', obtainedMarks: 48 }
      ]
    });
    await publishSubjectResults(db, {
      actorUserId: 'tea_dbms',
      subjectId: 'CIT214',
      examType: 'Mid-Term Exam'
    });

    await upsertExamConfiguration(db, {
      actorUserId: 'tea_dbms',
      subjectId: 'CIT214',
      examType: 'Pre-Board Exam',
      maxMarks: 100
    });
    await saveStudentMarks(db, {
      actorUserId: 'tea_dbms',
      subjectId: 'CIT214',
      examType: 'Pre-Board Exam',
      records: [
        { studentId: 'stu_saugat', obtainedMarks: 79 },
        { studentId: 'stu_bina', obtainedMarks: 88 }
      ]
    });

    // 6. Seed Assignments, Questions, Submissions, and Released/Unreleased Grades
    const a1 = await db.run(
      `INSERT INTO assignments (title, description, language, subject, semester, semester_no, deadline, createdBy, cohort_id, audience_scope)
       VALUES ('DBMS SQL Joins & Normalization Lab', 'Write SQL queries for inner/outer joins and normalize to 3NF.', 'sql', 'Database Management System', 'Semester 3', 3, '2026-11-20', 'tea_dbms', 'cohort_mars_s3', 'cohort')`
    );
    const a1Id = a1.lastInsertRowid;
    const q1 = await db.run(
      `INSERT INTO assignment_questions (assignmentId, questionNumber, title, description, language, maxPoints)
       VALUES (?, 1, 'Inner and Left Join Query', 'Write a query joining students and cohorts.', 'sql', 10)`,
      a1Id
    );
    const q2 = await db.run(
      `INSERT INTO assignment_questions (assignmentId, questionNumber, title, description, language, maxPoints)
       VALUES (?, 2, 'BCNF Decomposition', 'Decompose relation R(A,B,C) into BCNF.', 'sql', 15)`,
      a1Id
    );

    // Saugat submitted both questions on 2026-10-25
    await db.run(
      `INSERT INTO submissions (assignmentId, questionId, studentId, code, questionTitle, submittedAt)
       VALUES (?, ?, 'stu_saugat', 'SELECT * FROM students;', 'Inner and Left Join Query', '2026-10-25T10:15:00.000Z')`,
      a1Id, q1.lastInsertRowid
    );
    await db.run(
      `INSERT INTO submissions (assignmentId, questionId, studentId, code, questionTitle, submittedAt)
       VALUES (?, ?, 'stu_saugat', '-- BCNF steps', 'BCNF Decomposition', '2026-10-25T11:30:00.000Z')`,
      a1Id, q2.lastInsertRowid
    );

    // Bina also submitted Q1 (ungraded/unreleased)
    await db.run(
      `INSERT INTO submissions (assignmentId, questionId, studentId, code, questionTitle, submittedAt)
       VALUES (?, ?, 'stu_bina', 'SELECT 1;', 'Inner and Left Join Query', '2026-10-26T09:00:00.000Z')`,
      a1Id, q1.lastInsertRowid
    );

    // Grade for Saugat Q1 is RELEASED (9/10, remarks: "Clean SQL join syntax")
    await db.run(
      `INSERT INTO submission_grades (questionId, studentId, marksObtained, remarks, checked, released, gradedBy)
       VALUES (?, 'stu_saugat', 9, 'Clean SQL join syntax', 1, 1, 'tea_dbms')`,
      q1.lastInsertRowid
    );
    // Grade for Saugat Q2 is CHECKED but UNRELEASED (released = 0, marksObtained = 14, remarks = "Secret draft remark")
    await db.run(
      `INSERT INTO submission_grades (questionId, studentId, marksObtained, remarks, checked, released, gradedBy)
       VALUES (?, 'stu_saugat', 14, 'Secret draft remark must not leak', 1, 0, 'tea_dbms')`,
      q2.lastInsertRowid
    );

    // 7. Seed Library Files & Custom Chapters for DBMS
    await db.run(
      `INSERT INTO files (storedName, originalName, title, semester, semester_no, subject, chapter, uploadedBy, cohort_id, audience_scope)
       VALUES ('dbms_ch1.pdf', 'dbms_ch1.pdf', 'Intro to DBMS', 'Semester 3', 3, 'Database Management System', 'Chapter 1: Introduction', 'tea_dbms', 'cohort_mars_s3', 'all_students'),
              ('dbms_ch3.pdf', 'dbms_ch3.pdf', 'Normalization 1NF-BCNF', 'Semester 3', 3, 'Database Management System', 'Chapter 3: Normalization', 'tea_dbms', 'cohort_mars_s3', 'all_students')`
    );
    await db.run(
      `INSERT INTO library_custom_chapters (subject, semester, chapter, created_by)
       VALUES ('Database Management System', 'Semester 3', 'Chapter 4: Transaction Processing & Concurrency', 'tea_dbms')`
    );

    // 8. Seed Verified Official Gandaki University Notice (gu_official)
    const guBuilt = buildGUKnowledge({
      id: 2083,
      type: 'pdfposter',
      title: 'Official Gandaki University Convocation & Dean List Notice 2083',
      link: 'https://www.gandakiuniversity.edu.np/pdfposter/convocation-2083/',
      date: '2026-10-20T10:00:00Z',
      content: 'Gandaki University announces the 2083 Convocation Ceremony and Dean List scholarship applications.'
    });
    await db.run(
      `INSERT INTO knowledge_resources (
        id, resource_type, canonical_id, canonical_code, title, source_authority_tier,
        audience_scope, target_all_semesters, visibility, web_url, mobile_route, mobile_params, content_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      guBuilt.resource.id,
      guBuilt.resource.resource_type,
      guBuilt.resource.canonical_id,
      guBuilt.resource.canonical_code,
      guBuilt.resource.title,
      guBuilt.resource.source_authority_tier,
      guBuilt.resource.audience_scope,
      guBuilt.resource.target_all_semesters,
      guBuilt.resource.visibility,
      guBuilt.resource.web_url,
      guBuilt.resource.mobile_route,
      JSON.stringify(guBuilt.resource.mobile_params || {}),
      guBuilt.resource.content_hash
    );
    await db.run(
      `INSERT INTO knowledge_chunks (id, resource_id, chunk_index, content)
       VALUES (?, ?, 0, ?)`,
      `${guBuilt.resource.id}:c0`,
      guBuilt.resource.id,
      guBuilt.chunks[0].content
    );
  });

  after(async () => {
    if (client) await client.close();
  });

  test('1. Student Attendance (`get_my_attendance`): answers overall attendance, exam eligibility, and subject missed classes using authenticated context only', async () => {
    const stuCtx = await getAcademicContext(db, { studentId: 'stu_saugat', role: 'student' });

    // 1a. "Mero attendance kati xa?"
    const r1 = await handleChat(db, 'Mero attendance kati xa?', { studentId: 'stu_saugat', role: 'student' }, [], 'sess_att_1', {
      academicContext: stuCtx
    });
    assert.equal(r1.intent, 'attendance');
    assert.match(r1.reply, /83\.33%/, 'Overall attendance must be 5/6 = 83.33%');
    assert.match(r1.reply, /5 present, 1 missed\/absent out of 6 total classes/);
    assert.doesNotMatch(r1.reply, /Eligible for exams|Required threshold/i);

    // 1b. "Am I eligible for exams?"
    const r2 = await handleChat(db, 'Am I eligible for exams?', { studentId: 'stu_saugat', role: 'student' }, [], 'sess_att_2', {
      academicContext: stuCtx
    });
    assert.equal(r2.intent, 'attendance');
    assert.match(r2.reply, /83\.33%/);
    assert.doesNotMatch(r2.reply, /Eligible for exams/i);

    // 1c. "DBMS ma kati class miss gare?"
    const r3 = await handleChat(db, 'DBMS ma kati class miss gare?', { studentId: 'stu_saugat', role: 'student' }, [], 'sess_att_3', {
      academicContext: stuCtx
    });
    assert.equal(r3.intent, 'attendance');
    assert.match(r3.reply, /Database Management System \(CIT214\)/);
    assert.match(r3.reply, /75% \(3 present, 1 missed\/absent out of 4 classes\)/);

    // 1d. Never accepts a model/user-supplied studentId in tool arguments & blocks cross-student queries
    const crossRes = await handleChat(db, 'Bina ko attendance kati xa?', { studentId: 'stu_saugat', role: 'student' }, [], 'sess_att_cross', {
      academicContext: stuCtx
    });
    assert.equal(crossRes.intent, 'cross_student');
    assert.doesNotMatch(crossRes.reply, /25%/, 'Must never leak another student attendance');

    const toolkit = createTools(db, routeQuery('Mero attendance kati xa?'), { academicContext: stuCtx });
    await assert.rejects(
      () => toolkit.executeTool('get_my_attendance', { studentId: 'stu_bina' }),
      /Unknown tool argument/i,
      'Tool schema must reject any injected studentId argument'
    );
  });

  test('2. Student Results (`get_my_results`): returns published marks, hides unpublished draft marks, and supports exam-type & semester queries', async () => {
    const stuCtx = await getAcademicContext(db, { studentId: 'stu_saugat', role: 'student' });

    // 2a. "What are my midterm marks?"
    const r1 = await handleChat(db, 'What are my midterm marks?', { studentId: 'stu_saugat', role: 'student' }, [], 'sess_res_1', {
      academicContext: stuCtx
    });
    assert.equal(r1.intent, 'results');
    assert.match(r1.reply, /Database Management System.*CIT214/);
    assert.match(r1.reply, /Mid-Term Exam/);
    assert.match(r1.reply, /42 \/ 50 \(84%\)/);
    assert.doesNotMatch(r1.reply, /48/, 'Must never expose classmate Bina marks');

    // 2b. "Are my pre-board results published?" (Pre-Board is in draft with 79/100 — must NOT leak 79!)
    const r2 = await handleChat(db, 'Are my pre-board results published?', { studentId: 'stu_saugat', role: 'student' }, [], 'sess_res_2', {
      academicContext: stuCtx
    });
    assert.equal(r2.intent, 'results');
    assert.match(r2.reply, /No published exam results were found.*Pre-Board Exam/i);
    assert.doesNotMatch(r2.reply, /79/, 'Draft/unpublished marks must NEVER be exposed');

    // 2c. "Show my results for semester 3."
    const r3 = await handleChat(db, 'Show my results for semester 3.', { studentId: 'stu_saugat', role: 'student' }, [], 'sess_res_3', {
      academicContext: stuCtx
    });
    assert.equal(r3.intent, 'results');
    assert.match(r3.reply, /Semester 3 Exam Results/);
    assert.match(r3.reply, /42 \/ 50 \(84%\)/);
    assert.doesNotMatch(r3.reply, /79/);
  });

  test('3. Assignment Intelligence (`search_assignments`): reports submission status, submission date, released grades/remarks only, and nested questions', async () => {
    const stuCtx = await getAcademicContext(db, { studentId: 'stu_saugat', role: 'student' });

    // 3a. Student asks about submission status, grades, and questions
    const r1 = await handleChat(
      db,
      'Did I submit the DBMS assignment and what are my grades and questions?',
      { studentId: 'stu_saugat', role: 'student' },
      [],
      'sess_asg_1',
      { academicContext: stuCtx }
    );
    assert.equal(r1.intent, 'assignments');
    assert.match(r1.reply, /DBMS SQL Joins & Normalization Lab/);
    assert.match(r1.reply, /Q1: Inner and Left Join Query/);
    assert.match(r1.reply, /Q2: BCNF Decomposition/);
    assert.match(r1.reply, /Submitted \(2\/2 questions\) on 2026-10-25/);
    assert.match(r1.reply, /Inner and Left Join Query: \*\*9\/10\*\* — Remarks: "Clean SQL join syntax"/);
    assert.doesNotMatch(r1.reply, /14\/15/);
    assert.doesNotMatch(r1.reply, /Secret draft remark/i);
  });

  test('4. Academic Directory (`get_academic_directory` & `get_syllabus`): answers who teaches a subject, semester subjects, and available chapters from live DB', async () => {
    const stuCtx = await getAcademicContext(db, { studentId: 'stu_saugat', role: 'student' });

    // 4a. "Who teaches DBMS?"
    const r1 = await handleChat(db, 'Who teaches DBMS?', { studentId: 'stu_saugat', role: 'student' }, [], 'sess_dir_1', {
      academicContext: stuCtx
    });
    assert.equal(r1.intent, 'academic_directory');
    assert.match(r1.reply, /Database Management System/);
    assert.match(r1.reply, /Dr\. Ramesh Karki/);

    // 4b. "Which teacher is assigned to Data Structure and Algorithms?"
    const r2 = await handleChat(db, 'Which teacher is assigned to Data Structure and Algorithms?', { studentId: 'stu_saugat', role: 'student' }, [], 'sess_dir_2', {
      academicContext: stuCtx
    });
    assert.equal(r2.intent, 'academic_directory');
    assert.match(r2.reply, /Dr\. Ramesh Karki/);

    // 4c. "Which subjects are available in semester 3?"
    const r3 = await handleChat(db, 'Which subjects are available in semester 3?', { studentId: 'stu_saugat', role: 'student' }, [], 'sess_dir_3', {
      academicContext: stuCtx
    });
    assert.match(r3.reply, /\*\*Database Management System\*\* \(CIT214\)/);
    assert.match(r3.reply, /\*\*Data Structure and Algorithms\*\* \(CIT211\)/);
    assert.match(r3.reply, /\*\*Operating Systems\*\* \(CIT212\)/);
    assert.match(r3.reply, /Dr\. Ramesh Karki/);

    // 4d. "Which chapters are available for DBMS?"
    const r4 = await handleChat(db, 'Which chapters are available for DBMS?', { studentId: 'stu_saugat', role: 'student' }, [], 'sess_dir_4', {
      academicContext: stuCtx
    });
    assert.equal(r4.intent, 'academic_directory');
    assert.match(r4.reply, /Chapter 1: Introduction/);
    assert.match(r4.reply, /Chapter 3: Normalization/);
    assert.match(r4.reply, /Chapter 4: Transaction Processing & Concurrency/);
  });

  test('5. Teacher Classroom Intelligence (`get_teacher_classroom_summary`): returns aggregate pending grading, recorded attendance sessions, and draft/published exam configs', async () => {
    const teacherCtx = await getAcademicContext(db, { studentId: 'tea_dbms', role: 'teacher' });

    const r1 = await handleChat(
      db,
      'How many pending submissions require grading, how many attendance sessions recorded, and what are my draft and published exam configurations?',
      { studentId: 'tea_dbms', role: 'teacher' },
      [],
      'sess_tea_1',
      { academicContext: teacherCtx }
    );
    assert.equal(r1.intent, 'teacher_classroom');
    assert.match(r1.reply, /Pending Submissions Requiring Grading:\*\* 2 pending \(out of 3 total submissions/);
    assert.match(r1.reply, /Attendance Sessions Recorded:\*\* 6 finalized sessions/);
    assert.match(r1.reply, /\*\*Database Management System\*\* \(CIT214, Sem 3\): 4 sessions/);
    assert.match(r1.reply, /\*\*Data Structure and Algorithms\*\* \(CIT211, Sem 3\): 2 sessions/);
    assert.match(r1.reply, /Exam Configurations:\*\* 1 draft, 1 published/);
    assert.match(r1.reply, /Mid-Term Exam\*: \*\*published\*\*/);
    assert.match(r1.reply, /Pre-Board Exam\*: \*\*draft\*\*/);
    assert.doesNotMatch(r1.reply, /Saugat Student|Bina Classmate/);
  });

  test('6. Official University Notices (`gu_official`): retrieves verified gu_official notices only when explicitly asked about official Gandaki University notices', async () => {
    const prevV3 = process.env.KYANA_KNOWLEDGE_V3;
    const prevUsers = process.env.KYANA_KNOWLEDGE_V3_USERS;
    process.env.KYANA_KNOWLEDGE_V3 = 'true';
    process.env.KYANA_KNOWLEDGE_V3_USERS = '*';

    try {
      const stuCtx = await getAcademicContext(db, { studentId: 'stu_saugat', role: 'student' });

      // 6a. Generic notice query (without mentioning Gandaki University / official university notice) does NOT return gu_official
      const genericRes = await handleChat(
        db,
        'Is there any notice about convocation ceremony?',
        { studentId: 'stu_saugat', role: 'student' },
        [],
        'sess_gu_generic',
        {
          academicContext: stuCtx,
          minScore: 0.01
        }
      );
      assert.equal(genericRes.resourceCards.length, 0, 'Generic notice query must not pull external gu_official notices');

      // 6b. Explicit official Gandaki University notice query DOES retrieve verified gu_official record and card
      const explicitRes = await handleChat(
        db,
        'Are there any official Gandaki University notices about convocation?',
        { studentId: 'stu_saugat', role: 'student' },
        [],
        'sess_gu_explicit',
        {
          academicContext: stuCtx,
          minScore: 0.01,
          generateReply: async () => ({
            reply: 'According to the Official Gandaki University Notice, the 2083 Convocation Ceremony and Dean List scholarship applications have been announced.\n<referenced_records>\ngu:pdfposter:2083\n</referenced_records>'
          })
        }
      );
      assert.match(explicitRes.reply, /2083 Convocation Ceremony/);
      assert.equal(explicitRes.resourceCards.length, 1);
      assert.equal(explicitRes.resourceCards[0].id, 2083);
      assert.equal(explicitRes.resourceCards[0].deepLink, 'https://www.gandakiuniversity.edu.np/pdfposter/convocation-2083/');
    } finally {
      process.env.KYANA_KNOWLEDGE_V3 = prevV3;
      process.env.KYANA_KNOWLEDGE_V3_USERS = prevUsers;
    }
  });
});
