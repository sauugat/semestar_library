'use strict';

const crypto = require('crypto');
const gamesTicket = require('./games-ticket');

const LUDO_INVITATION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_INVITATIONS_PER_MINUTE = 5;
const ROOM_CODE_REGEX = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates whether a room code strictly conforms to the expected 6-character format.
 */
function isValidRoomCode(input) {
  if (typeof input !== 'string') return false;
  const normalized = input.trim().toUpperCase();
  return ROOM_CODE_REGEX.test(normalized);
}

/**
 * Validates whether an ID is a valid UUID.
 */
function isValidInvitationId(input) {
  if (typeof input !== 'string') return false;
  return UUID_REGEX.test(input.trim());
}

/**
 * Ensures schema tables and indexes exist for Game Invitations.
 * Supports both PostgreSQL and SQLite.
 */
async function ensureGamesInvitationsSchema(db) {
  if (db.isPostgres) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS game_invitations (
        id TEXT PRIMARY KEY,
        game_type TEXT NOT NULL,
        room_id TEXT NOT NULL,
        room_generation INTEGER NOT NULL DEFAULT 1,
        inviter_user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
        invitee_user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMPTZ NOT NULL,
        accepted_at TIMESTAMPTZ,
        declined_at TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ
      );
      ALTER TABLE game_invitations ADD COLUMN IF NOT EXISTS game_type TEXT;
      ALTER TABLE game_invitations ADD COLUMN IF NOT EXISTS room_id TEXT;
      ALTER TABLE game_invitations ADD COLUMN IF NOT EXISTS room_generation INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE game_invitations ADD COLUMN IF NOT EXISTS inviter_user_id TEXT;
      ALTER TABLE game_invitations ADD COLUMN IF NOT EXISTS invitee_user_id TEXT;
      ALTER TABLE game_invitations ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
      ALTER TABLE game_invitations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE game_invitations ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
      ALTER TABLE game_invitations ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
      ALTER TABLE game_invitations ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;
      ALTER TABLE game_invitations ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS idx_game_invitations_invitee_status ON game_invitations(invitee_user_id, status);
      CREATE INDEX IF NOT EXISTS idx_game_invitations_inviter ON game_invitations(inviter_user_id);
      CREATE INDEX IF NOT EXISTS idx_game_invitations_room ON game_invitations(room_id);
      CREATE INDEX IF NOT EXISTS idx_game_invitations_expires ON game_invitations(expires_at);
      CREATE INDEX IF NOT EXISTS idx_game_invitations_inviter_created ON game_invitations(inviter_user_id, created_at);
      DROP INDEX IF EXISTS uq_game_invitations_pending;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_game_invitations_gen_pending ON game_invitations(room_id, room_generation, inviter_user_id, invitee_user_id) WHERE status = 'pending';
    `);
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS game_invitations (
        id TEXT PRIMARY KEY,
        game_type TEXT NOT NULL,
        room_id TEXT NOT NULL,
        room_generation INTEGER NOT NULL DEFAULT 1,
        inviter_user_id TEXT NOT NULL,
        invitee_user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        accepted_at DATETIME,
        declined_at DATETIME,
        cancelled_at DATETIME,
        FOREIGN KEY (inviter_user_id) REFERENCES students(studentId) ON DELETE CASCADE,
        FOREIGN KEY (invitee_user_id) REFERENCES students(studentId) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_game_invitations_invitee_status ON game_invitations(invitee_user_id, status);
      CREATE INDEX IF NOT EXISTS idx_game_invitations_inviter ON game_invitations(inviter_user_id);
      CREATE INDEX IF NOT EXISTS idx_game_invitations_room ON game_invitations(room_id);
      CREATE INDEX IF NOT EXISTS idx_game_invitations_expires ON game_invitations(expires_at);
      CREATE INDEX IF NOT EXISTS idx_game_invitations_inviter_created ON game_invitations(inviter_user_id, created_at);
    `);
    try {
      const tableInfo = await db.all(`PRAGMA table_info(game_invitations)`);
      const hasGeneration = tableInfo && tableInfo.some((col) => col.name === 'room_generation');
      if (!hasGeneration) {
        await db.exec(`ALTER TABLE game_invitations ADD COLUMN room_generation INTEGER NOT NULL DEFAULT 1;`);
      }
    } catch {}
    await db.exec(`
      DROP INDEX IF EXISTS uq_game_invitations_pending;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_game_invitations_gen_pending ON game_invitations(room_id, room_generation, inviter_user_id, invitee_user_id) WHERE status = 'pending';
    `);
  }
}

