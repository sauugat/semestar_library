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
  getPilotReport
} = require('../lib/kyana-pilot-telemetry');

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

  return router;
}

module.exports = {
  createKyanaPilotTelemetryRouter
};
