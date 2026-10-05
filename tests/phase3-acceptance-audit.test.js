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
  buildAcademicContentFilter
} = require('../lib/academic-context');
const { createAdminCohortsRouter } = require('../routes/admin-cohorts');
const { createCohortChatService } = require('../lib/cohort-chat');
const { migrateCohortChat } = require('../migrations/002-cohort-chat');
const push = require('../lib/push-notifications');

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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-audit-test-'));
  const dbFile = path.join(tempDir, 'test.db');
  const client = createClient({ url: `file:${dbFile}` });

  function wrapAdapter(c) {
    const adapter = createTransactionAdapter(c, false, formatRow, formatRows);
    adapter.queryOne = (sql, ...args) => {
      const flat = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      return adapter.get(sql, ...flat);
    };
    adapter.query = (sql, ...args) => {
      const flat = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      return adapter.all(sql, ...flat);
    };
    return adapter;
  }

  const db = wrapAdapter(client);
  let queue = Promise.resolve();
  db.withTransaction = fn => {
    const operation = queue.then(async () => {
      const tx = await client.transaction('write');
      try {
        const wrappedTx = wrapAdapter(tx);
        wrappedTx.withTransaction = innerFn => innerFn(wrappedTx);
        const result = await fn(wrappedTx);
        await tx.commit();
        return result;
      } catch (error) {
        await tx.rollback();
        throw error;
      } finally {
        tx.close();
      }
    });
    queue = operation.catch(() => {});
    return operation;
  };

  t.after(async () => {
    await queue;
    client.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await db.exec(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT,
      role TEXT DEFAULT 'student',
      department TEXT DEFAULT 'BIT',
      semester TEXT DEFAULT 'Semester 1',
      cohort_id TEXT,
      avatarUrl TEXT,
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

    CREATE TABLE file_blobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT UNIQUE,
      mimeType TEXT,
      fileData BLOB,
      createdAt TEXT
    );

    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      recipientStudentId TEXT NOT NULL REFERENCES students(studentId),
      cohort_id TEXT,
      title TEXT,
      body TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId TEXT NOT NULL REFERENCES students(studentId),
      text TEXT,
      attachmentName TEXT,
      attachmentOriginalName TEXT,
      attachmentMimeType TEXT,
      replyToId INTEGER,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE chat_reactions (
      messageId INTEGER REFERENCES chat_messages(id),
      studentId TEXT REFERENCES students(studentId),
      emoji TEXT,
      PRIMARY KEY(messageId, studentId)
    );

    CREATE TABLE chat_read_receipts (
      studentId TEXT PRIMARY KEY,
      lastReadMessageId INTEGER
    );

    CREATE TABLE chat_typing (
      studentId TEXT PRIMARY KEY,
      lastTypedAt TEXT
    );
  `);

  await ensureAcademicCohortSchema(db);
  await push.ensurePushNotificationSchema(db);
  await migrateCohortChat(db, { disposable: true });

  return { db };
}

test('Gate 7: Live Promotion Chat Continuity (Same Room, History Remains, New Context)', async (t) => {
  const { db } = await createAuditFixture(t);

  const cohort = await createCohort(db, {
    slotCode: 'mercury',
    academicYear: 2026,
    currentSemester: 1,
    displayName: 'Mercury Batch'
  });
  const uuidA = cohort.id;

  // Insert students
  await db.query("INSERT INTO students (studentId, name, role, cohort_id, semester) VALUES ('s1', 'Alice', 'student', ?, 'Semester 1')", [uuidA]);
  await db.query("INSERT INTO students (studentId, name, role, cohort_id, semester) VALUES ('s2', 'Bob', 'student', ?, 'Semester 1')", [uuidA]);

  const service = createCohortChatService({ db, providers: { now: () => '2026-10-05T12:00:00.000Z' } });

  // 1. Send messages in Semester 1
  const m1 = await service.send('s1', { text: 'Hello in Sem 1', clientId: 'c1' });
  const m2 = await service.send('s2', { text: 'Reply in Sem 1', clientId: 'c2' });
  assert.ok(m1.messageId);
  assert.ok(m2.messageId);

  const roomBefore = await db.queryOne('SELECT * FROM chat_groups WHERE cohort_id = ?', [uuidA]);
  const roomX = roomBefore.id;

  // 2. Promote cohort: Sem 1 -> Sem 2
  await promoteCohort(db, uuidA, { expectedSemester: 1 });

  // 3. Refresh context for students
  const ctxA = await service.context('s1');
  const ctxB = await service.context('s2');

  assert.equal(ctxA.cohortId, uuidA, 'Cohort UUID MUST remain permanent');
  assert.equal(ctxA.chatGroupId, roomX, 'Room UUID MUST remain permanent');
  assert.equal(ctxA.currentSemester, 2, 'Authoritative context MUST report Semester 2');
  assert.equal(ctxB.currentSemester, 2);

  // 4. Verify existing history remains fully readable
  const hist = await service.history('s1');
  const texts = hist.messages.map(m => m.text);
  assert.ok(texts.includes('Hello in Sem 1'));
  assert.ok(texts.includes('Reply in Sem 1'));

  // 5. Send new message in Semester 2
  const m3 = await service.send('s1', { text: 'First message in Sem 2', clientId: 'c3' });
  assert.ok(m3.messageId);

  const histAfter = await service.history('s2');
  assert.equal(histAfter.messages.length, 3);
  assert.equal(histAfter.chatGroupId, roomX);
});

test('Gate 8: Graduation Transitions Chat to Read-Only Archive', async (t) => {
  const { db } = await createAuditFixture(t);

  const cohort = await createCohort(db, {
    slotCode: 'mars',
    academicYear: 2026,
    currentSemester: 8,
    displayName: 'Mars Seniors'
  });
  const uuidA = cohort.id;
  await db.query("INSERT INTO students (studentId, name, role, cohort_id, semester) VALUES ('senior_1', 'Senior One', 'student', ?, 'Semester 8')", [uuidA]);

  const service = createCohortChatService({ db, providers: { now: () => '2026-10-05T12:00:00.000Z' } });
  await service.send('senior_1', { text: 'Senior farewell message', clientId: 'sen-1' });

  // Graduate cohort
  await graduateCohort(db, uuidA);

  // 1. Standard active context throws 404/unavailable
  await assert.rejects(
    () => service.context('senior_1'),
    err => err.status === 404
  );

  // 2. Active sends are strictly rejected
  await assert.rejects(
    () => service.send('senior_1', { text: 'Illegal post after grad', clientId: 'sen-bad' }),
    err => err.status === 404
  );

  // 3. Room status in database is closed
  const room = await db.queryOne('SELECT * FROM chat_groups WHERE cohort_id = ?', [uuidA]);
  assert.equal(room.status, 'closed');
});

test('Gate 9 & 10: Recycled Slot Absolute Isolation & Old Student Exclusion', async (t) => {
  const { db } = await createAuditFixture(t);

  // 1. Create and graduate Mars UUID-A
  const cohortA = await createCohort(db, { slotCode: 'mars', academicYear: 2026, currentSemester: 8, displayName: 'Mars 2026' });
  const uuidA = cohortA.id;
  await db.query("INSERT INTO students (studentId, name, role, cohort_id, semester) VALUES ('old_student', 'Old Student O', 'student', ?, 'Semester 8')", [uuidA]);

  const service = createCohortChatService({ db, providers: { now: () => '2026-10-05T12:00:00.000Z' } });
  const msgA = await service.send('old_student', { text: 'Secret Mars A Note', clientId: 'msg-a' });
  const roomA = (await db.queryOne('SELECT * FROM chat_groups WHERE cohort_id = ?', [uuidA])).id;

  await graduateCohort(db, uuidA);

  // 2. Recycle Mars for new Freshmen UUID-B
  const cohortB = await recycleSlot(db, { slotCode: 'mars', academicYear: 2030, currentSemester: 1, displayName: 'Mars 2030 Freshmen' });
  const uuidB = cohortB.id;
  const roomB = (await db.queryOne('SELECT * FROM chat_groups WHERE cohort_id = ?', [uuidB])).id;

  assert.notEqual(uuidB, uuidA);
  assert.notEqual(roomB, roomA);

  await db.query("INSERT INTO students (studentId, name, role, cohort_id, semester) VALUES ('new_student', 'Freshman N', 'student', ?, 'Semester 1')", [uuidB]);

  // 3. Freshman N in UUID-B can use Room Y
  const ctxB = await service.context('new_student');
  assert.equal(ctxB.cohortId, uuidB);
  assert.equal(ctxB.chatGroupId, roomB);
  await service.send('new_student', { text: 'Hello Freshmen Mars B', clientId: 'msg-b' });

  // 4. Freshman N CANNOT fetch Room X messages or exact deep link
  await assert.rejects(
    () => service.exact('new_student', roomA, msgA.messageId),
    err => err.status === 404
  );

  // 5. Old Student O does NOT automatically gain access to UUID-B merely because slot_code='mars'
  const oldStudent = await db.queryOne("SELECT cohort_id FROM students WHERE studentId = 'old_student'");
  assert.equal(oldStudent.cohortId || oldStudent.cohort_id, uuidA);
  assert.notEqual(oldStudent.cohortId || oldStudent.cohort_id, uuidB);

  await assert.rejects(
    () => service.send('old_student', { text: 'Old student trying to post in new Mars', clientId: 'old-hack' }),
    err => err.status === 404
  );
});

test('Gate 11 & 12: Student Reassignment and In-Flight Request Isolation', async (t) => {
  const { db } = await createAuditFixture(t);

  const mercury = await createCohort(db, { slotCode: 'mercury', academicYear: 2026, currentSemester: 2 });
  const venus = await createCohort(db, { slotCode: 'venus', academicYear: 2026, currentSemester: 3 });

  await db.query("INSERT INTO students (studentId, name, role, cohort_id, semester) VALUES ('transfer_stu', 'Transfer User', 'student', ?, 'Semester 2')", [mercury.id]);

  const service = createCohortChatService({ db, providers: { now: () => '2026-10-05T12:00:00.000Z' } });

  // Initial context is Mercury
  const ctxInit = await service.context('transfer_stu');
  assert.equal(ctxInit.cohortId, mercury.id);

  // Simulate in-flight capture of Mercury context
  const inFlightMercuryRoom = ctxInit.chatGroupId;

  // Admin reassigns student to Venus
  await reassignStudentCohort(db, 'transfer_stu', venus.id, { actorId: 'ADMIN_01' });

  // Authoritative academic context now returns Venus
  const academicCtx = await getAcademicContext(db, { studentId: 'transfer_stu' });
  assert.equal(academicCtx.cohort.id, venus.id);
  assert.equal(academicCtx.cohort.currentSemester, 3);

  // Student context in chat is now Venus
  const ctxNew = await service.context('transfer_stu');
  assert.equal(ctxNew.cohortId, venus.id);
  assert.notEqual(ctxNew.chatGroupId, inFlightMercuryRoom);

  // In-flight delayed response using old Mercury room token/context is rejected
  await assert.rejects(
    () => service.send('transfer_stu', { chatGroupId: inFlightMercuryRoom, text: 'Late in-flight send', clientId: 'late-1' }),
    err => err.status === 404
  );
});

test('Gate 13: Notification Lifecycle (Promotion, Graduation, Recycled Slot)', async (t) => {
  const { db } = await createAuditFixture(t);

  const cohort = await createCohort(db, { slotCode: 'mercury', academicYear: 2026, currentSemester: 1 });
  await db.query("INSERT INTO students (studentId, name, role, cohort_id, semester) VALUES ('notif_user', 'Notif User', 'student', ?, 'Semester 1')", [cohort.id]);

  // Insert notification during Semester 1
  await db.query("INSERT INTO notifications (id, recipientStudentId, cohort_id, title, body) VALUES ('n1', 'notif_user', ?, 'Notice 1', 'Sem 1 notice')", [cohort.id]);

  // Promote to Semester 2
  await promoteCohort(db, cohort.id, { expectedSemester: 1 });

  // Verify historical notification remains in inbox
  const notifs = await db.query("SELECT * FROM notifications WHERE recipientStudentId = 'notif_user'");
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].id, 'n1');

  // Graduate cohort
  await graduateCohort(db, cohort.id);

  // Recycle slot mercury
  const newMercury = await recycleSlot(db, { slotCode: 'mercury', academicYear: 2030, currentSemester: 1 });
  await db.query("INSERT INTO students (studentId, name, role, cohort_id, semester) VALUES ('new_merc_user', 'New Mercury User', 'student', ?, 'Semester 1')", [newMercury.id]);

  // New Mercury user has ZERO notifications from old Mercury
  const newNotifs = await db.query("SELECT * FROM notifications WHERE recipientStudentId = 'new_merc_user'");
  assert.equal(newNotifs.length, 0);
});

test('Gate 16: Staff Inspection Distinguishes Recycled Batches', async (t) => {
  const { db } = await createAuditFixture(t);

  const cohortA = await createCohort(db, { slotCode: 'mars', displayName: 'Mars Intake 2022', intakeYear: 2022, currentSemester: 8 });
  await graduateCohort(db, cohortA.id);

  const cohortB = await recycleSlot(db, { slotCode: 'mars', displayName: 'Mars Intake 2026', intakeYear: 2026, currentSemester: 1 });

  const allCohorts = await getAllCohortsWithHistory(db);
  const marsCohorts = allCohorts.filter(c => c.slotCode === 'mars');

  assert.equal(marsCohorts.length, 2);
  const oldMars = marsCohorts.find(c => c.status === 'graduated');
  const newMars = marsCohorts.find(c => c.status === 'active');

  assert.ok(oldMars);
  assert.ok(newMars);
  assert.equal(oldMars.id, cohortA.id);
  assert.equal(newMars.id, cohortB.id);
  assert.equal(oldMars.intakeYear, 2022);
  assert.equal(newMars.intakeYear, 2026);
  assert.notEqual(oldMars.displayName, newMars.displayName);
});

test('Gate 17: Admin Authorization Attacks Denied for Student and CR', async (t) => {
  const { db } = await createAuditFixture(t);

  const app = express();
  app.use(express.json());

  let mockUser = { studentId: 'stu_attacker', role: 'student' };
  app.use((req, res, next) => {
    req.user = mockUser;
    next();
  });

  app.use('/api/admin', createAdminCohortsRouter({ db }));

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/admin`;

  t.after(async () => {
    await new Promise(r => server.close(r));
  });

  // Student attempt: GET /cohorts -> 403
  let res = await fetch(`${baseUrl}/cohorts`);
  assert.equal(res.status, 403);

  // Student attempt: POST /cohorts -> 403
  res = await fetch(`${baseUrl}/cohorts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slotCode: 'mercury', currentSemester: 1 })
  });
  assert.equal(res.status, 403);

  // CR attempt: role = 'cr' -> 403
  mockUser = { studentId: 'cr_attacker', role: 'cr' };
  res = await fetch(`${baseUrl}/cohorts`);
  assert.equal(res.status, 403);

  // Teacher attempt: mutation POST /cohorts -> 403
  mockUser = { studentId: 'teacher_user', role: 'teacher' };
  res = await fetch(`${baseUrl}/cohorts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slotCode: 'mercury', currentSemester: 1 })
  });
  assert.equal(res.status, 403);
});

