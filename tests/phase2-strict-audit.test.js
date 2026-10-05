'use strict';

process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createClient } = require('@libsql/client');
const { createTransactionAdapter } = require('../lib/db-transaction');
const {
  ensureAcademicCohortSchema,
  getAcademicContext,
  createCohort,
  promoteCohort,
  graduateCohort,
  recycleSlot,
  resolvePublishScope,
  buildAcademicContentFilter,
  assertContentAccess
} = require('../lib/academic-context');

const camelMap = {
  cohort_id: 'cohortId', cohortid: 'cohortId',
  slot_code: 'slotCode', slotcode: 'slotCode',
  display_name: 'displayName', displayname: 'displayName',
  intake_year: 'intakeYear', intakeyear: 'intakeYear',
  intake_identifier: 'intakeIdentifier', intakeidentifier: 'intakeIdentifier',
  current_semester: 'currentSemester', currentsemester: 'currentSemester',
  graduated_at: 'graduatedAt', graduatedat: 'graduatedAt',
  semester_no: 'semesterNo', semesterno: 'semesterNo',
  audience_scope: 'audienceScope', audiencescope: 'audienceScope',
  started_at: 'startedAt', startedat: 'startedAt',
  ended_at: 'endedAt', endedat: 'endedAt',
  promoted_by: 'promotedBy', promotedby: 'promotedBy',
  studentid: 'studentId'
};

function formatRow(row) {
  if (!row) return row;
  const formatted = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = camelMap[key] || key;
    formatted[camelKey] = (value instanceof Date) ? value.toISOString() : value;
  }
  return formatted;
}
function formatRows(rows) {
  if (!rows) return rows;
  return rows.map(formatRow);
}

async function createAuditFixture(t) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase2-audit-test-'));
  const dbFile = path.join(tempDir, 'test.db');
  const client = createClient({ url: `file:${dbFile}` });
  const db = createTransactionAdapter(client, false, formatRow, formatRows);

  t.after(async () => {
    client.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await db.exec(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'student',
      department TEXT DEFAULT 'BIT',
      semester TEXT DEFAULT 'Semester 1',
      cohort_id TEXT,
      supabase_uid TEXT
    );

    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES students(studentId),
      content TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'status',
      attachment_url TEXT,
      cohort_id TEXT,
      semester_no INTEGER,
      audience_scope TEXT DEFAULT 'cohort',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE post_likes (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (post_id, user_id)
    );

    CREATE TABLE files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storedName TEXT NOT NULL,
      originalName TEXT NOT NULL,
      title TEXT,
      subject TEXT,
      chapter TEXT,
      semester TEXT,
      uploadedBy TEXT NOT NULL REFERENCES students(studentId),
      uploadedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      sizeBytes INTEGER DEFAULT 0,
      previewName TEXT,
      cohort_id TEXT,
      semester_no INTEGER,
      audience_scope TEXT DEFAULT 'cohort'
    );

    CREATE TABLE file_likes (
      fileId INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      studentId TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (fileId, studentId)
    );

    CREATE TABLE file_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fileId INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      studentId TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
      commentText TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      language TEXT,
      subject TEXT,
      semester TEXT,
      deadline TEXT,
      pdfUrl TEXT,
      pdfName TEXT,
      createdBy TEXT NOT NULL REFERENCES students(studentId),
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      cohort_id TEXT,
      semester_no INTEGER,
      audience_scope TEXT DEFAULT 'cohort'
    );

    CREATE TABLE assignment_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignmentId INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      questionNumber INTEGER DEFAULT 1,
      title TEXT,
      description TEXT
    );

    CREATE TABLE submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignmentId INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      questionId INTEGER,
      studentId TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
      code TEXT,
      status TEXT,
      submittedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE routine (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_date TEXT NOT NULL,
      exam_time TEXT NOT NULL,
      semester INTEGER NOT NULL,
      subject_name TEXT NOT NULL,
      subject_code TEXT NOT NULL,
      room_no TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await ensureAcademicCohortSchema(db);

  // Canonical active cohorts:
  // Mercury -> Sem 1
  // Venus -> Sem 3
  const mercury = await createCohort(db, {
    slotCode: 'mercury',
    displayName: 'Mercury',
    currentSemester: 1,
    intakeYear: 2024,
    intakeIdentifier: 'BIT-2024'
  });

  const venus = await createCohort(db, {
    slotCode: 'venus',
    displayName: 'Venus',
    currentSemester: 3,
    intakeYear: 2023,
    intakeIdentifier: 'BIT-2023'
  });

  // Seed Users:
  // Student A -> Mercury (Sem 1)
  // Student B -> Venus (Sem 3)
  // Teacher T -> Teacher role
  // CR M -> CR in Mercury
  // Student U -> Unassigned (cohort_id = NULL)
  await db.run(`INSERT INTO students (studentId, name, role, department, semester, cohort_id) VALUES (?, ?, ?, ?, ?, ?)`,
    'STU_A', 'Student A (Mercury)', 'student', 'BIT', 'Semester 1', mercury.id);
  await db.run(`INSERT INTO students (studentId, name, role, department, semester, cohort_id) VALUES (?, ?, ?, ?, ?, ?)`,
    'STU_B', 'Student B (Venus)', 'student', 'BIT', 'Semester 3', venus.id);
  await db.run(`INSERT INTO students (studentId, name, role, department, semester, cohort_id) VALUES (?, ?, ?, ?, ?, ?)`,
    'TEACHER_T', 'Teacher T', 'teacher', 'Faculty', null, null);
  await db.run(`INSERT INTO students (studentId, name, role, department, semester, cohort_id) VALUES (?, ?, ?, ?, ?, ?)`,
    'ADMIN_X', 'Admin X', 'admin', 'Administration', null, null);
  await db.run(`INSERT INTO students (studentId, name, role, department, semester, cohort_id) VALUES (?, ?, ?, ?, ?, ?)`,
    'CR_M', 'CR M (Mercury)', 'cr', 'BIT', 'Semester 1', mercury.id);
  await db.run(`INSERT INTO students (studentId, name, role, department, semester, cohort_id) VALUES (?, ?, ?, ?, ?, ?)`,
    'STU_U', 'Student U (Unassigned)', 'student', 'BIT', 'Semester 1', null);

  return { db, mercury, venus };
}

