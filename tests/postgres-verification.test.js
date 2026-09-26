const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const TEST_PG_URL = process.env.TEST_POSTGRES_URL || 'postgresql://postgres:postgres@127.0.0.1:5433/test_db';

async function isPostgresAvailable() {
  const pool = new Pool({ connectionString: TEST_PG_URL, connectionTimeoutMillis: 1000 });
  try {
    await pool.query('SELECT 1');
    await pool.end();
    return true;
  } catch {
    await pool.end().catch(() => {});
    return false;
  }
}

function getPool() {
  return new Pool({ connectionString: TEST_PG_URL });
}

test('PostgreSQL: Migration against fresh database creates all required tables, columns and indexes', async (t) => {
  if (!await isPostgresAvailable()) {
    t.skip('Disposable PostgreSQL container is not reachable on ' + TEST_PG_URL);
    return;
  }
  const pool = getPool();
  t.after(() => pool.end());

  // Clean slate in disposable test database
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

  // Create base tables matching pre-migration schema
  await pool.query(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT DEFAULT 'student',
      avatarUrl TEXT
    );

    CREATE TABLE assignments (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      language TEXT NOT NULL,
      createdBy TEXT NOT NULL REFERENCES students(studentId),
      createdAt TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE assignment_questions (
      id SERIAL PRIMARY KEY,
      assignmentId INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      questionNumber INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      language TEXT NOT NULL,
      createdAt TIMESTAMPTZ NOT NULL,
      UNIQUE(assignmentId, questionNumber)
    );

    CREATE TABLE submissions (
      id SERIAL PRIMARY KEY,
      assignmentId INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      studentId TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
      code TEXT NOT NULL,
      submittedAt TIMESTAMPTZ NOT NULL,
      CONSTRAINT submissions_assignmentid_studentid_key UNIQUE(assignmentId, studentId)
    );

    CREATE TABLE chat_messages (
      id SERIAL PRIMARY KEY,
      studentId TEXT NOT NULL REFERENCES students(studentId),
      text TEXT,
      createdAt TIMESTAMPTZ NOT NULL
    );
  `);

  // Read and run the prepared migration file
  const migrationSql = fs.readFileSync(path.join(__dirname, '../migrations/20260926_safe_submissions_migration.sql'), 'utf8');
  await pool.query(migrationSql);

  // 1. Verify new columns in submissions
  const subCols = await pool.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'submissions'
  `);
  const colNames = subCols.rows.map(r => r.column_name);
  assert.ok(colNames.includes('questionid'), 'submissions must have questionId column');
  assert.ok(colNames.includes('stdout'), 'submissions must have stdout column');
  assert.ok(colNames.includes('stderr'), 'submissions must have stderr column');
  assert.ok(colNames.includes('testresults'), 'submissions must have testResults column');
  assert.ok(colNames.includes('questiontitle'), 'submissions must have questionTitle column');

  // 2. Verify chat_pinned table exists
  const pinnedTable = await pool.query(`
    SELECT table_name FROM information_schema.tables WHERE table_name = 'chat_pinned'
  `);
  assert.equal(pinnedTable.rows.length, 1, 'chat_pinned table must exist');

  // 3. Verify login_attempts table and index exists
  const loginTable = await pool.query(`
    SELECT table_name FROM information_schema.tables WHERE table_name = 'login_attempts'
  `);
  assert.equal(loginTable.rows.length, 1, 'login_attempts table must exist');

  const indexes = await pool.query(`
    SELECT indexname FROM pg_indexes WHERE tablename IN ('submissions', 'login_attempts')
  `);
  const idxNames = indexes.rows.map(r => r.indexname);
  assert.ok(idxNames.includes('idx_submissions_question'), 'idx_submissions_question index must exist');
  assert.ok(idxNames.includes('idx_submissions_legacy'), 'idx_submissions_legacy index must exist');
  assert.ok(idxNames.includes('idx_login_attempts_locked'), 'idx_login_attempts_locked index must exist');
});

