'use strict';

const crypto = require('crypto');
const db = require('../db');

/**
 * Supported Notification Types
 */
const NOTIFICATION_TYPES = {
  POST_COMMENT: 'post_comment',
  COMMENT_REPLY: 'comment_reply',
  POST_REACTION: 'post_reaction',
  COMMENT_REACTION: 'comment_reaction',
  MENTION: 'mention',
  CHAT_MESSAGE: 'chat_message',
  OFFICIAL_NOTICE: 'official_notice',
  MATERIAL_UPLOADED: 'material_uploaded',
  ROUTINE_UPDATED: 'routine_updated',
  SYSTEM: 'system',
  SECURITY: 'security',
};

/**
 * Mapping notification types to top-level preference categories
 */
const TYPE_TO_CATEGORY = {
  [NOTIFICATION_TYPES.CHAT_MESSAGE]: 'messages',
  [NOTIFICATION_TYPES.MENTION]: 'messages',
  [NOTIFICATION_TYPES.POST_COMMENT]: 'activity',
  [NOTIFICATION_TYPES.COMMENT_REPLY]: 'activity',
  [NOTIFICATION_TYPES.POST_REACTION]: 'activity',
  [NOTIFICATION_TYPES.COMMENT_REACTION]: 'activity',
  [NOTIFICATION_TYPES.OFFICIAL_NOTICE]: 'academic',
  [NOTIFICATION_TYPES.MATERIAL_UPLOADED]: 'academic',
  [NOTIFICATION_TYPES.ROUTINE_UPDATED]: 'academic',
  [NOTIFICATION_TYPES.SYSTEM]: 'system',
  [NOTIFICATION_TYPES.SECURITY]: 'system',
};

/**
 * Default Priority by Type
 */
const DEFAULT_PRIORITY = {
  [NOTIFICATION_TYPES.POST_REACTION]: 'low',
  [NOTIFICATION_TYPES.COMMENT_REACTION]: 'low',
  [NOTIFICATION_TYPES.CHAT_MESSAGE]: 'normal',
  [NOTIFICATION_TYPES.POST_COMMENT]: 'normal',
  [NOTIFICATION_TYPES.COMMENT_REPLY]: 'normal',
  [NOTIFICATION_TYPES.MATERIAL_UPLOADED]: 'normal',
  [NOTIFICATION_TYPES.MENTION]: 'high',
  [NOTIFICATION_TYPES.OFFICIAL_NOTICE]: 'high',
  [NOTIFICATION_TYPES.ROUTINE_UPDATED]: 'high',
  [NOTIFICATION_TYPES.SYSTEM]: 'high',
  [NOTIFICATION_TYPES.SECURITY]: 'urgent',
};

/**
 * In-memory bus for local realtime subscribers (SSE / WebSocket)
 */
const notificationSubscribers = new Map(); // userId -> Set of callback functions

function subscribeToUserNotifications(userId, callback) {
  if (!userId || typeof callback !== 'function') return () => {};
  if (!notificationSubscribers.has(userId)) {
    notificationSubscribers.set(userId, new Set());
  }
  notificationSubscribers.get(userId).add(callback);
  return () => {
    const set = notificationSubscribers.get(userId);
    if (set) {
      set.delete(callback);
      if (set.size === 0) notificationSubscribers.delete(userId);
    }
  };
}

function broadcastToUser(userId, event) {
  const set = notificationSubscribers.get(userId);
  if (set) {
    set.forEach((cb) => {
      try {
        cb(event);
      } catch (err) {
        console.warn('[Notification Realtime Callback Error]:', err.message);
      }
    });
  }
}

/**
 * Ensures schema exists across PostgreSQL/Neon and SQLite.
 */
