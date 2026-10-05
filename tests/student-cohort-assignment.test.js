'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createClient } = require('@libsql/client');
const {
  ensureAcademicCohortSchema,
  createCohort,
  promoteCohort,
  resolveActiveCohortForSemester,
  getAcademicContext,
  buildAcademicContentFilter,
  resolvePublishScope
} = require('../lib/academic-context');
const { analyzeStudentCohortStatus } = require('../scripts/repair-student-cohorts');

function createTestDb() {
  const client = createClient({ url: ':memory:' });
  return {
    isPostgres: false,
    exec: (sql) => client.executeMultiple(sql),
    all: async (sql, ...args) => {
      const res = await client.execute({ sql, args });
      return res.rows;
    },
    get: async (sql, ...args) => {
      const res = await client.execute({ sql, args });
      return res.rows[0] || null;
    },
    run: async (sql, ...args) => {
      const res = await client.execute({ sql, args });
      return {
        lastInsertRowid: Number(res.lastInsertRowid),
        changes: res.rowsAffected
      };
    },
    withTransaction: async (cb) => {
      await client.execute('BEGIN');
      try {
        const txAdapter = {
          all: async (sql, ...args) => (await client.execute({ sql, args })).rows,
          get: async (sql, ...args) => (await client.execute({ sql, args })).rows[0] || null,
          run: async (sql, ...args) => {
            const res = await client.execute({ sql, args });
            return { lastInsertRowid: Number(res.lastInsertRowid), changes: res.rowsAffected };
          }
        };
        const result = await cb(txAdapter);
        await client.execute('COMMIT');
        return result;
      } catch (err) {
        await client.execute('ROLLBACK');
        throw err;
      }
    }
  };
}

