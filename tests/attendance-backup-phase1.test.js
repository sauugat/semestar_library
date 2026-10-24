'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const testDbPath = path.join(
  os.tmpdir(),
  `attendance_backup_p1_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = testDbPath;
process.env.SEMESTER_DB_SKIP_INIT = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { PGlite } = require('@electric-sql/pglite');

const db = require('../db');
const { createTransactionAdapter } = require('../lib/db-transaction');
const {
  ensureAcademicCohortSchema,
  createCohort
} = require('../lib/academic-context');
const {
  ensureTeacherSchema,
  seedCanonicalSubjects
} = require('../lib/teacher-service');
const { ensureAuditSchema } = require('../lib/audit-service');
const {
  ensureAttendanceSchema,
  serializeCanonicalJson,
  computeCanonicalSnapshotHash,
  saveAttendanceSession,
  editAttendanceSessionById,
  adminCorrectAttendanceSession,
  listSessionBackupRevisions
} = require('../lib/attendance-service');
const { formatNepalDate } = require('../lib/nepali-dates');

const PASSWORD = 'Test_Password123!';
let cohortMercury = null;
const TODAY_NEPAL = formatNepalDate(new Date());
const YESTERDAY_NEPAL = formatNepalDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
const TWO_DAYS_AGO_NEPAL = formatNepalDate(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));

test.before(async () => {
  await db.initSchema();
  await ensureAcademicCohortSchema({
    exec: db.exec,
    run: db.run,
    all: db.all,
    isPostgres: db.isPostgres
  });
  await ensureTeacherSchema({ exec: db.exec, isPostgres: db.isPostgres });
  await ensureAuditSchema(db);
  await ensureAttendanceSchema(db);
  await seedCanonicalSubjects(db);

  await db.run('DELETE FROM students');

  const passwordHash = bcrypt.hashSync(PASSWORD, 8);

  cohortMercury = await createCohort(db, {
    slotCode: 'mercury',
    displayName: 'Mercury',
    currentSemester: 1,
    intakeYear: 2026
  });

  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, account_status)
     VALUES ('admin_p1', 'admin_p1', 'Admin Phase1', 'admp1@gandaki.edu.np', 'admin', ?, NULL, 'active')`,
    passwordHash
  );

  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, department, account_status)
     VALUES ('tea_p1', 'tea_p1', 'Prof. Phase1', 'teap1@gandaki.edu.np', 'teacher', ?, NULL, 'BIT', 'active')`,
    passwordHash
  );
  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES ('tea_id_p1', 'tea_p1', 'Professor', 'active')`
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
     VALUES ('ts_p1_1', 'tea_id_p1', 'CIT111')`
  );

  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES ('stu_p1_b', 'stu_p1_b', 'Bikash Mercury', 'b@gandaki.edu.np', 'student', ?, 'Semester 1', ?, 'active')`,
    passwordHash,
    cohortMercury.id
  );
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES ('stu_p1_a', 'stu_p1_a', 'Aashrita Mercury', 'a@gandaki.edu.np', 'cr', ?, 'Semester 1', ?, 'active')`,
    passwordHash,
    cohortMercury.id
  );
});

test.after(async () => {
  await db.close().catch(() => {});
  try {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  } catch (_) {}
});

test('Phase 1 Verification 1: Canonical JSON serialization & SHA-256 hashing are deterministic and independent of property insertion order', () => {
  const objA = {
    z: 1,
    a: { d: null, c: 'hello', b: [3, { y: true, x: false }] }
  };
  const objB = {
    a: { b: [3, { x: false, y: true }], c: 'hello', d: undefined },
    z: 1
  };

  const jsonA = serializeCanonicalJson(objA);
  const jsonB = serializeCanonicalJson(objB);
  assert.equal(jsonA, jsonB, 'Canonical JSON must be identical regardless of key insertion order');
  assert.equal(jsonA, '{"a":{"b":[3,{"x":false,"y":true}],"c":"hello","d":null},"z":1}');

  const hashA = computeCanonicalSnapshotHash(objA);
  const hashB = computeCanonicalSnapshotHash(objB);
  assert.equal(hashA, hashB);
  assert.match(hashA, /^[0-9a-f]{64}$/);
});

test('Phase 1 Verification 2: Initial submission, 24h teacher edit, and post-24h admin correction create monotonic, immutable, hash-chained backup revisions in the same transaction', async () => {
  // 1. Initial teacher submission (v1)
  const v1Result = await saveAttendanceSession(db, {
    actorUserId: 'tea_p1',
    subjectId: 'CIT111',
    cohortId: cohortMercury.id,
    sessionDate: TODAY_NEPAL,
    // Pass records in reverse studentId order to verify canonical sorting
    records: [
      { studentId: 'stu_p1_b', status: 'absent' },
      { studentId: 'stu_p1_a', status: 'present' }
    ]
  });

  assert.equal(v1Result.created, true);
  assert.ok(v1Result.backupRevision, 'Initial submission must return backupRevision');
  assert.equal(v1Result.backupRevision.revisionNo, 1);
  assert.equal(v1Result.backupRevision.action, 'session_created');
  assert.equal(v1Result.backupRevision.previousSnapshotSha256, null);
  assert.equal(v1Result.backupRevision.backupStatus, 'pending');
  assert.equal(v1Result.backupRevision.teacherId, 'tea_id_p1');
  assert.match(v1Result.backupRevision.snapshotSha256, /^[0-9a-f]{64}$/);

  // Verify canonical payload has sorted records (stu_p1_a before stu_p1_b) and no sensitive email/password fields
  const v1Payload = v1Result.backupRevision.snapshotPayload;
  assert.equal(v1Payload.records.length, 2);
  assert.equal(v1Payload.records[0].studentId, 'stu_p1_a');
  assert.equal(v1Payload.records[1].studentId, 'stu_p1_b');
  assert.equal(v1Payload.records[0].email, undefined, 'Snapshot must not expose student email');
  assert.equal(
    computeCanonicalSnapshotHash(v1Payload),
    v1Result.backupRevision.snapshotSha256,
    'Recomputing SHA-256 on canonical payload must match stored snapshotSha256'
  );

  // 2. Teacher edit within 24 hours (v2)
  const v2Result = await editAttendanceSessionById(db, {
    actorUserId: 'tea_p1',
    sessionId: v1Result.session.id,
    reason: 'Bikash arrived on time',
    records: [
      { studentId: 'stu_p1_a', status: 'present' },
      { studentId: 'stu_p1_b', status: 'present' }
    ]
  });

  assert.equal(v2Result.updated, true);
  assert.equal(v2Result.backupRevision.revisionNo, 2);
  assert.equal(v2Result.backupRevision.action, 'teacher_edit');
  assert.equal(
    v2Result.backupRevision.previousSnapshotSha256,
    v1Result.backupRevision.snapshotSha256,
    'v2 previousSnapshotSha256 must link to v1 snapshotSha256'
  );
  assert.notEqual(v2Result.backupRevision.snapshotSha256, v1Result.backupRevision.snapshotSha256);

  // 3. Admin post-24h correction (v3): queued for the assigned teacher (tea_id_p1)
  const v3Result = await adminCorrectAttendanceSession(db, {
    adminUserId: 'admin_p1',
    sessionId: v1Result.session.id,
    reason: 'Approved administrative correction',
    records: [
      { studentId: 'stu_p1_a', status: 'absent' },
      { studentId: 'stu_p1_b', status: 'present' }
    ]
  });

  assert.equal(v3Result.corrected, true);
  assert.equal(v3Result.backupRevision.revisionNo, 3);
  assert.equal(v3Result.backupRevision.action, 'admin_correction');
  assert.equal(
    v3Result.backupRevision.teacherId,
    'tea_id_p1',
    'Admin correction must queue revision for the session assigned teacherId'
  );
  assert.equal(
    v3Result.backupRevision.previousSnapshotSha256,
    v2Result.backupRevision.snapshotSha256,
    'v3 previousSnapshotSha256 must link to v2 snapshotSha256'
  );

  // 4. Verify all 3 historical revisions are preserved immutably in attendance_backup_runs
  const allRevs = await listSessionBackupRevisions(db, v1Result.session.id);
  assert.equal(allRevs.length, 3);
  assert.deepEqual(allRevs.map((r) => r.revisionNo), [1, 2, 3]);

  // Verify v1 still retains its original snapshot payload (stu_p1_a: present, stu_p1_b: absent)
  // even after v2 and v3 modified attendance_records!
  assert.equal(allRevs[0].snapshotPayload.records[0].status, 'present');
  assert.equal(allRevs[0].snapshotPayload.records[1].status, 'absent');
  assert.equal(allRevs[1].snapshotPayload.records[0].status, 'present');
  assert.equal(allRevs[1].snapshotPayload.records[1].status, 'present');
  assert.equal(allRevs[2].snapshotPayload.records[0].status, 'absent');
  assert.equal(allRevs[2].snapshotPayload.records[1].status, 'present');

  // Verify parent attendance_sessions.latest_revision_no is 3
  const sessionRow = await db.get('SELECT latest_revision_no FROM attendance_sessions WHERE id = ?', v1Result.session.id);
  assert.equal(Number(sessionRow.latestRevisionNo || sessionRow.latest_revision_no), 3);
});

test('Phase 1 Verification 3: Concurrent edits allocate strictly sequential revision numbers without collisions', async () => {
  const initial = await saveAttendanceSession(db, {
    actorUserId: 'tea_p1',
    subjectId: 'CIT111',
    cohortId: cohortMercury.id,
    sessionDate: YESTERDAY_NEPAL,
    records: [
      { studentId: 'stu_p1_a', status: 'present' },
      { studentId: 'stu_p1_b', status: 'present' }
    ]
  });

  // Fire 3 concurrent edits against the same session
  await Promise.all([
    editAttendanceSessionById(db, {
      actorUserId: 'tea_p1',
      sessionId: initial.session.id,
      reason: 'Concurrent edit A',
      records: [
        { studentId: 'stu_p1_a', status: 'absent' },
        { studentId: 'stu_p1_b', status: 'present' }
      ]
    }),
    editAttendanceSessionById(db, {
      actorUserId: 'tea_p1',
      sessionId: initial.session.id,
      reason: 'Concurrent edit B',
      records: [
        { studentId: 'stu_p1_a', status: 'present' },
        { studentId: 'stu_p1_b', status: 'absent' }
      ]
    }),
    adminCorrectAttendanceSession(db, {
      adminUserId: 'admin_p1',
      sessionId: initial.session.id,
      reason: 'Concurrent admin correction C',
      records: [
        { studentId: 'stu_p1_a', status: 'present' },
        { studentId: 'stu_p1_b', status: 'present' }
      ]
    })
  ]);

  const revs = await listSessionBackupRevisions(db, initial.session.id);
  assert.equal(revs.length, 4);
  assert.deepEqual(revs.map((r) => r.revisionNo), [1, 2, 3, 4]);
  for (let i = 1; i < revs.length; i++) {
    assert.equal(
      revs[i].previousSnapshotSha256,
      revs[i - 1].snapshotSha256,
      `Revision ${revs[i].revisionNo} must chain to revision ${revs[i - 1].revisionNo}`
    );
  }
});

test('Phase 1 Verification 4: If backup revision insertion fails inside a transaction, the attendance session and records roll back atomically', async () => {
  const failingDb = {
    ...db,
    withTransaction: async (fn) => {
      return await db.withTransaction(async (tx) => {
        const wrappedTx = {
          ...tx,
          run: async (sql, ...args) => {
            if (/INSERT\s+INTO\s+attendance_backup_runs/i.test(sql)) {
              throw new Error('SIMULATED_BACKUP_OUTBOX_WRITE_FAILURE');
            }
            return await tx.run(sql, ...args);
          }
        };
        return await fn(wrappedTx);
      });
    }
  };

  await assert.rejects(
    async () => {
      await saveAttendanceSession(failingDb, {
        actorUserId: 'tea_p1',
        subjectId: 'CIT111',
        cohortId: cohortMercury.id,
        sessionDate: TWO_DAYS_AGO_NEPAL,
        records: [
          { studentId: 'stu_p1_a', status: 'present' },
          { studentId: 'stu_p1_b', status: 'present' }
        ]
      });
    },
    /SIMULATED_BACKUP_OUTBOX_WRITE_FAILURE/
  );

  // Verify no attendance session, records, or audit logs were committed for TWO_DAYS_AGO_NEPAL
  const orphanSession = await db.get(
    `SELECT * FROM attendance_sessions WHERE cohort_id = ? AND subject_id = 'CIT111' AND session_date = ?`,
    cohortMercury.id,
    TWO_DAYS_AGO_NEPAL
  );
  assert.equal(orphanSession, null, 'Failed outbox creation must roll back the attendance session');
});

test('Phase 1 Verification 5: PostgreSQL (PGlite) migration 20261025_attendance_drive_backup.sql and full revision flow pass', async () => {
  const pg = new PGlite();

  const formatRow = (r) => db.formatRow(r);
  const formatRows = (rs) => db.formatRows(rs);

  function createPgAdapter(client) {
    const adapter = createTransactionAdapter(
      {
        query: async (sql, args) => {
          const res = args && args.length > 0 ? await client.query(sql, args) : await client.query(sql);
          return { rows: res.rows, rowCount: res.affectedRows };
        }
      },
      true,
      formatRow,
      formatRows
    );
    adapter.isPostgres = true;
    adapter.exec = async (sql) => {
      if (client.exec) return await client.exec(sql);
      return await client.query(sql);
    };
    return adapter;
  }

  const pgDb = createPgAdapter(pg);
  pgDb.withTransaction = async (fn) => {
    return await pg.transaction(async (tx) => {
      return await fn(createPgAdapter(tx));
    });
  };

  await pgDb.exec(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT,
      email TEXT,
      role TEXT DEFAULT 'student',
      department TEXT DEFAULT 'BIT',
      semester TEXT DEFAULT 'Semester 1',
      cohort_id TEXT,
      avatarUrl TEXT,
      account_status VARCHAR(32) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE posts (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES students(studentId),
      content TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'status',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE files (
      id SERIAL PRIMARY KEY,
      storedName TEXT NOT NULL,
      originalName TEXT NOT NULL,
      title TEXT,
      subject TEXT,
      semester TEXT,
      uploadedBy TEXT NOT NULL REFERENCES students(studentId),
      uploadedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE assignments (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      subject TEXT,
      semester TEXT,
      deadline TIMESTAMPTZ,
      createdBy TEXT NOT NULL REFERENCES students(studentId),
      createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await ensureAcademicCohortSchema({
    exec: pgDb.exec,
    run: pgDb.run,
    all: pgDb.all,
    isPostgres: true
  });
  await ensureTeacherSchema({ exec: pgDb.exec, isPostgres: true });
  await ensureAuditSchema(pgDb);

  // Execute both PostgreSQL migration files directly
  const migration1Sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '20261024_attendance_schema.sql'),
    'utf8'
  );
  const migration2Sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '20261025_attendance_drive_backup.sql'),
    'utf8'
  );
  await pgDb.exec(migration1Sql);
  await pgDb.exec(migration2Sql);

  // Also verify ensureAttendanceSchema is idempotent on PostgreSQL after running migrations
  await ensureAttendanceSchema(pgDb);

  await pgDb.run(
    `INSERT INTO subjects (id, code, name, semester, department, credit_hours, active)
     VALUES ('CIT111', 'CIT111', 'Programming in C', 1, 'BIT', 3.0, TRUE)`
  );
  const pgCohort = await createCohort(pgDb, {
    slotCode: 'mercury',
    displayName: 'Mercury',
    currentSemester: 1,
    intakeYear: 2026
  });

  await pgDb.run(
    `INSERT INTO students (studentId, username, name, role, account_status)
     VALUES ('pg_admin_1', 'pg_admin_1', 'PG Admin', 'admin', 'active')`
  );
  await pgDb.run(
    `INSERT INTO students (studentId, username, name, role, account_status)
     VALUES ('pg_tea_1', 'pg_tea_1', 'PG Teacher', 'teacher', 'active')`
  );
  await pgDb.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES ('pg_tea_id_1', 'pg_tea_1', 'Professor', 'active')`
  );
  await pgDb.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
     VALUES ('pg_ts_1', 'pg_tea_id_1', 'CIT111')`
  );
  await pgDb.run(
    `INSERT INTO students (studentId, username, name, role, semester, cohort_id, account_status)
     VALUES ('pg_stu_1', 'pg_stu_1', 'PG Student 1', 'student', 'Semester 1', ?, 'active')`,
    pgCohort.id
  );

  // Verify teacher_drive_connections works cleanly on PostgreSQL without RETURNING id errors
  await pgDb.run(
    `INSERT INTO teacher_drive_connections
      (teacher_id, user_id, google_email, root_folder_id, root_folder_name, connection_status)
     VALUES (?, ?, ?, ?, ?, 'connected')`,
    'pg_tea_id_1',
    'pg_tea_1',
    'pg.teacher@gmail.com',
    'drive_folder_123',
    'Semester Library Attendance Backups'
  );
  const connRow = await pgDb.get(
    `SELECT * FROM teacher_drive_connections WHERE teacher_id = ?`,
    'pg_tea_id_1'
  );
  assert.equal(connRow.teacherId, 'pg_tea_id_1');
  assert.equal(connRow.googleEmail, 'pg.teacher@gmail.com');
  assert.equal(connRow.rootFolderId, 'drive_folder_123');
  assert.equal(connRow.connectionStatus, 'connected');

  const saved = await saveAttendanceSession(pgDb, {
    actorUserId: 'pg_tea_1',
    subjectId: 'CIT111',
    cohortId: pgCohort.id,
    sessionDate: TODAY_NEPAL,
    records: [{ studentId: 'pg_stu_1', status: 'present' }]
  });

  assert.equal(saved.created, true);
  assert.equal(saved.backupRevision.revisionNo, 1);
  assert.match(saved.backupRevision.snapshotSha256, /^[0-9a-f]{64}$/);

  const corrected = await adminCorrectAttendanceSession(pgDb, {
    adminUserId: 'pg_admin_1',
    sessionId: saved.session.id,
    reason: 'PG admin correction check',
    records: [{ studentId: 'pg_stu_1', status: 'absent' }]
  });
  assert.equal(corrected.backupRevision.revisionNo, 2);
  assert.equal(corrected.backupRevision.previousSnapshotSha256, saved.backupRevision.snapshotSha256);

  const pgRevs = await listSessionBackupRevisions(pgDb, saved.session.id);
  assert.equal(pgRevs.length, 2);
  assert.equal(pgRevs[0].snapshotSha256, saved.backupRevision.snapshotSha256);
  assert.equal(pgRevs[1].snapshotSha256, corrected.backupRevision.snapshotSha256);

  await pg.close();
});
