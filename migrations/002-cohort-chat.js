'use strict';
const { randomUUID } = require('node:crypto');
const ID = '002-cohort-chat-local';
const CODES = ['MERCURY', 'VENUS', 'EARTH', 'MARS'];

// Explicitly invoked on disposable fixtures only; never imported by initSchema.
async function migrateCohortChat(db, { disposable = false } = {}) {
  if (!disposable || process.env.NODE_ENV !== 'test') throw new Error('Phase 2A migration requires NODE_ENV=test and an explicit disposable fixture');
  return db.withTransaction(async tx => {
    if (tx.isPostgres) await tx.get('SELECT pg_advisory_xact_lock(741002)');
    await tx.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    if (await tx.get('SELECT id FROM schema_migrations WHERE id=?', ID)) return { applied: false };
    await tx.exec(`
      CREATE TABLE cohorts (
        id TEXT PRIMARY KEY, intake_year INTEGER NOT NULL CHECK(intake_year BETWEEN 1900 AND 2300),
        group_code TEXT NOT NULL CHECK(group_code IN ('MERCURY','VENUS','EARTH','MARS')),
        current_semester INTEGER NOT NULL CHECK(current_semester BETWEEN 1 AND 8),
        status TEXT NOT NULL CHECK(status IN ('active','graduated')), version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, graduated_at TEXT
      );
      CREATE TABLE chat_groups (
        id TEXT PRIMARY KEY, cohort_id TEXT UNIQUE REFERENCES cohorts(id),
        kind TEXT NOT NULL DEFAULT 'cohort' CHECK(kind IN ('cohort','legacy')),
        status TEXT NOT NULL CHECK(status IN ('active','closed','recycling','recycled','quarantined')),
        realtime_epoch INTEGER NOT NULL DEFAULT 1 CHECK(realtime_epoch>0),
        projection_status TEXT NOT NULL DEFAULT 'pending' CHECK(projection_status IN ('pending','ready','failed')),
        projection_epoch INTEGER, created_at TEXT NOT NULL, closed_at TEXT, recycled_at TEXT,
        CHECK ((kind='legacy' AND cohort_id IS NULL AND status='quarantined') OR
          (kind='cohort' AND cohort_id IS NOT NULL AND status<>'quarantined'))
      );
      CREATE UNIQUE INDEX chat_one_legacy_room ON chat_groups(kind) WHERE kind='legacy';
      CREATE TABLE chat_group_slots (
        group_code TEXT PRIMARY KEY CHECK(group_code IN ('MERCURY','VENUS','EARTH','MARS')),
        current_chat_group_id TEXT UNIQUE REFERENCES chat_groups(id), version INTEGER NOT NULL DEFAULT 1
      );
      ALTER TABLE students ADD COLUMN cohort_id TEXT REFERENCES cohorts(id);
      ALTER TABLE chat_messages ADD COLUMN chat_group_id TEXT REFERENCES chat_groups(id);
      ALTER TABLE chat_messages ADD COLUMN client_id TEXT;
      CREATE UNIQUE INDEX chat_send_identity ON chat_messages(chat_group_id,studentId,client_id);
      CREATE INDEX chat_room_history ON chat_messages(chat_group_id,id);
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
    `);
    for (const code of CODES) await tx.run('INSERT INTO chat_group_slots(group_code) VALUES (?) RETURNING group_code', code);
    const legacyRoomId = randomUUID();
    await tx.run("INSERT INTO chat_groups(id,kind,status,created_at) VALUES (?,'legacy','quarantined',?) RETURNING id", legacyRoomId, new Date().toISOString());
    await tx.run('INSERT INTO schema_migrations(id) VALUES (?) RETURNING id', ID);
    return { applied: true, legacyRoomId };
  });
}
module.exports = { migrateCohortChat, CODES };
