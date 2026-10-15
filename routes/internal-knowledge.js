'use strict';

const express = require('express');
const router = express.Router();
const { isKnowledgeIndexingEnabled } = require('../lib/knowledge-schema');
const { processPendingJobs, reconcileKnowledge, secureCompare } = require('../lib/knowledge-worker');

/**
 * Middleware: Verify cron secret.
 * Compares against INTERNAL_CRON_SECRET or CRON_SECRET using constant-time comparison.
 */
function requireCronSecret(req, res, next) {
  const secret = process.env.INTERNAL_CRON_SECRET || process.env.CRON_SECRET;
  if (!secret) {
    return res.status(503).json({ message: 'Internal cron secret not configured.' });
  }

  const incomingSecret = req.headers['x-cron-secret'] ||
    (req.headers.authorization && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);

  if (!incomingSecret || !secureCompare(incomingSecret, secret)) {
    return res.status(403).json({ message: 'Forbidden: Invalid or missing cron secret.' });
  }

  next();
}

/**
 * POST & GET /api/internal/knowledge/worker
 * Periodic worker: drains pending retry queue rows.
 * Supports GET for Vercel Cron invocation and POST for manual / CI invocation.
 */
const handleWorker = async (req, res) => {
  if (!isKnowledgeIndexingEnabled()) {
    return res.json({ status: 'skipped', message: 'KYANA_KNOWLEDGE_V3 feature flag is disabled.' });
  }

  const db = req.app.locals.db || require('../db');
  if (!db) {
    return res.status(500).json({ message: 'Database handle unavailable.' });
  }

  try {
    const jobStats = await processPendingJobs(db, { batchSize: 25 });
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      jobs: jobStats
    });
  } catch (err) {
    console.error('[KYANA Knowledge Worker Endpoint Error]:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

router.post('/worker', requireCronSecret, handleWorker);
router.get('/worker', requireCronSecret, handleWorker);

/**
 * POST & GET /api/internal/knowledge/reconcile
 * Bounded drift reconciliation: scans for orphaned/missing records.
 * Supports GET for Vercel Cron and POST for manual / CI invocation.
 */
const handleReconcile = async (req, res) => {
  if (!isKnowledgeIndexingEnabled()) {
    return res.json({ status: 'skipped', message: 'KYANA_KNOWLEDGE_V3 feature flag is disabled.' });
  }

  const db = req.app.locals.db || require('../db');
  if (!db) {
    return res.status(500).json({ message: 'Database handle unavailable.' });
  }

  try {
    const reconStats = await reconcileKnowledge(db);
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      reconciliation: reconStats
    });
  } catch (err) {
    console.error('[KYANA Knowledge Reconcile Endpoint Error]:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

router.post('/reconcile', requireCronSecret, handleReconcile);
router.get('/reconcile', requireCronSecret, handleReconcile);

/**
 * POST & GET /api/internal/knowledge/sync-university
 * Controlled synchronization of approved public Gandaki University notices and updates.
 * Preserves canonical university URLs, publication timestamps, and Tier 1 institutional authority.
 */
const handleSyncUniversity = async (req, res) => {
  if (!isKnowledgeIndexingEnabled()) {
    return res.json({ status: 'skipped', message: 'KYANA_KNOWLEDGE_V3 feature flag is disabled.' });
  }

  const db = req.app.locals.db || require('../db');
  if (!db) {
    return res.status(500).json({ message: 'Database handle unavailable.' });
  }

  try {
    const { syncGandakiUniversityNotices } = require('../lib/university-sync');
    const syncStats = await syncGandakiUniversityNotices(db);
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      sync: syncStats
    });
  } catch (err) {
    console.error('[KYANA University Sync Endpoint Error]:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

router.post('/sync-university', requireCronSecret, handleSyncUniversity);
router.get('/sync-university', requireCronSecret, handleSyncUniversity);

/**
 * GET /api/internal/knowledge/timings
 * Health-style check returning the last 50 request timings and aggregate performance metrics.
 * Safe: Contains zero PII, zero query text, zero secrets.
 */
router.get('/timings', requireCronSecret, async (req, res) => {
  const { getRecentTimings, getTimingSummary } = require('../lib/knowledge-timing');
  const limit = parseInt(req.query.limit, 10) || 50;
  res.json({
    success: true,
    featureFlagEnabled: isKnowledgeIndexingEnabled(),
    summary: getTimingSummary(),
    timings: getRecentTimings(limit)
  });
});

module.exports = router;
