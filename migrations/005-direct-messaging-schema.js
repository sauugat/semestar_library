'use strict';

const ID = '005-direct-messaging-schema';

/**
 * Migration 005: Direct Messaging Schema Foundation
 * Supports PostgreSQL (Neon) and SQLite (disposable test fixtures).
 */
async function migrateDirectMessaging(db, { disposable = false } = {}) {
  if (process.env.NODE_ENV !== 'test' && !disposable && process.env.DM_MIGRATION_ALLOWED !== '1') {
    throw new Error('Direct messaging migration requires explicit authorization or test environment');
  }

  return db.withTransaction(async tx => {
    if (tx.isPostgres) {
      await tx.get('SELECT pg_advisory_xact_lock(741005)');
    }

    await tx.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    const alreadyApplied = await tx.get('SELECT id FROM schema_migrations WHERE id = ?', ID);
    if (alreadyApplied) {
      return { applied: false };
    }

    if (tx.isPostgres) {
      // Neon PostgreSQL Migration
      await tx.exec(`
        -- 1. CONVERSATIONS
        CREATE TABLE IF NOT EXISTS dm_conversations (
          id TEXT PRIMARY KEY,
          user_one_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          user_two_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          realtime_epoch INTEGER NOT NULL DEFAULT 1 CHECK (realtime_epoch > 0),
          last_message_id INTEGER,
          last_message_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT dm_canonical_pair_check CHECK (user_one_id < user_two_id)
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_conversations_unique_pair
          ON dm_conversations (user_one_id, user_two_id);

        CREATE INDEX IF NOT EXISTS idx_dm_conversations_user_one_list
          ON dm_conversations (user_one_id, last_message_at DESC NULLS LAST);

        CREATE INDEX IF NOT EXISTS idx_dm_conversations_user_two_list
          ON dm_conversations (user_two_id, last_message_at DESC NULLS LAST);

        -- 2. PARTICIPANTS
        CREATE TABLE IF NOT EXISTS dm_participants (
          conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
          student_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          slot INTEGER NOT NULL CHECK (slot IN (1, 2)),
          last_read_message_id INTEGER NOT NULL DEFAULT 0 CHECK (last_read_message_id >= 0),
          cleared_before_message_id INTEGER NOT NULL DEFAULT 0 CHECK (cleared_before_message_id >= 0),
          is_muted BOOLEAN NOT NULL DEFAULT false,
          is_archived BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (conversation_id, student_id),
          CONSTRAINT dm_participants_slot_unique UNIQUE (conversation_id, slot)
        );

        CREATE INDEX IF NOT EXISTS idx_dm_participants_lookup
          ON dm_participants (student_id, is_archived, updated_at DESC);

        CREATE OR REPLACE FUNCTION trg_fn_check_dm_participant_membership()
        RETURNS TRIGGER AS $$
        DECLARE
          conv RECORD;
        BEGIN
          SELECT user_one_id, user_two_id INTO conv
          FROM dm_conversations WHERE id = NEW.conversation_id;

          IF conv IS NULL THEN
            RAISE EXCEPTION 'Conversation not found: %', NEW.conversation_id;
          END IF;

          IF NEW.slot = 1 AND NEW.student_id <> conv.user_one_id THEN
            RAISE EXCEPTION 'Participant integrity violation: Slot 1 must belong to user_one_id (%)', conv.user_one_id;
          END IF;

          IF NEW.slot = 2 AND NEW.student_id <> conv.user_two_id THEN
            RAISE EXCEPTION 'Participant integrity violation: Slot 2 must belong to user_two_id (%)', conv.user_two_id;
          END IF;

          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_dm_participant_membership ON dm_participants;
        CREATE TRIGGER trg_dm_participant_membership
        BEFORE INSERT OR UPDATE ON dm_participants
        FOR EACH ROW EXECUTE FUNCTION trg_fn_check_dm_participant_membership();

        -- 3. MESSAGES
        CREATE TABLE IF NOT EXISTS dm_messages (
          id SERIAL PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
          sender_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          client_id TEXT NOT NULL,
          text TEXT,
          reply_to_id INTEGER REFERENCES dm_messages(id) ON DELETE SET NULL,
          is_edited BOOLEAN NOT NULL DEFAULT false,
          edited_at TIMESTAMPTZ,
          deleted_for_all BOOLEAN NOT NULL DEFAULT false,
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT dm_message_text_required CHECK (
            deleted_for_all = true OR (text IS NOT NULL AND LENGTH(TRIM(text)) > 0 AND LENGTH(text) <= 2000)
          ),
          CONSTRAINT dm_messages_sender_in_conv_fk FOREIGN KEY (conversation_id, sender_id)
            REFERENCES dm_participants(conversation_id, student_id) ON DELETE RESTRICT
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_messages_idempotent_send
          ON dm_messages (conversation_id, sender_id, client_id);

        CREATE INDEX IF NOT EXISTS idx_dm_messages_history_cursor
          ON dm_messages (conversation_id, id DESC);

        CREATE INDEX IF NOT EXISTS idx_dm_messages_reply_lookup
          ON dm_messages (reply_to_id) WHERE reply_to_id IS NOT NULL;

        CREATE OR REPLACE FUNCTION trg_fn_check_dm_message_reply()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.reply_to_id IS NOT NULL THEN
            IF NOT EXISTS (
              SELECT 1 FROM dm_messages
              WHERE id = NEW.reply_to_id AND conversation_id = NEW.conversation_id
            ) THEN
              RAISE EXCEPTION 'Cross-conversation reply rejected: message % is not in conversation %',
                NEW.reply_to_id, NEW.conversation_id;
            END IF;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_dm_message_reply ON dm_messages;
        CREATE TRIGGER trg_dm_message_reply
        BEFORE INSERT OR UPDATE ON dm_messages
        FOR EACH ROW EXECUTE FUNCTION trg_fn_check_dm_message_reply();

        -- 4. MESSAGE INDIVIDUAL DELETIONS
        CREATE TABLE IF NOT EXISTS dm_message_deletions (
          message_id INTEGER NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
          student_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          deleted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (message_id, student_id)
        );

        CREATE INDEX IF NOT EXISTS idx_dm_msg_deletions_student
          ON dm_message_deletions (student_id, message_id);

        -- 5. BLOCKS
        CREATE TABLE IF NOT EXISTS dm_blocks (
          blocker_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          blocked_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (blocker_id, blocked_id),
          CONSTRAINT dm_block_not_self CHECK (blocker_id <> blocked_id)
        );

        CREATE INDEX IF NOT EXISTS idx_dm_blocks_target
          ON dm_blocks (blocked_id, blocker_id);

        -- 6. REPORTS
        CREATE TABLE IF NOT EXISTS dm_reports (
          id TEXT PRIMARY KEY,
          reporter_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          reported_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
          reported_message_id INTEGER REFERENCES dm_messages(id) ON DELETE SET NULL,
          reason TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'inappropriate_content', 'impersonation', 'other')),
          description TEXT,
          message_snapshot_text TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed', 'action_taken')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          reviewed_at TIMESTAMPTZ,
          reviewed_by TEXT REFERENCES students(studentId) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_dm_reports_review_queue
          ON dm_reports (status, created_at DESC);

        CREATE OR REPLACE FUNCTION trg_fn_check_dm_report_message()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.reported_message_id IS NOT NULL THEN
            IF NOT EXISTS (
              SELECT 1 FROM dm_messages
              WHERE id = NEW.reported_message_id AND conversation_id = NEW.conversation_id
            ) THEN
              RAISE EXCEPTION 'Report message cross-conversation violation: message % does not belong to conversation %',
                NEW.reported_message_id, NEW.conversation_id;
            END IF;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_dm_report_message ON dm_reports;
        CREATE TRIGGER trg_dm_report_message
        BEFORE INSERT OR UPDATE ON dm_reports
        FOR EACH ROW EXECUTE FUNCTION trg_fn_check_dm_report_message();

        -- 7. SHARED RATE LIMITING
        CREATE TABLE IF NOT EXISTS dm_rate_limits (
          rate_key TEXT PRIMARY KEY,
          request_count INTEGER NOT NULL DEFAULT 1,
          window_start TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_dm_rate_limits_window
          ON dm_rate_limits (window_start);

        -- 8. REALTIME OUTBOX
        CREATE TABLE IF NOT EXISTS dm_realtime_outbox (
          id TEXT PRIMARY KEY,
          event_id TEXT UNIQUE NOT NULL,
          conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
          realtime_epoch INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          payload_json JSONB NOT NULL,
          parent_message_id INTEGER,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'retry', 'sent', 'cancelled')),
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          sent_at TIMESTAMPTZ,
          expires_at TIMESTAMPTZ
        );

        CREATE INDEX IF NOT EXISTS idx_dm_realtime_outbox_drain
          ON dm_realtime_outbox (status, next_attempt_at);
      `);
    } else {
      // SQLite Migration (Used in isolated test runners)
      await tx.exec(`
        -- 1. CONVERSATIONS
        CREATE TABLE IF NOT EXISTS dm_conversations (
          id TEXT PRIMARY KEY,
          user_one_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          user_two_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          realtime_epoch INTEGER NOT NULL DEFAULT 1 CHECK (realtime_epoch > 0),
          last_message_id INTEGER,
          last_message_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          CHECK (user_one_id < user_two_id)
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_conversations_unique_pair
          ON dm_conversations (user_one_id, user_two_id);

        CREATE INDEX IF NOT EXISTS idx_dm_conversations_user_one_list
          ON dm_conversations (user_one_id, last_message_at DESC);

        CREATE INDEX IF NOT EXISTS idx_dm_conversations_user_two_list
          ON dm_conversations (user_two_id, last_message_at DESC);

        -- 2. PARTICIPANTS
        CREATE TABLE IF NOT EXISTS dm_participants (
          conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
          student_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          slot INTEGER NOT NULL CHECK (slot IN (1, 2)),
          last_read_message_id INTEGER NOT NULL DEFAULT 0 CHECK (last_read_message_id >= 0),
          cleared_before_message_id INTEGER NOT NULL DEFAULT 0 CHECK (cleared_before_message_id >= 0),
          is_muted INTEGER NOT NULL DEFAULT 0,
          is_archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (conversation_id, student_id),
          UNIQUE (conversation_id, slot)
        );

        CREATE INDEX IF NOT EXISTS idx_dm_participants_lookup
          ON dm_participants (student_id, is_archived, updated_at DESC);

        CREATE TRIGGER IF NOT EXISTS trg_dm_participant_membership_insert
        BEFORE INSERT ON dm_participants
        BEGIN
          SELECT CASE
            WHEN (NEW.slot = 1 AND NEW.student_id <> (SELECT user_one_id FROM dm_conversations WHERE id = NEW.conversation_id))
              OR (NEW.slot = 2 AND NEW.student_id <> (SELECT user_two_id FROM dm_conversations WHERE id = NEW.conversation_id))
              OR (SELECT COUNT(*) FROM dm_conversations WHERE id = NEW.conversation_id) = 0
            THEN RAISE(ABORT, 'Participant integrity violation: student must match conversation user for designated slot')
          END;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_dm_participant_membership_update
        BEFORE UPDATE ON dm_participants
        BEGIN
          SELECT CASE
            WHEN (NEW.slot = 1 AND NEW.student_id <> (SELECT user_one_id FROM dm_conversations WHERE id = NEW.conversation_id))
              OR (NEW.slot = 2 AND NEW.student_id <> (SELECT user_two_id FROM dm_conversations WHERE id = NEW.conversation_id))
            THEN RAISE(ABORT, 'Participant integrity violation: student must match conversation user for designated slot')
          END;
        END;

        -- 3. MESSAGES
        CREATE TABLE IF NOT EXISTS dm_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
          sender_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          client_id TEXT NOT NULL,
          text TEXT,
          reply_to_id INTEGER REFERENCES dm_messages(id) ON DELETE SET NULL,
          is_edited INTEGER NOT NULL DEFAULT 0,
          edited_at TEXT,
          deleted_for_all INTEGER NOT NULL DEFAULT 0,
          deleted_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          CHECK (deleted_for_all = 1 OR (text IS NOT NULL AND LENGTH(TRIM(text)) > 0 AND LENGTH(text) <= 2000)),
          FOREIGN KEY (conversation_id, sender_id) REFERENCES dm_participants(conversation_id, student_id) ON DELETE RESTRICT
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_messages_idempotent_send
          ON dm_messages (conversation_id, sender_id, client_id);

        CREATE INDEX IF NOT EXISTS idx_dm_messages_history_cursor
          ON dm_messages (conversation_id, id DESC);

        CREATE INDEX IF NOT EXISTS idx_dm_messages_reply_lookup
          ON dm_messages (reply_to_id);

        CREATE TRIGGER IF NOT EXISTS trg_dm_message_reply_insert
        BEFORE INSERT ON dm_messages
        WHEN NEW.reply_to_id IS NOT NULL
        BEGIN
          SELECT CASE
            WHEN (SELECT COUNT(*) FROM dm_messages WHERE id = NEW.reply_to_id AND conversation_id = NEW.conversation_id) = 0
            THEN RAISE(ABORT, 'Cross-conversation reply rejected: reply_to_id must belong to same conversation')
          END;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_dm_message_reply_update
        BEFORE UPDATE ON dm_messages
        WHEN NEW.reply_to_id IS NOT NULL
        BEGIN
          SELECT CASE
            WHEN (SELECT COUNT(*) FROM dm_messages WHERE id = NEW.reply_to_id AND conversation_id = NEW.conversation_id) = 0
            THEN RAISE(ABORT, 'Cross-conversation reply rejected: reply_to_id must belong to same conversation')
          END;
        END;

        -- 4. MESSAGE INDIVIDUAL DELETIONS
        CREATE TABLE IF NOT EXISTS dm_message_deletions (
          message_id INTEGER NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
          student_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (message_id, student_id)
        );

        CREATE INDEX IF NOT EXISTS idx_dm_msg_deletions_student
          ON dm_message_deletions (student_id, message_id);

        -- 5. BLOCKS
        CREATE TABLE IF NOT EXISTS dm_blocks (
          blocker_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          blocked_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (blocker_id, blocked_id),
          CHECK (blocker_id <> blocked_id)
        );

        CREATE INDEX IF NOT EXISTS idx_dm_blocks_target
          ON dm_blocks (blocked_id, blocker_id);

        -- 6. REPORTS
        CREATE TABLE IF NOT EXISTS dm_reports (
          id TEXT PRIMARY KEY,
          reporter_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          reported_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
          conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
          reported_message_id INTEGER REFERENCES dm_messages(id) ON DELETE SET NULL,
          reason TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'inappropriate_content', 'impersonation', 'other')),
          description TEXT,
          message_snapshot_text TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed', 'action_taken')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          reviewed_at TEXT,
          reviewed_by TEXT REFERENCES students(studentId) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_dm_reports_review_queue
          ON dm_reports (status, created_at DESC);

        CREATE TRIGGER IF NOT EXISTS trg_dm_report_message_insert
        BEFORE INSERT ON dm_reports
        WHEN NEW.reported_message_id IS NOT NULL
        BEGIN
          SELECT CASE
            WHEN (SELECT COUNT(*) FROM dm_messages WHERE id = NEW.reported_message_id AND conversation_id = NEW.conversation_id) = 0
            THEN RAISE(ABORT, 'Report message cross-conversation violation: message does not belong to conversation')
          END;
        END;

        -- 7. SHARED RATE LIMITING
        CREATE TABLE IF NOT EXISTS dm_rate_limits (
          rate_key TEXT PRIMARY KEY,
          request_count INTEGER NOT NULL DEFAULT 1,
          window_start TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_dm_rate_limits_window
          ON dm_rate_limits (window_start);

        -- 8. REALTIME OUTBOX
        CREATE TABLE IF NOT EXISTS dm_realtime_outbox (
          id TEXT PRIMARY KEY,
          event_id TEXT UNIQUE NOT NULL,
          conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
          realtime_epoch INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          parent_message_id INTEGER,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'retry', 'sent', 'cancelled')),
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          sent_at TEXT,
          expires_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_dm_realtime_outbox_drain
          ON dm_realtime_outbox (status, next_attempt_at);
      `);
    }

    await tx.run('INSERT INTO schema_migrations (id) VALUES (?)', ID);
    return { applied: true };
  });
}

module.exports = {
  migrateDirectMessaging,
  MIGRATION_ID: ID,
};