async function ensureNotificationCenterSchema(opts = {}) {
  const dbInstance = opts.db || db;
  const runExec = opts.exec || (dbInstance ? (sql) => dbInstance.exec(sql) : null);
  const isPg = opts.isPostgres !== undefined ? opts.isPostgres : (dbInstance && dbInstance.isPostgres);
  if (!runExec) return;

  const safeExec = async (sql) => {
    try {
      await runExec(sql);
    } catch (err) {
      // Ignore errors for already existing columns/tables
    }
  };

  if (isPg) {
    await safeExec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        actor_id TEXT REFERENCES students(studentId) ON DELETE SET NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        secondary_entity_id TEXT,
        deep_link TEXT NOT NULL,
        web_path TEXT NOT NULL,
        group_key TEXT,
        priority TEXT NOT NULL DEFAULT 'normal',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMPTZ
      );
    `);

    await safeExec(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'notifications' AND column_name = 'id' AND data_type IN ('integer', 'bigint', 'smallint')
        ) THEN
          ALTER TABLE notifications ALTER COLUMN id TYPE TEXT USING id::text;
          ALTER TABLE notifications ALTER COLUMN id DROP DEFAULT;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'notifications' AND column_name = 'recipientstudentid' AND is_nullable = 'NO'
        ) THEN
          ALTER TABLE notifications ALTER COLUMN recipientStudentId DROP NOT NULL;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'notifications' AND column_name = 'message' AND is_nullable = 'NO'
        ) THEN
          ALTER TABLE notifications ALTER COLUMN message DROP NOT NULL;
        END IF;
      END $$;
    `);

    for (const col of [
      'actor_id TEXT REFERENCES students(studentId) ON DELETE SET NULL',
      'title TEXT',
      'body TEXT',
      'entity_type TEXT',
      'entity_id TEXT',
      'secondary_entity_id TEXT',
      'deep_link TEXT',
      'web_path TEXT',
      'group_key TEXT',
      "priority TEXT DEFAULT 'normal'",
      "metadata JSONB DEFAULT '{}'::jsonb",
      'updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP',
      'expires_at TIMESTAMPTZ',
      'recipientStudentId TEXT REFERENCES students(studentId) ON DELETE CASCADE',
      'message TEXT',
      'isRead INTEGER DEFAULT 0',
      'relatedFileId INTEGER',
      'createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP',
    ]) {
      await safeExec(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ${col};`);
    }

    await safeExec(`
      CREATE TABLE IF NOT EXISTS notification_recipients (
        id TEXT PRIMARY KEY,
        notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
        seen_at TIMESTAMPTZ,
        read_at TIMESTAMPTZ,
        hidden_at TIMESTAMPTZ,
        push_sent_at TIMESTAMPTZ,
        push_status TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(notification_id, user_id)
      );
    `);

    await safeExec('CREATE INDEX IF NOT EXISTS idx_notifications_group_key ON notifications(group_key);');
    await safeExec('CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);');
    await safeExec('CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications(entity_type, entity_id);');
    await safeExec('CREATE INDEX IF NOT EXISTS idx_notif_recip_user_unseen ON notification_recipients(user_id, hidden_at, seen_at);');
    await safeExec('CREATE INDEX IF NOT EXISTS idx_notif_recip_user_unread ON notification_recipients(user_id, hidden_at, read_at);');
    await safeExec('CREATE INDEX IF NOT EXISTS idx_notif_recip_user_created ON notification_recipients(user_id, hidden_at, created_at DESC);');
    await safeExec('CREATE INDEX IF NOT EXISTS idx_notif_recip_notif_id ON notification_recipients(notification_id);');

    await safeExec(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'recipientstudentid') THEN
          INSERT INTO notification_recipients (
            id, notification_id, user_id, seen_at, read_at, hidden_at, created_at
          )
          SELECT
            'recip_legacy_' || n.id::text,
            n.id::text,
            n.recipientStudentId,
            CASE WHEN n.isRead = 1 THEN COALESCE(n.created_at, CURRENT_TIMESTAMP) ELSE NULL END,
            CASE WHEN n.isRead = 1 THEN COALESCE(n.created_at, CURRENT_TIMESTAMP) ELSE NULL END,
            NULL,
            COALESCE(n.created_at, CURRENT_TIMESTAMP)
          FROM notifications n
          WHERE n.recipientStudentId IS NOT NULL
            AND n.recipientStudentId IN (SELECT studentId FROM students)
          ON CONFLICT (notification_id, user_id) DO NOTHING;
        END IF;
      END $$;
    `);

    for (const [col, def] of [
      ['delivery_messages', "TEXT DEFAULT 'push_inbox'"],
      ['delivery_activity', "TEXT DEFAULT 'push_inbox'"],
      ['delivery_academic', "TEXT DEFAULT 'push_inbox'"],
      ['delivery_system', "TEXT DEFAULT 'push_inbox'"],
      ['quiet_hours_enabled', 'BOOLEAN DEFAULT false'],
      ['quiet_hours_start', "TEXT DEFAULT '22:30'"],
      ['quiet_hours_end', "TEXT DEFAULT '07:00'"],
      ['timezone', "TEXT DEFAULT 'Asia/Kathmandu'"],
    ]) {
      await safeExec(`ALTER TABLE student_notification_preferences ADD COLUMN IF NOT EXISTS ${col} ${def};`);
    }
  } else {
    // SQLite dialect
    await safeExec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        actor_id TEXT,
        title TEXT,
        body TEXT,
        entity_type TEXT,
        entity_id TEXT,
        secondary_entity_id TEXT,
        deep_link TEXT,
        web_path TEXT,
        group_key TEXT,
        priority TEXT DEFAULT 'normal',
        metadata TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME
      );
    `);

    // Ensure legacy tables get new columns in SQLite
    for (const [col, def] of [
      ['created_at', 'DATETIME'],
      ['updated_at', 'DATETIME'],
      ['actor_id', 'TEXT'],
      ['title', 'TEXT'],
      ['body', 'TEXT'],
      ['entity_type', 'TEXT'],
      ['entity_id', 'TEXT'],
      ['secondary_entity_id', 'TEXT'],
      ['deep_link', 'TEXT'],
      ['web_path', 'TEXT'],
      ['group_key', 'TEXT'],
      ['priority', "TEXT DEFAULT 'normal'"],
      ['metadata', "TEXT DEFAULT '{}'"],
      ['expires_at', 'DATETIME'],
    ]) {
      await safeExec(`ALTER TABLE notifications ADD COLUMN ${col} ${def};`);
    }

    await safeExec(`
      CREATE TABLE IF NOT EXISTS notification_recipients (
        id TEXT PRIMARY KEY,
        notification_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        seen_at DATETIME,
        read_at DATETIME,
        hidden_at DATETIME,
        push_sent_at DATETIME,
        push_status TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES students(studentId) ON DELETE CASCADE,
        UNIQUE(notification_id, user_id)
      );
    `);

    await safeExec('CREATE INDEX IF NOT EXISTS idx_notifications_group_key ON notifications(group_key);');
    await safeExec('CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);');
    await safeExec('CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications(entity_type, entity_id);');
    await safeExec('CREATE INDEX IF NOT EXISTS idx_notif_recip_user_unseen ON notification_recipients(user_id, hidden_at, seen_at);');
    await safeExec('CREATE INDEX IF NOT EXISTS idx_notif_recip_user_unread ON notification_recipients(user_id, hidden_at, read_at);');
    await safeExec('CREATE INDEX IF NOT EXISTS idx_notif_recip_user_created ON notification_recipients(user_id, hidden_at, created_at DESC);');
    await safeExec('CREATE INDEX IF NOT EXISTS idx_notif_recip_notif_id ON notification_recipients(notification_id);');

    await safeExec(`
      INSERT OR IGNORE INTO notification_recipients (id, notification_id, user_id, seen_at, read_at, hidden_at, created_at)
      SELECT
        'recip_legacy_' || id,
        CAST(id AS TEXT),
        recipientStudentId,
        CASE WHEN isRead = 1 THEN COALESCE(created_at, datetime('now')) ELSE NULL END,
        CASE WHEN isRead = 1 THEN COALESCE(created_at, datetime('now')) ELSE NULL END,
        NULL,
        COALESCE(created_at, datetime('now'))
      FROM notifications
      WHERE recipientStudentId IS NOT NULL AND recipientStudentId != '';
    `);

    for (const [col, def] of [
      ['delivery_messages', "TEXT DEFAULT 'push_inbox'"],
      ['delivery_activity', "TEXT DEFAULT 'push_inbox'"],
      ['delivery_academic', "TEXT DEFAULT 'push_inbox'"],
      ['delivery_system', "TEXT DEFAULT 'push_inbox'"],
      ['quiet_hours_enabled', 'INTEGER DEFAULT 0'],
      ['quiet_hours_start', "TEXT DEFAULT '22:30'"],
      ['quiet_hours_end', "TEXT DEFAULT '07:00'"],
      ['timezone', "TEXT DEFAULT 'Asia/Kathmandu'"],
    ]) {
      await safeExec(`ALTER TABLE student_notification_preferences ADD COLUMN ${col} ${def};`);
    }
  }
}

/**
 * Checks if current time is within user's configured quiet hours.
 */
function isWithinQuietHours({ quietHoursStart = '22:30', quietHoursEnd = '07:00', timezone = 'Asia/Kathmandu' }) {
  try {
    const now = new Date();
    // Format current time in user's timezone to HH:mm
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone,
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
    const currentMins = hour * 60 + minute;

    const [startH, startM] = quietHoursStart.split(':').map((n) => parseInt(n, 10));
    const [endH, endM] = quietHoursEnd.split(':').map((n) => parseInt(n, 10));
    const startMins = startH * 60 + (startM || 0);
    const endMins = endH * 60 + (endM || 0);

    if (startMins <= endMins) {
      // Normal range e.g. 01:00 to 06:00
      return currentMins >= startMins && currentMins < endMins;
    } else {
      // Overnight range e.g. 22:30 to 07:00
      return currentMins >= startMins || currentMins < endMins;
    }
  } catch (err) {
    return false;
  }
}

/**
 * Calculates whether given hour and minute falls within quiet hours.
 */
function isQuietHoursActive(startTime = '22:30', endTime = '07:00', currentHour = null, currentMinute = null) {
  const [startH, startM] = startTime.split(':').map((n) => parseInt(n, 10));
  const [endH, endM] = endTime.split(':').map((n) => parseInt(n, 10));
  const startMins = startH * 60 + (startM || 0);
  const endMins = endH * 60 + (endM || 0);

  let currentMins;
  if (currentHour !== null && currentMinute !== null) {
    currentMins = currentHour * 60 + currentMinute;
  } else {
    const now = new Date();
    currentMins = now.getHours() * 60 + now.getMinutes();
  }

  if (startMins <= endMins) {
    return currentMins >= startMins && currentMins < endMins;
  } else {
    return currentMins >= startMins || currentMins < endMins;
  }
}

/**
 * Evaluates whether a push notification should be delivered to a recipient
 * based on user category preferences, priority, and quiet hours.
 */
async function evaluatePushDelivery(arg1, arg2, arg3, arg4) {
  let dbInstance, userId, type, priority;
  if (arg1 && (arg1.get || arg1.run)) {
    dbInstance = arg1;
    userId = arg2;
    type = arg3;
    priority = arg4;
  } else {
    dbInstance = db;
    userId = arg1;
    type = arg2;
    priority = arg3;
  }
  try {
    const prefRow = await dbInstance.get(
      'SELECT * FROM student_notification_preferences WHERE student_id = ?',
      userId
    );

    const category = TYPE_TO_CATEGORY[type] || 'activity';
    let deliveryMode = 'push_inbox';

    if (prefRow) {
      if (category === 'messages') {
        deliveryMode = prefRow.delivery_messages || (prefRow.mute_chat ? 'inbox_only' : 'push_inbox');
      } else if (category === 'academic') {
        deliveryMode = prefRow.delivery_academic || (prefRow.notify_notices === 0 || prefRow.notify_notes === 0 ? 'inbox_only' : 'push_inbox');
      } else if (category === 'activity') {
        deliveryMode = prefRow.delivery_activity || (prefRow.notify_posts === 0 ? 'inbox_only' : 'push_inbox');
      } else if (category === 'system') {
        deliveryMode = prefRow.delivery_system || 'push_inbox';
      }
    }

    // 1. User preferences check
    if (deliveryMode === 'off' || deliveryMode === 'inbox_only') {
      return { eligible: false, reason: 'suppressed_preference', deliveryMode };
    }

    // 2. Quiet hours check
    const quietHoursEnabled = Boolean(
      prefRow?.quiet_hours_enabled === true || prefRow?.quiet_hours_enabled === 1
    );

    if (quietHoursEnabled && priority !== 'urgent' && priority !== 'high') {
      const inQuiet = isWithinQuietHours({
        quietHoursStart: prefRow.quiet_hours_start || '22:30',
        quietHoursEnd: prefRow.quiet_hours_end || '07:00',
        timezone: prefRow.timezone || 'Asia/Kathmandu',
      });
      if (inQuiet) {
        return { eligible: false, reason: 'suppressed_quiet_hours', deliveryMode };
      }
    }

    return { eligible: true, deliveryMode };
  } catch (err) {
    return { eligible: true, deliveryMode: 'push_inbox' }; // default to delivery if error evaluating
  }
}

/**
 * Builds formatted text for aggregated notifications.
 */
function buildAggregatedContent(type, actors, metadata = {}) {
  const actorNames = actors.map((a) => a.name || 'A student').filter(Boolean);
  const totalCount = Math.max(actorNames.length, metadata.totalCount || 1);

  let formattedTitle = '';
  let formattedBody = '';

  if (type === NOTIFICATION_TYPES.POST_REACTION || type === NOTIFICATION_TYPES.COMMENT_REACTION) {
    const isComment = type === NOTIFICATION_TYPES.COMMENT_REACTION;
    const targetName = isComment ? 'your comment' : 'your post';

    if (totalCount === 1) {
      formattedTitle = `${actorNames[0]} reacted to ${targetName}`;
      formattedBody = metadata.preview ? `"${metadata.preview}"` : `liked ${targetName}`;
    } else if (totalCount === 2) {
      formattedTitle = `${actorNames[0]} and ${actorNames[1]} reacted to ${targetName}`;
      formattedBody = metadata.preview ? `"${metadata.preview}"` : `reacted to ${targetName}`;
    } else {
      const others = totalCount - 2;
      formattedTitle = `${actorNames[0]}, ${actorNames[1]} and ${others} ${others === 1 ? 'other' : 'others'} reacted to ${targetName}`;
      formattedBody = metadata.preview ? `"${metadata.preview}"` : `reacted to ${targetName}`;
    }
  } else if (type === NOTIFICATION_TYPES.POST_COMMENT || type === NOTIFICATION_TYPES.COMMENT_REPLY) {
    const targetName = type === NOTIFICATION_TYPES.COMMENT_REPLY ? 'your comment' : 'your post';
    if (totalCount === 1) {
      formattedTitle = `${actorNames[0]} commented on ${targetName}`;
      formattedBody = metadata.preview ? `"${metadata.preview}"` : 'commented';
    } else if (totalCount === 2) {
      formattedTitle = `${actorNames[0]} and ${actorNames[1]} commented on ${targetName}`;
      formattedBody = metadata.preview ? `"${metadata.preview}"` : 'commented';
    } else {
      const others = totalCount - 2;
      formattedTitle = `${actorNames[0]}, ${actorNames[1]} and ${others} others commented on ${targetName}`;
      formattedBody = metadata.preview ? `"${metadata.preview}"` : 'new comments';
    }
  } else if (type === NOTIFICATION_TYPES.CHAT_MESSAGE) {
    const groupName = metadata.groupName || 'Group Chat';
    if (totalCount === 1) {
      formattedTitle = `New message in ${groupName}`;
      formattedBody = `${actorNames[0]}: ${metadata.preview || 'sent a message'}`;
    } else {
      formattedTitle = `${totalCount} new messages in ${groupName}`;
      formattedBody = `${actorNames.slice(0, 3).join(', ')}: ${metadata.preview || 'new messages'}`;
    }
  }

  return { title: formattedTitle, body: formattedBody };
}

/**
 * Creates or aggregates a persistent in-app notification with recipients.
 *
 * Core architecture:
 * 1. Event happens
 * 2. Group aggregation check
 * 3. Persistent notification record created or updated
 * 4. Recipient records created with unseen state (seen_at = null, read_at = null)
 * 5. Realtime broadcast to online users
 * 6. Evaluates quiet hours & preferences, optionally triggers push delivery
 */
async function createNotification(arg1, arg2) {
  let dbInstance;
  let params;
  if (arg2) {
    dbInstance = arg1;
    params = arg2;
  } else {
    dbInstance = db;
    params = arg1 || {};
  }

  const {
    type,
    actorId = null,
    actorName = null,
    actorAvatar = null,
    title,
    body,
    entityType,
    entityId,
    secondaryEntityId = null,
    deepLink = '',
    webPath = '',
    groupKey = null,
    priority = null,
    metadata = {},
  } = params;

  if (!type || !title || !body || !entityType || !entityId) {
    throw new Error('Missing mandatory notification fields.');
  }

  const rawRecipients = params.recipientUserIds || params.recipientIds || [];

  // Filter out self-notifications
  const validRecipients = Array.from(
    new Set((rawRecipients || []).map((id) => String(id)).filter((id) => id && id !== actorId))
  );

  if (validRecipients.length === 0) {
    return { success: true, count: 0, recipientCount: 0, recipients: [], reason: 'No external recipients' };
  }

  const finalDeepLink = deepLink || (entityType === 'post' ? `/post/${entityId}` : entityType === 'notice' ? `/notice/${entityId}` : '/');
  const finalWebPath = webPath || finalDeepLink;

  const isPg = dbInstance?.isPostgres !== undefined ? dbInstance.isPostgres : db.isPostgres;
  const resolvedPriority = priority || DEFAULT_PRIORITY[type] || 'normal';
  const nowIso = new Date().toISOString();

  // 1. Grouping / Aggregation Check
  let existingGroupNotif = null;
  if (groupKey) {
    // Check if an existing notification with this group_key was created in the last 24 hours
    try {
      const sql = isPg
        ? `SELECT * FROM notifications WHERE group_key = ? AND created_at >= (CURRENT_TIMESTAMP - interval '24 hours') ORDER BY created_at DESC LIMIT 1`
        : `SELECT * FROM notifications WHERE group_key = ? AND datetime(created_at) >= datetime('now', '-24 hours') ORDER BY created_at DESC LIMIT 1`;
      existingGroupNotif = await dbInstance.get(sql, groupKey);
    } catch {}
  }

  let notificationId = null;

  if (existingGroupNotif) {
    // AGGREGATION: Update existing notification
    notificationId = String(existingGroupNotif.id);
    let existingMeta = {};
    try {
      existingMeta = typeof existingGroupNotif.metadata === 'string'
        ? JSON.parse(existingGroupNotif.metadata)
        : (existingGroupNotif.metadata || {});
    } catch {}

    const existingActors = Array.isArray(existingMeta.actors) ? existingMeta.actors : [];
    const newActors = [...existingActors];

    if (actorId && !newActors.some((a) => a.id === actorId)) {
      newActors.unshift({ id: actorId, name: actorName || 'A student', avatarUrl: actorAvatar });
    }

    const updatedTotalCount = (existingMeta.totalCount || existingActors.length || 1) + 1;
    const mergedMeta = {
      ...existingMeta,
      ...metadata,
      actors: newActors.slice(0, 5), // Keep top 5 latest actors
      totalCount: updatedTotalCount,
    };

    const aggregated = buildAggregatedContent(type, newActors, mergedMeta);
    const finalTitle = aggregated.title || title;
    const finalBody = aggregated.body || body;

    const metaVal = JSON.stringify(mergedMeta);
    await dbInstance.run(
      `UPDATE notifications SET title = ?, body = ?, metadata = ${isPg ? '?::jsonb' : '?'}, updated_at = ${isPg ? 'CURRENT_TIMESTAMP' : "datetime('now')"} WHERE id = ?`,
      finalTitle,
      finalBody,
      metaVal,
      notificationId
    );

    // Reset seen_at and read_at so recipient receives new unseen badge alert
    for (const recipientId of validRecipients) {
      if (isPg) {
        await dbInstance.run(
          `INSERT INTO notification_recipients (id, notification_id, user_id, seen_at, read_at, hidden_at, created_at)
           VALUES (?, ?, ?, NULL, NULL, NULL, CURRENT_TIMESTAMP)
           ON CONFLICT (notification_id, user_id)
           DO UPDATE SET seen_at = NULL, read_at = NULL, hidden_at = NULL, created_at = CURRENT_TIMESTAMP`,
          crypto.randomUUID(),
          notificationId,
          recipientId
        );
      } else {
        await dbInstance.run(
          `INSERT INTO notification_recipients (id, notification_id, user_id, seen_at, read_at, hidden_at, created_at)
           VALUES (?, ?, ?, NULL, NULL, NULL, datetime('now'))
           ON CONFLICT (notification_id, user_id)
           DO UPDATE SET seen_at = NULL, read_at = NULL, hidden_at = NULL, created_at = datetime('now')`,
          crypto.randomUUID(),
          notificationId,
          recipientId
        );
      }
    }
  } else {
    // NEW NOTIFICATION
    notificationId = crypto.randomUUID();
    const initialActors = actorId
      ? [{ id: actorId, name: actorName || 'A student', avatarUrl: actorAvatar }]
      : [];

    const finalMeta = {
      ...metadata,
      actors: initialActors,
      totalCount: 1,
    };

    const metaVal = isPg ? JSON.stringify(finalMeta) : JSON.stringify(finalMeta);

    if (isPg) {
      await dbInstance.run(
        `INSERT INTO notifications
           (id, type, actor_id, title, body, entity_type, entity_id, secondary_entity_id, deep_link, web_path, group_key, priority, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        notificationId,
        type,
        actorId,
        title,
        body,
        entityType,
        String(entityId),
        secondaryEntityId ? String(secondaryEntityId) : null,
        finalDeepLink,
        finalWebPath,
        groupKey,
        resolvedPriority,
        metaVal
      );
    } else {
      // Existing SQLite installations may still have an INTEGER rowid key;
      // fresh Notification Center schemas use an explicit TEXT UUID key.
      const columns = await dbInstance.all('PRAGMA table_info(notifications)');
      const colNames = (columns || []).map(column => column.name);
      const legacyRowId = columns.some(column => column.name === 'id' && column.type.toUpperCase() === 'INTEGER');

      const extraCols = [];
      const extraVals = [];

      if (colNames.includes('actorId')) {
        extraCols.push('actorId');
        extraVals.push(actorId);
      }
      const toSafeInt = (val) => {
        if (val === null || val === undefined || val === '') return null;
        const n = Number(val);
        return Number.isFinite(n) ? n : null;
      };

      if (colNames.includes('postId')) {
        extraCols.push('postId');
        const pid = toSafeInt(finalMeta?.postId) ?? (entityType === 'post' ? toSafeInt(entityId) : null);
        extraVals.push(pid);
      }
      if (colNames.includes('commentId')) {
        extraCols.push('commentId');
        const cid = toSafeInt(finalMeta?.commentId) ?? (secondaryEntityId ? toSafeInt(secondaryEntityId) : (entityType === 'comment' ? toSafeInt(entityId) : null));
        extraVals.push(cid);
      }
      if (colNames.includes('replyId')) {
        extraCols.push('replyId');
        const rid = toSafeInt(finalMeta?.replyId) ?? (entityType === 'reply' ? toSafeInt(entityId) : null);
        extraVals.push(rid);
      }
      if (colNames.includes('reactionType')) {
        extraCols.push('reactionType');
        extraVals.push(finalMeta?.reactionType || null);
      }

      const extraColsSql = extraCols.length > 0 ? ', ' + extraCols.join(', ') : '';
      const extraPlaceholdersSql = extraCols.length > 0 ? ', ' + extraCols.map(() => '?').join(', ') : '';

      const insertRes = await dbInstance.run(
        `INSERT INTO notifications
           (${legacyRowId ? '' : 'id, '}type, actor_id, title, body, entity_type, entity_id, secondary_entity_id, deep_link, web_path, group_key, priority, metadata, created_at, updated_at, recipientStudentId, message${extraColsSql})
         VALUES (${legacyRowId ? '' : '?, '}?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?${extraPlaceholdersSql})`,
        ...(!legacyRowId ? [notificationId] : []),
        type,
        actorId,
        title,
        body,
        entityType,
        String(entityId),
        secondaryEntityId ? String(secondaryEntityId) : null,
        finalDeepLink,
        finalWebPath,
        groupKey,
        resolvedPriority,
        metaVal,
        validRecipients[0],
        body || title,
        ...extraVals
      );
      if (legacyRowId && insertRes && (insertRes.lastInsertRowid || insertRes.lastInsertRowid === 0)) {
        notificationId = String(insertRes.lastInsertRowid);
      }
    }

    // Insert recipient rows
    for (const recipientId of validRecipients) {
      const recipId = crypto.randomUUID();
      if (isPg) {
        await dbInstance.run(
          `INSERT INTO notification_recipients (id, notification_id, user_id, seen_at, read_at, hidden_at, created_at)
           VALUES (?, ?, ?, NULL, NULL, NULL, CURRENT_TIMESTAMP)
           ON CONFLICT (notification_id, user_id) DO NOTHING`,
          recipId,
          notificationId,
          recipientId
        );
      } else {
        await dbInstance.run(
          `INSERT OR IGNORE INTO notification_recipients (id, notification_id, user_id, seen_at, read_at, hidden_at, created_at)
           VALUES (?, ?, ?, NULL, NULL, NULL, datetime('now'))`,
          recipId,
          notificationId,
          recipientId
        );
      }
    }
  }

  // 2. Realtime Broadcast & Unseen Count Dispatch (Minimized Payload: no sensitive text)
  for (const recipientId of validRecipients) {
    const unseenCount = await getUnseenCount(dbInstance, recipientId);
    broadcastToUser(recipientId, {
      type: 'notification',
      notificationId,
      unseenCount,
    });
  }

  // 3. Evaluate Push Delivery & Preferences per recipient
  const isMandatory = type === NOTIFICATION_TYPES.OFFICIAL_NOTICE ||
                      type === NOTIFICATION_TYPES.SECURITY ||
                      resolvedPriority === 'urgent';

  const pushEligibleRecipients = [];
  for (const recipientId of validRecipients) {
    const decision = await evaluatePushDelivery(dbInstance, recipientId, type, resolvedPriority);

    // Strict "Off" mode handling:
    // If delivery mode is 'off' and NOT a mandatory official notice or urgent security alert,
    // hide the notification from the user's inbox as well.
    if (decision.deliveryMode === 'off' && !isMandatory) {
      if (isPg) {
        await dbInstance.run(
          `UPDATE notification_recipients SET hidden_at = CURRENT_TIMESTAMP, push_status = 'suppressed_preferences' WHERE notification_id = ? AND user_id = ?`,
          notificationId,
          recipientId
        );
      } else {
        await dbInstance.run(
          `UPDATE notification_recipients SET hidden_at = datetime('now'), push_status = 'suppressed_preferences' WHERE notification_id = ? AND user_id = ?`,
          notificationId,
          recipientId
        );
      }
      continue;
    }

    if (decision.eligible && !params.skipPush) {
      pushEligibleRecipients.push(recipientId);
    } else if (!params.skipPush) {
      // Record suppression reason in recipient row
      await dbInstance.run(
        'UPDATE notification_recipients SET push_status = ? WHERE notification_id = ? AND user_id = ?',
        decision.reason || 'suppressed',
        notificationId,
        recipientId
      );
    }
  }

  // 4. Enqueue Push for eligible recipients if any
  if (pushEligibleRecipients.length > 0 && !params.skipPush) {
    try {
      const pushNotifications = require('./push-notifications');
      const category = TYPE_TO_CATEGORY[type] || 'activity';
      const channelId = category === 'academic' ? 'academic' : category === 'messages' ? 'chat' : 'social';

      const payload = {
        title,
        body,
        data: {
          type,
          notificationId,
          entityId: String(entityId),
          secondaryEntityId: secondaryEntityId ? String(secondaryEntityId) : undefined,
          actorId: actorId ? String(actorId) : undefined,
          actorName: actorName || undefined,
          deepLink,
          groupKey: groupKey || undefined,
          createdAt: nowIso,
          ...metadata,
        },
        channelId,
        groupKey: groupKey || undefined,
      };

      await pushNotifications.enqueuePushForRecipients(dbInstance, {
        eventType: type,
        eventId: notificationId,
        recipientStudentIds: pushEligibleRecipients,
        payload,
        idempotencyKeyPrefix: `${type}_${notificationId}`,
      });

      // Mark push_status as queued
      for (const recId of pushEligibleRecipients) {
        await dbInstance.run(
          `UPDATE notification_recipients SET push_status = 'queued' WHERE notification_id = ? AND user_id = ?`,
          notificationId,
          recId
        );
      }
    } catch (pushErr) {
      console.warn('[Notification Service Push Enqueue Error]:', pushErr.message);
    }
  }

  return {
    success: true,
    notificationId,
    recipientCount: validRecipients.length,
    recipientsCount: validRecipients.length,
    recipients: validRecipients,
    pushCount: pushEligibleRecipients.length,
  };
}

