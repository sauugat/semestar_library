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
    SELECT
      o.id, o.event_type, o.event_id, o.recipient_student_id, o.payload_json,
      o.idempotency_key, o.attempts
    FROM push_notification_outbox o
    WHERE o.status = 'pending' AND o.next_attempt_at <= CURRENT_TIMESTAMP
  `;
  const params = [];
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

  const pendingRows = await db.all(sql, ...params);

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
    if (job.event_type === 'post' && !prefs.notifyPosts) {
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
      else if (job.event_type === 'post') resolvedChannelId = 'social';
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

    const groupKey = payloadObj.groupKey || (job.event_type === 'chat' ? 'chat_group_bit' : `${job.event_type}_group`);
    const collapseId = job.event_type === 'chat' ? undefined : (payloadObj.collapseId || undefined);
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
      const { tickets, status: httpStatus, error, expoHttpMs } = await sendExpoPushBatch(messages, { timeoutMs: options.timeoutMs });
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
              ON CONFLICT (ticket_id) DO NOTHING
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
      SELECT ticket_id, expo_push_token
      FROM push_receipt_tickets
      WHERE status = 'pending' AND created_at <= (CURRENT_TIMESTAMP - make_interval(secs => ?))
      LIMIT ?
    `, minAgeSeconds, limit);
  } else {
    pendingTickets = await db.all(`
      SELECT ticket_id, expo_push_token
      FROM push_receipt_tickets
      WHERE status = 'pending' AND created_at <= datetime('now', '-' || ? || ' seconds')
      LIMIT ?
    `, minAgeSeconds, limit);
  }

  if (!pendingTickets || pendingTickets.length === 0) {
    return { checked: 0, unregisteredTokensPruned: 0 };
  }

  const ticketIds = pendingTickets.map(t => t.ticket_id);
  const tokenMap = new Map();
  pendingTickets.forEach(t => tokenMap.set(t.ticket_id, t.expo_push_token));

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
      if (!receipt) continue; // Expo receipt may not be ready yet

      checkedCount++;
      if (receipt.status === 'ok') {
        await db.run(`
          UPDATE push_receipt_tickets
          SET status = 'ok', checked_at = CURRENT_TIMESTAMP
          WHERE ticket_id = ?
        `, ticketId);
      } else if (receipt.status === 'error') {
        const errCode = receipt.details?.error || 'UNKNOWN_ERROR';
        const errMsg = receipt.message || 'Delivery error';

        await db.run(`
          UPDATE push_receipt_tickets
          SET status = 'error', error_code = ?, error_message = ?, checked_at = CURRENT_TIMESTAMP
          WHERE ticket_id = ?
        `, errCode, errMsg, ticketId);

        if (errCode === 'DeviceNotRegistered') {
          const badToken = tokenMap.get(ticketId);
          if (badToken) {
            console.log(`[Push Receipts]: Pruning unregistered token ${badToken}`);
            await db.run('DELETE FROM student_device_tokens WHERE expo_push_token = ?', badToken);
            unregisteredPruned++;
          }
        }
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

  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const CHUNK_SIZE = 250;
  let totalInserted = 0;

  for (let i = 0; i < uniqueRecipients.length; i += CHUNK_SIZE) {
    const chunk = uniqueRecipients.slice(i, i + CHUNK_SIZE);
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

  const fullBody = `${cleanSender}: ${previewContent}`;

  const recipients = await db.all('SELECT studentId FROM students WHERE studentId != ?', senderStudentId);
  if (!recipients || recipients.length === 0) return { enqueuedCount: 0 };
  const recipientIds = recipients.map(r => r.studentId);

  const payloadObj = {
    title: 'BIT Group Chat',
    body: fullBody,
    data: {
      type: 'chat',
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

  return await enqueuePushForRecipients(db, {
    eventType: 'chat',
    eventId: String(messageId),
    recipientStudentIds: recipientIds,
    payload: payloadObj,
    idempotencyKeyPrefix: 'chat'
  });
}

/**
 * Enqueues study material upload push notifications targeting only authorized semester students.
 * Excludes the uploader.
 */
async function enqueueMaterialPush(db, { fileId, originalName, title, semester, subject, uploaderStudentId, uploaderName }) {
  if (!fileId) return { enqueuedCount: 0 };

  const { normalizeSemester } = require('./note-search');
  const targetSem = normalizeSemester(semester);

  let resolvedUploaderName = uploaderName;
  if (!resolvedUploaderName && uploaderStudentId) {
    const uploader = await db.get('SELECT name FROM students WHERE studentId = ?', uploaderStudentId);
    if (uploader?.name) resolvedUploaderName = uploader.name;
  }

  let recipients = [];
  if (targetSem !== null) {
    // Only notify students whose semester matches the uploaded material
    const students = await db.all('SELECT studentId, semester FROM students WHERE studentId != ?', uploaderStudentId || '');
    recipients = students
      .filter(s => normalizeSemester(s.semester) === targetSem)
      .map(s => s.studentId);
  } else {
    // Common / public material without semester constraint: notify all students except uploader
    const students = await db.all('SELECT studentId FROM students WHERE studentId != ?', uploaderStudentId || '');
    recipients = students.map(s => s.studentId);
  }

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

  return enqueuePushForRecipients(db, {
    eventType: 'material',
    eventId: String(fileId),
    recipientStudentIds: recipients,
    payload,
    idempotencyKeyPrefix: 'material'
  });
}

/**
 * Enqueues feed post or official notice push notifications.
 * Distinguishes official notices from normal posts so a notice never triggers both.
 */
async function enqueuePostOrNoticePush(db, { postId, authorStudentId, authorName, type, isOfficial, role, title, content, semester }) {
  if (!postId) return { enqueuedCount: 0 };

  const isOfficialNotice = type === 'notice' && (Boolean(isOfficial) || ['admin', 'cr', 'teacher'].includes(role));

  const students = await db.all('SELECT studentId FROM students WHERE studentId != ?', authorStudentId || '');
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
  enqueuePostOrNoticePush,
  processPushOutbox,
  processPushReceipts,
  sendExpoPushBatch,
  dispatchImmediateOutbox,
  buildNotificationPreview,
};
