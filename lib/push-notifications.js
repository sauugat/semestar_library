const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/**
 * Validates an Expo push token format.
 * Matches ExponentPushToken[...] or ExpoPushToken[...] or UUID-based expo tokens.
 */
function isValidExpoPushToken(token) {
  if (typeof token !== 'string') return false;
  const trimmed = token.trim();
  return /^(ExponentPushToken|ExpoPushToken)\[.+\]$/.test(trimmed) ||
         /^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}$/i.test(trimmed);
}

/**
 * Normalizes notification preferences from database row.
 */
function normalizePreferences(row) {
  if (!row) {
    return {
      muteChat: false,
      notifyNotes: true,
      notifyPosts: true,
      notifyNotices: true,
      hideLockscreenPreview: false,
    };
  }

  const parseBool = (val, defaultVal) => {
    if (val === undefined || val === null) return defaultVal;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val === 1;
    if (typeof val === 'string') return val === 'true' || val === '1';
    return defaultVal;
  };

  return {
    muteChat: parseBool(row.mute_chat ?? row.muteChat, false),
    notifyNotes: parseBool(row.notify_notes ?? row.notifyNotes, true),
    notifyPosts: parseBool(row.notify_posts ?? row.notifyPosts, true),
    notifyNotices: parseBool(row.notify_notices ?? row.notifyNotices, true),
    hideLockscreenPreview: parseBool(row.hide_lockscreen_preview ?? row.hideLockscreenPreview, false),
  };
}

/**
 * Safely sanitizes and truncates user-generated content for push notifications.
 * - Strips script fragments and HTML tags
 * - Normalizes excessive whitespace and newlines
 * - Unicode/emoji-aware truncation
 */
function buildNotificationPreview(text, maxLength = 140) {
  if (!text || typeof text !== 'string') return '';
  // 1. Strip script tags and HTML
  let cleaned = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');
  // 2. Sanitize auth tokens and credentials
  cleaned = cleaned.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, '');
  cleaned = cleaned.replace(/(?:token|auth|key|secret|password)=[A-Za-z0-9_\-\.]+/gi, '');
  // 3. Sanitize private/internal local URLs
  cleaned = cleaned.replace(/https?:\/\/(?:localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(?::\d+)?\S*/gi, '');
  // 4. Normalize excessive whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  // 5. Clean Unicode/emoji-aware truncation
  const chars = Array.from(cleaned);
  if (chars.length <= maxLength) {
    return cleaned;
  }
  return chars.slice(0, maxLength - 1).join('').trim() + '…';
}

/**
 * Ensures schema tables and indexes exist for Push Notifications.
 */
async function ensurePushNotificationSchema({ exec, isPostgres }) {
  if (isPostgres) {
    await exec(`
      CREATE TABLE IF NOT EXISTS student_device_tokens (
        expo_push_token TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        device_name TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        last_used_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_student_device_tokens_student ON student_device_tokens(student_id);

      CREATE TABLE IF NOT EXISTS student_notification_preferences (
        student_id TEXT PRIMARY KEY REFERENCES students(studentId) ON DELETE CASCADE,
        mute_chat BOOLEAN DEFAULT false,
        notify_notes BOOLEAN DEFAULT true,
        notify_posts BOOLEAN DEFAULT true,
        notify_notices BOOLEAN DEFAULT true,
        hide_lockscreen_preview BOOLEAN DEFAULT true,
        delivery_messages TEXT DEFAULT 'push_inbox',
        delivery_activity TEXT DEFAULT 'push_inbox',
        delivery_academic TEXT DEFAULT 'push_inbox',
        delivery_system TEXT DEFAULT 'push_inbox',
        quiet_hours_enabled BOOLEAN DEFAULT false,
        quiet_hours_start TEXT DEFAULT '22:30',
        quiet_hours_end TEXT DEFAULT '07:00',
        timezone TEXT DEFAULT 'Asia/Kathmandu',
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS push_notification_outbox (
        id SERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        event_id TEXT NOT NULL,
        recipient_student_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
        payload_json JSONB NOT NULL,
        idempotency_key TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        next_attempt_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        sent_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_push_outbox_status_next ON push_notification_outbox(status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_push_outbox_recipient ON push_notification_outbox(recipient_student_id);
      CREATE INDEX IF NOT EXISTS idx_push_outbox_event_status ON push_notification_outbox(event_type, event_id, status);
      CREATE INDEX IF NOT EXISTS idx_student_device_tokens_student ON student_device_tokens(student_id);

      CREATE TABLE IF NOT EXISTS push_receipt_tickets (
        ticket_id TEXT PRIMARY KEY,
        expo_push_token TEXT NOT NULL,
        outbox_id INTEGER REFERENCES push_notification_outbox(id) ON DELETE SET NULL,
        status TEXT DEFAULT 'pending',
        error_code TEXT,
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        checked_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_push_receipts_status ON push_receipt_tickets(status, created_at);
    `);
  } else {
    await exec(`
      CREATE TABLE IF NOT EXISTS student_device_tokens (
        expo_push_token TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        device_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(studentId) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_student_device_tokens_student ON student_device_tokens(student_id);

      CREATE TABLE IF NOT EXISTS student_notification_preferences (
        student_id TEXT PRIMARY KEY,
        mute_chat INTEGER DEFAULT 0,
        notify_notes INTEGER DEFAULT 1,
        notify_posts INTEGER DEFAULT 1,
        notify_notices INTEGER DEFAULT 1,
        hide_lockscreen_preview INTEGER DEFAULT 1,
        delivery_messages TEXT DEFAULT 'push_inbox',
        delivery_activity TEXT DEFAULT 'push_inbox',
        delivery_academic TEXT DEFAULT 'push_inbox',
        delivery_system TEXT DEFAULT 'push_inbox',
        quiet_hours_enabled INTEGER DEFAULT 0,
        quiet_hours_start TEXT DEFAULT '22:30',
        quiet_hours_end TEXT DEFAULT '07:00',
        timezone TEXT DEFAULT 'Asia/Kathmandu',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(studentId) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS push_notification_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        event_id TEXT NOT NULL,
        recipient_student_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        idempotency_key TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        next_attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        sent_at DATETIME,
        FOREIGN KEY (recipient_student_id) REFERENCES students(studentId) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_push_outbox_status_next ON push_notification_outbox(status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_push_outbox_recipient ON push_notification_outbox(recipient_student_id);
      CREATE INDEX IF NOT EXISTS idx_push_outbox_event_status ON push_notification_outbox(event_type, event_id, status);

      CREATE TABLE IF NOT EXISTS push_receipt_tickets (
        ticket_id TEXT PRIMARY KEY,
        expo_push_token TEXT NOT NULL,
        outbox_id INTEGER,
        status TEXT DEFAULT 'pending',
        error_code TEXT,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        checked_at DATETIME,
        FOREIGN KEY (outbox_id) REFERENCES push_notification_outbox(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_push_receipts_status ON push_receipt_tickets(status, created_at);
    `);
  }

  // Phase 2C: Safe non-destructive column migrations for in-app notifications
  if (isPostgres) {
    try {
      await exec(`
        CREATE TABLE IF NOT EXISTS notifications (
          id SERIAL PRIMARY KEY,
          recipientStudentId TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          type TEXT NOT NULL,
          relatedFileId INTEGER,
          actorId TEXT REFERENCES students(studentId) ON DELETE SET NULL,
          postId INTEGER REFERENCES posts(id) ON DELETE CASCADE,
          commentId INTEGER REFERENCES post_comments(id) ON DELETE CASCADE,
          replyId INTEGER REFERENCES post_comments(id) ON DELETE CASCADE,
          reactionType TEXT,
          message TEXT NOT NULL,
          isRead INTEGER DEFAULT 0,
          createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipientStudentId);
        CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread ON notifications(recipientStudentId, isRead);
        CREATE INDEX IF NOT EXISTS idx_notifications_post ON notifications(postId);
        CREATE INDEX IF NOT EXISTS idx_notifications_comment ON notifications(commentId);
      `);
    } catch (_) {}

    const alterCols = [
      'ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actorId TEXT REFERENCES students(studentId) ON DELETE SET NULL',
      'ALTER TABLE notifications ADD COLUMN IF NOT EXISTS postId INTEGER REFERENCES posts(id) ON DELETE CASCADE',
      'ALTER TABLE notifications ADD COLUMN IF NOT EXISTS commentId INTEGER REFERENCES post_comments(id) ON DELETE CASCADE',
      'ALTER TABLE notifications ADD COLUMN IF NOT EXISTS replyId INTEGER REFERENCES post_comments(id) ON DELETE CASCADE',
      'ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reactionType TEXT'
    ];
    for (const sql of alterCols) {
      try {
        await exec(sql);
      } catch (_) {}
    }
  } else {
    try {
      await exec(`
        CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recipientStudentId TEXT NOT NULL,
          type TEXT NOT NULL,
          relatedFileId INTEGER,
          actorId TEXT,
          postId INTEGER,
          commentId INTEGER,
          replyId INTEGER,
          reactionType TEXT,
          message TEXT NOT NULL,
          isRead INTEGER DEFAULT 0,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (recipientStudentId) REFERENCES students(studentId) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipientStudentId);
        CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread ON notifications(recipientStudentId, isRead);
        CREATE INDEX IF NOT EXISTS idx_notifications_post ON notifications(postId);
        CREATE INDEX IF NOT EXISTS idx_notifications_comment ON notifications(commentId);
      `);
    } catch (_) {}

    const alterCols = [
      'ALTER TABLE notifications ADD COLUMN actorId TEXT',
      'ALTER TABLE notifications ADD COLUMN postId INTEGER',
      'ALTER TABLE notifications ADD COLUMN commentId INTEGER',
      'ALTER TABLE notifications ADD COLUMN replyId INTEGER',
      'ALTER TABLE notifications ADD COLUMN reactionType TEXT'
    ];
    for (const sql of alterCols) {
      try {
        await exec(sql);
      } catch (_) {}
    }
  }

  // Chat @mentions table — links messages to mentioned students
  if (isPostgres) {
    await exec(`
      CREATE TABLE IF NOT EXISTS chat_message_mentions (
        id SERIAL PRIMARY KEY,
        message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
        mentioned_student_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
        handle TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(message_id, mentioned_student_id)
      );
      CREATE INDEX IF NOT EXISTS idx_chat_mentions_message ON chat_message_mentions(message_id);
      CREATE INDEX IF NOT EXISTS idx_chat_mentions_student ON chat_message_mentions(mentioned_student_id);
    `);
    await exec('ALTER TABLE chat_message_mentions ADD COLUMN IF NOT EXISTS handle TEXT');
  } else {
    await exec(`
      CREATE TABLE IF NOT EXISTS chat_message_mentions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        mentioned_student_id TEXT NOT NULL,
        handle TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
        FOREIGN KEY (mentioned_student_id) REFERENCES students(studentId) ON DELETE CASCADE,
        UNIQUE(message_id, mentioned_student_id)
      );
      CREATE INDEX IF NOT EXISTS idx_chat_mentions_message ON chat_message_mentions(message_id);
      CREATE INDEX IF NOT EXISTS idx_chat_mentions_student ON chat_message_mentions(mentioned_student_id);
    `);
    try {
      await exec('ALTER TABLE chat_message_mentions ADD COLUMN handle TEXT');
    } catch (err) {
      const msg = (err?.message || '').toLowerCase();
      if (!msg.includes('duplicate column') && !msg.includes('already exists')) {
        throw err;
      }
    }
  }
}