/**
 * Removes an actor from a grouped notification when they remove their reaction.
 * Recomputes title, body, and totalCount, or hides the notification if no actors remain.
 */
async function removeReactionFromGroup(arg1, arg2) {
  let dbInstance, opts;
  if (arg1 && (arg1.get || arg1.run)) {
    dbInstance = arg1;
    opts = arg2 || {};
  } else {
    dbInstance = db;
    opts = arg1 || {};
  }
  const { groupKey, actorId } = opts;
  if (!groupKey || !actorId) return { updated: false };

  const isPg = dbInstance?.isPostgres !== undefined ? dbInstance.isPostgres : db.isPostgres;

  try {
    const sql = isPg
      ? `SELECT * FROM notifications WHERE group_key = ? ORDER BY created_at DESC LIMIT 1`
      : `SELECT * FROM notifications WHERE group_key = ? ORDER BY datetime(created_at) DESC LIMIT 1`;
    const notif = await dbInstance.get(sql, groupKey);
    if (!notif) return { updated: false };

    let meta = {};
    try {
      meta = typeof notif.metadata === 'string' ? JSON.parse(notif.metadata) : (notif.metadata || {});
    } catch {}

    const actors = Array.isArray(meta.actors) ? meta.actors : [];
    const hadActor = actors.some((a) => a.id === actorId);
    const updatedActors = actors.filter((a) => a.id !== actorId);
    const prevCount = meta.totalCount || actors.length || 1;
    const newTotalCount = hadActor ? Math.max(0, prevCount - 1) : prevCount;

    if (newTotalCount === 0 || updatedActors.length === 0) {
      // Hide notification recipient records so it disappears from inbox
      await dbInstance.run(
        `UPDATE notification_recipients SET hidden_at = ${isPg ? 'CURRENT_TIMESTAMP' : "datetime('now')"} WHERE notification_id = ?`,
        String(notif.id)
      );
      return { updated: true, hidden: true, totalCount: 0 };
    }

    const updatedMeta = {
      ...meta,
      actors: updatedActors,
      totalCount: newTotalCount,
    };

    const aggregated = buildAggregatedContent(notif.type, updatedActors, updatedMeta);
    const finalTitle = aggregated.title || notif.title;
    const finalBody = aggregated.body || notif.body;

    const metaVal = JSON.stringify(updatedMeta);
    await dbInstance.run(
      `UPDATE notifications SET title = ?, body = ?, metadata = ${isPg ? '?::jsonb' : '?'} WHERE id = ?`,
      finalTitle,
      finalBody,
      metaVal,
      String(notif.id)
    );

    return { updated: true, totalCount: newTotalCount, actors: updatedActors };
  } catch (err) {
    console.warn('[removeReactionFromGroup Error]:', err.message);
    return { updated: false, error: err.message };
  }
}

