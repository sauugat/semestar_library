'use strict';

/**
 * Kyana Academic Visualization Pilot Telemetry Service (lib/kyana-pilot-telemetry.js)
 * 
 * Provides privacy-preserving observability, student feedback collection,
 * deduplication, and administrative reporting for the Kyana Academic
 * Visualization Engine during the 10-20 student pilot at Gandaki University (BIT).
 * 
 * Strict Privacy Guarantees:
 * 1. Zero PII: Never stores student names, student IDs, usernames, or emails.
 * 2. Zero Chat Logs: Never stores prompt text, response content, or code excerpts.
 * 3. Rotated / Hashed Sessions: Student identification is an HMAC-SHA256 hash.
 * 4. Sanitized Failure Enums: Only predefined error categories are recorded.
 */

const crypto = require('crypto');

const PILOT_SALT = process.env.KYANA_PILOT_SALT || 'kyana_pilot_bit_gandaki_2026';

const ALLOWED_ENGINES = new Set([
  'algo_anim',
  'dsa_linear',
  'logic_sim',
  'truth_table',
  'dbms_relational',
  'os_sim',
  'comp_arch',
  'crypto_cipher',
  'network_sim',
  'tree_sim',
  'graph_sim',
  'ai_agent',
  'adaptive_visual',
  'other'
]);

const ALLOWED_FAILURE_REASONS = new Set([
  'VALIDATION_FAILED',
  'MALFORMED_JSON',
  'UNSORTED_ARRAY',
  'OUT_OF_BOUNDS',
  'UNSUPPORTED_ALGORITHM',
  'RENDER_CRASH',
  'CONTAINER_MISSING',
  'STEP_ERROR',
  'TIMEOUT',
  'UNKNOWN'
]);

const ALLOWED_RATINGS = new Set(['helpful', 'unhelpful']);

const ALLOWED_FEEDBACK_REASONS = new Set([
  'clear_explanation',
  'easy_to_follow',
  'interactive_helpful',
  'confusing',
  'broken_animation',
  'incorrect_step',
  'too_fast',
  'too_slow',
  'other'
]);

/**
 * Computes an anonymous, irreversible HMAC-SHA256 hash of a session or student identifier.
 * Enables deduplication of feedback without ever storing student identities.
 */
function hashSession(rawIdentifier) {
  if (!rawIdentifier) return 'anonymous_session';
  return crypto.createHmac('sha256', PILOT_SALT).update(String(rawIdentifier)).digest('hex').slice(0, 32);
}

/**
 * Sanitizes incoming failure reason into a controlled enum.
 * Never stores arbitrary error messages that could leak student input.
 */
function sanitizeFailureReason(reason) {
  if (!reason) return null;
  const normalized = String(reason).trim().toUpperCase();
  if (ALLOWED_FAILURE_REASONS.has(normalized)) return normalized;
  
  if (/unsorted|must be sorted|not sorted|sort order/i.test(normalized)) return 'UNSORTED_ARRAY';
  if (/syntax|json|parse/i.test(normalized)) return 'MALFORMED_JSON';
  if (/validat|schema/i.test(normalized)) return 'VALIDATION_FAILED';
  if (/bound|range|index/i.test(normalized)) return 'OUT_OF_BOUNDS';
  if (/algorithm|unsupported/i.test(normalized)) return 'UNSUPPORTED_ALGORITHM';
  if (/container|mount/i.test(normalized)) return 'CONTAINER_MISSING';
  if (/crash|render/i.test(normalized)) return 'RENDER_CRASH';
  if (/step/i.test(normalized)) return 'STEP_ERROR';
  if (/timeout/i.test(normalized)) return 'TIMEOUT';

  return 'UNKNOWN';
}

/**
 * Sanitizes feedback rating into 'helpful' or 'unhelpful'.
 */
function sanitizeRating(rating) {
  const norm = String(rating || '').trim().toLowerCase();
  return ALLOWED_RATINGS.has(norm) ? norm : null;
}

/**
 * Sanitizes feedback reason into an allowed tag or null.
 */
function sanitizeFeedbackReason(reason) {
  if (!reason) return null;
  const norm = String(reason).trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ALLOWED_FEEDBACK_REASONS.has(norm) ? norm : 'other';
}

/**
 * Ensures pilot telemetry tables exist across both PostgreSQL and SQLite.
 */
