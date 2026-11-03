'use strict';

/**
 * KYANA AI 3.0 — Per-Request Timing Logger
 *
 * Tracks latency breakdown across:
 *   - Scope-gate decision type & duration (ms)
 *   - Context load (ms)
 *   - Query embedding (ms)
 *   - Knowledge retrieval (ms)
 *   - Time to first token (TTFT, ms)
 *   - Total request time (ms)
 *
 * SECURITY & PRIVACY:
 *   - NO prompt/content or message text stored
 *   - NO user queries or PII stored
 *   - NO secrets, auth tokens, or keys stored
 *   - Only timestamps, decision category enum, numeric durations (ms), and record counts
 *
 * Maintains an in-memory ring buffer of the last 50 requests.
 */

const MAX_TIMINGS = 50;
const timingsRingBuffer = [];

const ALLOWED_DECISION_TYPES = new Set([
  'in_scope',
  'syllabus_general',
  'smalltalk',
  'out_of_scope',
  'cross_student',
  'staff_individual_lookup',
  'platform_context_override',
  'sensitive_refusal'
]);

function sanitizeDecisionType(decision) {
  const d = String(decision || '').trim().toLowerCase();
  return ALLOWED_DECISION_TYPES.has(d) ? d : 'in_scope';
}

/**
 * Logs a single request timing entry.
 *
 * @param {object} entry
 * @param {string} [entry.scopeDecision='in_scope']
 * @param {number} [entry.scopeDecisionMs=0]
 * @param {number} [entry.contextLoadMs=0]
 * @param {number} [entry.embeddingMs=0]
 * @param {number} [entry.retrievalMs=0]
 * @param {number} [entry.timeToFirstTokenMs=0]
 * @param {number} [entry.totalMs=0]
 * @param {number} [entry.retrievedCount=0]
 * @param {number} [entry.cardsCount=0]
 * @param {boolean} [entry.fallback=false]
 */
function logTiming(entry = {}) {
  const record = {
    id: `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    scopeDecision: sanitizeDecisionType(entry.scopeDecision),
    scopeDecisionMs: Math.max(0, Math.round((Number(entry.scopeDecisionMs) || 0) * 100) / 100),
    contextLoadMs: Math.max(0, Math.round(entry.contextLoadMs || 0)),
    embeddingMs: Math.max(0, Math.round(entry.embeddingMs || 0)),
    databaseMs: Number.isFinite(entry.databaseMs) ? Math.max(0, Math.round(entry.databaseMs)) : null,
    retrievalMs: Math.max(0, Math.round(entry.retrievalMs || 0)),
    timeToFirstTokenMs: Math.max(0, Math.round(entry.timeToFirstTokenMs || 0)),
    totalMs: Math.max(0, Math.round(entry.totalMs || 0)),
    retrievedCount: Number(entry.retrievedCount || 0),
    cardsCount: Number(entry.cardsCount || 0),
    fallback: Boolean(entry.fallback)
  };

  timingsRingBuffer.unshift(record);
  if (timingsRingBuffer.length > MAX_TIMINGS) {
    timingsRingBuffer.length = MAX_TIMINGS;
  }

  // Serverless logging: Output structured JSON log line to stdout
  console.log(JSON.stringify({ tag: 'KYANA_TIMING', ...record }));

  return record;
}

/**
 * Convenience helper to record a standalone scope-gate decision (e.g. early refusal or smalltalk)
 * into the timing ring buffer with decision type and ms only (never message text).
 */
function logScopeDecision({ decision = 'out_of_scope', scopeDecisionMs = 0, contextLoadMs = 0, totalMs = null } = {}) {
  const roundedScopeMs = Math.max(0, Math.round((Number(scopeDecisionMs) || 0) * 100) / 100);
  const effectiveTotal = totalMs !== null ? totalMs : (roundedScopeMs + (Number(contextLoadMs) || 0));
  return logTiming({
    scopeDecision: decision,
    scopeDecisionMs: roundedScopeMs,
    contextLoadMs: Number(contextLoadMs) || 0,
    embeddingMs: 0,
    retrievalMs: 0,
    timeToFirstTokenMs: effectiveTotal,
    totalMs: effectiveTotal,
    retrievedCount: 0,
    cardsCount: 0,
    fallback: false
  });
}

/**
 * Returns the most recent timings up to limit (max 50), newest first.
 *
 * @param {number} [limit=50]
 * @returns {Array<object>}
 */
function getRecentTimings(limit = MAX_TIMINGS) {
  const count = Math.max(1, Math.min(limit, MAX_TIMINGS));
  return timingsRingBuffer.slice(0, count);
}

/**
 * Clears the timings buffer (useful for test isolation).
 */
function clearTimings() {
  timingsRingBuffer.length = 0;
}

/**
 * Computes summary percentiles and averages over recent requests.
 */
function getTimingSummary() {
  if (timingsRingBuffer.length === 0) {
    return {
      count: 0,
      avgTotalMs: 0,
      avgTtftMs: 0,
      avgRetrievalMs: 0,
      avgEmbeddingMs: 0,
      avgContextLoadMs: 0,
      avgScopeDecisionMs: 0,
      scopeDecisions: {}
    };
  }

  const count = timingsRingBuffer.length;
  const sum = (fn) => timingsRingBuffer.reduce((acc, t) => acc + fn(t), 0);
  const scopeDecisions = {};
  for (const t of timingsRingBuffer) {
    const key = t.scopeDecision || 'in_scope';
    scopeDecisions[key] = (scopeDecisions[key] || 0) + 1;
  }

  return {
    count,
    avgTotalMs: Math.round(sum(t => t.totalMs) / count),
    avgTtftMs: Math.round(sum(t => t.timeToFirstTokenMs) / count),
    avgRetrievalMs: Math.round(sum(t => t.retrievalMs) / count),
    avgEmbeddingMs: Math.round(sum(t => t.embeddingMs) / count),
    avgContextLoadMs: Math.round(sum(t => t.contextLoadMs) / count),
    avgScopeDecisionMs: Math.round((sum(t => t.scopeDecisionMs || 0) / count) * 100) / 100,
    scopeDecisions
  };
}

module.exports = {
  MAX_TIMINGS,
  logTiming,
  logScopeDecision,
  getRecentTimings,
  clearTimings,
  getTimingSummary
};
