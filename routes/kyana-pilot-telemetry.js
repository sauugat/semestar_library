'use strict';

/**
 * Kyana Pilot Telemetry Routes (routes/kyana-pilot-telemetry.js)
 * 
 * Provides HTTP endpoints for collecting privacy-safe visualization lifecycle events,
 * playback control engagements, and student feedback during the controlled pilot.
 */

const express = require('express');
const {
  hashSession,
  recordTelemetryEvent,
  recordControlsInteraction,
  recordFeedback,
  getPilotReport,
  pruneTelemetryRecords
} = require('../lib/kyana-pilot-telemetry');

/**
 * Middleware to authenticate scheduled cron requests securely.
 * Authenticates via Authorization: Bearer <CRON_SECRET> or x-cron-secret: <CRON_SECRET>.
 * Fail-closed: Rejects requests if CRON_SECRET is unconfigured or mismatch occurs.
 * Never exposes the secret to clients or log files.
 */
function verifyCronAuth(req, res, next) {
  const secret = process.env.CRON_SECRET || process.env.INTERNAL_CRON_SECRET;
  if (!secret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: CRON_SECRET is not configured on server.' });
  }
  const authHeader = req.headers['authorization'];
  const cronHeader = req.headers['x-cron-secret'];
  if ((authHeader && authHeader === `Bearer ${secret}`) || (cronHeader && cronHeader === secret)) {
    return next();
  }
  return res.status(401).json({ ok: false, error: 'Unauthorized: Invalid or missing cron secret.' });
}

function createKyanaPilotTelemetryRouter(db) {
  const router = express.Router();

  /**
   * Helper to derive an anonymous session hash from the request.
   * Never stores or leaks studentId, username, or IP address.
   */
  function getRequestSessionHash(req) {
    const rawId = req.student?.studentId || req.user?.studentId || req.session?.studentId || req.sessionID || req.ip || 'anonymous';
    return hashSession(rawId);
  }

  /**
   * POST /api/kyana/telemetry/event
   * Record a visualizer lifecycle event (generated, validated, mounted, or failed).
   * Non-blocking, fails gracefully.
   */
  router.post('/event', async (req, res) => {
    try {
      const body = req.body || {};
      const sessionHash = getRequestSessionHash(req);

      // Strip any accidental PII from body
      delete body.prompt;
      delete body.text;
      delete body.message;
      delete body.content;
      delete body.studentId;
      delete body.email;
      delete body.token;

      const eventData = {
        ...body,
        sessionHash
      };

      const result = await recordTelemetryEvent(db, eventData);
      res.status(200).json(result);
    } catch (err) {
      console.error('[KyanaPilotRoute] Event recording failed:', err);
      // Always return 200 so telemetry failures never break student experience
      res.status(200).json({ ok: false, error: 'Telemetry recording failed' });
    }
  });

  /**
   * POST /api/kyana/telemetry/interaction
   * Record that a student interacted with playback controls (play, step, slider, logic toggle).
   */
  router.post('/interaction', async (req, res) => {
    try {
      const { instanceId } = req.body || {};
      if (!instanceId) {
        return res.status(200).json({ ok: false, message: 'Missing instanceId' });
      }

      const sessionHash = getRequestSessionHash(req);
      const result = await recordControlsInteraction(db, { instanceId, sessionHash });
      res.status(200).json(result);
    } catch (err) {
      console.error('[KyanaPilotRoute] Interaction recording failed:', err);
      res.status(200).json({ ok: false });
    }
  });

  /**
   * POST /api/kyana/telemetry/feedback
   * Record student feedback ('helpful' | 'unhelpful' + optional reason).
   * Strictly deduplicated per student per visualization instance.
   */
  router.post('/feedback', async (req, res) => {
    try {
      const { instanceId, rating, reason } = req.body || {};
      if (!instanceId || !rating) {
        return res.status(400).json({ ok: false, message: 'Missing instanceId or rating' });
      }

      const sessionHash = getRequestSessionHash(req);
      const result = await recordFeedback(db, {
        instanceId,
        sessionHash,
        rating,
        reason
      });

      if (!result.ok) {
        return res.status(400).json(result);
      }
      res.status(200).json(result);
    } catch (err) {
      console.error('[KyanaPilotRoute] Feedback recording failed:', err);
      res.status(500).json({ ok: false, message: 'Feedback recording failed' });
    }
  });

  /**
   * ALL /api/kyana/telemetry/internal/prune
   * Automated 90-day retention pruning endpoint.
   * Authenticated strictly via Bearer CRON_SECRET or x-cron-secret.
   * Safe, idempotent, zero PII returned.
   */
  router.all('/internal/prune', verifyCronAuth, async (req, res) => {
    try {
      const retentionDays = Math.max(1, Number(req.body?.retentionDays || req.query?.retentionDays || 90));
      const result = await pruneTelemetryRecords(db, { retentionDays });
      if (!result.ok) {
        return res.status(500).json({ ok: false, error: result.error || 'Pruning operation failed' });
      }
      console.log(`[KyanaPilotTelemetry] Automated ${retentionDays}-day retention pruning completed. Deleted telemetry: ${result.deletedTelemetry}, Deleted feedback: ${result.deletedFeedback}`);
      return res.status(200).json({
        ok: true,
        status: 'pruned',
        retentionDays,
        deletedTelemetry: result.deletedTelemetry,
        deletedFeedback: result.deletedFeedback,
        executedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error('[KyanaPilotTelemetry] Internal prune error:', err);
      return res.status(500).json({ ok: false, error: 'Internal pruning failure' });
    }
  });

  return router;
}

module.exports = {
  createKyanaPilotTelemetryRouter,
  verifyCronAuth
};