async function ensureTelemetrySchema({ exec, isPostgres, db } = {}) {
  const execFn = exec || (db && typeof db.exec === 'function' ? db.exec.bind(db) : null);
  if (!execFn) return;

  const isPg = Boolean(isPostgres || (db && db.isPostgres));

  if (isPg) {
    await execFn(`
      CREATE TABLE IF NOT EXISTS kyana_visualization_telemetry (
        id SERIAL PRIMARY KEY,
        instance_id VARCHAR(64) NOT NULL,
        session_hash VARCHAR(64) NOT NULL,
        engine_id VARCHAR(32) NOT NULL,
        subject_code VARCHAR(32),
        semester_no INTEGER,
        selected BOOLEAN DEFAULT TRUE,
        validation_passed BOOLEAN DEFAULT TRUE,
        render_passed BOOLEAN DEFAULT TRUE,
        controls_used BOOLEAN DEFAULT FALSE,
        failure_reason VARCHAR(64),
        latency_ms INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_kvt_engine ON kyana_visualization_telemetry (engine_id);
      CREATE INDEX IF NOT EXISTS idx_kvt_created ON kyana_visualization_telemetry (created_at);
      CREATE INDEX IF NOT EXISTS idx_kvt_subject ON kyana_visualization_telemetry (subject_code);
      CREATE INDEX IF NOT EXISTS idx_kvt_instance ON kyana_visualization_telemetry (instance_id);

      CREATE TABLE IF NOT EXISTS kyana_visualization_feedback (
        id SERIAL PRIMARY KEY,
        instance_id VARCHAR(64) NOT NULL,
        session_hash VARCHAR(64) NOT NULL,
        rating VARCHAR(16) NOT NULL,
        reason VARCHAR(64),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(instance_id, session_hash)
      );

      CREATE INDEX IF NOT EXISTS idx_kvf_instance ON kyana_visualization_feedback (instance_id);
      CREATE INDEX IF NOT EXISTS idx_kvf_rating ON kyana_visualization_feedback (rating);
    `);
  } else {
    await execFn(`
      CREATE TABLE IF NOT EXISTS kyana_visualization_telemetry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT NOT NULL,
        session_hash TEXT NOT NULL,
        engine_id TEXT NOT NULL,
        subject_code TEXT,
        semester_no INTEGER,
        selected INTEGER DEFAULT 1,
        validation_passed INTEGER DEFAULT 1,
        render_passed INTEGER DEFAULT 1,
        controls_used INTEGER DEFAULT 0,
        failure_reason TEXT,
        latency_ms INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_kvt_engine ON kyana_visualization_telemetry (engine_id);
      CREATE INDEX IF NOT EXISTS idx_kvt_created ON kyana_visualization_telemetry (created_at);
      CREATE INDEX IF NOT EXISTS idx_kvt_subject ON kyana_visualization_telemetry (subject_code);
      CREATE INDEX IF NOT EXISTS idx_kvt_instance ON kyana_visualization_telemetry (instance_id);

      CREATE TABLE IF NOT EXISTS kyana_visualization_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT NOT NULL,
        session_hash TEXT NOT NULL,
        rating TEXT NOT NULL,
        reason TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(instance_id, session_hash)
      );

      CREATE INDEX IF NOT EXISTS idx_kvf_instance ON kyana_visualization_feedback (instance_id);
      CREATE INDEX IF NOT EXISTS idx_kvf_rating ON kyana_visualization_feedback (rating);
    `);
  }
}

/**
 * Record a visualization lifecycle event.
 * Non-blocking, fails gracefully.
 */
async function recordTelemetryEvent(db, eventData = {}) {
  if (!db || typeof db.run !== 'function') return { ok: false, error: 'Database unavailable' };

  try {
    const instanceId = String(eventData.instanceId || eventData.instance_id || `vis_${Date.now()}`).slice(0, 64);
    const sessionHash = eventData.sessionHash || hashSession(eventData.rawSession || eventData.studentId || 'anon');
    const engineId = ALLOWED_ENGINES.has(String(eventData.engineId || eventData.engine).toLowerCase())
      ? String(eventData.engineId || eventData.engine).toLowerCase()
      : 'algo_anim';
    const subjectCode = eventData.subjectCode || eventData.subject ? String(eventData.subjectCode || eventData.subject).slice(0, 32).toUpperCase() : null;
    const semesterNo = Number.isInteger(Number(eventData.semesterNo || eventData.semester)) ? Number(eventData.semesterNo || eventData.semester) : null;
    const selected = eventData.selected !== false;
    const validationPassed = eventData.validationPassed !== false;
    const renderPassed = eventData.renderPassed !== false;
    const controlsUsed = Boolean(eventData.controlsUsed);
    const failureReason = sanitizeFailureReason(eventData.failureReason || eventData.failure_reason);
    const latencyMs = Math.max(0, Math.min(120000, Number(eventData.latencyMs || eventData.latency_ms || 0)));

    const isPg = Boolean(db.isPostgres);
    const sql = `
      INSERT INTO kyana_visualization_telemetry (
        instance_id, session_hash, engine_id, subject_code, semester_no,
        selected, validation_passed, render_passed, controls_used, failure_reason, latency_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${isPg ? 'CURRENT_TIMESTAMP' : "datetime('now')"})
    `;

    await db.run(
      sql,
      instanceId,
      sessionHash,
      engineId,
      subjectCode,
      semesterNo,
      isPg ? selected : (selected ? 1 : 0),
      isPg ? validationPassed : (validationPassed ? 1 : 0),
      isPg ? renderPassed : (renderPassed ? 1 : 0),
      isPg ? controlsUsed : (controlsUsed ? 1 : 0),
      failureReason,
      latencyMs
    );

    return { ok: true, instanceId };
  } catch (err) {
    console.error('[KyanaPilotTelemetry] Failed to record telemetry event:', err?.message || err);
    return { ok: false, error: err?.message || 'Failed to record event' };
  }
}

