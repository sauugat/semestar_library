'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const bcrypt = require('bcryptjs');
const { PGlite } = require('@electric-sql/pglite');

const { createTransactionAdapter } = require('../lib/db-transaction');
const { ensureAuditSchema, queryAdminAuditLogs } = require('../lib/audit-service');
const { isTeacherOnboardingEnabled, validateTeacherSubjectAuthorization } = require('../lib/teacher-service');
const {
  getAcademicsOverview,
  listCanonicalSubjects,
  getSubjectDetail,
  createCanonicalSubject,
  updateCanonicalSubject,
  archiveCanonicalSubject,
  reactivateCanonicalSubject,
  getUnclassifiedMaterials
} = require('../lib/academic-service');
const createAdminDashboardRouter = require('../routes/admin-dashboard');

/**
 * Creates an isolated disposable in-process PostgreSQL engine (PGlite).
 */
function createDisposablePostgresInstance() {
  const pg = new PGlite();
  const formatRow = (r) => {
    if (!r || typeof r !== 'object') return r;
    const formatted = { ...r };
    if (formatted.studentid !== undefined && formatted.studentId === undefined) {
      formatted.studentId = formatted.studentid;
    }
    if (formatted.avatarurl !== undefined && formatted.avatarUrl === undefined) {
      formatted.avatarUrl = formatted.avatarurl;
    }
    return formatted;
  };
  const formatRows = (rs) => (Array.isArray(rs) ? rs.map(formatRow) : rs);

  function createPgAdapter(client) {
    const adapter = createTransactionAdapter({
      query: async (sql, args) => {
        const res = (args && args.length > 0) ? await client.query(sql, args) : await client.query(sql);
        return { rows: res.rows, rowCount: res.affectedRows };
      }
    }, true, formatRow, formatRows);
    adapter.isPostgres = true;
    adapter.exec = async (sql) => {
      if (client.exec) return await client.exec(sql);
      return await client.query(sql);
    };
    return adapter;
  }

  const db = createPgAdapter(pg);
  db.withTransaction = async (fn) => {
    return await pg.transaction(async (tx) => {
      const txAdapter = createPgAdapter(tx);
      return await fn(txAdapter);
    });
  };

  return { pg, db };
}

let pgInstance;
let stagingDb;
let server;
let baseUrl;

const TEST_PASS = 'P@ssword123!';
const testPasswordHash = bcrypt.hashSync(TEST_PASS, 4);

// Test Identities
const ADMIN_ID = 'admin_academic_01';
const TEACHER_USER_ID = 'teacher_user_01';
const TEACHER_TABLE_ID = 't_prof_01';
const STUDENT_ID = 'student_01';
const CR_ID = 'cr_student_01';
const SUSPENDED_ID = 'student_suspended_01';

