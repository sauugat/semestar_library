'use strict';

const express = require('express');
const notifService = require('../lib/notifications-service');

module.exports = function createNotificationsRouter(db, requireLogin) {
  const router = express.Router();

  const getStudentId = (req) => req.user?.studentId || req.session?.studentId;

  /**
   * GET /api/notifications/unread-count
   * Returns unseen badge count (notifications user has not opened/seen yet)
   */
  router.get('/unread-count', requireLogin, async (req, res) => {
    try {
      const studentId = getStudentId(req);
      if (!studentId) return res.status(401).json({ message: 'Authentication required' });

      const count = await notifService.getUnseenCount(db, studentId);
      res.json({ count });
    } catch (err) {
      console.error('[Notifications API unread-count Error]:', err.message);
      res.status(500).json({ message: 'Failed to retrieve notification count.' });
    }
  });

  /**
   * GET /api/notifications
   * Paginated notification inbox with tab filtering ('all', 'unread', 'mentions')
   */
  router.get('/', requireLogin, async (req, res) => {
    try {
      const studentId = getStudentId(req);
      if (!studentId) return res.status(401).json({ message: 'Authentication required' });

      const tab = req.query.tab || 'all';
      const limit = parseInt(req.query.limit, 10) || 20;
      const cursor = req.query.cursor || null;

      const [result, unseenCount] = await Promise.all([
        notifService.getNotifications(db, { userId: studentId, tab, limit, cursor }),
        notifService.getUnseenCount(db, studentId),
      ]);

      res.setHeader('Cache-Control', 'no-store');
      res.json({
        notifications: result.items,
        items: result.items,
        nextCursor: result.nextCursor,
        unseenCount,
        tab,
      });
    } catch (err) {
      console.error('[Notifications API Inbox Error]:', err.message);
      res.status(500).json({ message: 'Failed to load notifications.' });
    }
  });

  /**
   * POST /api/notifications/seen
   * PATCH /api/notifications/seen
   * PATCH /api/notifications/:id/seen
   * Marks unseen notifications as seen when user opens Notification Center
   */
  const handleMarkSeen = async (req, res) => {
    try {
      const studentId = getStudentId(req);
      if (!studentId) return res.status(401).json({ message: 'Authentication required' });

      const result = await notifService.markAllSeen(db, studentId);
      res.json({ success: true, count: result.count, seen_at: new Date().toISOString() });
    } catch (err) {
      console.error('[Notifications API Seen Error]:', err.message);
      res.status(500).json({ message: 'Failed to mark notifications seen.' });
    }
  };
  router.post('/seen', requireLogin, handleMarkSeen);
  router.patch('/seen', requireLogin, handleMarkSeen);
  router.patch('/:id/seen', requireLogin, handleMarkSeen);

  /**
   * POST /api/notifications/:id/read
   * PATCH /api/notifications/:id/read
   * Marks a specific notification as read
   */
  const handleMarkRead = async (req, res) => {
    try {
      const studentId = getStudentId(req);
      if (!studentId) return res.status(401).json({ message: 'Authentication required' });

      const notificationId = req.params.id;
      const result = await notifService.markRead(db, studentId, notificationId);

      if (result.success) {
        res.json({ success: true, read_at: new Date().toISOString() });
      } else {
        res.status(404).json({ message: 'Notification not found' });
      }
    } catch (err) {
      console.error('[Notifications API Read Error]:', err.message);
      res.status(500).json({ message: 'Failed to mark notification as read.' });
    }
  };
  router.post('/:id/read', requireLogin, handleMarkRead);
  router.patch('/:id/read', requireLogin, handleMarkRead);

  /**
   * POST /api/notifications/:id/unread
   * PATCH /api/notifications/:id/unread
   * Marks a specific notification as unread
   */
  const handleMarkUnread = async (req, res) => {
    try {
      const studentId = getStudentId(req);
      if (!studentId) return res.status(401).json({ message: 'Authentication required' });

      const notificationId = req.params.id;
      const result = await notifService.markUnread(db, studentId, notificationId);

      if (result.success) {
        res.json({ success: true, read_at: null });
      } else {
        res.status(404).json({ message: 'Notification not found' });
      }
    } catch (err) {
      console.error('[Notifications API Unread Error]:', err.message);
      res.status(500).json({ message: 'Failed to mark notification as unread.' });
    }
  };
  router.post('/:id/unread', requireLogin, handleMarkUnread);
  router.patch('/:id/unread', requireLogin, handleMarkUnread);

  /**
   * POST /api/notifications/read-all
   * PATCH /api/notifications/read-all
   * Marks all notifications as read for current user
   */
  const handleReadAll = async (req, res) => {
    try {
      const studentId = getStudentId(req);
      if (!studentId) return res.status(401).json({ message: 'Authentication required' });

      const result = await notifService.markAllRead(db, studentId);
      res.json({ success: true, count: result.count });
    } catch (err) {
      console.error('[Notifications API Read-All Error]:', err.message);
      res.status(500).json({ message: 'Failed to mark all notifications as read.' });
    }
  };
  router.post('/read-all', requireLogin, handleReadAll);
  router.patch('/read-all', requireLogin, handleReadAll);

  /**
   * POST /api/notifications/:id/hide
   * PATCH /api/notifications/:id/hide
   * DELETE /api/notifications/:id
   * Hides a notification from user's inbox
   */
  const handleHide = async (req, res, next) => {
    if (req.params.id === 'device-token') return next();
    try {
      const studentId = getStudentId(req);
      if (!studentId) return res.status(401).json({ message: 'Authentication required' });

      const notificationId = req.params.id;
      const result = await notifService.hideNotification(db, studentId, notificationId);

      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ message: 'Notification not found' });
      }
    } catch (err) {
      console.error('[Notifications API Hide Error]:', err.message);
      res.status(500).json({ message: 'Failed to hide notification.' });
    }
  };
  router.post('/:id/hide', requireLogin, handleHide);
  router.patch('/:id/hide', requireLogin, handleHide);
  router.delete('/:id', requireLogin, handleHide);

  /**
   * GET /api/notifications/preferences
   */
  router.get('/preferences', requireLogin, async (req, res) => {
    try {
      const studentId = getStudentId(req);
      if (!studentId) return res.status(401).json({ message: 'Authentication required' });

      const preferences = await notifService.getAdvancedPreferences(db, studentId);
      res.json({ success: true, preferences });
    } catch (err) {
      console.error('[Notifications API Preferences Error]:', err.message);
      res.status(500).json({ message: 'Failed to retrieve notification preferences.' });
    }
  });

  /**
   * PUT /api/notifications/preferences
   * PATCH /api/notifications/preferences
   */
  const handleUpdatePreferences = async (req, res) => {
    try {
      const studentId = getStudentId(req);
      if (!studentId) return res.status(401).json({ message: 'Authentication required' });

      const preferences = await notifService.updateAdvancedPreferences(db, studentId, req.body || {});
      res.json({ success: true, preferences });
    } catch (err) {
      console.error('[Notifications API Preferences Update Error]:', err.message);
      res.status(500).json({ message: 'Failed to update notification preferences.' });
    }
  };
  router.put('/preferences', requireLogin, handleUpdatePreferences);
  router.patch('/preferences', requireLogin, handleUpdatePreferences);

  /**
   * POST /api/notifications/device-token
   */
  router.post('/device-token', requireLogin, async (req, res) => {
    try {
      const studentId = getStudentId(req);
      const pushNotifications = require('../lib/push-notifications');
      const { expoPushToken, platform, deviceName } = req.body || {};

      if (!expoPushToken || typeof expoPushToken !== 'string') {
        return res.status(400).json({ message: 'expoPushToken string is required.' });
      }
      if (!pushNotifications.isValidExpoPushToken(expoPushToken)) {
        return res.status(400).json({ message: 'Invalid Expo push token format.' });
      }

      await pushNotifications.registerDeviceToken(db, {
        studentId,
        expoPushToken,
        platform,
        deviceName,
      });

      return res.json({ success: true, message: 'Device token registered successfully.' });
    } catch (err) {
      console.error('[Device Token Register Error]:', err.message);
      return res.status(500).json({ message: 'Failed to register device token.' });
    }
  });

  /**
   * DELETE /api/notifications/device-token
   */
  router.delete('/device-token', requireLogin, async (req, res) => {
    try {
      const studentId = getStudentId(req);
      const pushNotifications = require('../lib/push-notifications');
      const expoPushToken = req.body?.expoPushToken || req.query?.token;

      if (!expoPushToken || typeof expoPushToken !== 'string') {
        return res.status(400).json({ message: 'expoPushToken is required.' });
      }

      const result = await pushNotifications.unregisterDeviceToken(db, {
        studentId,
        expoPushToken,
      });

      return res.json({ success: true, changes: result.changes, message: 'Device token unregistered successfully.' });
    } catch (err) {
      console.error('[Device Token Unregister Error]:', err.message);
      return res.status(500).json({ message: 'Failed to unregister device token.' });
    }
  });

  const activeSseConnections = new Map(); // studentId -> Set of res objects
  const MAX_SSE_PER_STUDENT = 6;

  /**
   * GET /api/notifications/realtime & /api/notifications/stream
   * Server-Sent Events stream for instant notification alerts & badge updates
   */
  const handleNotificationStream = (req, res) => {
    const studentId = getStudentId(req);
    if (!studentId) return res.status(401).end();

    let currentConns = activeSseConnections.get(studentId);
    if (!currentConns) {
      currentConns = new Set();
      activeSseConnections.set(studentId, currentConns);
    }
    if (currentConns.size >= MAX_SSE_PER_STUDENT) {
      const oldest = currentConns.values().next().value;
      if (oldest) {
        try { oldest.end(); } catch (_) {}
        currentConns.delete(oldest);
      }
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    currentConns.add(res);

    // Send initial connected ping
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    const unsubscribe = notifService.subscribeToUserNotifications(studentId, (event) => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch (_) {}
    });

    const keepAliveTimer = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch (_) {}
    }, 25000);

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearInterval(keepAliveTimer);
      unsubscribe();
      const conns = activeSseConnections.get(studentId);
      if (conns) {
        conns.delete(res);
        if (conns.size === 0) activeSseConnections.delete(studentId);
      }
    };

    req.on('close', cleanup);
    req.on('end', cleanup);
    res.on('finish', cleanup);
  };

  router.get('/realtime', requireLogin, handleNotificationStream);
  router.get('/stream', requireLogin, handleNotificationStream);

  return router;
};