// In-memory sliding rate limiter per inviter (fast path)
const inviterRateLimitMap = new Map();

function checkRateLimit(inviterUserId, maxPerMin = MAX_INVITATIONS_PER_MINUTE) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  let timestamps = inviterRateLimitMap.get(inviterUserId) || [];
  timestamps = timestamps.filter(t => now - t < windowMs);

  if (timestamps.length >= maxPerMin) {
    inviterRateLimitMap.set(inviterUserId, timestamps);
    return false;
  }

  timestamps.push(now);
  inviterRateLimitMap.set(inviterUserId, timestamps);
  return true;
}

// Database-backed rate limiter per inviter (distributed authority)
async function checkDbRateLimit(db, inviterUserId, maxPerMin = MAX_INVITATIONS_PER_MINUTE) {
  try {
    let row;
    if (db.isPostgres) {
      row = await db.get(
        `SELECT COUNT(*) as count FROM game_invitations
         WHERE inviter_user_id = ? AND created_at >= NOW() - INTERVAL '60 seconds'`,
        inviterUserId
      );
    } else {
      row = await db.get(
        `SELECT COUNT(*) as count FROM game_invitations
         WHERE inviter_user_id = ? AND created_at >= datetime('now', '-60 seconds')`,
        inviterUserId
      );
    }
    const count = Number(row?.count || row?.COUNT || 0);
    return count < maxPerMin;
  } catch {
    return true; // Fall back gracefully to memory rate limiter on query issue
  }
}

function clearRateLimits() {
  inviterRateLimitMap.clear();
}

/**
 * Searches users safely without exposing private fields (email, tokens, etc.).
 * Minimum 2 characters. Limit 20.
 */
async function searchUsers(db, { query, currentUserId, limit = 20 }) {
  if (!query || typeof query !== 'string') return [];
  const cleanQuery = query.trim().toLowerCase();
  if (cleanQuery.length < 2) return [];

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const pattern = `%${cleanQuery}%`;

  const rows = await db.all(
    `SELECT studentId, username, name, avatarUrl
     FROM students
     WHERE (LOWER(name) LIKE ? OR LOWER(username) LIKE ?)
       AND studentId != ?
       AND COALESCE(role, 'student') NOT IN ('blocked', 'banned', 'suspended')
     LIMIT ?`,
    pattern,
    pattern,
    currentUserId || '',
    safeLimit
  );

  return (rows || []).map(r => ({
    studentId: r.studentId || r.studentid,
    userId: r.studentId || r.studentid,
    name: r.name || 'Student',
    username: r.username || null,
    avatarUrl: r.avatarUrl || r.avatarurl || null,
  }));
}

/**
 * Authoritatively verifies room state with Games Worker.
 */