test('Gate 18: Invalid Lifecycle Transitions Strictly Blocked', async (t) => {
  const { db } = await createAuditFixture(t);

  const cohort = await createCohort(db, { slotCode: 'mercury', currentSemester: 1 });

  // 1. Direct unexpected semester skip (expectedSemester 1, but passed 2)
  await assert.rejects(
    () => promoteCohort(db, cohort.id, { expectedSemester: 2 }),
    err => err.status === 409
  );

  // 2. Promote beyond Semester 8 -> auto-graduates instead of invalid sem 9
  // Advance to sem 8
  for (let s = 1; s <= 7; s++) {
    await promoteCohort(db, cohort.id, { expectedSemester: s });
  }
  const gradResult = await promoteCohort(db, cohort.id, { expectedSemester: 8 });
  assert.equal(gradResult.status, 'graduated');

  // 3. Promote an already graduated cohort -> 409
  await assert.rejects(
    () => promoteCohort(db, cohort.id),
    err => err.status === 409
  );

  // 4. Invalid slot code -> Error
  await assert.rejects(
    () => createCohort(db, { slotCode: 'jupiter', currentSemester: 1 }),
    /invalid slot code/i
  );

  // 5. Recycle occupied active slot -> 409
  const activeVenus = await createCohort(db, { slotCode: 'venus', currentSemester: 1 });
  await assert.rejects(
    () => recycleSlot(db, { slotCode: 'venus', currentSemester: 1 }),
    err => err.status === 409
  );
});

test('Gate 19: Audit Log Verifiability and Actor Immutability', async (t) => {
  const { db } = await createAuditFixture(t);

  await db.query("INSERT INTO students (studentId, name, role) VALUES ('SUPER_ADMIN', 'Super Admin', 'admin')");

  const cohort = await createCohort(db, { slotCode: 'earth', currentSemester: 1, actorId: 'SUPER_ADMIN' });
  await promoteCohort(db, cohort.id, { expectedSemester: 1, actorId: 'SUPER_ADMIN' });

  const logs = await db.query('SELECT * FROM cohort_audit_logs WHERE cohort_id = ? ORDER BY created_at ASC', [cohort.id]);
  assert.equal(logs.length, 2);

  assert.equal(logs[0].action, 'create');
  assert.equal(logs[0].actor_id, 'SUPER_ADMIN');
  assert.ok(logs[0].created_at);

  assert.equal(logs[1].action, 'promote');
  assert.equal(logs[1].actor_id, 'SUPER_ADMIN');
  assert.ok(logs[1].details_json.includes('previousSemester'));
});
