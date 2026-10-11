'use strict';

process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
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

async function createLibraryFixture(t) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'library-isolation-test-'));
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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
  `);

  await ensureAcademicCohortSchema({
    exec: (sql) => db.exec(sql),
    run: (sql, ...params) => db.run(sql, ...params),
    all: (sql, ...params) => db.all(sql, ...params),
    isPostgres: false
  });

  return db;
}

test('PHASE 2: Student Library Semester Isolation Test Suite', async (t) => {
  const db = await createLibraryFixture(t);

  // 1. Setup the 4 permanent cohorts across 4 semesters
  const mercury = await createCohort(db, { slotCode: 'mercury', currentSemester: 1 });
  const venus = await createCohort(db, { slotCode: 'venus', currentSemester: 3 });
  const earth = await createCohort(db, { slotCode: 'earth', currentSemester: 5 });
  const mars = await createCohort(db, { slotCode: 'mars', currentSemester: 7 });

  // 2. Setup students for each semester
  await db.run('INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES (?, ?, ?, ?, ?)',
    'STU_SEM1', 'Alice Mercury', 'student', 'Semester 1', mercury.id);
  await db.run('INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES (?, ?, ?, ?, ?)',
    'STU_SEM3', 'Bob Venus', 'student', 'Semester 3', venus.id);
  await db.run('INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES (?, ?, ?, ?, ?)',
    'STU_SEM5', 'Charlie Earth', 'student', 'Semester 5', earth.id);
  await db.run('INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES (?, ?, ?, ?, ?)',
    'STU_SEM7', 'Diana Mars', 'student', 'Semester 7', mars.id);

  // 3. Setup staff members (Teacher and Admin)
  await db.run('INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES (?, ?, ?, ?, ?)',
    'STAFF_TEACHER', 'Prof. Smith', 'teacher', null, null);
  await db.run('INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES (?, ?, ?, ?, ?)',
    'STAFF_ADMIN', 'Dean Johnson', 'admin', null, null);

  // 4. Seed study materials across all 4 semesters + global/all-semesters
  // Semester 1 materials (Mercury)
  await db.run(`INSERT INTO files (storedName, originalName, title, subject, chapter, semester, uploadedBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'c_prog.pdf', 'c_prog.pdf', 'C Programming Fundamentals', 'Programming in C', 'Unit 1: Syntax', 'Semester 1', 'STAFF_TEACHER', mercury.id, 1, 'cohort');
  await db.run(`INSERT INTO files (storedName, originalName, title, subject, chapter, semester, uploadedBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'physics.pdf', 'physics.pdf', 'Engineering Physics Lab Manual', 'Physics', 'Unit 2: Optics', 'Semester 1', 'STAFF_TEACHER', null, 1, 'all_students');

  // Semester 3 materials (Venus)
  await db.run(`INSERT INTO files (storedName, originalName, title, subject, chapter, semester, uploadedBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'dsa.pdf', 'dsa.pdf', 'Data Structures and Algorithms', 'DSA', 'Unit 3: Trees', 'Semester 3', 'STAFF_TEACHER', venus.id, 3, 'cohort');
  await db.run(`INSERT INTO files (storedName, originalName, title, subject, chapter, semester, uploadedBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'discrete_math.pdf', 'discrete_math.pdf', 'Discrete Mathematics Lecture Notes', 'Discrete Math', 'Unit 1: Graphs', 'Semester 3', 'STAFF_TEACHER', null, 3, 'all_students');

  // Semester 5 materials (Earth)
  await db.run(`INSERT INTO files (storedName, originalName, title, subject, chapter, semester, uploadedBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'dbms.pdf', 'dbms.pdf', 'Database Management Systems Complete Guide', 'DBMS', 'Unit 4: Normalization', 'Semester 5', 'STAFF_TEACHER', earth.id, 5, 'cohort');

  // Semester 7 materials (Mars)
  await db.run(`INSERT INTO files (storedName, originalName, title, subject, chapter, semester, uploadedBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'compilers.pdf', 'compilers.pdf', 'Compiler Construction Theory', 'Compilers', 'Unit 2: Parsers', 'Semester 7', 'STAFF_TEACHER', mars.id, 7, 'cohort');

  // All-Semesters / General materials (e.g. University Handbook, Academic Calendar)
  await db.run(`INSERT INTO files (storedName, originalName, title, subject, chapter, semester, uploadedBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'calendar.pdf', 'calendar.pdf', 'Annual University Academic Calendar', 'General', 'General', 'all', 'STAFF_ADMIN', null, null, 'all_students');
  await db.run(`INSERT INTO files (storedName, originalName, title, subject, chapter, semester, uploadedBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'handbook.pdf', 'handbook.pdf', 'Student Conduct & Code of Ethics', 'General', 'General', null, 'STAFF_ADMIN', null, null, 'all_students');

  // 5. Seed assignments across all 4 semesters
  await db.run(`INSERT INTO assignments (title, subject, semester, createdBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    'Lab 1: Pointers in C', 'Programming in C', 'Semester 1', 'STAFF_TEACHER', mercury.id, 1, 'cohort');
  await db.run(`INSERT INTO assignments (title, subject, semester, createdBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    'Lab 3: Binary Search Tree Implementation', 'DSA', 'Semester 3', 'STAFF_TEACHER', venus.id, 3, 'cohort');
  await db.run(`INSERT INTO assignments (title, subject, semester, createdBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    'Lab 5: SQL Query Optimization', 'DBMS', 'Semester 5', 'STAFF_TEACHER', earth.id, 5, 'cohort');
  await db.run(`INSERT INTO assignments (title, subject, semester, createdBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    'Lab 7: Lexical Analyzer Generator', 'Compilers', 'Semester 7', 'STAFF_TEACHER', mars.id, 7, 'cohort');

  // ─────────────────────────────────────────────────────────────
  // TEST 1: Student Semester 1 isolation
  // ─────────────────────────────────────────────────────────────
  await t.test('1. Student Semester 1 sees only Sem 1 notes and all-semester notes', async () => {
    const ctx = await getAcademicContext(db, { studentId: 'STU_SEM1' });
    const filter = buildAcademicContentFilter(ctx, { tableAlias: 'files' });
    const files = await db.all(`SELECT * FROM files WHERE ${filter.sql}`, ...filter.params);
    const titles = files.map(f => f.title);

    assert.ok(titles.includes('C Programming Fundamentals'), 'Must see Sem 1 cohort note');
    assert.ok(titles.includes('Engineering Physics Lab Manual'), 'Must see Sem 1 all_students note');
    assert.ok(titles.includes('Annual University Academic Calendar'), 'Must see all-semester note');
    assert.ok(titles.includes('Student Conduct & Code of Ethics'), 'Must see general handbook');

    // Negative assertions: must NOT see Sem 3, 5, 7 notes
    assert.equal(titles.includes('Data Structures and Algorithms'), false, 'Must NOT see Sem 3 note');
    assert.equal(titles.includes('Discrete Mathematics Lecture Notes'), false, 'Must NOT see Sem 3 note');
    assert.equal(titles.includes('Database Management Systems Complete Guide'), false, 'Must NOT see Sem 5 note');
    assert.equal(titles.includes('Compiler Construction Theory'), false, 'Must NOT see Sem 7 note');
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 2: Student Semester 3 isolation
  // ─────────────────────────────────────────────────────────────
  await t.test('2. Student Semester 3 sees only Sem 3 notes and all-semester notes', async () => {
    const ctx = await getAcademicContext(db, { studentId: 'STU_SEM3' });
    const filter = buildAcademicContentFilter(ctx, { tableAlias: 'files' });
    const files = await db.all(`SELECT * FROM files WHERE ${filter.sql}`, ...filter.params);
    const titles = files.map(f => f.title);

    assert.ok(titles.includes('Data Structures and Algorithms'), 'Must see Sem 3 cohort note');
    assert.ok(titles.includes('Discrete Mathematics Lecture Notes'), 'Must see Sem 3 all_students note');
    assert.ok(titles.includes('Annual University Academic Calendar'), 'Must see all-semester note');

    // Negative assertions
    assert.equal(titles.includes('C Programming Fundamentals'), false, 'Must NOT see Sem 1 note');
    assert.equal(titles.includes('Database Management Systems Complete Guide'), false, 'Must NOT see Sem 5 note');
    assert.equal(titles.includes('Compiler Construction Theory'), false, 'Must NOT see Sem 7 note');
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 3: Student Semester 5 isolation
  // ─────────────────────────────────────────────────────────────
  await t.test('3. Student Semester 5 sees only Sem 5 notes and all-semester notes', async () => {
    const ctx = await getAcademicContext(db, { studentId: 'STU_SEM5' });
    const filter = buildAcademicContentFilter(ctx, { tableAlias: 'files' });
    const files = await db.all(`SELECT * FROM files WHERE ${filter.sql}`, ...filter.params);
    const titles = files.map(f => f.title);

    assert.ok(titles.includes('Database Management Systems Complete Guide'), 'Must see Sem 5 note');
    assert.ok(titles.includes('Annual University Academic Calendar'), 'Must see all-semester note');

    assert.equal(titles.includes('C Programming Fundamentals'), false, 'Must NOT see Sem 1 note');
    assert.equal(titles.includes('Data Structures and Algorithms'), false, 'Must NOT see Sem 3 note');
    assert.equal(titles.includes('Compiler Construction Theory'), false, 'Must NOT see Sem 7 note');
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 4: Student Semester 7 isolation
  // ─────────────────────────────────────────────────────────────
  await t.test('4. Student Semester 7 sees only Sem 7 notes and all-semester notes', async () => {
    const ctx = await getAcademicContext(db, { studentId: 'STU_SEM7' });
    const filter = buildAcademicContentFilter(ctx, { tableAlias: 'files' });
    const files = await db.all(`SELECT * FROM files WHERE ${filter.sql}`, ...filter.params);
    const titles = files.map(f => f.title);

    assert.ok(titles.includes('Compiler Construction Theory'), 'Must see Sem 7 note');
    assert.ok(titles.includes('Annual University Academic Calendar'), 'Must see all-semester note');

    assert.equal(titles.includes('C Programming Fundamentals'), false, 'Must NOT see Sem 1 note');
    assert.equal(titles.includes('Data Structures and Algorithms'), false, 'Must NOT see Sem 3 note');
    assert.equal(titles.includes('Database Management Systems Complete Guide'), false, 'Must NOT see Sem 5 note');
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 5: Assignments semester isolation
  // ─────────────────────────────────────────────────────────────
  await t.test('5. Assignments are strictly isolated per semester', async () => {
    const ctx1 = await getAcademicContext(db, { studentId: 'STU_SEM1' });
    const filter1 = buildAcademicContentFilter(ctx1, { tableAlias: 'a' });
    const assigns1 = await db.all(`SELECT * FROM assignments a WHERE ${filter1.sql}`, ...filter1.params);
    const titles1 = assigns1.map(a => a.title);

    assert.ok(titles1.includes('Lab 1: Pointers in C'));
    assert.equal(titles1.includes('Lab 3: Binary Search Tree Implementation'), false);
    assert.equal(titles1.includes('Lab 5: SQL Query Optimization'), false);
    assert.equal(titles1.includes('Lab 7: Lexical Analyzer Generator'), false);

    const ctx7 = await getAcademicContext(db, { studentId: 'STU_SEM7' });
    const filter7 = buildAcademicContentFilter(ctx7, { tableAlias: 'a' });
    const assigns7 = await db.all(`SELECT * FROM assignments a WHERE ${filter7.sql}`, ...filter7.params);
    const titles7 = assigns7.map(a => a.title);

    assert.ok(titles7.includes('Lab 7: Lexical Analyzer Generator'));
    assert.equal(titles7.includes('Lab 1: Pointers in C'), false);
    assert.equal(titles7.includes('Lab 3: Binary Search Tree Implementation'), false);
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 6: Direct file view, download, preview authorization (assertContentAccess)
  // ─────────────────────────────────────────────────────────────
  await t.test('6. Direct file access & download authorization blocks unauthorized semester', async () => {
    const ctx1 = await getAcademicContext(db, { studentId: 'STU_SEM1' });
    const ctx7 = await getAcademicContext(db, { studentId: 'STU_SEM7' });

    const sem1File = await db.get('SELECT * FROM files WHERE title = ?', 'C Programming Fundamentals');
    const sem7File = await db.get('SELECT * FROM files WHERE title = ?', 'Compiler Construction Theory');
    const globalCalendar = await db.get('SELECT * FROM files WHERE title = ?', 'Annual University Academic Calendar');

    // Sem 1 student access checks
    assert.equal(assertContentAccess(ctx1, sem1File), true, 'Sem 1 student CAN access Sem 1 file');
    assert.equal(assertContentAccess(ctx1, sem7File), false, 'Sem 1 student CANNOT access Sem 7 file (HTTP 404 simulation)');
    assert.equal(assertContentAccess(ctx1, globalCalendar), true, 'Sem 1 student CAN access global calendar');

    // Sem 7 student access checks
    assert.equal(assertContentAccess(ctx7, sem7File), true, 'Sem 7 student CAN access Sem 7 file');
    assert.equal(assertContentAccess(ctx7, sem1File), false, 'Sem 7 student CANNOT access Sem 1 file');
    assert.equal(assertContentAccess(ctx7, globalCalendar), true, 'Sem 7 student CAN access global calendar');
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 7: Direct assignment view authorization (assertContentAccess)
  // ─────────────────────────────────────────────────────────────
  await t.test('7. Direct assignment access blocks other semester assignments', async () => {
    const ctx1 = await getAcademicContext(db, { studentId: 'STU_SEM1' });
    const ctx3 = await getAcademicContext(db, { studentId: 'STU_SEM3' });

    const sem1Assign = await db.get('SELECT * FROM assignments WHERE title = ?', 'Lab 1: Pointers in C');
    const sem3Assign = await db.get('SELECT * FROM assignments WHERE title = ?', 'Lab 3: Binary Search Tree Implementation');

    assert.equal(assertContentAccess(ctx1, sem1Assign), true, 'Sem 1 student CAN access Sem 1 lab');
    assert.equal(assertContentAccess(ctx1, sem3Assign), false, 'Sem 1 student CANNOT access Sem 3 lab');

    assert.equal(assertContentAccess(ctx3, sem3Assign), true, 'Sem 3 student CAN access Sem 3 lab');
    assert.equal(assertContentAccess(ctx3, sem1Assign), false, 'Sem 3 student CANNOT access Sem 1 lab');
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 8: Subject listing isolation (/api/library/subjects)
  // ─────────────────────────────────────────────────────────────
  await t.test('8. Subject listing includes only subjects with current semester materials', async () => {
    const ctx1 = await getAcademicContext(db, { studentId: 'STU_SEM1' });
    const filter1 = buildAcademicContentFilter(ctx1, { tableAlias: 'files' });
    const subjects1 = await db.all(`
      SELECT subject, COUNT(*) AS fileCount
      FROM files
      WHERE subject IS NOT NULL AND subject != '' AND ${filter1.sql}
      GROUP BY subject
      ORDER BY subject ASC
    `, ...filter1.params);
    const subNames1 = subjects1.map(s => s.subject);

    assert.ok(subNames1.includes('Programming in C'));
    assert.ok(subNames1.includes('Physics'));
    assert.ok(subNames1.includes('General'));
    assert.equal(subNames1.includes('DSA'), false, 'DSA (Sem 3) must NOT appear in Sem 1 subject listing');
    assert.equal(subNames1.includes('DBMS'), false, 'DBMS (Sem 5) must NOT appear in Sem 1 subject listing');
    assert.equal(subNames1.includes('Compilers'), false, 'Compilers (Sem 7) must NOT appear in Sem 1 subject listing');

    const ctx3 = await getAcademicContext(db, { studentId: 'STU_SEM3' });
    const filter3 = buildAcademicContentFilter(ctx3, { tableAlias: 'files' });
    const subjects3 = await db.all(`
      SELECT subject, COUNT(*) AS fileCount
      FROM files
      WHERE subject IS NOT NULL AND subject != '' AND ${filter3.sql}
      GROUP BY subject
      ORDER BY subject ASC
    `, ...filter3.params);
    const subNames3 = subjects3.map(s => s.subject);

    assert.ok(subNames3.includes('DSA'));
    assert.ok(subNames3.includes('Discrete Math'));
    assert.equal(subNames3.includes('Programming in C'), false);
    assert.equal(subNames3.includes('Compilers'), false);
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 9: Library Search Isolation (/api/search)
  // ─────────────────────────────────────────────────────────────
  await t.test('9. Library search strictly limits results to student current semester', async () => {
    const ctx1 = await getAcademicContext(db, { studentId: 'STU_SEM1' });
    const fileFilter = buildAcademicContentFilter(ctx1, { tableAlias: 'files' });
    const assignFilter = buildAcademicContentFilter(ctx1, { tableAlias: 'a' });

    // Search query matching "Lab" (present in Sem 1, 3, 5, 7)
    const files = await db.all(`
      SELECT * FROM files
      WHERE (${fileFilter.sql}) AND (LOWER(title) LIKE '%lab%')
    `, ...fileFilter.params);
    assert.equal(files.length, 1);
    assert.equal(files[0].title, 'Engineering Physics Lab Manual');

    const assigns = await db.all(`
      SELECT * FROM assignments a
      WHERE (${assignFilter.sql}) AND (LOWER(title) LIKE '%lab%')
    `, ...assignFilter.params);
    assert.equal(assigns.length, 1);
    assert.equal(assigns[0].title, 'Lab 1: Pointers in C');
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 10: Automatic Semester Resolution via Cohort Promotion
  // ─────────────────────────────────────────────────────────────
  await t.test('10. Cohort promotion automatically updates student Library access without ID change', async () => {
    // Mercury is promoted from Semester 1 -> Semester 2
    const promoted = await promoteCohort(db, { cohortId: mercury.id, actorId: 'STAFF_ADMIN' });
    assert.equal(promoted.currentSemester, 2);

    // Seed a Semester 2 note for Mercury
    await db.run(`INSERT INTO files (storedName, originalName, title, subject, chapter, semester, uploadedBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'oop_cpp.pdf', 'oop_cpp.pdf', 'Object Oriented Programming in C++', 'OOP', 'Unit 1: Classes', 'Semester 2', 'STAFF_TEACHER', mercury.id, 2, 'cohort');

    // Fresh academic context for Student 1 reflects Semester 2 automatically
    const ctxAfterPromo = await getAcademicContext(db, { studentId: 'STU_SEM1' });
    assert.equal(ctxAfterPromo.cohort.id, mercury.id, 'Cohort ID remains permanent and unchanged');
    assert.equal(ctxAfterPromo.cohort.currentSemester, 2, 'Academic semester automatically resolved to 2');

    // Query Library files for Student 1 after promotion
    const filterAfter = buildAcademicContentFilter(ctxAfterPromo, { tableAlias: 'files' });
    const filesAfter = await db.all(`SELECT * FROM files WHERE ${filterAfter.sql}`, ...filterAfter.params);
    const titlesAfter = filesAfter.map(f => f.title);

    assert.ok(titlesAfter.includes('Object Oriented Programming in C++'), 'Now sees new Semester 2 note');
    assert.equal(titlesAfter.includes('C Programming Fundamentals'), false, 'Previous Semester 1 notes no longer shown in active library');

    // Direct access to Sem 1 file is now blocked, Sem 2 file allowed
    const sem1File = await db.get('SELECT * FROM files WHERE title = ?', 'C Programming Fundamentals');
    const sem2File = await db.get('SELECT * FROM files WHERE title = ?', 'Object Oriented Programming in C++');

    assert.equal(assertContentAccess(ctxAfterPromo, sem2File), true, 'Direct access to Sem 2 file allowed');
    assert.equal(assertContentAccess(ctxAfterPromo, sem1File), false, 'Direct access to Sem 1 file denied after promotion');
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 11: Teacher and Admin safety (access preserved)
  // ─────────────────────────────────────────────────────────────
  await t.test('11. Teacher and Admin access preserved across all semesters', async () => {
    const ctxTeacher = await getAcademicContext(db, { studentId: 'STAFF_TEACHER' });
    const ctxAdmin = await getAcademicContext(db, { studentId: 'STAFF_ADMIN' });

    assert.equal(ctxTeacher.canViewAllCohorts, true);
    assert.equal(ctxAdmin.canViewAllCohorts, true);

    const sem1File = await db.get('SELECT * FROM files WHERE title = ?', 'C Programming Fundamentals');
    const sem7File = await db.get('SELECT * FROM files WHERE title = ?', 'Compiler Construction Theory');
    const sem7Assign = await db.get('SELECT * FROM assignments WHERE title = ?', 'Lab 7: Lexical Analyzer Generator');

    // Direct access checks
    assert.equal(assertContentAccess(ctxTeacher, sem1File), true, 'Teacher can access Sem 1 file');
    assert.equal(assertContentAccess(ctxTeacher, sem7File), true, 'Teacher can access Sem 7 file');
    assert.equal(assertContentAccess(ctxTeacher, sem7Assign), true, 'Teacher can access Sem 7 assignment');

    assert.equal(assertContentAccess(ctxAdmin, sem1File), true, 'Admin can access Sem 1 file');
    assert.equal(assertContentAccess(ctxAdmin, sem7File), true, 'Admin can access Sem 7 file');
    assert.equal(assertContentAccess(ctxAdmin, sem7Assign), true, 'Admin can access Sem 7 assignment');

    // Filter checks: teacher querying all files sees everything
    const filterTeacherAll = buildAcademicContentFilter(ctxTeacher, { tableAlias: 'files' });
    const allFiles = await db.all(`SELECT * FROM files WHERE ${filterTeacherAll.sql}`, ...filterTeacherAll.params);
    assert.ok(allFiles.length >= 7, 'Teacher can see all files across semesters');

    // Filter checks: teacher can optionally focus on a specific semester
    const filterTeacherSem7 = buildAcademicContentFilter(ctxTeacher, { tableAlias: 'files', requestedSemester: 7 });
    const sem7Files = await db.all(`SELECT * FROM files WHERE ${filterTeacherSem7.sql}`, ...filterTeacherSem7.params);
    const sem7Titles = sem7Files.map(f => f.title);
    assert.ok(sem7Titles.includes('Compiler Construction Theory'));
    assert.equal(sem7Titles.includes('C Programming Fundamentals'), false);
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 12: Client Parameter Spoofing Prevention
  // ─────────────────────────────────────────────────────────────
  await t.test('12. Student parameter spoofing attempts cannot expand access', async () => {
    const ctx = await getAcademicContext(db, { studentId: 'STU_SEM3' }); // Sem 3 student

    // Student attempts to request ?semester=7 and ?cohortId=mars
    const spoofFilter = buildAcademicContentFilter(ctx, {
      tableAlias: 'files',
      requestedCohortId: mars.id,
      requestedSemester: 7
    });

    const spoofFiles = await db.all(`SELECT * FROM files WHERE ${spoofFilter.sql}`, ...spoofFilter.params);
    const spoofTitles = spoofFiles.map(f => f.title);

    assert.equal(spoofTitles.includes('Compiler Construction Theory'), false, 'Spoofing cannot reveal Sem 7 notes');
    assert.ok(spoofTitles.includes('Data Structures and Algorithms'), 'Remains strictly scoped to Sem 3 notes');
  });
});