async function fetchAuthoritativeRoomState(roomId, user, options = {}) {
  const customFetch = options.fetchFn || globalThis.fetch;
  const baseUrl = (options.gamesServiceUrl || process.env.GAMES_SERVICE_URL || 'https://semester-library-games.semester-library-games.workers.dev').replace(/\/+$/, '');
  const url = `${baseUrl}/rooms/${encodeURIComponent(roomId)}`;

  let ticket = null;
  try {
    ticket = gamesTicket.createGamesTicket(user, options.customTicketSecret, {
      role: options.role,
    });
  } catch (err) {
    return { exists: false, error: 'TICKET_CREATION_FAILED', message: err.message };
  }

  try {
    const res = await customFetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ticket}`,
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      if (res.status === 404) {
        return { exists: false, error: 'ROOM_NOT_FOUND', message: 'Room not found.' };
      }
      return { exists: false, error: 'ROOM_UNAVAILABLE', message: `Room service returned ${res.status}.` };
    }

    const data = await res.json();
    return {
      exists: true,
      gameType: data.gameType,
      roomStatus: data.roomStatus,
      hostUserId: data.hostUserId,
      activeSeatCount: data.activeSeatCount,
      roomGeneration: data.roomGeneration,
      seats: data.seats,
      revision: data.revision,
    };
  } catch (err) {
    return { exists: false, error: 'NETWORK_ERROR', message: err.message };
  }
}

/**
 * Creates an authenticated Ludo private lobby invitation.
 */
async function createInvitation(db, {
  roomId,
  inviterUser,
  inviteeUserId,
  gamesServiceUrl,
  customTicketSecret,
  pushNotifications,
  fetchFn,
} = {}) {
  if (!inviterUser || !inviterUser.studentId) {
    throw new Error('Authenticated inviter is required.');
  }
  const inviterId = String(inviterUser.studentId).trim();
  const targetUserId = String(inviteeUserId || '').trim();

  // 1. Self-invite prevention
  if (inviterId === targetUserId) {
    const err = new Error('You cannot invite yourself to a match.');
    err.code = 'CANNOT_INVITE_SELF';
    err.status = 400;
    throw err;
  }

  // 2. Room code format validation
  if (!isValidRoomCode(roomId)) {
    const err = new Error('Invalid room code format. Room codes must be 6 characters.');
    err.code = 'INVALID_ROOM_CODE';
    err.status = 400;
    throw err;
  }
  const cleanRoomId = roomId.trim().toUpperCase();

  // 3. Recipient existence validation
  const recipient = await db.get(
    `SELECT studentId, name, username, avatarUrl
     FROM students
     WHERE studentId = ? AND COALESCE(role, 'student') NOT IN ('blocked', 'banned', 'suspended')`,
    targetUserId
  );
  if (!recipient) {
    const err = new Error('Recipient user not found or unavailable.');
    err.code = 'RECIPIENT_NOT_FOUND';
    err.status = 404;
    throw err;
  }

  // 4. Rate limiting check (in-memory fast-path + DB authoritative)
  if (!checkRateLimit(inviterId) || !(await checkDbRateLimit(db, inviterId))) {
    const err = new Error('Too many invitation requests. Please wait a moment before sending another.');
    err.code = 'RATE_LIMITED';
    err.status = 429;
    throw err;
  }

  // 5. Authoritative Room State Verification via Games Worker
  const roomState = await fetchAuthoritativeRoomState(cleanRoomId, inviterUser, {
    gamesServiceUrl,
    customTicketSecret,
    fetchFn,
  });

  if (!roomState.exists) {
    const err = new Error(roomState.message || 'Room not found or unavailable.');
    err.code = roomState.error || 'ROOM_NOT_FOUND';
    err.status = 404;
    throw err;
  }

  if (roomState.gameType !== 'ludo') {
    const err = new Error('Only Ludo matches support private invitations currently.');
    err.code = 'INVALID_GAME_TYPE';
    err.status = 400;
    throw err;
  }

  if (roomState.roomStatus !== 'lobby') {
    const err = new Error('This match has already started and is no longer in lobby.');
    err.code = 'ROOM_ALREADY_STARTED';
    err.status = 409;
    throw err;
  }

  // Only the current lobby host may invite
  if (roomState.hostUserId !== inviterId) {
    const err = new Error('Only the lobby host can invite players.');
    err.code = 'NOT_ROOM_HOST';
    err.status = 403;
    throw err;
  }

  // Check if recipient is already in the room (Gate 33)
  if (roomState.seats && Object.values(roomState.seats).some(s => s.userId === targetUserId)) {
    const err = new Error('This user is already in the match room.');
    err.code = 'ALREADY_IN_ROOM';
    err.status = 400;
    throw err;
  }

  // Check if room has open human capacity
  const hasOpenSeat = roomState.seats && Object.values(roomState.seats).some(s => s.status === 'open');
  if (!hasOpenSeat) {
    const err = new Error('This room is full. Free up a seat or increase player count before inviting.');
    err.code = 'ROOM_FULL';
    err.status = 409;
    throw err;
  }

  const roomGeneration =
    Number.isInteger(roomState.roomGeneration) && roomState.roomGeneration >= 1
      ? roomState.roomGeneration
      : 1;

  // 6. Deduplication: check if pending unexpired invitation already exists for (roomId, roomGeneration, inviterId, inviteeId)
  const existing = await db.get(
    `SELECT id, game_type, room_id, room_generation, inviter_user_id, invitee_user_id, status, created_at, expires_at
     FROM game_invitations
     WHERE room_id = ? AND room_generation = ? AND inviter_user_id = ? AND invitee_user_id = ? AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`,
    cleanRoomId,
    roomGeneration,
    inviterId,
    targetUserId
  );

  const now = Date.now();
  if (existing) {
    const expiresAtMs = new Date(existing.expires_at).getTime();
    if (expiresAtMs > now) {
      // Return existing pending invitation without re-spamming push
      return {
        invitation: {
          id: existing.id,
          gameType: existing.game_type,
          roomId: existing.room_id,
          roomGeneration: existing.room_generation || 1,
          inviterUserId: existing.inviter_user_id,
          inviteeUserId: existing.invitee_user_id,
          status: existing.status,
          createdAt: existing.created_at,
          expiresAt: existing.expires_at,
        },
        pushDelivery: 'deduplicated',
        deduplicated: true,
      };
    }
  }

  // 7. Persist fresh invitation with atomic unique constraint protection
  const invitationId = crypto.randomUUID();
  const createdAtIso = new Date(now).toISOString();
  const expiresAtIso = new Date(now + LUDO_INVITATION_TTL_MS).toISOString();

  try {
    await db.run(
      `INSERT INTO game_invitations (id, game_type, room_id, room_generation, inviter_user_id, invitee_user_id, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      invitationId,
      'ludo',
      cleanRoomId,
      roomGeneration,
      inviterId,
      targetUserId,
      createdAtIso,
      expiresAtIso
    );
  } catch (insertErr) {
    const isUniqueViolation =
      insertErr.code === 'SQLITE_CONSTRAINT' ||
      insertErr.code === '23505' ||
      /unique/i.test(insertErr.message || '');

    if (isUniqueViolation) {
      const existingPending = await db.get(
        `SELECT id, game_type, room_id, room_generation, inviter_user_id, invitee_user_id, status, created_at, expires_at
         FROM game_invitations
         WHERE room_id = ? AND room_generation = ? AND inviter_user_id = ? AND invitee_user_id = ? AND status = 'pending'
         ORDER BY created_at DESC LIMIT 1`,
        cleanRoomId,
        roomGeneration,
        inviterId,
        targetUserId
      );
      if (existingPending) {
        return {
          invitation: {
            id: existingPending.id,
            gameType: existingPending.game_type,
            roomId: existingPending.room_id,
            roomGeneration: existingPending.room_generation || 1,
            inviterUserId: existingPending.inviter_user_id,
            inviteeUserId: existingPending.invitee_user_id,
            status: existingPending.status,
            createdAt: existingPending.created_at,
            expiresAt: existingPending.expires_at,
          },
          pushDelivery: 'deduplicated',
          deduplicated: true,
        };
      }
    }
    throw insertErr;
  }

  // 8. Push Notification & In-App Notification Delivery
  const inviterName = inviterUser.name || inviterUser.username || 'A player';
  let pushDeliveryStatus = 'not_configured';

  if (pushNotifications) {
    try {
      const payload = {
        title: 'Ludo invitation',
        body: `${inviterName} invited you to a Ludo match.`,
        data: {
          type: 'ludo_invitation',
          invitationId,
          version: 1,
        },
      };

      const pushRes = await pushNotifications.enqueuePushForRecipients(db, {
        eventType: 'ludo_invitation',
        eventId: invitationId,
        recipientStudentIds: [targetUserId],
        payload,
        idempotencyKeyPrefix: `ludo-invite:${invitationId}`,
      });

      // Synchronously sweep outbox to dispatch immediate push
      if (pushNotifications.dispatchImmediateOutbox) {
        await pushNotifications.dispatchImmediateOutbox(db, {
          eventType: 'ludo_invitation',
          eventId: invitationId,
        }).catch(() => {});
      }

      pushDeliveryStatus = pushRes?.enqueuedCount > 0 ? 'sent' : 'no_devices';
    } catch (pushErr) {
      console.warn('[Game Invitation Push Warning]:', pushErr.message);
      pushDeliveryStatus = 'failed';
    }

    // In-app notification insertion
    try {
      if (pushNotifications.createInAppNotification) {
        await pushNotifications.createInAppNotification(db, {
          recipientStudentId: targetUserId,
          type: 'game_invitation',
          actorId: inviterId,
          message: `${inviterName} invited you to a Ludo match.`,
          deepLink: `/games/ludo/invitations/${invitationId}`,
        });
      }
    } catch (_) {}
  }

  return {
    invitation: {
      id: invitationId,
      gameType: 'ludo',
      roomId: cleanRoomId,
      roomGeneration,
      inviterUserId: inviterId,
      inviteeUserId: targetUserId,
      status: 'pending',
      createdAt: createdAtIso,
      expiresAt: expiresAtIso,
    },
    pushDelivery: pushDeliveryStatus,
    deduplicated: false,
  };
}

