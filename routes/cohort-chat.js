'use strict';
const express = require('express');
const multer = require('multer');
const { createHash } = require('node:crypto');
const { ChatError } = require('../lib/cohort-chat');

// Mount after the application's requireLogin; no caller-controlled identity.
module.exports = function cohortChatRouter(service) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 12 } });
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (!req.student?.studentId) return res.status(401).json({ message: 'Authentication required.' });
    next();
  });
  const input = req => {
    // Reject contradictory query/body scope instead of silently overriding it.
    for (const key of ['chatGroupId','chat_group_id','group','groupCode']) {
      if (req.query[key] !== undefined && req.body?.[key] !== undefined && req.query[key] !== req.body[key]) throw new ChatError();
    }
    return { ...req.query, ...req.body };
  };
  const route = fn => async (req, res, next) => {
    try { const result = await fn(req, res); if (!res.headersSent) res.json(result); } catch (error) { next(error); }
  };
  const id = req => req.student.studentId;
  router.get('/config', route(req => service.getAuthenticatedChatContext(id(req), input(req))));
  router.get('/realtime-config', route(req => service.realtimeConfig(id(req), input(req))));
  router.get(['/messages','/search'], route(req => service.history(id(req), input(req))));
  router.get('/groups/:chatGroupId/messages/:messageId', route(async req => {
    await service.getAuthenticatedChatContext(id(req), input(req));
    return service.exact(id(req), req.params.chatGroupId, req.params.messageId);
  }));
  router.get('/members', route(req => service.memberList(id(req), input(req))));
  router.get('/mentions/students', route(req => service.candidates(id(req), input(req))));
  router.post('/messages', upload.single('attachment'), route(req => service.send(id(req), input(req), req.file)));
  router.delete('/messages/:id', route(req => service.remove(id(req), input(req), req.params.id)));
  router.post('/reactions', route(req => service.reaction(id(req), input(req))));
  router.post('/read', route(req => service.read(id(req), input(req))));
  router.post('/typing', route(req => service.typing(id(req), input(req))));
  router.post('/heartbeat', route(req => {
    const authenticatedSession = req.sessionID || req.get('authorization');
    if (!authenticatedSession) throw new ChatError(401, 'Authenticated session required.');
    const sessionId = createHash('sha256').update(authenticatedSession).digest('hex');
    return service.heartbeat(id(req), input(req), sessionId);
  }));
  router.get('/pinned', route(req => service.pinned(id(req), input(req))));
  router.post('/pinned/:id', route(req => service.pin(id(req), input(req), req.params.id)));
  router.delete('/pinned', route(req => service.pin(id(req), input(req))));
  router.get('/attachment/:filename', route(async (req, res) => {
    const file = await service.attachment(id(req), input(req), req.params.filename);
    res.set('Content-Security-Policy', "sandbox; default-src 'none'");
    res.set('X-Content-Type-Options', 'nosniff');
    res.type(file.mimeType || 'application/octet-stream').send(file.buffer);
  }));
  router.get('/admin/rooms', route(async req => {
    await service.requireAdmin(id(req));
    return service.adminRooms(id(req));
  }));
  router.get('/admin/rooms/:chatGroupId/config', route(async req => {
    await service.requireAdmin(id(req));
    return service.adminRoomConfig(id(req), req.params.chatGroupId);
  }));
  router.post('/admin/cohorts', route(req => service.createCohort(id(req), req.body)));
  router.post('/admin/groups/:id/advance', route(req => service.advance(id(req), req.params.id, req.body.expectedVersion)));
  router.post('/admin/groups/:id/graduate', route(req => service.graduate(id(req), req.params.id)));
  router.post('/admin/groups/:id/rotate', route(req => service.rotate(id(req), req.params.id, req.body.revokeStudentId)));
  router.post('/admin/groups/:id/recycle', route(req => service.beginRecycle(id(req), req.params.id, req.body)));
  router.post('/admin/recycle/:id/finish', route(req => service.finishRecycle(id(req), req.params.id)));
  router.use((_req, res) => res.status(404).json({ message: 'This conversation is no longer available.' }));
  router.use((error, _req, res, _next) => {
    const status = error instanceof ChatError ? error.status : error instanceof multer.MulterError ? 400 : 500;
    if (status === 500) console.error('[COHORT-CHAT ROUTE ERROR]:', error);
    res.status(status).json({ message: status === 500 ? 'Chat request failed.' : error.message });
  });
  return router;
};
