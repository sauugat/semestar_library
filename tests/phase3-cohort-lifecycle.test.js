'use strict';

process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const http = require('node:http');
const { createClient } = require('@libsql/client');
const { createTransactionAdapter } = require('../lib/db-transaction');
const {
  ensureAcademicCohortSchema,
  getAcademicContext,
  createCohort,
  promoteCohort,
  graduateCohort,
  recycleSlot,
  assignStudentToCohort,
  reassignStudentCohort,
  getCohortHistory,
  getAllCohortsWithHistory,
  assertAcademicAccess,
  buildAcademicContentFilter
} = require('../lib/academic-context');
const { createAdminCohortsRouter } = require('../routes/admin-cohorts');

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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-cohort-test-'));
  const dbFile = path.join(tempDir, 'test.db');
  const client = createClient({ url: `file:${dbFile}` });

  const db = createTransactionAdapter(client, false, formatRow, formatRows);
  db.queryOne = (sql, ...args) => {
    const flat = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    return db.get(sql, ...flat);
  };
  db.query = (sql, ...args) => {
    const flat = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    return db.all(sql, ...flat);
  };

  t.after(async () => {
    client.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Base tables
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
      cohort_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storedName TEXT NOT NULL,
      originalName TEXT NOT NULL,
      title TEXT,
      subject TEXT,
      semester TEXT,
      cohort_id TEXT,
      uploadedBy TEXT NOT NULL REFERENCES students(studentId),
      uploadedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      subject TEXT,
      semester TEXT,
      cohort_id TEXT,
      createdBy TEXT NOT NULL REFERENCES students(studentId),
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId TEXT NOT NULL REFERENCES students(studentId),
      chat_group_id TEXT,
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

  await ensureAcademicCohortSchema(db);

  return { db };
}

test('Phase 3: Permanent Cohort Lifecycle - Sem 1 to Sem 8 preserves UUID and Chat Room', async (t) => {
  const { db } = await createTestFixture(t);

  // 1. Create a cohort in slot mercury
  const cohort = await createCohort(db, {
    slotCode: 'mercury',
    academicYear: 2026,
    currentSemester: 1,
    displayName: 'BCA 2026 Mercury',
    createdBy: 'admin-001'
  });

  assert.equal(cohort.slotCode, 'mercury');
  assert.equal(cohort.currentSemester, 1);
  assert.equal(cohort.status, 'active');
  const permanentCohortId = cohort.id;

  // Verify chat room was initialized
  const room = await db.queryOne('SELECT * FROM chat_groups WHERE cohort_id = ?', [permanentCohortId]);
  assert.ok(room);
  assert.equal(room.status, 'active');
  assert.equal(room.cohortId || room.cohort_id, permanentCohortId);
  const permanentRoomId = room.id;

  // 2. Add students
  await db.query(`INSERT INTO students (studentId, name, role, cohort_id, semester) VALUES ('s1', 'Alice', 'student', ?, 'Semester 1')`, [permanentCohortId]);
  await db.query(`INSERT INTO students (studentId, name, role, cohort_id, semester) VALUES ('s2', 'Bob', 'student', ?, 'Semester 1')`, [permanentCohortId]);

  // 3. Promote across semesters 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8
  for (let sem = 1; sem <= 7; sem++) {
    const updated = await promoteCohort(db, permanentCohortId, {
      expectedSemester: sem,
      promotedBy: 'admin-001'
    });
    assert.equal(updated.id, permanentCohortId, 'Cohort UUID MUST remain permanent');
    assert.equal(updated.currentSemester, sem + 1);

    // Verify chat room identity remains identical
    const currentRoom = await db.queryOne('SELECT * FROM chat_groups WHERE cohort_id = ?', [permanentCohortId]);
    assert.equal(currentRoom.id, permanentRoomId, 'Chat room UUID MUST remain identical across promotions');
    assert.equal(currentRoom.status, 'active');

    // Verify student academic context is updated
    const alice = await db.queryOne('SELECT * FROM students WHERE studentId = ?', ['s1']);
    assert.equal(alice.semester, `Semester ${sem + 1}`);
  }

  // 4. Verify history progression
  const historyData = await getCohortHistory(db, permanentCohortId);
  const history = historyData.semesters || historyData;
  assert.equal(history.length, 8);
  for (let s = 1; s <= 7; s++) {
    assert.ok(history[s - 1].endedAt, `Semester ${s} record must be closed with endedAt`);
  }
  assert.equal(history[7].endedAt, null, 'Current Semester 8 record must still be open');
});

test('Phase 3: Concurrency Guard - Simultaneous promotion of same cohort', async (t) => {
  const { db } = await createTestFixture(t);

  const cohort = await createCohort(db, {
    slotCode: 'venus',
    academicYear: 2026,
    currentSemester: 1,
    displayName: 'BCA 2026 Venus'
  });

  // Attempt concurrent promotion with expectedSemester = 1
  const results = await Promise.allSettled([
    promoteCohort(db, cohort.id, { expectedSemester: 1, promotedBy: 'admin-1' }),
    promoteCohort(db, cohort.id, { expectedSemester: 1, promotedBy: 'admin-2' })
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'Exactly one promotion must succeed');
  assert.equal(rejected.length, 1, 'The competing promotion must fail with conflict');
  assert.equal(rejected[0].reason.status, 409);

  // Final semester must be 2
  const finalCohort = await db.queryOne('SELECT * FROM cohorts WHERE id = ?', [cohort.id]);
  assert.equal(finalCohort.currentSemester, 2);
});

test('Phase 3: Graduation & Slot Recycling - mars UUID-A -> graduated -> mars UUID-B', async (t) => {
  const { db } = await createTestFixture(t);

  // 1. Create Mars UUID-A
  const cohortA = await createCohort(db, {
    slotCode: 'mars',
    academicYear: 2026,
    currentSemester: 8,
    displayName: 'BCA 2026 Mars Batch A'
  });
  const uuidA = cohortA.id;
  const roomA = await db.queryOne('SELECT * FROM chat_groups WHERE cohort_id = ?', [uuidA]);

  // Insert students and posts for Cohort A
  await db.query(`INSERT INTO students (studentId, name, cohort_id, semester) VALUES ('senior1', 'Senior Alice', ?, 'Semester 8')`, [uuidA]);
  await db.query(`INSERT INTO posts (user_id, content, cohort_id) VALUES ('senior1', 'Graduation farewell post', ?)`, [uuidA]);
  await db.query(`INSERT INTO chat_messages (studentId, chat_group_id, text) VALUES ('senior1', ?, 'See you all!')`, [roomA.id]);

  // Cannot allocate slot mars while cohort A is still active
  await assert.rejects(
    () => createCohort(db, { slotCode: 'mars', academicYear: 2030, currentSemester: 1 }),
    err => err.status === 409 && /already occupied/i.test(err.message)
  );

  // 2. Graduate Cohort A
  const gradResult = await graduateCohort(db, uuidA, { graduatedBy: 'admin-001' });
  assert.equal(gradResult.status, 'graduated');

  // Verify chat room A is marked closed
  const closedRoomA = await db.queryOne('SELECT * FROM chat_groups WHERE id = ?', [roomA.id]);
  assert.equal(closedRoomA.status, 'closed');

  // Verify double-graduation is safe and idempotent
  const doubleGrad = await graduateCohort(db, uuidA);
  assert.equal(doubleGrad.status, 'graduated');
  assert.equal(doubleGrad.alreadyGraduated, true);

  // 3. Recycle slot mars for incoming freshman cohort (UUID-B)
  const cohortB = await recycleSlot(db, {
    slotCode: 'mars',
    academicYear: 2030,
    currentSemester: 1,
    displayName: 'BCA 2030 Mars Freshmen',
    createdBy: 'admin-001'
  });
  const uuidB = cohortB.id;

  // Assert distinct identities
  assert.notEqual(uuidB, uuidA, 'Recycled slot MUST generate a brand new cohort UUID');
  assert.equal(cohortB.slotCode, 'mars');
  assert.equal(cohortB.status, 'active');
  assert.equal(cohortB.currentSemester, 1);

  const roomB = await db.queryOne('SELECT * FROM chat_groups WHERE cohort_id = ?', [uuidB]);
  assert.ok(roomB);
  assert.notEqual(roomB.id, roomA.id, 'Recycled slot MUST generate a brand new chat room identity');
  assert.equal(roomB.status, 'active');

  // Assign fresh student to Cohort B
  await db.query(`INSERT INTO students (studentId, name, cohort_id, semester) VALUES ('fresh1', 'Freshman Bob', ?, 'Semester 1')`, [uuidB]);

  // 4. Strict Isolation Verification:
  // Freshman Bob in Cohort B has ZERO access to Cohort A resources
  const filterB = buildAcademicContentFilter({
    authenticated: true,
    role: 'student',
    cohortId: uuidB,
    currentSemester: 1,
    isGraduated: false
  });

  const visiblePosts = await db.query(`SELECT * FROM posts WHERE ${filterB.sql}`, ...filterB.params);
  assert.equal(visiblePosts.length, 0, 'Cohort B students must NOT see Cohort A posts');

  // Realtime topic isolation
  const topicA = `cohort:chat:${roomA.id}`;
  const topicB = `cohort:chat:${roomB.id}`;
  assert.notEqual(topicA, topicB, 'Realtime topics must be strictly isolated between recycled cohorts');

  // Deep link isolation: accessing message from room A with cohort B context fails
  const deepLinkMsg = await db.queryOne('SELECT * FROM chat_messages WHERE id = 1 AND chat_group_id = ?', [roomB.id]);
  assert.equal(deepLinkMsg, null, 'Deep link to room A messages does not exist in room B');
});

test('Phase 3: Student Assignment and Reassignment', async (t) => {
  const { db } = await createTestFixture(t);

  const cohort1 = await createCohort(db, { slotCode: 'earth', academicYear: 2026, currentSemester: 2 });
  const cohort2 = await createCohort(db, { slotCode: 'venus', academicYear: 2026, currentSemester: 3 });

  await db.query(`INSERT INTO students (studentId, name, role, semester) VALUES ('st-101', 'Charlie', 'student', 'Semester 1')`);

  // Assign to cohort1
  await assignStudentToCohort(db, 'st-101', cohort1.id, { assignedBy: 'admin-001' });
  const st1 = await db.queryOne('SELECT * FROM students WHERE studentId = ?', ['st-101']);
  assert.equal(st1.cohortId || st1.cohort_id, cohort1.id);
  assert.equal(st1.semester, 'Semester 2', 'Student semester must synchronize with cohort semester');

  // Reassign to cohort2
  await reassignStudentCohort(db, 'st-101', cohort2.id, { reassignedBy: 'admin-001' });
  const st2 = await db.queryOne('SELECT * FROM students WHERE studentId = ?', ['st-101']);
  assert.equal(st2.cohortId || st2.cohort_id, cohort2.id);
  assert.equal(st2.semester, 'Semester 3', 'Student semester must update to new cohort semester');
});

test('Phase 3: Audit Log Records Every Lifecycle Mutation', async (t) => {
  const { db } = await createTestFixture(t);

  const cohort = await createCohort(db, { slotCode: 'mercury', academicYear: 2026, currentSemester: 1, createdBy: 'admin-super' });
  await promoteCohort(db, cohort.id, { expectedSemester: 1, promotedBy: 'admin-super' });
  await graduateCohort(db, cohort.id, { graduatedBy: 'admin-super' });
  const recycled = await recycleSlot(db, { slotCode: 'mercury', academicYear: 2030, currentSemester: 1, createdBy: 'admin-super' });

  const auditLogs = await db.query('SELECT * FROM cohort_audit_logs ORDER BY created_at ASC');
  assert.ok(auditLogs.length >= 4);

  const operations = auditLogs.map(l => l.action || l.operation);
  assert.ok(operations.includes('create'));
  assert.ok(operations.includes('promote'));
  assert.ok(operations.includes('graduate'));
  assert.ok(operations.includes('recycle_slot'));
});

test('Phase 3: Admin Cohorts API Endpoints', async (t) => {
  const { db } = await createTestFixture(t);

  const app = express();
  app.use(express.json());

  // Insert admin and student into students table for foreign key validation
  await db.query("INSERT INTO students (studentId, name, role) VALUES ('admin-1', 'Admin User', 'admin')");
  await db.query("INSERT INTO students (studentId, name, role) VALUES ('student-1', 'Student User', 'student')");

  // Mock auth middleware: inject req.user
  let currentUser = { studentId: 'admin-1', role: 'admin' };
  app.use((req, res, next) => {
    req.user = currentUser;
    next();
  });

  const router = createAdminCohortsRouter({ db });
  app.use('/api/admin', router);

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/admin`;

  t.after(async () => {
    await new Promise(r => server.close(r));
  });

  // 1. GET /cohorts initially empty
  let res = await fetch(`${baseUrl}/cohorts`);
  assert.equal(res.status, 200);
  let json = await res.json();
  assert.equal(json.cohorts.length, 0);
  assert.equal(json.availableSlots.length, 4);

  // 2. POST /cohorts (Allocate)
  res = await fetch(`${baseUrl}/cohorts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slotCode: 'mercury', currentSemester: 1, displayName: 'Mercury 2026', academicYear: 2026 })
  });
  const created = await res.json();
  assert.equal(res.status, 201, `POST /cohorts failed with status ${res.status}: ${JSON.stringify(created)}`);
  assert.equal(created.cohort.slotCode, 'mercury');
  const cohortId = created.cohort.id;

  // 3. POST /cohorts/:id/promote
  res = await fetch(`${baseUrl}/cohorts/${cohortId}/promote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedSemester: 1 })
  });
  assert.equal(res.status, 200);
  const promoted = await res.json();
  assert.equal(promoted.currentSemester, 2);

  // 4. GET /cohorts/:id/history
  res = await fetch(`${baseUrl}/cohorts/${cohortId}/history`);
  assert.equal(res.status, 200);
  const hist = await res.json();
  assert.equal(hist.history.semesters.length, 2);

  // 5. POST /cohorts/:id/graduate
  res = await fetch(`${baseUrl}/cohorts/${cohortId}/graduate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  assert.equal(res.status, 200);
  const graduated = await res.json();
  assert.equal(graduated.status, 'graduated');

  // 6. Slot mercury is now available again
  res = await fetch(`${baseUrl}/cohorts`);
  json = await res.json();
  assert.ok(json.availableSlots.includes('mercury'));

  // 7. Non-admin forbidden
  currentUser = { studentId: 'student-1', role: 'student' };
  res = await fetch(`${baseUrl}/cohorts`);
  assert.equal(res.status, 403);
});
