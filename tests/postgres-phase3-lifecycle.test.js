'use strict';

process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
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
  buildAcademicContentFilter
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

const PG_URL = process.env.DISPOSABLE_PG_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function setupPostgresFixture(t) {
  const schema = `test_phase3_${crypto.randomBytes(4).toString('hex')}`;
  const pool = new Pool({
    connectionString: `${PG_URL}?options=-csearch_path%3D${schema},public`,
    max: 10
  });

  try {
    const initClient = await pool.connect();
    await initClient.query(`CREATE SCHEMA ${schema}`);
    initClient.release();
  } catch (err) {
    t.skip(`Disposable PostgreSQL is not reachable: ${err.message}`);
    return null;
  }

  t.after(async () => {
    try {
      const cleanupClient = await pool.connect();
      await cleanupClient.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      cleanupClient.release();
      await pool.end();
    } catch {}
  });

  // Base application tables
  const setupClient = await pool.connect();
  await setupClient.query(`
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
  setupClient.release();

  const db = createTransactionAdapter(pool, true, formatRow, formatRows);
  await ensureAcademicCohortSchema(db);

  return { pool, db, schema };
}

test('Postgres Gate 1: Actual PostgreSQL Phase 3 Lifecycle Execution', async (t) => {
  const fixture = await setupPostgresFixture(t);
  if (!fixture) return;
  const { db } = fixture;

  // 1. Create Mercury cohort in Postgres
  const cohort = await createCohort(db, {
    slotCode: 'mercury',
    displayName: 'Mercury 2026',
    academicYear: 2026,
    currentSemester: 1
  });
  assert.ok(cohort.id);
  assert.equal(cohort.slotCode, 'mercury');
  assert.equal(cohort.currentSemester, 1);
  assert.equal(cohort.status, 'active');

  // Verify chat_groups linkage
  const room = await db.get('SELECT * FROM chat_groups WHERE cohort_id = ?', cohort.id);
  assert.ok(room);
  assert.equal(room.status, 'active');
  assert.equal(room.cohortId || room.cohort_id, cohort.id);

  // 2. Assign student in Postgres
  await db.run("INSERT INTO students (studentId, name, role) VALUES ('PG_ALICE', 'Alice PG', 'student')");
  await assignStudentToCohort(db, 'PG_ALICE', cohort.id);
  const alice = await db.get("SELECT * FROM students WHERE studentId = 'PG_ALICE'");
  assert.equal(alice.cohortId || alice.cohort_id, cohort.id);
  assert.equal(alice.semester, 'Semester 1');

  // 3. Promote across semesters 1 -> 2 in Postgres
  const promoted = await promoteCohort(db, cohort.id, { expectedSemester: 1 });
  assert.equal(promoted.id, cohort.id, 'UUID must remain identical in Postgres');
  assert.equal(promoted.currentSemester, 2);

  // Verify chat room identity remains identical
  const roomAfterPromo = await db.get('SELECT * FROM chat_groups WHERE cohort_id = ?', cohort.id);
  assert.equal(roomAfterPromo.id, room.id, 'Chat room UUID must remain identical in Postgres');

  // Verify semester history progression
  const hist = await getCohortHistory(db, cohort.id);
  assert.equal(hist.semesters.length, 2);
  assert.ok(hist.semesters[0].endedAt, 'Sem 1 record must be closed');
  assert.equal(hist.semesters[1].endedAt, null, 'Sem 2 record must be open');

  // 4. Verify audit logging in Postgres
  const audits = await db.all('SELECT * FROM cohort_audit_logs WHERE cohort_id = ? ORDER BY created_at ASC', cohort.id);
  assert.ok(audits.length >= 3);
  const actions = audits.map(a => a.action);
  assert.ok(actions.includes('create'));
  assert.ok(actions.includes('assign_student'));
  assert.ok(actions.includes('promote'));
});

test('Postgres Gate 2: PostgreSQL Promotion Race Concurrency', async (t) => {
  const fixture = await setupPostgresFixture(t);
  if (!fixture) return;
  const { db } = fixture;

  // Insert admin users for foreign key integrity
  await db.run("INSERT INTO students (studentId, name, role) VALUES ('ADMIN_A', 'Admin A', 'admin')");
  await db.run("INSERT INTO students (studentId, name, role) VALUES ('ADMIN_B', 'Admin B', 'admin')");

  const cohort = await createCohort(db, {
    slotCode: 'mercury',
    displayName: 'Mercury Concurrency PG',
    academicYear: 2026,
    currentSemester: 1
  });

  // Competing promotions expecting Sem 1
  const results = await Promise.allSettled([
    promoteCohort(db, cohort.id, { expectedSemester: 1, actorId: 'ADMIN_A' }),
    promoteCohort(db, cohort.id, { expectedSemester: 1, actorId: 'ADMIN_B' })
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'Exactly one promotion must succeed in Postgres');
  assert.equal(rejected.length, 1, 'Competing promotion must be rejected with 409 in Postgres');
  assert.equal(rejected[0].reason.status, 409);

  // Final semester must be 2, NOT 3
  const current = await db.get('SELECT * FROM cohorts WHERE id = ?', cohort.id);
  assert.equal(Number(current.currentSemester || current.current_semester), 2);

  // Exactly one new semester history record
  const hist = await getCohortHistory(db, cohort.id);
  assert.equal(hist.semesters.length, 2);
  assert.equal(hist.semesters[1].semesterNo, 2);
  assert.equal(hist.semesters[1].endedAt, null);
});

test('Postgres Gate 3: PostgreSQL Partial Unique Index & Slot Conflict', async (t) => {
  const fixture = await setupPostgresFixture(t);
  if (!fixture) return;
  const { db } = fixture;

  // 1. Create Active Mars UUID-A
  const cohortA = await createCohort(db, {
    slotCode: 'mars',
    displayName: 'Mars Batch A',
    academicYear: 2026,
    currentSemester: 1
  });
  const uuidA = cohortA.id;

  // 2. Attempt another active Mars -> MUST fail
  await assert.rejects(
    () => createCohort(db, { slotCode: 'mars', displayName: 'Mars Imposter', currentSemester: 1 }),
    err => (err.status === 409 || /occupied|unique/i.test(err.message))
  );

  // 3. Graduate UUID-A
  await graduateCohort(db, uuidA);

  // 4. Recycle slot Mars -> UUID-B
  const cohortB = await recycleSlot(db, {
    slotCode: 'mars',
    displayName: 'Mars Batch B Freshmen',
    academicYear: 2030,
    currentSemester: 1
  });
  const uuidB = cohortB.id;

  assert.notEqual(uuidB, uuidA, 'Recycled cohort UUID in Postgres must be brand new');
  assert.equal(cohortB.slotCode, 'mars');
  assert.equal(cohortB.status, 'active');

  // Verify chat room identities differ
  const roomA = await db.get('SELECT * FROM chat_groups WHERE cohort_id = ?', uuidA);
  const roomB = await db.get('SELECT * FROM chat_groups WHERE cohort_id = ?', uuidB);
  assert.equal(roomA.status, 'closed');
  assert.equal(roomB.status, 'active');
  assert.notEqual(roomB.id, roomA.id);
});

test('Postgres Gate 4: PostgreSQL Graduation & Double-Graduation Idempotency', async (t) => {
  const fixture = await setupPostgresFixture(t);
  if (!fixture) return;
  const { db } = fixture;

  const cohort = await createCohort(db, {
    slotCode: 'earth',
    displayName: 'Earth Seniors',
    academicYear: 2022,
    currentSemester: 8
  });

  // First graduation
  const grad1 = await graduateCohort(db, cohort.id);
  assert.equal(grad1.status, 'graduated');

  // Verify DB state
  const dbCohort = await db.get('SELECT * FROM cohorts WHERE id = ?', cohort.id);
  assert.equal(dbCohort.status, 'graduated');
  assert.ok(dbCohort.graduatedAt || dbCohort.graduated_at);

  const room = await db.get('SELECT * FROM chat_groups WHERE cohort_id = ?', cohort.id);
  assert.equal(room.status, 'closed');

  const hist = await getCohortHistory(db, cohort.id);
  assert.ok(hist.semesters[0].endedAt, 'Final semester history must be closed');

  // Second graduation: safe idempotent response
  const grad2 = await graduateCohort(db, cohort.id);
  assert.equal(grad2.status, 'graduated');
  assert.equal(grad2.alreadyGraduated, true);

  // Verify no duplicate history records created
  const histAfter = await getCohortHistory(db, cohort.id);
  assert.equal(histAfter.semesters.length, 1);
});