/**
 * Returns unseen notification badge count for user (contributes to bell badge).
 */
async function getUnseenCount(arg1, arg2) {
  const dbInstance = (arg1 && (arg1.get || arg1.run)) ? arg1 : db;
  const userId = (arg1 && (arg1.get || arg1.run)) ? arg2 : arg1;
  if (!userId) return 0;
  const row = await dbInstance.get(
    'SELECT COUNT(*) AS c FROM notification_recipients WHERE user_id = ? AND hidden_at IS NULL AND seen_at IS NULL',
    userId
  );
  return Number(row?.c || 0);
}

/**
 * Marks all unseen notifications as seen when user opens Notification Center.
 */
async function markAllSeen(arg1, arg2) {
  const dbInstance = (arg1 && (arg1.get || arg1.run)) ? arg1 : db;
  const userId = (arg1 && (arg1.get || arg1.run)) ? arg2 : arg1;
  if (!userId) return { count: 0 };
  const isPg = dbInstance?.isPostgres !== undefined ? dbInstance.isPostgres : db.isPostgres;
  const sql = isPg
    ? `UPDATE notification_recipients SET seen_at = CURRENT_TIMESTAMP WHERE user_id = ? AND seen_at IS NULL AND hidden_at IS NULL`
    : `UPDATE notification_recipients SET seen_at = datetime('now') WHERE user_id = ? AND seen_at IS NULL AND hidden_at IS NULL`;
  const result = await dbInstance.run(sql, userId);
  const count = result.changes || 0;

  broadcastToUser(userId, { type: 'badge_update', unseenCount: 0 });
  return { success: true, count };
}

