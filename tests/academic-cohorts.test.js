'use strict';

process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createClient } = require('@libsql/client');
const { createTransactionAdapter } = require('../lib/db-transaction');
const {
  ensureAcademicCohortSchema,
  getAcademicContext,
  createCohort,
  promoteCohort,
  graduateCohort,
  recycleSlot,
  assertAcademicAccess,
  buildAcademicContentFilter
} = require('../lib/academic-context');

// Camel case mapper helper matching db.js
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

async function createTestFixture(t) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'academic-cohort-test-'));
  const dbFile = path.join(tempDir, 'test.db');
  const client = createClient({ url: `file:${dbFile}` });

  const db = createTransactionAdapter(client, false, formatRow, formatRows);

  t.after(async () => {
    client.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Create base tables needed for testing
  await db.exec(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'student',
      department TEXT DEFAULT 'BIT',
      semester TEXT DEFAULT 'Semester 1',
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
      semester TEXT,
      uploadedBy TEXT NOT NULL REFERENCES students(studentId),
      uploadedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      subject TEXT,
      semester TEXT,
      createdBy TEXT NOT NULL REFERENCES students(studentId),
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId TEXT NOT NULL REFERENCES students(studentId),
      cohort_id TEXT,
      text TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      recipientStudentId TEXT NOT NULL REFERENCES students(studentId),
      cohort_id TEXT,
      title TEXT,
      body TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Run academic cohort schema migration
  await ensureAcademicCohortSchema({
    exec: sql => db.exec(sql),
    run: (sql, ...params) => db.run(sql, ...params),
    all: (sql, ...params) => db.all(sql, ...params),
    isPostgres: false
  });

  return db;
}

test('1. Mercury student resolves Mercury context correctly', async t => {
  const db = await createTestFixture(t);

  const mercury = await createCohort(db, {
    slotCode: 'mercury',
    displayName: 'Mercury',
    currentSemester: 1,
    intakeYear: 2024
  });

  await db.run(
    'INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES (?, ?, ?, ?, ?)',
    'STU_MERCURY', 'Aashrita Lamichhane', 'student', 'Semester 1', mercury.id
  );

  const context = await getAcademicContext(db, { studentId: 'STU_MERCURY' });
  assert.equal(context.authenticated, true);
  assert.equal(context.role, 'student');
  assert.equal(context.studentId, 'STU_MERCURY');
  assert.ok(context.cohort);
  assert.equal(context.cohort.id, mercury.id);
  assert.equal(context.cohort.code, 'mercury');
  assert.equal(context.cohort.displayName, 'Mercury');
  assert.equal(context.cohort.currentSemester, 1);
  assert.equal(context.cohort.status, 'active');
});

test('2. Venus student resolves Venus context correctly', async t => {
  const db = await createTestFixture(t);

  const venus = await createCohort(db, {
    slotCode: 'venus',
    displayName: 'Venus',
    currentSemester: 3,
    intakeYear: 2023
  });

  await db.run(
    'INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES (?, ?, ?, ?, ?)',
    'STU_VENUS', 'Manish Regmi', 'student', 'Semester 3', venus.id
  );

  const context = await getAcademicContext(db, { studentId: 'STU_VENUS' });
  assert.equal(context.authenticated, true);
  assert.equal(context.role, 'student');
  assert.equal(context.studentId, 'STU_VENUS');
  assert.ok(context.cohort);
  assert.equal(context.cohort.id, venus.id);
  assert.equal(context.cohort.code, 'venus');
  assert.equal(context.cohort.displayName, 'Venus');
  assert.equal(context.cohort.currentSemester, 3);
});

test('3. Student cannot override cohort through query parameters', async t => {
  const db = await createTestFixture(t);

  const mercury = await createCohort(db, { slotCode: 'mercury', currentSemester: 1 });
  const earth = await createCohort(db, { slotCode: 'earth', currentSemester: 5 });

  await db.run(
    'INSERT INTO students (studentId, name, role, cohort_id) VALUES (?, ?, ?, ?)',
    'STU_MERC', 'Mercury Student', 'student', mercury.id
  );

  // Attack: Mercury student sends ?cohortId=<earth.id> in query
  const fakeReq = {
    studentId: 'STU_MERC',
    query: { cohortId: earth.id, cohort_id: earth.id }
  };

  const context = await getAcademicContext(db, fakeReq);
  assert.equal(context.cohort.id, mercury.id);
  assert.notEqual(context.cohort.id, earth.id);

  // Access check asserts failure when trying to access Earth data
  assert.throws(() => {
    assertAcademicAccess(context, earth.id, 'cohort');
  }, /Access denied/);
});

test('4. Student cannot override cohort through request body values', async t => {
  const db = await createTestFixture(t);

  const mercury = await createCohort(db, { slotCode: 'mercury', currentSemester: 1 });
  const mars = await createCohort(db, { slotCode: 'mars', currentSemester: 7 });

  await db.run(
    'INSERT INTO students (studentId, name, role, cohort_id) VALUES (?, ?, ?, ?)',
    'STU_MERC_2', 'Mercury Student 2', 'student', mercury.id
  );

  // Attack: Mercury student sends { cohortId: mars.id } in body
  const fakeReq = {
    user: { studentId: 'STU_MERC_2' },
    body: { cohortId: mars.id, cohort_id: mars.id }
  };

  const context = await getAcademicContext(db, fakeReq);
  assert.equal(context.cohort.id, mercury.id);
  assert.notEqual(context.cohort.id, mars.id);

  // Access check rejects Mars content
  assert.throws(() => {
    assertAcademicAccess(context, mars.id, 'cohort');
  }, /Access denied/);
});

test('5. Student cannot override semester to access future or other cohort content', async t => {
  const db = await createTestFixture(t);

  const mercury = await createCohort(db, { slotCode: 'mercury', currentSemester: 1 });

  await db.run(
    'INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES (?, ?, ?, ?, ?)',
    'STU_MERC_3', 'Mercury Student 3', 'student', 'Semester 1', mercury.id
  );

  const context = await getAcademicContext(db, {
    studentId: 'STU_MERC_3',
    query: { semester: 5 },
    body: { semester: 'Semester 5' }
  });

  // Query filter strictly locks student to own cohort and cannot be tricked by ?semester=5
  const filter = buildAcademicContentFilter(context, { requestedSemester: 5 });
  assert.equal(filter.params[0], mercury.id);
  assert.ok(filter.sql.includes('cohort_id = ?'));
  assert.ok(!filter.sql.includes('semester_no = 5'));
});

test('6. Teacher and Admin can view all active and permitted cohorts', async t => {
  const db = await createTestFixture(t);

  const mercury = await createCohort(db, { slotCode: 'mercury', currentSemester: 1 });
  const venus = await createCohort(db, { slotCode: 'venus', currentSemester: 3 });
  const earth = await createCohort(db, { slotCode: 'earth', currentSemester: 5 });
  const mars = await createCohort(db, { slotCode: 'mars', currentSemester: 7 });

  await db.run(
    'INSERT INTO students (studentId, name, role) VALUES (?, ?, ?)',
    'TEACHER_1', 'Teacher Sharma', 'teacher'
  );
  await db.run(
    'INSERT INTO students (studentId, name, role) VALUES (?, ?, ?)',
    'ADMIN_1', 'Admin Saugat', 'admin'
  );

  const teacherCtx = await getAcademicContext(db, { studentId: 'TEACHER_1' });
  assert.equal(teacherCtx.role, 'teacher');
  assert.equal(teacherCtx.canViewAllCohorts, true);
  assert.equal(teacherCtx.cohorts.length, 4);

  // Teacher has access to any cohort
  assert.equal(assertAcademicAccess(teacherCtx, mercury.id, 'cohort'), true);
  assert.equal(assertAcademicAccess(teacherCtx, mars.id, 'cohort'), true);

  const adminCtx = await getAcademicContext(db, { studentId: 'ADMIN_1' });
  assert.equal(adminCtx.role, 'admin');
  assert.equal(adminCtx.canManageCohorts, true);
  assert.equal(adminCtx.cohorts.length, 4);
});

test('7. Historical semester_no does not change after cohort promotion', async t => {
  const db = await createTestFixture(t);

  const mercury = await createCohort(db, { slotCode: 'mercury', currentSemester: 1, intakeYear: 2024 });

  await db.run(
    'INSERT INTO students (studentId, name, role, cohort_id) VALUES (?, ?, ?, ?)',
    'STU_HIST', 'Student Historical', 'student', mercury.id
  );

  // Student uploads a note and creates a post while in Semester 1
  const postResult = await db.run(
    'INSERT INTO posts (user_id, content, type, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?)',
    'STU_HIST', 'My Semester 1 Notes on C Programming', 'status', mercury.id, 1, 'cohort'
  );
  const postId = postResult.lastInsertRowid;

  const fileResult = await db.run(
    'INSERT INTO files (storedName, originalName, title, uploadedBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?)',
    'c_prog_notes.pdf', 'c_prog_notes.pdf', 'C Programming Chapter 1', 'STU_HIST', mercury.id, 1, 'cohort'
  );
  const fileId = fileResult.lastInsertRowid;

  // 6 months later: Mercury is promoted to Semester 2
  const promoResult = await promoteCohort(db, { cohortId: mercury.id, actorId: 'STU_HIST' });
  assert.equal(promoResult.previousSemester, 1);
  assert.equal(promoResult.currentSemester, 2);

  // Verify cohort current_semester is now 2
  const updatedCohort = await db.get('SELECT current_semester FROM cohorts WHERE id = ?', mercury.id);
  assert.equal(Number(updatedCohort.currentSemester || updatedCohort.current_semester), 2);

  // CRITICAL REQUIREMENT: Historical content semester_no MUST REMAIN 1!
  const postAfter = await db.get('SELECT semester_no FROM posts WHERE id = ?', postId);
  const fileAfter = await db.get('SELECT semester_no FROM files WHERE id = ?', fileId);

  assert.equal(Number(postAfter.semesterNo || postAfter.semester_no), 1);
  assert.equal(Number(fileAfter.semesterNo || fileAfter.semester_no), 1);

  // Verify cohort semester history has 2 records
  const history = await db.all('SELECT semester_no, started_at, ended_at FROM cohort_semester_history WHERE cohort_id = ? ORDER BY semester_no ASC', mercury.id);
  assert.equal(history.length, 2);
  assert.equal(Number(history[0].semesterNo || history[0].semester_no), 1);
  assert.ok(history[0].endedAt || history[0].ended_at); // Semester 1 history was ended
  assert.equal(Number(history[1].semesterNo || history[1].semester_no), 2);
  assert.ok(!history[1].endedAt && !history[1].ended_at); // Semester 2 is ongoing
});

test('8. Graduated cohort remains intact with status graduated', async t => {
  const db = await createTestFixture(t);

  const seniorCohort = await createCohort(db, {
    slotCode: 'mars',
    displayName: 'Mars Senior',
    currentSemester: 8,
    intakeYear: 2020
  });

  const gradResult = await graduateCohort(db, { cohortId: seniorCohort.id, actorId: null });
  assert.equal(gradResult.status, 'graduated');
  assert.ok(gradResult.graduatedAt);
  assert.equal(gradResult.releasedSlotCode, 'mars');

  const check = await db.get('SELECT id, status, graduated_at FROM cohorts WHERE id = ?', seniorCohort.id);
  assert.equal(check.status, 'graduated');
  assert.ok(check.graduatedAt || check.graduated_at);
});

test('9. New cohort can reuse a display slot with a BRAND NEW UUID', async t => {
  const db = await createTestFixture(t);

  // 1. Initial Mars cohort UUID-A at Semester 8
  const marsOld = await createCohort(db, {
    slotCode: 'mars',
    displayName: 'Mars',
    currentSemester: 8,
    intakeYear: 2020
  });
  const uuidA = marsOld.id;

  // 2. Graduate UUID-A
  await graduateCohort(db, { cohortId: uuidA });

  // 3. New incoming cohort reuses slot 'mars'
  const marsNew = await recycleSlot(db, {
    slotCode: 'mars',
    displayName: 'Mars',
    intakeYear: 2024
  });
  const uuidB = marsNew.id;

  // Verify: UUID is completely new and distinct
  assert.notEqual(uuidA, uuidB);
  assert.equal(marsNew.slotCode, 'mars');
  assert.equal(marsNew.currentSemester, 1);
  assert.equal(marsNew.status, 'active');

  // Both records co-exist safely in cohorts table
  const allMars = await db.all('SELECT id, slot_code, status, current_semester FROM cohorts WHERE slot_code = ?', 'mars');
  assert.equal(allMars.length, 2);

  // Enforce: Attempting to create a second ACTIVE cohort in 'mars' MUST FAIL
  await assert.rejects(async () => {
    await createCohort(db, { slotCode: 'mars', currentSemester: 1 });
  }, /already occupied by active cohort/);
});

test('10. IMPORTANT RECYCLING TEST: Mars UUID-B cannot see Mars UUID-A data across any entity', async t => {
  const db = await createTestFixture(t);

  // ==========================================
  // PHASE A: Mars UUID-A Lifecycle
  // ==========================================
  const marsOld = await createCohort(db, {
    slotCode: 'mars',
    displayName: 'Mars',
    currentSemester: 8,
    intakeYear: 2020
  });
  const uuidA = marsOld.id;

  // Student A1 belongs to UUID-A
  await db.run(
    'INSERT INTO students (studentId, name, role, cohort_id) VALUES (?, ?, ?, ?)',
    'STU_A1', 'Old Mars Student A1', 'student', uuidA
  );

  // Content created by / for UUID-A
  await db.run(
    'INSERT INTO posts (user_id, content, type, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?)',
    'STU_A1', 'UUID-A Senior Capstone Post', 'status', uuidA, 8, 'cohort'
  );
  await db.run(
    'INSERT INTO posts (user_id, content, type, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?)',
    'STU_A1', 'UUID-A Private Notice for Mars 2020', 'notice', uuidA, 8, 'cohort'
  );
  await db.run(
    'INSERT INTO files (storedName, originalName, title, uploadedBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?, ?)',
    'mars_a_thesis.pdf', 'mars_a_thesis.pdf', 'UUID-A Thesis Draft', 'STU_A1', uuidA, 8, 'cohort'
  );
  await db.run(
    'INSERT INTO assignments (title, subject, createdBy, cohort_id, semester_no, audience_scope) VALUES (?, ?, ?, ?, ?, ?)',
    'UUID-A Final Assignment', 'Advanced Distributed Systems', 'STU_A1', uuidA, 8, 'cohort'
  );
  await db.run(
    'INSERT INTO chat_messages (studentId, cohort_id, text) VALUES (?, ?, ?)',
    'STU_A1', uuidA, 'UUID-A secret graduation chat message'
  );
  await db.run(
    'INSERT INTO notifications (id, recipientStudentId, cohort_id, title, body) VALUES (?, ?, ?, ?, ?)',
    'NOTIF_A1', 'STU_A1', uuidA, 'UUID-A Senior Alert', 'Exclusive to Mars 2020'
  );

  // Graduate Mars UUID-A
  await graduateCohort(db, { cohortId: uuidA });

  // ==========================================
  // PHASE B: Mars UUID-B Recycled
  // ==========================================
  const marsNew = await recycleSlot(db, {
    slotCode: 'mars',
    displayName: 'Mars',
    intakeYear: 2024
  });
  const uuidB = marsNew.id;
  assert.notEqual(uuidA, uuidB);

  // Student B1 belongs to new Mars UUID-B
  await db.run(
    'INSERT INTO students (studentId, name, role, cohort_id) VALUES (?, ?, ?, ?)',
    'STU_B1', 'Freshman Mars Student B1', 'student', uuidB
  );

  // Resolve Student B1's context
  const contextB = await getAcademicContext(db, { studentId: 'STU_B1' });
  assert.equal(contextB.cohort.id, uuidB);
  assert.equal(contextB.cohort.slotCode, 'mars');
  assert.equal(contextB.cohort.currentSemester, 1);

  // ==========================================
  // PHASE C: Zero Data Leak Assertions
  // ==========================================
  const filter = buildAcademicContentFilter(contextB, { tableAlias: 'p' });

  // 1. Posts isolation: Student B1 querying posts sees ZERO UUID-A posts
  const visiblePosts = await db.all(
    `SELECT * FROM posts p WHERE ${filter.sql}`,
    ...filter.params
  );
  assert.equal(visiblePosts.length, 0, 'UUID-B must see 0 posts from UUID-A');

  // 2. Notes / Files isolation: Student B1 sees ZERO UUID-A study materials
  const fileFilter = buildAcademicContentFilter(contextB, { tableAlias: 'f' });
  const visibleFiles = await db.all(
    `SELECT * FROM files f WHERE ${fileFilter.sql}`,
    ...fileFilter.params
  );
  assert.equal(visibleFiles.length, 0, 'UUID-B must see 0 files/notes from UUID-A');

  // 3. Assignments isolation: Student B1 sees ZERO UUID-A assignments
  const assignFilter = buildAcademicContentFilter(contextB, { tableAlias: 'a' });
  const visibleAssignments = await db.all(
    `SELECT * FROM assignments a WHERE ${assignFilter.sql}`,
    ...assignFilter.params
  );
  assert.equal(visibleAssignments.length, 0, 'UUID-B must see 0 assignments from UUID-A');

  // 4. Notices isolation: Cohort-scoped notices from UUID-A are not visible
  const visibleNotices = await db.all(
    `SELECT * FROM posts p WHERE p.type = 'notice' AND ${filter.sql}`,
    ...filter.params
  );
  assert.equal(visibleNotices.length, 0, 'UUID-B must see 0 cohort notices from UUID-A');

  // 5. Chat History isolation: Student B1 querying chat sees ZERO UUID-A messages
  const visibleChat = await db.all(
    'SELECT * FROM chat_messages WHERE cohort_id = ?',
    contextB.cohort.id
  );
  assert.equal(visibleChat.length, 0, 'UUID-B must see 0 chat messages from UUID-A');

  // 6. Notification History isolation: Student B1 sees ZERO notifications from UUID-A
  const visibleNotifs = await db.all(
    'SELECT * FROM notifications WHERE recipientStudentId = ? OR cohort_id = ?',
    contextB.studentId, contextB.cohort.id
  );
  assert.equal(visibleNotifs.length, 0, 'UUID-B must see 0 notifications from UUID-A');

  // Direct IDOR access attempt by Student B1 requesting UUID-A data explicitly throws 403
  assert.throws(() => {
    assertAcademicAccess(contextB, uuidA, 'cohort');
  }, /Access denied: You are not authorized/);
});

test('11. GET /api/academic-context HTTP endpoint returns authoritative context', async t => {
  const db = await createTestFixture(t);

  const mercury = await createCohort(db, { slotCode: 'mercury', currentSemester: 1 });
  await db.run(
    'INSERT INTO students (studentId, name, role, cohort_id) VALUES (?, ?, ?, ?)',
    'STU_HTTP', 'HTTP Test Student', 'student', mercury.id
  );

  const app = express();
  app.use(express.json());

  // Mock requireLogin middleware that sets req.user
  const mockAuth = (req, res, next) => {
    const studentId = req.headers['x-test-student'] || 'STU_HTTP';
    req.user = { studentId };
    next();
  };

  app.get('/api/academic-context', mockAuth, async (req, res) => {
    const ctx = await getAcademicContext(db, req);
    res.json(ctx);
  });

  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const port = server.address().port;

  // Regular student request
  const res = await fetch(`http://127.0.0.1:${port}/api/academic-context?cohortId=venus&semester=8`, {
    headers: { 'x-test-student': 'STU_HTTP' }
  });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.authenticated, true);
  assert.equal(data.role, 'student');
  assert.equal(data.cohort.id, mercury.id);
  assert.equal(data.cohort.slotCode, 'mercury');
  assert.equal(data.cohort.currentSemester, 1);
  // Confirmed: Query parameters ?cohortId=venus&semester=8 were completely ignored
  assert.notEqual(data.cohort.slotCode, 'venus');
});

test('12. PostgreSQL: Complete verification of cohort tables, partial unique index, history, recycling, and context', async t => {
  const { Pool } = require('pg');
  const testPgUrl = process.env.TEST_POSTGRES_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const pool = new Pool({ connectionString: testPgUrl, connectionTimeoutMillis: 1500 });
  let isAvailable = false;
  try {
    await pool.query('SELECT 1');
    isAvailable = true;
  } catch {
    await pool.end().catch(() => {});
  }

  if (!isAvailable) {
    t.skip('Disposable PostgreSQL container is not reachable on ' + testPgUrl);
    return;
  }

  const schema = `cohort_test_${crypto.randomBytes(6).toString('hex')}`;
  await pool.query(`CREATE SCHEMA ${schema}`);

  const client = await pool.connect();
  await client.query(`SET search_path TO ${schema}`);

  t.after(async () => {
    try {
      client.release();
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    } catch (_) {}
  });

  // 1. Base tables in PG
  await client.query(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'student',
      department TEXT DEFAULT 'BIT',
      semester TEXT DEFAULT 'Semester 1'
    );
    CREATE TABLE posts (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES students(studentId),
      content TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'status'
    );
    CREATE TABLE files (
      id SERIAL PRIMARY KEY,
      storedName TEXT NOT NULL,
      originalName TEXT NOT NULL,
      title TEXT,
      semester TEXT,
      uploadedBy TEXT NOT NULL REFERENCES students(studentId)
    );
    CREATE TABLE assignments (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      semester TEXT,
      createdBy TEXT NOT NULL REFERENCES students(studentId)
    );
  `);

  const pgAdapter = {
    isPostgres: true,
    exec: sql => client.query(sql),
    run: async (sql, ...params) => {
      let idx = 1;
      const pgSql = sql.replace(/\?/g, () => `$${idx++}`);
      const res = await client.query(pgSql, params);
      return { lastInsertRowid: res.rows[0]?.id, changes: res.rowCount };
    },
    all: async (sql, ...params) => {
      let idx = 1;
      const pgSql = sql.replace(/\?/g, () => `$${idx++}`);
      const res = await client.query(pgSql, params);
      return formatRows(res.rows);
    },
    get: async (sql, ...params) => {
      let idx = 1;
      const pgSql = sql.replace(/\?/g, () => `$${idx++}`);
      const res = await client.query(pgSql, params);
      return formatRow(res.rows[0] || null);
    }
  };

  // 2. Ensure academic cohort schema runs cleanly in PostgreSQL
  await ensureAcademicCohortSchema({
    exec: sql => client.query(sql),
    run: pgAdapter.run,
    all: pgAdapter.all,
    isPostgres: true
  });

  // Verify Idempotency (running second time must not fail)
  await ensureAcademicCohortSchema({
    exec: sql => client.query(sql),
    run: pgAdapter.run,
    all: pgAdapter.all,
    isPostgres: true
  });

  // Verify tables & columns exist
  const tables = await client.query(
    'SELECT table_name FROM information_schema.tables WHERE table_schema = $1',
    [schema]
  );
  const tableNames = tables.rows.map(r => r.table_name);
  assert.ok(tableNames.includes('cohorts'));
  assert.ok(tableNames.includes('cohort_semester_history'));

  // 3. Test Partial Unique Index in Postgres: only 1 active cohort per slot
  const c1 = crypto.randomUUID();
  const c2 = crypto.randomUUID();
  await client.query(`
    INSERT INTO cohorts (id, slot_code, display_name, current_semester, status)
    VALUES ($1, 'mercury', 'Mercury', 1, 'active')
  `, [c1]);

  await assert.rejects(async () => {
    await client.query(`
      INSERT INTO cohorts (id, slot_code, display_name, current_semester, status)
      VALUES ($1, 'mercury', 'Mercury 2', 1, 'active')
    `, [c2]);
  }, /unique/i);

  // 4. Test Graduate & Slot Recycling in Postgres
  await client.query(`
    UPDATE cohorts SET status = 'graduated', graduated_at = CURRENT_TIMESTAMP WHERE id = $1
  `, [c1]);

  // Now slot mercury can be reused by a new cohort with a new UUID!
  await client.query(`
    INSERT INTO cohorts (id, slot_code, display_name, current_semester, status)
    VALUES ($1, 'mercury', 'Mercury New', 1, 'active')
  `, [c2]);

  // 5. Test Semester History & Content Scope columns in Postgres
  const histId = crypto.randomUUID();
  await client.query(`
    INSERT INTO cohort_semester_history (id, cohort_id, semester_no)
    VALUES ($1, $2, 1)
  `, [histId, c2]);

  // 6. Test Assignment Backfill and Academic Context Query in Postgres
  await client.query(`
    INSERT INTO students (studentId, name, role, cohort_id)
    VALUES ('PG_STU_1', 'Postgres Student', 'student', $1)
  `, [c2]);

  await client.query(`
    INSERT INTO assignments (title, semester, createdBy, cohort_id, semester_no, audience_scope)
    VALUES ('Lab 1', 'Semester 1', 'PG_STU_1', $1, 1, 'cohort')
  `, [c2]);

  const ctx = await getAcademicContext(pgAdapter, { studentId: 'PG_STU_1' });
  assert.equal(ctx.authenticated, true);
  assert.equal(ctx.role, 'student');
  assert.equal(ctx.cohort.id, c2);
  assert.equal(ctx.cohort.slotCode, 'mercury');
  assert.equal(ctx.cohort.currentSemester, 1);
});