/**
 * Atomically registers or reassigns an Expo push token to the authenticated student account.
 */
async function registerDeviceToken(db, { studentId, expoPushToken, platform = 'unknown', deviceName = null }) {
  if (!studentId) throw new Error('Authenticated studentId is required.');
  const trimmedToken = (expoPushToken || '').trim();
  if (!isValidExpoPushToken(trimmedToken)) {
    throw new Error('Invalid Expo push token format.');
  }

  const cleanPlatform = String(platform || 'unknown').toLowerCase().substring(0, 20);
  const cleanName = deviceName ? String(deviceName).trim().substring(0, 100) : null;

  if (db.isPostgres) {
    await db.run(`
      INSERT INTO student_device_tokens (expo_push_token, student_id, platform, device_name, updated_at, last_used_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (expo_push_token)
      DO UPDATE SET
        student_id = EXCLUDED.student_id,
        platform = EXCLUDED.platform,
        device_name = EXCLUDED.device_name,
        updated_at = CURRENT_TIMESTAMP,
        last_used_at = CURRENT_TIMESTAMP
    `, trimmedToken, studentId, cleanPlatform, cleanName);
  } else {
    await db.run(`
      INSERT INTO student_device_tokens (expo_push_token, student_id, platform, device_name, updated_at, last_used_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT (expo_push_token)
      DO UPDATE SET
        student_id = excluded.student_id,
        platform = excluded.platform,
        device_name = excluded.device_name,
        updated_at = datetime('now'),
        last_used_at = datetime('now')
    `, trimmedToken, studentId, cleanPlatform, cleanName);
  }

  return { success: true };
}

/**
 * Unregisters a push token for a specific student.
 */
async function unregisterDeviceToken(db, { studentId, expoPushToken }) {
  if (!studentId || !expoPushToken) return { success: false, changes: 0 };
  const trimmedToken = expoPushToken.trim();

  const res = await db.run(`
    DELETE FROM student_device_tokens
    WHERE expo_push_token = ? AND student_id = ?
  `, trimmedToken, studentId);

  return { success: true, changes: res.changes || 0 };
}

/**
 * Fetches notification preferences for a student.
 */
async function getNotificationPreferences(db, studentId) {
  if (!studentId) return normalizePreferences(null);
  const row = await db.get(`
    SELECT * FROM student_notification_preferences WHERE student_id = ?
  `, studentId);
  return normalizePreferences(row);
}

/**
 * Updates notification preferences for a student.
 */
async function updateNotificationPreferences(db, studentId, prefs = {}) {
  if (!studentId) throw new Error('studentId is required.');
  const current = await getNotificationPreferences(db, studentId);

  const merged = {
    muteChat: prefs.muteChat !== undefined ? Boolean(prefs.muteChat) : current.muteChat,
    notifyNotes: prefs.notifyNotes !== undefined ? Boolean(prefs.notifyNotes) : current.notifyNotes,
    notifyPosts: prefs.notifyPosts !== undefined ? Boolean(prefs.notifyPosts) : current.notifyPosts,
    notifyNotices: prefs.notifyNotices !== undefined ? Boolean(prefs.notifyNotices) : current.notifyNotices,
    hideLockscreenPreview: prefs.hideLockscreenPreview !== undefined ? Boolean(prefs.hideLockscreenPreview) : current.hideLockscreenPreview,
  };

  if (db.isPostgres) {
    await db.run(`
      INSERT INTO student_notification_preferences
        (student_id, mute_chat, notify_notes, notify_posts, notify_notices, hide_lockscreen_preview, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (student_id)
      DO UPDATE SET
        mute_chat = EXCLUDED.mute_chat,
        notify_notes = EXCLUDED.notify_notes,
        notify_posts = EXCLUDED.notify_posts,
        notify_notices = EXCLUDED.notify_notices,
        hide_lockscreen_preview = EXCLUDED.hide_lockscreen_preview,
        updated_at = CURRENT_TIMESTAMP
    `, studentId, merged.muteChat, merged.notifyNotes, merged.notifyPosts, merged.notifyNotices, merged.hideLockscreenPreview);
  } else {
    await db.run(`
      INSERT INTO student_notification_preferences
        (student_id, mute_chat, notify_notes, notify_posts, notify_notices, hide_lockscreen_preview, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT (student_id)
      DO UPDATE SET
        mute_chat = excluded.mute_chat,
        notify_notes = excluded.notify_notes,
        notify_posts = excluded.notify_posts,
        notify_notices = excluded.notify_notices,
        hide_lockscreen_preview = excluded.hide_lockscreen_preview,
        updated_at = datetime('now')
    `, studentId, merged.muteChat ? 1 : 0, merged.notifyNotes ? 1 : 0, merged.notifyPosts ? 1 : 0, merged.notifyNotices ? 1 : 0, merged.hideLockscreenPreview ? 1 : 0);
  }

  return merged;
}

/**
 * Enqueues a notification into the durable outbox table.
 * Idempotency key guarantees duplicate prevention across retries.
 */
async function enqueuePushNotification(db, { eventType, eventId, recipientStudentId, payload, idempotencyKey }) {
  if (!eventType || !eventId || !recipientStudentId || !payload || !idempotencyKey) {
    return { enqueued: false, reason: 'Missing required notification parameters.' };
  }

  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

  try {
    if (db.isPostgres) {
      await db.run(`
        INSERT INTO push_notification_outbox
          (event_type, event_id, recipient_student_id, payload_json, idempotency_key, status, next_attempt_at)
        VALUES (?, ?, ?, ?::jsonb, ?, 'pending', CURRENT_TIMESTAMP)
        ON CONFLICT (idempotency_key) DO NOTHING
      `, eventType, String(eventId), recipientStudentId, payloadStr, idempotencyKey);
    } else {
      await db.run(`
        INSERT OR IGNORE INTO push_notification_outbox
          (event_type, event_id, recipient_student_id, payload_json, idempotency_key, status, next_attempt_at)
        VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))
      `, eventType, String(eventId), recipientStudentId, payloadStr, idempotencyKey);
    }
    return { enqueued: true };
  } catch (err) {
    console.warn('[Push Outbox Enqueue Warning]:', err.message);
    return { enqueued: false, error: err.message };
  }
}

/**
 * Sends a batch of message objects to the Expo Push Service HTTP/2 API.
 * Supports up to 100 messages per request per Expo specification.
 */
async function sendExpoPushBatch(messages, options = {}) {
  if (!messages || messages.length === 0) return { tickets: [], error: null };

  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Accept-Encoding': 'gzip, deflate',
  };

  if (process.env.EXPO_ACCESS_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  }

  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 4000);
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
    ? AbortSignal.timeout(timeoutMs)
    : undefined;

  const tFetchStart = Date.now();
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(messages),
      signal,
    });

    const expoHttpMs = Date.now() - tFetchStart;
    const data = await res.json().catch(() => ({}));
    if (res.status === 200 && Array.isArray(data.data)) {
      return { tickets: data.data, status: 200, error: null, expoHttpMs };
    }

    return {
      tickets: [],
      status: res.status,
      error: data.errors?.[0]?.message || `Expo Push API returned status ${res.status}`,
      expoHttpMs,
    };
  } catch (netErr) {
    return { tickets: [], status: 0, error: netErr.message, expoHttpMs: Date.now() - tFetchStart };
  }
}

/**
 * Processes pending items from push_notification_outbox.
 * Batches tokens, verifies student preferences, delivers via Expo, and logs tickets.
 */