/**
 * Marks a specific notification as read.
 */
async function markRead(arg1, arg2, arg3) {
  const dbInstance = (arg1 && (arg1.get || arg1.run)) ? arg1 : db;
  const userId = (arg1 && (arg1.get || arg1.run)) ? arg2 : arg1;
  const notificationId = (arg1 && (arg1.get || arg1.run)) ? arg3 : arg2;
  if (!userId || !notificationId) return { success: false };
  const isPg = dbInstance?.isPostgres !== undefined ? dbInstance.isPostgres : db.isPostgres;
  const sql = isPg
    ? `UPDATE notification_recipients SET read_at = CURRENT_TIMESTAMP, seen_at = COALESCE(seen_at, CURRENT_TIMESTAMP) WHERE user_id = ? AND notification_id = ?`
    : `UPDATE notification_recipients SET read_at = datetime('now'), seen_at = COALESCE(seen_at, datetime('now')) WHERE user_id = ? AND notification_id = ?`;
  const result = await dbInstance.run(sql, userId, notificationId);
  return { success: (result.changes || 0) > 0 };
}

/**
 * Marks a specific notification as unread.
 */
async function markUnread(arg1, arg2, arg3) {
  const dbInstance = (arg1 && (arg1.get || arg1.run)) ? arg1 : db;
  const userId = (arg1 && (arg1.get || arg1.run)) ? arg2 : arg1;
  const notificationId = (arg1 && (arg1.get || arg1.run)) ? arg3 : arg2;
  if (!userId || !notificationId) return { success: false };
  const result = await dbInstance.run(
    'UPDATE notification_recipients SET read_at = NULL WHERE user_id = ? AND notification_id = ?',
    userId,
    notificationId
  );
  return { success: (result.changes || 0) > 0 };
}

