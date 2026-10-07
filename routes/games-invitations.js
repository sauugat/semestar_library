'use strict';

const express = require('express');
const gamesInvitations = require('../lib/games-invitations');

module.exports = function createGamesInvitationsRouter(db, requireLogin, options = {}) {
  const router = express.Router();
  const pushNotifications = options.pushNotifications || require('../lib/push-notifications');

  // Search rate limit map: 30 requests/minute/user
  const searchRateLimitMap = new Map();
  function checkSearchRateLimit(userId, maxPerMin = 30) {
    const now = Date.now();
    const windowMs = 60 * 1000;
    let timestamps = searchRateLimitMap.get(userId) || [];
    timestamps = timestamps.filter(t => now - t < windowMs);
    if (timestamps.length >= maxPerMin) {
      searchRateLimitMap.set(userId, timestamps);
      return false;
    }
    timestamps.push(now);
    searchRateLimitMap.set(userId, timestamps);
    return true;
  }

  router.clearSearchRateLimits = () => {
    searchRateLimitMap.clear();
  };

  /**
   * GET /api/games/ludo/users/search?q=...
   * Searches Semester Library students safely for the lobby invite picker.
   */
  router.get('/users/search', requireLogin, async (req, res) => {
    try {
      const currentUserId = req.user?.studentId || req.session?.studentId;
      if (currentUserId && !checkSearchRateLimit(currentUserId)) {
        return res.status(429).json({
          error: 'RATE_LIMITED',
          message: "You're sending searches too quickly. Please wait a moment.",
        });
      }

      const query = req.query.q || '';

      const results = await gamesInvitations.searchUsers(db, {
        query: String(query),
        currentUserId,
        limit: 20,
      });

      return res.json({ users: results });
    } catch (err) {
      console.error('[Games Invitations User Search Error]:', err.message);
      return res.status(500).json({ message: 'Failed to search users.' });
    }
  });

  /**
   * POST /api/games/ludo/invitations
   * Creates an invitation to a private Ludo room.
   */
  router.post('/invitations', requireLogin, async (req, res) => {
    try {
      const { roomId, inviteeUserId } = req.body || {};
      const inviterUser = req.user;

      if (!roomId || typeof roomId !== 'string') {
        return res.status(400).json({ error: 'INVALID_ROOM_CODE', message: 'Room code is required.' });
      }
      if (!inviteeUserId || typeof inviteeUserId !== 'string') {
        return res.status(400).json({ error: 'RECIPIENT_REQUIRED', message: 'Recipient user ID is required.' });
      }

      const result = await gamesInvitations.createInvitation(db, {
        roomId,
        inviterUser,
        inviteeUserId,
        gamesServiceUrl: options.gamesServiceUrl,
        customTicketSecret: options.customTicketSecret,
        pushNotifications,
        fetchFn: options.fetchFn,
      });

      return res.status(result.deduplicated ? 200 : 201).json(result);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error('[Games Invitations Create Error]:', err.message);
      }
      return res.status(status).json({
        error: err.code || 'INVITATION_CREATION_FAILED',
        message: err.message,
      });
    }
  });

  /**
   * GET /api/games/ludo/invitations/:id
   * Retrieves invitation details for the recipient or inviter.
   */
  router.get('/invitations/:id', requireLogin, async (req, res) => {
    try {
      const invitationId = req.params.id;
      if (!gamesInvitations.isValidInvitationId(invitationId)) {
        return res.status(400).json({ error: 'INVALID_INVITATION_ID', message: 'Invitation ID must be a valid UUID.' });
      }

      const currentUserId = req.user?.studentId || req.session?.studentId;

      const invitation = await gamesInvitations.getInvitationById(db, invitationId, currentUserId);
      if (!invitation) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Invitation not found.' });
      }

      return res.json({ invitation });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        error: err.code || 'FETCH_FAILED',
        message: err.message,
      });
    }
  });

  /**
   * POST /api/games/ludo/invitations/:id/accept
   * Accepts the invitation after re-validating the room state.
   */
  router.post('/invitations/:id/accept', requireLogin, async (req, res) => {
    try {
      const invitationId = req.params.id;
      if (!gamesInvitations.isValidInvitationId(invitationId)) {
        return res.status(400).json({ error: 'INVALID_INVITATION_ID', message: 'Invitation ID must be a valid UUID.' });
      }

      const currentUser = req.user;

      const result = await gamesInvitations.acceptInvitation(db, invitationId, currentUser, {
        gamesServiceUrl: options.gamesServiceUrl,
        customTicketSecret: options.customTicketSecret,
        fetchFn: options.fetchFn,
      });

      return res.json(result);
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        error: err.code || 'ACCEPT_FAILED',
        message: err.message,
      });
    }
  });

  /**
   * POST /api/games/ludo/invitations/:id/decline
   * Declines the invitation.
   */
  router.post('/invitations/:id/decline', requireLogin, async (req, res) => {
    try {
      const invitationId = req.params.id;
      if (!gamesInvitations.isValidInvitationId(invitationId)) {
        return res.status(400).json({ error: 'INVALID_INVITATION_ID', message: 'Invitation ID must be a valid UUID.' });
      }

      const currentUser = req.user;

      const result = await gamesInvitations.declineInvitation(db, invitationId, currentUser);
      return res.json(result);
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        error: err.code || 'DECLINE_FAILED',
        message: err.message,
      });
    }
  });

  return router;
};