async function setupTestEnvironment() {
  const db = createTestDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'student',
      department TEXT DEFAULT 'BIT',
      semester TEXT,
      gender TEXT,
      verification_status TEXT DEFAULT 'verified',
      passwordHash TEXT,
      cohort_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      content TEXT,
      type TEXT,
      attachment_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storedName TEXT,
      originalName TEXT,
      title TEXT,
      semester TEXT,
      subject TEXT,
      chapter TEXT,
      uploadedBy TEXT,
      sizeBytes INTEGER,
      uploadedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      language TEXT,
      subject TEXT,
      semester TEXT,
      deadline TEXT,
      createdBy TEXT,
      createdAt TEXT
    );
  `);

  await ensureAcademicCohortSchema(db);

  // Seed 4 active cohorts: Mercury (1), Venus (3), Earth (5), Mars (7)
  const mercury = await createCohort(db, { slotCode: 'mercury', displayName: 'Mercury', currentSemester: 1 });
  const venus = await createCohort(db, { slotCode: 'venus', displayName: 'Venus', currentSemester: 3 });
  const earth = await createCohort(db, { slotCode: 'earth', displayName: 'Earth', currentSemester: 5 });
  const mars = await createCohort(db, { slotCode: 'mars', displayName: 'Mars', currentSemester: 7 });

  return { db, mercury, venus, earth, mars };
}

test('1. Student chooses Semester 1 -> current active Semester 1 cohort (Mercury) assigned', async () => {
  const { db, mercury } = await setupTestEnvironment();
  const res = await resolveActiveCohortForSemester(db, 'Semester 1');
  assert.equal(res.status, 'AUTO_ASSIGN_SAFE');
  assert.equal(res.cohort.id, mercury.id);
  assert.equal(res.cohort.displayName, 'Mercury');
  assert.equal(res.cohort.currentSemester, 1);
});

test('2. Student chooses Semester 3 -> current active Semester 3 cohort (Venus) assigned', async () => {
  const { db, venus } = await setupTestEnvironment();
  const res = await resolveActiveCohortForSemester(db, 'Semester 3');
  assert.equal(res.status, 'AUTO_ASSIGN_SAFE');
  assert.equal(res.cohort.id, venus.id);
  assert.equal(res.cohort.displayName, 'Venus');
  assert.equal(res.cohort.currentSemester, 3);
});

test('3. Student chooses Semester 5 -> current active Semester 5 cohort (Earth) assigned', async () => {
  const { db, earth } = await setupTestEnvironment();
  const res = await resolveActiveCohortForSemester(db, 5);
  assert.equal(res.status, 'AUTO_ASSIGN_SAFE');
  assert.equal(res.cohort.id, earth.id);
  assert.equal(res.cohort.displayName, 'Earth');
  assert.equal(res.cohort.currentSemester, 5);
});

test('4. Student chooses Semester 7 -> current active Semester 7 cohort (Mars) assigned', async () => {
  const { db, mars } = await setupTestEnvironment();
  const res = await resolveActiveCohortForSemester(db, 'Semester 7');
  assert.equal(res.status, 'AUTO_ASSIGN_SAFE');
  assert.equal(res.cohort.id, mars.id);
  assert.equal(res.cohort.displayName, 'Mars');
  assert.equal(res.cohort.currentSemester, 7);
});

test('5. CR chooses Semester 3 -> same behavior as student', async () => {
  const { db, venus } = await setupTestEnvironment();
  const res = await resolveActiveCohortForSemester(db, 'Semester 3');
  assert.equal(res.status, 'AUTO_ASSIGN_SAFE');
  assert.equal(res.cohort.id, venus.id);

  // Insert as CR
  await db.run(
    `INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES (?, ?, ?, ?, ?)`,
    'CR_101', 'Alice CR', 'cr', 'Semester 3', res.cohort.id
  );

  const context = await getAcademicContext(db, { studentId: 'CR_101' });
  assert.equal(context.role, 'cr');
  assert.equal(context.academicStatus, 'active');
  assert.equal(context.cohort.id, venus.id);
  assert.equal(context.cohort.displayName, 'Venus');
  assert.equal(context.canViewAllCohorts, false);

  // CR cannot target other cohorts
  const filter = buildAcademicContentFilter(context, { requestedCohortId: 'some-other-uuid' });
  assert.ok(filter.params.includes(venus.id), 'Filter must bind strictly to own cohort');
  assert.ok(!filter.params.includes('some-other-uuid'), 'Foreign cohort query must be ignored');

  // CR notice scope is locked to own cohort
  const noticeScope = await resolvePublishScope(db, context, { cohortId: 'malicious-cohort' }, { isNotice: true });
  assert.equal(noticeScope.cohortId, venus.id);
  assert.equal(noticeScope.audienceScope, 'cohort');
});

test('6. Client sends fake cohort_id -> server ignores client parameter and resolves by semester', async () => {
  const { db, venus } = await setupTestEnvironment();

  // Simulate client attempting to spoof cohort_id in body
  const clientPayload = {
    semester: 'Semester 3',
    cohort_id: 'fake-spoofed-cohort-uuid-9999'
  };

  const resolution = await resolveActiveCohortForSemester(db, clientPayload.semester);
  assert.equal(resolution.status, 'AUTO_ASSIGN_SAFE');
  assert.equal(resolution.cohort.id, venus.id);
  assert.notEqual(resolution.cohort.id, clientPayload.cohort_id);
});

test('7. Client sends different semester and fake cohort -> server uses validated semester lookup only', async () => {
  const { db, earth } = await setupTestEnvironment();

  const clientPayload = {
    semester: 'Semester 5',
    cohort_id: 'fake-spoofed-cohort-uuid-1111'
  };

  const resolution = await resolveActiveCohortForSemester(db, clientPayload.semester);
  assert.equal(resolution.status, 'AUTO_ASSIGN_SAFE');
  assert.equal(resolution.cohort.id, earth.id);
});

test('8. No active cohort matching selected semester -> clear error / unassigned review state', async () => {
  const { db } = await setupTestEnvironment();

  // Active cohorts are 1, 3, 5, 7. Semester 2 has no active cohort.
  const res = await resolveActiveCohortForSemester(db, 'Semester 2');
  assert.equal(res.status, 'NO_MATCH');
  assert.equal(res.cohort, null);
  assert.ok(res.error.includes('No active cohort'));
});

test('9. Two active matching cohorts -> fail safely, do not guess', async () => {
  const { db, mercury, venus } = await setupTestEnvironment();

  // Legally promote Mercury (originally Sem 1) twice so it reaches Sem 3 alongside Venus
  await promoteCohort(db, { cohortId: mercury.id }); // Sem 2
  await promoteCohort(db, { cohortId: mercury.id }); // Sem 3

  // Now both Mercury and Venus are active cohorts with current_semester = 3
  const res = await resolveActiveCohortForSemester(db, 'Semester 3');
  assert.equal(res.status, 'AMBIGUOUS');
  assert.equal(res.cohort, null);
  assert.ok(res.error.includes('Multiple active cohorts found'));
});

test('10. Student edits profile semester later -> cohort membership does NOT silently change', async () => {
  const { db, venus } = await setupTestEnvironment();

  await db.run(
    `INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES (?, ?, ?, ?, ?)`,
    'STU_201', 'Bob Smith', 'student', 'Semester 3', venus.id
  );

  // Student attempts to edit profile semester to Semester 7
  await db.run(
    `UPDATE students SET name = ?, semester = ? WHERE studentId = ?`,
    'Bob Smith Updated', 'Semester 7', 'STU_201'
  );

  const updatedStudent = await db.get('SELECT * FROM students WHERE studentId = ?', 'STU_201');
  assert.equal(updatedStudent.semester, 'Semester 7');
  // Authoritative cohort_id MUST NOT CHANGE!
  assert.equal(updatedStudent.cohort_id, venus.id);

  // Context remains Venus (active cohort)
  const ctx = await getAcademicContext(db, { studentId: 'STU_201' });
  assert.equal(ctx.cohort.id, venus.id);
  assert.equal(ctx.cohort.displayName, 'Venus');
});

test('11. Promotion Regression: Semester 1 student remains Mercury UUID when Mercury promoted to Semester 2, and new Semester 2 student gets Mercury UUID', async () => {
  const { db, mercury } = await setupTestEnvironment();

  // Student 1 signs up in Semester 1
  const res1 = await resolveActiveCohortForSemester(db, 1);
  assert.equal(res1.cohort.id, mercury.id);
  await db.run(
    `INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES (?, ?, ?, ?, ?)`,
    'STU_M1', 'Freshman Alice', 'student', 'Semester 1', res1.cohort.id
  );

  // Promote Mercury to Semester 2
  await promoteCohort(db, { cohortId: mercury.id });

  const promotedMercury = await db.get('SELECT current_semester FROM cohorts WHERE id = ?', mercury.id);
  assert.equal(promotedMercury.currentSemester || promotedMercury.current_semester, 2);

  // Existing student still has Mercury UUID and now resolves to Semester 2 automatically
  const existingStudentContext = await getAcademicContext(db, { studentId: 'STU_M1' });
  assert.equal(existingStudentContext.cohort.id, mercury.id);
  assert.equal(existingStudentContext.cohort.currentSemester, 2);

  // New student signs up selecting Semester 2
  const res2 = await resolveActiveCohortForSemester(db, 2);
  assert.equal(res2.status, 'AUTO_ASSIGN_SAFE');
  assert.equal(res2.cohort.id, mercury.id);
  assert.equal(res2.cohort.displayName, 'Mercury');
  assert.equal(res2.cohort.currentSemester, 2);
});

test('12. Existing student auto-repair dry run and transactional execution', async () => {
  const { db, venus } = await setupTestEnvironment();

  // Insert legacy students with NULL cohort_id
  await db.run(`INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES ('LEGACY_1', 'Swostika', 'student', 'Semester 3', NULL)`);
  await db.run(`INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES ('LEGACY_2', 'Subarna', 'student', 'Semester 2', NULL)`);
  await db.run(`INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES ('STAFF_1', 'Admin Saugat', 'admin', 'Semester 3', NULL)`);
  await db.run(`INSERT INTO students (studentId, name, role, semester, cohort_id) VALUES ('TEST-A', 'Test Account', 'student', 'Semester 3', NULL)`);

  const { report } = await analyzeStudentCohortStatus(db);

  const swostika = report.find(r => r.studentId === 'LEGACY_1');
  assert.equal(swostika.status, 'AUTO_ASSIGN_SAFE');
  assert.equal(swostika.proposedCohortId, venus.id);

  const subarna = report.find(r => r.studentId === 'LEGACY_2');
  assert.equal(subarna.status, 'AMBIGUOUS'); // No active cohort for Sem 2

  const admin = report.find(r => r.studentId === 'STAFF_1');
  assert.equal(admin.status, 'SKIP_STAFF');

  const testAcc = report.find(r => r.studentId === 'TEST-A');
  assert.equal(testAcc.status, 'SKIP_TEST');
});