/**
 * Marks all notifications as read for user.
 */
async function markAllRead(arg1, arg2) {
  const dbInstance = (arg1 && (arg1.get || arg1.run)) ? arg1 : db;
  const userId = (arg1 && (arg1.get || arg1.run)) ? arg2 : arg1;
  if (!userId) return { success: false };
  const isPg = dbInstance?.isPostgres !== undefined ? dbInstance.isPostgres : db.isPostgres;
  const sql = isPg
    ? `UPDATE notification_recipients SET read_at = CURRENT_TIMESTAMP, seen_at = COALESCE(seen_at, CURRENT_TIMESTAMP) WHERE user_id = ? AND read_at IS NULL AND hidden_at IS NULL`
    : `UPDATE notification_recipients SET read_at = datetime('now'), seen_at = COALESCE(seen_at, datetime('now')) WHERE user_id = ? AND read_at IS NULL AND hidden_at IS NULL`;
  const result = await dbInstance.run(sql, userId);

  broadcastToUser(userId, { type: 'badge_update', unseenCount: 0 });
  return { success: true, count: result.changes || 0 };
}

/**
 * Hides a notification from user's view (soft-delete inbox item).
 */
async function hideNotification(arg1, arg2, arg3) {
  const dbInstance = (arg1 && (arg1.get || arg1.run)) ? arg1 : db;
  const userId = (arg1 && (arg1.get || arg1.run)) ? arg2 : arg1;
  const notificationId = (arg1 && (arg1.get || arg1.run)) ? arg3 : arg2;
  if (!userId || !notificationId) return { success: false };
  const isPg = dbInstance?.isPostgres !== undefined ? dbInstance.isPostgres : db.isPostgres;
  const sql = isPg
    ? `UPDATE notification_recipients SET hidden_at = CURRENT_TIMESTAMP WHERE user_id = ? AND notification_id = ?`
    : `UPDATE notification_recipients SET hidden_at = datetime('now') WHERE user_id = ? AND notification_id = ?`;
  const result = await dbInstance.run(sql, userId, notificationId);
  return { success: (result.changes || 0) > 0 };
}

