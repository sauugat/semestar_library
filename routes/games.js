const express = require('express');
const { createInvitation, getInvitation } = require('../lib/games-invitations');

/**
 * Express router for Games Invitation endpoints.
 */
module.exports = function createGamesRouter(db, requireLogin) {
  const router = express.Router();

  /**
   * POST /api/games/invitations
   * Authenticated creation of game invitations with rate limiting and push dispatch.
   */
  router.post('/invitations', requireLogin, async (req, res) => {
    try {
      const senderStudentId = req.user?.studentId || req.student?.studentId;
      if (!senderStudentId) {
        return res.status(401).json({ message: 'Authentication required. Please sign in.' });
      }

      const { gameType, roomId, recipientStudentId } = req.body || {};
      const senderName = req.user?.name || req.student?.name || 'A classmate';

      const result = await createInvitation(db, {
        senderStudentId,
        senderName,
        recipientStudentId,
        gameType,
        roomId,
      });

      if (result.error) {
        return res.status(result.status || 400).json({ message: result.error });
      }

      return res.status(result.isDuplicate ? 200 : 201).json({
        invitation: result.invitation,
      });
    } catch (err) {
      console.error('[Games Invitation Error]:', err.message);
      return res.status(500).json({ message: 'Failed to create game invitation.' });
    }
  });

  /**
   * GET /api/games/invitations/:invitationId
   * Authenticated validation of game invitations for recipient prior to room auto-join.
   */
  router.get('/invitations/:invitationId', requireLogin, async (req, res) => {
    try {
      const studentId = req.user?.studentId || req.student?.studentId;
      if (!studentId) {
        return res.status(401).json({ message: 'Authentication required. Please sign in.' });
      }

      const { invitationId } = req.params;
      const result = await getInvitation(db, { invitationId, studentId });

      if (result.error) {
        return res.status(result.status || 404).json({
          message: result.error,
          ...(result.expired ? { expired: true } : {}),
        });
      }

      return res.json({ invitation: result.invitation });
    } catch (err) {
      console.error('[Games Invitation Validation Error]:', err.message);
      return res.status(500).json({ message: 'Failed to validate game invitation.' });
    }
  });

  return router;
};