/**
 * Retrieves invitation details with safe public inviter profile information.
 */
async function getInvitationById(db, invitationId, currentUserId) {
  if (!invitationId || typeof invitationId !== 'string') return null;

  const row = await db.get(
    `SELECT i.id, i.game_type, i.room_id, i.room_generation, i.inviter_user_id, i.invitee_user_id,
            i.status, i.created_at, i.expires_at, i.accepted_at, i.declined_at, i.cancelled_at,
            s.name AS inviter_name, s.username AS inviter_username, s.avatarUrl AS inviter_avatar_url
     FROM game_invitations i
     JOIN students s ON i.inviter_user_id = s.studentId
     WHERE i.id = ?`,
    invitationId.trim()
  );

  if (!row) return null;

  // Authorization check: only invitee or inviter can view details
  const currentId = String(currentUserId || '').trim();
  if (currentId !== row.invitee_user_id && currentId !== row.inviter_user_id) {
    const err = new Error('You do not have permission to view this invitation.');
    err.code = 'FORBIDDEN';
    err.status = 403;
    throw err;
  }

  // Auto-expire check
  let status = row.status;
  const now = Date.now();
  if (status === 'pending') {
    const expTime = new Date(row.expires_at).getTime();
    if (expTime <= now) {
      status = 'expired';
      await db.run(
        `UPDATE game_invitations SET status = 'expired' WHERE id = ? AND status = 'pending'`,
        row.id
      ).catch(() => {});
    }
  }

  return {
    id: row.id,
    gameType: row.game_type,
    roomId: row.room_id,
    roomGeneration: row.room_generation || 1,
    status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    declinedAt: row.declined_at,
    cancelledAt: row.cancelled_at,
    inviter: {
      userId: row.inviter_user_id,
      name: row.inviter_name || 'Player',
      displayName: row.inviter_name || 'Player',
      username: row.inviter_username || null,
      avatarUrl: row.inviter_avatar_url || null,
    },
    invitee: {
      userId: row.invitee_user_id,
    },
    isInvitee: currentId === row.invitee_user_id,
  };
}

