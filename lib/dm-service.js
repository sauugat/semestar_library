const { randomUUID } = require('node:crypto');
const { getDmConfig } = require('./dm-config');
const {
  createDmRealtimeProviders,
  broadcastTypingIndicator,
  drainDmRealtimeOutbox,
  drainDmPushOutbox,
} = require('./dm-realtime');
const { buildNotificationPreview } = require('./push-notifications');

class DmError extends Error {
  constructor(status = 400, message = 'Request failed.') {
    super(message);
    this.status = status;
  }
}

/**
 * Creates the domain service for Universal One-to-One Private Messaging.
 */
function createDmService(database, options = {}) {
  const db = database;
  const config = getDmConfig(options.env || process.env);
  const providers = options.providers || createDmRealtimeProviders(options.env || process.env);
  const nowIso = () => (options.now ? new Date(options.now()).toISOString() : new Date().toISOString());
  const canonicalPair = (u1, u2) => [String(u1), String(u2)].sort();
  const requireProjectionSync = Boolean(options.requireProjectionSync || config.requireProjectionSync);

  /**
   * Distributed database-backed rate limiter.
   * Works atomically across multi-instance Vercel serverless environments.
   */
  async function checkRateLimit(tx, rateKey, maxRequests, windowSeconds) {
    if (process.env.NODE_ENV === 'test' && options.skipRateLimits) {
      return { allowed: true };
    }

    if (tx.isPostgres) {
      const query = `
        INSERT INTO dm_rate_limits (rate_key, request_count, window_start)
        VALUES ($1, 1, CURRENT_TIMESTAMP)
        ON CONFLICT (rate_key) DO UPDATE
        SET request_count = CASE
              WHEN dm_rate_limits.window_start + ($2 || ' seconds')::interval < CURRENT_TIMESTAMP THEN 1
              ELSE dm_rate_limits.request_count + 1
            END,
            window_start = CASE
              WHEN dm_rate_limits.window_start + ($2 || ' seconds')::interval < CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP
              ELSE dm_rate_limits.window_start
            END
        RETURNING request_count;
      `;
      const res = await tx.get(query, rateKey, windowSeconds);
      if (res && res.request_count > maxRequests) {
        throw new DmError(429, 'Too many requests. Please slow down.');
      }
    } else {
      // SQLite fallback for local test runners
      const nowStr = nowIso();
      const existing = await tx.get('SELECT request_count, window_start FROM dm_rate_limits WHERE rate_key = ?', rateKey);
      if (!existing) {
        await tx.run('INSERT INTO dm_rate_limits (rate_key, request_count, window_start) VALUES (?, 1, ?)', rateKey, nowStr);
      } else {
        const startMs = new Date(existing.window_start).getTime();
        const nowMs = new Date(nowStr).getTime();
        if (nowMs - startMs >= windowSeconds * 1000) {
          await tx.run('UPDATE dm_rate_limits SET request_count = 1, window_start = ? WHERE rate_key = ?', nowStr, rateKey);
        } else {
          const newCount = Number(existing.request_count) + 1;
          await tx.run('UPDATE dm_rate_limits SET request_count = ? WHERE rate_key = ?', newCount, rateKey);
          if (newCount > maxRequests) {
            throw new DmError(429, 'Too many requests. Please slow down.');
          }
        }
      }
    }
  }

  /**
   * Verifies authenticated caller exists and is verified.
   */
  async function verifyCaller(tx, studentId) {
    if (!studentId || typeof studentId !== 'string') {
      throw new DmError(401, 'Authentication required.');
    }
    const student = await tx.get(
      `SELECT studentId, name, username, role, avatarUrl, department, semester,
              COALESCE(verification_status, 'unverified') AS verification_status,
              supabase_uid
       FROM students
       WHERE studentId = ? AND COALESCE(role, 'student') NOT IN ('blocked', 'banned', 'suspended')`,
      studentId
    );
    if (!student) {
      throw new DmError(401, 'Authenticated account not found or suspended.');
    }
    const vStatus = student.verification_status || student.verificationStatus;
    if (vStatus !== 'verified') {
      throw new DmError(403, 'Account verification required to use private messaging.');
    }
    return student;
  }

  /**
   * Verifies target participant exists, is active, and is verified.
   */
  async function verifyTarget(tx, targetId) {
    if (!targetId || typeof targetId !== 'string') {
      throw new DmError(400, 'Invalid recipient user ID.');
    }
    const student = await tx.get(
      `SELECT studentId, name, username, role, avatarUrl, department, semester,
              COALESCE(verification_status, 'unverified') AS verification_status,
              supabase_uid
       FROM students
       WHERE studentId = ? AND COALESCE(role, 'student') NOT IN ('blocked', 'banned', 'suspended')`,
      targetId
    );
    if (!student) {
      throw new DmError(404, 'Recipient user not found or unavailable.');
    }
    const vStatus = student.verification_status || student.verificationStatus;
    if (vStatus !== 'verified') {
      throw new DmError(400, 'Recipient account is not verified.');
    }
    return student;
  }

  /**
   * Checks block status between two users.
   */
  async function checkBlockStatus(tx, userA, userB) {
    const blocks = await tx.all(
      `SELECT blocker_id, blocked_id FROM dm_blocks
       WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
      userA, userB, userB, userA
    );
    const isBlockedByCaller = blocks.some(b => b.blocker_id === userA && b.blocked_id === userB);
    const isBlockedByPeer = blocks.some(b => b.blocker_id === userB && b.blocked_id === userA);
    return {
      blocked: blocks.length > 0,
      isBlockedByCaller,
      isBlockedByPeer,
    };
  }

  /**
   * Verifies caller is an enrolled participant in conversation.
   * Throws 404 (preventing conversation ID discovery).
   */
  async function assertParticipant(tx, conversationId, callerId) {
    const participant = await tx.get(
      `SELECT conversation_id, student_id, slot, last_read_message_id, cleared_before_message_id, is_muted
       FROM dm_participants
       WHERE conversation_id = ? AND student_id = ?`,
      conversationId, callerId
    );
    if (!participant) {
      throw new DmError(404, 'Conversation not found.');
    }
    const conv = await tx.get('SELECT id, user_one_id, user_two_id, realtime_epoch FROM dm_conversations WHERE id = ?', conversationId);
    if (!conv) {
      throw new DmError(404, 'Conversation not found.');
    }
    const peerId = conv.user_one_id === callerId ? conv.user_two_id : conv.user_one_id;
    return { participant, conversation: conv, peerId };
  }

  return {
    DmError,

    /**
     * 1. Search Users
     */
    async searchUsers(callerId, { q = '', limit = 20, offset = 0 } = {}) {
      return db.withTransaction(async tx => {
        await verifyCaller(tx, callerId);
        await checkRateLimit(tx, `dm:search:${callerId}`, config.rateLimits.searchMaxRequests, config.rateLimits.searchWindowSeconds);

        const queryStr = String(q || '').trim().toLowerCase();
        if (!queryStr) {
          return { users: [] };
        }

        const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
        const safeOffset = Math.max(0, Number(offset) || 0);

        const rows = await tx.all(
          `SELECT studentId, name, username, avatarUrl, role, department
           FROM students
           WHERE (LOWER(name) LIKE ? OR LOWER(username) LIKE ?)
             AND studentId != ?
             AND COALESCE(role, 'student') NOT IN ('blocked', 'banned', 'suspended')
             AND COALESCE(verification_status, 'unverified') = 'verified'
             AND NOT EXISTS (
               SELECT 1 FROM dm_blocks
               WHERE (blocker_id = ? AND blocked_id = students.studentId)
                  OR (blocker_id = students.studentId AND blocked_id = ?)
             )
           ORDER BY name ASC
           LIMIT ? OFFSET ?`,
          `%${queryStr}%`, `%${queryStr}%`, callerId, callerId, callerId, safeLimit, safeOffset
        );

        return {
          users: rows.map(r => ({
            studentId: r.studentId,
            name: r.name,
            username: r.username || null,
            avatarUrl: r.avatarUrl || null,
            role: r.role || 'student',
            department: r.department || 'BIT',
          })),
        };
      });
    },

    /**
     * 2. Start or Get Existing Conversation
     * Deterministic pairing: exactly one conversation between two users.
     */
    async getOrCreateConversation(callerId, targetUserId) {
      return db.withTransaction(async tx => {
        const caller = await verifyCaller(tx, callerId);
        if (callerId === targetUserId) {
          throw new DmError(400, 'Cannot start a private conversation with yourself.');
        }

        const target = await verifyTarget(tx, targetUserId);
        await checkRateLimit(tx, `dm:create:${callerId}`, config.rateLimits.createMaxRequests, config.rateLimits.createWindowSeconds);

        const blockStatus = await checkBlockStatus(tx, callerId, targetUserId);
        if (blockStatus.blocked) {
          throw new DmError(403, 'Cannot start a conversation with this user.');
        }

        const [userOne, userTwo] = [callerId, targetUserId].sort();
        const existing = await tx.get(
          'SELECT id, user_one_id, user_two_id, realtime_epoch FROM dm_conversations WHERE user_one_id = ? AND user_two_id = ?',
          userOne, userTwo
        );

        let conversationId;
        let isNew = false;
        let realtimeEpoch = 1;

        if (existing) {
          conversationId = existing.id;
          realtimeEpoch = Number(existing.realtime_epoch || 1);
        } else {
          conversationId = randomUUID();
          isNew = true;
          const stamp = nowIso();

          try {
            await tx.run(
              `INSERT INTO dm_conversations (id, user_one_id, user_two_id, realtime_epoch, created_at, updated_at)
               VALUES (?, ?, ?, 1, ?, ?)`,
              conversationId, userOne, userTwo, stamp, stamp
            );
          } catch (insertErr) {
            // Concurrent race condition: catch UNIQUE violation and load the winning conversation
            const winner = await tx.get(
              'SELECT id, user_one_id, user_two_id, realtime_epoch FROM dm_conversations WHERE user_one_id = ? AND user_two_id = ?',
              userOne, userTwo
            );
            if (winner) {
              conversationId = winner.id;
              realtimeEpoch = Number(winner.realtime_epoch || 1);
              isNew = false;
            } else {
              throw insertErr;
            }
          }

          // Ensure participants are inserted
          const slot1 = await tx.get('SELECT 1 FROM dm_participants WHERE conversation_id = ? AND student_id = ?', conversationId, userOne);
          if (!slot1) {
            await tx.run('INSERT INTO dm_participants (conversation_id, student_id, slot, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
              conversationId, userOne, stamp, stamp);
          }
          const slot2 = await tx.get('SELECT 1 FROM dm_participants WHERE conversation_id = ? AND student_id = ?', conversationId, userTwo);
          if (!slot2) {
            await tx.run('INSERT INTO dm_participants (conversation_id, student_id, slot, created_at, updated_at) VALUES (?, ?, 2, ?, ?)',
              conversationId, userTwo, stamp, stamp);
          }

          // Initial projection sync for newly created conversations
          if (providers.projection && typeof providers.projection.sync === 'function') {
            try {
              const subCaller = await providers.credentials.subject(caller);
              const subTarget = await providers.credentials.subject(target);
              await providers.projection.sync({
                conversationId,
                realtimeEpoch: 1,
                status: blockStatus.blocked ? 'blocked' : 'active',
                participants: blockStatus.blocked ? [] : [{ subject: subCaller }, { subject: subTarget }],
              });
            } catch (syncErr) {
              // getRealtimeConfig will authoritatively synchronize prior to issuing scoped credentials
            }
          }
        }

        return {
          conversationId,
          participant: {
            studentId: target.studentId,
            name: target.name,
            username: target.username || null,
            avatarUrl: target.avatarUrl || null,
            role: target.role || 'student',
          },
          isBlockedByCaller: blockStatus.isBlockedByCaller,
          isBlockedByPeer: blockStatus.isBlockedByPeer,
          realtimeEpoch,
          isNew,
        };
      });
    },

    /**
     * 3. List Conversations
     */
    async listConversations(callerId, { limit = 40, offset = 0 } = {}) {
      return db.withTransaction(async tx => {
        await verifyCaller(tx, callerId);

        const safeLimit = Math.max(1, Math.min(Number(limit) || 40, 100));
        const safeOffset = Math.max(0, Number(offset) || 0);

        const convRows = await tx.all(
          `SELECT c.id, c.user_one_id, c.user_two_id, c.last_message_id, c.last_message_at,
                  p.last_read_message_id, p.cleared_before_message_id, p.is_muted, p.is_archived
           FROM dm_conversations c
           JOIN dm_participants p ON p.conversation_id = c.id AND p.student_id = ?
           WHERE (p.is_archived = FALSE OR p.is_archived IS NULL)
           ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
           LIMIT ? OFFSET ?`,
          callerId, safeLimit, safeOffset
        );

        const conversations = [];
        for (const row of convRows) {
          const peerId = row.user_one_id === callerId ? row.user_two_id : row.user_one_id;
          const peer = await tx.get(
            'SELECT studentId, name, username, avatarUrl, role FROM students WHERE studentId = ?',
            peerId
          );
          if (!peer) continue;

          // Fetch last message preview if not cleared or individually deleted
          let lastMessage = null;
          if (row.last_message_id && row.last_message_id > row.cleared_before_message_id) {
            const isIndividuallyDeleted = await tx.get(
              'SELECT 1 FROM dm_message_deletions WHERE message_id = ? AND student_id = ?',
              row.last_message_id, callerId
            );
            if (!isIndividuallyDeleted) {
              const msg = await tx.get(
                'SELECT id, text, sender_id, deleted_for_all, created_at FROM dm_messages WHERE id = ?',
                row.last_message_id
              );
              if (msg) {
                lastMessage = {
                  id: Number(msg.id),
                  text: msg.deleted_for_all ? null : msg.text,
                  senderId: msg.sender_id,
                  deletedForAll: !!msg.deleted_for_all,
                  createdAt: msg.created_at,
                };
              }
            }
          }

          // Unread count
          const unreadRow = await tx.get(
            `SELECT COUNT(*) AS count FROM dm_messages m
             WHERE m.conversation_id = ?
               AND m.id > ?
               AND m.id > ?
               AND m.sender_id != ?
               AND NOT EXISTS (
                 SELECT 1 FROM dm_message_deletions d
                 WHERE d.message_id = m.id AND d.student_id = ?
               )`,
            row.id, Number(row.last_read_message_id || 0), Number(row.cleared_before_message_id || 0), callerId, callerId
          );

          const blockStatus = await checkBlockStatus(tx, callerId, peerId);

          conversations.push({
            id: row.id,
            participant: {
              studentId: peer.studentId,
              name: peer.name,
              username: peer.username || null,
              avatarUrl: peer.avatarUrl || null,
              role: peer.role || 'student',
            },
            lastMessage,
            unreadCount: Number(unreadRow?.count || 0),
            isMuted: Boolean(row.is_muted),
            isBlocked: blockStatus.blocked,
            isBlockedByCaller: blockStatus.isBlockedByCaller,
            isBlockedByPeer: blockStatus.isBlockedByPeer,
          });
        }

        return { conversations };
      });
    },

    /**
     * 4. Fetch Message History (Cursor Pagination)
     */
    async getMessages(callerId, conversationId, { before, since, limit = 40 } = {}) {
      return db.withTransaction(async tx => {
        await verifyCaller(tx, callerId);
        const { participant } = await assertParticipant(tx, conversationId, callerId);

        const safeLimit = Math.max(1, Math.min(Number(limit) || 40, 100));
        const clearedBefore = Number(participant.cleared_before_message_id || 0);

        let whereClause = 'm.conversation_id = ? AND m.id > ?';
        const params = [conversationId, clearedBefore];

        const beforeId = Number(before || 0);
        const sinceId = Number(since || 0);

        if (beforeId > 0) {
          whereClause += ' AND m.id < ?';
          params.push(beforeId);
        } else if (sinceId > 0) {
          whereClause += ' AND m.id > ?';
          params.push(sinceId);
        }

        params.push(callerId); // for deletions exclusion

        const query = `
          SELECT m.id, m.conversation_id, m.sender_id, m.client_id, m.text, m.reply_to_id,
                 m.is_edited, m.edited_at, m.deleted_for_all, m.created_at,
                 s.name AS sender_name, s.avatarUrl AS sender_avatar,
                 r.text AS reply_text, r.sender_id AS reply_sender_id, rs.name AS reply_sender_name,
                 r.deleted_for_all AS reply_deleted_for_all
          FROM dm_messages m
          JOIN students s ON s.studentId = m.sender_id
          LEFT JOIN dm_messages r ON r.id = m.reply_to_id AND r.conversation_id = m.conversation_id
          LEFT JOIN students rs ON rs.studentId = r.sender_id
          WHERE ${whereClause}
            AND NOT EXISTS (
              SELECT 1 FROM dm_message_deletions d
              WHERE d.message_id = m.id AND d.student_id = ?
            )
          ORDER BY m.id ${sinceId > 0 && !beforeId ? 'ASC' : 'DESC'}
          LIMIT ?
        `;
        params.push(safeLimit);

        const rows = await tx.all(query, ...params);
        if (!sinceId || beforeId > 0) {
          rows.reverse();
        }

        const messages = rows.map(r => ({
          id: Number(r.id),
          conversationId: r.conversation_id,
          senderId: r.sender_id,
          senderName: r.sender_name,
          senderAvatarUrl: r.sender_avatar || null,
          clientId: r.client_id,
          text: r.deleted_for_all ? null : r.text,
          replyTo: r.reply_to_id ? {
            id: Number(r.reply_to_id),
            text: r.reply_deleted_for_all ? null : r.reply_text,
            senderId: r.reply_sender_id,
            senderName: r.reply_sender_name,
            deletedForAll: !!r.reply_deleted_for_all,
          } : null,
          isEdited: Boolean(r.is_edited),
          editedAt: r.edited_at || null,
          deletedForAll: Boolean(r.deleted_for_all),
          createdAt: r.created_at,
        }));

        return {
          conversationId,
          messages,
          hasMore: rows.length === safeLimit,
        };
      });
    },

    /**
     * 5. Send Message
     */
    async sendMessage(callerId, conversationId, { clientId, text, replyToId } = {}) {
      return db.withTransaction(async tx => {
        const caller = await verifyCaller(tx, callerId);
        const { conversation, peerId } = await assertParticipant(tx, conversationId, callerId);

        const trimmedText = String(text || '').trim();
        if (!trimmedText) {
          throw new DmError(400, 'Message text cannot be empty.');
        }
        if (trimmedText.length > config.maxMessageLength) {
          throw new DmError(400, `Message exceeds maximum length of ${config.maxMessageLength} characters.`);
        }
        if (!clientId || typeof clientId !== 'string' || clientId.length > 128) {
          throw new DmError(400, 'Valid client identifier required for idempotent sending.');
        }

        await checkRateLimit(tx, `dm:send:${callerId}`, config.rateLimits.sendMaxRequests, config.rateLimits.sendWindowSeconds);

        // Check blocking fence
        const blockStatus = await checkBlockStatus(tx, callerId, peerId);
        if (blockStatus.blocked) {
          throw new DmError(403, 'Cannot send messages to this user.');
        }

        // Idempotency check
        const existing = await tx.get(
          'SELECT id, conversation_id, sender_id, client_id, text, reply_to_id, created_at FROM dm_messages WHERE conversation_id = ? AND sender_id = ? AND client_id = ?',
          conversationId, callerId, clientId
        );
        if (existing) {
          return {
            message: {
              id: Number(existing.id),
              conversationId: existing.conversation_id,
              senderId: existing.sender_id,
              clientId: existing.client_id,
              text: existing.text,
              replyToId: existing.reply_to_id ? Number(existing.reply_to_id) : null,
              createdAt: existing.created_at,
            },
            duplicate: true,
          };
        }

        // Validate reply target if supplied
        let validReplyId = null;
        if (replyToId !== undefined && replyToId !== null) {
          const replyRow = await tx.get(
            'SELECT id FROM dm_messages WHERE id = ? AND conversation_id = ?',
            Number(replyToId), conversationId
          );
          if (!replyRow) {
            throw new DmError(400, 'Reply target message does not exist in this conversation.');
          }
          validReplyId = Number(replyRow.id);
        }

        const stamp = nowIso();
        const insertResult = await tx.run(
          `INSERT INTO dm_messages (conversation_id, sender_id, client_id, text, reply_to_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
          conversationId, callerId, clientId, trimmedText, validReplyId, stamp
        );
        const messageId = Number(insertResult.lastInsertRowid);

        // Update conversation pointer
        await tx.run(
          'UPDATE dm_conversations SET last_message_id = ?, last_message_at = ?, updated_at = ? WHERE id = ?',
          messageId, stamp, stamp, conversationId
        );

        // Auto-advance sender's own read cursor
        await tx.run(
          'UPDATE dm_participants SET last_read_message_id = ?, updated_at = ? WHERE conversation_id = ? AND student_id = ?',
          messageId, stamp, conversationId, callerId
        );

        // Enqueue realtime outbox record
        const eventId = randomUUID();
        const eventPayload = {
          eventId,
          messageId,
          conversationId,
          senderId: callerId,
          clientId,
          text: trimmedText,
          replyToId: validReplyId,
          createdAt: stamp,
        };
        await tx.run(
          `INSERT INTO dm_realtime_outbox (id, event_id, conversation_id, realtime_epoch, event_type, payload_json, parent_message_id, next_attempt_at, created_at, status)
           VALUES (?, ?, ?, ?, 'dm:message:new', ?, ?, ?, ?, 'pending')`,
          eventId, eventId, conversationId, conversation.realtime_epoch, JSON.stringify(eventPayload), messageId, stamp, stamp
        );

        // Enqueue Push Notification for peer (if not muted and preferences allow)
        try {
          const recipientPrefs = await tx.get(
            'SELECT mute_chat, hide_lockscreen_preview, delivery_messages FROM student_notification_preferences WHERE student_id = ?',
            peerId
          );
          const peerParticipant = await tx.get(
            'SELECT is_muted FROM dm_participants WHERE conversation_id = ? AND student_id = ?',
            conversationId, peerId
          );
          const isMuted = peerParticipant && Boolean(peerParticipant.is_muted);
          const chatMuted = recipientPrefs && (Number(recipientPrefs.mute_chat) === 1 || recipientPrefs.delivery_messages === 'none');

          if (!isMuted && !chatMuted) {
            const hidePreview = recipientPrefs && Number(recipientPrefs.hide_lockscreen_preview) === 1;
            const preview = hidePreview ? 'New private message' : buildNotificationPreview(trimmedText, 140);
            const pushPayload = {
              type: 'dm',
              conversationId,
              messageId,
              senderId: callerId,
              title: caller.name || 'Semester Library',
              body: preview,
              data: {
                type: 'dm',
                conversationId,
                messageId,
                senderId: callerId,
              },
            };
            await tx.run(
              `INSERT INTO push_notification_outbox (event_type, event_id, recipient_student_id, payload_json, idempotency_key, status, next_attempt_at)
               VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
              'dm', String(messageId), peerId, JSON.stringify(pushPayload), `dm:${conversationId}:${messageId}:${peerId}`, stamp
            );
          }
        } catch (pushErr) {
          // Push notification table might not exist in stripped unit tests; non-fatal for messaging
          console.warn('[DM Push Enqueue Warning]:', pushErr.message);
        }

        return {
          message: {
            id: messageId,
            conversationId,
            senderId: callerId,
            clientId,
            text: trimmedText,
            replyToId: validReplyId,
            createdAt: stamp,
          },
          duplicate: false,
        };
      }).then(res => {
        if (process.env.NODE_ENV !== 'test' && options.autoDrain !== false) {
          setImmediate(() => {
            drainDmRealtimeOutbox(db, providers).catch(() => {});
            drainDmPushOutbox(db, providers).catch(() => {});
          });
        }
        return res;
      });
    },

    /**
     * 6. Edit Message
     */
    async editMessage(callerId, conversationId, messageId, { text } = {}) {
      return db.withTransaction(async tx => {
        await verifyCaller(tx, callerId);
        const { conversation } = await assertParticipant(tx, conversationId, callerId);

        const trimmedText = String(text || '').trim();
        if (!trimmedText) {
          throw new DmError(400, 'Message text cannot be empty.');
        }
        if (trimmedText.length > config.maxMessageLength) {
          throw new DmError(400, `Message exceeds maximum length of ${config.maxMessageLength} characters.`);
        }

        const msg = await tx.get(
          'SELECT id, sender_id, deleted_for_all, created_at FROM dm_messages WHERE id = ? AND conversation_id = ?',
          Number(messageId), conversationId
        );
        if (!msg) {
          throw new DmError(404, 'Message not found.');
        }
        if (msg.sender_id !== callerId) {
          throw new DmError(403, 'You can only edit your own messages.');
        }
        if (msg.deleted_for_all) {
          throw new DmError(400, 'Deleted messages cannot be edited.');
        }

        const ageMs = Date.now() - new Date(msg.created_at).getTime();
        if (ageMs > config.editWindowMinutes * 60 * 1000) {
          throw new DmError(400, `Messages can only be edited within ${config.editWindowMinutes} minutes of sending.`);
        }

        const stamp = nowIso();
        await tx.run(
          'UPDATE dm_messages SET text = ?, is_edited = TRUE, edited_at = ? WHERE id = ?',
          trimmedText, stamp, Number(messageId)
        );

        // Enqueue realtime outbox event for edit
        const editEventId = randomUUID();
        const editPayload = {
          eventId: editEventId,
          messageId: Number(messageId),
          conversationId,
          editorId: callerId,
          text: trimmedText,
          editedAt: stamp,
        };
        await tx.run(
          `INSERT INTO dm_realtime_outbox (id, event_id, conversation_id, realtime_epoch, event_type, payload_json, parent_message_id, next_attempt_at, created_at, status)
           VALUES (?, ?, ?, ?, 'dm:message:edited', ?, ?, ?, ?, 'pending')`,
          editEventId, editEventId, conversationId, conversation.realtime_epoch, JSON.stringify(editPayload), Number(messageId), stamp, stamp
        );

        return {
          success: true,
          messageId: Number(messageId),
          text: trimmedText,
          editedAt: stamp,
        };
      }).then(res => {
        if (process.env.NODE_ENV !== 'test' && options.autoDrain !== false) {
          setImmediate(() => {
            drainDmRealtimeOutbox(db, providers).catch(() => {});
          });
        }
        return res;
      });
    },

    /**
     * 7. Delete Message (Three-Tier Deletion)
     */
    async deleteMessage(callerId, conversationId, messageId, { mode = 'for_me' } = {}) {
      return db.withTransaction(async tx => {
        await verifyCaller(tx, callerId);
        const { conversation } = await assertParticipant(tx, conversationId, callerId);

        const numId = Number(messageId);
        const msg = await tx.get('SELECT id, sender_id, deleted_for_all FROM dm_messages WHERE id = ? AND conversation_id = ?', numId, conversationId);
        if (!msg) {
          throw new DmError(404, 'Message not found.');
        }

        const stamp = nowIso();

        if (mode === 'for_everyone') {
          if (msg.sender_id !== callerId) {
            throw new DmError(403, 'You can only delete your own messages for everyone.');
          }
          await tx.run(
            'UPDATE dm_messages SET deleted_for_all = TRUE, text = NULL, deleted_at = ? WHERE id = ?',
            stamp, numId
          );

          // Enqueue realtime outbox event for delete
          const deleteEventId = randomUUID();
          const deletePayload = {
            eventId: deleteEventId,
            messageId: numId,
            conversationId,
            deleterId: callerId,
            mode: 'for_everyone',
            deletedAt: stamp,
          };
          await tx.run(
            `INSERT INTO dm_realtime_outbox (id, event_id, conversation_id, realtime_epoch, event_type, payload_json, parent_message_id, next_attempt_at, created_at, status)
             VALUES (?, ?, ?, ?, 'dm:message:deleted', ?, ?, ?, ?, 'pending')`,
            deleteEventId, deleteEventId, conversationId, conversation.realtime_epoch, JSON.stringify(deletePayload), numId, stamp, stamp
          );

          // Cancel any pending outbox records for this message
          await tx.run(
            "UPDATE dm_realtime_outbox SET status = 'cancelled' WHERE conversation_id = ? AND parent_message_id = ? AND status <> 'sent'",
            conversationId, numId
          );
          await tx.run(
            "UPDATE push_notification_outbox SET status = 'cancelled' WHERE event_type = 'dm' AND event_id = ? AND status <> 'sent'",
            String(numId)
          );

          return { success: true, mode: 'for_everyone' };
        } else if (mode === 'for_me') {
          await tx.run(
            `INSERT INTO dm_message_deletions (message_id, student_id, deleted_at)
             VALUES (?, ?, ?)
             ON CONFLICT (message_id, student_id) DO NOTHING`,
            numId, callerId, stamp
          );
          return { success: true, mode: 'for_me' };
        } else {
          throw new DmError(400, 'Invalid delete mode. Use "for_me" or "for_everyone".');
        }
      }).then(res => {
        if (process.env.NODE_ENV !== 'test' && options.autoDrain !== false) {
          setImmediate(() => {
            drainDmRealtimeOutbox(db, providers).catch(() => {});
          });
        }
        return res;
      });
    },

    /**
     * 8. Clear Conversation
     */
    async clearConversation(callerId, conversationId) {
      return db.withTransaction(async tx => {
        await verifyCaller(tx, callerId);
        await assertParticipant(tx, conversationId, callerId);

        const maxRow = await tx.get(
          'SELECT COALESCE(MAX(id), 0) AS max_id FROM dm_messages WHERE conversation_id = ?',
          conversationId
        );
        const clearedBeforeId = Number(maxRow?.max_id || 0);
        const stamp = nowIso();

        await tx.run(
          'UPDATE dm_participants SET cleared_before_message_id = ?, updated_at = ? WHERE conversation_id = ? AND student_id = ?',
          clearedBeforeId, stamp, conversationId, callerId
        );

        return { success: true, clearedBeforeId };
      });
    },

    /**
     * 9. Mark Read
     */
    async markRead(callerId, conversationId, { lastReadMessageId } = {}) {
      return db.withTransaction(async tx => {
        await verifyCaller(tx, callerId);
        const { participant, conversation } = await assertParticipant(tx, conversationId, callerId);

        const readId = Number(lastReadMessageId);
        if (!Number.isSafeInteger(readId) || readId <= 0) {
          throw new DmError(400, 'Valid lastReadMessageId required.');
        }

        // Verify message belongs to this conversation
        const msg = await tx.get('SELECT id FROM dm_messages WHERE id = ? AND conversation_id = ?', readId, conversationId);
        if (!msg) {
          throw new DmError(400, 'Message does not belong to this conversation.');
        }

        const currentRead = Number(participant.last_read_message_id || 0);
        const newReadId = Math.max(currentRead, readId);

        const stamp = nowIso();
        await tx.run(
          'UPDATE dm_participants SET last_read_message_id = ?, updated_at = ? WHERE conversation_id = ? AND student_id = ?',
          newReadId, stamp, conversationId, callerId
        );

        // Enqueue realtime outbox event for read receipt
        const readEventId = randomUUID();
        const readPayload = {
          eventId: readEventId,
          conversationId,
          studentId: callerId,
          lastReadMessageId: newReadId,
          readAt: stamp,
        };
        await tx.run(
          `INSERT INTO dm_realtime_outbox (id, event_id, conversation_id, realtime_epoch, event_type, payload_json, parent_message_id, next_attempt_at, created_at, status)
           VALUES (?, ?, ?, ?, 'dm:read:updated', ?, ?, ?, ?, 'pending')`,
          readEventId, readEventId, conversationId, conversation.realtime_epoch, JSON.stringify(readPayload), newReadId, stamp, stamp
        );

        return { lastReadMessageId: newReadId };
      }).then(res => {
        if (process.env.NODE_ENV !== 'test' && options.autoDrain !== false) {
          setImmediate(() => {
            drainDmRealtimeOutbox(db, providers).catch(() => {});
          });
        }
        return res;
      });
    },

    /**
     * 10. Block User
     */
    async blockUser(callerId, targetUserId) {
      return db.withTransaction(async tx => {
        await verifyCaller(tx, callerId);
        if (callerId === targetUserId) {
          throw new DmError(400, 'Cannot block yourself.');
        }
        await verifyTarget(tx, targetUserId);

        const stamp = nowIso();
        await tx.run(
          `INSERT INTO dm_blocks (blocker_id, blocked_id, created_at)
           VALUES (?, ?, ?)
           ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
          callerId, targetUserId, stamp
        );

        // Rotate epoch and revoke Supabase Realtime authorization if conversation exists
        const [u1, u2] = canonicalPair(callerId, targetUserId);
        const conv = await tx.get(
          'SELECT id, realtime_epoch FROM dm_conversations WHERE user_one_id = ? AND user_two_id = ?',
          u1, u2
        );

        if (conv) {
          const newEpoch = Number(conv.realtime_epoch || 1) + 1;
          await tx.run(
            'UPDATE dm_conversations SET realtime_epoch = ?, updated_at = ? WHERE id = ?',
            newEpoch, stamp, conv.id
          );

          // Cancel pending outbox events for this conversation
          await tx.run(
            "UPDATE dm_realtime_outbox SET status = 'cancelled' WHERE conversation_id = ? AND status <> 'sent'",
            conv.id
          );

          // Revoke Realtime authorization projection in Supabase
          if (providers.projection && typeof providers.projection.sync === 'function') {
            try {
              await providers.projection.sync({
                conversationId: conv.id,
                realtimeEpoch: newEpoch,
                status: 'blocked',
                participants: [],
              });
            } catch (err) {
              // Authoritative state is maintained in Neon DB
            }
          }
        }

        return { blocked: true, userId: targetUserId };
      });
    },

    /**
     * 11. Unblock User
     */
    async unblockUser(callerId, targetUserId) {
      return db.withTransaction(async tx => {
        const caller = await verifyCaller(tx, callerId);
        const target = await verifyTarget(tx, targetUserId);
        await tx.run('DELETE FROM dm_blocks WHERE blocker_id = ? AND blocked_id = ?', callerId, targetUserId);

        // Check if bidirectional block is cleared
        const stillBlocked = await checkBlockStatus(tx, callerId, targetUserId);
        if (!stillBlocked.blocked) {
          const [u1, u2] = canonicalPair(callerId, targetUserId);
          const conv = await tx.get(
            'SELECT id, realtime_epoch FROM dm_conversations WHERE user_one_id = ? AND user_two_id = ?',
            u1, u2
          );
          if (conv) {
            const newEpoch = Number(conv.realtime_epoch || 1) + 1;
            const stamp = nowIso();
            await tx.run(
              'UPDATE dm_conversations SET realtime_epoch = ?, updated_at = ? WHERE id = ?',
              newEpoch, stamp, conv.id
            );

            // Restore active projection in Supabase Realtime
            if (providers.projection && typeof providers.projection.sync === 'function') {
              try {
                const sub1 = await providers.credentials.subject(caller);
                const sub2 = await providers.credentials.subject(target);
                await providers.projection.sync({
                  conversationId: conv.id,
                  realtimeEpoch: newEpoch,
                  status: 'active',
                  participants: [{ subject: sub1 }, { subject: sub2 }],
                });
              } catch (err) {
                // getRealtimeConfig will synchronize authoritatively
              }
            }
          }
        }

        return { blocked: false, userId: targetUserId };
      });
    },

    /**
     * 12. Report Message
     */
    async reportMessage(callerId, { conversationId, reportedUserId, reportedMessageId, reason, description } = {}) {
      return db.withTransaction(async tx => {
        await verifyCaller(tx, callerId);
        const { peerId } = await assertParticipant(tx, conversationId, callerId);

        await checkRateLimit(tx, `dm:report:${callerId}`, 5, 60);

        if (reportedUserId !== peerId) {
          throw new DmError(400, 'Reported user must be the participant in this conversation.');
        }

        const validReasons = ['spam', 'harassment', 'inappropriate_content', 'impersonation', 'other'];
        if (!validReasons.includes(reason)) {
          throw new DmError(400, `Invalid report reason. Allowed: ${validReasons.join(', ')}`);
        }

        let snapshotText = '';
        let targetMsgId = null;

        if (reportedMessageId !== undefined && reportedMessageId !== null) {
          targetMsgId = Number(reportedMessageId);
          const msg = await tx.get(
            'SELECT text, deleted_for_all FROM dm_messages WHERE id = ? AND conversation_id = ?',
            targetMsgId, conversationId
          );
          if (!msg) {
            throw new DmError(400, 'Reported message does not belong to this conversation.');
          }
          snapshotText = msg.deleted_for_all ? '[Message Deleted by Author]' : (msg.text || '');
        } else {
          snapshotText = '[General Conversation Report]';
        }

        const reportId = randomUUID();
        const stamp = nowIso();

        await tx.run(
          `INSERT INTO dm_reports (id, reporter_id, reported_id, conversation_id, reported_message_id, reason, description, message_snapshot_text, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
          reportId, callerId, reportedUserId, conversationId, targetMsgId, reason, String(description || '').trim(), snapshotText, stamp
        );

        return { reportId, status: 'pending' };
      });
    },

    /**
     * 13. Get Realtime Config (Scoped Credentials)
     */
    async getRealtimeConfig(callerId, conversationId) {
      return db.withTransaction(async tx => {
        const caller = await verifyCaller(tx, callerId);
        const { conversation, peerId } = await assertParticipant(tx, conversationId, callerId);
        const blockStatus = await checkBlockStatus(tx, callerId, peerId);
        if (blockStatus.blocked) {
          throw new DmError(403, 'Direct messaging is blocked with this user.');
        }

        const peer = await verifyTarget(tx, peerId);
        const callerSubject = await providers.credentials.subject(caller);
        const peerSubject = await providers.credentials.subject(peer);
        const realtimeEpoch = Number(conversation.realtime_epoch || 1);

        // Synchronize authorization projection to Supabase before issuing credentials
        if (providers.projection && typeof providers.projection.sync === 'function') {
          try {
            await providers.projection.sync({
              conversationId,
              realtimeEpoch,
              status: 'active',
              participants: [
                { subject: callerSubject },
                { subject: peerSubject },
              ],
            });
          } catch (syncErr) {
            if (requireProjectionSync || (process.env.NODE_ENV !== 'test' && !config.mockRealtime)) {
              throw new DmError(502, `Realtime authorization synchronization failed: ${syncErr.message}`);
            }
          }
        }

        const ttl = config.realtimeTokenTtlSeconds || 120;
        const expiry = new Date(Date.now() + ttl * 1000).toISOString();
        const token = await providers.credentials.issue({
          subject: callerSubject,
          conversationId,
          realtimeEpoch,
          expiry,
        });

        return {
          conversationId,
          realtimeEpoch: Number(conversation.realtime_epoch || 1),
          epoch: Number(conversation.realtime_epoch || 1),
          topic: `dm:${conversationId}:${conversation.realtime_epoch}`,
          token,
          expiry,
          expiresAt: expiry,
          url: providers.realtime.publicConnection.url,
          supabaseUrl: providers.realtime.publicConnection.url,
          key: providers.realtime.publicConnection.key,
        };
      });
    },

    /**
     * 14. Ephemeral Typing Indicator
     */
    async sendTyping(callerId, conversationId, { isTyping = true } = {}) {
      return broadcastTypingIndicator(db, providers, callerId, conversationId, isTyping);
    },

    /**
     * 15. Multi-device / Reconnection Synchronization
     */
    async syncConversation(callerId, conversationId, { sinceMessageId, sinceTimestamp } = {}) {
      return db.withTransaction(async tx => {
        await verifyCaller(tx, callerId);
        const { participant, conversation, peerId } = await assertParticipant(tx, conversationId, callerId);

        const peerParticipant = await tx.get(
          'SELECT last_read_message_id FROM dm_participants WHERE conversation_id = ? AND student_id = ?',
          conversationId, peerId
        );

        const minId = Math.max(
          Number(sinceMessageId || 0),
          Number(participant.cleared_before_message_id || 0)
        );

        // Fetch new messages strictly greater than minId
        const newMessages = await tx.all(
          `SELECT m.id, m.conversation_id, m.sender_id, m.client_id, m.text, m.reply_to_id,
                  m.is_edited, m.edited_at, m.deleted_for_all, m.created_at
           FROM dm_messages m
           WHERE m.conversation_id = ?
             AND m.id > ?
             AND NOT EXISTS (
               SELECT 1 FROM dm_message_deletions d
               WHERE d.message_id = m.id AND d.student_id = ?
             )
           ORDER BY m.id ASC
           LIMIT 100`,
          conversationId, minId, callerId
        );

        const formattedMessages = newMessages.map(m => ({
          id: Number(m.id),
          conversationId: m.conversation_id,
          senderId: m.sender_id,
          clientId: m.client_id || null,
          text: m.deleted_for_all ? null : m.text,
          replyToId: m.reply_to_id ? Number(m.reply_to_id) : null,
          isEdited: Boolean(m.is_edited),
          editedAt: m.edited_at || null,
          deletedForAll: Boolean(m.deleted_for_all),
          createdAt: m.created_at,
        }));

        let edits = [];
        let deletions = [];
        if (sinceTimestamp) {
          const editedRows = await tx.all(
            `SELECT m.id, m.text, m.edited_at
             FROM dm_messages m
             WHERE m.conversation_id = ?
               AND m.is_edited = TRUE
               AND (m.deleted_for_all = FALSE OR m.deleted_for_all IS NULL)
               AND m.edited_at >= ?
               AND NOT EXISTS (
                 SELECT 1 FROM dm_message_deletions d
                 WHERE d.message_id = m.id AND d.student_id = ?
               )
             ORDER BY m.edited_at ASC`,
            conversationId, sinceTimestamp, callerId
          );
          edits = editedRows.map(r => ({
            messageId: Number(r.id),
            text: r.text,
            editedAt: r.edited_at,
          }));

          const deletedRows = await tx.all(
            `SELECT m.id, m.deleted_at
             FROM dm_messages m
             WHERE m.conversation_id = ?
               AND m.deleted_for_all = TRUE
               AND m.deleted_at >= ?
             UNION
             SELECT d.message_id AS id, d.deleted_at
             FROM dm_message_deletions d
             JOIN dm_messages m2 ON m2.id = d.message_id
             WHERE m2.conversation_id = ?
               AND d.student_id = ?
               AND d.deleted_at >= ?`,
            conversationId, sinceTimestamp, conversationId, callerId, sinceTimestamp
          );
          deletions = deletedRows.map(r => ({
            messageId: Number(r.id),
            deletedAt: r.deleted_at,
          }));
        }

        return {
          conversationId,
          realtimeEpoch: Number(conversation.realtime_epoch || 1),
          serverTime: nowIso(),
          messages: formattedMessages,
          edits,
          deletions,
          readCursor: {
            callerLastReadMessageId: Number(participant.last_read_message_id || 0),
            peerLastReadMessageId: Number(peerParticipant?.last_read_message_id || 0),
          },
        };
      });
    },

    /**
     * 16. Outbox Worker Trigger
     */
    async drain(options = {}) {
      const rtRes = await drainDmRealtimeOutbox(db, providers, options);
      const pushRes = await drainDmPushOutbox(db, providers, options);
      return {
        realtime: rtRes,
        push: pushRes,
      };
    },
  };
}

module.exports = {
  createDmService,
  DmError,
};