/**
 * Retrieves paginated notifications for the user with tab filtering.
 * Tabs: 'all' | 'unread' | 'mentions'
 */
async function getNotifications(arg1, arg2) {
  const dbInstance = (arg1 && (arg1.get || arg1.run)) ? arg1 : db;
  const opts = (arg1 && (arg1.get || arg1.run)) ? (arg2 || {}) : (arg1 || {});
  const {
    userId,
    tab = 'all',
    limit = 20,
    cursor = null, // timestamp or id cursor
  } = opts;

  if (!userId) return { items: [], nextCursor: null };

  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);

  let whereClauses = [
    'r.user_id = ?',
    'r.hidden_at IS NULL',
  ];
  let params = [userId];

  if (tab === 'unread') {
    whereClauses.push('r.read_at IS NULL');
  } else if (tab === 'mentions') {
    whereClauses.push("n.type = 'mention'");
  }

  if (cursor) {
    let cursorDate = null;
    let cursorId = null;

    if (typeof cursor === 'string') {
      let decoded = cursor;
      try {
        if (/^[A-Za-z0-9+/=]+$/.test(cursor) && cursor.includes('=')) {
          decoded = Buffer.from(cursor, 'base64').toString('utf8');
        }
      } catch {}

      if (decoded.includes('|')) {
        const parts = decoded.split('|');
        cursorDate = parts[0];
        cursorId = parts[1];
      } else {
        cursorDate = decoded;
      }
    }

    if (cursorDate && cursorId) {
      whereClauses.push('(n.created_at < ? OR (n.created_at = ? AND n.id < ?))');
      params.push(cursorDate, cursorDate, cursorId);
    } else if (cursorDate) {
      whereClauses.push('n.created_at < ?');
      params.push(cursorDate);
    }
  }

  params.push(parsedLimit + 1);

  const query = `
    SELECT
      n.id,
      n.type,
      n.title,
      n.body,
      n.entity_type AS "entityType",
      n.entity_id AS "entityId",
      n.secondary_entity_id AS "secondaryEntityId",
      n.deep_link AS "deepLink",
      n.web_path AS "webPath",
      n.group_key AS "groupKey",
      n.priority,
      n.metadata,
      n.created_at AS "createdAt",
      n.updated_at AS "updatedAt",
      r.seen_at AS "seenAt",
      r.read_at AS "readAt",
      s.studentId AS "actorStudentId",
      s.name AS "actorName",
      s.avatarUrl AS "actorAvatar",
      s.role AS "actorRole"
    FROM notification_recipients r
    JOIN notifications n ON r.notification_id = n.id
    LEFT JOIN students s ON n.actor_id = s.studentId
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT ?
  `;

  const rows = await dbInstance.all(query, ...params);
  const hasMore = rows.length > parsedLimit;
  const items = hasMore ? rows.slice(0, parsedLimit) : rows;

  const formattedItems = items.map((row) => {
    let meta = {};
    try {
      meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
    } catch {}

    const isUnread = !row.readAt;
    const isUnseen = !row.seenAt;

    return {
      id: String(row.id),
      type: row.type,
      title: row.title,
      body: row.body,
      entityType: row.entityType,
      entityId: row.entityId,
      secondaryEntityId: row.secondaryEntityId,
      deepLink: row.deepLink,
      webPath: row.webPath,
      groupKey: row.groupKey,
      priority: row.priority,
      metadata: meta,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      isRead: !isUnread,
      isSeen: !isUnseen,
      readAt: row.readAt || null,
      seenAt: row.seenAt || null,
      actor: row.actorStudentId
        ? {
            studentId: row.actorStudentId,
            name: row.actorName,
            avatarUrl: row.actorAvatar,
            role: row.actorRole,
          }
        : null,
    };
  });

  const nextCursor = hasMore && formattedItems.length > 0
    ? `${formattedItems[formattedItems.length - 1].createdAt}|${formattedItems[formattedItems.length - 1].id}`
    : null;

  return {
    items: formattedItems,
    nextCursor,
  };
}

/**
 * Returns advanced student notification preferences.
 */