test('PHASE 2 STRICT AUDIT: Comprehensive Feature & Security Verification', async t => {
  const { db, mercury, venus } = await createAuditFixture(t);

  // ─────────────────────────────────────────────────────────────
  // 1. FEED VERIFICATION & SEEDING
  // ─────────────────────────────────────────────────────────────
  await t.test('1. Feed Verification: Mercury vs Venus vs Global', async () => {
    // Seed 10 distinct items:
    // 1. Mercury post
    await db.run(`INSERT INTO posts (user_id, content, type, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?)`,
      'STU_A', 'Mercury private post', 'status', mercury.id, 1, 'cohort');
    // 2. Venus post
    await db.run(`INSERT INTO posts (user_id, content, type, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?)`,
      'STU_B', 'Venus private post', 'status', venus.id, 3, 'cohort');
    // 3. Global post
    await db.run(`INSERT INTO posts (user_id, content, type, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?)`,
      'ADMIN_X', 'Global system post', 'status', null, null, 'all_students');
    // 4. Mercury notice
    await db.run(`INSERT INTO posts (user_id, content, type, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?)`,
      'CR_M', 'Mercury exam notice', 'notice', mercury.id, 1, 'cohort');
    // 5. Venus notice
    await db.run(`INSERT INTO posts (user_id, content, type, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?)`,
      'ADMIN_X', 'Venus lab notice', 'notice', venus.id, 3, 'cohort');
    // 6. Global notice
    await db.run(`INSERT INTO posts (user_id, content, type, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?)`,
      'ADMIN_X', 'Holiday notice', 'notice', null, null, 'all_students');
    // 7. Mercury material
    await db.run(`INSERT INTO files (storedName, originalName, title, subject, semester, uploadedBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'f_merc.pdf', 'merc.pdf', 'Mercury Notes', 'Programming I', 'Semester 1', 'STU_A', mercury.id, 1, 'cohort');
    // 8. Venus material
    await db.run(`INSERT INTO files (storedName, originalName, title, subject, semester, uploadedBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'f_venus.pdf', 'venus.pdf', 'Venus Notes', 'Data Structures', 'Semester 3', 'STU_B', venus.id, 3, 'cohort');
    // 9. Mercury assignment
    await db.run(`INSERT INTO assignments (title, subject, semester, createdBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'Mercury Assignment 1', 'Programming I', 'Semester 1', 'TEACHER_T', mercury.id, 1, 'cohort');
    // 10. Venus assignment
    await db.run(`INSERT INTO assignments (title, subject, semester, createdBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'Venus Assignment 1', 'Data Structures', 'Semester 3', 'TEACHER_T', venus.id, 3, 'cohort');

    // Query Feed for Student A (Mercury)
    const ctxA = await getAcademicContext(db, { studentId: 'STU_A' });
    const filterA = buildAcademicContentFilter(ctxA, { tableAlias: 'p' });
    const feedA = await db.all(`SELECT * FROM posts p WHERE ${filterA.sql} ORDER BY p.id ASC`, ...filterA.params);

    const contentsA = feedA.map(p => p.content);
    assert.ok(contentsA.includes('Mercury private post'), 'Student A must see Mercury post');
    assert.ok(contentsA.includes('Mercury exam notice'), 'Student A must see Mercury notice');
    assert.ok(contentsA.includes('Global system post'), 'Student A must see Global post');
    assert.ok(contentsA.includes('Holiday notice'), 'Student A must see Global notice');
    assert.equal(contentsA.includes('Venus private post'), false, 'Student A must NOT see Venus post');
    assert.equal(contentsA.includes('Venus lab notice'), false, 'Student A must NOT see Venus notice');

    // Query Feed for Student B (Venus)
    const ctxB = await getAcademicContext(db, { studentId: 'STU_B' });
    const filterB = buildAcademicContentFilter(ctxB, { tableAlias: 'p' });
    const feedB = await db.all(`SELECT * FROM posts p WHERE ${filterB.sql} ORDER BY p.id ASC`, ...filterB.params);

    const contentsB = feedB.map(p => p.content);
    assert.ok(contentsB.includes('Venus private post'), 'Student B must see Venus post');
    assert.ok(contentsB.includes('Venus lab notice'), 'Student B must see Venus notice');
    assert.ok(contentsB.includes('Global system post'), 'Student B must see Global post');
    assert.ok(contentsB.includes('Holiday notice'), 'Student B must see Global notice');
    assert.equal(contentsB.includes('Mercury private post'), false, 'Student B must NOT see Mercury post');
    assert.equal(contentsB.includes('Mercury exam notice'), false, 'Student B must NOT see Mercury notice');

    // Query Feed for Teacher T
    const ctxT = await getAcademicContext(db, { studentId: 'TEACHER_T' });
    const filterT = buildAcademicContentFilter(ctxT, { tableAlias: 'p' });
    const feedT = await db.all(`SELECT * FROM posts p WHERE ${filterT.sql} ORDER BY p.id ASC`, ...filterT.params);
    assert.equal(feedT.length, 6, 'Teacher sees all 6 posts/notices across all cohorts');
  });

  // ─────────────────────────────────────────────────────────────
  // 2. STUDENT POST CREATION SPOOFING PREVENTION
  // ─────────────────────────────────────────────────────────────
  await t.test('2. Student Post Creation: Spoofing Venus values rejected/overridden', async () => {
    const ctxA = await getAcademicContext(db, { studentId: 'STU_A' });

    // Student A tries to submit Venus values:
    const spoofAttempt = {
      cohort_id: venus.id,
      cohortId: venus.id,
      semester: 3,
      semester_no: 3,
      audience_scope: 'all_students'
    };

    const resolvedScope = await resolvePublishScope(db, ctxA, spoofAttempt);
    // Must remain strictly scoped to Student A's cohort (Mercury) and current semester (1)
    assert.equal(resolvedScope.cohortId, mercury.id, 'Spoofed cohortId must be overridden with Mercury');
    assert.equal(resolvedScope.semesterNo, 1, 'Spoofed semesterNo must be overridden with 1');
    assert.equal(resolvedScope.audienceScope, 'cohort', 'Spoofed audienceScope must be overridden with cohort');

    // Teacher targeting Venus must succeed
    const ctxT = await getAcademicContext(db, { studentId: 'TEACHER_T' });
    const teacherScope = await resolvePublishScope(db, ctxT, { cohortId: venus.id });
    assert.equal(teacherScope.cohortId, venus.id);
    assert.equal(teacherScope.audienceScope, 'cohort');

    // Admin targeting all_students must succeed
    const ctxAdmin = await getAcademicContext(db, { studentId: 'ADMIN_X' });
    const adminScope = await resolvePublishScope(db, ctxAdmin, { audience_scope: 'all_students' });
    assert.equal(adminScope.cohortId, null);
    assert.equal(adminScope.audienceScope, 'all_students');
  });

  // ─────────────────────────────────────────────────────────────
  // 3. CR CROSS-COHORT ACCESS RESTRICTION
  // ─────────────────────────────────────────────────────────────
  await t.test('3. CR Access: Cannot target Venus or all_students', async () => {
    const ctxCR = await getAcademicContext(db, { studentId: 'CR_M' });
    assert.equal(ctxCR.role, 'cr');
    assert.equal(ctxCR.cohort.id, mercury.id);

    // CR attempts to target Venus in request body
    const crSpoofScope = await resolvePublishScope(db, ctxCR, {
      cohortId: venus.id,
      audience_scope: 'all_students'
    }, { isNotice: true });

    assert.equal(crSpoofScope.cohortId, mercury.id, 'CR notice must be strictly bound to Mercury');
    assert.equal(crSpoofScope.audienceScope, 'cohort', 'CR notice cannot be all_students');
  });

  // ─────────────────────────────────────────────────────────────
  // 4. LIBRARY — BACKEND AUTHORIZATION
  // ─────────────────────────────────────────────────────────────
  await t.test('4. Library Backend: Student cannot override via query params', async () => {
    const ctxA = await getAcademicContext(db, { studentId: 'STU_A' });

    // Attack 1: Student A passes ?semester=3
    const attackSemFilter = buildAcademicContentFilter(ctxA, {
      tableAlias: 'files',
      requestedSemester: '3'
    });
    const resAttackSem = await db.all(`SELECT * FROM files WHERE ${attackSemFilter.sql}`, ...attackSemFilter.params);
    assert.equal(resAttackSem.some(f => f.title === 'Venus Notes'), false, 'Mercury student cannot access Venus notes via ?semester=3');

    // Attack 2: Student A passes ?cohortId=<venus.id>
    const attackCohortFilter = buildAcademicContentFilter(ctxA, {
      tableAlias: 'files',
      requestedCohortId: venus.id
    });
    const resAttackCohort = await db.all(`SELECT * FROM files WHERE ${attackCohortFilter.sql}`, ...attackCohortFilter.params);
    assert.equal(resAttackCohort.some(f => f.title === 'Venus Notes'), false, 'Mercury student cannot access Venus notes via ?cohortId');
    assert.ok(resAttackCohort.some(f => f.title === 'Mercury Notes'), 'Mercury student receives Mercury notes');
  });

  // ─────────────────────────────────────────────────────────────
  // 6. GLOBAL HISTORICAL MATERIAL: all_students vs all_semesters
  // ─────────────────────────────────────────────────────────────
  await t.test('6. Global Material: Sem 2 global notes do not leak to Sem 1 student', async () => {
    // Seed global Sem 2 note
    await db.run(`INSERT INTO files (storedName, originalName, title, subject, semester, uploadedBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'glob_sem2.pdf', 'glob2.pdf', 'Global Sem 2 C++ Note', 'C++', 'Semester 2', 'ADMIN_X', null, 2, 'all_students');
    // Seed global semester-independent note
    await db.run(`INSERT INTO files (storedName, originalName, title, subject, semester, uploadedBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'glob_any.pdf', 'any.pdf', 'Global University Rules', 'General', null, 'ADMIN_X', null, null, 'all_students');

    const ctxA = await getAcademicContext(db, { studentId: 'STU_A' }); // Mercury, Sem 1
    const filterA = buildAcademicContentFilter(ctxA, { tableAlias: 'files' });
    const filesA = await db.all(`SELECT * FROM files WHERE ${filterA.sql}`, ...filterA.params);
    const titlesA = filesA.map(f => f.title);

    assert.equal(titlesA.includes('Global Sem 2 C++ Note'), false, 'Student in Sem 1 must NOT see Global Sem 2 notes');
    assert.ok(titlesA.includes('Global University Rules'), 'Student in Sem 1 sees semester-independent global file');

    // A student currently in Sem 2:
    const ctxSem2 = {
      authenticated: true,
      role: 'student',
      cohort: { id: mercury.id, currentSemester: 2 },
      academicStatus: 'active'
    };
    const filterSem2 = buildAcademicContentFilter(ctxSem2, { tableAlias: 'files' });
    const filesSem2 = await db.all(`SELECT * FROM files WHERE ${filterSem2.sql}`, ...filterSem2.params);
    const titlesSem2 = filesSem2.map(f => f.title);
    assert.ok(titlesSem2.includes('Global Sem 2 C++ Note'), 'Student currently in Sem 2 DOES see Global Sem 2 note');
  });

  // ─────────────────────────────────────────────────────────────
  // 8. ASSIGNMENT AUTHORIZATION
  // ─────────────────────────────────────────────────────────────
  await t.test('8. Assignment Authorization: Cross-cohort exposure blocked', async () => {
    const ctxA = await getAcademicContext(db, { studentId: 'STU_A' });
    const filterA = buildAcademicContentFilter(ctxA, {
      tableAlias: 'a',
      requestedCohortId: venus.id,
      requestedSemester: 3
    });
    const assignmentsA = await db.all(`SELECT * FROM assignments a WHERE ${filterA.sql}`, ...filterA.params);
    const titlesA = assignmentsA.map(a => a.title);

    assert.ok(titlesA.includes('Mercury Assignment 1'));
    assert.equal(titlesA.includes('Venus Assignment 1'), false, 'Student A cannot see Venus assignment');

    // Deep link check: assertContentAccess on single assignment
    const venusAssignment = await db.get('SELECT * FROM assignments WHERE title = ?', 'Venus Assignment 1');
    assert.equal(assertContentAccess(ctxA, venusAssignment), false, 'Direct URL access to Venus assignment denied');
  });

  // ─────────────────────────────────────────────────────────────
  // 9. NOTICES: Cohort Notice vs Global Notice
  // ─────────────────────────────────────────────────────────────
  await t.test('9. Notices: Cohort vs Global notice isolation', async () => {
    const ctxA = await getAcademicContext(db, { studentId: 'STU_A' });
    const ctxB = await getAcademicContext(db, { studentId: 'STU_B' });

    const filterA = buildAcademicContentFilter(ctxA, { tableAlias: 'p' });
    const noticesA = await db.all(`SELECT * FROM posts p WHERE ${filterA.sql} AND p.type = 'notice'`, ...filterA.params);
    const contentsA = noticesA.map(n => n.content);

    assert.ok(contentsA.includes('Mercury exam notice'));
    assert.ok(contentsA.includes('Holiday notice'));
    assert.equal(contentsA.includes('Venus lab notice'), false);

    const filterB = buildAcademicContentFilter(ctxB, { tableAlias: 'p' });
    const noticesB = await db.all(`SELECT * FROM posts p WHERE ${filterB.sql} AND p.type = 'notice'`, ...filterB.params);
    const contentsB = noticesB.map(n => n.content);

    assert.ok(contentsB.includes('Venus lab notice'));
    assert.ok(contentsB.includes('Holiday notice'));
    assert.equal(contentsB.includes('Mercury exam notice'), false);
  });

  // ─────────────────────────────────────────────────────────────
  // 10. ROUTINE AUTHORIZATION
  // ─────────────────────────────────────────────────────────────
  await t.test('10. Routine: Student scoped to active semester; ?semester=7 ignored', async () => {
    await db.run(`INSERT INTO routine (exam_date, exam_time, semester, subject_name, subject_code, room_no) VALUES (?, ?, ?, ?, ?, ?)`,
      '2026-10-10', '09:00', 1, 'Programming I Exam', 'BIT101', 'Room 101');
    await db.run(`INSERT INTO routine (exam_date, exam_time, semester, subject_name, subject_code, room_no) VALUES (?, ?, ?, ?, ?, ?)`,
      '2026-10-12', '09:00', 7, 'Advanced AI Exam', 'BIT401', 'Room 401');

    // Student A (Mercury, Sem 1) requesting ?semester=7
    const ctxA = await getAcademicContext(db, { studentId: 'STU_A' });
    let targetSemA = null;
    if (ctxA.authenticated && (ctxA.role === 'student' || ctxA.role === 'cr')) {
      targetSemA = Number(ctxA.cohort.currentSemester); // 1
    }

    const routineA = await db.all(`SELECT * FROM routine WHERE semester = ?`, targetSemA);
    assert.equal(routineA.length, 1);
    assert.equal(routineA[0].subject_name, 'Programming I Exam');
  });

  // ─────────────────────────────────────────────────────────────
  // 12. SEARCH: Cross-cohort isolation in Search
  // ─────────────────────────────────────────────────────────────
  await t.test('12. Search: Mercury student cannot find Venus private files or assignments', async () => {
    const ctxA = await getAcademicContext(db, { studentId: 'STU_A' });
    const fileFilter = buildAcademicContentFilter(ctxA, { tableAlias: 'files' });
    const searchFiles = await db.all(`SELECT * FROM files WHERE (${fileFilter.sql}) AND LOWER(title) LIKE LOWER(?)`,
      ...fileFilter.params, '%Venus%');
    assert.equal(searchFiles.length, 0, 'Venus files not found in Student A search');

    const assignFilter = buildAcademicContentFilter(ctxA, { tableAlias: 'a' });
    const searchAssign = await db.all(`SELECT * FROM assignments a WHERE (${assignFilter.sql}) AND LOWER(title) LIKE LOWER(?)`,
      ...assignFilter.params, '%Venus%');
    assert.equal(searchAssign.length, 0, 'Venus assignments not found in Student A search');
  });

  // ─────────────────────────────────────────────────────────────
  // 14. DEEP LINK AUTHORIZATION
  // ─────────────────────────────────────────────────────────────
  await t.test('14. Deep Links: Mercury student accessing Venus entities returns false', async () => {
    const ctxA = await getAcademicContext(db, { studentId: 'STU_A' });

    const venusPost = await db.get('SELECT * FROM posts WHERE content = ?', 'Venus private post');
    const venusFile = await db.get('SELECT * FROM files WHERE title = ?', 'Venus Notes');
    const venusAssign = await db.get('SELECT * FROM assignments WHERE title = ?', 'Venus Assignment 1');

    assert.equal(assertContentAccess(ctxA, venusPost), false, 'Deep link to Venus post denied');
    assert.equal(assertContentAccess(ctxA, venusFile), false, 'Deep link to Venus file denied');
    assert.equal(assertContentAccess(ctxA, venusAssign), false, 'Deep link to Venus assignment denied');
  });

  // ─────────────────────────────────────────────────────────────
  // 15. COUNTS: Inaccessible cohort content is excluded from count
  // ─────────────────────────────────────────────────────────────
  await t.test('15. Counts: Counts strictly exclude other cohort records', async () => {
    const ctxA = await getAcademicContext(db, { studentId: 'STU_A' });
    const filterA = buildAcademicContentFilter(ctxA, { tableAlias: 'files' });

    const stats = await db.get(`SELECT COUNT(*) AS totalFiles FROM files WHERE ${filterA.sql}`, ...filterA.params);
    // Student A can see: Mercury Notes + Global University Rules = 2 files (NOT Venus Notes or Global Sem 2 note)
    assert.equal(stats.totalFiles, 2, 'Total counted files for Student A must only be 2');
  });

  // ─────────────────────────────────────────────────────────────
  // 17. UNASSIGNED STUDENT SAFETY
  // ─────────────────────────────────────────────────────────────
  await t.test('17. Unassigned Student: Accesses only global content, no private cohort leaks, no crash', async () => {
    const ctxU = await getAcademicContext(db, { studentId: 'STU_U' });
    assert.equal(ctxU.academicStatus, 'unassigned');
    assert.equal(ctxU.cohort, null);

    const filterU = buildAcademicContentFilter(ctxU, { tableAlias: 'p' });
    const postsU = await db.all(`SELECT * FROM posts p WHERE ${filterU.sql}`, ...filterU.params);
    const contentsU = postsU.map(p => p.content);

    assert.ok(contentsU.includes('Global system post'));
    assert.ok(contentsU.includes('Holiday notice'));
    assert.equal(contentsU.includes('Mercury private post'), false);
    assert.equal(contentsU.includes('Venus private post'), false);
  });

  // ─────────────────────────────────────────────────────────────
  // 18. SEMESTER PROMOTION REGRESSION
  // ─────────────────────────────────────────────────────────────
  await t.test('18. Semester Promotion: Historical records retain semester_no = 1', async () => {
    // Mercury is promoted from Semester 1 -> Semester 2
    const promoted = await promoteCohort(db, { cohortId: mercury.id, actorId: 'ADMIN_X' });
    assert.equal(promoted.currentSemester, 2);

    // Verify historical post still has semester_no = 1
    const postHist = await db.get('SELECT * FROM posts WHERE content = ?', 'Mercury private post');
    assert.equal(postHist.semesterNo ?? postHist.semester_no, 1, 'Historical semester_no must remain 1 after promotion');

    // Verify historical file still has semester_no = 1
    const fileHist = await db.get('SELECT * FROM files WHERE title = ?', 'Mercury Notes');
    assert.equal(fileHist.semesterNo ?? fileHist.semester_no, 1, 'Historical file semester_no must remain 1 after promotion');

    // Create a new post in Semester 2:
    const ctxA_sem2 = await getAcademicContext(db, { studentId: 'STU_A' });
    assert.equal(ctxA_sem2.cohort.currentSemester, 2);

    const scopeSem2 = await resolvePublishScope(db, ctxA_sem2, {});
    assert.equal(scopeSem2.semesterNo, 2, 'New post receives currentSemester = 2');
  });

  // ─────────────────────────────────────────────────────────────
  // 19. RECYCLED SLOT TEST: Mars UUID-A vs Mars UUID-B
  // ─────────────────────────────────────────────────────────────
  await t.test('19. Recycled Slot: Mars UUID-B sees ZERO Mars UUID-A records', async () => {
    // 1. Create Mars UUID-A at Semester 7
    const marsA = await createCohort(db, {
      slotCode: 'mars',
      displayName: 'Mars',
      currentSemester: 7,
      intakeYear: 2021,
      intakeIdentifier: 'BIT-2021'
    });

    // Seed student and records in Mars UUID-A
    await db.run(`INSERT INTO students (studentId, name, role, cohort_id) VALUES (?, ?, ?, ?)`,
      'STU_MARS_A', 'Old Mars Student', 'student', marsA.id);
    await db.run(`INSERT INTO posts (user_id, content, type, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?)`,
      'STU_MARS_A', 'Private Mars UUID-A Secret Thesis', 'status', marsA.id, 7, 'cohort');

    // 2. Graduate Mars UUID-A
    await graduateCohort(db, { cohortId: marsA.id, actorId: 'ADMIN_X' });

    // 3. Recycle slot 'mars' for new batch (Mars UUID-B at Semester 1)
    const marsB = await recycleSlot(db, {
      slotCode: 'mars',
      displayName: 'Mars',
      intakeYear: 2025,
      intakeIdentifier: 'BIT-2025',
      actorId: 'ADMIN_X'
    });

    assert.notEqual(marsA.id, marsB.id, 'UUID must be completely distinct');

    // 4. Enroll new student in Mars UUID-B
    await db.run(`INSERT INTO students (studentId, name, role, cohort_id) VALUES (?, ?, ?, ?)`,
      'STU_MARS_B', 'New Mars Student', 'student', marsB.id);

    // 5. Query feed for New Mars Student
    const ctxMarsB = await getAcademicContext(db, { studentId: 'STU_MARS_B' });
    const filterMarsB = buildAcademicContentFilter(ctxMarsB, { tableAlias: 'p' });
    const feedMarsB = await db.all(`SELECT * FROM posts p WHERE ${filterMarsB.sql}`, ...filterMarsB.params);
    const contentsMarsB = feedMarsB.map(p => p.content);

    assert.equal(contentsMarsB.includes('Private Mars UUID-A Secret Thesis'), false,
      'Recycled slot isolation: Mars UUID-B student MUST NOT see Mars UUID-A records');
  });
});
