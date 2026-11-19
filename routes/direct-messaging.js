'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { DmError } = require('../lib/dm-service');
const { isDmAllowedForUser } = require('../lib/dm-config');

const dmImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const m = String(file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (m.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new DmError(400, 'Only image files are supported in direct messages.'));
    }
  },
});

function optionalDmImageUpload(req, res, next) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (!ct.includes('multipart/form-data')) return next();
  dmImageUpload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'attachment', maxCount: 1 },
    { name: 'file', maxCount: 1 },
  ])(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        return next(new DmError(400, err.code === 'LIMIT_FILE_SIZE' ? 'Image must be under 15MB.' : err.message));
      }
      return next(err);
    }
    if (req.files) {
      req.file = (req.files.image && req.files.image[0])
        || (req.files.attachment && req.files.attachment[0])
        || (req.files.file && req.files.file[0])
        || undefined;
    }
    next();
  });
}

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
      q: req.query.q,
      callerUser: getCallerUser(req),
    });
  }));

  // 5. Send Message (supports JSON text or multipart/form-data with image attachment)
  router.post('/conversations/:id/messages', optionalDmImageUpload, asyncRoute(async (req, res) => {
    const { clientId, text, replyToId } = req.body || {};
    let attachmentName = null;
    let attachmentOriginalName = null;
    let attachmentMimeType = null;

    if (req.file && req.file.buffer) {
      const rawExt = path.extname(req.file.originalname || '').toLowerCase();
      const mime = String(req.file.mimetype || 'image/jpeg').toLowerCase();
      const ext = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(rawExt)
        ? rawExt
        : (mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : mime.includes('gif') ? '.gif' : '.jpg');
      attachmentName = `dm_${crypto.randomBytes(16).toString('hex')}${ext}`;
      attachmentOriginalName = String(req.file.originalname || `photo${ext}`).slice(0, 200);
      attachmentMimeType = mime.startsWith('image/') ? mime : 'image/jpeg';

      if (service.db && typeof service.db.saveFileBlob === 'function') {
        const saved = await service.db.saveFileBlob(attachmentName, req.file.buffer, attachmentMimeType);
        if (!saved) {
          throw new DmError(503, 'Could not store image attachment. Please try again.');
        }
      }
    }

    const parsedReplyToId = replyToId !== undefined && replyToId !== null && String(replyToId).trim() !== ''
      ? Number(replyToId)
      : undefined;

    const result = await service.sendMessage(getCallerId(req), req.params.id, {
      clientId,
      text,
      replyToId: Number.isFinite(parsedReplyToId) ? parsedReplyToId : undefined,
      attachmentName,
      attachmentOriginalName,
      attachmentMimeType,
      callerUser: getCallerUser(req),
    });
    if (!result.duplicate) {
      res.status(201);
    }
    return result;
  }));

  // 5b. Serve authorized DM image attachment
  router.get('/attachments/:filename', async (req, res, next) => {
    try {
      const info = await service.getAttachmentForCaller(getCallerId(req), req.params.filename, {
        callerUser: getCallerUser(req),
      });
      const blob = service.db && typeof service.db.getFileBlob === 'function'
        ? await service.db.getFileBlob(info.attachmentName)
        : null;
      if (!blob || !blob.fileData) {
        return res.status(404).json({ message: 'Attachment file not found.' });
      }
      res.setHeader('Content-Type', blob.mimeType || info.attachmentMimeType || 'image/jpeg');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.send(blob.fileData);
    } catch (err) {
      next(err);
    }
  });

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

  // 8b. Mute / Unmute Conversation
  router.post('/conversations/:id/mute', asyncRoute(async req => {
    const isMuted = req.body?.isMuted !== false;
    return service.setConversationMute(getCallerId(req), req.params.id, {
      isMuted,
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