async function processPushOutbox(db, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 500);

  let sql = `
    SELECT o.*
    FROM push_notification_outbox o
    WHERE o.status = 'pending' AND o.next_attempt_at <= CURRENT_TIMESTAMP
  `;
  const params = [];
  // The reserved namespace works on old schemas too and keeps cohort jobs
  // from occupying the legacy worker's limited batch indefinitely.
  if (!options.chatRoomFence) sql += " AND o.idempotency_key NOT LIKE 'cohort-chat:%'";
  if (options.onlyOutboxId !== undefined) {
    sql += ' AND o.id = ?';
    params.push(options.onlyOutboxId);
  }
  if (options.recipientStudentId) {
    sql += ' AND o.recipient_student_id = ?';
    params.push(options.recipientStudentId);
  }
  if (options.eventType && !options.eventId) {
    sql += ' AND o.event_type = ?';
    params.push(options.eventType);
  }

  if (options.eventId && options.eventType) {
    sql += ' AND o.event_type = ? AND o.event_id = ?';
    params.push(options.eventType, String(options.eventId));
    sql += ' ORDER BY o.id ASC LIMIT ?';
    params.push(limit);
  } else if (options.eventId) {
    sql += ' AND o.event_id = ?';
    params.push(String(options.eventId));
    sql += ' ORDER BY o.id ASC LIMIT ?';
    params.push(limit);
  } else if (options.eventType) {
    sql += ' AND o.event_type = ?';
    params.push(options.eventType);
    sql += ' ORDER BY o.id ASC LIMIT ?';
    params.push(limit);
  } else {
    sql += ' ORDER BY o.id ASC LIMIT ?';
    params.push(limit);
  }

  // Existing cron/fast-path workers cannot deliver cohort jobs without the
  // room transaction held by cohort-chat.deliverPush. Works before migration too.
  const pendingRows = (await db.all(sql, ...params)).filter(row => {
    if (!row.chat_group_id) return !options.chatRoomFence;
    const fence = options.chatRoomFence;
    return fence && row.chat_group_id === fence.chatGroupId &&
      Number(row.realtime_epoch) === fence.realtimeEpoch && row.id === options.onlyOutboxId;
  });

  if (!pendingRows || pendingRows.length === 0) {
    return { processed: 0, sent: 0, skipped: 0, failed: 0, expoHttpMs: 0 };
  }

  let sentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let lastExpoHttpMs = 0;

  const uniqueRecipientIds = Array.from(new Set(pendingRows.map(r => r.recipient_student_id)));

  // Batch-load preferences and device tokens in 2 queries concurrently
  const placeholders = uniqueRecipientIds.map(() => '?').join(',');
  const [prefRows, tokenRows] = await Promise.all([
    uniqueRecipientIds.length > 0
      ? db.all(`SELECT student_id, mute_chat, notify_notes, notify_posts, notify_notices, hide_lockscreen_preview FROM student_notification_preferences WHERE student_id IN (${placeholders})`, ...uniqueRecipientIds)
      : [],
    uniqueRecipientIds.length > 0
      ? db.all(`SELECT expo_push_token, platform, student_id FROM student_device_tokens WHERE student_id IN (${placeholders})`, ...uniqueRecipientIds)
      : []
  ]);

  const prefMap = new Map();
  for (const pr of prefRows) {
    prefMap.set(pr.student_id, normalizePreferences(pr));
  }

  const tokenMap = new Map();
  for (const tr of tokenRows) {
    if (!tokenMap.has(tr.student_id)) tokenMap.set(tr.student_id, []);
    tokenMap.get(tr.student_id).push(tr);
  }

  const skippedIds = [];
  const noTokenIds = [];
  const deliverableJobs = [];

  for (const job of pendingRows) {
    // 1. Check student notification preferences
    const prefs = prefMap.get(job.recipient_student_id) || normalizePreferences(null);

    if (job.event_type === 'chat' && prefs.muteChat) {
      skippedIds.push(job.id);
      continue;
    }
    if (job.event_type === 'material' && !prefs.notifyNotes) {
      skippedIds.push(job.id);
      continue;
    }
    if ((job.event_type === 'post' || job.event_type === 'post_comment' || job.event_type === 'comment_reply' || job.event_type === 'comment_reaction') && !prefs.notifyPosts) {
      skippedIds.push(job.id);
      continue;
    }
    if (job.event_type === 'notice' && !prefs.notifyNotices) {
      skippedIds.push(job.id);
      continue;
    }

    // 2. Fetch device tokens for recipient
    const tokens = tokenMap.get(job.recipient_student_id) || [];
    if (tokens.length === 0) {
      noTokenIds.push(job.id);
      continue;
    }

    deliverableJobs.push({ job, tokens, prefs });
  }

  // Batch update skipped and no_tokens jobs concurrently
  const updatePromises = [];
  if (skippedIds.length > 0) {
    const p = skippedIds.map(() => '?').join(',');
    updatePromises.push(db.run(`UPDATE push_notification_outbox SET status = 'skipped', sent_at = CURRENT_TIMESTAMP WHERE id IN (${p})`, ...skippedIds));
    skippedCount += skippedIds.length;
  }
  if (noTokenIds.length > 0) {
    const p = noTokenIds.map(() => '?').join(',');
    updatePromises.push(db.run(`UPDATE push_notification_outbox SET status = 'no_tokens', sent_at = CURRENT_TIMESTAMP WHERE id IN (${p})`, ...noTokenIds));
    skippedCount += noTokenIds.length;
  }
  if (updatePromises.length > 0) {
    await Promise.all(updatePromises);
  }

  // Batch deliverable messages across jobs to minimize HTTP round-trips
  const allMessageItems = [];
  for (const { job, tokens, prefs } of deliverableJobs) {
    let payloadObj = {};
    try {
      payloadObj = typeof job.payload_json === 'string' ? JSON.parse(job.payload_json) : (job.payload_json || {});
    } catch (_) {
      payloadObj = {};
    }

    // Derive appropriate Android notification channel based on event_type
    let resolvedChannelId = payloadObj.channelId;
    if (!resolvedChannelId) {
      if (job.event_type === 'chat') resolvedChannelId = 'chat';
      else if (job.event_type === 'material') resolvedChannelId = 'academic';
      else if (job.event_type === 'post' || job.event_type === 'post_comment' || job.event_type === 'comment_reply' || job.event_type === 'comment_reaction') resolvedChannelId = 'social';
      else if (job.event_type === 'notice') resolvedChannelId = 'notices';
      else resolvedChannelId = 'academic';
    }

    // Balanced Android importance / priority per category: chat and notices get high priority for immediate FCM wake
    const isHighPriority = job.event_type === 'notice' || job.event_type === 'chat' || payloadObj.priority === 'high';
    const resolvedPriority = isHighPriority ? 'high' : 'default';

    // Privacy-safe lock screen masking when enabled by user
    let displayTitle = payloadObj.title || 'Semester Library';
    let displayBody = payloadObj.body || 'New notification';
    if (prefs && prefs.hideLockscreenPreview) {
      if (job.event_type === 'chat') {
        displayTitle = 'BIT Group Chat';
        displayBody = 'New message';
      } else if (job.event_type === 'post') {
        displayTitle = 'Semester Library';
        displayBody = 'You have a new post';
      } else if (job.event_type === 'post_comment' || job.event_type === 'comment_reply') {
        displayTitle = 'New comment';
        displayBody = 'Open Semester Library to view it';
      } else if (job.event_type === 'comment_reaction') {
        displayTitle = 'New reaction';
        displayBody = 'Open Semester Library to view it';
      } else if (job.event_type === 'material') {
        displayTitle = 'Semester Library';
        displayBody = 'New study material is available';
      } else if (job.event_type === 'notice') {
        displayTitle = 'Semester Library';
        displayBody = 'You have a new official notice';
      } else {
        displayTitle = 'Semester Library';
        displayBody = 'You have a new notification';
      }
    }

    const isRepetitiveSocial = job.event_type === 'post_comment' || job.event_type === 'comment_reply' || job.event_type === 'comment_reaction' || job.event_type === 'post_reaction';
    const targetPostId = payloadObj.data?.postId || payloadObj.data?.entityId;

    let groupKey = payloadObj.groupKey;
    let collapseId = payloadObj.collapseId;

    if (!groupKey) {
      if (job.event_type === 'chat') {
        const chatGroupId = payloadObj.data?.chatGroupId || 'bit';
        groupKey = `chat:${chatGroupId}`;
        collapseId = `chat:${chatGroupId}`;
      } else if (isRepetitiveSocial && targetPostId) {
        groupKey = `post:${targetPostId}`;
        collapseId = `post:${targetPostId}`;
      }
      // For security alerts, official notices, and general academic events:
      // groupKey and collapseId remain undefined so they never collapse incorrectly into each other.
    }

    const tag = payloadObj.tag || (job.event_type === 'chat' ? `chat_msg_${job.event_id}` : undefined);

    for (const t of tokens) {
      const msg = {
        to: t.expo_push_token,
        sound: 'default',
        title: displayTitle,
        body: displayBody,
        data: payloadObj.data || {},
        channelId: resolvedChannelId,
        priority: resolvedPriority,
      };
      if (collapseId) msg.collapseId = collapseId;
      if (groupKey) msg.groupKey = groupKey;
      if (tag) msg.tag = tag;
      if (payloadObj.threadId) msg.threadId = payloadObj.threadId;

      allMessageItems.push({
        msg,
        job,
        token: t.expo_push_token,
      });
    }
  }

  // Send in chunks of up to 100 per Expo specification
  const CHUNK_SIZE = 100;
  for (let c = 0; c < allMessageItems.length; c += CHUNK_SIZE) {
    const chunk = allMessageItems.slice(c, c + CHUNK_SIZE);
    const messages = chunk.map(item => item.msg);

    try {
      const { tickets, status: httpStatus, error, expoHttpMs } = await (options.sendBatch || sendExpoPushBatch)(messages, { timeoutMs: options.timeoutMs });
      if (typeof expoHttpMs === 'number') lastExpoHttpMs = expoHttpMs;

      if (tickets && tickets.length > 0) {
        const successfulJobIds = new Set();
        const pendingTicketValues = [];
        const pendingTicketParams = [];

        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];
          const item = chunk[i];
          if (!ticket || !item) continue;

          const maskedToken = item.token ? (item.token.substring(0, 15) + '...' + item.token.slice(-5)) : 'N/A';
          console.log(`[PUSH-DIAG-EXPO-TICKET] Job ${item.job.id} (recipient: ${item.job.recipient_student_id}): ticketStatus=${ticket.status}, ticketId=${ticket.id || 'N/A'}, token=${maskedToken}`);

          if (ticket.status === 'ok' && ticket.id) {
            successfulJobIds.add(item.job.id);
            pendingTicketValues.push('(?, ?, ?, ?)');
            pendingTicketParams.push(ticket.id, item.token, item.job.id, 'pending');
          } else if (ticket.status === 'error') {
            const errCode = ticket.details?.error || 'UNKNOWN_ERROR';
            const errMsg = ticket.message || 'Push delivery error';

            if (errCode === 'DeviceNotRegistered') {
              console.log(`[Push Notification]: Removing invalid token ${item.token} (DeviceNotRegistered)`);
              await db.run('DELETE FROM student_device_tokens WHERE expo_push_token = ?', item.token);
            }

            if (ticket.id) {
              pendingTicketValues.push('(?, ?, ?, ?)');
              pendingTicketParams.push(ticket.id, item.token, item.job.id, 'error');
            }
          }
        }

        // Batch insert push receipt tickets in a single query
        if (pendingTicketValues.length > 0) {
          if (db.isPostgres) {
            await db.run(`
              INSERT INTO push_receipt_tickets (ticket_id, expo_push_token, outbox_id, status)
              VALUES ${pendingTicketValues.join(', ')}
              ON CONFLICT (ticket_id) DO NOTHING RETURNING ticket_id
            `, ...pendingTicketParams);
          } else {
            await db.run(`
              INSERT OR IGNORE INTO push_receipt_tickets (ticket_id, expo_push_token, outbox_id, status)
              VALUES ${pendingTicketValues.join(', ')}
            `, ...pendingTicketParams);
          }
        }

        // Mark jobs with successful ticket(s) as 'sent'
        if (successfulJobIds.size > 0) {
          const ids = Array.from(successfulJobIds);
          const p = ids.map(() => '?').join(',');
          await db.run(`UPDATE push_notification_outbox SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id IN (${p})`, ...ids);
          sentCount += ids.length;

          // Sync sent status to notification_recipients
          try {
            for (const item of chunk) {
              if (successfulJobIds.has(item.job.id)) {
                let notifId = null;
                try {
                  const pJson = typeof item.job.payload_json === 'string' ? JSON.parse(item.job.payload_json) : item.job.payload_json;
                  notifId = pJson?.data?.notificationId;
                } catch (_) {}
                if (notifId) {
                  await db.run(
                    `UPDATE notification_recipients SET push_status = 'sent', push_sent_at = CURRENT_TIMESTAMP WHERE notification_id = ? AND user_id = ? AND push_status != 'delivered'`,
                    String(notifId),
                    item.job.recipient_student_id
                  );
                }
              }
            }
          } catch (_) {}
        }

        // For any jobs in this chunk where NO tokens succeeded:
        const chunkJobMap = new Map();
        for (const item of chunk) {
          if (!chunkJobMap.has(item.job.id)) chunkJobMap.set(item.job.id, item.job);
        }
        for (const [jobId, job] of chunkJobMap.entries()) {
          if (!successfulJobIds.has(jobId)) {
            const newAttempts = Number(job.attempts || 0) + 1;
            if (newAttempts >= 5) {
              await db.run("UPDATE push_notification_outbox SET status = 'failed', attempts = ? WHERE id = ?", newAttempts, jobId);
              failedCount++;

              try {
                let notifId = null;
                try {
                  const pJson = typeof job.payload_json === 'string' ? JSON.parse(job.payload_json) : job.payload_json;
                  notifId = pJson?.data?.notificationId;
                } catch (_) {}
                if (notifId) {
                  await db.run(
                    `UPDATE notification_recipients SET push_status = 'failed' WHERE notification_id = ? AND user_id = ? AND push_status NOT IN ('delivered', 'sent')`,
                    String(notifId),
                    job.recipient_student_id
                  );
                }
              } catch (_) {}
            } else {
              const backoffSec = Math.min(300, Math.pow(2, newAttempts) * 10);
              if (db.isPostgres) {
                await db.run(`
                  UPDATE push_notification_outbox
                  SET attempts = ?, next_attempt_at = CURRENT_TIMESTAMP + make_interval(secs => ?)
                  WHERE id = ?
                `, newAttempts, backoffSec, jobId);
              } else {
                await db.run(`
                  UPDATE push_notification_outbox
                  SET attempts = ?, next_attempt_at = datetime('now', '+' || ? || ' seconds')
                  WHERE id = ?
                `, newAttempts, backoffSec, jobId);
              }
              failedCount++;
            }
          }
        }
      } else {
        // Complete failure of the chunk (network error, timeout, or 5xx)
        const chunkJobMap = new Map();
        for (const item of chunk) {
          if (!chunkJobMap.has(item.job.id)) chunkJobMap.set(item.job.id, item.job);
        }
        for (const [jobId, job] of chunkJobMap.entries()) {
          const newAttempts = Number(job.attempts || 0) + 1;
          if (newAttempts >= 5) {
            await db.run("UPDATE push_notification_outbox SET status = 'failed', attempts = ? WHERE id = ?", newAttempts, jobId);
            failedCount++;
          } else {
            const backoffSec = Math.min(300, Math.pow(2, newAttempts) * 10);
            if (db.isPostgres) {
              await db.run(`
                UPDATE push_notification_outbox
                SET attempts = ?, next_attempt_at = CURRENT_TIMESTAMP + make_interval(secs => ?)
                WHERE id = ?
              `, newAttempts, backoffSec, jobId);
            } else {
              await db.run(`
                UPDATE push_notification_outbox
                SET attempts = ?, next_attempt_at = datetime('now', '+' || ? || ' seconds')
                WHERE id = ?
              `, newAttempts, backoffSec, jobId);
            }
            failedCount++;
          }
        }
      }
    } catch (chunkErr) {
      console.error('[Push Notification Batch Chunk Error]:', chunkErr.message);
      failedCount++;
    }
  }

  return { processed: pendingRows.length, sent: sentCount, skipped: skippedCount, failed: failedCount, expoHttpMs: lastExpoHttpMs || 0 };
}