/**
 * Accepts an invitation after authoritatively re-verifying room status.
 */
async function acceptInvitation(db, invitationId, currentUser, options = {}) {
  if (!currentUser || !currentUser.studentId) {
    throw new Error('Authenticated user required.');
  }
  const userId = String(currentUser.studentId).trim();

  const invitation = await db.get(
    `SELECT * FROM game_invitations WHERE id = ?`,
    String(invitationId || '').trim()
  );

  if (!invitation) {
    const err = new Error('Invitation not found.');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }

  if (invitation.invitee_user_id !== userId) {
    const err = new Error('This invitation was sent to a different account.');
    err.code = 'WRONG_ACCOUNT';
    err.status = 403;
    throw err;
  }

  if (invitation.status === 'accepted') {
    return {
      success: true,
      roomId: invitation.room_id,
      invitationId: invitation.id,
      status: 'accepted',
      idempotent: true,
    };
  }

  if (invitation.status !== 'pending') {
    const err = new Error(`This invitation is already ${invitation.status}.`);
    err.code = `ALREADY_${invitation.status.toUpperCase()}`;
    err.status = 400;
    throw err;
  }

  const now = Date.now();
  if (new Date(invitation.expires_at).getTime() <= now) {
    await db.run(`UPDATE game_invitations SET status = 'expired' WHERE id = ? AND status = 'pending'`, invitation.id).catch(() => {});
    const err = new Error('This invitation has expired.');
    err.code = 'EXPIRED';
    err.status = 410;
    throw err;
  }

  // Revalidate authoritative room state with Games Worker using server/host authorization
  const roomState = await fetchAuthoritativeRoomState(
    invitation.room_id,
    { studentId: invitation.inviter_user_id },
    { ...options, role: 'server' }
  );

  if (!roomState.exists) {
    await db.run(`UPDATE game_invitations SET status = 'cancelled' WHERE id = ? AND status = 'pending'`, invitation.id).catch(() => {});
    const err = new Error('The room for this invitation is no longer available.');
    err.code = 'ROOM_UNAVAILABLE';
    err.status = 410;
    throw err;
  }

  if (roomState.roomStatus !== 'lobby') {
    await db.run(`UPDATE game_invitations SET status = 'cancelled' WHERE id = ? AND status = 'pending'`, invitation.id).catch(() => {});
    const err = new Error('This match has already started.');
    err.code = 'ROOM_STARTED';
    err.status = 409;
    throw err;
  }

  // Verify room generation binding matches current lobby generation (Phase 4D)
  const currentGen = Number.isInteger(roomState.roomGeneration) && roomState.roomGeneration >= 1 ? roomState.roomGeneration : 1;
  const inviteGen = Number.isInteger(invitation.room_generation) && invitation.room_generation >= 1 ? invitation.room_generation : 1;
  if (currentGen !== inviteGen) {
    await db.run(`UPDATE game_invitations SET status = 'cancelled' WHERE id = ? AND status = 'pending'`, invitation.id).catch(() => {});
    const err = new Error('This invitation belongs to an earlier match.');
    err.code = 'INVITATION_STALE';
    err.status = 409;
    throw err;
  }

  // Check capacity
  const hasOpenSeat = roomState.seats && Object.values(roomState.seats).some(s => s.status === 'open');
  if (!hasOpenSeat) {
    const err = new Error('This room is currently full.');
    err.code = 'ROOM_FULL';
    err.status = 409;
    throw err;
  }

  const acceptedAtIso = new Date(now).toISOString();
  const updateRes = await db.run(
    `UPDATE game_invitations SET status = 'accepted', accepted_at = ? WHERE id = ? AND status = 'pending'`,
    acceptedAtIso,
    invitation.id
  );

  if (updateRes && (updateRes.changes === 0 || updateRes.rowCount === 0)) {
    const rechecked = await db.get(`SELECT * FROM game_invitations WHERE id = ?`, invitation.id);
    if (rechecked && rechecked.status === 'accepted') {
      return {
        success: true,
        roomId: rechecked.room_id,
        invitationId: rechecked.id,
        status: 'accepted',
        idempotent: true,
      };
    }
    const currentStatus = rechecked?.status || 'processed';
    const err = new Error(`This invitation is already ${currentStatus}.`);
    err.code = `ALREADY_${currentStatus.toUpperCase()}`;
    err.status = 400;
    throw err;
  }

  return {
    success: true,
    roomId: invitation.room_id,
    invitationId: invitation.id,
    status: 'accepted',
    idempotent: false,
  };
}

