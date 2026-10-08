'use strict';

const express = require('express');
const { DmError } = require('../lib/dm-service');

/**
 * Express Router for Universal One-to-One Private Messaging.
 * Mounted after application requireLogin middleware.
 */
module.exports = function directMessagingRouter(service) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (!req.student?.studentId) {
      return res.status(401).json({ message: 'Authentication required.' });
    }
    next();
  });

  const getCallerId = req => req.student.studentId;

  const asyncRoute = fn => async (req, res, next) => {
    try {
      const result = await fn(req, res);
      if (!res.headersSent) {
        res.json(result);
      }
    } catch (err) {
      next(err);
    }
  };

  // 1. User Directory Search
  router.get('/users/search', asyncRoute(async req => {
    return service.searchUsers(getCallerId(req), {
      q: req.query.q,
      limit: req.query.limit,
      offset: req.query.offset,
    });
  }));

  // 2. Start or Get Conversation
  router.post('/conversations', asyncRoute(async (req, res) => {
    const targetUserId = req.body?.targetUserId;
    if (!targetUserId || typeof targetUserId !== 'string') {
      throw new DmError(400, 'targetUserId is required.');
    }
    const result = await service.getOrCreateConversation(getCallerId(req), targetUserId.trim());
    if (result.isNew) {
      res.status(201);
    }
    return result;
  }));

  // 3. List Conversations
  router.get('/conversations', asyncRoute(async req => {
    return service.listConversations(getCallerId(req), {
      limit: req.query.limit,
      offset: req.query.offset,
    });
  }));

  // 4. Fetch Message History
  router.get('/conversations/:id/messages', asyncRoute(async req => {
    return service.getMessages(getCallerId(req), req.params.id, {
      before: req.query.before,
      since: req.query.since || req.query.after,
      limit: req.query.limit,
    });
  }));

  // 5. Send Message
  router.post('/conversations/:id/messages', asyncRoute(async (req, res) => {
    const { clientId, text, replyToId } = req.body || {};
    const result = await service.sendMessage(getCallerId(req), req.params.id, {
      clientId,
      text,
      replyToId,
    });
    if (!result.duplicate) {
      res.status(201);
    }
    return result;
  }));

  // 6. Edit Message
  router.patch('/conversations/:id/messages/:messageId', asyncRoute(async req => {
    const { text } = req.body || {};
    return service.editMessage(getCallerId(req), req.params.id, req.params.messageId, { text });
  }));

  // 7. Delete Message
  router.delete('/conversations/:id/messages/:messageId', asyncRoute(async req => {
    const mode = req.query.mode || req.body?.mode || 'for_me';
    return service.deleteMessage(getCallerId(req), req.params.id, req.params.messageId, { mode });
  }));

  // 8. Clear Conversation
  router.post('/conversations/:id/clear', asyncRoute(async req => {
    return service.clearConversation(getCallerId(req), req.params.id);
  }));

  // 9. Mark Messages Read
  router.post('/conversations/:id/read', asyncRoute(async req => {
    const lastReadMessageId = req.body?.lastReadMessageId;
    return service.markRead(getCallerId(req), req.params.id, { lastReadMessageId });
  }));

  // 10. Block User
  router.post('/users/:userId/block', asyncRoute(async req => {
    return service.blockUser(getCallerId(req), req.params.userId);
  }));

  // 11. Unblock User
  router.delete('/users/:userId/block', asyncRoute(async req => {
    return service.unblockUser(getCallerId(req), req.params.userId);
  }));

  // 12. Report Message
  router.post('/reports', asyncRoute(async (req, res) => {
    const { conversationId, reportedUserId, reportedMessageId, reason, description } = req.body || {};
    if (!conversationId || !reportedUserId || !reason) {
      throw new DmError(400, 'conversationId, reportedUserId, and reason are required.');
    }
    const result = await service.reportMessage(getCallerId(req), {
      conversationId,
      reportedUserId,
      reportedMessageId,
      reason,
      description,
    });
    res.status(201);
    return result;
  }));

  // 404 handler for unmatched routes
  router.use((_req, res) => {
    res.status(404).json({ message: 'Resource not found.' });
  });

  // Centralized Error Handler
  router.use((err, _req, res, _next) => {
    const status = err instanceof DmError ? err.status : 500;
    if (status === 500) {
      console.error('[DM ROUTE ERROR]:', err);
    }
    res.status(status).json({
      message: status === 500 ? 'Direct messaging request failed.' : err.message,
    });
  });

  return router;
};
