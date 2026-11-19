'use strict';

/**
 * Phase 2.6.3 — Pilot Blocker Remediation Test Suite
 * 
 * Verifies:
 * 1. Production retention scheduling, cron authentication, 90-day pruning, and idempotency.
 * 2. Canonical Gandaki University BIT curriculum mapping for CIT214, ELX121, CIT213, CIT221.
 * 3. Production-facing query resolution and pedagogical presentation planning.
 * 4. Dual-database parity (SQLite and PostgreSQL).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const db = require('../db');
const {
  ensureTelemetrySchema,
  recordTelemetryEvent,
  recordFeedback,
  pruneTelemetryRecords
} = require('../lib/kyana-pilot-telemetry');
const {
  createKyanaPilotTelemetryRouter,
  verifyCronAuth
} = require('../routes/kyana-pilot-telemetry');
const cr = require('../lib/curriculum-reasoning');
const { planAdaptivePresentation } = require('../lib/adaptive-presentation-engine');

const TEST_CRON_SECRET = 'test_cron_secret_gu_bit_2026';

test.before(async () => {
  await ensureTelemetrySchema({ db });
});

// ============================================================================
// PART A — PRODUCTION RETENTION SCHEDULING TESTS (LB-1)
// ============================================================================

test('Part A.1: Cron Auth — Missing Authorization Header Rejected with HTTP 401', async () => {
  const originalSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = TEST_CRON_SECRET;

  const app = express();
  app.use(express.json());
  app.use('/api/kyana/telemetry', createKyanaPilotTelemetryRouter(db));

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/kyana/telemetry/internal/prune`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    assert.equal(res.status, 401, 'Request with missing cron secret must return HTTP 401');
    const json = await res.json();
    assert.equal(json.ok, false);
    assert.match(json.error, /Unauthorized/i);
  } finally {
    server.close();
    process.env.CRON_SECRET = originalSecret;
  }
});

test('Part A.2: Cron Auth — Invalid Secret Rejected with HTTP 401', async () => {
  const originalSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = TEST_CRON_SECRET;

  const app = express();
  app.use(express.json());
  app.use('/api/kyana/telemetry', createKyanaPilotTelemetryRouter(db));

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/kyana/telemetry/internal/prune`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer wrong_invalid_secret'
      }
    });

    assert.equal(res.status, 401, 'Request with invalid bearer token must return HTTP 401');
    const json = await res.json();
    assert.equal(json.ok, false);
  } finally {
    server.close();
    process.env.CRON_SECRET = originalSecret;
  }
});

test('Part A.3: Cron Auth — Valid Bearer Token Authenticates and Prunes Successfully', async () => {
  const originalSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = TEST_CRON_SECRET;

  const app = express();
  app.use(express.json());
  app.use('/api/kyana/telemetry', createKyanaPilotTelemetryRouter(db));

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/kyana/telemetry/internal/prune`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_CRON_SECRET}`
      }
    });

    assert.equal(res.status, 200, 'Valid cron secret must return HTTP 200');
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.status, 'pruned');
    assert.equal(json.retentionDays, 90);
    assert.equal(typeof json.deletedTelemetry, 'number');
    assert.equal(typeof json.deletedFeedback, 'number');
    assert.ok(json.executedAt, 'Must include execution timestamp');

    // Zero PII / secret leak verification
    assert.equal(json.secret, undefined);
    assert.equal(json.studentId, undefined);
    assert.equal(json.sessionHash, undefined);
  } finally {
    server.close();
    process.env.CRON_SECRET = originalSecret;
  }
});

test('Part A.4: Cron Auth — Valid x-cron-secret Header Authenticates Successfully', async () => {
  const originalSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = TEST_CRON_SECRET;

  const app = express();
  app.use(express.json());
  app.use('/api/kyana/telemetry', createKyanaPilotTelemetryRouter(db));

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/kyana/telemetry/internal/prune`, {
      method: 'GET',
      headers: {
        'x-cron-secret': TEST_CRON_SECRET
      }
    });

    assert.equal(res.status, 200, 'x-cron-secret header must be accepted for Vercel Cron invocation');
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.status, 'pruned');
  } finally {
    server.close();
    process.env.CRON_SECRET = originalSecret;
  }
});

test('Part A.5: Retention Pruning — Deletes >90 Days Records and Preserves <90 Days Records', async () => {
  const isPg = Boolean(db.isPostgres);
  const oldInstance = `old_vis_${Date.now()}`;
  const freshInstance = `fresh_vis_${Date.now()}`;

  // Insert an expired record (>90 days old, e.g. 100 days old)
  const oldDateExpr = isPg
    ? "CURRENT_TIMESTAMP - INTERVAL '100 days'"
    : "datetime('now', '-100 days')";

  if (isPg) {
    await db.run(`
      INSERT INTO kyana_visualization_telemetry (instance_id, session_hash, engine_id, subject_code, created_at)
      VALUES ($1, $2, $3, $4, ${oldDateExpr})
    `, oldInstance, 'hash_old', 'algo_anim', 'CIT214');

    await db.run(`
      INSERT INTO kyana_visualization_feedback (instance_id, session_hash, rating, reason, created_at)
      VALUES ($1, $2, $3, $4, ${oldDateExpr})
    `, oldInstance, 'hash_old', 'helpful', 'clear_explanation');
  } else {
    await db.run(`
      INSERT INTO kyana_visualization_telemetry (instance_id, session_hash, engine_id, subject_code, created_at)
      VALUES (?, ?, ?, ?, ${oldDateExpr})
    `, oldInstance, 'hash_old', 'algo_anim', 'CIT214');

    await db.run(`
      INSERT INTO kyana_visualization_feedback (instance_id, session_hash, rating, reason, created_at)
      VALUES (?, ?, ?, ?, ${oldDateExpr})
    `, oldInstance, 'hash_old', 'helpful', 'clear_explanation');
  }

  // Insert a fresh record (<90 days old, e.g. today)
  await recordTelemetryEvent(db, {
    instanceId: freshInstance,
    sessionHash: 'hash_fresh',
    engineId: 'algo_anim',
    subjectCode: 'CIT214'
  });
  await recordFeedback(db, {
    instanceId: freshInstance,
    sessionHash: 'hash_fresh',
    rating: 'helpful'
  });

  // Verify both existed prior to pruning
  const beforeOldTel = await db.get('SELECT * FROM kyana_visualization_telemetry WHERE instance_id = ?', oldInstance);
  const beforeFreshTel = await db.get('SELECT * FROM kyana_visualization_telemetry WHERE instance_id = ?', freshInstance);
  assert.ok(beforeOldTel, 'Old record must exist before pruning');
  assert.ok(beforeFreshTel, 'Fresh record must exist before pruning');

  // Execute pruning with standard 90-day retention
  const pruneResult = await pruneTelemetryRecords(db, { retentionDays: 90 });
  assert.equal(pruneResult.ok, true);
  assert.ok(pruneResult.deletedTelemetry >= 1, 'Must delete at least 1 expired telemetry row');
  assert.ok(pruneResult.deletedFeedback >= 1, 'Must delete at least 1 expired feedback row');

  // Verify expired records were deleted
  const afterOldTel = await db.get('SELECT * FROM kyana_visualization_telemetry WHERE instance_id = ?', oldInstance);
  const afterOldFb = await db.get('SELECT * FROM kyana_visualization_feedback WHERE instance_id = ?', oldInstance);
  assert.ok(!afterOldTel, 'Expired telemetry record must be deleted');
  assert.ok(!afterOldFb, 'Expired feedback record must be deleted');

  // Verify fresh records were preserved
  const afterFreshTel = await db.get('SELECT * FROM kyana_visualization_telemetry WHERE instance_id = ?', freshInstance);
  const afterFreshFb = await db.get('SELECT * FROM kyana_visualization_feedback WHERE instance_id = ?', freshInstance);
  assert.ok(afterFreshTel, 'Fresh telemetry record must be preserved');
  assert.ok(afterFreshFb, 'Fresh feedback record must be preserved');
});

test('Part A.6: Retention Pruning — Idempotence on Repeated Invocation', async () => {
  const firstRun = await pruneTelemetryRecords(db, { retentionDays: 90 });
  assert.equal(firstRun.ok, true);

  // Immediate second run should complete cleanly with 0 remaining expired records
  const secondRun = await pruneTelemetryRecords(db, { retentionDays: 90 });
  assert.equal(secondRun.ok, true);
  assert.equal(secondRun.deletedTelemetry, 0, 'Second run must have 0 telemetry rows deleted');
  assert.equal(secondRun.deletedFeedback, 0, 'Second run must have 0 feedback rows deleted');
});

test('Part A.7: Retention Pruning — Database Failure Resilience', async () => {
  // Test with invalid / unavailable database handle
  const brokenDb = { run: async () => { throw new Error('Database pool exhausted'); } };
  const failResult = await pruneTelemetryRecords(brokenDb, { retentionDays: 90 });

  assert.equal(failResult.ok, false);
  assert.match(failResult.error, /pool exhausted/i);
});


// ============================================================================
// PART B & C — CANONICAL CURRICULUM CORRECTION & PRODUCTION RESOLUTION (LB-2)
// ============================================================================

test('Part B.1: Canonical Resolution — Data Structures and Algorithms maps to CIT214 (Semester 3)', () => {
  const query = 'Show binary search.';
  const resolved = cr.resolveSyllabusConcept(query);

  assert.ok(resolved, 'Concept must resolve');
  assert.equal(resolved.courseCode, 'CIT214', 'Binary search must resolve to CIT214');
  assert.equal(resolved.canonicalSubject, 'Data Structure and Algorithms');
  assert.equal(resolved.semesterNum, 3, 'DSA must map to Semester 3');

  // Presentation planning verification
  const plan = planAdaptivePresentation(query, { subjectCode: resolved.courseCode, semester: resolved.semesterNum });
  assert.equal(plan.profile, 'algorithm_walkthrough', 'Algorithm walkthrough profile expected');
});

test('Part B.2: Canonical Resolution — Digital Logic maps to ELX121 (Semester 2)', () => {
  const query = 'Explain XOR gates.';
  const resolved = cr.resolveSyllabusConcept(query);

  assert.ok(resolved, 'Concept must resolve');
  assert.equal(resolved.courseCode, 'ELX121', 'XOR gates must resolve to ELX121');
  assert.equal(resolved.canonicalSubject, 'Digital Logic');
  assert.equal(resolved.semesterNum, 2, 'Digital Logic must map to Semester 2');

  const plan = planAdaptivePresentation(query, { subjectCode: resolved.courseCode, semester: resolved.semesterNum });
  assert.equal(plan.profile, 'interactive_simulation', 'Interactive simulation profile expected');
});

test('Part B.3: Canonical Resolution — Database Management System maps to CIT213 (Semester 3)', () => {
  const query = 'Explain database primary and foreign keys.';
  const resolved = cr.resolveSyllabusConcept(query);

  assert.ok(resolved, 'Concept must resolve');
  assert.equal(resolved.courseCode, 'CIT213', 'DBMS concepts must resolve to CIT213');
  assert.equal(resolved.canonicalSubject, 'Database Management System');
  assert.equal(resolved.semesterNum, 3, 'DBMS must map to Semester 3');

  const plan = planAdaptivePresentation(query, { subjectCode: resolved.courseCode, semester: resolved.semesterNum });
  assert.equal(plan.profile, 'conceptual_explanation', 'Conceptual explanation expected');
});

test('Part B.4: Canonical Resolution — Operating Systems maps to CIT221 (Semester 4)', () => {
  const query = 'Show FCFS CPU scheduling.';
  const resolved = cr.resolveSyllabusConcept(query);

  assert.ok(resolved, 'Concept must resolve');
  assert.equal(resolved.courseCode, 'CIT221', 'Operating Systems CPU scheduling must resolve to CIT221');
  assert.equal(resolved.canonicalSubject, 'Operating Systems');
  assert.equal(resolved.semesterNum, 4, 'Operating Systems must map to Semester 4');

  const plan = planAdaptivePresentation(query, { subjectCode: resolved.courseCode, semester: resolved.semesterNum });
  assert.ok(plan.profile, 'Valid presentation profile expected');
});

test('Part B.5: Canonical Syllabus Integrity Check against public/syllabus-data.json', () => {
  const syllabus = require('../public/syllabus-data.json');
  const allCourses = [];
  (syllabus.semesters || []).forEach(sem => {
    (sem.courses || []).forEach(c => allCourses.push({ ...c, semester: sem.semester }));
  });

  const cit214 = allCourses.find(c => c.code === 'CIT214');
  assert.ok(cit214, 'CIT214 must exist in canonical syllabus');
  assert.equal(cit214.title, 'Data Structure and Algorithms');
  assert.equal(cit214.semester, 'III');

  const elx121 = allCourses.find(c => c.code === 'ELX121');
  assert.ok(elx121, 'ELX121 must exist in canonical syllabus');
  assert.equal(elx121.title, 'Digital Logic');
  assert.equal(elx121.semester, 'II');

  const cit213 = allCourses.find(c => c.code === 'CIT213');
  assert.ok(cit213, 'CIT213 must exist in canonical syllabus');
  assert.equal(cit213.title, 'Database Management System');
  assert.equal(cit213.semester, 'III');

  const cit221 = allCourses.find(c => c.code === 'CIT221');
  assert.ok(cit221, 'CIT221 must exist in canonical syllabus');
  assert.equal(cit221.title, 'Operating Systems');
  assert.equal(cit221.semester, 'IV');

  // Confirm non-existence of fictitious BIT101
  const bit101 = allCourses.find(c => c.code === 'BIT101');
  assert.equal(bit101, undefined, 'BIT101 must NOT exist in Gandaki University BIT syllabus');
});

test.after(() => {
  setTimeout(() => process.exit(0), 100);
});
