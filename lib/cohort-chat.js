'use strict';
const { randomUUID } = require('node:crypto');
const { CODES } = require('../migrations/002-cohort-chat');
const push = require('./push-notifications');

class ChatError extends Error {
  constructor(status = 404, message = 'This conversation is no longer available.') { super(message); this.status = status; }
}
const unavailable = () => new ChatError();
const bad = message => new ChatError(400, message);
const sqlLock = tx => tx.isPostgres ? ' FOR UPDATE' : '';
const decode = value => typeof value === 'string' ? JSON.parse(value) : value;

function createCohortChat(dbOrOptions, maybeProviders = {}) {
  const db = require('./cohort-chat-db').cohortChatDb((dbOrOptions && dbOrOptions.db) ? dbOrOptions.db : dbOrOptions);
  const providers = (dbOrOptions && dbOrOptions.db && dbOrOptions.providers) ? dbOrOptions.providers : maybeProviders;
  if (process.env.NODE_ENV !== 'test' && process.env.COHORT_CHAT_LOCAL !== '1' && !(process.env.COHORT_CHAT_PRODUCTION === '1' && db.isPostgres && providers.production)) throw new Error('Cohort chat requires explicit production providers or test mode');
  const now = () => new Date(providers.now ? providers.now() : Date.now());
  const iso = () => now().toISOString();
  const later = ms => new Date(now().getTime() + ms).toISOString();
  const testPoint = async name => { if (providers.testPoint) await providers.testPoint(name); };
  const admin = async (tx, studentId) => {
    if (!(await tx.get("SELECT studentId FROM students WHERE studentId=? AND role='admin'", studentId))) throw new ChatError(403, 'Administrator access required.');
  };
  const lockRoom = async (tx, id) => {
    const room = await tx.get(`SELECT * FROM chat_groups WHERE id=?${sqlLock(tx)}`, id);
    if (!room || room.kind !== 'cohort') throw unavailable();
    return room;
  };
  const context = async (tx, studentId, input = {}) => {
    const studentUser = await tx.get(
      "SELECT studentId, name, role, department, cohort_id FROM students WHERE studentId=? AND COALESCE(role,'student') NOT IN ('blocked','banned','suspended')",
      studentId
    );
    if (!studentUser) throw unavailable();
    const isStaff = studentUser.role === 'teacher' || studentUser.role === 'admin';

    let row = null;
    if (isStaff) {
      const reqRoomId = input.chatGroupId || input.chat_group_id || null;
      const reqCode = input.group || input.groupCode || null;
      if (reqRoomId) {
        row = await tx.get(`
          SELECT c.id AS cohort_id, c.group_code, c.current_semester, c.status AS cohort_status,
                 g.id AS room_id, g.status AS room_status, g.realtime_epoch, g.projection_status, g.projection_epoch
          FROM chat_groups g
          JOIN cohorts c ON c.id = g.cohort_id
          WHERE g.id = ?
        `, reqRoomId);
      } else if (reqCode) {
        row = await tx.get(`
          SELECT c.id AS cohort_id, c.group_code, c.current_semester, c.status AS cohort_status,
                 g.id AS room_id, g.status AS room_status, g.realtime_epoch, g.projection_status, g.projection_epoch
          FROM chat_group_slots slot
          JOIN chat_groups g ON g.id = slot.current_chat_group_id
          JOIN cohorts c ON c.id = g.cohort_id
          WHERE slot.group_code = ?
        `, reqCode.toUpperCase());
      } else if (studentUser.cohort_id) {
        row = await tx.get(`
          SELECT c.id AS cohort_id, c.group_code, c.current_semester, c.status AS cohort_status,
                 g.id AS room_id, g.status AS room_status, g.realtime_epoch, g.projection_status, g.projection_epoch
          FROM cohorts c
          JOIN chat_groups g ON g.cohort_id = c.id
          WHERE c.id = ?
        `, studentUser.cohort_id);
      } else {
        row = await tx.get(`
          SELECT c.id AS cohort_id, c.group_code, c.current_semester, c.status AS cohort_status,
                 g.id AS room_id, g.status AS room_status, g.realtime_epoch, g.projection_status, g.projection_epoch
          FROM cohorts c
          JOIN chat_groups g ON g.cohort_id = c.id
          WHERE c.status = 'active' AND g.status = 'active'
          ORDER BY c.current_semester ASC LIMIT 1
        `);
      }
      if (!row) throw unavailable();
      row.student_id = studentUser.studentId;
      row.name = studentUser.name;
      row.role = studentUser.role;
    } else {
      const allowArchived = input.archived === true;
      row = await tx.get(`SELECT s.studentId AS student_id, s.name, s.role, c.id AS cohort_id,
        c.group_code,c.current_semester,c.status AS cohort_status,g.id AS room_id,g.status AS room_status,
        g.realtime_epoch,g.projection_status,g.projection_epoch
        FROM students s JOIN cohorts c ON c.id=s.cohort_id JOIN chat_groups g ON g.cohort_id=c.id
        LEFT JOIN chat_group_slots slot ON slot.current_chat_group_id=g.id AND slot.group_code=c.group_code
        WHERE s.studentId=? AND UPPER(TRIM(s.department))='BIT'
        AND (c.status='active' OR (? = 1 AND c.status='graduated'))
        AND (g.status='active' OR (? = 1 AND g.status='closed'))
        AND COALESCE(s.role,'student') NOT IN ('blocked','banned','suspended')
        AND NOT EXISTS (SELECT 1 FROM chat_room_revocations r WHERE r.chat_group_id=g.id AND r.student_id=s.studentId)`,
        studentId, allowArchived ? 1 : 0, allowArchived ? 1 : 0
      );
    }

    if (!row) throw unavailable();
    const gCode = row.group_code || row.groupCode;
    const displayName = gCode ? gCode.charAt(0) + gCode.slice(1).toLowerCase() : 'Group';
    const cSem = Number(row.current_semester || row.currentSemester);
    const rId = row.room_id || row.roomId;
    const rEpoch = Number(row.realtime_epoch !== undefined ? row.realtime_epoch : row.realtimeEpoch);
    const rStatus = row.room_status || row.roomStatus;
    const cStatus = row.cohort_status || row.cohortStatus;

    return {
      studentId: row.student_id || row.studentId,
      name: row.name,
      role: row.role,
      cohortId: row.cohort_id || row.cohortId,
      cohortDisplayName: displayName,
      groupCode: gCode,
      chatGroupId: rId,
      roomId: rId,
      currentSemester: cSem,
      cohortStatus: cStatus,
      roomStatus: rStatus,
      realtimeEpoch: rEpoch,
      epoch: rEpoch,
      projectionStatus: row.projection_status || row.projectionStatus,
      projectionEpoch: Number(row.projection_epoch !== undefined ? row.projection_epoch : row.projectionEpoch),
      permissions: {
        canPost: rStatus === 'active' && cStatus === 'active',
        canPin: ['admin', 'cr', 'class_rep'].includes(row.role)
      }
    };
  };
  const validateRequested = (ctx, input = {}) => {
    for (const key of ['chatGroupId', 'chat_group_id']) if (input[key] !== undefined && String(input[key]) !== ctx.chatGroupId) throw unavailable();
    for (const key of ['group', 'groupCode']) if (input[key] !== undefined && input[key] !== ctx.groupCode) throw unavailable();
  };
  const withContext = (studentId, input, operation) => db.withTransaction(async tx => {
    const initial = await context(tx, studentId, input);
    await lockRoom(tx, initial.chatGroupId);
    const ctx = await context(tx, studentId, input); // Fresh under the publication/lifecycle fence.
    validateRequested(ctx, input);
    return operation(tx, ctx);
  });
  const members = (tx, ctx) => tx.all(`SELECT s.studentId AS student_id,s.name,s.username,s.avatarUrl AS avatar_url,s.supabase_uid
    FROM students s WHERE ((s.cohort_id=? AND UPPER(TRIM(s.department))='BIT') ${providers.includeStaff ? "OR s.role IN ('admin','teacher')" : ''})
    AND COALESCE(s.role,'student') NOT IN ('blocked','banned','suspended')
    AND NOT EXISTS(SELECT 1 FROM chat_room_revocations r WHERE r.chat_group_id=? AND r.student_id=s.studentId)
    ORDER BY s.studentId`, ctx.cohortId, ctx.chatGroupId);
  const selectMessage = `SELECT m.id,m.text,m.studentId AS student_id,m.createdAt AS created_at,
    m.attachmentName AS attachment_name,m.attachmentOriginalName AS attachment_original_name,
    m.attachmentMimeType AS attachment_mime_type,m.replyToId AS reply_id,m.client_id,m.chat_group_id,
    s.name,s.avatarUrl AS avatar_url,r.text AS reply_text,rs.name AS reply_sender
    FROM chat_messages m LEFT JOIN students s ON s.studentId=m.studentId
    LEFT JOIN chat_messages r ON r.id=m.replyToId AND r.chat_group_id=m.chat_group_id
    LEFT JOIN students rs ON rs.studentId=r.studentId`;
  const hydrate = async (tx, row) => {
    const reactions = await tx.all(`SELECT r.studentId AS student_id,r.emoji FROM chat_reactions r
      JOIN chat_messages m ON m.id=r.messageId WHERE m.chat_group_id=? AND m.id=?`, row.chat_group_id, row.id);
    const mentions = await tx.all(`SELECT x.mentioned_student_id AS target_id,s.username AS handle FROM chat_message_mentions x
      JOIN students s ON s.studentId=x.mentioned_student_id
      JOIN chat_messages m ON m.id=x.message_id WHERE m.chat_group_id=? AND m.id=?`, row.chat_group_id, row.id);
    return { id: Number(row.id), text: row.text, studentId: row.student_id, name: row.name, avatarUrl: row.avatar_url,
      createdAt: row.created_at, attachmentName: row.attachment_name, attachmentOriginalName: row.attachment_original_name,
      attachmentMimeType: row.attachment_mime_type, replyToId: row.reply_id, replyText: row.reply_text,
      replySender: row.reply_sender, clientId: row.client_id, chatGroupId: row.chat_group_id,
      reactions: reactions.map(r => ({ studentId: r.student_id, emoji: r.emoji })), mentions: mentions.map(m => m.target_id),
      mentionsDetail: mentions.map(m => ({studentId:m.target_id,handle:m.handle})) };
  };
  const message = async (tx, ctx, id) => {
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw unavailable();
    const row = await tx.get(`${selectMessage} WHERE m.chat_group_id=? AND m.id=?`, ctx.chatGroupId, Number(id));
    if (!row) throw unavailable();
    return hydrate(tx, row);
  };
  const event = async (tx, ctx, type, payload, expiresAt = null) => {
    if (ctx.roomStatus !== 'active' || ctx.cohortStatus !== 'active') throw unavailable();
    const id = randomUUID();
    const parent = type === 'delete_message' ? null : (payload.id || payload.messageId || payload.lastReadMessageId || null);
    await tx.run(`INSERT INTO chat_realtime_outbox(id,event_id,chat_group_id,realtime_epoch,event_type,payload_json,next_attempt_at,created_at,expires_at,parent_message_id)
      VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id`, id, id, ctx.chatGroupId, ctx.realtimeEpoch, type, JSON.stringify(payload), iso(), iso(), expiresAt, parent);
    return id;
  };
  const enqueuePush = async (tx, ctx, msg, mentions) => {
    const eligible = await members(tx, ctx);
    const recipients = eligible.filter(m => m.student_id !== ctx.studentId && (!mentions.length || mentions.includes(m.student_id)));
    for (const recipient of recipients) {
      if (!await tx.get('SELECT student_id FROM student_device_tokens WHERE student_id=? LIMIT 1', recipient.student_id)) continue;
      const groupKey = `chat:${ctx.chatGroupId}`;
      const preview = push.buildNotificationPreview(msg.text || msg.attachmentOriginalName || 'Attachment', 140);
      const payload = { title: `${ctx.groupCode} Group Chat${mentions.length ? ' — You were mentioned' : ''}`,
        body: `${ctx.name}: ${preview}`, channelId: 'chat', priority: 'high', groupKey,
        tag: `${groupKey}:${msg.id}`, data: { type: 'chat', subType: mentions.length ? 'mention' : 'message',
          chatGroupId: ctx.chatGroupId, messageId: msg.id, realtimeEpoch: ctx.realtimeEpoch,
          groupKey, actorId: ctx.studentId } };
      await tx.run(`INSERT INTO push_notification_outbox(event_type,event_id,recipient_student_id,payload_json,idempotency_key,status,next_attempt_at,chat_group_id,realtime_epoch)
        VALUES ('chat',?,?,?,?, 'pending',CURRENT_TIMESTAMP,?,?) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
      String(msg.id), recipient.student_id, JSON.stringify(payload), `cohort-chat:${ctx.chatGroupId}:${msg.id}:${recipient.student_id}`, ctx.chatGroupId, ctx.realtimeEpoch);
    }
  };
  const audit = (tx, actor, operation, roomId) => tx.run('INSERT INTO chat_lifecycle_audit(id,actor_id,operation,chat_group_id,created_at) VALUES (?,?,?,?,?) RETURNING id', randomUUID(), actor, operation, roomId, iso());
  const allocate = async (tx, code, year, semester, roster) => {
    if (!CODES.includes(code) || !Number.isInteger(year) || year < 1900 || year > 2300 || !Number.isInteger(semester) || semester < 1 || semester > 8) throw bad('Invalid cohort input.');
    if (!Array.isArray(roster) || new Set(roster).size !== roster.length) throw bad('An explicit unique roster is required.');
    const slot = await tx.get(`SELECT * FROM chat_group_slots WHERE group_code=?${sqlLock(tx)}`, code);
    if (!slot || slot.current_chat_group_id) throw new ChatError(409, 'Group code is occupied.');
    const cohortId = randomUUID(), roomId = randomUUID();
    const slotCode = code.toLowerCase();
    const displayName = code.charAt(0) + code.slice(1).toLowerCase();
    let hasSlotCode = false;
    if (tx.isPostgres) {
      hasSlotCode = true;
    } else {
      const cols = (await tx.all("PRAGMA table_info(cohorts)")).map(c => c.name);
      hasSlotCode = cols.includes('slot_code');
    }
    if (hasSlotCode) {
      await tx.run("INSERT INTO cohorts(id,intake_year,group_code,slot_code,display_name,current_semester,status,created_at) VALUES (?,?,?,?,?,?,'active',?) RETURNING id", cohortId, year, code, slotCode, displayName, semester, iso());
      try {
        await tx.run("INSERT INTO cohort_semester_history (id, cohort_id, semester_no, started_at, created_at) VALUES (?,?,?,?,?)", randomUUID(), cohortId, semester, iso(), iso());
      } catch {}
    } else {
      await tx.run("INSERT INTO cohorts(id,intake_year,group_code,current_semester,status,created_at) VALUES (?,?,?,?,'active',?) RETURNING id", cohortId, year, code, semester, iso());
    }
    await tx.run("INSERT INTO chat_groups(id,cohort_id,status,created_at) VALUES (?,?,'active',?) RETURNING id", roomId, cohortId, iso());
    for (const id of roster) {
      const result = await tx.run(`UPDATE students SET cohort_id=? WHERE studentId=? AND cohort_id IS NULL
        AND UPPER(TRIM(department))='BIT' AND COALESCE(role,'student') NOT IN ('blocked','banned','suspended')`, cohortId, id);
      if (result.changes !== 1) throw bad('Roster contains an ineligible, missing or already assigned student.');
    }
    await tx.run('UPDATE chat_group_slots SET current_chat_group_id=?,version=version+1 WHERE group_code=?', roomId, code);
    return { cohortId, chatGroupId: roomId, groupCode: code, realtimeEpoch: 1 };
  };
  const isShared = async (tx, filename) => {
    // Existing storage consumers. An unknown inventory cannot authorize deletion.
    if (await tx.get('SELECT id FROM chat_messages WHERE attachmentName=? LIMIT 1', filename)) return true;
    if (!providers.attachments?.isReferencedElsewhere) throw new ChatError(503, 'Attachment reference inventory unavailable.');
    return providers.attachments.isReferencedElsewhere(tx, filename);
  };

  const service = {
    getAuthenticatedChatContext: (studentId, input = {}) => withContext(studentId, input, async (_tx, ctx) => ctx),
    context: (studentId, input = {}) => withContext(studentId, input, async (_tx, ctx) => ctx),
    async history(studentId, input = {}) {
      return withContext(studentId, input, async (tx, ctx) => {
        const before = Number(input.before || 0), since = Number(input.since || input.after || 0);
        const limit = Math.max(1, Math.min(Number(input.limit) || 40, 200));
        if (![before, since, limit].every(Number.isSafeInteger) || before < 0 || since < 0) throw bad('Invalid pagination.');
        let predicate = 'm.chat_group_id=?', args = [ctx.chatGroupId];
        if (before) { predicate += ' AND m.id<?'; args.push(before); }
        else if (since) { predicate += ' AND m.id>?'; args.push(since); }
        if (input.q) { predicate += ' AND LOWER(m.text) LIKE ?'; args.push(`%${String(input.q).toLowerCase()}%`); }
        const rows = await tx.all(`${selectMessage} WHERE ${predicate} ORDER BY m.id ${since && !before ? 'ASC' : 'DESC'} LIMIT ?`, ...args, limit);
        if (!since || before) rows.reverse();
        const messages = [];
        for (const row of rows) messages.push(await hydrate(tx, row));
        const recent = Math.max(0, Math.min(Number(input.recent) || 0, 100));
        if (!Number.isSafeInteger(recent)) throw bad('Invalid recent limit.');
        const recentMessages = [];
        if (recent) {
          const latest = await tx.all(`${selectMessage} WHERE m.chat_group_id=? ORDER BY m.id DESC LIMIT ?`, ctx.chatGroupId, recent);
          for (const row of latest.reverse()) recentMessages.push(await hydrate(tx, row));
        }
        const receipts = await tx.all('SELECT student_id,last_read_message_id AS last_read_id FROM chat_room_read_receipts WHERE chat_group_id=?', ctx.chatGroupId);
        const typing = await tx.all(`SELECT t.student_id,s.name,t.last_typed_at FROM chat_room_typing t JOIN students s ON s.studentId=t.student_id
          WHERE t.chat_group_id=? AND t.expires_at>?`, ctx.chatGroupId, iso());
        return { chatGroupId: ctx.chatGroupId, messages, recentMessages,
          readReceipts: receipts.map(r => ({ studentId: r.student_id, lastReadMessageId: Number(r.last_read_id) })),
          typing: typing.map(r => ({ studentId: r.student_id, name: r.name, timestamp: r.last_typed_at })) };
      });
    },
    exact: (studentId, roomId, id) => withContext(studentId, { chatGroupId: roomId }, (tx, ctx) => message(tx, ctx, id)),
    async candidates(studentId, input = {}) {
      return withContext(studentId, input, async (tx, ctx) => {
        const list = await members(tx, ctx), q = String(input.q || '').toLowerCase();
        return list.filter(m => m.student_id !== studentId && `${m.name} ${m.username || ''}`.toLowerCase().includes(q))
          .slice(0, 25).map(m => ({ studentId: m.student_id, name: m.name, username: m.username, avatarUrl: m.avatar_url }));
      });
    },
    memberList: (studentId, input = {}) => withContext(studentId, input, async (tx, ctx) => (await members(tx, ctx)).map(m => ({ studentId: m.student_id, name: m.name, username: m.username, avatarUrl: m.avatar_url }))),
    async send(studentId, input = {}, attachment = null) {
      return withContext(studentId, input, async (tx, ctx) => {
        const clientId = input.clientId;
        if (typeof clientId !== 'string' || !clientId.trim() || clientId.length > 128) throw bad('A clientId of 1–128 characters is required.');
        const text = String(input.text || '').trim();
        if ((!text && !attachment) || text.length > 2000) throw bad('Message must contain text or an attachment; text limit is 2000.');
        let mentions = input.mentions || [];
        if (typeof mentions === 'string') { try { mentions = JSON.parse(mentions); } catch { throw bad('Invalid mentions.'); } }
        if (!Array.isArray(mentions) || mentions.length > 50 || mentions.some(id => typeof id !== 'string')) throw bad('Invalid mentions.');
        mentions = [...new Set(mentions)].filter(id => id !== studentId);
        const eligible = new Set((await members(tx, ctx)).map(m => m.student_id));
        if (mentions.some(id => !eligible.has(id))) throw bad('One or more mentions are unavailable.');
        const reply = input.replyToId ? await message(tx, ctx, input.replyToId) : null;
        // Tombstone identity survives individual message deletion; a delayed
        // retry cannot resurrect deleted content under the same client ID.
        const existing = await tx.get('SELECT original_message_id AS id FROM chat_send_keys WHERE chat_group_id=? AND sender_student_id=? AND client_id=?', ctx.chatGroupId, studentId, clientId);
        if (existing) return { data: await message(tx, ctx, existing.id), messageId: Number(existing.id), duplicate: true };
        let filename = null;
        if (attachment) {
          if (!Buffer.isBuffer(attachment.buffer) || attachment.buffer.length > 25 * 1024 * 1024) throw bad('Invalid attachment.');
          filename = `cohort-${randomUUID()}`;
          await tx.run('INSERT INTO file_blobs(filename,mimeType,fileData,createdAt) VALUES (?,?,?,?) RETURNING id', filename, attachment.mimetype || 'application/octet-stream', attachment.buffer, iso());
          await tx.run('INSERT INTO chat_attachment_ownership(chat_group_id,filename) VALUES (?,?) RETURNING filename', ctx.chatGroupId, filename);
        }
        await testPoint('send-before-insert');
        const inserted = await tx.run(`INSERT INTO chat_messages(studentId,text,attachmentName,attachmentOriginalName,attachmentMimeType,replyToId,createdAt,chat_group_id,client_id)
          VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`, studentId, text, filename, attachment?.originalname || null, attachment?.mimetype || null, reply?.id || null, iso(), ctx.chatGroupId, clientId);
        const id = inserted.lastInsertRowid;
        await tx.run('INSERT INTO chat_send_keys(chat_group_id,sender_student_id,client_id,original_message_id) VALUES (?,?,?,?) RETURNING original_message_id', ctx.chatGroupId, studentId, clientId, id);
        for (const target of mentions) await tx.run('INSERT INTO chat_message_mentions(message_id,mentioned_student_id) VALUES (?,?) RETURNING id', id, target);
        const msg = await message(tx, ctx, id);
        await enqueuePush(tx, ctx, msg, mentions);
        await event(tx, ctx, 'new_message', msg);
        await testPoint('send-before-commit');
        return { data: msg, messageId: Number(id), duplicate: false };
      });
    },
    async reaction(studentId, input) {
      return withContext(studentId, input, async (tx, ctx) => {
        const msg = await message(tx, ctx, input.messageId);
        if (!['👍','❤️','😂','😮','😢','🙏','🔥'].includes(input.emoji)) throw bad('Unsupported reaction.');
        await testPoint('reaction-before-write');
        const existing = await tx.get('SELECT emoji FROM chat_reactions WHERE messageId=? AND studentId=?', msg.id, studentId);
        const action = existing?.emoji === input.emoji ? 'remove' : existing ? 'update' : 'add';
        if (action === 'remove') await tx.run('DELETE FROM chat_reactions WHERE messageId=? AND studentId=?', msg.id, studentId);
        else await tx.run(`INSERT INTO chat_reactions(messageId,studentId,emoji) VALUES (?,?,?)
          ON CONFLICT(messageId,studentId) DO UPDATE SET emoji=excluded.emoji RETURNING messageId`, msg.id, studentId, input.emoji);
        await event(tx, ctx, 'reaction_update', { messageId: msg.id, studentId, emoji: input.emoji, action });
        return { action };
      });
    },
    async read(studentId, input) {
      return withContext(studentId, input, async (tx, ctx) => {
        const msg = await message(tx, ctx, input.lastReadMessageId);
        const old = await tx.get('SELECT last_read_message_id AS last_read_id FROM chat_room_read_receipts WHERE chat_group_id=? AND student_id=?', ctx.chatGroupId, studentId);
        const id = Math.max(Number(old?.last_read_id || 0), msg.id);
        await tx.run(`INSERT INTO chat_room_read_receipts(chat_group_id,student_id,last_read_message_id) VALUES (?,?,?)
          ON CONFLICT(chat_group_id,student_id) DO UPDATE SET last_read_message_id=excluded.last_read_message_id RETURNING student_id`, ctx.chatGroupId, studentId, id);
        if (id !== Number(old?.last_read_id)) await event(tx, ctx, 'read_receipt', { studentId, lastReadMessageId: id });
        return { lastReadMessageId: id };
      });
    },
    async typing(studentId, input = {}) {
      return withContext(studentId, input, async (tx, ctx) => {
        const old = await tx.get('SELECT last_typed_at FROM chat_room_typing WHERE chat_group_id=? AND student_id=?', ctx.chatGroupId, studentId);
        if (old && now().getTime() - new Date(old.last_typed_at).getTime() < 2000) return { coalesced: true };
        const expiry = later(4000);
        await tx.run(`INSERT INTO chat_room_typing(chat_group_id,student_id,last_typed_at,expires_at) VALUES (?,?,?,?)
          ON CONFLICT(chat_group_id,student_id) DO UPDATE SET last_typed_at=excluded.last_typed_at,expires_at=excluded.expires_at RETURNING student_id`, ctx.chatGroupId, studentId, iso(), expiry);
        await event(tx, ctx, 'typing', { studentId, name: ctx.name, timestamp: iso(), expiresAt: expiry }, expiry);
        return { coalesced: false };
      });
    },
    async heartbeat(studentId, input, sessionId) {
      return withContext(studentId, input, async (tx, ctx) => {
        if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 160) throw bad('Authenticated session identity is required.');
        await tx.run('DELETE FROM chat_online_sessions WHERE chat_group_id=? AND expires_at<=?', ctx.chatGroupId, iso());
        const old = await tx.get('SELECT last_seen_at FROM chat_online_sessions WHERE chat_group_id=? AND student_id=? AND session_id=?', ctx.chatGroupId, studentId, sessionId);
        if (!old || now().getTime() - new Date(old.last_seen_at).getTime() >= 25000) {
          await tx.run(`INSERT INTO chat_online_sessions(chat_group_id,student_id,session_id,last_seen_at,expires_at) VALUES (?,?,?,?,?)
            ON CONFLICT(chat_group_id,student_id,session_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,expires_at=excluded.expires_at RETURNING student_id`, ctx.chatGroupId, studentId, sessionId, iso(), later(75000));
          const online = await tx.all('SELECT student_id,MAX(expires_at) AS expires_at FROM chat_online_sessions WHERE chat_group_id=? AND expires_at>? GROUP BY student_id', ctx.chatGroupId, iso());
          await event(tx, ctx, 'online_snapshot', { members: online.map(r => ({ studentId: r.student_id, expiresAt: r.expires_at })) }, later(75000));
        }
        const rows = await tx.all('SELECT student_id,MAX(expires_at) AS expires_at FROM chat_online_sessions WHERE chat_group_id=? AND expires_at>? GROUP BY student_id', ctx.chatGroupId, iso());
        return { onlineIds: rows.map(r => r.student_id), total: rows.length, members: rows.map(r => ({studentId:r.student_id,expiresAt:r.expires_at})) };
      });
    },
    async pinned(studentId, input = {}) {
      return withContext(studentId, input, async (tx, ctx) => {
        const row = await tx.get('SELECT message_id AS target_id FROM chat_pinned_announcements WHERE chat_group_id=?', ctx.chatGroupId);
        return { pinned: row ? await message(tx, ctx, row.target_id) : null };
      });
    },
    async pin(studentId, input, id = null) {
      return withContext(studentId, input, async (tx, ctx) => {
        const msg = id ? await message(tx, ctx, id) : null;
        if (!['admin','cr','class_rep'].includes(ctx.role)) throw new ChatError(403, 'Pin permission required.');
        if (msg) await tx.run(`INSERT INTO chat_pinned_announcements(chat_group_id,message_id,pinned_by,pinned_at) VALUES (?,?,?,?)
          ON CONFLICT(chat_group_id) DO UPDATE SET message_id=excluded.message_id,pinned_by=excluded.pinned_by,pinned_at=excluded.pinned_at RETURNING chat_group_id`, ctx.chatGroupId, msg.id, studentId, iso());
        else await tx.run('DELETE FROM chat_pinned_announcements WHERE chat_group_id=?', ctx.chatGroupId);
        await event(tx, ctx, 'pin_message', { messageId: msg?.id || null });
        return { success: true };
      });
    },
    async remove(studentId, input, id) {
      return withContext(studentId, input, async (tx, ctx) => {
        const msg = await message(tx, ctx, id);
        if (msg.studentId !== studentId && ctx.role !== 'admin') throw new ChatError(403, 'Delete permission required.');
        await tx.run('DELETE FROM chat_pinned_announcements WHERE chat_group_id=? AND message_id=?', ctx.chatGroupId, msg.id);
        await tx.run('DELETE FROM chat_room_read_receipts WHERE chat_group_id=? AND last_read_message_id=?', ctx.chatGroupId, msg.id);
        await tx.run('UPDATE chat_messages SET replyToId=NULL WHERE chat_group_id=? AND replyToId=?', ctx.chatGroupId, msg.id);
        await tx.run('DELETE FROM chat_reactions WHERE messageId IN (SELECT id FROM chat_messages WHERE chat_group_id=? AND id=?)', ctx.chatGroupId, msg.id);
        await tx.run('DELETE FROM chat_message_mentions WHERE message_id IN (SELECT id FROM chat_messages WHERE chat_group_id=? AND id=?)', ctx.chatGroupId, msg.id);
        await tx.run("UPDATE push_notification_outbox SET status='cancelled' WHERE chat_group_id=? AND event_id=?", ctx.chatGroupId, String(msg.id));
        await tx.run("UPDATE chat_realtime_outbox SET status='cancelled' WHERE chat_group_id=? AND parent_message_id=? AND status<>'sent'", ctx.chatGroupId, msg.id);
        await tx.run('DELETE FROM chat_messages WHERE chat_group_id=? AND id=?', ctx.chatGroupId, msg.id);
        // File bytes become inaccessible immediately. Recycle inventory also
        // covers message-deletion orphans via durable attachment ownership.
        await event(tx, ctx, 'delete_message', { messageId: msg.id });
        return { success: true };
      });
    },
    attachment: (studentId, input, filename) => withContext(studentId, input, async (tx, ctx) => {
      const row = await tx.get(`SELECT b.fileData AS blob_data,m.attachmentMimeType AS mime_type FROM chat_messages m
        JOIN file_blobs b ON b.filename=m.attachmentName WHERE m.chat_group_id=? AND m.attachmentName=?`, ctx.chatGroupId, filename);
      if (!row) throw unavailable();
      return { buffer: Buffer.from(row.blob_data), mimeType: row.mime_type };
    }),

    createCohort: (actor, input) => db.withTransaction(async tx => {
      await admin(tx, actor);
      const result = await allocate(tx, input.groupCode, input.intakeYear, input.currentSemester || 1, input.studentIds || []);
      await audit(tx, actor, 'create', result.chatGroupId);
      return result;
    }),
    advance: (actor, roomId, expectedVersion) => db.withTransaction(async tx => {
      await admin(tx, actor); const room = await lockRoom(tx, roomId);
      const c = await tx.get('SELECT * FROM cohorts WHERE id=?', room.cohort_id);
      if (room.status !== 'active' || c.status !== 'active' || c.current_semester >= 8 || c.version !== expectedVersion) throw new ChatError(409, 'Cohort version or semester changed.');
      await tx.run('UPDATE cohorts SET current_semester=current_semester+1,version=version+1 WHERE id=?', c.id);
      await audit(tx, actor, 'advance', roomId);
      return { cohortId: c.id, chatGroupId: roomId, currentSemester: c.current_semester + 1, version: c.version + 1 };
    }),
    graduate: (actor, roomId) => db.withTransaction(async tx => {
      await admin(tx, actor); const room = await lockRoom(tx, roomId);
      const c = await tx.get('SELECT * FROM cohorts WHERE id=?', room.cohort_id);
      if (room.status !== 'active' || c.status !== 'active' || c.current_semester !== 8) throw new ChatError(409, 'Only an active semester-8 cohort may graduate.');
      await tx.run("UPDATE cohorts SET status='graduated',graduated_at=?,version=version+1 WHERE id=?", iso(), c.id);
      await tx.run("UPDATE chat_groups SET status='closed',closed_at=?,projection_status='pending' WHERE id=?", iso(), roomId);
      await tx.run('UPDATE chat_realtime_memberships SET active=0 WHERE chat_group_id=?', roomId);
      await tx.run("UPDATE chat_realtime_outbox SET status='cancelled' WHERE chat_group_id=? AND status<>'sent'", roomId);
      await tx.run("UPDATE push_notification_outbox SET status='cancelled' WHERE chat_group_id=? AND status='pending'", roomId);
      await audit(tx, actor, 'graduate', roomId);
      await testPoint('graduate-before-commit');
      return { chatGroupId: roomId, status: 'closed' };
    }),
    rotate: (actor, roomId, revokeStudentId) => db.withTransaction(async tx => {
      await admin(tx, actor); const room = await lockRoom(tx, roomId);
      if (room.status !== 'active') throw unavailable();
      if (revokeStudentId) {
        if (!await tx.get('SELECT studentId FROM students WHERE studentId=? AND cohort_id=?', revokeStudentId, room.cohort_id)) throw unavailable();
        await tx.run('INSERT INTO chat_room_revocations(chat_group_id,student_id) VALUES (?,?) ON CONFLICT DO NOTHING RETURNING student_id', roomId, revokeStudentId);
        await tx.run('DELETE FROM chat_online_sessions WHERE chat_group_id=? AND student_id=?', roomId, revokeStudentId);
        await tx.run('DELETE FROM chat_room_typing WHERE chat_group_id=? AND student_id=?', roomId, revokeStudentId);
      }
      await tx.run("UPDATE chat_groups SET realtime_epoch=realtime_epoch+1,projection_status='pending' WHERE id=?", roomId);
      await tx.run('UPDATE chat_realtime_memberships SET active=0 WHERE chat_group_id=?', roomId);
      await tx.run("UPDATE chat_realtime_outbox SET status='cancelled' WHERE chat_group_id=? AND status<>'sent'", roomId);
      await tx.run("UPDATE push_notification_outbox SET status='cancelled' WHERE chat_group_id=? AND status='pending'", roomId);
      await audit(tx, actor, 'rotate', roomId);
      await testPoint('rotate-before-commit');
      return { realtimeEpoch: room.realtime_epoch + 1 };
    }),
    async syncProjection(roomId) {
      // Persist a closed gate first. If remote sync succeeds but the following
      // SQL transaction fails, rollback must not restore an old ready state.
      await db.withTransaction(async tx => {
        await lockRoom(tx, roomId);
        await tx.run("UPDATE chat_groups SET projection_status='pending' WHERE id=?", roomId);
      });
      return db.withTransaction(async tx => {
        const room = await lockRoom(tx, roomId);
        const ctx = { chatGroupId: roomId, cohortId: room.cohort_id };
        const projected = [];
        try {
          if (!providers.projection?.sync || !providers.credentials?.subject) throw new Error('Projection provider unavailable');
          const roster = room.status === 'active' ? await members(tx, ctx) : [];
          for (const member of roster) projected.push({ studentId: member.student_id, subject: await providers.credentials.subject(member) });
          if (projected.some(m => !m.subject) || new Set(projected.map(m => m.subject)).size !== projected.length) throw new Error('Subject mapping unavailable');
          const snapshot = { chatGroupId: roomId, realtimeEpoch: room.realtime_epoch, status: room.status, members: projected };
          const ack = await providers.projection.sync(snapshot);
          if (ack?.chatGroupId !== roomId || ack?.realtimeEpoch !== room.realtime_epoch || ack?.status !== room.status ||
              JSON.stringify(ack.members) !== JSON.stringify(projected)) throw new Error('Projection mismatch');
        } catch (syncErr) {
          console.error('[cohort-chat] syncProjection failed for room', roomId, ':', syncErr?.message);
          await tx.run("UPDATE chat_groups SET projection_status='failed' WHERE id=?", roomId);
          return { ready: false };
        }
        await tx.run('DELETE FROM chat_realtime_memberships WHERE chat_group_id=?', roomId);
        for (const m of projected) await tx.run(`INSERT INTO chat_realtime_memberships(chat_group_id,student_id,subject,realtime_epoch,active)
          VALUES (?,?,?,?,1) RETURNING student_id`, roomId, m.studentId, m.subject, room.realtime_epoch);
        await testPoint('projection-before-ready');
        await tx.run("UPDATE chat_groups SET projection_status='ready',projection_epoch=? WHERE id=?", room.realtime_epoch, roomId);
        return { ready: true };
      });
    },
    realtimeConfig: (studentId, input = {}) => withContext(studentId, input, async (tx, ctx) => {
      if (ctx.projectionStatus !== 'ready' || ctx.projectionEpoch !== ctx.realtimeEpoch || !providers.credentials?.issue) throw new ChatError(503, 'Realtime authorization is not ready.');
      const member = await tx.get('SELECT subject FROM chat_realtime_memberships WHERE chat_group_id=? AND student_id=? AND realtime_epoch=? AND active=1', ctx.chatGroupId, studentId, ctx.realtimeEpoch);
      if (!member) throw new ChatError(503, 'Realtime authorization is not ready.');
      const expiry = later(120000), topic = `chat:${ctx.chatGroupId}:${ctx.realtimeEpoch}`;
      const token = await providers.credentials.issue({ subject: member.subject, chatGroupId: ctx.chatGroupId, realtimeEpoch: ctx.realtimeEpoch, expiry });
      if (typeof token !== 'string' || !token) throw new ChatError(503, 'Realtime credential unavailable.');
      const connection = providers.realtime?.publicConnection;
      return { chatGroupId: ctx.chatGroupId, realtimeEpoch: ctx.realtimeEpoch, topic, expiry, token,
        ...(connection ? { url: connection.url, key: connection.key } : {}) };
    }),
    async publishRealtime(id) {
      const ref = await db.get('SELECT chat_group_id FROM chat_realtime_outbox WHERE id=?', id);
      if (!ref) return { status: 'missing' };
      return db.withTransaction(async tx => {
        const room = await lockRoom(tx, ref.chat_group_id);
        const row = await tx.get(`SELECT * FROM chat_realtime_outbox WHERE id=? AND chat_group_id=?${sqlLock(tx)}`, id, room.id);
        if (!row || !['pending','retry'].includes(row.status) || row.next_attempt_at > iso()) return { status: row?.status || 'missing' };
        if (room.status !== 'active' || row.realtime_epoch !== room.realtime_epoch || (row.expires_at && row.expires_at <= iso())) {
          await tx.run("UPDATE chat_realtime_outbox SET status='cancelled' WHERE id=? AND chat_group_id=?", id, room.id);
          return { status: 'cancelled' };
        }
        if (room.projection_status !== 'ready' || room.projection_epoch !== room.realtime_epoch || !providers.realtime?.send) return { status: 'projection_blocked' };
        await tx.run("UPDATE chat_realtime_outbox SET status='processing',attempts=attempts+1 WHERE id=? AND chat_group_id=?", id, room.id);
        try {
          await providers.realtime.send({ topic: `chat:${room.id}:${room.realtime_epoch}`, private: true,
            event: row.event_type, payload: { ...decode(row.payload_json), eventId: row.event_id, chatGroupId: room.id, realtimeEpoch: room.realtime_epoch } });
          await tx.run("UPDATE chat_realtime_outbox SET status='sent',sent_at=? WHERE id=? AND chat_group_id=?", iso(), id, room.id);
          return { status: 'sent' };
        } catch {
          await tx.run("UPDATE chat_realtime_outbox SET status='retry',next_attempt_at=? WHERE id=? AND chat_group_id=?", later(Math.min(300000, 1000 * 2 ** Math.min(row.attempts, 8))), id, room.id);
          return { status: 'retry' };
        }
      });
    },
    async deliverPush(id, options = {}) {
      if (!providers.push?.sendBatch) return { status: 'provider_unavailable' };
      const ref = await db.get('SELECT chat_group_id FROM push_notification_outbox WHERE id=?', id);
      if (!ref?.chat_group_id) return { status: 'missing' };
      return db.withTransaction(async tx => {
        const room = await lockRoom(tx, ref.chat_group_id);
        const row = await tx.get(`SELECT * FROM push_notification_outbox WHERE id=? AND chat_group_id=?${sqlLock(tx)}`, id, room.id);
        if (!row || row.status !== 'pending') return { status: row?.status || 'missing' };
        const payload = decode(row.payload_json);
        let allowed = room.status === 'active' && row.realtime_epoch === room.realtime_epoch;
        try {
          const recipient = await context(tx, row.recipient_student_id);
          allowed = allowed && recipient.chatGroupId === room.id && payload.data?.chatGroupId === room.id;
          if (allowed) await message(tx, recipient, Number(row.event_id));
        } catch { allowed = false; }
        if (!allowed) { await tx.run("UPDATE push_notification_outbox SET status='cancelled' WHERE id=? AND chat_group_id=?", id, room.id); return { status: 'cancelled' }; }
        return push.processPushOutbox(tx, { ...options, sendBatch: providers.push.sendBatch, onlyOutboxId: id, chatRoomFence: { chatGroupId: room.id, realtimeEpoch: room.realtime_epoch } });
      });
    },
    async beginRecycle(actor, roomId, input) {
      return db.withTransaction(async tx => {
        await admin(tx, actor);
        if (!input.requestKey || typeof input.requestKey !== 'string' || input.requestKey.length > 128) throw bad('Recycle requestKey required.');
        const before = await tx.get('SELECT cohort_id FROM chat_groups WHERE id=?', roomId);
        if (!before?.cohort_id) throw unavailable();
        const cohort = await tx.get('SELECT * FROM cohorts WHERE id=?', before.cohort_id);
        await tx.get(`SELECT * FROM chat_group_slots WHERE group_code=?${sqlLock(tx)}`, cohort.group_code);
        const room = await lockRoom(tx, roomId);
        const existing = await tx.get('SELECT * FROM chat_recycle_jobs WHERE chat_group_id=?', roomId);
        if (existing) {
          if (existing.intake_year !== input.intakeYear || JSON.stringify(decode(existing.roster_json)) !== JSON.stringify(input.studentIds || [])) throw new ChatError(409, 'Recycle input differs from existing operation.');
          return existing;
        }
        if (room.status !== 'closed' || cohort.status !== 'graduated' || cohort.current_semester !== 8) throw new ChatError(409, 'Only a closed graduated cohort may be recycled.');
        if (!Number.isInteger(input.intakeYear) || input.intakeYear < 1900 || input.intakeYear > 2300 || !Array.isArray(input.studentIds || [])) throw bad('Invalid incoming roster/intake.');
        const id = randomUUID();
        await tx.run("INSERT INTO chat_recycle_jobs(id,chat_group_id,request_key,state,intake_year,roster_json,created_at) VALUES (?,?,?,'erasure_pending',?,?,?) RETURNING id", id, roomId, input.requestKey, input.intakeYear, JSON.stringify(input.studentIds || []), iso());
        await tx.run("UPDATE chat_groups SET status='recycling' WHERE id=?", roomId);
        const files = await tx.all('SELECT DISTINCT filename FROM chat_attachment_ownership WHERE chat_group_id=?', roomId);
        for (const f of files) await tx.run("INSERT INTO chat_erasure_files(job_id,filename,status) VALUES (?,?,'pending') RETURNING filename", id, f.filename);
        await tx.run('DELETE FROM push_receipt_tickets WHERE outbox_id IN (SELECT id FROM push_notification_outbox WHERE chat_group_id=?)', roomId);
        await tx.run('DELETE FROM push_notification_outbox WHERE chat_group_id=?', roomId);
        await tx.run('DELETE FROM chat_realtime_outbox WHERE chat_group_id=?', roomId);
        for (const table of ['chat_room_read_receipts','chat_room_typing','chat_pinned_announcements','chat_online_sessions','chat_realtime_memberships','chat_room_revocations']) await tx.run(`DELETE FROM ${table} WHERE chat_group_id=?`, roomId);
        await tx.run('DELETE FROM chat_reactions WHERE messageId IN (SELECT id FROM chat_messages WHERE chat_group_id=?)', roomId);
        await tx.run('DELETE FROM chat_message_mentions WHERE message_id IN (SELECT id FROM chat_messages WHERE chat_group_id=?)', roomId);
        await tx.run('DELETE FROM chat_send_keys WHERE chat_group_id=?', roomId);
        await tx.run('DELETE FROM chat_messages WHERE chat_group_id=?', roomId);
        await audit(tx, actor, 'recycle-start', roomId);
        await testPoint('recycle-before-commit');
        return tx.get('SELECT * FROM chat_recycle_jobs WHERE id=?', id);
      });
    },
    async finishRecycle(actor, jobId) {
      return db.withTransaction(async tx => {
        await admin(tx, actor);
        const ref = await tx.get('SELECT * FROM chat_recycle_jobs WHERE id=?', jobId);
        if (!ref) throw unavailable();
        const old = await tx.get('SELECT cohort_id FROM chat_groups WHERE id=?', ref.chat_group_id);
        const cohort = await tx.get('SELECT * FROM cohorts WHERE id=?', old.cohort_id);
        await tx.get(`SELECT * FROM chat_group_slots WHERE group_code=?${sqlLock(tx)}`, cohort.group_code);
        const room = await lockRoom(tx, ref.chat_group_id);
        const job = await tx.get('SELECT * FROM chat_recycle_jobs WHERE id=?', jobId);
        if (job.state === 'complete') return { chatGroupId: job.new_chat_group_id, duplicate: true };
        if (room.status !== 'recycling') throw unavailable();
        const files = await tx.all("SELECT * FROM chat_erasure_files WHERE job_id=? AND status='pending'", jobId);
        for (const file of files) {
          if (await isShared(tx, file.filename)) {
            await tx.run("UPDATE chat_erasure_files SET status='shared' WHERE job_id=? AND filename=?", jobId, file.filename);
            continue;
          }
          if (!providers.attachments?.eraseExternal) throw new ChatError(503, 'External erasure provider unavailable.');
          // Idempotent provider; failure rolls back finalization. The separate
          // beginRecycle transaction already closed access and erased content.
          await providers.attachments.eraseExternal(file.filename);
          await tx.run('DELETE FROM file_blobs WHERE filename=?', file.filename);
          await tx.run("UPDATE chat_erasure_files SET status='deleted' WHERE job_id=? AND filename=?", jobId, file.filename);
        }
        await tx.run('DELETE FROM chat_attachment_ownership WHERE chat_group_id=?', room.id);
        await tx.run("UPDATE chat_groups SET status='recycled',recycled_at=? WHERE id=?", iso(), room.id);
        await tx.run('UPDATE chat_group_slots SET current_chat_group_id=NULL,version=version+1 WHERE group_code=? AND current_chat_group_id=?', cohort.group_code, room.id);
        const fresh = await allocate(tx, cohort.group_code, job.intake_year, 1, decode(job.roster_json));
        await tx.run("UPDATE chat_recycle_jobs SET state='complete',new_chat_group_id=?,completed_at=? WHERE id=?", fresh.chatGroupId, iso(), jobId);
        await audit(tx, actor, 'recycle-complete', room.id);
        return fresh;
      });
    },
  };
  return service;
}
module.exports = { createCohortChat, createCohortChatService: createCohortChat, ChatError };
