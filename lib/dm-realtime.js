'use strict';

const { createHash, createHmac, randomUUID } = require('node:crypto');
const { sendExpoPushBatch, buildNotificationPreview } = require('./push-notifications');

/**
 * Resolves configuration from environment variables for DM Realtime.
 * Reuses existing Supabase Realtime environment variables where available.
 */
function resolveDmProviderEnv(env = process.env) {
  const refUrl = env.COHORT_REALTIME_SUPABASE_PROJECT_REF
    ? `https://${env.COHORT_REALTIME_SUPABASE_PROJECT_REF}.supabase.co`
    : '';
  const urlStr = (
    env.DM_SUPABASE_URL ||
    env.COHORT_SUPABASE_URL ||
    env.COHORT_REALTIME_SUPABASE_URL ||
    refUrl ||
    env.NEXT_PUBLIC_SUPABASE_URL ||
    env.SUPABASE_URL ||
    ''
  ).trim();
  const publicKey = (
    env.DM_SUPABASE_PUBLIC_KEY ||
    env.COHORT_SUPABASE_PUBLIC_KEY ||
    env.COHORT_REALTIME_SUPABASE_PUBLIC_KEY ||
    env.COHORT_REALTIME_SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    env.SUPABASE_ANON_KEY ||
    ''
  ).trim();
  const serviceKey = (
    env.DM_SUPABASE_SERVICE_KEY ||
    env.COHORT_SUPABASE_SERVICE_KEY ||
    env.COHORT_REALTIME_SUPABASE_SERVICE_ROLE_KEY ||
    env.COHORT_REALTIME_SUPABASE_SERVICE_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SECRET_KEY ||
    ''
  ).trim();
  const signingSecret = (
    env.DM_SUPABASE_JWT_SECRET ||
    env.COHORT_SUPABASE_JWT_SECRET ||
    env.COHORT_REALTIME_SUPABASE_JWT_SECRET ||
    env.SUPABASE_JWT_SECRET ||
    ''
  ).trim();

  return { urlStr, publicKey, serviceKey, signingSecret };
}

function checkDmProviderConfig(env = process.env) {
  const { urlStr, publicKey, serviceKey, signingSecret } = resolveDmProviderEnv(env);
  let validUrl = false;
  try {
    const url = new URL(urlStr);
    validUrl =
      url.protocol === 'https:' &&
      /^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password;
  } catch {}

  const missing = [];
  if (!validUrl) missing.push('DM_SUPABASE_URL / COHORT_SUPABASE_URL');
  if (!publicKey) missing.push('DM_SUPABASE_PUBLIC_KEY / COHORT_SUPABASE_PUBLIC_KEY');
  if (!serviceKey) missing.push('DM_SUPABASE_SERVICE_KEY / COHORT_SUPABASE_SERVICE_KEY');
  if (!signingSecret || signingSecret.length < 32) missing.push('DM_SUPABASE_JWT_SECRET / COHORT_SUPABASE_JWT_SECRET');

  return {
    configured: missing.length === 0,
    missing,
  };
}

/**
 * Creates DM realtime and push notification providers.
 */