async function getAdvancedPreferences(arg1, arg2) {
  const dbInstance = (arg1 && (arg1.get || arg1.run)) ? arg1 : db;
  const userId = (arg1 && (arg1.get || arg1.run)) ? arg2 : arg1;
  if (!userId) return null;
  const row = await dbInstance.get(
    'SELECT * FROM student_notification_preferences WHERE student_id = ?',
    userId
  );

  return {
    muteChat: Boolean(row?.mute_chat ?? row?.muteChat ?? false),
    notifyNotes: Boolean(row?.notify_notes ?? row?.notifyNotes ?? true),
    notifyPosts: Boolean(row?.notify_posts ?? row?.notifyPosts ?? true),
    notifyNotices: Boolean(row?.notify_notices ?? row?.notifyNotices ?? true),
    hideLockscreenPreview: Boolean(row?.hide_lockscreen_preview ?? row?.hideLockscreenPreview ?? true),
    deliveryMessages: row?.delivery_messages || (row?.mute_chat ? 'inbox_only' : 'push_inbox'),
    deliveryActivity: row?.delivery_activity || (row?.notify_posts === 0 ? 'inbox_only' : 'push_inbox'),
    deliveryAcademic: row?.delivery_academic || (row?.notify_notices === 0 ? 'inbox_only' : 'push_inbox'),
    deliverySystem: row?.delivery_system || 'push_inbox',
    quietHoursEnabled: Boolean(row?.quiet_hours_enabled ?? false),
    quietHoursStart: row?.quiet_hours_start || '22:30',
    quietHoursEnd: row?.quiet_hours_end || '07:00',
    timezone: row?.timezone || 'Asia/Kathmandu',
  };
}

/**
 * Updates student notification preferences.
 */
async function updateAdvancedPreferences(arg1, arg2, arg3) {
  const dbInstance = (arg1 && (arg1.get || arg1.run)) ? arg1 : db;
  const userId = (arg1 && (arg1.get || arg1.run)) ? arg2 : arg1;
  const prefs = (arg1 && (arg1.get || arg1.run)) ? (arg3 || {}) : (arg2 || {});
  if (!userId) return null;

  const current = (await getAdvancedPreferences(dbInstance, userId)) || {};
  const updated = {
    ...current,
    ...prefs,
  };

  const deliveryModes = ['push_inbox', 'inbox_only', 'off'];
  const validMode = (m, fallback) => (deliveryModes.includes(m) ? m : fallback);

  const deliveryMessages = validMode(updated.deliveryMessages, 'push_inbox');
  const deliveryActivity = validMode(updated.deliveryActivity, 'push_inbox');
  const deliveryAcademic = validMode(updated.deliveryAcademic, 'push_inbox');
  const deliverySystem = validMode(updated.deliverySystem, 'push_inbox');

  const muteChat = deliveryMessages === 'inbox_only' || deliveryMessages === 'off' || updated.muteChat;
  const notifyPosts = deliveryActivity !== 'off' && updated.notifyPosts;
  const notifyNotices = deliveryAcademic !== 'off' && updated.notifyNotices;
  const notifyNotes = deliveryAcademic !== 'off' && updated.notifyNotes;
  const hideLockscreenPreview = Boolean(updated.hideLockscreenPreview);

  const quietHoursEnabled = Boolean(updated.quietHoursEnabled);
  const quietHoursStart = typeof updated.quietHoursStart === 'string' && /^\d{2}:\d{2}$/.test(updated.quietHoursStart)
    ? updated.quietHoursStart
    : '22:30';
  const quietHoursEnd = typeof updated.quietHoursEnd === 'string' && /^\d{2}:\d{2}$/.test(updated.quietHoursEnd)
    ? updated.quietHoursEnd
    : '07:00';
  const timezone = typeof updated.timezone === 'string' && updated.timezone.trim()
    ? updated.timezone.trim()
    : 'Asia/Kathmandu';

  const isPg = dbInstance?.isPostgres !== undefined ? dbInstance.isPostgres : db.isPostgres;

  if (isPg) {
    await dbInstance.run(
      `INSERT INTO student_notification_preferences
         (student_id, mute_chat, notify_notes, notify_posts, notify_notices, hide_lockscreen_preview,
          delivery_messages, delivery_activity, delivery_academic, delivery_system,
          quiet_hours_enabled, quiet_hours_start, quiet_hours_end, timezone, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (student_id) DO UPDATE SET
         mute_chat = EXCLUDED.mute_chat,
         notify_notes = EXCLUDED.notify_notes,
         notify_posts = EXCLUDED.notify_posts,
         notify_notices = EXCLUDED.notify_notices,
         hide_lockscreen_preview = EXCLUDED.hide_lockscreen_preview,
         delivery_messages = EXCLUDED.delivery_messages,
         delivery_activity = EXCLUDED.delivery_activity,
         delivery_academic = EXCLUDED.delivery_academic,
         delivery_system = EXCLUDED.delivery_system,
         quiet_hours_enabled = EXCLUDED.quiet_hours_enabled,
         quiet_hours_start = EXCLUDED.quiet_hours_start,
         quiet_hours_end = EXCLUDED.quiet_hours_end,
         timezone = EXCLUDED.timezone,
         updated_at = CURRENT_TIMESTAMP`,
      userId,
      muteChat,
      notifyNotes,
      notifyPosts,
      notifyNotices,
      hideLockscreenPreview,
      deliveryMessages,
      deliveryActivity,
      deliveryAcademic,
      deliverySystem,
      quietHoursEnabled,
      quietHoursStart,
      quietHoursEnd,
      timezone
    );
  } else {
    await dbInstance.run(
      `INSERT OR REPLACE INTO student_notification_preferences
         (student_id, mute_chat, notify_notes, notify_posts, notify_notices, hide_lockscreen_preview,
          delivery_messages, delivery_activity, delivery_academic, delivery_system,
          quiet_hours_enabled, quiet_hours_start, quiet_hours_end, timezone, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      userId,
      muteChat ? 1 : 0,
      notifyNotes ? 1 : 0,
      notifyPosts ? 1 : 0,
      notifyNotices ? 1 : 0,
      hideLockscreenPreview ? 1 : 0,
      deliveryMessages,
      deliveryActivity,
      deliveryAcademic,
      deliverySystem,
      quietHoursEnabled ? 1 : 0,
      quietHoursStart,
      quietHoursEnd,
      timezone
    );
  }

  return getAdvancedPreferences(dbInstance, userId);
}

module.exports = {
  NOTIFICATION_TYPES,
  TYPE_TO_CATEGORY,
  DEFAULT_PRIORITY,
  ensureNotificationCenterSchema,
  createNotification,
  getUnseenCount,
  markAllSeen,
  markRead,
  markUnread,
  markAllRead,
  hideNotification,
  getNotifications,
  getAdvancedPreferences,
  updateAdvancedPreferences,
  removeReactionFromGroup,
  subscribeToUserNotifications,
  broadcastToUser,
  isWithinQuietHours,
  isQuietHoursActive,
};