/**
 * Synchronously attempts bounded outbox dispatch within the primary HTTP request.
 * Dispatches the newly enqueued event jobs (plus any overdue pending rows up to limit).
 * Strictly bounded by timeoutMs (default: 3500ms).
 * Wrapped in safe try-catch: failures/timeouts leave jobs pending and NEVER throw or fail primary action.
 */
async function dispatchImmediateOutbox(db, options = {}) {
  if (process.env.DISABLE_IMMEDIATE_PUSH_DISPATCH === '1') {
    return { skipped: true, reason: 'Immediate push dispatch disabled by environment' };
  }

  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 3500);
  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 250);

  const tStart = Date.now();
  try {
    const res = await processPushOutbox(db, {
      ...options,
      timeoutMs,
      limit,
    });

    // Opportunistically sweep overdue retries from other events that are now ready for re-attempt
    // within the remaining request budget (zero detached post-response timers).
    if (options.eventId && options.eventType) {
      try {
        await processPushOutbox(db, { limit: 20, timeoutMs: 1500 }).catch(() => {});
      } catch (_) {}
    }


    return {
      ...res,
      dispatchDurationMs: Date.now() - tStart,
    };
  } catch (err) {
    console.warn(`[Push Immediate Dispatch Warning for ${options.eventType || 'event'}:${options.eventId || ''}]:`, err.message);
    return { processed: 0, sent: 0, skipped: 0, failed: 0, error: err.message, dispatchDurationMs: Date.now() - tStart };
  }
}


/**
 * Fetches and processes delivery receipts from Expo for previously issued tickets.
 * Automatically cleans up invalid device tokens (DeviceNotRegistered).
 */
