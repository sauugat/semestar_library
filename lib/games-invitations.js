const crypto = require('crypto');
const { enqueuePushForRecipients, dispatchImmediateOutbox } = require('./push-notifications');

const INVITATION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DUPLICATE_WINDOW_MS = 30 * 1000;    // 30 seconds
const RATE_LIMIT_WINDOW_MS = 60 * 1000;   // 60 seconds
const MAX_INVITES_PER_WINDOW = 3;         // max 3 per 60 seconds

const SUPPORTED_GAME_TYPES = new Set(['tic-tac-toe']);
const ROOM_ID_REGEX = /^[A-Z0-9]{4,16}$/;

/**
 * Generate a cryptographically unpredictable invitation ID.
 */
function generateInvitationId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Ensures schema tables and indexes exist for Game Invitations.
 */
async function ensureGameInvitationsSchema({ exec, isPostgres }) {
  if (isPostgres) {
    await exec(`
      CREATE TABLE IF NOT EXISTS game_invitations (
        id TEXT PRIMARY KEY,
        sender_student_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
        recipient_student_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
        game_type TEXT NOT NULL,
        room_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMPTZ NOT NULL,
        accepted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_game_invitations_recipient ON game_invitations(recipient_student_id, expires_at);
      CREATE INDEX IF NOT EXISTS idx_game_invitations_sender_rate ON game_invitations(sender_student_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_game_invitations_duplicate ON game_invitations(sender_student_id, recipient_student_id, room_id, game_type, created_at);
    `);
  } else {
    await exec(`
      CREATE TABLE IF NOT EXISTS game_invitations (
        id TEXT PRIMARY KEY,
        sender_student_id TEXT NOT NULL,
        recipient_student_id TEXT NOT NULL,
        game_type TEXT NOT NULL,
        room_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        accepted_at DATETIME,
        FOREIGN KEY (sender_student_id) REFERENCES students(studentId) ON DELETE CASCADE,
        FOREIGN KEY (recipient_student_id) REFERENCES students(studentId) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_game_invitations_recipient ON game_invitations(recipient_student_id, expires_at);
      CREATE INDEX IF NOT EXISTS idx_game_invitations_sender_rate ON game_invitations(sender_student_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_game_invitations_duplicate ON game_invitations(sender_student_id, recipient_student_id, room_id, game_type, created_at);
    `);
  }
}

/**
 * Formats a game title for notifications.
 */
function formatGameTitle(gameType) {
  if (gameType === 'tic-tac-toe') return 'Tic Tac Toe';
  return 'Multiplayer Game';
}

/**
 * Creates a persistent game invitation, enforces rate limits and duplicate suppression,
 * and enqueues/dispatches targeted push notification to recipient.
 */