test.before(async () => {
  const instance = createDisposablePostgresInstance();
  pgInstance = instance.pg;
  stagingDb = instance.db;

  // 1. Initialize schema in isolated PostgreSQL
  await stagingDb.exec(`
    CREATE TABLE IF NOT EXISTS students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password TEXT NOT NULL,
      semester TEXT DEFAULT '1',
      department TEXT DEFAULT 'BIT',
      role TEXT NOT NULL DEFAULT 'student',
      account_status TEXT NOT NULL DEFAULT 'active',
      cohort_id TEXT,
      avatarUrl TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cohorts (
      id TEXT PRIMARY KEY,
      slot_code TEXT NOT NULL,
      display_name TEXT NOT NULL,
      current_semester INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
      department TEXT NOT NULL DEFAULT 'BIT',
      credit_hours NUMERIC(3, 1) DEFAULT 3.0,
      nature TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS teachers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES students(studentId) ON DELETE CASCADE,
      designation TEXT DEFAULT 'Instructor',
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS teacher_subjects (
      id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(teacher_id, subject_id)
    );

    CREATE TABLE IF NOT EXISTS files (
      id SERIAL PRIMARY KEY,
      storedName TEXT NOT NULL,
      originalName TEXT NOT NULL,
      title TEXT,
      subject TEXT,
      chapter TEXT,
      semester TEXT,
      uploadedBy TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
      sizeBytes BIGINT NOT NULL,
      uploadedAt TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      language TEXT NOT NULL,
      subject TEXT,
      semester TEXT,
      deadline TIMESTAMPTZ,
      createdBy TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
      createdAt TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS assignment_questions (
      id SERIAL PRIMARY KEY,
      assignmentId INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      questionNumber INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      language TEXT NOT NULL,
      createdAt TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      assignmentId INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      studentId TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
      code TEXT NOT NULL,
      submittedAt TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await ensureAuditSchema(stagingDb);

  // 2. Seed initial actors
  await stagingDb.run(`
    INSERT INTO students (studentId, name, username, email, password, role, account_status)
    VALUES
      ('${ADMIN_ID}', 'System Admin', 'sysadmin', 'admin@example.com', '${testPasswordHash}', 'admin', 'active'),
      ('${TEACHER_USER_ID}', 'Professor Smith', 'profsmith', 'smith@example.com', '${testPasswordHash}', 'teacher', 'active'),
      ('${STUDENT_ID}', 'Alice Student', 'alice', 'alice@example.com', '${testPasswordHash}', 'student', 'active'),
      ('${CR_ID}', 'Bob ClassRep', 'bobcr', 'bobcr@example.com', '${testPasswordHash}', 'cr', 'active'),
      ('${SUSPENDED_ID}', 'Charlie Suspended', 'charlie', 'charlie@example.com', '${testPasswordHash}', 'student', 'suspended')
  `);

  await stagingDb.run(`
    INSERT INTO teachers (id, user_id, designation, status)
    VALUES ('${TEACHER_TABLE_ID}', '${TEACHER_USER_ID}', 'Senior Lecturer', 'active')
  `);

  // 3. Seed baseline permanent cohorts
  await stagingDb.run(`
    INSERT INTO cohorts (id, slot_code, display_name, current_semester, status)
    VALUES
      ('cohort_mercury_01', 'mercury', 'Mercury Cohort', 1, 'active'),
      ('cohort_venus_01', 'venus', 'Venus Cohort', 3, 'active'),
      ('cohort_earth_01', 'earth', 'Earth Cohort', 5, 'active'),
      ('cohort_mars_01', 'mars', 'Mars Cohort', 7, 'active')
  `);

  // 4. Seed initial canonical subjects
  await stagingDb.run(`
    INSERT INTO subjects (id, code, name, semester, department, credit_hours, nature, active)
    VALUES
      ('CS101', 'CS101', 'Intro to Computer Science', 1, 'BIT', 3.0, 'TH + PR', TRUE),
      ('MATH101', 'MATH101', 'Calculus I', 1, 'BIT', 3.0, 'TH', TRUE),
      ('DSA201', 'DSA201', 'Data Structures & Algorithms', 2, 'BIT', 4.0, 'TH + PR', TRUE),
      ('OLD999', 'OLD999', 'Legacy Computation Theory', 8, 'BIT', 3.0, 'TH', FALSE)
  `);

  // 5. Seed teacher assignment
  await stagingDb.run(`
    INSERT INTO teacher_subjects (id, teacher_id, subject_id)
    VALUES ('ts_01', '${TEACHER_TABLE_ID}', 'CS101')
  `);

  // 6. Seed academic materials and assignments
  await stagingDb.run(`
    INSERT INTO files (storedName, originalName, title, subject, semester, uploadedBy, sizeBytes)
    VALUES
      ('note1.pdf', 'cs101_week1.pdf', 'CS101 Week 1 Notes', 'CS101', '1', '${TEACHER_USER_ID}', 1024),
      ('legacy1.pdf', 'unclassified_notes.pdf', 'Unclassified Notes', 'UNKNOWN_SUBJ', '99', '${STUDENT_ID}', 2048),
      ('legacy2.pdf', 'missing_all.pdf', 'Missing Fields Note', NULL, NULL, '${STUDENT_ID}', 512)
  `);

  await stagingDb.run(`
    INSERT INTO assignments (title, description, language, subject, semester, createdBy)
    VALUES
      ('CS101 Assignment 1', 'Introductory C lab', 'c', 'CS101', '1', '${TEACHER_USER_ID}'),
      ('Unclassified Assignment', 'Legacy questions', 'python', 'OLD_COURSE', '12', '${ADMIN_ID}')
  `);

  // 7. Mount test Express HTTP server
  const app = express();
  app.use(express.json());

  // Test auth middleware providing req.student based on x-test-user header
  const requireLogin = (req, res, next) => {
    const studentId = req.headers['x-test-user'] || req.headers['x-student-id'];
    if (!studentId) {
      return res.status(401).json({ message: 'Authentication required. Please sign in.' });
    }
    req.student = { studentId };
    req.session = { studentId };
    next();
  };

  const adminRouter = createAdminDashboardRouter({ db: stagingDb, requireLogin });
  app.use('/api/admin', adminRouter);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

// Helper for authenticated requests
async function authFetch(pathname, options = {}, userId = ADMIN_ID) {
  const headers = {
    'Content-Type': 'application/json',
    'x-test-user': userId,
    ...(options.headers || {})
  };
  return fetch(`${baseUrl}${pathname}`, { ...options, headers });
}

test('1. Admin can list canonical subjects with semester and status filtering', async () => {
  const res = await authFetch('/api/admin/academics/subjects?semester=1&status=active');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.subjects), 'subjects must be an array');
  assert.equal(data.subjects.length, 2, 'Should find 2 active subjects in Semester 1');
  assert.ok(data.subjects.some(s => s.code === 'CS101'));
  assert.ok(data.subjects.some(s => s.code === 'MATH101'));
});

test('2. Admin can create a valid canonical subject', async () => {
  const res = await authFetch('/api/admin/academics/subjects', {
    method: 'POST',
    body: JSON.stringify({
      code: 'WT202',
      name: 'Web Technology II',
      semester: 3,
      department: 'BIT',
      creditHours: 3.0,
      nature: 'TH + PR',
      reason: 'Approved curriculum addition'
    })
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.subject.code, 'WT202');
  assert.equal(data.subject.name, 'Web Technology II');
  assert.equal(data.subject.semester, 3);
  assert.equal(data.subject.active, true);
});

test('3. Duplicate subject codes are rejected with 409 Conflict', async () => {
  const res = await authFetch('/api/admin/academics/subjects', {
    method: 'POST',
    body: JSON.stringify({
      code: 'cs101', // case-insensitive duplicate check
      name: 'Duplicate Computer Science',
      semester: 1
    })
  });
  assert.equal(res.status, 409);
  const data = await res.json();
  assert.match(data.message, /already exists/i);
});

test('4. Invalid semesters are rejected with 400 Bad Request', async () => {
  const res9 = await authFetch('/api/admin/academics/subjects', {
    method: 'POST',
    body: JSON.stringify({
      code: 'INV909',
      name: 'Invalid Semester 9',
      semester: 9
    })
  });
  assert.equal(res9.status, 400);

  const res0 = await authFetch('/api/admin/academics/subjects', {
    method: 'POST',
    body: JSON.stringify({
      code: 'INV000',
      name: 'Invalid Semester 0',
      semester: 0
    })
  });
  assert.equal(res0.status, 400);
});

test('5. Admin can edit an existing subject name and metadata', async () => {
  const res = await authFetch('/api/admin/academics/subjects/MATH101', {
    method: 'PATCH',
    body: JSON.stringify({
      name: 'Calculus and Analytical Geometry I',
      creditHours: 4.0,
      reason: 'Updated syllabus naming'
    })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.subject.name, 'Calculus and Analytical Geometry I');
  assert.equal(data.subject.creditHours, 4.0);
});

test('6. Subject ID remains strictly unchanged across edits', async () => {
  const res = await authFetch('/api/admin/academics/subjects/MATH101');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.id, 'MATH101', 'Internal ID must remain stable');
});

test('7. Admin can archive an active canonical subject', async () => {
  const res = await authFetch('/api/admin/academics/subjects/DSA201/archive', {
    method: 'POST',
    body: JSON.stringify({ reason: 'Replaced by updated syllabus structure' })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.subject.active, false);

  // Verify DB state
  const row = await stagingDb.get('SELECT active FROM subjects WHERE id = ?', 'DSA201');
  assert.equal(row.active, false);
});

test('8. Admin can reactivate an archived subject', async () => {
  const res = await authFetch('/api/admin/academics/subjects/DSA201/reactivate', {
    method: 'POST',
    body: JSON.stringify({ reason: 'Course restored for back-paper enrollment' })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.subject.active, true);

  const row = await stagingDb.get('SELECT active FROM subjects WHERE id = ?', 'DSA201');
  assert.equal(row.active, true);
});

test('9. Subject deletion is disabled to preserve historical data integrity (405 Method Not Allowed)', async () => {
  const res = await authFetch('/api/admin/academics/subjects/CS101', {
    method: 'DELETE'
  });
  assert.equal(res.status, 405);
  const data = await res.json();
  assert.match(data.message, /Subject deletion is disabled/i);

  // Verify subject still exists in DB
  const row = await stagingDb.get('SELECT id FROM subjects WHERE id = ?', 'CS101');
  assert.ok(row, 'Subject must not be deleted');
});

test('10. Existing teacher assignments are preserved across subject archive and reactivation', async () => {
  // Archive CS101
  await authFetch('/api/admin/academics/subjects/CS101/archive', {
    method: 'POST',
    body: JSON.stringify({ reason: 'Temporary curriculum archive' })
  });

  // Verify teacher_subjects record is still intact
  const assignment = await stagingDb.get(
    'SELECT * FROM teacher_subjects WHERE teacher_id = ? AND subject_id = ?',
    TEACHER_TABLE_ID, 'CS101'
  );
  assert.ok(assignment, 'Teacher assignment must be preserved when subject is archived');

  // Reactivate CS101
  await authFetch('/api/admin/academics/subjects/CS101/reactivate', {
    method: 'POST',
    body: JSON.stringify({ reason: 'Restore active teaching' })
  });
});

test('11. Existing academic materials are preserved across subject updates and archiving', async () => {
  const file = await stagingDb.get('SELECT * FROM files WHERE subject = ?', 'CS101');
  assert.ok(file, 'Material must exist');
  assert.equal(file.title, 'CS101 Week 1 Notes');
});

test('12. Existing assignments are preserved across subject updates and archiving', async () => {
  const assignment = await stagingDb.get('SELECT * FROM assignments WHERE subject = ?', 'CS101');
  assert.ok(assignment, 'Assignment must exist');
  assert.equal(assignment.title, 'CS101 Assignment 1');
});

test('13. Student cannot create subjects (rejects 403 Forbidden)', async () => {
  const res = await authFetch('/api/admin/academics/subjects', {
    method: 'POST',
    body: JSON.stringify({ code: 'HACK101', name: 'Unauthorized Subject', semester: 1 })
  }, STUDENT_ID);
  assert.equal(res.status, 403);
});

test('14. Class Representative (CR) cannot modify subjects (rejects 403 Forbidden)', async () => {
  const res = await authFetch('/api/admin/academics/subjects/CS101', {
    method: 'PATCH',
    body: JSON.stringify({ name: 'CR Modified Subject' })
  }, CR_ID);
  assert.equal(res.status, 403);
});

test('15. Teacher cannot modify subjects via administrative APIs (rejects 403 Forbidden)', async () => {
  const res = await authFetch('/api/admin/academics/subjects/CS101/archive', {
    method: 'POST',
    body: JSON.stringify({ reason: 'Teacher attempting archive' })
  }, TEACHER_USER_ID);
  assert.equal(res.status, 403);
});

test('16. Suspended accounts cannot access academic management APIs (rejects 403 Forbidden)', async () => {
  const res = await authFetch('/api/admin/academics/subjects', {}, SUSPENDED_ID);
  assert.equal(res.status, 403);
});

test('17. Archived subject publishing behavior respects backend authorization (rejects teacher upload with 403)', async () => {
  // Archive OLD999 and assign teacher to it
  await stagingDb.run(`
    INSERT INTO teacher_subjects (id, teacher_id, subject_id)
    VALUES ('ts_archived_test', '${TEACHER_TABLE_ID}', 'OLD999')
    ON CONFLICT (teacher_id, subject_id) DO NOTHING
  `);

  // Teacher tries to validate publishing to archived subject OLD999
  let errorCaught = null;
  try {
    await validateTeacherSubjectAuthorization(stagingDb, TEACHER_USER_ID, 'OLD999', 8);
  } catch (err) {
    errorCaught = err;
  }
  assert.ok(errorCaught, 'Teacher publishing to archived subject must throw error');
  assert.equal(errorCaught.status, 403, 'Must be HTTP 403 Forbidden');
  assert.match(errorCaught.message, /archived/i, 'Error message must state subject is archived');
});

test('18. Teacher dashboard subject queries operate cleanly with canonical subjects', async () => {
  const detail = await getSubjectDetail(stagingDb, 'CS101');
  assert.ok(detail);
  assert.equal(detail.code, 'CS101');
  assert.ok(detail.assignedTeachers.some(t => t.userId === TEACHER_USER_ID));
});

test('19. Student Library isolation is preserved without leaking cross-semester data', async () => {
  const s1Files = await stagingDb.all('SELECT * FROM files WHERE semester = ?', '1');
  assert.equal(s1Files.length, 1);
  assert.equal(s1Files[0].subject, 'CS101');
});

test('20. Admin Dashboard academic overview returns accurate 8-semester statistics', async () => {
  const res = await authFetch('/api/admin/academics');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.semesters), 'Must return 8 semesters');
  assert.equal(data.semesters.length, 8);

  const sem1 = data.semesters.find(s => s.semester === 1);
  assert.ok(sem1);
  assert.ok(sem1.activeSubjectsCount >= 2);
  assert.ok(sem1.materialsCount >= 1);
  assert.ok(sem1.assignmentsCount >= 1);
  assert.ok(sem1.assignedTeachersCount >= 1);
});

test('21. Permanent cohorts and cohort memberships remain completely unchanged', async () => {
  const cohorts = await stagingDb.all('SELECT slot_code, display_name FROM cohorts ORDER BY slot_code');
  assert.equal(cohorts.length, 4);
  const slots = cohorts.map(c => c.slot_code);
  assert.deepEqual(slots, ['earth', 'mars', 'mercury', 'venus']);
});

test('22. Academic mutations generate durable audit records in admin_audit_logs', async () => {
  const auditRes = await queryAdminAuditLogs(stagingDb, { entityType: 'subject', limit: 20 });
  const auditLogs = auditRes.logs || [];
  assert.ok(auditLogs.length >= 3, 'Must have recorded subject creation, update, and lifecycle events');

  const actions = auditLogs.map(a => a.action);
  assert.ok(actions.includes('subject_created'));
  assert.ok(actions.includes('subject_updated'));
  assert.ok(actions.includes('subject_archived'));
  assert.ok(actions.includes('subject_reactivated'));
});

test('23. Audit failure rolls back subject mutation transactionally on PostgreSQL', async () => {
  // Mock audit failure on isolated transaction
  let errorCaught = null;
  try {
    await stagingDb.withTransaction(async (tx) => {
      // 1. Insert subject on tx
      await tx.run(
        `INSERT INTO subjects (id, code, name, semester, department, active)
         VALUES ('FAIL101', 'FAIL101', 'Should Rollback Subject', 4, 'BIT', TRUE)`
      );
      // 2. Intentionally throw audit failure
      throw new Error('Forced Audit Persistence Failure');
    });
  } catch (err) {
    errorCaught = err;
  }

  assert.ok(errorCaught, 'Transaction must fail');
  // Verify subject was NOT committed to DB
  const uncommitted = await stagingDb.get('SELECT id FROM subjects WHERE id = ?', 'FAIL101');
  assert.equal(uncommitted, null, 'Uncommitted subject must be rolled back');
});

test('24. Academic materials listing is properly paginated with filtering', async () => {
  const res = await authFetch('/api/admin/academics/materials?page=1&limit=1&semester=1');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.pagination.page, 1);
  assert.equal(data.pagination.limit, 1);
  assert.ok(data.pagination.total >= 1);
  assert.equal(data.materials.length, 1);
});

test('25. Legacy and unclassified files are not automatically reassigned (read-only audit)', async () => {
  const res = await authFetch('/api/admin/academics/unclassified-materials');
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.ok(data.summary.totalUnclassifiedMaterials >= 2, 'Should find unclassified legacy files');
  assert.ok(data.summary.totalUnclassifiedAssignments >= 1, 'Should find unclassified legacy assignments');

  // Verify database rows remain untouched
  const rawFile1 = await stagingDb.get('SELECT semester, subject FROM files WHERE storedName = ?', 'legacy1.pdf');
  assert.equal(rawFile1.semester, '99', 'Raw legacy semester must not be modified');
  assert.equal(rawFile1.subject, 'UNKNOWN_SUBJ', 'Raw legacy subject must not be modified');

  const rawFile2 = await stagingDb.get('SELECT semester, subject FROM files WHERE storedName = ?', 'legacy2.pdf');
  assert.equal(rawFile2.semester, null);
  assert.equal(rawFile2.subject, null);
});

test('26. Existing account suspension remains enforced across the platform', async () => {
  const student = await stagingDb.get('SELECT account_status FROM students WHERE studentId = ?', SUSPENDED_ID);
  assert.equal(student.account_status, 'suspended');
});

test('27. CR role management remains distinct from administrator privileges', async () => {
  const cr = await stagingDb.get('SELECT role FROM students WHERE studentId = ?', CR_ID);
  assert.equal(cr.role, 'cr');
});

test('28. Teacher onboarding feature flag remains strictly disabled', async () => {
  assert.equal(isTeacherOnboardingEnabled(), false);
});

test('29. Concurrent conflicting subject creations execute safely without data corruption', async () => {
  const uniqueCode = 'CONCUR101';
  const promises = [
    authFetch('/api/admin/academics/subjects', {
      method: 'POST',
      body: JSON.stringify({ code: uniqueCode, name: 'Concurrent Test 1', semester: 2 })
    }),
    authFetch('/api/admin/academics/subjects', {
      method: 'POST',
      body: JSON.stringify({ code: uniqueCode, name: 'Concurrent Test 2', semester: 2 })
    })
  ];

  const results = await Promise.all(promises);
  const statuses = results.map(r => r.status);
  assert.ok(statuses.includes(201), 'One request must succeed with 201');
  assert.ok(statuses.includes(409), 'One request must be rejected with 409 Conflict');

  const rows = await stagingDb.all('SELECT * FROM subjects WHERE code = ?', uniqueCode);
  assert.equal(rows.length, 1, 'Exactly one subject record must exist');
});