/**
 * Declines an invitation.
 */
async function declineInvitation(db, invitationId, currentUser) {
  if (!currentUser || !currentUser.studentId) {
    throw new Error('Authenticated user required.');
  }
  const userId = String(currentUser.studentId).trim();

  const invitation = await db.get(
    `SELECT * FROM game_invitations WHERE id = ?`,
    String(invitationId || '').trim()
  );

  if (!invitation) {
    const err = new Error('Invitation not found.');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }

  if (invitation.invitee_user_id !== userId) {
    const err = new Error('This invitation was sent to a different account.');
    err.code = 'WRONG_ACCOUNT';
    err.status = 403;
    throw err;
  }

  if (invitation.status === 'declined') {
    return { success: true, status: 'declined', idempotent: true };
  }

  if (invitation.status !== 'pending') {
    const err = new Error(`This invitation is already ${invitation.status}.`);
    err.code = `ALREADY_${invitation.status.toUpperCase()}`;
    err.status = 400;
    throw err;
  }

  const declinedAtIso = new Date().toISOString();
  const updateRes = await db.run(
    `UPDATE game_invitations SET status = 'declined', declined_at = ? WHERE id = ? AND status = 'pending'`,
    declinedAtIso,
    invitation.id
  );

  if (updateRes && (updateRes.changes === 0 || updateRes.rowCount === 0)) {
    const rechecked = await db.get(`SELECT * FROM game_invitations WHERE id = ?`, invitation.id);
    if (rechecked && rechecked.status === 'declined') {
      return { success: true, status: 'declined', idempotent: true };
    }
    const currentStatus = rechecked?.status || 'processed';
    const err = new Error(`This invitation is already ${currentStatus}.`);
    err.code = `ALREADY_${currentStatus.toUpperCase()}`;
    err.status = 400;
    throw err;
  }

  return { success: true, status: 'declined', idempotent: false };
}

module.exports = {
  LUDO_INVITATION_TTL_MS,
  MAX_INVITATIONS_PER_MINUTE,
  isValidRoomCode,
  isValidInvitationId,
  ensureGamesInvitationsSchema,
  searchUsers,
  fetchAuthoritativeRoomState,
  createInvitation,
  getInvitationById,
  acceptInvitation,
  declineInvitation,
  checkRateLimit,
  checkDbRateLimit,
  clearRateLimits,
};