async function createInvitation(db, {
  senderStudentId,
  senderName,
  recipientStudentId,
  gameType,
  roomId,
}) {
  const cleanSenderId = senderStudentId ? String(senderStudentId).trim() : '';
  if (!cleanSenderId) {
    return { error: 'Authentication required.', status: 401 };
  }

  const cleanRecipientId = recipientStudentId ? String(recipientStudentId).trim() : '';
  if (!cleanRecipientId) {
    return { error: 'Recipient student ID is required.', status: 400 };
  }

  if (cleanSenderId === cleanRecipientId) {
    return { error: 'You cannot invite yourself to a game.', status: 400 };
  }

  const cleanGameType = typeof gameType === 'string' ? gameType.trim().toLowerCase() : '';
  if (!SUPPORTED_GAME_TYPES.has(cleanGameType)) {
    return { error: 'Unsupported game type.', status: 400 };
  }

  const cleanRoomId = typeof roomId === 'string' ? roomId.trim().toUpperCase() : '';
  if (!ROOM_ID_REGEX.test(cleanRoomId)) {
    return { error: 'Invalid room format.', status: 400 };
  }

  // Verify recipient exists
  const recipient = await db.get(
    'SELECT studentId, name FROM students WHERE studentId = ?',
    cleanRecipientId
  );
  if (!recipient) {
    return { error: 'Recipient student not found.', status: 404 };
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // 1. Rapid duplicate suppression (~30 seconds to same recipient & room)
  const duplicateWindowIso = new Date(now - DUPLICATE_WINDOW_MS).toISOString();
  const existingInvite = await db.get(
    `SELECT id, game_type, room_id, recipient_student_id, created_at, expires_at
     FROM game_invitations
     WHERE sender_student_id = ?
       AND recipient_student_id = ?
       AND room_id = ?
       AND game_type = ?
       AND created_at >= ?
       AND expires_at > ?
     ORDER BY created_at DESC
     LIMIT 1`,
    cleanSenderId,
    cleanRecipientId,
    cleanRoomId,
    cleanGameType,
    duplicateWindowIso,
    nowIso
  );

  if (existingInvite) {
    return {
      invitation: {
        id: existingInvite.id,
        gameType: existingInvite.game_type,
        roomId: existingInvite.room_id,
        recipientStudentId: existingInvite.recipient_student_id,
        expiresAt: existingInvite.expires_at,
      },
      isDuplicate: true,
    };
  }

  // 2. Abuse protection: max 3 invites per sender per 60 seconds
  const rateLimitWindowIso = new Date(now - RATE_LIMIT_WINDOW_MS).toISOString();
  const recentCountRow = await db.get(
    `SELECT COUNT(*) AS count
     FROM game_invitations
     WHERE sender_student_id = ?
       AND created_at >= ?`,
    cleanSenderId,
    rateLimitWindowIso
  );
  const recentCount = Number(recentCountRow?.count || 0);
  if (recentCount >= MAX_INVITES_PER_WINDOW) {
    return {
      error: "You're sending invitations too quickly. Try again shortly.",
      status: 429,
    };
  }

  // 3. Persist invitation with 10-minute server-authoritative expiry
  const invitationId = generateInvitationId();
  const expiresAt = new Date(now + INVITATION_TTL_MS).toISOString();

  await db.run(
    `INSERT INTO game_invitations
       (id, sender_student_id, recipient_student_id, game_type, room_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    invitationId,
    cleanSenderId,
    cleanRecipientId,
    cleanGameType,
    cleanRoomId,
    nowIso,
    expiresAt
  );

  // 4. Targeted Push Notification via existing outbox
  const gameTitle = formatGameTitle(cleanGameType);
  const resolvedSenderName = (senderName || '').trim() || 'A classmate';

  try {
    await enqueuePushForRecipients(db, {
      eventType: 'game_invite',
      eventId: invitationId,
      recipientStudentIds: [cleanRecipientId],
      payload: {
        title: `${gameTitle} Invite`,
        body: `${resolvedSenderName} invited you to play ${gameTitle}`,
        data: {
          type: 'game_invite',
          gameType: cleanGameType,
          invitationId,
          roomId: cleanRoomId,
          expiresAt,
        },
        priority: 'high',
        channelId: 'social',
      },
      idempotencyKeyPrefix: 'game_invite',
    });

    await dispatchImmediateOutbox(db, {
      eventType: 'game_invite',
      eventId: invitationId,
      timeoutMs: 3500,
    });
  } catch (pushErr) {
    console.warn('[Game Invite Push Warning]:', pushErr.message);
  }

  return {
    invitation: {
      id: invitationId,
      gameType: cleanGameType,
      roomId: cleanRoomId,
      recipientStudentId: cleanRecipientId,
      expiresAt,
    },
    isDuplicate: false,
  };
}

/**
 * Retrieves and validates a game invitation for the intended recipient.
 * Strictly verifies recipient identity and expiration.
 */
async function getInvitation(db, { invitationId, studentId }) {
  const cleanInviteId = invitationId ? String(invitationId).trim() : '';
  const cleanStudentId = studentId ? String(studentId).trim() : '';

  if (!cleanInviteId) {
    return { error: 'Invitation ID is required.', status: 400 };
  }
  if (!cleanStudentId) {
    return { error: 'Authentication required.', status: 401 };
  }

  const row = await db.get(
    'SELECT * FROM game_invitations WHERE id = ?',
    cleanInviteId
  );

  if (!row) {
    return { error: 'Invitation not found.', status: 404 };
  }

  // Recipient authorization check: wrong recipient receives 404 to avoid leaking invitation existence
  if (row.recipient_student_id !== cleanStudentId) {
    return { error: 'Invitation not found.', status: 404 };
  }

  // Expiration check
  const expiresAtMs = new Date(row.expires_at).getTime();
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now()) {
    return {
      error: 'This game invitation is no longer active.',
      status: 410,
      expired: true,
    };
  }

  // Fetch safe public inviter details
  const sender = await db.get(
    'SELECT name FROM students WHERE studentId = ?',
    row.sender_student_id
  );
  const inviterName = sender?.name ? sender.name.trim() : 'A classmate';

  return {
    invitation: {
      id: row.id,
      gameType: row.game_type,
      roomId: row.room_id,
      inviter: {
        name: inviterName,
      },
      expiresAt: row.expires_at,
    },
  };
}

module.exports = {
  INVITATION_TTL_MS,
  DUPLICATE_WINDOW_MS,
  RATE_LIMIT_WINDOW_MS,
  MAX_INVITES_PER_WINDOW,
  SUPPORTED_GAME_TYPES,
  ROOM_ID_REGEX,
  generateInvitationId,
  ensureGameInvitationsSchema,
  createInvitation,
  getInvitation,
};
