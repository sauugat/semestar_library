'use strict';
const { randomUUID } = require('node:crypto');
const { cohortChatSupportSchema } = require('./cohort-chat-support-schema');
const ID = '003-cohort-chat-production';

// Explicit deployment step only. Never run from application startup. This adds
// the hardened chat schema to existing academic identities; it does not enroll
// students, relabel legacy messages, recycle rooms or enable the runtime.
async function migrateProductionCohortChat(db) {
  if (!db.isPostgres || typeof db.withTransaction !== 'function') {
    throw new Error('Production chat migration requires a transactional PostgreSQL adapter');
  }
  return db.withTransaction(async tx => {
    await tx.exec("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s'");
    await tx.get('SELECT pg_advisory_xact_lock(741002)');
    await tx.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    if (await tx.get('SELECT id FROM schema_migrations WHERE id=?', ID)) return { applied: false };
    const invalid = await tx.all(`SELECT c.id FROM cohorts c
      LEFT JOIN chat_groups g ON g.cohort_id=c.id AND g.kind='cohort' AND g.status='active'
      LEFT JOIN chat_group_slots s ON s.current_chat_group_id=g.id AND s.group_code=c.group_code
      WHERE c.status='active' AND (g.id IS NULL OR s.group_code IS NULL)`);
    if (invalid.length) throw new Error('Active academic cohorts must already have correctly linked rooms and slots');
    await tx.exec(`
      ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS chat_group_id TEXT REFERENCES chat_groups(id);
      ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS client_id TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS chat_send_identity ON chat_messages(chat_group_id,studentId,client_id);
      CREATE INDEX IF NOT EXISTS chat_room_history ON chat_messages(chat_group_id,id);
      CREATE UNIQUE INDEX IF NOT EXISTS chat_one_legacy_room ON chat_groups(kind) WHERE kind='legacy';
    `);
    await tx.exec(cohortChatSupportSchema({ idempotent: true }));
    // Older chat messages stay unassigned and inaccessible to cohort queries.
    // A quarantine room documents that boundary without changing their rows.
    const existing = await tx.get("SELECT id FROM chat_groups WHERE kind='legacy'");
    const legacyRoomId = existing?.id || randomUUID();
    if (!existing) await tx.run("INSERT INTO chat_groups(id,kind,status,created_at) VALUES (?,'legacy','quarantined',?) RETURNING id", legacyRoomId, new Date().toISOString());
    await tx.run('INSERT INTO schema_migrations(id) VALUES (?) RETURNING id', ID);
    return { applied: true, legacyRoomId };
  });
}

module.exports = { migrateProductionCohortChat };