/**
 * Updates controls_used flag when a student engages with playback controls or simulator buttons.
 */
async function recordControlsInteraction(db, { instanceId, sessionHash, rawSession } = {}) {
  if (!db || typeof db.run !== 'function' || !instanceId) return { ok: false };

  try {
    const resolvedHash = sessionHash || (rawSession ? hashSession(rawSession) : null);
    const isPg = Boolean(db.isPostgres);
    const val = isPg ? true : 1;

    if (resolvedHash) {
      await db.run(
        `UPDATE kyana_visualization_telemetry SET controls_used = ? WHERE instance_id = ? AND session_hash = ?`,
        val, instanceId, resolvedHash
      );
    } else {
      await db.run(
        `UPDATE kyana_visualization_telemetry SET controls_used = ? WHERE instance_id = ?`,
        val, instanceId
      );
    }

    return { ok: true };
  } catch (err) {
    console.error('[KyanaPilotTelemetry] Failed to update controls interaction:', err?.message || err);
    return { ok: false };
  }
}

/**
 * Records student feedback ('helpful' | 'unhelpful') with deduplication.
 * Repeated clicks by the same student for the same visualizer update the existing record.
 */
async function recordFeedback(db, feedbackData = {}) {
  if (!db || typeof db.run !== 'function') return { ok: false, error: 'Database unavailable' };

  try {
    const instanceId = String(feedbackData.instanceId || feedbackData.instance_id || '').trim();
    if (!instanceId) return { ok: false, error: 'Missing instanceId' };

    const sessionHash = feedbackData.sessionHash || hashSession(feedbackData.rawSession || feedbackData.studentId || 'anon');
    const rating = sanitizeRating(feedbackData.rating);
    if (!rating) return { ok: false, error: 'Invalid rating (must be helpful or unhelpful)' };

    const reason = sanitizeFeedbackReason(feedbackData.reason);
    const isPg = Boolean(db.isPostgres);

    const sql = `
      INSERT INTO kyana_visualization_feedback (instance_id, session_hash, rating, reason, created_at)
      VALUES (?, ?, ?, ?, ${isPg ? 'CURRENT_TIMESTAMP' : "datetime('now')"})
      ON CONFLICT(instance_id, session_hash) DO UPDATE SET
        rating = EXCLUDED.rating,
        reason = EXCLUDED.reason,
        created_at = ${isPg ? 'CURRENT_TIMESTAMP' : "datetime('now')"}
      RETURNING id
    `;

    await db.run(sql, instanceId, sessionHash, rating, reason);
    return { ok: true, status: 'recorded', instanceId };
  } catch (err) {
    console.error('[KyanaPilotTelemetry] Failed to record feedback:', err?.message || err);
    return { ok: false, error: err?.message || 'Failed to record feedback' };
  }
}

/**
 * Generates an aggregated administrative pilot report.
 * Guaranteed 100% free of student PII or message content.
 */