async function processPushReceipts(db, options = {}) {
  const minAgeSeconds = options.minAgeSeconds !== undefined ? Number(options.minAgeSeconds) : 900; // 15 mins default
  const limit = Math.min(Math.max(Number(options.limit) || 1000, 1), 1000);

  let pendingTickets = [];
  if (db.isPostgres) {
    pendingTickets = await db.all(`
      SELECT ticket_id, expo_push_token, created_at
      FROM push_receipt_tickets
      WHERE status = 'pending' AND created_at <= (CURRENT_TIMESTAMP - make_interval(secs => ?))
      ORDER BY created_at DESC
      LIMIT ?
    `, minAgeSeconds, limit);
  } else {
    pendingTickets = await db.all(`
      SELECT ticket_id, expo_push_token, created_at
      FROM push_receipt_tickets
      WHERE status = 'pending' AND created_at <= datetime('now', '-' || ? || ' seconds')
      ORDER BY created_at DESC
      LIMIT ?
    `, minAgeSeconds, limit);
  }

  if (!pendingTickets || pendingTickets.length === 0) {
    return { checked: 0, unregisteredTokensPruned: 0 };
  }

  const ticketIds = pendingTickets.map(t => t.ticket_id);
  const tokenMap = new Map();
  const ticketMetaMap = new Map();
  pendingTickets.forEach(t => {
    tokenMap.set(t.ticket_id, t.expo_push_token);
    ticketMetaMap.set(t.ticket_id, t);
  });

  let unregisteredPruned = 0;
  let checkedCount = 0;

  try {
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    };
    if (process.env.EXPO_ACCESS_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    }

    const res = await fetch(EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids: ticketIds }),
    });

    const json = await res.json().catch(() => ({}));
    const receipts = json.data || {};

    for (const ticketId of ticketIds) {
      const receipt = receipts[ticketId];
      if (!receipt) {
        // Expo only retains receipts for 24 hours.
        // If ticket is older than 24 hours and Expo returned no receipt, mark it unconfirmed_expired
        const meta = ticketMetaMap.get(ticketId);
        if (meta && meta.created_at) {
          const ageMs = Date.now() - new Date(meta.created_at).getTime();
          if (ageMs > 24 * 60 * 60 * 1000) {
            await db.run(`
              UPDATE push_receipt_tickets
              SET status = 'unconfirmed_expired', checked_at = CURRENT_TIMESTAMP
              WHERE ticket_id = ?
            `, ticketId);
            checkedCount++;
          }
        }
        continue;
      }

      checkedCount++;
      if (receipt.status === 'ok') {
        await db.run(`
          UPDATE push_receipt_tickets
          SET status = 'ok', checked_at = CURRENT_TIMESTAMP
          WHERE ticket_id = ?
        `, ticketId);

        try {
          const ticketRow = await db.get(`
            SELECT o.recipient_student_id, o.payload_json
            FROM push_receipt_tickets t
            JOIN push_notification_outbox o ON t.outbox_id = o.id
            WHERE t.ticket_id = ?
          `, ticketId);
          if (ticketRow) {
            let notifId = null;
            try {
              const p = typeof ticketRow.payload_json === 'string' ? JSON.parse(ticketRow.payload_json) : ticketRow.payload_json;
              notifId = p?.data?.notificationId;
            } catch (_) {}
            if (notifId) {
              await db.run(
                `UPDATE notification_recipients SET push_status = 'delivered' WHERE notification_id = ? AND user_id = ?`,
                String(notifId), ticketRow.recipient_student_id
              );
            }
          }
        } catch (_) {}
      } else if (receipt.status === 'error') {
        const errCode = receipt.details?.error || 'UNKNOWN_ERROR';
        const errMsg = receipt.message || 'Delivery error';

        await db.run(`
          UPDATE push_receipt_tickets
          SET status = 'error', error_code = ?, error_message = ?, checked_at = CURRENT_TIMESTAMP
          WHERE ticket_id = ?
        `, errCode, errMsg, ticketId);

        let isUnregistered = false;
        if (errCode === 'DeviceNotRegistered') {
          isUnregistered = true;
          const badToken = tokenMap.get(ticketId);
          if (badToken) {
            console.log(`[Push Receipts]: Pruning unregistered token ${badToken}`);
            await db.run('DELETE FROM student_device_tokens WHERE expo_push_token = ?', badToken);
            unregisteredPruned++;
          }
        }

        try {
          const ticketRow = await db.get(`
            SELECT o.recipient_student_id, o.payload_json
            FROM push_receipt_tickets t
            JOIN push_notification_outbox o ON t.outbox_id = o.id
            WHERE t.ticket_id = ?
          `, ticketId);
          if (ticketRow) {
            let notifId = null;
            try {
              const p = typeof ticketRow.payload_json === 'string' ? JSON.parse(ticketRow.payload_json) : ticketRow.payload_json;
              notifId = p?.data?.notificationId;
            } catch (_) {}
            if (notifId) {
              await db.run(
                `UPDATE notification_recipients SET push_status = ? WHERE notification_id = ? AND user_id = ? AND push_status != 'delivered'`,
                isUnregistered ? 'invalid_token' : 'failed',
                String(notifId),
                ticketRow.recipient_student_id
              );
            }
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    console.error('[Push Receipts Process Error]:', err.message);
  }

  return { checked: checkedCount, unregisteredTokensPruned: unregisteredPruned };
}

/**
 * Enqueues a notification for multiple recipients with batched SQL insertion.
 * Respects idempotency keys (${idempotencyKeyPrefix || eventType}:${eventId}:${recipientStudentId}).
 */
async function enqueuePushForRecipients(db, {
  eventType,
  eventId,
  recipientStudentIds,
  payload,
  idempotencyKeyPrefix = eventType
}) {
  if (!eventType || !eventId || !recipientStudentIds || !payload) {
    return { enqueuedCount: 0 };
  }

  // De-duplicate recipient IDs
  const uniqueRecipients = Array.from(new Set(
    (Array.isArray(recipientStudentIds) ? recipientStudentIds : [recipientStudentIds])
      .map(id => String(id).trim())
      .filter(Boolean)
  ));

  if (uniqueRecipients.length === 0) {
    return { enqueuedCount: 0 };
  }

  // Filter recipients to ONLY students who currently possess at least one valid registered device token.
  // This prevents outbox bloat and prevents tokenless students from starving actual mobile users
  // under bounded synchronous dispatch windows.
  const activeStudentIds = new Set();
  const FILTER_CHUNK = 200;
  for (let i = 0; i < uniqueRecipients.length; i += FILTER_CHUNK) {
    const chunk = uniqueRecipients.slice(i, i + FILTER_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    try {
      const tokenHolders = await db.all(
        `SELECT DISTINCT student_id FROM student_device_tokens WHERE student_id IN (${placeholders})`,
        ...chunk
      );
      if (Array.isArray(tokenHolders)) {
        for (const th of tokenHolders) {
          const sid = th.student_id || th.studentid;
          if (sid) activeStudentIds.add(String(sid).trim());
        }
      }
    } catch (filterErr) {
      console.warn('[Push Recipient Device Filter Warning]:', filterErr.message);
    }
  }

  const activeRecipients = uniqueRecipients.filter(id => activeStudentIds.has(id));
  if (activeRecipients.length === 0) {
    return { enqueuedCount: 0 };
  }

  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const CHUNK_SIZE = 250;
  let totalInserted = 0;

  for (let i = 0; i < activeRecipients.length; i += CHUNK_SIZE) {
    const chunk = activeRecipients.slice(i, i + CHUNK_SIZE);
    const valuePlaceholders = [];
    const params = [];

    for (const recipientId of chunk) {
      const idempotencyKey = `${idempotencyKeyPrefix}:${eventId}:${recipientId}`;
      valuePlaceholders.push("(?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)");
      params.push(eventType, String(eventId), recipientId, payloadStr, idempotencyKey);
    }

    try {
      if (db.isPostgres) {
        const sql = `
          INSERT INTO push_notification_outbox
            (event_type, event_id, recipient_student_id, payload_json, idempotency_key, status, next_attempt_at)
          VALUES ${valuePlaceholders.join(', ')}
          ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
        `;
        const res = await db.run(sql, ...params);
        totalInserted += res.changes || 0;
      } else {
        const sql = `
          INSERT OR IGNORE INTO push_notification_outbox
            (event_type, event_id, recipient_student_id, payload_json, idempotency_key, status, next_attempt_at)
          VALUES ${valuePlaceholders.join(', ')}
        `;
        const res = await db.run(sql, ...params);
        totalInserted += res.changes || 0;
      }
    } catch (err) {
      console.warn(`[Batch Push Enqueue Warning for ${eventType}]:`, err.message);
    }
  }

  return { enqueuedCount: totalInserted };
}

/**
 * Enqueues a group chat push notification immediately for each authorized group recipient.
 * Formats every message with:
 *   Title: 'BIT Group Chat'
 *   Body: '<Student Name>: <Actual Message>'
 * (or '<Student Name>: 📷 Photo' / '<Student Name>: 📎 File' for attachment-only messages)
 * 
 * Excludes the sender.
 * Never throttles or delays chat into generic counters ('2 new messages', '5 new messages').
 * Uses collapseId = 'chat_group_bit', groupKey = 'chat_group_bit', tag = 'chat_group_bit'
 * so Android updates the active conversation notification in-place.
 */
async function enqueueChatPushWithThrottle(db, options = {}) {
  const { messageId, senderStudentId, senderName } = options;
  if (!messageId || !senderStudentId) return { enqueuedCount: 0 };

  let messageText = options.text;
  let mimeType = options.attachmentMimeType;
  if (messageText === undefined && messageId) {
    const msg = await db.get('SELECT text, attachmentMimeType, attachmentOriginalName FROM chat_messages WHERE id = ?', messageId);
    if (msg) {
      messageText = msg.text;
      mimeType = msg.attachmentMimeType || msg.attachment_mime_type;
    }
  }

  let resolvedSenderName = senderName ? senderName.trim() : null;
  if (!resolvedSenderName && senderStudentId) {
    const sender = await db.get('SELECT name FROM students WHERE studentId = ?', senderStudentId);
    if (sender?.name) resolvedSenderName = sender.name.trim();
  }
  const cleanSender = resolvedSenderName || 'Classmate';

  let previewContent = '';
  if (messageText && typeof messageText === 'string' && messageText.trim().length > 0) {
    previewContent = buildNotificationPreview(messageText, 140);
  } else if (mimeType && typeof mimeType === 'string' && mimeType.startsWith('image/')) {
    previewContent = '📷 Photo';
  } else if (mimeType || options.attachmentOriginalName) {
    previewContent = '📎 File';
  } else {
    previewContent = 'Sent a message';
  }

  // Determine if this message has @mentions → targeted notifications
  const mentionedStudentIds = Array.isArray(options.mentionedStudentIds) ? options.mentionedStudentIds : [];
  const hasMentions = mentionedStudentIds.length > 0;

  let recipientIds;
  let notificationTitle;
  let fullBody;

  if (hasMentions) {
    // TARGETED: only mentioned students receive the push (excluding sender)
    recipientIds = Array.from(new Set(
      mentionedStudentIds
        .map(id => String(id).trim())
        .filter(id => id && id !== String(senderStudentId))
    ));
    notificationTitle = 'BIT Group Chat — You were mentioned';
    fullBody = `${cleanSender} mentioned you: ${previewContent}`;
  } else {
    // BROADCAST: all eligible students except sender (existing behavior)
    const CHAT_ELIGIBILITY_SQL = `(COALESCE(department, 'BIT') IN ('BIT', 'B.Sc. CSIT', 'CSIT') AND (role IS NULL OR role NOT IN ('blocked', 'banned', 'suspended')))`;
    const recipients = await db.all(
      `SELECT studentId FROM students WHERE studentId != ? AND ${CHAT_ELIGIBILITY_SQL}`,
      senderStudentId
    );
    if (!recipients || recipients.length === 0) return { enqueuedCount: 0 };
    recipientIds = recipients.map(r => r.studentId);
    notificationTitle = 'BIT Group Chat';
    fullBody = `${cleanSender}: ${previewContent}`;
  }

  if (recipientIds.length === 0) return { enqueuedCount: 0 };

  const payloadObj = {
    title: notificationTitle,
    body: fullBody,
    data: {
      type: 'chat',
      subType: hasMentions ? 'mention' : 'message',
      eventId: String(messageId),
      entityId: String(messageId),
      messageId: Number(messageId),
      actorId: String(senderStudentId),
      actorName: cleanSender,
      groupId: 'bit',
      groupName: 'BIT Group Chat',
      latestSender: cleanSender,
      latestMessage: previewContent,
      groupKey: 'chat_group_bit',
      tag: `chat_msg_${messageId}`,
      createdAt: new Date().toISOString()
    },
    priority: 'high',
    channelId: 'chat',
    groupKey: 'chat_group_bit',
    tag: `chat_msg_${messageId}`
  };

  try {
    const notifService = require('./notifications-service');
    await notifService.createNotification(db, {
      type: hasMentions ? 'mention' : 'chat_message',
      actorId: senderStudentId ? String(senderStudentId) : null,
      actorName: cleanSender,
      title: notificationTitle,
      body: fullBody,
      entityType: 'chat',
      entityId: options.chatGroupId || 'bit',
      secondaryEntityId: String(messageId),
      deepLink: `/(tabs)/chat?targetMessageId=${messageId}`,
      webPath: `chat.html#msg-${messageId}`,
      groupKey: hasMentions ? null : `chat:${options.chatGroupId || 'bit'}`,
      priority: hasMentions ? 'high' : 'normal',
      recipientUserIds: recipientIds,
      metadata: {
        chatGroupId: options.chatGroupId || 'bit',
        messageId: Number(messageId),
        preview: previewContent,
      },
      skipPush: true,
    });
  } catch (chatNotifErr) {
    console.warn('[Chat In-App Notification Error]:', chatNotifErr.message);
  }

  return await enqueuePushForRecipients(db, {
    eventType: 'chat',
    eventId: String(messageId),
    recipientStudentIds: recipientIds,
    payload: payloadObj,
    idempotencyKeyPrefix: hasMentions ? 'chat_mention' : 'chat'
  });
}

/**
 * Enqueues study material upload push notifications targeting only authorized semester students.
 * Excludes the uploader.
 */
async function enqueueMaterialPush(db, { fileId, originalName, title, semester, department, subject, uploaderStudentId, uploaderName, cohortId, audienceScope }) {
  if (!fileId) return { enqueuedCount: 0 };

  const { normalizeSemester } = require('./note-search');
  const targetSem = normalizeSemester(semester);

  let resolvedUploaderName = uploaderName;
  let resolvedDepartment = (department || '').trim();
  if ((!resolvedUploaderName || !resolvedDepartment) && uploaderStudentId) {
    try {
      const uploader = await db.get('SELECT name, department FROM students WHERE studentId = ?', uploaderStudentId);
      if (uploader?.name && !resolvedUploaderName) resolvedUploaderName = uploader.name;
      if (uploader?.department && !resolvedDepartment) resolvedDepartment = uploader.department.trim();
    } catch (_) {
      try {
        const uploader = await db.get('SELECT name FROM students WHERE studentId = ?', uploaderStudentId);
        if (uploader?.name && !resolvedUploaderName) resolvedUploaderName = uploader.name;
      } catch (__) {}
    }
  }

  const nonProgramDepts = new Set(['admin', 'administrator', 'teacher', 'faculty', 'staff', 'administration']);
  let cleanDept = resolvedDepartment ? resolvedDepartment.toLowerCase() : null;
  if (!cleanDept || nonProgramDepts.has(cleanDept)) {
    cleanDept = 'bit';
  }

  let recipients = [];
  let students = [];
  if (cohortId && audienceScope === 'cohort') {
    try {
      students = await db.all('SELECT studentId, semester, department FROM students WHERE cohort_id = ? AND studentId != ?', cohortId, uploaderStudentId || '');
    } catch (_) {
      students = await db.all('SELECT studentId, semester, department FROM students WHERE studentId != ?', uploaderStudentId || '');
    }
  } else {
    try {
      students = await db.all('SELECT studentId, semester, department FROM students WHERE studentId != ?', uploaderStudentId || '');
    } catch (_) {
      students = await db.all('SELECT studentId, semester FROM students WHERE studentId != ?', uploaderStudentId || '');
    }
  }

  recipients = students
    .filter(s => {
      if (!cohortId && targetSem !== null && normalizeSemester(s.semester) !== targetSem) return false;
      if (cleanDept && s.department && s.department.trim().toLowerCase() !== cleanDept) return false;
      return true;
    })
    .map(s => s.studentId);

  if (recipients.length === 0) return { enqueuedCount: 0 };

  const cleanSubject = (subject || '').trim();
  const cleanTitle = (title || originalName || '').trim();
  const displayTitle = cleanSubject ? buildNotificationPreview(cleanSubject, 80) : 'New study material';
  let displayBody = 'New study material uploaded.';
  if (cleanTitle && resolvedUploaderName) {
    displayBody = `${buildNotificationPreview(cleanTitle, 100)} uploaded by ${resolvedUploaderName}`;
  } else if (cleanTitle) {
    displayBody = `New notes: ${buildNotificationPreview(cleanTitle, 120)}`;
  } else if (resolvedUploaderName) {
    displayBody = `Uploaded by ${resolvedUploaderName}`;
  }

  const groupKey = 'material_' + (cleanSubject ? cleanSubject.toLowerCase().replace(/[^a-z0-9]+/g, '_') : 'general');
  const collapseId = 'material_' + String(fileId);

  const payload = {
    title: displayTitle,
    body: displayBody,
    data: {
      type: 'material',
      eventId: String(fileId),
      entityId: String(fileId),
      materialId: Number(fileId),
      fileId: Number(fileId),
      title: cleanTitle || 'New notes',
      subject: cleanSubject || null,
      semester: semester || null,
      department: resolvedDepartment || null,
      actorId: String(uploaderStudentId || ''),
      actorName: resolvedUploaderName || null,
      groupKey,
      collapseId,
      createdAt: new Date().toISOString()
    },
    channelId: 'academic',
    groupKey,
    collapseId
  };

  // Persist in-app notifications for each target recipient
  for (const recipientId of recipients) {
    await createInAppNotification(db, {
      recipientStudentId: recipientId,
      type: 'material',
      relatedFileId: Number(fileId),
      actorId: String(uploaderStudentId || ''),
      message: `${cleanSubject ? cleanSubject + ': ' : ''}${cleanTitle || 'New study material'}`
    });
  }

  return enqueuePushForRecipients(db, {
    eventType: 'material',
    eventId: String(fileId),
    recipientStudentIds: recipients,
    payload,
    idempotencyKeyPrefix: 'material'
  });
}

/**
 * Enqueues a single combined batch push notification for multi-file teacher uploads.
 * Idempotency key: material-batch:<batchId>:<recipientStudentId>
 * Strictly ensures only persisted files trigger a notification.
 */
async function enqueueMaterialBatchPush(db, {
  batchId,
  files,
  semester,
  department,
  subject,
  chapter,
  uploaderStudentId,
  uploaderName,
  cohortId,
  audienceScope
}) {
  if (!files || !Array.isArray(files) || files.length === 0) {
    return { enqueuedCount: 0 };
  }

  // Single file fallback -> delegate to standard single-material push
  if (files.length === 1) {
    return enqueueMaterialPush(db, {
      fileId: files[0].id,
      originalName: files[0].originalName,
      title: files[0].title,
      semester,
      department,
      subject,
      uploaderStudentId,
      uploaderName,
      cohortId,
      audienceScope
    });
  }

  const { normalizeSemester } = require('./note-search');
  const targetSem = normalizeSemester(semester);

  let resolvedUploaderName = uploaderName;
  let resolvedDepartment = (department || '').trim();
  if ((!resolvedUploaderName || !resolvedDepartment) && uploaderStudentId) {
    try {
      const uploader = await db.get('SELECT name, department FROM students WHERE studentId = ?', uploaderStudentId);
      if (uploader?.name && !resolvedUploaderName) resolvedUploaderName = uploader.name;
      if (uploader?.department && !resolvedDepartment) resolvedDepartment = uploader.department.trim();
    } catch (_) {
      try {
        const uploader = await db.get('SELECT name FROM students WHERE studentId = ?', uploaderStudentId);
        if (uploader?.name && !resolvedUploaderName) resolvedUploaderName = uploader.name;
      } catch (__) {}
    }
  }

  const nonProgramDepts = new Set(['admin', 'administrator', 'teacher', 'faculty', 'staff', 'administration']);
  let cleanDept = resolvedDepartment ? resolvedDepartment.toLowerCase() : null;
  if (!cleanDept || nonProgramDepts.has(cleanDept)) {
    cleanDept = 'bit';
  }

  let recipients = [];
  let students = [];
  if (cohortId && audienceScope === 'cohort') {
    try {
      students = await db.all('SELECT studentId, semester, department FROM students WHERE cohort_id = ? AND studentId != ?', cohortId, uploaderStudentId || '');
    } catch (_) {
      students = await db.all('SELECT studentId, semester, department FROM students WHERE studentId != ?', uploaderStudentId || '');
    }
  } else {
    try {
      students = await db.all('SELECT studentId, semester, department FROM students WHERE studentId != ?', uploaderStudentId || '');
    } catch (_) {
      students = await db.all('SELECT studentId, semester FROM students WHERE studentId != ?', uploaderStudentId || '');
    }
  }

  recipients = students
    .filter(s => {
      if (!cohortId && targetSem !== null && normalizeSemester(s.semester) !== targetSem) return false;
      if (cleanDept && s.department && s.department.trim().toLowerCase() !== cleanDept) return false;
      return true;
    })
    .map(s => s.studentId);

  if (recipients.length === 0) return { enqueuedCount: 0 };

  const count = files.length;
  const cleanSubject = (subject || '').trim();
  const cleanChapter = (chapter || '').trim();
  const displayTitle = cleanSubject ? buildNotificationPreview(cleanSubject, 80) : 'New study materials';

  let displayBody = `${count} new study materials uploaded.`;
  if (resolvedUploaderName && cleanChapter) {
    displayBody = `${resolvedUploaderName} uploaded ${count} new files to ${buildNotificationPreview(cleanChapter, 60)}`;
  } else if (resolvedUploaderName) {
    displayBody = `${resolvedUploaderName} uploaded ${count} new study materials`;
  } else if (cleanChapter) {
    displayBody = `${count} new files added to ${buildNotificationPreview(cleanChapter, 60)}`;
  }

  const stableBatchId = String(batchId || files[0]?.id || Date.now());
  const groupKey = 'material_' + (cleanSubject ? cleanSubject.toLowerCase().replace(/[^a-z0-9]+/g, '_') : 'general');
  const collapseId = 'material_batch_' + stableBatchId;

  const payload = {
    title: displayTitle,
    body: displayBody,
    data: {
      type: 'material_batch',
      batchId: stableBatchId,
      eventId: stableBatchId,
      materialCount: count,
      fileIds: files.map(f => Number(f.id)),
      subject: cleanSubject || null,
      semester: semester || null,
      chapter: cleanChapter || null,
      actorId: String(uploaderStudentId || ''),
      actorName: resolvedUploaderName || null,
      groupKey,
      collapseId,
      createdAt: new Date().toISOString()
    },
    channelId: 'academic',
    groupKey,
    collapseId
  };

  // Persist in-app notifications for each target recipient
  for (const recipientId of recipients) {
    await createInAppNotification(db, {
      recipientStudentId: recipientId,
      type: 'material_batch',
      relatedFileId: files[0]?.id ? Number(files[0].id) : null,
      actorId: String(uploaderStudentId || ''),
      message: `${count} new study materials uploaded in ${cleanSubject || semester || 'Library'}`
    });
  }

  return enqueuePushForRecipients(db, {
    eventType: 'material',
    eventId: stableBatchId,
    recipientStudentIds: recipients,
    payload,
    idempotencyKeyPrefix: 'material-batch'
  });
}

/**
 * Enqueues feed post or official notice push notifications.
 * Distinguishes official notices from normal posts so a notice never triggers both.
 */
async function enqueuePostOrNoticePush(db, { postId, authorStudentId, authorName, type, isOfficial, role, title, content, semester, cohortId, audienceScope, category, targetSemesters, targetAllSemesters = true }) {
  if (!postId) return { enqueuedCount: 0 };

  const isOfficialNotice = type === 'notice' && (Boolean(isOfficial) || ['admin', 'cr', 'teacher'].includes(role));

  let students = [];
  const isTargetedBySemester = !targetAllSemesters && Array.isArray(targetSemesters) && targetSemesters.length > 0 && targetSemesters.length < 8;

  if (isTargetedBySemester) {
    const semNumbers = targetSemesters.map(Number);
    const queryParams = [authorStudentId || ''];

    // Match variations like 'Semester 3', 'Semester3', '3'
    const semPatterns = [];
    for (const semNum of semNumbers) {
      semPatterns.push(`Semester ${semNum}`, `Semester${semNum}`, String(semNum));
    }
    const placeholders = semPatterns.map(() => '?').join(',');
    const semNumPlaceholders = semNumbers.map(() => '?').join(',');

    queryParams.push(...semPatterns, ...semNumbers);

    let cohortFilterClause = '';
    if (cohortId && audienceScope === 'cohort') {
      cohortFilterClause = ' AND s.cohort_id = ?';
      queryParams.push(cohortId);
    }

    try {
      students = await db.all(
        `SELECT DISTINCT s.studentId 
         FROM students s
         LEFT JOIN cohorts c ON s.cohort_id = c.id
         WHERE s.studentId != ?
           AND (s.semester IN (${placeholders}) OR c.current_semester IN (${semNumPlaceholders}))${cohortFilterClause}`,
        ...queryParams
      );
    } catch (_) {
      // Fallback if cohorts table not joined in query
      const fallbackParams = [authorStudentId || '', ...semPatterns];
      students = await db.all(
        `SELECT DISTINCT studentId 
         FROM students 
         WHERE studentId != ? AND semester IN (${placeholders})`,
        ...fallbackParams
      );
    }
  } else if (cohortId && audienceScope === 'cohort') {
    try {
      students = await db.all('SELECT DISTINCT studentId FROM students WHERE cohort_id = ? AND studentId != ?', cohortId, authorStudentId || '');
    } catch (_) {
      students = await db.all('SELECT DISTINCT studentId FROM students WHERE studentId != ?', authorStudentId || '');
    }
  } else {
    students = await db.all('SELECT DISTINCT studentId FROM students WHERE studentId != ?', authorStudentId || '');
  }
  const recipients = students.map(s => s.studentId);
  if (recipients.length === 0) return { enqueuedCount: 0 };

  let resolvedAuthorName = authorName;
  if (!resolvedAuthorName && authorStudentId) {
    const author = await db.get('SELECT name FROM students WHERE studentId = ?', authorStudentId);
    if (author?.name) resolvedAuthorName = author.name;
  }

  const cleanTitle = (title || '').trim();
  const cleanContent = (content || '').trim();

  if (isOfficialNotice) {
    const publisherName = (resolvedAuthorName && resolvedAuthorName !== 'Classmate')
      ? resolvedAuthorName
      : 'Semester Library';

    let noticeBody = '';
    if (cleanTitle) {
      noticeBody = buildNotificationPreview(cleanTitle, 140);
    } else if (cleanContent) {
      noticeBody = buildNotificationPreview(cleanContent, 140);
    } else {
      noticeBody = semester ? `${semester} Official Announcement` : 'Official Announcement';
    }

    const payload = {
      title: publisherName,
      body: noticeBody,
      data: {
        type: 'notice',
        eventId: String(postId),
        entityId: String(postId),
        noticeId: Number(postId),
        postId: Number(postId),
        actorId: String(authorStudentId || ''),
        actorName: resolvedAuthorName || 'Administration',
        groupKey: 'official_notices',
        collapseId: 'notice_' + String(postId),
        createdAt: new Date().toISOString()
      },
      channelId: 'notices',
      priority: 'high',
      groupKey: 'official_notices',
      collapseId: 'notice_' + String(postId)
    };

    try {
      const notifService = require('./notifications-service');
      await notifService.createNotification(db, {
        type: 'official_notice',
        actorId: authorStudentId ? String(authorStudentId) : null,
        actorName: resolvedAuthorName || 'Semester Library Administration',
        title: publisherName,
        body: noticeBody,
        entityType: 'notice',
        entityId: String(postId),
        deepLink: `/notice/${postId}`,
        webPath: `notices.html?highlight=${postId}`,
        groupKey: `notice:${postId}`,
        priority: 'high',
        recipientUserIds: recipients,
        skipPush: true,
      });
    } catch (notifErr) {
      console.warn('[Official Notice Notification Error]:', notifErr.message);
    }

    return enqueuePushForRecipients(db, {
      eventType: 'notice',
      eventId: String(postId),
      recipientStudentIds: recipients,
      payload,
      idempotencyKeyPrefix: 'notice'
    });
  } else {
    const postAuthor = resolvedAuthorName || 'Classmate';
    let postBody = '';
    if (cleanTitle) {
      postBody = buildNotificationPreview(cleanTitle, 140);
    } else if (cleanContent) {
      postBody = buildNotificationPreview(cleanContent, 140);
    } else {
      postBody = semester ? `Shared a new post in ${semester}` : 'Shared a new post';
    }

    const payload = {
      title: postAuthor,
      body: postBody,
      data: {
        type: 'post',
        eventId: String(postId),
        entityId: String(postId),
        postId: Number(postId),
        actorId: String(authorStudentId || ''),
        actorName: postAuthor,
        groupKey: 'feed_posts',
        collapseId: 'post_' + String(postId),
        createdAt: new Date().toISOString()
      },
      channelId: 'social',
      groupKey: 'feed_posts',
      collapseId: 'post_' + String(postId)
    };
    return enqueuePushForRecipients(db, {
      eventType: 'post',
      eventId: String(postId),
      recipientStudentIds: recipients,
      payload,
      idempotencyKeyPrefix: 'post'
    });
  }
}

/**
 * Creates persistent in-app notification record with backward-compatible schema fallback.
 */
async function createInAppNotification(db, {
  recipientStudentId,
  type,
  relatedFileId = null,
  postId = null,
  commentId = null,
  replyId = null,
  reactionType = null,
  actorId = null,
  message
}) {
  if (!recipientStudentId || !type || !message) return null;
  // Recipient cannot be self
  if (actorId && recipientStudentId === actorId) return null;

  try {
    const notifService = require('./notifications-service');
    let actorName = 'A classmate';
    let actorAvatar = null;
    if (actorId) {
      const student = await db.get('SELECT name, avatarUrl FROM students WHERE studentId = ?', actorId).catch(() => null);
      if (student) {
        actorName = student.name || actorName;
        actorAvatar = student.avatarUrl || null;
      }
    }

    let entityType = 'post';
    let entityId = String(postId || relatedFileId || '0');
    let secondaryEntityId = commentId ? String(replyId || commentId) : null;
    let deepLink = '/(tabs)';
    let webPath = 'dashboard.html';
    let groupKey = null;

    if (type === 'post_comment') {
      entityType = 'post';
      entityId = String(postId);
      secondaryEntityId = commentId ? String(commentId) : null;
      deepLink = `/post/${postId}${commentId ? `?commentId=${commentId}` : ''}`;
      webPath = `dashboard.html?post=${postId}${commentId ? `#comment-${commentId}` : ''}`;
      groupKey = `post:${postId}:comments`;
    } else if (type === 'comment_reply') {
      entityType = 'comment';
      entityId = String(postId);
      secondaryEntityId = String(replyId || commentId);
      deepLink = `/post/${postId}?commentId=${commentId || replyId}`;
      webPath = `dashboard.html?post=${postId}#comment-${replyId || commentId}`;
      groupKey = `post:${postId}:comments`;
    } else if (type === 'comment_reaction') {
      entityType = 'comment';
      entityId = String(postId);
      secondaryEntityId = String(commentId);
      deepLink = `/post/${postId}?commentId=${commentId}`;
      webPath = `dashboard.html?post=${postId}#comment-${commentId}`;
      groupKey = `comment:${commentId}:reactions`;
    } else if (type === 'post_reaction') {
      entityType = 'post';
      entityId = String(postId);
      deepLink = `/post/${postId}`;
      webPath = `dashboard.html?post=${postId}`;
      groupKey = `post:${postId}:reactions`;
    } else if (type === 'material' || type === 'material_batch') {
      entityType = 'material';
      entityId = String(relatedFileId || '0');
      deepLink = `/material/${relatedFileId || '0'}`;
      webPath = `files.html?highlight=${relatedFileId || '0'}`;
    } else if (type === 'notice') {
      entityType = 'notice';
      entityId = String(postId);
      deepLink = `/notice/${postId}`;
      webPath = `notices.html?highlight=${postId}`;
    }

    const created = await notifService.createNotification(db, {
      type,
      actorId,
      actorName,
      actorAvatar,
      title: actorName ? `${actorName} interacted with your content` : 'New notification',
      body: message,
      entityType,
      entityId,
      secondaryEntityId,
      deepLink,
      webPath,
      groupKey,
      recipientUserIds: [recipientStudentId],
      skipPush: true,
      metadata: {
        postId: postId ? Number(postId) : null,
        commentId: commentId ? Number(commentId) : null,
        replyId: replyId ? Number(replyId) : null,
        reactionType: reactionType || null,
      },
    });

    const notifId = created?.notificationId;
    return { id: notifId, lastInsertRowid: notifId };
  } catch (err) {
    console.warn('[createInAppNotification Error]:', err.message);
    return null;
  }
}

/**
 * Checks if a reaction notification was recently created for the same comment, actor, and reactionType.
 * Prevents rapid tap spamming (within 5 minutes).
 */
async function isRecentReactionNotification(db, { commentId, actorId, reactionType = 'like' }) {
  if (!commentId || !actorId) return false;
  try {
    let row = null;
    if (db.isPostgres) {
      row = await db.get(`
        SELECT id FROM notifications
        WHERE (type = 'comment_reaction' OR type = 'like')
          AND (actor_id = ? OR "actorId" = ?)
          AND (secondary_entity_id = ? OR "commentId" = ?::int OR entity_id = ?)
          AND (created_at >= (CURRENT_TIMESTAMP - interval '5 minutes') OR "createdAt" >= (CURRENT_TIMESTAMP - interval '5 minutes'))
        LIMIT 1
      `, String(actorId), String(actorId), String(commentId), Number(commentId), String(commentId)).catch(async () => {
        return await db.get(`
          SELECT id FROM notifications
          WHERE type = 'comment_reaction'
            AND actor_id = ?
            AND secondary_entity_id = ?
            AND created_at >= (CURRENT_TIMESTAMP - interval '5 minutes')
          LIMIT 1
        `, String(actorId), String(commentId)).catch(() => null);
      });
    } else {
      row = await db.get(`
        SELECT id FROM notifications
        WHERE (type = 'comment_reaction' OR type = 'like')
          AND (actor_id = ? OR actorId = ?)
          AND (secondary_entity_id = ? OR commentId = ? OR entity_id = ?)
          AND (created_at >= datetime('now', '-5 minutes') OR createdAt >= datetime('now', '-5 minutes'))
        LIMIT 1
      `, String(actorId), String(actorId), String(commentId), Number(commentId), String(commentId)).catch(async () => {
        return await db.get(`
          SELECT id FROM notifications
          WHERE type = 'comment_reaction'
            AND actor_id = ?
            AND secondary_entity_id = ?
            AND created_at >= datetime('now', '-5 minutes')
          LIMIT 1
        `, String(actorId), String(commentId)).catch(() => null);
      });
    }
    return Boolean(row);
  } catch (_) {
    return false;
  }
}

/**
 * Enqueues push notification and creates in-app notification when a user comments on a post.
 */
async function enqueuePostCommentPush(db, {
  postId,
  commentId,
  authorStudentId,
  authorName,
  content,
  recipientStudentId
}) {
  if (!postId || !commentId || !recipientStudentId || !authorStudentId) {
    return { enqueuedCount: 0 };
  }
  // Absolute self-notification suppression
  if (recipientStudentId === authorStudentId) {
    return { enqueuedCount: 0 };
  }

  const cleanAuthorName = (authorName || '').trim() || 'Classmate';
  const preview = buildNotificationPreview(content, 120);

  // 1. Create persistent in-app notification record
  await createInAppNotification(db, {
    recipientStudentId,
    type: 'post_comment',
    postId: Number(postId),
    commentId: Number(commentId),
    actorId: String(authorStudentId),
    message: `${cleanAuthorName} commented on your post: "${buildNotificationPreview(content, 80)}"`,
  });

  // 2. Prepare push payload
  const payload = {
    title: `${cleanAuthorName} commented on your post`,
    body: preview,
    data: {
      type: 'post_comment',
      eventId: String(commentId),
      entityId: String(commentId),
      postId: Number(postId),
      commentId: Number(commentId),
      actorId: String(authorStudentId),
      actorName: cleanAuthorName,
      groupKey: `post_activity_${postId}`,
      tag: `post_comment_${commentId}`,
      createdAt: new Date().toISOString()
    },
    channelId: 'social',
    groupKey: `post_activity_${postId}`,
    tag: `post_comment_${commentId}`
  };

  const enqueueRes = await enqueuePushForRecipients(db, {
    eventType: 'post_comment',
    eventId: String(commentId),
    recipientStudentIds: [recipientStudentId],
    payload,
    idempotencyKeyPrefix: 'post_comment'
  });

  return enqueueRes;
}

/**
 * Enqueues push notification and creates in-app notification when a user replies to a comment or reply.
 */
async function enqueueCommentReplyPush(db, {
  postId,
  commentId,
  replyId,
  authorStudentId,
  authorName,
  content,
  recipientStudentId,
  isTargetReply = false
}) {
  if (!postId || !replyId || !recipientStudentId || !authorStudentId) {
    return { enqueuedCount: 0 };
  }
  // Absolute self-notification suppression
  if (recipientStudentId === authorStudentId) {
    return { enqueuedCount: 0 };
  }

  const cleanAuthorName = (authorName || '').trim() || 'Classmate';
  const preview = buildNotificationPreview(content, 120);
  const targetLabel = isTargetReply ? 'reply' : 'comment';

  // 1. Create persistent in-app notification record
  await createInAppNotification(db, {
    recipientStudentId,
    type: 'comment_reply',
    postId: Number(postId),
    commentId: Number(commentId),
    replyId: Number(replyId),
    actorId: String(authorStudentId),
    message: `${cleanAuthorName} replied to your ${targetLabel}: "${buildNotificationPreview(content, 80)}"`,
  });

  // 2. Prepare push payload
  const payload = {
    title: `${cleanAuthorName} replied to your ${targetLabel}`,
    body: preview,
    data: {
      type: 'comment_reply',
      eventId: String(replyId),
      entityId: String(replyId),
      postId: Number(postId),
      commentId: Number(commentId),
      replyId: Number(replyId),
      actorId: String(authorStudentId),
      actorName: cleanAuthorName,
      groupKey: `post_activity_${postId}`,
      tag: `comment_reply_${replyId}`,
      createdAt: new Date().toISOString()
    },
    channelId: 'social',
    groupKey: `post_activity_${postId}`,
    tag: `comment_reply_${replyId}`
  };

  const enqueueRes = await enqueuePushForRecipients(db, {
    eventType: 'comment_reply',
    eventId: String(replyId),
    recipientStudentIds: [recipientStudentId],
    payload,
    idempotencyKeyPrefix: 'comment_reply'
  });

  return enqueueRes;
}

/**
 * Enqueues push notification and creates in-app notification when a user reacts to a comment or reply.
 */
async function enqueueCommentReactionPush(db, {
  postId,
  commentId,
  replyId = null,
  reactionType = 'like',
  authorStudentId,
  authorName,
  recipientStudentId,
  isReply = false,
  commentContent = ''
}) {
  if (!postId || !commentId || !recipientStudentId || !authorStudentId) {
    return { enqueuedCount: 0 };
  }
  // Absolute self-notification suppression
  if (recipientStudentId === authorStudentId) {
    return { enqueuedCount: 0 };
  }

  // Deduplication check for rapid reaction spam (within 5 minutes)
  const isRecent = await isRecentReactionNotification(db, {
    commentId: replyId || commentId,
    actorId: authorStudentId,
    reactionType
  });
  if (isRecent) {
    return { enqueuedCount: 0, skipped: true, reason: 'Duplicate recent reaction notification' };
  }

  const cleanAuthorName = (authorName || '').trim() || 'Classmate';
  const targetLabel = isReply ? 'reply' : 'comment';
  const eventId = `${replyId || commentId}_${authorStudentId}_${reactionType}`;

  // 1. Create persistent in-app notification record
  await createInAppNotification(db, {
    recipientStudentId,
    type: 'comment_reaction',
    postId: Number(postId),
    commentId: Number(commentId),
    replyId: replyId ? Number(replyId) : null,
    actorId: String(authorStudentId),
    reactionType: String(reactionType),
    message: `${cleanAuthorName} liked your ${targetLabel}`,
  });

  const preview = commentContent ? buildNotificationPreview(commentContent, 100) : `${cleanAuthorName} liked your ${targetLabel}`;

  // 2. Prepare push payload
  const payload = {
    title: `${cleanAuthorName} liked your ${targetLabel}`,
    body: preview,
    data: {
      type: 'comment_reaction',
      eventId,
      entityId: String(replyId || commentId),
      postId: Number(postId),
      commentId: Number(commentId),
      replyId: replyId ? Number(replyId) : undefined,
      reactionType: String(reactionType),
      actorId: String(authorStudentId),
      actorName: cleanAuthorName,
      groupKey: `post_activity_${postId}`,
      tag: `comment_reaction_${replyId || commentId}`,
      createdAt: new Date().toISOString()
    },
    channelId: 'social',
    groupKey: `post_activity_${postId}`,
    tag: `comment_reaction_${replyId || commentId}`
  };

  const enqueueRes = await enqueuePushForRecipients(db, {
    eventType: 'comment_reaction',
    eventId,
    recipientStudentIds: [recipientStudentId],
    payload,
    idempotencyKeyPrefix: 'comment_reaction'
  });

  return enqueueRes;
}

/**
 * Top-level orchestration for comment or reply notifications.
 * Enqueues outbox + bounded immediate dispatch without blocking caller or failing on error.
 */
async function handleCommentOrReplyNotification(db, {
  postId,
  commentId,
  authorStudentId,
  authorName,
  content,
  targetParentId,
  targetComment,
  postAuthorId
}) {
  try {
    let enqueueRes = { enqueuedCount: 0 };
    if (targetParentId && targetComment) {
      // Reply to comment or reply-to-reply
      // Target recipient is STRICTLY derived from database relationship: targetComment.user_id
      const recipientId = targetComment.user_id;
      if (!recipientId || recipientId === authorStudentId) return { enqueuedCount: 0 };

      const resolvedParentId = targetComment.parent_comment_id
        ? Number(targetComment.parent_comment_id)
        : Number(targetComment.id);

      enqueueRes = await enqueueCommentReplyPush(db, {
        postId: Number(postId),
        commentId: resolvedParentId,
        replyId: Number(commentId),
        authorStudentId,
        authorName,
        content,
        recipientStudentId: recipientId,
        isTargetReply: Boolean(targetComment.parent_comment_id)
      });

      if (enqueueRes && enqueueRes.enqueuedCount > 0) {
        await dispatchImmediateOutbox(db, {
          eventType: 'comment_reply',
          eventId: String(commentId),
          timeoutMs: 3500
        });
      }
    } else {
      // Root comment on post
      // Target recipient is STRICTLY derived from database relationship: post.user_id
      const recipientId = postAuthorId;
      if (!recipientId || recipientId === authorStudentId) return { enqueuedCount: 0 };

      enqueueRes = await enqueuePostCommentPush(db, {
        postId: Number(postId),
        commentId: Number(commentId),
        authorStudentId,
        authorName,
        content,
        recipientStudentId: recipientId
      });

      if (enqueueRes && enqueueRes.enqueuedCount > 0) {
        await dispatchImmediateOutbox(db, {
          eventType: 'post_comment',
          eventId: String(commentId),
          timeoutMs: 3500
        });
      }
    }
    return enqueueRes;
  } catch (err) {
    console.warn('[Comment Notification Handler Error]:', err.message);
    return { enqueuedCount: 0, error: err.message };
  }
}

/**
 * Top-level orchestration for comment/reply reaction notifications.
 * Enqueues outbox + bounded immediate dispatch without blocking caller or failing on error.
 */
async function handleCommentReactionNotification(db, {
  commentId,
  reactionType = 'like',
  authorStudentId,
  authorName,
  comment
}) {
  try {
    if (!comment || !comment.user_id) return { enqueuedCount: 0 };
    // Target recipient is STRICTLY derived from database relationship: comment.user_id
    const recipientId = comment.user_id;
    if (!recipientId || recipientId === authorStudentId) return { enqueuedCount: 0 };

    const isReply = Boolean(comment.parent_comment_id);
    const rootCommentId = comment.parent_comment_id ? Number(comment.parent_comment_id) : Number(comment.id);
    const replyId = comment.parent_comment_id ? Number(comment.id) : null;

    const enqueueRes = await enqueueCommentReactionPush(db, {
      postId: Number(comment.post_id),
      commentId: rootCommentId,
      replyId,
      reactionType,
      authorStudentId,
      authorName,
      recipientStudentId: recipientId,
      isReply,
      commentContent: comment.content
    });

    if (enqueueRes && enqueueRes.enqueuedCount > 0) {
      const eventId = `${replyId || rootCommentId}_${authorStudentId}_${reactionType}`;
      await dispatchImmediateOutbox(db, {
        eventType: 'comment_reaction',
        eventId,
        timeoutMs: 3500
      });
    }

    return enqueueRes;
  } catch (err) {
    console.warn('[Comment Reaction Notification Handler Error]:', err.message);
    return { enqueuedCount: 0, error: err.message };
  }
}

module.exports = {
  isValidExpoPushToken,
  normalizePreferences,
  ensurePushNotificationSchema,
  registerDeviceToken,
  unregisterDeviceToken,
  getNotificationPreferences,
  updateNotificationPreferences,
  enqueuePushNotification,
  enqueuePushForRecipients,
  enqueueChatPushWithThrottle,
  enqueueChatPush: enqueueChatPushWithThrottle,
  enqueueMaterialPush,
  enqueueMaterialBatchPush,
  enqueuePostOrNoticePush,
  createInAppNotification,
  isRecentReactionNotification,
  enqueuePostCommentPush,
  enqueueCommentReplyPush,
  enqueueCommentReactionPush,
  handleCommentOrReplyNotification,
  handleCommentReactionNotification,
  processPushOutbox,
  processPushReceipts,
  sendExpoPushBatch,
  dispatchImmediateOutbox,
  buildNotificationPreview,
};