test('PostgreSQL: Migration against legacy database preserves fake existing submissions and data', async (t) => {
  if (!await isPostgresAvailable()) {
    t.skip('Disposable PostgreSQL container is not reachable on ' + TEST_PG_URL);
    return;
  }
  const pool = getPool();
  t.after(() => pool.end());

  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

  // Setup legacy schema with initial constraints
  await pool.query(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      passwordHash TEXT NOT NULL
    );

    CREATE TABLE assignments (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      language TEXT NOT NULL,
      createdAt TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE assignment_questions (
      id SERIAL PRIMARY KEY,
      assignmentId INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      questionNumber INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      language TEXT NOT NULL,
      createdAt TIMESTAMPTZ NOT NULL,
      UNIQUE(assignmentId, questionNumber)
    );

    CREATE TABLE submissions (
      id SERIAL PRIMARY KEY,
      assignmentId INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      studentId TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
      code TEXT NOT NULL,
      submittedAt TIMESTAMPTZ NOT NULL,
      CONSTRAINT submissions_assignmentid_studentid_key UNIQUE(assignmentId, studentId)
    );

    CREATE TABLE chat_messages (
      id SERIAL PRIMARY KEY,
      studentId TEXT NOT NULL REFERENCES students(studentId),
      text TEXT,
      createdAt TIMESTAMPTZ NOT NULL
    );
  `);

  // Seed students and assignments
  await pool.query(`
    INSERT INTO students (studentId, name, passwordHash) VALUES
      ('stu_legacy_1', 'Legacy Alice', 'hash1'),
      ('stu_legacy_2', 'Legacy Bob', 'hash2');

    INSERT INTO assignments (id, title, description, language, createdAt) VALUES
      (1, 'Legacy Lab 1', 'Lab Desc 1', 'c', NOW()),
      (2, 'Legacy Lab 2', 'Lab Desc 2', 'python', NOW());
  `);

  // Seed 3 existing legacy submissions
  await pool.query(`
    INSERT INTO submissions (id, assignmentId, studentId, code, submittedAt) VALUES
      (101, 1, 'stu_legacy_1', 'int main() { return 42; }', '2026-01-15T10:00:00Z'),
      (102, 1, 'stu_legacy_2', 'int main() { return 0; }',  '2026-01-15T11:00:00Z'),
      (103, 2, 'stu_legacy_1', 'print("hello world")',       '2026-01-16T12:00:00Z');
  `);

  // Execute migration
  const migrationSql = fs.readFileSync(path.join(__dirname, '../migrations/20260926_safe_submissions_migration.sql'), 'utf8');
  await pool.query(migrationSql);

  // Verify all 3 existing rows survived with exact data
  const survivedRows = await pool.query('SELECT id, assignmentId, studentId, code, questionId FROM submissions ORDER BY id ASC');
  assert.equal(survivedRows.rows.length, 3, 'All 3 existing submission rows must survive the migration');

  assert.equal(survivedRows.rows[0].id, 101);
  assert.equal(survivedRows.rows[0].studentid, 'stu_legacy_1');
  assert.equal(survivedRows.rows[0].code, 'int main() { return 42; }');
  assert.equal(survivedRows.rows[0].questionid, null, 'Legacy rows keep questionId as NULL');

  assert.equal(survivedRows.rows[1].id, 102);
  assert.equal(survivedRows.rows[1].studentid, 'stu_legacy_2');
  assert.equal(survivedRows.rows[1].code, 'int main() { return 0; }');

  assert.equal(survivedRows.rows[2].id, 103);
  assert.equal(survivedRows.rows[2].studentid, 'stu_legacy_1');
  assert.equal(survivedRows.rows[2].code, 'print("hello world")');

  // Verify old restrictive constraint was dropped:
  // A student should now be able to submit for Question 1 AND Question 2 in Assignment 1
  await pool.query(`
    INSERT INTO assignment_questions (id, assignmentId, questionNumber, title, description, language, createdAt) VALUES
      (1, 1, 1, 'Q1', 'Desc', 'c', NOW()),
      (2, 1, 2, 'Q2', 'Desc', 'c', NOW())
    ON CONFLICT (id) DO NOTHING;
  `);

  await pool.query(`
    INSERT INTO submissions (assignmentId, questionId, studentId, code, submittedAt) VALUES
      (1, 1, 'stu_legacy_1', 'code_q1', NOW()),
      (1, 2, 'stu_legacy_1', 'code_q2', NOW());
  `);

  const student1Submissions = await pool.query('SELECT id, questionId FROM submissions WHERE assignmentId = 1 AND studentId = $1', ['stu_legacy_1']);
  assert.equal(student1Submissions.rows.length, 3, 'Student now has legacy submission + 2 question submissions in same assignment');
});

test('PostgreSQL: Concurrent submissions test atomic UPSERT without race conditions', async (t) => {
  if (!await isPostgresAvailable()) {
    t.skip('Disposable PostgreSQL container is not reachable on ' + TEST_PG_URL);
    return;
  }
  const pool = getPool();
  t.after(() => pool.end());

  const assignmentId = 1;
  const questionId = 1;
  const studentId = 'stu_pg_concurrent';

  await pool.query("INSERT INTO students (studentId, name, passwordHash) VALUES ($1, 'Concurrent PG', 'hash') ON CONFLICT DO NOTHING", [studentId]);
  await pool.query("INSERT INTO assignments (id, title, description, language, createdAt) VALUES (1, 'Lab 1', 'Desc', 'c', NOW()) ON CONFLICT (id) DO NOTHING");
  await pool.query("INSERT INTO assignment_questions (id, assignmentId, questionNumber, title, description, language, createdAt) VALUES (1, 1, 1, 'Q1', 'Desc', 'c', NOW()) ON CONFLICT (id) DO NOTHING");

  // Function running the exact atomic PostgreSQL upsert used in routes/code-lab/assignments.js
  const submitCode = async (version) => {
    const code = `pg_version_${version}`;
    const now = new Date().toISOString();
    return pool.query(`
      INSERT INTO submissions (assignmentId, questionId, studentId, code, stdout, stderr, testResults, questionTitle, submittedAt)
      VALUES ($1, $2, $3, $4, '', '', '', 'Q1', $5)
      ON CONFLICT (assignmentId, studentId, questionId) WHERE questionId IS NOT NULL
      DO UPDATE SET
        code = EXCLUDED.code,
        submittedAt = EXCLUDED.submittedAt
    `, [assignmentId, questionId, studentId, code, now]);
  };

  // Launch 10 simultaneous submissions concurrently
  const promises = [];
  for (let i = 1; i <= 10; i++) {
    promises.push(submitCode(i));
  }

  // All 10 must succeed without serialization conflict or duplicate key failure
  const results = await Promise.all(promises);
  assert.equal(results.length, 10);

  // Exactly ONE row must exist for this student and question
  const rows = await pool.query(
    'SELECT * FROM submissions WHERE assignmentId = $1 AND questionId = $2 AND studentId = $3',
    [assignmentId, questionId, studentId]
  );
  assert.equal(rows.rows.length, 1, 'Only one submission row must exist after 10 concurrent PostgreSQL requests');
  assert.match(rows.rows[0].code, /^pg_version_\d+$/);

  // Test legacy concurrent submission (questionId IS NULL)
  const submitLegacy = async (version) => {
    const code = `pg_legacy_v${version}`;
    const now = new Date().toISOString();
    return pool.query(`
      INSERT INTO submissions (assignmentId, questionId, studentId, code, stdout, stderr, testResults, submittedAt)
      VALUES ($1, NULL, $2, $3, '', '', '', $4)
      ON CONFLICT (assignmentId, studentId) WHERE questionId IS NULL
      DO UPDATE SET
        code = EXCLUDED.code,
        submittedAt = EXCLUDED.submittedAt
    `, [assignmentId, studentId, code, now]);
  };

  const legacyPromises = [];
  for (let i = 1; i <= 5; i++) {
    legacyPromises.push(submitLegacy(i));
  }
  await Promise.all(legacyPromises);

  const legacyRows = await pool.query(
    'SELECT * FROM submissions WHERE assignmentId = $1 AND questionId IS NULL AND studentId = $2',
    [assignmentId, studentId]
  );
  assert.equal(legacyRows.rows.length, 1, 'Only one legacy submission row must exist when questionId is NULL on PostgreSQL');
});

test('PostgreSQL: Shared database login rate limiter locks out IP after 5 failures and clears on success', async (t) => {
  if (!await isPostgresAvailable()) {
    t.skip('Disposable PostgreSQL container is not reachable on ' + TEST_PG_URL);
    return;
  }
  const pool = getPool();
  t.after(() => pool.end());

  const testIp = '203.0.113.88';

  async function checkLimit(ip) {
    const res = await pool.query('SELECT attemptCount, lockedUntil FROM login_attempts WHERE ip = $1', [ip]);
    const row = res.rows[0];
    if (row && row.lockeduntil) {
      const lockedUntilTime = new Date(row.lockeduntil).getTime();
      const now = Date.now();
      if (lockedUntilTime > now) {
        return Math.ceil((lockedUntilTime - now) / 1000);
      }
    }
    return 0;
  }

  async function recordFail(ip) {
    const now = new Date();
    const res = await pool.query('SELECT attemptCount, lastAttemptAt FROM login_attempts WHERE ip = $1', [ip]);
    const row = res.rows[0];
    let count = 1;
    if (row && row.lastattemptat) {
      const lastTime = new Date(row.lastattemptat).getTime();
      if (now.getTime() - lastTime < 15 * 60 * 1000) {
        count = (Number(row.attemptcount) || 0) + 1;
      }
    }
    let lockedUntil = null;
    if (count >= 5) {
      lockedUntil = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
    }
    const nowIso = now.toISOString();

    await pool.query(`
      INSERT INTO login_attempts (ip, attemptCount, lockedUntil, lastAttemptAt)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (ip) DO UPDATE SET
        attemptCount = EXCLUDED.attemptCount,
        lockedUntil = EXCLUDED.lockedUntil,
        lastAttemptAt = EXCLUDED.lastAttemptAt
    `, [ip, count, lockedUntil, nowIso]);
  }

  async function clearAttempts(ip) {
    await pool.query('DELETE FROM login_attempts WHERE ip = $1', [ip]);
  }

  // 1. Initial state: 0
  assert.equal(await checkLimit(testIp), 0);

  // 2. 4 failed attempts: not yet locked
  for (let i = 0; i < 4; i++) {
    await recordFail(testIp);
  }
  assert.equal(await checkLimit(testIp), 0);

  // 3. 5th failed attempt: triggers 5-minute lockout
  await recordFail(testIp);
  const remaining = await checkLimit(testIp);
  assert.ok(remaining > 0, 'IP must be locked out on PostgreSQL after 5 failed attempts');
  assert.ok(remaining <= 300, 'Lockout must be at most 300 seconds');

  // 4. Successful login: clears attempts across all serverless instances
  await clearAttempts(testIp);
  assert.equal(await checkLimit(testIp), 0, 'Lockout must be immediately cleared after successful login');
});

test('PostgreSQL: Authentication verification against students table with bcrypt', async (t) => {
  if (!await isPostgresAvailable()) {
    t.skip('Disposable PostgreSQL container is not reachable on ' + TEST_PG_URL);
    return;
  }
  const pool = getPool();
  t.after(() => pool.end());

  const testStudentId = 'stu_auth_test';
  const plainPassword = 'CorrectPassword123!';
  const passwordHash = bcrypt.hashSync(plainPassword, 10);

  await pool.query("ALTER TABLE students ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'student'");

  await pool.query(`
    INSERT INTO students (studentId, name, passwordHash, role)
    VALUES ($1, 'Auth Tester', $2, 'student')
    ON CONFLICT (studentId) DO UPDATE SET passwordHash = EXCLUDED.passwordHash
  `, [testStudentId, passwordHash]);

  // Lookup student
  const res = await pool.query('SELECT * FROM students WHERE studentId = $1', [testStudentId]);
  const student = res.rows[0];
  assert.ok(student);
  assert.equal(student.studentid, testStudentId);

  // Valid password check
  assert.equal(bcrypt.compareSync(plainPassword, student.passwordhash), true);

  // Invalid password check
  assert.equal(bcrypt.compareSync('WrongPassword', student.passwordhash), false);
});