function createDmRealtimeProviders(env = process.env, transport = fetch) {
  const { urlStr, publicKey, serviceKey, signingSecret } = resolveDmProviderEnv(env);

  let origin = '';
  if (urlStr) {
    try {
      const url = new URL(urlStr);
      origin = url.origin;
    } catch {}
  }

  const request = async (path, body) => {
    if (!origin || !serviceKey) {
      throw new Error('Supabase Realtime provider is not configured.');
    }
    const result = await transport(origin + path, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!result.ok) {
      const errText = await result.text().catch(() => '');
      throw new Error(`Realtime broadcast rejected (${result.status}): ${errText}`);
    }
    return result;
  };

  return {
    credentials: {
      /**
       * Derives the canonical subject for an account:
       * 1. Uses canonical Supabase Auth UUID (supabase_uid) when present.
       * 2. In test mode or when allowSynthetic is enabled, falls back to deterministic UUID.
       * 3. In production, fails closed if the account is not linked to Supabase Auth.
       */
      subject: async (student, options = {}) => {
        if (!student) throw new Error('Account record required for identity resolution.');
        if (student.supabase_uid) return student.supabase_uid;

        if (options.allowSynthetic || process.env.NODE_ENV === 'test' || process.env.DM_ALLOW_SYNTHETIC_UID === 'true') {
          const id = student.studentId || student.student_id || student.id;
          if (!id) throw new Error('Student identifier required.');
          const hex = createHash('sha256').update(`semester-library:dm-realtime:${id}`).digest('hex');
          return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
        }

        const id = student.studentId || student.student_id || student.id || 'unknown';
        const err = new Error(
          `Account '${id}' is not linked to a canonical Supabase Auth identity. Please complete account verification or sign in via Supabase before using private messaging.`
        );
        err.status = 403;
        err.code = 'SUPABASE_UID_REQUIRED';
        throw err;
      },

      /**
       * Issues a short-lived (120s max) scoped JWT for private DM broadcast subscription.
       */
      issue: async ({ subject, conversationId, realtimeEpoch, expiry }) => {
        const now = Math.floor(Date.now() / 1000);
        const exp = Math.floor(Date.parse(expiry) / 1000);
        if (!subject || !conversationId || !Number.isInteger(realtimeEpoch) || !(exp > now && exp <= now + 120)) {
          throw new Error('Invalid DM realtime credential parameters.');
        }
        if (!signingSecret) {
          throw new Error('JWT signing secret is required to issue realtime credentials.');
        }
        const enc = val => Buffer.from(JSON.stringify(val)).toString('base64url');
        const data = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({
          sub: subject,
          role: 'authenticated',
          aud: 'authenticated',
          iat: now,
          exp,
          dm_conversation_id: conversationId,
          dm_epoch: realtimeEpoch,
        })}`;
        const signature = createHmac('sha256', signingSecret).update(data).digest('base64url');
        return `${data}.${signature}`;
      },
    },

    projection: {
      /**
       * Synchronizes conversation authorization projection to Supabase Realtime backend.
       */
      sync: async snapshot => {
        if (!snapshot || !snapshot.conversationId || !snapshot.realtimeEpoch || !snapshot.status || !Array.isArray(snapshot.participants)) {
          throw new Error('Invalid DM projection snapshot parameters.');
        }
        if (!origin || !serviceKey) {
          if (process.env.NODE_ENV === 'test' && !serviceKey) {
            return { ok: true, skipped: true, snapshot };
          }
          throw new Error('Supabase Realtime service-role key is required for DM projection synchronization.');
        }
        const result = await request('/rest/v1/rpc/sync_dm_conversation_projection', { snapshot });
        return await result.json().catch(() => ({ ok: true }));
      },
    },

    realtime: {
      publicConnection: {
        url: origin,
        key: publicKey,
      },
      send: async event => {
        if (!event.private || !/^dm:[0-9a-f-]{36}:\d+$/.test(event.topic)) {
          throw new Error('Private DM publication required.');
        }
        await request('/realtime/v1/api/broadcast', { messages: [event] });
      },
    },

    push: {
      sendBatch: sendExpoPushBatch,
    },
  };
}

// In-memory throttling map for typing indicators to avoid spamming network/realtime
const typingThrottleMap = new Map();

/**
 * Ephemeral typing indicator broadcaster.
 * Zero database writes.
 */
async function broadcastTypingIndicator(db, providers, callerId, conversationId, isTyping = true) {
  // Rate limit / throttle typing per caller per conversation (at most 1 every 2 seconds)
  const throttleKey = `${callerId}:${conversationId}`;
  const lastEmitted = typingThrottleMap.get(throttleKey) || 0;
  const now = Date.now();
  if (now - lastEmitted < 2000) {
    return { throttled: true, isTyping };
  }
  typingThrottleMap.set(throttleKey, now);

  // Clean old throttle entries
  if (typingThrottleMap.size > 1000) {
    for (const [k, ts] of typingThrottleMap.entries()) {
      if (now - ts > 10000) typingThrottleMap.delete(k);
    }
  }

  // Verify caller participant and blocking status
  const conv = await db.get(
    `SELECT c.id, c.user_one_id, c.user_two_id, c.realtime_epoch
     FROM dm_conversations c
     JOIN dm_participants p ON p.conversation_id = c.id
     WHERE c.id = ? AND p.student_id = ?`,
    conversationId, callerId
  );
  if (!conv) {
    return { ok: false, error: 'Conversation not found.' };
  }

  const peerId = conv.user_one_id === callerId ? conv.user_two_id : conv.user_one_id;
  const block = await db.get(
    `SELECT 1 FROM dm_blocks
     WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
    callerId, peerId, peerId, callerId
  );
  if (block) {
    // Drop silently, never leak typing activity across blocked boundaries
    return { ok: false, blocked: true };
  }

  if (providers && providers.realtime && typeof providers.realtime.send === 'function') {
    const epoch = Number(conv.realtime_epoch || 1);
    await providers.realtime.send({
      topic: `dm:${conversationId}:${epoch}`,
      event: 'dm:typing',
      payload: {
        conversationId,
        studentId: callerId,
        isTyping: Boolean(isTyping),
        timestamp: new Date().toISOString(),
        expiresAt: new Date(now + 4000).toISOString(),
      },
      private: true,
    }).catch(err => {
      console.warn('[DM Realtime] Typing broadcast warning:', err.message);
    });
  }

  return { ok: true, isTyping: Boolean(isTyping) };
}

/**
 * Transactional Outbox Drainer for DM Realtime Events.
 * Handles atomic claiming, epoch validation, block verification, and retry backoff.
 */
async function drainDmRealtimeOutbox(db, providers, { limit = 25, timeoutMs = 4000 } = {}) {
  if (!providers?.realtime?.send) {
    return { drained: 0, skipped: true };
  }

  const nowIso = new Date().toISOString();

  // Atomically claim pending or retry events
  const pendingEvents = await db.withTransaction(async tx => {
    let rows;
    if (tx.isPostgres) {
      rows = await tx.all(
        `SELECT id, event_id, conversation_id, realtime_epoch, event_type, payload_json, attempts
         FROM dm_realtime_outbox
         WHERE status IN ('pending', 'retry') AND next_attempt_at <= CURRENT_TIMESTAMP
         ORDER BY created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        limit
      );
    } else {
      rows = await tx.all(
        `SELECT id, event_id, conversation_id, realtime_epoch, event_type, payload_json, attempts
         FROM dm_realtime_outbox
         WHERE status IN ('pending', 'retry') AND next_attempt_at <= ?
         ORDER BY created_at ASC
         LIMIT ?`,
        nowIso, limit
      );
    }

    if (!rows || rows.length === 0) return [];

    // Mark claimed as processing
    for (const r of rows) {
      await tx.run("UPDATE dm_realtime_outbox SET status = 'processing' WHERE id = ?", r.id);
    }
    return rows;
  });

  if (pendingEvents.length === 0) return { drained: 0 };

  let processedCount = 0;

  for (const event of pendingEvents) {
    let shouldSend = true;
    let cancelReason = null;

    // 1. Verify conversation status and epoch
    const conv = await db.get(
      'SELECT id, user_one_id, user_two_id, realtime_epoch FROM dm_conversations WHERE id = ?',
      event.conversation_id
    );
    if (!conv) {
      shouldSend = false;
      cancelReason = 'conversation_missing';
    } else if (Number(conv.realtime_epoch) !== Number(event.realtime_epoch)) {
      shouldSend = false;
      cancelReason = 'epoch_mismatch';
    } else {
      // 2. Verify blocking status between participants
      const block = await db.get(
        `SELECT 1 FROM dm_blocks
         WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
        conv.user_one_id, conv.user_two_id, conv.user_two_id, conv.user_one_id
      );
      if (block) {
        shouldSend = false;
        cancelReason = 'blocked';
      }
    }

    if (!shouldSend) {
      await db.run(
        "UPDATE dm_realtime_outbox SET status = 'cancelled' WHERE id = ?",
        event.id
      );
      continue;
    }

    // 3. Dispatch to Supabase Realtime Broadcast
    try {
      const payload = typeof event.payload_json === 'string'
        ? JSON.parse(event.payload_json)
        : event.payload_json;

      const topic = `dm:${event.conversation_id}:${event.realtime_epoch}`;
      await providers.realtime.send({
        topic,
        event: event.event_type,
        payload,
        private: true,
      });

      await db.run(
        "UPDATE dm_realtime_outbox SET status = 'sent', sent_at = ? WHERE id = ?",
        new Date().toISOString(), event.id
      );
      processedCount++;
    } catch (err) {
      console.warn(`[DM Realtime] Event ${event.id} dispatch failure:`, err.message);
      const newAttempts = Number(event.attempts || 0) + 1;
      if (newAttempts >= 5) {
        await db.run(
          "UPDATE dm_realtime_outbox SET status = 'failed', attempts = ? WHERE id = ?",
          newAttempts, event.id
        );
      } else {
        const backoffMs = Math.pow(2, newAttempts) * 1000;
        const nextAttempt = new Date(Date.now() + backoffMs).toISOString();
        await db.run(
          "UPDATE dm_realtime_outbox SET status = 'retry', attempts = ?, next_attempt_at = ? WHERE id = ?",
          newAttempts, nextAttempt, event.id
        );
      }
    }
  }

  return { drained: processedCount };
}

/**
 * Transactional Outbox Drainer for DM Mobile Push Notifications.
 * Handles device token fetching, privacy checking, and batch push delivery.
 */
async function drainDmPushOutbox(db, providers, { limit = 20 } = {}) {
  if (!providers?.push?.sendBatch) {
    return { drained: 0, skipped: true };
  }

  const nowIso = new Date().toISOString();

  // Atomically claim pending DM push records
  const pendingPushes = await db.withTransaction(async tx => {
    let rows;
    if (tx.isPostgres) {
      rows = await tx.all(
        `SELECT id, event_id, recipient_student_id, payload_json, attempts
         FROM push_notification_outbox
         WHERE event_type = 'dm' AND status IN ('pending', 'retry') AND next_attempt_at <= CURRENT_TIMESTAMP
         ORDER BY id ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        limit
      );
    } else {
      rows = await tx.all(
        `SELECT id, event_id, recipient_student_id, payload_json, attempts
         FROM push_notification_outbox
         WHERE event_type = 'dm' AND status IN ('pending', 'retry') AND next_attempt_at <= ?
         ORDER BY id ASC
         LIMIT ?`,
        nowIso, limit
      );
    }

    if (!rows || rows.length === 0) return [];
    for (const r of rows) {
      await tx.run("UPDATE push_notification_outbox SET status = 'processing' WHERE id = ?", r.id);
    }
    return rows;
  });

  if (pendingPushes.length === 0) return { drained: 0 };

  let deliveredCount = 0;

  for (const push of pendingPushes) {
    const payload = typeof push.payload_json === 'string'
      ? JSON.parse(push.payload_json)
      : push.payload_json;

    const conversationId = payload.conversationId;
    const senderId = payload.senderId;
    const recipientId = push.recipient_student_id;

    // 1. Verify blocking status between sender and recipient
    const block = await db.get(
      `SELECT 1 FROM dm_blocks
       WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
      senderId, recipientId, recipientId, senderId
    );
    if (block) {
      await db.run("UPDATE push_notification_outbox SET status = 'cancelled' WHERE id = ?", push.id);
      continue;
    }

    // 2. Verify conversation mute setting for recipient
    const participant = await db.get(
      'SELECT is_muted FROM dm_participants WHERE conversation_id = ? AND student_id = ?',
      conversationId, recipientId
    );
    if (participant && Number(participant.is_muted) === 1) {
      await db.run("UPDATE push_notification_outbox SET status = 'cancelled' WHERE id = ?", push.id);
      continue;
    }

    // 3. Fetch recipient device push tokens
    const deviceRows = await db.all(
      'SELECT expo_push_token FROM student_device_tokens WHERE student_id = ?',
      recipientId
    );
    const tokens = (deviceRows || []).map(d => d.expo_push_token).filter(Boolean);

    if (tokens.length === 0) {
      // No active registered devices: mark as sent
      await db.run("UPDATE push_notification_outbox SET status = 'sent', sent_at = ? WHERE id = ?", nowIso, push.id);
      deliveredCount++;
      continue;
    }

    // 4. Construct Expo push messages for all devices
    const pushMessages = tokens.map(token => ({
      to: token,
      sound: 'default',
      title: payload.title || 'New private message',
      body: payload.body || 'New private message',
      data: payload.data || payload,
      priority: 'high',
      channelId: 'chat',
    }));

    try {
      await providers.push.sendBatch(pushMessages);
      await db.run(
        "UPDATE push_notification_outbox SET status = 'sent', sent_at = ? WHERE id = ?",
        new Date().toISOString(), push.id
      );
      deliveredCount++;
    } catch (err) {
      console.warn(`[DM Push] Delivery failure for push ${push.id}:`, err.message);
      const newAttempts = Number(push.attempts || 0) + 1;
      if (newAttempts >= 4) {
        await db.run(
          "UPDATE push_notification_outbox SET status = 'failed', attempts = ? WHERE id = ?",
          newAttempts, push.id
        );
      } else {
        const backoffMs = Math.pow(2, newAttempts) * 1500;
        const nextAttempt = new Date(Date.now() + backoffMs).toISOString();
        await db.run(
          "UPDATE push_notification_outbox SET status = 'retry', attempts = ?, next_attempt_at = ? WHERE id = ?",
          newAttempts, nextAttempt, push.id
        );
      }
    }
  }

  return { drained: deliveredCount };
}

module.exports = {
  resolveDmProviderEnv,
  checkDmProviderConfig,
  createDmRealtimeProviders,
  broadcastTypingIndicator,
  drainDmRealtimeOutbox,
  drainDmPushOutbox,
};
