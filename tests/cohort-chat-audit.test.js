const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, rmSync, readFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { auditLocalChat } = require('../scripts/audit-cohort-chat');

function fixture(t, extra = '') {
  const dir = mkdtempSync(join(tmpdir(), 'cohort-audit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'fixture.db');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE students (studentId TEXT, department TEXT, semester TEXT);
    CREATE TABLE chat_messages (id INTEGER, studentId TEXT, text TEXT);
    INSERT INTO students VALUES ('private-student-id', 'BIT', 'Semester 1');
    INSERT INTO chat_messages VALUES (1, 'private-student-id', 'private-message-body');
    ${extra}`);
  db.close();
  return file;
}

test('legacy history is blocked, never assigned by current semester, and source bytes stay unchanged', t => {
  const file = fixture(t);
  const before = readFileSync(file);
  const report = auditLocalChat(file);
  assert.equal(report.readyForProductionMigration, false);
  assert.equal(report.historicalOwnership, 'NOT_PROVEN');
  assert.ok(report.blockers.includes('NO_PERSISTED_MESSAGE_ROOM_ID'));
  assert.equal(report.assignmentSummary[0].candidateCode, 'MERCURY');
  assert.equal(report.assignmentSummary[0].requiresRosterReview, true);
  assert.deepEqual(readFileSync(file), before);
  assert.doesNotMatch(JSON.stringify(report), /private-student-id|private-message-body/);
});

test('semester candidates follow only the supplied initial BIT mapping; even semesters and CSIT stay unresolved', t => {
  const file = fixture(t, `INSERT INTO students VALUES
    ('b','BIT','Semester 3'), ('c','BIT','Semester 5'), ('d','BIT','Semester 7'),
    ('e','BIT','Semester 2'), ('f','B.Sc. CSIT','Semester 1'), ('g',NULL,'Semester 1'),
    ('h','BIT','Semester 3garbage');`);
  const report = auditLocalChat(file);
  assert.deepEqual(report.assignmentSummary.filter(row => row.candidateCode).map(row => row.candidateCode).sort(), ['EARTH', 'MARS', 'MERCURY', 'VENUS']);
  assert.equal(report.assignmentSummary.filter(row => !row.candidateCode).length, 4);
  assert.ok(report.blockers.includes('STUDENTS_OUTSIDE_INITIAL_BIT_MAPPING'));
});

test('new room columns alone do not manufacture historical proof or migration approval', t => {
  const file = fixture(t, 'ALTER TABLE students ADD COLUMN cohort_id INTEGER; ALTER TABLE chat_messages ADD COLUMN chat_group_id INTEGER;');
  const report = auditLocalChat(file);
  assert.equal(report.persistedMessageRoomIdentity, true);
  assert.equal(report.historicalOwnership, 'NOT_PROVEN');
  assert.equal(report.readyForProductionMigration, false);
  assert.ok(report.blockers.includes('HISTORICAL_OWNERSHIP_REQUIRES_VERIFIED_PROVENANCE'));
});

test('unsupported schema and unusual SQL identifiers are handled without writes', t => {
  const file = fixture(t, 'DROP TABLE students; CREATE TABLE "chat_odd""name" (id INTEGER);');
  const report = auditLocalChat(file);
  assert.ok(report.blockers.includes('REQUIRED_TABLES_MISSING'));
  assert.equal(report.tables['chat_odd"name'].count, 0);
});

test('audit rejects remote URLs and never creates a missing database', t => {
  for (const url of ['postgres://host/db', 'file:/tmp/db', 'libsql://host', ':memory:', '']) {
    assert.throws(() => auditLocalChat(url), /local SQLite/);
  }
  const file = fixture(t);
  const missing = join(file + '-missing');
  assert.throws(() => auditLocalChat(missing));
  assert.equal(existsSync(missing), false);
});

test('CLI reports an explicit stop status without importing application database config', t => {
  const file = fixture(t);
  const result = spawnSync(process.execPath, ['scripts/audit-cohort-chat.js', file], {
    cwd: join(__dirname, '..'), encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: 'postgres://invalid.invalid/never-connect', NODE_ENV: 'production' },
  });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout).readyForProductionMigration, false);
});