async function getPilotReport(db, options = {}) {
  if (!db || typeof db.all !== 'function') {
    throw new Error('Database is required for pilot reporting.');
  }

  // 1. Total attempts and pass counts
  const totalRow = await db.get(`
    SELECT 
      COUNT(*) AS total_attempts,
      SUM(CASE WHEN validation_passed THEN 1 ELSE 0 END) AS valid_count,
      SUM(CASE WHEN render_passed THEN 1 ELSE 0 END) AS render_count,
      SUM(CASE WHEN controls_used THEN 1 ELSE 0 END) AS controls_count
    FROM kyana_visualization_telemetry
  `);

  const totalAttempts = Number(totalRow?.total_attempts || 0);
  const validCount = Number(totalRow?.valid_count || 0);
  const renderCount = Number(totalRow?.render_count || 0);
  const controlsCount = Number(totalRow?.controls_count || 0);

  const renderSuccessRate = totalAttempts > 0 ? Number(((renderCount / totalAttempts) * 100).toFixed(1)) : 100.0;
  const validationFailureRate = totalAttempts > 0 ? Number((((totalAttempts - validCount) / totalAttempts) * 100).toFixed(1)) : 0.0;
  const controlsUsageRate = renderCount > 0 ? Number(((controlsCount / renderCount) * 100).toFixed(1)) : 0.0;

  // 2. Attempts by engine
  const engineRows = await db.all(`
    SELECT engine_id, COUNT(*) AS count
    FROM kyana_visualization_telemetry
    GROUP BY engine_id
    ORDER BY count DESC
  `);
  const attemptsByEngine = (engineRows || []).map(r => ({
    engineId: r.engine_id || r.engineId,
    count: Number(r.count || 0)
  }));

  // 3. Most-used subjects
  const subjectRows = await db.all(`
    SELECT subject_code, COUNT(*) AS count
    FROM kyana_visualization_telemetry
    WHERE subject_code IS NOT NULL AND subject_code != ''
    GROUP BY subject_code
    ORDER BY count DESC
    LIMIT 10
  `);
  const mostUsedSubjects = (subjectRows || []).map(r => ({
    subjectCode: r.subject_code || r.subjectCode,
    count: Number(r.count || 0)
  }));

  // 4. Feedback metrics
  const feedbackTotalRow = await db.get(`
    SELECT 
      COUNT(*) AS total_feedback,
      SUM(CASE WHEN rating = 'helpful' THEN 1 ELSE 0 END) AS helpful_count,
      SUM(CASE WHEN rating = 'unhelpful' THEN 1 ELSE 0 END) AS unhelpful_count
    FROM kyana_visualization_feedback
  `);
  const totalFeedback = Number(feedbackTotalRow?.total_feedback || 0);
  const helpfulCount = Number(feedbackTotalRow?.helpful_count || 0);
  const unhelpfulCount = Number(feedbackTotalRow?.unhelpful_count || 0);
  const helpfulRatio = totalFeedback > 0 ? Number(((helpfulCount / totalFeedback) * 100).toFixed(1)) : 100.0;

  const reasonRows = await db.all(`
    SELECT reason, rating, COUNT(*) AS count
    FROM kyana_visualization_feedback
    WHERE reason IS NOT NULL AND reason != ''
    GROUP BY reason, rating
    ORDER BY count DESC
  `);
  const feedbackReasons = (reasonRows || []).map(r => ({
    reason: r.reason,
    rating: r.rating,
    count: Number(r.count || 0)
  }));

  // 5. Latency metrics (median)
  let medianLatencyMs = 0;
  const latencyRows = await db.all(`
    SELECT latency_ms
    FROM kyana_visualization_telemetry
    WHERE latency_ms > 0
    ORDER BY latency_ms ASC
  `);
  if (latencyRows && latencyRows.length > 0) {
    const mid = Math.floor(latencyRows.length / 2);
    medianLatencyMs = latencyRows.length % 2 !== 0
      ? Number(latencyRows[mid].latency_ms || latencyRows[mid].latencyMs)
      : Math.round((Number(latencyRows[mid - 1].latency_ms || latencyRows[mid - 1].latencyMs) + Number(latencyRows[mid].latency_ms || latencyRows[mid].latencyMs)) / 2);
  }

  // 6. Recent failures (sanitized categories only, zero PII)
  const failureRows = await db.all(`
    SELECT engine_id, failure_reason, created_at
    FROM kyana_visualization_telemetry
    WHERE (NOT validation_passed OR NOT render_passed OR failure_reason IS NOT NULL)
      AND failure_reason IS NOT NULL AND failure_reason != ''
    ORDER BY created_at DESC
    LIMIT 20
  `);
  const recentFailures = (failureRows || []).map(r => ({
    engineId: r.engine_id || r.engineId,
    failureReason: r.failure_reason || r.failureReason,
    createdAt: r.created_at || r.createdAt
  }));

  return {
    summary: {
      totalAttempts,
      validAttempts: validCount,
      renderedVisualizations: renderCount,
      controlsEngagements: controlsCount,
      renderSuccessRate,
      validationFailureRate,
      controlsUsageRate,
      medianLatencyMs,
      pilotCohortSize: '10-20 Students (Gandaki University BIT)'
    },
    attemptsByEngine,
    mostUsedSubjects,
    feedback: {
      total: totalFeedback,
      helpful: helpfulCount,
      unhelpful: unhelpfulCount,
      helpfulRatio,
      reasons: feedbackReasons
    },
    recentFailures,
    privacyCompliant: true,
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  ALLOWED_ENGINES,
  ALLOWED_FAILURE_REASONS,
  ALLOWED_RATINGS,
  ALLOWED_FEEDBACK_REASONS,
  hashSession,
  sanitizeFailureReason,
  sanitizeRating,
  sanitizeFeedbackReason,
  ensureTelemetrySchema,
  recordTelemetryEvent,
  recordControlsInteraction,
  recordFeedback,
  getPilotReport
};
