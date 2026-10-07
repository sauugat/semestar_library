'use strict';

// Shared Phase 2C support schema. Production uses the same tables and constraints.
const schema = `
      CREATE TABLE chat_send_keys (
        chat_group_id TEXT NOT NULL REFERENCES chat_groups(id), sender_student_id TEXT NOT NULL REFERENCES students(studentId),
        client_id TEXT NOT NULL, original_message_id INTEGER NOT NULL,
        PRIMARY KEY(chat_group_id,sender_student_id,client_id)
      );
      CREATE TABLE chat_attachment_ownership (
        chat_group_id TEXT NOT NULL REFERENCES chat_groups(id), filename TEXT NOT NULL,
        PRIMARY KEY(chat_group_id,filename)
      );
      CREATE TABLE chat_room_read_receipts (
        chat_group_id TEXT NOT NULL REFERENCES chat_groups(id), student_id TEXT NOT NULL REFERENCES students(studentId),
        last_read_message_id INTEGER NOT NULL REFERENCES chat_messages(id), PRIMARY KEY(chat_group_id,student_id)
      );
      CREATE TABLE chat_room_typing (
        chat_group_id TEXT NOT NULL REFERENCES chat_groups(id), student_id TEXT NOT NULL REFERENCES students(studentId),
        last_typed_at TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY(chat_group_id,student_id)
      );
      CREATE TABLE chat_pinned_announcements (
        chat_group_id TEXT PRIMARY KEY REFERENCES chat_groups(id), message_id INTEGER NOT NULL REFERENCES chat_messages(id),
        pinned_by TEXT NOT NULL REFERENCES students(studentId), pinned_at TEXT NOT NULL
      );
      CREATE TABLE chat_room_revocations (
        chat_group_id TEXT NOT NULL REFERENCES chat_groups(id), student_id TEXT NOT NULL REFERENCES students(studentId),
        PRIMARY KEY(chat_group_id,student_id)
      );
      CREATE TABLE chat_online_sessions (
        chat_group_id TEXT NOT NULL REFERENCES chat_groups(id), student_id TEXT NOT NULL REFERENCES students(studentId),
        session_id TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        PRIMARY KEY(chat_group_id,student_id,session_id)
      );
      CREATE INDEX chat_online_expiry ON chat_online_sessions(chat_group_id,expires_at);
      CREATE TABLE chat_realtime_memberships (
        chat_group_id TEXT NOT NULL REFERENCES chat_groups(id), student_id TEXT NOT NULL REFERENCES students(studentId),
        subject TEXT NOT NULL, realtime_epoch INTEGER NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)),
        PRIMARY KEY(chat_group_id,student_id), UNIQUE(chat_group_id,subject)
      );
      CREATE TABLE chat_realtime_outbox (
        id TEXT PRIMARY KEY, event_id TEXT UNIQUE NOT NULL, chat_group_id TEXT NOT NULL REFERENCES chat_groups(id),
        realtime_epoch INTEGER NOT NULL, event_type TEXT NOT NULL, payload_json TEXT NOT NULL, parent_message_id INTEGER,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','retry','sent','cancelled')),
        attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, created_at TEXT NOT NULL,
        sent_at TEXT, expires_at TEXT
      );
      CREATE INDEX chat_realtime_pending ON chat_realtime_outbox(status,next_attempt_at);
      ALTER TABLE push_notification_outbox ADD COLUMN chat_group_id TEXT REFERENCES chat_groups(id);
      ALTER TABLE push_notification_outbox ADD COLUMN realtime_epoch INTEGER;
      CREATE INDEX push_chat_room ON push_notification_outbox(chat_group_id);
      CREATE TABLE chat_recycle_jobs (
        id TEXT PRIMARY KEY, chat_group_id TEXT UNIQUE NOT NULL REFERENCES chat_groups(id), request_key TEXT UNIQUE NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('erasure_pending','complete')), intake_year INTEGER NOT NULL,
        roster_json TEXT NOT NULL, new_chat_group_id TEXT REFERENCES chat_groups(id), created_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE TABLE chat_erasure_files (
        job_id TEXT NOT NULL REFERENCES chat_recycle_jobs(id), filename TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','deleted','shared')), PRIMARY KEY(job_id,filename)
      );
      CREATE TABLE chat_lifecycle_audit (
        id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, operation TEXT NOT NULL, chat_group_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `;

function cohortChatSupportSchema({ idempotent = false } = {}) {
  if (!idempotent) return schema;
  // Idempotent column additions are PostgreSQL-only.
  return schema.replace(/CREATE TABLE /g, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/CREATE INDEX /g, 'CREATE INDEX IF NOT EXISTS ')
    .replace(/ADD COLUMN /g, 'ADD COLUMN IF NOT EXISTS ');
}

module.exports = { cohortChatSupportSchema };
