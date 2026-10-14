'use strict';

/**
 * KYANA AI 3.0 — Per-Request Timing Logger
 *
 * Tracks latency breakdown across:
 *   - Context load (ms)
 *   - Query embedding (ms)
 *   - Knowledge retrieval (ms)
 *   - Time to first token (TTFT, ms)
 *   - Total request time (ms)
 *
 * SECURITY & PRIVACY:
 *   - NO prompt/content stored
 *   - NO user queries or PII stored
 *   - NO secrets, auth tokens, or keys stored
 *   - Only timestamps, numeric durations (ms), and record counts
 *
 * Maintains an in-memory ring buffer of the last 50 requests.
 */

const MAX_TIMINGS = 50;
const timingsRingBuffer = [];

/**
 * Logs a single request timing entry.
 *
 * @param {object} entry
 * @param {number} entry.contextLoadMs
 * @param {number} entry.embeddingMs
 * @param {number} entry.retrievalMs
 * @param {number} entry.timeToFirstTokenMs
 * @param {number} entry.totalMs
 * @param {number} [entry.retrievedCount=0]
 * @param {number} [entry.cardsCount=0]
 * @param {boolean} [entry.fallback=false]
 */
function logTiming(entry = {}) {
  const record = {
    id: `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    contextLoadMs: Math.max(0, Math.round(entry.contextLoadMs || 0)),
    embeddingMs: Math.max(0, Math.round(entry.embeddingMs || 0)),
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

  return record;
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
      avgContextLoadMs: 0
    };
  }

  const count = timingsRingBuffer.length;
  const sum = (fn) => timingsRingBuffer.reduce((acc, t) => acc + fn(t), 0);

  return {
    count,
    avgTotalMs: Math.round(sum(t => t.totalMs) / count),
    avgTtftMs: Math.round(sum(t => t.timeToFirstTokenMs) / count),
    avgRetrievalMs: Math.round(sum(t => t.retrievalMs) / count),
    avgEmbeddingMs: Math.round(sum(t => t.embeddingMs) / count),
    avgContextLoadMs: Math.round(sum(t => t.contextLoadMs) / count)
  };
}

module.exports = {
  MAX_TIMINGS,
  logTiming,
  getRecentTimings,
  clearTimings,
  getTimingSummary
};
