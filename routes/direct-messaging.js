'use strict';

const express = require('express');
const { DmError } = require('../lib/dm-service');
const { isDmAllowedForUser } = require('../lib/dm-config');

/**
 * Express Router for Universal One-to-One Private Messaging.
 * Mounted after application requireLogin middleware.
 */
module.exports = function directMessagingRouter(service) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers['authorization'] || '';
    const cronHeader = req.headers['x-cron-secret'] || '';
    const isCron = cronSecret && (
      authHeader === `Bearer ${cronSecret}` ||
      cronHeader === cronSecret
    );
    if (isCron && req.path === '/outbox/drain') {
      req.isInternalWorker = true;
      return next();
    }
    if (!req.student?.studentId) {
      return res.status(401).json({ message: 'Authentication required.' });
    }
    if (!isDmAllowedForUser(req.student.studentId)) {
      return res.status(403).json({ message: 'Private messaging is currently restricted to authorized test accounts.' });
    }
    next();
  });

  const getCallerId = req => req.student.studentId;
  const getCallerUser = req => req.student || req.user || null;

  const asyncRoute = fn => async (req, res, next) => {
    try {
      const result = await fn(req, res);
      if (req.method === 'GET' && (req.path === '/conversations' || /^\/conversations\/[^/]+\/(messages|sync)$/.test(req.path))) {
        service.scheduleDelivery?.();
      }
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
      callerUser: getCallerUser(req),
    });
  }));

  // 2. Start or Get Conversation
  router.post('/conversations', asyncRoute(async (req, res) => {
    const targetUserId = req.body?.targetUserId;
    if (!targetUserId || typeof targetUserId !== 'string') {
      throw new DmError(400, 'targetUserId is required.');
    }
    const result = await service.getOrCreateConversation(getCallerId(req), targetUserId.trim(), {
      callerUser: getCallerUser(req),
    });
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
      callerUser: getCallerUser(req),
    });
  }));

  // 4. Fetch Message History
  router.get('/conversations/:id/messages', asyncRoute(async req => {
    return service.getMessages(getCallerId(req), req.params.id, {
      before: req.query.before,
      since: req.query.since || req.query.after,
      limit: req.query.limit,
      callerUser: getCallerUser(req),
    });
  }));

  // 5. Send Message
  router.post('/conversations/:id/messages', asyncRoute(async (req, res) => {
    const { clientId, text, replyToId } = req.body || {};
    const result = await service.sendMessage(getCallerId(req), req.params.id, {
      clientId,
      text,
      replyToId,
      callerUser: getCallerUser(req),
    });
    if (!result.duplicate) {
      res.status(201);
    }
    return result;
  }));

  // 6. Edit Message
  router.patch('/conversations/:id/messages/:messageId', asyncRoute(async req => {
    const { text } = req.body || {};
    return service.editMessage(getCallerId(req), req.params.id, req.params.messageId, {
      text,
      callerUser: getCallerUser(req),
    });
  }));

  // 7. Delete Message
  router.delete('/conversations/:id/messages/:messageId', asyncRoute(async req => {
    const mode = req.query.mode || req.body?.mode || 'for_me';
    return service.deleteMessage(getCallerId(req), req.params.id, req.params.messageId, {
      mode,
      callerUser: getCallerUser(req),
    });
  }));

  // 8. Clear Conversation
  router.post('/conversations/:id/clear', asyncRoute(async req => {
    return service.clearConversation(getCallerId(req), req.params.id, {
      callerUser: getCallerUser(req),
    });
  }));

  // 9. Mark Messages Read
  router.post('/conversations/:id/read', asyncRoute(async req => {
    const lastReadMessageId = req.body?.lastReadMessageId;
    return service.markRead(getCallerId(req), req.params.id, {
      lastReadMessageId,
      callerUser: getCallerUser(req),
    });
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

  // 13. Scoped Realtime Credentials
  router.get('/conversations/:id/realtime-config', asyncRoute(async req => {
    return service.getRealtimeConfig(getCallerId(req), req.params.id, {
      callerUser: getCallerUser(req),
    });
  }));

  // 14. Ephemeral Typing Indicator
  router.post('/conversations/:id/typing', asyncRoute(async req => {
    const isTyping = req.body?.isTyping !== false;
    return service.sendTyping(getCallerId(req), req.params.id, {
      isTyping,
      callerUser: getCallerUser(req),
    });
  }));

  // 15. Reconnection & Multi-Device Sync
  router.get('/conversations/:id/sync', asyncRoute(async req => {
    return service.syncConversation(getCallerId(req), req.params.id, {
      sinceMessageId: req.query.sinceMessageId,
      sinceTimestamp: req.query.sinceTimestamp,
      callerUser: getCallerUser(req),
    });
  }));

  // 16. Outbox Drain Trigger (Background Worker / Maintenance Only)
  // Strictly restricted to authenticated internal workers using CRON_SECRET.
  router.post('/outbox/drain', asyncRoute(async (req, res) => {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers['authorization'] || '';
    const cronHeader = req.headers['x-cron-secret'] || '';
    const isCron = cronSecret && (
      authHeader === `Bearer ${cronSecret}` ||
      cronHeader === cronSecret
    );

    if (!isCron) {
      return res.status(403).json({ message: 'Forbidden: internal worker authorization required.' });
    }

    return service.drain();
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
    const msg = status === 500 ? 'Direct messaging request failed.' : err.message;
    res.status(status).json({
      message: msg,
      error: msg,
      ...(err instanceof DmError && err.code ? { code: err.code } : {}),
    });
  });

  return router;
};
