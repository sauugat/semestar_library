'use strict';

/**
 * Kyana Academic Visualization Pilot Telemetry Tests (tests/kyana-pilot-telemetry.test.js)
 * 
 * Verifies Phase 2.6 pilot telemetry, feedback deduplication, privacy compliance,
 * admin report aggregation, and authorization boundaries.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');

const db = require('../db');
const {
  hashSession,
  sanitizeFailureReason,
  sanitizeRating,
  sanitizeFeedbackReason,
  ensureTelemetrySchema,
  recordTelemetryEvent,
  recordControlsInteraction,
  recordFeedback,
  getPilotReport
} = require('../lib/kyana-pilot-telemetry');
const { createKyanaPilotTelemetryRouter } = require('../routes/kyana-pilot-telemetry');

test.before(async () => {
  await ensureTelemetrySchema({ db });
  // Clean up any test records in isolated tables
  try {
    await db.exec("DELETE FROM kyana_visualization_feedback WHERE instance_id LIKE 'test_%'");
    await db.exec("DELETE FROM kyana_visualization_telemetry WHERE instance_id LIKE 'test_%'");
  } catch (_) {}
});

test('1. Privacy Guarantees — Session Hashing & Sanitization', async () => {
  const studentId = 'STU_2083_BIT_042';
  const hash1 = hashSession(studentId);
  const hash2 = hashSession(studentId);

  // Must be deterministic for the same student within the pilot
  assert.equal(hash1, hash2);
  assert.equal(typeof hash1, 'string');
  assert.equal(hash1.length, 32);

  // Must NEVER expose the original studentId or format
  assert.equal(hash1.includes(studentId), false);
  assert.equal(hash1.includes('BIT'), false);
  assert.equal(hash1.includes('STU'), false);

  // Different students must produce distinct hashes
  const otherHash = hashSession('STU_2083_BIT_099');
  assert.notEqual(hash1, otherHash);

  // Failure reason sanitization to predefined enums
  assert.equal(sanitizeFailureReason('Array must be sorted in ascending order'), 'UNSORTED_ARRAY');
  assert.equal(sanitizeFailureReason('Unexpected token < in JSON at position 0'), 'MALFORMED_JSON');
  assert.equal(sanitizeFailureReason('Validation failed: missing payload.engine'), 'VALIDATION_FAILED');
  assert.equal(sanitizeFailureReason('Target container is required'), 'CONTAINER_MISSING');
  assert.equal(sanitizeFailureReason('Unknown fatal render crash'), 'RENDER_CRASH');
  assert.equal(sanitizeFailureReason(null), null);

  // Feedback rating sanitization
  assert.equal(sanitizeRating('helpful'), 'helpful');
  assert.equal(sanitizeRating('UNHELPFUL'), 'unhelpful');
  assert.equal(sanitizeRating('invalid_score'), null);

  // Feedback reason sanitization
  assert.equal(sanitizeFeedbackReason('Clear Explanation'), 'clear_explanation');
  assert.equal(sanitizeFeedbackReason('Broken-animation'), 'broken_animation');
  assert.equal(sanitizeFeedbackReason('custom random reason'), 'other');
});

test('2. Telemetry Lifecycle Event Recording & Storage', async () => {
  const instanceId = `test_vis_binary_search_${Date.now()}`;
  const studentId = 'student_pilot_01';
  const sessionHash = hashSession(studentId);

  const res = await recordTelemetryEvent(db, {
    instanceId,
    sessionHash,
    engineId: 'algo_anim',
    subjectCode: 'CIT122',
    semesterNo: 2,
    selected: true,
    validationPassed: true,
    renderPassed: true,
    controlsUsed: false,
    latencyMs: 1420
  });

  assert.equal(res.ok, true);
  assert.equal(res.instanceId, instanceId);

  // Verify persistence and zero PII
  const row = await db.get(
    'SELECT * FROM kyana_visualization_telemetry WHERE instance_id = ?',
    instanceId
  );

  assert.ok(row);
  assert.equal(row.instance_id ?? row.instanceId, instanceId);
  assert.equal(row.session_hash ?? row.sessionHash, sessionHash);
  assert.equal(row.engine_id ?? row.engineId, 'algo_anim');
  assert.equal(row.subject_code ?? row.subjectCode, 'CIT122');
  assert.equal(Number(row.latency_ms ?? row.latencyMs), 1420);
  assert.equal(Number(row.controls_used ?? row.controlsUsed), 0);

  // PII verification: verify table schema has no prompt/message/email columns
  assert.equal(row.prompt, undefined);
  assert.equal(row.message, undefined);
  assert.equal(row.content, undefined);
  assert.equal(row.email, undefined);
});

test('3. Playback / Simulator Interaction Tracking', async () => {
  const instanceId = `test_vis_stack_${Date.now()}`;
  const sessionHash = hashSession('student_pilot_02');

  await recordTelemetryEvent(db, {
    instanceId,
    sessionHash,
    engineId: 'dsa_linear',
    subjectCode: 'CIT122',
    semesterNo: 2,
    selected: true,
    validationPassed: true,
    renderPassed: true,
    controlsUsed: false,
    latencyMs: 850
  });

  // Now student interacts with playback controls
  const updateRes = await recordControlsInteraction(db, { instanceId, sessionHash });
  assert.equal(updateRes.ok, true);

  const updatedRow = await db.get(
    'SELECT controls_used FROM kyana_visualization_telemetry WHERE instance_id = ?',
    instanceId
  );

  assert.equal(Number(updatedRow.controls_used ?? updatedRow.controlsUsed), 1);
});

test('4. Student Feedback Submission & Strict Deduplication', async () => {
  const instanceId = `test_vis_logic_${Date.now()}`;
  const studentHash = hashSession('student_pilot_03');

  // 1. Initial vote: Helpful
  const fb1 = await recordFeedback(db, {
    instanceId,
    sessionHash: studentHash,
    rating: 'helpful',
    reason: 'interactive_helpful'
  });
  assert.equal(fb1.ok, true);

  let rows = await db.all(
    'SELECT * FROM kyana_visualization_feedback WHERE instance_id = ?',
    instanceId
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rating, 'helpful');
  assert.equal(rows[0].reason, 'interactive_helpful');

  // 2. Duplicate click by same student: change vote to Unhelpful
  const fb2 = await recordFeedback(db, {
    instanceId,
    sessionHash: studentHash,
    rating: 'unhelpful',
    reason: 'confusing'
  });
  assert.equal(fb2.ok, true);

  // Strict Deduplication Check: must still be exactly 1 record, not 2
  rows = await db.all(
    'SELECT * FROM kyana_visualization_feedback WHERE instance_id = ?',
    instanceId
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rating, 'unhelpful');
  assert.equal(rows[0].reason, 'confusing');

  // 3. Different student votes on the same visualization
  const otherStudentHash = hashSession('student_pilot_04');
  const fb3 = await recordFeedback(db, {
    instanceId,
    sessionHash: otherStudentHash,
    rating: 'helpful',
    reason: 'clear_explanation'
  });
  assert.equal(fb3.ok, true);

  rows = await db.all(
    'SELECT * FROM kyana_visualization_feedback WHERE instance_id = ?',
    instanceId
  );
  assert.equal(rows.length, 2);
});

test('5. Admin Pilot Report Aggregation Metrics', async () => {
  // Populate a known batch of test data
  const batchId = `test_batch_${Date.now()}`;

  await recordTelemetryEvent(db, {
    instanceId: `${batchId}_1`,
    sessionHash: 'hash_a',
    engineId: 'algo_anim',
    subjectCode: 'CIT122',
    validationPassed: true,
    renderPassed: true,
    controlsUsed: true,
    latencyMs: 1200
  });

  await recordTelemetryEvent(db, {
    instanceId: `${batchId}_2`,
    sessionHash: 'hash_b',
    engineId: 'logic_sim',
    subjectCode: 'CIT221',
    validationPassed: true,
    renderPassed: true,
    controlsUsed: false,
    latencyMs: 1800
  });

  await recordTelemetryEvent(db, {
    instanceId: `${batchId}_3`,
    sessionHash: 'hash_c',
    engineId: 'dsa_linear',
    subjectCode: 'CIT122',
    validationPassed: false,
    renderPassed: false,
    failureReason: 'UNSORTED_ARRAY',
    latencyMs: 600
  });

  await recordFeedback(db, {
    instanceId: `${batchId}_1`,
    sessionHash: 'hash_a',
    rating: 'helpful',
    reason: 'clear_explanation'
  });

  await recordFeedback(db, {
    instanceId: `${batchId}_2`,
    sessionHash: 'hash_b',
    rating: 'unhelpful',
    reason: 'too_fast'
  });

  const report = await getPilotReport(db);

  assert.ok(report);
  assert.ok(report.summary);
  assert.ok(report.summary.totalAttempts >= 3);
  assert.ok(typeof report.summary.renderSuccessRate === 'number');
  assert.ok(typeof report.summary.validationFailureRate === 'number');
  assert.ok(typeof report.summary.controlsUsageRate === 'number');
  assert.ok(typeof report.summary.medianLatencyMs === 'number');

  assert.ok(Array.isArray(report.attemptsByEngine));
  assert.ok(Array.isArray(report.mostUsedSubjects));
  assert.ok(report.feedback);
  assert.ok(report.feedback.total >= 2);
  assert.ok(typeof report.feedback.helpfulRatio === 'number');

  assert.ok(Array.isArray(report.recentFailures));
  const hasUnsorted = report.recentFailures.some(f => f.failureReason === 'UNSORTED_ARRAY');
  assert.ok(hasUnsorted);

  // Guarantee report contains zero student identifiers
  const reportString = JSON.stringify(report);
  assert.equal(reportString.includes('student_pilot'), false);
  assert.equal(reportString.includes('password'), false);
  assert.equal(reportString.includes('prompt'), false);
});

test('6. HTTP Telemetry Endpoints & Authorization Security', async () => {
  const app = express();
  app.use(express.json());

  // Mount telemetry routes
  app.use('/api/kyana/telemetry', createKyanaPilotTelemetryRouter(db));

  // Mount mock admin report with guard
  app.get('/api/admin/kyana/pilot-report', async (req, res) => {
    const role = req.headers['x-test-role'];
    if (!role) {
      return res.status(401).json({ message: 'Authentication required. Please sign in.' });
    }
    if (role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: Administrator access required.' });
    }
    const report = await getPilotReport(db);
    res.json(report);
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Post telemetry event
    const eventRes = await fetch(`${baseUrl}/api/kyana/telemetry/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: `test_http_vis_${Date.now()}`,
        engineId: 'algo_anim',
        subjectCode: 'CIT122',
        semesterNo: 2,
        latencyMs: 1100
      })
    });
    assert.equal(eventRes.status, 200);
    const eventJson = await eventRes.json();
    assert.equal(eventJson.ok, true);

    // 2. Post controls interaction
    const interactRes = await fetch(`${baseUrl}/api/kyana/telemetry/interaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: `test_http_vis_${Date.now()}`
      })
    });
    assert.equal(interactRes.status, 200);
    const interactJson = await interactRes.json();
    assert.equal(interactJson.ok, true);

    // 3. Post feedback (valid)
    const fbRes = await fetch(`${baseUrl}/api/kyana/telemetry/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: `test_http_vis_${Date.now()}`,
        rating: 'helpful',
        reason: 'clear_explanation'
      })
    });
    assert.equal(fbRes.status, 200);
    const fbJson = await fbRes.json();
    assert.equal(fbJson.ok, true);

    // 4. Post feedback (invalid rating rejected)
    const badFbRes = await fetch(`${baseUrl}/api/kyana/telemetry/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: `test_http_vis_${Date.now()}`,
        rating: 'not_a_valid_rating'
      })
    });
    assert.equal(badFbRes.status, 400);

    // 5. Admin Report — Unauthenticated returns 401
    const unauthRes = await fetch(`${baseUrl}/api/admin/kyana/pilot-report`);
    assert.equal(unauthRes.status, 401);

    // 6. Admin Report — Student role returns 403
    const studentRes = await fetch(`${baseUrl}/api/admin/kyana/pilot-report`, {
      headers: { 'x-test-role': 'student' }
    });
    assert.equal(studentRes.status, 403);

    // 7. Admin Report — Admin role returns 200
    const adminRes = await fetch(`${baseUrl}/api/admin/kyana/pilot-report`, {
      headers: { 'x-test-role': 'admin' }
    });
    assert.equal(adminRes.status, 200);
    const adminJson = await adminRes.json();
    assert.ok(adminJson.summary);
    assert.ok(adminJson.privacyCompliant);
  } finally {
    server.close();
  }
});

test('7. Telemetry Resilience — Fault Tolerance', async () => {
  // Test that invalid / corrupted database client does not throw or crash
  const fakeDb = {
    run: async () => { throw new Error('Simulated database network timeout'); }
  };

  const eventRes = await recordTelemetryEvent(fakeDb, { instanceId: 'test_crash' });
  assert.equal(eventRes.ok, false);
  assert.ok(eventRes.error);

  const fbRes = await recordFeedback(fakeDb, { instanceId: 'test_crash', rating: 'helpful' });
  assert.equal(fbRes.ok, false);
  assert.ok(fbRes.error);

  const ctrlRes = await recordControlsInteraction(fakeDb, { instanceId: 'test_crash' });
  assert.equal(ctrlRes.ok, false);
});
